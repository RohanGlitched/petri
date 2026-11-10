export type Lag = {
  /** The generation the board is projected to: the clock's, or for a sleeping dish the stored one plus max_catchup. */
  target: number;
  /** Generations the next call would skip (0 unless asleep). */
  skip: number;
  /** More than max_lag behind the clock: the next call skips. */
  asleep: boolean;
};
export function projectTarget(stored: number, due: number, rules: { max_lag: number; max_catchup: number }): Lag;
