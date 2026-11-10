// Living slides v2 on a dish, keyless from end to end, and played by a team bench account that is not the house:
//
//  1. The funder (the keeper on mainnet) moves NEAR to the accounts that sign. The dish's own NEAR is never used.
//  2. The dish account creates its factory `slides.<dish>` in ONE transaction: create the account, fund its storage,
//     deploy purse/res/petri_purse_factory.wasm (the v2 purse inside it), call `new`. There is no AddKey, so the
//     factory never has a key and nobody can change how it makes purses.
//  3. The bench (an ordinary account outside the house) joins the dish with its own NEAR, enough to be ATTACHED, and
//     plants a still life (a dead spark coil, 18 cells, that lives alone for good).
//  4. The bench mints a slide of it, prepays the factory and seals the slide (nft_transfer_call): the factory asks the
//     dish who minted it and creates the keyless purse `slide-<id>.slides.<dish>`, holder and minter the bench.
//  5. The purse joins the dish with enough NEAR to be ATTACHED (read live: intent_minimum) and plants its own slide's
//     pattern under its licence. From then on a keyless account earns feed, tides and royalties on the dish.
//  6. Mainnet only: Congo Red (a house strain) hands living slide 14's purse to the bench, so no house account holds
//     a fed colony's purse.
//
//   node scripts/purse-mainnet-v2.mjs plan   [--network mainnet|testnet] [--keys <dir>] [--bench <account>]
//   node scripts/purse-mainnet-v2.mjs send   [same]      sign, step by step; skips every step already done
//   node scripts/purse-mainnet-v2.mjs status [same]      the colonies, what they earn, keys
//   node scripts/purse-mainnet-v2.mjs claim  [same]      the bench has the purse claim what it earned (a tx hash)
//
// --keys is a near-cli keychain for the network (default ~/.near-credentials/<network>). For each signer the script
// uses <keys>/<account>/ed25519_*.json or <keys>/<account>.json, whichever holds a full-access key the chain knows, so a
// stale top-level key file is skipped. `send` stops before any step that would take the NEAR spent past BUDGET, leave
// the funder under FUNDER_KEEP, the bench under 0.02 NEAR, or any other signer under 0.05 NEAR. NEAR moved between the
// team's own accounts is shown but not counted as spent; deposits that leave them (storage, joins, plantings) are.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const cmd = argv.find((a) => !a.startsWith("--") && !argv[argv.indexOf(a) - 1]?.startsWith("--")) ?? "plan";
const NET = flag("network", process.env.PETRI_NETWORK ?? "mainnet");
if (!["mainnet", "testnet"].includes(NET)) throw new Error("--network is mainnet or testnet");
process.env.PETRI_NETWORK = NET;
const KEYS = flag("keys", process.env.PETRI_KEYS_DIR ?? path.join(os.homedir(), ".near-credentials", NET));
process.env.PETRI_KEYS_DIR = KEYS;

// near-api-js as the agents install it (scripts/ has no node_modules of its own).
const { createRequire } = await import("node:module");
const { Account, JsonRpcProvider, KeyPair, actions } = createRequire(new URL("../agents/package.json", import.meta.url))("near-api-js");
const { CONTRACT, Engine, failureText, liveDish, RPCS, rpc, view } = await import("../agents/lib.mjs");

