// Creates a guest account for a visitor's browser key: g-<random>.<relayer>, holding only what its own storage needs.
// The visitor never sees a wallet popup, a seed phrase or a gas prompt: /api/relay pays for their transactions and,
// up to a per-guest budget, for the NEAR the dish asks them to attach.
//
// Making a guest costs the relayer NEAR, so a request must carry a small proof of work bound to its key: the browser
// finds a nonce such that sha256("petri-guest:" + publicKey + ":" + nonce) starts with DIFFICULTY zero bits. It takes
// a browser about a second and makes scripted farming of guests slow.

import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { NETWORK, RPC_URLS } from "@/lib/config";

export const runtime = "nodejs";

const GUEST_NEAR = "0.002";
const DIFFICULTY = 18;
const PER_IP_PER_HOUR = 4;
const PER_HOUR = 120;
const hits = new Map<string, number[]>();
let global: number[] = [];

function limited(ip: string): string | null {
  const now = Date.now();
  const hour = now - 3600_000;
  global = global.filter((t) => t > hour);
  const mine = (hits.get(ip) ?? []).filter((t) => t > hour);
  if (mine.length >= PER_IP_PER_HOUR) return "This address already made a few guests in the last hour. Use the one you have, or try again later.";
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

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return NextResponse.json({ error: "Guest accounts exist only on testnet. Connect a NEAR wallet instead." }, { status: 400 });
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  if (!relayer || !key) return NextResponse.json({ error: "Guest accounts are not configured on this server." }, { status: 503 });

  let publicKey = "";
  let nonce = "";
  try {
    const body = await req.json();
    publicKey = String(body?.publicKey ?? "");
    nonce = String(body?.nonce ?? "");
  } catch {
    return NextResponse.json({ error: "Send JSON: { publicKey, nonce }" }, { status: 400 });
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) {
    return NextResponse.json({ error: "publicKey must be an ed25519 public key in NEAR's base58 form." }, { status: 400 });
  }
  if (!/^\d{1,12}$/.test(nonce) || leadingZeroBits(sha256(new TextEncoder().encode(`petri-guest:${publicKey}:${nonce}`))) < DIFFICULTY) {
    return NextResponse.json({ error: "The proof of work for this key is missing or too weak. Reload the page and try again." }, { status: 400 });
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const why = limited(ip);
  if (why) return NextResponse.json({ error: why }, { status: 429 });

  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, "0")).join("");
  const accountId = `g-${suffix}.${relayer}`;
  try {
    const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
    const acct = new Account(relayer, provider, key as `ed25519:${string}`);
    await acct.createSubAccount({ accountOrPrefix: `g-${suffix}`, publicKey, nearToTransfer: nearToYocto(GUEST_NEAR) });
    return NextResponse.json({ accountId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("guest creation failed", msg);
    const funds = /balance|NotEnoughBalance|LackBalance/i.test(msg);
    return NextResponse.json(
      { error: funds ? "The guest faucet is empty. Connect a NEAR wallet, or try again after it is topped up." : "NEAR did not create the guest account. Try again in a moment." },
      { status: 502 },
    );
  }
}
