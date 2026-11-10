// Replays the whole dish from generation zero with petri-core and checks it against what the contract holds.
//
// The contract keeps one ordered ledger of everything that changes the dish, the agar, the NEAR vault, the credit pool,
// the credit accounts hold, the NEAR owed to colonies or pending NEAR: joins, purchases from the agar, sales back to it,
// plantings (with the price each paid and the NEAR and credit it brought), tides (with the history chain at that
// generation, the bytes the tide stored and who ran it), clock skips, refunds of failed payouts, slides, sponsorships,
// claims and pending movements. At each generation the replay applies that generation's entries in order: it checks
// every planting is legal, paid the formula's price and its fee, every planting under a slide's licence was exactly the
// pattern of a slide of at least licence_min_cells cells at the licence's price and paid its royalty to the slide's
// holder at that point (or to the agar, for a planter that never attached NEAR), every purchase and sale followed the
// curve and the sale allowance, every claim took exactly what its colony was owed, and every refund is for exactly the
// payout it names. What each tide paid (its share of the vault and the credit pool, the capped bounty, none to the house
// whose bounty stays in the vault, and the storage its record cost) is not stored: the replay works it out from the
// ledger before it, and a wrong one shows in every total after. A colony that never put NEAR into the vault itself is
// paid its vault shares and its sales as credit; the replay knows which colonies have from their purchases and
// plantings, and pays each tide and sale the right way, and a tide's bounty as credit to a guest that ran it. Every specimen slide must be exactly the minting colony's living cells in its rectangle
// as the board stood, at the rule's price, all burned. It also stops at every tide generation and checks that a tide ran
// exactly when some colony outside the house had earned since the last one (an idle tide leaves no entry). Between
// entries it steps Life and feeds the living exactly as the contract does. The board, the history chain, the agar, the
// burn, the vault, the credit pool, every colony's PETRI earnings, NEAR winnings and credit winnings, and every slide's
// holder and royalties must all come out identical, to the unit. Every term of the solvency check is rebuilt from the
// ledger alone and compared with the contract's own counter, and the contract's NEAR balance must cover them.
//
// PETRI earned before a colony's first NEAR stays in the dish: the replay rebuilds every colony's kept PETRI (what it
// earned, bought with credit or was paid in royalties before its first NEAR, and PETRI bought with credit since, less
// what it planted or minted since), checks that no colony holding any sold PETRI for NEAR or paid for a pact, and that
// each colony's kept PETRI is what the contract holds back. Transfers are not in the ledger; none changes kept PETRI,
// and the contract refuses every transfer by a guest or a colony holding kept PETRI. It also rebuilds every pact and
// checks that no planting broke a pact binding its colony (no cell within pact_radius of a protected colony's living
// cells as the board stood), that offers kept to the rules, and the PETRI the dish holds for open offers.

import { Engine, buy_quote, credit_share, licence, pattern_cells, quote, sell_quote } from "@/engine";
import type { Colony, DishState, Entry, Rules, SlideView } from "./chain";
import { entryGeneration } from "./chain";

/** The published reproducible build both dishes run (v6.5, commit 27a5976); rebuild it to check this constant. */
export const BUILD_HASH = "CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD";

export type Check = { id: string; label: string; expected: string; got: string | null; ok: boolean | null };

export type ReplayInput = {
  rules: Rules;
  state: DishState;
  colonies: Colony[];
  ledger: Entry[];
  /** Each colony's lifetime PETRI earnings from the `earnings` view (index = colony id - 1). */
  earnings: string[];
  /** Each colony's NEAR won at tides from the `tide_winnings` view (index = colony id - 1). */
  winnings: string[];
  /** Every slide, from the `slides` view, in token order (without it, slide holders are not checked). */
  slides?: SlideView[];
  /** The contract account: code hash, full-access keys, NEAR balance and storage used. */
  lock: { codeHash: string; fullAccessKeys: number; balance: string; storageUsage: number } | null;
};

type Problem = { generation: number; what: string };
type Kind = "plant" | "price" | "fee" | "licence" | "buy" | "sell" | "tide" | "slide" | "claim" | "refund" | "kept" | "pact";

/** Most a tide or refund record can cost in storage (about 200 bytes at 10^19 yoctoNEAR a byte). */
const RECORD_STORAGE_MAX = 3n * 10n ** 21n;
const BYTE_COST = 10n ** 19n;
/** `by` of a tide a keeper (a house account with no colony) ran. */
export const HOUSE_RUNNER = 0xffff;
/** What a refunded payout was, as a Refund entry's `kind` names it. */
export const PAYOUT = { CLAIM: 0, SALE: 1, BOUNTY: 2, UNSPONSOR: 3, PENDING: 4 } as const;

/** What a Tide entry and its place in the tide index store: 126 + 4 bytes, and 45 more on the tide that starts an index page. */
const TIDE_BYTES = [130, 175];

type SlideSeen = { bitmap: Uint8Array; w: number; h: number; cells: number; moves: number; holder: string; royalties: bigint };
type PactSeen = { from: number; to: number; petri: bigint; until: number; accepted: boolean; ended: boolean };
/** Most pacts one colony is party to at once (accepted ones and the offers it made), and most open offers it can receive. */
const MAX_PACTS = 8;
const MAX_INCOMING = 16;
/** The least a pact offer carries, unless both colonies are the house's: 1 PETRI. */
const MIN_PACT_PETRI = 1_000_000n;

