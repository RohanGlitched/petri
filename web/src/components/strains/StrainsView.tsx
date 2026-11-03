"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getAllPlants, type PlantRecord } from "@/lib/chain";
import { STRAINS, KEEPER, MODEL } from "@/lib/strains";
import { accountUrl, txUrl } from "@/lib/config";
import { useStrainLog, modelStatus, actionIndex } from "@/lib/strain-log";
import s from "./strains.module.css";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function StrainsView() {
  const { d, colonies } = useLive();
  const log = useStrainLog();
  const [plants, setPlants] = useState<PlantRecord[]>([]);

  const total = d.state ? Number(d.state.plants) : 0;
  useEffect(() => {
    if (!total) return;
    getAllPlants(total).then(setPlants).catch(() => {});
  }, [total]);

  // Strains repeat their notes, so a planting is matched to its logged move by account and generation, not by note.
  const index = useMemo(() => actionIndex(log?.actions ?? []), [log]);
  const modelMoves = (log?.actions ?? []).filter((a) => a.decided_by === "model").length;
  const allMoves = log?.actions.length ?? 0;
  const status = useMemo(() => modelStatus(log?.actions ?? []), [log]);

  return (
    <>
      <section className={s.status} aria-live="polite">
        <div>
          <span>
            Model<sup className={s.ref}><a href="#model-note" aria-label="Which model">1</a></sup>
          </span>
          <b>{status.offline ? "Not answering" : "Answering"}</b>
          <em>
            {status.offline && status.since !== null ? `Since generation ${int(status.since)}` : "On NEAR AI Cloud, inside a TEE"}
          </em>
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
      {status.offline && status.since !== null && (
        <p className={s.honest}>
          The model has been offline since generation {int(status.since)}; the strains are playing by their written rules,
          and every move below says which.
        </p>
      )}
      {log?.error && <p className={s.honest}>The strains&rsquo; log could not be reached just now. It is retried every 20 seconds.</p>}

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
                <div><dt>Earned</dt><dd className="num">{c ? petri((d.earnings[c.id] ?? 0) + (d.pending[c.id] ?? 0), 1) : "—"}</dd></div>
                <div><dt>Spent planting</dt><dd className="num">{c ? petri(Number(c.petri_spent), 1) : "—"}</dd></div>
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
                  const a = index.find(st.account, Number(p.generation));
                  return (
                    <li key={i}>
                      <q>{p.note}</q>
                      <span className={`num ${s.meta}`}>
                        <span>Generation {int(Number(p.generation))}</span>
                        <span>{p.cells.length} cells</span>
                        {a && <span className={a.decided_by === "model" ? s.byModel : s.byRules}>{a.decided_by === "model" ? "Chosen by the model" : "Written rules"}</span>}
                        {a?.tx && <a href={txUrl(a.tx)}>Transaction</a>}
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
      <p id="model-note" className={s.footnote}>
        <sup>1</sup> The model is <code>{log?.model ?? MODEL}</code>, served by NEAR AI Cloud from a trusted execution environment.
        When it answers, its reply is signed by the enclave and the signature is shown with the strain&rsquo;s last move.
      </p>
    </>
  );
}
