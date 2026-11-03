"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive, petri, int } from "@/lib/live";
import s from "./bands.module.css";

function Cycle({ agar, fed, back, burned, perGen }: { agar: string; fed: string; back: string; burned: string; perGen: string }) {
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  const dots = (path: string, n: number, dur: number, color: string, r = 4) =>
    motion &&
    Array.from({ length: n }, (_, i) => (
      <circle key={`${path}${i}`} r={r} fill={color}>
        <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(i * dur) / n}s`}>
          <mpath href={`#${path}`} />
        </animateMotion>
      </circle>
    ));
  return (
    <svg className={s.cycle} viewBox="0 0 640 400" role="img" aria-label="The PETRI cycle: the agar feeds living cells, planting pays half back to the agar and burns half.">
      <defs>
        <radialGradient id="cy-agar" cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#ffd796" />
          <stop offset="0.55" stopColor="#e29a3a" />
          <stop offset="1" stopColor="#9c5a14" />
        </radialGradient>
        <radialGradient id="cy-cell" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffb7a3" />
          <stop offset="0.4" stopColor="#c8431f" />
          <stop offset="1" stopColor="#7c2310" />
        </radialGradient>
        <marker id="cy-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#6f5c47" />
        </marker>
      </defs>
      <path id="cy-feed" d="M210 130 C 300 60, 380 60, 452 104" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-spend" d="M500 190 L 500 262" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-back" d="M446 318 C 360 360, 260 330, 200 262" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-burn" d="M556 318 C 590 340, 600 360, 600 372" fill="none" stroke="#b8a58e" strokeWidth="2" strokeDasharray="4 5" />
      {dots("cy-feed", 4, 3.2, "#e29a3a")}
      {dots("cy-spend", 2, 1.6, "#c8431f", 3.5)}
      {dots("cy-back", 3, 3.4, "#e29a3a", 3.5)}
      {dots("cy-burn", 2, 2.2, "#4e3d2c", 3)}

      <circle cx="140" cy="190" r="104" fill="url(#cy-agar)" />
      <circle cx="140" cy="190" r="104" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" />
      <text x="140" y="172" textAnchor="middle" className={s.cyBig}>The agar</text>
      <text x="140" y="204" textAnchor="middle" className={s.cyNum}>{agar}</text>
      <text x="140" y="226" textAnchor="middle" className={s.cySmall}>PETRI left to feed</text>

      <g>
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <circle key={i} cx={470 + (i % 4) * 20 + (i > 3 ? 10 : 0)} cy={126 + Math.floor(i / 4) * 20} r="9" fill="url(#cy-cell)" />
        ))}
        <text x="500" y="92" textAnchor="middle" className={s.cyLabel}>Living cells</text>
        <text x="500" y="186" textAnchor="middle" className={s.cySmall}>{perGen} PETRI to every cell, every generation</text>
      </g>

      <rect x="430" y="266" width="140" height="56" rx="28" fill="#1d1208" />
      <text x="500" y="300" textAnchor="middle" className={s.cyBtn}>Planting</text>

      <text x="300" y="54" textAnchor="middle" className={s.cySmall}>fed so far: {fed}</text>
      <text x="300" y="370" textAnchor="middle" className={s.cySmall}>half back to the agar: {back}</text>
      <text x="600" y="392" textAnchor="end" className={s.cySmall}>half burned: {burned}</text>
    </svg>
  );
}

