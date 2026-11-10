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

export const CONTRACT = process.env.PETRI_CONTRACT ?? (process.env.PETRI_NETWORK === "mainnet" ? "petri-dish.near" : "petri-v6.testnet");
export const NETWORK = process.env.PETRI_NETWORK ?? "testnet";
export const RPCS =
  NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"]
    : ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"];
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
// Accounts whose keys live somewhere else than PETRI_KEYS_DIR: the strains visitors spawn keep theirs beside the swarm
// registry (swarm/registry.mjs).
const keyDirs = new Map();
export function useKeysDir(accountId, dir) {
  keyDirs.set(accountId, dir);
}
export function account(accountId, keysDir = keyDirs.get(accountId) ?? KEYS_DIR) {
  const k = `${keysDir}|${accountId}`;
  if (!accounts.has(k)) {
    const file = path.join(keysDir, `${accountId}.json`);
    const { private_key } = JSON.parse(fs.readFileSync(file, "utf8"));
    const provider = new JsonRpcProvider({ url: RPCS[0] });
    accounts.set(k, new Account(accountId, provider, private_key));
  }
  return accounts.get(k);
}

export function failureText(f) {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 200);
}

/**
 * Call the dish as `accountId`. The strains and the keeper sign with function-call keys that may only call the dish and
 * cannot attach NEAR, so whatever a call needs (`deposit` yoctoNEAR) is paid from the account's sponsored credit in
 * the dish instead. The bench colonies (`attach`) attach their own NEAR, like a wallet player. Every call prepays 300
 * TGas by default: unused gas is refunded, and a catch-up on a crowded dish can need well over 150. Returns { hash,
 * value } (what the method returned, parsed) or throws with the contract's own words.
 */
// Gas each call attaches. NEAR reserves prepaid gas at a pessimistic price (about 10x the real one) until the refund
// lands, so 300 TGas locks about 0.3 NEAR per call: a strain holding 0.45 NEAR could then not plant right after it
// advanced the dish. A planting burns about 5 TGas and an advance of max_catchup (120) generations under 30 TGas.
export const CALL_TGAS = Number(process.env.PETRI_CALL_TGAS ?? "100");

export async function callDish(accountId, methodName, args, tgas = CALL_TGAS, deposit = 0n, attach = false) {
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
  return { hash: res.transaction.hash, value: returned(res), burnt: tokensBurnt(res) };
}

/** yoctoNEAR a transaction burnt in gas, over the transaction and all its receipts (refunds are not burnt). */
export function tokensBurnt(res) {
  let total = BigInt(res.transaction_outcome?.outcome?.tokens_burnt ?? 0);
  for (const r of res.receipts_outcome ?? []) total += BigInt(r.outcome?.tokens_burnt ?? 0);
  return total;
}

/**
 * Sends `actions` to `receiverId` as `accountId` and reports what happened without throwing on a refusal:
 * { hash, ok, failure (the contract's own words, or null), value }. Used where a refusal is the point (break-the-pact).
 */
export async function sendActions(accountId, receiverId, acts) {
  const a = account(accountId);
  const res = await a.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "EXECUTED_OPTIMISTIC", throwOnFailure: false });
  const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  return { hash: res.transaction.hash, ok: !fail, failure: fail ? failureText(fail) : null, value: fail ? null : returned(res) };
}

/** What a call returned (the first SuccessValue that parses as JSON), or null. */
function returned(res) {
  for (const st of [res.status, ...(res.receipts_outcome ?? []).map((r) => r.outcome.status)]) {
    const v = st?.SuccessValue;
    if (!v) continue;
    try {
      return JSON.parse(Buffer.from(v, "base64").toString("utf8"));
    } catch {
      /* not JSON */
    }
  }
  return null;
}

export function log(...a) {
  console.log(new Date().toISOString().slice(0, 19), ...a);
}