export class Replayer {
  e: Engine;
  input: ReplayInput;
  target: number;
  at: Map<number, Entry[]>;
  house: number[] = [];
  sold = 0n;
  returned = 0n;
  burned = 0n;
  boughtBack = 0n;
  vault = 0n;
  pool = 0n;
  sellLeft = 0n;
  nearIn = 0n;
  creditIn = 0n;
  nearTides = 0n;
  nearAsCredit = 0n;
  creditWon = 0n;
  creditSold = 0n;
  /** The solvency terms the contract counts, rebuilt from the ledger alone. */
  given = 0n;
  spent = 0n;
  reclaimed = 0n;
  owed = 0n;
  pending = 0n;
  royalties = 0n;
  plants = 0;
  licensed = 0;
  slides = 0;
  slidesBurned = 0n;
  buys = 0;
  sells = 0;
  tides = 0;
  tidesMatched = 0;
  claims = 0;
  refunds = 0;
  /** Sales for NEAR and pact payments, each checked against the colony's kept PETRI. */
  keptChecks = 0;
  pactsSeen: PactSeen[] = [];
  /** Plantings by colonies bound by a pact, each checked against the pacts. */
  bound = 0;
  escrow = 0n;
  /** Tide generations with nobody to pay, which the contract skips. */
  idleTides = 0;
  /** The first entry of each kind that did not follow the rules. */
  problems: Record<Kind, Problem | null> = { plant: null, price: null, fee: null, licence: null, buy: null, sell: null, tide: null, slide: null, claim: null, refund: null, kept: null, pact: null };
  log: { generation: number; text: string; ok: boolean }[] = [];
  /** What each tide paid, as the replay works it out (a Tide entry no longer records it): NEAR to colonies that have
   * attached NEAR, vault shares and a guest runner's bounty as credit, the credit pool's shares, and the bounty. */
  tidesPaid: { generation: number; by: number; paid: bigint; asCredit: bigint; creditPaid: bigint; bounty: bigint }[] = [];
  private applied = new Set<number>();
  private claimed = new Map<number, bigint>();
  private refunded = new Set<string>();
  private seen: SlideSeen[] = [];
  /** The bounty each tide paid, by the Tide entry's ledger index: a Refund of a bounty must give back exactly that. */
  private tideBounty = new Map<number, bigint>();
  /** Each entry's ledger index. */
  private indexOf = new Map<Entry, number>();
  /** Each colony's kept PETRI as the ledger gives it, and its earnings when last counted (a guest's count as kept). */
  private kept = new Map<number, bigint>();
  private synced = new Map<number, bigint>();
  /** Vault shares the engine counted as NEAR won that went to an attached colony holding kept PETRI, paid as credit. */
  private asCreditWon = new Map<number, bigint>();

  constructor(input: ReplayInput) {
    const { rules, state, ledger } = input;
    this.input = input;
    this.e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
    this.e.set_colonies(0);
    this.e.set_agar(rules.max_supply);
    this.target = Number(state.generation);
    this.at = new Map();
    ledger.forEach((entry, i) => {
      const g = entryGeneration(entry);
      this.at.set(g, [...(this.at.get(g) ?? []), entry]);
      this.indexOf.set(entry, i);
    });
  }

  get generation() {
    return this.e.generation();
  }

  private flag(kind: Kind, what: string) {
    if (!this.problems[kind]) this.problems[kind] = { generation: this.generation, what };
  }

  private accountOf(id: number): string {
    return this.input.colonies[id - 1]?.account ?? "";
  }

  keptOf(id: number): bigint {
    return this.kept.get(id) ?? 0n;
  }

  /** Count what colony `id` earned since it was last counted: kept, while it has never attached NEAR. */
  private sync(id: number) {
    const now = BigInt(this.e.earned_of(id));
    if (!this.e.has_attached(id)) this.kept.set(id, this.keptOf(id) + now - (this.synced.get(id) ?? 0n));
    this.synced.set(id, now);
  }

  /** Kept PETRI is spent first. */
  private spend(id: number, units: bigint) {
    const k = this.keptOf(id);
    this.kept.set(id, k > units ? k - units : 0n);
  }

  /** NEAR the engine counted as won by colony `id`, less the shares paid to it as credit while it held kept PETRI. */
  private wonOf(id: number): bigint {
    return BigInt(this.e.won_of(id)) - (this.asCreditWon.get(id) ?? 0n);
  }

  /** Paid in NEAR: a colony that brought at least min_join of NEAR in one call and holds no kept PETRI. */
  private paidInNear(id: number) {
    return this.e.has_attached(id) && this.keptOf(id) === 0n;
  }

  /** Pacts colony `id` is bound by or waits on: accepted ones it is party to and open offers it made (at most 8). */
  private livePacts(id: number) {
    return this.pactsSeen.filter((p) => !p.ended && (p.accepted ? p.from === id || p.to === id : p.from === id)).length;
  }

  /** Open offers made to colony `id` (at most 16). */
  private incomingPacts(id: number) {
    return this.pactsSeen.filter((p) => !p.ended && !p.accepted && p.to === id).length;
  }

