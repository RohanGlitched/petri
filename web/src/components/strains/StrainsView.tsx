"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getAllPlants, type PlantRecord } from "@/lib/chain";
import { STRAINS, KEEPER, MODEL } from "@/lib/strains";
import { accountUrl, txUrl } from "@/lib/config";
import s from "./strains.module.css";

type Action = {
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
type Log = { model: string | null; health: { at: string; near: Record<string, number | null>; modelErrors?: number } | null; actions: Action[]; error?: string };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function StrainsView() {
  const { d, colonies } = useLive();
  const [log, setLog] = useState<Log | null>(null);
  const [plants, setPlants] = useState<PlantRecord[]>([]);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const r = await fetch("/api/strains", { cache: "no-store" });
        const body = (await r.json()) as Log;
        if (!stop) setLog(body);
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

  const total = d.state ? Number(d.state.plants) : 0;
  useEffect(() => {
    if (!total) return;
    getAllPlants(total).then(setPlants).catch(() => {});
  }, [total]);

  const byTx = useMemo(() => new Map((log?.actions ?? []).map((a) => [a.account + "|" + a.note, a])), [log]);
  const modelMoves = (log?.actions ?? []).filter((a) => a.decided_by === "model").length;
  const allMoves = log?.actions.length ?? 0;
  const lastError = [...(log?.actions ?? [])].reverse().find((a) => a.model_error)?.model_error;

  return (
    <>
      <section className={s.status} aria-live="polite">
        <div>
          <span>Model</span>
          <b>{MODEL}</b>
          <em>on NEAR AI Cloud, inside a TEE</em>
        </div>
        <div>
          <span>Moves in the public log</span>
          <b className="num">{int(allMoves)}</b>
          <em>
            {int(modelMoves)} chosen by the model, {int(allMoves - modelMoves)} by the rules fallback
          </em>
        </div>
        <div>
          <span>Agents last checked in</span>
          <b>{log?.health ? ago(log.health.at) : "—"}</b>
          <em>keeper and five strains on one small VM</em>
        </div>
      </section>
      {lastError && modelMoves < allMoves && (
        <p className={s.honest}>
          Right now the model is not answering, so the strains are choosing by their written rules and saying so in the log
          below. The last reason the model gave: <q>{(lastError.match(/"message":"([^"]+)"/)?.[1] ?? lastError.replace(/^NEAR AI \d+: /, "")).slice(0, 140)}</q>
        </p>
      )}

      <ul className={s.grid}>
        {STRAINS.map((st) => {
          const c = colonies.find((x) => x.account === st.account);
          const mine = c ? plants.filter((p) => p.colony === c.id).reverse() : [];
          const notes = mine.filter((p) => p.note).slice(0, 5);
          const actions = (log?.actions ?? []).filter((a) => a.account === st.account);
          const last = actions[actions.length - 1];
          return (
            <li key={st.account} className={s.card}>
              <header className={s.cardHead}>
                <i className="swatch" style={{ background: c ? hex(c.color) : "#888", width: 18, height: 18 }} />
                <h2>{st.name}</h2>
                <span className={s.temper}>{st.temperament}</span>
              </header>
              <p className={s.voice}>{st.voice}</p>
              <p className={s.plays}><b>How it plays.</b> {st.plays}</p>
              <dl className={s.nums}>
                <div><dt>Living cells</dt><dd className="num">{c ? int(c.live) : "—"}</dd></div>
                <div><dt>Earned</dt><dd className="num">{c ? petri(Number(c.petri_earned) + (d.pending[c.id] ?? 0), 1) : "—"}</dd></div>
                <div><dt>Spent planting</dt><dd className="num">{c ? petri(Number(c.petri_burned), 1) : "—"}</dd></div>
                <div><dt>Plantings</dt><dd className="num">{int(mine.length)}</dd></div>
              </dl>
              {last && (
                <div className={s.last}>
                  <p className={s.lastHead}>
                    Last move {ago(last.at)}, chosen by <b>{last.decided_by === "model" ? "the model" : "its rules"}</b>
                  </p>
                  <p className={s.options}>It could have planted: {last.options.slice(0, 4).join("; ")}{last.options.length > 4 ? "; …" : ""}</p>
                  {last.signature?.signature && (
                    <p className={s.sig}>
                      Enclave signature <code>{last.signature.signature.slice(0, 26)}…</code> by <code>{(last.signature.signing_address ?? "").slice(0, 14)}…</code>
                    </p>
                  )}
                </div>
              )}
              <ol className={s.notes}>
                {notes.map((p, i) => {
                  const a = byTx.get(st.account + "|" + p.note);
                  return (
                    <li key={i}>
                      <q>{p.note}</q>
                      <span className="num">
                        Generation {int(Number(p.generation))}, {p.cells.length} cells
                        {a ? `, ${a.decided_by === "model" ? "model" : "rules"}` : ""}
                        {a?.tx && (
                          <>
                            {", "}
                            <a href={txUrl(a.tx)}>transaction</a>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
                {notes.length === 0 && <li className={s.dim}>No lab notes yet.</li>}
              </ol>
              <a className={s.acct} href={accountUrl(st.account)}>{st.account}</a>
            </li>
          );
        })}
        <li className={`${s.card} ${s.keeper}`}>
          <header className={s.cardHead}>
            <i className="swatch" style={{ background: "#bba78f", width: 18, height: 18 }} />
            <h2>The keeper</h2>
            <span className={s.temper}>Clock</span>
          </header>
          <p className={s.voice}>
            Not a player. When nobody has touched the dish for twenty generations it calls advance, which catches the board
            up to the clock and pays every colony what its cells earned. Whoever advances takes the keeper&rsquo;s{" "}
            {d.rules ? d.rules.keeper_bps / 100 : 2}% of the feed, so anyone can do this job.
          </p>
          <p className={s.plays}>
            Paid to keepers so far: <b className="num">{d.state ? petri(Number(d.state.keeper_paid), 2) : "—"} PETRI</b>
          </p>
          <a className={s.acct} href={accountUrl(KEEPER)}>{KEEPER}</a>
        </li>
      </ul>
      <p className={s.cta}>
        <Link className="btn btn-amber" href="/dish">Play against them</Link>
      </p>
    </>
  );
}
