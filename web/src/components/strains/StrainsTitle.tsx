"use client";

import { PulseBadge, useStrainPulse } from "./StrainPulse";

/** The strains page's heading: "on a steady clock" only while they are moving; otherwise resting, said plainly. */
export function StrainsTitle({ className }: { className?: string }) {
  const { pulse } = useStrainPulse();
  return (
    <>
      <h1 className={className}>{pulse && !pulse.active ? "Five strains, resting" : "Five strains on a steady clock"}</h1>
      <PulseBadge pulse={pulse} />
    </>
  );
}
