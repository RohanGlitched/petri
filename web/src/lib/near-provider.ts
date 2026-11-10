// A near-api-js provider over every keyless provider of a network, for signing: guest keys, the lab and the relayer.
// One provider answering 429 no longer stops a join or a planting; near-api-js moves to the next.

import { FailoverRpcProvider, JsonRpcProvider, type Provider } from "near-api-js";
import { RPCS, type Network } from "./config";

const made = new Map<Network, Provider>();

export function nearProvider(net: Network): Provider {
  let p = made.get(net);
  if (!p) {
    p = new FailoverRpcProvider(RPCS[net].map((url) => new JsonRpcProvider({ url }, { retries: 2, backoff: 1.6, wait: 500 })));
    made.set(net, p);
  }
  return p;
}
