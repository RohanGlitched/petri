// One mainnet living slide, without a factory: petri-dish.near creates slide-<id>.petri-dish.near in one transaction
// (create the account, fund its storage, deploy the purse, init it with the holder; no key is ever added), the holder
// sends the slide in, and the purse joins the dish and plants the slide's own pattern with NEAR the holder attaches.
//
//   PETRI_NETWORK=mainnet PETRI_KEYS_DIR=<keychain>/mainnet node scripts/purse-mainnet.mjs plan
//   PETRI_NETWORK=mainnet PETRI_KEYS_DIR=<keychain>/mainnet node scripts/purse-mainnet.mjs send
//
// `plan` reads only. `send` signs, one step at a time, skipping steps already done, and stops before any step that
// would take the NEAR spent past BUDGET or leave a funding strain under KEEP. It prints every transaction with the NEAR
// it cost (deposits plus gas burnt), the purse's access keys, and petri-dish.near's key nonces afterwards.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { account, Engine, failureText, NETWORK, rpc, view } from "../agents/lib.mjs";
import { actions } from "../agents/purse.mjs";

const YOCTO = 10n ** 24n;
const MILLI = YOCTO / 1000n;
const TGAS = 10n ** 12n;
const near = (y) => (Number(y / 10n ** 18n) / 1e6).toFixed(6);

const DISH = "petri-dish.near";
const TOKEN = process.env.SLIDE ?? "14";
const HOLDER = process.env.HOLDER ?? "congo.petri-dish.near";
const PURSE = `slide-${TOKEN}.${DISH}`;
const BUDGET = 400n * MILLI;
const KEEP = 300n * MILLI;
const JOIN = 15n * MILLI;
// What funds the creation: NEAR moved from strains into petri-dish.near, never the dish's own.
const FUNDERS = [
  ["methylene.petri-dish.near", 160n * MILLI],
  ["safranin.petri-dish.near", 130n * MILLI],
  ["violet.petri-dish.near", 30n * MILLI],
];
const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, "../purse/res/petri_purse.wasm"));
// What the factory charges for the same purse: its code and 2,200 bytes for its record, state and headroom.
const STORAGE = (BigInt(CODE.length) + 2200n) * 10n ** 19n;

if (NETWORK !== "mainnet") throw new Error("set PETRI_NETWORK=mainnet");

async function balance(a) {
  try {
    return BigInt((await rpc("query", { request_type: "view_account", finality: "final", account_id: a })).amount);
  } catch {
    return null;
  }
}
async function keys(a) {
  return (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: a })).keys;
}

/** The slide's pattern alone on an empty dish for 1,000 generations: does it keep living? */
async function lives(slide) {
  const rules = await view("rules");
  const bits = Buffer.from(slide.bitmap, "base64");
  const cells = [];
  for (let i = 0; i < slide.w * slide.h; i++) if ((bits[i >> 3] >> (i & 7)) & 1) cells.push((60 + Math.floor(i / slide.w)) * rules.width + 60 + (i % slide.w));
  const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
  e.set_colonies(1);
  e.plant(1, new Uint32Array(cells));
  const at = [];
  for (let t = 1; t <= 1000; t++) {
    e.step(1);
    if (t % 250 === 0) at.push(e.live_counts()[1] ?? 0);
  }
  e.free();
  return at;
}

const rows = [];
let spent = 0n;

