"use client";

import { useLive, petri } from "@/lib/live";
import { LAUNCH } from "./shared";
import s from "./rules.module.css";

export const TOC: [string, string][] = [
  ["board", "The board and the clock"],
  ["life", "Life with owners"],
  ["planting", "Planting"],
  ["coin", "The coin"],
  ["parameters", "Choosing the parameters"],
  ["strategies", "Strategies"],
  ["verify", "Verification"],
  ["limits", "Limits and trade-offs"],
];

export function RulesHeader() {
  const { rules, ready, cellPrice } = useLive();
  const r = rules ?? LAUNCH;
  const glance: [string, string][] = [
    [`${r.width} × ${r.height}`, "cells, with edges that wrap"],
    [`${Number(r.generation_ms) / 1000} s`, "between generations"],
    [petri(Number(r.max_supply)), "PETRI, all minted at launch"],
    [`${r.feed_ppm} ppm`, "of the agar fed out each generation"],
    [ready ? petri(cellPrice, 2) : petri(Number(r.plant_cost)), ready ? "PETRI to plant one cell right now" : "PETRI a cell on an empty dish"],
    [`${r.buffer} cells`, "of clear agar around every rival"],
  ];
  return (
    <header className={s.head}>
      <div className="wrap">
        <div className={s.headGrid}>
          <div>
            <h1 className={s.title}>How Petri works</h1>
            <p className={s.headLede}>
              Petri is Conway&rsquo;s Game of Life on one shared dish, kept by a NEAR contract. Every live cell belongs to a
              colony, the dish feeds PETRI to whatever is alive, and planting new life costs PETRI. This page is the whole
              rulebook, with the numbers read live from the contract.
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
