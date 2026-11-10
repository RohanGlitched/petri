// Free play on mainnet: the relayer that pays for guests' accounts, credit and gas, kept apart from every team account.
//
// The relayer is an implicit account (64 hex) whose key sits in the lead's near-cli keychain. It is funded ONCE from
// the funder (keeper.petri-dish.near on mainnet, petri-guests.testnet for the testnet rehearsal) and never draws on
// anything else, so the most free play can ever cost is what this script sends it. The site (web/src/app/api/guest,
// web/src/app/api/relay) then refuses to make a guest unless the relayer keeps its floor plus one guest's reserve, and
// refuses to relay below the floor (see web/src/lib/guest-program.ts).
//
//   node scripts/mainnet-guests-setup.mjs plan    [--network mainnet|testnet] [--keys <dir>] [--relayer <hex>] [--fund <NEAR>]
//   node scripts/mainnet-guests-setup.mjs send    [same]   the funder sends the relayer up to --fund NEAR (default 3.1)
//   node scripts/mainnet-guests-setup.mjs status  [same]   balances, guests made (from the dish's own ledger), places left
//   node scripts/mainnet-guests-setup.mjs probe   [same] [--send]   views only; with --send the relayer makes one test
//                                                    guest the site's way (create by transfer, sponsor 0.01 NEAR) and
//                                                    reads it back. About 0.0175 NEAR (0.007 of it the protocol's account-creation charge); it counts as one of the 40.
//   node scripts/mainnet-guests-setup.mjs reclaim [same] [--send]   credit the relayer gave that guests left unused for
//                                                    a day; with --send, take it back (unsponsor) into the relayer
//   node scripts/mainnet-guests-setup.mjs return  [same] [--send]   after the window: send what the relayer holds back
//                                                    to the funder (keeps 0.001 NEAR)
//
// --keys is a near-cli keychain for the network (default ~/.near-credentials/<network>); from Windows, point it at
// //wsl$/Ubuntu/home/<user>/.near-credentials/<network>. Keys are read from <keys>/<account>.json or
// <keys>/<account>/*.json and are never printed. Nothing signs without `send` or `--send`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);
const VALUED = new Set(["--network", "--keys", "--relayer", "--fund", "--dish", "--funder"]);
const cmd = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && VALUED.has(argv[i - 1]))) ?? "plan";
const NET = flag("network", "mainnet");
if (!["mainnet", "testnet"].includes(NET)) throw new Error("--network is mainnet or testnet");
const KEYS = flag("keys", path.join(os.homedir(), ".near-credentials", NET));

// near-api-js as the agents install it, loaded as ESM so any Node from 18 on works.
const nearPath = createRequire(new URL("../agents/package.json", import.meta.url)).resolve("near-api-js").replace(/index\.cjs$/, "index.js");
const { Account, JsonRpcProvider, KeyPair, actions } = await import(pathToFileURL(nearPath).href);

const YOCTO = 10n ** 24n;
const MILLI = YOCTO / 1000n;
const TGAS = 10n ** 12n;
const near = (y) => {
  const v = BigInt(y);
  const sign = v < 0n ? "-" : "";
  const a = v < 0n ? -v : v;
  return `${sign}${a / YOCTO}.${String((a % YOCTO) / 10n ** 18n).padStart(6, "0")}`;
};
const toYocto = (s) => {
  const [w, f = ""] = String(s).split(".");
  return BigInt(w || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24));
};

const CONFIG = {
  mainnet: {
    rpcs: ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"],
    dish: "petri-dish.near",
    funder: "keeper.petri-dish.near",
    relayer: "1cd2d1336aa1789336ff659ace0e4a4d92fd3382381a0074f1b113696fbe8a7b",
    // The keeper keeps paying the dish's own gas after this; never leave it under this much.
    funderKeep: 2000n * MILLI,
    explorer: "https://nearblocks.io",
  },
  testnet: {
    rpcs: ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"],
    dish: "petri-v6.testnet",
    funder: "petri-guests.testnet",
    relayer: "f48c550e3471af011ad6de7ac3f21fd17d9f66b0ff33f7c488745bf544c0ae88",
    // petri-guests.testnet is also the live testnet free-play relayer.
    funderKeep: 2500n * MILLI,
    explorer: "https://testnet.nearblocks.io",
  },
}[NET];
const DISH = flag("dish", CONFIG.dish);
const FUNDER = flag("funder", CONFIG.funder);
const RELAYER = flag("relayer", CONFIG.relayer);
/** The most this script ever sends the relayer in all (the free-play budget). */
const FUND = toYocto(flag("fund", "3.1"));
const FUND_MAX = 3100n * MILLI;
if (FUND > FUND_MAX) throw new Error("--fund is at most 3.1 NEAR: that is the whole free-play budget");
/** Kept in step with the site's defaults (web/src/lib/guest-program.ts); the lead's env may differ. */
const FLOOR = toYocto(process.env.PETRI_MAINNET_RELAYER_FLOOR ?? "0.3");
const RESERVE = toYocto(process.env.PETRI_MAINNET_GUEST_RESERVE ?? "0.07");
const CAP = Number(process.env.PETRI_MAINNET_GUESTS_CAP ?? "40");
// The site sends a new guest one yoctoNEAR (lib/implicit-guests.ts): zero-balance accounts need nothing for storage.
const DUST = 1n;
const PROBE_CREDIT = 10n * MILLI;
const RECLAIM_AFTER = 5760n;

