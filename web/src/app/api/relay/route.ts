// Relays a guest's signed delegate action (NEP-366 meta transaction): the guest signs a call to the dish, this
// server wraps it in a transaction and pays the gas. Before paying anything it checks, off chain, what NEAR would
// check before running the call: the sender is one of our guests, the call is one of the dish's own methods with no
// deposit and bounded gas, the delegate action has not expired, the signature is valid for it, and the key exists on
// the guest's account with a fresh nonce.
//
// Under NEP-366 the relayer would also pay any NEAR an inner call attaches, and a failed call refunds that NEAR to the
// guest, so nothing relayed may attach NEAR at all. Guests pay for joining, buying and planting with the credit the
// relayer sponsored on chain when it made them (see /api/guest), and their keys are function-call keys for the dish
// alone, so the NEAR cannot leave the dish. A call that still fails inside the contract costs the relayer only gas,
// and the per-guest rate limit bounds that. Wallet players sign and pay for themselves.

import { NextResponse } from "next/server";
import { Account, JsonRpcProvider, SCHEMA, actions, baseEncode, encodeDelegateAction } from "near-api-js";
import { deserialize } from "borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CONTRACT, RPC_URLS } from "@/lib/config";

export const runtime = "nodejs";

/** The dish's methods a guest may call through the relayer. None may attach NEAR. */
const ALLOWED = new Set(["join", "buy", "plant", "sell", "claim", "advance", "mint_slide"]);
const MAX_GAS = 250n * 10n ** 12n;
const PER_ACCOUNT_PER_MIN = 6;
/** Nonces this instance has relayed recently, so two copies of one action sent at once are paid for only once. */
const seen = new Map<string, number>();
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
    publicKey: { ed25519Key?: { data: number[] | Uint8Array } };
  };
  signature: { ed25519Signature?: { data: number[] | Uint8Array } };
};

// Best effort: each server instance keeps its own counters. The checks below are what actually protect the relayer.
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
  if (/NotEnoughBalance|LackBalanceForState/.test(s)) return "Your guest account is out of NEAR for deposits.";
  if (/Exceeded the prepaid gas/.test(s)) return "The transaction ran out of gas.";
  return "NEAR rejected the transaction.";
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function finalHeight(): Promise<bigint> {
  const res = await fetch(RPC_URLS[0], {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "relay", method: "block", params: { finality: "final" } }),
    signal: AbortSignal.timeout(6000),
  });
  const body = await res.json();
  if (body.error) throw new Error("rpc");
  return BigInt(body.result.header.height);
}

export async function POST(req: Request) {
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  if (!relayer || !key) return bad("The relayer is not configured on this server.", 503);

  let bytes: Uint8Array;
  try {
    const body = await req.json();
    bytes = Uint8Array.from(Buffer.from(String(body?.signedDelegate ?? ""), "base64"));
    if (bytes.length < 64 || bytes.length > 8192) throw new Error("size");
  } catch {
    return bad("Send JSON: { signedDelegate: base64 }");
  }

  let decoded: Decoded;
  try {
    decoded = deserialize(SCHEMA.SignedDelegate, bytes) as unknown as Decoded;
  } catch {
    return bad("That is not a signed delegate action.");
  }
  const da = decoded.delegateAction;
  const guest = new RegExp(`^g-[0-9a-f]{10}\\.${relayer.replace(/\./g, "\\.")}$`);
  if (da.receiverId !== CONTRACT) return bad(`Only calls to ${CONTRACT} are relayed.`);
  if (!guest.test(da.senderId)) return bad("Only Petri guest accounts are relayed; wallet accounts pay their own gas.", 403);
  if (da.actions.length !== 1) return bad("Relay one call at a time.");
  const fc = da.actions[0].functionCall;
  if (!fc || !ALLOWED.has(fc.methodName)) return bad("Only join, buy, plant, sell, claim, advance and mint_slide are relayed.");
  if (BigInt(fc.deposit) !== 0n) return bad("Relayed calls carry no NEAR; guests pay from their sponsored credit.");
  if (BigInt(fc.gas) > MAX_GAS) return bad("Too much gas requested.");

  // The signature must be valid for exactly this delegate action.
  const pk = da.publicKey.ed25519Key?.data;
  const sig = decoded.signature.ed25519Signature?.data;
  if (!pk || !sig) return bad("Only ed25519 keys are relayed.");
  let valid = false;
  try {
    valid = ed25519.verify(Uint8Array.from(sig), sha256(encodeDelegateAction(da as never)), Uint8Array.from(pk));
  } catch {
    valid = false;
  }
  if (!valid) return bad("The signature does not match this action.", 403);

  const why = limited(da.senderId);
  if (why) return bad(why, 429);

  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  try {
    if (BigInt(da.maxBlockHeight) <= (await finalHeight())) return bad("The signed action expired before it was relayed. Try again.", 409);
  } catch {
    return bad("Could not read the chain. Try again.", 503);
  }
  const nonceKey = `${da.senderId}:${da.nonce}`;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 300_000) seen.delete(k);
  if (seen.has(nonceKey)) return bad("That action was already sent. Try again.", 409);
  seen.set(nonceKey, now);
  // The key must exist on the guest's account, and the nonce must be fresh, or NEAR would reject it and we would pay.
  try {
    const ak = await provider.viewAccessKey({ accountId: da.senderId, publicKey: `ed25519:${baseEncode(Uint8Array.from(pk))}` });
    if (BigInt(da.nonce) <= BigInt(ak.nonce)) return bad("That action was already used. Try again.", 409);
  } catch {
    return bad("This guest account or its key does not exist.", 403);
  }

  try {
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
    return bad(funds ? "The relayer is out of gas money. It is topped up regularly; try again soon." : "The relay did not go through. Try again.", 502);
  }
}
