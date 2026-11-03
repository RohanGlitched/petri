"use client";
// The strains' public action log (served by /api/strains) and what it says about the model right now.

import { useEffect, useState } from "react";

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
  options: string[];
};

export type StrainLog = {
  model: string | null;
  health: { at: string; near: Record<string, number | null>; modelErrors?: number } | null;
  actions: StrainAction[];
  error?: string;
};

/** Polls the strains' log every 20 s. `null` until the first answer. */
export function useStrainLog(): StrainLog | null {
  const [log, setLog] = useState<StrainLog | null>(null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/strains", { cache: "no-store" });
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
