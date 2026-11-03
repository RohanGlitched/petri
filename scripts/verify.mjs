#!/usr/bin/env node
// Replay the Petri dish from generation zero and check it against the contract.
//
//   node scripts/verify.mjs
//   node scripts/verify.mjs [--network testnet|mainnet] [--contract <account>] [--code-hash <base58>]
//
// Every read is pinned to one finalized block, so a transaction landing mid-read cannot skew the result. The script
// reads the rules, state, colonies, the whole ledger (every join, purchase, sale, planting, tide, skip and refund in
// order), every colony's PETRI earnings and NEAR tide winnings, the contract account and its NEP-330 source metadata. It replays all of it with
// petri-core (the same Rust crate the contract runs, compiled to WebAssembly) and compares: the history chain and
// board hash, the living cells, that every planting was legal and paid the formula's price and its fee, that every
// purchase and sale followed the curve and the sale allowance, every tide's chain, shares, bounty and storage (and that
// a tide ran at exactly the tide generations where some colony outside the house had earned), that colonies which
// never attached NEAR were paid their vault shares, sales and the bounties of tides they ran as credit, that every
// specimen slide is exactly its colony's living cells as the board stood at the rule's price (burned), the agar and
// every PETRI counter, the vault,
// the credit pool and every NEAR and credit counter, each colony's earnings and winnings, and that the contract's NEAR
// covers everything it owes. It also checks the deployed code hash (--code-hash, by default
// the hash of `cargo near build reproducible-wasm` at the commit the contract's own metadata names: rebuild it to check
// this constant) and that the contract account has no full-access key, so nobody can change the code.
// Exits 0 when everything matches, 1 on any mismatch, 2 if the dish could not be read. Needs Node 20 or later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.join(here, "..", "web", "src", "engine", "pkg");
const { initSync, Engine, quote, buy_quote, sell_quote } = await import(pathToFileURL(path.join(pkg, "petri.js")).href);
initSync({ module: fs.readFileSync(path.join(pkg, "petri_bg.wasm")) });

/** The SHA-256 (base58) of `cargo near build reproducible-wasm` of contract/ at the deployed commit. */
const BUILD_HASH = "Foo3au6aYVQMV2cLv5p3DreSYEWgfHwq2MpKU4zv7U6j";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const NETWORK = arg("network", "testnet");
const CONTRACT = arg("contract", NETWORK === "mainnet" ? "petri-dish.near" : "petri-v5.testnet");
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

let rules, state, colonies, ledger, earnings, winnings, account, keys, meta;
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
  meta = await view("contract_source_metadata").catch(() => null);
} catch (e) {
  console.error(`Could not read ${CONTRACT} on ${NETWORK}: ${e.message ?? e}`);
  process.exit(2);
}

const target = Number(state.generation);
const tideCount = ledger.filter((x) => x.Tide).length;
console.log(`Replaying ${CONTRACT} (${NETWORK}) at block ${block}: ${target.toLocaleString("en-US")} generations, ${ledger.length} ledger entries, ${colonies.length} colonies, ${tideCount} tides.`);

const t0 = performance.now();
const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
e.set_colonies(0);
e.set_agar(rules.max_supply);
const genOf = (x) => Number(Object.values(x)[0].generation);
const at = new Map();
for (const x of ledger) at.set(genOf(x), [...(at.get(genOf(x)) ?? []), x]);
const house = [];
const TIDE_STORAGE_MAX = 3n * 10n ** 21n;
let sold = 0n, burned = 0n, returned = 0n, boughtBack = 0n, vault = 0n, pool = 0n, sellLeft = 0n, nearIn = 0n, nearTides = 0n, nearAsCredit = 0n, creditWon = 0n, creditSold = 0n, slidesBurned = 0n;
const count = { plants: 0, buys: 0, sells: 0, tides: 0, idle: 0, slides: 0 };
const bad = { legal: null, price: null, fee: null, buy: null, sell: null, tide: null, slide: null };
const popcount = (b) => {
  let n = 0;
  for (let v = b; v; v &= v - 1) n++;
  return n;
};
const flag = (k, g, what) => {
  if (!bad[k]) bad[k] = `generation ${g}: ${what}`;
};

