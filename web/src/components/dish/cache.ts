// The dish as this browser last saw it, so the play page can draw a board and its numbers at once while the live dish
// is read from NEAR. Stored per network in localStorage; any storage error just means there is no cached dish.

export type DishCache = {
  generation: number;
  at: number;
  w: number;
  h: number;
  cells: Uint16Array;
  colors: [number, number][];
  totalLive: number;
  agar: number;
  perCell: number;
};

type Stored = Omit<DishCache, "cells"> & { v: 1; rle: number[] };

const key = (net: string) => `petri.dish-cache.v1.${net}`;

/** Run-length pairs [owner, run, owner, run, …]: a mostly empty dish packs into a few kilobytes. */
function pack(cells: Uint16Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < cells.length) {
    const v = cells[i];
    let j = i + 1;
    while (j < cells.length && cells[j] === v) j++;
    out.push(v, j - i);
    i = j;
  }
  return out;
}

function unpack(rle: number[], n: number): Uint16Array | null {
  const out = new Uint16Array(n);
  let i = 0;
  for (let k = 0; k + 1 < rle.length; k += 2) {
    const run = rle[k + 1];
    if (i + run > n) return null;
    out.fill(rle[k], i, i + run);
    i += run;
  }
  return i === n ? out : null;
}

export function readDishCache(net: string): DishCache | null {
  try {
    const raw = localStorage.getItem(key(net));
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (s.v !== 1 || !Array.isArray(s.rle)) return null;
    const cells = unpack(s.rle, s.w * s.h);
    if (!cells) return null;
    return { generation: s.generation, at: s.at, w: s.w, h: s.h, cells, colors: s.colors ?? [], totalLive: s.totalLive, agar: s.agar, perCell: s.perCell };
  } catch {
    return null;
  }
}

export function writeDishCache(net: string, c: DishCache) {
  try {
    const { cells, ...rest } = c;
    const s: Stored = { v: 1, ...rest, rle: pack(cells) };
    localStorage.setItem(key(net), JSON.stringify(s));
  } catch {
    /* storage full or blocked: the next visit reads the dish from NEAR as before */
  }
}
