// How a living slide's holder replants the slide's colony, kept apart from the chain calls so it can be tested with a
// fake dish (test/tend.test.mjs). purse.mjs supplies the real calls.
//
// Before anything is signed:
//   1. Back-off: a purse whose last replant failed waits PETRI_PURSE_EVERY_MIN × 2^(failures − 1), at most 12 hours,
//      so a planting that would panic is not retried every half hour.
//   2. Budget: the NEAR the holder spends on one purse (attached deposits and the gas its calls burn) is capped over any
//      24 hours (PETRI_PURSE_DAY_NEAR, 0.03 NEAR by default). A step that would pass the cap is not sent.
//   3. Clock: a planting needs the stored dish within max_catchup generations of the clock (the contract catches up at
//      most that many itself, then refuses a dish still behind). The holder calls `advance` until it is, at most three
//      times: one advance is not enough when the dish is between max_catchup and max_lag behind.
//   4. PETRI: the slide's pattern is placed on the live dish and priced (quote, licensed, never a siege); when the
//      purse's PETRI and what it can claim fall short, the purse claims, and if it is still short it buys from the agar
//      (`buy`, one of the purse's allowed calls) with the smallest of 0.01, 0.02, 0.03 NEAR that covers the gap.
//   5. Only then the planting, with the NEAR its deposit costs attached by the holder.

const YOCTO = 10n ** 24n;
export const MAX_ADVANCES = 3;
export const BACKOFF_MAX_MS = 12 * 3600_000;
export const DAY_MS = 86_400_000;
const near = (s) => {
  const [a, b = ""] = String(s).split(".");
  return BigInt(a) * YOCTO + BigInt((b + "0".repeat(24)).slice(0, 24));
};
export const BUY_STEPS = [near("0.01"), near("0.02"), near("0.03")];
export const nearText = (y) => (Number((BigInt(y) * 1_000_000n) / YOCTO) / 1e6).toFixed(6);

/** When a purse may be tried again after `failures` failures in a row (0 means at once). */
export function nextTry(failures, now, everyMs) {
  if (!failures) return now;
  return now + Math.min(everyMs * 2 ** (failures - 1), BACKOFF_MAX_MS);
}

/** yoctoNEAR spent on a purse in the 24 hours before `now`, from its spend records [{ at (ms), yocto }]. */
export const spentInDay = (records = [], now) => records.filter((r) => now - r.at < DAY_MS).reduce((a, r) => a + BigInt(r.yocto), 0n);

/**
 * Replants living slide `token` once. `t` is this purse's tending record ({ failures, nextAt, spend }), updated in place.
 * deps:
 *   view(method, args)                 a view on the dish
 *   advance()                          the holder's `advance` → { hash, burnt }
 *   act(method, args, deposit)         the purse calls the dish, as the holder → { hash, failed, burnt }
 *   place(colonyId, slide)             flat cell indices for the slide's pattern on the live dish, or null
 *   log(...)                           the runner's log line
 *   now()                              ms
 * opts: { purse, everyMs, capYocto, note }.
 * Returns { ok, step, reason?, hash?, spent } and never throws on a contract refusal.
 */
