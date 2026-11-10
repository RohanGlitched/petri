// Break the pact (/strains/break). POST { action: "chat", session, message } talks to Captive, a colony bound by a
// pact; POST { action: "plant", session, side, anyway } sends the planting as a real testnet transaction signed by
// Captive's own key, which the contract refuses. Rate limited per address here, and overall on the agents VM.

import { NETWORK } from "@/lib/config";
import { clientIp, limited, swarmPost } from "@/lib/swarm-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return Response.json({ error: "Break the pact runs on the testnet dish." }, { status: 400 });
  let b: { action?: unknown; session?: unknown; message?: unknown; side?: unknown; anyway?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { action, session, message | side }" }, { status: 400 });
  }
  const ip = clientIp(req);
  const session = b.session ? String(b.session).slice(0, 64) : null;
  if (b.action === "chat") {
    if (limited(`chat|${ip}`, 30, 3600_000)) return Response.json({ error: "Captive needs a breather: at most 30 messages an hour from one address." }, { status: 429 });
    return swarmPost("/swarm/break/chat", { session, message: String(b.message ?? "").slice(0, 400) }, { req, timeoutMs: 45_000 });
  }
  if (b.action === "plant") {
    if (limited(`plant|${ip}`, 8, 3600_000)) return Response.json({ error: "At most 8 attempts an hour from one address; every one is on chain below." }, { status: 429 });
    return swarmPost("/swarm/break/plant", { session, side: String(b.side ?? "east"), anyway: b.anyway === true }, { req, timeoutMs: 50_000 });
  }
  return Response.json({ error: 'action must be "chat" or "plant"' }, { status: 400 });
}
