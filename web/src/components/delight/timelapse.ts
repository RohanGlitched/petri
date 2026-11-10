// Time-lapse export: generations of the dish (the next N, played ahead by a copy of the browser's engine, or the ones
// this tab has watched) drawn with the dish's own renderer onto an offscreen canvas, with a title card, a running
// generation count and an end card, and recorded with MediaRecorder as MP4 or WebM. Everything happens in this browser;
// the live dish is not touched.

import type { Engine } from "@/engine";
import { CultureGL, fastGL, type Camera } from "@/components/culture-gl";
import { Culture2D } from "@/components/culture-2d";
import type { Watched } from "./live-feed";

export type Frame = { prev: Uint16Array; cells: Uint16Array; generation: number };
export type Frames = { total: number; first: number; next(): Frame | null; done(): void };
export type Aspect = "16:9" | "1:1" | "9:16";
export const SIZES: Record<Aspect, [number, number]> = { "16:9": [1920, 1080], "1:1": [1080, 1080], "9:16": [1080, 1920] };

/** The next `n` generations, from a copy of the engine (freed when done). */
export function forecastFrames(base: Engine, n: number): Frames {
  let e: Engine | null = base.clone_engine();
  let last = e.cells();
  const first = e.generation();
  let k = 0;
  return {
    total: n,
    first,
    next() {
      if (!e || k >= n) return null;
      e.step(1);
      k++;
      const cells = e.cells();
      const f = { prev: last, cells, generation: e.generation() };
      last = cells;
      return f;
    },
    done() {
      e?.free();
      e = null;
    },
  };
}

/** The generations this tab watched, oldest first. */
export function watchedFrames(list: Watched[], n: number): Frames {
  const xs = list.slice(-Math.min(n + 1, list.length));
  let k = 1;
  return {
    total: Math.max(0, xs.length - 1),
    first: xs[0]?.generation ?? 0,
    next() {
      if (k >= xs.length) return null;
      const f = { prev: xs[k - 1].cells, cells: xs[k].cells, generation: xs[k].generation };
      k++;
      return f;
    },
    done() {},
  };
}

export type Format = { mime: string; ext: "mp4" | "webm"; label: string };

/** The formats this browser can record, best first. */
export function formats(): Format[] {
  if (typeof MediaRecorder === "undefined") return [];
  const out: Format[] = [];
  for (const mime of ["video/mp4;codecs=avc1.640028", "video/mp4;codecs=avc1.42E01E", "video/mp4"]) {
    if (MediaRecorder.isTypeSupported(mime)) {
      out.push({ mime, ext: "mp4", label: "MP4" });
      break;
    }
  }
  for (const mime of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    if (MediaRecorder.isTypeSupported(mime)) {
      out.push({ mime, ext: "webm", label: "WebM" });
      break;
    }
  }
  return out;
}

export type RenderOpts = {
  frames: Frames;
  size: [number, number];
  palette: Map<number, number>;
  /** Follow one colony (the others are dimmed), or show the whole dish. */
  colony?: { id: number; name: string; color: number } | null;
  w: number;
  h: number;
  kicker: string;
  title: string;
  subtitle: string;
  /** Frames each generation lasts. */
  perGen: number;
  fps?: number;
  format: Format;
  onProgress?: (p: number) => void;
  signal?: AbortSignal;
};

const TAU = Math.PI * 2;
const AGAR = 0x2a1509;

function mix(a: number, b: number, k: number) {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - k) + ((b >> s) & 255) * k);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Torus centroid and spread of one colony's cells (or of every cell). */
function centroid(cells: Uint16Array, w: number, h: number, id?: number) {
  let sx = 0, cx = 0, sy = 0, cy = 0, n = 0;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (!v || (id && v !== id)) continue;
    const x = i % w;
    const y = (i - x) / w;
    sx += Math.sin((x / w) * TAU);
    cx += Math.cos((x / w) * TAU);
    sy += Math.sin((y / h) * TAU);
    cy += Math.cos((y / h) * TAU);
    n++;
  }
  if (!n) return null;
  const ax = Math.atan2(sx, cx);
  const ay = Math.atan2(sy, cy);
  // The mean resultant length says how gathered the cells are: 1 in one spot, 0 spread round the whole ring.
  const rx = Math.hypot(sx, cx) / n;
  const ry = Math.hypot(sy, cy) / n;
  const spread = Math.max(Math.sqrt(-2 * Math.log(Math.max(1e-6, rx))) * (w / TAU), Math.sqrt(-2 * Math.log(Math.max(1e-6, ry))) * (h / TAU));
  return { x: (((ax / TAU) * w) % w + w) % w, y: (((ay / TAU) * h) % h + h) % h, spread, n };
}

