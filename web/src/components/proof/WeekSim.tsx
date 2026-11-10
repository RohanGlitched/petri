"use client";
// A week of the dish in a minute. It starts from a copy of the live dish (the browser's petri-core engine, at the
// generation the clock says is due) and runs 40,320 generations with the contract's own Rust core: Life, the feed
// from the agar, the stake cap, the planting price (siege included), the purchase curve and the tide split all come
// from petri-core. What is scripted is the players: the five house strains follow simplified versions of their written
// rules (agents/strategies.mjs), the colonies already on the dish replant now and then, newcomers arrive, and the
// what-if buttons add a whale, a glider-gun war, idle strains or a crowd. Nothing here touches the chain.

import { useEffect, useMemo, useRef, useState } from "react";
import { Culture } from "@/components/Culture";
import { LineChart } from "@/components/charts/LineChart";
import { buy_quote, pattern_cells, quote, type Engine, type PatternName } from "@/engine";
import { currentEngine, useDish } from "@/lib/dish-store";
import type { Rules } from "@/lib/chain";
import { useNet } from "@/lib/use-net";
import s from "./proof.module.css";

const WEEK = 40_320;
const MINUTE_MS = 60_000;
const NEAR = 10n ** 24n;
const P = 1e6;

type Kind = "gardener" | "raider" | "engineer" | "wanderer" | "chaos" | "player" | "newcomer" | "whale" | "gunner";
type Player = { id: number; name: string; color: number; kind: Kind; house: boolean; every: number; next: number; balance: number; budget: bigint; spent: bigint; base: number; earned: number };
type Point = { g: number; price: number; agar: number; burned: number; paid: number; live: number };
type Sim = {
  e: Engine;
  rules: Rules;
  start: number;
  players: Player[];
  vault: bigint;
  burned: number;
  paid: bigint;
  tides: number;
  points: Point[];
  queue: { at: number; kind: Kind }[];
  idle: boolean;
  events: string[];
  nextId: number;
};

const STRAINS: Kind[] = ["gardener", "raider", "engineer", "wanderer", "chaos"];
const COLORS = [0x6fd3ff, 0xffd166, 0xef476f, 0x06d6a0, 0xc77dff, 0xf4a261, 0x90be6d, 0xff70a6, 0x70d6ff, 0xe9ff70];

function rand(n: number) {
  return Math.floor(Math.random() * n);
}

/** Where `pattern` can go for colony `id`: near (x, y) within `r` cells, or anywhere when r is 0. */
function spot(e: Engine, rules: Rules, id: number, pattern: PatternName, near: [number, number] | null, r: number): number[] | null {
  const { width: w, height: h } = rules;
  for (let i = 0; i < 80; i++) {
    const x = near ? (near[0] + rand(2 * r + 1) - r + w) % w : rand(w);
    const y = near ? (near[1] + rand(2 * r + 1) - r + h) % h : rand(h);
    const cells = Array.from(pattern_cells(pattern, x, y, w, h, rand(4), false));
    const ok = e.check_plant(id, new Uint32Array(cells), rules.buffer, rules.max_plant_cells);
    if (ok === "" || ok.startsWith("siege:")) return cells;
  }
  return null;
}

function cellOf(cells: Uint16Array, w: number, who: (o: number) => boolean): [number, number] | null {
  const start = rand(cells.length);
  for (let k = 0; k < cells.length; k++) {
    const i = (start + k) % cells.length;
    if (cells[i] && who(cells[i])) return [i % w, Math.floor(i / w)];
  }
  return null;
}

function priceNear(rules: Rules, agar: number) {
  return (Number(rules.petri_price) * Number(rules.max_supply)) / Math.max(1, agar) / 1e24;
}

