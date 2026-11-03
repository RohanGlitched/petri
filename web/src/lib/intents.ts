// Pay with any token: NEAR Intents' 1Click API swaps a deposit on another chain into wNEAR and sends it to the dish
// contract with a message saying which account to join or buy for. The site's /api/intents routes pass requests to
// 1Click and pin everything that matters (destination asset, recipient, deadline); this module is what the page calls.

export const INTENTS_API = "https://1click.chaindefuser.com";
export const WNEAR = "nep141:wrap.near";

export type Origin = {
  id: string;
  symbol: string;
  chain: string;
  decimals: number;
  /** How the refund address is written on the origin chain. */
  address: "evm" | "sol" | "btc";
  /** Minutes the deposit address stays open. Bitcoin needs confirmations, so it gets longer. */
  minutes: number;
  /** A sensible first amount, in whole tokens. */
  start: string;
};

// Routes that are cheap for small amounts. Ethereum mainnet origins are left out on purpose: a refund there costs about
// $0.30, more than a typical stake.
export const ORIGINS: Origin[] = [
  { id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", symbol: "USDC", chain: "Base", decimals: 6, address: "evm", minutes: 60, start: "1" },
  { id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", symbol: "USDC", chain: "Solana", decimals: 6, address: "sol", minutes: 60, start: "1" },
  { id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", symbol: "USDC", chain: "Arbitrum", decimals: 6, address: "evm", minutes: 60, start: "1" },
  { id: "nep141:base.omft.near", symbol: "ETH", chain: "Base", decimals: 18, address: "evm", minutes: 60, start: "0.0005" },
  { id: "nep141:sol.omft.near", symbol: "SOL", chain: "Solana", decimals: 9, address: "sol", minutes: 60, start: "0.01" },
  // The Bitcoin bridge takes at least about 8,300 sats.
  { id: "nep141:btc.omft.near", symbol: "BTC", chain: "Bitcoin", decimals: 8, address: "btc", minutes: 180, start: "0.0001" },
];

export const originById = (id: string) => ORIGINS.find((o) => o.id === id) ?? null;

const ADDRESS: Record<Origin["address"], RegExp> = {
  evm: /^0x[0-9a-fA-F]{40}$/,
  sol: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
  btc: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
};
export const ADDRESS_HINT: Record<Origin["address"], string> = {
  evm: "a 0x address on that chain",
  sol: "a Solana address",
  btc: "a Bitcoin address (bc1…, 1… or 3…)",
};

export function refundOk(o: Origin, a: string): boolean {
  return ADDRESS[o.address].test(a.trim());
}

/** A decimal amount ("0.25") in base units, or null if it is not a positive number with at most `decimals` places. */
export function toBase(amount: string, decimals: number): string | null {
  const t = amount.trim();
  if (!/^\d*(\.\d*)?$/.test(t) || t === "" || t === ".") return null;
  const [i, f = ""] = t.split(".");
  if (f.length > decimals) return null;
  const v = BigInt((i || "0") + f.padEnd(decimals, "0"));
  return v > 0n ? v.toString() : null;
}

export function fromBase(base: string | bigint, decimals: number, dp = 6): string {
  const v = BigInt(base);
  const s = v.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).slice(0, dp).replace(/0+$/, "");
  return BigInt(i).toLocaleString("en-US") + (f ? "." + f : "");
}

export type Plan = { for: string; do: "join" | "buy"; name?: string; color?: number };

export type QuoteRequestIn = Plan & { dry: boolean; originAsset: string; amount: string; refundTo?: string };

export type Quote = {
  depositAddress?: string;
  depositMemo?: string;
  amountIn: string;
  amountInFormatted: string;
  amountInUsd: string;
  minAmountIn: string;
  amountOut: string;
  amountOutFormatted: string;
  amountOutUsd: string;
  minAmountOut: string;
  deadline?: string;
  timeWhenInactive?: string;
  timeEstimate: number;
  refundFee?: string;
  withdrawFee?: string;
};

export type QuoteResponse = {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: Record<string, unknown> & { recipient: string; destinationAsset: string; customRecipientMsg?: string; deadline: string; appFees?: { recipient: string; fee: number }[] };
  quote: Quote;
};

export type SwapStatus = "KNOWN_DEPOSIT_TX" | "PENDING_DEPOSIT" | "INCOMPLETE_DEPOSIT" | "PROCESSING" | "SUCCESS" | "REFUNDED" | "FAILED";

export type StatusResponse = {
  status: SwapStatus;
  updatedAt: string;
  swapDetails?: {
    nearTxHashes?: string[];
    amountOut?: string;
    amountOutFormatted?: string;
    refundedAmount?: string;
    refundedAmountFormatted?: string;
    refundReason?: string;
    depositedAmountFormatted?: string;
    originChainTxHashes?: { hash: string; explorerUrl: string }[];
    destinationChainTxHashes?: { hash: string; explorerUrl: string }[];
  };
};

export type Token = { assetId: string; symbol: string; blockchain: string; decimals: number; price: number };

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `NEAR Intents answered ${res.status}.`);
  return body as T;
}

/** USD prices of the offered assets and of wNEAR, from 1Click (cached a minute by the site). */
export const getTokens = () => fetch("/api/intents/tokens").then((r) => json<{ tokens: Token[] }>(r)).then((b) => b.tokens);

export const getIntentsQuote = (req: QuoteRequestIn, signal?: AbortSignal) =>
  fetch("/api/intents/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req), signal }).then((r) => json<QuoteResponse>(r));

export const getIntentsStatus = (depositAddress: string, depositMemo?: string) =>
  fetch(`/api/intents/status?depositAddress=${encodeURIComponent(depositAddress)}${depositMemo ? `&depositMemo=${encodeURIComponent(depositMemo)}` : ""}`, { cache: "no-store" }).then((r) => json<StatusResponse>(r));

export const submitDepositTx = (depositAddress: string, txHash: string) =>
  fetch("/api/intents/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ depositAddress, txHash }) }).then((r) => json<StatusResponse>(r));

/** 1Click answers "Amount is too low for bridge, try at least 150000" in base units; say it in tokens. */
export function readableIntentsError(msg: string, o: Origin | null): string {
  const m = msg.match(/try at least (\d+)/i);
  if (m && o) return `That is below what the ${o.chain} bridge takes. Send at least ${fromBase(m[1], o.decimals, 8)} ${o.symbol}.`;
  return msg;
}

// Every real quote is kept in this browser: the quote and 1Click's signature are the evidence if a swap goes wrong.
const ORDERS = "petri.intents.v1";
export type SavedOrder = { savedAt: number; plan: Plan; origin: string; response: QuoteResponse; last?: SwapStatus };

export function savedOrders(): SavedOrder[] {
  try {
    const raw = localStorage.getItem(ORDERS);
    return raw ? (JSON.parse(raw) as SavedOrder[]) : [];
  } catch {
    return [];
  }
}

export function saveOrder(o: SavedOrder) {
  try {
    const rest = savedOrders().filter((x) => x.response.quote.depositAddress !== o.response.quote.depositAddress);
    localStorage.setItem(ORDERS, JSON.stringify([o, ...rest].slice(0, 20)));
  } catch {
    /* the page keeps it while open, and offers it as a file */
  }
}

export const FINAL: SwapStatus[] = ["SUCCESS", "REFUNDED", "FAILED"];
