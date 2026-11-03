// Tell 1Click the hash of a deposit already sent, so it can look for it sooner. Optional: it finds deposits anyway.

import { fail, isDepositAddress, oneClick, paysTheDish, upstreamError } from "../oneclick";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as { depositAddress?: unknown; txHash?: unknown } | null;
  if (!b || !isDepositAddress(b.depositAddress)) return fail(400, "That is not a deposit address.");
  if (typeof b.txHash !== "string" || !/^(0x)?[0-9A-Za-z]{32,100}$/.test(b.txHash.trim())) return fail(400, "That does not look like a transaction hash.");
  try {
    const { status, body } = await oneClick("/v0/deposit/submit", { method: "POST", body: JSON.stringify({ depositAddress: b.depositAddress, txHash: b.txHash.trim() }) });
    if (status !== 200 && status !== 201) return fail(status === 400 ? 400 : 502, upstreamError(body, status));
    if (!paysTheDish(body.quoteResponse)) return fail(404, "This deposit address does not pay the dish.");
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(502, `NEAR Intents could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  }
}
