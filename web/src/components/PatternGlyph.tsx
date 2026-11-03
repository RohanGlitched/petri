"use client";

import { useMemo } from "react";

// A small drawing of a pattern's cells, as a specimen label would show it.
export function PatternGlyph({
  offsets,
  color = "currentColor",
  size = 44,
}: {
  offsets: [number, number][];
  color?: string;
  size?: number;
}) {
  const { w, h } = useMemo(() => {
    const xs = offsets.map((o) => o[0]);
    const ys = offsets.map((o) => o[1]);
    return { w: Math.max(...xs) + 1, h: Math.max(...ys) + 1 };
  }, [offsets]);
  const n = Math.max(w, h, 3);
  const cell = size / (n + 1);
  const ox = (size - w * cell) / 2;
  const oy = (size - h * cell) / 2;
  const gap = Math.min(0.6, cell * 0.12);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {offsets.map(([x, y], i) => (
        <rect key={i} x={ox + x * cell + gap} y={oy + y * cell + gap} width={cell - 2 * gap} height={cell - 2 * gap} rx={cell * 0.35} fill={color} />
      ))}
    </svg>
  );
}
