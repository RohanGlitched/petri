// The break-it lab's tally: how many attempts the chain refused, per attempt, and the latest few with their
// transactions. Shared across server instances when Upstash Redis (Vercel KV) is configured; per instance otherwise.

import { refusals } from "@/lib/budget";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await refusals();
  return Response.json(r, { headers: { "cache-control": "no-store" } });
}
