"use client";
// Cinema: the live dish full screen, shot like a nature film. A slow camera drifts to where things are happening (two
// colonies fighting at a border, the colony growing fastest, a glider in flight, the largest colony, the whole plate),
// the edges of the frame go soft, and captions fade in under each shot from what the chain shows. Live by default;
// Fast-forward plays the same rules ahead in this browser (WASM), clearly labelled, at sixty times the speed.
// Loaded only when someone opens it.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import { useLive, hex } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { currentEngine } from "@/lib/dish-store";
import { strainOf, sideOf } from "@/lib/strains";
import type { Engine } from "@/engine";
import { analyze, ringDelta, type GenReport } from "./analysis";
import { Director, type Caption, type ColonyInfo, type World } from "./director";
import { feedGeneration, setSound, setSoundSource, useSound } from "./sound-store";
import { useLiveFeed } from "./live-feed";
import { SoundToggle } from "./SoundToggle";
import s from "./cinema.module.css";

const TimelapsePanel = lazy(() => import("./TimelapsePanel"));

const FF_STEP_MS = 250;
const FF_MAX = 4000;
const int = (n: number) => Math.round(n).toLocaleString("en-US");

type FF = { cells: Uint16Array; prev: Uint16Array; changedAt: number; generation: number; ahead: number };

export type CinemaProps = {
  onClose: () => void;
  mine?: number | null;
  focus?: number | null;
  /** Start with every control hidden (for recording). */
  clean?: boolean;
  /** Start in fast-forward. */
  fast?: boolean;
};

