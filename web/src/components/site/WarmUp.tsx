"use client";

import { useLive, int } from "@/lib/live";
import s from "./warmup.module.css";
import { Term } from "./Term";

// A young dish: the agar releases its ration for at least `live_floor` counted cells, so until that many are alive part
// of each ration stays in the agar. Each cell still earns the full per-cell rate; this shows how far the dish has to go.
export function WarmUp({ tone = "dark", className = "", compact = false }: { tone?: "dark" | "paper"; className?: string; compact?: boolean }) {
  const { d, rules, ready, warming } = useLive();
  // Shown once the first player cell is counted; before that there is no feeding share to report.
  if (!rules || !ready || !warming || d.counted === 0) return null;
  const floor = rules.live_floor;
  const pct = Math.min(100, (100 * d.counted) / floor);
  if (compact) {
    // One short line over the dish; the explanation waits behind a hover (or a tap on the term).
    const note = `Below ${int(floor)} counted cells the agar releases that share of its ration; each cell still earns the full per-cell rate.`;
    return (
      <p className={`${s.mini} ${className}`} role="status" title={note}>
        <span className={s.tag}>Young dish</span>
        <Term k="feeding" place="below">
          feeding at <b className="num">{Math.max(1, Math.floor(pct))}%</b>
        </Term>
        <span className={s.miniTrack} aria-hidden="true">
          <i style={{ width: `${pct}%` }} />
        </span>
      </p>
    );
  }
  return (
    <div className={`${s.warm} ${tone === "paper" ? s.paper : ""} ${className}`} role="status">
      {/* Below the floor the agar releases that fraction of its ration, so with no player cell counted nothing is fed. */}
      <p className={s.line}>
        <span className={s.tag}>Young dish</span> <Term k="feeding" place="below">Feeding at {Math.max(1, Math.floor(pct))}%</Term> until {int(floor)}{" "}
        <Term k="counted" place="below">cells are counted</Term>:{" "}
        <b className="num">
          {int(d.counted)}&nbsp;/&nbsp;{int(floor)}
        </b>
      </p>
      <span className={s.track} aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
