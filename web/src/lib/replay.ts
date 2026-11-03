// Replays the whole dish from generation zero with petri-core and checks it against what the contract holds.
//
// Order matches the contract: at each generation g, joins grant from the agar, then plantings apply in log order
// (each priced at the live count before it, half burned, the rest returned to the agar), then the dish steps.
// The engine's step() feeds the living exactly as the contract's catch-up does, so the agar and every colony's
// earnings must also come out identical, to the unit.

import { Engine, pattern_cells, quote } from "@/engine";
import type { Checkpoint, Colony, DishState, PlantRecord, Rules } from "./chain";

export type Check = { id: string; label: string; expected: string; got: string | null; ok: boolean | null };

export type ReplayInput = { rules: Rules; state: DishState; colonies: Colony[]; plants: PlantRecord[]; checkpoints: Checkpoint[] };

export class Replayer {
  e: Engine;
  input: ReplayInput;
  target: number;
  joins: Map<number, Colony[]>;
  plantsAt: Map<number, PlantRecord[]>;
  checkpointAt: Map<number, string>;
  granted = 0n;
  returned = 0n;
  burned = 0n;
  checkpointsMatched = 0;
  checkpointsSeen = 0;
  firstMismatch: { generation: number; expected: string; got: string } | null = null;
  log: { generation: number; text: string; ok: boolean }[] = [];

  constructor(input: ReplayInput) {
    const { rules, state, colonies, plants, checkpoints } = input;
    this.input = input;
    this.e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps);
    this.e.set_colonies(colonies.length);
    this.e.set_agar(rules.max_supply);
    this.target = Number(state.generation);
    this.joins = new Map();
    for (const c of colonies) {
      const g = Number(c.joined_generation);
      this.joins.set(g, [...(this.joins.get(g) ?? []), c]);
    }
    this.plantsAt = new Map();
    for (const p of plants) {
      const g = Number(p.generation);
      this.plantsAt.set(g, [...(this.plantsAt.get(g) ?? []), p]);
    }
    this.checkpointAt = new Map(checkpoints.map((c) => [Number(c.generation), c.chain]));
    this.checkCheckpoint();
  }

  get generation() {
    return this.e.generation();
  }

  get done() {
    return this.generation >= this.target && !this.pendingEventsHere();
  }

  private applied = new Set<number>();
  private pendingEventsHere() {
    return !this.applied.has(this.generation);
  }

  private applyEvents() {
    const g = this.generation;
    if (this.applied.has(g)) return;
    this.applied.add(g);
    const { rules } = this.input;
    for (const c of this.joins.get(g) ?? []) {
      const agar = BigInt(this.e.agar());
      const grant = BigInt(rules.starter_grant) < agar ? BigInt(rules.starter_grant) : agar;
      this.e.set_agar((agar - grant).toString());
      this.granted += grant;
      this.log.push({ generation: g, text: `${c.name} joined and took ${fmt(grant)} PETRI from the agar`, ok: true });
    }
    for (const p of this.plantsAt.get(g) ?? []) {
      const cost = BigInt(quote(rules.plant_cost, p.cells.length, this.e.total_live(), rules.capacity));
      const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
      const back = cost - burn;
      this.burned += burn;
      this.returned += back;
      this.e.set_agar((BigInt(this.e.agar()) + back).toString());
      this.e.plant(p.colony, new Uint32Array(p.cells));
    }
  }

  private checkCheckpoint() {
    const g = this.generation;
    const want = this.checkpointAt.get(g);
    if (want === undefined) return;
    this.checkpointsSeen++;
    const got = this.e.chain_hex();
    if (got === want) this.checkpointsMatched++;
    else if (!this.firstMismatch) this.firstMismatch = { generation: g, expected: want, got };
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
      while (next < limit && !this.joins.has(next) && !this.plantsAt.has(next) && !this.checkpointAt.has(next)) next++;
      const n = next - this.generation;
      this.e.step(n);
      left -= n;
      this.checkCheckpoint();
    }
    this.applyEvents();
    return this.generation >= this.target;
  }

  checks(): Check[] {
    const { state, colonies } = this.input;
    const earned = this.e.earned();
    const colonyOk = colonies.filter((c) => BigInt(Math.round(earned[c.id] ?? 0)) === BigInt(c.petri_earned)).length;
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
      c("agar", "PETRI left in the agar", fmt(BigInt(state.agar)), fmt(BigInt(this.e.agar()))),
      c("burned", "PETRI burned by planting", fmt(BigInt(state.burned)), fmt(this.burned)),
      c("returned", "PETRI returned to the agar", fmt(BigInt(state.returned)), fmt(this.returned)),
      c("granted", "Starter grants", fmt(BigInt(state.granted)), fmt(this.granted)),
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
