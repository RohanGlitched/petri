// The assets the site offers for paying with any token, with 1Click's current USD prices, and wNEAR's.

import { ORIGINS, WNEAR, type Token } from "@/lib/intents";
import { fail, oneClick, upstreamError } from "../oneclick";

export const revalidate = 60;

let cached: { at: number; tokens: Token[] } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < 60_000) return Response.json({ tokens: cached.tokens }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  try {
    const { status, body } = await oneClick("/v0/tokens");
    if (status !== 200 || !Array.isArray(body)) return fail(502, upstreamError(body, status));
    const wanted = new Set([WNEAR, ...ORIGINS.map((o) => o.id)]);
    const tokens = (body as unknown as Token[])
      .filter((t) => wanted.has(t.assetId))
      .map(({ assetId, symbol, blockchain, decimals, price }) => ({ assetId, symbol, blockchain, decimals, price }));
    cached = { at: Date.now(), tokens };
    return Response.json({ tokens }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" } });
  } catch (e) {
    return fail(502, `NEAR Intents could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  }
}
