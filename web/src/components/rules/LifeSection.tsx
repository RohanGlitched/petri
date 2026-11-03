"use client";

import { useId, useRef, useState } from "react";
import { RuleDemo, type Seed } from "@/components/site/RuleDemo";
import { hex } from "@/lib/live";
import { DEMO } from "./shared";
import s from "./rules.module.css";

const C: Record<number, number> = { 1: DEMO.red, 2: DEMO.green, 3: DEMO.violet };
const NAME: Record<number, string> = { 1: "Red", 2: "Green", 3: "Violet" };

/** A 3 × 3 neighbourhood before a generation, and what the centre cell becomes. */
function Hood({ cells, result, label }: { cells: number[]; result: number; label: string }) {
  const id = useId().replace(/:/g, "");
  const used = [...new Set([...cells, result].filter(Boolean))];
  const cell = 26;
  const grid = (ox: number, list: number[], size: number) =>
    list.map((c, i) => {
      const x = ox + (i % size) * cell;
      const y = 8 + Math.floor(i / size) * cell + (size === 1 ? cell : 0);
      return (
        <g key={`${ox}-${i}`}>
          <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx="5" className={s.hoodTile} />
          {i === 4 && size === 3 && <rect x={x + 1} y={y + 1} width={cell - 2} height={cell - 2} rx="5" className={s.hoodFocus} />}
          {c > 0 && <circle cx={x + cell / 2} cy={y + cell / 2} r={cell * 0.38} fill={`url(#${id}-${c})`} />}
        </g>
      );
    });
  return (
    <svg className={s.hood} viewBox="0 0 168 94" role="img" aria-label={label}>
      <defs>
        {used.map((c) => (
          <radialGradient key={c} id={`${id}-${c}`} cx="34%" cy="30%" r="78%">
            <stop offset="0" stopColor="#fff" stopOpacity="0.7" />
            <stop offset="0.3" stopColor={hex(C[c])} />
            <stop offset="1" stopColor={hex(C[c])} stopOpacity="0.75" />
          </radialGradient>
        ))}
      </defs>
      {grid(4, cells, 3)}
      <path d="M96 47 H124 M118 41 L125 47 L118 53" className={s.hoodArrow} />
      {grid(134, [result], 1)}
      {result === 0 && <circle cx={134 + cell / 2} cy={8 + cell + cell / 2} r={cell * 0.3} className={s.hoodEmpty} />}
    </svg>
  );
}

const RULES: { title: string; body: string; cells: number[]; result: number; label: string }[] = [
  {
    title: "Survive with two or three",
    body: "A live cell with two or three live neighbours stays alive and keeps its owner. Whose neighbours they are does not matter.",
    cells: [2, 0, 0, 0, 1, 1, 0, 0, 0],
    result: 1,
    label: "A red cell with a green and a red neighbour survives and stays red.",
  },
  {
    title: "Otherwise die",
    body: "With fewer than two neighbours, or more than three, a live cell dies and its square is empty agar again.",
    cells: [0, 0, 0, 0, 1, 0, 0, 0, 1],
    result: 0,
    label: "A red cell with one neighbour dies.",
  },
  {
    title: "Births join the majority",
    body: "An empty square with exactly three live neighbours comes alive. It joins the colony that owns at least two of those three parents.",
    cells: [1, 0, 1, 0, 0, 0, 0, 2, 0],
    result: 1,
    label: "An empty cell with two red parents and one green parent is born red.",
  },
  {
    title: "Three owners, no birth",
    body: "If the three parents belong to three different colonies, the birth is contested and nothing grows there. This is the only place Petri differs from Life.",
    cells: [1, 0, 2, 0, 0, 0, 0, 3, 0],
    result: 0,
    label: "An empty cell with red, green and violet parents stays empty.",
  },
];

// Three L-shaped trios, owned by one, two and three colonies. Simulated with petri-core: the first two become blocks
// after one generation; the third is contested every generation and never changes.
const TRIO: Seed[] = [
  { colony: 1, x: 3, y: 3, cells: [[0, 0], [1, 0], [0, 1]] },
  { colony: 1, x: 11, y: 3, cells: [[0, 0], [1, 0]] },
  { colony: 2, x: 11, y: 4, cells: [[0, 0]] },
  { colony: 1, x: 19, y: 3, cells: [[0, 0]] },
  { colony: 2, x: 20, y: 3, cells: [[0, 0]] },
  { colony: 3, x: 19, y: 4, cells: [[0, 0]] },
];

// Three gliders that meet on a 40 × 22 dish. Simulated with petri-core: with three owners, one birth at generation 13
// is contested and the wreck dies out by generation 41; with one owner (plain Life) the debris is still active at 72.
const CRASH = (owners: [number, number, number]): Seed[] => [
  { colony: owners[0], pattern: "glider", x: 14, y: 16, rotate: 3 },
  { colony: owners[1], pattern: "glider", x: 12, y: 5, rotate: 0 },
  { colony: owners[2], pattern: "glider", x: 24, y: 3, rotate: 1 },
];
const CRASH_PETRI = CRASH([1, 2, 3]);
const CRASH_LIFE = CRASH([1, 1, 1]);
const LIFE_COLORS = { 1: DEMO.plain };

