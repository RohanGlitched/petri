// Top up a spawned strain: the sponsor prepays more of its brain and more dish credit. Only the browser that spawned it
// holds the owner token the VM checks; a strain can be topped up a couple of times on testnet.

import { NETWORK } from "@/lib/config";
import { clientIp, limited, swarmPost } from "@/lib/swarm-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return Response.json({ error: "Spawned strains run on the testnet dish." }, { status: 400 });
  let b: { account?: unknown; ownerToken?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { account, ownerToken }" }, { status: 400 });
  }
  if (limited(`topup|${clientIp(req)}`, 6, 24 * 3600_000)) return Response.json({ error: "Too many top-ups from this address today." }, { status: 429 });
  return swarmPost("/swarm/topup", { account: String(b.account ?? ""), ownerToken: String(b.ownerToken ?? "") }, { req, timeoutMs: 50_000 });
}