const YOCTO = 10n ** 24n;
const MILLI = YOCTO / 1000n;
const TGAS = 10n ** 12n;
const near = (y) => (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(6);

const CONFIG = {
  mainnet: {
    funder: "keeper.petri-dish.near",
    bench: "58135f2e727a40755df38f1d231aca159ea4ab138260b8d0d9419da63f999932",
    // Living slide 14 (made by hand, without a factory) passes from Congo Red to the bench.
    handover: { purse: "slide-14.petri-dish.near", token: "14", from: "congo.petri-dish.near" },
  },
  testnet: {
    funder: "petri-guests.testnet",
    bench: "9e0f14b0b58c9760dd95af218cdd98a4417cd37d316e01cbff178d41ac5b7c5e",
    handover: null,
  },
}[NET];
const DISH = CONTRACT;
const FACTORY = `slides.${DISH}`;
const FUNDER = flag("funder", CONFIG.funder);
const BENCH = flag("bench", CONFIG.bench);
const HANDOVER = CONFIG.handover;
const BUDGET = 1400n * MILLI;
const FUNDER_KEEP = 900n * MILLI;
const BENCH_KEEP = 20n * MILLI;
const KEEP = 50n * MILLI;
// NEAR holds back prepaid gas at ten times its price until the refund lands: 0.1 NEAR per 100 TGas attached.
const HOLD_PER_TGAS = MILLI;
const hold = (tgas) => tgas * HOLD_PER_TGAS;
// A dead spark coil: a still life of 18 cells, 7 by 5. Alone on an empty dish the engine keeps it at 18 cells for good.
const PATTERN = ["OO...OO", "O.O.O.O", "..O.O..", "O.O.O.O", "OO...OO"];
const BENCH_NAME = NET === "mainnet" ? "Team bench" : "Team bench v2";
const BENCH_COLOR = 0x6f8f5a;
const SLIDE_TITLE = "Dead spark coil";

const here = path.dirname(fileURLToPath(import.meta.url));
const FACTORY_CODE = fs.readFileSync(path.join(here, "../purse/res/petri_purse_factory.wasm"));
// The factory's account: its code, its state (the dish, prepayment records) and 1,000 bytes of room for them.
const FACTORY_STORAGE = (BigInt(FACTORY_CODE.length) + 1000n) * 10n ** 19n;
const STATE_FILE = path.join(os.homedir(), `.petri-purse-v2-${NET}.json`);

// ---------- chain ----------

async function balance(a) {
  try {
    return BigInt((await rpc("query", { request_type: "view_account", finality: "final", account_id: a })).amount);
  } catch {
    return null;
  }
}
async function accountInfo(a) {
  try {
    return await rpc("query", { request_type: "view_account", finality: "final", account_id: a });
  } catch {
    return null;
  }
}
async function keys(a) {
  try {
    return (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: a })).keys;
  } catch {
    return [];
  }
}
async function viewAt(contract, method, args = {}) {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

/** The signer's key: one of its key files whose key is a full-access key on chain now. */
const signers = new Map();
async function signer(accountId) {
  if (signers.has(accountId)) return signers.get(accountId);
  const onChain = new Set((await keys(accountId)).filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key));
  const files = [];
  const dir = path.join(KEYS, accountId);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) files.push(path.join(dir, f));
  if (fs.existsSync(path.join(KEYS, `${accountId}.json`))) files.push(path.join(KEYS, `${accountId}.json`));
  for (const f of files) {
    const { private_key, secret_key } = JSON.parse(fs.readFileSync(f, "utf8"));
    const pk = private_key ?? secret_key;
    if (!pk) continue;
    const pub = KeyPair.fromString(pk).getPublicKey().toString();
    if (onChain.has(pub)) {
      const a = new Account(accountId, new JsonRpcProvider({ url: RPCS[0] }), pk);
      signers.set(accountId, { account: a, file: f, publicKey: pub });
      return signers.get(accountId);
    }
  }
  throw new Error(`no key file in ${KEYS} holds a full-access key of ${accountId}`);
}

// ---------- the run ----------

const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
const rows = [];
let spent = 0n;
let moved = 0n;
const SEND = cmd === "send";

/**
 * One transaction. `spends`: whether its deposit leaves the team's accounts (false for NEAR moved between them).
 * Stops before signing if the spend would pass BUDGET or leave the signer under its floor (the deposit plus the gas
 * NEAR holds back while the transaction runs).
 */
