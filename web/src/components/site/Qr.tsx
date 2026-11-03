"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** A QR code drawn as one SVG path: dark modules on bone, with the quiet zone scanners need. */
export function Qr({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const { n, d } = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { n, d };
  }, [text]);
  const box = n + 8;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={box} height={box} rx="2" fill="#f3e9da" />
      <path d={d} fill="#1d1208" />
    </svg>
  );
}
