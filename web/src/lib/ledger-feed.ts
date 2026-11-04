"use client";
// The dish's ledger, read once per page and then only its new entries, whenever the contract's entry count moves. Every
// page that rebuilds something from the ledger (pacts, a slide's history, the council) shares this one read.

import { useEffect, useSyncExternalStore } from "react";
import { getLedger, type Entry } from "./chain";
import { useDish } from "./dish-store";

export type LedgerFeed = { status: "loading" | "ready" | "error"; entries: Entry[]; error?: string };

let feed: LedgerFeed = { status: "loading", entries: [] };
const listeners = new Set<() => void>();
let reading: Promise<void> | null = null;
let wanted = 0;

function emit(patch: Partial<LedgerFeed>) {
  feed = { ...feed, ...patch };
  listeners.forEach((l) => l());
}

/** Read entries until the cache holds `total` of them (the `ledger` count in the dish's state). Entries never change once
 * written, so only the tail is ever read again. */
async function readTo(total: number) {
  wanted = Math.max(wanted, total);
  if (reading) return reading;
  reading = (async () => {
    try {
      while (feed.entries.length < wanted) {
        const from = feed.entries.length;
        const page = await getLedger(from, Math.min(1000, wanted - from));
        if (page.length === 0) break;
        emit({ entries: feed.entries.concat(page) });
      }
      emit({ status: "ready", error: undefined });
    } catch (e) {
      emit({ status: feed.entries.length ? "ready" : "error", error: e instanceof Error ? e.message : String(e) });
    } finally {
      reading = null;
    }
  })();
  return reading;
}

/** The whole ledger, kept current with the dish. */
export function useLedger(): LedgerFeed {
  const d = useDish();
  const total = d.state ? Number(d.state.ledger) : null;
  // Checked on every poll of the dish, so a failed read is tried again a few seconds later.
  useEffect(() => {
    if (total === null) return;
    if (total === 0) emit({ status: "ready" });
    else if (total > feed.entries.length) readTo(total);
  }, [total, d.syncedAt]);
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => feed,
    () => feed,
  );
}
