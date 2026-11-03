// Network settings. One env switch moves the whole site between dishes or networks.

export const NETWORK = (process.env.NEXT_PUBLIC_NEAR_NETWORK ?? "testnet") as "testnet" | "mainnet";
export const CONTRACT = process.env.NEXT_PUBLIC_PETRI_CONTRACT ?? "petri-dish.testnet";
export const RPC_URLS =
  NETWORK === "mainnet"
    ? ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"]
    : ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"];
export const EXPLORER = NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
export const REPO = "https://github.com/RohanGlitched/petri";

export const PETRI_DECIMALS = 6;
export const UNIT = 10 ** PETRI_DECIMALS;

export function fmtPetri(units: number | bigint | string, digits = 2): string {
  const n = Number(units) / UNIT;
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function shortAccount(a: string, max = 22): string {
  if (a.length <= max) return a;
  return a.slice(0, max - 9) + "…" + a.slice(-8);
}

export function accountUrl(a: string): string {
  return `${EXPLORER}/address/${a}`;
}

export function txUrl(h: string): string {
  return `${EXPLORER}/txns/${h}`;
}
