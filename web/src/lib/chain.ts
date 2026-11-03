// Read-only views of the dish contract over JSON-RPC, with failover between providers.

import { CONTRACT, RPC_URLS } from "./config";

export type Rules = {
  width: number;
  height: number;
  generation_ms: string;
  max_supply: string;
  feed_ppm: number;
  keeper_bps: number;
  /** A colony is paid for at most this many living cells per cell of stake. */
  reach: number;
  /** Share of each colony's stake left after every tide. */
  stake_keep_bps: number;
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
  tide_bounty_bps: number;
  /** yoctoNEAR: the tide bounty never exceeds this */
  max_bounty: string;
  sell_bps: number;
  sell_cap_bps: number;
  siege_x: number;
  buffer: number;
  max_plant_cells: number;
  max_catchup: number;
  /** When the dish is this far behind the clock, the clock skips ahead. */
  max_lag: number;
  house: string[];
};

export type DishState = {
  generation: string;
  due_generation: string;
  epoch_ms: string;
  now_ms: string;
  chain: string;
  board_hash: string;
  total_live: number;
  /** cells the last feed counted; prices are set against this */
  counted: number;
  colonies: number;
  ledger: string;
  plants: string;
  total_supply: string;
  agar: string;
  sold: string;
  fed: string;
  returned: string;
  burned: string;
  bought_back: string;
  unclaimed: string;
  keeper_pot: string;
  keeper_paid: string;
  /** yoctoNEAR waiting in the tide vault */
  vault: string;
  near_in: string;
  /** NEAR the tides made claimable (shares of colonies that have attached NEAR) */
  near_tides: string;
  /** the vault's tide shares paid as credit to colonies that never attached NEAR (counted in credit_won too) */
  near_as_credit: string;
  near_bounties: string;
  near_sold: string;
  near_refunded: string;
  /** NEAR tide winnings not yet claimed */
  tides_owed: string;
  /** yoctoNEAR the agar may still pay for PETRI before the next tide */
  sell_left: string;
  /** sponsored NEAR waiting in the credit pool, paid out as credit at tides */
  credit_pool: string;
  credit_in: string;
  credit_given: string;
  /** credit spent in the dish, won or sponsored */
  credit_spent: string;
  /** credit won at the tides: the credit pool's shares and the vault's shares paid as credit */
  credit_won: string;
  /** credit paid for PETRI sold back by colonies that never attached NEAR */
  credit_sold: string;
  credit_reclaimed: string;
  /** tides that ran; a tide with nobody to pay is skipped */
  tides: string;
  skipped: string;
  house: number[];
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
  house: boolean;
  payout: string | null;
  joined_generation: string;
  last_plant_generation: string | null;
  cells_planted: string;
  petri_spent: string;
  petri_burned: string;
  petri_claimed: string;
  petri_sold: string;
  near_paid: string;
  near_claimed: string;
  near_sold: string;
  /** credit won at the tides, from the credit pool and as vault shares */
  credit_won: string;
};

export type PlantRecord = { index: string; generation: string; colony: number; cells: number[]; cost: string; siege: boolean; note: string | null };
export type Entry =
  | { Join: { generation: string; colony: number } }
  | { Buy: { generation: string; colony: number; petri: string; near: string; credit: string } }
  | { Plant: { generation: string; colony: number; cells: number[]; cost: string; near: string; credit: string; siege: boolean } }
  | { Sell: { generation: string; colony: number; petri: string; near: string; paid: string; as_credit: boolean } }
  | { Tide: { generation: string; chain: string; pay: string; bounty: string; storage: string; paid: string; as_credit: string; credit_pay: string; credit_paid: string } }
  | { Skip: { generation: string; skipped: string } }
  | { Refund: { generation: string; colony: number; near: string } };

export const entryGeneration = (e: Entry): number => Number(Object.values(e)[0].generation);
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

/** Reads can be pinned to one block so a replay compares numbers from a single moment. */
let pinned: number | null = null;

/** Pin every following read to the latest final block (or unpin with `null`). Returns the block height. */
export async function pinFinalBlock(on = true): Promise<number | null> {
  if (!on) {
    pinned = null;
    return null;
  }
  const b = await rpc<{ header: { height: number } }>("block", { finality: "final" });
  pinned = b.header.height;
  return pinned;
}

export async function view<T>(method: string, args: Record<string, unknown> = {}, contract = CONTRACT): Promise<T> {
  const argsB64 = btoa(JSON.stringify(args));
  const r = await rpc<{ result: number[]; logs: string[] } & { error?: string }>("query", {
    request_type: "call_function",
    ...(pinned !== null ? { block_id: pinned } : { finality: "optimistic" }),
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
export const getTideWinnings = (from = 0, limit = 2000) => view<string[]>("tide_winnings", { from, limit });
export const getStakes = (from = 0, limit = 2000) => view<string[]>("stakes", { from, limit });
export const getCredit = (account_id: string) => view<string>("credit_of", { account_id });
export const getSellQuote = (petri: string) => view<string>("sell_quote", { petri });
export const getCheckpoints = (from = 0, limit = 2000) => view<Checkpoint[]>("checkpoints", { from, limit });
export const getBalance = (account_id: string) => view<string>("ft_balance_of", { account_id });
export const getClaimable = (account_id: string) => view<Claimable>("claimable", { account_id });
export const getQuote = (cells: number, siege = false) => view<string>("quote", { cells, siege });
export const getBuyQuote = (near: string) => view<string>("buy_quote", { near });
export const getPlantDeposit = (cells: number, note_bytes: number | null) => view<string>("plant_deposit", { cells, note_bytes });
export const getColonyOf = (account_id: string) => view<Colony | null>("colony_of", { account_id });

/** An account's NEAR balance in yoctoNEAR (what a guest has left for deposits). */
export async function getNearBalance(account_id: string): Promise<bigint> {
  const r = await rpc<{ amount: string }>("query", { request_type: "view_account", finality: "optimistic", account_id });
  return BigInt(r.amount);
}

/** The contract account's deployed code hash and access keys, to show that nobody can change the code. */
export async function getLock(account_id = CONTRACT): Promise<{ codeHash: string; fullAccessKeys: number; keys: number; balance: string; storageUsage: number }> {
  const at = pinned !== null ? { block_id: pinned } : { finality: "final" };
  const acct = await rpc<{ code_hash: string; amount: string; storage_usage: number }>("query", { request_type: "view_account", account_id, ...at });
  const list = await rpc<{ keys: { access_key: { permission: unknown } }[] }>("query", { request_type: "view_access_key_list", account_id, ...at });
  const full = list.keys.filter((k) => k.access_key.permission === "FullAccess").length;
  return { codeHash: acct.code_hash, fullAccessKeys: full, keys: list.keys.length, balance: acct.amount, storageUsage: acct.storage_usage };
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
