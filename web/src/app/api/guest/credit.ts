// Shared by /api/guest and /api/guest/sponsor: read a guest's sponsored credit on the current dish, and sponsor it until
// the credit is really there. A sponsor transaction that timed out may still have landed, so every retry first reads
// the credit again: the relayer never pays twice for one guest.

import { Account, actions, nearToYocto } from "near-api-js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { CONTRACT, NETWORK } from "@/lib/config";
import { rpcCall } from "@/lib/rpc";
import { nearProvider } from "@/lib/near-provider";

export const GUEST_CREDIT = "0.05";
/** The same, in yoctoNEAR, for the relayer's daily budget. */
export const GUEST_CREDIT_YOCTO = 5n * 10n ** 22n;

const rpc = <T,>(method: string, params: Record<string, unknown>): Promise<T> => rpcCall<T>(NETWORK, method, params, { id: "guest", timeoutMs: 6000 });

async function view<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: CONTRACT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

/** The credit `relayer` has sponsored for `accountId` on the dish as it is now (a relaunched dish starts empty). */
export async function sponsoredBy(relayer: string, accountId: string): Promise<bigint> {
  const grants = await view<{ sponsor: string; amount: string }[]>("credit_grants", { account_id: accountId });
  return grants.filter((g) => g.sponsor === relayer).reduce((s, g) => s + BigInt(g.amount), 0n);
}

export async function hasColony(accountId: string): Promise<boolean> {
  return (await view<unknown>("colony_of", { account_id: accountId })) !== null;
}

/** True when `accountId` is one of this relayer's guests: its name is derived from one of its keys, and that key is a
 * function-call key for the dish (the key /api/guest added). */
export async function isOurGuest(relayer: string, accountId: string): Promise<boolean> {
  const m = accountId.match(/^g-([0-9a-f]{10})\.(.+)$/);
  if (!m || m[2] !== relayer) return false;
  const list = await rpc<{ keys: { public_key: string; access_key: { permission: unknown } }[] }>("query", {
    request_type: "view_access_key_list",
    finality: "optimistic",
    account_id: accountId,
  }).catch(() => null);
  if (!list) return false;
  return list.keys.some((k) => {
    const p = k.access_key.permission as { FunctionCall?: { receiver_id: string } } | string;
    const forDish = typeof p === "object" && p?.FunctionCall?.receiver_id === CONTRACT;
    return forDish && bytesToHex(sha256(new TextEncoder().encode(k.public_key))).slice(0, 10) === m[1];
  });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sponsor `accountId` with GUEST_CREDIT, up to three tries, and report true only once the credit can be read on chain. */
export async function sponsorUntilCredited(relayer: Account, accountId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if ((await sponsoredBy(relayer.accountId, accountId).catch(() => 0n)) > 0n) return true;
    try {
      await relayer.signAndSendTransaction({
        receiverId: CONTRACT,
        actions: [actions.functionCall("sponsor", { account_id: accountId }, 30n * 10n ** 12n, nearToYocto(GUEST_CREDIT))],
        waitUntil: "EXECUTED_OPTIMISTIC",
      });
      // It landed: never send a second one, only wait for the read to show it.
      break;
    } catch (e) {
      console.error(`guest sponsorship try ${attempt + 1} failed`, e instanceof Error ? e.message : String(e));
      await pause(800 * (attempt + 1));
    }
  }
  // The last try may have landed after its error; read once more before giving up.
  for (let i = 0; i < 3; i++) {
    if ((await sponsoredBy(relayer.accountId, accountId).catch(() => 0n)) > 0n) return true;
    await pause(700);
  }
  return false;
}

export function relayerAccount(relayer: string, key: string): Account {
  return new Account(relayer, nearProvider(NETWORK), key as `ed25519:${string}`);
}