let rpcAt = 0;
async function rpc(method, params) {
  let last;
  for (let i = 0; i < CONFIG.rpcs.length * 2; i++) {
    const url = CONFIG.rpcs[(rpcAt + i) % CONFIG.rpcs.length];
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "setup", method, params }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      const body = await res.json();
      if (body.error) {
        const msg = JSON.stringify(body.error);
        if (/UNKNOWN_ACCOUNT|does not exist|UNKNOWN_ACCESS_KEY/.test(msg)) return null;
        throw new Error(msg);
      }
      rpcAt = (rpcAt + i) % CONFIG.rpcs.length;
      return body.result;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw last;
}
const view = async (method, args = {}) => {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: DISH, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
};
const accountOf = (id) => rpc("query", { request_type: "view_account", finality: "final", account_id: id });
async function balance(id) {
  const a = await accountOf(id);
  return a ? { amount: BigInt(a.amount), locked: BigInt(a.locked), storage: BigInt(a.storage_usage) } : null;
}

function keyFile(accountId) {
  const files = [];
  const dir = path.join(KEYS, accountId);
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) files.push(path.join(dir, f));
  if (fs.existsSync(path.join(KEYS, `${accountId}.json`))) files.push(path.join(KEYS, `${accountId}.json`));
  return files;
}
async function signer(accountId) {
  const keys = (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: accountId }))?.keys ?? [];
  const onChain = new Set(keys.filter((k) => k.access_key.permission === "FullAccess").map((k) => k.public_key));
  for (const f of keyFile(accountId)) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    const sk = j.private_key ?? j.secret_key;
    if (!sk) continue;
    const pub = KeyPair.fromString(sk).getPublicKey().toString();
    // An implicit account that does not exist yet has no keys on chain; its own key is the one its name encodes.
    const implicitOwn = /^[0-9a-f]{64}$/.test(accountId) && Buffer.from(KeyPair.fromString(sk).getPublicKey().data).toString("hex") === accountId;
    if (onChain.has(pub) || (onChain.size === 0 && implicitOwn)) return new Account(accountId, new JsonRpcProvider({ url: CONFIG.rpcs[0] }), sk);
  }
  throw new Error(`no full-access key for ${accountId} in ${KEYS}`);
}

/** Guests this relayer has sponsored, from the dish's own ledger (the same count the site shows). */
async function guestsMade() {
  const st = await view("state");
  const len = Number(st.ledger);
  const made = new Set();
  for (let from = 0; from < len; from += 1000) {
    for (const e of await view("ledger", { from, limit: 1000 })) if (e.Sponsor && e.Sponsor.sponsor === RELAYER) made.add(e.Sponsor.account);
  }
  return { made, state: st };
}

function line(label, value) {
  console.log(`  ${label.padEnd(34)} ${value}`);
}

async function status() {
  const [f, r] = await Promise.all([balance(FUNDER), balance(RELAYER)]);
  const { made, state } = await guestsMade();
  console.log(`${NET}: dish ${DISH}, funder ${FUNDER}, relayer ${RELAYER}`);
  line("funder balance", f ? `${near(f.amount)} NEAR` : "does not exist");
  line("relayer balance", r ? `${near(r.amount)} NEAR (${r.storage} bytes of storage)` : "does not exist yet");
  line("guests made (ledger Sponsor entries)", String(made.size));
  const spendable = r ? r.amount - r.storage * 10n ** 19n : 0n;
  const byBudget = spendable > FLOOR ? Number((spendable - FLOOR) / RESERVE) : 0;
  line("places left", `${Math.max(0, Math.min(CAP - made.size, byBudget))} of ${CAP} (budget allows ${byBudget}, floor ${near(FLOOR)}, reserve ${near(RESERVE)} per guest)`);
  line("dish credit given (all sponsors)", `${near(state.credit_given)} NEAR`);
  return { f, r, made };
}

async function send(from, receiverId, acts, label) {
  const acct = await signer(from);
  const res = await acct.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
  const fail = [res.status, ...(res.receipts_outcome ?? []).map((o) => o.outcome.status)].find((s) => s && typeof s === "object" && "Failure" in s);
  console.log(`  ${fail ? "FAILED" : "ok"}: ${label}  ${CONFIG.explorer}/txns/${res.transaction.hash}${fail ? `\n    ${JSON.stringify(fail).slice(0, 300)}` : ""}`);
  if (fail) throw new Error(`${label} failed`);
  return res;
}

