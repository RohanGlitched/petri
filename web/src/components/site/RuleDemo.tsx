"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Culture } from "@/components/Culture";
import { Engine, loadEngine, pattern_cells, type PatternName } from "@/engine";

/** A scripted planting: a named pattern, or raw (dx, dy) offsets from (x, y). */
export type Seed = { colony: number; x: number; y: number; rotate?: number; flip?: boolean } & (
  | { pattern: PatternName; cells?: undefined }
  | { cells: [number, number][]; pattern?: undefined }
);

function seedCells(s: Seed, width: number, height: number): Uint32Array {
  if (s.cells) {
    const wrap = (v: number, n: number) => ((v % n) + n) % n;
    return Uint32Array.from(s.cells.map(([dx, dy]) => wrap(s.y + dy, height) * width + wrap(s.x + dx, width)));
  }
  return pattern_cells(s.pattern, s.x, s.y, width, height, s.rotate ?? 0, s.flip ?? false);
}

type Props = {
  width: number;
  height: number;
  seeds: Seed[];
  /** Restart from the seeds after this many generations. */
  loop: number;
  colors: Record<number, number>;
  /** Paint each rival's no-planting zone (the buffer) for this colony. */
  bufferFor?: { colony: number; radius: number };
  /** A planting that the rules refuse, shown as a red ghost. */
  refused?: Seed;
  stepMs?: number;
  /** With reduced motion the dish does not animate; show this generation instead of the seeds. */
  stillAt?: number;
  label: string;
  /** Called after every generation with live cells per colony and the births contested in that generation. */
  onGeneration?: (g: number, counts: number[], contested: number) => void;
};

// A small dish running the real petri-core rules (the same WASM the big dish uses), seeded with a scripted scene.
export function RuleDemo({ width, height, seeds, loop, colors, bufferFor, refused, stepMs = 320, stillAt, label, onGeneration }: Props) {
  const [frame, setFrame] = useState<{ cells: Uint16Array; prev: Uint16Array; at: number } | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const cb = useRef(onGeneration);
  cb.current = onGeneration;
  const palette = useMemo(() => new Map(Object.entries(colors).map(([k, v]) => [Number(k), v])), [colors]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let visible = false;
    let stopped = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const reset = () => {
      engineRef.current?.free();
      const e = new Engine(width, height, 0, 0, 10_000, 0);
      e.set_colonies(Math.max(...seeds.map((s) => s.colony)));
      for (const s of seeds) e.plant(s.colony, seedCells(s, width, height));
      engineRef.current = e;
      const c = e.cells();
      setFrame({ cells: c, prev: c, at: performance.now() });
      cb.current?.(0, Array.from(e.live_counts()), 0);
    };
    const tick = () => {
      const e = engineRef.current;
      if (!e || !visible) return;
      if (e.generation() >= loop) return reset();
      const prev = e.cells();
      e.step(1);
      setFrame({ cells: e.cells(), prev, at: performance.now() });
      cb.current?.(e.generation(), Array.from(e.live_counts()), e.last_contested());
    };

    loadEngine().then(() => {
      if (stopped) return;
      reset();
      if (!reduce) timer = setInterval(tick, stepMs);
      else if (stillAt && engineRef.current) {
        const e = engineRef.current;
        e.step(stillAt);
        const c = e.cells();
        setFrame({ cells: c, prev: c, at: performance.now() });
        cb.current?.(e.generation(), Array.from(e.live_counts()), e.last_contested());
      }
    });
    const io = new IntersectionObserver(([en]) => (visible = en.isIntersecting), { threshold: 0.2 });
    if (box.current) io.observe(box.current);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      io.disconnect();
      engineRef.current?.free();
      engineRef.current = null;
    };
    // The scene is fixed for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlay = useMemo(() => {
    if (!frame || (!bufferFor && !refused)) return undefined;
    const o = new Uint8Array(width * height);
    if (bufferFor) {
      const r = bufferFor.radius;
      for (let i = 0; i < frame.cells.length; i++) {
        const c = frame.cells[i];
        if (c === 0 || c === bufferFor.colony) continue;
        const x = i % width;
        const y = (i / width) | 0;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) o[((y + dy + height) % height) * width + ((x + dx + width) % width)] = 3;
      }
    }
    if (refused) for (const i of seedCells(refused, width, height)) o[i] = 2;
    return o;
  }, [frame, bufferFor, refused, width, height]);

  return (
    <div ref={box} style={{ width: "100%", height: "100%" }}>
      <Culture
        width={width}
        height={height}
        cells={frame?.cells}
        prevCells={frame?.prev}
        changedAt={frame?.at ?? 0}
        palette={palette}
        look="macro"
        fit="cover"
        overlay={overlay}
        transitionMs={Math.min(stepMs * 0.9, 600)}
        maxDpr={1.5}
        label={label}
      />
    </div>
  );
}
