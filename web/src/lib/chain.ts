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
  /** The dish's own strains: never fed, no tide share, never sell PETRI back or hand it to players. */
  house: string[];
  /** The dish's own keepers: like the house, they take no tide bounty and no keeper pot. */
  keepers: string[];
  /** PETRI units a specimen slide costs per living cell it captures, all burned. */
  slide_cells_price: string;
  /** A slide must capture at least this many of the colony's own living cells. */
  slide_min_cells: number;
  /** A planting of a slide's exact pattern under its licence costs this share less (basis points). */
  slide_discount_bps: number;
  /** Anyone but the slide's holder pays the holder this share of a licensed planting's cost, in PETRI (basis points); a
   * planter that has never attached NEAR pays it to the agar instead. */
  slide_royalty_bps: number;
  /** Only a slide that captured at least this many cells is a licence (v6.1; 12 on both dishes). */
  licence_min_cells: number;
  /** A colony bound by a pact may not plant within this many cells (across or down, wrapping) of the living cells of the
   * colony it protects (8 on both dishes). */
  pact_radius: number;
  /** A pact binds for at most this many generations from its offer (2,880, 12 hours, on both dishes). */
  pact_max_gens: number;
  /** The wNEAR contract whose `ft_transfer_call` joins or buys for the account its message names (NEAR Intents). */
  wnear: string | null;
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
  /** colonies with stake (planted in the last few days), whose numbers the contract keeps in its hot table */
  playing: number;
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
  /** NEAR that reached the vault: attached by players, and wNEAR too small for a pending record (`Dust`) */
  near_in: string;
  /** NEAR the tides made claimable (shares of colonies that have attached NEAR) */
  near_tides: string;
  /** the vault's tide shares paid as credit to colonies that never attached NEAR (counted in credit_won too) */
  near_as_credit: string;
  near_bounties: string;
  near_sold: string;
  /** failed bounty payouts that went back to the vault */
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
  /** specimen slides minted, and the PETRI they burned (counted in `burned` too) */
  slides: string;
  slides_burned: string;
  /** PETRI paid to slide holders in royalties */
  royalties: string;
  /** yoctoNEAR waiting for accounts to claim (wNEAR whose order has not run, failed payouts), wNEAR held and not yet
   * unwrapped, and how much of that is being unwrapped */
  pending: string;
  wrapped: string;
  unwrapping: string;
  wnear_ready: boolean;
  /** pacts offered so far, and the PETRI the dish holds for offers not yet accepted */
  pacts: string;
  pact_escrow: string;
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
  /** credit won at the tides, from the credit pool and as vault shares (and bounties, for a guest that ran a tide) */
  credit_won: string;
  /** started by someone else's payment (wNEAR through NEAR Intents) under a neutral name ("Culture" and hex digits of
   * its account's hash); the account may `rename` it once */
  proxy: boolean;
  /** whether the colony has ever put NEAR into the vault itself; one that has not (a guest) is paid in credit and cannot
   * send PETRI */
  attached: boolean;
  /** PETRI that stays in the dish: what it earned, bought with credit or was paid in royalties before its first NEAR
   * (a guest's unclaimed earnings included), and PETRI it has bought with credit since, less what it has planted or
   * minted since (kept PETRI is spent first). While it holds any, the colony cannot sell PETRI for NEAR, send PETRI or
   * pay for a pact. */
  kept: string;
};

/** A pact (the `pact` and `pacts_of` views): colony `from` paid colony `to` `petri` for its promise not to plant within
 * rules.pact_radius of `from`'s living cells before generation `until`. `binding` while accepted, not ended and
 * `until` still ahead of the stored generation. */
export type PactView = {
  id: number;
  from: number;
  to: number;
  petri: string;
  until: string;
  accepted: string | null;
  ended: string | null;
  binding: boolean;
};