if (cmd === "plan" || cmd === "send") {
  const { f, r } = await status();
  if (!f) throw new Error(`${FUNDER} does not exist on ${NET}`);
  const have = r?.amount ?? 0n;
  const amount = FUND > have ? FUND - have : 0n;
  console.log(`\nFunding: bring the relayer to ${near(FUND)} NEAR, so send ${near(amount)} NEAR from ${FUNDER}.`);
  line("funder after", `${near(f.amount - amount)} NEAR (must stay over ${near(CONFIG.funderKeep)})`);
  if (amount === 0n) console.log("  The relayer already holds the budget. Nothing to send.");
  else if (f.amount - amount < CONFIG.funderKeep) throw new Error("that would leave the funder under its keep; send less with --fund");
  else if (cmd === "plan") console.log(`  Run again with \`send\` to sign it as ${FUNDER}.`);
  else await send(FUNDER, RELAYER, [actions.transfer(amount)], `${FUNDER} -> ${RELAYER} ${near(amount)} NEAR`);
  if (cmd === "send" && amount > 0n) await status();
  console.log(
    NET === "mainnet"
      ? `\nSite env (Vercel, production): PETRI_MAINNET_GUESTS=1, PETRI_MAINNET_RELAYER_ACCOUNT=${RELAYER}, PETRI_MAINNET_RELAYER_KEY=<private_key in ${RELAYER}.json>`
      : `\nRehearsal env (a local server only): PETRI_TESTNET_GUESTS=implicit, PETRI_TESTNET_RELAYER_ACCOUNT=${RELAYER}, PETRI_TESTNET_RELAYER_KEY=<private_key in ${RELAYER}.json>`,
  );
} else if (cmd === "status") {
  await status();
} else if (cmd === "probe") {
  await status();
  // The views free play needs, and that `sponsor` exists and refuses too little (a free read of the method's guard is
  // not possible on NEAR, so --send pays for one real guest).
  const rules = await view("rules");
  line("credit_grants(relayer) view", JSON.stringify(await view("credit_grants", { account_id: RELAYER })));
  line("rules.min_join", `${near(rules.min_join ?? "0")} NEAR`);
  const kp = KeyPair.fromRandom("ed25519");
  const guest = Buffer.from(kp.getPublicKey().data).toString("hex");
  line("probe guest (fresh implicit)", guest);
  if (!has("send")) {
    console.log("  Views only. With --send the relayer makes this guest the site's way and sponsors it 0.01 NEAR.");
  } else {
    const before = (await balance(RELAYER)).amount;
    await send(RELAYER, guest, [actions.transfer(DUST)], `create ${guest.slice(0, 12)}… with ${near(DUST)} NEAR`);
    await send(RELAYER, DISH, [actions.functionCall("sponsor", { account_id: guest }, 30n * TGAS, PROBE_CREDIT)], `sponsor ${guest.slice(0, 12)}… ${near(PROBE_CREDIT)} NEAR`);
    const g = await accountOf(guest);
    line("guest account", g ? `${near(g.amount)} NEAR, ${g.storage_usage} bytes` : "missing");
    line("guest grants", JSON.stringify(await view("credit_grants", { account_id: guest })));
    line("relayer spent", `${near(before - (await balance(RELAYER)).amount)} NEAR`);
  }
} else if (cmd === "reclaim") {
  const { made, state } = await guestsMade();
  const clock = BigInt(state.due_generation) + BigInt(state.skipped);
  let total = 0n;
  const due = [];
  for (const g of made) {
    const grant = (await view("credit_grants", { account_id: g })).find((x) => x.sponsor === RELAYER);
    if (!grant) continue;
    const ready = clock >= BigInt(grant.at) + RECLAIM_AFTER;
    line(g.slice(0, 16) + "…", `${near(grant.amount)} NEAR unspent${ready ? ", reclaimable" : `, reclaimable in ${BigInt(grant.at) + RECLAIM_AFTER - clock} generations`}`);
    if (ready) {
      due.push(g);
      total += BigInt(grant.amount);
    }
  }
  console.log(`  ${due.length} grants, ${near(total)} NEAR, can come back to the relayer now.`);
  if (has("send")) for (const g of due) await send(RELAYER, DISH, [actions.functionCall("unsponsor", { account_id: g }, 30n * TGAS, 0n)], `unsponsor ${g.slice(0, 12)}…`);
} else if (cmd === "return") {
  const r = await balance(RELAYER);
  if (!r) throw new Error("the relayer does not exist");
  const amount = r.amount - MILLI - 1n * MILLI; // keep 0.001 and the transfer's own gas
  line("relayer holds", `${near(r.amount)} NEAR`);
  line(`back to ${FUNDER}`, `${near(amount)} NEAR`);
  if (amount <= 0n) console.log("  Nothing to return.");
  else if (has("send")) await send(RELAYER, FUNDER, [actions.transfer(amount)], `${RELAYER.slice(0, 12)}… -> ${FUNDER} ${near(amount)} NEAR`);
  else console.log("  Add --send to sign it as the relayer.");
} else {
  throw new Error(`unknown command ${cmd}`);
}
