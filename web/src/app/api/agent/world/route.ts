// GET /api/agent/world?account=<id>[&temperament=gardener|raider|engineer|wanderer|chaos]
// What an outside agent sees: its colony, threats, the plantings the contract accepts from it now (with forecasts),
// pacts, prices and the council. Computed on the agents VM with the contract's own rules (agents/swarm/world.mjs).

import { swarmGet } from "@/lib/swarm-server";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const account = q.get("account") ?? "";
  if (account && !/^[a-z0-9._-]{2,64}$/.test(account)) return Response.json({ error: "account must be a NEAR account id" }, { status: 400 });
  const temperament = q.get("temperament") ?? "gardener";
  return swarmGet(`/swarm/world?account=${encodeURIComponent(account)}&temperament=${encodeURIComponent(temperament)}`, req);
}
