// Any view of a dish (or of a living slide's purse) at a final block, cached forever: a final block never changes, so
// the answer is the same for every visitor. The heavy readers (/verify, /coin, /judges, /records, the ledger pages) pin
// a block from /api/head and read through here, so the CDN answers most of their calls instead of the public RPC.
// Read-only: views, accounts and access-key lists, nothing else.
//
//   GET /api/view?net=testnet&block=<final height>&kind=call&account=<dish>&method=<view>&args=<base64 JSON>
//   GET /api/view?net=mainnet&block=<final height>&kind=account|keys&account=<dish>

import { CONTRACTS, type Network } from "@/lib/config";
import { PARENTS } from "@/lib/living";
import { RpcAnswer, rpcCall } from "@/lib/rpc";
import { finalHeight } from "@/lib/final-head";

export const dynamic = "force-dynamic";

const FOREVER = "public, max-age=31536000, s-maxage=31536000, immutable";
const mem = new Map<string, { status: number; body: string }>();

function allowed(net: Network, account: string): boolean {
  if (account === CONTRACTS[net] || account === PARENTS[net]) return true;
  return new RegExp(`^slide-[1-9][0-9]{0,9}\.${PARENTS[net].replace(/\./g, "\.")}$`).test(account);
}

const bad = (error: string) => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const net: Network = q.get("net") === "mainnet" ? "mainnet" : "testnet";
  const block = Number(q.get("block"));
  const kind = q.get("kind") ?? "call";
  const account = q.get("account") ?? CONTRACTS[net];
  const method = q.get("method") ?? "";
  const args = q.get("args") ?? "e30=";
  if (!Number.isSafeInteger(block) || block <= 0) return bad("block must be a final block height");
  if (kind !== "call" && kind !== "account" && kind !== "keys") return bad("kind is call, account or keys");
  if (!allowed(net, account)) return bad("only the dish, its slide factory and living slides are served here");
  if (kind === "call" && (!/^[a-z_][a-z0-9_]{0,63}$/.test(method) || args.length > 2048 || !/^[A-Za-z0-9+/=]*$/.test(args))) return bad("a view method and base64 JSON arguments");

  const key = `${net}|${block}|${kind}|${account}|${method}|${args}`;
  const hit = mem.get(key);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json", "cache-control": FOREVER } });

  try {
    // Only a block that is already final may be cached forever.
    const head = await finalHeight(net);
    if (block > head && block > (await finalHeight(net, 0))) return Response.json({ error: "that block is not final yet" }, { status: 409, headers: { "cache-control": "no-store" } });
    const params =
      kind === "call"
        ? { request_type: "call_function", block_id: block, account_id: account, method_name: method, args_base64: args }
        : { request_type: kind === "account" ? "view_account" : "view_access_key_list", block_id: block, account_id: account };
    let body: string;
    let status = 200;
    try {
      const r = await rpcCall<{ result?: number[] } & Record<string, unknown>>(net, "query", params, { id: "petri-view", timeoutMs: 9000 });
      if (kind === "call") {
        const text = Buffer.from(r.result ?? []).toString("utf8");
        JSON.parse(text);
        body = `{"v":${text}}`;
      } else {
        const { block_hash: _h, block_height: _b, ...rest } = r;
        body = JSON.stringify({ v: rest });
      }
    } catch (e) {
      // A view that panics at a final block panics there forever: that answer is cached too.
      if (!(e instanceof RpcAnswer)) throw e;
      status = 422;
      body = JSON.stringify({ error: e.message, final: true });
    }
    mem.set(key, { status, body });
    if (mem.size > 4000) mem.delete(mem.keys().next().value!);
    return new Response(body, { status, headers: { "content-type": "application/json", "cache-control": FOREVER } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
