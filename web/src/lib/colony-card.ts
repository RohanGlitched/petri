// One colony as a share card needs it, read on the server straight from the contract's views: its row, its lifetime
// earnings, the stored board (decoded here, no WASM) and the clock. Kept for thirty seconds per colony. Read-only.

import { CONTRACTS, type Network } from "./config";
import { b64, decodeView, rpcCall } from "./rpc";
import { projectTarget } from "./projection.mjs";
import { STAINS } from "./stains";
import { ENGINE_HASH } from "@/engine";
import { Engine, initSync } from "@/engine/pkg/petri";

export type ColonyCard = {
  net: Network;
  id: number;
  name: string;
  color: number;
  stain: string | null;
  account: string;
  house: boolean;
  /** Living cells, and the generation the board shown is at: the stored board stepped forward to now by the same
   * engine the browser runs, or the stored board itself if the engine could not load. */
  live: number;
  boardGeneration: number;
  /** The generation the chain's clock says is due now. */
  generation: number;
  joined: number;
  cellsPlanted: number;
  /** Lifetime PETRI earnings in units of 1e-6: the contract's count at the stored board plus what the engine says the
   * colony has earned since. */
  earned: number;
  w: number;
  h: number;
  /** The board's owners (u16 per cell), for drawing the colony's shape. */
  cells: Uint16Array;
};

async function view<T>(net: Network, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpcCall<{ result?: number[] }>(net, "query", { request_type: "call_function", finality: "optimistic", account_id: CONTRACTS[net], method_name: method, args_base64: b64(args) }, { id: "petri-card", timeoutMs: 6000 });
  return decodeView<T>(r);
}

/** The contract's compact board: a bit per cell (rows of 64-bit little-endian words), then each live cell's owner. */
export function decodeBoard(bytes: Uint8Array, w: number, h: number): Uint16Array | null {
  const words = Math.ceil(w / 64);
  const nb = words * h * 8;
  if (bytes.length < nb || (bytes.length - nb) % 2) return null;
  const cells = new Uint16Array(w * h);
  let o = nb;
  for (let y = 0; y < h; y++)
    for (let k = 0; k < words; k++) {
      const at = (y * words + k) * 8;
      for (let byte = 0; byte < 8; byte++) {
        let b = bytes[at + byte];
        while (b) {
          const bit = 31 - Math.clz32(b & -b);
          b &= b - 1;
          const x = k * 64 + byte * 8 + bit;
          if (o + 1 >= bytes.length) return null;
          if (x < w) cells[y * w + x] = bytes[o] | (bytes[o + 1] << 8);
          o += 2;
        }
      }
    }
  return o === bytes.length ? cells : null;
}

type RawColony = { id: number; account: string; name: string; color: number; house: boolean; joined_generation: string; cells_planted: string };
type RawRules = { width: number; height: number; generation_ms: string; feed_ppm: number; keeper_bps: number; reach: number; live_floor: number; stake_keep_bps: number; max_lag: number; max_catchup: number };
type RawState = { generation: string; epoch_ms: string; now_ms: string; colonies: number; chain: string; counted: number; house: number[]; agar: string };

/** petri-core (WASM), loaded once on the server from the site's own copy of the engine. */
let wasm: Promise<boolean> | null = null;
function engineReady(origin: string): Promise<boolean> {
  if (!wasm)
    wasm = fetch(`${origin}/petri_bg.wasm?v=${ENGINE_HASH}`, { signal: AbortSignal.timeout(6000) })
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => {
        initSync({ module: new Uint8Array(b) });
        return true;
      })
      .catch(() => {
        wasm = null;
        return false;
      });
  return wasm;
}

const cache = new Map<string, { at: number; p: Promise<ColonyCard | null> }>();

