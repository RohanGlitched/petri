// node --test test/   (from agents/)
import test from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_MAX_MS, BUY_STEPS, nextTry, replant, spentInDay } from "../tend.mjs";

const Y = 10n ** 24n;
const CAP = (Y * 3n) / 100n;
const EVERY = 30 * 60_000;

/** A fake dish: the stored generation, the clock, the purse's PETRI, and every call the holder signs. */
function dish({ lag = 0, petri = 100n, claimPetri = 0n, claimNear = 0n, cost = 20n, deposit = (Y * 7n) / 1000n, perNear = 50n, plantFails = null, step = 120 } = {}) {
  const d = { generation: 1000, due: 1000 + lag, petri, claimPetri, claimNear, calls: [], now: 1_000_000 };
  const views = {
    rules: () => ({ max_catchup: 120 }),
    state: () => ({ generation: String(d.generation), due_generation: String(d.due) }),
    colony_of: () => ({ id: 8 }),
    slide: () => ({ token_id: "18" }),
    quote: () => String(cost),
    plant_deposit: () => String(deposit),
    ft_balance_of: () => String(d.petri),
    claimable: () => ({ petri: String(d.claimPetri), near: String(d.claimNear) }),
    buy_quote: ({ near }) => String((BigInt(near) * perNear) / (Y / 100n)),
  };
  const deps = {
    view: async (m, a) => views[m](a),
    advance: async () => {
      d.calls.push("advance");
      const lagNow = d.due - d.generation;
      // Past max_lag (480) the clock first skips to max_catchup behind.
      if (lagNow > 480) d.generation = d.due - 120;
      d.generation = Math.min(d.due, d.generation + step);
      return { hash: "adv", burnt: 10n ** 20n };
    },
    act: async (method, args, deposit_) => {
      d.calls.push(`${method}:${deposit_}`);
      if (method === "claim") {
        d.petri += d.claimPetri;
        d.claimPetri = 0n;
        d.claimNear = 0n;
      }
      if (method === "buy") d.petri += (BigInt(deposit_) * perNear) / (Y / 100n);
      if (method === "plant") {
        if (plantFails) return { hash: "p", failed: plantFails, burnt: 0n };
        if (d.generation < d.due - 120) return { hash: "p", failed: "the dish is behind the clock; call advance first", burnt: 0n };
        if (d.petri + d.claimPetri < cost) return { hash: "p", failed: "you hold too little", burnt: 0n };
        d.petri -= cost;
      }
      return { hash: method, failed: null, burnt: 10n ** 20n };
    },
    place: async () => [1, 2, 3],
    log: () => {},
    now: () => d.now,
  };
  return { d, deps };
}
const opts = { purse: "slide-18.slides.petri-dish.near", everyMs: EVERY, capYocto: CAP };

test("a current dish and enough PETRI: one planting, nothing else", async () => {
  const { d, deps } = dish();
  const r = await replant("18", {}, deps, opts);
  assert.equal(r.ok, true);
  assert.deepEqual(d.calls, [`plant:${(Y * 7n) / 1000n}`]);
});

test("in the 241-480 band one advance is not enough: it advances until within max_catchup, then plants", async () => {
  const { d, deps } = dish({ lag: 300 });
  const r = await replant("18", {}, deps, opts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(d.calls.filter((c) => c === "advance").length, 2);
  assert.ok(d.calls.at(-1).startsWith("plant:"));
});

test("at most three advances; a dish still behind is not planted on, and the purse backs off", async () => {
  const { d, deps } = dish({ lag: 460, step: 40 });
  const t = {};
  const r = await replant("18", t, deps, opts);
  assert.equal(r.ok, false);
  assert.equal(r.step, "advance");
  assert.equal(d.calls.filter((c) => c === "advance").length, 3);
  assert.ok(!d.calls.some((c) => c.startsWith("plant")));
  assert.equal(t.failures, 1);
  assert.equal(t.nextAt, d.now + EVERY);
  // Inside the back-off nothing is sent at all.
  const again = await replant("18", t, deps, opts);
  assert.equal(again.step, "backoff");
  assert.equal(d.calls.filter((c) => c === "advance").length, 3);
});

test("short of PETRI with tides waiting: claims first, then buys what is still missing", async () => {
  const { d, deps } = dish({ petri: 5n, claimNear: 10n ** 21n, cost: 20n });
  const r = await replant("18", {}, deps, opts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(d.calls.map((c) => c.split(":")[0]), ["claim", "buy", "plant"]);
  assert.equal(d.calls[1], `buy:${BUY_STEPS[0]}`);
});

test("short of PETRI and nothing to claim: buys the smallest step that covers the gap", async () => {
  const { d, deps } = dish({ petri: 0n, cost: 80n, perNear: 50n });
  const r = await replant("18", {}, deps, opts);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(d.calls.map((c) => c.split(":")[0]), ["buy", "plant"]);
  assert.equal(d.calls[0], `buy:${BUY_STEPS[1]}`);
});

test("the daily cap: no buy or planting that would pass it; spending is counted over 24 hours", async () => {
  const { d, deps } = dish({ petri: 0n, cost: 20n });
  const t = { spend: [{ at: 1_000_000 - 3600_000, yocto: ((Y * 25n) / 1000n).toString() }] };
  const r = await replant("18", t, deps, opts);
  assert.equal(r.ok, false);
  assert.equal(r.step, "buy");
  assert.deepEqual(d.calls, []);
  assert.equal(spentInDay(t.spend, d.now), (Y * 25n) / 1000n);
  // A day later the old spending no longer counts.
  assert.equal(spentInDay(t.spend, d.now + 86_400_000), 0n);
});

test("a refused planting backs off exponentially, capped at 12 hours; a success resets it", async () => {
  const { d, deps } = dish({ plantFails: "no legal spot" });
  const t = {};
  await replant("18", t, deps, opts);
  assert.equal(t.failures, 1);
  d.now = t.nextAt;
  await replant("18", t, deps, opts);
  assert.equal(t.failures, 2);
  assert.equal(t.nextAt, d.now + 2 * EVERY);
  assert.equal(nextTry(10, 0, EVERY), BACKOFF_MAX_MS);
  assert.equal(nextTry(0, 5, EVERY), 5);
  const ok = dish();
  const t2 = { failures: 3, nextAt: 0 };
  await replant("18", t2, ok.deps, opts);
  assert.equal(t2.failures, 0);
});
