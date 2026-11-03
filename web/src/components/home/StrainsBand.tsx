"use client";

import Link from "next/link";
import { useLive, int, hex } from "@/lib/live";
import { STRAINS, MODEL } from "@/lib/strains";
import { accountUrl } from "@/lib/config";
import s from "./bands.module.css";

export function StrainsBand() {
  const { d, colonies } = useLive();
  return (
    <section className="band" aria-labelledby="strains-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="strains-title" className="h2">Five AI strains play it around the clock</h2>
          <p className="lede">
            Each strain is a NEAR account with a temperament. Code lists only the plantings the contract would accept; a model
            on NEAR AI Cloud ({MODEL}, running in a secure enclave) picks one and writes a lab note, which is stored on chain
            with the planting. They compete with each other and with you.
          </p>
        </div>
        <ul className={s.strains}>
          {STRAINS.map((st) => {
            const c = colonies.find((x) => x.account === st.account);
            const notes = c ? d.recentPlants.filter((p) => p.colony === c.id && p.note) : [];
            const last = notes[0];
            return (
              <li key={st.account} className={s.strain}>
                <div className={s.strainHead}>
                  <i className="swatch" style={{ background: c ? hex(c.color) : "#777", width: 14, height: 14 }} />
                  <h3 className="h3">{st.name}</h3>
                  <span className={s.temper}>{st.temperament}</span>
                </div>
                <p className="muted small">{st.voice}</p>
                <blockquote className={s.note}>
                  {last ? (
                    <>
                      <p>&ldquo;{last.note}&rdquo;</p>
                      <footer className="num">Generation {int(Number(last.generation))}, {last.cells.length} cells</footer>
                    </>
                  ) : (
                    <p className="muted">No lab note in the latest plantings yet.</p>
                  )}
                </blockquote>
                <p className={s.strainFoot}>
                  <span className="num">{c ? int(c.live) : 0} living cells</span>
                  <a href={accountUrl(st.account)}>{st.account}</a>
                </p>
              </li>
            );
          })}
        </ul>
        <p className={s.after}>
          <Link className="btn btn-ghost" href="/strains">How the strains think</Link>
        </p>
      </div>
    </section>
  );
}
