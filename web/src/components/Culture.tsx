"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CultureGL, type Camera, type Look } from "./culture-gl";

export type CultureHandle = {
  centerOn: (x: number, y: number, zoom?: number) => void;
  fit: () => void;
  zoomBy: (factor: number) => void;
  camera: () => Camera;
  /** Size of the view in device px and the zoom that fits the whole dish in a circle of the shorter side. */
  view: () => { w: number; h: number; dpr: number; roundFit: number };
  /** Zoom relative to the round fit: 1 shows the whole dish in a circle, larger looks closer. */
  setZoomFit: (k: number) => void;
};

type Props = {
  width: number;
  height: number;
  cells?: Uint16Array;
  prevCells?: Uint16Array;
  changedAt: number;
  palette: Map<number, number>;
  look: Look;
  /** Round field of view (a dish or an objective lens) instead of filling the box. */
  round?: boolean;
  /** How the whole board fits at the starting zoom: inside the box, or covering it. */
  fit?: "contain" | "cover";
  /** Multiplies the fitted zoom, e.g. 3 for a close-up. */
  zoomScale?: number;
  /** Cells per second the view drifts across the torus when no one is touching it. */
  drift?: [number, number];
  start?: { x: number; y: number };
  overlay?: Uint8Array;
  /** Colour (0xRRGGBB) of the "fits here" ghost drawn for overlay code 1; amber by default. */
  ghost?: number;
  interactive?: boolean;
  onHover?: (cell: { x: number; y: number } | null) => void;
  onCellClick?: (cell: { x: number; y: number }) => void;
  /** Framing mode: a one-finger or mouse drag draws a rectangle instead of panning (Shift and drag still pans, two
   * fingers pinch and pan). Called as the drag moves and once more when it ends; a tap reports a == b. */
  select?: boolean;
  onSelect?: (a: { x: number; y: number }, b: { x: number; y: number }, done: boolean) => void;
  onCamera?: (cam: Camera) => void;
  label?: string;
  className?: string;
  maxDpr?: number;
  /** How long births and deaths take to animate. */
  transitionMs?: number;
};

const TRANSITION_MS = 700;

const roundFitOf = (w: number, h: number, width: number, height: number) => Math.min(w, h) / (Math.max(width, height) * Math.SQRT2);

/** Fluorescence wants brighter, purer channel colours than the stains chosen for a light plate. */
export function fluorPalette(p: Map<number, number>) {
  const m = new Map<number, number>();
  p.forEach((rgb, id) => {
    let r = ((rgb >> 16) & 255) / 255;
    let g = ((rgb >> 8) & 255) / 255;
    let b = (rgb & 255) / 255;
    const mx = Math.max(r, g, b, 0.001);
    r = Math.pow(r / mx, 1.6);
    g = Math.pow(g / mx, 1.6);
    b = Math.pow(b / mx, 1.6);
    const lift = 0.18;
    const to = (v: number) => Math.round(Math.min(1, v * (1 - lift) + lift) * 255);
    m.set(id, (to(r) << 16) | (to(g) << 8) | to(b));
  });
  return m;
}