/** `counts`: whether the deposit is spent (false for NEAR moved between the project's own accounts). */
async function step(what, signer, receiver, acts, deposit, counts = true) {
  const before = await balance(signer);
  if (before === null) throw new Error(`${signer} not found`);
  const guess = deposit + 5n * MILLI;
  if (spent + (counts ? guess : 5n * MILLI) > BUDGET) throw new Error(`stopping before "${what}": it would take the spend past ${near(BUDGET)} NEAR`);
  if ((signer === HOLDER || FUNDERS.some(([a]) => a === signer)) && before - guess < KEEP) throw new Error(`stopping before "${what}": ${signer} would fall under ${near(KEEP)} NEAR`);
  const res = await account(signer).signAndSendTransaction({ receiverId: receiver, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const burnt = [res.transaction_outcome, ...res.receipts_outcome].reduce((n, o) => n + BigInt(o.outcome.tokens_burnt), 0n);
  const fail = [res.status, ...res.receipts_outcome.map((r) => r.outcome.status)].map((s) => s?.Failure).find(Boolean);
  // NEAR spent: the gas burnt, and the deposit unless it failed (refunded) or only moved NEAR between our accounts.
  const cost = (fail || !counts ? 0n : deposit) + burnt;
  spent += cost;
  rows.push({ what, signer, hash: res.transaction.hash, near: near(cost), failed: fail ? failureText(fail) : null });
  console.log(`${fail ? "FAIL" : "ok  "} ${what}\n     ${signer} ${res.transaction.hash} ${near(cost)} NEAR${fail ? ` refused: ${failureText(fail)}` : ""}`);
  if (fail) throw new Error(`"${what}" failed`);
  return res;
}

const cmd = process.argv[2] ?? "plan";
const slide = await view("slide", { token_id: TOKEN });
if (!slide) throw new Error(`no slide ${TOKEN}`);
const [rules, plantDeposit, purseNow] = await Promise.all([view("rules"), view("plant_deposit", { cells: slide.cells, note_bytes: 45, slide: TOKEN }), balance(PURSE)]);
const survival = await lives(slide);
console.log(`slide ${TOKEN}: ${slide.name}, ${slide.cells} cells, held by ${slide.owner_id}; alone on an empty dish it has ${survival.join(" / ")} cells after 250 / 500 / 750 / 1,000 generations`);
console.log(`purse ${PURSE}: ${purseNow === null ? "not created yet" : `exists, ${near(purseNow)} NEAR`}`);
console.log(`storage ${near(STORAGE)} NEAR (code ${CODE.length} bytes), join ${near(JOIN)}, plant deposit ${near(BigInt(plantDeposit))}; budget ${near(BUDGET)}`);
for (const a of [DISH, HOLDER, ...FUNDERS.map(([a]) => a)]) console.log(`  ${a}: ${near((await balance(a)) ?? 0n)} NEAR`);
if (slide.owner_id !== HOLDER && slide.owner_id !== PURSE) throw new Error(`slide ${TOKEN} is held by ${slide.owner_id}, not ${HOLDER}`);
if (cmd !== "send") {
  console.log("plan only: nothing signed. Run with `send` to sign.");
  process.exit(0);
}

// 1. Strains move the creation's NEAR into petri-dish.near (it pays the account's storage and the transaction's gas).
if (purseNow === null) {
  if (process.env.SKIP_FUNDING !== "1") for (const [from, amount] of FUNDERS) await step(`${from} sends ${near(amount)} NEAR to ${DISH} for the purse's storage`, from, DISH, [actions.transfer(amount)], amount, false);
  // 2. One transaction, no AddKey: the account never has a key.
  await step(`${DISH} creates ${PURSE}: create, fund ${near(STORAGE)} NEAR, deploy the purse, init (holder ${HOLDER})`, DISH, PURSE, [
    actions.createAccount(),
    actions.transfer(STORAGE),
    actions.deployContract(CODE),
    actions.functionCall("init", { dish: DISH, holder: HOLDER }, 30n * TGAS, 0n),
  ], STORAGE);
}
// 3. The holder sends the slide in.
if ((await view("slide", { token_id: TOKEN })).owner_id !== PURSE) await step(`${HOLDER} sends slide ${TOKEN} into ${PURSE}`, HOLDER, DISH, [actions.functionCall("nft_transfer", { receiver_id: PURSE, token_id: TOKEN, memo: "sealed into its living slide" }, 30n * TGAS, 1n)], 1n);
// 4. The purse joins the dish, with NEAR the holder attaches.
let colony = await view("colony_of", { account_id: PURSE });
if (!colony) {
  await step(`the purse joins the dish (${near(JOIN)} NEAR from ${HOLDER})`, HOLDER, PURSE, [actions.functionCall("act", { method: "join", args: { name: `Living slide ${TOKEN}`, color: slide.color } }, 300n * TGAS, JOIN)], JOIN);
  colony = await view("colony_of", { account_id: PURSE });
}
// 5. It plants its slide's own pattern somewhere legal, under the licence it holds.
if (colony.last_plant_generation === null) {
  const { liveDish } = await import("../agents/lib.mjs");
  const world = await liveDish();
  const bits = Buffer.from(slide.bitmap, "base64");
  const shape = [];
  for (let i = 0; i < slide.w * slide.h; i++) if ((bits[i >> 3] >> (i & 7)) & 1) shape.push([i % slide.w, Math.floor(i / slide.w)]);
  let cells = null;
  for (let t = 0; t < 400 && !cells; t++) {
    const x0 = Math.floor(Math.random() * rules.width), y0 = Math.floor(Math.random() * rules.height);
    const c = shape.map(([dx, dy]) => ((y0 + dy) % rules.height) * rules.width + ((x0 + dx) % rules.width));
    if (world.engine.check_plant(colony.id, new Uint32Array(c), rules.buffer, rules.max_plant_cells) === "") cells = c;
  }
  world.engine.free();
  if (!cells) throw new Error("no legal spot for the pattern right now; run send again in a minute");
  const note = `Living slide ${TOKEN} plants its own specimen.`;
  const deposit = BigInt(await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: TOKEN }));
  await step(`the purse plants its slide's pattern (${cells.length} cells, ${near(deposit)} NEAR from ${HOLDER})`, HOLDER, PURSE, [actions.functionCall("act", { method: "plant", args: { cells, note, slide: TOKEN } }, 300n * TGAS, deposit)], deposit);
}

const purseKeys = await keys(PURSE);
const dishKeys = await keys(DISH);
console.log(`\nspent ${near(spent)} NEAR in ${rows.length} transactions`);
console.log(`${PURSE}: ${purseKeys.length} access keys`);
for (const k of dishKeys) console.log(`${DISH} key ${k.public_key} ${JSON.stringify(k.access_key.permission)} nonce ${k.access_key.nonce}`);
console.log("\n| Step | Signer | Transaction | NEAR |\n|---|---|---|---|");
for (const r of rows) console.log(`| ${r.what} | ${r.signer} | \`${r.hash}\` | ${r.near} |`);
