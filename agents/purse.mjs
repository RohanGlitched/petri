// Living slides for the house strains: seal a slide into its own keyless account (a purse), wake the purse as a colony,
// let it plant its own slide's pattern, collect what it earns, and move or sell it.
//
//   node purse.mjs status <token>                    everything about slide <token>'s purse, keys included
//   node purse.mjs seal <holder> <token>             prepay the factory and send it the slide (nft_transfer_call)
//   node purse.mjs wake <token> [near]               the holder has the purse join the dish (default 0.02 NEAR)
//   node purse.mjs plant <token>                     the holder has the purse plant its slide's pattern under licence
//   node purse.mjs replant <token>                   as the run loop does it: advance, claim/buy if short, plant (capped)
//   node purse.mjs claim <token>                     the purse claims its feed and tides
//   node purse.mjs transfer <token> <to>             nft_transfer of the purse's own token
//   node purse.mjs withdraw <token> [yocto]          NEAR to the holder
//   node purse.mjs ft-withdraw <token> <units>       PETRI to the holder
//   node purse.mjs list <token> <yocto> | unlist <token>
//   node purse.mjs payout <token> [yocto]            how a sale splits now (v2 purses: 5% to the slide's minter)
//   node purse.mjs buy <token> <buyer> [nonce]       buy at the listed price, pinned to the nonce
//   node purse.mjs license <token> <planter>         another colony plants the slide's pattern under licence: its
//                                                    royalty is paid into the purse
//   node purse.mjs as <account> <cmd> ...            run withdraw/ft-withdraw/act as another account (to show a refusal)
//
// The run loop calls `tendPurses` for the team bench accounts when PETRI_LIVING_SLIDES=1. Every call here is signed by
// the slide's holder with its own key; a holder whose key may only call the dish (a function-call key) cannot drive a
// purse, and a holder whose key is not on this machine is skipped with a note.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { actions } from "near-api-js";
import { account, callDish, CALL_TGAS, CONTRACT, failureText, liveDish, log, NETWORK, rpc, tokensBurnt, view } from "./lib.mjs";
import { replant } from "./tend.mjs";

export { actions };

// The accounts purses live under, newest first. The first is the keyless v2 factory `slides.<dish>` (its purses pay
// the slide's minter 5% of every sale), which `seal` goes through. The others made the v1 purses: petri-slides.testnet
// (a factory with a key) and, on mainnet, petri-dish.near itself, which made living slide 14 by hand
// (scripts/purse-mainnet.mjs). PETRI_SLIDES_PARENTS overrides the list (comma-separated).
export const PARENTS = (process.env.PETRI_SLIDES_PARENTS ?? (NETWORK === "mainnet" ? "slides.petri-dish.near,petri-dish.near" : "slides.petri-v6.testnet,petri-slides.testnet")).split(",").map((s) => s.trim()).filter(Boolean);
export const FACTORY = process.env.PETRI_SLIDES_FACTORY ?? PARENTS[0];
const YOCTO = 10n ** 24n;
const TGAS = 10n ** 12n;
// A purse's calls to the dish run within this: 150 TGas holds back 0.15 NEAR of the holder's while it runs.
const ACT_TGAS = 150n;

/** The account slide `token`'s purse lives at under `parent` (the v2 factory by default). */
export const purseOf = (token, parent = FACTORY) => `slide-${token}.${parent}`;

/** Whether `owner` (the slide's owner on the dish) is the slide's own purse, under any of this network's parents. */
export const isPurseOf = (token, owner) => PARENTS.some((p) => owner === purseOf(token, p));

/** Slide `token`'s purse: the parent account it was sealed under, read from the dish (the v2 factory if not sealed). */
export async function purseFor(token) {
  const slide = await view("slide", { token_id: String(token) });
  return slide && isPurseOf(token, slide.owner_id) ? slide.owner_id : purseOf(token);
}

