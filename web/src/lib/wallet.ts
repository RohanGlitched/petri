"use client";
// The player's account. By default a guest: a key made in this browser and a testnet account the site creates for
// it. The key never leaves the browser; the server only sees the public half.

import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { useSyncExternalStore } from "react";
import { CONTRACT, RPC_URLS } from "./config";

const STORE = "petri.guest.v1";

export type Player = { accountId: string; kind: "guest" } | null;

type Saved = { accountId: string; secretKey: KeyPairString };

let player: Player = null;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORE);
    if (raw) {
      const s = JSON.parse(raw) as Saved;
      if (s.accountId && s.secretKey) player = { accountId: s.accountId, kind: "guest" };
    }
  } catch {
    /* storage blocked: the player can still make a guest for this visit */
  }
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
async function proofOfWork(publicKey: string, bits = 18): Promise<string> {
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    const h = sha256(enc.encode(`petri-guest:${publicKey}:${n}`));
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
  const kp = KeyPair.fromRandom("ed25519");
  const publicKey = kp.getPublicKey().toString();
  const nonce = await proofOfWork(publicKey);
  const res = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey, nonce }),
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
  set(null);
}

function account(): Account {
  const s = saved();
  if (!s) throw new Error("Make a guest account first.");
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  return new Account(s.accountId, provider, s.secretKey);
}

export type TxResult = { hash: string };

// Guests sign a delegate action (NEP-366) and the site's relayer submits it and pays the gas.
async function call(methodName: string, args: Record<string, unknown>, tgas: number, deposit: bigint = 0n): Promise<TxResult> {
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

/** A guest stakes 0.02 NEAR when it joins: storage for its colony, and the rest buys its first PETRI. */
export const JOIN_NEAR = 2n * 10n ** 22n;
export const BUY_NEAR = 10n ** 22n;
/** NEAR of deposits the site's relayer sponsors per guest (kept in step with /api/relay). */
export const GUEST_BUDGET = 6n * 10n ** 22n;
export const joinDish = (name: string, color: number, deposit: bigint = JOIN_NEAR) => call("join", { name, color }, 200, deposit);
export const plantCells = (cells: number[], note: string | undefined, deposit: bigint) => call("plant", { cells, note: note?.trim() || null }, 200, deposit);
export const buyPetri = (deposit: bigint = BUY_NEAR) => call("buy", {}, 150, deposit);
export const claimAll = () => call("claim", {}, 150);
export const advanceDish = () => call("advance", {}, 250);

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
