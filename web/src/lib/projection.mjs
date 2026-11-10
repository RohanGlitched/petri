// Where the contract's next catch-up would leave the dish, so the browser draws the board the contract would hold.
// Plain JavaScript so scripts/projection-test.mjs (Node, no build step) tests this very file.
//
// The contract (catch_up_by in contract/src/lib.rs) steps at most max_catchup generations a call. When the stored dish
// is more than max_lag generations behind the clock, the clock first skips: epoch_ms moves forward until the dish is
// max_catchup behind, a Skip entry records how many generations were skipped, and those generations never run: no
// Life, no feed, no tide. Then the call steps the max_catchup that are left. So a dish nobody has tended for a while is
// asleep: whatever the clock says, the next call leaves it exactly max_catchup generations past the stored board.

/**
 * @param {number} stored the generation the contract stored
 * @param {number} due the generation the clock says is due
 * @param {{ max_lag: number, max_catchup: number }} rules
 * @returns {{ target: number, skip: number, asleep: boolean }} the generation to project the board to (the clock's, or
 *   for a sleeping dish the stored one plus max_catchup), the generations the next call would skip, and whether it
 *   would skip at all
 */
export function projectTarget(stored, due, rules) {
  if (due > stored + rules.max_lag) return { target: stored + rules.max_catchup, skip: due - stored - rules.max_catchup, asleep: true };
  return { target: Math.max(stored, due), skip: 0, asleep: false };
}
