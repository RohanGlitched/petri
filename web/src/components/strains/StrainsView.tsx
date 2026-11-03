"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getAllPlants, type PlantRecord } from "@/lib/chain";
import { strainsOn, keeperOn, CLAUDE_MODEL, NEARAI_MODEL } from "@/lib/strains";
import { useNet } from "@/lib/use-net";
import { accountUrl, txUrl } from "@/lib/config";
import { useStrainLog, modelStatus, actionIndex } from "@/lib/strain-log";
import s from "./strains.module.css";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

/** Older log entries counted zero neighbours literally; say "empty agar" instead. */
const plain = (o: string) => o.replace(/near 0 living cells/g, "in empty agar").replace(/fresh agar \(0 cells nearby\)/g, "empty agar");

export function StrainsView() {
  const { d, colonies } = useLive();
  const log = useStrainLog();
  const net = useNet();
  const STRAINS = useMemo(() => strainsOn(net.network), [net.network]);
  const KEEPER = keeperOn(net.network);
  const [plants, setPlants] = useState<PlantRecord[]>([]);
  const [plantsRead, setPlantsRead] = useState(false);

  const total = d.state ? Number(d.state.plants) : 0;
  // Counts of plantings and notes are only true once they are read: a dish with no plantings is read as soon as its state is.
  const read = plantsRead || (!!d.state && total === 0);
  useEffect(() => {
    if (!total) return;
    getAllPlants(total)
      .then((p) => {
        setPlants(p);
        setPlantsRead(true);
      })
      .catch(() => {});
  }, [total]);

  // Strains repeat their notes, so a planting is matched to its logged move by account and generation, not by note.
  const index = useMemo(() => actionIndex(log?.actions ?? []), [log]);
  // Only the five strains ask a model; the bench colonies in the same log play by written rules by design.
  const strainMoves = (log?.actions ?? []).filter((a) => STRAINS.some((st) => st.account === a.account));
  const modelMoves = strainMoves.filter((a) => a.decided_by === "model").length;
  const allMoves = strainMoves.length;
  const status = modelStatus(strainMoves);


  return (
    <>
      <section className={s.status} aria-live="polite">
        <div>
          <span>
            Model<sup className={s.ref}><a href="#model-note" aria-label="Which model">1</a></sup>
          </span>
          <b>{status.offline ? "Not answering" : "Answering"}</b>
          <em>
            {status.offline && status.since !== null ? `Since generation ${int(status.since)}` : log?.model ?? "Claude Haiku, or NEAR AI Cloud"}
          </em>
        </div>
        <div>
          <span>Strain moves in the public log</span>
          <b className="num">{int(allMoves)}</b>
          <em>
            {int(modelMoves)} chosen by the model, {int(allMoves - modelMoves)} by the rules fallback
          </em>
        </div>
        <div>
          <span>Agents last checked in</span>
          <b>{log?.health ? ago(log.health.at) : "—"}</b>
          <em>{net.freePlay ? "keeper, five strains and three bench colonies on one small VM" : "keeper and five strains on one small VM"}</em>
        </div>
      </section>
      {status.offline && status.since !== null && (
        <p className={s.honest}>
          No model has answered since generation {int(status.since)}; the strains are playing by their written rules, and
          every move below says which.
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
          // A strain that has sat still for a while says so in generations, which is how the dish counts time.
          const idle = last && d.status === "ready" ? d.generation - Number(last.generation) : 0;
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
                <div><dt>Plantings</dt><dd className="num">{read ? int(mine.length) : "—"}</dd></div>
              </dl>
              {last && (
                <div className={s.last}>
                  <p className={s.lastHead}>
                    {idle > 120 ? `Last move ${int(idle)} generations ago (${ago(last.at)})` : `Last move ${ago(last.at)}`}, chosen by <b>{last.decided_by === "model" ? "the model" : "its rules"}</b>
                  </p>
                  <p className={s.options}>It could have planted: {last.options.slice(0, 4).map(plain).join("; ")}{last.options.length > 4 ? "; …" : ""}</p>
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
                        {a && <span className={a.decided_by === "model" ? s.byModel : s.byRules}>{a.decided_by === "model" ? `Chosen by ${a.model ?? "the model"}` : "Written rules"}</span>}
                        {a?.tx && <a href={txUrl(a.tx)}>Transaction</a>}
                      </span>
                    </li>
                  );
                })}
                {notes.length === 0 && <li className={s.dim}>{read ? "No lab notes yet." : "Reading the lab notes from NEAR…"}</li>}
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
            Not a player. When the stored board is twenty generations behind the clock, or the keeper pot holds more than 50
            PETRI, it calls advance, which catches the board up and adds what every colony&rsquo;s cells earned to its
            unclaimed earnings. Whoever advances at least one generation, and can hold PETRI, takes the keeper pot, the {d.rules ? d.rules.keeper_bps / 100 : 2}% of the feed set aside, so anyone can
            do this job. It also unwraps any wNEAR left waiting from a token payment.
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
        <sup>1</sup> Petri is integrated with both Claude Haiku (<code>{CLAUDE_MODEL}</code>, asked first, within a fixed
        budget) and NEAR AI Cloud (<code>{NEARAI_MODEL}</code>, served from a trusted execution environment), which takes over
        when Claude does not answer and NEAR AI has credits. A NEAR AI answer is signed by the enclave, and the signature is
        shown with the strain&rsquo;s last move. Each move says which model chose it.
      </p>
    </>
  );
}