  private applyEvents() {
    const g = this.generation;
    if (this.applied.has(g)) return;
    this.applied.add(g);
    const { rules, colonies, ledger } = this.input;
    const entries = this.at.get(g) ?? [];
    // A tide runs at a multiple of tide_every when some colony outside the house earned since the last one, and only then.
    const onSchedule = g > 0 && g % rules.tide_every === 0;
    const due = onSchedule && this.e.tide_due();
    const ran = entries.some((x) => "Tide" in x);
    if (due && !ran) this.flag("tide", "a tide was due (colonies had earned) but none was recorded");
    else if (ran && !due) this.flag("tide", "a tide was recorded with nobody to pay, or off the schedule");
    else if (onSchedule && !due) this.idleTides++;
    for (const entry of entries) {
      if ("Join" in entry) {
        const id = entry.Join.colony;
        this.e.set_colonies(id);
        if (colonies[id - 1]?.house) {
          this.house.push(id);
          this.e.set_house(new Uint16Array(this.house));
        }
      } else if ("Buy" in entry) {
        const b = entry.Buy;
        this.buys++;
        const paid = BigInt(b.near) + BigInt(b.credit);
        const want = BigInt(buy_quote(paid.toString(), this.e.agar(), rules.petri_price, rules.max_supply));
        if (want !== BigInt(b.petri)) this.flag("buy", `bought ${b.petri} units for ${paid} yocto; the curve gives ${want}`);
        this.e.set_agar((BigInt(this.e.agar()) - BigInt(b.petri)).toString());
        this.sold += BigInt(b.petri);
        this.vault += BigInt(b.near);
        this.nearIn += BigInt(b.near);
        this.pool += BigInt(b.credit);
        this.creditIn += BigInt(b.credit);
        this.spent += BigInt(b.spent ?? 0);
        // What a guest earned is kept until it first attaches; PETRI bought with credit is kept.
        this.sync(b.colony);
        this.kept.set(b.colony, this.keptOf(b.colony) + BigInt(credit_share(b.petri, b.credit, paid.toString())));
        // A colony is paid in NEAR only once one call of its brought at least min_join of NEAR to the vault.
        if (BigInt(b.near) >= BigInt(rules.min_join)) this.e.attach(b.colony);
      } else if ("Sell" in entry) {
        const x = entry.Sell;
        this.sells++;
        const outstanding = BigInt(rules.max_supply) - this.burned - BigInt(this.e.agar());
        const want = BigInt(sell_quote(x.petri, this.e.agar(), rules.petri_price, rules.max_supply, rules.sell_bps, this.vault.toString(), outstanding.toString()));
        const near = BigInt(x.near);
        if (want !== near) this.flag("sell", `sold ${x.petri} units for ${x.near} yocto; the curve gives ${want}`);
        else if (near > this.sellLeft) this.flag("sell", `sold for ${x.near} yocto with only ${this.sellLeft} left to buy back before the tide`);
        else if (x.as_credit === this.e.has_attached(x.colony)) this.flag("sell", `colony ${x.colony} was paid in ${x.as_credit ? "credit" : "NEAR"}, but it ${x.as_credit ? "has" : "never"} attached NEAR`);
        else if (this.house.includes(x.colony)) this.flag("sell", `house colony ${x.colony} sold PETRI back`);
        this.sync(x.colony);
        if (x.as_credit) this.spend(x.colony, BigInt(x.petri));
        else {
          this.keptChecks++;
          if (this.keptOf(x.colony) > 0n) this.flag("kept", `colony ${x.colony} sold PETRI for NEAR while it held ${fmt(this.keptOf(x.colony))} kept PETRI`);
        }
        if (x.as_credit) this.creditSold += BigInt(x.paid);
        this.e.set_agar((BigInt(this.e.agar()) + BigInt(x.petri)).toString());
        this.boughtBack += BigInt(x.petri);
        this.vault -= near;
        this.sellLeft -= near;
      } else if ("Plant" in entry) {
        const p = entry.Plant;
        this.plants++;
        const cells = new Uint32Array(p.cells);
        const legal = this.e.check_plant(p.colony, cells, rules.buffer, rules.max_plant_cells);
        const siege = legal.startsWith("siege:");
        if (legal !== "" && !siege) this.flag("plant", `colony ${p.colony}'s planting was not legal (${legal})`);
        else if (siege !== p.siege) this.flag("plant", `colony ${p.colony}'s planting was ${siege ? "" : "not "}a siege`);
        // No cell within pact_radius of a colony an accepted pact binding this one protects, as the board stood.
        const protect = this.pactsSeen.filter((q) => q.to === p.colony && q.accepted && !q.ended && g < q.until).map((q) => q.from);
        if (protect.length > 0) {
          this.bound++;
          const breach = this.e.pact_breach(cells, new Uint16Array(protect), rules.pact_radius ?? 8);
          if (breach !== "") this.flag("pact", `colony ${p.colony}'s planting broke its pact with colony ${breach.split(",")[2]}`);
        }
        // Kept PETRI is spent first, the royalty too; a royalty to a guest holder is kept.
        this.sync(p.colony);
        const keptBefore = this.keptOf(p.colony);
        this.spend(p.colony, BigInt(p.cost) + BigInt(p.licence?.royalty ?? 0));
        if (p.licence?.holder && !p.licence.to_agar) {
          const h = colonies.find((c) => c.account === p.licence?.holder);
          if (h && !this.e.has_attached(h.id)) this.kept.set(h.id, this.keptOf(h.id) + BigInt(p.licence.royalty));
        }
        const base = quote(this.e.agar(), rules.feed_ppm, rules.keeper_bps, this.e.counted(), rules.live_floor, rules.payback, rules.min_cell_price, p.cells.length, p.siege, rules.siege_x);
        const l = p.licence;
        if (!l) {
          if (base !== p.cost) this.flag("price", `paid ${p.cost}, the formula gives ${base}`);
        } else {
          this.licensed++;
          const [cost, toll] = licence(base, rules.slide_discount_bps, rules.slide_royalty_bps).split(",");
          const s = this.seen[Number(l.token) - 1];
          const who = l.holder ?? this.accountOf(p.colony);
          // A planter that has never attached NEAR (before this planting), or that holds kept PETRI beyond the planting's
          // cost (which the royalty would come from), pays its royalty to the agar.
          const toAgar = !!l.holder && (!this.e.has_attached(p.colony) || keptBefore > BigInt(p.cost));
          if (!s) this.flag("licence", `slide ${l.token} did not exist yet`);
          else if (s.cells < (rules.licence_min_cells ?? 0)) this.flag("licence", `slide ${l.token} holds ${s.cells} cells, under the ${rules.licence_min_cells} a licence needs`);
          else if (!this.e.fits_slide(cells, s.bitmap, s.w, s.h)) this.flag("licence", `colony ${p.colony}'s planting is not slide ${l.token}'s pattern`);
          else if (!!l.to_agar !== toAgar) this.flag("licence", `colony ${p.colony}'s royalty went to ${l.to_agar ? "the agar" : "the holder"}, but it ${toAgar ? "never attached NEAR or held kept PETRI" : "had attached NEAR and held no kept PETRI beyond the cost"}`);
          else if (cost !== p.cost) this.flag("price", `a licensed planting paid ${p.cost}; the licence gives ${cost}`);
          else if (l.moves < s.moves || (l.moves === s.moves && who !== s.holder)) this.flag("licence", `slide ${l.token}'s holder was ${s.holder} (after ${s.moves} moves), not ${who}`);
          else if (l.holder === this.accountOf(p.colony)) this.flag("licence", `colony ${p.colony} paid its own slide a royalty`);
          else if (l.royalty !== (l.holder ? toll : "0")) this.flag("licence", `royalty ${l.royalty}; the licence gives ${l.holder ? toll : "0"}`);
          else if (l.holder && this.house.includes(p.colony)) this.flag("licence", `house colony ${p.colony} paid a royalty to ${l.holder}`);
          if (s) {
            s.moves = Math.max(s.moves, l.moves);
            s.holder = who;
            if (!l.to_agar) s.royalties += BigInt(l.royalty);
          }
          if (l.to_agar) {
            // Back into the agar, as a planting's returned half is.
            this.returned += BigInt(l.royalty);
            this.e.set_agar((BigInt(this.e.agar()) + BigInt(l.royalty)).toString());
          } else this.royalties += BigInt(l.royalty);
        }
        const toPools = BigInt(p.near) + BigInt(p.credit);
        if (toPools < BigInt(rules.cell_fee) * BigInt(p.cells.length)) this.flag("fee", `colony ${p.colony} paid less than the cell fee`);
        const cost = BigInt(p.cost);
        const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
        this.burned += burn;
        this.returned += cost - burn;
        this.e.set_agar((BigInt(this.e.agar()) + cost - burn).toString());
        // v6.3: a colony's first NEAR clears the stake it planted as a guest, and an attached colony stakes only the part
        // of the planting's cost (not its royalty, v6.4) its kept PETRI (spent first) did not pay.
        if (BigInt(p.near) >= BigInt(rules.min_join)) this.e.attach(p.colony);
        this.e.plant_paid(p.colony, cells, cost.toString(), keptBefore.toString());
        this.vault += BigInt(p.near);
        this.nearIn += BigInt(p.near);
        this.pool += BigInt(p.credit);
        this.creditIn += BigInt(p.credit);
        this.spent += BigInt(p.spent ?? 0);
      } else if ("Refund" in entry) {
        const r = entry.Refund;
        this.refunds++;
        const of = ledger[Number(r.of)];
        const sent =
          r.kind === PAYOUT.CLAIM && of && "Claim" in of
            ? of.Claim.paid
            : r.kind === PAYOUT.SALE && of && "Sell" in of && !of.Sell.as_credit
              ? of.Sell.paid
              : r.kind === PAYOUT.BOUNTY && of && "Tide" in of
                ? this.tideBounty.get(Number(r.of))?.toString()
                : r.kind === PAYOUT.UNSPONSOR && of && "Unsponsor" in of
                  ? of.Unsponsor.amount
                  : r.kind === PAYOUT.PENDING && of && "Unpend" in of
                    ? of.Unpend.paid
                    : undefined;
        const storage = BigInt(r.storage);
        if (sent === undefined) this.flag("refund", `a refund of entry ${r.of}, which is no payout of kind ${r.kind}`);
        else if (sent !== r.near) this.flag("refund", `a refund of ${r.near} for a payout of ${sent}`);
        else if (this.refunded.has(r.of)) this.flag("refund", `entry ${r.of} refunded twice`);
        else if (storage > BigInt(r.near) || storage > RECORD_STORAGE_MAX) this.flag("refund", `a refund charged ${r.storage} yocto of storage`);
        this.refunded.add(r.of);
        const back = BigInt(r.near) - storage;
        if (r.kind === PAYOUT.BOUNTY) this.vault += back;
        else this.pending += back;
      } else if ("Slide" in entry) {
        const x = entry.Slide;
        this.slides++;
        const want = this.e.region_bitmap(x.colony, x.x, x.y, x.w, x.h);
        const got = fromB64(x.bitmap);
        const cells = want.reduce((n, b) => n + popcount(b), 0);
        const cost = BigInt(x.cost);
        const price = BigInt(rules.slide_cells_price) * BigInt(cells);
        if (x.w < 4 || x.w > 32 || x.h < 4 || x.h > 32) this.flag("slide", `slide ${x.token} is ${x.w} × ${x.h}; slides are 4 to 32 a side`);
        else if (Number(x.token) !== this.slides) this.flag("slide", `slide ${x.token} is out of order`);
        else if (want.length !== got.length || want.some((b, i) => b !== got[i])) this.flag("slide", `slide ${x.token} is not colony ${x.colony}'s cells as the dish stood`);
        else if (cells !== x.cells || cells < rules.slide_min_cells) this.flag("slide", `slide ${x.token} holds ${cells} cells (recorded ${x.cells}, at least ${rules.slide_min_cells})`);
        else if (cost !== price) this.flag("slide", `slide ${x.token} burned ${x.cost}; the rule gives ${price}`);
        this.sync(x.colony);
        this.spend(x.colony, cost);
        this.burned += cost;
        this.slidesBurned += cost;
        this.spent += BigInt(x.spent ?? 0);
        this.seen.push({ bitmap: new Uint8Array(want), w: x.w, h: x.h, cells, moves: 0, holder: this.accountOf(x.colony), royalties: 0n });
      } else if ("Sponsor" in entry) {
        this.given += BigInt(entry.Sponsor.amount);
      } else if ("Unsponsor" in entry) {
        this.reclaimed += BigInt(entry.Unsponsor.amount);
      } else if ("Claim" in entry) {
        const c = entry.Claim;
        this.claims++;
        // A claim takes all its colony was owed: what it won at the tides less what it claimed before.
        const owedNow = this.wonOf(c.colony) - (this.claimed.get(c.colony) ?? 0n);
        // No NEAR claim while the colony holds kept PETRI.
        this.keptChecks++;
        if (this.keptOf(c.colony) > 0n) this.flag("kept", `colony ${c.colony} claimed NEAR while it held ${fmt(this.keptOf(c.colony))} kept PETRI`);
        else if (BigInt(c.near) !== owedNow) this.flag("claim", `colony ${c.colony} claimed ${c.near} NEAR; it was owed ${owedNow}`);
        else if (BigInt(c.paid) > BigInt(c.near) || BigInt(c.near) - BigInt(c.paid) > RECORD_STORAGE_MAX) this.flag("claim", `colony ${c.colony} was sent ${c.paid} of ${c.near}`);
        this.claimed.set(c.colony, (this.claimed.get(c.colony) ?? 0n) + BigInt(c.near));
        this.owed -= BigInt(c.near);
      } else if ("Pending" in entry) {
        this.pending += BigInt(entry.Pending.near);
      } else if ("Unpend" in entry) {
        this.pending -= BigInt(entry.Unpend.near);
      } else if ("Dust" in entry) {
        this.vault += BigInt(entry.Dust.near);
        this.nearIn += BigInt(entry.Dust.near);
      } else if ("Burn" in entry) {
        this.burned += BigInt(entry.Burn.petri);
      } else if ("PactOffer" in entry) {
        const o = entry.PactOffer;
        const petri = BigInt(o.petri);
        const until = Number(o.until);
        if (o.pact !== this.pactsSeen.length + 1) this.flag("pact", `pact ${o.pact} is out of order`);
        else if (o.from === o.to || until <= g || until > g + (rules.pact_max_gens ?? 0)) this.flag("pact", `pact ${o.pact} runs to generation ${until}`);
        else if (this.livePacts(o.from) >= MAX_PACTS) this.flag("pact", `pact ${o.pact}: colony ${o.from} already had ${MAX_PACTS} pacts and offers`);
        else if (this.incomingPacts(o.to) >= MAX_INCOMING) this.flag("pact", `pact ${o.pact}: colony ${o.to} already had ${MAX_INCOMING} open offers`);
        else if (petri < MIN_PACT_PETRI && !(this.house.includes(o.from) && this.house.includes(o.to))) this.flag("pact", `pact ${o.pact} carries ${fmt(petri)} PETRI; an offer carries at least 1`);
        else if (this.pactsSeen.some((q) => q.from === o.from && q.to === o.to && !q.accepted && !q.ended)) this.flag("pact", `pact ${o.pact}: a second open offer from colony ${o.from} to colony ${o.to}`);
        else if (petri > 0n && this.house.includes(o.from) && !this.house.includes(o.to)) this.flag("pact", `pact ${o.pact}: the house offered a player PETRI`);
        if (petri > 0n && !this.house.includes(o.from)) {
          // Only PETRI its maker could sell pays for a pact (the house's PETRI stays in the house, so it is not held back).
          this.sync(o.from);
          this.keptChecks++;
          if (!this.e.has_attached(o.from) || this.keptOf(o.from) > 0n) this.flag("kept", `colony ${o.from} paid for pact ${o.pact} with PETRI it could not sell`);
        }
        this.spent += BigInt(o.spent ?? 0);
        this.escrow += petri;
        this.pactsSeen.push({ from: o.from, to: o.to, petri, until, accepted: false, ended: false });
      } else if ("PactAccept" in entry) {
        const q = this.pactsSeen[entry.PactAccept.pact - 1];
        if (!q || q.accepted || q.ended || g >= q.until) this.flag("pact", `pact ${entry.PactAccept.pact} accepted while not open`);
        else if (this.livePacts(q.to) >= MAX_PACTS) this.flag("pact", `pact ${entry.PactAccept.pact}: colony ${q.to} accepted it with ${MAX_PACTS} pacts and offers already`);
        if (q && !q.accepted && !q.ended && g < q.until) {
          q.accepted = true;
          this.escrow -= q.petri;
        }
      } else if ("PactEnd" in entry) {
        const q = this.pactsSeen[entry.PactEnd.pact - 1];
        if (!q || q.ended || (q.accepted && g < q.until)) this.flag("pact", `pact ${entry.PactEnd.pact} ended before its time`);
        else {
          if (!q.accepted) this.escrow -= q.petri;
          q.ended = true;
        }
      } else if ("Tide" in entry) {
        // A Tide entry keeps the chain, the bytes it stored and who ran it; everything it paid follows from the ledger
        // before it, and is worked out here.
        const t = entry.Tide;
        this.tides++;
        const chainOk = this.e.chain_hex() === t.chain;
        const pay = (this.vault * BigInt(rules.tide_bps)) / 10000n;
        const full = (pay * BigInt(rules.tide_bounty_bps)) / 10000n;
        const capped = full < BigInt(rules.max_bounty) ? full : BigInt(rules.max_bounty);
        const cost = BigInt(t.bytes) * BYTE_COST;
        const creditPay = (this.pool * BigInt(rules.tide_bps)) / 10000n;
        const left = pay - capped;
        const storage0 = cost < left ? cost : left;
        // An attached colony holding kept PETRI is paid its vault share as credit: the engine counts it as NEAR won, so
        // it is moved to credit here.
        const heldBack = [...this.kept].filter(([id, k]) => k > 0n && this.e.has_attached(id)).map(([id]) => [id, BigInt(this.e.won_of(id))] as const);
        const [paidS, creditPaidS, asCreditS] = this.e.tide((left - storage0).toString(), creditPay.toString()).split(",");
        let paid = BigInt(paidS);
        const creditPaid = BigInt(creditPaidS);
        let asCredit = BigInt(asCreditS);
        for (const [id, before] of heldBack) {
          const share = BigInt(this.e.won_of(id)) - before;
          if (share === 0n) continue;
          this.asCreditWon.set(id, (this.asCreditWon.get(id) ?? 0n) + share);
          this.e.add_credit_won(id, share.toString());
          paid -= share;
          asCredit += share;
        }
        const winners = paid + asCredit > 0n;
        // Without winners only the storage leaves the vault, as much of it as the vault holds.
        const storage = winners ? storage0 : cost < this.vault ? cost : this.vault;
        // A tide the house ran (a house colony, or a keeper) pays no bounty: it stays in the vault.
        const houseRunner = t.by === HOUSE_RUNNER || this.house.includes(t.by);
        const bounty = winners && !houseRunner ? capped : 0n;
        this.tideBounty.set(this.indexOf.get(entry) ?? -1, bounty);
        // A guest (a colony that never attached NEAR), or a colony holding kept PETRI, that ran the tide is paid its
        // bounty as credit.
        const bountyCredit = t.by > 0 && t.by !== HOUSE_RUNNER && !this.paidInNear(t.by) ? bounty : 0n;
        if (bountyCredit > 0n) this.e.add_credit_won(t.by, bountyCredit.toString());
        const problem = !chainOk ? "the history chain differs" : !TIDE_BYTES.includes(Number(t.bytes)) ? `stored ${t.bytes} bytes; a tide stores ${TIDE_BYTES.join(" or ")}` : null;
        if (problem) this.flag("tide", problem);
        else this.tidesMatched++;
        this.tidesPaid.push({ generation: g, by: t.by, paid, asCredit: asCredit + bountyCredit, creditPaid, bounty });
        this.vault -= paid + asCredit + bounty + storage;
        this.pool -= creditPaid;
        this.owed += paid;
        this.nearTides += paid;
        this.nearAsCredit += asCredit + bountyCredit;
        this.creditWon += creditPaid + asCredit + bountyCredit;
        this.sellLeft = (this.vault * BigInt(rules.sell_cap_bps)) / 10000n;
        this.log.push({
          generation: g,
          text: `Tide at generation ${g.toLocaleString("en-US")}: ${chainOk ? "chain matches" : "chain differs"}, ${fmtNear(paid)} NEAR and ${fmtNear(creditPaid + asCredit)} credit to colonies`,
          ok: !problem,
        });
      }
      // A Skip entry only moves the clock; the dish does not change.
    }
  }

