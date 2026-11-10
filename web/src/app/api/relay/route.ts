// Relays a guest's signed delegate action (NEP-366 meta transaction): the guest signs a call to the dish, this
// server wraps it in a transaction and pays the gas. Before paying anything it checks, off chain, what NEAR would
// check before running the call: the sender is one of our guests, the call is one of the dish's own methods (with at
// most three `advance` calls before it) with no deposit and bounded gas in all, the delegate action has not expired,
// the signature is valid for it, and the key exists on the guest's account with a fresh nonce.
//
// Under NEP-366 the relayer would also pay any NEAR an inner call attaches, and a failed call refunds that NEAR to the
// guest, so nothing relayed may attach NEAR at all. Guests pay for joining, buying and planting with the credit the
// relayer sponsored on chain when it made them (see /api/guest), and their keys are function-call keys for the dish
// alone, so the NEAR cannot leave the dish. A call that still fails inside the contract costs the relayer only gas,
// and the per-guest rate limit bounds that. Wallet players sign and pay for themselves.
//
// Every relay also counts against a daily budget (lib/budget.ts): the gas NEAR actually burnt is added up per UTC day,
// in all and per client address (Vercel's x-vercel-forwarded-for, which a client cannot set), and relaying stops for
// the day once either reaches its cap. The break-it lab (/break) sends calls the contract is meant to refuse; those
// are relayed only with `lab` set, within their own daily allowance, and each refusal is tallied.
//
// Mainnet free play (`?net=mainnet`, see lib/guest-program.ts) relays implicit guests: the sender must carry the
// ticket /api/guest gave it, sign with the key its own account name encodes, stay within its relayed moves (counted by
// the key's nonce since it was made), and the relayer must be above its balance floor. The lab is testnet only. On the
// mainnet dish no `advance` is relayed (the keeper catches the dish up; an advance would spend the relayer's NEAR on
// stepping the whole board) and a relayed call prepays at most 100 TGas, so one guest's moves cannot drain the pool.
//
// On both networks a planting's note may not carry a ` · tee:<hex>` tag: that tag names a strain move's TEE proof, and
// a guest copying it would make its own planting look like a verified AI move.

import { NextResponse } from "next/server";
import { Account, SCHEMA, actions, baseEncode, encodeDelegateAction } from "near-api-js";
import { deserialize } from "borsh";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { CONTRACT, NETWORK, type Network } from "@/lib/config";
import { guestProgram, netOf, readTicket, type GuestProgram } from "@/lib/guest-program";
import { relayerFunds } from "@/lib/implicit-guests";
import { rpcCall } from "@/lib/rpc";
import { nearProvider } from "@/lib/near-provider";
import { burnt, clientIp, labAllowed, overBudget, recordRefusal, spent } from "@/lib/budget";
import { hasColony } from "../guest/credit";

export const runtime = "nodejs";

/** The dish's methods a guest may call through the relayer. None may attach NEAR. */
const ALLOWED = new Set(["join", "buy", "plant", "sell", "claim", "advance", "mint_slide", "settle_pending", "pact_offer", "pact_accept", "pact_cancel"]);
/** Calls only the break-it lab relays, each one the contract (or NEAR, for a key that may not make it) refuses: there
 * is no mint and no rule setter, relaunch is private, the dish is initialised, a guest sponsored nobody, and a guest's
 * key cannot attach the 1 yoctoNEAR a transfer needs. */
const LAB = new Set(["ft_mint", "set_rules", "relaunch", "new", "unsponsor", "ft_transfer"]);
const LAB_IDS = /^[a-z0-9-]{2,32}$/;
/** The most gas a relayed call may prepay: 300 TGas, a transaction's limit, which a catch-up on a crowded dish can need
 * (unused gas is refunded to the relayer). */
const MAX_GAS = 300n * 10n ** 12n;
/** On mainnet: the most gas a relayed delegate action may prepay in all (a planting needs well under it once the
 * keeper has the dish current), and no `advance` at all. */