export async function viewAt(contract, method, args = {}) {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

/** The account's access keys: a living slide's list is empty, and has been since the receipt that created it. */
export async function accessKeys(accountId) {
  const r = await rpc("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: accountId });
  return r.keys ?? [];
}

/** Sign one call from `signer` to `receiver`; returns { hash, value, failed } and never throws on a contract refusal. */
export async function send(signer, receiver, method, args, deposit = 0n, tgas = 300n) {
  const res = await account(signer).signAndSendTransaction({
    receiverId: receiver,
    actions: [actions.functionCall(method, args, tgas * TGAS, BigInt(deposit))],
    waitUntil: "FINAL",
    throwOnFailure: false,
  });
  const outcomes = [res.status, ...(res.receipts_outcome ?? []).map((r) => r.outcome.status)];
  const fail = outcomes.map((s) => s?.Failure).find(Boolean);
  let value = null;
  for (const st of outcomes) {
    if (!st?.SuccessValue) continue;
    try {
      value = JSON.parse(Buffer.from(st.SuccessValue, "base64").toString("utf8"));
    } catch {
      /* not JSON */
    }
  }
  const logs = (res.receipts_outcome ?? []).flatMap((r) => r.outcome.logs);
  return { hash: res.transaction.hash, value, failed: fail ? failureText(fail) : null, logs, burnt: tokensBurnt(res) };
}

/** Prepay the factory if needed, then send it the slide: it creates the purse and moves the slide in. */
export async function seal(holder, token) {
  const [cost, credit] = await Promise.all([viewAt(FACTORY, "create_cost"), viewAt(FACTORY, "credit_of", { account_id: holder })]);
  const steps = [];
  if (BigInt(credit) < BigInt(cost)) {
    const pay = BigInt(cost) - BigInt(credit);
    steps.push({ step: "prepay", ...(await send(holder, FACTORY, "prepay", {}, pay < YOCTO / 100n ? YOCTO / 100n : pay, 30n)) });
  }
  steps.push({ step: "seal", ...(await send(holder, CONTRACT, "nft_transfer_call", { receiver_id: FACTORY, token_id: String(token), msg: "" }, 1n, 300n)) });
  return steps;
}

/** Have the purse call the dish (one of its whitelisted calls), as its holder. */
export async function act(holder, token, method, args = {}, deposit = 0n, tgas = ACT_TGAS) {
  return send(holder, await purseFor(token), "act", { method, args }, deposit, tgas);
}

export async function status(token) {
  const purse = await purseFor(token);
  const [info, history, keys, colony, petri, claimable, slide] = await Promise.all([
    viewAt(purse, "purse"),
    viewAt(purse, "history"),
    accessKeys(purse),
    view("colony_of", { account_id: purse }),
    view("ft_balance_of", { account_id: purse }),
    view("claimable", { account_id: purse }),
    view("slide", { token_id: String(token) }),
  ]);
  return { purse, keys: keys.length, slideOwner: slide?.owner_id, sealed: slide?.owner_id === purse, info, history, colony, petri, claimable };
}

/** Where the slide's pattern can go on the live dish for the purse's colony, as flat cell indices, or null. */
function placeSlide(world, colonyId, slide, tries = 200) {
  const { width: w, height: h, buffer, max_plant_cells: maxCells } = world.rules;
  const bits = Buffer.from(slide.bitmap, "base64");
  const shape = [];
  for (let i = 0; i < slide.w * slide.h; i++) if ((bits[i >> 3] >> (i & 7)) & 1) shape.push([i % slide.w, Math.floor(i / slide.w)]);
  if (shape.length !== slide.cells || shape.length > maxCells) return null;
  for (let t = 0; t < tries; t++) {
    const x0 = Math.floor(Math.random() * w), y0 = Math.floor(Math.random() * h);
    const cells = shape.map(([dx, dy]) => ((y0 + dy) % h) * w + ((x0 + dx) % w));
    if (world.engine.check_plant(colonyId, new Uint32Array(cells), buffer, maxCells) === "") return cells;
  }
  return null;
}

/** The purse's colony plants its own slide's pattern, under the licence it holds (no royalty, the licence discount). */
export async function plantSlide(holder, token, { pay = "attach" } = {}) {
  const purse = await purseFor(token);
  const [colony, slide] = await Promise.all([view("colony_of", { account_id: purse }), view("slide", { token_id: String(token) })]);
  if (!colony) throw new Error("the purse has not joined the dish: wake it first");
  const world = await liveDish();
  try {
    const cells = placeSlide(world, colony.id, slide);
    if (!cells) throw new Error("no legal spot for the slide's pattern right now");
    const note = `Living slide ${token} plants its own specimen.`;
    const deposit = BigInt(await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: String(token) }));
    const args = { cells, note, slide: String(token) };
    if (pay === "credit") return await act(holder, token, "plant", { ...args, credit: deposit.toString() }, 0n);
    return await act(holder, token, "plant", args, deposit);
  } finally {
    world.engine.free();
  }
}

