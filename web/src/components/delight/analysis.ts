// What happened on the dish in one generation, read from the board before and after it: who was born and who died
// (and where), where colonies are touching and losing cells to each other, which colony grew fastest, and which small
// travelling shapes (gliders) are crossing open agar. The soundscape turns this into notes; the cinema camera turns it
// into shots. One pass over 128 x 128 cells plus a flood fill: well under a millisecond, once per generation.

export type ColonyMoment = {
  id: number;
  births: number;
  deaths: number;
  live: number;
  /** Circular (torus) mean of the colony's living cells, in cells. */
  cx: number;
  cy: number;
  /** Mean x of this generation's births and deaths, for stereo position (NaN when there were none). */
  bornX: number;
  diedX: number;
  /** Mean y of the same, for the camera. */
  bornY: number;
  /** The middle of the colony's densest 16 x 16 patch: where its cells actually are (a centroid can fall in empty
   * agar between two outposts). */
  ax: number;
  ay: number;
};

export type Clash = { x: number; y: number; n: number; a: number; b: number };
export type Glider = { id: number; x: number; y: number };

export type GenReport = {
  generation: number;
  births: number;
  deaths: number;
  live: number;
  colonies: Map<number, ColonyMoment>;
  /** Cells lost this generation where two colonies touch, in total. */
  clashCells: number;
  /** The busiest meeting point of two colonies (the 16 x 16 block with the most such losses). */
  clash: Clash | null;
  /** The block with the most change of any kind. */
  busy: { x: number; y: number; n: number } | null;
  gliders: Glider[];
};

const TAU = Math.PI * 2;

/** Circular mean of positions on a ring of length `n`. */
function ringMean(sin: number, cos: number, n: number) {
  if (sin === 0 && cos === 0) return NaN;
  const a = Math.atan2(sin, cos);
  return (((a / TAU) * n) % n + n) % n;
}

