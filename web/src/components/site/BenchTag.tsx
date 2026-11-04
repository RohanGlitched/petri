import { sideOf } from "@/lib/strains";

/** What a bench colony is, said wherever its name appears (they are not leftovers from a test run). */
export const BENCH_LABEL = "team test player · own NEAR";
export const BENCH_TITLE =
  "One of three testnet colonies the Petri team plays from its own testnet NEAR, by written rules. Fed and paid like any player; not a house strain.";

export function BenchTag({ account }: { account: string }) {
  if (sideOf(account) !== "bench") return null;
  return (
    <span className="benchtag" title={BENCH_TITLE}>
      {BENCH_LABEL}
    </span>
  );
}
