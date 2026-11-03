// What every /api/intents route shares: the 1Click base, its optional key, and the one recipient it may pay.
// Intents settles on NEAR mainnet, so these routes only ever quote for the mainnet dish, whatever a browser is reading.

import { CONTRACTS } from "@/lib/config";
import { INTENTS_API } from "@/lib/intents";

export const MAINNET_DISH = CONTRACTS.mainnet;

export function headers(): HeadersInit {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  // 1Click works without a key; a key only lowers its fee and lifts its rate limit.
  if (process.env.INTENTS_API_KEY) h["x-api-key"] = process.env.INTENTS_API_KEY;
  return h;
}

export async function oneClick(path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${INTENTS_API}${path}`, { ...init, headers: headers(), cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

export function fail(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

/** 1Click's own words for a refused request, or a plain fallback. */
export function upstreamError(body: Record<string, unknown>, status: number): string {
  const m = body.message;
  if (typeof m === "string" && m) return m;
  if (Array.isArray(m) && m.length) return m.map(String).join("; ");
  return `NEAR Intents answered ${status}.`;
}

/** Deposit addresses are hex, base58 or bech32: letters and digits only. */
export const isDepositAddress = (a: unknown): a is string => typeof a === "string" && /^[0-9A-Za-z]{20,100}$/.test(a);

let deployed: { at: number; ok: boolean } | null = null;
/** Whether the mainnet dish has contract code, checked at most once a minute. NEAR sent to an account with no code
 * would be stranded, so no deposit address is handed out until it does. */
export async function dishDeployed(): Promise<boolean> {
  if (deployed && Date.now() - deployed.at < 60_000) return deployed.ok;
  try {
    const res = await fetch("https://rpc.mainnet.fastnear.com", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "petri", method: "query", params: { request_type: "view_account", finality: "final", account_id: MAINNET_DISH } }),
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const body = (await res.json()) as { result?: { code_hash?: string } };
    const hash = body.result?.code_hash;
    deployed = { at: Date.now(), ok: !!hash && hash !== "11111111111111111111111111111111" };
  } catch {
    // An unreachable RPC is not a verdict; ask again on the next request.
    return false;
  }
  return deployed.ok;
}

/** True when a quote, as 1Click echoes it, pays wNEAR to the mainnet dish and nobody else. */
export function paysTheDish(q: unknown): boolean {
  const r = (q as { quoteRequest?: { recipient?: string; destinationAsset?: string; recipientType?: string } })?.quoteRequest;
  return !!r && r.recipient === MAINNET_DISH && r.destinationAsset === "nep141:wrap.near" && r.recipientType === "DESTINATION_CHAIN";
}
