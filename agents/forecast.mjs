// Forecasts: every candidate planting is run forward on a private copy of the live dish, with the same Rust rules the
// contract runs, so a strain chooses on what each move would do rather than on what it is called.

/** The planting's bounding box on the torus, widened by `margin`: { x, y, w, h } with x, y wrapped. */
export function boxOf(cells, w, h, margin = 2) {
  const x0 = cells[0] % w;
  const y0 = (cells[0] / w) | 0;
  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  for (const c of cells) {
    let dx = (c % w) - x0;
    let dy = ((c / w) | 0) - y0;
    if (dx > w / 2) dx -= w;
    if (dx < -w / 2) dx += w;
    if (dy > h / 2) dy -= h;
    if (dy < -h / 2) dy += h;
    minX = Math.min(minX, dx);
    maxX = Math.max(maxX, dx);
    minY = Math.min(minY, dy);
    maxY = Math.max(maxY, dy);
  }
  return {
    x: (((x0 + minX - margin) % w) + w) % w,
    y: (((y0 + minY - margin) % h) + h) % h,
    w: Math.min(w, maxX - minX + 1 + 2 * margin),
    h: Math.min(h, maxY - minY + 1 + 2 * margin),
  };
}

export function popcount(bytes) {
  let n = 0;
  for (const byte of bytes) for (let v = byte; v; v &= v - 1) n++;
  return n;
}

/** A colony's living cells inside a box on an engine. */
export function cellsInBox(engine, colony, box) {
  return popcount(engine.region_bitmap(colony, box.x, box.y, box.w, box.h));
}

const big = (s) => BigInt(s ?? "0");

/**
 * Runs each candidate `gens` generations ahead on a clone of `world.engine` and attaches `c.forecast`:
 *   mine         the strain's living cells at the end, and `vsIdle`, the same against not planting at all
 *   kept         of the cells planted, how many of its own cells are still in the planting's box at the end
 *   rivals       [{ id, delta }]: each colony's cells at the end against not planting (negative = this move cost it)
 *   petri        PETRI the strain itself would earn (house colonies are never fed, so this is 0 for them)
 *   rivalsPetri  PETRI the colonies outside the house would earn, against not planting (negative = we cut their feed)
 * Stops once `budgetMs` is spent (the agents share a small VM with the site), leaving later candidates without one.
 * Returns { gens, ms, done, skipped }.
 */
export function forecast(world, me, cands, { gens = 240, budgetMs = 2000, house = [] } = {}) {
  const t0 = Date.now();
  const houseSet = new Set(house);
  const ids = world.colonies.map((c) => c.id);
  const earnedNow = new Map(ids.map((id) => [id, big(world.engine.earned_of(id))]));

  const run = (cells) => {
    const e = world.engine.clone_engine();
    try {
      if (cells) e.plant(me, new Uint32Array(cells));
      e.step(gens);
      const counts = e.live_counts();
      const earned = new Map(ids.map((id) => [id, big(e.earned_of(id)) - earnedNow.get(id)]));
      const box = cells ? boxOf(cells, world.rules.width, world.rules.height) : null;
      return { counts, earned, kept: box ? cellsInBox(e, me, box) : 0 };
    } finally {
      e.free();
    }
  };

  const idle = run(null);
  const idleMs = Date.now() - t0;
  let done = 0;
  // On a slow moment (the baseline alone took a quarter of the budget) the strains choose without forecasts.
  if (idleMs * 4 <= budgetMs) {
    for (const c of cands) {
      if (Date.now() - t0 + idleMs > budgetMs) break;
      const r = run(c.cells);
      const mine = r.counts[me] ?? 0;
      const rivals = ids
        .filter((id) => id !== me)
        .map((id) => ({ id, delta: (r.counts[id] ?? 0) - (idle.counts[id] ?? 0) }))
        .filter((x) => x.delta !== 0)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      let rivalsPetri = 0n;
      for (const id of ids) if (id !== me && !houseSet.has(id)) rivalsPetri += r.earned.get(id) - idle.earned.get(id);
      c.forecast = {
        gens,
        mine,
        vsIdle: mine - (idle.counts[me] ?? 0),
        kept: Math.min(r.kept, c.cells.length),
        planted: c.cells.length,
        rivals: rivals.slice(0, 4),
        petri: Number(r.earned.get(me) ?? 0n) / 1e6,
        rivalsPetri: Number(rivalsPetri) / 1e6,
      };
      done++;
    }
  }
  return { gens, ms: Date.now() - t0, done, skipped: cands.length - done, idleMine: idle.counts[me] ?? 0 };
}

const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** One line a model can read: what the dish would look like `gens` generations after this planting. */
export function forecastText(f, nameOf = (id) => `colony ${id}`) {
  if (!f) return "no forecast";
  const parts = [`you ${f.mine} cells (${signed(f.vsIdle)} vs not planting)`, `${f.kept} of your cells still in place`];
  const hits = f.rivals.filter((r) => Math.abs(r.delta) >= 2).slice(0, 3);
  if (hits.length) parts.push(hits.map((r) => `${nameOf(r.id)} ${signed(r.delta)}`).join(", "));
  if (Math.abs(f.rivalsPetri) >= 0.01) parts.push(`outside players earn ${f.rivalsPetri > 0 ? "+" : ""}${f.rivalsPetri.toFixed(2)} PETRI`);
  if (f.petri >= 0.01) parts.push(`you earn ${f.petri.toFixed(2)} PETRI`);
  return `in ${f.gens} gens: ${parts.join("; ")}`;
}
