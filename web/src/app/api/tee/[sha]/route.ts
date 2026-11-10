// The archived NEAR AI answer behind a strain's move, by the tag its planting note carries (" · tee:<16 hex>") or the
// full SHA-256 of the answer. Proxied from the agents' log window, checked against its hash, then cached for good.
// scripts/verify-tee.mjs reads the same path. See lib/tee-proxy.ts.

import { teeAnswer } from "@/lib/tee-proxy";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  return teeAnswer(req, (await ctx.params).sha);
}