for (;;) {
  const g = e.generation();
  const entries = at.get(g) ?? [];
  // A tide runs at a multiple of tide_every when some colony outside the house earned since the last one, and only then.
  const onSchedule = g > 0 && g % rules.tide_every === 0;
  const due = onSchedule && e.tide_due();
  const ran = entries.some((x) => x.Tide);
  if (due && !ran) flag("tide", g, "a tide was due (colonies had earned) but none was recorded");
  else if (ran && !due) flag("tide", g, "a tide was recorded with nobody to pay, or off the schedule");
  else if (onSchedule && !due) count.idle++;
  for (const x of entries) {
    if (x.Join) {
      e.set_colonies(x.Join.colony);
      if (colonies[x.Join.colony - 1]?.house) {
        house.push(x.Join.colony);
        e.set_house(new Uint16Array(house));
      }
    } else if (x.Buy) {
      count.buys++;
      const paid = BigInt(x.Buy.near) + BigInt(x.Buy.credit);
      const want = buy_quote(paid.toString(), e.agar(), rules.petri_price, rules.max_supply);
      if (want !== x.Buy.petri) flag("buy", g, `${x.Buy.petri} units for ${paid} yocto, curve gives ${want}`);
      e.set_agar((BigInt(e.agar()) - BigInt(x.Buy.petri)).toString());
      sold += BigInt(x.Buy.petri);
      vault += BigInt(x.Buy.near);
      nearIn += BigInt(x.Buy.near);
      pool += BigInt(x.Buy.credit);
      if (BigInt(x.Buy.near) > 0n) e.attach(x.Buy.colony);
    } else if (x.Sell) {
      count.sells++;
      const outstanding = BigInt(rules.max_supply) - burned - BigInt(e.agar());
      const want = sell_quote(x.Sell.petri, e.agar(), rules.petri_price, rules.max_supply, rules.sell_bps, vault.toString(), outstanding.toString());
      if (want !== x.Sell.near) flag("sell", g, `${x.Sell.near} yocto for ${x.Sell.petri} units, curve gives ${want}`);
      else if (BigInt(x.Sell.near) > sellLeft) flag("sell", g, `sold beyond the allowance (${sellLeft} left)`);
      else if (x.Sell.as_credit === e.has_attached(x.Sell.colony)) flag("sell", g, `colony ${x.Sell.colony} paid in ${x.Sell.as_credit ? "credit" : "NEAR"}, but it ${x.Sell.as_credit ? "has" : "never"} attached NEAR`);
      if (x.Sell.as_credit) creditSold += BigInt(x.Sell.paid);
      e.set_agar((BigInt(e.agar()) + BigInt(x.Sell.petri)).toString());
      boughtBack += BigInt(x.Sell.petri);
      vault -= BigInt(x.Sell.near);
      sellLeft -= BigInt(x.Sell.near);
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
      if (BigInt(p.near) + BigInt(p.credit) < BigInt(rules.cell_fee) * BigInt(p.cells.length)) flag("fee", g, `colony ${p.colony} paid less than the cell fee`);
      const cost = BigInt(p.cost);
      const burn = (cost * BigInt(rules.burn_bps)) / 10000n;
      burned += burn;
      returned += cost - burn;
      e.set_agar((BigInt(e.agar()) + cost - burn).toString());
      e.plant(p.colony, cells);
      if (BigInt(p.near) > 0n) e.attach(p.colony);
      vault += BigInt(p.near);
      nearIn += BigInt(p.near);
      pool += BigInt(p.credit);
    } else if (x.Refund) {
      vault += BigInt(x.Refund.near);
    } else if (x.Slide) {
      const sl = x.Slide;
      count.slides++;
      const want = e.region_bitmap(sl.colony, sl.x, sl.y, sl.w, sl.h);
      const got = Buffer.from(sl.bitmap, "base64");
      const cells = want.reduce((n, b) => n + popcount(b), 0);
      const price = BigInt(rules.slide_cells_price) * BigInt(cells);
      if (sl.w < 4 || sl.w > 32 || sl.h < 4 || sl.h > 32) flag("slide", g, `slide ${sl.token} is ${sl.w} x ${sl.h}`);
      else if (Number(sl.token) !== count.slides) flag("slide", g, `slide ${sl.token} out of order`);
      else if (want.length !== got.length || want.some((b, i) => b !== got[i])) flag("slide", g, `slide ${sl.token} is not colony ${sl.colony}'s cells as the dish stood`);
      else if (cells !== sl.cells || cells < rules.slide_min_cells) flag("slide", g, `slide ${sl.token} holds ${cells} cells, recorded ${sl.cells}`);
      else if (BigInt(sl.cost) !== price) flag("slide", g, `slide ${sl.token} burned ${sl.cost}, rule gives ${price}`);
      burned += BigInt(sl.cost);
      slidesBurned += BigInt(sl.cost);
    } else if (x.Tide) {
      const t = x.Tide;
      count.tides++;
      const pay = (vault * BigInt(rules.tide_bps)) / 10000n;
      const full = (pay * BigInt(rules.tide_bounty_bps)) / 10000n;
      const capped = full < BigInt(rules.max_bounty) ? full : BigInt(rules.max_bounty);
      const storage = BigInt(t.storage);
      const creditPay = (pool * BigInt(rules.tide_bps)) / 10000n;
      const left = pay - capped;
      const [paidS, creditS, asCreditS] = e.tide((left > storage ? left - storage : 0n).toString(), creditPay.toString()).split(",");
      const paid = BigInt(paidS);
      const creditPaid = BigInt(creditS);
      const asCredit = BigInt(asCreditS);
      const winners = paid + asCredit > 0n;
      // A guest (a colony that never attached NEAR) that ran the tide is paid its bounty as credit.
      const bountyCredit = t.by > 0 && !e.has_attached(t.by) ? BigInt(t.bounty) : 0n;
      if (bountyCredit > 0n) e.add_credit_won(t.by, bountyCredit.toString());
      if (e.chain_hex() !== t.chain) flag("tide", g, "history chain differs");
      else if (pay !== BigInt(t.pay) || paid !== BigInt(t.paid)) flag("tide", g, `paid ${t.paid} of ${t.pay}, replay ${paid} of ${pay}`);
      else if (asCredit !== BigInt(t.as_credit)) flag("tide", g, `paid ${t.as_credit} of the vault as credit, replay ${asCredit}`);
      else if (BigInt(t.bounty) !== (winners ? capped : 0n)) flag("tide", g, `bounty ${t.bounty}, rules give ${winners ? capped : 0n}`);
      else if (storage > TIDE_STORAGE_MAX) flag("tide", g, `charged ${t.storage} yocto of storage for one record`);
      else if (creditPay !== BigInt(t.credit_pay) || creditPaid !== BigInt(t.credit_paid)) flag("tide", g, `credit pool paid ${t.credit_paid} of ${t.credit_pay}, replay ${creditPaid} of ${creditPay}`);
      vault -= paid + asCredit + BigInt(t.bounty) + storage;
      pool -= creditPaid;
      nearTides += paid;
      nearAsCredit += asCredit + bountyCredit;
      creditWon += creditPaid + asCredit + bountyCredit;
      sellLeft = (vault * BigInt(rules.sell_cap_bps)) / 10000n;
    }
    // A Skip entry only moves the clock; the dish does not change.
  }
  if (g >= target) break;
  let next = g + 1;
  while (next < target && !at.has(next) && next % rules.tide_every !== 0) next++;
  e.step(next - g);
}
const ms = performance.now() - t0;

