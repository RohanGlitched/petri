// Replays the whole dish from generation zero with petri-core and checks it against what the contract holds.
//
// The contract keeps one ordered ledger of everything that changes the dish, the agar or the NEAR vault: joins,
// purchases from the agar, sales back to it, plantings (with the price each paid and the NEAR it brought) and tides
// (with the history chain at that generation and what each paid). At each generation the replay applies that
// generation's entries in order: it checks every planting is legal and paid the formula's price, every purchase and
// sale followed the curve, and every tide paid the right share of the vault, split by what each colony earned. Between
// entries it steps Life and feeds the living exactly as the contract does. The board, the history chain, the agar,
// the burn, the vault and every colony's PETRI earnings and NEAR winnings must all come out identical, to the unit.

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
  /** The contract account's code hash and how many full-access keys it has. */
  lock: { codeHash: string; fullAccessKeys: number } | null;
};

type Problem = { generation: number; what: string };

export class Replayer {
  e: Engine;
  input: ReplayInput;
  target: number;
  at: Map<number, Entry[]>;
  house: number[] = [];
  k: bigint;
  sold = 0n;
  returned = 0n;
  burned = 0n;
  boughtBack = 0n;
  vault = 0n;
  nearIn = 0n;
  nearTides = 0n;
  plants = 0;
  buys = 0;
  sells = 0;
  tides = 0;
  tidesMatched = 0;
  /** The first planting, purchase, sale or tide that did not follow the rules, by kind. */
  problems: Record<"plant" | "price" | "buy" | "sell" | "tide", Problem | null> = { plant: null, price: null, buy: null, sell: null, tide: null };
  log: { generation: number; text: string; ok: boolean }[] = [];
  private applied = new Set<number>();

  constructor(input: ReplayInput) {
    const { rules, state, ledger } = input;
    this.input = input;
    this.e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor);
    this.e.set_colonies(0);
    this.e.set_agar(rules.max_supply);
    this.k = (BigInt(rules.petri_price) / 1_000_000n) * BigInt(rules.max_supply);
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

