// The AI strains that play the dish around the clock (agents/run.mjs runs them). Kept in step with that file.
// On testnet the strains are petri-<name>.testnet; on mainnet they are <name>.petri-dish.near and attach their own NEAR.

import type { Network } from "./config";

type StrainDef = { short: string; name: string; temperament: string; voice: string; plays: string };
export type Strain = StrainDef & { account: string };

const DEFS: StrainDef[] = [
  {
    short: "violet",
    name: "Crystal Violet",
    temperament: "Gardener",
    voice: "Patient and orderly. Grows tidy gardens of still lifes and walls them off from raiders.",
    plays: "Blocks, beehives and loaves near home; a pulsar when it can afford one; eaters towards the nearest rival.",
  },
  {
    short: "safranin",
    name: "Safranin",
    temperament: "Raider",
    voice: "Bold and hungry. Sends gliders at whoever has grown fattest, and enjoys it.",
    plays: "Gliders aimed at the richest colony, then the nearest; a glider gun once it has saved enough.",
  },
  {
    short: "methylene",
    name: "Methylene Blue",
    temperament: "Engineer",
    voice: "Careful and technical. Builds eaters to absorb attacks and guns when it can afford them.",
    plays: "Eaters facing the nearest rival first, then a gun, then steady still lifes.",
  },
  {
    short: "malachite",
    name: "Malachite Green",
    temperament: "Wanderer",
    voice: "Curious and restless. Settles fresh agar far from everyone before it gets crowded.",
    plays: "New outposts in the emptiest agar it can find, so no single raid can reach all of it.",
  },
  {
    short: "congo",
    name: "Congo Red",
    temperament: "Chaos",
    voice: "Mischievous. Seeds small chaos and watches what the dish does with it.",
    plays: "R-pentominoes and blinkers in quiet agar, the odd glider at its neighbour.",
  },
];

const accountOn = (short: string, net: Network) => (net === "mainnet" ? `${short}.petri-dish.near` : `petri-${short}.testnet`);

/** The five strains with their accounts on `net`. */
export function strainsOn(net: Network): Strain[] {
  return DEFS.map((d) => ({ ...d, account: accountOn(d.short, net) }));
}

/** The project's keeper on `net`. */
export const keeperOn = (net: Network) => accountOn("keeper", net);

/** The models the strains can think with (agents/model.mjs): NEAR AI Cloud first (TEE-verified), Claude Haiku second. */
export const CLAUDE_MODEL = "claude-haiku-5-5";
export const NEARAI_MODEL = "z-ai/glm-5.3-flash";

const ALL = [...strainsOn("testnet"), ...strainsOn("mainnet")];

/** The strain an account belongs to, on either network. */
export function strainOf(account: string) {
  return ALL.find((s) => s.account === account) ?? null;
}

/** The bench: colonies the team plays from its own NEAR, outside the house (agents/run.mjs): three testnet colonies,
 * and on each network the implicit account that minted and holds the v2 living slides. */
export const BENCH_ACCOUNTS = [
  "petri-bench-a.testnet",
  "petri-bench-b.testnet",
  "petri-bench-c.testnet",
  "9e0f14b0b58c9760dd95af218cdd98a4417cd37d316e01cbff178d41ac5b7c5e",
  "58135f2e727a40755df38f1d231aca159ea4ab138260b8d0d9419da63f999932",
  // The team's testnet rehearsal of mainnet free play (10 Nov): guests made by its rehearsal relayer.
  "3e5504718e82cf2345f90b104be8164084f63d66c1c8e5a6c22d6c41188e6099",
  "6e82be87443737e311a1f8f5439793512b44486ffc8f8533f6ed3aeb95c8a938",
  "1295a926f71804ce1c712fadc641db8a59017e677cb703424d6a398f8274296e",
];

/** Who an account plays for: the house strains, the team (its bench, and any account it made: every petri-*.testnet
 * account and its sub-accounts, every *.petri-dish.near, which includes today's living-slide purses), or an outside
 * player. A purse later sold to someone else would still count as the team's, which only ever understates outside play. */
export function sideOf(account: string, house = false): "house" | "bench" | "player" {
  if (house || strainOf(account)) return "house";
  if (BENCH_ACCOUNTS.includes(account)) return "bench";
  // A guest lives under petri-guests.testnet but is a key in anyone's browser: a player, never the team's.
  if (/^g-[0-9a-f]{10}\.petri-guests\.testnet$/.test(account)) return "player";
  if (/(^|\.)petri-[a-z0-9-]+\.testnet$/.test(account) || account === "petri-dish.near" || account.endsWith(".petri-dish.near")) return "bench";
  return "player";
}
