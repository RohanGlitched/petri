// Server only. Who may make and relay guests on each network, read from the server's environment.
//
// Testnet free play (unchanged): `g-<hash>.<relayer>` sub-accounts with a function-call key for the dish, made by
// PETRI_RELAYER_ACCOUNT with PETRI_RELAYER_KEY.
//
// Mainnet free play (PETRI_MAINNET_GUESTS=1), for the judging window only: the guest is the implicit account of the
// key its browser made (64 hex, the key's own bytes), created by the relayer with a 1 yoctoNEAR transfer (NEAR's
// zero-balance accounts need nothing for storage; the protocol's account-creation charge is paid by the relayer). The
// relayer then sponsors it on the dish with `sponsor`, relays its signed delegate actions (NEP-366) and pays their gas.
// The relayer is its own implicit account, funded once by scripts/mainnet-guests-setup.mjs, never a team account, so
// free play can never spend more than that one deposit. On top of that:
//   - a guest is made only inside the window, only while fewer than PETRI_MAINNET_GUESTS_CAP guests exist (counted
//     from the dish's own ledger: `Sponsor` entries this relayer signed), and only while the relayer would keep
//     PETRI_MAINNET_RELAYER_FLOOR plus PETRI_MAINNET_GUEST_RESERVE (one guest's creation, credit and gas);
//   - nothing is relayed once the relayer is under its floor, and each guest gets at most PETRI_MAINNET_GUEST_RELAYS
//     relayed moves (counted by its key's nonce, which only ever rises);
//   - per address: PETRI_MAINNET_GUESTS_PER_IP guests a day, and the daily spend caps of lib/budget.ts on their own
//     mainnet counters;
//   - PETRI_MAINNET_JUDGE_PLACES of the places (default 25) are held for judges: a guest made without a judge code is
//     refused once the public places (cap less that) are taken. A judge code is an HMAC under PETRI_JUDGE_CODE_SECRET
//     (scripts/judge-codes.mjs prints them); without that secret no place is held back. A judge's guest is marked on
//     chain, not in a server's memory: its sponsorship carries one extra yoctoNEAR, so the dish's own ledger counts the
//     judge places taken (lib/implicit-guests.ts).
// The same implicit flow can run on testnet for a rehearsal: PETRI_TESTNET_GUESTS=implicit with the PETRI_TESTNET_*
// variables of the same names.

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CONTRACTS, type Network } from "./config";

export type ImplicitLimits = {
  /** The window guests may be made in, in ms since the epoch: [start, end). */
  start: number;
  end: number;
  /** Relaying for existing guests stops at this time. */
  relayUntil: number;
  /** Most guests this relayer ever makes. */
  cap: number;
  /** yoctoNEAR the relayer never goes under: it covers NEAR's hold on prepaid gas (bought at 10 times the gas price
   * until the refund lands, so 0.3 NEAR for a 300 TGas call) and is what is left over for the funder afterwards. */
  floor: bigint;
  /** yoctoNEAR above the floor a new guest needs: the account-creation charge, the sponsored credit and its gas. */
  reserve: bigint;
  /** Guests one client address may make in a UTC day. */
  perIpDay: number;
  /** Relayed moves (delegate actions) one guest may make in all. */
  relaysPerGuest: number;
  /** The dish ledger index the guest count starts from. */
  ledgerFrom: number;
  /** Places held for guests made with a judge code (0 when no PETRI_JUDGE_CODE_SECRET is set). */
  judgePlaces: number;
  /** Guests one judge code may make on one server instance. */
  judgeCodeUses: number;
};

export type GuestProgram = {
  net: Network;
  contract: string;
  /** `named`: g-<hash>.<relayer> with a function-call key (testnet free play). `implicit`: the browser key's own account. */
  kind: "named" | "implicit";
  relayer: string;
  key: string;
  limits: ImplicitLimits | null;
};

const env = (k: string) => process.env[k]?.trim() || undefined;
const YOCTO = 10n ** 24n;

/** "0.3" NEAR as yoctoNEAR. */
export function nearToYoctoStr(s: string): bigint {
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * YOCTO + BigInt((f + "0".repeat(24)).slice(0, 24));
}

/** The judging window (UTC). */
export const DEFAULT_START = "2026-11-14T18:00:00Z";
export const DEFAULT_END = "2026-11-19T00:00:00Z";

function time(v: string | undefined, dflt: string): number {
  const t = Date.parse(v ?? dflt);
  return Number.isFinite(t) ? t : Date.parse(dflt);
}