export function analyze(prev: Uint16Array, now: Uint16Array, w: number, h: number, generation: number): GenReport {
  const B = 16;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const blockClash = new Float32Array(bw * bh);
  const blockBusy = new Float32Array(bw * bh);
  const blockPair = new Map<number, Map<number, number>>();
  type Acc = { births: number; deaths: number; live: number; sx: number; cx: number; sy: number; cy: number; bx: number; bn: number; dx: number; dn: number; by: number; blk: Map<number, [number, number, number]> };
  const acc = new Map<number, Acc>();
  const get = (id: number) => {
    let a = acc.get(id);
    if (!a) {
      a = { births: 0, deaths: 0, live: 0, sx: 0, cx: 0, sy: 0, cy: 0, bx: 0, bn: 0, dx: 0, dn: 0, by: 0, blk: new Map() };
      acc.set(id, a);
    }
    return a;
  };
  // Trig tables, so the circular means cost a lookup per cell.
  const sxT = new Float32Array(w);
  const cxT = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    sxT[x] = Math.sin((x / w) * TAU);
    cxT[x] = Math.cos((x / w) * TAU);
  }
  const syT = new Float32Array(h);
  const cyT = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    syT[y] = Math.sin((y / h) * TAU);
    cyT[y] = Math.cos((y / h) * TAU);
  }
  let births = 0;
  let deaths = 0;
  let live = 0;
  let clashCells = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    const by = Math.floor(y / B) * bw;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const n = now[i];
      const p = prev[i];
      if (n) {
        live++;
        const a = get(n);
        a.live++;
        a.sx += sxT[x];
        a.cx += cxT[x];
        a.sy += syT[y];
        a.cy += cyT[y];
        const bk = by + Math.floor(x / B);
        const t = a.blk.get(bk);
        if (t) {
          t[0]++;
          t[1] += x;
          t[2] += y;
        } else a.blk.set(bk, [1, x, y]);
      }
      if (n === p) continue;
      const blk = by + Math.floor(x / B);
      blockBusy[blk]++;
      if (n && !p) {
        births++;
        const a = get(n);
        a.births++;
        a.bx += x;
        a.bn++;
        a.by += y;
      }
      if (p && n !== p) {
        deaths++;
        const a = get(p);
        a.deaths++;
        a.dx += x;
        a.dn++;
        // A loss where another colony stood next to it: two colonies touching.
        let rival = 0;
        for (let dy = -1; dy <= 1 && !rival; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const q = prev[((y + dy + h) % h) * w + ((x + dx + w) % w)];
            if (q && q !== p) {
              rival = q;
              break;
            }
          }
        if (rival) {
          clashCells++;
          blockClash[blk]++;
          const key = p < rival ? p * 65536 + rival : rival * 65536 + p;
          let m = blockPair.get(blk);
          if (!m) blockPair.set(blk, (m = new Map()));
          m.set(key, (m.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const colonies = new Map<number, ColonyMoment>();
  acc.forEach((a, id) => {
    let best: [number, number, number] | null = null;
    a.blk.forEach((t) => {
      if (!best || t[0] > best[0]) best = t;
    });
    const b = best as [number, number, number] | null;
    colonies.set(id, {
      ax: b ? b[1] / b[0] : NaN,
      ay: b ? b[2] / b[0] : NaN,
      id,
      births: a.births,
      deaths: a.deaths,
      live: a.live,
      cx: a.live ? ringMean(a.sx, a.cx, w) : NaN,
      cy: a.live ? ringMean(a.sy, a.cy, h) : NaN,
      bornX: a.bn ? a.bx / a.bn : NaN,
      diedX: a.dn ? a.dx / a.dn : NaN,
      bornY: a.bn ? a.by / a.bn : NaN,
    });
  });
  let clash: Clash | null = null;
  let busy: GenReport["busy"] = null;
  for (let k = 0; k < blockClash.length; k++) {
    const x = (k % bw) * B + B / 2;
    const y = Math.floor(k / bw) * B + B / 2;
    if (blockClash[k] > (clash?.n ?? 0)) {
      let best = 0;
      let pair = 0;
      blockPair.get(k)?.forEach((v, key) => {
        if (v > best) {
          best = v;
          pair = key;
        }
      });
      clash = { x, y, n: blockClash[k], a: Math.floor(pair / 65536), b: pair % 65536 };
    }
    if (blockBusy[k] > (busy?.n ?? 0)) busy = { x, y, n: blockBusy[k] };
  }
  return { generation, births, deaths, live, colonies, clashCells, clash, busy, gliders: findGliders(prev, now, w, h) };
}

/**
 * Small travelling shapes: a five-cell, single-colony group inside a 3 x 3 box with nothing else within two cells is a
 * glider in one of its four phases (every glider phase is five cells in a 3 x 3 box). The boat, a still life, is too;
 * it is told apart by not changing between generations.
 */
function findGliders(prev: Uint16Array, cells: Uint16Array, w: number, h: number): Glider[] {
  const seen = new Uint8Array(w * h);
  const out: Glider[] = [];
  const stack: number[] = [];
  for (let i = 0; i < cells.length && out.length < 24; i++) {
    if (!cells[i] || seen[i]) continue;
    const id = cells[i];
    // Flood fill over the 8-neighbourhood, giving up past six cells.
    const members: number[] = [];
    let mixed = false;
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      members.push(j);
      if (members.length > 6) break;
      const x = j % w;
      const y = (j - x) / w;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const k = ((y + dy + h) % h) * w + ((x + dx + w) % w);
          if (cells[k] && !seen[k]) {
            seen[k] = 1;
            if (cells[k] !== id) mixed = true;
            stack.push(k);
          }
        }
    }
    if (mixed || members.length !== 5 || stack.length) {
      // Mark the rest of a big group as seen so it is not walked again cell by cell.
      while (stack.length) {
        const j = stack.pop()!;
        const x = j % w;
        const y = (j - x) / w;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const k = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            if (cells[k] && !seen[k]) {
              seen[k] = 1;
              stack.push(k);
            }
          }
      }
      continue;
    }
    // Bounding box on the torus: unwrap around the first member.
    const x0 = members[0] % w;
    const y0 = Math.floor(members[0] / w);
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (const j of members) {
      let dx = (j % w) - x0;
      let dy = Math.floor(j / w) - y0;
      if (dx > w / 2) dx -= w;
      if (dx < -w / 2) dx += w;
      if (dy > h / 2) dy -= h;
      if (dy < -h / 2) dy += h;
      minX = Math.min(minX, dx);
      maxX = Math.max(maxX, dx);
      minY = Math.min(minY, dy);
      maxY = Math.max(maxY, dy);
    }
    if (maxX - minX !== 2 || maxY - minY !== 2) continue;
    // Nothing else within two cells of the box: in flight, not part of a garden.
    let lonely = true;
    for (let dy = minY - 2; dy <= maxY + 2 && lonely; dy++)
      for (let dx = minX - 2; dx <= maxX + 2; dx++) {
        if (dx >= minX && dx <= maxX && dy >= minY && dy <= maxY) continue;
        if (cells[((y0 + dy + h * 2) % h) * w + ((x0 + dx + w * 2) % w)]) {
          lonely = false;
          break;
        }
      }
    if (!lonely) continue;
    // Every glider phase has births: five cells that were all alive a generation ago are a still life (a boat).
    if (members.every((j) => prev[j] === id)) continue;
    out.push({ id, x: (x0 + (minX + maxX) / 2 + w) % w, y: (y0 + (minY + maxY) / 2 + h) % h });
  }
  return out;
}

/** Shortest signed distance from a to b on a ring of length n. */
export function ringDelta(a: number, b: number, n: number) {
  return ((((b - a) % n) + n * 1.5) % n) - n / 2;
}
