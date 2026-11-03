"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useLive, int, hex } from "@/lib/live";
import { STRAINS, MODEL } from "@/lib/strains";
import { accountUrl } from "@/lib/config";
import { useStrainLog, modelStatus } from "@/lib/strain-log";
import s from "./bands.module.css";

export function StrainsBand() {
  const { d, colonies } = useLive();
  const log = useStrainLog();
  const actions = useMemo(() => log?.actions ?? [], [log]);
  // The strains are on their written rules when each one's latest logged move was chosen by the rules.
  const onRules = useMemo(() => {
    const latest = STRAINS.map((st) => [...actions].reverse().find((a) => a.account === st.account)).filter(Boolean);
    return latest.length > 0 && latest.every((a) => a!.decided_by === "rules");
  }, [actions]);
  const since = useMemo(() => modelStatus(actions).since, [actions]);

  return (
    <section className="band" aria-labelledby="strains-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="strains-title" className="h2">Five AI strains play the dish around the clock</h2>
          <div>
            <p className="lede">
              Each strain is a NEAR account with a temperament. Code lists only the plantings the contract would accept; a
              model on NEAR AI Cloud, running in a secure enclave, picks one and writes a lab note, which is stored on chain
              with the planting.<sup className={s.ref}><a href="#strains-model">1</a></sup> They compete with each other and
              with you.
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
                    <p className={s.noteEmpty}>No lab note yet.</p>
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
          <sup>1</sup> The model is <code>{log?.model ?? MODEL}</code> on NEAR AI Cloud.
        </p>
      </div>
    </section>
  );
}
