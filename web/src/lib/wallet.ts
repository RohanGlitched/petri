"use client";
// The player's account. Either a NEAR wallet connected through NEAR Connect, which signs and pays for its own
// transactions, or a guest: a key made in this browser and a testnet account the site creates for it. A guest's key
// never leaves the browser; the server only sees the public half and relays what the guest signs. Guests exist only on
// the free-play dish (testnet); on mainnet every move is signed by the player's own wallet.

import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { useSyncExternalStore } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import type { DataStorage } from "@hot-labs/near-connect";
import { CONTRACT, FREE_PLAY, NETWORK, RPC_URLS, isAccountId } from "./config";

const STORE = "petri.guest.v1";
// Each network remembers its own wallet; testnet keeps the key it always had.
const WALLET_STORE = NETWORK === "testnet" ? "petri.wallet.v1" : `petri.wallet.v1.${NETWORK}`;

export type Player = { accountId: string; kind: "guest" | "wallet" } | null;

type Saved = { accountId: string; secretKey: KeyPairString };

let player: Player = null;
let loaded = false;
const listeners = new Set<() => void>();

function guestPlayer(): Player {
  if (!FREE_PLAY) return null;
  const s = saved();
  return s ? { accountId: s.accountId, kind: "guest" } : null;
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  player = guestPlayer();
  // A wallet connected on an earlier visit comes back without a popup.
  let hadWallet = false;
  try {
    hadWallet = localStorage.getItem(WALLET_STORE) === "1";
  } catch {
    /* storage blocked */
  }
  if (hadWallet) {
    connector()
      .then((c) => c.getConnectedWallet())
      .then(({ accounts }) => accounts[0] && isAccountId(accounts[0].accountId) && set({ accountId: accounts[0].accountId, kind: "wallet" }))
      .catch(() => {
        /* the wallet session ended; stay a guest */
      });
  }
}

let connecting: Promise<NearConnector> | null = null;

/** NEAR Connect's own records (the chosen wallet), kept apart per network so a testnet session never opens on mainnet. */
const connectStorage: DataStorage = {
  async get(key) {
    try {
      return localStorage.getItem(`${NETWORK}:${key}`) ?? (NETWORK === "testnet" ? localStorage.getItem(key) : null);
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(`${NETWORK}:${key}`, value);
    } catch {
      /* this visit only */
    }
  },
  async remove(key) {
    try {
      localStorage.removeItem(`${NETWORK}:${key}`);
      if (NETWORK === "testnet") localStorage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  },
};

/** NEAR Connect, loaded only when a wallet is wanted. Wallet code runs in its own sandboxed iframe. */
function connector(): Promise<NearConnector> {
  connecting ??= import("@hot-labs/near-connect").then(({ NearConnector }) => {
    const c = new NearConnector({ network: NETWORK, providers: { [NETWORK]: RPC_URLS }, storage: connectStorage });
    c.on("wallet:signIn", ({ accounts }) => {
      if (!accounts[0]) return;
      if (!isAccountId(accounts[0].accountId)) {
        // A wallet still signed in to the other network; this dish cannot use that account.
        c.disconnect().catch(() => {});
        return;
      }
      try {
        localStorage.setItem(WALLET_STORE, "1");
      } catch {
        /* remembered for this visit only */
      }
      set({ accountId: accounts[0].accountId, kind: "wallet" });
    });
    c.on("wallet:signOut", () => {
      try {
        localStorage.removeItem(WALLET_STORE);
      } catch {
        /* nothing stored */
      }
      set(guestPlayer());
    });
    return c;
  });
  return connecting;
}

/** Opens the wallet picker. The player becomes the wallet's account once it signs in. */
export async function connectWallet(): Promise<void> {
  const c = await connector();
  await c.connect();
}

export async function disconnectWallet(): Promise<void> {
  const c = await connector();
  await c.disconnect();
}

function set(p: Player) {
  player = p;
  listeners.forEach((l) => l());
}

let memoryKey: Saved | null = null;

function saved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) return JSON.parse(raw) as Saved;
  } catch {
    /* fall through */
  }
  return memoryKey;
}

