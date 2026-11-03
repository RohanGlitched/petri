// The state of one swap, by its deposit address. Only swaps that pay the dish are reported.

import { fail, isDepositAddress, oneClick, paysTheDish, upstreamError } from "../oneclick";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const depositAddress = url.searchParams.get("depositAddress");
  const depositMemo = url.searchParams.get("depositMemo");
  if (!isDepositAddress(depositAddress)) return fail(400, "That is not a deposit address.");
  if (depositMemo !== null && !/^[0-9A-Za-z]{1,64}$/.test(depositMemo)) return fail(400, "That is not a deposit memo.");
  try {
    const q = new URLSearchParams({ depositAddress, ...(depositMemo ? { depositMemo } : {}) });
    const { status, body } = await oneClick(`/v0/status?${q}`);
    if (status === 404) return fail(404, "NEAR Intents does not know this deposit address yet.");
    if (status !== 200) return fail(502, upstreamError(body, status));
    if (!paysTheDish(body.quoteResponse)) return fail(404, "This deposit address does not pay the dish.");
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(502, `NEAR Intents could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  }
}
