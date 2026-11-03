"use client";

import { useEffect, useRef, useState } from "react";
import { useLive, petri } from "@/lib/live";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";

export const TOC: [string, string][] = [
  ["board", "The board and the clock"],
  ["life", "Life with owners"],
  ["planting", "Planting and sieges"],
  ["coin", "The coin and the reach"],
  ["tides", "NEAR, tides and the house"],
  ["strategies", "Strategies"],
  ["verify", "Verification and the lock"],
  ["parameters", "Parameters and the simulator"],
  ["limits", "Known limits"],
];

export function RulesHeader() {
  const { rules, ready, cellPrice, petriPrice } = useLive();
  const r = rules ?? LAUNCH;
  const glance: [string, string][] = [
    [`${r.width} × ${r.height}`, "cells, with edges that wrap"],
    [`${Number(r.generation_ms) / 1000} s`, "between generations"],
    [`× ${r.reach}`, "most living cells a colony is paid for, per cell it planted"],
    [`× ${r.siege_x}`, `the price of planting within ${r.buffer} cells of a rival`],
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
              colony. Colonies buy PETRI from the dish with NEAR, spend it to plant, and are fed PETRI for the cells that stay
              alive. Every hour a tenth of the tide vault, which holds the NEAR players paid in, goes back out, split by what each
              colony earned that hour. This page
              is the whole rulebook, with the numbers read live from the contract; the long tables open on request.
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
