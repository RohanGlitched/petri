"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import type { Look } from "@/components/culture-gl";

type Props = {
  target: RefObject<CultureHandle | null>;
  width: number;
  height: number;
  cells?: Uint16Array;
  prevCells?: Uint16Array;
  changedAt: number;
  palette: Map<number, number>;
  look?: Look;
  className?: string;
  /** Tap the loupe to move the big view there. */
  onPick?: (x: number, y: number) => void;
};

function wrapDelta(a: number, b: number, n: number) {
  let d = b - a;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

// The whole dish in a small round lens, with a reticle showing where the big view is looking.
export function Loupe({ target, width, height, cells, prevCells, changedAt, palette, look = "macro", className, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const ret = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = target.current;
      const el = box.current;
      const r = ret.current;
      if (!t || !el || !r) return;
      const cam = t.camera();
      const v = t.view();
      const S = el.clientWidth;
      const f = S / (Math.max(width, height) * Math.SQRT2);
      const vw = (v.w / cam.zoom) * f;
      const vh = (v.h / cam.zoom) * f;
      const cx = S / 2 + wrapDelta(width / 2, cam.cx, width) * f;
      const cy = S / 2 + wrapDelta(height / 2, cam.cy, height) * f;
      const big = vw > S * 0.92;
      r.style.opacity = big ? "0" : "1";
      r.style.transform = `translate(${cx - vw / 2}px, ${cy - vh / 2}px)`;
      r.style.width = `${Math.max(6, vw)}px`;
      r.style.height = `${Math.max(6, vh)}px`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, width, height]);

  return (
    <div
      ref={box}
      className={className}
      style={{ position: "relative", aspectRatio: "1", borderRadius: "50%", cursor: onPick ? "crosshair" : undefined }}
      onClick={(e) => {
        if (!onPick || !box.current) return;
        const rect = box.current.getBoundingClientRect();
        const f = rect.width / (Math.max(width, height) * Math.SQRT2);
        const x = Math.round(width / 2 + (e.clientX - rect.left - rect.width / 2) / f);
        const y = Math.round(height / 2 + (e.clientY - rect.top - rect.height / 2) / f);
        onPick(((x % width) + width) % width, ((y % height) + height) % height);
      }}
    >
      <Culture width={width} height={height} cells={cells} prevCells={prevCells} changedAt={changedAt} palette={palette} look={look} round label="The whole dish" />
      <div aria-hidden="true" style={{ position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden", pointerEvents: "none" }}>
        <div
          ref={ret}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            borderRadius: 4,
            boxShadow: "0 0 0 1.5px rgba(243,233,218,0.9), 0 0 0 9999px rgba(18,10,5,0.28)",
            transition: "opacity 0.3s",
          }}
        />
      </div>
    </div>
  );
}
