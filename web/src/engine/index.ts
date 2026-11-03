// Loads petri-core (compiled to WebAssembly) once per page.

import init, { Engine, buy_quote, pattern_cells, quote, sell_quote, slide_svg } from "./pkg/petri";

let ready: Promise<void> | null = null;
/** First 12 hex digits of sha256(public/petri_bg.wasm); update when the engine is rebuilt (scripts/build-engine.sh does). */
export const ENGINE_HASH = "65c712ba522d";

export function loadEngine(): Promise<void> {
  if (!ready) {
    // The query is the binary's hash, so a new engine is never paired with a cached old one.
    ready = init({ module_or_path: `/petri_bg.wasm?v=${ENGINE_HASH}` }).then(() => undefined);
  }
  return ready;
}

export { Engine, buy_quote, pattern_cells, quote, sell_quote, slide_svg };

export type PatternName =
  | "block"
  | "beehive"
  | "loaf"
  | "blinker"
  | "toad"
  | "pulsar"
  | "glider"
  | "lwss"
  | "eater"
  | "r-pentomino"
  | "gosper-gun";

export type PatternInfo = {
  name: PatternName;
  label: string;
  cells: number;
  kind: "still" | "oscillator" | "ship" | "gun" | "wild";
  note: string;
};

// What each stamp does, in the words a player needs.
export const PATTERNS: PatternInfo[] = [
  { name: "block", label: "Block", cells: 4, kind: "still", note: "Never changes. Earns every generation until something hits it." },
  { name: "beehive", label: "Beehive", cells: 6, kind: "still", note: "A sturdier still life. Six cells of steady income." },
  { name: "loaf", label: "Loaf", cells: 7, kind: "still", note: "Still life that survives some glancing hits." },
  { name: "eater", label: "Eater", cells: 7, kind: "still", note: "Absorbs gliders that fly into its mouth and survives. Your wall." },
  { name: "blinker", label: "Blinker", cells: 3, kind: "oscillator", note: "Flips every generation. Cheap, but easily disturbed." },
  { name: "toad", label: "Toad", cells: 6, kind: "oscillator", note: "Period-two oscillator." },
  { name: "pulsar", label: "Pulsar", cells: 48, kind: "oscillator", note: "Period three, up to 72 cells alive. A big, showy earner." },
  { name: "glider", label: "Glider", cells: 5, kind: "ship", note: "Travels one cell diagonally every four generations, forever. Your raid." },
  { name: "lwss", label: "Spaceship", cells: 9, kind: "ship", note: "Light spaceship. Flies straight, two cells every four generations." },
  { name: "r-pentomino", label: "R-pentomino", cells: 5, kind: "wild", note: "Five cells that explode for over a thousand generations. Chaos for everyone." },
  { name: "gosper-gun", label: "Glider gun", cells: 36, kind: "gun", note: "Fires a glider every 30 generations. A standing army." },
];