const MAINNET_MAX_GAS = 100n * 10n ** 12n;
/** The tag strain moves carry in their planting notes to name their TEE proof; never relayed for a guest. */
const TEE_TAG = /\btee:[0-9a-f]{4,}/i;
/** Most `advance` calls a relayed delegate action may carry ahead of its call (in all within MAX_GAS). */
const MAX_ADVANCES = 3;
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
  if (/MethodNotFound/.test(s)) return "The contract has no such method.";
  if (/MethodNameMismatch|DelegateActionAccessKeyError|ReceiverMismatch/.test(s)) return "NEAR refused it: this guest's key may not make that call.";
  return "NEAR rejected the transaction.";
}

/** The failure as NEAR reported it, trimmed: the lab shows it next to the readable line. */
function rawFailure(f: unknown): string {
  const s = JSON.stringify(f);
  const m = s.match(/Smart contract panicked: ([^"\\]+)/);
  if (m) return `Smart contract panicked: ${m[1]}`;
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function finalHeight(net: Network): Promise<bigint> {
  const b = await rpcCall<{ header: { height: number } }>(net, "block", { finality: "final" }, { id: "relay", timeoutMs: 6000 });
  return BigInt(b.header.height);
}

export async function POST(req: Request) {
  const net = netOf(req);
  const program = guestProgram(net);
  if (net === "mainnet" && !program) return bad("Free play on mainnet is not open on this server; a NEAR wallet pays its own gas.", 400);
  // An implicit program (mainnet free play) has its own relayer; testnet keeps the one it always had.
  const implicit: GuestProgram | null = program?.kind === "implicit" ? program : null;
  const relayer = implicit ? implicit.relayer : process.env.PETRI_RELAYER_ACCOUNT;
  const key = implicit ? implicit.key : process.env.PETRI_RELAYER_KEY;
  const contract = implicit ? implicit.contract : CONTRACT;
  const chain: Network = implicit ? implicit.net : NETWORK;
  if (!relayer || !key) return bad("The relayer is not configured on this server.", 503);

  let bytes: Uint8Array;
  let lab: string | null = null;
  let ticket: unknown = null;
  try {
    const body = await req.json();
    if (!implicit && typeof body?.lab === "string" && LAB_IDS.test(body.lab)) lab = body.lab;
    ticket = body?.ticket;
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
  if (da.receiverId !== contract) return bad(`Only calls to ${contract} are relayed.`);
  // An implicit guest is ours when its ticket says so (the chain cannot: its credit grant is gone once spent).
  const t = implicit ? readTicket(implicit, ticket) : null;
  if (implicit ? !t || t.account !== da.senderId : !guest.test(da.senderId)) return bad("Only Petri guest accounts are relayed; wallet accounts pay their own gas.", 403);
  // One call, or one call preceded by up to MAX_ADVANCES `advance` calls that bring a dish far behind the clock within
  // one catch-up of it (the actions run in one receipt, so they succeed or fail together).
  if (da.actions.length < 1 || da.actions.length > 1 + MAX_ADVANCES) return bad("Relay one call at a time (with at most 3 advance calls before it).");
  let gas = 0n;
  const names = da.actions.map((a) => a.functionCall?.methodName ?? "");
  for (const [i, a] of da.actions.entries()) {
    const fc = a.functionCall;
    if (!fc || !(ALLOWED.has(fc.methodName) || (lab && LAB.has(fc.methodName)))) return bad("Only join, buy, plant, sell, claim, advance, mint_slide, settle_pending and the pact calls are relayed.");
    if (i < da.actions.length - 1 && fc.methodName !== "advance") return bad("Only advance calls may come before the call itself.");
    if (BigInt(fc.deposit) !== 0n) return bad("Relayed calls carry no NEAR; guests pay from their sponsored credit.");
    if (chain === "mainnet" && fc.methodName === "advance") {
      return bad("On mainnet the relayer does not pay for advancing the dish; the keeper keeps it current. Send the move on its own.", 403);
    }
    if (fc.methodName === "plant") {
      let note: unknown = null;
      try {
        note = JSON.parse(new TextDecoder().decode(Uint8Array.from(fc.args)))?.note;
      } catch {
        return bad("The planting's arguments are not JSON.");
      }
      if (typeof note === "string" && TEE_TAG.test(note)) return bad("A lab note may not carry a tee: tag; those name the strains' TEE proofs.", 403);
    }
    gas += BigInt(fc.gas);
  }
  if (gas > (chain === "mainnet" ? MAINNET_MAX_GAS : MAX_GAS)) return bad(chain === "mainnet" ? "Too much gas requested: a free mainnet move may prepay at most 100 TGas." : "Too much gas requested.");

  // The signature must be valid for exactly this delegate action.
  const pk = da.publicKey.ed25519Key?.data;
  const sig = decoded.signature.ed25519Signature?.data;
  if (!pk || !sig) return bad("Only ed25519 keys are relayed.");
  if (implicit && t) {
    // Only the key the account was made with (its name is that key), within the guest's moves and the window.
    if (Buffer.from(Uint8Array.from(pk)).toString("hex") !== da.senderId) return bad("Only the guest's own key is relayed.", 403);
    const used = BigInt(da.nonce) - t.nonce0;
    if (used > BigInt(implicit.limits!.relaysPerGuest)) {
      return bad(`This free colony has used its ${implicit.limits!.relaysPerGuest} relayed moves, the most a free mainnet colony gets. Connect a NEAR wallet to keep playing with your own NEAR.`, 429);
    }
    if (Date.now() >= implicit.limits!.relayUntil) return bad("Free mainnet play has closed, so the relayer no longer pays for moves. The colony stays on the dish.", 403);
  }
  let valid = false;
  try {
    valid = ed25519.verify(Uint8Array.from(sig), sha256(encodeDelegateAction(da as never)), Uint8Array.from(pk));
  } catch {
    valid = false;
  }
  if (!valid) return bad("The signature does not match this action.", 403);

  // A guest with no colony gains nothing from advancing the dish, and a tide bounty its advance earned would be stranded
  // in an account only a function-call key controls: only colonies' advances are relayed.
  if (names.includes("advance")) {
    const joined = await hasColony(da.senderId, chain).catch(() => null);
    if (joined === null) return bad("Could not read the chain. Try again.", 503);
    if (!joined) return bad("Join the dish before advancing it: a guest without a colony cannot be relayed an advance.", 403);
  }
  const why = limited(da.senderId);
  if (why) return bad(why, 429);
  const ip = clientIp(req);
  const broke = await overBudget(ip, chain);
  if (broke) return bad(broke, 429);
  if (lab) {
    const no = await labAllowed(da.senderId);
    if (no) return bad(no, 429);
  }

  if (implicit) {
    // The floor covers NEAR's hold on this call's prepaid gas; under it, nothing more is relayed.
    const funds = await relayerFunds(implicit).catch(() => null);
    if (!funds) return bad("Could not read the chain. Try again.", 503);
    if (funds.spendable < implicit.limits!.floor) {
      return bad("Free mainnet play has spent its budget, so the relayer no longer pays for moves. The colony stays on the dish; a NEAR wallet can keep playing.", 409);
    }
  }
  const provider = nearProvider(chain);
  try {
    if (BigInt(da.maxBlockHeight) <= (await finalHeight(chain))) return bad("The signed action expired before it was relayed. Try again.", 409);
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
    await spent(ip, burnt(res as never), chain).catch(() => {});
    const failures = [res.status, ...(res.receipts_outcome ?? []).map((r) => r.outcome.status)]
      .map((st) => (st && typeof st === "object" && "Failure" in st ? (st as { Failure?: unknown }).Failure : null))
      .filter(Boolean);
    if (failures.length) {
      const error = failureText(failures[0]);
      if (lab) await recordRefusal({ attempt: lab, hash: res.transaction.hash, text: error, at: Date.now() }).catch(() => {});
      return NextResponse.json({ error, hash: res.transaction.hash, raw: lab ? rawFailure(failures[0]) : undefined }, { status: 422 });
    }
    return NextResponse.json({ hash: res.transaction.hash });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("relay failed", msg);
    const funds = /NotEnoughBalance|LackBalance|balance/i.test(msg);
    return bad(funds ? "The relayer is out of gas money. It is topped up regularly; try again soon." : "The relay did not go through. Try again.", 502);
  }
}