/** Where one colony is thickest: the 16 x 16 block holding most of its cells, refined to the mean of its cells within
 * twenty cells of that block, and how far they spread from there. A colony with outposts all over the dish is framed on
 * its main patch rather than on empty agar between them. */
function patch(cells: Uint16Array, w: number, h: number, id: number) {
  const B = 16;
  const bw = Math.ceil(w / B);
  const counts = new Uint32Array(bw * Math.ceil(h / B));
  let any = false;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== id) continue;
    const x = i % w;
    counts[Math.floor((i - x) / w / B) * bw + Math.floor(x / B)]++;
    any = true;
  }
  if (!any) return null;
  let best = 0;
  for (let k = 1; k < counts.length; k++) if (counts[k] > counts[best]) best = k;
  const bx = (best % bw) * B + B / 2;
  const by = Math.floor(best / bw) * B + B / 2;
  let sx = 0, sy = 0, n = 0;
  const pts: [number, number][] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== id) continue;
    const x = i % w;
    const dx = ringDelta(bx, x, w);
    const dy = ringDelta(by, (i - x) / w, h);
    if (Math.abs(dx) > 20 || Math.abs(dy) > 20) continue;
    sx += dx;
    sy += dy;
    n++;
    pts.push([dx, dy]);
  }
  const mx = sx / n;
  const my = sy / n;
  let v = 0;
  for (const [dx, dy] of pts) v = Math.max(v, Math.abs(dx - mx), Math.abs(dy - my));
  return { x: (bx + mx + w) % w, y: (by + my + h) % h, spread: v };
}

const ringDelta = (a: number, b: number, n: number) => ((((b - a) % n) + n * 1.5) % n) - n / 2;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const int = (n: number) => Math.round(n).toLocaleString("en-US");

