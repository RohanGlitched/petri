// Creates a guest account for a visitor's browser key: g-<hash of the key>.<relayer>, holding only what its own storage
// needs, with a function-call key that can call the dish and nothing else (such a key cannot attach NEAR or transfer
// it). The relayer then sponsors the guest on chain: `sponsor` gives it GUEST_CREDIT of credit that can only be spent
// joining, buying and planting. The visitor never sees a wallet popup, a seed phrase or a gas prompt, and /api/relay
// never has to attach NEAR to anything it relays.
//
// Making a guest costs the relayer NEAR, so a request must carry a proof of work bound to a challenge this server
// signed in the last ten minutes and to the key: the browser finds a nonce such that
// sha256("petri-guest:" + challenge + ":" + publicKey + ":" + nonce) starts with DIFFICULTY zero bits. The account name
// comes from the key, so one key makes at most one guest.

import { NextResponse } from "next/server";
import { clientIp, overBudget, spent } from "@/lib/budget";
import { PublicKey, actions, nearToYocto } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CONTRACT, NETWORK } from "@/lib/config";
import { GUEST_CREDIT_YOCTO, relayerAccount, sponsorUntilCredited } from "./credit";

export const runtime = "nodejs";

const GUEST_NEAR = "0.003";
const DIFFICULTY = 18;
const CHALLENGE_MS = 10 * 60_000;
/** Generous enough for a judging team behind one office or cloud IP; the proof of work and the daily budget still bound it. */
const PER_IP_PER_HOUR = 6;
const PER_HOUR = 120;
// No set_payout: a guest attaches no NEAR, so the dish pays it in credit and it has no NEAR payouts to send anywhere.
// The last six are for the break-it lab (/break) only: the contract refuses each of them from a guest (there is no mint
// and no rule setter, relaunch is private, the dish is initialised, a guest sponsored nobody, and a function-call key
// cannot attach the 1 yoctoNEAR a transfer needs). Anyone can call any method with any account; listing them on the
// key only lets the lab show the contract's own refusal instead of the key's.
const METHODS = ["join", "buy", "plant", "sell", "claim", "advance", "mint_slide", "settle_pending", "pact_offer", "pact_accept", "pact_cancel", "ft_mint", "set_rules", "relaunch", "new", "unsponsor", "ft_transfer"];
const hits = new Map<string, number[]>();
let global: number[] = [];

function limited(ip: string): string | null {
  const now = Date.now();
  const hour = now - 3600_000;
  global = global.filter((t) => t > hour);
  const mine = (hits.get(ip) ?? []).filter((t) => t > hour);
  if (mine.length >= PER_IP_PER_HOUR) return `This network already made ${PER_IP_PER_HOUR} guest accounts in the last hour (a shared office or cloud address reaches that sooner). Use the guest you have, or watch meanwhile: the dish plays on without you (press C on /dish for cinema mode), and /verify replays its whole history. New guests open again within the hour.`;
  if (global.length >= PER_HOUR) return "Guest accounts are paused for a few minutes because many were made at once. Try again shortly.";
  mine.push(now);
  global.push(now);
  hits.set(ip, mine);
  return null;
}

function leadingZeroBits(h: Uint8Array): number {
  let n = 0;
  for (const b of h) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

/** The challenge secret is derived from the relayer's key, so no extra secret has to be configured. */
function sign(ts: string, key: string): string {
  return bytesToHex(hmac(sha256, sha256(new TextEncoder().encode(`petri-guest-challenge:${key}`)), new TextEncoder().encode(ts))).slice(0, 32);
}

function config() {
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  return relayer && key ? { relayer, key } : null;
}

/** A fresh challenge: `<timestamp>.<signature>`. */
export async function GET() {
  const c = config();
  if (NETWORK !== "testnet") return NextResponse.json({ error: "Guest accounts exist only on testnet. Connect a NEAR wallet instead." }, { status: 400 });
  if (!c) return NextResponse.json({ error: "Guest accounts are not configured on this server." }, { status: 503 });
  const ts = String(Date.now());
  return NextResponse.json({ challenge: `${ts}.${sign(ts, c.key)}`, bits: DIFFICULTY }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return NextResponse.json({ error: "Guest accounts exist only on testnet. Connect a NEAR wallet instead." }, { status: 400 });
  const c = config();
  if (!c) return NextResponse.json({ error: "Guest accounts are not configured on this server." }, { status: 503 });

  let publicKey = "";
  let nonce = "";
  let challenge = "";
  try {
    const body = await req.json();
    publicKey = String(body?.publicKey ?? "");
    nonce = String(body?.nonce ?? "");
    challenge = String(body?.challenge ?? "");
  } catch {
    return NextResponse.json({ error: "Send JSON: { publicKey, nonce, challenge }" }, { status: 400 });
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) {
    return NextResponse.json({ error: "publicKey must be an ed25519 public key in NEAR's base58 form." }, { status: 400 });
  }
  const [ts, mac] = challenge.split(".");
  if (!ts || !mac || mac !== sign(ts, c.key) || Date.now() - Number(ts) > CHALLENGE_MS || Number(ts) > Date.now() + 60_000) {
    return NextResponse.json({ error: "The challenge is missing or expired. Reload the page and try again." }, { status: 400 });
  }
  if (!/^\d{1,12}$/.test(nonce) || leadingZeroBits(sha256(new TextEncoder().encode(`petri-guest:${challenge}:${publicKey}:${nonce}`))) < DIFFICULTY) {
    return NextResponse.json({ error: "The proof of work for this key is missing or too weak. Reload the page and try again." }, { status: 400 });
  }
  const ip = clientIp(req);
  const why = limited(ip);
  if (why) return NextResponse.json({ error: why }, { status: 429 });
  const broke = await overBudget(ip);
  if (broke) return NextResponse.json({ error: broke }, { status: 429 });

  // One key, one guest: the name is derived from the key.
  const suffix = bytesToHex(sha256(new TextEncoder().encode(publicKey))).slice(0, 10);
  const accountId = `g-${suffix}.${c.relayer}`;
  const relayer = relayerAccount(c.relayer, c.key);
  try {
    await relayer.signAndSendTransaction({
      receiverId: accountId,
      actions: [actions.createAccount(), actions.transfer(nearToYocto(GUEST_NEAR)), actions.addFunctionCallAccessKey(PublicKey.fromString(publicKey), CONTRACT, METHODS)],
      // Executed is enough: the browser waits until RPC sees the key before it signs anything, and the sponsor call
      // below does not need the account to exist. Waiting for FINAL only added seconds.
      waitUntil: "EXECUTED_OPTIMISTIC",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("guest creation failed", msg);
    if (/AccountAlreadyExists|already exists/i.test(msg)) return NextResponse.json({ error: "A guest for this key already exists. Reload the page to use it." }, { status: 409 });
    const funds = /balance|NotEnoughBalance|LackBalance/i.test(msg);
    return NextResponse.json(
      { error: funds ? "The guest faucet is empty. Connect a NEAR wallet, or try again after it is topped up." : "NEAR did not create the guest account. Try again in a moment." },
      { status: 502 },
    );
  }
  // Credit is retried and read back here; if it still is not there, the page asks /api/guest/sponsor before joining.
  const credited = await sponsorUntilCredited(relayer, accountId).catch(() => false);
  await spent(ip, nearToYocto(GUEST_NEAR) + (credited ? GUEST_CREDIT_YOCTO : 0n)).catch(() => {});
  return NextResponse.json({ accountId, credited });
}
