// Candidate moves for each strain. Code proposes only plantings the contract will accept (checked with the same
// petri-core rules); a model then chooses among them and writes the lab note. Rules decide what is legal.

import { pattern_cells, quote } from "./lib.mjs";

// Direction a glider (and a Gosper gun's stream) travels for each rotation (rotation turns (a, b) into (-b, a)), and
// the direction a lightweight spaceship travels, both measured on the engine.
const GLIDER_DIR = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];
const LWSS_DIR = [
  [-1, 0],
  [0, -1],
  [1, 0],
  [0, 1],
];

// Shapes the engine has no name for, as (x, y) offsets. The contract takes any list of cells.
const SHAPES = {
  // A methuselah: seven cells that run for over 5,000 generations and leave hundreds of cells and a flock of gliders.
  acorn: [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
};

/** Flat cell indices for a named pattern or one of SHAPES at (x, y), turned `rot` quarter turns, wrapped. */
export function shapeCells(name, x, y, w, h, rot) {
  const offsets = SHAPES[name];
  if (!offsets) return Array.from(pattern_cells(name, x, y, w, h, rot, false));
  return offsets.map(([a, b]) => {
    for (let r = 0; r < rot; r++) [a, b] = [-b, a];
    return ((((y + b) % h) + h) % h) * w + ((((x + a) % w) + w) % w);
  });
}

export const REGIONS = ["north-west", "north-east", "south-west", "south-east"];
/** Which quarter of the dish a point lies in (north is the top row). */
export function quadrantOf(x, y, w, h) {
  return `${y < h / 2 ? "north" : "south"}-${x < w / 2 ? "west" : "east"}`;
}

export function wrapDelta(a, b, n) {
  let d = b - a;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/** Circular mean of a colony's cells on the torus, plus its size. */
export function colonyCentres(cells, w, h) {
  const acc = new Map();
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (!c) continue;
    const x = i % w;
    const y = (i / w) | 0;
    let a = acc.get(c);
    if (!a) acc.set(c, (a = { n: 0, sx: 0, cx: 0, sy: 0, cy: 0 }));
    a.n++;
    a.sx += Math.sin((2 * Math.PI * x) / w);
    a.cx += Math.cos((2 * Math.PI * x) / w);
    a.sy += Math.sin((2 * Math.PI * y) / h);
    a.cy += Math.cos((2 * Math.PI * y) / h);
  }
  const out = new Map();
  for (const [c, a] of acc) {
    const x = ((Math.atan2(a.sx, a.cx) / (2 * Math.PI)) * w + w) % w;
    const y = ((Math.atan2(a.sy, a.cy) / (2 * Math.PI)) * h + h) % h;
    out.set(c, { x: Math.round(x) % w, y: Math.round(y) % h, n: a.n });
  }
  return out;
}

function crowding(cells, w, h, x, y, r) {
  let n = 0;
  for (let dy = -r; dy <= r; dy++) {
    const row = (((y + dy) % h) + h) % h * w;
    for (let dx = -r; dx <= r; dx++) if (cells[row + ((((x + dx) % w) + w) % w)]) n++;
  }
  return n;
}

function freshSpots(cells, w, h, rng, k = 60) {
  const spots = [];
  for (let i = 0; i < k; i++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    spots.push({ x, y, c: crowding(cells, w, h, x, y, 9) });
  }
  return spots.sort((a, b) => a.c - b.c);
}

export function compass(dx, dy) {
  const ns = dy < -2 ? "north" : dy > 2 ? "south" : "";
  const ew = dx < -2 ? "west" : dx > 2 ? "east" : "";
  return ns + (ns && ew ? "-" : "") + ew || "at the centre";
}

export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

/**
 * Up to `limit` legal plantings for a strain, each with a plain description, a kind, its target (a colony id, for
 * raids and walls) and whether it is an ambitious play. The set always holds at least one ambitious option (a glider
 * gun, a spaceship, an eater wall, a pulsar or a methuselah) when one is affordable.
 * world: { engine, cells, rules, colonies, totalLive }, me: { id, temperament, cap, maxCost }, balance: PETRI units
 * (maxCost, if set, is the most one planting may cost: the mainnet house keeps a daily PETRI budget).
 * pact: promises in force this window: { avoid: Set of colony ids never to target or crowd, protected: colony ids an
 * on-chain pact forbids planting within `radius` cells of (the contract refuses such plantings), banRegions: Set of
 * quarters to stay out of, strike: the colony id this strain was paid to raid }.
 */
export function candidates(world, me, balance, rng, limit = 6, pact = {}) {
  const { engine, cells, rules } = world;
  const w = rules.width;
  const h = rules.height;
  const avoid = pact.avoid ?? new Set();
  const banRegions = pact.banRegions ?? new Set();
  const centres = colonyCentres(cells, w, h);
  const mine = centres.get(me.id);
  // Rivals are named by number only. Colony names are written by players, and a model reading them could be steered
  // by a name written as an instruction, so no player-written text ever reaches the prompt.
  const rivals = [...centres.entries()].filter(([c]) => c !== me.id).map(([c, v]) => ({ id: c, ...v, name: `colony ${c}` }));
  const price = (n) => Number(quote(engine.agar(), rules.feed_ppm, rules.keeper_bps, engine.counted(), rules.live_floor, rules.payback, rules.min_cell_price, n, false, rules.siege_x));
  const dist = (a, b) => Math.hypot(wrapDelta(a.x, b.x, w), wrapDelta(a.y, b.y, h));
  const out = [];
  const seen = new Set();
  let room = limit;

  const tryAdd = (pattern, x, y, rot, why, extra = {}) => {
    if (out.length >= room) return false;
    if (extra.target != null && avoid.has(extra.target)) return false;
    const px = ((x % w) + w) % w;
    const py = ((y % h) + h) % h;
    // A promise to stay out of a quarter of the dish, or away from an ally, holds for every planting.
    if (banRegions.has(quadrantOf(px, py, w, h))) return false;
    for (const id of avoid) {
      const c = centres.get(id);
      if (c && dist({ x: px, y: py }, c) < 14) return false;
    }
    const idx = extra.cells ?? shapeCells(pattern, x, y, w, h, rot);
    if (idx.length === 0) return false;
    const key = idx.slice().sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    // The house never lays siege: strains plant only outside every rival's buffer.
    if (engine.check_plant(me.id, new Uint32Array(idx), rules.buffer, rules.max_plant_cells) !== "") return false;
    // Nor anywhere a pact binding it forbids: the contract would refuse it.
    if (pact.protected?.length && engine.pact_breach(new Uint32Array(idx), new Uint16Array(pact.protected), pact.radius ?? 8) !== "") return false;
    const cost = price(idx.length);
    if (cost > balance * 0.6 || (me.maxCost != null && cost > me.maxCost)) return false;
    seen.add(key);
    out.push({
      pattern,
      x: px,
      y: py,
      rot,
      cells: idx,
      cost,
      why: `${why} at ${px}, ${py}`,
      kind: extra.kind ?? "grow",
      target: extra.target ?? null,
      ambitious: !!extra.ambitious,
      pact: extra.pact ?? null,
    });
    return true;
  };

  const home = mine ?? freshSpots(cells, w, h, rng)[0];
  const myCells = mine?.n ?? 0;
  const cap = me.cap ?? 420;
  const t = me.temperament;
  const targets = rivals.filter((r) => !avoid.has(r.id));
  const nearest = targets.slice().sort((a, b) => dist(home, a) - dist(home, b))[0];
  const richest = targets.slice().sort((a, b) => b.n - a.n)[0];

  // Growing the colony: still lifes near home, kept apart so they do not merge into chaos.
  const grow = (kinds, spread, ambitious = false) => {
    for (let i = 0; i < 60 && out.length < room; i++) {
      const ang = rng() * Math.PI * 2;
      const r = spread[0] + rng() * (spread[1] - spread[0]);
      const x = Math.round(home.x + Math.cos(ang) * r);
      const y = Math.round(home.y + Math.sin(ang) * r);
      const p = kinds[Math.floor(rng() * kinds.length)];
      if (tryAdd(p, x, y, Math.floor(rng() * 4), `${p === "pulsar" ? "a pulsar" : p} ${compass(x - home.x, y - home.y)} of our core`, { kind: "grow", ambitious }) && ambitious) return true;
    }
    return false;
  };

  // Raids: a glider (or a gun's stream of them) launched from home towards a rival.
  const raid = (target, gun = false, pactTag = null) => {
    if (!target) return false;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const rot = GLIDER_DIR.findIndex(([a, b]) => a === Math.sign(dx || 1) && b === Math.sign(dy || 1));
    const [ax, ay] = GLIDER_DIR[rot];
    const d0 = Math.round(Math.hypot(dx, dy));
    for (let i = 0; i < 30 && out.length < room; i++) {
      const d = 6 + rng() * 10;
      const x = Math.round(home.x + ax * d + (rng() - 0.5) * 6);
      const y = Math.round(home.y + ay * d + (rng() - 0.5) * 6);
      const extra = { kind: gun ? "gun" : "raid", target: target.id, ambitious: gun, pact: pactTag };
      if (gun) {
        if (tryAdd("gosper-gun", x, y, rot, `a glider gun aimed at ${target.name}, ${d0} cells away`, extra)) return true;
      } else if (tryAdd("glider", x, y, rot, `a glider towards ${target.name}, ${d0} cells away`, extra)) return true;
    }
    return false;
  };

  // A lightweight spaceship: flies straight rather than diagonally, and hits harder than a glider.
  const ship = (target, pactTag = null) => {
    if (!target) return false;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const want = Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx) || 1, 0] : [0, Math.sign(dy) || 1];
    const rot = LWSS_DIR.findIndex(([a, b]) => a === want[0] && b === want[1]);
    const d0 = Math.round(Math.hypot(dx, dy));
    for (let i = 0; i < 30 && out.length < room; i++) {
      const d = 7 + rng() * 8;
      const x = Math.round(home.x + want[0] * d + (rng() - 0.5) * 6);
      const y = Math.round(home.y + want[1] * d + (rng() - 0.5) * 6);
      if (tryAdd("lwss", x, y, rot, `a spaceship towards ${target.name}, ${d0} cells away`, { kind: "ship", target: target.id, ambitious: true, pact: pactTag })) return true;
    }
    return false;
  };

  // Walls: an eater between home and the nearest rival.
  const wall = (target) => {
    if (!target) return false;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 30 && out.length < room; i++) {
      const d = 7 + rng() * 6;
      const x = Math.round(home.x + (dx / len) * d + (rng() - 0.5) * 8);
      const y = Math.round(home.y + (dy / len) * d + (rng() - 0.5) * 8);
      if (tryAdd("eater", x, y, Math.floor(rng() * 4), `an eater facing ${target.name}`, { kind: "wall", target: target.id })) return true;
    }
    return false;
  };

  // An eater wall: three eaters in a line across the way a rival would come, planted as one.
  const eaterWall = (target) => {
    if (!target) return false;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const len = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / len, dy / len];
    for (let i = 0; i < 20 && out.length < room; i++) {
      const d = 9 + rng() * 5;
      const cx = Math.round(home.x + ux * d);
      const cy = Math.round(home.y + uy * d);
      const rot = Math.floor(rng() * 4);
      const idx = new Set();
      for (const k of [-1, 0, 1]) {
        for (const c of pattern_cells("eater", Math.round(cx - uy * 7 * k), Math.round(cy + ux * 7 * k), w, h, rot, false)) idx.add(c);
      }
      if (tryAdd("eater-wall", cx, cy, rot, `a wall of three eaters facing ${target.name}`, { kind: "wall", target: target.id, ambitious: true, cells: [...idx] })) return true;
    }
    return false;
  };

  // A methuselah or a pulsar in the freshest agar: a big bet on open space.
  const seedFresh = (p, kind) => {
    for (const s of freshSpots(cells, w, h, rng).slice(0, 10)) {
      const near = s.c ? `fresh agar (${s.c} ${s.c === 1 ? "cell" : "cells"} nearby)` : "empty agar";
      const what = p === "acorn" ? "an acorn (a methuselah that grows for thousands of generations)" : p === "r-pentomino" ? "an R-pentomino (a methuselah)" : `a ${p}`;
      if (tryAdd(p, s.x, s.y, Math.floor(rng() * 4), `${what} in ${near}`, { kind, ambitious: true })) return true;
    }
    return false;
  };

  // A promise bought at the council: aim this window's raid at the colony the payer named.
  if (pact.strike != null) {
    const target = rivals.find((r) => r.id === pact.strike);
    if (target && !avoid.has(target.id)) {
      raid(target, false, "strike");
      if (balance > price(36) * 3 && myCells < cap) raid(target, true, "strike");
      else ship(target, "strike");
    }
  }

  // One slot is kept for an ambitious play, filled last.
  room = limit - 1;
  if (myCells === 0) {
    // A colony with nothing alive starts again in the freshest agar it can find.
    for (const s of freshSpots(cells, w, h, rng).slice(0, 12)) {
      for (const p of ["beehive", "block", "loaf"]) tryAdd(p, s.x, s.y, 0, `${p} in ${s.c ? `fresh agar (${s.c} ${s.c === 1 ? "cell" : "cells"} nearby)` : "empty agar"}`, { kind: "settle" });
      if (out.length >= room) break;
    }
  } else if (t === "gardener") {
    if (myCells < cap) grow(["block", "beehive", "loaf"], [5, 14]);
    wall(nearest);
  } else if (t === "raider") {
    raid(richest);
    raid(nearest);
    if (myCells < cap / 2) grow(["block", "beehive"], [4, 10]);
  } else if (t === "engineer") {
    wall(nearest);
    raid(nearest);
    if (myCells < cap) grow(["beehive", "loaf", "block"], [5, 12]);
  } else if (t === "wanderer") {
    for (const s of freshSpots(cells, w, h, rng).slice(0, 8)) {
      tryAdd(["beehive", "loaf", "block"][Math.floor(rng() * 3)], s.x, s.y, Math.floor(rng() * 4), `a new outpost in ${s.c ? `fresh agar (${s.c} ${s.c === 1 ? "cell" : "cells"} nearby)` : "empty agar"}`, { kind: "settle" });
      if (out.length >= room - 1) break;
    }
    if (myCells < cap) grow(["beehive", "block"], [4, 9]);
  } else if (t === "chaos") {
    for (const s of freshSpots(cells, w, h, rng).slice(0, 6)) {
      tryAdd("blinker", s.x, s.y, Math.floor(rng() * 4), "a blinker to keep the agar restless", { kind: "chaos" });
      if (out.length >= room - 2) break;
    }
    raid(nearest);
    if (myCells < cap / 2) grow(["block", "toad"], [4, 10]);
  }

  // The ambitious slot. Big growth (guns, methuselahs, pulsars) only while the colony is under its cap, so no strain
  // crowds the whole dish out; walls and spaceships are always allowed.
  room = limit;
  const small = myCells < cap;
  const plays = {
    gardener: [() => small && grow(["pulsar"], [10, 18], true), () => eaterWall(nearest), () => small && seedFresh("pulsar", "grow")],
    raider: [() => small && raid(richest, true), () => ship(richest), () => ship(nearest)],
    engineer: [() => small && raid(nearest, true), () => eaterWall(nearest), () => ship(nearest)],
    wanderer: [() => small && seedFresh("acorn", "methuselah"), () => small && seedFresh("pulsar", "grow"), () => ship(richest)],
    chaos: [() => small && seedFresh(rng() < 0.5 ? "acorn" : "r-pentomino", "methuselah"), () => ship(nearest), () => small && raid(nearest, true)],
  };
  if (!out.some((c) => c.ambitious)) {
    for (const play of [...(plays[t] ?? []), () => eaterWall(nearest), () => ship(nearest)]) if (play()) break;
  }
  // When nothing ambitious is affordable, the last slot goes to one more ordinary planting.
  if (out.length < limit && myCells > 0) grow(["block", "beehive", "loaf"], [5, 14]);
  return out.slice(0, limit);
}
