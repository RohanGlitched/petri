// Canvas 2D stand-in for the WebGL dish, for browsers whose WebGL runs on the CPU (SwiftShader, llvmpipe, headless
// Chrome, remote desktops). The shader sums a 5 by 5 neighbourhood per pixel, which a software rasteriser turns into
// half-second frames; this draws each living cell once, as a lit bead on the agar, and only when something changes.
// Same interface as CultureGL, so Culture.tsx picks one at mount and drives it the same way.

import { LOOKS, type Camera, type Look } from "./culture-gl";

const rgb = (v: [number, number, number], k = 1) => `rgb(${Math.round(v[0] * 255 * k)},${Math.round(v[1] * 255 * k)},${Math.round(v[2] * 255 * k)})`;
const hex = (n: number) => "#" + n.toString(16).padStart(6, "0");

export class Culture2D {
  private ctx: CanvasRenderingContext2D;
  private board: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private img: ImageData;
  private cells: Uint16Array;
  private overlay: Uint8Array;
  private palette = new Map<number, number>();
  private dirty = true;
  w: number;
  h: number;

  constructor(canvas: HTMLCanvasElement, w: number, h: number) {
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) throw new Error("Canvas 2D is not available in this browser");
    this.ctx = ctx;
    this.w = w;
    this.h = h;
    this.board = document.createElement("canvas");
    this.board.width = w;
    this.board.height = h;
    this.bctx = this.board.getContext("2d")!;
    this.img = this.bctx.createImageData(w, h);
    this.cells = new Uint16Array(w * h);
    this.overlay = new Uint8Array(w * h);
  }

  /** Births and deaths are not animated here, so the previous board is not needed. */
  setCells(now: Uint16Array, _prev?: Uint16Array) {
    this.cells = now;
    this.dirty = true;
  }

  setOverlay(o: Uint8Array) {
    this.overlay = o;
    this.dirty = true;
  }

  setPalette(colors: Map<number, number>) {
    this.palette = colors;
    this.dirty = true;
  }

  /** One pixel per cell: colony colour where alive, overlay tints elsewhere, transparent agar. */
  private paintBoard(ghost: number) {
    const d = this.img.data;
    const n = this.w * this.h;
    for (let i = 0; i < n; i++) {
      const id = this.cells[i];
      const ov = this.overlay[i];
      const o = i * 4;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      if (id) {
        const c = this.palette.get(id) ?? 0xd8c8b0;
        r = (c >> 16) & 255;
        g = (c >> 8) & 255;
        b = c & 255;
        a = 255;
      }
      if (ov === 4 && id) {
        // A living cell pulsing (just planted, or found): its own stain, lifted towards white.
        r = Math.round(r + (255 - r) * 0.45);
        g = Math.round(g + (255 - g) * 0.45);
        b = Math.round(b + (255 - b) * 0.45);
      } else if (ov === 1 || ov === 4) {
        r = (ghost >> 16) & 255;
        g = (ghost >> 8) & 255;
        b = ghost & 255;
        a = ov === 4 ? 255 : 190;
      } else if (ov === 2) {
        r = 242;
        g = 72;
        b = 92;
        a = 230;
      } else if ((ov === 3 || ov === 9) && !id) {
        r = 242;
        g = 72;
        b = 92;
        a = ov === 9 ? 30 : 60;
      } else if ((ov === 6 || ov === 7) && !id) {
        r = 255;
        g = 240;
        b = 220;
        a = 24;
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = b;
      d[o + 3] = a;
    }
    this.bctx.putImageData(this.img, 0, 0);
  }

  draw(cam: Camera, size: { w: number; h: number }, opts: { radius: number; look: Look; ghost?: number; t?: number; time?: number; glow?: number }) {
    const ctx = this.ctx;
    const ghost = opts.ghost ?? 0xf2b45a;
    if (this.dirty) {
      this.paintBoard(ghost);
      this.dirty = false;
    }
    const p = LOOKS[opts.look];
    const W = size.w;
    const H = size.h;
    const R = opts.radius > 0 ? opts.radius : Math.hypot(W, H) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (opts.radius > 0) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, opts.radius, 0, Math.PI * 2);
      ctx.clip();
    }
    // Agar: lit in the middle, deep at the edge, as the lamp falls on it.
    const lamp = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, R * 1.1);
    lamp.addColorStop(0, rgb(p.agarLit, 0.92));
    lamp.addColorStop(1, rgb(p.agarDeep));
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);

    const z = cam.zoom;
    // Visible cell range; the dish is a torus, so tiles repeat in every direction.
    const x0 = cam.cx - W / 2 / z;
    const y0 = cam.cy - H / 2 / z;
    const x1 = cam.cx + W / 2 / z;
    const y1 = cam.cy + H / 2 / z;
    const toX = (cx: number) => (cx - cam.cx) * z + W / 2;
    const toY = (cy: number) => (cy - cam.cy) * z + H / 2;

    if (z < 5) {
      // Far out: the board image scaled up is cheaper and reads the same.
      ctx.imageSmoothingEnabled = z < 2;
      for (let ty = Math.floor(y0 / this.h); ty <= Math.floor(y1 / this.h); ty++)
        for (let tx = Math.floor(x0 / this.w); tx <= Math.floor(x1 / this.w); tx++)
          ctx.drawImage(this.board, toX(tx * this.w), toY(ty * this.h), this.w * z, this.h * z);
    } else {
      // Close up: each cell is a bead with a soft shadow and a highlight, batched per colour.
      const paths = new Map<number, Path2D>();
      const shine = new Path2D();
      const shade = new Path2D();
      const ring = new Path2D();
      const rad = z * 0.5;
      for (let cy = Math.floor(y0) - 1; cy <= Math.ceil(y1); cy++) {
        const wy = ((cy % this.h) + this.h) % this.h;
        for (let cx = Math.floor(x0) - 1; cx <= Math.ceil(x1); cx++) {
          const wx = ((cx % this.w) + this.w) % this.w;
          const i = wy * this.w + wx;
          const id = this.cells[i];
          const ov = this.overlay[i];
          const key = id ? id : ov === 1 || ov === 4 ? -1 : ov === 2 ? -2 : 0;
          if (!key) continue;
          const sx = toX(cx + 0.5);
          const sy = toY(cy + 0.5);
          let path = paths.get(key);
          if (!path) paths.set(key, (path = new Path2D()));
          path.moveTo(sx + rad, sy);
          path.arc(sx, sy, rad, 0, Math.PI * 2);
          if (id && ov === 4) {
            ring.moveTo(sx + rad * 1.18, sy);
            ring.arc(sx, sy, rad * 1.18, 0, Math.PI * 2);
          }
          if (id) {
            shade.moveTo(sx + rad * 1.05, sy + rad * 0.18);
            shade.arc(sx + rad * 0.1, sy + rad * 0.18, rad * 1.05, 0, Math.PI * 2);
            shine.moveTo(sx - rad * 0.3 + rad * 0.26, sy - rad * 0.34);
            shine.arc(sx - rad * 0.3, sy - rad * 0.34, rad * 0.26, 0, Math.PI * 2);
          }
        }
      }
      ctx.fillStyle = "rgba(10,4,0,0.35)";
      ctx.fill(shade);
      paths.forEach((path, key) => {
        ctx.globalAlpha = key === -1 ? 0.75 : 1;
        ctx.fillStyle = key === -1 ? hex(ghost) : key === -2 ? "#f2485c" : hex(this.palette.get(key) ?? 0xd8c8b0);
        ctx.fill(path);
      });
      ctx.globalAlpha = 1;
      ctx.fillStyle = "rgba(255,250,240,0.55)";
      ctx.fill(shine);
      ctx.strokeStyle = "rgba(255,246,228,0.85)";
      ctx.lineWidth = Math.max(1, rad * 0.16);
      ctx.stroke(ring);
    }

    // Vignette, as the lens darkens towards its rim.
    const vign = ctx.createRadialGradient(W / 2, H / 2, R * 0.5, W / 2, H / 2, R);
    vign.addColorStop(0, "rgba(0,0,0,0)");
    vign.addColorStop(1, `rgba(0,0,0,${opts.look === "plate" ? 0.16 : 0.42})`);
    ctx.fillStyle = vign;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (opts.radius > 0) {
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, opts.radius - 1, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,247,230,0.35)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  dispose() {
    this.board.width = this.board.height = 0;
  }
}
