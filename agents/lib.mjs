// Shared plumbing for the keeper and the strains: chain reads, the WASM rules, and signed calls.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, actions } from "near-api-js";
import { pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// The engine package: the site's copy by default, or another build (PETRI_PKG_DIR) while a new one is staged.
const PKG = process.env.PETRI_PKG_DIR ?? path.join(here, "../web/src/engine/pkg");
const { initSync, Engine, pattern_cells, quote } = await import(pathToFileURL(path.join(PKG, "petri.js")).href);
initSync({ module: fs.readFileSync(path.join(PKG, "petri_bg.wasm")) });

export { Engine, pattern_cells, quote };

export const CONTRACT = process.env.PETRI_CONTRACT ?? (process.env.PETRI_NETWORK === "mainnet" ? "petri-dish.near" : "petri-v5.testnet");
export const NETWORK = process.env.PETRI_NETWORK ?? "testnet";
export const RPCS =
  NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"]
    : ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org"];
const KEYS_DIR = process.env.PETRI_KEYS_DIR ?? path.join(process.env.HOME ?? "", ".near-credentials", NETWORK);

let rpcIndex = 0;
export async function rpc(method, params) {
  let last;
  for (let i = 0; i < RPCS.length; i++) {
    const url = RPCS[(rpcIndex + i) % RPCS.length];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "petri-agents", method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      if (body.error) throw new Error(JSON.stringify(body.error).slice(0, 300));
      rpcIndex = (rpcIndex + i) % RPCS.length;
      return body.result;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

export async function view(method, args = {}) {
  const r = await rpc("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

export async function nearBalance(accountId) {
  const r = await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
  return Number(BigInt(r.amount) / 10n ** 18n) / 1e6;
}

/** The dish as the contract stores it, stepped forward to the generation the clock says is due. */
export async function liveDish() {
  const [rules, state, colonies] = await Promise.all([view("rules"), view("state"), view("colonies", { from: 0, limit: 500 })]);
  const [b64, stakes] = await Promise.all([view("board"), view("stakes", { from: 0, limit: 2000 })]);
  const board = Buffer.from(b64, "base64");
  const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
  e.set_counted(state.counted);
  e.set_house(new Uint16Array(state.house));
  e.set_colonies(colonies.length);
  e.set_stakes(new BigUint64Array(stakes.map((v) => BigInt(v))));
  e.set_agar(state.agar);
  if (!e.load_compact(board, Number(state.generation), state.chain)) throw new Error("board did not load");
  const due = Math.floor((Number(state.now_ms) - Number(state.epoch_ms)) / Number(rules.generation_ms));
  if (due > e.generation()) e.step(due - e.generation());
  return { rules, state, colonies, engine: e, cells: e.cells(), due };
}

const accounts = new Map();
export function account(accountId, keysDir = KEYS_DIR) {
  const k = `${keysDir}|${accountId}`;
  if (!accounts.has(k)) {
    const file = path.join(keysDir, `${accountId}.json`);
    const { private_key } = JSON.parse(fs.readFileSync(file, "utf8"));
    const provider = new JsonRpcProvider({ url: RPCS[0] });
    accounts.set(k, new Account(accountId, provider, private_key));
  }
  return accounts.get(k);
}

/**
 * Where a key that can attach NEAR lives for `accountId`, or null. NEP-141 `ft_transfer` needs exactly 1 yoctoNEAR
 * attached, which a function-call key cannot do. On mainnet the strains sign with full-access keys; on testnet they
 * sign with dish-only function-call keys, so a transfer needs a full-access key from PETRI_KEYS_DIR_FULL (optional).
 */
export function transferKeysDir(accountId) {
  if (NETWORK === "mainnet") return KEYS_DIR;
  const dir = process.env.PETRI_KEYS_DIR_FULL;
  return dir && fs.existsSync(path.join(dir, `${accountId}.json`)) ? dir : null;
}

/** Sends `amount` PETRI units from `from` to `to` with NEP-141 ft_transfer and a memo. Returns { hash } or throws. */
export async function ftTransfer(from, to, amount, memo) {
  const dir = transferKeysDir(from);
  if (!dir) throw new Error("no key that can attach the 1 yoctoNEAR ft_transfer needs");
  const res = await account(from, dir).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall("ft_transfer", { receiver_id: to, amount: String(amount), memo }, 30n * 10n ** 12n, 1n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  if (fail) throw new Error(failureText(fail));
  return { hash: res.transaction.hash };
}

export function failureText(f) {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 200);
}

/**
 * Call the dish as `accountId`. The strains and the keeper sign with function-call keys that may only call the dish and
 * cannot attach NEAR, so whatever a call needs (`deposit` yoctoNEAR) is paid from the account's sponsored credit in
 * the dish instead. The bench colonies (`attach`) attach their own NEAR, like a wallet player. Returns { hash } or
 * throws with the contract's own words.
 */
export async function callDish(accountId, methodName, args, tgas = 150, deposit = 0n, attach = false) {
  const a = account(accountId);
  if (BigInt(deposit) > 0n && !attach) {
    args = { ...args, credit: BigInt(deposit).toString() };
    deposit = 0n;
  }
  const res = await a.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, BigInt(deposit))],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  if (fail) throw new Error(failureText(fail));
  return { hash: res.transaction.hash };
}

export function log(...a) {
  console.log(new Date().toISOString().slice(0, 19), ...a);
}
