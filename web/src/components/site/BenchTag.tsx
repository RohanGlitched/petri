import { sideOfAccount } from "@/lib/sides";
import { Term } from "./Term";

/** What a bench colony is, said wherever its name appears (they are not leftovers from a test run). */
export const BENCH_LABEL = "team bench";
export const BENCH_TITLE =
  "One of three testnet colonies the Petri Dish team plays from its own testnet NEAR, by written rules. Fed and paid like any player; not a house strain.";

export function BenchTag({ account }: { account: string }) {
  // Only the bench itself: a guest (g-….petri-guests.testnet) or another team account is not "the team bench".
  if (sideOfAccount(account) !== "bench") return null;
  return (
    <Term tip={BENCH_TITLE} place="below" align="start">
      <span className="benchtag">{BENCH_LABEL}</span>
    </Term>
  );
}
