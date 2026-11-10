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

/** A judge's guest is sponsored with one yoctoNEAR more than a public one. The dish takes its records' storage (whole
 * bytes at 10^19 yoctoNEAR each) from a sponsorship, so the Sponsor entry's amount keeps that last yoctoNEAR: anyone can
 * count the judge places taken from the ledger, and no server's memory is needed. */
export const JUDGE_MARK = 1n;
const isJudgeGrant = (amount: string | undefined) => amount !== undefined && BigInt(amount) % BYTE === JUDGE_MARK;

type Scan = { next: number; made: Set<string>; judges: Set<string>; at: number };
const scans = new Map<string, Scan>();

/** Every account this relayer has sponsored on the dish, from the dish's own ledger (its `Sponsor` entries): the count
 * no server instance can lose and nobody but the relayer's key can add to. Read incrementally, at most every 8 s. Those
 * whose first sponsorship carries JUDGE_MARK are judges'. */
export async function guestsMade(p: GuestProgram, fresh = false): Promise<Scan> {
  const k = `${p.net}:${p.contract}:${p.relayer}`;
  const s = scans.get(k) ?? { next: p.limits?.ledgerFrom ?? 0, made: new Set<string>(), judges: new Set<string>(), at: 0 };
  if (!fresh && Date.now() - s.at < 8000) return s;
  const st = await view<{ ledger: string }>("state", {}, p.net);
  const len = Number(st.ledger);
  while (s.next < len) {
    const page = await view<Record<string, { account?: string; sponsor?: string; amount?: string }>[]>("ledger", { from: s.next, limit: 1000 }, p.net);
    if (!page.length) break;
    for (const e of page) {
      if (e.Sponsor?.sponsor !== p.relayer || !e.Sponsor.account) continue;
      if (!s.made.has(e.Sponsor.account) && isJudgeGrant(e.Sponsor.amount)) s.judges.add(e.Sponsor.account);
      s.made.add(e.Sponsor.account);
    }
    s.next += page.length;
  }
  s.at = Date.now();
  scans.set(k, s);
  return s;
}

export type ImplicitStatus = {
  /** A guest can be made now (with a judge code, when only judge places are left). */
  open: boolean;
  /** Before the window: "soon"; after it: "closed"; inside it: "open" while public places are left, "judges" when only
   * the places held for judge codes are, "full" once every place is taken, "spent" when the relayer's balance above its
   * floor no longer pays for another guest. */
  why: "open" | "judges" | "soon" | "closed" | "full" | "spent";
  opensAt: number;
  closesAt: number;
  cap: number;
  made: number;
  /** Places left in all, at most what the relayer's balance above its floor still pays for. */
  left: number;
  /** Places held for judge codes. */
  judgePlaces: number;
  /** Of `left`, how many only a judge code opens. */
  judgeLeft: number;
  /** Of `left`, how many anyone can take. */
  publicLeft: number;
  /** Guests made with a judge code (marked on chain). */
  judgesMade: number;
  guests: string[];
};

export async function implicitStatus(p: GuestProgram, fresh = false): Promise<ImplicitStatus> {
  const l = p.limits!;
  const [scan, funds] = await Promise.all([guestsMade(p, fresh), relayerFunds(p).catch(() => null)]);
  const made = scan.made.size;
  const judgesMade = scan.judges.size;
  const judgePlaces = Math.min(l.judgePlaces, l.cap);
  const byBudget = funds && funds.spendable > l.floor ? Number((funds.spendable - l.floor) / l.reserve) : 0;
  const left = Math.max(0, Math.min(l.cap - made, byBudget));
  // The held places come first out of what the budget still pays for; judges may also take public places, the public
  // never a held one.
  const judgeLeft = Math.min(left, Math.max(0, judgePlaces - judgesMade));
  const publicLeft = Math.max(0, Math.min(left - judgeLeft, l.cap - judgePlaces - (made - judgesMade)));
  const now = Date.now();
  const why = now < l.start ? "soon" : now >= l.end ? "closed" : publicLeft > 0 ? "open" : left > 0 ? "judges" : made >= l.cap ? "full" : "spent";
  return { open: why === "open" || why === "judges", why, opensAt: l.start, closesAt: l.end, cap: l.cap, made, left, judgePlaces, judgeLeft, publicLeft, judgesMade, guests: [...scan.made] };
}

/** Guests each judge code made on this server instance. The on-chain mark bounds the places; this bounds one leaked
 * code, per instance, since there is no shared store. */
const codeUses = new Map<number, number>();

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
    : st.why === "judges"
      ? `The public free mainnet places are taken; the ${st.judgeLeft} left are held for judges with a code. Connect a NEAR wallet, or play free on testnet.`
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
export async function makeImplicitGuest(p: GuestProgram, publicKey: string, judge: number | null = null): Promise<{ accountId: string; credited: boolean; ticket: string; cost: bigint }> {
  return serial(async () => {
    const st = await implicitStatus(p, true);
    if (st.why === "soon") throw new GuestRefusal(`Free mainnet play opens ${new Date(st.opensAt).toUTCString().replace(":00 GMT", " UTC")}.`, 403);
    if (st.why === "closed") throw new GuestRefusal("Free mainnet play has closed. Connect a NEAR wallet, or play free on testnet.", 403);
    // A public guest needs a public place; a judge's code opens any place left.
    if (judge === null ? st.why !== "open" : st.left <= 0) throw new GuestRefusal(fullText(st), 409);
    if (judge !== null && (codeUses.get(judge) ?? 0) >= p.limits!.judgeCodeUses) {
      throw new GuestRefusal(`This judge code has already started ${p.limits!.judgeCodeUses} colonies here. Use the one you have, or ask the team for another code.`, 429);
    }
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
    if (judge !== null) codeUses.set(judge, (codeUses.get(judge) ?? 0) + 1);
    const credited = await sponsorUntilCredited(relayer, accountId, p.net, judge !== null ? JUDGE_MARK : 0n).catch(() => false);
    const after = await relayerFunds(p).then((f) => f.amount).catch(() => before);
    // Make the next status read see this guest.
    scans.get(`${p.net}:${p.contract}:${p.relayer}`)!.at = 0;
    return { accountId, credited, ticket: ticketFor(p, accountId, nonce0), cost: before - after };
  });
}

export { sponsoredBy };
