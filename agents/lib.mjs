// Shared plumbing for the keeper and the strains: chain reads, the WASM rules, and signed calls.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Account, JsonRpcProvider, actions } from "near-api-js";
import { initSync, Engine, pattern_cells, quote } from "../web/src/engine/pkg/petri.js";

const here = path.dirname(fileURLToPath(import.meta.url));
initSync({ module: fs.readFileSync(path.join(here, "../web/src/engine/pkg/petri_bg.wasm")) });

export { Engine, pattern_cells, quote };

export const CONTRACT = process.env.PETRI_CONTRACT ?? "petri-dish.testnet";
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
  const board = Buffer.from(await view("board"), "base64");
  const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps);
  e.set_colonies(colonies.length);
  e.set_agar(state.agar);
  if (!e.load_compact(board, Number(state.generation), state.chain)) throw new Error("board did not load");
  const due = Math.floor((Number(state.now_ms) - Number(state.epoch_ms)) / Number(rules.generation_ms));
  if (due > e.generation()) e.step(due - e.generation());
  return { rules, state, colonies, engine: e, cells: e.cells(), due };
}

const accounts = new Map();
export function account(accountId) {
  if (!accounts.has(accountId)) {
    const file = path.join(KEYS_DIR, `${accountId}.json`);
    const { private_key } = JSON.parse(fs.readFileSync(file, "utf8"));
    const provider = new JsonRpcProvider({ url: RPCS[0] });
    accounts.set(accountId, new Account(accountId, provider, private_key));
  }
  return accounts.get(accountId);
}

export function failureText(f) {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  return m ? m[1] : s.slice(0, 200);
}

/** Call the dish as `accountId`. Returns { hash } or throws with the contract's own words. */
export async function callDish(accountId, methodName, args, tgas = 150) {
  const a = account(accountId);
  const res = await a.signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, 0n)],
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
