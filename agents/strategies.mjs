// Candidate moves for each strain. Code proposes only plantings the contract will accept (checked with the same
// petri-core rules); a model then chooses among them and writes the lab note. Rules decide what is legal.

import { pattern_cells, quote } from "./lib.mjs";

// Direction a glider travels for each rotation (rotation turns (a, b) into (-b, a)).
const GLIDER_DIR = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

function wrapDelta(a, b, n) {
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

function compass(dx, dy) {
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
 * Up to `limit` legal plantings for a strain, each with a plain description.
 * world: { engine, cells, rules, colonies, totalLive }, me: { id, temperament }, balance: PETRI units.
 */
export function candidates(world, me, balance, rng, limit = 6) {
  const { engine, cells, rules, colonies } = world;
  const w = rules.width;
  const h = rules.height;
  const centres = colonyCentres(cells, w, h);
  const mine = centres.get(me.id);
  // Rivals are named by number only. Colony names are written by players, and a model reading them could be steered
  // by a name written as an instruction, so no player-written text ever reaches the prompt.
  const rivals = [...centres.entries()].filter(([c]) => c !== me.id).map(([c, v]) => ({ id: c, ...v, name: `colony ${c}` }));
  const totalLive = world.totalLive;
  const price = (n) => Number(quote(engine.agar(), rules.feed_ppm, rules.keeper_bps, engine.counted(), rules.live_floor, rules.payback, rules.min_cell_price, n, false, rules.siege_x));
  const out = [];
  const seen = new Set();

  const tryAdd = (pattern, x, y, rot, why) => {
    const idx = Array.from(pattern_cells(pattern, x, y, w, h, rot, false));
    const key = idx.slice().sort((a, b) => a - b).join(",");
    if (seen.has(key)) return false;
    // The house never lays siege: strains plant only outside every rival's buffer.
    if (engine.check_plant(me.id, new Uint32Array(idx), rules.buffer, rules.max_plant_cells) !== "") return false;
    const cost = price(idx.length);
    if (cost > balance * 0.6) return false;
    seen.add(key);
    const px = ((x % w) + w) % w;
    const py = ((y % h) + h) % h;
    out.push({ pattern, x: px, y: py, rot, cells: idx, cost, why: `${why} at ${px}, ${py}` });
    return true;
  };

  const home = mine ?? freshSpots(cells, w, h, rng)[0];
  const myCells = mine?.n ?? 0;
  const cap = me.cap ?? 420;
  const t = me.temperament;

  // Growing the colony: still lifes near home, kept apart so they do not merge into chaos.
  const grow = (kinds, spread) => {
    for (let i = 0; i < 60 && out.length < limit; i++) {
      const ang = rng() * Math.PI * 2;
      const r = spread[0] + rng() * (spread[1] - spread[0]);
      const x = Math.round(home.x + Math.cos(ang) * r);
      const y = Math.round(home.y + Math.sin(ang) * r);
      const p = kinds[Math.floor(rng() * kinds.length)];
      tryAdd(p, x, y, Math.floor(rng() * 4), `${p} ${compass(x - home.x, y - home.y)} of our core`);
    }
  };

  // Raids: gliders launched from home towards a rival.
  const raid = (target, gun = false) => {
    if (!target) return;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const rot = GLIDER_DIR.findIndex(([a, b]) => a === Math.sign(dx || 1) && b === Math.sign(dy || 1));
    const [ax, ay] = GLIDER_DIR[rot];
    for (let i = 0; i < 30 && out.length < limit; i++) {
      const d = 6 + rng() * 10;
      const x = Math.round(home.x + ax * d + (rng() - 0.5) * 6);
      const y = Math.round(home.y + ay * d + (rng() - 0.5) * 6);
      const dist = Math.round(Math.hypot(dx, dy));
      if (gun) {
        if (tryAdd("gosper-gun", x, y, rot, `a glider gun aimed at ${target.name}, ${dist} cells away`)) break;
      } else if (tryAdd("glider", x, y, rot, `a glider towards ${target.name}, ${dist} cells away`)) break;
    }
  };

  // Walls: eaters between home and the nearest rival.
  const wall = (target) => {
    if (!target) return;
    const dx = wrapDelta(home.x, target.x, w);
    const dy = wrapDelta(home.y, target.y, h);
    const len = Math.hypot(dx, dy) || 1;
    for (let i = 0; i < 30 && out.length < limit; i++) {
      const d = 7 + rng() * 6;
      const x = Math.round(home.x + (dx / len) * d + (rng() - 0.5) * 8);
      const y = Math.round(home.y + (dy / len) * d + (rng() - 0.5) * 8);
      if (tryAdd("eater", x, y, Math.floor(rng() * 4), `an eater facing ${target.name}`)) break;
    }
  };

  const nearest = rivals.slice().sort((a, b) => Math.hypot(wrapDelta(home.x, a.x, w), wrapDelta(home.y, a.y, h)) - Math.hypot(wrapDelta(home.x, b.x, w), wrapDelta(home.y, b.y, h)))[0];
  const richest = rivals.slice().sort((a, b) => b.n - a.n)[0];

  if (myCells === 0) {
    // A colony with nothing alive starts again in the freshest agar it can find.
    for (const s of freshSpots(cells, w, h, rng).slice(0, 12)) {
      for (const p of ["beehive", "block", "loaf"]) tryAdd(p, s.x, s.y, 0, `${p} in fresh agar (${s.c} cells nearby)`);
      if (out.length >= limit) break;
    }
    return out;
  }

  if (t === "gardener") {
    if (myCells < cap) grow(["block", "beehive", "loaf"], [5, 14]);
    if (balance > price(48) * 3 && myCells < cap) grow(["pulsar"], [10, 18]);
    wall(nearest);
  } else if (t === "raider") {
    raid(richest);
    raid(nearest);
    if (balance > price(36) * 4) raid(richest, true);
    if (myCells < cap / 2) grow(["block", "beehive"], [4, 10]);
  } else if (t === "engineer") {
    wall(nearest);
    if (balance > price(36) * 3) raid(nearest, true);
    if (myCells < cap) grow(["beehive", "loaf", "block"], [5, 12]);
  } else if (t === "wanderer") {
    for (const s of freshSpots(cells, w, h, rng).slice(0, 8)) {
      tryAdd(["beehive", "loaf", "block"][Math.floor(rng() * 3)], s.x, s.y, Math.floor(rng() * 4), `a new outpost in fresh agar (${s.c} cells nearby)`);
      if (out.length >= limit) break;
    }
    if (myCells < cap) grow(["beehive", "block"], [4, 9]);
  } else if (t === "chaos") {
    // Wild seeds only while the colony is small: an R-pentomino can grow to hundreds of cells and crowd everyone out.
    const wild = myCells < cap;
    for (const s of freshSpots(cells, w, h, rng).slice(0, 6)) {
      if (wild && rng() < 0.5) tryAdd("r-pentomino", s.x, s.y, Math.floor(rng() * 4), `an R-pentomino near ${s.c} living cells, to see what grows`);
      else tryAdd("blinker", s.x, s.y, Math.floor(rng() * 4), "a blinker to keep the agar restless");
      if (out.length >= limit) break;
    }
    raid(nearest);
    if (myCells < cap / 2) grow(["block", "toad"], [4, 10]);
  }
  return out.slice(0, limit);
}