export const Culture = forwardRef<CultureHandle, Props>(function Culture(props, ref) {
  const { width, height, cells, prevCells, changedAt, look, round = false, interactive = false } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<CultureGL | null>(null);
  const camRef = useRef<Camera>({ cx: props.start?.x ?? width / 2, cy: props.start?.y ?? height / 2, zoom: 4 });
  const sizeRef = useRef({ w: 0, h: 0, cssW: 0, cssH: 0, dpr: 1 });
  const rafRef = useRef(0);
  const changedRef = useRef(changedAt);
  const fitZoomRef = useRef(4);
  const bornAt = useRef(0);
  const lastFrame = useRef(0);
  const touchedAt = useRef(-1e9);
  const reduceMotion = useRef(false);
  const visible = useRef(true);
  const [failed, setFailed] = useState<string | null>(null);
  const cbRef = useRef(props);
  cbRef.current = props;

  const palette = useMemo(() => (look === "fluor" ? fluorPalette(props.palette) : props.palette), [look, props.palette]);

  const requestDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(frame);
  };

  function frame(now: number) {
    rafRef.current = 0;
    const g = glRef.current;
    if (!g) return;
    const s = sizeRef.current;
    const dt = lastFrame.current ? Math.min(0.1, (now - lastFrame.current) / 1000) : 0;
    lastFrame.current = now;
    const drift = cbRef.current.drift;
    const drifting = !!drift && !reduceMotion.current && visible.current && now - touchedAt.current > 4000;
    if (drifting) {
      const c = camRef.current;
      c.cx = (((c.cx + drift![0] * dt) % width) + width) % width;
      c.cy = (((c.cy + drift![1] * dt) % height) + height) % height;
    }
    const t = reduceMotion.current ? 1 : Math.min(1, Math.max(0, (now - changedRef.current) / (cbRef.current.transitionMs ?? TRANSITION_MS)));
    const glow = reduceMotion.current ? 1 : Math.min(1, (now - bornAt.current) / 1600);
    const radius = round ? (Math.min(s.cssW, s.cssH) / 2) * s.dpr - 1 : 0;
    g.draw(camRef.current, { w: s.w, h: s.h }, { radius, t, time: now / 1000, look: cbRef.current.look, glow, ghost: cbRef.current.ghost });
    const ov = cbRef.current.overlay;
    const pending = !!ov && !reduceMotion.current && (ov.includes(4) || ov.includes(1));
    if (t < 1 || pending || drifting || glow < 1) requestDraw();
    else lastFrame.current = 0;
  }

  function clampZoom(z: number) {
    const s = sizeRef.current;
    return Math.min(56 * s.dpr, Math.max(fitZoomRef.current * 0.8, z));
  }

  useImperativeHandle(ref, () => ({
    centerOn(x, y, zoom) {
      camRef.current = { cx: x + 0.5, cy: y + 0.5, zoom: clampZoom(zoom ?? Math.max(camRef.current.zoom, fitZoomRef.current * 3)) };
      touchedAt.current = performance.now();
      cbRef.current.onCamera?.(camRef.current);
      requestDraw();
    },
    fit() {
      camRef.current = { cx: width / 2, cy: height / 2, zoom: fitZoomRef.current * (cbRef.current.zoomScale ?? 1) };
      cbRef.current.onCamera?.(camRef.current);
      requestDraw();
    },
    zoomBy(f) {
      const c = camRef.current;
      c.zoom = clampZoom(c.zoom * f);
      touchedAt.current = performance.now();
      cbRef.current.onCamera?.(c);
      requestDraw();
    },
    camera: () => camRef.current,
    view: () => {
      const s = sizeRef.current;
      return { w: s.w, h: s.h, dpr: s.dpr, roundFit: roundFitOf(s.w, s.h, width, height) };
    },
    setZoomFit(k) {
      const s = sizeRef.current;
      if (!s.w) return;
      camRef.current.zoom = roundFitOf(s.w, s.h, width, height) * k;
      requestDraw();
    },
  }));

  useEffect(() => {
    const canvas = canvasRef.current!;
    try {
      glRef.current = new CultureGL(canvas, width, height);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    bornAt.current = performance.now();
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const resize = () => {
      const el = wrapRef.current!;
      const cssW = Math.max(60, Math.floor(el.clientWidth));
      const cssH = Math.max(60, Math.floor(el.clientHeight));
      const dpr = Math.min(cbRef.current.maxDpr ?? 2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      canvas.style.width = cssW + "px";
      canvas.style.height = cssH + "px";
      const first = sizeRef.current.cssW === 0;
      sizeRef.current = { w: canvas.width, h: canvas.height, cssW, cssH, dpr };
      const W = cssW * dpr;
      const H = cssH * dpr;
      if (round) fitZoomRef.current = roundFitOf(W, H, width, height);
      else if ((cbRef.current.fit ?? "contain") === "cover") fitZoomRef.current = Math.max(W / width, H / height);
      else fitZoomRef.current = Math.min(W / width, H / height);
      if (first) camRef.current.zoom = fitZoomRef.current * (cbRef.current.zoomScale ?? 1);
      else camRef.current.zoom = clampZoom(camRef.current.zoom);
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting) requestDraw();
    });
    io.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      io.disconnect();
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      glRef.current?.dispose();
      glRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, round]);

  useEffect(() => {
    const g = glRef.current;
    if (!g || !cells) return;
    g.setCells(cells, prevCells ?? cells);
    changedRef.current = changedAt;
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, prevCells, changedAt]);

  useEffect(() => {
    glRef.current?.setPalette(palette);
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palette]);

  useEffect(() => {
    glRef.current?.setOverlay(props.overlay ?? new Uint8Array(width * height));
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.overlay, props.ghost]);

  useEffect(() => {
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, props.drift]);

  // Drag to pan (the dish wraps, so panning never ends), wheel or pinch to zoom, hover and tap to inspect.
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchStart = 0;
    let zoomStart = 0;
    let selA: { x: number; y: number } | null = null;
    let lastMid: { x: number; y: number } | null = null;

    const toLens = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const s = sizeRef.current;
      return { rx: (clientX - rect.left - rect.width / 2) * s.dpr, ry: (clientY - rect.top - rect.height / 2) * s.dpr };
    };
    const cellAt = (clientX: number, clientY: number) => {
      const { rx, ry } = toLens(clientX, clientY);
      const s = sizeRef.current;
      if (round && Math.hypot(rx, ry) > (Math.min(s.cssW, s.cssH) / 2) * s.dpr) return null;
      const c = camRef.current;
      const x = Math.floor(c.cx + rx / c.zoom);
      const y = Math.floor(c.cy + ry / c.zoom);
      return { x: ((x % width) + width) % width, y: ((y % height) + height) % height };
    };
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      touchedAt.current = performance.now();
      moved = 0;
      selA = cbRef.current.select && pointers.size === 1 && !e.shiftKey ? cellAt(e.clientX, e.clientY) : null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = camRef.current.zoom;
        lastMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        selA = null;
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse") cbRef.current.onHover?.(cellAt(e.clientX, e.clientY));
        return;
      }
      touchedAt.current = performance.now();
      const s = sizeRef.current;
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) camRef.current.zoom = clampZoom((zoomStart * d) / pinchStart);
        // While framing, one finger draws, so two fingers also move the dish.
        if (cbRef.current.select && lastMid) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const c = camRef.current;
          c.cx = (((c.cx - ((mid.x - lastMid.x) * s.dpr) / c.zoom) % width) + width) % width;
          c.cy = (((c.cy - ((mid.y - lastMid.y) * s.dpr) / c.zoom) % height) + height) % height;
          lastMid = mid;
        }
        moved += 10;
      } else if (selA) {
        moved += Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y);
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const b = cellAt(e.clientX, e.clientY);
        if (b && moved >= 8) cbRef.current.onSelect?.(selA, b, false);
        if (e.pointerType === "mouse") cbRef.current.onHover?.(b);
        return;
      } else {
        const dx = (e.clientX - p.x) * s.dpr;
        const dy = (e.clientY - p.y) * s.dpr;
        moved += Math.abs(dx) + Math.abs(dy);
        const c = camRef.current;
        c.cx = (((c.cx - dx / c.zoom) % width) + width) % width;
        c.cy = (((c.cy - dy / c.zoom) % height) + height) % height;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (e.pointerType === "mouse") cbRef.current.onHover?.(cellAt(e.clientX, e.clientY));
      }
      cbRef.current.onCamera?.(camRef.current);
      requestDraw();
    };
    const up = (e: PointerEvent) => {
      const wasTap = pointers.size === 1 && moved < 8;
      if (selA && pointers.size === 1) {
        const a = selA;
        selA = null;
        pointers.delete(e.pointerId);
        cbRef.current.onSelect?.(a, wasTap ? a : cellAt(e.clientX, e.clientY) ?? a, true);
        return;
      }
      if (pointers.size <= 2) lastMid = null;
      pointers.delete(e.pointerId);
      if (wasTap) {
        const cell = cellAt(e.clientX, e.clientY);
        if (cell) {
          cbRef.current.onHover?.(cell);
          cbRef.current.onCellClick?.(cell);
        }
      }
    };
    const leave = () => cbRef.current.onHover?.(null);
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      touchedAt.current = performance.now();
      const { rx, ry } = toLens(e.clientX, e.clientY);
      const c = camRef.current;
      const before = { x: c.cx + rx / c.zoom, y: c.cy + ry / c.zoom };
      c.zoom = clampZoom(c.zoom * Math.exp(-e.deltaY * 0.0015));
      c.cx = before.x - rx / c.zoom;
      c.cy = before.y - ry / c.zoom;
      cbRef.current.onCamera?.(c);
      requestDraw();
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("pointerleave", leave);
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("wheel", wheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interactive, width, height, round]);

  return (
    <div ref={wrapRef} className={props.className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={props.label ?? "The live Petri dish"}
        style={{ display: "block", touchAction: interactive ? "none" : "auto", cursor: props.select ? "crosshair" : interactive ? "grab" : "default" }}
      />
      {failed && <p style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, textAlign: "center" }}>This browser cannot draw the dish (WebGL2 is off). The numbers are still live.</p>}
    </div>
  );
});
