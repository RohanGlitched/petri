// A specimen slide's NEP-171 events (its mint and every move) as NearBlocks indexed them, for the slide's page. Proxied
// and cached for a minute, so visitors share one NearBlocks request per slide instead of each spending the public API's
// small rate limit from their own browser. Read-only.

import { CONTRACTS, type Network } from "@/lib/config";

export const revalidate = 60;

const API: Record<Network, string> = { mainnet: "https://api.nearblocks.io", testnet: "https://api-testnet.nearblocks.io" };

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const net: Network = q.get("net") === "mainnet" ? "mainnet" : "testnet";
  const token = q.get("token") ?? "";
  if (!/^[0-9]{1,10}$/.test(token)) return Response.json({ error: "token must be a slide id" }, { status: 400 });
  const headers: Record<string, string> = {};
  if (process.env.NEARBLOCKS_API_KEY) headers.authorization = `Bearer ${process.env.NEARBLOCKS_API_KEY}`;
  try {
    const r = await fetch(`${API[net]}/v1/nfts/${CONTRACTS[net]}/tokens/${token}/txns?per_page=100&order=asc`, { headers, next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`NearBlocks answered ${r.status}`);
    const body = (await r.json()) as { txns?: unknown[] };
    return Response.json({ txns: body.txns ?? [] }, { headers: { "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "public, max-age=10, s-maxage=15" } });
  }
}