export async function replant(token, t, deps, opts) {
  const { view, advance, act, place, log } = deps;
  const now = deps.now ?? Date.now;
  const { purse, everyMs, capYocto, note = `Living slide ${token} plants its own specimen.` } = opts;
  const fail = (step, reason) => {
    t.failures = (t.failures ?? 0) + 1;
    t.nextAt = nextTry(t.failures, now(), everyMs);
    log(`living slide ${token}: ${step} failed: ${reason}; failure ${t.failures} in a row, next try after ${new Date(t.nextAt).toISOString()}`);
    return { ok: false, step, reason };
  };
  if (t.nextAt && now() < t.nextAt) return { ok: false, step: "backoff", reason: `backing off until ${new Date(t.nextAt).toISOString()}` };
  t.spend = (t.spend ?? []).filter((r) => now() - r.at < DAY_MS);
  const charge = (yocto) => {
    if (BigInt(yocto) > 0n) t.spend.push({ at: now(), yocto: BigInt(yocto).toString() });
  };
  const left = () => BigInt(capYocto) - spentInDay(t.spend, now());
  const over = (yocto) => BigInt(yocto) > left();

  // 3. The clock: advance until the stored dish is within max_catchup of it.
  const rules = await view("rules");
  const maxCatchup = Number(rules.max_catchup);
  let lag = null;
  for (let i = 0; i <= MAX_ADVANCES; i++) {
    const st = await view("state");
    lag = Number(st.due_generation) - Number(st.generation);
    if (lag <= maxCatchup) break;
    if (i === MAX_ADVANCES) break;
    // An advance burns a few TGas of the holder's NEAR: kept inside the cap too (about 0.001 NEAR budgeted each).
    if (over(near("0.001"))) return fail("advance", `the day's cap of ${nearText(capYocto)} NEAR for this purse is spent`);
    const a = await advance().catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    if (a.error) return fail("advance", a.error);
    charge(a.burnt ?? 0n);
    log(`living slide ${token}: the dish was ${lag} generations behind the clock (max_catchup ${maxCatchup}); advanced`, a.hash);
  }
  if (lag > maxCatchup) return fail("advance", `the dish is still ${lag} generations behind after ${MAX_ADVANCES} advances`);

  // 4. Where the pattern goes, what it costs, and what the purse holds.
  const [colony, slide] = await Promise.all([view("colony_of", { account_id: purse }), view("slide", { token_id: String(token) })]);
  if (!colony) return fail("place", "the purse has not joined the dish");
  const cells = await place(colony.id, slide);
  if (!cells) return fail("place", "no legal spot for the slide's pattern right now");
  const [cost, deposit] = await Promise.all([
    view("quote", { cells: cells.length, siege: false, licensed: true }).then(BigInt),
    view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: String(token) }).then(BigInt),
  ]);
  const holds = async () => {
    const [bal, cl] = await Promise.all([view("ft_balance_of", { account_id: purse }), view("claimable", { account_id: purse })]);
    return { petri: BigInt(bal) + BigInt(cl.petri), claimable: cl };
  };
  let h = await holds();
  if (h.petri < cost) {
    // First what the purse has earned: a claim moves its feed into its balance and its tides into the purse.
    if (BigInt(h.claimable.petri) > 0n || BigInt(h.claimable.near) > 0n) {
      const c = await act("claim", {}, 0n);
      charge(c.burnt ?? 0n);
      log(`living slide ${token}: short of PETRI (${cost} needed, ${h.petri} held with claimable); claimed`, c.failed ?? "", c.hash);
      h = await holds();
    }
  }
  if (h.petri < cost) {
    const short = cost - h.petri;
    let pay = null;
    for (const n of BUY_STEPS) {
      if (BigInt(await view("buy_quote", { near: n.toString() })) >= short) {
        pay = n;
        break;
      }
    }
    if (!pay) return fail("buy", `${short} PETRI short; ${nearText(BUY_STEPS.at(-1))} NEAR would not buy it`);
    if (over(pay + deposit)) return fail("buy", `buying ${nearText(pay)} NEAR of PETRI and planting (${nearText(deposit)} NEAR) would pass the day's cap of ${nearText(capYocto)} NEAR for this purse (${nearText(left())} left)`);
    const b = await act("buy", {}, pay);
    if (b.failed) {
      // A refused call's deposit is refunded to the purse, not the holder: it counts as spent.
      charge(pay + BigInt(b.burnt ?? 0n));
      return fail("buy", b.failed);
    }
    charge(pay + BigInt(b.burnt ?? 0n));
    log(`living slide ${token}: bought PETRI with ${nearText(pay)} NEAR (it was ${short} units short)`, b.hash);
    h = await holds();
    if (h.petri < cost) return fail("buy", `still ${cost - h.petri} PETRI short after buying`);
  }

  // 5. The planting.
  if (over(deposit)) return fail("plant", `the planting's ${nearText(deposit)} NEAR would pass the day's cap of ${nearText(capYocto)} NEAR for this purse (${nearText(left())} left)`);
  const r = await act("plant", { cells, note, slide: String(token) }, deposit);
  if (r.failed) {
    charge(deposit + BigInt(r.burnt ?? 0n));
    return fail("plant", r.failed);
  }
  charge(deposit + BigInt(r.burnt ?? 0n));
  t.failures = 0;
  t.nextAt = 0;
  log(`living slide ${token} replanted its pattern (${cells.length} cells, ${cost} PETRI, ${nearText(deposit)} NEAR; ${nearText(left())} NEAR of today's cap left)`, r.hash);
  return { ok: true, step: "plant", hash: r.hash, spent: spentInDay(t.spend, now()) };
}
