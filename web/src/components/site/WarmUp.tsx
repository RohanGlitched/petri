"use client";

import { useLive, int } from "@/lib/live";
import s from "./warmup.module.css";

// A young dish: the agar releases its ration for at least `live_floor` counted cells, so until that many are alive part
// of each ration stays in the agar. Each cell still earns the full per-cell rate; this shows how far the dish has to go.
export function WarmUp({ tone = "dark", className = "" }: { tone?: "dark" | "paper"; className?: string }) {
  const { d, rules, ready, warming } = useLive();
  if (!rules || !ready || !warming) return null;
  const floor = rules.live_floor;
  const pct = Math.min(100, (100 * d.counted) / floor);
  return (
    <div className={`${s.warm} ${tone === "paper" ? s.paper : ""} ${className}`} role="status">
      <p className={s.line}>
        <span className={s.tag}>Warming up</span> Feed pays in full from {int(floor)} counted cells:{" "}
        <b className="num">
          {int(d.counted)} / {int(floor)}
        </b>
      </p>
      <span className={s.track} aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