export function WeekSim() {
  const dish = useDish();
  const net = useNet();
  const sim = useRef<Sim | null>(null);
  const [frame, setFrame] = useState<{ cells: Uint16Array; prev: Uint16Array; at: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [running, setRunning] = useState(false);
  const [palette, setPalette] = useState<Map<number, number>>(new Map());
  const raf = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reset = () => {
    const live = currentEngine();
    if (!live || !dish.rules || !dish.state) return;
    sim.current?.e.free();
    const e = live.clone_engine();
    const rules = dish.rules;
    const house = new Set(dish.state.house);
    const players: Player[] = dish.colonies.map((c, i) => {
      const hk = house.has(c.id) ? STRAINS[[...house].indexOf(c.id) % 5] : "player";
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        kind: hk,
        house: house.has(c.id),
        every: hk === "player" ? 480 + rand(480) : 60 + rand(40),
        next: e.generation() + rand(120) + i,
        balance: 0,
        budget: hk === "player" ? NEAR / 20n : (3n * NEAR) / 2n,
        spent: 0n,
        base: Number(e.earned_of(c.id)),
        earned: 0,
      };
    });
    sim.current = { e, rules, start: e.generation(), players, vault: BigInt(dish.state.vault), burned: 0, paid: 0n, tides: 0, points: [], queue: [], idle: false, events: [], nextId: dish.colonies.length + 1 };
    // Five newcomers a day, spread over the week.
    for (let d = 0; d < 7; d++) for (let k = 0; k < 5; k++) sim.current.queue.push({ at: e.generation() + d * 5760 + rand(5760), kind: "newcomer" });
    setPalette(new Map(players.map((p) => [p.id, p.color])));
    record(sim.current);
    setFrame({ cells: e.cells(), prev: e.cells(), at: performance.now() });
    setTick((t) => t + 1);
  };

  const record = (S: Sim) => {
    const agar = Number(S.e.agar());
    S.points.push({ g: S.e.generation() - S.start, price: priceNear(S.rules, agar), agar, burned: S.burned, paid: Number(S.paid) / 1e24, live: S.e.total_live() });
  };

  const join = (S: Sim, kind: Kind, budget: bigint, name: string) => {
    const id = S.nextId++;
    S.e.set_colonies(id);
    const p: Player = { id, name, color: COLORS[id % COLORS.length], kind, house: false, every: kind === "gunner" ? 1440 : kind === "whale" ? 120 : 240 + rand(240), next: S.e.generation() + 1, balance: 0, budget, spent: 0n, base: 0, earned: 0 };
    S.players.push(p);
    setPalette((m) => new Map(m).set(id, p.color));
    buy(S, p, kind === "whale" ? 0n : budget / 2n);
    return p;
  };

  /** Spend `near` yoctoNEAR on the agar's curve for player `p`. */
  const buy = (S: Sim, p: Player, near: bigint) => {
    if (near <= 0n || p.spent + near > p.budget) return 0;
    const units = Number(buy_quote(near.toString(), S.e.agar(), S.rules.petri_price, S.rules.max_supply));
    S.e.set_agar((BigInt(S.e.agar()) - BigInt(units)).toString());
    S.vault += near;
    p.spent += near;
    p.balance += units;
    if (near >= BigInt(S.rules.min_join)) S.e.attach(p.id);
    return units;
  };

  const plant = (S: Sim, p: Player, cells: number[] | null) => {
    if (!cells) return false;
    const r = S.rules;
    const siege = S.e.check_plant(p.id, new Uint32Array(cells), r.buffer, r.max_plant_cells).startsWith("siege:");
    const cost = Number(quote(S.e.agar(), r.feed_ppm, r.keeper_bps, S.e.counted(), r.live_floor, r.payback, r.min_cell_price, cells.length, siege, r.siege_x));
    if (p.balance + p.earned < cost) {
      // Buy what is missing, within the budget.
      const want = BigInt(Math.ceil(((cost - p.balance - p.earned) / P) * Number(r.petri_price) * 1.2 * (Number(r.max_supply) / Number(S.e.agar()))));
      buy(S, p, want < BigInt(r.min_join) ? BigInt(r.min_join) : want);
      if (p.balance + p.earned < cost) return false;
    }
    p.balance -= cost;
    const burn = Math.floor((cost * r.burn_bps) / 10000);
    S.burned += burn;
    S.e.set_agar((BigInt(S.e.agar()) + BigInt(cost - burn)).toString());
    S.e.plant(p.id, new Uint32Array(cells));
    S.vault += BigInt(r.cell_fee) * BigInt(cells.length);
    return true;
  };

  const act = (S: Sim, p: Player) => {
    const { e, rules } = S;
    const cells = e.cells();
    const w = rules.width;
    const mine = cellOf(cells, w, (o) => o === p.id);
    switch (p.kind) {
      case "gardener":
        return plant(S, p, spot(e, rules, p.id, Math.random() < 0.6 ? "block" : "beehive", mine, 10));
      case "engineer":
        return plant(S, p, spot(e, rules, p.id, Math.random() < 0.5 ? "eater" : "block", mine, 12));
      case "raider": {
        const rival = cellOf(cells, w, (o) => o !== p.id);
        return plant(S, p, spot(e, rules, p.id, "glider", rival, 14));
      }
      case "wanderer":
        return plant(S, p, spot(e, rules, p.id, "block", null, 0));
      case "chaos":
        return plant(S, p, spot(e, rules, p.id, Math.random() < 0.5 ? "r-pentomino" : "blinker", null, 0));
      case "whale":
        return plant(S, p, spot(e, rules, p.id, Math.random() < 0.5 ? "pulsar" : "beehive", null, 0));
      case "gunner":
        return plant(S, p, spot(e, rules, p.id, "gosper-gun", null, 0));
      default:
        return plant(S, p, spot(e, rules, p.id, Math.random() < 0.7 ? "block" : "beehive", mine, 8));
    }
  };

  const tide = (S: Sim) => {
    const r = S.rules;
    if (!S.e.tide_due()) return;
    const pay = (S.vault * BigInt(r.tide_bps)) / 10000n;
    const [paid, , asCredit] = S.e.tide(pay.toString(), "0").split(",").map((x) => BigInt(x));
    S.vault -= paid + asCredit;
    S.paid += paid + asCredit;
    S.tides++;
  };

  const step = (S: Sim, n: number) => {
    const every = S.rules.tide_every;
    for (let i = 0; i < n; i++) {
      const g = S.e.generation();
      if (g - S.start >= WEEK) return;
      // Arrivals.
      while (S.queue.length && S.queue[0].at <= g) {
        const q = S.queue.shift()!;
        join(S, q.kind, q.kind === "newcomer" ? NEAR / 20n + BigInt(rand(4)) * (NEAR / 20n) : NEAR, `Newcomer ${S.nextId}`);
      }
      for (const p of S.players) {
        if (g < p.next) continue;
        p.next = g + p.every;
        if (p.house && S.idle) continue;
        if (p.house && p.spent >= p.budget) continue;
        act(S, p);
      }
      const to = Math.min(every - (g % every), WEEK - (g - S.start));
      S.e.step(Math.max(1, Math.min(to, nextEvent(S, g) - g)));
      for (const p of S.players) p.earned = Number(S.e.earned_of(p.id)) - p.base;
      if (S.e.generation() % every === 0) {
        tide(S);
        record(S);
      }
    }
  };

  const nextEvent = (S: Sim, g: number) => {
    let n = g + 240;
    for (const p of S.players) if (!(p.house && S.idle) && p.next < n) n = p.next;
    if (S.queue.length && S.queue[0].at < n) n = S.queue[0].at;
    return Math.max(g + 1, n);
  };

  // The loop: about a week of generations a minute, drawn on timers so a background tab still advances.
  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const loop = () => {
      const S = sim.current;
      if (!S) return;
      const now = performance.now();
      const want = Math.max(1, Math.round(((now - last) / MINUTE_MS) * WEEK));
      last = now;
      const prev = S.e.cells();
      const target = Math.min(S.start + WEEK, S.e.generation() + want);
      let guard = 0;
      while (S.e.generation() < target && guard++ < 400) step(S, 1);
      setFrame({ cells: S.e.cells(), prev, at: performance.now() });
      setTick((t) => t + 1);
      if (S.e.generation() - S.start >= WEEK) {
        setRunning(false);
        return;
      }
      raf.current = setTimeout(loop, 50);
    };
    raf.current = setTimeout(loop, 50);
    return () => {
      if (raf.current) clearTimeout(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  useEffect(() => {
    if (dish.status === "ready" && !sim.current) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dish.status]);

  useEffect(
    () => () => {
      sim.current?.e.free();
      sim.current = null;
    },
    [],
  );

  const S = sim.current;
  const whatIf = (k: "whale" | "guns" | "idle" | "crowd") => () => {
    const X = sim.current;
    if (!X) return;
    const g = X.e.generation();
    if (k === "whale") {
      // NEAR for a tenth of the agar, found on the curve itself.
      const agar = BigInt(X.e.agar());
      const want = agar / 10n;
      let lo = 0n;
      let hi = 10_000n * NEAR;
      for (let i = 0; i < 90; i++) {
        const mid = (lo + hi) / 2n;
        if (BigInt(buy_quote(mid.toString(), X.e.agar(), X.rules.petri_price, X.rules.max_supply)) < want) lo = mid;
        else hi = mid;
      }
      const p = join(X, "whale", hi * 2n, "Whale");
      buy(X, p, hi);
      X.events.push(`Generation ${(g - X.start).toLocaleString("en-US")}: a whale bought ${(Number(want) / P).toLocaleString("en-US", { maximumFractionDigits: 0 })} PETRI, a tenth of the agar, for ${(Number(hi) / 1e24).toFixed(2)} NEAR.`);
    } else if (k === "guns") {
      for (let i = 0; i < 4; i++) {
        const p = join(X, "gunner", NEAR, `Gunner ${i + 1}`);
        act(X, p);
      }
      X.events.push(`Generation ${(g - X.start).toLocaleString("en-US")}: four colonies started a glider-gun war.`);
    } else if (k === "idle") {
      X.idle = !X.idle;
      X.events.push(`Generation ${(g - X.start).toLocaleString("en-US")}: the strains ${X.idle ? "went idle" : "woke up"}.`);
    } else {
      for (let i = 0; i < 50; i++) X.queue.push({ at: g + rand(480), kind: "newcomer" });
      X.queue.sort((a, b) => a.at - b.at);
      X.events.push(`Generation ${(g - X.start).toLocaleString("en-US")}: 50 newcomers arrive over the next two hours.`);
    }
    setTick((t) => t + 1);
  };

  const board = useMemo(() => {
    if (!S) return [];
    const live = S.e.live_counts();
    return [...S.players].map((p) => ({ ...p, live: live[p.id] ?? 0 })).sort((a, b) => b.earned - a.earned || b.live - a.live).slice(0, 10);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // The space the simulation will take is held while the dish loads, so the footer does not jump when it appears.
  if (dish.status !== "ready" || !S)
    return (
      <div className={s.simHold} aria-busy="true">
        <p className="lede">Loading the live dish to start from…</p>
      </div>
    );
  const done = S.e.generation() - S.start;
  const days = done / 5760;
  const pts = S.points;
  const xs = pts.map((p) => p.g / 5760);
  return (
    <>
      <div className={s.two}>
        <div>
          <div style={{ position: "relative", aspectRatio: "1", borderRadius: "50%", overflow: "hidden", boxShadow: "0 0 0 1px rgba(243,233,218,0.22)" }}>
            {frame && <Culture width={S.rules.width} height={S.rules.height} cells={frame.cells} prevCells={frame.prev} changedAt={frame.at} palette={palette} look="macro" round transitionMs={60} label={`Simulated dish, day ${days.toFixed(1)}`} />}
          </div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <p className={s.kicker} style={{ margin: 0 }}>Simulation · not the chain</p>
          <h2 className="h2" style={{ margin: 0 }}>
            Day <span className="num">{days.toFixed(1)}</span> of 7
          </h2>
          <div className={s.progress} style={{ margin: 0 }} aria-hidden="true">
            <i style={{ width: `${((100 * done) / WEEK).toFixed(1)}%` }} />
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Started from the live {net.network} dish at generation {S.start.toLocaleString("en-US")}; {done.toLocaleString("en-US")} of {WEEK.toLocaleString("en-US")} generations run with the contract&rsquo;s own rules.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {done >= WEEK ? (
              <button
                className="btn btn-amber"
                onClick={() => {
                  reset();
                  setRunning(true);
                }}
              >
                Run again
              </button>
            ) : (
              <button className="btn btn-amber" onClick={() => setRunning((r) => !r)}>
                {running ? "Pause" : done > 0 ? "Resume" : "Run the week"}
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => { setRunning(false); reset(); }}>
              Start again from the live dish
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn-ghost btn-small" onClick={whatIf("whale")}>A whale buys 10% of the agar</button>
            <button className="btn btn-ghost btn-small" onClick={whatIf("guns")}>Glider-gun war</button>
            <button className="btn btn-ghost btn-small" onClick={whatIf("idle")} aria-pressed={S.idle}>{S.idle ? "Wake the strains" : "The strains go idle"}</button>
            <button className="btn btn-ghost btn-small" onClick={whatIf("crowd")}>50 newcomers arrive</button>
          </div>
          <dl className={s.tiles}>
            <div className={s.tile}>
              <dt>PETRI price</dt>
              <dd className="num">{priceNear(S.rules, Number(S.e.agar())).toFixed(6)}</dd>
              <small>NEAR per PETRI on the agar&rsquo;s curve</small>
            </div>
            <div className={s.tile}>
              <dt>Burned this week</dt>
              <dd className="num">{(S.burned / P).toLocaleString("en-US", { maximumFractionDigits: 0 })}</dd>
              <small>PETRI, by plantings</small>
            </div>
            <div className={s.tile}>
              <dt>Tides paid</dt>
              <dd className="num">{(Number(S.paid) / 1e24).toFixed(3)}</dd>
              <small>NEAR over {S.tides} tides</small>
            </div>
          </dl>
          {S.events.length > 0 && (
            <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
              {S.events.slice(-4).map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={s.two} style={{ marginTop: 40 }}>
        <div>
          <h3 className="h3">PETRI price and the agar</h3>
          <LineChart
            label="Simulated PETRI price and agar over the week"
            x={xs}
            fmtX={(d) => `day ${d.toFixed(1)}`}
            ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
            fmt={(v) => v.toFixed(6)}
            fmtRight={(v) => `${Math.round(v / 1000)}k`}
            minLeft={Math.min(...pts.map((p) => p.price)) * 0.97}
            maxLeft={Math.max(...pts.map((p) => p.price)) * 1.03}
            minRight={Math.min(...pts.map((p) => p.agar / P)) * 0.97}
            maxRight={Math.max(...pts.map((p) => p.agar / P)) * 1.01}
            height={260}
            series={[
              { label: "NEAR per PETRI", color: "#f2b45a", values: pts.map((p) => p.price) },
              { label: "PETRI in the agar", color: "#e2d5c3", values: pts.map((p) => p.agar / P), right: true, dashed: true },
            ]}
          />
        </div>
        <div>
          <h3 className="h3">Burned and paid out</h3>
          <LineChart
            label="Simulated PETRI burned and NEAR paid by tides over the week"
            x={xs}
            fmtX={(d) => `day ${d.toFixed(1)}`}
            ticks={[0, 1, 2, 3, 4, 5, 6, 7]}
            fmt={(v) => Math.round(v).toLocaleString("en-US")}
            fmtRight={(v) => `${v.toFixed(2)} N`}
            height={260}
            series={[
              { label: "PETRI burned", color: "#ff8f7f", values: pts.map((p) => p.burned / P) },
              { label: "NEAR paid at tides", color: "#9fd8a8", values: pts.map((p) => p.paid), right: true },
            ]}
          />
        </div>
      </div>

      <h3 className="h3" style={{ marginTop: 40 }}>Leaderboard: PETRI earned this week</h3>
      <ol className={s.feed}>
        {board.map((p) => (
          <li key={p.id} className={s.feedRow}>
            <span className="num">{(p.earned / P).toLocaleString("en-US", { maximumFractionDigits: 1 })} PETRI</span>
            <span className={s.who}>
              <i style={{ display: "inline-block", width: 10, height: 10, borderRadius: 5, background: `#${p.color.toString(16).padStart(6, "0")}`, marginRight: 8 }} />
              {p.name}
            </span>
            <span className={`${s.side} ${p.house ? s.sideHouse : s.sidePlayer}`}>{p.house ? `strain · ${p.kind}` : p.kind === "player" ? "on the dish now" : p.kind}</span>
            <span className="muted small">{p.live} cells</span>
          </li>
        ))}
      </ol>
      <p className={s.note}>
        House strains are never fed (as on chain), so they earn nothing here; they plant with NEAR they bring. Newcomers bring 0.05 to 0.2 NEAR each.
        The players are scripted and simple; the dish, the feed, prices and tides are petri-core&rsquo;s.
      </p>
    </>
  );
}
