// Who an account plays for, as honestly as the chain allows. The house (five strains and their keeper), the team's
// bench, and other accounts the team made (every petri-*.testnet account and its sub-accounts, every *.petri-dish.near)
// are the team's. A guest (g-….petri-guests.testnet) is a key in someone's browser: anyone's, the team's own test runs
// included, and the chain cannot tell which. Any other account is an outside player.

import { BENCH_ACCOUNTS, strainOf } from "./strains";

export type Side = "house" | "bench" | "team" | "guest" | "outside";

export function sideOfAccount(a: string, house = false): Side {
  if (house || strainOf(a) || a === "petri-keeper.testnet" || a === "keeper.petri-dish.near") return "house";
  if (BENCH_ACCOUNTS.includes(a)) return "bench";
  if (/^g-[0-9a-f]{10}\.petri-guests\.testnet$/.test(a)) return "guest";
  if (/(^|\.)petri-[a-z0-9-]+\.testnet$/.test(a) || a === "petri-dish.near" || a.endsWith(".petri-dish.near")) return "team";
  return "outside";
}

export const SIDE_LABEL: Record<Side, string> = {
  house: "house",
  bench: "team bench",
  team: "team account",
  guest: "guest, anyone's browser",
  outside: "outside player",
};
