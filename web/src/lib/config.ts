// Network settings. The same contract code runs two dishes: free play on NEAR testnet (guests, a relayer, sponsored
// credit) and real NEAR on mainnet (wallets only). Which one a visitor reads is chosen in the browser: `?net=` in the
// address, else the choice remembered from an earlier visit, else the default. Switching reloads the page, so these
// stay plain constants for the rest of the code. The server always sees the default (testnet) dish.

export type Network = "testnet" | "mainnet";

export const CONTRACTS: Record<Network, string> = {
  testnet: process.env.NEXT_PUBLIC_PETRI_CONTRACT_TESTNET ?? process.env.NEXT_PUBLIC_PETRI_CONTRACT ?? "petri-v6.testnet",
  mainnet: process.env.NEXT_PUBLIC_PETRI_CONTRACT_MAINNET ?? "petri-dish.near",
};
/** Every network's RPC providers, for the few reads that look at the other dish (the mainnet pulse). */
export const RPCS: Record<Network, string[]> = {
  mainnet: ["https://rpc.mainnet.fastnear.com", "https://rpc.mainnet.near.org"],
  testnet: ["https://rpc.testnet.fastnear.com", "https://rpc.testnet.near.org", "https://test.rpc.fastnear.com"],
};
export const EXPLORERS: Record<Network, string> = { mainnet: "https://nearblocks.io", testnet: "https://testnet.nearblocks.io" };

const isNetwork = (v: unknown): v is Network => v === "testnet" || v === "mainnet";
/** The dish a first visit reads, and the only one the server knows. */
export const DEFAULT_NETWORK: Network = isNetwork(process.env.NEXT_PUBLIC_NEAR_NETWORK) ? process.env.NEXT_PUBLIC_NEAR_NETWORK : "testnet";
export const NET_STORE = "petri.net.v1";

/** The network named in this page's address, if any. */
export function networkInUrl(): Network | null {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams(window.location.search).get("net");
    return isNetwork(q) ? q : null;
  } catch {
    return null;
  }
}

function pick(): Network {
  if (typeof window === "undefined") return DEFAULT_NETWORK;
  const fromUrl = networkInUrl();
  if (fromUrl) {
    try {
      localStorage.setItem(NET_STORE, fromUrl);
    } catch {
      /* this visit only */
    }
    return fromUrl;
  }
  try {
    const saved = localStorage.getItem(NET_STORE);
    if (isNetwork(saved)) return saved;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_NETWORK;
}

export const NETWORK: Network = pick();
export const CONTRACT = CONTRACTS[NETWORK];
export const RPC_URLS = RPCS[NETWORK];
export const EXPLORER = EXPLORERS[NETWORK];
/** Free play: guests, the relayer and sponsored credit exist only on testnet. */
export const FREE_PLAY = NETWORK === "testnet";
export const REPO = "https://github.com/RohanGlitched/petri";

/** Move to the other dish. The page reloads so every reader, wallet and cache starts on the new network. */
export function switchNetwork(to: Network) {
  try {
    localStorage.setItem(NET_STORE, to);
  } catch {
    /* the address carries it instead */
  }
  const url = new URL(window.location.href);
  if (to === DEFAULT_NETWORK && !url.searchParams.has("net")) url.searchParams.delete("net");
  else url.searchParams.set("net", to);
  window.location.assign(url.toString());
}

/** A link to this site that opens on the dish being read, for sharing. */
export function shareUrl(path: string): string {
  const base = typeof window === "undefined" ? "" : window.location.origin;
  return `${base}${path}${NETWORK === DEFAULT_NETWORK ? "" : `${path.includes("?") ? "&" : "?"}net=${NETWORK}`}`;
}

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

/** A named account says its own network (`.testnet` or `.near`); only implicit accounts follow the dish being read. */
export function accountUrl(a: string, net?: Network): string {
  const n = net ?? (a.endsWith(".testnet") ? "testnet" : a.endsWith(".near") ? "mainnet" : NETWORK);
  return `${EXPLORERS[n]}/address/${a}`;
}

export function txUrl(h: string, net: Network = NETWORK): string {
  return `${EXPLORERS[net]}/txns/${h}`;
}

/** NearBlocks' page for one NEP-171 token. */
export function nftUrl(contract: string, tokenId: string, net: Network = NETWORK): string {
  return `${EXPLORERS[net]}/nft-token/${contract}/${encodeURIComponent(tokenId)}`;
}

/** A NEAR account id: 2 to 64 characters of lowercase letters, digits and `-_` separated by dots, as nearcore checks it. */
export function isAccountId(a: string, net: Network = NETWORK): boolean {
  if (a.length < 2 || a.length > 64) return false;
  if (!/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(a)) return false;
  // Named accounts live under the network's top-level account; implicit ones (64 hex, or 0x and 40 hex) work on both.
  if (/^[0-9a-f]{64}$/.test(a) || /^0x[0-9a-f]{40}$/.test(a)) return true;
  if (net === "mainnet" && a.endsWith(".testnet")) return false;
  if (net === "testnet" && a.includes(".") && !a.endsWith(".testnet")) return false;
  return true;
}

export const NETWORK_LABEL: Record<Network, { name: string; chain: string; line: string }> = {
  testnet: { name: "Free play", chain: "NEAR testnet", line: "A guest account and sponsored credit. Nothing on this dish costs real money." },
  mainnet: { name: "Real NEAR", chain: "NEAR mainnet", line: "Your own wallet and your own NEAR, or pay with any token through NEAR Intents." },
};
