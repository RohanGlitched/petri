"use client";

import Link from "next/link";
import { SpecimenCard, useSpecimenRows } from "@/components/specimens/Gallery";
import { SlideGlass } from "@/components/specimens/SlideGlass";
import s from "./bands.module.css";

export function SpecimensBand() {
  const { all, rows } = useSpecimenRows();
  const latest = rows.slice(0, 3);
  return (
    <section className="band band-2" aria-labelledby="specimens-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="specimens-title" className="h2">Fossils of a living coin</h2>
          <p className="lede">
            Cells die; a specimen stays. A colony can fix a patch of its own living cells onto a slide, minted by the contract as a
            NEAR token with a picture it drew itself. The same replay that checks the dish proves those cells were alive. A
            slide is also a licence: anyone may plant its exact pattern elsewhere for 25% less, and pays its holder 10% of that
            in PETRI.
          </p>
        </div>
        <ul className={s.slides}>
          {latest.length > 0
            ? latest.map(({ sl, c }) => (
                <li key={sl.id}>
                  <SpecimenCard sl={sl} c={c} />
                </li>
              ))
            : [0, 1, 2].map((i) => (
                <li key={i} className={s.slideBlank}>
                  <SlideGlass src={null} placeholder={all.status === "loading" ? "Reading…" : i === 0 ? "The first slide is still blank" : "Blank slide"} />
                </li>
              ))}
        </ul>
        <p className={s.after}>
          <Link className="btn btn-amber" href="/specimens">Open the slide box</Link>{" "}
          <Link className="btn btn-ghost" href="/dish?tool=fossil" style={{ marginLeft: 8 }}>Make a specimen</Link>
        </p>
      </div>
    </section>
  );
}
