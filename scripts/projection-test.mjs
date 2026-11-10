#!/usr/bin/env node
// The browser's projection of a lagged dish against the contract's catch-up and skip rule.
//
//   node scripts/projection-test.mjs            # offline checks, then the chain check on mainnet
//   node scripts/projection-test.mjs --offline  # offline checks only
//   node scripts/projection-test.mjs --network testnet
//
// The dish in the browser loads the stored board into petri-core (WebAssembly) and steps it to where the contract's
// next call would leave it (web/src/lib/projection.mjs). The contract (catch_up_by in contract/src/lib.rs) steps at most
// max_catchup generations a call, and when the stored dish is more than max_lag behind the clock it first skips the
// clock ahead to max_catchup behind: the skipped generations never run, so they pay no feed.
//
// Offline: the rule's edges, and on a made-up dish that a lagged projection steps exactly max_catchup generations and
// pays exactly their feed (and that stepping the whole gap, the old projection, would have paid far more).
// Chain: finds the block where the dish last skipped (an archival read, bisecting on the `skipped` counter), loads the
// board stored just before it, projects it with the engine to the clock of that block, and compares with what the
// contract stored: the generation, the board hash (after the call's own plantings, from the ledger) and the feed paid.
// Exit 0 when everything matches, 1 on a mismatch; a chain that cannot be read is reported and skipped.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..", "web", "src", "engine", "pkg");
const { initSync, Engine, pattern_cells } = await import(pathToFileURL(path.join(pkg, "petri.js")).href);
initSync({ module: fs.readFileSync(path.join(pkg, "petri_bg.wasm")) });
const { projectTarget } = await import(pathToFileURL(path.join(here, "..", "web", "src", "lib", "projection.mjs")).href);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const OFFLINE = process.argv.includes("--offline");
const NETWORK = arg("network", "mainnet");

