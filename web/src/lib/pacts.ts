"use client";
// Pacts, rebuilt from the ledger. A pact is three entries at most: PactOffer (colony `from` offers colony `to` PETRI,
// held by the dish, for `to`'s promise not to plant within rules.pact_radius cells of `from`'s living cells before
// generation `until`), PactAccept (`to` took the PETRI; from then the contract refuses every planting of `to` that would
// break it) and PactEnd (an offer withdrawn, declined or lapsed, its PETRI back to `from`; or an accepted pact closed
// once `until` came). The `pact(id)` view is read for every pact the ledger has not ended, as a check on the rebuild.

import { useEffect, useMemo, useState } from "react";
import { getPact, type Entry, type PactView } from "./chain";
import { useLedger } from "./ledger-feed";
import type { StrainPact } from "./strain-log";

export type Pact = {
  id: number;
  /** the colony that pays, and is protected */
  from: number;
  /** the colony that is paid, and bound */
  to: number;
  /** PETRI units */
  petri: bigint;
  until: number;
  /** generation of the offer, and its place in the ledger (null for a pact known only from the strains' log) */
  offered: number | null;
  index: number | null;
  /** credit that paid for the offer's storage */
  spent: bigint | null;
  accepted: number | null;
  ended: number | null;
};

/** Where a pact stands at generation `g`. */
export type PactPhase = "open" | "binding" | "due" | "lapsed" | "ended" | "withdrawn";

export function phaseOf(p: Pact, g: number): PactPhase {
  if (p.ended !== null) return p.accepted !== null ? "ended" : "withdrawn";
  if (p.accepted !== null) return g < p.until ? "binding" : "due";
  return g < p.until ? "open" : "lapsed";
}

/** The three words the pages use: an offer still open, a pact that binds now, or one that no longer does. */
export function stageOf(phase: PactPhase): "open" | "binding" | "ended" {
  return phase === "open" ? "open" : phase === "binding" ? "binding" : "ended";
}

export const PHASE_TEXT: Record<PactPhase, string> = {
  open: "Open offer",
  binding: "Binding",
  due: "Ran its course",
  lapsed: "Lapsed unaccepted",
  ended: "Ended",
  withdrawn: "Never accepted",
};

/** Every pact in the ledger, in number order. */
export function pactsFromLedger(entries: Entry[]): Pact[] {
  const out: Pact[] = [];
  entries.forEach((e, i) => {
    if ("PactOffer" in e) {
      const o = e.PactOffer;
      out[o.pact - 1] = {
        id: o.pact,
        from: o.from,
        to: o.to,
        petri: BigInt(o.petri),
        until: Number(o.until),
        offered: Number(o.generation),
        index: i,
        spent: o.spent ? BigInt(o.spent) : null,
        accepted: null,
        ended: null,
      };
    } else if ("PactAccept" in e) {
      const p = out[e.PactAccept.pact - 1];
      if (p) p.accepted = Number(e.PactAccept.generation);
    } else if ("PactEnd" in e) {
      const p = out[e.PactEnd.pact - 1];
      if (p) p.ended = Number(e.PactEnd.generation);
    }
  });
  return out.filter(Boolean);
}

/** A pact as the strains' log carries it (the `pacts_of` view with names), for when the ledger cannot be read. */
export function pactFromView(v: PactView | StrainPact): Pact {
  return {
    id: v.id,
    from: v.from,
    to: v.to,
    petri: BigInt(v.petri),
    until: Number(v.until),
    offered: null,
    index: null,
    spent: null,
    accepted: v.accepted !== null ? Number(v.accepted) : null,
    ended: v.ended !== null ? Number(v.ended) : null,
  };
}

/**
 * The cells a pact keeps its promisor out of: every cell within `radius` (across or down, wrapping) of a living cell of
 * one of `payers`, as the contract's `pact_breach` checks it. A mask of 1s over the dish.
 */
export function pactZone(cells: Uint16Array, payers: number[], radius: number, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  if (!payers.length) return out;
  const want = new Set(payers);
  // Separable: widen each living cell along its row, then each marked cell along its column.
  const row = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!want.has(cells[y * w + x])) continue;
      for (let dx = -radius; dx <= radius; dx++) row[y * w + ((x + dx + w) % w)] = 1;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!row[y * w + x]) continue;
      for (let dy = -radius; dy <= radius; dy++) out[((y + dy + h) % h) * w + x] = 1;
    }
  return out;
}

export type PactBook = {
  status: "loading" | "ready" | "error";
  /** where the list came from: the ledger, or only the strains' log while the ledger cannot be read */
  source: "ledger" | "log";
  pacts: Pact[];
  /** the `pact(id)` view for each pact the ledger has not ended, read to check the rebuild */
  views: Map<number, PactView | null>;
};

/** Every pact on the dish, from the ledger (or, while it cannot be read, from the strains' log), with the contract's
 * own view of each live one. */
export function usePacts(fromLog?: StrainPact[]): PactBook {
  const ledger = useLedger();
  const fromLedger = useMemo(() => pactsFromLedger(ledger.entries), [ledger.entries]);
  const useLog = ledger.status === "error" && !ledger.entries.length && !!fromLog?.length;
  const pacts = useMemo(() => (useLog ? (fromLog ?? []).map(pactFromView) : fromLedger), [useLog, fromLog, fromLedger]);
  const live = pacts.filter((p) => p.ended === null).map((p) => p.id);
  const key = `${live.join(",")}|${ledger.entries.length}`;
  const [views, setViews] = useState<Map<number, PactView | null>>(new Map());
  useEffect(() => {
    if (!live.length) return;
    let stop = false;
    Promise.all(live.map((id) => getPact(id).then((v) => [id, v] as const, () => null))).then((rows) => {
      if (stop) return;
      const m = new Map<number, PactView | null>();
      for (const r of rows) if (r) m.set(r[0], r[1]);
      setViews(m);
    });
    return () => {
      stop = true;
    };
    // `key` stands for the live pacts and the ledger's length.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { status: useLog ? "ready" : ledger.status, source: useLog ? "log" : "ledger", pacts, views };
}

/** Whether the contract's view agrees with the pact rebuilt from the ledger (accepted, ended, terms). */
export function viewAgrees(p: Pact, v: PactView | null | undefined): boolean | null {
  if (v === undefined) return null;
  if (v === null) return false;
  return (
    v.from === p.from &&
    v.to === p.to &&
    BigInt(v.petri) === p.petri &&
    Number(v.until) === p.until &&
    (v.accepted !== null) === (p.accepted !== null) &&
    (v.ended !== null) === (p.ended !== null)
  );
}
