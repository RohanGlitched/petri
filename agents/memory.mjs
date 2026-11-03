// Each house strain's memory, kept per dish in PETRI_LOG_DIR: its last moves, what it expected of them, and what the
// live dish later showed actually happened. The strains read it back before every move and at every council.

import fs from "node:fs";
import path from "node:path";
import { pattern_cells } from "./lib.mjs";
import { boxOf, cellsInBox } from "./forecast.mjs";
import { shapeCells } from "./strategies.mjs";

export const KEEP_MOVES = 10;
// Generations after a planting at which its outcome is measured: one tide window, the same span as its forecast.
export const OUTCOME_GENS = Number(process.env.PETRI_OUTCOME_GENS ?? "240");

export function loadMemory(dir, network) {
  const file = path.join(dir, `memory-${network}.json`);
  let mem = null;
  try {
    mem = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    /* a first run */
  }
  mem ??= {};
  mem.version = 1;
  mem.network = network;
  mem.strains ??= {};
  mem.reputation ??= {};
  mem.pacts ??= [];
  mem.payments ??= {};
  mem.councilWindow ??= null;
  Object.defineProperty(mem, "file", { value: file, enumerable: false, writable: true });
  return mem;
}

export function saveMemory(mem, dry = false) {
  if (dry) return;
  const tmp = `${mem.file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(mem));
  fs.renameSync(tmp, mem.file);
}

const strainMem = (mem, account) => (mem.strains[account] ??= { moves: [] });

export function rememberMove(mem, account, move) {
  const s = strainMem(mem, account);
  s.moves.push(move);
  if (s.moves.length > KEEP_MOVES) s.moves.splice(0, s.moves.length - KEEP_MOVES);
}

export function movesOf(mem, account) {
  return mem.strains[account]?.moves ?? [];
}

// Shapes the strains plant, normalized, so a planting read back from the chain can be named.
const KNOWN = ["block", "blinker", "beehive", "loaf", "glider", "lwss", "eater", "r-pentomino", "toad", "pulsar", "gosper-gun", "acorn"];
function shapeKey(cells, w, h) {
  const x0 = cells[0] % w;
  const y0 = (cells[0] / w) | 0;
  const pts = cells.map((c) => {
    let dx = (c % w) - x0;
    let dy = ((c / w) | 0) - y0;
    if (dx > w / 2) dx -= w;
    if (dx < -w / 2) dx += w;
    if (dy > h / 2) dy -= h;
    if (dy < -h / 2) dy += h;
    return [dx, dy];
  });
  const mx = Math.min(...pts.map((p) => p[0]));
  const my = Math.min(...pts.map((p) => p[1]));
  return pts.map(([a, b]) => `${a - mx},${b - my}`).sort().join(";");
}
let shapeIndex = null;
export function classify(cells, w, h) {
  if (!shapeIndex) {
    shapeIndex = new Map();
    for (const name of KNOWN) {
      for (let rot = 0; rot < 4; rot++) {
        const variants = name === "acorn" ? [shapeCells(name, 64, 64, 128, 128, rot)] : [false, true].map((f) => Array.from(pattern_cells(name, 64, 64, 128, 128, rot, f)));
        for (const v of variants) if (v.length) shapeIndex.set(shapeKey(v, 128, 128), name);
      }
    }
  }
  if (!cells.length) return "nothing";
  return shapeIndex.get(shapeKey(cells, w, h)) ?? (cells.length > 30 ? "eater-wall" : `a ${cells.length}-cell shape`);
}

export function kindOf(pattern) {
  return { glider: "raid", "gosper-gun": "gun", lwss: "ship", eater: "wall", "eater-wall": "wall", "r-pentomino": "methuselah", acorn: "methuselah", blinker: "chaos", toad: "chaos" }[pattern] ?? "grow";
}

/**
 * A strain with no memory yet (a first run, or a new VM) reads its last plantings back from the chain, so it starts
 * out knowing what it did. Their outcomes are measured on the live dish at whatever age they have reached.
 */
export function bootstrapFromChain(mem, world, plants, house, cleanNote) {
  const { width: w, height: h } = world.rules;
  let added = 0;
  for (const c of world.colonies.filter((c) => house.includes(c.id))) {
    if (movesOf(mem, c.account).length) continue;
    const mine = plants.filter((p) => p.colony === c.id).slice(-KEEP_MOVES);
    for (const p of mine) {
      const cells = p.cells.map(Number);
      const pattern = classify(cells, w, h);
      rememberMove(mem, c.account, {
        source: "chain",
        plant: Number(p.index),
        tx: null,
        generation: Number(p.generation),
        pattern,
        kind: kindOf(pattern),
        target: null,
        cells: cells.length,
        cost: Number(p.cost),
        box: boxOf(cells, w, h),
        note: cleanNote(p.note ?? ""),
        forecast: null,
        before: null,
        outcome: null,
      });
      added++;
    }
  }
  return added;
}

/**
 * Measures, on the live dish, every remembered move that has reached OUTCOME_GENS (moves read back from the chain are
 * measured at whatever age they have, once they are 30 generations old). Returns the moves measured just now.
 * earnings: Map colony id -> PETRI units earned so far (the contract's `earnings` view), or null.
 */
export function measureOutcomes(mem, world, earnings = null) {
  const counts = world.engine.live_counts();
  const idOf = new Map(world.colonies.map((c) => [c.account, c.id]));
  const measured = [];
  for (const [account, s] of Object.entries(mem.strains)) {
    const id = idOf.get(account);
    if (!id) continue;
    for (const m of s.moves) {
      if (m.outcome) continue;
      const age = world.due - m.generation;
      if (age < (m.source === "chain" ? 30 : OUTCOME_GENS)) continue;
      const out = {
        at: new Date().toISOString(),
        generation: world.due,
        after: age,
        kept: m.box ? cellsInBox(world.engine, id, m.box) : null,
        planted: m.cells,
        mine: counts[id] ?? 0,
        mineBefore: m.before?.mine ?? null,
        target: m.target,
        targetBefore: m.target != null ? m.before?.target ?? null : null,
        targetNow: m.target != null ? counts[m.target] ?? 0 : null,
        hit: null,
        petri: null,
      };
      // A raid hit when the colony it was aimed at lost cells since (other things on the dish can do that too; the
      // forecast says how much of it this move alone should have done).
      if (out.targetBefore != null) out.hit = out.targetNow < out.targetBefore - 2;
      if (earnings && m.earnedAt != null) out.petri = (Number(earnings.get(id) ?? 0) - m.earnedAt) / 1e6;
      m.outcome = out;
      measured.push({ account, move: m });
    }
  }
  return measured;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One remembered move, in a line. */
export function moveLine(m, nameOf = (id) => `colony ${id}`) {
  const what = `gen ${m.generation} ${m.pattern}${m.target != null ? ` at ${nameOf(m.target)}` : ""}`;
  const f = m.forecast;
  const o = m.outcome;
  const parts = [];
  if (f) {
    const t = m.target != null ? f.rivals?.find((r) => r.id === m.target) : null;
    parts.push(`forecast ${f.kept}/${m.cells} in place${t ? `, ${nameOf(m.target)} ${t.delta > 0 ? "+" : ""}${t.delta}` : ""}`);
  }
  if (o) {
    // Gliders and spaceships leave the box they were planted in; for them only the target's cells tell.
    const flies = m.kind === "raid" || m.kind === "ship";
    const seen = [`after ${o.after} gens`];
    if (!flies) seen.push(`${Math.min(o.kept ?? 0, m.cells)}/${m.cells} in place`);
    if (o.mineBefore != null) seen.push(`you ${o.mineBefore}→${o.mine} cells`);
    if (o.targetBefore != null) seen.push(`${nameOf(m.target)} ${o.targetBefore}→${o.targetNow} (${o.hit ? "hit" : "no hit"})`);
    else if (flies) seen.push("target not recorded");
    parts.push(seen.join(", "));
  } else parts.push("outcome pending");
  return `${what}: ${parts.join("; ")}`;
}

/** What a strain's model sees of its own past: its recent moves and the lessons in them. */
export function memoryText(mem, account, nameOf, n = 6) {
  const moves = movesOf(mem, account);
  if (!moves.length) return "You have no moves on record yet.";
  const lines = moves.slice(-n).reverse().map((m) => `- ${moveLine(m, nameOf)}`);
  const lessons = [];
  const measured = moves.filter((m) => m.outcome && m.outcome.kept != null);
  const still = measured.filter((m) => m.kind === "grow" || m.kind === "settle" || m.kind === "wall");
  if (still.length) {
    const kept = still.reduce((a, m) => a + Math.min(m.outcome.kept, m.cells), 0);
    const planted = still.reduce((a, m) => a + m.cells, 0);
    lessons.push(`your still lifes and walls kept ${Math.round((100 * kept) / Math.max(1, planted))}% of their cells`);
  }
  const raids = moves.filter((m) => m.outcome && m.outcome.hit != null);
  if (raids.length) lessons.push(`${raids.filter((m) => m.outcome.hit).length} of your last ${plural(raids.length, "raid")} hit their target`);
  const big = measured.filter((m) => ["gun", "methuselah"].includes(m.kind) || m.cells >= 20);
  if (big.length) lessons.push(`big plays: ${big.map((m) => `${m.pattern} ${Math.min(m.outcome.kept, m.cells)}/${m.cells} in place`).join(", ")}`);
  const fc = measured.filter((m) => m.forecast && m.kind !== "raid" && m.kind !== "ship");
  if (fc.length) {
    const err = fc.reduce((a, m) => a + Math.abs(m.outcome.kept - m.forecast.kept), 0) / fc.length;
    lessons.push(`forecasts were off by ${err.toFixed(1)} cells on average (other players move too)`);
  }
  return `Your last moves (newest first):\n${lines.join("\n")}${lessons.length ? `\nLessons: ${lessons.join("; ")}.` : ""}`;
}

/** Another house strain's latest public moves and lab notes (house notes only: no player-written text). */
export function publicMovesText(mem, account, nameOf, n = 2) {
  const moves = movesOf(mem, account).slice(-n).reverse();
  if (!moves.length) return "no moves on record";
  return moves.map((m) => `gen ${m.generation} ${m.pattern}${m.target != null ? ` at ${nameOf(m.target)}` : ""}${m.note ? ` ("${m.note}")` : ""}`).join("; ");
}

// Reputation: for each pair, how often the promisor kept its word to the payer.
export function reputationOf(mem, promisor, payer = null) {
  let kept = 0;
  let broken = 0;
  for (const [k, v] of Object.entries(mem.reputation)) {
    const [p, to] = k.split("|");
    if (p !== promisor || (payer && to !== payer)) continue;
    kept += v.kept;
    broken += v.broken;
  }
  return { kept, broken };
}

export function scorePromise(mem, promisor, payer, kept) {
  const r = (mem.reputation[`${promisor}|${payer}`] ??= { kept: 0, broken: 0 });
  if (kept) r.kept++;
  else r.broken++;
}
