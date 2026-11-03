#!/usr/bin/env node
// Replay the Petri dish from generation zero and check it against the contract.
//
//   node scripts/verify.mjs
//   node scripts/verify.mjs --contract petri-dish.testnet --network testnet
//
// Reads the rules, state, colonies, plant log and checkpoints over public NEAR RPC, replays everything with petri-core
// (the same Rust crate the contract runs, compiled to WebAssembly), and compares the history chain, every checkpoint,
// the board hash, the agar, burned, returned and granted totals, and each colony's lifetime earnings.
// Exits 0 when everything matches, 1 on any mismatch, 2 if the dish could not be read. Needs Node 20 or later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..", "web", "src", "engine", "pkg");
const { initSync, Engine, quote } = await import(pathToFileURL(path.join(pkg, "petri.js")).href);
initSync({ module: fs.readFileSync(path.join(pkg, "petri_bg.wasm")) });

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const NETWORK = arg("network", "testnet");
const CONTRACT = arg("contract", NETWORK === "mainnet" ? "petri.near" : "petri-dish.testnet");
const RPCS = NETWORK === "mainnet"
  ? ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"]
  : ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

async function view(method, args = {}) {
  let last;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "verify",
          method: "query",
          params: { request_type: "call_function", finality: "final", account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
      return JSON.parse(Buffer.from(body.result.result).toString("utf8"));
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

const fmt = (u) => {
  const v = BigInt(u);
  return `${(v / 1_000_000n).toLocaleString("en-US")}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
};

let rules, state, colonies, plants, checkpoints;
try {
  // One finalized read of the state; the plant log and checkpoints only ever grow, so read them up to its counts.
  [rules, state] = await Promise.all([view("rules"), view("state")]);
  colonies = (await view("colonies", { from: 0, limit: 500 })).slice(0, state.colonies);
  plants = [];
  for (let from = 0; from < Number(state.plants); from += 1000) plants.push(...(await view("plants", { from, limit: 1000 })));
  plants = plants.slice(0, Number(state.plants));
  checkpoints = (await view("checkpoints", { from: 0, limit: 2000 })).filter((c) => Number(c.generation) <= Number(state.generation));
} catch (e) {
  console.error(`Could not read ${CONTRACT} on ${NETWORK}: ${e.message ?? e}`);
  process.exit(2);
}

const target = Number(state.generation);
console.log(`Replaying ${CONTRACT} (${NETWORK}): ${target.toLocaleString("en-US")} generations, ${plants.length} plantings, ${colonies.length} colonies, ${checkpoints.length} checkpoints.`);

const t0 = performance.now();
const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps);
e.set_colonies(colonies.length);
e.set_agar(rules.max_supply);
const joinsAt = new Map();
for (const c of colonies) joinsAt.set(Number(c.joined_generation), [...(joinsAt.get(Number(c.joined_generation)) ?? []), c]);
const plantsAt = new Map();
for (const p of plants) plantsAt.set(Number(p.generation), [...(plantsAt.get(Number(p.generation)) ?? []), p]);
const checkpointAt = new Map(checkpoints.map((c) => [Number(c.generation), c.chain]));
let granted = 0n, burned = 0n, returned = 0n, cpOk = 0, cpSeen = 0;

const checkpoint = () => {
  const want = checkpointAt.get(e.generation());
  if (want === undefined) return;
  cpSeen++;
  if (e.chain_hex() === want) cpOk++;
  else console.log(`  checkpoint at ${e.generation()} differs: contract ${want}, replay ${e.chain_hex()}`);
};

checkpoint();
for (;;) {
  const g = e.generation();
  for (const c of joinsAt.get(g) ?? []) {
    const agar = BigInt(e.agar());
    const grant = BigInt(rules.starter_grant) < agar ? BigInt(rules.starter_grant) : agar;
    e.set_agar((agar - grant).toString());
    granted += grant;
  }
  for (const p of plantsAt.get(g) ?? []) {
    const cost = BigInt(quote(rules.plant_cost, p.cells.length, e.total_live(), rules.capacity));
    const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
    burned += burn;
    returned += cost - burn;
    e.set_agar((BigInt(e.agar()) + cost - burn).toString());
    e.plant(p.colony, new Uint32Array(p.cells));
  }
  if (g >= target) break;
  let next = g + 1;
  while (next < target && !joinsAt.has(next) && !plantsAt.has(next) && !checkpointAt.has(next)) next++;
  e.step(next - g);
  checkpoint();
}
const ms = performance.now() - t0;

const earned = e.earned();
const colonyMismatch = colonies.filter((c) => BigInt(Math.round(earned[c.id] ?? 0)) !== BigInt(c.petri_earned));
const checks = [
  ["History chain", state.chain, e.chain_hex()],
  ["Board hash", state.board_hash, e.board_hash_hex()],
  ["Checkpoints", `${checkpointAt.size} of ${checkpointAt.size}`, `${cpOk} of ${cpSeen}`],
  ["Agar", fmt(state.agar), fmt(e.agar())],
  ["Burned", fmt(state.burned), fmt(burned)],
  ["Returned to the agar", fmt(state.returned), fmt(returned)],
  ["Starter grants", fmt(state.granted), fmt(granted)],
  ["Colony earnings", `${colonies.length} of ${colonies.length}`, `${colonies.length - colonyMismatch.length} of ${colonies.length}`],
  ["Living cells", String(state.total_live), String(e.total_live())],
];
let bad = 0;
for (const [name, want, got] of checks) {
  const ok = want === got;
  if (!ok) bad++;
  console.log(`${ok ? "  match " : "  DIFFERS"}  ${name.padEnd(22)} ${got}${ok ? "" : `  (contract: ${want})`}`);
}
for (const c of colonyMismatch) console.log(`  ${c.name}: contract ${fmt(c.petri_earned)}, replay ${fmt(BigInt(Math.round(earned[c.id] ?? 0)))}`);
console.log(bad === 0 ? `Everything matches. Replay took ${ms.toFixed(0)} ms.` : `${bad} check(s) differ.`);
process.exit(bad === 0 ? 0 : 1);
