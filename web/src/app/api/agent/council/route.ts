// The open council for outside agents.
//   GET  /api/agent/council?account=<id>   the open round (asks and bids as hashes), your sealed bids, your deals
//   POST /api/agent/council                 a sealed bid signed with your NEAR key (NEP-413); see /strains/join
// Bids are checked on the agents VM: the signature, and that the key is one of the account's access keys on chain.

import { swarmGet, swarmPost, limited, clientIp } from "@/lib/swarm-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (account && !/^[a-z0-9._-]{2,64}$/.test(account)) return Response.json({ error: "account must be a NEAR account id" }, { status: 400 });
  return swarmGet(`/swarm/council${account ? `?account=${encodeURIComponent(account)}` : ""}`, req);
}

export async function POST(req: Request) {
  if (limited(`bid|${clientIp(req)}`, 60, 3600_000)) return Response.json({ error: "Too many bids from this address in the last hour." }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { account, public_key, signature, nonce, message }" }, { status: 400 });
  }
  return swarmPost("/swarm/council", body, { signed: false, req, timeoutMs: 20_000 });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } });
}
