"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useDish } from "@/lib/dish-store";
import { fmtPetri } from "@/lib/config";
import { Eyepiece } from "./Eyepiece";
import { Witness } from "./Witness";

export function usePalette(colonies: { id: number; color: number }[]) {
  return useMemo(() => {
    const m = new Map<number, number>();
    colonies.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [colonies]);
}

export function LiveHero() {
  const d = useDish();
  const palette = usePalette(d.colonies);
  const w = d.rules?.width ?? 128;
  const h = d.rules?.height ?? 128;
  const feed = d.rules ? (d.agar * d.rules.feed_ppm) / 1e6 : 0;
  const perCell = d.totalLive > 0 && d.rules ? (feed * (1 - d.rules.keeper_bps / 10000)) / d.totalLive : 0;
  const secs = Math.ceil(d.nextInMs / 1000);

  return (
    <section className="page hero" aria-labelledby="hero-title">
      <div className="hero-grid">
        <div className="hero-copy">
          <div className="page-head" style={{ marginBottom: 18 }}>
            <span className="page-no">Plate 1</span>
          </div>
          <h1 id="hero-title" className="hero-title">Petri</h1>
          <p className="hero-sub">A coin that is alive.</p>
          <p className="lede">
            A NEAR contract runs Conway&rsquo;s Life on one shared dish. Every living cell belongs to a real account.
            Every PETRI starts in the agar; each generation the agar feeds the living, and bringing new cells to life
            pays half back into it and burns the rest.
          </p>
          <dl className="readout" aria-live="polite">
            <div>
              <dt>Generation</dt>
              <dd className="num">{d.status === "ready" ? d.generation.toLocaleString("en-US") : "—"}<small>{d.status === "ready" ? `next in ${secs}s` : ""}</small></dd>
            </div>
            <div>
              <dt>Living cells</dt>
              <dd className="num">{d.status === "ready" ? d.totalLive.toLocaleString("en-US") : "—"}</dd>
            </div>
            <div>
              <dt>Each cell earns</dt>
              <dd className="num">{d.status === "ready" ? fmtPetri(perCell, 4) : "—"}<small>PETRI / gen</small></dd>
            </div>
            <div>
              <dt>Left in the agar</dt>
              <dd className="num">{d.status === "ready" ? fmtPetri(d.agar, 0) : "—"}<small>PETRI</small></dd>
            </div>
          </dl>
          <div className="hero-actions">
            <Link className="btn" href="/dish">Plant a colony</Link>
            <Link className="btn btn-quiet" href="/rules">Read the rules</Link>
          </div>
          {d.status === "error" && <p className="note-bad">The dish could not be read from NEAR: {d.error}. Retrying every few seconds.</p>}
        </div>
        <div className="hero-dish">
          <Eyepiece
            width={w}
            height={h}
            cells={d.cells}
            prevCells={d.prevCells}
            changedAt={d.changedAt}
            palette={palette}
            label={`The live dish at generation ${d.generation}, ${d.totalLive} living cells`}
          />
          <p className="dish-caption">
            The live dish, drawn in your browser by the same Rust code the contract runs. Drag to move across it;
            the edges wrap. Scroll or pinch to look closer.
          </p>
        </div>
      </div>
      <Witness page={1} />
    </section>
  );
}