/** `origin` is this site's own address, where the engine's WASM is served. */
export function colonyCard(net: Network, id: number, origin: string): Promise<ColonyCard | null> {
  const key = `${net}:${id}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.p;
  const p = read(net, id, origin).catch(() => null);
  cache.set(key, { at: Date.now(), p });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return p;
}

async function read(net: Network, id: number, origin: string): Promise<ColonyCard | null> {
  if (!Number.isInteger(id) || id < 1 || id > 65534) return null;
  const [rules, state, board, rows, earned, stakes, ok] = await Promise.all([
    view<RawRules>(net, "rules"),
    view<RawState>(net, "state"),
    view<string>(net, "board"),
    view<RawColony[]>(net, "colonies", { from: id - 1, limit: 1 }),
    view<string[]>(net, "earnings", { from: id - 1, limit: 1 }),
    view<string[]>(net, "stakes", { from: 0, limit: 2000 }).catch(() => null),
    engineReady(origin),
  ]);
  const c = rows[0];
  if (!c || c.id !== id) return null;
  const bytes = new Uint8Array(Buffer.from(board, "base64"));
  const generation = Math.floor((Number(state.now_ms) - Number(state.epoch_ms)) / Number(rules.generation_ms));
  let cells: Uint16Array | null = null;
  let boardGeneration = Number(state.generation);
  let since = 0;
  // The contract stores the board at the last generation someone advanced to; Life is deterministic, so the board now
  // is that one stepped forward, exactly as the browser's dish does it.
  if (ok && stakes && stakes.length >= state.colonies) {
    let e: Engine | null = null;
    try {
      e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
      e.set_counted(state.counted);
      e.set_colonies(state.colonies);
      e.set_stakes(new BigUint64Array(stakes.map((v) => BigInt(v))));
      e.set_house(new Uint16Array(state.house));
      e.set_agar(state.agar);
      // A dish asleep (more than max_lag behind) is stepped only as far as the contract's next call would take it:
      // the skipped generations never run (projection.mjs).
      const to = projectTarget(boardGeneration, generation, rules).target;
      if (e.load_compact(bytes, boardGeneration, state.chain) && to >= boardGeneration) {
        e.step(to - boardGeneration);
        cells = e.cells();
        since = Number(e.earned_of(id));
        boardGeneration = to;
      }
    } catch {
      cells = null;
    } finally {
      e?.free();
    }
  }
  if (!cells) cells = decodeBoard(bytes, rules.width, rules.height) ?? new Uint16Array(rules.width * rules.height);
  let live = 0;
  for (let i = 0; i < cells.length; i++) if (cells[i] === id) live++;
  return {
    net,
    id,
    name: c.name,
    color: c.color,
    stain: STAINS.find((s) => s.color === c.color)?.name ?? null,
    account: c.account,
    house: c.house,
    live,
    boardGeneration,
    generation,
    joined: Number(c.joined_generation),
    cellsPlanted: Number(c.cells_planted),
    earned: Number(earned[0] ?? 0) + since,
    w: rules.width,
    h: rules.height,
    cells,
  };
}

const TAU = Math.PI * 2;

/**
 * The colony's living shape as an SVG: glossy beads on dark agar, framed on the colony (on the torus), with the
 * neighbours it touches dimmed around it.
 */
export function colonySvg(card: ColonyCard, size: number): string {
  const { w, h, cells, id } = card;
  let sx = 0, cx = 0, sy = 0, cy = 0, n = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== id) continue;
    const x = i % w;
    const y = (i - x) / w;
    sx += Math.sin((x / w) * TAU);
    cx += Math.cos((x / w) * TAU);
    sy += Math.sin((y / h) * TAU);
    cy += Math.cos((y / h) * TAU);
    n++;
  }
  const mx = n ? (((Math.atan2(sx, cx) / TAU) * w) % w + w) % w : w / 2;
  const my = n ? (((Math.atan2(sy, cy) / TAU) * h) % h + h) % h : h / 2;
  const rx = n ? Math.hypot(sx, cx) / n : 0;
  const ry = n ? Math.hypot(sy, cy) / n : 0;
  const spread = n ? Math.max(Math.sqrt(-2 * Math.log(Math.max(1e-6, rx))) * (w / TAU), Math.sqrt(-2 * Math.log(Math.max(1e-6, ry))) * (h / TAU)) : 20;
  let across = Math.max(22, Math.min(Math.min(w, h), Math.ceil(spread * 4.6 + 6)));
  let fx = mx;
  let fy = my;
  if (across > 48 && n) {
    // A colony spread over the whole dish (outposts): frame its densest patch instead, so its beads read.
    across = 44;
    const pts: [number, number][] = [];
    for (let i = 0; i < cells.length; i++) if (cells[i] === id) pts.push([i % w, Math.floor(i / w)]);
    let best = -1;
    for (let cyy = 0; cyy < h; cyy += 4)
      for (let cxx = 0; cxx < w; cxx += 4) {
        let c = 0;
        for (const [x, y] of pts) {
          const dx = Math.abs(((x - cxx + w * 1.5) % w) - w / 2);
          const dy = Math.abs(((y - cyy + h * 1.5) % h) - h / 2);
          if (dx < across / 2 - 3 && dy < across / 2 - 3) c++;
        }
        if (c > best) {
          best = c;
          fx = cxx;
          fy = cyy;
        }
      }
  }
  const k = size / across;
  const hexc = (c: number) => "#" + c.toString(16).padStart(6, "0");
  const beads: string[] = [];
  const x0 = fx - across / 2;
  const y0 = fy - across / 2;
  for (let dy = 0; dy <= across; dy++)
    for (let dx = 0; dx <= across; dx++) {
      const gx = Math.floor(x0 + dx);
      const gy = Math.floor(y0 + dy);
      const v = cells[(((gy % h) + h) % h) * w + (((gx % w) + w) % w)];
      if (!v) continue;
      const px = (gx - x0 + 0.5) * k;
      const py = (gy - y0 + 0.5) * k;
      const r = k * 0.5;
      if ((px - size / 2) ** 2 + (py - size / 2) ** 2 > (size / 2 - r) ** 2) continue;
      beads.push(`<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(2)}" fill="url(#${v === id ? "m" : "o"})"${v === id ? "" : ' opacity="0.42"'}/>`);
      if (v === id) beads.push(`<ellipse cx="${(px - r * 0.3).toFixed(1)}" cy="${(py - r * 0.36).toFixed(1)}" rx="${(r * 0.32).toFixed(2)}" ry="${(r * 0.2).toFixed(2)}" fill="#fff" opacity="0.55"/>`);
    }
  const c = hexc(card.color);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
<defs>
<radialGradient id="agar" cx="45%" cy="40%" r="70%"><stop offset="0" stop-color="#6e3a14"/><stop offset="0.6" stop-color="#3a1c09"/><stop offset="1" stop-color="#1c0d04"/></radialGradient>
<radialGradient id="m" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="0.35" stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity="0.75"/></radialGradient>
<radialGradient id="o" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#d8c8b0"/><stop offset="1" stop-color="#6d5a48"/></radialGradient>
</defs>
<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#agar)"/>
${beads.join("")}
<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 3}" fill="none" stroke="#f3e9da" stroke-opacity="0.35" stroke-width="3"/>
</svg>`;
}
