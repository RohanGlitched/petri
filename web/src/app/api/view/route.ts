// Any view of a dish (or of a living slide's purse) at a final block, cached forever: a final block never changes, so
// the answer is the same for every visitor. The heavy readers (/verify, /coin, /judges, /records, the ledger pages) pin
// a block from /api/head and read through here, so the CDN answers most of their calls instead of the public RPC.
// Read-only: views, accounts and access-key lists, nothing else.
//
// Trust: an answer is cached forever only when two independent RPC operators returned the very same bytes for it; with
// one answer (or two that differ) it is served for seconds, or refused. Only recent final blocks are served (the last
// ~600, which is what /api/head hands out), so the cache cannot be filled with arbitrary history, and each address may
// make a bounded number of uncached reads a minute.
//
//   GET /api/view?net=testnet&block=<final height>&kind=call&account=<dish>&method=<view>&args=<base64 JSON>
//   GET /api/view?net=mainnet&block=<final height>&kind=account|keys&account=<dish>

import { CONTRACTS, RPCS, type Network } from "@/lib/config";
import { PARENTS } from "@/lib/living";
import { keeperOn, strainsOn } from "@/lib/strains";
import { RpcAnswer, rpcCall } from "@/lib/rpc";
import { finalHeight } from "@/lib/final-head";
import { clientIp, limited } from "@/lib/swarm-server";

export const dynamic = "force-dynamic";

const FOREVER = "public, max-age=31536000, s-maxage=31536000, immutable";
/** One provider's answer, unchecked: shared briefly, never kept. */
const BRIEF = "public, max-age=5, s-maxage=10";
/** How far behind the latest final block a read may be pinned (about ten minutes of blocks). */
const WINDOW = 600;
/** Uncached reads one address may ask for a minute (a full /verify, /judges and /colonies tour stays well under it). */
const PER_MINUTE = 400;
const mem = new Map<string, { status: number; body: string }>();

function allowed(net: Network, account: string, kind: string): boolean {
  if (account === CONTRACTS[net] || PARENTS[net].includes(account)) return true;
  // The house strains' and the keeper's balances (view_account only), for the house runway on /strains.
  if (kind === "account" && (strainsOn(net).some((s) => s.account === account) || keeperOn(net) === account)) return true;
  const m = account.match(/^slide-[1-9][0-9]{0,9}\.(.+)$/);
  return !!m && PARENTS[net].includes(m[1]);
}

/** Two RPC operators for a network, each as its own failover list: the first provider's operator, and the second's. */
function operators(net: Network): [string[], string[]] {
  const all = RPCS[net];
  const op = (u: string) => new URL(u).host.split(".").slice(-2).join(".");
  const first = all.filter((u) => op(u) === op(all[0]));
  const rest = all.filter((u) => op(u) !== op(all[0]));
  return [first, rest.length ? rest : all.slice(1)];
}

/** One operator's answer, as the body this route would serve. A view that panics is the chain's answer too. */
async function answer(net: Network, kind: string, params: Record<string, unknown>, urls: string[]): Promise<{ status: number; body: string }> {
  try {
    const r = await rpcCall<{ result?: number[] } & Record<string, unknown>>(net, "query", params, { id: "petri-view", timeoutMs: 9000, urls });
    if (kind === "call") {
      const text = Buffer.from(r.result ?? []).toString("utf8");
      JSON.parse(text);
      return { status: 200, body: `{"v":${text}}` };
    }
    const { block_hash: _h, block_height: _b, ...rest } = r;
    return { status: 200, body: JSON.stringify({ v: rest }) };
  } catch (e) {
    // A view that panics at a final block panics there forever.
    if (!(e instanceof RpcAnswer)) throw e;
    return { status: 422, body: JSON.stringify({ error: e.message, final: true }) };
  }
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
  if (!allowed(net, account, kind)) return bad("only the dish, its slide factory, living slides and the house accounts are served here");
  if (kind === "call" && (!/^[a-z_][a-z0-9_]{0,63}$/.test(method) || args.length > 2048 || !/^[A-Za-z0-9+/=]*$/.test(args))) return bad("a view method and base64 JSON arguments");

  const key = `${net}|${block}|${kind}|${account}|${method}|${args}`;
  const hit = mem.get(key);
  if (hit) return new Response(hit.body, { status: hit.status, headers: { "content-type": "application/json", "cache-control": FOREVER } });

  if (limited(`view|${clientIp(req)}`, PER_MINUTE, 60_000)) return Response.json({ error: "too many uncached reads from this address; try again in a minute" }, { status: 429, headers: { "cache-control": "no-store", "retry-after": "30" } });
  try {
    // Only a block that is already final may be cached forever, and only a recent one (what /api/head hands out).
    const head = await finalHeight(net);
    if (block > head && block > (await finalHeight(net, 0))) return Response.json({ error: "that block is not final yet" }, { status: 409, headers: { "cache-control": "no-store" } });
    if (block < head - WINDOW) return Response.json({ error: `only the last ${WINDOW} final blocks are served here; read /api/head for a recent one` }, { status: 409, headers: { "cache-control": "no-store" } });
    const params =
      kind === "call"
        ? { request_type: "call_function", block_id: block, account_id: account, method_name: method, args_base64: args }
        : { request_type: kind === "account" ? "view_account" : "view_access_key_list", block_id: block, account_id: account };
    // The same read from two independent operators (each list fails over within one operator's endpoints only).
    const [a, b] = await Promise.allSettled(operators(net).map((urls) => answer(net, kind, params, urls)));
    const one = a.status === "fulfilled" ? a.value : b.status === "fulfilled" ? b.value : null;
    if (!one) throw (a as PromiseRejectedResult).reason;
    if (a.status === "fulfilled" && b.status === "fulfilled") {
      if (a.value.body !== b.value.body || a.value.status !== b.value.status)
        return Response.json({ error: "two RPC providers disagree about this read; not served" }, { status: 502, headers: { "cache-control": "no-store" } });
      mem.set(key, a.value);
      if (mem.size > 4000) mem.delete(mem.keys().next().value!);
      return new Response(a.value.body, { status: a.value.status, headers: { "content-type": "application/json", "cache-control": FOREVER } });
    }
    // Only one operator answered: the answer is served, but not kept.
    return new Response(one.body, { status: one.status, headers: { "content-type": "application/json", "cache-control": BRIEF, "x-petri-providers": "1" } });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
