// The dish's first paint in one request: every view the browser's dish store needs to rebuild the board (rules, state,
// stored board, colonies, stakes, earnings, the latest plantings), read from NEAR here and kept for five seconds, so a
// first visit does not wait on six or seven RPC calls from the browser. The store refines from RPC straight after.
// Read-only: it calls view methods and nothing else.

import { CONTRACTS, RPCS, type Network } from "@/lib/config";

export const dynamic = "force-dynamic";

const TTL = 5_000;

type Snap = { at: number; body: string };
const cache = new Map<Network, Snap>();
const inflight = new Map<Network, Promise<Snap>>();

async function view<T>(net: Network, method: string, args: Record<string, unknown> = {}): Promise<T> {
  let last: unknown = null;
  for (const url of RPCS[net]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "petri-snapshot",
          method: "query",
          params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACTS[net], method_name: method, args_base64: btoa(JSON.stringify(args)) },
        }),
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error || !body.result?.result) throw new Error("RPC error");
      return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result))) as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("NEAR did not answer");
}

/** Every page of a paged view, all at once. */
async function pages<T>(net: Network, method: string, total: number, size: number): Promise<T[]> {
  const n = Math.ceil(total / size);
  const got = await Promise.all(Array.from({ length: n }, (_, i) => view<T[]>(net, method, { from: i * size, limit: size })));
  return got.flat().slice(0, total);
}

async function read(net: Network): Promise<Snap> {
  const [rules, state, board] = await Promise.all([view(net, "rules"), view<{ colonies: number; plants: string }>(net, "state"), view<string>(net, "board")]);
  const total = Number(state.plants);
  const [colonies, stakes, earnings, plants] = await Promise.all([
    pages(net, "colonies", state.colonies, 500),
    pages(net, "stakes", state.colonies, 2000),
    pages(net, "earnings", state.colonies, 500),
    total > 0 ? view<unknown[]>(net, "plants", { from: Math.max(0, total - 24), limit: 24 }) : Promise.resolve([]),
  ]);
  const at = Date.now();
  return { at, body: JSON.stringify({ net, contract: CONTRACTS[net], at, rules, state, board, colonies, stakes, earnings, plants }) };
}

export async function GET(req: Request) {
  const net: Network = new URL(req.url).searchParams.get("net") === "mainnet" ? "mainnet" : "testnet";
  try {
    let s = cache.get(net);
    if (!s || Date.now() - s.at > TTL) {
      let p = inflight.get(net);
      if (!p) {
        p = read(net).finally(() => inflight.delete(net));
        inflight.set(net, p);
      }
      s = await p;
      cache.set(net, s);
    }
    // `servedAt` lets the browser carry the chain's clock forward by however long the snapshot sat in this cache.
    return new Response(s.body.slice(0, -1) + `,"servedAt":${Date.now()}}`, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
