"use client";
// A small hand-drawn line chart in the site's own colours: a few series on one x axis, an optional right axis for a
// series in other units, an optional shaded range per series, and a crosshair that reads every series at the pointer.

import { useId, useMemo, useRef, useState } from "react";
import s from "./charts.module.css";

export type Series = {
  label: string;
  color: string;
  values: number[];
  /** [low, high] per point, drawn as a shaded range behind the line */
  band?: [number, number][];
  /** plot against the right axis */
  right?: boolean;
  dashed?: boolean;
};

type Props = {
  x: number[];
  series: Series[];
  /** formats the left / right axis and the readout */
  fmt: (v: number) => string;
  fmtRight?: (v: number) => string;
  fmtX: (x: number) => string;
  /** axis ceilings; by default the data's highest point, rounded up */
  maxLeft?: number;
  maxRight?: number;
  /** the left axis's floor (0 by default), for a series that moves in a narrow band far from zero */
  minLeft?: number;
  minRight?: number;
  height?: number;
  label: string;
  /** a few x ticks; by default five evenly spaced */
  ticks?: number[];
};

function nice(v: number): number {
  if (!(v > 0)) return 1;
  const e = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * e >= v) return m * e;
  return 10 * e;
}

export function LineChart({ x, series, fmt, fmtRight, fmtX, maxLeft, maxRight, minLeft = 0, minRight = 0, height = 320, label, ticks }: Props) {
  const id = useId();
  const box = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const W = 760;
  const H = height;
  const pad = { l: 68, r: series.some((x) => x.right) ? 86 : 18, t: 14, b: 34 };
  const pw = W - pad.l - pad.r;
  const ph = H - pad.t - pad.b;
  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const top = useMemo(() => {
    const hi = (right: boolean) => Math.max(0, ...series.filter((v) => !!v.right === right).flatMap((v) => [...v.values, ...(v.band ?? []).map((b) => b[1])]));
    return { l: maxLeft ?? nice(hi(false)), r: maxRight ?? nice(hi(true)) };
  }, [series, maxLeft, maxRight]);
  const px = (v: number) => pad.l + (x1 === x0 ? 0 : ((v - x0) / (x1 - x0)) * pw);
  const py = (v: number, right?: boolean) => (right ? pad.t + ph * (1 - (v - minRight) / Math.max(1e-12, top.r - minRight)) : pad.t + ph * (1 - (v - minLeft) / Math.max(1e-12, top.l - minLeft)));
  const path = (vals: number[], right?: boolean) => vals.map((v, i) => `${i ? "L" : "M"}${px(x[i]).toFixed(1)},${py(v, right).toFixed(1)}`).join("");
  const area = (band: [number, number][], right?: boolean) =>
    band.map((b, i) => `${i ? "L" : "M"}${px(x[i]).toFixed(1)},${py(b[1], right).toFixed(1)}`).join("") +
    [...band].reverse().map((b, j) => `L${px(x[band.length - 1 - j]).toFixed(1)},${py(b[0], right).toFixed(1)}`).join("") +
    "Z";
  const xt = ticks ?? [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + f * (x1 - x0));
  const move = (e: React.PointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || x.length === 0) return;
    const sx = ((e.clientX - r.left) / r.width) * W;
    const v = x0 + ((sx - pad.l) / pw) * (x1 - x0);
    let best = 0;
    for (let i = 1; i < x.length; i++) if (Math.abs(x[i] - v) < Math.abs(x[best] - v)) best = i;
    setHover(best);
  };
  return (
    <figure className={s.chart}>
      <svg ref={box} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect x={pad.l} y={pad.t - 2} width={pw} height={ph + 4} />
          </clipPath>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={pad.t + ph * (1 - f)} y2={pad.t + ph * (1 - f)} className={s.grid} />
            <text x={pad.l - 8} y={pad.t + ph * (1 - f) + 4} className={s.axis} textAnchor="end">
              {fmt(minLeft + (top.l - minLeft) * f)}
            </text>
            {series.some((v) => v.right) && (
              <text x={W - pad.r + 8} y={pad.t + ph * (1 - f) + 4} className={s.axisR} textAnchor="start">
                {(fmtRight ?? fmt)(minRight + (top.r - minRight) * f)}
              </text>
            )}
          </g>
        ))}
        {xt.map((t) => (
          <text key={t} x={px(t)} y={H - 10} className={s.axis} textAnchor="middle">
            {fmtX(t)}
          </text>
        ))}
        <g clipPath={`url(#${id}-clip)`}>
          {series.map((v) => v.band && <path key={`${v.label}-b`} d={area(v.band, v.right)} fill={v.color} opacity={0.16} />)}
          {series.map((v) => (
            <path key={v.label} d={path(v.values, v.right)} fill="none" stroke={v.color} strokeWidth={2} strokeDasharray={v.dashed ? "5 4" : undefined} strokeLinejoin="round" />
          ))}
        </g>
        {hover !== null && (
          <g>
            <line x1={px(x[hover])} x2={px(x[hover])} y1={pad.t} y2={pad.t + ph} className={s.cross} />
            {series.map((v) => (
              <circle key={v.label} cx={px(x[hover])} cy={py(v.values[hover] ?? 0, v.right)} r={3.5} fill={v.color} />
            ))}
          </g>
        )}
      </svg>
      <figcaption className={s.legend}>
        {hover !== null && <span className={s.at}>{fmtX(x[hover])}</span>}
        {series.map((v) => (
          <span key={v.label} className={s.key}>
            <i style={{ background: v.color }} aria-hidden="true" />
            {v.label}
            {hover !== null && <b className="num">{(v.right ? fmtRight ?? fmt : fmt)(v.values[hover] ?? 0)}</b>}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
