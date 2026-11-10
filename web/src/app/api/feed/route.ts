// The latest transactions on a dish, from NearBlocks (API v3), for the judge desk's trade feed. Calls to the contract
// come from its own transaction list; on testnet, guests' moves are meta transactions the relayer submits to the
// guest's own account, so the relayer's list is read too and each delegate action is shown as the guest's. Read-only,
// cached for a minute so the public API's rate limit is never hit by visitors.

import { CONTRACTS, type Network } from "@/lib/config";

export const revalidate = 60;

const API: Record<Network, string> = { mainnet: "https://api.nearblocks.io/v3", testnet: "https://api-testnet.nearblocks.io/v3" };
const RELAYER = process.env.PETRI_RELAYER_ACCOUNT ?? "petri-guests.testnet";
/** Mainnet free play's relayer (during judging), whose meta transactions are its guests' moves. */
const MAINNET_RELAYER = process.env.PETRI_MAINNET_GUESTS === "1" ? process.env.PETRI_MAINNET_RELAYER_ACCOUNT?.trim() : undefined;

type Txn = {
  transaction_hash: string;
  signer_account_id: string;
  receiver_account_id: string;
  block_timestamp: string;
  actions: { action: string; method: string | null }[];
  outcomes?: { status?: boolean };
};
export type FeedRow = { hash: string; at: number; account: string; method: string; ok: boolean; relayed: boolean };

async function list(net: Network, account: string, limit: number): Promise<Txn[]> {
  const headers: Record<string, string> = {};
  if (process.env.NEARBLOCKS_API_KEY) headers.authorization = `Bearer ${process.env.NEARBLOCKS_API_KEY}`;
  const res = await fetch(`${API[net]}/accounts/${account}/txns?limit=${limit}`, { headers, next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`NearBlocks answered ${res.status}`);
  const body = await res.json();
  return (body.data ?? []) as Txn[];
}

export async function GET(req: Request) {
  const net: Network = new URL(req.url).searchParams.get("net") === "mainnet" ? "mainnet" : "testnet";
  const contract = CONTRACTS[net];
  try {
    const [direct, relayed] = await Promise.all([list(net, contract, 50), net === "testnet" ? list(net, RELAYER, 50).catch(() => [] as Txn[]) : MAINNET_RELAYER ? list(net, MAINNET_RELAYER, 50).catch(() => [] as Txn[]) : Promise.resolve([] as Txn[])]);
    const rows: FeedRow[] = [];
    for (const t of direct) {
      const fc = t.actions.find((a) => a.action === "FUNCTION_CALL");
      if (!fc?.method || t.receiver_account_id !== contract) continue;
      rows.push({ hash: t.transaction_hash, at: Math.floor(Number(t.block_timestamp) / 1e6), account: t.signer_account_id, method: fc.method, ok: t.outcomes?.status !== false, relayed: false });
    }
    for (const t of relayed) {
      if (!t.actions.some((a) => a.action === "DELEGATE_ACTION")) continue;
      const fc = [...t.actions].reverse().find((a) => a.action === "FUNCTION_CALL");
      if (!fc?.method) continue;
      rows.push({ hash: t.transaction_hash, at: Math.floor(Number(t.block_timestamp) / 1e6), account: t.receiver_account_id, method: fc.method, ok: t.outcomes?.status !== false, relayed: true });
    }
    rows.sort((a, b) => b.at - a.at);
    return Response.json({ net, rows: rows.slice(0, 60) }, { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } });
  } catch (e) {
    return Response.json({ net, rows: [], error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