let failed = 0;
function check(label, ok, detail = "") {
  console.log(`  ${ok ? "match" : "DIFFERS"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// ---------------------------------------------------------------------------------------------------------------
console.log("The rule (projection.mjs):");
const R = { max_lag: 480, max_catchup: 120 };
{
  const a = projectTarget(1000, 1000 + 480, R);
  check("exactly max_lag behind: no skip, step to the clock", !a.asleep && a.target === 1480 && a.skip === 0, JSON.stringify(a));
  const b = projectTarget(1000, 1000 + 481, R);
  check("one more: asleep, skip to max_catchup behind", b.asleep && b.target === 1120 && b.skip === 361, JSON.stringify(b));
  const c = projectTarget(1000, 1000 + 50_000, R);
  check("far behind: still stored + max_catchup", c.asleep && c.target === 1120 && c.skip === 49_880, JSON.stringify(c));
  const d = projectTarget(1000, 1000 + 119, R);
  check("within one catch-up: step to the clock", !d.asleep && d.target === 1119, JSON.stringify(d));
}

// ---------------------------------------------------------------------------------------------------------------
console.log("A made-up lagged dish, through the engine:");
{
  const W = 128;
  const H = 128;
  const make = () => {
    const e = new Engine(W, H, 3, 200, 8, 1000, 8750);
    e.set_colonies(3);
    e.set_stakes(new BigUint64Array([400n, 400n, 400n]));
    e.set_house(new Uint16Array([]));
    e.set_agar("900000000000");
    e.set_counted(0);
    const at = [
      [1, "block", 10, 10],
      [1, "beehive", 30, 12],
      [2, "pulsar", 60, 60],
      [2, "blinker", 90, 20],
      [3, "glider", 20, 90],
      [3, "loaf", 100, 100],
    ];
    for (const [c, p, x, y] of at) e.plant(c, Uint32Array.from(pattern_cells(p, x, y, W, H, 0, false)));
    return e;
  };
  const stored = 0;
  const due = stored + 5000;
  const lag = projectTarget(stored, due, R);
  const projected = make();
  projected.step(lag.target - stored);
  const reference = make();
  for (let g = 0; g < R.max_catchup; g++) reference.step(1);
  const whole = make();
  whole.step(due - stored);
  const agar0 = BigInt(make().agar());
  const paid = (e) => agar0 - BigInt(e.agar());
  check("the projection lands on stored + max_catchup", projected.generation() === stored + R.max_catchup, `generation ${projected.generation()}`);
  check("its board is the board after max_catchup generations", projected.board_hash_hex() === reference.board_hash_hex());
  check("it paid exactly max_catchup generations of feed", paid(projected) === paid(reference) && paid(projected) > 0n, `${paid(projected)} units`);
  check("stepping the whole gap (the old projection) pays for skipped generations", paid(whole) > paid(projected), `${paid(whole)} units over ${due - stored} generations`);
  for (const e of [projected, reference, whole]) e.free();
}

// ---------------------------------------------------------------------------------------------------------------
if (!OFFLINE) {
  const CONTRACT = NETWORK === "mainnet" ? "petri-dish.near" : "petri-v6.testnet";
  const ARCHIVAL = NETWORK === "mainnet" ? ["https://archival-rpc.mainnet.fastnear.com"] : ["https://archival-rpc.testnet.fastnear.com"];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function rpc(method, params) {
    let last;
    for (let round = 0; round < 4; round++)
      for (const url of ARCHIVAL) {
        try {
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "proj", method, params }), signal: AbortSignal.timeout(20_000) });
          if (res.status === 429 || res.status >= 500) {
            await sleep((Number(res.headers.get("retry-after")) || 2 ** round) * 1000 + Math.random() * 400);
            throw new Error(`archival RPC ${res.status}`);
          }
          const body = await res.json();
          if (body.error) throw Object.assign(new Error(JSON.stringify(body.error).slice(0, 200)), { answer: true });
          return body.result;
        } catch (e) {
          last = e;
          if (e.answer) throw e;
        }
      }
    throw last;
  }
  const view = async (block, method, args = {}) => {
    const r = await rpc("query", { request_type: "call_function", block_id: block, account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  };
  const pages = async (block, method, total, size) => {
    const out = [];
    for (let from = 0; from < total; from += size) out.push(...(await view(block, method, { from, limit: size })));
    return out.slice(0, total);
  };

  console.log(`The last skip on ${CONTRACT}, against the engine:`);
  try {
    const head = (await rpc("block", { finality: "final" })).header.height;
    const now = await view(head, "state");
    const rules = await view(head, "rules");
    const ledger = await pages(head, "ledger", Number(now.ledger), 1000);
    const last = ledger.map((e, i) => [e, i]).filter(([e]) => "Skip" in e).at(-1);
    if (!last) {
      console.log("  note    this dish has never skipped; nothing to compare");
    } else {
      const [{ Skip }, at] = last;
      const skippedAfter = ledger.slice(0, at + 1).reduce((n, e) => n + ("Skip" in e ? Number(e.Skip.skipped) : 0), 0);
      // The first block whose state counts this skip: bisect on `skipped`.
      const skippedAt = async (b) => {
        try {
          return Number((await view(b, "state")).skipped);
        } catch {
          return -1;
        }
      };
      let hi = head;
      let lo = head - 1;
      let step = 2000;
      while ((await skippedAt(lo)) >= skippedAfter) {
        hi = lo;
        lo = Math.max(1, lo - step);
        step *= 2;
      }
      while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if ((await skippedAt(mid)) >= skippedAfter) hi = mid;
        else lo = mid;
      }
      const before = lo;
      const after = hi;
      const [s0, s1, board, blockAfter] = await Promise.all([view(before, "state"), view(after, "state"), view(before, "board"), rpc("block", { block_id: after })]);
      const [stakes, r0] = await Promise.all([pages(before, "stakes", s0.colonies, 2000), view(before, "rules")]);
      const tsMs = Math.floor(Number(blockAfter.header.timestamp) / 1e6);
      const due = Math.floor((tsMs - Number(s0.epoch_ms)) / Number(r0.generation_ms));
      const lag = projectTarget(Number(s0.generation), due, r0);
      console.log(`  block ${before} stored generation ${s0.generation}; block ${after} (clock at ${due}) stored ${s1.generation} after skipping ${Skip.skipped}`);
      check("the dish was asleep at that call", lag.asleep, `${due - Number(s0.generation)} behind, max_lag ${r0.max_lag}`);
      check("the generations it skipped", lag.skip === Number(Skip.skipped), `projected ${lag.skip}, ledger ${Skip.skipped}`);
      // A call stops early near its gas limit (catchup_limit), so it may run fewer than max_catchup; never more.
      const ran = Number(s1.generation) - Number(s0.generation);
      check("the generations that ran: at most the projection's, none of the skipped", ran > 0 && Number(s1.generation) <= lag.target, `projected ${lag.target}, contract ${s1.generation}${Number(s1.generation) < lag.target ? ", the call stopped early near its gas limit" : ""}`);
      const e = new Engine(r0.width, r0.height, r0.feed_ppm, r0.keeper_bps, r0.reach, r0.live_floor, r0.stake_keep_bps);
      e.set_counted(s0.counted);
      e.set_colonies(s0.colonies);
      e.set_stakes(new BigUint64Array(stakes.map((v) => BigInt(v))));
      e.set_house(new Uint16Array(s0.house));
      e.set_agar(s0.agar);
      const loaded = e.load_compact(Uint8Array.from(Buffer.from(board, "base64")), Number(s0.generation), s0.chain);
      check("the stored board loads", loaded);
      e.step(ran);
      const fed = BigInt(s0.agar) - BigInt(e.agar());
      check("the feed paid: only the generations that ran", fed === BigInt(s1.fed) - BigInt(s0.fed), `engine ${fed}, contract ${BigInt(s1.fed) - BigInt(s0.fed)}`);
      check("the history chain", e.chain_hex() === s1.chain);
      // The same call may have planted after its catch-up: those cells are in the ledger at the new generation.
      for (const entry of ledger.slice(at + 1)) {
        const p = entry.Plant;
        if (!p || Number(p.generation) !== Number(s1.generation)) continue;
        if (Number(s1.plants) <= Number(s0.plants)) break;
        e.plant(p.colony, Uint32Array.from(p.cells));
      }
      check("the board hash the contract stored", e.board_hash_hex() === s1.board_hash, `${e.board_hash_hex().slice(0, 12)}… vs ${s1.board_hash.slice(0, 12)}…`);
      e.free();
    }
  } catch (err) {
    console.log(`  note    the chain check was skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(failed ? `${failed} check(s) differ.` : "Everything matches.");
process.exit(failed ? 1 : 0);
