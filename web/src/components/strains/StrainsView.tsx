"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getAllPlants, type PlantRecord } from "@/lib/chain";
import { strainsOn, keeperOn, CLAUDE_MODEL, NEARAI_MODEL } from "@/lib/strains";
import { useNet } from "@/lib/use-net";
import { accountUrl, txUrl } from "@/lib/config";
import { useStrainLog, modelStatus, actionIndex } from "@/lib/strain-log";
import { readRunway, nearOf, type Runway } from "@/lib/house-runway";
import { Council } from "./Council";
import s from "./strains.module.css";
import { NetTag } from "@/components/site/NetTag";
import { NoteText } from "@/components/site/TeeNote";
import type { Network } from "@/lib/config";
import { ModelBadge } from "@/components/swarm/Bits";

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
      <p className={s.netLine}>
        <NetTag />
        <span>{net.freePlay ? "The strains on the free-play testnet dish, at full pace" : "The strains on the mainnet dish, at a thirty-second of the testnet pace"}</span>
      </p>
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

      <ul id="lab-notes" data-section="Their lab notes" className={s.grid}>
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
                    {idle > 120 ? `Last move ${int(idle)} generations ago (${ago(last.at)})` : `Last move ${ago(last.at)}`}, chosen by <b>{last.decided_by === "model" ? "the model" : "its rules"}</b>{" "}
                    <ModelBadge model={last.decided_by === "model" ? last.model : null} tee={last.tee ?? null} />
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
                      <Note text={p.note ?? ""} net={net.network} />
                      <span className={`num ${s.meta}`}>
                        <span>Generation {int(Number(p.generation))}</span>
                        <span>{p.cells.length} cells</span>
                        {a && <ModelBadge model={a.decided_by === "model" ? a.model : null} tee={a.tee ?? null} />}
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
        <li id="keeper" data-section="The keeper" className={`${s.card} ${s.keeper}`}>
          <header className={s.cardHead}>
            <i className="swatch" style={{ background: "#bba78f", width: 18, height: 18 }} />
            <h2>The keeper</h2>
            <span className={s.temper}>Clock</span>
          </header>
          <p className={s.voice}>
            Not a player.{" "}
            {net.freePlay
              ? "When the stored board is twenty generations behind the clock, it calls advance,"
              : "Once someone outside the house plays, and only when the stored board is 400 generations behind, before the clock would skip, it calls advance,"}{" "}
            which catches the board up and adds what every colony&rsquo;s cells earned to its unclaimed earnings. Any player
            outside the house whose call runs at least one generation, and who is registered for PETRI and has attached NEAR (a
            guest never has), takes the keeper pot, the {d.rules ? d.rules.keeper_bps / 100 : 2}% of the feed set aside, so
            anyone can do this job. The keeper itself is listed in the rules as a keeper, so it takes neither the pot nor a tide
            bounty: they stay in the dish for the players. It also unwraps any wNEAR left waiting from a token payment.
          </p>
          <p className={s.plays}>
            Paid from the keeper pot so far: <b className="num">{d.state ? petri(Number(d.state.keeper_paid), 2) : "—"} PETRI</b>
          </p>
          <a className={s.acct} href={accountUrl(KEEPER)}>{KEEPER}</a>
        </li>
      </ul>
      <Council log={log} />
      <RunwayNote />
      <p className={s.cta}>
        <Link className="btn btn-amber" href="/dish">Play against them</Link>
      </p>
      <p id="model-note" className={s.footnote}>
        <sup>1</sup> Petri Dish asks NEAR AI Cloud first (<code>{NEARAI_MODEL}</code>, served from a trusted execution environment) and
        Claude Haiku (<code>{CLAUDE_MODEL}</code>, within a fixed budget) when NEAR AI does not answer. Every NEAR AI answer is
        signed by the enclave; the agent checks that signature against the exact request and response and the
        enclave&rsquo;s attestation report, and logs the verdict with the move. Each move says which model chose it.
      </p>
    </>
  );
}

/** A lab note, two lines until opened: the strains write whole sentences now. */
function Note({ text, net }: { text: string; net: Network }) {
  const [open, setOpen] = useState(false);
  const [long, setLong] = useState(false);
  const ref = useRef<HTMLQuoteElement>(null);
  // The toggle appears only when the clamp actually hides something at this width.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => !open && setLong(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open]);
  return (
    <div className={s.note}>
      <q ref={ref} className={!open ? s.clamp : undefined}>
        <NoteText note={text} net={net} />
      </q>
      {(long || open) && (
        <button type="button" className={s.more} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read the whole note"}
        </button>
      )}
    </div>
  );
}

/** What the house holds on mainnet and how long it lasts at its recent pace, read from NEAR mainnet itself. */
function RunwayNote() {
  const [r, setR] = useState<Runway | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    readRunway().then(
      (x) => !stop && setR(x),
      () => !stop && setFailed(true),
    );
    return () => {
      stop = true;
    };
  }, []);
  const hrs = r ? Math.max(1, Math.round(r.hours)) : 0;
  const span = !r ? "" : r.young ? `the dish's first ${hrs} ${hrs === 1 ? "hour" : "hours"} (so the pace is rough)` : r.hours >= 23.5 ? "the last 24 hours" : `the last ${hrs} hours`;
  return (
    <section id="runway" data-section="Runway" className={s.runway} aria-labelledby="runway-title">
      <div>
        <h2 id="runway-title" className="h3">Runway</h2>
        <p>
          {failed
            ? "NEAR mainnet did not answer just now, so the house's balances are not shown."
            : !r
              ? "Reading the house's balances from NEAR mainnet…"
              : r.perDay
                ? `On mainnet the five strains hold ${nearOf(r.total)} NEAR of the team's money. Over ${span} their purchases and plantings put ${nearOf(r.spent, 4)} NEAR into the tide vault, about ${nearOf(r.perDay, 4)} a day, which the tides pay out to the other players. At that pace the house lasts about ${r.days !== null && r.days > 365 ? "more than a year" : `${Math.max(1, Math.round(r.days ?? 0))} days`}, before storage and gas, which come on top; when it runs low the strains stop and the dish carries on without them.`
                : `On mainnet the five strains hold ${nearOf(r.total)} NEAR of the team's money and put nothing into the tide vault over ${span}. What they do put in, the tides pay out to the other players.`}
        </p>
      </div>
      {r && (
        <ul className={s.runwayList}>
          {r.strains.map((x) => (
            <li key={x.account}>
              <a href={accountUrl(x.account, "mainnet")}>{x.name}</a>
              <span className="num">{x.balance !== null ? `${nearOf(x.balance)} NEAR` : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
