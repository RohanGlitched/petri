"use client";

import { useEffect, useState } from "react";
import { Engine, loadEngine, pattern_cells, PATTERNS, type PatternName } from "@/engine";
import { Specimen } from "@/components/site/Specimen";
import { useLive, usePatternOffsets, petri, int } from "@/lib/live";
import { fmtPetri } from "@/lib/config";
import { LAUNCH, genTime } from "./shared";
import s from "./rules.module.css";

const FAMILIES: { title: string; color: string; patterns: PatternName[]; body: string }[] = [
  {
    title: "Still lifes earn",
    color: "#1e8c6e",
    patterns: ["block", "beehive", "loaf"],
    body: "A still life never changes, so every cell of it is fed every generation until something hits it. It is the plainest bet on the dish: pay once, collect slowly.",
  },
  {
    title: "Oscillators shimmer",
    color: "#6b2fa0",
    patterns: ["blinker", "toad", "pulsar"],
    body: "An oscillator repeats in place. A pulsar is planted as 48 cells but averages more than that over its three phases, so it earns on more cells than it cost. Bigger shapes are easier to knock apart.",
  },
  {
    title: "Ships and guns reach",
    color: "#c8431f",
    patterns: ["glider", "lwss", "gosper-gun"],
    body: "Planting next to a rival costs three times the price. Something that travels gets there for the normal price. When a glider hits a colony, births in the wreck join whoever owns most of their parents, so territory changes hands. A gun keeps firing gliders, and every glider in flight earns, up to the gun's reach.",
  },
  {
    title: "Eaters defend",
    color: "#2364aa",
    patterns: ["eater"],
    body: "An eater is a seven-cell still life that destroys a glider flying into it at the right angle and repairs itself. A line of them facing a raider is a wall, and it earns like any still life while it waits.",
  },
  {
    title: "Wild seeds gamble",
    color: "#c99a2e",
    patterns: ["r-pentomino"],
    body: "Five cells that grow chaotically for a long time. On an empty dish the R-pentomino is all yours; near others, its births join whoever owns most of their parents, and contested ground stays empty. A colony is paid for at most four cells per cell it planted, so growth past twenty cells covers ground but earns nothing more.",
  },
];

const MEASURE: PatternName[] = ["block", "beehive", "eater", "blinker", "pulsar", "glider", "lwss", "gosper-gun", "r-pentomino"];
const HOUR = 240;

type Yield = { cells: number; avg: number };

/** Average live cells over the first hour after planting each pattern alone on an empty dish, measured with petri-core. */
function useYields(w: number, h: number) {
  const [out, setOut] = useState<Partial<Record<PatternName, Yield>>>({});
  useEffect(() => {
    let live = true;
    loadEngine().then(() => {
      const m: Partial<Record<PatternName, Yield>> = {};
      for (const p of MEASURE) {
        const e = new Engine(w, h, 0, 0, 1_000_000, 1);
        e.set_colonies(1);
        const cells = pattern_cells(p, Math.floor(w / 3), Math.floor(h / 3), w, h, 0, false);
        e.plant(1, cells);
        let sum = 0;
        for (let g = 0; g < HOUR; g++) {
          e.step(1);
          sum += e.total_live();
        }
        e.free();
        m[p] = { cells: cells.length, avg: sum / HOUR };
      }
      if (live) setOut(m);
    });
    return () => {
      live = false;
    };
  }, [w, h]);
  return out;
}

