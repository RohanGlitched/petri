// Free play's state on a network, for the dish's start card and the judge desk: whether it is on, its window, how many
// guests the relayer has made (from the dish's own ledger) and how many places are left (the cap, and what the
// relayer's balance above its floor still pays for), and the guests' accounts, so the site counts them as guests.

import { NextResponse } from "next/server";
import { guestProgram, mainnetGuestsOn, mainnetWindow, netOf } from "@/lib/guest-program";
import { implicitStatus } from "@/lib/implicit-guests";

export const runtime = "nodejs";

const cache = { "cache-control": "public, s-maxage=15, stale-while-revalidate=30" };

export async function GET(req: Request) {
  const net = netOf(req);
  const p = guestProgram(net);
  if (net === "mainnet" && !mainnetGuestsOn()) return NextResponse.json({ net, on: false }, { headers: cache });
  if (!p) {
    // Switched on, but the relayer is not configured yet: say when it opens and give out nothing.
    if (net === "mainnet") {
      const w = mainnetWindow();
      const now = Date.now();
      return NextResponse.json({ net, on: true, kind: "implicit", open: false, why: now < w.start ? "soon" : now >= w.end ? "closed" : "full", opensAt: w.start, closesAt: w.end, cap: w.cap, made: 0, left: 0, judgePlaces: w.judgePlaces, judgeLeft: 0, publicLeft: 0, guests: [] }, { headers: cache });
    }
    return NextResponse.json({ net, on: false }, { headers: cache });
  }
  if (p.kind === "named") return NextResponse.json({ net, on: true, kind: "named", relayer: p.relayer }, { headers: cache });
  try {
    const st = await implicitStatus(p);
    return NextResponse.json({ net, on: true, kind: "implicit", relayer: p.relayer, ...st }, { headers: cache });
  } catch (e) {
    return NextResponse.json({ net, on: true, kind: "implicit", error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