export default function Cinema({ onClose, mine, focus, clean = false, fast = false }: CinemaProps) {
  const { d, rules, palette, colonies, w, h, tideIn } = useLive();
  const net = useNet();
  const sound = useSound();
  const root = useRef<HTMLDivElement>(null);
  const lens = useRef<CultureHandle>(null);
  const dof = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"live" | "ff">(fast ? "ff" : "live");
  const [ff, setFf] = useState<FF | null>(null);
  const [captions, setCaptions] = useState(true);
  const [bare, setBare] = useState(clean);
  const [idle, setIdle] = useState(false);
  const [caption, setCaption] = useState<Caption | null>(null);
  const [capShown, setCapShown] = useState(false);
  const [rec, setRec] = useState(false);
  const director = useRef(new Director());
  const cam = useRef({ x: w / 2, y: h / 2, z: Math.log(120), vx: 0, vy: 0, vz: 0, ready: false });
  const reduce = useRef(false);
  const worldRef = useRef<World | null>(null);

  // The live dish keeps singing while cinema is open (the store sings each generation once, whoever asks).
  useLiveFeed({ mine, ear: () => ((cam.current.x % w) + w) % w });

  const info = useMemo(() => {
    const m = new Map<number, ColonyInfo>();
    for (const c of d.colonies) {
      const strain = strainOf(c.account);
      const side = sideOf(c.account, c.house);
      const role = c.id === mine ? "Your colony" : strain ? `the ${strain.temperament.toLowerCase()} strain` : side === "house" ? "House colony" : side === "bench" ? "Bench colony" : "A player's colony";
      const earned = (Number(d.earnings[c.id] ?? 0) || 0) + (d.pending[c.id] ?? 0);
      const last = c.last_plant_generation != null ? d.generation - Number(c.last_plant_generation) : null;
      m.set(c.id, { id: c.id, name: c.name, color: c.color, role, earned, age: Math.max(0, d.generation - Number(c.joined_generation)), sinceLastPlant: last != null && last >= 0 ? last : null });
    }
    return m;
  }, [d.colonies, d.earnings, d.pending, d.generation, mine]);

  const cells = mode === "ff" && ff ? ff.cells : d.cells;
  const prevCells = mode === "ff" && ff ? ff.prev : d.prevCells;
  const changedAt = mode === "ff" && ff ? ff.changedAt : d.changedAt;
  const generation = mode === "ff" && ff ? ff.generation : d.generation;

  worldRef.current = {
    w,
    h,
    generation,
    live: d.totalLive,
    colonyCount: colonies.filter((c) => c.live > 0).length,
    info,
    netLabel: `NEAR ${net.network}`,
    forecast: mode === "ff",
    ahead: ff?.ahead ?? 0,
    tideIn,
    mine,
    focus,
  };

  // Each new generation: the director learns what happened.
  const onReport = useCallback((r: GenReport) => {
    if (worldRef.current) director.current.observe(r, worldRef.current);
  }, []);

  // Live generations.
  useEffect(() => {
    if (mode !== "live" || !d.cells || !d.prevCells) return;
    onReport(analyze(d.prevCells, d.cells, w, h, d.generation));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, d.generation, d.cells]);

  // Fast-forward: a copy of the browser's engine, stepped four generations a second. The live dish is untouched.
  useEffect(() => {
    if (mode !== "ff") return;
    const base = currentEngine();
    if (!base) {
      // The dish is still being read: try again in a moment (opened with ?cinema=fast before it loaded).
      const t = setTimeout(() => setMode("live"), 20000);
      const p = setInterval(() => {
        if (currentEngine()) {
          clearInterval(p);
          clearTimeout(t);
          setMode("live");
          setTimeout(() => setMode("ff"), 0);
        }
      }, 300);
      return () => {
        clearInterval(p);
        clearTimeout(t);
      };
    }
    let e: Engine | null = base.clone_engine();
    const start = e.generation();
    let last = e.cells();
    setSoundSource("forecast");
    director.current.cut();
    const colors = new Map(palette);
    const t = setInterval(() => {
      if (!e) return;
      if (document.hidden) return;
      if (e.generation() - start >= FF_MAX) {
        e.free();
        e = base.clone_engine();
        last = e.cells();
      }
      e.step(1);
      const now = e.cells();
      const gen = e.generation();
      const r = analyze(last, now, w, h, gen);
      onReport(r);
      // Sung every other generation, a few notes at a time: sixty times faster must still sound calm.
      if (rules && gen % 2 === 0) feedGeneration("forecast", last, now, gen, { colors, mine, w, h, barSec: (FF_STEP_MS * 2) / 1000, tideEvery: rules.tide_every, ear: ((cam.current.x % w) + w) % w, maxNotes: 2 }, r);
      setFf({ cells: now, prev: last, changedAt: performance.now(), generation: gen, ahead: gen - start });
      last = now;
    }, FF_STEP_MS);
    return () => {
      clearInterval(t);
      e?.free();
      e = null;
      setSoundSource("live");
      setFf(null);
      director.current.cut();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // The camera: a slow, damped glide to each shot, with a breath of drift so the frame is never quite still.
  useEffect(() => {
    reduce.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let shotAt = -1;
    let capTimer: ReturnType<typeof setTimeout> | null = null;
    let blurNow = -1;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const L = lens.current;
      const world = worldRef.current;
      if (!L || !world) return;
      const v = L.view();
      if (!v.w) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const hold = world.forecast ? 9 : 17;
      const shot = director.current.next(now, world, hold);
      const c = cam.current;
      if (shot && shot.at !== shotAt) {
        shotAt = shot.at;
        // A new shot: the caption fades out, the camera moves, and the new caption fades in once it has settled.
        setCapShown(false);
        if (capTimer) clearTimeout(capTimer);
        capTimer = setTimeout(() => {
          setCaption(shot.caption);
          setCapShown(!!shot.caption);
        }, reduce.current ? 600 : 2600);
        const outAt = shot.until - now - 1800;
        if (outAt > 3000) setTimeout(() => setCapShown(false), outAt);
        if (!c.ready || reduce.current) {
          // The first shot, or reduced motion: cut instead of gliding.
          c.x = shot.x;
          c.y = shot.y;
          c.z = Math.log(shot.across);
          c.vx = c.vy = c.vz = 0;
          c.ready = true;
        }
        const blur = Math.max(1.5, Math.min(7, 150 / shot.across));
        if (dof.current && Math.abs(blur - blurNow) > 0.3) {
          blurNow = blur;
          dof.current.style.setProperty("--blur", `${blur.toFixed(1)}px`);
        }
      }
      if (shot) {
        // Critically damped springs: position settles in about five seconds, zoom a little slower.
        const tx = c.x + ringDelta(c.x, shot.x, world.w);
        const ty = c.y + ringDelta(c.y, shot.y, world.h);
        const tz = Math.log(shot.across);
        const wp = world.forecast ? 1.1 : 0.75;
        const wz = world.forecast ? 0.8 : 0.55;
        c.vx += (wp * wp * (tx - c.x) - 2 * wp * c.vx) * dt;
        c.vy += (wp * wp * (ty - c.y) - 2 * wp * c.vy) * dt;
        c.vz += (wz * wz * (tz - c.z) - 2 * wz * c.vz) * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.z += c.vz * dt;
      }
      const across = Math.exp(c.z);
      const t = now / 1000;
      const breath = reduce.current ? 0 : across * 0.018;
      const bx = breath * Math.sin(t * 0.11) + breath * 0.5 * Math.sin(t * 0.047 + 1.3);
      const by = breath * Math.cos(t * 0.083 + 0.4);
      const bz = reduce.current ? 1 : 1 + 0.025 * Math.sin(t * 0.06);
      // Never wider than the dish on either axis: on a wide screen (16:10, 21:9) a wider shot would show the torus
      // wrapping, the same cluster twice side by side.
      const zoom = Math.max((Math.min(v.w, v.h) / across) * bz, v.w / world.w, v.h / world.h);
      L.centerOn((((c.x + bx) % world.w) + world.w) % world.w - 0.5, (((c.y + by) % world.h) + world.h) % world.h - 0.5, zoom);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      if (capTimer) clearTimeout(capTimer);
    };
  }, []);

  // Full screen when the browser allows it; leaving full screen (Esc) leaves cinema too.
  useEffect(() => {
    const el = root.current!;
    const prevFocus = document.activeElement as HTMLElement | null;
    el.focus();
    let entered = false;
    const onFs = () => {
      if (document.fullscreenElement === el) entered = true;
      else if (entered) onClose();
    };
    document.addEventListener("fullscreenchange", onFs);
    const gesture = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? true;
    if (!clean && gesture && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      if (document.fullscreenElement === el) document.exitFullscreen().catch(() => {});
      html.style.overflow = overflow;
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keys, caught before the page's own shortcuts: C or Esc leaves, M sound, F fast-forward, T captions, H hides all.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      const key = e.key.toLowerCase();
      let used = true;
      if (key === "escape" || key === "c") {
        if (rec && key === "escape") setRec(false);
        else onClose();
      } else if (key === "m") setSound(!soundOn.current);
      else if (key === "f") setMode((m) => (m === "ff" ? "live" : "ff"));
      else if (key === "t") setCaptions((c) => !c);
      else if (key === "h") setBare((b) => !b);
      else if (key === "n") director.current.cut();
      else if (key === "tab") {
        // Keep focus inside the cinema.
        const f = [...root.current!.querySelectorAll<HTMLElement>("button, input, select, a[href]")].filter((x) => !x.closest(`.${s.faded}`));
        if (f.length) {
          const i = f.indexOf(document.activeElement as HTMLElement);
          const n = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : i === f.length - 1 ? 0 : i + 1;
          f[n].focus();
        }
      } else used = false;
      if (used) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      wake();
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec]);
  const soundOn = useRef(sound.on);
  soundOn.current = sound.on;

  // The controls fade after a few still seconds and come back on any movement.
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useCallback(() => {
    setIdle(false);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), 2800);
  }, []);
  useEffect(() => {
    wake();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [wake]);

  const hideUi = bare || (idle && !rec);
  const showCap = captions && capShown && !!caption;
  const tideNote = mode === "live" && tideIn > 0 && tideIn <= 8;

  return (
    <div
      ref={root}
      className={`${s.root} ${s.bars} ${hideUi ? s.idle : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label="Cinema: the live dish full screen"
      tabIndex={-1}
      onPointerMove={wake}
      onPointerDown={wake}
    >
      <div className={s.stage}>
        <Culture
          ref={lens}
          width={w}
          height={h}
          cells={cells}
          prevCells={prevCells}
          changedAt={changedAt}
          palette={palette}
          look="macro"
          fit="cover"
          maxDpr={1.25}
          transitionMs={mode === "ff" ? FF_STEP_MS * 0.95 : 2400}
          label={`Cinema view of the dish at generation ${int(generation)}`}
        />
      </div>
      <div ref={dof} className={s.dof} aria-hidden="true" />
      <div className={s.vignette} aria-hidden="true" />
      <div className={s.grain} aria-hidden="true" />
      {!d.cells && <div className={s.loading}>Reading the dish from NEAR…</div>}

      <div className={`${s.slate} ${bare ? s.faded : ""}`}>
        <span className={s.mark}>Petri Dish</span>
        {mode === "live" ? (
          <span className={s.meta}>
            <i className={s.dot} aria-hidden="true" />
            Live · NEAR {net.network} · generation {int(generation)}
            {tideNote ? ` · tide in ${tideIn}` : ""}
          </span>
        ) : (
          <>
            <span className={s.meta}>
              <i className={`${s.dot} ${s.ff}`} aria-hidden="true" />
              Fast-forward ×60 · {int(ff?.ahead ?? 0)} generations ahead
            </span>
            <span className={`${s.meta} ${s.note}`}>Played ahead in this browser by the contract&rsquo;s own rules, as if nobody planted. The live dish is unchanged.</span>
          </>
        )}
      </div>

      <div className={`${s.caption} ${showCap ? s.show : ""}`} aria-live="polite">
        {caption && (
          <>
            <span className={s.kicker}>
              {caption.swatch != null && <i style={{ background: hex(caption.swatch) }} aria-hidden="true" />}
              {caption.kicker}
            </span>
            <p className={s.title}>{caption.title}</p>
            {caption.sub && (
              <>
                <span className={s.rule} aria-hidden="true" />
                <p className={s.sub}>{caption.sub}</p>
              </>
            )}
          </>
        )}
      </div>

      <div className={`${s.controls} ${hideUi ? s.faded : ""}`}>
        <span className={s.seg} role="group" aria-label="Time">
          <button type="button" aria-pressed={mode === "live"} onClick={() => setMode("live")}>Live</button>
          <button type="button" aria-pressed={mode === "ff"} onClick={() => setMode("ff")} title="Play the rules ahead at sixty times the speed (F)"><span className={s.long}>Fast-forward</span><span className={s.short}>×60</span></button>
        </span>
        <SoundToggle compact />
        <button type="button" className={s.wide} aria-pressed={captions} onClick={() => setCaptions((c) => !c)} title="Captions (T)">Captions</button>
        <button type="button" aria-pressed={rec} onClick={() => setRec((r) => !r)} title="Record a time-lapse">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="#ff6a4d" /></svg>
          Time-lapse
        </button>
        <button type="button" className={s.close} onClick={onClose} aria-label="Leave cinema (C or Esc)">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>

      {rec && (
        <div className={s.panel}>
          <Suspense fallback={null}>
            <TimelapsePanel onClose={() => setRec(false)} focus={focus ?? null} mine={mine ?? null} />
          </Suspense>
        </div>
      )}

      <p className={`${s.help} ${hideUi ? s.faded : ""}`} aria-hidden="true">
        <kbd>C</kbd> leave · <kbd>F</kbd> fast-forward · <kbd>M</kbd> sound · <kbd>T</kbd> captions · <kbd>N</kbd> next shot · <kbd>H</kbd> hide all
      </p>
      <span className={`${s.watermark} ${hideUi ? "" : s.faded}`} aria-hidden="true">playpetri.xyz</span>
    </div>
  );
}
