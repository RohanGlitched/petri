// Specimens: slides a colony makes of its own living cells, minted by the dish contract as NEP-171 tokens. A slide is
// a rectangle of 4 to 32 cells a side on the wrapping board, fixed at the generation it was made; the contract stores
// the rectangle as a bitmap, draws the picture from it (petri-core `slide_svg`) and records the slide in the ledger,
// where /verify checks that those cells really were alive and the colony's.

import type { Rules } from "./chain";

export type Rect = { x: number; y: number; w: number; h: number };
export const SLIDE_MIN = 4;
export const SLIDE_MAX = 32;
/** The contract's limit on a slide's title (`MAX_TITLE_CHARS`). */
export const SLIDE_TITLE_MAX = 40;

export type Slide = {
  id: string;
  /** Who holds the token now; slides can be transferred. */
  owner: string;
  /** The colony whose cells it holds, its name now, and its stain when the slide was made. */
  colony: number | null;
  name: string | null;
  color: number | null;
  generation: number | null;
  rect: Rect | null;
  /** The rectangle's bits, row by row, least significant bit first (petri-core `region_bitmap`). */
  bitmap: Uint8Array | null;
  /** Living cells, as offsets inside the rectangle. */
  cells: [number, number][] | null;
  count: number | null;
  title: string | null;
  /** The contract's own picture, when the view carried it (NEP-171 `nft_token`); the `slides` views leave it out. */
  media: string | null;
  /** When it was minted, in ms. */
  minted: number | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || !isFinite(Number(v)) ? null : Number(v));
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);

function parseExtra(v: unknown): Obj {
  if (typeof v !== "string") return obj(v);
  try {
    return obj(JSON.parse(v));
  } catch {
    return {};
  }
}

