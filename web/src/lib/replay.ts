// Replays the whole dish from generation zero with petri-core and checks it against what the contract holds.
//
// The contract keeps one ordered ledger of everything that changes the dish, the agar, the NEAR vault or the credit
// pool: joins, purchases from the agar, sales back to it, plantings (with the price each paid and the NEAR and credit it
// brought), tides (with the history chain at that generation and what each paid), clock skips and refunds. At each
// generation the replay applies that generation's entries in order: it checks every planting is legal, paid the
// formula's price and its fee, every purchase and sale followed the curve and the sale allowance, and every tide paid
// the right share of the vault and the credit pool, the capped bounty and no more storage than a tide record costs.
// Between entries it steps Life and feeds the living exactly as the contract does. The board, the history chain, the
// agar, the burn, the vault, the credit pool and every colony's PETRI earnings, NEAR winnings and credit winnings must
// all come out identical, to the unit; and the contract's NEAR balance must cover everything it owes.

import { Engine, buy_quote, pattern_cells, quote, sell_quote } from "@/engine";
import type { Colony, DishState, Entry, Rules } from "./chain";
import { entryGeneration } from "./chain";

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
  /** The contract account: code hash, full-access keys, NEAR balance and storage used. */
  lock: { codeHash: string; fullAccessKeys: number; balance: string; storageUsage: number } | null;
};

type Problem = { generation: number; what: string };
type Kind = "plant" | "price" | "fee" | "buy" | "sell" | "tide";