function PriceCurve({ live, base, capacity }: { live: number; base: number; capacity: number }) {
  const W = 520;
  const H = 180;
  const maxLive = Math.max(3000, Math.ceil((live * 1.6) / 500) * 500);
  const price = (l: number) => (base * (capacity + l)) / capacity / 1e6;
  const maxP = price(maxLive);
  const x = (l: number) => 40 + (l / maxLive) * (W - 60);
  const y = (p: number) => H - 30 - (p / maxP) * (H - 50);
  const px = x(live);
  const py = y(price(live));
  return (
    <svg className={s.curve} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price per planted cell against living cells. Now ${price(live).toFixed(2)} PETRI at ${live} living cells.`}>
      <line x1="40" y1={H - 30} x2={W - 20} y2={H - 30} stroke="#cdbba3" />
      <line x1="40" y1="16" x2="40" y2={H - 30} stroke="#cdbba3" />
      <path d={`M${x(0)} ${y(price(0))} L${x(maxLive)} ${y(price(maxLive))}`} stroke="#9c5a14" strokeWidth="2.5" fill="none" />
      <line x1={px} y1={py} x2={px} y2={H - 30} stroke="#9c5a14" strokeDasharray="3 4" />
      <circle cx={px} cy={py} r="6" fill="#c8431f" stroke="#fff" strokeWidth="2" />
      <text x={px + 10} y={py - 10} className={s.cySmall}>now {price(live).toFixed(2)}</text>
      <text x="40" y={H - 10} className={s.cyTick}>0 cells</text>
      <text x={W - 20} y={H - 10} textAnchor="end" className={s.cyTick}>{int(maxLive)} living cells</text>
      <text x="46" y="26" className={s.cyTick}>{maxP.toFixed(1)} PETRI a cell</text>
    </svg>
  );
}

export function CoinBand() {
  const { d, rules, ready, perCell, supply, cellPrice } = useLive();
  const st = d.state;
  const v = (k: keyof NonNullable<typeof st>) => (st ? Number(st[k]) : 0);
  const held = st ? supply - v("agar") : 0;
  const max = rules ? Number(rules.max_supply) : 1e12;
  const rows: [string, string, string][] = [
    ["Created, once, at launch", petri(max), "No mint function exists after this."],
    ["Still in the agar", petri(v("agar")), "Paid out a sliver at a time to whoever is alive."],
    ["Held by colonies", petri(held), "Earned by living cells, or granted when a colony joined."],
    ["Fed to the living so far", petri(v("fed")), `${rules ? rules.feed_ppm : 20} parts per million of the agar, every generation.`],
    ["Paid back by planting", petri(v("returned")), "Half of every planting returns to the agar."],
    ["Burned for good", petri(v("burned")), "The other half. Total supply only ever falls."],
  ];
  return (
    <section id="coin" className="band band-paper" aria-labelledby="coin-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="coin-title" className="h2">The coin is the nutrient</h2>
          <p className="lede">
            All {rules ? petri(max) : "1,000,000"} PETRI were made at launch and placed in the agar. Nobody can mint more. Living
            cells are fed from the agar; planting new life feeds it back, and burns as much again. Fill the dish and planting
            gets dearer; thin it out and every surviving cell takes a bigger share of the feed.
          </p>
        </div>
        <div className={s.coinGrid}>
          <div className={s.coinFig}>
            <Cycle
              agar={ready ? petri(d.agar) : "—"}
              fed={st ? petri(v("fed")) : "—"}
              back={st ? petri(v("returned")) : "—"}
              burned={st ? petri(v("burned")) : "—"}
              perGen={ready ? petri(perCell, 4) : "—"}
            />
          </div>
          <dl className={s.ledger}>
            {rows.map(([k, val, note]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="num">{st ? val : "—"}</dd>
                <p>{note}</p>
              </div>
            ))}
          </dl>
        </div>
        <div className={s.priceRow}>
          <div>
            <h3 className="h3">Planting gets dearer as the dish fills</h3>
            <p className="muted">
              One cell costs {rules ? petri(Number(rules.plant_cost)) : "2"} PETRI on an empty dish, plus the same again for
              every {rules ? int(rules.capacity) : "1,000"} cells already alive. Right now a cell costs{" "}
              <b className="num">{ready ? petri(cellPrice, 2) : "—"} PETRI</b> and earns{" "}
              <b className="num">{ready ? petri(perCell, 4) : "—"}</b> a generation, so a still life pays for itself in about{" "}
              <b className="num">{ready && perCell > 0 ? int(cellPrice / perCell) : "—"}</b> generations if nothing hits it.
            </p>
            <Link className="btn btn-ink btn-small" href="/rules#coin">Read the full economics</Link>
          </div>
          {rules && <PriceCurve live={d.totalLive} base={Number(rules.plant_cost)} capacity={rules.capacity} />}
        </div>
      </div>
    </section>
  );
}
