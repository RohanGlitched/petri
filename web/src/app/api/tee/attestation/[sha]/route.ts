// An attestation report the strains' agents fetched from NEAR AI Cloud, by the SHA-256 of its bytes (each archived
// answer names it as attestation_sha256). Proxied from the agents' log window, checked against its name, then cached
// for good. scripts/verify-tee.mjs reads the same path. See lib/tee-proxy.ts.

import { teeAttestation } from "@/lib/tee-proxy";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  return teeAttestation(req, (await ctx.params).sha);
}