  /** Run up to `budget` generations. Returns true when the replay has reached the contract's stored generation. */
  run(budget: number): boolean {
    let left = budget;
    while (left > 0) {
      this.applyEvents();
      if (this.generation >= this.target) return true;
      // Jump straight to the next generation that has an entry or is a tide's, within the budget.
      let next = this.generation + 1;
      const limit = Math.min(this.target, this.generation + left);
      const every = this.input.rules.tide_every;
      while (next < limit && !this.at.has(next) && next % every !== 0) next++;
      const n = next - this.generation;
      this.e.step(n);
      left -= n;
    }
    this.applyEvents();
    return this.generation >= this.target;
  }

  checks(): Check[] {
    const { state, colonies, earnings, winnings, slides, lock } = this.input;
    const earnedOk = colonies.filter((c, i) => this.e.earned_of(c.id) === (earnings[i] ?? "0")).length;
    const wonOk = colonies.filter((c, i) => this.wonOf(c.id).toString() === (winnings[i] ?? "0")).length;
    const creditOk = colonies.filter((c) => this.e.credit_won_of(c.id) === c.credit_won).length;
    for (const c of colonies) this.sync(c.id);
    const keptOk = colonies.filter((c) => this.keptOf(c.id).toString() === String(c.kept ?? "0")).length;
    // Each slide ends with the holder the replay last saw, unless it moved since; and with the royalties the ledger paid.
    const slidesOk = (slides ?? []).filter((v, i) => {
      const s = this.seen[i];
      return !!s && v.moves >= s.moves && (v.moves !== s.moves || v.owner_id === s.holder) && BigInt(v.royalties) === s.royalties;
    }).length;
    const keeper = BigInt(state.keeper_pot) + BigInt(state.keeper_paid);
    const c = (id: string, label: string, expected: string, got: string): Check => ({ id, label, expected, got, ok: expected === got });
    const rule = (id: string, label: string, count: number, noun: string, p: Problem | null): Check => ({
      id,
      label,
      expected: `${count} ${noun}`,
      got: p ? `differs at generation ${p.generation.toLocaleString("en-US")}: ${p.what}` : `${count} of ${count} match`,
      ok: p === null,
    });
    const every = (id: string, label: string, ok: number) => ({ id, label, expected: `${colonies.length} colonies`, got: `${ok} of ${colonies.length} match`, ok: ok === colonies.length });
    const out: Check[] = [
      c("chain", `History chain at generation ${this.target.toLocaleString("en-US")}`, state.chain, this.e.chain_hex()),
      c("board", "Board hash: every cell and its owner", state.board_hash, this.e.board_hash_hex()),
      c("live", "Living cells", state.total_live.toLocaleString("en-US"), this.e.total_live().toLocaleString("en-US")),
      rule("legal", "Every planting was legal, sieges marked", this.plants, "plantings", this.problems.plant),
      rule("prices", "Every planting paid the formula's price", this.plants, "plantings", this.problems.price),
      rule("fees", "Every planting paid its cell fee", this.plants, "plantings", this.problems.fee),
      rule("licences", "Every licensed planting was a slide of at least licence_min_cells (12) cells, its pattern, and paid the holder of the day (or the agar, for a planter that never attached NEAR or holds kept PETRI beyond the cost)", this.licensed, "licensed plantings", this.problems.licence),
      rule("buys", "Every purchase followed the agar's curve", this.buys, "purchases", this.problems.buy),
      rule("sells", "Every sale back followed the curve and the allowance, and none was the house's", this.sells, "sales", this.problems.sell),
      {
        id: "specimens",
        label: "Specimens: every slide is its colony's own cells as the dish stood, at the rule's price, burned",
        expected: `${state.slides} ${state.slides === "1" ? "slide" : "slides"}`,
        got: this.problems.slide
          ? `differs at generation ${this.problems.slide.generation.toLocaleString("en-US")}: ${this.problems.slide.what}`
          : `${this.slides} of ${state.slides} match the dish`,
        ok: this.problems.slide === null && String(this.slides) === state.slides,
      },
      ...(slides ? [c("slide_holders", "Every slide's holder and the royalties it was paid", `${slides.length} slides`, `${slidesOk} slides`)] : []),
      {
        id: "tides",
        label: "Every tide: ran when due, chain and stored bytes; its shares of the vault and credit pool, bounty (none to the house) and storage worked out from the ledger",
        expected: `${this.tides} ${this.tides === 1 ? "tide" : "tides"}`,
        got: this.problems.tide
          ? `differs at generation ${this.problems.tide.generation}: ${this.problems.tide.what}`
          : `${this.tidesMatched} of ${this.tides} match${this.idleTides > 0 ? `; ${this.idleTides} idle, skipped` : ""}`,
        ok: this.problems.tide === null,
      },
      rule("claims", "Every claim took exactly what its colony was owed", this.claims, "claims", this.problems.claim),
      rule("refunds", "Every refund is for exactly the payout it names, once", this.refunds, "refunds", this.problems.refund),
      rule("kept", "No colony holding kept PETRI (earned before its first NEAR, or bought with credit) sold PETRI for NEAR, claimed NEAR or paid for a pact", this.keptChecks, "sales, claims and pact payments", this.problems.kept),
      every("kept_each", "Every colony's kept PETRI, from the ledger", keptOk),
      rule("pacts", "Every pact kept to the rules (at least 1 PETRI; 8 pacts and own offers, 16 offers received), and no planting broke a pact binding its colony", this.pactsSeen.length + this.bound, "pacts and bound plantings", this.problems.pact),
      c("pact_escrow", "PETRI the dish holds for pact offers not yet accepted", fmt(BigInt(state.pact_escrow ?? "0")), fmt(this.escrow)),
      c("agar", "PETRI left in the agar", fmt(BigInt(state.agar)), fmt(BigInt(this.e.agar()))),
      c("sold", "PETRI sold from the agar", fmt(BigInt(state.sold)), fmt(this.sold)),
      c("burned", "PETRI burned by planting, by specimen slides and by unregistering", fmt(BigInt(state.burned)), fmt(this.burned)),
      c("slides_burned", "PETRI burned by specimen slides", fmt(BigInt(state.slides_burned)), fmt(this.slidesBurned)),
      c("royalties", "PETRI paid to slide holders in royalties", fmt(BigInt(state.royalties)), fmt(this.royalties)),
      c("returned", "PETRI returned to the agar by planting", fmt(BigInt(state.returned)), fmt(this.returned)),
      c("bought_back", "PETRI bought back by the agar", fmt(BigInt(state.bought_back)), fmt(this.boughtBack)),
      c("keeper", "PETRI set aside for keepers", fmt(keeper), fmt(BigInt(this.e.keeper_total()))),
      every("earned", "Every colony's lifetime PETRI earnings", earnedOk),
      c("vault", "NEAR in the tide vault", fmtNear(BigInt(state.vault)), fmtNear(this.vault)),
      c("near_in", "NEAR paid in by players", fmtNear(BigInt(state.near_in)), fmtNear(this.nearIn)),
      c("near_tides", "NEAR paid out at tides", fmtNear(BigInt(state.near_tides)), fmtNear(this.nearTides)),
      c("near_as_credit", "Vault shares and bounties paid as credit to colonies that never attached NEAR", fmtNear(BigInt(state.near_as_credit)), fmtNear(this.nearAsCredit)),
      c("credit_sold", "Sales paid as credit to colonies that never attached NEAR", fmtNear(BigInt(state.credit_sold)), fmtNear(this.creditSold)),
      every("won", "Every colony's NEAR won at tides", wonOk),
      c("credit_pool", "Sponsored credit in the credit pool", fmtNear(BigInt(state.credit_pool)), fmtNear(this.pool)),
      c("credit_won", "Credit paid out at tides", fmtNear(BigInt(state.credit_won)), fmtNear(this.creditWon)),
      c("credit_given", "Credit sponsored, from the ledger", fmtNear(BigInt(state.credit_given)), fmtNear(this.given)),
      c("credit_spent", "Credit spent in the dish, from the ledger", fmtNear(BigInt(state.credit_spent)), fmtNear(this.spent)),
      c("credit_reclaimed", "Credit taken back by its sponsors, from the ledger", fmtNear(BigInt(state.credit_reclaimed)), fmtNear(this.reclaimed)),
      c("tides_owed", "NEAR won and not yet claimed, from the ledger", fmtNear(BigInt(state.tides_owed)), fmtNear(this.owed)),
      c("pending", "Pending NEAR, from the ledger", fmtNear(BigInt(state.pending)), fmtNear(this.pending)),
      every("credit_each", "Every colony's credit won at tides", creditOk),
    ];
    if (lock) {
      // The contract's NEAR (and any wNEAR it has not unwrapped yet) must cover the vault, the credit pool, unspent credit
      // (won or sponsored), unclaimed winnings and pending NEAR, every one of them rebuilt from the ledger.
      const outstanding = this.given + this.creditWon + this.creditSold - this.spent - this.reclaimed;
      const owed = this.vault + this.pool + outstanding + this.owed + this.pending;
      const free = BigInt(lock.balance) - BigInt(lock.storageUsage) * BYTE_COST + BigInt(state.wrapped);
      out.push({
        id: "solvent",
        label: "The contract's NEAR covers everything it owes, as the ledger counts it",
        expected: `${fmtNear(free)} NEAR held beyond storage`,
        got: `at least ${fmtNear(owed)} NEAR owed`,
        ok: free >= owed,
      });
      out.push({
        id: "code",
        label: "The contract runs the published reproducible build",
        expected: BUILD_HASH,
        got: lock.codeHash,
        ok: lock.codeHash === BUILD_HASH,
      });
      // The team keeps one full-access key so a bug can be fixed (new code plus relaunch); it is disclosed, and new code
      // would fail the check above.
      out.push({
        id: "lock",
        label:
          lock.fullAccessKeys === 0
            ? "No full-access key: nobody can deploy other code"
            : "Disclosed: the team holds a full-access key, so a bug can be fixed; new code would change the hash above",
        expected: `${lock.fullAccessKeys} full-access key${lock.fullAccessKeys === 1 ? "" : "s"} on chain`,
        got: "disclosed",
        ok: true,
      });
    }
    return out;
  }

  free() {
    this.e.free();
  }
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function popcount(b: number) {
  let n = 0;
  for (let v = b; v; v &= v - 1) n++;
  return n;
}

export function fmt(units: bigint) {
  const neg = units < 0n;
  const v = neg ? -units : units;
  const whole = v / 1_000_000n;
  const frac = (v % 1_000_000n).toString().padStart(6, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${frac}`;
}

/** yoctoNEAR as NEAR with every digit down to the yocto, so a one-yocto difference shows. */
export function fmtNear(yocto: bigint) {
  const neg = yocto < 0n;
  const v = neg ? -yocto : yocto;
  const whole = v / 10n ** 24n;
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

export { pattern_cells };
