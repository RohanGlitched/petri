// Read-only views of the dish contract over JSON-RPC, with failover between providers.

import { CONTRACT, RPC_URLS } from "./config";

export type Rules = {
  width: number;
  height: number;
  generation_ms: string;
  emission_per_generation: string;
  keeper_bps: number;
  plant_cost: string;
  starter_grant: string;
  buffer: number;
  max_plant_cells: number;
  max_catchup: number;
};

export type DishState = {
  generation: string;
  due_generation: string;
  epoch_ms: string;
  now_ms: string;
  chain: string;
  board_hash: string;
  total_live: number;
  colonies: number;
  plants: string;
  total_supply: string;
  granted: string;
  emitted: string;
  burned: string;
  keeper_paid: string;
};

export type Colony = {
  id: number;
  account: string;
  name: string;
  color: number;
  joined_generation: string;
  last_plant_generation: string | null;
  cells_planted: string;
  petri_burned: string;
  petri_earned: string;
};

export type PlantRecord = { generation: string; colony: number; cells: number[] };
export type Checkpoint = { generation: string; chain: string };

let preferred = 0;

async function rpc<T>(method: string, params: unknown, timeoutMs = 8000): Promise<T> {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < RPC_URLS.length; attempt++) {
    const i = (preferred + attempt) % RPC_URLS.length;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(RPC_URLS[i], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "petri", method, params }),
        signal: ctrl.signal,
        cache: "no-store",
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error) {
        const msg = body.error?.data ?? body.error?.cause?.name ?? body.error?.message ?? "RPC error";
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      preferred = i;
      return body.result as T;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Every NEAR RPC provider failed");
}

export async function view<T>(method: string, args: Record<string, unknown> = {}, contract = CONTRACT): Promise<T> {
  const argsB64 = btoa(JSON.stringify(args));
  const r = await rpc<{ result: number[]; logs: string[] } & { error?: string }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: argsB64,
  });
  if (r.error) throw new Error(r.error);
  const text = new TextDecoder().decode(new Uint8Array(r.result));
  return JSON.parse(text) as T;
}

export const getRules = () => view<Rules>("rules");
export const getState = () => view<DishState>("state");
export const getBoard = async () => {
  const b64 = await view<string>("board");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
export const getColonies = (from = 0, limit = 500) => view<Colony[]>("colonies", { from, limit });
export const getPlants = (from = 0, limit = 1000) => view<PlantRecord[]>("plants", { from, limit });
export const getCheckpoints = (from = 0, limit = 2000) => view<Checkpoint[]>("checkpoints", { from, limit });
export const getBalance = (account_id: string) => view<string>("ft_balance_of", { account_id });
export const getColonyOf = (account_id: string) => view<Colony | null>("colony_of", { account_id });

export async function getAllPlants(total: number): Promise<PlantRecord[]> {
  const out: PlantRecord[] = [];
  for (let from = 0; from < total; from += 1000) {
    out.push(...(await getPlants(from, 1000)));
  }
  return out;
}

export function colorHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}
