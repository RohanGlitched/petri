"use client";
// Numbers every page derives from the live dish.

import { useEffect, useMemo, useState } from "react";
import { useDish } from "./dish-store";
import { loadEngine, pattern_cells, PATTERNS, type PatternName } from "@/engine";

export function useLive() {
  const d = useDish();
  const palette = useMemo(() => {
    const m = new Map<number, number>();
    d.colonies.forEach((c) => m.set(c.id, c.color));
    return m;
  }, [d.colonies]);
  const rules = d.rules;
  const feed = rules ? (d.agar * rules.feed_ppm) / 1e6 : 0;
  const keeperShare = rules ? rules.keeper_bps / 10000 : 0;
  const perCell = d.totalLive > 0 ? (feed * (1 - keeperShare)) / d.totalLive : 0;
  const ready = d.status === "ready";
  const colonies = useMemo(
    () => d.colonies.map((c) => ({ ...c, live: d.liveCounts[c.id] ?? 0 })).sort((a, b) => b.live - a.live),
    [d.colonies, d.liveCounts],
  );
  const st = d.state;
  const supply = st ? Number(st.total_supply) : 0;
  const burned = st ? Number(st.burned) : 0;
  /** PETRI units to plant one cell right now. */
  const cellPrice = rules ? (Number(rules.plant_cost) * (rules.capacity + d.totalLive)) / rules.capacity : 0;
  return {
    d,
    rules,
    palette,
    perCell,
    feed,
    ready,
    colonies,
    supply,
    burned,
    cellPrice,
    w: rules?.width ?? 128,
    h: rules?.height ?? 128,
    secs: Math.max(0, Math.ceil(d.nextInMs / 1000)),
  };
}

/** Cell offsets of every stamp, from the same pattern table the contract tests use. */
export function usePatternOffsets() {
  const [out, setOut] = useState<Record<string, [number, number][]>>({});
  useEffect(() => {
    let live = true;
    loadEngine().then(() => {
      const m: Record<string, [number, number][]> = {};
      for (const p of PATTERNS) {
        const idx = Array.from(pattern_cells(p.name, 40, 40, 128, 128, 0, false));
        const pts = idx.map((i) => [i % 128, Math.floor(i / 128)] as [number, number]);
        const mx = Math.min(...pts.map((q) => q[0]));
        const my = Math.min(...pts.map((q) => q[1]));
        m[p.name] = pts.map(([x, y]) => [x - mx, y - my]);
      }
      if (live) setOut(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return out as Partial<Record<PatternName, [number, number][]>>;
}

export const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");
export const petri = (units: number, dp = 0) =>
  (units / 1e6).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const int = (n: number) => Math.round(n).toLocaleString("en-US");
