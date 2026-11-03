// Creates a guest account for a visitor's browser key: g-<random>.<relayer>, holding only what its storage needs.
// The visitor never sees a wallet popup, a seed phrase or a gas prompt: /api/relay pays for their transactions.

import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, nearToYocto } from "near-api-js";
import { NETWORK, RPC_URLS } from "@/lib/config";

export const runtime = "nodejs";

// Enough for the account's own storage; gas is paid by the relayer through meta transactions.
const GUEST_NEAR = "0.01";
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

export async function POST(req: Request) {
  if (NETWORK !== "testnet") {
    return NextResponse.json({ error: "Guest accounts exist only on testnet. Connect a NEAR wallet instead." }, { status: 400 });
  }
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  if (!relayer || !key) return NextResponse.json({ error: "Guest accounts are not configured on this server." }, { status: 503 });

  let publicKey = "";
  try {
    const body = await req.json();
    publicKey = String(body?.publicKey ?? "");
  } catch {
    return NextResponse.json({ error: "Send JSON: { publicKey }" }, { status: 400 });
  }
  if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) {
    return NextResponse.json({ error: "publicKey must be an ed25519 public key in NEAR's base58 form." }, { status: 400 });
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
