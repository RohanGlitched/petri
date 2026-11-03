"use client";

import { useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";
import { EyepieceGL, type Camera } from "./eyepiece-gl";

export type EyepieceHandle = {
  centerOn: (x: number, y: number, zoom?: number) => void;
  fit: () => void;
  zoomBy: (factor: number) => void;
};

type Props = {
  width: number;
  height: number;
  cells?: Uint16Array;
  prevCells?: Uint16Array;
  changedAt: number;
  palette: Map<number, number>;
  overlay?: Uint8Array;
  interactive?: boolean;
  onHover?: (cell: { x: number; y: number } | null) => void;
  onCellClick?: (cell: { x: number; y: number }) => void;
  label?: string;
  /** Called with the camera whenever it moves (for minimaps and readouts). */
  onCamera?: (cam: Camera) => void;
  className?: string;
};

const TRANSITION_MS = 650;

export const Eyepiece = forwardRef<EyepieceHandle, Props>(function Eyepiece(props, ref) {
  const { width, height, cells, prevCells, changedAt, palette, overlay, interactive = true } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<EyepieceGL | null>(null);
  const camRef = useRef<Camera>({ cx: width / 2, cy: height / 2, zoom: 4 });
  const sizeRef = useRef({ w: 0, h: 0, css: 0, dpr: 1 });
  const rafRef = useRef(0);
  const changedRef = useRef(changedAt);
  const fitZoomRef = useRef(4);
  const [failed, setFailed] = useState<string | null>(null);
  const reduceMotion = useRef(false);
  const darkRef = useRef(false);
  const cbRef = useRef(props);
  cbRef.current = props;

  const requestDraw = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(frame);
  };

  function frame(now: number) {
    rafRef.current = 0;
    const g = glRef.current;
    if (!g) return;
    const s = sizeRef.current;
    const elapsed = now - changedRef.current;
    const t = reduceMotion.current ? 1 : Math.min(1, Math.max(0, elapsed / TRANSITION_MS));
    const radius = (s.css / 2) * s.dpr - 1;
    g.draw(camRef.current, { w: s.w, h: s.h }, radius, t, now / 1000, darkRef.current);
    const pending = cbRef.current.overlay?.includes(4);
    if (t < 1 || pending) requestDraw();
  }

  useImperativeHandle(ref, () => ({
    centerOn(x, y, zoom) {
      camRef.current = { cx: x + 0.5, cy: y + 0.5, zoom: zoom ?? Math.max(camRef.current.zoom, fitZoomRef.current * 3) };
      cbRef.current.onCamera?.(camRef.current);
      requestDraw();
    },
    fit() {
      camRef.current = { cx: width / 2, cy: height / 2, zoom: fitZoomRef.current };
      cbRef.current.onCamera?.(camRef.current);
      requestDraw();
    },
    zoomBy(f) {
      const c = camRef.current;
      c.zoom = clampZoom(c.zoom * f);
      cbRef.current.onCamera?.(c);
      requestDraw();
    },
  }));

  function clampZoom(z: number) {
    const s = sizeRef.current;
    return Math.min(48 * s.dpr, Math.max(fitZoomRef.current * 0.9, z));
  }

  // Set up GL and size.
  useEffect(() => {
    const canvas = canvasRef.current!;
    try {
      glRef.current = new EyepieceGL(canvas, width, height);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
      return;
    }
    reduceMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const readDark = () => {
      const forced = document.documentElement.dataset.theme;
      darkRef.current = forced ? forced === "dark" : mq.matches;
      requestDraw();
    };
    readDark();
    mq.addEventListener("change", readDark);
    const resize = () => {
      const el = wrapRef.current!;
      const css = Math.max(120, Math.floor(el.clientWidth));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(css * dpr);
      canvas.height = Math.floor(css * dpr);
      canvas.style.width = css + "px";
      canvas.style.height = css + "px";
      const first = sizeRef.current.css === 0;
      sizeRef.current = { w: canvas.width, h: canvas.height, css, dpr };
      // Fit: the whole square plate inside the round lens.
      fitZoomRef.current = (css * dpr) / (Math.max(width, height) * Math.SQRT2) * 0.98;
      if (first) camRef.current.zoom = fitZoomRef.current;
      else camRef.current.zoom = clampZoom(camRef.current.zoom);
      requestDraw();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);
    return () => {
      ro.disconnect();
      mq.removeEventListener("change", readDark);
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      glRef.current?.dispose();
      glRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

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
    const g = glRef.current;
    if (!g) return;
    g.setOverlay(overlay ?? new Uint8Array(width * height));
    requestDraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay]);

  // Pointer: drag to pan (the dish wraps, so panning never ends), wheel or pinch to zoom, hover to inspect.
  useEffect(() => {
    if (!interactive) return;
    const canvas = canvasRef.current!;
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = 0;
    let pinchStart = 0;
    let zoomStart = 0;

    const cellAt = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const s = sizeRef.current;
      const rx = (clientX - rect.left - rect.width / 2) * s.dpr;
      const ry = (clientY - rect.top - rect.height / 2) * s.dpr;
      if (Math.hypot(rx, ry) > (s.css / 2) * s.dpr) return null;
      const c = camRef.current;
      const x = Math.floor(c.cx + rx / c.zoom);
      const y = Math.floor(c.cy + ry / c.zoom);
      return { x: ((x % width) + width) % width, y: ((y % height) + height) % height };
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = 0;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y);
        zoomStart = camRef.current.zoom;
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) {
        if (e.pointerType === "mouse") cbRef.current.onHover?.(cellAt(e.clientX, e.clientY));
        return;
      }
      const s = sizeRef.current;
      if (pointers.size === 2) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchStart > 0) camRef.current.zoom = clampZoom((zoomStart * d) / pinchStart);
        moved += 10;
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
      const rect = canvas.getBoundingClientRect();
      const s = sizeRef.current;
      const rx = (e.clientX - rect.left - rect.width / 2) * s.dpr;
      const ry = (e.clientY - rect.top - rect.height / 2) * s.dpr;
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
  }, [interactive, width, height]);

  return (
    <div className={`eyepiece ${props.className ?? ""}`}>
      <div className="eyepiece-ring" aria-hidden="true" />
      <div ref={wrapRef} className="eyepiece-lens">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={props.label ?? "The Petri dish seen through the eyepiece"}
          className={interactive ? "eyepiece-canvas is-interactive" : "eyepiece-canvas"}
        />
        {failed && (
          <p className="eyepiece-fallback">
            This browser cannot draw the dish (WebGL2 is off). The numbers below are still live.
          </p>
        )}
      </div>
    </div>
  );
});