/** The small proof of work the guest faucet asks for, bound to this key (see /api/guest). About a second. */
async function proofOfWork(challenge: string, publicKey: string, bits: number): Promise<string> {
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    const h = sha256(enc.encode(`petri-guest:${challenge}:${publicKey}:${n}`));
    let z = 0;
    for (const b of h) {
      if (b === 0) {
        z += 8;
        continue;
      }
      z += Math.clz32(b) - 24;
      break;
    }
    if (z >= bits) return String(n);
    // Let the page breathe every few thousand tries.
    if (n % 20_000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

export async function createGuest(): Promise<string> {
  if (!FREE_PLAY) throw new Error("Guest accounts are for free play on testnet. Connect a NEAR wallet to play with real NEAR.");
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  // The server hands out a signed, short-lived challenge; the proof of work is bound to it and to this key.
  const ch = await fetch("/api/guest").then((r) => r.json()).catch(() => ({}));
  if (!ch.challenge) throw new Error(ch.error ?? "The guest faucet did not answer.");
  const nonce = await proofOfWork(ch.challenge, publicKey, ch.bits ?? 18);
  const res = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey, nonce, challenge: ch.challenge }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.accountId) throw new Error(body.error ?? "The guest account could not be made.");
  const s: Saved = { accountId: body.accountId, secretKey: kp.toString() as KeyPairString };
  memoryKey = s;
  try {
    localStorage.setItem(STORE, JSON.stringify(s));
  } catch {
    /* kept in memory for this visit */
  }
  // The account exists once the creating transaction is final; wait until RPC sees the key.
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  for (let i = 0; i < 20; i++) {
    try {
      await provider.viewAccessKey({ accountId: s.accountId, publicKey: kp.getPublicKey() });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  set({ accountId: s.accountId, kind: "guest" });
  return s.accountId;
}

export function forgetGuest() {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* nothing stored */
  }
  memoryKey = null;
  if (player?.kind === "guest") set(null);
}

function account(): Account {
  const s = saved();
  if (!s) throw new Error("Make a guest account first.");
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  return new Account(s.accountId, provider, s.secretKey);
}

export type TxResult = { hash: string };

type Outcome = { transaction: { hash: string }; status: unknown; receipts_outcome?: { outcome: { status: unknown } }[] };

function failureOf(o: Outcome): unknown {
  const bad = (st: unknown) => st && typeof st === "object" && "Failure" in st ? (st as { Failure: unknown }).Failure : null;
  return bad(o.status) ?? (o.receipts_outcome ?? []).map((r) => bad(r.outcome.status)).find(Boolean) ?? null;
}

// A wallet signs the call itself and pays its own gas and deposit.
async function walletCall(methodName: string, args: Record<string, unknown>, tgas: number, deposit: bigint): Promise<TxResult> {
  const w = await (await connector()).wallet();
  const out = (await w.signAndSendTransaction({
    signerId: player?.accountId,
    receiverId: CONTRACT,
    actions: [{ type: "FunctionCall", params: { methodName, args, gas: String(BigInt(tgas) * 10n ** 12n), deposit: String(deposit) } }],
  })) as unknown as Outcome;
  const f = failureOf(out);
  if (f) throw new Error(readableFailure(f));
  return { hash: out.transaction.hash };
}

// Guests sign a delegate action (NEP-366) and the site's relayer submits it and pays the gas. A guest's key may only
// call the dish and cannot attach NEAR, so whatever the call needs comes from the credit the relayer sponsored on
// chain when it made the guest: `deposit` is sent as `credit` in the arguments instead.
async function call(methodName: string, args: Record<string, unknown>, tgas: number, deposit: bigint = 0n): Promise<TxResult> {
  load();
  if (player?.kind === "wallet") return walletCall(methodName, args, tgas, deposit);
  if (!FREE_PLAY) throw new Error("Connect a NEAR wallet first: on mainnet every move is signed and paid by your own wallet.");
  if (deposit > 0n) {
    args = { ...args, credit: deposit.toString() };
    deposit = 0n;
  }
  const a = account();
  const { actions, encodeSignedDelegate } = await import("near-api-js");
  const { signedDelegate } = await a.createSignedMetaTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(methodName, args, BigInt(tgas) * 10n ** 12n, deposit)],
    blockHeightTtl: 120,
  });
  const bytes = encodeSignedDelegate(signedDelegate);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedDelegate: btoa(bin) }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.hash) throw new Error(body.error ?? "The relay did not answer.");
  return { hash: body.hash };
}

export function readableFailure(f: unknown): string {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ".";
  if (/NotEnoughBalance|LackBalanceForState/.test(s)) return "This account is out of NEAR for gas.";
  if (/Exceeded the prepaid gas/.test(s)) return "The transaction ran out of gas. Try again; the dish may have been catching up.";
  return "NEAR rejected the transaction.";
}

/** A colony stakes 0.02 NEAR when it joins: storage for its colony, and the rest buys its first PETRI. */
export const JOIN_NEAR = 2n * 10n ** 22n;
export const BUY_NEAR = 10n ** 22n;
/** NEAR of credit the site's relayer sponsors on chain for each guest (kept in step with /api/guest). */
export const GUEST_CREDIT = 5n * 10n ** 22n;
export const joinDish = (name: string, color: number, deposit: bigint = JOIN_NEAR) => call("join", { name, color }, 200, deposit);
export const plantCells = (cells: number[], note: string | undefined, deposit: bigint) => call("plant", { cells, note: note?.trim() || null }, 200, deposit);
export const buyPetri = (deposit: bigint = BUY_NEAR) => call("buy", {}, 150, deposit);
export const sellPetri = (units: bigint) => call("sell", { petri: units.toString() }, 150);
export const claimAll = () => call("claim", {}, 150);
export const advanceDish = () => call("advance", {}, 250);
/** Fix a rectangle of the caller colony's own living cells onto a slide, minted as a NEP-171 token. It burns PETRI for
 * each captured cell; `deposit` pays the token's storage (a guest spends it from credit). */
export const mintSlide = (args: { x: number; y: number; w: number; h: number; title?: string | null }, deposit: bigint) =>
  call("mint_slide", { ...args, title: args.title?.trim() || null }, 300, deposit);
/** NEAR that arrived for this account through NEAR Intents but could not be used (say, a join under the minimum), paid
 * back to the account. */
export const claimPending = () => call("claim_pending", {}, 30);
/** A colony someone else's payment started (`proxy`) may take its own name and stain, once. */
export const renameColony = (name: string, color: number) => call("rename", { name, color }, 50);
/** Where the colony's NEAR payouts (tide winnings and sales) go from now on; `null` sends them to its own account again.
 * Only a colony that has attached NEAR may set one: a guest is paid in credit, and the relayer does not relay this call. */
export const setPayout = (account: string | null) => call("set_payout", { account_id: account }, 50);

export function usePlayer(): Player {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      load();
      return () => listeners.delete(l);
    },
    () => {
      load();
      return player;
    },
    () => null,
  );
}
