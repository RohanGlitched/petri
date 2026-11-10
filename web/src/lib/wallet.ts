"use client";
// The player's account. Either a NEAR wallet connected through NEAR Connect, which signs and pays for its own
// transactions, or a guest: a key made in this browser and a testnet account the site creates for it. A guest's key
// never leaves the browser; the server only sees the public half and relays what the guest signs. Guests exist only on
// the free-play dish (testnet); on mainnet every move is signed by the player's own wallet.

import { Account, KeyPair, type KeyPairString } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { useSyncExternalStore } from "react";
import type { NearConnector } from "@hot-labs/near-connect";
import type { DataStorage } from "@hot-labs/near-connect";
import { CONTRACT, FREE_PLAY, NETWORK, RPC_URLS, isAccountId } from "./config";
import { nearProvider } from "./near-provider";
import { getRules, getState, type Rules } from "./chain";

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
  const provider = nearProvider(NETWORK);
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
  const provider = nearProvider(NETWORK);
  return new Account(s.accountId, provider, s.secretKey);
}

export type TxResult = { hash: string };

type Outcome = { transaction: { hash: string }; status: unknown; receipts_outcome?: { outcome: { status: unknown } }[] };

function failureOf(o: Outcome): unknown {
  const bad = (st: unknown) => st && typeof st === "object" && "Failure" in st ? (st as { Failure: unknown }).Failure : null;
  return bad(o.status) ?? (o.receipts_outcome ?? []).map((r) => bad(r.outcome.status)).find(Boolean) ?? null;
}

/** The calls the contract refuses while the dish is behind the clock (plant, sell, mint_slide), and buy, which catches
 * up like them. Each catches up at most rules.max_catchup generations itself. */
const NEEDS_CURRENT = new Set(["plant", "sell", "mint_slide", "buy"]);
/** A transaction may prepay at most 300 TGas across all its actions; the move itself keeps at least this much. */
const TX_TGAS = 300;
const MAIN_MIN_TGAS = 150;
const ADVANCE_MAX_TGAS = 100;
/** Generations that may pass while the player signs (a minute at 15 s). */
const SIGN_MARGIN = 4;

type Step = { methodName: string; args: Record<string, unknown>; tgas: number };

let rulesOnce: Promise<Rules> | null = null;

/** The move, preceded in the same transaction by enough `advance` calls to bring the dish within one catch-up of the
 * clock. The mainnet house plays slowly, so its dish often sits more than max_catchup generations behind, where a
 * planting (or a sale or a slide) alone would be refused "the dish is behind the clock". The actions of one transaction
 * to one receiver run in one receipt, so they succeed or fail together. Beyond max_lag the first catch-up skips the
 * clock ahead to max_catchup behind, so one advance is then enough. Gas is split so the whole stays within 300 TGas. */
async function withCatchUp(methodName: string, args: Record<string, unknown>, tgas: number): Promise<Step[]> {
  const main: Step = { methodName, args, tgas };
  if (!NEEDS_CURRENT.has(methodName)) return [main];
  try {
    rulesOnce ??= getRules().catch((e) => {
      rulesOnce = null;
      throw e;
    });
    const [rules, state] = await Promise.all([rulesOnce, getState()]);
    const lag = Number(state.due_generation) - Number(state.generation) + SIGN_MARGIN;
    if (lag <= rules.max_catchup) return [main];
    const room = TX_TGAS - MAIN_MIN_TGAS;
    const most = Math.floor(room / 50);
    const n = Math.min(most, lag > rules.max_lag ? 1 : Math.ceil(lag / rules.max_catchup) - 1);
    const each = Math.min(ADVANCE_MAX_TGAS, Math.floor(room / n));
    const advance: Step = { methodName: "advance", args: { max: rules.max_catchup }, tgas: each };
    return [...Array<Step>(n).fill(advance), { ...main, tgas: Math.min(tgas, TX_TGAS - n * each) }];
  } catch {
    // The views did not answer: send the move alone, as before.
    return [main];
  }
}

