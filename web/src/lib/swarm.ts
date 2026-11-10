"use client";
// The open swarm as the agents VM reports it (agents/swarm/registry.mjs → /api/strains/swarm): strains visitors spawned,
// the open council's rounds and deals, and the break-the-pact attempts.

import { useEffect, useState } from "react";
import { NETWORK } from "./config";

export type Tee = { ok: boolean; reason?: string | null } | null;

export type Decision = {
  at: string;
  generation: number;
  model: string | null;
  chat_id: string | null;
  tee: Tee;
  usage: { in: number; out: number } | null;
  fee: string;
  choice: number;
  options: number;
  cost: number;
  tx: string | null;
  error: string | null;
};

export type SpawnedStrain = {
  id: string;
  account: string;
  name: string;
  color: number;
  temperament: string;
  prompt: string;
  summary: string;
  guard: { ok: boolean; layer: string; model: string | null; chat_id: string | null; tee: Tee; reasons: string[] };
  created_at: string;
  status: "creating" | "active" | "sleeping" | "failed";
  play_key: string;
  methods: string[];
  txs: Record<string, string>;
  brain: { budget: string; spent: string; fee: string; account: string; payments: { at: string; near: string; tx: string; from: string; credit_tx?: string }[] };
  decisions: Decision[];
  topups: number;
  keys?: { public_key: string; kind: string }[];
  locked?: boolean;
  colony?: number | null;
  error?: string;
};

export type Deal = {
  id: string;
  round: number;
  cleared_generation: number;
  payer: string;
  payer_colony: number;
  promisor: string;
  promisor_colony: number;
  house: boolean;
  bid: number;
  ask: number;
  price: number;
  pact_gens: number;
  offer_by: number;
  status: string;
  pact_id: number | null;
  accept_tx: string | null;
  note: string;
  until?: number;
};

export type Round = {
  n: number;
  status: "open" | "cleared";
  opened_generation: number;
  closes_generation: number;
  opened_at: string;
  pact_gens: number;
  asks: { house: string; house_name?: string; colony: number; commit: string; ask?: number; lost?: number; salt?: string }[];
  bids: { id: string; account: string; side: string; counterparty: string; commit: string; at?: string; petri?: number }[];
  cleared: { bid: string; payer: string; promisor: string; bid_petri: number; ask_petri: number | null; price?: number; status: string }[];
};

export type BreakAttempt = {
  n: number;
  at: string;
  generation: number;
  tx: string;
  refused: boolean;
  planted: boolean;
  panic: string | null;
  spot: { x: number; y: number };
  by: "agreed" | "anyway";
  model: string | null;
  tee: Tee;
  pact: number;
};

export type Swarm = {
  strains: SpawnedStrain[];
  refused: { at: string; reasons: string[]; model: string | null; layer: string }[];
  council: { rounds: Round[]; deals: Deal[] };
  breaks: {
    refused: number;
    attempts: BreakAttempt[];
    chats: number;
    captive?: string;
    warden?: string;
    captive_colony?: number;
    warden_colony?: number;
    warden_cells?: number;
    pact?: { id: number; petri: number; until: number; binding: boolean } | null;
    radius?: number;
    generation?: number;
  };
  error?: string;
};

const EMPTY: Swarm = { strains: [], refused: [], council: { rounds: [], deals: [] }, breaks: { refused: 0, attempts: [], chats: 0 } };

/** Polls the open swarm every `ms` (20 s by default). `null` until the first answer. Testnet only. */
export function useSwarm(ms = 20_000): [Swarm | null, () => void] {
  const [s, setS] = useState<Swarm | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (NETWORK !== "testnet") {
      setS({ ...EMPTY, error: "The open swarm runs on the testnet dish." });
      return;
    }
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/strains/swarm", { cache: "no-store" });
        const body = await r.json();
        if (!stop) setS(r.ok ? { ...EMPTY, ...body } : { ...EMPTY, error: body.error ?? "The swarm did not answer." });
      } catch {
        if (!stop) setS({ ...EMPTY, error: "The swarm on the agents VM could not be reached." });
      }
    };
    load();
    const t = setInterval(load, ms);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [ms, tick]);
  return [s, () => setTick((t) => t + 1)];
}

export const nearText = (yocto: string | bigint | number, dp = 4) => (Number(BigInt(yocto)) / 1e24).toFixed(dp).replace(/0+$/, "").replace(/\.$/, "");
export const brainLeft = (s: SpawnedStrain) => BigInt(s.brain.budget) - BigInt(s.brain.spent);
export const decisionsLeft = (s: SpawnedStrain) => Number(brainLeft(s) / BigInt(s.brain.fee || "1"));

/** Which model made a move, as one short label: NEAR AI with the enclave's signature checked, or which fallback. */
export function modelLabel(model: string | null | undefined, tee: Tee | undefined): { text: string; tee: boolean } {
  if (!model) return { text: "Written rules", tee: false };
  if (/claude/i.test(model)) return { text: "Claude Haiku", tee: false };
  if (tee?.ok) return { text: "NEAR AI · TEE-verified", tee: true };
  return { text: "NEAR AI · signature not verified", tee: false };
}

/** Owner tokens of strains this browser spawned, by account. */
const OWN = "petri.spawned.v1";
export function ownTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(OWN) ?? "{}");
  } catch {
    return {};
  }
}
export function rememberOwn(account: string, token: string) {
  try {
    localStorage.setItem(OWN, JSON.stringify({ ...ownTokens(), [account]: token }));
  } catch {
    /* this visit only */
  }
}
