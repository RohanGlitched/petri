// Reads pinned to one final block, through the site's own cache.
//
// A final block never changes, so a view read at one is the same for every visitor forever. /api/head names a recent
// final block (the same one for everybody for a few seconds), and /api/view serves any dish view at a final block with
// an immutable cache header: the CDN and the browser keep it, so a judge clicking through /judges, /verify and /coin,
// or a crawler from a busy cloud IP, costs the public RPC almost nothing. If the site's routes cannot answer, the read
// goes straight to RPC (rpc.ts), pinned to the same block.

import { CONTRACTS, type Network } from "./config";
import { b64, decodeView, rpcCall } from "./rpc";

const heads = new Map<Network, { at: number; p: Promise<number> }>();

/** A recent final block height on `net`, shared by every page (and every visitor) for a few seconds. */
export function sharedHead(net: Network, maxAgeMs = 10_000): Promise<number> {
  const hit = heads.get(net);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.p;
  const p = (async () => {
    if (typeof window !== "undefined") {
      try {
        const r = await fetch(`/api/head?net=${net}`, { signal: AbortSignal.timeout(6000) });
        if (r.ok) {
          const j = (await r.json()) as { height?: number };
          if (j.height && Number.isSafeInteger(j.height)) return j.height;
        }
      } catch {
        /* straight to RPC */
      }
    }
    const b = await rpcCall<{ header: { height: number } }>(net, "block", { finality: "final" });
    return b.header.height;
  })();
  heads.set(net, { at: Date.now(), p });
  p.catch(() => heads.delete(net));
  return p;
}

type Kind = "call" | "account" | "keys";

async function viaSite<T>(net: Network, block: number, kind: Kind, account: string, method = "", args = ""): Promise<T> {
  const q = new URLSearchParams({ net, block: String(block), kind, account });
  if (kind === "call") {
    q.set("method", method);
    q.set("args", args);
  }
  const r = await fetch(`/api/view?${q}`, { signal: AbortSignal.timeout(15_000) });
  const j = (await r.json().catch(() => null)) as { v?: T; error?: string; final?: boolean } | null;
  if (r.ok && j && "v" in j) return j.v as T;
  const e = new Error(j?.error ?? `The site's view cache answered ${r.status}`) as Error & { final?: boolean };
  e.final = !!j?.final;
  throw e;
}

/** A view of `account` (the dish by default) at final block `block`. */
export async function viewAt<T>(net: Network, block: number, method: string, args: Record<string, unknown> = {}, account = CONTRACTS[net]): Promise<T> {
  const a = b64(args);
  if (typeof window !== "undefined") {
    try {
      return await viaSite<T>(net, block, "call", account, method, a);
    } catch (e) {
      if ((e as { final?: boolean }).final) throw e;
    }
  }
  const r = await rpcCall<{ result?: number[] }>(net, "query", { request_type: "call_function", block_id: block, account_id: account, method_name: method, args_base64: a });
  return decodeView<T>(r);
}

export type AccountView = { code_hash: string; amount: string; locked: string; storage_usage: number };
export type AccessKeyList = { keys: { public_key: string; access_key: { nonce: number; permission: "FullAccess" | { FunctionCall: { allowance: string | null; receiver_id: string; method_names: string[] } } } }[] };

export async function accountAt(net: Network, block: number, account = CONTRACTS[net]): Promise<AccountView> {
  if (typeof window !== "undefined") {
    try {
      return await viaSite<AccountView>(net, block, "account", account);
    } catch {
      /* straight to RPC */
    }
  }
  return rpcCall<AccountView>(net, "query", { request_type: "view_account", block_id: block, account_id: account });
}

export async function keysAt(net: Network, block: number, account = CONTRACTS[net]): Promise<AccessKeyList> {
  if (typeof window !== "undefined") {
    try {
      return await viaSite<AccessKeyList>(net, block, "keys", account);
    } catch {
      /* straight to RPC */
    }
  }
  return rpcCall<AccessKeyList>(net, "query", { request_type: "view_access_key_list", block_id: block, account_id: account });
}

/** Every page of a paged view at one block, `size` a call, requested together. */
export async function pagedAt<T>(net: Network, block: number, method: string, total: number, size: number): Promise<T[]> {
  const n = Math.ceil(total / size);
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => viewAt<T[]>(net, block, method, { from: i * size, limit: size })));
  return parts.flat().slice(0, total);
}
