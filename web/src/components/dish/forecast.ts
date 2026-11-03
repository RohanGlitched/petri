// A planting's likely future, before it is made: the dish engine is cloned twice, the candidate is planted into one
// copy, and both copies are stepped forward with the same Life rules the contract runs. The difference in the colony's
// living cells between the two copies is what this planting adds, generation by generation. Neither copy touches the
// live dish, and neither knows about plantings other players will make in the meantime.

import type { Engine } from "@/engine";

export type Forecast = {
  /** Generations stepped. */
  horizon: number;
  /** Living cells the planting adds after each generation, 1..horizon. */
  alive: number[];
  /** Still alive at the end of the horizon. */
  survives: boolean;
  /** The generation (1-based) by which the planting had no cell left, if it died. */
  diedAt: number | null;
  /** Living cells it adds when the next tide runs, `tideIn` generations from now (capped at the horizon). */
  atTide: number;
  tideIn: number;
  /** PETRI units it earns over the horizon at today's per-cell rate, capped by the reach its stake buys. */
  earned: number;
  /** Generations until it has earned its price: measured inside the horizon, extrapolated from its last hour of
   * life beyond it, null if it dies first or never pays. */
  payback: number | null;
  /** True when `payback` lies beyond the horizon and is an estimate. */
  extrapolated: boolean;
};

export type ForecastInput = {
  colony: number;
  /** Colonies on the dish now; a colony id above it is a newcomer and gets room in the copies. */
  colonies: number;
  cells: Uint32Array;
  horizon?: number;
  tideIn: number;
  /** PETRI units a counted cell earns a generation now. */
  perCell: number;
  /** PETRI units the planting costs. */
  cost: number;
  /** Paid cells per cell of stake. */
  reach: number;
};

export function forecast(base: Engine, f: ForecastInput): Forecast {
  const horizon = f.horizon ?? 240;
  const withIt = base.clone_engine();
  const without = base.clone_engine();
  const alive: number[] = [];
  try {
    if (f.colony > f.colonies) {
      withIt.set_colonies(f.colony);
      without.set_colonies(f.colony);
    }
    withIt.plant(f.colony, f.cells);
    for (let t = 1; t <= horizon; t++) {
      withIt.step(1);
      without.step(1);
      const a = withIt.live_counts()[f.colony] ?? 0;
      const b = without.live_counts()[f.colony] ?? 0;
      alive.push(Math.max(0, a - b));
    }
  } finally {
    withIt.free();
    without.free();
  }
  // A colony is paid for at most `reach` living cells per cell of stake; this planting brings its own cells of stake.
  const cap = f.reach * f.cells.length;
  let earned = 0;
  let payback: number | null = null;
  for (let t = 0; t < alive.length; t++) {
    earned += f.perCell * Math.min(alive[t], cap);
    if (payback === null && f.cost > 0 && earned >= f.cost) payback = t + 1;
  }
  const lastAlive = alive.length ? alive[alive.length - 1] : 0;
  const survives = lastAlive > 0;
  let diedAt: number | null = null;
  if (!survives) {
    let t = alive.length - 1;
    while (t > 0 && alive[t - 1] === 0) t--;
    diedAt = t + 1;
  }
  let extrapolated = false;
  if (payback === null && survives && f.perCell > 0) {
    const tail = alive.slice(-60);
    const rate = (f.perCell * tail.reduce((n, a) => n + Math.min(a, cap), 0)) / tail.length;
    if (rate > 0) {
      payback = Math.ceil(horizon + (f.cost - earned) / rate);
      extrapolated = true;
    }
  }
  const tideIn = Math.max(1, Math.min(horizon, f.tideIn));
  return { horizon, alive, survives, diedAt, atTide: alive[tideIn - 1] ?? 0, tideIn, earned, payback, extrapolated };
}