const lastTend = new Map();
const TEND_EVERY_MS = Number(process.env.PETRI_PURSE_EVERY_MIN ?? "30") * 60_000;
// The most NEAR a holder spends on one purse in any 24 hours: deposits it attaches and the gas its calls burn.
const DAY_CAP = BigInt(Math.round(Number(process.env.PETRI_PURSE_DAY_NEAR ?? "0.03") * 1e6)) * 10n ** 18n;

const noKey = new Set();

// Each purse's tending record (failures in a row, when it may be tried again, what was spent today), kept across
// restarts beside the runner's log.
const TEND_FILE = path.join(process.env.PETRI_LOG_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "log"), `purse-tend-${NETWORK}.json`);
let tending = null;
function tendRecord(token) {
  if (!tending) {
    try {
      tending = JSON.parse(fs.readFileSync(TEND_FILE, "utf8"));
    } catch {
      tending = {};
    }
  }
  return (tending[token] ??= { failures: 0, nextAt: 0, spend: [] });
}
function saveTending() {
  try {
    fs.mkdirSync(path.dirname(TEND_FILE), { recursive: true });
    fs.writeFileSync(TEND_FILE, JSON.stringify(tending, null, 1));
  } catch {
    /* the record still holds for this run */
  }
}

/** The chain calls replant() makes for holder `holder` and slide `token`. */
function tendDeps(holder, token, name) {
  return {
    view,
    advance: () => callDish(holder, "advance", {}, CALL_TGAS),
    act: (method, args, deposit) => act(holder, token, method, args, deposit),
    place: async (colonyId, slide) => {
      const world = await liveDish();
      try {
        return placeSlide(world, colonyId, slide);
      } finally {
        world.engine.free();
      }
    },
    log: (...a) => log(name, ...a),
  };
}

/**
 * For the run loop: each account given (the team bench) that holds a living slide keeps it alive. When the purse's
 * colony has no living cells it replants the slide's pattern (tend.mjs: advance the dish if it is too far behind,
 * claim and buy PETRI if the purse is short, within a daily NEAR cap per purse, backing off after a failure); when it
 * has NEAR from the tides waiting, it claims. One pass per holder per PETRI_PURSE_EVERY_MIN minutes at most. A holder
 * whose key is not on this machine is skipped.
 */
export async function tendPurses(holders) {
  for (const s of holders) {
    if (Date.now() - (lastTend.get(s.account) ?? 0) < TEND_EVERY_MS) continue;
    lastTend.set(s.account, Date.now());
    try {
      account(s.account);
    } catch {
      if (!noKey.has(s.account)) log(s.name, "living slides: no key for", s.account, "on this machine; not tending its purses");
      noKey.add(s.account);
      continue;
    }
    let held = [];
    try {
      // Purses this holder holds: slides are few, so read every slide and keep those its own purse owns.
      const slides = await view("slides", { from: 0, limit: 500 });
      for (const sl of slides) {
        if (!isPurseOf(sl.token_id, sl.owner_id)) continue;
        const info = await viewAt(sl.owner_id, "purse").catch(() => null);
        if (info?.holder === s.account && info.price === null && info.approvals === 0) held.push(sl.token_id);
      }
    } catch (e) {
      log(s.name, "living slides: could not read", e instanceof Error ? e.message : e);
      continue;
    }
    for (const token of held) {
      try {
        const st = await status(token);
        if (!st.colony) continue;
        const world = await liveDish();
        const alive = world.engine.live_counts()[st.colony.id] ?? 0;
        const due = world.due;
        world.engine.free();
        if (alive === 0 && (st.colony.last_plant_generation === null || Number(st.colony.last_plant_generation) < due)) {
          // The holder attaches the planting's NEAR: the purse has no sponsored credit of its own.
          await replant(token, tendRecord(token), tendDeps(s.account, token, s.name), { purse: st.purse, everyMs: TEND_EVERY_MS, capYocto: DAY_CAP });
          saveTending();
        } else if (BigInt(st.claimable.near) > 0n) {
          const r = await act(s.account, token, "claim", {}, 0n);
          log(s.name, `living slide ${token} claimed its tides`, r.failed ?? "", r.hash);
        }
      } catch (e) {
        log(s.name, `living slide ${token}:`, e instanceof Error ? e.message : e);
      }
    }
  }
}

