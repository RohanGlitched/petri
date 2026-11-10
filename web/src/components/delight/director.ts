// The cinema's camera operator. Each generation's report (analysis.ts) offers shots: two colonies fighting at their
// border, the colony growing fastest, a glider crossing open agar, the largest colony, the whole plate, the tide about
// to turn. The director holds each shot for a while, then picks the next one with a little chance and a dislike of
// repeating itself, and writes the caption a nature documentary would put under it, from what the chain shows.

import type { GenReport } from "./analysis";
import { ringDelta } from "./analysis";

export type ShotKind = "establish" | "clash" | "growth" | "glider" | "giant" | "tide" | "colony";

export type Caption = { kicker: string; swatch?: number; title: string; sub?: string };

export type Shot = {
  kind: ShotKind;
  x: number;
  y: number;
  /** Cells across the shorter side of the screen. */
  across: number;
  colony?: number;
  caption: Caption | null;
  /** performance.now() when it started and when it ends. */
  at: number;
  until: number;
};

export type ColonyInfo = {
  id: number;
  name: string;
  color: number;
  role: string;
  /** PETRI earned so far (units of 1e-6), or 0 for colonies that are never paid. */
  earned: number;
  /** Generations since it joined. */
  age: number;
  sinceLastPlant: number | null;
};

export type World = {
  w: number;
  h: number;
  generation: number;
  live: number;
  colonyCount: number;
  info: Map<number, ColonyInfo>;
  netLabel: string;
  forecast: boolean;
  /** Generations played ahead, in fast-forward. */
  ahead: number;
  tideIn: number;
  mine?: number | null;
  /** Start on this colony and keep coming back to it. */
  focus?: number | null;
};

const int = (n: number) => Math.round(n).toLocaleString("en-US");
const petri = (u: number) => (u / 1e6).toLocaleString("en-US", { maximumFractionDigits: u >= 1e8 ? 0 : 1 });
const plural = (n: number, one: string, many = one + "s") => `${int(n)} ${n === 1 ? one : many}`;

export class Director {
  shot: Shot | null = null;
  report: GenReport | null = null;
  private recent: string[] = [];
  private count = 0;
  private lostGlider = 0;
  private rand: () => number;

  constructor(seed = Date.now()) {
    let s = seed >>> 0 || 1;
    this.rand = () => {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return ((s >>> 0) % 10000) / 10000;
    };
  }

  /** A new generation. A glider being followed is found again, a little further on. */
  observe(r: GenReport, world: World) {
    this.report = r;
    const s = this.shot;
    if (s?.kind === "glider") {
      let best: { x: number; y: number } | null = null;
      let bd = 5;
      for (const g of r.gliders) {
        if (g.id !== s.colony) continue;
        const dd = Math.hypot(ringDelta(s.x, g.x, world.w), ringDelta(s.y, g.y, world.h));
        if (dd < bd) {
          bd = dd;
          best = g;
        }
      }
      if (best) {
        s.x = best.x;
        s.y = best.y;
        this.lostGlider = 0;
      } else if (++this.lostGlider > 2) s.until = Math.min(s.until, performance.now() + 1500);
    }
    if (s?.kind === "colony" || s?.kind === "giant") {
      const m = s.colony ? r.colonies.get(s.colony) : undefined;
      if (m && Number.isFinite(m.ax)) {
        // Drift with the colony, but only within reach: a jump to another patch waits for the next shot.
        if (Math.hypot(ringDelta(s.x, m.ax, world.w), ringDelta(s.y, m.ay, world.h)) < 12) {
          s.x = m.ax;
          s.y = m.ay;
        }
      }
    }
  }

  /** The shot to show now: the current one while it lasts, else a new one. */
  next(now: number, world: World, holdSec: number): Shot | null {
    if (this.shot && now < this.shot.until) return this.shot;
    const r = this.report;
    if (!r) return this.shot;
    const pick = this.choose(r, world);
    const hold = holdSec * (0.85 + this.rand() * 0.4);
    this.shot = { ...pick, at: now, until: now + hold * 1000 };
    this.count++;
    this.recent.push(`${pick.kind}:${pick.colony ?? ""}`);
    if (this.recent.length > 4) this.recent.shift();
    return this.shot;
  }