  private flag(kind: keyof Replayer["problems"], what: string) {
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
        const want = BigInt(buy_quote(b.near, this.e.agar(), rules.petri_price, rules.max_supply));
        if (want !== BigInt(b.petri)) this.flag("buy", `bought ${b.petri} units for ${b.near} yocto; the curve gives ${want}`);
        this.e.set_agar((BigInt(this.e.agar()) - BigInt(b.petri)).toString());
        this.sold += BigInt(b.petri);
        this.vault += BigInt(b.near);
        this.nearIn += BigInt(b.near);
      } else if ("Sell" in entry) {
        const x = entry.Sell;
        this.sells++;
        const outstanding = BigInt(rules.max_supply) - this.burned - BigInt(this.e.agar());
        const want = BigInt(sell_quote(x.petri, this.e.agar(), rules.petri_price, rules.max_supply, rules.sell_bps, this.vault.toString(), outstanding.toString()));
        if (want !== BigInt(x.near)) this.flag("sell", `sold ${x.petri} units for ${x.near} yocto; the curve gives ${want}`);
        this.e.set_agar((BigInt(this.e.agar()) + BigInt(x.petri)).toString());
        this.boughtBack += BigInt(x.petri);
        this.vault -= BigInt(x.near);
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
        const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
        this.burned += burn;
        this.returned += cost - burn;
        this.e.set_agar((BigInt(this.e.agar()) + cost - burn).toString());
        this.e.plant(p.colony, cells);
        this.vault += BigInt(p.near);
        this.nearIn += BigInt(p.near);
      } else {
        const t = entry.Tide;
        this.tides++;
        const chainOk = this.e.chain_hex() === t.chain;
        const pay = (this.vault * BigInt(rules.tide_bps)) / 10000n;
        const bounty = BigInt(t.bounty);
        const storage = BigInt(t.storage);
        const fullBounty = (pay * BigInt(rules.tide_bounty_bps)) / 10000n;
        const capped = fullBounty < BigInt(rules.max_bounty) ? fullBounty : BigInt(rules.max_bounty);
        const pool = pay - capped;
        const paid = BigInt(this.e.tide((pool > storage ? pool - storage : 0n).toString()));
        const ok = chainOk && pay === BigInt(t.pay) && paid === BigInt(t.paid) && (paid === 0n || bounty === capped);
        if (ok) this.tidesMatched++;
        else this.flag("tide", !chainOk ? "the history chain differs" : `paid ${t.paid} of ${t.pay}; the replay gives ${paid} of ${pay}`);
        this.vault -= paid + bounty + storage;
        this.nearTides += paid;
        this.log.push({
          generation: g,
          text: `Tide at generation ${g.toLocaleString("en-US")}: ${chainOk ? "chain matches" : "chain differs"}, ${fmtNear(paid)} NEAR to colonies`,
          ok,
        });
      }
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
    const keeper = BigInt(state.keeper_pot) + BigInt(state.keeper_paid);
    const c = (id: string, label: string, expected: string, got: string): Check => ({ id, label, expected, got, ok: expected === got });
    const rule = (id: string, label: string, count: number, noun: string, p: Problem | null): Check => ({
      id,
      label,
      expected: `${count} ${noun}`,
      got: p ? `differs at generation ${p.generation.toLocaleString("en-US")}: ${p.what}` : `${count} of ${count} match`,
      ok: p === null,
    });
    const out: Check[] = [
      c("chain", `History chain at generation ${this.target.toLocaleString("en-US")}`, state.chain, this.e.chain_hex()),
      c("board", "Board hash: every cell and its owner", state.board_hash, this.e.board_hash_hex()),
      c("live", "Living cells", state.total_live.toLocaleString("en-US"), this.e.total_live().toLocaleString("en-US")),
      rule("legal", "Every planting was legal, sieges marked", this.plants, "plantings", this.problems.plant),
      rule("prices", "Every planting paid the formula's price", this.plants, "plantings", this.problems.price),
      rule("buys", "Every purchase followed the agar's curve", this.buys, "purchases", this.problems.buy),
      rule("sells", "Every sale back followed the curve", this.sells, "sales", this.problems.sell),
      {
        id: "tides",
        label: "Every tide: chain, share of the vault and split",
        expected: `${this.tides} tides`,
        got: this.problems.tide ? `differs at generation ${this.problems.tide.generation}: ${this.problems.tide.what}` : `${this.tidesMatched} of ${this.tides} match`,
        ok: this.tides > 0 ? this.problems.tide === null : this.target < Number(this.input.rules.tide_every),
      },
      c("agar", "PETRI left in the agar", fmt(BigInt(state.agar)), fmt(BigInt(this.e.agar()))),
      c("sold", "PETRI sold from the agar for NEAR", fmt(BigInt(state.sold)), fmt(this.sold)),
      c("burned", "PETRI burned by planting", fmt(BigInt(state.burned)), fmt(this.burned)),
      c("returned", "PETRI returned to the agar by planting", fmt(BigInt(state.returned)), fmt(this.returned)),
      c("bought_back", "PETRI bought back by the agar", fmt(BigInt(state.bought_back)), fmt(this.boughtBack)),
      c("keeper", "PETRI set aside for keepers", fmt(keeper), fmt(BigInt(this.e.keeper_total()))),
      {
        id: "earned",
        label: "Every colony's lifetime PETRI earnings",
        expected: `${colonies.length} colonies`,
        got: `${earnedOk} of ${colonies.length} match`,
        ok: earnedOk === colonies.length,
      },
      c("vault", "NEAR in the tide vault", fmtNear(BigInt(state.vault)), fmtNear(this.vault)),
      c("near_in", "NEAR paid in by players", fmtNear(BigInt(state.near_in)), fmtNear(this.nearIn)),
      c("near_tides", "NEAR paid out at tides", fmtNear(BigInt(state.near_tides)), fmtNear(this.nearTides)),
      {
        id: "won",
        label: "Every colony's NEAR won at tides",
        expected: `${colonies.length} colonies`,
        got: `${wonOk} of ${colonies.length} match`,
        ok: wonOk === colonies.length,
      },
    ];
    if (lock) {
      out.push({
        id: "lock",
        label: "Nobody can change the contract: no full-access key",
        expected: "0 full-access keys",
        got: `${lock.fullAccessKeys} full-access key${lock.fullAccessKeys === 1 ? "" : "s"}`,
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
