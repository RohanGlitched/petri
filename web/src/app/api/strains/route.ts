// The strains' action log, passed through from the agents' read-only log window so the page can be served over HTTPS.

import { CONTRACTS } from "@/lib/config";

const SOURCE = process.env.PETRI_STRAINS_LOG_URL ?? "http://136.64.100.170:8790/";

export const revalidate = 15;

export async function GET(req: Request) {
  // The browser says which dish it reads; the log is filtered to that dish's contract.
  const net = new URL(req.url).searchParams.get("net") === "mainnet" ? "mainnet" : "testnet";
  try {
    const res = await fetch(SOURCE, { next: { revalidate: 15 }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`log window answered ${res.status}`);
    const body = await res.json();
    // The log spans every dish the strains have played; show only moves on the dish this site reads.
    body.actions = (body.actions ?? []).filter((a: { contract?: string }) => a.contract === CONTRACTS[net]);
    return Response.json(body, { headers: { "cache-control": "public, s-maxage=15, stale-while-revalidate=60" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e), actions: [] }, { status: 502 });
  }
}