function CrashDemo({ petri }: { petri: boolean }) {
  const [g, setG] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const [contested, setContested] = useState(0);
  const total = useRef(0);
  const live = counts.slice(1).reduce((a, b) => a + b, 0);
  return (
    <figure className={s.figure}>
      <div className={s.dish} style={{ aspectRatio: "40 / 22" }}>
        <RuleDemo
          width={40}
          height={22}
          seeds={petri ? CRASH_PETRI : CRASH_LIFE}
          loop={72}
          colors={petri ? C : LIFE_COLORS}
          stepMs={300}
          stillAt={20}
          label={petri ? "Three gliders owned by three colonies collide" : "The same three gliders with one owner collide"}
          onGeneration={(gen, c, k) => {
            if (gen === 0) total.current = 0;
            total.current += k;
            setG(gen);
            setCounts(c);
            setContested(total.current);
          }}
        />
      </div>
      <figcaption className={s.caption}>
        <h3 className="h3">{petri ? "Three owners" : "One owner: plain Life"}</h3>
        <p>
          {petri
            ? "Red, green and violet gliders. One birth, at generation 13, has three different parents and does not happen. That single missing cell changes the whole crash: the wreck burns out by generation 41."
            : "The same three gliders, all owned by one colony, so every birth happens. The crash leaves debris that is still active when the loop restarts at generation 72."}
        </p>
        <p className={s.live} aria-live="off">
          <span className="num">Generation {g}</span>
          {petri ? (
            <>
              {[1, 2, 3].map((o) => (
                <span key={o}>
                  <i className="swatch" style={{ background: hex(C[o]) }} />
                  {NAME[o]} <b className="num">{counts[o] ?? 0}</b>
                </span>
              ))}
              <span>
                Contested <b className="num">{contested}</b>
              </span>
            </>
          ) : (
            <span>
              <i className="swatch" style={{ background: hex(DEMO.plain) }} />
              Live cells <b className="num">{live}</b>
            </span>
          )}
        </p>
      </figcaption>
    </figure>
  );
}

export function LifeSection() {
  const [trio, setTrio] = useState<{ g: number; k: number }>({ g: 0, k: 0 });
  return (
    <section id="life" className={`band band-2 ${s.section}`} aria-labelledby="life-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="life-title" className={s.h2}>Life, with owners</h2>
          <p className="lede">
            Every generation each cell counts its eight neighbours, all at once, from the board as it was. The first two rules
            are Conway&rsquo;s Life exactly. Ownership adds the other two.
          </p>
        </div>

        <ul className={s.hoods}>
          {RULES.map((r) => (
            <li key={r.title} className={s.card}>
              <Hood cells={r.cells} result={r.result} label={r.label} />
              <h3 className="h3">{r.title}</h3>
              <p>{r.body}</p>
            </li>
          ))}
        </ul>

        <figure className={`${s.figure} ${s.trio}`}>
          <div className={s.dish} style={{ aspectRatio: "24 / 8" }}>
            <RuleDemo
              width={24}
              height={8}
              seeds={TRIO}
              loop={3}
              colors={C}
              stepMs={900}
              stillAt={1}
              label="Three L-shaped trios of cells owned by one, two and three colonies"
              onGeneration={(g, _c, k) => setTrio({ g, k })}
            />
          </div>
          <figcaption className={s.caption}>
            <div className={s.trioCaps}>
              <p>
                <b>One owner.</b> The corner square has three red parents, so a red cell is born and the L becomes a block, a
                still life.
              </p>
              <p>
                <b>Two owners.</b> Two red parents and one green: the birth is red. The green cell survives and keeps its colour.
              </p>
              <p>
                <b>Three owners.</b> Red, green and violet parents. The corner is contested, every cell keeps two neighbours, and
                the L never changes.
              </p>
            </div>
            <p className={s.live} aria-live="off">
              <span className="num">Generation {trio.g}</span>
              <span>
                Births contested this generation <b className="num">{trio.k}</b>
              </span>
            </p>
          </figcaption>
        </figure>

        <div className={s.pair}>
          <CrashDemo petri={false} />
          <CrashDemo petri />
        </div>
        <p className={s.footnote}>
          These dishes run <code className={s.code}>petri-core</code> compiled to WebAssembly, the code the contract runs. The
          scenes were chosen by simulating them; nothing is drawn by hand. The trios could not be planted on the real dish, where
          rivals must keep three cells apart. The three gliders could: each starts outside the others&rsquo; buffers.
        </p>
      </div>
    </section>
  );
}
