// Re-sponsors an existing guest that holds no sponsored credit on the dish as it is now. A relaunched dish starts from
// generation 0 with no credit at all, so a browser that remembered its guest from before would otherwise be stuck:
// `join` would refuse it for having "0 NEAR of won and sponsored credit".
//
// The same guards as making a guest, short of the proof of work (the guest was already paid for once): the account
// must be one of this relayer's guests (its name derived from its function-call key for the dish), it must have no
// colony on the current dish, and it must hold no credit from this relayer. So each guest is topped up at most once
// per dish, and only before it joins. Each address and the server as a whole are rate limited as well.

import { NextResponse } from "next/server";
import { NETWORK } from "@/lib/config";
import { hasColony, isOurGuest, relayerAccount, sponsorUntilCredited, sponsoredBy } from "../credit";

export const runtime = "nodejs";

const PER_IP_PER_HOUR = 6;
const PER_HOUR = 200;
const hits = new Map<string, number[]>();
let global: number[] = [];
/** Guests being sponsored right now by this instance, so two clicks at once pay once. */
const inFlight = new Set<string>();

function limited(ip: string): string | null {
  const now = Date.now();
  const hour = now - 3600_000;
  global = global.filter((t) => t > hour);
  const mine = (hits.get(ip) ?? []).filter((t) => t > hour);
  if (mine.length >= PER_IP_PER_HOUR) return "This address asked for free credit a few times in the last hour. Try again later.";
  if (global.length >= PER_HOUR) return "Free credit is paused for a few minutes because many guests asked at once. Try again shortly.";
  mine.push(now);
  global.push(now);
  hits.set(ip, mine);
  return null;
}

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return NextResponse.json({ error: "Free credit exists only on testnet." }, { status: 400 });
  const relayer = process.env.PETRI_RELAYER_ACCOUNT;
  const key = process.env.PETRI_RELAYER_KEY;
  if (!relayer || !key) return NextResponse.json({ error: "Guest accounts are not configured on this server." }, { status: 503 });

  let accountId = "";
  try {
    accountId = String((await req.json())?.accountId ?? "");
  } catch {
    return NextResponse.json({ error: "Send JSON: { accountId }" }, { status: 400 });
  }
  if (!/^g-[0-9a-f]{10}\./.test(accountId) || !accountId.endsWith(`.${relayer}`)) {
    return NextResponse.json({ error: "Only free-play guest accounts get free credit." }, { status: 400 });
  }

  try {
    // Already credited: nothing to pay, and no rate limit spent.
    if ((await sponsoredBy(relayer, accountId)) > 0n) return NextResponse.json({ accountId, credited: true });
    if (!(await isOurGuest(relayer, accountId))) return NextResponse.json({ error: "That is not one of this site's guest accounts." }, { status: 403 });
    if (await hasColony(accountId)) return NextResponse.json({ error: "This guest already has a colony on the dish; free credit comes once, before joining." }, { status: 409 });
  } catch (e) {
    console.error("guest sponsor check failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "NEAR did not answer. Try again in a moment." }, { status: 502 });
  }
  if (inFlight.has(accountId)) return NextResponse.json({ error: "Your free credit is already on its way. Retry in a few seconds." }, { status: 409 });
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const why = limited(ip);
  if (why) return NextResponse.json({ error: why }, { status: 429 });

  inFlight.add(accountId);
  try {
    const credited = await sponsorUntilCredited(relayerAccount(relayer, key), accountId).catch(() => false);
    if (!credited) return NextResponse.json({ error: "Your free PETRI is still on its way. Retry in a moment." }, { status: 502 });
    return NextResponse.json({ accountId, credited: true });
  } finally {
    inFlight.delete(accountId);
  }
}
