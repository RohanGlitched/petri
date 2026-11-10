"use client";

import { useLive, petri } from "@/lib/live";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";

export const TOC: [string, string][] = [
  ["loops", "The game, at three speeds"],
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
    [`× ${r.reach}`, "most living cells a colony is paid for, per cell of stake"],
    [`× ${r.siege_x}`, `the price of planting within ${r.buffer} cells of a rival`],
    [ready ? petri(cellPrice, 2) : "—", "PETRI to plant one cell right now"],
    [ready ? nearPer(petriPrice) : "—", "NEAR for one PETRI from the agar right now"],
  ];
  return (
    <header id="overview" data-section="How Petri Dish works" className={s.head}>
      <div className="wrap">
        <div className={s.headGrid}>
          <div>
            <h1 className={s.title}>How Petri Dish works</h1>
            <p className={s.headLede}>
              Petri Dish is a memecoin that is alive: Conway&rsquo;s Game of Life on one shared dish, kept by a NEAR contract. Every live cell belongs to a
              colony. Colonies buy PETRI from the dish with NEAR, spend it to plant, and are fed PETRI for the cells that stay
              alive. Every hour {r.tide_bps / 100}% of the tide vault, which holds the NEAR players attached, goes back out,
              split by what each colony earned that hour; free play is paid the same way in credit. A colony can also fix a patch
              of its living cells as a specimen slide, an NFT the contract draws itself and, from 12 cells up, a licence: anyone may plant its
              pattern for less, paying its holder a royalty. This page
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
        <ol className={s.summary} aria-label="Petri Dish in three steps">
          <li>
            <b>Buy in</b>
            <p>
              Pay NEAR to the agar and get PETRI back, at a price that rises as the agar empties. Past the storage it pays for,
              the NEAR goes to the tide vault, not to anyone running the dish.
            </p>
          </li>
          <li>
            <b>Plant cells that last</b>
            <p>
              Spend PETRI to plant a pattern; half is burned, half returns to the agar. Life decides what survives, and your
              living cells earn PETRI every {Number(r.generation_ms) / 1000} s, up to {r.reach} paid cells per cell of stake.
            </p>
          </li>
          <li>
            <b>Collect at the tide</b>
            <p>
              Every {r.tide_every} generations {r.tide_bps / 100}% of the vault is paid out in NEAR (as credit on free play), split by
              the PETRI each colony earned since the last tide. Claim it, or sell PETRI back to the agar.
            </p>
          </li>
        </ol>
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
