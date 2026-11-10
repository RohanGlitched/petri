"use client";
// The live dish's side of the delight features: it hands each new generation to the soundscape and keeps the last
// generations this tab has watched, for a time-lapse of what just happened. The store already makes a fresh board
// array every generation, so keeping them costs references, not copies.

import { useEffect, useMemo, useRef } from "react";
import { useDish } from "@/lib/dish-store";
import { feedGeneration, onSoundStart } from "./sound-store";

export type Watched = { generation: number; cells: Uint16Array };

const KEEP = 240;
const watched: Watched[] = [];

/** The generations this tab has watched in a row, oldest first (a jump, e.g. after a sleeping tab, starts it again). */
export function watchedGenerations(): Watched[] {
  return watched;
}

function keep(generation: number, cells: Uint16Array) {
  const last = watched[watched.length - 1];
  if (last && last.generation === generation) return;
  if (last && generation !== last.generation + 1) watched.length = 0;
  watched.push({ generation, cells });
  if (watched.length > KEEP) watched.splice(0, watched.length - KEEP);
}

/** Feed the live dish to the soundscape and the watch history. `ear` says where the listener is looking. */
export function useLiveFeed(opts: { mine?: number | null; ear?: () => number | undefined } = {}) {
  const d = useDish();
  const colors = useMemo(() => {
    const m = new Map<number, number>();
    d.colonies.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [d.colonies]);
  const w = d.rules?.width ?? 128;
  const h = d.rules?.height ?? 128;
  const sing = useRef(() => {});
  sing.current = () => {
    if (d.status !== "ready" || !d.cells || !d.prevCells || !d.rules) return;
    feedGeneration("live", d.prevCells, d.cells, d.generation, {
      colors,
      mine: opts.mine ?? null,
      w,
      h,
      barSec: Number(d.rules.generation_ms) / 1000,
      tideEvery: d.rules.tide_every,
      ear: opts.ear?.(),
    });
  };
  useEffect(() => onSoundStart(() => sing.current()), []);
  useEffect(() => {
    if (d.status !== "ready" || !d.cells) return;
    keep(d.generation, d.cells);
    sing.current();
  }, [d.generation, d.cells, d.status]);
}
