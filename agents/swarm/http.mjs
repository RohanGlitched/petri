// The swarm's routes on the agents' log window (PETRI_LOG_PORT). Reads are open. Anything that spends the sponsor's
// NEAR or a model call (spawn, top up, break-the-pact) must come from the site: an HMAC-SHA256 over
// "<unix ms>\n<METHOD>\n<path>\n<body>" with PETRI_SWARM_SECRET, at most a minute old. Sealed council bids need no HMAC:
// each carries its own NEAR signature.
//
//   GET  /swarm                    the registry as the site shows it (strains, council rounds, deals, break attempts)
//   GET  /swarm/world?account=     what an outside agent sees (swarm/world.mjs)
//   GET  /swarm/council?account=   the open round, your bids and deals
//   POST /swarm/council            a NEP-413 signed sealed bid
//   POST /swarm/spawn              (HMAC) { name, color, prompt, family }
//   POST /swarm/topup              (HMAC) { account, ownerToken }
//   POST /swarm/break/chat         (HMAC) { session, message }
//   POST /swarm/break/plant        (HMAC) { session, side, anyway }

import crypto from "node:crypto";
import { publicSwarm } from "./registry.mjs";
import { spawnStrain, topUp } from "./spawn.mjs";
import { worldFor } from "./world.mjs";
import { councilView, submitBid } from "./open-council.mjs";
import { breakAttempt, breakChat } from "./breakpact.mjs";

const SECRET = process.env.PETRI_SWARM_SECRET ?? "";

export function signRequest(secret, method, path, body, ts = Date.now()) {
  return { ts: String(ts), sig: crypto.createHmac("sha256", secret).update(`${ts}\n${method}\n${path}\n${body}`).digest("hex") };
}

function authorized(req, path, body) {
  if (!SECRET) return false;
  const ts = Number(req.headers["x-petri-ts"]);
  const sig = String(req.headers["x-petri-sig"] ?? "");
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 60_000) return false;
  const want = signRequest(SECRET, req.method, path, body, ts).sig;
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

/** Runs jobs one at a time (each signer's nonces stay in order). */
function queue() {
  let tail = Promise.resolve();
  return (job) => {
    const run = tail.then(job, job);
    tail = run.catch(() => {});
    return run;
  };
}
const spawnQueue = queue();
const breakQueue = queue();

const hits = new Map();
function limited(key, n, ms) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < ms);
  if (list.length >= n) return true;
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value);
  return false;
}

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let s = "";
    req.on("data", (c) => {
      s += c;
      if (s.length > 20_000) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(s));
    req.on("error", reject);
  });

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/** Handles /swarm routes; returns false for anything else. ctx: { reg, house(), catchUp, log, enabled }. */
export async function handleSwarm(req, res, ctx) {
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  if (!path.startsWith("/swarm")) return false;
  const { reg, log } = ctx;
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" });
      res.end();
      return true;
    }
    if (req.method === "GET") {
      if (path === "/swarm") return send(res, 200, publicSwarm(reg)), true;
      if (path === "/swarm/council") return send(res, 200, councilView(reg, url.searchParams.get("account"))), true;
      if (path === "/swarm/world") {
        if (limited(`world|${req.headers["x-petri-client"] ?? req.socket.remoteAddress}`, 60, 60_000)) return send(res, 429, { error: "at most 60 world reads a minute" }), true;
        const account = url.searchParams.get("account") ?? "";
        if (account && !/^[a-z0-9._-]{2,64}$/.test(account)) return send(res, 400, { error: "account must be a NEAR account id" }), true;
        return send(res, 200, await worldFor(account, { temperament: url.searchParams.get("temperament") ?? "gardener", house: ctx.house() })), true;
      }
      return send(res, 404, { error: "no such swarm route" }), true;
    }
    if (req.method !== "POST") return send(res, 405, { error: "GET or POST" }), true;
    const raw = await readBody(req);
    let body;
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, { error: "send JSON" }), true;
    }
    if (path === "/swarm/council") {
      if (!ctx.enabled) return send(res, 503, { error: "the open council is not running on this dish" }), true;
      if (limited(`bid|${body?.account}`, 30, 3600_000) || limited(`bidip|${req.headers["x-petri-client"] ?? req.socket.remoteAddress}`, 120, 3600_000)) return send(res, 429, { error: "too many bids in the last hour" }), true;
      const r = await submitBid(reg, body);
      return send(res, r.ok ? 200 : 400, r), true;
    }
    if (!authorized(req, path, raw)) return send(res, 401, { error: "this route is called by the site only" }), true;
    if (!ctx.enabled) return send(res, 503, { error: "the swarm is not running on this dish" }), true;
    if (path === "/swarm/spawn") {
      const r = await spawnQueue(() => spawnStrain(reg, body, log));
      return send(res, r.ok ? 200 : 400, r), true;
    }
    if (path === "/swarm/topup") {
      const r = await spawnQueue(() => topUp(reg, body, log));
      return send(res, r.ok ? 200 : 400, r), true;
    }
    if (path === "/swarm/break/chat") {
      const r = await breakChat(reg, body);
      return send(res, r.ok ? 200 : 400, r), true;
    }
    if (path === "/swarm/break/plant") {
      const r = await breakQueue(() => breakAttempt(reg, body, { catchUp: ctx.catchUp, log }));
      return send(res, r.ok ? 200 : 400, r), true;
    }
    return send(res, 404, { error: "no such swarm route" }), true;
  } catch (e) {
    log("swarm route error", path, e instanceof Error ? e.message : e);
    send(res, 500, { error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    return true;
  }
}
