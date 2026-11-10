// Server only. Free play with implicit accounts (mainnet during judging; testnet for a rehearsal): what the relayer
// can still afford, how many guests it has made, and making one. See lib/guest-program.ts for the rules.

import { PublicKey, actions } from "near-api-js";
import { rpcCall } from "./rpc";
import { type GuestProgram, ticketFor } from "./guest-program";
import { relayerAccount, sponsorUntilCredited, sponsoredBy, view } from "@/app/api/guest/credit";

/** What a new implicit guest is sent: one yoctoNEAR. NEAR's zero-balance accounts (one key, under 770 bytes) need no
 * NEAR for storage, so this only creates the account; the protocol's 0.007 NEAR account-creation charge is paid by
 * the relayer on top (measured on testnet: 0.007115 NEAR with the transfer's gas). */
export const IMPLICIT_DUST = 1n;
const BYTE = 10n ** 19n;

type AccountView = { amount: string; locked: string; storage_usage: number };

export async function relayerFunds(p: GuestProgram): Promise<{ amount: bigint; spendable: bigint }> {
  const a = await rpcCall<AccountView>(p.net, "query", { request_type: "view_account", finality: "optimistic", account_id: p.relayer }, { id: "guest", timeoutMs: 6000 });
  const amount = BigInt(a.amount);
  // Storage is counted although a zero-balance account does not need it held, so the floor is never overstated.
  return { amount, spendable: amount - BigInt(a.storage_usage) * BYTE };
}

type Scan = { next: number; made: Set<string>; at: number };
const scans = new Map<string, Scan>();

/** Every account this relayer has sponsored on the dish, from the dish's own ledger (its `Sponsor` entries): the count
 * no server instance can lose and nobody but the relayer's key can add to. Read incrementally, at most every 8 s. */
export async function guestsMade(p: GuestProgram, fresh = false): Promise<Set<string>> {
  const k = `${p.net}:${p.contract}:${p.relayer}`;
  const s = scans.get(k) ?? { next: p.limits?.ledgerFrom ?? 0, made: new Set<string>(), at: 0 };
  if (!fresh && Date.now() - s.at < 8000) return s.made;
  const st = await view<{ ledger: string }>("state", {}, p.net);
  const len = Number(st.ledger);
  while (s.next < len) {
    const page = await view<Record<string, { account?: string; sponsor?: string }>[]>("ledger", { from: s.next, limit: 1000 }, p.net);
    if (!page.length) break;
    for (const e of page) if (e.Sponsor?.sponsor === p.relayer && e.Sponsor.account) s.made.add(e.Sponsor.account);
    s.next += page.length;
  }
  s.at = Date.now();
  scans.set(k, s);
  return s.made;
}

export type ImplicitStatus = {
  open: boolean;
  /** Before the window: "soon"; after it: "closed"; inside it: "full" once every place is taken, "spent" when the
   * relayer's balance above its floor no longer pays for another guest. */
  why: "open" | "soon" | "closed" | "full" | "spent";
  opensAt: number;
  closesAt: number;
  cap: number;
  made: number;
  left: number;
  guests: string[];
};

export async function implicitStatus(p: GuestProgram, fresh = false): Promise<ImplicitStatus> {
  const l = p.limits!;
  const [made, funds] = await Promise.all([guestsMade(p, fresh), relayerFunds(p).catch(() => null)]);
  const byBudget = funds && funds.spendable > l.floor ? Number((funds.spendable - l.floor) / l.reserve) : 0;
  const left = Math.max(0, Math.min(l.cap - made.size, byBudget));
  const now = Date.now();
  const why = now < l.start ? "soon" : now >= l.end ? "closed" : left > 0 ? "open" : made.size >= l.cap ? "full" : "spent";
  return { open: why === "open", why, opensAt: l.start, closesAt: l.end, cap: l.cap, made: made.size, left, guests: [...made] };
}

/** One maker at a time per server instance, so two requests cannot both take the last place. */
let making: Promise<unknown> = Promise.resolve();
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = making.then(f, f);
  making = run.catch(() => {});
  return run;
}

/** Why no guest can be made inside the window, in words. */
export function fullText(st: ImplicitStatus): string {
  return st.why === "spent"
    ? "Free mainnet play has spent its budget. Connect a NEAR wallet, or play free on testnet."
    : `All ${st.cap} free mainnet colonies have been given out. Connect a NEAR wallet, or play free on testnet.`;
}

export class GuestRefusal extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** Make the implicit guest of `publicKey`: check the window, the cap and the relayer's floor, create the account with
 * one yoctoNEAR, read its key's nonce, sponsor it, and return its ticket. */
export async function makeImplicitGuest(p: GuestProgram, publicKey: string): Promise<{ accountId: string; credited: boolean; ticket: string; cost: bigint }> {
  return serial(async () => {
    const st = await implicitStatus(p, true);
    if (st.why === "soon") throw new GuestRefusal(`Free mainnet play opens ${new Date(st.opensAt).toUTCString().replace(":00 GMT", " UTC")}.`, 403);
    if (st.why === "closed") throw new GuestRefusal("Free mainnet play has closed. Connect a NEAR wallet, or play free on testnet.", 403);
    if (st.why !== "open") throw new GuestRefusal(fullText(st), 409);
    const pk = PublicKey.fromString(publicKey);
    const accountId = Buffer.from(pk.data).toString("hex");
    if (accountId === p.relayer) throw new GuestRefusal("That key is not a guest's.", 400);
    const exists = await rpcCall<AccountView>(p.net, "query", { request_type: "view_account", finality: "optimistic", account_id: accountId }, { id: "guest", timeoutMs: 6000 })
      .then(() => true)
      .catch((e) => (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e?.message ?? e)) ? false : Promise.reject(e)));
    // An account that already exists was not made by us (one key makes one guest): its owner plays with a wallet.
    if (exists) throw new GuestRefusal("An account for this key already exists. Reload the page to make a new key.", 409);
    const relayer = relayerAccount(p.relayer, p.key, p.net);
    const before = (await relayerFunds(p)).amount;
    await relayer.signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(IMPLICIT_DUST)], waitUntil: "EXECUTED_OPTIMISTIC" });
    // The key's nonce as created: every relayed move must use a higher one, so it counts the moves.
    let nonce0: bigint | null = null;
    for (let i = 0; i < 12 && nonce0 === null; i++) {
      const ak = await rpcCall<{ nonce: number | string }>(p.net, "query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey }, { id: "guest", timeoutMs: 6000 }).catch(() => null);
      if (ak) nonce0 = BigInt(ak.nonce);
      else await new Promise((r) => setTimeout(r, 600));
    }
    if (nonce0 === null) throw new GuestRefusal("NEAR did not show the new account in time. Try again in a moment.", 502);
    const credited = await sponsorUntilCredited(relayer, accountId, p.net).catch(() => false);
    const after = await relayerFunds(p).then((f) => f.amount).catch(() => before);
    // Make the next status read see this guest.
    scans.get(`${p.net}:${p.contract}:${p.relayer}`)!.at = 0;
    return { accountId, credited, ticket: ticketFor(p, accountId, nonce0), cost: before - after };
  });
}

export { sponsoredBy };
