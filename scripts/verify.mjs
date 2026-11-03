#!/usr/bin/env node
// Replay the Petri dish from generation zero and check it against the contract.
//
//   node scripts/verify.mjs
//   node scripts/verify.mjs --contract petri-v4.testnet --network testnet [--code-hash <base58>]
//
// Every read is pinned to one finalized block, so a transaction landing mid-read cannot skew the result. The script
// reads the rules, state, colonies, the whole ledger (every join, purchase, sale, planting and tide in order), every
// colony's PETRI earnings and NEAR tide winnings, and the contract account itself. It replays all of it with
// petri-core (the same Rust crate the contract runs, compiled to WebAssembly) and compares: the history chain and
// board hash, the living cells, that every planting was legal and paid the formula's price (siege or not), that every
// purchase and sale followed the curve, every tide's chain and NEAR, the agar and every PETRI counter, the vault and
// every NEAR counter, and each colony's earnings and winnings. It also checks that the deployed code is the
// reproducible build of this repository (--code-hash, by default the hash in this file) and that the contract account
// has no full-access key, so nobody can change the code.
// Exits 0 when everything matches, 1 on any mismatch, 2 if the dish could not be read. Needs Node 20 or later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..", "web", "src", "engine", "pkg");
const { initSync, Engine, quote, buy_quote, sell_quote } = await import(pathToFileURL(path.join(pkg, "petri.js")).href);
initSync({ module: fs.readFileSync(path.join(pkg, "petri_bg.wasm")) });

/** The SHA-256 (base58) of `cargo near build reproducible-wasm` of contract/ at the deployed commit. */
const BUILD_HASH = "7GNyLTrzbFSmSxVp92Ne7bVXaKpUtxPsMYGqtx9ULuaS";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const NETWORK = arg("network", "testnet");
const CONTRACT = arg("contract", NETWORK === "mainnet" ? "petri.near" : "petri-v4.testnet");
const CODE_HASH = arg("code-hash", BUILD_HASH);
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
const fmtNear = (y) => {
  const v = BigInt(y);
  const frac = (v % 10n ** 24n).toString().padStart(24, "0").replace(/0+$/, "");
  return `${v / 10n ** 24n}${frac ? "." + frac : ""}`;
};

let rules, state, colonies, ledger, earnings, winnings, account, keys;
try {
  block = (await rpc("block", { finality: "final" })).header.height;
  [rules, state, account, keys] = await Promise.all([
    view("rules"),
    view("state"),
    rpc("query", { request_type: "view_account", block_id: block, account_id: CONTRACT }),
    rpc("query", { request_type: "view_access_key_list", block_id: block, account_id: CONTRACT }),
  ]);
  colonies = await paged("colonies", state.colonies, 500);
  ledger = await paged("ledger", Number(state.ledger), 1000);
  earnings = await paged("earnings", state.colonies, 2000);
  winnings = await paged("tide_winnings", state.colonies, 2000);
} catch (e) {
  console.error(`Could not read ${CONTRACT} on ${NETWORK}: ${e.message ?? e}`);
  process.exit(2);
}

const target = Number(state.generation);
const tideCount = ledger.filter((x) => x.Tide).length;
console.log(`Replaying ${CONTRACT} (${NETWORK}) at block ${block}: ${target.toLocaleString("en-US")} generations, ${ledger.length} ledger entries, ${colonies.length} colonies, ${tideCount} tides.`);

const t0 = performance.now();
const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor);
e.set_colonies(0);
e.set_agar(rules.max_supply);
const genOf = (x) => Number((x.Join ?? x.Buy ?? x.Plant ?? x.Sell ?? x.Tide).generation);
const at = new Map();
for (const x of ledger) at.set(genOf(x), [...(at.get(genOf(x)) ?? []), x]);
const house = [];
let sold = 0n, burned = 0n, returned = 0n, boughtBack = 0n, vault = 0n, nearIn = 0n, nearTides = 0n;
const count = { plants: 0, buys: 0, sells: 0, tides: 0 };
const bad = { legal: null, price: null, buy: null, sell: null, tide: null };
const flag = (k, g, what) => {
  if (!bad[k]) bad[k] = `generation ${g}: ${what}`;
};

