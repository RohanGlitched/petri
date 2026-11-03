import type { Rules } from "@/lib/chain";

/** The launch values the live dish returns from `rules`, used only until the real view has loaded. */
export const LAUNCH: Rules = {
  width: 128,
  height: 128,
  generation_ms: "15000",
  max_supply: "1000000000000",
  feed_ppm: 20,
  keeper_bps: 200,
  burn_bps: 5000,
  plant_cost: "2000000",
  capacity: 1000,
  starter_grant: "64000000",
  buffer: 3,
  max_plant_cells: 64,
  max_catchup: 120,
};

/** The colours the explanatory dishes use (the same stains as the home page demos). */
export const DEMO = { red: 0xc8431f, green: 0x1e8c6e, violet: 0x6b2fa0, blue: 0x2364aa, plain: 0xd9b26a };

/** A duration in generations, in words. */
export function genTime(gens: number, generationMs: number): string {
  const mins = (gens * generationMs) / 60000;
  if (!isFinite(mins)) return "never";
  if (mins < 1) return "under a minute";
  if (mins < 90) return `${Math.round(mins)} min`;
  const h = mins / 60;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}
