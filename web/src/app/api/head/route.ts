// A recent final block on either dish's network, the same one for every visitor for a few seconds, so reads pinned to
// it (/api/view) are shared through the cache. Read-only.

import type { Network } from "@/lib/config";
import { finalHeight } from "@/lib/final-head";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const net: Network = new URL(req.url).searchParams.get("net") === "mainnet" ? "mainnet" : "testnet";
  try {
    const height = await finalHeight(net);
    return Response.json({ net, height }, { headers: { "cache-control": "public, max-age=5, s-maxage=8, stale-while-revalidate=20" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