export type PlantRecord = { index: string; generation: string; colony: number; cells: number[]; cost: string; siege: boolean; note: string | null; slide: string | null };
/** A planting under a slide's licence: the slide, how many times it had changed hands, the holder (none when the
 * planter held it), the royalty, and whether it went to the agar (the planter had never attached NEAR) instead of the
 * holder. */
export type Licence = { token: string; moves: number; holder: string | null; royalty: string; to_agar: boolean };
/** A Refund's `kind`: what the failed payout was (0 a claim, 1 a sale, 2 a bounty, 3 a sponsor's reclaim, 4 a pending
 * claim). */
export type PayoutKind = 0 | 1 | 2 | 3 | 4;
export type Entry =
  | { Join: { generation: string; colony: number } }
  | { Buy: { generation: string; colony: number; petri: string; near: string; credit: string; spent: string | null } }
  | { Plant: { generation: string; colony: number; cells: number[]; cost: string; near: string; credit: string; siege: boolean; spent: string | null; licence: Licence | null } }
  | { Sell: { generation: string; colony: number; petri: string; near: string; paid: string; as_credit: boolean } }
  /** v6.1 keeps only the chain, the bytes the tide stored and who ran it; what it paid follows from the ledger before
   * it (the replays work it out, see replay.ts `tidesPaid`) and is in the contract's `tide` event. */
  | { Tide: { generation: string; chain: string; bytes: number; by: number } }
  | { Skip: { generation: string; skipped: string } }
  | { Refund: { generation: string; colony: number; kind: PayoutKind; of: string; near: string; storage: string } }
  | { Slide: { generation: string; colony: number; token: string; x: number; y: number; w: number; h: number; cells: number; bitmap: string; cost: string; spent: string | null } }
  | { Sponsor: { generation: string; account: string; sponsor: string; amount: string } }
  | { Unsponsor: { generation: string; account: string; sponsor: string; amount: string } }
  | { Claim: { generation: string; colony: number; petri: string; near: string; paid: string } }
  | { Pending: { generation: string; account: string; near: string } }
  | { Unpend: { generation: string; account: string; near: string; paid: string } }
  | { Dust: { generation: string; near: string } }
  | { Burn: { generation: string; account: string; petri: string } }
  | { PactOffer: { generation: string; pact: number; from: number; to: number; petri: string; until: string; spent: string | null } }
  | { PactAccept: { generation: string; pact: number } }
  | { PactEnd: { generation: string; pact: number } };

/** One sponsor's credit for an account (the `credit_grants` view, oldest first, which is the order it is spent in). */
export type Grant = { sponsor: string; amount: string; at: string };
/** An account's pending NEAR and the order still waiting on it (the `pending_record` view). */
export type PendingRecord = { near: string; order_near: string; order: { join: boolean; name: string | null; color: number | null } | null };

/** A specimen slide as the `slides`, `slide` and `slides_for` views return it (no image: draw it with `slide_svg`
 * from the engine, which is exactly what the contract serves as the NFT's media). `bitmap` is base64: bit i of the
 * w × h rectangle, row by row from (x, y), is byte i >> 3, bit i & 7. */
export type SlideView = {
  token_id: string;
  owner_id: string;
  colony: number;
  /** the colony's name now */
  name: string;
  /** the colony's colour when it was minted */
  color: number;
  generation: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cells: number;
  title: string | null;
  bitmap: string;
  minted_ms: string;
  /** times the slide has changed hands */
  moves: number;
  /** PETRI its holders have been paid in royalties */
  royalties: string;
};

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
/** At most 500 a call; see getAllEarnings. */
export const getEarnings = (from = 0, limit = 500) => view<string[]>("earnings", { from, limit });
/** At most 500 a call; see getAllTideWinnings. */
export const getTideWinnings = (from = 0, limit = 500) => view<string[]>("tide_winnings", { from, limit });
export const getStakes = (from = 0, limit = 2000) => view<string[]>("stakes", { from, limit });
export const getCredit = (account_id: string) => view<string>("credit_of", { account_id });
export const getCreditGrants = (account_id: string) => view<Grant[]>("credit_grants", { account_id });
export const getSellQuote = (petri: string) => view<string>("sell_quote", { petri });
export const getCheckpoints = (from = 0, limit = 2000) => view<Checkpoint[]>("checkpoints", { from, limit });
export const getBalance = (account_id: string) => view<string>("ft_balance_of", { account_id });
export const getClaimable = (account_id: string) => view<Claimable>("claimable", { account_id });
/** PETRI units a planting costs now; `licensed` for one under a slide's licence (`slide_discount_bps` off). */
export const getQuote = (cells: number, siege = false, licensed = false) => view<string>("quote", { cells, siege, licensed });
export const getBuyQuote = (near: string) => view<string>("buy_quote", { near });
/** yoctoNEAR to bring to a planting; with `slide`, enough for one under that slide's licence (and for registering its
 * holder for PETRI if it has no registration). What storage does not use goes to the vault or credit pool with the fee. */
