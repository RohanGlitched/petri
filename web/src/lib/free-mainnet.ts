"use client";
// Free play on mainnet, as the site's server reports it (/api/guest/status?net=mainnet): whether it is on, its window,
// how many free colonies are left, and which accounts are its guests. Reading it also registers those guests with
// lib/sides.ts, so every count on the site files them as guests, never as outside players.

import { useEffect, useState } from "react";
import { addSponsoredGuests } from "./sides";

export type FreeMainnet = {
  on: boolean;
  open?: boolean;
  why?: "open" | "judges" | "soon" | "closed" | "full" | "spent";
  opensAt?: number;
  closesAt?: number;
  cap?: number;
  made?: number;
  left?: number;
  /** Places held for judges with a code, and how many of `left` only a code opens. */
  judgePlaces?: number;
  judgeLeft?: number;
  publicLeft?: number;
  guests?: string[];
  relayer?: string;
};

let cached: { at: number; value: FreeMainnet } | null = null;
let loading: Promise<FreeMainnet> | null = null;

function load(force = false): Promise<FreeMainnet> {
  if (!force && cached && Date.now() - cached.at < 20_000) return Promise.resolve(cached.value);
  loading ??= fetch("/api/guest/status?net=mainnet", { cache: "no-store" })
    .then((r) => r.json())
    .then((v: FreeMainnet) => {
      if (v.guests) addSponsoredGuests(v.guests);
      cached = { at: Date.now(), value: v };
      return v;
    })
    .catch(() => ({ on: false }) as FreeMainnet)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Free mainnet play's state, refreshed every 30 s while shown; null until read. */
export function useFreeMainnet(enabled = true): FreeMainnet | null {
  const [v, setV] = useState<FreeMainnet | null>(cached?.value ?? null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = () => load().then((x) => !stop && setV(x));
    tick();
    const t = setInterval(tick, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [enabled]);
  return v;
}

/** "Sat 14 Nov, 18:00 UTC". */
export function utcWhen(ms: number): string {
  const d = new Date(ms);
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}
