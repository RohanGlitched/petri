// The open swarm's public registry (spawned strains, council rounds and deals, break-the-pact attempts), passed through
// from the agents VM so the page can be served over HTTPS.

import { swarmGet } from "@/lib/swarm-server";

export const dynamic = "force-dynamic";

export async function GET() {
  return swarmGet("/swarm");
}
