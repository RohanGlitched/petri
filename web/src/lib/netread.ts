// Read-only views of either dish, whichever one this page reads. The judge desk shows both dishes side by side, so it
// cannot use chain.ts, whose calls follow the network chosen for the page.
//
// The heavy read (rules, state, every colony, the whole ledger, every slide, earnings, winnings, the contract account
// and its keys) is made once per final block and shared: pinned to the block /api/head names, through the site's
// immutable cache (/api/view), kept in memory for the visit and in IndexedDB across reloads for two minutes. /judges,
// /verify, /coin and /records all replay from it, so opening all four reads the ledger once, not four times.

import { CONTRACTS, type Network } from "./config";
import type { Colony, DishState, Entry, Rules, SlideView } from "./chain";
import { b64, decodeView, rpcCall, withRetries } from "./rpc";
import { accountAt, keysAt, pagedAt, sharedHead, viewAt, type AccessKeyList } from "./shared-read";

/** Each network's reads can be pinned to one final block, so a dish read while transactions land is still one moment. */
const pinned: Partial<Record<Network, number>> = {};

/** Pin every following read on `net` to a recent final block. Returns the height. */
export async function pin(net: Network): Promise<number> {
  pinned[net] = await sharedHead(net);
  return pinned[net]!;
}
export const unpin = (net: Network) => void delete pinned[net];

export async function netView<T>(net: Network, method: string, args: Record<string, unknown> = {}, contract = CONTRACTS[net]): Promise<T> {
  const at = pinned[net];
  if (at !== undefined) return viewAt<T>(net, at, method, args, contract);
  const r = await rpcCall<{ result?: number[] }>(net, "query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: b64(args) }, { id: "petri-desk" });
  return decodeView<T>(r);
}

export type AccessKey = AccessKeyList["keys"][number];

export async function accountOf(net: Network, account_id: string) {
  const block = pinned[net] ?? (await sharedHead(net));
  const [acct, keys] = await Promise.all([accountAt(net, block, account_id), keysAt(net, block, account_id)]);
  return { codeHash: acct.code_hash, balance: acct.amount, storageUsage: acct.storage_usage, keys: keys.keys, fullAccess: keys.keys.filter((k) => k.access_key.permission === "FullAccess").length };
}

/** NEP-330: where the deployed code came from and how it was built. */
export type SourceMeta = { version?: string; link?: string; standards?: { standard: string; version: string }[]; build_info?: { build_environment?: string; build_command?: string[]; source_code_snapshot?: string } };

/** Everything the desk counts on one dish. */
export type DishRead = { net: Network; rules: Rules; state: DishState; colonies: Colony[]; ledger: Entry[]; slides: SlideView[] };

/** One dish, whole, at one final block: what every replay on the site starts from. */
export type FullRead = DishRead & {
  block: number;
  /** When it was read (ms since the epoch). */
  at: number;
  earnings: string[];
  winnings: string[];
  account: { codeHash: string; balance: string; storageUsage: number };
  keys: AccessKey[];
  meta: SourceMeta | null;
};

/** How long a read is shared between pages before a page reads a newer block. */
const SHARE_MS = 120_000;
const memory = new Map<Network, { at: number; p: Promise<FullRead> }>();

const IDB = "petri.reads";
function idb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(IDB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("full");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
async function idbGet(net: Network): Promise<FullRead | null> {
  const db = await idb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const r = db.transaction("full").objectStore("full").get(net);
      r.onsuccess = () => resolve((r.result as FullRead | undefined) ?? null);
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
async function idbPut(net: Network, v: FullRead): Promise<void> {
  const db = await idb();
  if (!db) return;
  try {
    db.transaction("full", "readwrite").objectStore("full").put(v, net);
  } catch {
    /* a full or blocked store: this visit keeps it in memory */
  }
}

async function readFull(net: Network): Promise<FullRead> {
  const block = await sharedHead(net);
  const at = Date.now();
  const v = <T,>(method: string, args: Record<string, unknown> = {}) => viewAt<T>(net, block, method, args);
  const [rules, state, acct, keys, meta] = await Promise.all([
    v<Rules>("rules"),
    v<DishState>("state"),
    accountAt(net, block),
    keysAt(net, block),
    v<SourceMeta>("contract_source_metadata").catch(() => null),
  ]);
  const n = state.colonies;
  const [colonies, ledger, slides, earnings, winnings] = await Promise.all([
    pagedAt<Colony>(net, block, "colonies", n, 500),
    pagedAt<Entry>(net, block, "ledger", Number(state.ledger), 1000),
    pagedAt<SlideView>(net, block, "slides", Number(state.slides), 500),
    pagedAt<string>(net, block, "earnings", n, 500),
    pagedAt<string>(net, block, "tide_winnings", n, 500),
  ]);
  return {
    net,
    block,
    at,
    rules,
    state,
    colonies,
    ledger,
    slides,
    earnings,
    winnings,
    account: { codeHash: acct.code_hash, balance: acct.amount, storageUsage: acct.storage_usage },
    keys: keys.keys,
    meta,
  };
}

/** The whole dish at one final block, shared by every page for two minutes (`fresh` reads a newer block now). */
export function readDishAt(net: Network, { fresh = false }: { fresh?: boolean } = {}): Promise<FullRead> {
  const hit = memory.get(net);
  if (!fresh && hit && Date.now() - hit.at < SHARE_MS) return hit.p;
  const p = (async () => {
    if (!fresh) {
      const saved = await idbGet(net);
      if (saved && saved.net === net && Date.now() - saved.at < SHARE_MS) return saved;
    }
    const r = await withRetries(() => readFull(net));
    idbPut(net, r);
    return r;
  })();
  memory.set(net, { at: Date.now(), p });
  p.catch(() => memory.delete(net));
  return p;
}

export async function readDish(net: Network): Promise<DishRead> {
  return readDishAt(net);
}

/** The replay's inputs for one dish (see replay.ts), from the same read. */
export function forReplay(d: FullRead) {
  const n = d.state.colonies;
  return {
    earnings: d.earnings.slice(0, n),
    winnings: d.winnings.slice(0, n),
    lock: { codeHash: d.account.codeHash, fullAccessKeys: d.keys.filter((k) => k.access_key.permission === "FullAccess").length, balance: d.account.balance, storageUsage: d.account.storageUsage },
  };
}

export async function readForReplay(d: DishRead) {
  return forReplay(await readDishAt(d.net));
}