// A wallet signs the call itself and pays its own gas and deposit.
async function walletCall(methodName: string, args: Record<string, unknown>, tgas: number, deposit: bigint): Promise<TxResult> {
  const steps = await withCatchUp(methodName, args, tgas);
  const w = await (await connector()).wallet();
  const out = (await w.signAndSendTransaction({
    signerId: player?.accountId,
    receiverId: CONTRACT,
    actions: steps.map((s, i) => ({
      type: "FunctionCall" as const,
      params: { methodName: s.methodName, args: s.args, gas: String(BigInt(s.tgas) * 10n ** 12n), deposit: String(i === steps.length - 1 ? deposit : 0n) },
    })),
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
  const steps = await withCatchUp(methodName, args, tgas);
  const { actions, encodeSignedDelegate } = await import("near-api-js");
  // NEAR runs a delegate action signed by a function-call key only when it holds a single call, so a lagging dish is
  // caught up with one delegate per advance, each relayed and finished before the move itself is signed.
  let last: TxResult | null = null;
  for (const s of steps) {
    const { signedDelegate } = await a.createSignedMetaTransaction({
      receiverId: CONTRACT,
      actions: [actions.functionCall(s.methodName, s.args, BigInt(s.tgas) * 10n ** 12n, 0n)],
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
    last = { hash: body.hash };
  }
  return last!;
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
/** Gas every call that may catch the dish up prepays: unused gas is refunded, and a call on a crowded dish (a catch-up
 * through a tide that pays thousands of colonies) can need well over 200 TGas on the real network. */
export const CALL_TGAS = 300;
export const joinDish = (name: string, color: number, deposit: bigint = JOIN_NEAR) => call("join", { name, color }, CALL_TGAS, deposit);
/** Plant `cells`; with `slide` (a token id) under that slide's licence: the cells must be exactly its pattern moved
 * anywhere (and the slide must hold at least rules.licence_min_cells cells), the planting costs slide_discount_bps less,
 * and a planter that does not hold the slide pays a royalty: to its holder, or to the agar if the planter has never
 * attached NEAR. `deposit` is getPlantDeposit(cells, note bytes, slide). */
export const plantCells = (cells: number[], note: string | undefined, deposit: bigint, slide: string | null = null) => call("plant", { cells, note: note?.trim() || null, ...(slide ? { slide } : {}) }, CALL_TGAS, deposit);
// Gas left unused is refunded, so these leave room for a crowded dish: a call's cost grows with the colonies playing.
export const buyPetri = (deposit: bigint = BUY_NEAR) => call("buy", {}, CALL_TGAS, deposit);
export const sellPetri = (units: bigint) => call("sell", { petri: units.toString() }, CALL_TGAS);
export const claimAll = () => call("claim", {}, CALL_TGAS);
export const advanceDish = () => call("advance", {}, CALL_TGAS);
/** Fix a rectangle of the caller colony's own living cells onto a slide, minted as a NEP-171 token. It burns PETRI for
 * each captured cell; `deposit` pays the token's storage (a guest spends it from credit). */
export const mintSlide = (args: { x: number; y: number; w: number; h: number; title?: string | null }, deposit: bigint) =>
  call("mint_slide", { ...args, title: args.title?.trim() || null }, CALL_TGAS, deposit);
/** NEAR that arrived for this account through NEAR Intents but could not be used (say, a join under the minimum), paid
 * back to the account. */
export const claimPending = () => call("claim_pending", {}, 30);
/** Run the order waiting with `account`'s pending NEAR (from NEAR Intents): its join or purchase. Anyone may. */
export const settlePending = (account: string) => call("settle_pending", { account_id: account }, 100);
/** A colony someone else's payment started (`proxy`, under a neutral "Culture" name) may take its own name and stain,
 * once. */
/** Both `rename` and `set_payout` charge the storage they add (a longer name, a payout account) from the attached NEAR
 * and send the rest back; this covers either. */
export const SMALL_STORAGE_NEAR = 10n ** 21n;
export const renameColony = (name: string, color: number) => call("rename", { name, color }, 50, SMALL_STORAGE_NEAR);
/** Where the colony's NEAR payouts (tide winnings and sales) go from now on; `null` sends them to its own account again.
 * Only a colony that has attached NEAR may set one: a guest is paid in credit, and the relayer does not relay this call. */
export const setPayout = (account: string | null) => call("set_payout", { account_id: account }, 50, SMALL_STORAGE_NEAR);
/** Offer `to`'s colony `petri` PETRI units for its promise not to plant within rules.pact_radius of the caller's living
 * cells before generation `until`. The PETRI is held until it accepts; it must be PETRI the caller could sell (a guest,
 * or a colony holding kept PETRI, offers pacts without PETRI). `deposit` is PACT_DEPOSIT (a guest spends it from
 * credit); what is not used comes back. */
export const offerPact = (to: string, petri: bigint, until: number, deposit: bigint) => call("pact_offer", { to, petri: petri.toString(), until: String(until) }, CALL_TGAS, deposit);
/** Accept pact `id` made to the caller's colony: its PETRI is paid in, and the dish then refuses the colony's plantings
 * near the offering colony until the pact's `until`. */
export const acceptPact = (id: number) => call("pact_accept", { id }, 50);
/** End pact `id`: an open offer (by either colony, or anyone once it expired; its PETRI goes back), or an accepted pact
 * whose `until` has come. */
export const cancelPact = (id: number) => call("pact_cancel", { id }, 50);

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

// ---------- living slides: calls to a slide's purse, and a signed message proving who holds it ----------

/** A connected wallet calls another contract than the dish (a living slide's purse, its factory). Guests cannot: their
 * key may only call the dish. */
export async function walletCallTo(receiverId: string, methodName: string, args: Record<string, unknown>, tgas: number, deposit: bigint = 0n): Promise<TxResult> {
  load();
  if (player?.kind !== "wallet") throw new Error("Connect a NEAR wallet: a guest's key may only call the dish itself.");
  const w = await (await connector()).wallet();
  const out = (await w.signAndSendTransaction({
    signerId: player.accountId,
    receiverId,
    actions: [{ type: "FunctionCall" as const, params: { methodName, args, gas: String(BigInt(tgas) * 10n ** 12n), deposit: String(deposit) } }],
  })) as unknown as Outcome;
  const f = failureOf(out);
  if (f) throw new Error(readableFailure(f));
  return { hash: out.transaction.hash };
}

/** NEP-413: the connected wallet signs `message` for `recipient` with a fresh nonce. */
export async function walletSignMessage(message: string, recipient: string, nonce: Uint8Array): Promise<{ accountId: string; publicKey: string; signature: string }> {
  load();
  if (player?.kind !== "wallet") throw new Error("Connect a NEAR wallet to sign: a guest's key cannot prove it holds a slide.");
  const w = await (await connector()).wallet();
  return w.signMessage({ message, recipient, nonce, network: NETWORK, signerId: player.accountId });
}
