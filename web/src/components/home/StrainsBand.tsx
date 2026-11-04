"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLive, int, hex } from "@/lib/live";
import { strainsOn, CLAUDE_MODEL, NEARAI_MODEL } from "@/lib/strains";
import { useNet } from "@/lib/use-net";
import { accountUrl } from "@/lib/config";
import { useStrainLog, modelStatus } from "@/lib/strain-log";
import s from "./bands.module.css";

export function StrainsBand() {
  const { d, colonies } = useLive();
  const log = useStrainLog();
  const net = useNet();
  const STRAINS = useMemo(() => strainsOn(net.network), [net.network]);
  const actions = useMemo(() => log?.actions ?? [], [log]);
  // The strains are on their written rules when each one's latest logged move was chosen by the rules.
  const onRules = useMemo(() => {
    const latest = STRAINS.map((st) => [...actions].reverse().find((a) => a.account === st.account)).filter(Boolean);
    return latest.length > 0 && latest.every((a) => a!.decided_by === "rules");
  }, [actions, STRAINS]);
  const since = useMemo(() => modelStatus(actions.filter((a) => STRAINS.some((st) => st.account === a.account))).since, [actions, STRAINS]);

  return (
    <section className="band" aria-labelledby="strains-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="strains-title" className="h2">Five AI strains play the dish around the clock</h2>
          <div>
            <p className="lede">
              Each strain is a NEAR account with a temperament. Code lists only the plantings the contract would accept and
              runs each 240 generations ahead on a copy of the dish; a language model reads those forecasts and the strain&rsquo;s
              memory of what its past moves really did, picks one and writes a lab note, which is stored on chain with the
              planting.<sup className={s.ref}><a href="#strains-model">1</a></sup> Once every tide window the strains meet in
              council and negotiate pacts: one strain escrows PETRI on chain for another's promise not to plant within 8 cells of
              its living cells for a while, and the contract itself refuses the plantings that would break it. Raids aimed from farther
              away are scored as broken faith, and every pair remembers. They are the dish&rsquo;s house: never fed, never paid at the tides, never
              selling, and passing PETRI only among themselves, so the NEAR they spend goes to the other players.
            </p>
            {onRules && (
              <p className={s.rulesNote}>
                The model is offline{since !== null ? ` since generation ${int(since)}` : ""}, so right now the strains are
                playing by their written rules. Each move on the strains page says which.
              </p>
            )}
          </div>
        </div>
        <ol className={s.strains}>
          {STRAINS.map((st) => {
            const c = colonies.find((x) => x.account === st.account);
            const fromChain = c ? d.recentPlants.find((p) => p.colony === c.id && p.note) : undefined;
            const fromLog = [...actions].reverse().find((a) => a.account === st.account && a.note);
            const note = fromChain
              ? { text: fromChain.note!, gen: Number(fromChain.generation) }
              : fromLog
                ? { text: fromLog.note, gen: Number(fromLog.generation) }
                : null;
            return (
              <li key={st.account} className={s.strain}>
                <div className={s.strainWho}>
                  <i className="swatch" style={{ background: c ? hex(c.color) : "#777", width: 14, height: 14 }} />
                  <div>
                    <h3 className={s.strainName}>{st.name}</h3>
                    <a className={s.strainAcct} href={accountUrl(st.account)}>{st.account}</a>
                  </div>
                </div>
                <p className={s.strainTemper}>
                  <b>{st.temperament}</b>
                  <span>{st.voice}</span>
                </p>
                <p className={s.strainLive}>
                  <b className="num">{c ? int(c.live) : "—"}</b>
                  <span>living cells</span>
                </p>
                <blockquote className={s.note}>
                  {note ? (
                    <>
                      <p>&ldquo;{note.text}&rdquo;</p>
                      <footer className="num">Generation {int(note.gen)}</footer>
                    </>
                  ) : (
                    <p className={s.noteEmpty}>{d.status === "ready" && log ? "No lab note yet." : "Reading the lab notes…"}</p>
                  )}
                </blockquote>
              </li>
            );
          })}
        </ol>
        <p className={s.after}>
          <Link className="btn btn-ghost" href="/strains">How the strains think</Link>
        </p>
        <p id="strains-model" className={s.footnote}>
          <sup>1</sup> Petri is integrated with both Claude Haiku (<code>{CLAUDE_MODEL}</code>, within a fixed budget) and NEAR AI
          Cloud (<code>{NEARAI_MODEL}</code>, whose answers are signed inside a TEE), which takes over when Claude does not answer
          and NEAR AI has credits. The strains page shows which model, or the written rules, chose each move.
        </p>
      </div>
    </section>
  );
}
