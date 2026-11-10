// Server-side calls from the site's API routes to the open swarm on the agents VM (agents/swarm/http.mjs). Every call
// is signed with PETRI_SWARM_SECRET, which only the site and the VM hold (the VM refuses unsigned calls to the routes
// that spend the sponsor's NEAR or a model call: spawn, top up, break-the-pact):
//   x-petri-v: 2, x-petri-ts, x-petri-nonce, x-petri-client (the visitor's address), and x-petri-sig, the hex
//   HMAC-SHA256 of "v2\n<ts>\n<nonce>\n<METHOD>\n<path and query>\n<client>\n<body>".
// The VM counts the visitor's address for its rate limits only when it is signed, and accepts each signature once.

import { createHmac, randomBytes } from "node:crypto";

const BASE = (process.env.PETRI_SWARM_URL ?? process.env.PETRI_STRAINS_LOG_URL ?? "http://136.64.100.170:8790/").replace(/\/$/, "");

export const swarmConfigured = () => !!process.env.PETRI_SWARM_SECRET;

/** The visitor's address, for rate limits here and on the VM. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim().slice(0, 100);
}

/** The signed headers for one call, or null when this server has no secret. */
function signed(method: string, pathAndQuery: string, body: string, client: string): Record<string, string> | null {
  const secret = process.env.PETRI_SWARM_SECRET;
  if (!secret) return null;
  const ts = String(Date.now());
  const nonce = randomBytes(12).toString("hex");
  const sig = createHmac("sha256", secret).update(`v2\n${ts}\n${nonce}\n${method}\n${pathAndQuery}\n${client}\n${body}`).digest("hex");
  return { "x-petri-v": "2", "x-petri-ts": ts, "x-petri-nonce": nonce, "x-petri-client": client, "x-petri-sig": sig };
}

export async function swarmGet(pathAndQuery: string, req?: Request): Promise<Response> {
  try {
    const r = await fetch(`${BASE}${pathAndQuery}`, {
      cache: "no-store",
      headers: signed("GET", pathAndQuery, "", req ? clientIp(req) : "") ?? {},
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } });
  } catch {
    return Response.json({ error: "The swarm on the agents VM did not answer. Try again in a minute." }, { status: 502 });
  }
}

/**
 * POSTs `body` to the swarm, signed when this server has the secret. `signed: true` (the default) makes the signature
 * required: without the secret the call is not sent. Council bids pass `signed: false`: they carry their own NEAR
 * signature, and are still signed here when possible so the VM can count the visitor's address.
 */
export async function swarmPost(path: string, body: unknown, { signed: required = true, req, timeoutMs = 60_000 }: { signed?: boolean; req?: Request; timeoutMs?: number } = {}): Promise<Response> {
  const raw = JSON.stringify(body);
  const sig = signed("POST", path, raw, req ? clientIp(req) : "");
  if (required && !sig) return Response.json({ error: "The open swarm is not configured on this server." }, { status: 503 });
  const headers: Record<string, string> = { "content-type": "application/json", ...(sig ?? {}) };
  try {
    const r = await fetch(`${BASE}${path}`, { method: "POST", headers, body: raw, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The swarm on the agents VM did not answer in time. If you spawned a strain, reload in a minute: it may have been made." }, { status: 504 });
  }
}

/** A tiny in-memory limiter, per server instance (the VM keeps its own global limits). */
const hits = new Map<string, number[]>();
export function limited(key: string, n: number, ms: number): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= n) return true;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value as string);
  return false;
}
