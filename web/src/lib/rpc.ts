// NEAR JSON-RPC with failover across keyless public providers, for the browser and the server alike.
//
// Public RPC is shared: FastNEAR answers 429 to a busy IP (without CORS headers, so a browser sees only "Failed to
// fetch"), and the NEAR Foundation's rpc.*.near.org is deprecated and rate-limits everyone. Every read here rotates
// through the providers in config.ts; a provider that answers 429 or 5xx (or that a browser cannot reach) rests for its
// Retry-After, or a short exponential backoff, plus jitter, while the others answer. An error that is the chain's own
// answer (a contract panic, an unknown account) is final and is not retried elsewhere.

import { RPCS, type Network } from "./config";

export class RpcAnswer extends Error {
  /** The chain's own answer (a view that panicked, an account that does not exist): no provider will say otherwise. */
  readonly final = true;
}

/** Calls and failures this page made, by provider host (for the tour that measures RPC use, and for debugging). */
export const rpcStats: { calls: number; failed: number; throttled: number; hosts: Record<string, number> } = { calls: 0, failed: 0, throttled: 0, hosts: {} };
if (typeof window !== "undefined") (window as unknown as { __petriRpc: typeof rpcStats }).__petriRpc = rpcStats;

/** When each provider may be asked again (ms since the epoch). */
const resting = new Map<string, number>();
/** Where each network's reads start: the last provider that answered, so a page sticks to one that works. A first read
 * starts at a random one of the first two, so many visitors behind one IP spread over two providers. */
const preferred: Partial<Record<Network, number>> = {};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms: number) => ms + Math.random() * Math.min(1000, ms * 0.4 + 200);

function retryAfterMs(h: string | null): number | null {
  if (!h) return null;
  const s = Number(h);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const at = Date.parse(h);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function rest(url: string, ms: number) {
  resting.set(url, Date.now() + Math.min(30_000, jitter(ms)));
}

/** Whether an RPC error body is the chain's answer rather than the provider failing. */
function isAnswer(err: { name?: string; cause?: { name?: string }; data?: unknown; message?: string }): boolean {
  const name = `${err.cause?.name ?? ""} ${err.name ?? ""}`;
  const data = typeof err.data === "string" ? err.data : JSON.stringify(err.data ?? "");
  if (/UNKNOWN_BLOCK|GARBAGE_COLLECTED|NOT_SYNCED|TIMEOUT|INTERNAL_ERROR|NO_SYNCED_BLOCKS|UNAVAILABLE_SHARD/.test(name)) return false;
  return /UNKNOWN_ACCOUNT|UNKNOWN_ACCESS_KEY|CONTRACT_EXECUTION_ERROR|NO_CONTRACT_CODE|INVALID_ACCOUNT|PARSE_ERROR|INVALID_TRANSACTION|UNKNOWN_TRANSACTION/.test(name) || /FunctionCallError|MethodNotFound|wasm execution failed|panicked|does not exist/i.test(data);
}

function errorText(err: { name?: string; cause?: { name?: string }; data?: unknown; message?: string }): string {
  const msg = err.data ?? err.cause?.name ?? err.message ?? "RPC error";
  return typeof msg === "string" ? msg : JSON.stringify(msg);
}

export type RpcOptions = { timeoutMs?: number; urls?: string[]; id?: string };

/** One JSON-RPC call on `net`, failing over across its providers, backing off on 429 and 5xx. */
export async function rpcCall<T>(net: Network, method: string, params: unknown, opts: RpcOptions = {}): Promise<T> {
  const urls = opts.urls ?? RPCS[net];
  const n = urls.length;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  if (preferred[net] === undefined) preferred[net] = n > 1 ? Math.floor(Math.random() * 2) : 0;
  let last: unknown = null;
  for (let round = 0; round < 3; round++) {
    let tried = 0;
    for (let k = 0; k < n; k++) {
      const i: number = ((preferred[net] ?? 0) + k) % n;
      const url = urls[i];
      if ((resting.get(url) ?? 0) > Date.now()) continue;
      tried++;
      const host = new URL(url).host;
      rpcStats.calls++;
      rpcStats.hosts[host] = (rpcStats.hosts[host] ?? 0) + 1;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: opts.id ?? "petri", method, params }),
          signal: AbortSignal.timeout(timeoutMs),
          cache: "no-store",
        });
        if (res.status === 429 || res.status === 408 || res.status >= 500) {
          rpcStats.throttled++;
          rest(url, retryAfterMs(res.headers.get("retry-after")) ?? 1500 * 2 ** round);
          last = new Error(`${host} is busy (${res.status})`);
          continue;
        }
        if (!res.ok) {
          rest(url, 3000);
          last = new Error(`${host} answered ${res.status}`);
          continue;
        }
        const body = await res.json();
        if (body.error) {
          if (isAnswer(body.error)) throw new RpcAnswer(errorText(body.error));
          last = new Error(errorText(body.error));
          continue;
        }
        if (body.result && typeof body.result === "object" && typeof body.result.error === "string") throw new RpcAnswer(body.result.error);
        preferred[net] = i;
        return body.result as T;
      } catch (e) {
        if (e instanceof RpcAnswer) throw e;
        rpcStats.failed++;
        // A browser cannot read a 429 sent without CORS headers: it sees a network error. Rest that provider too.
        rest(url, 2000 * 2 ** round);
        last = e;
      }
    }
    // Every provider is resting: wait for the first to come back (never more than 8 s), then go round again.
    if (round < 2) {
      const soonest = Math.min(...urls.map((u) => resting.get(u) ?? 0));
      const wait = tried === 0 || soonest > Date.now() ? Math.min(8000, Math.max(250, soonest - Date.now())) : 0;
      if (wait) await sleep(wait);
    }
  }
  throw last instanceof Error ? last : new Error("Every NEAR RPC provider failed");
}

/** A call_function view's JSON result, decoded. */
export function decodeView<T>(r: { result?: number[] }): T {
  if (!r.result) throw new Error("view failed");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** View arguments as base64 JSON (UTF-8, so a colony name with any characters survives). */
export function b64(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** A failed read in words for a page: a busy public RPC said plainly, never a raw "Failed to fetch". */
export function readError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/fetch|network|load failed|RPC|busy|429|5\d\d|timed? ?out|abort|provider|cache/i.test(raw)) return "NEAR's public RPC is busy right now";
  return raw;
}

/** `f`, tried again after 5 and then 10 seconds when it fails for a reason that is not the chain's own answer. */
export async function withRetries<T>(f: () => Promise<T>, waits = [5000, 10_000]): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await f();
    } catch (e) {
      if (e instanceof RpcAnswer || (e as { final?: boolean }).final || i >= waits.length) throw e;
      await new Promise((r) => setTimeout(r, waits[i] + Math.random() * 500));
    }
  }
}
