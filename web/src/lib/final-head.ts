// The latest final block this server knows on each network (server-side; /api/head and /api/view share it).

import type { Network } from "./config";
import { rpcCall } from "./rpc";

const memo = new Map<Network, { at: number; height: number }>();

/** The latest final height on `net`, read again when older than `maxAgeMs`. */
export async function finalHeight(net: Network, maxAgeMs = 4000): Promise<number> {
  const hit = memo.get(net);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.height;
  const b = await rpcCall<{ header: { height: number } }>(net, "block", { finality: "final" }, { id: "petri-head" });
  memo.set(net, { at: Date.now(), height: b.header.height });
  return b.header.height;
}