  /** End the current shot now (a key press, a new mode). */
  cut() {
    if (this.shot) this.shot.until = 0;
  }

  private choose(r: GenReport, world: World): Omit<Shot, "at" | "until"> {
    const { w, h, info } = world;
    const name = (id: number) => info.get(id)?.name ?? `Colony ${id}`;
    const kick = (id: number) => {
      const c = info.get(id);
      return c ? `${c.name} · ${c.role}` : `Colony ${id}`;
    };
    const when = world.forecast ? "in one generation" : "this generation";
    const options: { score: number; shot: Omit<Shot, "at" | "until"> }[] = [];
    const seen = (k: string) => this.recent.filter((x) => x === k).length;
    const add = (score: number, shot: Omit<Shot, "at" | "until">) => {
      const key = `${shot.kind}:${shot.colony ?? ""}`;
      options.push({ score: score / (1 + 2.5 * seen(key)) / (1 + 0.6 * this.recent.filter((x) => x.startsWith(shot.kind + ":")).length), shot });
    };

    const establish: Omit<Shot, "at" | "until"> = {
      kind: "establish",
      x: r.busy?.x ?? w / 2,
      y: r.busy?.y ?? h / 2,
      across: Math.min(w, h) * 0.9,
      caption: {
        kicker: world.forecast ? `Fast-forward · ${plural(world.ahead, "generation")} ahead` : `Live · ${world.netLabel}`,
        title: `One dish, ${w} by ${h} cells.`,
        sub: world.forecast
          ? `${int(r.live)} living cells in ${plural(world.colonyCount, "colony", "colonies")}, played ahead by the contract's own rules, as if nobody planted.`
          : `${int(r.live)} living cells in ${plural(world.colonyCount, "colony", "colonies")}. Every one belongs to a NEAR account, and the contract steps them all every fifteen seconds.`,
      },
    };
    // The first shot sets the scene; then every fifth or so pulls back again.
    if (this.count === 0 && !world.focus) return establish;
    add(this.count % 5 === 0 ? 3 : 0.5, establish);

    if (world.focus && info.has(world.focus)) {
      const m = r.colonies.get(world.focus);
      const c = info.get(world.focus)!;
      if (m && Number.isFinite(m.ax))
        add(this.count === 0 ? 1e6 : 2.2, {
          kind: "colony",
          x: m.ax,
          y: m.ay,
          across: 40,
          colony: c.id,
          caption: {
            kicker: kick(c.id),
            swatch: c.color,
            title: `${c.name}, ${plural(m.live, "living cell")}.`,
            sub: [c.age > 0 ? `First planted ${plural(c.age, "generation")} ago` : null, c.earned > 0 ? `${petri(c.earned)} PETRI earned` : null].filter(Boolean).join(" · ") || undefined,
          },
        });
    }

    if (r.clash && r.clash.n >= 3 && r.clash.a && r.clash.b) {
      const { a, b } = r.clash;
      add(2 + Math.log2(r.clash.n), {
        kind: "clash",
        x: r.clash.x,
        y: r.clash.y,
        across: 26,
        colony: a,
        caption: {
          kicker: `${name(a)} meets ${name(b)}`,
          swatch: info.get(a)?.color,
          title: `At the border of ${name(a)} and ${name(b)}, cells are dying.`,
          sub: `${plural(r.clash.n, "cell")} lost along this border ${when}. In Life, crowding kills: a cell with more than three neighbours dies.`,
        },
      });
    }

    let grow: { id: number; net: number; x: number; y: number; births: number } | null = null;
    r.colonies.forEach((m) => {
      const net = m.births - m.deaths;
      if (net > 0 && Number.isFinite(m.bornX) && (!grow || net > grow.net)) grow = { id: m.id, net, x: m.bornX, y: m.bornY, births: m.births };
    });
    if (grow) {
      const g = grow as { id: number; net: number; x: number; y: number; births: number };
      const c = info.get(g.id);
      add(1.6 + Math.log2(1 + g.net) / 2, {
        kind: "growth",
        x: g.x,
        y: g.y,
        across: 34,
        colony: g.id,
        caption: {
          kicker: kick(g.id),
          swatch: c?.color,
          title: `${name(g.id)} is growing.`,
          sub: `${plural(g.births, "cell")} born ${when}, ${int(g.net)} more than it lost.${c && c.earned > 0 ? ` ${petri(c.earned)} PETRI earned so far.` : ""}`,
        },
      });
    }

    if (r.gliders.length) {
      const gl = r.gliders[Math.floor(this.rand() * r.gliders.length)];
      add(2.4, {
        kind: "glider",
        x: gl.x,
        y: gl.y,
        across: 20,
        colony: gl.id,
        caption: {
          kicker: kick(gl.id),
          swatch: info.get(gl.id)?.color,
          title: `A glider of ${name(gl.id)} is crossing open agar.`,
          sub: "Five cells that move one square diagonally every four generations, for as long as nothing stands in the way.",
        },
      });
    }

    let big: { id: number; live: number; x: number; y: number } | null = null;
    r.colonies.forEach((m) => {
      if (m.live > 0 && Number.isFinite(m.ax) && (!big || m.live > big.live)) big = { id: m.id, live: m.live, x: m.ax, y: m.ay };
    });
    if (big) {
      const b = big as { id: number; live: number; x: number; y: number };
      const c = info.get(b.id);
      const facts = [c && c.age > 0 ? `First planted ${plural(c.age, "generation")} ago` : null, c && c.earned > 0 ? `${petri(c.earned)} PETRI earned` : null].filter(Boolean);
      add(1.3, {
        kind: "giant",
        x: b.x,
        y: b.y,
        across: 54,
        colony: b.id,
        caption: {
          kicker: kick(b.id),
          swatch: c?.color,
          title: `${name(b.id)} holds ${plural(b.live, "living cell")}, the most on the dish.`,
          sub: facts.length ? facts.join(" · ") + "." : undefined,
        },
      });
    }

    // Other colonies, so a quiet dish still tours its residents.
    const others = [...r.colonies.values()].filter((m) => m.live >= 4 && Number.isFinite(m.ax));
    if (others.length) {
      const m = others[Math.floor(this.rand() * others.length)];
      const c = info.get(m.id);
      add(0.9, {
        kind: "colony",
        x: m.ax,
        y: m.ay,
        across: 38,
        colony: m.id,
        caption: c
          ? {
              kicker: kick(m.id),
              swatch: c.color,
              title: m.id === world.mine ? `Your colony, ${plural(m.live, "living cell")}.` : `${c.name}, ${plural(m.live, "living cell")}.`,
              sub: [c.age > 0 ? `First planted ${plural(c.age, "generation")} ago` : null, c.earned > 0 ? `${petri(c.earned)} PETRI earned` : null].filter(Boolean).join(" · ") || undefined,
            }
          : null,
      });
    }

    if (!world.forecast && world.tideIn > 0 && world.tideIn <= 6) {
      add(4, {
        ...establish,
        kind: "tide",
        caption: {
          kicker: "The tide",
          title: world.tideIn === 1 ? "The tide turns next generation." : `The tide turns in ${world.tideIn} generations.`,
          sub: "Then part of the NEAR vault is paid out, split by the PETRI each colony earned since the last tide.",
        },
      });
    }

    let total = 0;
    for (const o of options) total += o.score;
    let k = this.rand() * total;
    for (const o of options) {
      k -= o.score;
      if (k <= 0) return o.shot;
    }
    return options[options.length - 1]?.shot ?? establish;
  }
}
