// Server-side calls from the site's API routes to the open swarm on the agents VM (agents/swarm/http.mjs). Reads go
// straight through. Calls that spend the sponsor's NEAR or a model call (spawn, top up, break-the-pact) are signed:
// HMAC-SHA256 over "<unix ms>\n<METHOD>\n<path>\n<body>" with PETRI_SWARM_SECRET, which only the site and the VM hold.

import { createHmac } from "node:crypto";

const BASE = (process.env.PETRI_SWARM_URL ?? process.env.PETRI_STRAINS_LOG_URL ?? "http://136.64.100.170:8790/").replace(/\/$/, "");

export const swarmConfigured = () => !!process.env.PETRI_SWARM_SECRET;

/** The visitor's address, for rate limits here and on the VM. */
export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
}

export async function swarmGet(pathAndQuery: string, req?: Request): Promise<Response> {
  try {
    const r = await fetch(`${BASE}${pathAndQuery}`, {
      cache: "no-store",
      headers: req ? { "x-petri-client": clientIp(req) } : {},
      signal: AbortSignal.timeout(15_000),
    });
    const body = await r.text();
    return new Response(body, { status: r.status, headers: { "content-type": "application/json", "cache-control": "no-store", "access-control-allow-origin": "*" } });
  } catch {
    return Response.json({ error: "The swarm on the agents VM did not answer. Try again in a minute." }, { status: 502 });
  }
}

/** POSTs `body` to the swarm. `signed` adds the site's HMAC (the VM refuses unsigned calls to those routes). */
export async function swarmPost(path: string, body: unknown, { signed = true, req, timeoutMs = 60_000 }: { signed?: boolean; req?: Request; timeoutMs?: number } = {}): Promise<Response> {
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (req) headers["x-petri-client"] = clientIp(req);
  if (signed) {
    const secret = process.env.PETRI_SWARM_SECRET;
    if (!secret) return Response.json({ error: "The open swarm is not configured on this server." }, { status: 503 });
    const ts = String(Date.now());
    headers["x-petri-ts"] = ts;
    headers["x-petri-sig"] = createHmac("sha256", secret).update(`${ts}\nPOST\n${path}\n${raw}`).digest("hex");
  }
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
