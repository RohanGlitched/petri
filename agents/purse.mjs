// Living slides for the house strains: seal a slide into its own keyless account (a purse), wake the purse as a colony,
// let it plant its own slide's pattern, collect what it earns, and move or sell it.
//
//   node purse.mjs status <token>                    everything about slide <token>'s purse, keys included
//   node purse.mjs seal <holder> <token>             prepay the factory and send it the slide (nft_transfer_call)
//   node purse.mjs wake <token> [near]               the holder has the purse join the dish (default 0.02 NEAR)
//   node purse.mjs plant <token>                     the holder has the purse plant its slide's pattern under licence
//   node purse.mjs claim <token>                     the purse claims its feed and tides
//   node purse.mjs transfer <token> <to>             nft_transfer of the purse's own token
//   node purse.mjs withdraw <token> [yocto]          NEAR to the holder
//   node purse.mjs ft-withdraw <token> <units>       PETRI to the holder
//   node purse.mjs list <token> <yocto> | unlist <token>
//   node purse.mjs buy <token> <buyer> [nonce]       buy at the listed price, pinned to the nonce
//   node purse.mjs license <token> <planter>         another colony plants the slide's pattern under licence: its
//                                                    royalty is paid into the purse
//   node purse.mjs as <account> <cmd> ...            run withdraw/ft-withdraw/act as another account (to show a refusal)
//
// The run loop calls `tendPurses` for the house strains when PETRI_LIVING_SLIDES=1. Every call here is signed by the
// slide's holder with its own key; a holder whose key may only call the dish (a function-call key) cannot drive a
// purse, and is skipped with a note.

import { actions } from "near-api-js";
import { account, CONTRACT, failureText, liveDish, log, NETWORK, rpc, view } from "./lib.mjs";

export { actions };

export const FACTORY = process.env.PETRI_SLIDES_FACTORY ?? (NETWORK === "mainnet" ? "petri-slides.near" : "petri-slides.testnet");
const YOCTO = 10n ** 24n;
const TGAS = 10n ** 12n;

export const purseOf = (token) => `slide-${token}.${FACTORY}`;

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
  return { hash: res.transaction.hash, value, failed: fail ? failureText(fail) : null, logs };
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
export function act(holder, token, method, args = {}, deposit = 0n, tgas = 300n) {
  return send(holder, purseOf(token), "act", { method, args }, deposit, tgas);
}

export async function status(token) {
  const purse = purseOf(token);
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
  const purse = purseOf(token);
  const [colony, slide] = await Promise.all([view("colony_of", { account_id: purse }), view("slide", { token_id: String(token) })]);
  if (!colony) throw new Error("the purse has not joined the dish: wake it first");
  const world = await liveDish();
  try {
    const cells = placeSlide(world, colony.id, slide);
    if (!cells) throw new Error("no legal spot for the slide's pattern right now");
    const note = `Living slide ${token} plants its own specimen.`;
    const deposit = BigInt(await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: String(token) }));
    const args = { cells, note, slide: String(token) };
    if (pay === "credit") return await act(holder, token, "plant", { ...args, credit: deposit.toString() }, 0n, 300n);
    return await act(holder, token, "plant", args, deposit, 300n);
  } finally {
    world.engine.free();
  }
}

const lastTend = new Map();
const TEND_EVERY_MS = Number(process.env.PETRI_PURSE_EVERY_MIN ?? "30") * 60_000;

/**
 * For the run loop: each house strain that holds a living slide keeps it alive. When the purse's colony has no living
 * cells it replants the slide's pattern; when it has NEAR from the tides waiting, it claims. One call per strain per
 * PETRI_PURSE_EVERY_MIN minutes at most.
 */
export async function tendPurses(strains) {
  for (const s of strains) {
    if (Date.now() - (lastTend.get(s.account) ?? 0) < TEND_EVERY_MS) continue;
    lastTend.set(s.account, Date.now());
    let held = [];
    try {
      // Purses this strain holds: the house's slides are few, so read every purse the factory could have made.
      const slides = await view("slides", { from: 0, limit: 500 });
      for (const sl of slides) {
        if (sl.owner_id !== purseOf(sl.token_id)) continue;
        const info = await viewAt(purseOf(sl.token_id), "purse").catch(() => null);
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
          const r = await plantSlide(s.account, token);
          log(s.name, `living slide ${token} replanted its pattern`, r.failed ?? "", r.hash);
        } else if (BigInt(st.claimable.near) > 0n) {
          const r = await act(s.account, token, "claim", {}, 0n, 200n);
          log(s.name, `living slide ${token} claimed its tides`, r.failed ?? "", r.hash);
        }
      } catch (e) {
        log(s.name, `living slide ${token}:`, e instanceof Error ? e.message : e);
      }
    }
  }
}

async function holderOf(token) {
  return (await viewAt(purseOf(token), "purse")).holder;
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
  switch (cmd) {
    case "status":
      return out(await status(token));
    case "seal":
      return out(await seal(rest[0], rest[1]));
    case "wake": {
      const near = rest[1] ? BigInt(Math.round(Number(rest[1]) * 1e6)) * 10n ** 18n : (YOCTO * 2n) / 100n;
      const slide = await view("slide", { token_id: String(token) });
      return out(await act(await who(), token, "join", { name: `Living slide ${token}`, color: slide.color }, near, 300n));
    }
    case "plant":
      return out(await plantSlide(await who(), token));
    case "claim":
      return out(await act(await who(), token, "claim", {}, 0n, 300n));
    case "transfer":
      return out(await send(await who(), purseOf(token), "nft_transfer", { receiver_id: rest[1], token_id: String(token) }, 1n, 30n));
    case "withdraw":
      return out(await send(await who(), purseOf(token), "withdraw", rest[1] ? { amount: rest[1] } : {}, 1n, 60n));
    case "ft-withdraw":
      return out(await send(await who(), purseOf(token), "ft_withdraw", { amount: rest[1] }, 1n, 80n));
    case "list":
      return out(await send(await who(), purseOf(token), "list", { price: rest[1] }, 1n, 30n));
    case "unlist":
      return out(await send(await who(), purseOf(token), "unlist", {}, 1n, 30n));
    case "buy": {
      const info = await viewAt(purseOf(token), "purse");
      const nonce = rest[2] !== undefined ? Number(rest[2]) : info.nonce;
      return out(await send(rest[1], purseOf(token), "buy", { nonce }, BigInt(info.price ?? 0), 60n));
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
      return out(await act(await who(), token, rest[1], JSON.parse(rest[2] ?? "{}"), BigInt(rest[3] ?? 0), 300n));
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
