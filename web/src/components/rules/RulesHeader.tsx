"use client";

import { useEffect, useRef, useState } from "react";
import { useLive, petri } from "@/lib/live";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";

export const TOC: [string, string][] = [
  ["board", "The board and the clock"],
  ["life", "Life with owners"],
  ["planting", "Planting"],
  ["coin", "The coin"],
  ["tides", "NEAR and the tides"],
  ["parameters", "Choosing the parameters"],
  ["strategies", "Strategies"],
  ["verify", "Verification"],
  ["limits", "Limits and trade-offs"],
];

export function RulesHeader() {
  const { rules, ready, cellPrice, petriPrice } = useLive();
  const r = rules ?? LAUNCH;
  const glance: [string, string][] = [
    [`${r.width} × ${r.height}`, "cells, with edges that wrap"],
    [`${Number(r.generation_ms) / 1000} s`, "between generations"],
    [petri(Number(r.max_supply)), "PETRI, all minted into the agar at launch"],
    [`${r.feed_ppm} ppm`, "of the agar fed to the living each generation"],
    [ready ? petri(cellPrice, 2) : "—", "PETRI to plant one cell right now"],
    [ready ? nearPer(petriPrice) : "—", "NEAR for one PETRI from the agar right now"],
  ];
  return (
    <header className={s.head}>
      <div className="wrap">
        <div className={s.headGrid}>
          <div>
            <h1 className={s.title}>How Petri works</h1>
            <p className={s.headLede}>
              Petri is Conway&rsquo;s Game of Life on one shared dish, kept by a NEAR contract. Every live cell belongs to a
              colony. Colonies buy PETRI from the dish with NEAR, spend it to plant, and are fed PETRI for every cell that stays
              alive. The NEAR they pay in goes back out, every hour, to whoever holds ground. This page is the whole rulebook,
              with the numbers read live from the contract.
            </p>
          </div>
          <nav className={s.toc} aria-label="On this page">
            <h2 className={s.tocTitle}>On this page</h2>
            <ul className={s.tocList}>
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
        <dl className={s.glance}>
          {glance.map(([v, k]) => (
            <div key={k} className={s.glanceItem}>
              <dt>{k}</dt>
              <dd className="num">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </header>
  );
}

/** On phones the contents list scrolls away with the header, so a compact pill stays under the nav instead. */
export function RulesJump() {
  const [current, setCurrent] = useState<string | null>(null);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const els = TOC.map(([id]) => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const io = new IntersectionObserver(
      (entries) => {
        const seen = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (seen[0]) setCurrent(seen[0].target.id);
      },
      { rootMargin: "-130px 0px -55% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
  const label = TOC.find(([id]) => id === current)?.[1];
  return (
    <div className={s.jump}>
      <details ref={box} className={s.jumpBox}>
        <summary>
          <span>On this page</span>
          {label && <b>{label}</b>}
        </summary>
        <ul>
          {TOC.map(([id, l]) => (
            <li key={id}>
              <a href={`#${id}`} aria-current={id === current ? "true" : undefined} onClick={() => box.current?.removeAttribute("open")}>
                {l}
              </a>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