function fromBase64(v: string): Uint8Array | null {
  try {
    const bin = atob(v);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function bitmapCells(bitmap: Uint8Array, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < w * h; i++) if (((bitmap[i >> 3] ?? 0) >> (i & 7)) & 1) out.push([i % w, Math.floor(i / w)]);
  return out;
}

export function cellsBitmap(cells: [number, number][], w: number, h: number): Uint8Array {
  const out = new Uint8Array(Math.ceil((w * h) / 8));
  for (const [x, y] of cells) {
    const i = y * w + x;
    if (x >= 0 && y >= 0 && x < w && y < h) out[i >> 3] |= 1 << (i & 7);
  }
  return out;
}

/** One slide from the contract's `slides` / `slide` views (SlideView) or from a NEP-171 token, whose metadata `extra`
 * carries the same facts. Missing facts stay null rather than guessed. */
export function normalizeSlide(raw: unknown): Slide | null {
  const r = obj(raw);
  const meta = obj(r.metadata);
  const extra = parseExtra(meta.extra);
  const pick = (k: string) => r[k] ?? extra[k];
  const id = str(r.token_id ?? r.id);
  if (id === null) return null;
  const x = num(pick("x"));
  const y = num(pick("y"));
  const w = num(pick("w"));
  const h = num(pick("h"));
  const rect = x !== null && y !== null && w !== null && h !== null ? { x, y, w, h } : null;
  const b = pick("bitmap");
  const bitmap = typeof b === "string" ? fromBase64(b) : null;
  const cells = bitmap && rect ? bitmapCells(bitmap, rect.w, rect.h) : null;
  // In both views `cells` is the count of captured cells.
  const count = num(pick("cells")) ?? (cells ? cells.length : null);
  const issued = num(meta.issued_at);
  return {
    id,
    owner: str(r.owner_id) ?? "",
    colony: num(pick("colony")),
    name: str(r.name),
    color: num(pick("color")),
    generation: num(pick("generation")),
    rect,
    bitmap,
    cells,
    count,
    // A token's metadata title is generated ("Specimen #1 · name"); the colony's own title is the view's.
    title: str(r.title),
    media: str(meta.media),
    minted: num(r.minted_ms) ?? issued,
  };
}

/** What the rules say a slide costs, read loosely so a missing field degrades to "unknown" rather than a wrong number. */
export function slideRules(rules: Rules | undefined | null): { cellPrice: bigint | null; minCells: number | null } {
  const r = (rules ?? {}) as unknown as Obj;
  const price = r.slide_cells_price;
  return { cellPrice: price !== undefined && price !== null ? BigInt(String(price)) : null, minCells: num(r.slide_min_cells) };
}

const wrap = (a: number, n: number) => ((a % n) + n) % n;
/** The shortest way from a to b on a ring of n cells. */
const delta = (a: number, b: number, n: number) => wrap(b - a + n / 2, n) - n / 2;

/** The rectangle a drag from cell a to cell b frames: at least 4 and at most 32 cells a side, on the wrapping board. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, W: number, H: number): Rect {
  const side = (from: number, d: number, n: number): [number, number] => {
    const len = Math.max(SLIDE_MIN, Math.min(SLIDE_MAX, Math.abs(d) + 1));
    return [wrap(d >= 0 ? from : from - (len - 1), n), len];
  };
  const [x, w] = side(a.x, delta(a.x, b.x, W), W);
  const [y, h] = side(a.y, delta(a.y, b.y, H), H);
  return { x, y, w, h };
}

export const clampRect = (r: Rect, W: number, H: number): Rect => ({
  x: wrap(r.x, W),
  y: wrap(r.y, H),
  w: Math.max(SLIDE_MIN, Math.min(SLIDE_MAX, r.w)),
  h: Math.max(SLIDE_MIN, Math.min(SLIDE_MAX, r.h)),
});

/** The colony's own living cells inside the rectangle, as offsets: what `region_bitmap` would capture now. */
export function capture(board: Uint16Array | undefined, r: Rect, W: number, H: number, colony: number): [number, number][] {
  if (!board) return [];
  const out: [number, number][] = [];
  for (let dy = 0; dy < r.h; dy++)
    for (let dx = 0; dx < r.w; dx++) if (board[wrap(r.y + dy, H) * W + wrap(r.x + dx, W)] === colony) out.push([dx, dy]);
  return out;
}

/** The colony's densest square of `size` cells, for where the frame first opens. */
export function densest(board: Uint16Array | undefined, W: number, H: number, colony: number, size = 16): Rect | null {
  if (!board) return null;
  let best = 0;
  let at: Rect | null = null;
  for (let by = 0; by < H; by += 2)
    for (let bx = 0; bx < W; bx += 2) {
      let n = 0;
      for (let y = by; y < by + size; y++) {
        const row = (y % H) * W;
        for (let x = bx; x < bx + size; x++) if (board[row + (x % W)] === colony) n++;
      }
      if (n > best) {
        best = n;
        at = { x: bx, y: by, w: size, h: size };
      }
    }
  return at;
}

/** petri-core's `slide_svg`, character for character (checked against the engine's own export on random slides): a
 * dark agar disc, each live cell a small rounded square in the colony's colour, and the generation in the corner. The
 * contract serves this as the token's media; the site draws it from the bitmap the `slides` views return, and for the
 * preview while framing, without waiting for the engine to load. */
export function slideSvg(bitmap: Uint8Array, w: number, h: number, color: number, generation: number): string {
  const d2 = w * w + h * h;
  let s = 1;
  while (s * s < d2) s++;
  const side = s + 2;
  const ox = side - w;
  const oy = side - h;
  const half = (v: number) => (v % 2 === 0 ? `${v / 2}` : `${(v - 1) / 2}.5`);
  let path = "";
  let at: [number, number] | null = null;
  for (let i = 0; i < w * h; i++) {
    if ((((bitmap[i >> 3] ?? 0) >> (i % 8)) & 1) !== 1) continue;
    const cx = i % w;
    const cy = Math.floor(i / w);
    path += at === null ? `M${half(ox + 2 * cx + 1)} ${half(oy + 2 * cy + 1)}h0` : `m${cx - at[0]} ${cy - at[1]}h0`;
    at = [cx, cy];
  }
  const tenths = (v: number) => (v % 10 === 0 ? `${v / 10}` : `${Math.floor(v / 10)}.${v % 10}`);
  const col = (color & 0xffffff).toString(16).padStart(6, "0");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${side} ${side}">` +
    `<rect width="${side}" height="${side}" fill="#0b0705"/>` +
    `<circle cx="${tenths(side * 5)}" cy="${tenths(side * 5)}" r="${tenths(side * 5 - 4)}" fill="#24130a" stroke="#f3e9da" stroke-opacity=".2" stroke-width=".25"/>` +
    `<defs><path id="c" d="${path}"/></defs>` +
    `<g fill="none" stroke="#${col}"><use xlink:href="#c" stroke-width=".9" stroke-linecap="round"/><use xlink:href="#c" stroke-width=".72" stroke-linecap="square"/></g>` +
    `<text x=".6" y="${tenths(side * 10 - 6)}" font-family="monospace" font-size="${tenths(Math.floor((side * 10 + 11) / 22))}" fill="#f3e9da" fill-opacity=".55">gen ${generation}</text></svg>`
  );
}

export const svgUrl = (svg: string) => `data:image/svg+xml;base64,${btoa(svg)}`;

/** A slide's cells for replanting. */
export function slideOffsets(s: Slide): [number, number][] | null {
  return s.cells;
}
