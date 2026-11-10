// A living slide's picture: the fossil the slide fixed, beside the colony its purse keeps alive now. When that colony
// has no living cell the card is stamped EXTINCT; before the purse has joined the dish, DORMANT. Drawn the same way by
// the server (the token's media URL) and by the slide's page, both from the board the contract stores (never the
// browser's forecast).

export type LivingCard = {
  token: string;
  /** The slide: its rectangle's bits, row by row, least significant bit first. */
  bitmap: Uint8Array;
  w: number;
  h: number;
  color: number;
  fossilGeneration: number;
  /** The purse colony's living cells, relative to a crop of `cw` × `ch`, or null before it joined. */
  live: { cells: [number, number][]; cw: number; ch: number } | null;
  liveColor: number;
  generation: number;
  holder: string;
  keys: number | null;
};

const hex = (n: number) => "#" + (n >>> 0).toString(16).padStart(6, "0").slice(-6);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const short = (a: string, n = 30) => (a.length <= n ? a : a.slice(0, n - 9) + "…" + a.slice(-8));

function cellsOf(bitmap: Uint8Array, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < w * h; i++) if ((bitmap[i >> 3] >> (i & 7)) & 1) out.push([i % w, Math.floor(i / w)]);
  return out;
}

/** Cells as glossy domes inside a square panel at (px, py) of side `size`. */
function panel(cells: [number, number][], cw: number, ch: number, px: number, py: number, size: number, fill: string, id: string, faded = false): string {
  const side = Math.max(cw, ch, 8);
  const step = size / side;
  const ox = px + (size - cw * step) / 2;
  const oy = py + (size - ch * step) / 2;
  const r = Math.max(1, step * 0.42);
  let out = `<defs><radialGradient id="${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="${faded ? 0.35 : 0.75}"/><stop offset="0.35" stop-color="${fill}"/><stop offset="1" stop-color="${fill}" stop-opacity="${faded ? 0.45 : 0.85}"/></radialGradient></defs>`;
  out += `<g fill="url(#${id})"${faded ? ' opacity="0.8"' : ""}>`;
  for (const [x, y] of cells) out += `<circle cx="${(ox + (x + 0.5) * step).toFixed(1)}" cy="${(oy + (y + 0.5) * step).toFixed(1)}" r="${r.toFixed(1)}"/>`;
  return out + "</g>";
}

export function livingSvg(c: LivingCard): string {
  const W = 640;
  const H = 760;
  const fossil = cellsOf(c.bitmap, c.w, c.h);
  const alive = c.live ? c.live.cells.length : 0;
  const stamp = !c.live ? "DORMANT" : alive === 0 ? "EXTINCT" : null;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Georgia, serif">`;
  s += `<rect width="${W}" height="${H}" rx="28" fill="#120a05"/>`;
  s += `<rect x="14" y="14" width="${W - 28}" height="${H - 28}" rx="20" fill="none" stroke="#f3e9da" stroke-opacity="0.14"/>`;
  s += `<text x="40" y="70" fill="#f3e9da" font-size="30">Living slide #${esc(c.token)}</text>`;
  s += `<text x="40" y="100" fill="#f3e9da" fill-opacity="0.6" font-size="15" font-family="Helvetica, Arial, sans-serif">A specimen sealed in its own keyless account, playing on the dish.</text>`;
  // Two dishes: the fossil and the colony now.
  const size = 260;
  const top = 140;
  for (const [i, label] of [[0, `Fossil · generation ${c.fossilGeneration}`], [1, `On chain · generation ${c.generation}`]] as const) {
    const x = 40 + i * (size + 40);
    s += `<circle cx="${x + size / 2}" cy="${top + size / 2}" r="${size / 2}" fill="#24130a" stroke="#f3e9da" stroke-opacity="0.22"/>`;
    s += `<text x="${x + size / 2}" y="${top + size + 34}" text-anchor="middle" fill="#f3e9da" fill-opacity="0.7" font-size="15" font-family="Helvetica, Arial, sans-serif">${esc(label)}</text>`;
  }
  const inner = size * 0.66;
  const off = (size - inner) / 2;
  s += panel(fossil, c.w, c.h, 40 + off, top + off, inner, hex(c.color), "f", true);
  if (c.live && alive > 0) s += panel(c.live.cells, c.live.cw, c.live.ch, 40 + size + 40 + off, top + off, inner, hex(c.liveColor), "l");
  if (stamp) {
    const cx = 40 + size + 40 + size / 2;
    const cy = top + size / 2;
    s += `<g transform="rotate(-14 ${cx} ${cy})"><rect x="${cx - 120}" y="${cy - 30}" width="240" height="60" rx="8" fill="none" stroke="#e0533d" stroke-width="4"/><text x="${cx}" y="${cy + 13}" text-anchor="middle" fill="#e0533d" font-size="36" font-family="Helvetica, Arial, sans-serif" font-weight="700" letter-spacing="6">${stamp}</text></g>`;
  }
  // Facts.
  const rows: [string, string][] = [
    ["Cells on the slide", String(fossil.length)],
    ["Living cells on chain", c.live ? String(alive) : "not joined yet"],
    ["Held by", short(c.holder)],
    ["Access keys on the account", c.keys === null ? "unknown" : String(c.keys)],
  ];
  rows.forEach(([k, v], i) => {
    const y = 520 + i * 52;
    s += `<text x="40" y="${y}" fill="#f3e9da" fill-opacity="0.55" font-size="14" font-family="Helvetica, Arial, sans-serif">${esc(k)}</text>`;
    s += `<text x="${W - 40}" y="${y}" text-anchor="end" fill="${k.startsWith("Access") && c.keys === 0 ? "#f2b45a" : "#f3e9da"}" font-size="22">${esc(v)}</text>`;
    s += `<line x1="40" x2="${W - 40}" y1="${y + 18}" y2="${y + 18}" stroke="#f3e9da" stroke-opacity="0.1"/>`;
  });
  return s + "</svg>";
}
