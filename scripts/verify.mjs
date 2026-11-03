#!/usr/bin/env node
// Replay the Petri dish from generation zero and check it against the contract.
//
//   node scripts/verify.mjs
//   node scripts/verify.mjs --contract petri-v2.testnet --network testnet [--code-hash <base58>]
//
// Every read is pinned to one finalized block, so a transaction landing mid-read cannot skew the result. The script
// reads the rules, state, colonies, the ledger (every join, purchase and planting in order), the earnings and the
// checkpoints, replays all of it with petri-core (the same Rust crate the contract runs, compiled to WebAssembly) and
// compares: the history chain, every checkpoint, the board hash, every planting's price, the agar, PETRI sold,
// burned and returned, the keeper share, each colony's lifetime earnings and the living-cell count. With
// --code-hash it also checks that the deployed contract is the build you expect.
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
const CONTRACT = arg("contract", NETWORK === "mainnet" ? "petri.near" : "petri-v2.testnet");
const CODE_HASH = arg("code-hash", null);
const RPCS = NETWORK === "mainnet" ? ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"] : ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];

async function rpc(method, params) {
  let last;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "verify", method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 200));
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

let block;
async function view(method, args = {}) {
  const r = await rpc("query", { request_type: "call_function", block_id: block, account_id: CONTRACT, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

async function paged(method, total, size) {
  const out = [];
  for (let from = 0; from < total; from += size) out.push(...(await view(method, { from, limit: size })));
  return out.slice(0, total);
}

const fmt = (u) => {
  const v = BigInt(u);
  return `${(v / 1_000_000n).toLocaleString("en-US")}.${(v % 1_000_000n).toString().padStart(6, "0")}`;
};

let rules, state, colonies, ledger, checkpoints, earnings, account;
try {
  block = (await rpc("block", { finality: "final" })).header.height;
  [rules, state, account] = await Promise.all([view("rules"), view("state"), rpc("query", { request_type: "view_account", block_id: block, account_id: CONTRACT })]);
  colonies = await paged("colonies", state.colonies, 500);
  ledger = await paged("ledger", Number(state.ledger), 1000);
  checkpoints = await paged("checkpoints", 1 + Math.floor(Number(state.generation) / 240), 2000);
  earnings = await paged("earnings", state.colonies, 2000);
} catch (e) {
  console.error(`Could not read ${CONTRACT} on ${NETWORK}: ${e.message ?? e}`);
  process.exit(2);
}

const target = Number(state.generation);
console.log(`Replaying ${CONTRACT} (${NETWORK}) at block ${block}: ${target.toLocaleString("en-US")} generations, ${ledger.length} ledger entries, ${colonies.length} colonies, ${checkpoints.length} checkpoints.`);

const t0 = performance.now();
const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.cap_bps, rules.cap_min);
e.set_colonies(0);
e.set_agar(rules.max_supply);
const genOf = (x) => Number((x.Join ?? x.Buy ?? x.Plant).generation);
const at = new Map();
for (const x of ledger) at.set(genOf(x), [...(at.get(genOf(x)) ?? []), x]);
const checkpointAt = new Map(checkpoints.map((c) => [Number(c.generation), c.chain]));
let sold = 0n, burned = 0n, returned = 0n, cpOk = 0, cpSeen = 0, prices = 0, priceBad = null;

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
  for (const x of at.get(g) ?? []) {
    if (x.Join) e.set_colonies(x.Join.colony);
    else if (x.Buy) {
      e.set_agar((BigInt(e.agar()) - BigInt(x.Buy.petri)).toString());
      sold += BigInt(x.Buy.petri);
    } else {
      const p = x.Plant;
      const want = quote(e.agar(), rules.feed_ppm, rules.keeper_bps, e.total_live(), rules.live_floor, rules.payback, rules.min_cell_price, p.cells.length);
      prices++;
      if (want !== p.cost && !priceBad) priceBad = g;
      const cost = BigInt(p.cost);
      const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
      burned += burn;
      returned += cost - burn;
      e.set_agar((BigInt(e.agar()) + cost - burn).toString());
      e.plant(p.colony, new Uint32Array(p.cells));
    }
  }
  if (g >= target) break;
  let next = g + 1;
  while (next < target && !at.has(next) && !checkpointAt.has(next)) next++;
  e.step(next - g);
  checkpoint();
}
const ms = performance.now() - t0;

const colonyBad = colonies.filter((c, i) => e.earned_of(c.id) !== earnings[i]);
const checks = [
  ["History chain", state.chain, e.chain_hex()],
  ["Board hash", state.board_hash, e.board_hash_hex()],
  ["Checkpoints", `${checkpointAt.size} of ${checkpointAt.size}`, `${cpOk} of ${cpSeen}`],
  ["Planting prices", `${prices} of ${prices}`, priceBad === null ? `${prices} of ${prices}` : `differs at generation ${priceBad}`],
  ["Agar", fmt(state.agar), fmt(e.agar())],
  ["Sold for NEAR", fmt(state.sold), fmt(sold)],
  ["Burned", fmt(state.burned), fmt(burned)],
  ["Returned to the agar", fmt(state.returned), fmt(returned)],
  ["Keeper share", fmt(BigInt(state.keeper_pot) + BigInt(state.keeper_paid)), fmt(e.keeper_total())],
  ["Colony earnings", `${colonies.length} of ${colonies.length}`, `${colonies.length - colonyBad.length} of ${colonies.length}`],
  ["Living cells", String(state.total_live), String(e.total_live())],
];
if (CODE_HASH) checks.push(["Deployed code hash", CODE_HASH, account.code_hash]);
let bad = 0;
for (const [name, want, got] of checks) {
  const ok = want === got;
  if (!ok) bad++;
  console.log(`${ok ? "  match " : "  DIFFERS"}  ${name.padEnd(22)} ${got}${ok ? "" : `  (contract: ${want})`}`);
}
for (const c of colonyBad.slice(0, 10)) console.log(`  ${c.name}: contract ${fmt(earnings[c.id - 1])}, replay ${fmt(e.earned_of(c.id))}`);
console.log(`Deployed code hash: ${account.code_hash}${CODE_HASH ? "" : " (pass --code-hash to check it against a build)"}`);
console.log(bad === 0 ? `Everything matches. Replay took ${ms.toFixed(0)} ms.` : `${bad} check(s) differ.`);
process.exit(bad === 0 ? 0 : 1);
