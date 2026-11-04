// The house council as the strains' log records it (agents/council.mjs): once a tide window each strain may offer
// another a pact, the other's model accepts or declines in a short sentence, and an accepted deal is made on chain
// (pact_offer by the payer, pact_accept by the promisor). The log is what the strains said; the chain is what they did.

import type { StrainLog } from "./strain-log";

export type CouncilStatus =
  | "round"
  | "proposed"
  | "invalid"
  | "accepted"
  | "declined"
  | "cleared"
  | "cancelled"
  | "would offer"
  | "offered"
  | "pact made"
  | "offer withdrawn"
  | "offer failed"
  | "kept"
  | "broken";

export type CouncilEvent = {
  at: string;
  network?: string;
  contract?: string;
  window: number;
  generation: number;
  /** `t12` for a round, `t12-3` for one offer in it */
  id: string;
  /** the number the contract gave the pact, once it was offered on chain */
  pact_id: number | null;
  from: string | null;
  from_account?: string | null;
  to: string | null;
  to_account?: string | null;
  petri: number;
  until?: number | null;
  terms: string | null;
  status: CouncilStatus;
  tx: string | null;
  accept_tx?: string | null;
  kept: boolean | null;
  /** the pitch (proposed), the reply (accepted or declined), what went wrong, or the round's summary */
  note?: string;
  model?: string | null;
};

/** One offer through a council round: the pitch, the answer, what happened on chain and, later, whether faith held. */
export type CouncilOffer = {
  id: string;
  from: string;
  fromAccount: string | null;
  to: string;
  toAccount: string | null;
  petri: number;
  until: number | null;
  terms: string | null;
  pitch: string | null;
  pitchModel: string | null;
  invalid: string | null;
  answer: "accepted" | "declined" | null;
  reply: string | null;
  replyModel: string | null;
  /** set when a declined offer cleared in the sealed round: the payer's sealed bid covered the promisor's ask */
  cleared: string | null;
  /** the last on-chain step: pact made, offer failed, withdrawn, cancelled, or a dry run */
  outcome: CouncilStatus | null;
  outcomeNote: string | null;
  pactId: number | null;
  tx: string | null;
  acceptTx: string | null;
  faith: "kept" | "broken" | null;
  faithNote: string | null;
};

export type CouncilRound = { window: number; generation: number; at: string; summary: string | null; offers: CouncilOffer[] };

export function councilOf(log: StrainLog | null): CouncilEvent[] {
  const c = (log as (StrainLog & { council?: unknown }) | null)?.council;
  return Array.isArray(c) ? (c as CouncilEvent[]) : [];
}

/** Council events grouped into rounds, newest first, for one dish. */
export function councilRounds(events: CouncilEvent[], contract: string): CouncilRound[] {
  const rounds = new Map<number, CouncilRound>();
  const offers = new Map<string, CouncilOffer>();
  for (const e of events) {
    if (e.contract && e.contract !== contract) continue;
    let r = rounds.get(e.window);
    if (!r) rounds.set(e.window, (r = { window: e.window, generation: e.generation, at: e.at, summary: null, offers: [] }));
    if (e.status === "round") {
      r.summary = e.note ?? null;
      r.generation = e.generation;
      r.at = e.at;
      continue;
    }
    if (!e.from || !e.to) continue;
    let o = offers.get(e.id);
    if (!o) {
      o = {
        id: e.id,
        from: e.from,
        fromAccount: e.from_account ?? null,
        to: e.to,
        toAccount: e.to_account ?? null,
        petri: e.petri,
        until: e.until ?? null,
        terms: e.terms,
        pitch: null,
        pitchModel: null,
        invalid: null,
        answer: null,
        reply: null,
        replyModel: null,
        cleared: null,
        outcome: null,
        outcomeNote: null,
        pactId: null,
        tx: null,
        acceptTx: null,
        faith: null,
        faithNote: null,
      };
      offers.set(e.id, o);
      r.offers.push(o);
    }
    if (e.pact_id) o.pactId = e.pact_id;
    if (e.tx) o.tx = e.tx;
    if (e.accept_tx) o.acceptTx = e.accept_tx;
    if (e.until) o.until = e.until;
    switch (e.status) {
      case "proposed":
        o.pitch = e.note ?? null;
        o.pitchModel = e.model ?? null;
        break;
      case "invalid":
        o.invalid = e.note ?? "not a pact the contract would take";
        o.pitchModel = e.model ?? null;
        break;
      case "accepted":
      case "declined":
        o.answer = e.status;
        o.reply = e.note || null;
        o.replyModel = e.model ?? null;
        break;
      case "cleared":
        o.cleared = e.note ?? "cleared in the sealed round";
        o.petri = e.petri ?? o.petri;
        break;
      case "kept":
      case "broken":
        o.faith = e.status;
        o.faithNote = e.note ?? null;
        break;
      default:
        o.outcome = e.status;
        o.outcomeNote = e.note || null;
    }
  }
  return [...rounds.values()].sort((a, b) => b.window - a.window);
}

/** The transactions the strains' log names for each pact number. */
export function councilTxs(events: CouncilEvent[], contract: string): Map<number, { tx: string | null; acceptTx: string | null }> {
  const m = new Map<number, { tx: string | null; acceptTx: string | null }>();
  for (const e of events) {
    if (!e.pact_id || (e.contract && e.contract !== contract)) continue;
    const x = m.get(e.pact_id) ?? { tx: null, acceptTx: null };
    if (e.tx) x.tx = e.tx;
    if (e.accept_tx) x.acceptTx = e.accept_tx;
    m.set(e.pact_id, x);
  }
  return m;
}