for (;;) {
  const g = e.generation();
  for (const x of at.get(g) ?? []) {
    if (x.Join) {
      e.set_colonies(x.Join.colony);
      if (colonies[x.Join.colony - 1]?.house) {
        house.push(x.Join.colony);
        e.set_house(new Uint16Array(house));
      }
    } else if (x.Buy) {
      count.buys++;
      const want = buy_quote(x.Buy.near, e.agar(), rules.petri_price, rules.max_supply);
      if (want !== x.Buy.petri) flag("buy", g, `${x.Buy.petri} units for ${x.Buy.near} yocto, curve gives ${want}`);
      e.set_agar((BigInt(e.agar()) - BigInt(x.Buy.petri)).toString());
      sold += BigInt(x.Buy.petri);
      vault += BigInt(x.Buy.near);
      nearIn += BigInt(x.Buy.near);
    } else if (x.Sell) {
      count.sells++;
      const outstanding = BigInt(rules.max_supply) - burned - BigInt(e.agar());
      const want = sell_quote(x.Sell.petri, e.agar(), rules.petri_price, rules.max_supply, rules.sell_bps, vault.toString(), outstanding.toString());
      if (want !== x.Sell.near) flag("sell", g, `${x.Sell.near} yocto for ${x.Sell.petri} units, curve gives ${want}`);
      e.set_agar((BigInt(e.agar()) + BigInt(x.Sell.petri)).toString());
      boughtBack += BigInt(x.Sell.petri);
      vault -= BigInt(x.Sell.near);
    } else if (x.Plant) {
      const p = x.Plant;
      count.plants++;
      const cells = new Uint32Array(p.cells);
      const legal = e.check_plant(p.colony, cells, rules.buffer, rules.max_plant_cells);
      const siege = legal.startsWith("siege:");
      if (legal !== "" && !siege) flag("legal", g, `colony ${p.colony}: ${legal}`);
      else if (siege !== p.siege) flag("legal", g, `colony ${p.colony}: siege flag ${p.siege}, replay ${siege}`);
      const want = quote(e.agar(), rules.feed_ppm, rules.keeper_bps, e.counted(), rules.live_floor, rules.payback, rules.min_cell_price, p.cells.length, p.siege, rules.siege_x);
      if (want !== p.cost) flag("price", g, `paid ${p.cost}, formula gives ${want}`);
      const cost = BigInt(p.cost);
      const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
      burned += burn;
      returned += cost - burn;
      e.set_agar((BigInt(e.agar()) + cost - burn).toString());
      e.plant(p.colony, cells);
      vault += BigInt(p.near);
      nearIn += BigInt(p.near);
    } else {
      const t = x.Tide;
      count.tides++;
      const pay = (vault * BigInt(rules.tide_bps)) / 10000n;
      const full = (pay * BigInt(rules.tide_bounty_bps)) / 10000n;
      const pool = pay - (full < BigInt(rules.max_bounty) ? full : BigInt(rules.max_bounty));
      const storage = BigInt(t.storage);
      const paid = BigInt(e.tide((pool > storage ? pool - storage : 0n).toString()));
      if (e.chain_hex() !== t.chain) flag("tide", g, "history chain differs");
      else if (pay !== BigInt(t.pay) || paid !== BigInt(t.paid)) flag("tide", g, `paid ${t.paid} of ${t.pay}, replay ${paid} of ${pay}`);
      vault -= paid + BigInt(t.bounty) + storage;
      nearTides += paid;
    }
  }
  if (g >= target) break;
  let next = g + 1;
  while (next < target && !at.has(next)) next++;
  e.step(next - g);
}
const ms = performance.now() - t0;

const earnedBad = colonies.filter((c, i) => e.earned_of(c.id) !== earnings[i]);
const wonBad = colonies.filter((c, i) => e.won_of(c.id) !== winnings[i]);
const fullKeys = keys.keys.filter((k) => k.access_key.permission === "FullAccess").length;
const rule = (k, n, noun) => [`${noun[0].toUpperCase()}${noun.slice(1)}`, `${n} of ${n}`, bad[k] ? `differs at ${bad[k]}` : `${n} of ${n}`];
const checks = [
  ["History chain", state.chain, e.chain_hex()],
  ["Board hash", state.board_hash, e.board_hash_hex()],
  ["Living cells", String(state.total_live), String(e.total_live())],
  rule("legal", count.plants, "legal plantings"),
  rule("price", count.plants, "planting prices"),
  rule("buy", count.buys, "purchases on the curve"),
  rule("sell", count.sells, "sales on the curve"),
  rule("tide", count.tides, "tides"),
  ["Agar", fmt(state.agar), fmt(e.agar())],
  ["Sold for NEAR", fmt(state.sold), fmt(sold)],
  ["Burned", fmt(state.burned), fmt(burned)],
  ["Returned to the agar", fmt(state.returned), fmt(returned)],
  ["Bought back", fmt(state.bought_back), fmt(boughtBack)],
  ["Keeper share", fmt(BigInt(state.keeper_pot) + BigInt(state.keeper_paid)), fmt(e.keeper_total())],
  ["Colony earnings", `${colonies.length} of ${colonies.length}`, `${colonies.length - earnedBad.length} of ${colonies.length}`],
  ["Vault (NEAR)", fmtNear(state.vault), fmtNear(vault)],
  ["NEAR paid in", fmtNear(state.near_in), fmtNear(nearIn)],
  ["NEAR paid at tides", fmtNear(state.near_tides), fmtNear(nearTides)],
  ["Colony tide winnings", `${colonies.length} of ${colonies.length}`, `${colonies.length - wonBad.length} of ${colonies.length}`],
  ["Deployed code hash", CODE_HASH, account.code_hash],
  ["Full-access keys", "0", String(fullKeys)],
];
let differ = 0;
for (const [name, want, got] of checks) {
  const ok = want === got;
  if (!ok) differ++;
  console.log(`${ok ? "  match " : "  DIFFERS"}  ${name.padEnd(24)} ${got}${ok ? "" : `  (expected: ${want})`}`);
}
for (const c of earnedBad.slice(0, 10)) console.log(`  ${c.name}: contract ${fmt(earnings[c.id - 1])}, replay ${fmt(e.earned_of(c.id))}`);
for (const c of wonBad.slice(0, 10)) console.log(`  ${c.name}: contract ${fmtNear(winnings[c.id - 1])} NEAR won, replay ${fmtNear(e.won_of(c.id))}`);
if (fullKeys > 0) console.log("  The contract account still has a full-access key: whoever holds it could deploy different code.");
console.log(differ === 0 ? `Everything matches. Replay took ${ms.toFixed(0)} ms.` : `${differ} check(s) differ.`);
process.exit(differ === 0 ? 0 : 1);
