// Replays the whole dish from generation zero with petri-core and checks it against what the contract holds.
//
// The contract keeps one ordered ledger of everything that changes the dish or the agar: joins, purchases from the
// agar, and plantings (with the price each paid). At each generation the replay applies that generation's entries in
// order, checks every planting's price against the formula, then steps Life and feeds the living exactly as the
// contract does. The board, the history chain, the agar, the burn and every colony's lifetime earnings must all come
// out identical, to the unit.

import { Engine, pattern_cells, quote } from "@/engine";
import type { Checkpoint, Colony, DishState, Entry, Rules } from "./chain";

export type Check = { id: string; label: string; expected: string; got: string | null; ok: boolean | null };

export type ReplayInput = {
  rules: Rules;
  state: DishState;
  colonies: Colony[];
  ledger: Entry[];
  checkpoints: Checkpoint[];
  /** Each colony's lifetime earnings from the `earnings` view (index = colony id - 1). */
  earnings: string[];
};

type Step = { kind: "join" | "buy" | "plant"; colony: number; petri?: bigint; cells?: number[]; cost?: bigint };

const gen = (e: Entry) => Number("Join" in e ? e.Join.generation : "Buy" in e ? e.Buy.generation : e.Plant.generation);

export class Replayer {
  e: Engine;
  input: ReplayInput;
  target: number;
  at: Map<number, Step[]>;
  checkpointAt: Map<number, string>;
  sold = 0n;
  returned = 0n;
  burned = 0n;
  prices = 0;
  priceMismatch: { generation: number; expected: string; got: string } | null = null;
  checkpointsMatched = 0;
  checkpointsSeen = 0;
  log: { generation: number; text: string; ok: boolean }[] = [];
  private applied = new Set<number>();

  constructor(input: ReplayInput) {
    const { rules, state, ledger, checkpoints } = input;
    this.input = input;
    this.e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.cap_bps, rules.cap_min);
    this.e.set_colonies(0);
    this.e.set_agar(rules.max_supply);
    this.target = Number(state.generation);
    this.at = new Map();
    for (const entry of ledger) {
      const step: Step =
        "Join" in entry
          ? { kind: "join", colony: entry.Join.colony }
          : "Buy" in entry
            ? { kind: "buy", colony: entry.Buy.colony, petri: BigInt(entry.Buy.petri) }
            : { kind: "plant", colony: entry.Plant.colony, cells: entry.Plant.cells, cost: BigInt(entry.Plant.cost) };
      const g = gen(entry);
      this.at.set(g, [...(this.at.get(g) ?? []), step]);
    }
    this.checkpointAt = new Map(checkpoints.map((c) => [Number(c.generation), c.chain]));
    this.checkCheckpoint();
  }

  get generation() {
    return this.e.generation();
  }

  private applyEvents() {
    const g = this.generation;
    if (this.applied.has(g)) return;
    this.applied.add(g);
    const { rules } = this.input;
    for (const s of this.at.get(g) ?? []) {
      if (s.kind === "join") {
        this.e.set_colonies(s.colony);
      } else if (s.kind === "buy") {
        this.e.set_agar((BigInt(this.e.agar()) - s.petri!).toString());
        this.sold += s.petri!;
      } else {
        const want = BigInt(quote(this.e.agar(), rules.feed_ppm, rules.keeper_bps, this.e.total_live(), rules.live_floor, rules.payback, rules.min_cell_price, s.cells!.length));
        this.prices++;
        if (want !== s.cost! && !this.priceMismatch) this.priceMismatch = { generation: g, expected: s.cost!.toString(), got: want.toString() };
        const burn = (s.cost! * BigInt(rules.burn_bps)) / 10000n;
        this.burned += burn;
        this.returned += s.cost! - burn;
        this.e.set_agar((BigInt(this.e.agar()) + s.cost! - burn).toString());
        this.e.plant(s.colony, new Uint32Array(s.cells!));
      }
    }
  }

  private checkCheckpoint() {
    const g = this.generation;
    const want = this.checkpointAt.get(g);
    if (want === undefined) return;
    this.checkpointsSeen++;
    const got = this.e.chain_hex();
    if (got === want) this.checkpointsMatched++;
    this.log.push({ generation: g, text: `Checkpoint at generation ${g.toLocaleString("en-US")}: ${got === want ? "chain matches" : "chain differs"}`, ok: got === want });
  }

  /** Run up to `budget` generations. Returns true when the replay has reached the contract's stored generation. */
  run(budget: number): boolean {
    let left = budget;
    while (left > 0) {
      this.applyEvents();
      if (this.generation >= this.target) return true;
      // Jump straight to the next generation that has an event or a checkpoint, within the budget.
      let next = this.generation + 1;
      const limit = Math.min(this.target, this.generation + left);
      while (next < limit && !this.at.has(next) && !this.checkpointAt.has(next)) next++;
      const n = next - this.generation;
      this.e.step(n);
      left -= n;
      this.checkCheckpoint();
    }
    this.applyEvents();
    return this.generation >= this.target;
  }

  checks(): Check[] {
    const { state, colonies, earnings } = this.input;
    const colonyOk = colonies.filter((c, i) => this.e.earned_of(c.id) === (earnings[i] ?? "0")).length;
    const keeper = BigInt(state.keeper_pot) + BigInt(state.keeper_paid);
    const c = (id: string, label: string, expected: string, got: string): Check => ({ id, label, expected, got, ok: expected === got });
    return [
      c("chain", `History chain at generation ${this.target.toLocaleString("en-US")}`, state.chain, this.e.chain_hex()),
      c("board", "Board hash: every cell and its owner", state.board_hash, this.e.board_hash_hex()),
      {
        id: "checkpoints",
        label: "Checkpoints every 240 generations",
        expected: `${this.checkpointAt.size} stored`,
        got: `${this.checkpointsMatched} of ${this.checkpointsSeen} match`,
        ok: this.checkpointsSeen > 0 && this.checkpointsMatched === this.checkpointsSeen,
      },
      {
        id: "prices",
        label: "Every planting paid the formula's price",
        expected: `${this.prices} plantings`,
        got: this.priceMismatch ? `differs at generation ${this.priceMismatch.generation}` : `${this.prices} of ${this.prices} match`,
        ok: this.priceMismatch === null,
      },
      c("agar", "PETRI left in the agar", fmt(BigInt(state.agar)), fmt(BigInt(this.e.agar()))),
      c("sold", "PETRI sold from the agar for NEAR", fmt(BigInt(state.sold)), fmt(this.sold)),
      c("burned", "PETRI burned by planting", fmt(BigInt(state.burned)), fmt(this.burned)),
      c("returned", "PETRI returned to the agar", fmt(BigInt(state.returned)), fmt(this.returned)),
      c("keeper", "PETRI set aside for keepers", fmt(keeper), fmt(BigInt(this.e.keeper_total()))),
      {
        id: "earned",
        label: "Every colony's lifetime earnings",
        expected: `${colonies.length} colonies`,
        got: `${colonyOk} of ${colonies.length} match`,
        ok: colonyOk === colonies.length,
      },
      c("live", "Living cells", state.total_live.toLocaleString("en-US"), this.e.total_live().toLocaleString("en-US")),
    ];
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

export { pattern_cells };