export function StrategySection() {
  const { d, rules, ready, perCell, cellPrice } = useLive();
  const r = rules ?? LAUNCH;
  const offsets = usePatternOffsets();
  const yields = useYields(r.width, r.height);
  const genMs = Number(r.generation_ms);
  const label = (p: PatternName) => PATTERNS.find((x) => x.name === p)?.label ?? p;
  // What one counted cell is fed right now. Below `live_floor` counted cells the agar releases only that fraction of its
  // ration, so a counted cell earns the same either way: the ration, less the keeper's share, over max(counted, floor).
  const counted = d.counted;
  const perCounted = perCell;
  const payback = ready && perCounted > 0 ? cellPrice / perCounted : NaN;
  return (
    <section id="strategies" className={`band band-2 ${s.section}`} aria-labelledby="strategies-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="strategies-title" className={s.h2}>Ways to play, and what they pay</h2>
          <p className="lede">
            A live cell earns its share of the feed every generation it is alive, and its share of the tide when one comes.
            Planting it cost the price of a cell. Every strategy is a different answer to the same sum.
          </p>
        </div>

        <ul className={s.families}>
          {FAMILIES.map((f) => (
            <li key={f.title} className={s.card}>
              <div className={s.glyphs} aria-hidden="true">
                {f.patterns.map((p) => (
                  <span key={p} className={s.glyph}>
                    <Specimen offsets={offsets[p]} color={f.color} size={54} />
                  </span>
                ))}
              </div>
              <h3 className="h3">{f.title}</h3>
              <p>{f.body}</p>
              <p className={s.patternNames}>{f.patterns.map(label).join(", ")}</p>
            </li>
          ))}
        </ul>

        <div className={s.paybackHead}>
          <div className={s.prose}>
            <h3 className="h3">The payback sum</h3>
            <p>
              The price of a cell is what an average cell earns in {int(r.payback)} generations, counting at least{" "}
              {int(r.live_floor)} counted cells. Right now one cell costs{" "}
              <b className="num">{ready ? petri(cellPrice, 3) : "—"} PETRI</b>, and each paid cell is fed{" "}
              <b className="num">{ready ? petri(perCounted, 5) : "—"} PETRI</b> a generation: the ration, less the keeper&rsquo;s
              share, divided by the {ready ? int(Math.max(counted, r.live_floor)) : "—"} cells it is released for,{" "}
              {ready ? int(counted) : "—"} of them counted now. So a still life that nothing
              disturbs pays for itself in about <b className="num">{isFinite(payback) ? int(payback) : "—"}</b> generations,
              roughly {isFinite(payback) ? genTime(payback, genMs) : "—"}.
            </p>
            <p className="muted">
              {ready && counted < r.live_floor
                ? `With ${int(counted)} counted cells, fewer than ${int(r.live_floor)}, the agar releases only ${int(counted)}/${int(r.live_floor)} of its ration and keeps the rest, so a cell earns exactly what its price assumes and pays back in ${int(r.payback)} generations, not sooner. Past ${int(r.live_floor)} counted cells the price falls with each cell's share.`
                : `With ${ready ? int(counted) : "—"} counted cells, the price falls as each cell's share of the feed falls, so an average cell pays back in about ${int(r.payback)} generations whatever the crowding, until the floor of ${fmtPetri(r.min_cell_price)} PETRI a cell takes over.`}{" "}
              Both sides shrink slowly with the agar.
            </p>
            <p className="muted">
              Three things bend the sum. A colony is paid for at most {r.reach} living cells per cell it planted, so growth
              past that is ground it is not paid for. A siege costs {r.siege_x} times the price, so its cells take{" "}
              {r.siege_x} times as long to pay back. And every {r.tide_every} generations the tide pays NEAR by the PETRI each
              colony earned that hour, so every generation a cell stays alive also earns a slice of NEAR.
            </p>
          </div>
        </div>

        <details className={s.fold}>
          <summary>
            Each pattern, priced now <small>{MEASURE.length} patterns</small>
          </summary>
          <div className={s.foldBody}>
          <p className="muted small">
            Average live cells over the first {HOUR} generations (one hour) after planting each pattern alone on an empty{" "}
            {r.width} by {r.height} dish, measured in your browser with <code className={s.code}>petri-core</code>. Earnings use
            today&rsquo;s feed per paid cell and count at most {r.reach} cells per cell planted. On the real dish neighbours,
            raids and crowding change all of this.
          </p>
          <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Pattern payback">
            <table className={`${s.table} ${s.payTable}`}>
              <thead>
                <tr>
                  <th scope="col">Pattern</th>
                  <th scope="col">Cells planted</th>
                  <th scope="col">Costs now</th>
                  <th scope="col">Average live cells</th>
                  <th scope="col">Earns a generation</th>
                  <th scope="col">Pays back in</th>
                </tr>
              </thead>
              <tbody>
                {MEASURE.map((p) => {
                  const y = yields[p];
                  const cost = y ? cellPrice * y.cells : 0;
                  const earn = y ? Math.min(y.avg, y.cells * r.reach) * perCounted : 0;
                  const gens = earn > 0 ? cost / earn : NaN;
                  return (
                    <tr key={p}>
                      <th scope="row">{label(p)}</th>
                      <td className="num">{y ? y.cells : "—"}</td>
                      <td className="num">{ready && y ? `${petri(cost, 2)} PETRI` : "—"}</td>
                      <td className="num">{y ? y.avg.toFixed(1) : "—"}</td>
                      <td className="num">{ready && y ? petri(earn, 4) : "—"}</td>
                      <td className="num">{ready && isFinite(gens) ? `${int(gens)} gen, ${genTime(gens, genMs)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            A glider gun&rsquo;s average climbs because every glider it fires keeps flying and earning; on a crowded dish those
            gliders soon hit something. The R-pentomino&rsquo;s figure is for an empty dish, where all of its growth is yours.
          </p>
          </div>
        </details>
      </div>
    </section>
  );
}