const earnedBad = colonies.filter((c, i) => e.earned_of(c.id) !== earnings[i]);
const wonBad = colonies.filter((c, i) => e.won_of(c.id) !== winnings[i]);
const creditBad = colonies.filter((c) => e.credit_won_of(c.id) !== c.credit_won);
const fullKeys = keys.keys.filter((k) => k.access_key.permission === "FullAccess").length;
const outstanding = BigInt(state.credit_given) + BigInt(state.credit_won) + BigInt(state.credit_sold) - BigInt(state.credit_spent) - BigInt(state.credit_reclaimed);
const owed = BigInt(state.vault) + BigInt(state.credit_pool) + outstanding + BigInt(state.tides_owed) + BigInt(state.pending);
const free = BigInt(account.amount) - BigInt(account.storage_usage) * 10n ** 19n + BigInt(state.wrapped);
const rule = (k, n, noun) => [`${noun[0].toUpperCase()}${noun.slice(1)}`, `${n} of ${n}`, bad[k] ? `differs at ${bad[k]}` : `${n} of ${n}`];
const all = (name, list) => [name, `${colonies.length} of ${colonies.length}`, `${colonies.length - list.length} of ${colonies.length}`];
const checks = [
  ["History chain", state.chain, e.chain_hex()],
  ["Board hash", state.board_hash, e.board_hash_hex()],
  ["Living cells", String(state.total_live), String(e.total_live())],
  rule("legal", count.plants, "legal plantings"),
  rule("price", count.plants, "planting prices"),
  rule("fee", count.plants, "planting fees"),
  rule("buy", count.buys, "purchases on the curve"),
  rule("sell", count.sells, "sales on the curve and allowance"),
  rule("tide", count.tides, "tides"),
  ["Specimens", `${state.slides} of ${state.slides} match the dish`, bad.slide ? `differs at ${bad.slide}` : `${count.slides} of ${state.slides} match the dish`],
  ["Agar", fmt(state.agar), fmt(e.agar())],
  ["Sold", fmt(state.sold), fmt(sold)],
  ["Burned", fmt(state.burned), fmt(burned)],
  ["Burned by specimens", fmt(state.slides_burned), fmt(slidesBurned)],
  ["Returned to the agar", fmt(state.returned), fmt(returned)],
  ["Bought back", fmt(state.bought_back), fmt(boughtBack)],
  ["Keeper share", fmt(BigInt(state.keeper_pot) + BigInt(state.keeper_paid)), fmt(e.keeper_total())],
  all("Colony earnings", earnedBad),
  ["Vault (NEAR)", fmtNear(state.vault), fmtNear(vault)],
  ["NEAR paid in", fmtNear(state.near_in), fmtNear(nearIn)],
  ["NEAR paid at tides", fmtNear(state.near_tides), fmtNear(nearTides)],
  ["Vault shares, bounties as credit", fmtNear(state.near_as_credit), fmtNear(nearAsCredit)],
  ["Sales paid as credit", fmtNear(state.credit_sold), fmtNear(creditSold)],
  all("Colony tide winnings", wonBad),
  ["Credit pool", fmtNear(state.credit_pool), fmtNear(pool)],
  ["Credit paid at tides", fmtNear(state.credit_won), fmtNear(creditWon)],
  all("Colony credit winnings", creditBad),
  ["Solvent (NEAR held >= owed)", "yes", free >= owed ? "yes" : `no: ${fmtNear(free)} held, ${fmtNear(owed)} owed`],
  ["Deployed code hash", CODE_HASH, account.code_hash],
  ["Full-access keys", "0", String(fullKeys)],
];
let differ = 0;
for (const [name, want, got] of checks) {
  const ok = want === got;
  if (!ok) differ++;
  console.log(`${ok ? "  match " : "  DIFFERS"}  ${name.padEnd(28)} ${got}${ok ? "" : `  (expected: ${want})`}`);
}
for (const c of earnedBad.slice(0, 10)) console.log(`  ${c.name}: contract ${fmt(earnings[c.id - 1])}, replay ${fmt(e.earned_of(c.id))}`);
for (const c of wonBad.slice(0, 10)) console.log(`  ${c.name}: contract ${fmtNear(winnings[c.id - 1])} NEAR won, replay ${fmtNear(e.won_of(c.id))}`);
if (meta) console.log(`Source: ${meta.link ?? "no link"}; built with ${meta.build_info?.build_command?.join(" ") ?? "no build info"} in ${meta.build_info?.build_environment ?? "?"}`);
if (count.idle > 0) console.log(`${count.idle} tide generation(s) had nobody to pay and were skipped, as the rules say.`);
console.log(`Owed: ${fmtNear(owed)} NEAR (vault, credit pool, unspent credit, unclaimed winnings, pending); held beyond storage: ${fmtNear(free)} NEAR${BigInt(state.wrapped) > 0n ? ` (with ${fmtNear(state.wrapped)} wNEAR not yet unwrapped)` : ""}.`);
if (fullKeys > 0) console.log("  The contract account still has a full-access key: whoever holds it could deploy different code.");
console.log(differ === 0 ? `Everything matches. Replay took ${ms.toFixed(0)} ms.` : `${differ} check(s) differ.`);
process.exit(differ === 0 ? 0 : 1);
