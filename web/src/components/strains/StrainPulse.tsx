"use client";

import { useMemo } from "react";
import { agoText, strainPulse, useStrainLog } from "@/lib/strain-log";
import { strainsOn } from "@/lib/strains";
import { useNet } from "@/lib/use-net";

/**
 * The strains' heading, honest about the clock: "around the clock" only while the newest strain move is under six
 * hours old; otherwise the heading says they are resting and when they last moved. A quiet badge says the same.
 */
export function useStrainPulse() {
  const log = useStrainLog();
  const net = useNet();
  const accounts = useMemo(() => strainsOn(net.network).map((s) => s.account), [net.network]);
  return { pulse: strainPulse(log, accounts), log };
}

export function PulseBadge({ pulse, className }: { pulse: ReturnType<typeof strainPulse>; className?: string }) {
  if (!pulse) return null;
  const when = pulse.ageMs === null ? "" : ` · last move ${agoText(pulse.ageMs)}`;
  return (
    <span className={`pulse-badge ${pulse.active ? "is-live" : "is-resting"} ${className ?? ""}`} role="status">
      <i aria-hidden="true" />
      {pulse.active ? "Playing now" : "Resting"}{when}
    </span>
  );
}