async function step(what, from, to, acts, { deposit = 0n, tgas = 0n, spends = true } = {}) {
  const before = await balance(from);
  if (before === null) throw new Error(`${from} does not exist`);
  const gasGuess = 3n * MILLI;
  const floor = from === FUNDER ? FUNDER_KEEP : from === BENCH ? BENCH_KEEP : from === DISH ? 0n : KEEP;
  if (spent + (spends ? deposit : 0n) + gasGuess > BUDGET) throw new Error(`stopping before "${what}": it would take the spend past ${near(BUDGET)} NEAR`);
  if (from !== DISH && before - deposit - gasGuess < floor) throw new Error(`stopping before "${what}": ${from} would fall under ${near(floor)} NEAR`);
  if (before < deposit + hold(tgas) + gasGuess) throw new Error(`stopping before "${what}": ${from} needs ${near(deposit + hold(tgas))} NEAR free while it runs`);
  const { account } = await signer(from);
  const res = await account.signAndSendTransaction({ receiverId: to, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const burnt = [res.transaction_outcome, ...res.receipts_outcome].reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n);
  const fail = [res.status, ...res.receipts_outcome.map((r) => r.outcome.status)].map((s) => s?.Failure).find(Boolean);
  const cost = (fail || !spends ? 0n : deposit) + burnt;
  spent += cost;
  if (!spends && !fail) moved += deposit;
  let value = null;
  try {
    if (res.status?.SuccessValue) value = JSON.parse(Buffer.from(res.status.SuccessValue, "base64").toString("utf8"));
  } catch {
    /* not JSON */
  }
  const logs = res.receipts_outcome.flatMap((r) => r.outcome.logs);
  rows.push({ what, signer: from, hash: res.transaction.hash, near: near(cost), moved: spends ? null : near(deposit), failed: fail ? failureText(fail) : null });
  console.log(`${fail ? "FAIL" : "ok  "} ${what}\n     ${from} ${res.transaction.hash} spent ${near(cost)} NEAR${spends ? "" : `, moved ${near(deposit)}`}${fail ? `\n     refused: ${failureText(fail)}` : ""}`);
  if (fail) throw new Error(`"${what}" failed`);
  return { res, value, logs };
}

/** Top the bench (or another signer) up from the funder so it has `need` NEAR free over its floor. */
async function fund(who, need, why) {
  const have = (await balance(who)) ?? 0n;
  const floor = who === BENCH ? BENCH_KEEP : KEEP;
  if (have >= need + floor) return;
  // Rounded up to the next 0.01 NEAR.
  const short = need + floor - have;
  const amount = ((short + 10n * MILLI - 1n) / (10n * MILLI)) * 10n * MILLI;
  await step(`${FUNDER} sends ${near(amount)} NEAR to ${who} (${why})`, FUNDER, who, [actions.transfer(amount)], { deposit: amount, spends: false });
}

const call = (method, args, tgas, deposit = 0n) => actions.functionCall(method, args, tgas * TGAS, deposit);

function shape() {
  const out = [];
  PATTERN.forEach((row, y) => [...row].forEach((c, x) => c === "O" && out.push([x, y])));
  return out;
}

/** The pattern alone on an empty dish: its living cells after 1, 2, 3, 250 and 1,000 generations. */
function lives(rules, cellsOf) {
  const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
  e.set_colonies(1);
  e.plant(1, new Uint32Array(cellsOf(60, 60)));
  const at = [];
  for (let t = 1; t <= 1000; t++) {
    e.step(1);
    if ([1, 2, 3, 250, 1000].includes(t)) at.push(e.live_counts()[1] ?? 0);
  }
  e.free();
  return at;
}

/** A legal spot for the pattern for colony `id`, inside the dish's edges, as far from other cells as the samples allow. */
function place(world, id, pts, w, h) {
  const { width: W, height: H, buffer, max_plant_cells: max } = world.rules;
  const owners = world.engine.cells();
  let best = null;
  for (let t = 0; t < 800; t++) {
    const x0 = Math.floor(Math.random() * (W - w)), y0 = Math.floor(Math.random() * (H - h));
    const cells = pts.map(([dx, dy]) => (y0 + dy) * W + x0 + dx);
    if (world.engine.check_plant(id, new Uint32Array(cells), buffer, max) !== "") continue;
    // Room around it: live cells within 6 of the pattern's box count against the spot.
    let near = 0;
    for (let y = y0 - 6; y < y0 + h + 6; y++) for (let x = x0 - 6; x < x0 + w + 6; x++) if (owners[((y + H) % H) * W + ((x + W) % W)]) near++;
    if (!best || near < best.near) best = { x0, y0, cells, near };
    if (near === 0) break;
  }
  return best;
}

const slidesOf = async (colonyId) => (await view("slides", { from: 0, limit: 500 }).catch(() => [])).filter((s) => s.colony === colonyId);

async function readAll() {
  const [rules, factoryAcct, benchColony, benchBal, funderBal, dishBal, solvency] = await Promise.all([
    view("rules"),
    accountInfo(FACTORY),
    view("colony_of", { account_id: BENCH }),
    balance(BENCH),
    balance(FUNDER),
    balance(DISH),
    view("solvency").catch(() => null),
  ]);
  const factoryInfo = factoryAcct && factoryAcct.code_hash !== "11111111111111111111111111111111" ? await viewAt(FACTORY, "factory").catch(() => null) : null;
  let slide = null;
  if (benchColony) slide = (await slidesOf(benchColony.id)).find((s) => s.cells === shape().length) ?? null;
  const purse = slide ? `slide-${slide.token_id}.${FACTORY}` : null;
  const purseInfo = purse ? await viewAt(purse, "purse").catch(() => null) : null;
  const purseColony = purse ? await view("colony_of", { account_id: purse }) : null;
  return { rules, factoryAcct, factoryInfo, benchColony, benchBal, funderBal, dishBal, solvency, slide, purse, purseInfo, purseColony };
}

const s0 = await readAll();
const { rules } = s0;
const pts = shape();
const PW = PATTERN[0].length, PH = PATTERN.length;
const survival = lives(rules, (x, y) => pts.map(([dx, dy]) => (y + dy) * rules.width + x + dx));
const [joinBench, joinPurse, plantNew, plantLicensed, slideDeposit, createCost, petriPlant, buy01] = await Promise.all([
  view("intent_minimum", { what: "join", account_id: BENCH }),
  view("intent_minimum", { what: "join", account_id: `slide-99999.${FACTORY}` }),
  view("plant_deposit", { cells: pts.length, note_bytes: 80 }),
  view("plant_deposit", { cells: pts.length, note_bytes: 80, slide: "1" }),
  view("slide_deposit", { w: PW, h: PH, title_bytes: SLIDE_TITLE.length }),
  s0.factoryInfo ? viewAt(FACTORY, "create_cost") : Promise.resolve(((BigInt(fs.statSync(path.join(here, "../purse/res/petri_purse.wasm")).size) + 2200n) * 10n ** 19n).toString()),
  view("quote", { cells: pts.length }),
  view("buy_quote", { near: (10n * MILLI).toString() }),
]);
// Each join brings what intent_minimum says (its storage plus min_join, so the colony is attached) and 2 milliNEAR more.
const JOIN_BENCH = BigInt(joinBench) + 2n * MILLI;
const JOIN_PURSE = BigInt(joinPurse) + 2n * MILLI;
const PLANT = BigInt(plantNew);
const PLANT_LICENSED = BigInt(plantLicensed);
const SLIDE = BigInt(slideDeposit);
const CREATE = BigInt(createCost);
const SLIDE_PETRI = BigInt(rules.slide_cells_price) * BigInt(pts.length);
const FACTORY_GAS = 10n * MILLI;
const T = { join: 100n, plant: 100n, mint: 100n, prepay: 10n, seal: 200n, purseJoin: 150n, pursePlant: 150n, handover: 30n, create: 50n, claim: 150n };

console.log(`network ${NET}, dish ${DISH}, factory ${FACTORY}, funder ${FUNDER}, bench ${BENCH}`);
console.log(`keys ${KEYS}; state file ${STATE_FILE}`);
console.log(`pattern: dead spark coil, ${pts.length} cells, ${PW}x${PH}; alone on an empty dish it has ${survival.join(" / ")} cells after 1 / 2 / 3 / 250 / 1,000 generations (licence_min_cells ${rules.licence_min_cells}, max_plant_cells ${rules.max_plant_cells})`);
console.log(`factory code ${FACTORY_CODE.length} bytes: storage ${near(FACTORY_STORAGE)} NEAR; purse create_cost ${near(CREATE)} NEAR`);
console.log(`join: bench ${near(JOIN_BENCH)} NEAR, purse ${near(JOIN_PURSE)} NEAR (intent_minimum + 0.002; min_join ${near(rules.min_join)}); planting ${near(PLANT)} NEAR + ${Number(petriPlant) / 1e6} PETRI; slide ${near(SLIDE)} NEAR + ${Number(SLIDE_PETRI) / 1e6} PETRI; 0.01 NEAR buys ${Number(buy01) / 1e6} PETRI`);
console.log(`balances: funder ${near(s0.funderBal ?? 0n)}, bench ${s0.benchBal === null ? "not created" : near(s0.benchBal)}, dish ${near(s0.dishBal ?? 0n)}${s0.solvency ? ` (surplus ${near(s0.solvency.surplus ?? 0)})` : ""}`);

// The plan: every step, its signer, what it costs and whether it is done.
const handoverInfo = HANDOVER ? await viewAt(HANDOVER.purse, "purse").catch(() => null) : null;
const plan = [
  { id: "fund-dish", signer: FUNDER, moves: FACTORY_STORAGE + FACTORY_GAS, done: !!s0.factoryAcct || !!state.fundedDish, what: `move the factory's storage and gas to ${DISH}` },
  { id: "factory", signer: DISH, spends: FACTORY_STORAGE, tgas: T.create, done: !!s0.factoryInfo, what: `${DISH} creates ${FACTORY}: create, fund, deploy, new; no AddKey` },
  { id: "bench-join", signer: BENCH, spends: JOIN_BENCH, tgas: T.join, done: !!s0.benchColony, what: `bench joins the dish attached ("${BENCH_NAME}")` },
  { id: "bench-plant", signer: BENCH, spends: PLANT, tgas: T.plant, done: !!s0.benchColony?.last_plant_generation, what: "bench plants the dead spark coil" },
  { id: "bench-mint", signer: BENCH, spends: SLIDE, tgas: T.mint, done: !!s0.slide, what: "bench mints a slide of it" },
  { id: "prepay", signer: BENCH, spends: CREATE, tgas: T.prepay, done: !!s0.purseInfo, what: "bench prepays the factory's create_cost" },
  { id: "seal", signer: BENCH, spends: 1n, tgas: T.seal, done: !!s0.purseInfo, what: "bench seals the slide: nft_transfer_call to the factory" },
  { id: "purse-join", signer: BENCH, spends: JOIN_PURSE, tgas: T.purseJoin, done: !!s0.purseColony, what: "the purse joins the dish attached" },
  { id: "purse-plant", signer: BENCH, spends: PLANT_LICENSED, tgas: T.pursePlant, done: !!s0.purseColony?.last_plant_generation, what: "the purse plants its slide's pattern under its licence" },
];
if (HANDOVER) plan.push({ id: "handover", signer: HANDOVER.from, spends: 1n, tgas: T.handover, done: handoverInfo?.holder === BENCH, what: `${HANDOVER.from} hands ${HANDOVER.purse} to the bench (nft_transfer)` });
const GAS_EACH = 3n * MILLI;
let todoSpend = 0n;
let todoMove = 0n;
// The bench's NEAR, step by step: what it has spent so far, and the most it needs free at once (that plus a step's
// deposit and the gas the step holds back).
let benchNeed = 0n;
let benchPeak = 0n;
console.log("\n| Step | Signer | NEAR spent (deposit + about 0.003 gas) | NEAR moved | Gas held while it runs | Done |\n|---|---|---|---|---|---|");
for (const p of plan) {
  const spend = (p.spends ?? 0n) + GAS_EACH;
  if (!p.done) {
    todoSpend += spend;
    todoMove += p.moves ?? 0n;
    if (p.signer === BENCH) {
      const at = benchNeed + (p.spends ?? 0n) + hold(p.tgas);
      if (at > benchPeak) benchPeak = at;
      benchNeed += spend;
    }
  }
  console.log(`| ${p.what} | ${p.signer.length > 30 ? p.signer.slice(0, 8) + "…" : p.signer} | ${p.moves ? near(GAS_EACH) : near(spend)} | ${p.moves ? near(p.moves) : ""} | ${p.tgas ? `${p.tgas} TGas = ${near(hold(p.tgas))}` : ""} | ${p.done ? "yes" : "no"} |`);
}
const benchHas = s0.benchBal ?? 0n;
const benchMost = benchPeak > benchNeed ? benchPeak : benchNeed;
const benchTopUp = benchMost + BENCH_KEEP > benchHas ? benchMost + BENCH_KEEP - benchHas : 0n;
console.log(`\nstill to spend: about ${near(todoSpend)} NEAR (budget ${near(BUDGET)}); to move: ${near(todoMove)} NEAR to ${DISH}, and up to ${near(benchTopUp)} NEAR to the bench, which needs ${near(benchPeak)} NEAR at its peak (what it has spent by then, plus the deposit and the gas the step holds back; the held gas comes back)`);
const funderAfter = (s0.funderBal ?? 0n) - todoMove - benchTopUp - 10n * MILLI;
console.log(`funder after: about ${near(funderAfter)} NEAR (must stay over ${near(FUNDER_KEEP)}): ${funderAfter >= FUNDER_KEEP ? "ok" : "SHORT: send it more NEAR first"}`);
console.log(`budget: ${todoSpend <= BUDGET ? "ok" : "OVER"}`);
if (HANDOVER) console.log(`${HANDOVER.purse}: holder ${handoverInfo?.holder ?? "?"}, listed ${handoverInfo?.price ?? "no"}, approvals ${handoverInfo?.approvals ?? "?"}`);

async function report() {
  const s = await readAll();
  const purses = [s.purse, HANDOVER?.purse].filter(Boolean);
  console.log("\naccess keys (a keyless account has 0):");
  for (const a of [FACTORY, ...purses]) console.log(`  ${a}: ${(await keys(a)).length}`);
  for (const k of await keys(DISH)) console.log(`  ${DISH} key ${k.public_key} ${typeof k.access_key.permission === "string" ? k.access_key.permission : "FunctionCall"} nonce ${k.access_key.nonce}`);
  const fa = await accountInfo(FACTORY);
  if (fa) console.log(`${FACTORY}: code ${fa.code_hash}, storage ${fa.storage_usage} bytes, balance ${near(fa.amount)} NEAR`);
  if (s.purse) {
    const pa = await accountInfo(s.purse);
    console.log(`${s.purse}: code ${pa?.code_hash}, storage ${pa?.storage_usage} bytes, balance ${near(pa?.amount ?? 0)} NEAR`);
  }
  if (s.solvency) console.log(`${DISH} surplus ${near(s.solvency.surplus ?? 0)} NEAR (was ${near(s0.solvency?.surplus ?? 0)})`);
  return s;
}

async function status() {
  const s = await report();
  const world = await liveDish();
  const live = world.engine.live_counts();
  world.engine.free();
  for (const [label, acct] of [["bench", BENCH], ["purse", s.purse], ["slide 14's purse", HANDOVER?.purse]]) {
    if (!acct) continue;
    const [c, claim, petri, bal] = await Promise.all([view("colony_of", { account_id: acct }), view("claimable", { account_id: acct }), view("ft_balance_of", { account_id: acct }), balance(acct)]);
    if (!c) {
      console.log(`${label} ${acct}: no colony`);
      continue;
    }
    console.log(`${label} ${acct}: colony ${c.id} "${c.name}", attached ${c.attached}, kept ${c.kept}, living cells ${live[c.id] ?? 0}, PETRI ${Number(petri) / 1e6}, claimable ${Number(claim.petri) / 1e6} PETRI + ${near(claim.near)} NEAR, NEAR ${near(bal ?? 0n)}`);
  }
  if (s.purseInfo) console.log(`purse view: holder ${s.purseInfo.holder}, minter ${s.purseInfo.minter}, royalty_bps ${s.purseInfo.royalty_bps}`);
}

if (cmd === "plan") {
  console.log("\nplan only: nothing signed. Run with `send` to sign.");
  process.exit(0);
}
if (cmd === "status") {
  await status();
  process.exit(0);
}
if (cmd === "claim") {
  const s = await readAll();
  if (!s.purse) throw new Error("no purse yet");
  const r = await step("the bench has the purse claim what it earned", BENCH, s.purse, [call("act", { method: "claim", args: {} }, T.claim)], { tgas: T.claim });
  console.log("claimed:", JSON.stringify(r.value));
  await status();
  process.exit(0);
}
if (!SEND) throw new Error("plan | send | status | claim");
if (todoSpend > BUDGET) throw new Error("the plan is over budget");
if (survival[survival.length - 1] !== pts.length) throw new Error("the pattern does not live alone on this engine");

// 1-2. The factory, keyless from its first receipt.
if (!s0.factoryAcct) {
  if (!state.fundedDish) {
    const amount = FACTORY_STORAGE + FACTORY_GAS;
    const r = await step(`${FUNDER} moves ${near(amount)} NEAR to ${DISH} for the factory's storage and gas`, FUNDER, DISH, [actions.transfer(amount)], { deposit: amount, spends: false });
    state.fundedDish = r.res.transaction.hash;
    saveState();
  }
  await step(`${DISH} creates ${FACTORY}: create, fund ${near(FACTORY_STORAGE)} NEAR, deploy the factory (${FACTORY_CODE.length} bytes), new; no key is ever added`, DISH, FACTORY, [
    actions.createAccount(),
    actions.transfer(FACTORY_STORAGE),
    actions.deployContract(FACTORY_CODE),
    call("new", { dish: DISH }, T.create),
  ], { deposit: FACTORY_STORAGE, tgas: T.create });
} else if (!s0.factoryInfo) {
  throw new Error(`${FACTORY} exists but has no factory: look at it by hand`);
}
const fi = await viewAt(FACTORY, "factory");
if (fi.dish !== DISH) throw new Error(`${FACTORY} seals slides of ${fi.dish}, not ${DISH}`);
const create = BigInt(await viewAt(FACTORY, "create_cost"));

// 3. The bench joins, attached.
let bench = await view("colony_of", { account_id: BENCH });
if (!bench) {
  await fund(BENCH, JOIN_BENCH + hold(T.join), "its join");
  const taken = new Set((await view("colonies", { from: 0, limit: 500 })).map((c) => c.name.toLowerCase()));
  let name = BENCH_NAME;
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${BENCH_NAME} ${i}`;
  await step(`the bench joins the dish as "${name}" with ${near(JOIN_BENCH)} NEAR`, BENCH, DISH, [call("join", { name, color: BENCH_COLOR }, T.join, JOIN_BENCH)], { deposit: JOIN_BENCH, tgas: T.join });
  bench = await view("colony_of", { account_id: BENCH });
}
if (!bench.attached) throw new Error(`the bench's colony ${bench.id} is not attached: stop and look`);
console.log(`bench colony ${bench.id}, attached`);

// 4. It plants the still life, then mints a slide of it.
let slide = (await slidesOf(bench.id)).find((s) => s.cells === pts.length) ?? null;
if (!slide) {
  if (!bench.last_plant_generation) {
    const need = BigInt(petriPlant) + SLIDE_PETRI;
    const have = BigInt(await view("ft_balance_of", { account_id: BENCH }));
    if (have < (need * 11n) / 10n) {
      const nearFor = ((((need * 11n) / 10n - have) * 10n * MILLI) / BigInt(buy01)) + 2n * MILLI;
      await fund(BENCH, nearFor + hold(T.plant), "PETRI for the planting and the slide");
      await step(`the bench buys PETRI with ${near(nearFor)} NEAR`, BENCH, DISH, [call("buy", {}, T.plant, nearFor)], { deposit: nearFor, tgas: T.plant });
    }
    const world = await liveDish();
    const spot = place(world, bench.id, pts, PW, PH);
    world.engine.free();
    if (!spot) throw new Error("no legal spot for the pattern right now; run send again in a minute");
    const note = "The team bench plants a dead spark coil: a still life that lives on alone.";
    const deposit = BigInt(await view("plant_deposit", { cells: spot.cells.length, note_bytes: Buffer.byteLength(note) }));
    await fund(BENCH, deposit + hold(T.plant), "its planting");
    await step(`the bench plants the dead spark coil at (${spot.x0}, ${spot.y0}), ${spot.near} live cells nearby`, BENCH, DISH, [call("plant", { cells: spot.cells, note }, T.plant, deposit)], { deposit, tgas: T.plant });
    state.spot = { x: spot.x0, y: spot.y0 };
    saveState();
    bench = await view("colony_of", { account_id: BENCH });
  }
  // Where it stands: the bench's planting in the ledger is the truth; the state file is a shortcut.
  const at = state.spot;
  if (!at) throw new Error("the bench has planted but this script did not record where; mint by hand or set state.spot");
  // A slide captures the board as it stands: wait one generation so the planting is on it.
  await new Promise((ok) => setTimeout(ok, Number(rules.generation_ms) + 2000));
  const deposit = BigInt(await view("slide_deposit", { w: PW, h: PH, title_bytes: SLIDE_TITLE.length }));
  await fund(BENCH, deposit + hold(T.mint), "its slide");
  const r = await step(`the bench mints a slide of its ${pts.length} cells`, BENCH, DISH, [call("mint_slide", { x: at.x, y: at.y, w: PW, h: PH, title: SLIDE_TITLE }, T.mint, deposit)], { deposit, tgas: T.mint });
  slide = await view("slide", { token_id: String(r.value) });
  if (slide.cells !== pts.length) throw new Error(`slide ${slide.token_id} caught ${slide.cells} cells, not ${pts.length}: the coil changed; stop and look`);
}
const TOKEN = slide.token_id;
const PURSE = `slide-${TOKEN}.${FACTORY}`;
console.log(`slide ${TOKEN}: ${slide.cells} cells, owner ${slide.owner_id}; its purse ${PURSE}`);

// 5. Seal it: prepay, then nft_transfer_call to the factory.
if (slide.owner_id !== PURSE) {
  if (slide.owner_id !== BENCH) throw new Error(`slide ${TOKEN} is held by ${slide.owner_id}`);
  const credit = BigInt(await viewAt(FACTORY, "credit_of", { account_id: BENCH }));
  if (credit < create) {
    const pay = create - credit < 10n * MILLI ? 10n * MILLI : create - credit;
    await fund(BENCH, pay + hold(T.prepay), "the factory's create_cost");
    await step(`the bench prepays ${near(pay)} NEAR to the factory (create_cost ${near(create)})`, BENCH, FACTORY, [call("prepay", {}, T.prepay, pay)], { deposit: pay, tgas: T.prepay });
  }
  await fund(BENCH, hold(T.seal), "the gas the seal holds back");
  await step(`the bench seals slide ${TOKEN}: the factory creates ${PURSE} (no key), holder and minter the bench`, BENCH, DISH, [call("nft_transfer_call", { receiver_id: FACTORY, token_id: TOKEN, msg: "" }, T.seal, 1n)], { deposit: 1n, tgas: T.seal });
  const now = await view("slide", { token_id: TOKEN });
  if (now.owner_id !== PURSE) throw new Error(`the seal did not land: slide ${TOKEN} is held by ${now.owner_id}`);
}
const pinfo = await viewAt(PURSE, "purse");
console.log(`purse ${PURSE}: holder ${pinfo.holder}, minter ${pinfo.minter}, royalty ${pinfo.royalty_bps} bps`);
if (pinfo.holder !== BENCH) throw new Error("the purse's holder is not the bench");

// 6. The purse joins attached and plants its own slide's pattern.
let pc = await view("colony_of", { account_id: PURSE });
if (!pc) {
  const join = BigInt(await view("intent_minimum", { what: "join", account_id: PURSE })) + 2n * MILLI;
  await fund(BENCH, join + hold(T.purseJoin), "the purse's join");
  await step(`the purse joins the dish as "Living slide ${TOKEN}" with ${near(join)} NEAR from the bench`, BENCH, PURSE, [call("act", { method: "join", args: { name: `Living slide ${TOKEN}`, color: slide.color } }, T.purseJoin, join)], { deposit: join, tgas: T.purseJoin });
  pc = await view("colony_of", { account_id: PURSE });
}
if (!pc?.attached) throw new Error(`the purse's colony is not attached: stop and look`);
if (!pc.last_plant_generation) {
  const world = await liveDish();
  const bits = Buffer.from(slide.bitmap, "base64");
  const own = [];
  for (let i = 0; i < slide.w * slide.h; i++) if ((bits[i >> 3] >> (i & 7)) & 1) own.push([i % slide.w, Math.floor(i / slide.w)]);
  const spot = place(world, pc.id, own, slide.w, slide.h);
  world.engine.free();
  if (!spot) throw new Error("no legal spot for the purse's pattern right now; run send again in a minute");
  const note = `Living slide ${TOKEN} plants its own specimen.`;
  const deposit = BigInt(await view("plant_deposit", { cells: spot.cells.length, note_bytes: Buffer.byteLength(note), slide: TOKEN }));
  await fund(BENCH, deposit + hold(T.pursePlant), "the purse's planting");
  await step(`the purse plants its slide's ${spot.cells.length} cells under its licence at (${spot.x0}, ${spot.y0})`, BENCH, PURSE, [call("act", { method: "plant", args: { cells: spot.cells, note, slide: TOKEN } }, T.pursePlant, deposit)], { deposit, tgas: T.pursePlant });
}

// 7. Slide 14's purse leaves the house.
if (HANDOVER) {
  const h = await viewAt(HANDOVER.purse, "purse");
  if (h.holder !== BENCH) {
    if (h.holder !== HANDOVER.from) throw new Error(`${HANDOVER.purse} is held by ${h.holder}, not ${HANDOVER.from}`);
    if (h.price !== null || h.approvals > 0) throw new Error(`${HANDOVER.purse} is listed or approved: unlist it first`);
    await step(`${HANDOVER.from} hands ${HANDOVER.purse} (living slide ${HANDOVER.token}) to the bench`, HANDOVER.from, HANDOVER.purse, [call("nft_transfer", { receiver_id: BENCH, token_id: HANDOVER.token, memo: "to the team bench: no house account holds a fed colony" }, T.handover, 1n)], { deposit: 1n, tgas: T.handover });
  }
}

await status();
console.log(`\nspent ${near(spent)} NEAR and moved ${near(moved)} NEAR in ${rows.length} transactions`);
console.log("\n| Step | Signer | Transaction | NEAR spent |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.what} | ${r.signer.length > 30 ? r.signer.slice(0, 8) + "…" : r.signer} | \`${r.hash}\` | ${r.near}${r.moved ? ` (moved ${r.moved})` : ""} |`);