function fontsOf() {
  const el = document.querySelector(".site") ?? document.body;
  const cs = getComputedStyle(el);
  return {
    display: cs.getPropertyValue("--font-display").trim() || "Georgia, serif",
    body: cs.getPropertyValue("--font-body").trim() || "system-ui, sans-serif",
  };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const wd of words) {
    const t = line ? line + " " + wd : wd;
    if (ctx.measureText(t).width > max && line) {
      lines.push(line);
      line = wd;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderTimelapse(o: RenderOpts): Promise<Blob> {
  const fps = o.fps ?? 30;
  const [W, H] = o.size;
  const fonts = fontsOf();
  await document.fonts?.ready;

  // The dish renderer, offscreen at the output size.
  const glCanvas = document.createElement("canvas");
  glCanvas.width = W;
  glCanvas.height = H;
  let r: CultureGL | Culture2D;
  try {
    if (!fastGL()) throw new Error("software GL");
    r = new CultureGL(glCanvas, o.w, o.h);
  } catch {
    r = new Culture2D(glCanvas, o.w, o.h);
  }
  const palette = new Map<number, number>();
  o.palette.forEach((c, id) => palette.set(id, o.colony && id !== o.colony.id ? mix(c, AGAR, 0.72) : c));
  r.setPalette(palette);

  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const ctx = out.getContext("2d")!;
  const vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) / 2);
  vignette.addColorStop(0, "rgba(6,3,1,0)");
  vignette.addColorStop(0.7, "rgba(6,3,1,0.38)");
  vignette.addColorStop(1, "rgba(4,2,1,0.88)");

  // Frames are pushed one by one (requestFrame), so a still title card is recorded as faithfully as a busy dish.
  const stream = out.captureStream(0);
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const rec = new MediaRecorder(stream, { mimeType: o.format.mime, videoBitsPerSecond: W * H > 1.5e6 ? 14_000_000 : 9_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise<void>((done) => (rec.onstop = () => done()));

  // The title card starts fully drawn and holds: recorders often stall for a second or two just after they start, and a
  // still card hides that where a fade would stutter.
  const titleF = Math.round(fps * 3.6);
  const endF = Math.round(fps * 2.6);
  const gens = o.frames.total;
  const bodyF = gens * o.perGen;
  const totalF = titleF + bodyF + endF;
  const u = Math.min(W, H) / 1080;

  let cur = o.frames.next();
  if (!cur) throw new Error("No generations to record");
  r.setCells(cur.cells, cur.prev);
  let genIdx = 0;
  // Camera: the whole dish across the longer side with a slow push in, or one colony followed and framed.
  const start = o.colony ? patch(cur.cells, o.w, o.h, o.colony.id) : centroid(cur.cells, o.w, o.h);
  const camC = { x: start?.x ?? o.w / 2, y: start?.y ?? o.h / 2 };
  const frameOf = (spread: number) => Math.max(26, Math.min(64, spread * 2.6 + 10));
  let across = o.colony ? frameOf(start?.spread ?? 12) : 0;
  const lastGen = { n: cur.generation };

  const drawDish = (k: number, alpha: number) => {
    const t = clamp01((k + 1) / o.perGen);
    let zoom: number;
    if (o.colony) zoom = Math.min(W, H) / across;
    else zoom = (Math.max(W, H) / o.w) * (1 + 0.1 * ease(clamp01(genIdx / Math.max(1, gens))));
    const cam: Camera = { cx: camC.x + 0.5, cy: camC.y + 0.5, zoom };
    r.draw(cam, { w: W, h: H }, { radius: 0, t: ease(t), time: performance.now() / 1000, look: "macro", glow: 1 });
    ctx.globalAlpha = alpha;
    ctx.drawImage(glCanvas, 0, 0);
    ctx.globalAlpha = 1;
  };

  const label = (alpha: number) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
    const pad = 64 * u;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(243,233,218,0.95)";
    ctx.font = `400 ${30 * u}px ${fonts.display}`;
    ctx.fillText("Petri Dish", pad, pad + 24 * u);
    ctx.fillStyle = "rgba(243,233,218,0.7)";
    ctx.font = `600 ${15 * u}px ${fonts.body}`;
    ctx.fillText(o.kicker.toUpperCase().split("").join(String.fromCharCode(8202)), pad, pad + 54 * u);
    // Bottom left: the colony (if any) and the generation, counting.
    const base = H - pad;
    if (o.colony) {
      ctx.beginPath();
      ctx.arc(pad + 9 * u, base - 64 * u, 9 * u, 0, TAU);
      ctx.fillStyle = "#" + o.colony.color.toString(16).padStart(6, "0");
      ctx.fill();
      ctx.fillStyle = "rgba(243,233,218,0.92)";
      ctx.font = `400 ${30 * u}px ${fonts.display}`;
      ctx.fillText(o.colony.name, pad + 28 * u, base - 54 * u);
    }
    ctx.fillStyle = "rgba(243,233,218,0.9)";
    ctx.font = `400 ${44 * u}px ${fonts.display}`;
    ctx.fillText(`Generation ${int(lastGen.n)}`, pad, base);
    ctx.fillStyle = "rgba(243,233,218,0.55)";
    ctx.font = `400 ${22 * u}px ${fonts.display}`;
    const right = "playpetri.xyz";
    ctx.fillText(right, W - pad - ctx.measureText(right).width, base);
    // A hairline of progress along the bottom.
    ctx.fillStyle = "rgba(243,233,218,0.14)";
    ctx.fillRect(pad, H - 30 * u, W - pad * 2, 2 * u);
    ctx.fillStyle = "rgba(242,180,90,0.9)";
    ctx.fillRect(pad, H - 30 * u, (W - pad * 2) * clamp01(genIdx / Math.max(1, gens)), 2 * u);
    ctx.restore();
  };

  const card = (alpha: number, lines: { kicker: string; title: string; sub: string }) => {
    if (alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    const max = W - 200 * u;
    ctx.fillStyle = "rgba(243,233,218,0.72)";
    ctx.font = `600 ${17 * u}px ${fonts.body}`;
    const kick = lines.kicker.toUpperCase().split("").join(String.fromCharCode(8202));
    const ts = W < H ? 84 : 92;
    ctx.font = `400 ${ts * u}px ${fonts.display}`;
    const titleLines = wrapText(ctx, lines.title, max);
    ctx.font = `400 ${26 * u}px ${fonts.body}`;
    const subLines = wrapText(ctx, lines.sub, Math.min(max, 1100 * u));
    const block = 40 * u + titleLines.length * ts * 1.08 * u + 30 * u + subLines.length * 38 * u;
    let y = H / 2 - block / 2;
    ctx.textAlign = "center";
    ctx.font = `600 ${17 * u}px ${fonts.body}`;
    ctx.fillText(kick, W / 2, y + 17 * u);
    y += 40 * u;
    ctx.fillStyle = "rgba(243,233,218,0.97)";
    ctx.font = `400 ${ts * u}px ${fonts.display}`;
    for (const l of titleLines) {
      y += ts * 1.0 * u;
      ctx.fillText(l, W / 2, y);
      y += ts * 0.08 * u;
    }
    y += 22 * u;
    ctx.fillStyle = "rgba(242,180,90,0.85)";
    ctx.fillRect(W / 2 - 28 * u, y, 56 * u, 2 * u);
    y += 16 * u;
    ctx.fillStyle = "rgba(243,233,218,0.78)";
    ctx.font = `400 ${26 * u}px ${fonts.body}`;
    for (const l of subLines) {
      y += 38 * u;
      ctx.fillText(l, W / 2, y);
    }
    ctx.restore();
  };

  const endLines = { kicker: "A memecoin that is alive", title: "Petri Dish", sub: "Conway's Life on NEAR. Every cell belongs to an account, and the living earn PETRI. playpetri.xyz" };

  // Warm up: the first draw compiles the dish's shader, which must not stall the recording.
  drawDish(o.perGen - 1, 1);
  ctx.fillStyle = "#0b0603";
  ctx.fillRect(0, 0, W, H);
  await new Promise((r) => requestAnimationFrame(() => r(null)));

  const titleLines = { kicker: o.kicker, title: o.title, sub: o.subtitle };
  rec.start(250);
  // Encoders take a moment (up to a few seconds) to start, and drop or squeeze the frames they get meanwhile. Hold the
  // title card until the first encoded data arrives, then start the clock.
  await new Promise<void>((done) => {
    let over = false;
    const end = () => {
      if (over) return;
      over = true;
      rec.removeEventListener("dataavailable", first);
      done();
    };
    const first = (e: BlobEvent) => e.data.size > 0 && setTimeout(end, 300);
    rec.addEventListener("dataavailable", first);
    setTimeout(end, 5000);
    const hold = () => {
      if (over) return;
      ctx.fillStyle = "#0b0603";
      ctx.fillRect(0, 0, W, H);
      card(1, titleLines);
      track.requestFrame?.();
      requestAnimationFrame(hold);
    };
    hold();
  });
  let drawn = -1;
  const t0 = performance.now();
  try {
    await new Promise<void>((resolve, reject) => {
      const tick = () => {
        if (o.signal?.aborted) return reject(new DOMException("Cancelled", "AbortError"));
        const f = Math.floor(((performance.now() - t0) / 1000) * fps);
        if (f > drawn) {
          drawn = f;
          ctx.fillStyle = "#0b0603";
          ctx.fillRect(0, 0, W, H);
          if (f < titleF) {
            // Title card, and the dish fading up under it in its last second.
            const dishIn = clamp01((f - (titleF - fps)) / fps);
            if (dishIn > 0) drawDish(o.perGen - 1, dishIn);
            card(1 - dishIn, titleLines);
            label(dishIn);
          } else if (f < titleF + bodyF) {
            const b = f - titleF;
            const g = Math.floor(b / o.perGen);
            while (genIdx < g) {
              const n = o.frames.next();
              if (!n) break;
              cur = n;
              genIdx++;
              lastGen.n = n.generation;
              r.setCells(n.cells, n.prev);
              const c = o.colony ? patch(n.cells, o.w, o.h, o.colony.id) : null;
              // Follow the colony's main patch smoothly; a jump to another patch is not chased.
              if (c && Math.hypot(ringDelta(camC.x, c.x, o.w), ringDelta(camC.y, c.y, o.h)) < 16) {
                camC.x += ringDelta(camC.x, c.x, o.w) * 0.12;
                camC.y += ringDelta(camC.y, c.y, o.h) * 0.12;
                across += (frameOf(c.spread) - across) * 0.05;
              }
            }
            drawDish(b % o.perGen, 1);
            label(1);
          } else {
            const e = f - titleF - bodyF;
            const out = clamp01(e / (fps * 0.9));
            drawDish(o.perGen - 1, 1 - out * 0.85);
            label(1 - out);
            card(clamp01((e - fps * 0.5) / (fps * 0.7)), endLines);
          }
          track.requestFrame?.();
          o.onProgress?.(Math.min(1, f / totalF));
          if (f >= totalF) return resolve();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());
    o.frames.done();
    r.dispose();
  }
  return new Blob(chunks, { type: o.format.mime.split(";")[0] });
}

/** "1 hour", "15 minutes", "2.5 hours": how much of the dish's time `gens` generations are. */
export function span(gens: number, genMs: number) {
  const min = (gens * genMs) / 60000;
  if (min < 90) return `${Math.round(min)} minutes`;
  const hrs = min / 60;
  return `${hrs % 1 === 0 ? hrs : hrs.toFixed(1)} hours`;
}
