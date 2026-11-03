"use client";

import { useId, useMemo } from "react";

// A pattern drawn as a little group of glossy colonies, the way it would sit on the agar.
export function Specimen({ offsets, color = "#f2b45a", size = 56 }: { offsets?: [number, number][]; color?: string; size?: number }) {
  const id = useId().replace(/:/g, "");
  const box = useMemo(() => {
    if (!offsets || offsets.length === 0) return { w: 3, h: 3 };
    return { w: Math.max(...offsets.map((o) => o[0])) + 1, h: Math.max(...offsets.map((o) => o[1])) + 1 };
  }, [offsets]);
  const n = Math.max(box.w, box.h, 4);
  const cell = size / (n + 1);
  const ox = (size - box.w * cell) / 2;
  const oy = (size - box.h * cell) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <defs>
        <radialGradient id={`g${id}`} cx="34%" cy="30%" r="78%">
          <stop offset="0" stopColor="#fff" stopOpacity="0.75" />
          <stop offset="0.28" stopColor={color} />
          <stop offset="1" stopColor={color} stopOpacity="0.72" />
        </radialGradient>
      </defs>
      {offsets?.map(([x, y], i) => (
        <circle key={i} cx={ox + (x + 0.5) * cell} cy={oy + (y + 0.5) * cell} r={cell * 0.46} fill={`url(#g${id})`} />
      ))}
    </svg>
  );
}