function limits(prefix: string): ImplicitLimits {
  const end = time(env(`${prefix}_GUESTS_END`), DEFAULT_END);
  return {
    start: time(env(`${prefix}_GUESTS_START`), DEFAULT_START),
    end,
    relayUntil: env(`${prefix}_GUESTS_RELAY_UNTIL`) ? time(env(`${prefix}_GUESTS_RELAY_UNTIL`), DEFAULT_END) : end,
    cap: Number(env(`${prefix}_GUESTS_CAP`) ?? "40"),
    floor: nearToYoctoStr(env(`${prefix}_RELAYER_FLOOR`) ?? "0.3"),
    // 0.1 NEAR, not the 0.07 a guest's creation and credit take: also its 16 relayed moves' gas (about 0.02 measured
    // on testnet), so "places left" never counts a guest the relayer could make but not carry.
    reserve: nearToYoctoStr(env(`${prefix}_GUEST_RESERVE`) ?? "0.1"),
    perIpDay: Number(env(`${prefix}_GUESTS_PER_IP`) ?? "3"),
    relaysPerGuest: Number(env(`${prefix}_GUEST_RELAYS`) ?? "16"),
    ledgerFrom: Number(env(`${prefix}_GUESTS_LEDGER_FROM`) ?? "0"),
    judgePlaces: judgeSecret() ? Math.max(0, Number(env(`${prefix}_JUDGE_PLACES`) ?? "25")) : 0,
    judgeCodeUses: Math.max(1, Number(env("PETRI_JUDGE_CODE_USES") ?? "2")),
  };
}

function implicit(net: Network, prefix: string): GuestProgram | null {
  const relayer = env(`${prefix}_RELAYER_ACCOUNT`);
  const key = env(`${prefix}_RELAYER_KEY`);
  if (!relayer || !key || !/^[0-9a-f]{64}$/.test(relayer)) return null;
  return { net, contract: CONTRACTS[net], kind: "implicit", relayer, key, limits: limits(prefix) };
}

/** Whether mainnet free play is switched on at all (the start card then says when it opens, even before the relayer
 * is configured). */
export const mainnetGuestsOn = () => env("PETRI_MAINNET_GUESTS") === "1";

export function guestProgram(net: Network): GuestProgram | null {
  if (net === "testnet") {
    if (env("PETRI_TESTNET_GUESTS") === "implicit") return implicit("testnet", "PETRI_TESTNET");
    const relayer = env("PETRI_RELAYER_ACCOUNT");
    const key = env("PETRI_RELAYER_KEY");
    return relayer && key ? { net, contract: CONTRACTS.testnet, kind: "named", relayer, key, limits: null } : null;
  }
  return mainnetGuestsOn() ? implicit("mainnet", "PETRI_MAINNET") : null;
}

/** The window as configured, for the start card, even when the relayer is not. */
export function mainnetWindow(): { start: number; end: number; cap: number; judgePlaces: number } {
  const l = limits("PETRI_MAINNET");
  return { start: l.start, end: l.end, cap: l.cap, judgePlaces: Math.min(l.judgePlaces, l.cap) };
}

// Judge codes. A code is `petri-<n>-<8 hex>`: n is its number, the hex the start of HMAC-SHA256(secret, "petri-judge:<n>").
// scripts/judge-codes.mjs prints them from the same secret, for the submission text. 32 bits per code, each guess also
// costs an 18-bit proof of work, so codes cannot be guessed.

const judgeSecret = () => env("PETRI_JUDGE_CODE_SECRET");

export function judgeCodeFor(secret: string, n: number): string {
  const mac = bytesToHex(hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(`petri-judge:${n}`))).slice(0, 8);
  return `petri-${n}-${mac}`;
}

/** The code's number when `code` is a valid judge code under this server's secret, else null. */
export function readJudgeCode(code: unknown): number | null {
  const secret = judgeSecret();
  if (!secret || typeof code !== "string") return null;
  const m = code.trim().toLowerCase().match(/^petri-(\d{1,4})-([0-9a-f]{8})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return judgeCodeFor(secret, n) === `petri-${n}-${m[2]}` ? n : null;
}

/** The network a request names with `?net=` (the server's own default is testnet). */
export function netOf(req: Request): Network {
  return new URL(req.url).searchParams.get("net") === "mainnet" ? "mainnet" : "testnet";
}

/** The implicit account of an ed25519 public key in NEAR's `ed25519:<base58>` form. */
export function implicitOf(keyBytes: Uint8Array): string {
  return bytesToHex(keyBytes);
}

const macKey = (p: GuestProgram) => sha256(new TextEncoder().encode(`petri-guest-ticket:${p.net}:${p.relayer}:${p.key}`));

/** A guest's ticket: proof this server made `account`, with its key's nonce when it was made (so relayed moves can be
 * counted from the nonce alone). Signed with a key derived from the relayer's, so nothing else must be configured. */
export function ticketFor(p: GuestProgram, account: string, nonce0: bigint): string {
  const body = `${account}.${nonce0}`;
  return `${body}.${bytesToHex(hmac(sha256, macKey(p), new TextEncoder().encode(body))).slice(0, 32)}`;
}

/** The account and starting nonce a valid ticket names, or null. */
export function readTicket(p: GuestProgram, ticket: unknown): { account: string; nonce0: bigint } | null {
  if (typeof ticket !== "string") return null;
  const m = ticket.match(/^([0-9a-f]{64})\.(\d{1,30})\.([0-9a-f]{32})$/);
  if (!m) return null;
  if (ticketFor(p, m[1], BigInt(m[2])) !== ticket) return null;
  return { account: m[1], nonce0: BigInt(m[2]) };
}