export const getPlantDeposit = (cells: number, note_bytes: number | null, slide: string | null = null) => view<string>("plant_deposit", { cells, note_bytes, slide });
export const getColonyOf = (account_id: string) => view<Colony | null>("colony_of", { account_id });
/** Slides in mint order (token "1" is the first), at most 500 a call. */
export const getSlides = (from = 0, limit = 100) => view<SlideView[]>("slides", { from, limit });
export const getSlide = (token_id: string) => view<SlideView | null>("slide", { token_id });
export const getSlidesFor = (account_id: string, from = 0, limit = 100) => view<SlideView[]>("slides_for", { account_id, from, limit });
/** yoctoNEAR to attach to a slide of w × h with a title of `title_bytes` UTF-8 bytes; what is not used comes back. */
export const getSlideDeposit = (w: number, h: number, title_bytes: number | null) => view<string>("slide_deposit", { w, h, title_bytes });
/** yoctoNEAR waiting for an account to claim with `claim_pending` (wNEAR sent for it that could not join or buy). */
export const getPending = (account_id: string) => view<string>("pending_of", { account_id });
export const getPendingRecord = (account_id: string) => view<PendingRecord | null>("pending_record", { account_id });
/** The least wNEAR a payment for `account_id` must deliver for its order ("join" or "buy") to run. */
export const getIntentMinimum = (what: "join" | "buy", account_id: string) => view<string>("intent_minimum", { what, account_id });
/** The pacts a colony is party to that have not ended (at most 8), and one pact by number. */
export const getPactsOf = (account_id: string) => view<PactView[]>("pacts_of", { account_id });
export const getPact = (id: number) => view<PactView | null>("pact", { id });
/** yoctoNEAR that always covers a pact offer's storage (attached, or as credit); what is not used comes back. */
export const PACT_DEPOSIT = 4_200_000_000_000_000_000_000n;
/** PETRI a slide's holders have been paid in royalties, in all. */
export const getSlideRoyalties = (token_id: string) => view<string>("slide_royalties", { token_id });