/** Most a tide record can cost in storage (it is about 200 bytes at 10^19 yoctoNEAR a byte). */
const TIDE_STORAGE_MAX = 3n * 10n ** 21n;
const BYTE_COST = 10n ** 19n;

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
  creditWon = 0n;
  plants = 0;
  buys = 0;
  sells = 0;
  tides = 0;
  tidesMatched = 0;
  /** The first entry of each kind that did not follow the rules. */
  problems: Record<Kind, Problem | null> = { plant: null, price: null, fee: null, buy: null, sell: null, tide: null };
  log: { generation: number; text: string; ok: boolean }[] = [];
  private applied = new Set<number>();

  constructor(input: ReplayInput) {
    const { rules, state, ledger } = input;
    this.input = input;
    this.e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
    this.e.set_colonies(0);
    this.e.set_agar(rules.max_supply);
    this.target = Number(state.generation);
    this.at = new Map();
    for (const entry of ledger) {
      const g = entryGeneration(entry);
      this.at.set(g, [...(this.at.get(g) ?? []), entry]);
    }
  }

  get generation() {
    return this.e.generation();
  }

  private flag(kind: Kind, what: string) {
    if (!this.problems[kind]) this.problems[kind] = { generation: this.generation, what };
  }

  private applyEvents() {
    const g = this.generation;
    if (this.applied.has(g)) return;
    this.applied.add(g);
    const { rules, colonies } = this.input;
    for (const entry of this.at.get(g) ?? []) {
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
      } else if ("Sell" in entry) {
        const x = entry.Sell;
        this.sells++;
        const outstanding = BigInt(rules.max_supply) - this.burned - BigInt(this.e.agar());
        const want = BigInt(sell_quote(x.petri, this.e.agar(), rules.petri_price, rules.max_supply, rules.sell_bps, this.vault.toString(), outstanding.toString()));
        const near = BigInt(x.near);
        if (want !== near) this.flag("sell", `sold ${x.petri} units for ${x.near} yocto; the curve gives ${want}`);
        else if (near > this.sellLeft) this.flag("sell", `sold for ${x.near} yocto with only ${this.sellLeft} left to buy back before the tide`);
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
        const want = BigInt(quote(this.e.agar(), rules.feed_ppm, rules.keeper_bps, this.e.counted(), rules.live_floor, rules.payback, rules.min_cell_price, p.cells.length, p.siege, rules.siege_x));
        const cost = BigInt(p.cost);
        if (want !== cost) this.flag("price", `paid ${cost}, the formula gives ${want}`);
        const toPools = BigInt(p.near) + BigInt(p.credit);
        if (toPools < BigInt(rules.cell_fee) * BigInt(p.cells.length)) this.flag("fee", `colony ${p.colony} paid less than the cell fee`);
        const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
        this.burned += burn;
        this.returned += cost - burn;
        this.e.set_agar((BigInt(this.e.agar()) + cost - burn).toString());
        this.e.plant(p.colony, cells);
        this.vault += BigInt(p.near);
        this.nearIn += BigInt(p.near);
        this.pool += BigInt(p.credit);
        this.creditIn += BigInt(p.credit);
      } else if ("Refund" in entry) {
        this.vault += BigInt(entry.Refund.near);
      } else if ("Tide" in entry) {
        const t = entry.Tide;
        this.tides++;
        const chainOk = this.e.chain_hex() === t.chain;
        const pay = (this.vault * BigInt(rules.tide_bps)) / 10000n;
        const full = (pay * BigInt(rules.tide_bounty_bps)) / 10000n;
        const capped = full < BigInt(rules.max_bounty) ? full : BigInt(rules.max_bounty);
        const storage = BigInt(t.storage);
        const creditPay = (this.pool * BigInt(rules.tide_bps)) / 10000n;
        const pool = pay - capped;
        const [paidS, creditPaidS] = this.e.tide((pool > storage ? pool - storage : 0n).toString(), creditPay.toString()).split(",");
        const paid = BigInt(paidS);
        const creditPaid = BigInt(creditPaidS);
        const bounty = BigInt(t.bounty);
        const problem = !chainOk
          ? "the history chain differs"
          : pay !== BigInt(t.pay) || paid !== BigInt(t.paid)
            ? `paid ${t.paid} of ${t.pay}; the replay gives ${paid} of ${pay}`
            : bounty !== (paid > 0n ? capped : 0n)
              ? `bounty ${t.bounty}; the rules give ${paid > 0n ? capped : 0n}`
              : storage > TIDE_STORAGE_MAX
                ? `charged ${t.storage} yocto of storage for one record`
                : creditPay !== BigInt(t.credit_pay) || creditPaid !== BigInt(t.credit_paid)
                  ? `credit pool paid ${t.credit_paid} of ${t.credit_pay}; the replay gives ${creditPaid} of ${creditPay}`
                  : null;
        if (problem) this.flag("tide", problem);
        else this.tidesMatched++;
        this.vault -= paid + bounty + storage;
        this.pool -= creditPaid;
        this.nearTides += paid;
        this.creditWon += creditPaid;
        this.sellLeft = (this.vault * BigInt(rules.sell_cap_bps)) / 10000n;
        this.log.push({
          generation: g,
          text: `Tide at generation ${g.toLocaleString("en-US")}: ${chainOk ? "chain matches" : "chain differs"}, ${fmtNear(paid)} NEAR and ${fmtNear(creditPaid)} credit to colonies`,
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
      // Jump straight to the next generation that has an entry, within the budget.
      let next = this.generation + 1;
      const limit = Math.min(this.target, this.generation + left);
      while (next < limit && !this.at.has(next)) next++;
      const n = next - this.generation;
      this.e.step(n);
      left -= n;
    }
    this.applyEvents();
    return this.generation >= this.target;
  }

  checks(): Check[] {
    const { state, colonies, earnings, winnings, lock } = this.input;
    const earnedOk = colonies.filter((c, i) => this.e.earned_of(c.id) === (earnings[i] ?? "0")).length;
    const wonOk = colonies.filter((c, i) => this.e.won_of(c.id) === (winnings[i] ?? "0")).length;
    const creditOk = colonies.filter((c) => this.e.credit_won_of(c.id) === c.credit_won).length;
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
      rule("buys", "Every purchase followed the agar's curve", this.buys, "purchases", this.problems.buy),
      rule("sells", "Every sale back followed the curve and the allowance", this.sells, "sales", this.problems.sell),
      {
        id: "tides",
        label: "Every tide: chain, shares of the vault and credit pool, bounty, storage",
        expected: `${this.tides} ${this.tides === 1 ? "tide" : "tides"}`,
        got: this.problems.tide ? `differs at generation ${this.problems.tide.generation}: ${this.problems.tide.what}` : `${this.tidesMatched} of ${this.tides} match`,
        ok: this.tides > 0 ? this.problems.tide === null : this.target < Number(this.input.rules.tide_every),
      },
      c("agar", "PETRI left in the agar", fmt(BigInt(state.agar)), fmt(BigInt(this.e.agar()))),
      c("sold", "PETRI sold from the agar", fmt(BigInt(state.sold)), fmt(this.sold)),
      c("burned", "PETRI burned by planting", fmt(BigInt(state.burned)), fmt(this.burned)),
      c("returned", "PETRI returned to the agar by planting", fmt(BigInt(state.returned)), fmt(this.returned)),
      c("bought_back", "PETRI bought back by the agar", fmt(BigInt(state.bought_back)), fmt(this.boughtBack)),
      c("keeper", "PETRI set aside for keepers", fmt(keeper), fmt(BigInt(this.e.keeper_total()))),
      every("earned", "Every colony's lifetime PETRI earnings", earnedOk),
      c("vault", "NEAR in the tide vault", fmtNear(BigInt(state.vault)), fmtNear(this.vault)),
      c("near_in", "NEAR paid in by players", fmtNear(BigInt(state.near_in)), fmtNear(this.nearIn)),
      c("near_tides", "NEAR paid out at tides", fmtNear(BigInt(state.near_tides)), fmtNear(this.nearTides)),
      every("won", "Every colony's NEAR won at tides", wonOk),
      c("credit_pool", "Sponsored credit in the credit pool", fmtNear(BigInt(state.credit_pool)), fmtNear(this.pool)),
      c("credit_won", "Credit paid out at tides", fmtNear(BigInt(state.credit_won)), fmtNear(this.creditWon)),
      every("credit_each", "Every colony's credit won at tides", creditOk),
    ];
    if (lock) {
      // The contract's NEAR must cover the vault, the credit pool, unspent credit and unclaimed winnings.
      const owed = BigInt(state.vault) + BigInt(state.credit_pool) + BigInt(state.credit_given) + BigInt(state.credit_won) - BigInt(state.credit_spent) - BigInt(state.credit_reclaimed) + BigInt(state.tides_owed);
      const free = BigInt(lock.balance) - BigInt(lock.storageUsage) * BYTE_COST;
      out.push({
        id: "solvent",
        label: "The contract's NEAR covers everything it owes",
        expected: `${fmtNear(free)} NEAR held beyond storage`,
        got: `at least ${fmtNear(owed)} NEAR owed`,
        ok: free >= owed,
      });
      out.push({
        id: "lock",
        label: "Nobody can change the contract: no full-access key",
        expected: `${lock.fullAccessKeys} full-access key${lock.fullAccessKeys === 1 ? "" : "s"} on chain`,
        got: "0 needed",
        ok: lock.fullAccessKeys === 0,
      });
    }
    return out;
  }

  free() {
    this.e.free();
  }
}

export function fmt(units: bigint) {
  const whole = units / 1_000_000n;
  const frac = (units % 1_000_000n).toString().padStart(6, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
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
