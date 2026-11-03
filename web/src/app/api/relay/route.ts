// Relays a guest's signed delegate action (NEP-366 meta transaction): the guest signs a call to the dish, this
// server wraps it in a transaction and pays the gas. NEAR checks the guest's signature on chain, so the relayer can
// forward a guest's intent but never forge one. Only the dish's own methods, with no deposit, are relayed.

import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, SCHEMA, actions } from "near-api-js";
import { deserialize } from "borsh";
import { CONTRACT, RPC_URLS } from "@/lib/config";

export const runtime = "nodejs";

const ALLOWED = new Set(["join", "plant", "advance"]);
const MAX_GAS = 200n * 10n ** 12n;
const PER_ACCOUNT_PER_MIN = 6;
const PER_MIN = 120;
const hits = new Map<string, number[]>();
let global: number[] = [];

type FunctionCallFields = { methodName: string; args: Uint8Array; gas: bigint; deposit: bigint };
type Decoded = {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: FunctionCallFields }[];
    nonce: bigint;
    maxBlockHeight: bigint;
    publicKey: unknown;
  };
  signature: unknown;
};

function limited(account: string): string | null {
  const now = Date.now();
  const minute = now - 60_000;
  global = global.filter((t) => t > minute);
  const mine = (hits.get(account) ?? []).filter((t) => t > minute);
  if (mine.length >= PER_ACCOUNT_PER_MIN) return "Too many transactions from this colony in the last minute. Wait a moment.";
  if (global.length >= PER_MIN) return "The relayer is busy. Try again in a few seconds.";
  mine.push(now);
  global.push(now);
  hits.set(account, mine);
  return null;
}

function failureText(f: unknown): string {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1) + ".";
  if (/DelegateActionExpired/.test(s)) return "The signed action expired before it was relayed. Try again.";
  if (/DelegateActionInvalidNonce/.test(s)) return "That action was already used. Try again.";
  if (/Exceeded the prepaid gas/.test(s)) return "The transaction ran out of gas.";
  return "NEAR rejected the transaction.";
}

export async function POST(req: Request) {
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  if (!relayer || !key) return NextResponse.json({ error: "The relayer is not configured on this server." }, { status: 503 });

  let bytes: Uint8Array;
  try {
    const body = await req.json();
    bytes = Uint8Array.from(Buffer.from(String(body?.signedDelegate ?? ""), "base64"));
    if (bytes.length < 64 || bytes.length > 8192) throw new Error("size");
  } catch {
    return NextResponse.json({ error: "Send JSON: { signedDelegate: base64 }" }, { status: 400 });
  }

  let decoded: Decoded;
  try {
    decoded = deserialize(SCHEMA.SignedDelegate, bytes) as unknown as Decoded;
  } catch {
    return NextResponse.json({ error: "That is not a signed delegate action." }, { status: 400 });
  }
  const da = decoded.delegateAction;
  if (da.receiverId !== CONTRACT) return NextResponse.json({ error: `Only calls to ${CONTRACT} are relayed.` }, { status: 400 });
  if (!da.senderId.endsWith(`.${relayer}`)) return NextResponse.json({ error: "Only Petri guest accounts are relayed; wallet accounts pay their own gas." }, { status: 403 });
  if (da.actions.length !== 1) return NextResponse.json({ error: "Relay one call at a time." }, { status: 400 });
  const fc = da.actions[0].functionCall;
  if (!fc || !ALLOWED.has(fc.methodName)) return NextResponse.json({ error: "Only join, plant and advance are relayed." }, { status: 400 });
  if (BigInt(fc.deposit) !== 0n) return NextResponse.json({ error: "Relayed calls carry no deposit." }, { status: 400 });
  if (BigInt(fc.gas) > MAX_GAS) return NextResponse.json({ error: "Too much gas requested." }, { status: 400 });
  const why = limited(da.senderId);
  if (why) return NextResponse.json({ error: why }, { status: 429 });

  try {
    const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
    const acct = new Account(relayer, provider, key as `ed25519:${string}`);
    const res = await acct.signAndSendTransaction({
      receiverId: da.senderId,
      actions: [actions.signedDelegate(decoded as never)],
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    });
    const top = res.status as { Failure?: unknown };
    if (top && typeof top === "object" && "Failure" in top && top.Failure) {
      return NextResponse.json({ error: failureText(top.Failure), hash: res.transaction.hash }, { status: 422 });
    }
    for (const r of res.receipts_outcome ?? []) {
      const st = r.outcome.status as { Failure?: unknown };
      if (st && typeof st === "object" && "Failure" in st && st.Failure) {
        return NextResponse.json({ error: failureText(st.Failure), hash: res.transaction.hash }, { status: 422 });
      }
    }
    return NextResponse.json({ hash: res.transaction.hash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed", msg);
    const funds = /NotEnoughBalance|LackBalance|balance/i.test(msg);
    return NextResponse.json({ error: funds ? "The relayer is out of gas money. It is topped up regularly; try again soon." : "The relay did not go through. Try again." }, { status: 502 });
  }
}
