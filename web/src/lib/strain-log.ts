"use client";
// The strains' public action log (served by /api/strains) and what it says about the model right now.

import { useEffect, useState } from "react";
import { NETWORK } from "./config";

export type StrainAction = {
  at: string;
  strain: string;
  account: string;
  generation: number;
  pattern: string;
  cells: number;
  cost: number;
  note: string;
  tx: string;
  decided_by: "model" | "rules";
  model: string | null;
  chat_id: string | null;
  signature: { signature?: string; signing_address?: string; text?: string } | null;
  model_error?: string | null;
  /** NEAR AI answers: whether the enclave's signature over the exact request and response checked out */
  tee?: { ok: boolean; reason?: string | null } | null;
  /** a move by a strain a visitor spawned (agents/swarm) */
  spawned?: boolean;
  options: string[];
};

/** Who chose a strain's move, in a few words: the model by name (and whether its TEE signature checks), or the rules. */
export function chooserOf(a: StrainAction | undefined): { short: string; long: string } {
  if (!a || a.decided_by !== "model") return { short: "Rules", long: "Chosen by the strain's written rules (no model answered)" };
  const m = (a.model ?? "").toLowerCase();
  if (m.includes("claude")) return { short: "Claude Haiku", long: `Chosen by Claude Haiku (${a.model})` };
  if (a.tee?.ok) return { short: "NEAR AI · TEE-verified", long: `Chosen by ${a.model ?? "a NEAR AI Cloud model"} inside a TEE; its enclave signature was checked` };
  if (a.signature?.signature) return { short: "NEAR AI · TEE-signed", long: `Chosen by ${a.model ?? "a NEAR AI Cloud model"} inside a TEE, which signed the answer` };
  return { short: "NEAR AI", long: `Chosen by ${a.model ?? "a NEAR AI Cloud model"}` };
}

/** A pact a house strain is party to, as the contract holds it (the `pacts_of` view) with both colonies named: `to`
 * may not plant within rules.pact_radius of `from`'s living cells until `until` while `binding`. */
export type StrainPact = {
  id: number;
  from: number;
  to: number;
  from_name: string;
  to_name: string;
  petri: string;
  until: string;
  accepted: string | null;
  ended: string | null;
  binding: boolean;
};

export type StrainLog = {
  model: string | null;
  health: { at: string; near: Record<string, number | null>; modelErrors?: number } | null;
  actions: StrainAction[];
  /** the pacts the house strains are party to on chain now (open offers and binding pacts) */
  pacts?: StrainPact[];
  error?: string;
};

/** Polls the strains' log every 20 s. `null` until the first answer. */
export function useStrainLog(): StrainLog | null {
  const [log, setLog] = useState<StrainLog | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch(`/api/strains?net=${NETWORK}`, { cache: "no-store" });
        const body = (await r.json()) as StrainLog;
        if (!stop) setLog({ ...body, actions: body.actions ?? [] });
      } catch {
        if (!stop) setLog({ model: null, health: null, actions: [], error: "The strains' log could not be reached." });
      }
    };
    load();
    const t = setInterval(load, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return log;
}

/**
 * Whether the model is answering, judged from the log alone. The latest run of moves chosen by the written rules means
 * the model has stopped answering; `since` is the generation of the first move in that run that logged a model error
 * (or the first move of the run when none did).
 */
export function modelStatus(actions: StrainAction[]): { offline: boolean; since: number | null } {
  if (actions.length === 0) return { offline: false, since: null };
  let i = actions.length - 1;
  while (i >= 0 && actions[i].decided_by === "rules") i--;
  const run = actions.slice(i + 1);
  if (run.length === 0) return { offline: false, since: null };
  const first = run.find((a) => a.model_error) ?? run[0];
  return { offline: true, since: Number(first.generation) };
}

/** Log actions keyed by `${account}|${generation}`, so a planting finds the move that made it. */
export function actionIndex(actions: StrainAction[]) {
  const m = new Map<string, StrainAction>();
  for (const a of actions) m.set(`${a.account}|${Number(a.generation)}`, a);
  return {
    find(account: string, generation: number): StrainAction | undefined {
      return m.get(`${account}|${generation}`) ?? m.get(`${account}|${generation - 1}`) ?? m.get(`${account}|${generation + 1}`);
    },
  };
}

/** How long a strain may sit still before the site stops saying the strains play "around the clock". */
export const RESTING_AFTER_MS = 6 * 3600_000;

/**
 * Whether the house strains are moving now, judged from the newest logged move by any of `accounts`: `active` when it
 * is under six hours old, with its age. `null` until the log has been read.
 */
export function strainPulse(log: StrainLog | null, accounts: string[], now = Date.now()): { active: boolean; ageMs: number | null } | null {
  if (!log) return null;
  let last = 0;
  for (const a of log.actions) if (accounts.includes(a.account)) last = Math.max(last, new Date(a.at).getTime() || 0);
  if (!last) return { active: false, ageMs: null };
  const ageMs = Math.max(0, now - last);
  return { active: ageMs < RESTING_AFTER_MS, ageMs };
}

/** "4 min ago", "3 h ago", "2 days ago". */
export function agoText(ms: number): string {
  const m = ms / 60_000;
  if (m < 1.5) return "just now";
  if (m < 90) return `${Math.round(m)} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} days ago`;
}