/** Decode a slide's base64 bitmap for `slide_svg` or for drawing cells yourself. */
export function slideBits(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/*
 * Calls for the wallet (wallet.ts), as the contract takes them:
 *
 * mintSlide: method "mint_slide", args { x, y, w, h, title: string | null, credit: string | null } (w and h 4 to 32;
 *   x, y the rectangle's top-left cell; the rectangle wraps at the dish's edges). Attach getSlideDeposit(w, h, bytes)
 *   yoctoNEAR (unused NEAR comes back), or pass that much as `credit` for a guest; 300 TGas (it catches the dish up
 *   first). Returns the token id. It needs at least rules.slide_min_cells of the caller's own living cells inside the
 *   rectangle at the stored generation and burns rules.slide_cells_price PETRI per cell (unclaimed earnings count).
 * claimPending: method "claim_pending", args {}, no deposit, 30 TGas. Sends the caller its pending NEAR.
 * settlePending: method "settle_pending", args { account_id }, no deposit, 100 TGas. Anyone may call it: it runs the
 *   order waiting with that account's pending NEAR (a join, or a purchase for a colony), with only the NEAR that came
 *   with the order. Fails, changing nothing, while the order cannot run.
 * plant with a licence: method "plant", args { cells, note, credit, slide: "<token id>" }: the cells must be exactly the
 *   slide's pattern moved anywhere (not turned), and the slide must hold at least rules.licence_min_cells cells; it
 *   costs slide_discount_bps less, and a planter that does not hold the slide also pays slide_royalty_bps of that cost
 *   in PETRI, to the holder (or to the agar, for a planter that has never attached NEAR). Attach
 *   getPlantDeposit(n, bytes, slide). A colony with no hot row is refused while 10,000 colonies play at once.
 * rename: method "rename", args { name, color }, no deposit. Only for a colony started by someone else's payment
 *   (`proxy`), once. Names "Culture <hex digits>" are reserved for such colonies.
 * NEP-171: "nft_transfer" { receiver_id, token_id, approval_id: null, memo: null } with exactly 1 yoctoNEAR attached.
 * pactOffer: method "pact_offer", args { to: "<account with a colony>", petri: "<PETRI units>", until: "<generation>", credit },
 *   bring PACT_DEPOSIT (0.0042 NEAR) attached or as `credit` (a string, yoctoNEAR; what is not used comes back), 300 TGas (it catches the dish up first). The PETRI
 *   is held until `to` accepts; it must be PETRI the colony could sell (none if it holds kept PETRI or never attached
 *   NEAR; a house colony offers players none). `until` is after the stored generation and at most rules.pact_max_gens
 *   ahead. One open offer to a colony at a time; a colony is party to at most 8 pacts. Returns the pact's number.
 * pactAccept: method "pact_accept", args { id }, no deposit, 30 TGas. Pays the caller's colony the pact's PETRI; from
 *   then until `until` the dish refuses its plantings within rules.pact_radius of the offering colony's living cells.
 * pactCancel: method "pact_cancel", args { id }, no deposit, 30 TGas. Ends an open offer (by either colony, or by anyone
 *   once it expired; its PETRI goes back), or an accepted pact once its `until` has come (by anyone).
 * Kept PETRI: a colony with `kept` above zero is refused "sell" for NEAR, "ft_transfer", "ft_transfer_call" and paid
 *   pacts until it has planted (or minted slides with) that much; a guest (`attached` false) cannot send PETRI at all.
 *
 * Paying with NEAR Intents: 1Click's `customRecipientMsg` (wNEAR delivered to the dish with ft_transfer_call) is the
 * JSON string {"for": "<account>", "do": "join" | "buy", "name": "<colony name>", "color": <0xRRGGBB as a number>}.
 * Nothing is refunded: at least getIntentMinimum(do, for) runs the order; "join" for an account that already has a
 * colony buys instead; a colony started for an account by someone else's payment gets a neutral name (the name in the
 * message is used only when the account sends its own wNEAR); anything that cannot be done waits as pending NEAR with
 * its order for "for" (see getPendingRecord), which settle_pending completes and claim_pending takes back.
 */

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
async function paged500<T>(total: number, page: (from: number, limit: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < total; from += 500) out.push(...(await page(from, 500)));
  return out.slice(0, total);
}
/** Every colony's lifetime earnings, in colony order (the view returns at most 500 a call). */
export const getAllEarnings = (total: number) => paged500(total, getEarnings);
export const getAllTideWinnings = (total: number) => paged500(total, getTideWinnings);
export const getAllSlides = (total: number) => paged500(total, getSlides);
export async function getAllColonies(total: number): Promise<Colony[]> {
  const out: Colony[] = [];
  for (let from = 0; from < total; from += 500) out.push(...(await getColonies(from, 500)));
  return out.slice(0, total);
}

export function colorHex(c: number): string {
  return "#" + c.toString(16).padStart(6, "0");
}
