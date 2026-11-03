import type { Rules } from "@/lib/chain";

/** The launch values the live dish returns from `rules`, used only until the real view has loaded. */
export const LAUNCH: Rules = {
  width: 128,
  height: 128,
  generation_ms: "15000",
  max_supply: "1000000000000",
  feed_ppm: 10,
  keeper_bps: 200,
  cap_bps: 1500,
  cap_min: 64,
  burn_bps: 5000,
  payback: 480,
  min_cell_price: "500000",
  live_floor: 1000,
  petri_price: "200000000000000000000",
  min_join: "10000000000000000000000",
  cell_fee: "100000000000000000000",
  tide_every: 240,
  tide_bps: 5000,
  buffer: 3,
  max_plant_cells: 64,
  max_catchup: 120,
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
 * Each colony's claim on the feed and the tides, as the contract computes it (`feed_weights` in petri-core): its
 * living cells, but never more than `cap_bps` of all living cells, and the cap is never below `cap_min`.
 */
export function capOf(totalLive: number, capBps: number, capMin: number): number {
  return Math.max(Math.floor((totalLive * capBps) / 10000), capMin);
}

/** A PETRI price in yoctoNEAR per PETRI, as NEAR with enough digits to see it move. */
export function nearPer(yocto: number): string {
  if (!isFinite(yocto) || yocto <= 0) return "—";
  return (yocto / 1e24).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 8 });
}