async function holderOf(token) {
  return (await viewAt(await purseFor(token), "purse")).holder;
}

async function main() {
  let [cmd, ...rest] = process.argv.slice(2);
  let as = null;
  if (cmd === "as") {
    as = rest.shift();
    cmd = rest.shift();
  }
  const out = (x) => console.log(JSON.stringify(x, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
  const token = rest[0];
  const who = async () => as ?? (await holderOf(token));
  const purse = token && /^[1-9]\d*$/.test(token) ? await purseFor(token) : null;
  switch (cmd) {
    case "status":
      return out(await status(token));
    case "seal":
      return out(await seal(rest[0], rest[1]));
    case "wake": {
      const near = rest[1] ? BigInt(Math.round(Number(rest[1]) * 1e6)) * 10n ** 18n : (YOCTO * 2n) / 100n;
      const slide = await view("slide", { token_id: String(token) });
      return out(await act(await who(), token, "join", { name: `Living slide ${token}`, color: slide.color }, near));
    }
    case "plant":
      return out(await plantSlide(await who(), token));
    case "replant": {
      // What the run loop does for a purse with no living cells: advance, claim/buy if short, plant, within the cap.
      const holder = await who();
      const r = await replant(token, tendRecord(token), tendDeps(holder, token, holder.slice(0, 12)), { purse, everyMs: TEND_EVERY_MS, capYocto: DAY_CAP });
      saveTending();
      return out(r);
    }
    case "claim":
      return out(await act(await who(), token, "claim", {}, 0n));
    case "transfer":
      return out(await send(await who(), purse, "nft_transfer", { receiver_id: rest[1], token_id: String(token) }, 1n, 30n));
    case "withdraw":
      return out(await send(await who(), purse, "withdraw", rest[1] ? { amount: rest[1] } : {}, 1n, 60n));
    case "ft-withdraw":
      return out(await send(await who(), purse, "ft_withdraw", { amount: rest[1] }, 1n, 80n));
    case "list":
      return out(await send(await who(), purse, "list", { price: rest[1] }, 1n, 30n));
    case "unlist":
      return out(await send(await who(), purse, "unlist", {}, 1n, 30n));
    case "payout":
      return out(await viewAt(purse, "nft_payout", { token_id: String(token), balance: rest[1] ?? "10000", max_len_payout: 2 }));
    case "buy": {
      const info = await viewAt(purse, "purse");
      const nonce = rest[2] !== undefined ? Number(rest[2]) : info.nonce;
      return out(await send(rest[1], purse, "buy", { nonce }, BigInt(info.price ?? 0), 60n));
    }
    case "license": {
      const planter = rest[1];
      const [colony, slide] = await Promise.all([view("colony_of", { account_id: planter }), view("slide", { token_id: String(token) })]);
      const world = await liveDish();
      const cells = placeSlide(world, colony.id, slide);
      world.engine.free();
      if (!cells) throw new Error("no legal spot right now");
      const note = `Planted living slide ${token}'s pattern under its licence.`;
      const deposit = BigInt(await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: String(token) }));
      return out(await send(planter, CONTRACT, "plant", { cells, note, slide: String(token) }, deposit, 300n));
    }
    case "act":
      return out(await act(await who(), token, rest[1], JSON.parse(rest[2] ?? "{}"), BigInt(rest[3] ?? 0)));
    default:
      console.log("usage: see the top of purse.mjs");
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("purse.mjs")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
