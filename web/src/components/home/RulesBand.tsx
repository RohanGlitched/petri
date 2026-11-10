"use client";

import { useState } from "react";
import { RuleDemo, type Seed } from "@/components/site/RuleDemo";
import { hex } from "@/lib/live";
import s from "./bands.module.css";

const COLORS = { 1: 0xc8431f, 2: 0x1e8c6e, 3: 0x6b2fa0 };
const NAMES: Record<number, string> = { 1: "Red", 2: "Green", 3: "Violet" };

type Scene = {
  title: string;
  body: string;
  w: number;
  h: number;
  seeds: Seed[];
  loop: number;
  buffer?: boolean;
  refused?: Seed;
};

const SCENES: Scene[] = [
  {
    title: "Conway’s Life, with owners",
    body: "Every generation each cell counts its eight neighbours. With two or three it survives; an empty square with exactly three is born. Petri Dish adds one thing: every cell belongs to someone.",
    w: 40,
    h: 22,
    seeds: [
      { colony: 1, pattern: "glider", x: 4, y: 4 },
      { colony: 2, pattern: "blinker", x: 30, y: 6 },
      { colony: 3, pattern: "beehive", x: 12, y: 16 },
    ],
    loop: 120,
  },
  {
    title: "Births join the majority",
    body: "A new cell joins whichever colony owns most of its three parents; if three colonies meet, the birth is contested and nothing grows. So crashes change hands. Here Red’s glider hits Green’s block and every cell that survives is Red’s.",
    w: 36,
    h: 22,
    seeds: [
      { colony: 1, pattern: "glider", x: 6, y: 5 },
      { colony: 2, pattern: "block", x: 17, y: 13 },
    ],
    loop: 58,
  },
  {
    title: "Ground near a rival costs three times as much",
    body: "Planting within three cells of a rival (the hatched zone) is a siege: allowed, but at three times the price, so no one can close the dish. The red ghost is such a planting. The cheap way in is something that travels: this glider was planted on open agar for the normal price and gets there anyway.",
    w: 40,
    h: 22,
    seeds: [
      { colony: 1, pattern: "glider", x: 5, y: 4 },
      { colony: 2, pattern: "beehive", x: 20, y: 15 },
    ],
    loop: 72,
    buffer: true,
    refused: { colony: 1, pattern: "block", x: 25, y: 12 },
  },
];

function Demo({ sc }: { sc: Scene }) {
  const [g, setG] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const owners = [...new Set(sc.seeds.map((x) => x.colony))];
  return (
    <figure className={s.demo}>
      <div className={s.demoDish}>
        <RuleDemo
          width={sc.w}
          height={sc.h}
          seeds={sc.seeds}
          loop={sc.loop}
          colors={COLORS}
          bufferFor={sc.buffer ? { colony: 1, radius: 3 } : undefined}
          refused={sc.refused}
          label={sc.title}
          onGeneration={(gen, c) => {
            setG(gen);
            setCounts(c);
          }}
        />
      </div>
      <figcaption className={s.demoCap}>
        <h3 className="h3">{sc.title}</h3>
        <p>{sc.body}</p>
        <p className={s.demoLive} aria-live="off">
          <span className="num">Generation {g}</span>
          {owners.map((o) => (
            <span key={o}>
              <i className="swatch" style={{ background: hex(COLORS[o as 1 | 2 | 3]) }} />
              {NAMES[o]} <b className="num">{counts[o] ?? 0}</b>
            </span>
          ))}
        </p>
      </figcaption>
    </figure>
  );
}

export function RulesBand() {
  return (
    <section id="rules" data-section="Three rules" className="band" aria-labelledby="rules-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="rules-title" className="h2">Three rules, all enforced by the contract</h2>
          <p className="lede">
            These small dishes run the same Rust code as the contract and the big dish, compiled to WebAssembly. Nothing here
            is an animation someone drew; it is the rules playing out.
          </p>
        </div>
        <div className={s.demos}>
          {SCENES.map((sc) => (
            <Demo key={sc.title} sc={sc} />
          ))}
        </div>
      </div>
    </section>
  );
}
