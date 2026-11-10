"use client";

import { useLive, int } from "@/lib/live";
import s from "./warmup.module.css";
import { Term } from "./Term";

// A young dish: the agar releases its ration for at least `live_floor` counted cells, so until that many are alive part
// of each ration stays in the agar. Each cell still earns the full per-cell rate; this shows how far the dish has to go.
export function WarmUp({ tone = "dark", className = "" }: { tone?: "dark" | "paper"; className?: string }) {
  const { d, rules, ready, warming } = useLive();
  if (!rules || !ready || !warming) return null;
  const floor = rules.live_floor;
  const pct = Math.min(100, (100 * d.counted) / floor);
  return (
    <div className={`${s.warm} ${tone === "paper" ? s.paper : ""} ${className}`} role="status">
      {/* Below the floor the agar releases that fraction of its ration, so with no player cell counted nothing is fed. */}
      <p className={s.line}>
        {d.counted === 0 ? (
          <>
            <span className={s.tag}>Not feeding yet</span> Feeding starts with the first player cell and is full at {int(floor)}{" "}
            <Term k="counted" place="below">counted cells</Term>:{" "}
          </>
        ) : (
          <>
            <span className={s.tag}>Warming up</span> <Term k="feeding" place="below">Feeding at {Math.max(1, Math.floor(pct))}%</Term> until {int(floor)}{" "}
            <Term k="counted" place="below">cells are counted</Term>:{" "}
          </>
        )}
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
