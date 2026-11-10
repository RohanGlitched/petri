// Living slides: a specimen slide sealed into its own keyless account (a purse) that plays on the dish as a colony,
// keeps what it earns and is itself a one-token NEP-171 contract. See purse/ and docs/SLIDES-THREAT-MODEL.md.
//
// Server-safe: the API routes use these reads too, with the network passed in.

import { CONTRACTS, RPCS, type Network } from "./config";

/** The factory each dish's living slides are made by: `slide-<id>.<factory>`. None on mainnet until it is deployed. */
export const FACTORIES: Record<Network, string | null> = {
  testnet: process.env.NEXT_PUBLIC_PETRI_SLIDES_TESTNET ?? "petri-slides.testnet",
  mainnet: process.env.NEXT_PUBLIC_PETRI_SLIDES_MAINNET ?? null,
};

export const purseOf = (token: string, net: Network): string | null => (FACTORIES[net] ? `slide-${token}.${FACTORIES[net]}` : null);

/** The slide id a purse account is named for, if it is one of this network's purses. */
export function tokenOfPurse(account: string, net: Network): string | null {
  const f = FACTORIES[net];
  if (!f) return null;
  const m = account.match(/^slide-([1-9]\d{0,9})\.(.+)$/);
  return m && m[2] === f ? m[1] : null;
}

/** A slide is living when its owner on the dish is its own purse. */
export const isLiving = (token: string, owner: string | null | undefined, net: Network) => !!owner && owner === purseOf(token, net);

/** The message a holder signs (NEP-413) to open a living slide's darkroom. */
export const darkroomMessage = (token: string, net: Network, issued: string) => `Open the darkroom of living slide #${token} on NEAR ${net}. Issued ${issued}.`;

export type PurseInfo = {
  token_id: string;
  dish: string;
  factory: string;
  holder: string;
  /** Bumped by every change a buyer would care about; `buy` is pinned to it. */
  nonce: number;
  /** yoctoNEAR, when listed on its own market. */
  price: string | null;
  approvals: number;
  in_flight: number;
  in_flight_since: number;
  balance: string;
  locked: string;
  available: string;
  storage_bytes: number;
  moves: number;
  sales: number;
  sales_volume: string;
  near_out: string;
  petri_out: string;
  acts: string[];
};

export type PurseLogEntry = { kind: "seal" | "transfer" | "sale" | "withdraw" | "ft_withdraw" | "release" | "returned" | "failed"; account: string; amount: string; at_ms: number };
export type PurseHistory = { total: number; entries: PurseLogEntry[] };
export type AccessKey = { public_key: string; access_key: { nonce: number; permission: unknown } };

async function rpc<T>(net: Network, method: string, params: unknown): Promise<T> {
  let last: unknown = null;
  for (const url of RPCS[net]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "petri-living", method, params }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error) throw new Error(typeof body.error?.data === "string" ? body.error.data : body.error?.cause?.name ?? "RPC error");
      return body.result as T;
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("NEAR did not answer");
}

export async function viewOn<T>(net: Network, account: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result?: number[]; error?: string }>(net, "query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: account,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  if (!r.result) throw new Error(r.error ?? "view failed");
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export const dishView = <T>(net: Network, method: string, args: Record<string, unknown> = {}) => viewOn<T>(net, CONTRACTS[net], method, args);

/** The account's access keys: a purse's list is empty, and has been since the receipt that created it. */
export async function accessKeysOf(net: Network, account: string): Promise<AccessKey[]> {
  const r = await rpc<{ keys: AccessKey[] }>(net, "query", { request_type: "view_access_key_list", finality: "optimistic", account_id: account });
  return r.keys ?? [];
}

export type AccountView = { amount: string; code_hash: string; storage_usage: number };
export async function accountView(net: Network, account: string): Promise<AccountView | null> {
  try {
    return await rpc<AccountView>(net, "query", { request_type: "view_account", finality: "optimistic", account_id: account });
  } catch {
    return null;
  }
}

/**
 * The stored board's owners, one per cell (0 for bare agar), from the contract's compact form: `8 * words * height`
 * bytes of liveness rows (u64 little-endian, `words` per row), then a u16 owner for each live cell in index order.
 */
export function decodeBoard(bytes: Uint8Array, width: number, height: number): Uint16Array {
  const words = Math.ceil(width / 64);
  const nb = words * height * 8;
  const out = new Uint16Array(width * height);
  if (bytes.length < nb) return out;
  let o = nb;
  for (let y = 0; y < height; y++) {
    for (let k = 0; k < words; k++) {
      const base = (y * words + k) * 8;
      for (let byte = 0; byte < 8; byte++) {
        const v = bytes[base + byte];
        if (!v) continue;
        for (let bit = 0; bit < 8; bit++) {
          if (!((v >> bit) & 1)) continue;
          const x = k * 64 + byte * 8 + bit;
          if (x >= width || o + 1 >= bytes.length) continue;
          out[y * width + x] = bytes[o] | (bytes[o + 1] << 8);
          o += 2;
        }
      }
    }
  }
  return out;
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The colony's living cells on a wrapping board, cropped to the smallest window that holds them (at most `max` a side). */
export function colonyCrop(owners: Uint16Array, width: number, height: number, colony: number, max = 48): { x: number; y: number; w: number; h: number; cells: [number, number][] } | null {
  const pts: [number, number][] = [];
  for (let i = 0; i < owners.length; i++) if (owners[i] === colony) pts.push([i % width, Math.floor(i / width)]);
  if (!pts.length) return null;
  // Shift so the colony does not straddle the wrap: start just after the widest empty gap on each axis.
  const start = (vals: number[], n: number) => {
    const s = [...new Set(vals)].sort((a, b) => a - b);
    let best = 0;
    let at = s[0];
    for (let i = 0; i < s.length; i++) {
      const next = i + 1 < s.length ? s[i + 1] : s[0] + n;
      if (next - s[i] > best) {
        best = next - s[i];
        at = next % n;
      }
    }
    return at;
  };
  const x0 = start(pts.map((p) => p[0]), width);
  const y0 = start(pts.map((p) => p[1]), height);
  const rel = pts.map(([x, y]) => [(x - x0 + width) % width, (y - y0 + height) % height] as [number, number]);
  const w = Math.min(max, Math.max(...rel.map((p) => p[0])) + 1);
  const h = Math.min(max, Math.max(...rel.map((p) => p[1])) + 1);
  return { x: x0, y: y0, w, h, cells: rel.filter(([x, y]) => x < w && y < h) };
}
