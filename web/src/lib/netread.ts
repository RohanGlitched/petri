// Read-only views of either dish, whichever one this page reads. The judge desk shows both dishes side by side, so it
// cannot use chain.ts, whose calls follow the network chosen for the page. Same JSON-RPC, same failover.

import { CONTRACTS, RPCS, type Network } from "./config";
import type { Colony, DishState, Entry, Rules, SlideView } from "./chain";

async function rpc<T>(net: Network, method: string, params: unknown, timeoutMs = 10_000): Promise<T> {
  let last: unknown = null;
  for (const url of RPCS[net]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "petri-desk", method, params }),
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(typeof body.error?.data === "string" ? body.error.data : body.error?.message ?? "RPC error");
      if (body.result?.error) throw new Error(String(body.result.error));
      return body.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Every NEAR RPC provider failed");
}

/** Each network's reads can be pinned to one final block, so a dish read while transactions land is still one moment. */
const pinned: Partial<Record<Network, number>> = {};
const at = (net: Network) => (pinned[net] !== undefined ? { block_id: pinned[net] } : { finality: "final" });

/** Pin every following read on `net` to its latest final block. Returns the height. */
export async function pin(net: Network): Promise<number> {
  delete pinned[net];
  const b = await rpc<{ header: { height: number } }>(net, "block", { finality: "final" });
  pinned[net] = b.header.height;
  return b.header.height;
}
export const unpin = (net: Network) => void delete pinned[net];

export async function netView<T>(net: Network, method: string, args: Record<string, unknown> = {}, contract = CONTRACTS[net]): Promise<T> {
  const r = await rpc<{ result: number[] }>(net, "query", {
    request_type: "call_function",
    ...at(net),
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export type AccessKey = { public_key: string; access_key: { nonce: number; permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } } } };

export async function accountOf(net: Network, account_id: string) {
  const [acct, keys] = await Promise.all([
    rpc<{ code_hash: string; amount: string; storage_usage: number }>(net, "query", { request_type: "view_account", ...at(net), account_id }),
    rpc<{ keys: AccessKey[] }>(net, "query", { request_type: "view_access_key_list", ...at(net), account_id }),
  ]);
  return { codeHash: acct.code_hash, balance: acct.amount, storageUsage: acct.storage_usage, keys: keys.keys, fullAccess: keys.keys.filter((k) => k.access_key.permission === "FullAccess").length };
}

/** NEP-330: where the deployed code came from and how it was built. */
export type SourceMeta = { version?: string; link?: string; standards?: { standard: string; version: string }[]; build_info?: { build_environment?: string; build_command?: string[]; source_code_snapshot?: string } };

async function paged<T>(total: number, size: number, page: (from: number, limit: number) => Promise<T[]>): Promise<T[]> {
  const n = Math.ceil(total / size);
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => page(i * size, size)));
  return parts.flat().slice(0, total);
}

/** Everything the desk counts on one dish. */
export type DishRead = { net: Network; rules: Rules; state: DishState; colonies: Colony[]; ledger: Entry[]; slides: SlideView[] };

export async function readDish(net: Network): Promise<DishRead> {
  const [rules, state] = await Promise.all([netView<Rules>(net, "rules"), netView<DishState>(net, "state")]);
  const [colonies, ledger, slides] = await Promise.all([
    paged(state.colonies, 500, (from, limit) => netView<Colony[]>(net, "colonies", { from, limit })),
    paged(Number(state.ledger), 1000, (from, limit) => netView<Entry[]>(net, "ledger", { from, limit })),
    paged(Number(state.slides), 500, (from, limit) => netView<SlideView[]>(net, "slides", { from, limit })),
  ]);
  return { net, rules, state, colonies, ledger, slides };
}

/** The replay's inputs for one dish (see replay.ts): the desk replays both dishes, the verify page only the one it reads. */
export async function readForReplay(d: DishRead) {
  const n = d.state.colonies;
  const [earnings, winnings, acct] = await Promise.all([
    paged(n, 500, (from, limit) => netView<string[]>(d.net, "earnings", { from, limit })),
    paged(n, 500, (from, limit) => netView<string[]>(d.net, "tide_winnings", { from, limit })),
    accountOf(d.net, CONTRACTS[d.net]),
  ]);
  return { earnings, winnings, lock: { codeHash: acct.codeHash, fullAccessKeys: acct.fullAccess, balance: acct.balance, storageUsage: acct.storageUsage } };
}
