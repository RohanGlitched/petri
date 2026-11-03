import type { Rules } from "@/lib/chain";

/** The launch values the live dish (petri-v3.testnet) returns from `rules`, used only until the real view has loaded. */
export const LAUNCH: Rules = {
  width: 128,
  height: 128,
  generation_ms: "15000",
  max_supply: "1000000000000",
  feed_ppm: 10,
  keeper_bps: 200,
  reach: 4,
  burn_bps: 5000,
  payback: 480,
  min_cell_price: "500000",
  live_floor: 1000,
  petri_price: "200000000000000000000",
  min_join: "10000000000000000000000",
  cell_fee: "100000000000000000000",
  tide_every: 240,
  tide_bps: 1000,
  tide_bounty_bps: 100,
  max_bounty: "1000000000000000000000",
  sell_bps: 5000,
  sell_cap_bps: 1000,
  siege_x: 3,
  buffer: 3,
  max_plant_cells: 64,
  max_catchup: 120,
  house: ["petri-violet.testnet", "petri-safranin.testnet", "petri-methylene.testnet", "petri-malachite.testnet", "petri-congo.testnet"],
};

/** The colours the explanatory dishes use (the same stains as the home page demos). */
export const DEMO = { red: 0xc8431f, green: 0x1e8c6e, violet: 0x6b2fa0, blue: 0x2364aa, plain: 0xd9b26a };

/** yoctoNEAR in one NEAR, as a bigint. */
export const YOCTO = 10n ** 24n;

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

/**
 * A colony's claim on the feed, as the contract computes it (`feed_weight` in petri-core): its living cells, but never
 * more than `reach` cells for every cell it has ever planted. House colonies are never fed, so they weigh nothing.
 */
export function weightOf(live: number, planted: number, reach: number, house = false): number {
  return house ? 0 : Math.min(live, planted * reach);
}

/** A PETRI price in yoctoNEAR per PETRI, as NEAR with enough digits to see it move. */
export function nearPer(yocto: number): string {
  if (!isFinite(yocto) || yocto <= 0) return "—";
  return (yocto / 1e24).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}
