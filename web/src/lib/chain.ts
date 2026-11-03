// Read-only views of the dish contract over JSON-RPC, with failover between providers.

import { CONTRACT, RPC_URLS } from "./config";

export type Rules = {
  width: number;
  height: number;
  generation_ms: string;
  max_supply: string;
  feed_ppm: number;
  keeper_bps: number;
  cap_bps: number;
  cap_min: number;
  burn_bps: number;
  payback: number;
  min_cell_price: string;
  live_floor: number;
  /** yoctoNEAR per PETRI at launch */
  petri_price: string;
  min_join: string;
  cell_fee: string;
  tide_every: number;
  tide_bps: number;
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
  ledger: string;
  plants: string;
  total_supply: string;
  agar: string;
  sold: string;
  fed: string;
  returned: string;
  burned: string;
  keeper_pot: string;
  keeper_paid: string;
  /** yoctoNEAR waiting in the tide vault */
  vault: string;
  near_in: string;
  near_tides: string;
  tides: string;
  /** PETRI units per cell right now */
  cell_price: string;
  /** yoctoNEAR per PETRI right now */
  petri_price: string;
};

export type Colony = {
  id: number;
  account: string;
  name: string;
  color: number;
  joined_generation: string;
  last_plant_generation: string | null;
  cells_planted: string;
  petri_spent: string;
  petri_burned: string;
  petri_claimed: string;
  near_paid: string;
  near_claimed: string;
};

export type PlantRecord = { index: string; generation: string; colony: number; cells: number[]; cost: string; note: string | null };
export type Entry =
  | { Join: { generation: string; colony: number } }
  | { Buy: { generation: string; colony: number; petri: string; near: string } }
  | { Plant: { generation: string; colony: number; cells: number[]; cost: string } };
export type Checkpoint = { generation: string; chain: string };
export type Claimable = { petri: string; near: string };

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
export const getLedger = (from = 0, limit = 1000) => view<Entry[]>("ledger", { from, limit });
export const getEarnings = (from = 0, limit = 2000) => view<string[]>("earnings", { from, limit });
export const getCheckpoints = (from = 0, limit = 2000) => view<Checkpoint[]>("checkpoints", { from, limit });
export const getBalance = (account_id: string) => view<string>("ft_balance_of", { account_id });
export const getClaimable = (account_id: string) => view<Claimable>("claimable", { account_id });
export const getQuote = (cells: number) => view<string>("quote", { cells });
export const getBuyQuote = (near: string) => view<string>("buy_quote", { near });
export const getPlantDeposit = (cells: number, note_bytes: number | null) => view<string>("plant_deposit", { cells, note_bytes });
export const getColonyOf = (account_id: string) => view<Colony | null>("colony_of", { account_id });

/** An account's NEAR balance in yoctoNEAR (what a guest has left for deposits). */
export async function getNearBalance(account_id: string): Promise<bigint> {
  const r = await rpc<{ amount: string }>("query", { request_type: "view_account", finality: "optimistic", account_id });
  return BigInt(r.amount);
}

async function paged<T>(total: number, page: (from: number, limit: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < total; from += 1000) out.push(...(await page(from, 1000)));
  return out.slice(0, total);
}
export const getAllPlants = (total: number) => paged(total, getPlants);
export const getAllLedger = (total: number) => paged(total, getLedger);
export async function getAllColonies(total: number): Promise<Colony[]> {
  const out: Colony[] = [];
  for (let from = 0; from < total; from += 500) out.push(...(await getColonies(from, 500)));
  return out.slice(0, total);
}

export function colorHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}
