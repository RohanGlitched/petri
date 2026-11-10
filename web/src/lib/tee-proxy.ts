// The TEE proof proxy behind /api/tee/<sha> and /api/tee/attestation/<sha>. The agents VM archives every NEAR AI answer
// a strain acted on and every attestation report it fetched, by SHA-256, and serves them over plain HTTP. The site
// passes them on over HTTPS, and because they are content-addressed it can cache them for good, but only after
// checking the hash itself: an answer whose bodies do not hash to what it records, or to the requested tag, or a
// report whose bytes do not hash to its name, is refused and never cached. Read-only.

import { createHash } from "node:crypto";
import { LOG_SOURCES } from "./log-sources";
import type { Network } from "./config";

const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const NETS: Network[] = ["mainnet", "testnet"];
/** Verified bodies, kept in memory by this instance (the CDN keeps them too, for a year). */
const kept = new Map<string, { body: Buffer; net: Network }>();
const KEEP_MAX = 400;

const IMMUTABLE = "public, max-age=31536000, s-maxage=31536000, immutable";
const json = (status: number, body: unknown, cache = "no-store") => Response.json(body, { status, headers: { "cache-control": cache, "access-control-allow-origin": "*" } });
const proof = (body: Buffer, net: Network) =>
  new Response(new Uint8Array(body), { headers: { "content-type": "application/json", "cache-control": IMMUTABLE, "access-control-allow-origin": "*", "x-petri-dish": net } });

async function fetchFrom(net: Network, path: string): Promise<Buffer | null> {
  try {
    const r = await fetch(`${LOG_SOURCES[net]}${path}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Which dishes to ask: the one named by ?net=, else both (mainnet first). */
function order(req: Request): Network[] {
  const q = new URL(req.url).searchParams.get("net");
  return q === "mainnet" || q === "testnet" ? [q] : NETS;
}

function keep(key: string, body: Buffer, net: Network) {
  kept.set(key, { body, net });
  if (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value!);
}

/** GET /api/tee/<sha256 of the response body, or its first 16+ hex>: the archived answer, checked. */
export async function teeAnswer(req: Request, sha: string): Promise<Response> {
  const tag = sha.toLowerCase().replace(/\.json$/, "");
  if (!/^[0-9a-f]{16,64}$/.test(tag)) return json(400, { error: "GET /api/tee/<sha256 of the answer, or its first 16+ hex>" });
  const hit = kept.get(`tee:${tag}`);
  if (hit) return proof(hit.body, hit.net);
  for (const net of order(req)) {
    const body = await fetchFrom(net, `/tee/${tag}`);
    if (!body) continue;
    let rec: { response_body?: unknown; response_sha256?: unknown; request_body?: unknown; request_sha256?: unknown };
    try {
      rec = JSON.parse(body.toString("utf8"));
    } catch {
      return json(502, { error: "the archive answered something that is not JSON" });
    }
    const res = typeof rec.response_body === "string" ? sha256(rec.response_body) : "";
    const reqOk = typeof rec.request_body === "string" && sha256(rec.request_body) === rec.request_sha256;
    // The tag on chain is the start of the answer's hash: the archived answer must hash to it, or it is not that answer.
    if (!res || !res.startsWith(tag) || res !== rec.response_sha256 || !reqOk)
      return json(502, { error: "the archived answer does not hash to the requested tag; not served", requested: tag, got: res || null });
    keep(`tee:${tag}`, body, net);
    return proof(body, net);
  }
  return json(404, { error: "no archived NEAR AI answer with that hash on either dish's agents" }, "public, max-age=30");
}

/** GET /api/tee/attestation/<sha256>: the attestation report exactly as fetched, checked against its name. */
export async function teeAttestation(req: Request, sha: string): Promise<Response> {
  const h = sha.toLowerCase().replace(/\.json$/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) return json(400, { error: "GET /api/tee/attestation/<sha256 of the report>" });
  const hit = kept.get(`att:${h}`);
  if (hit) return proof(hit.body, hit.net);
  for (const net of order(req)) {
    const body = await fetchFrom(net, `/attestation/${h}`);
    if (!body) continue;
    const got = sha256(body);
    if (got !== h) return json(502, { error: "the archived report does not hash to its name; not served", requested: h, got });
    keep(`att:${h}`, body, net);
    return proof(body, net);
  }
  return json(404, { error: "no archived attestation report with that hash on either dish's agents" }, "public, max-age=30");
}
