// The dish's first paint in one request: every view the browser's dish store needs to rebuild the board (rules, state,
// stored board, colonies, stakes, earnings, the latest plantings), read from NEAR here and kept for five seconds (and a few more by the CDN), so
// a visit does not spend six or seven RPC calls from the browser. The dish polls it (`part=head`, just the state) instead
// of RPC, and reads RPC itself only right after its own move.
// Read-only: it calls view methods and nothing else.

import { CONTRACTS, type Network } from "@/lib/config";
import { b64, decodeView, rpcCall } from "@/lib/rpc";

export const dynamic = "force-dynamic";

const TTL = 5_000;

type Snap = { at: number; body: string };
const cache = new Map<Network, Snap>();
const inflight = new Map<Network, Promise<Snap>>();

async function view<T>(net: Network, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpcCall<{ result?: number[] }>(net, "query", { request_type: "call_function", finality: "optimistic", account_id: CONTRACTS[net], method_name: method, args_base64: b64(args) }, { id: "petri-snapshot", timeoutMs: 6000 });
  return decodeView<T>(r);
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
  const q = new URL(req.url).searchParams;
  const net: Network = q.get("net") === "mainnet" ? "mainnet" : "testnet";
  // `part=head`: only the state, for the dish's five-second poll; the board and the rest are fetched when it moves.
  const head = q.get("part") === "head";
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
    const state = (JSON.parse(s.body) as { state: { generation: string; ledger: string; colonies: number; now_ms: string } }).state;
    // The head poll's ETag names what it reports: while the stored dish has not moved, a browser revalidating gets an
    // empty 304 and keeps the answer it has (its clock runs on locally).
    const etag = `W/"${net}-${state.generation}-${state.ledger}-${state.colonies}${head ? "-h" : `-${s.at}`}"`;
    if (head && req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag, "cache-control": "public, max-age=0, s-maxage=4, stale-while-revalidate=6" } });
    const body = head ? JSON.stringify({ net, at: s.at, state }) : s.body;
    // `servedAt` lets the browser carry the chain's clock forward by however long the snapshot sat in this cache; the
    // CDN keeps it a few seconds more and says so in its Age header.
    return new Response(body.slice(0, -1) + `,"servedAt":${Date.now()}}`, {
      headers: { "content-type": "application/json", etag, "cache-control": "public, max-age=0, s-maxage=4, stale-while-revalidate=6" },
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
