"use client";
// Whether the dish sings, how loud, and who is feeding it. Tiny and always loaded; the audio engine (sound.ts) and the
// board analysis are imported only once someone turns sound on, and the audio context is closed when it is turned off.
//
// Two sources can feed it: the live dish (the default) and the cinema's fast-forward, which takes over while it runs.
// Each generation is sung once, however many controls are on the page.

import { useSyncExternalStore } from "react";
import type { DishSound, SoundLog } from "./sound";
import type { GenReport } from "./analysis";

const KEY = "petri.sound.v1";

type Prefs = { on: boolean; volume: number };
type State = Prefs & {
  /** On, but waiting for the first click or key press of this visit (browsers start audio only after one). */
  waiting: boolean;
  loading: boolean;
  reduced: boolean;
};

const SERVER: State = { on: false, volume: 0.7, waiting: false, loading: false, reduced: false };
let state: State = SERVER;
const listeners = new Set<() => void>();
let engine: DishSound | null = null;
let booted = false;
let override: "live" | "forecast" = "live";
const lastSung: Record<string, number> = {};
let analyzeMod: typeof import("./analysis") | null = null;
const kicks = new Set<() => void>();

/** Called when sound starts, so a source can sing the generation already on screen. */
export function onSoundStart(fn: () => void) {
  kicks.add(fn);
  return () => {
    kicks.delete(fn);
  };
}

function emit(p: Partial<State>) {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ on: state.on, volume: state.volume }));
  } catch {
    /* this visit only */
  }
}

function boot() {
  if (booted || typeof window === "undefined") return;
  booted = true;
  let prefs: Prefs = { on: false, volume: 0.7 };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) prefs = { ...prefs, ...JSON.parse(raw) };
  } catch {
    /* defaults */
  }
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  state = { ...state, ...prefs, reduced, waiting: prefs.on };
  if (prefs.on) {
    // Remembered as on: start at the first gesture of this visit.
    const go = () => {
      window.removeEventListener("pointerdown", go, true);
      window.removeEventListener("keydown", go, true);
      if (state.on && !engine) void startEngine();
    };
    window.addEventListener("pointerdown", go, true);
    window.addEventListener("keydown", go, true);
  }
  document.addEventListener("visibilitychange", () => {
    if (!engine) return;
    if (document.hidden) engine.suspend();
    else engine.resume();
  });
}

async function startEngine() {
  if (engine || state.loading) return;
  emit({ loading: true });
  try {
    const [{ DishSound }, an] = await Promise.all([import("./sound"), import("./analysis")]);
    analyzeMod = an;
    if (!state.on) return;
    engine = new DishSound(state.volume);
    engine.reduced = state.reduced;
    await engine.start();
    (window as unknown as { __petriSound: unknown }).__petriSound = {
      stats: () => engine?.stats(),
      log: () => engine?.log ?? [],
    };
    emit({ waiting: false });
    // Sing the generation on screen now rather than waiting up to a generation for the first notes.
    kicks.forEach((k) => k());
  } catch {
    engine = null;
    emit({ on: false, waiting: false });
  } finally {
    emit({ loading: false });
  }
}

export function setSound(on: boolean) {
  boot();
  emit({ on, waiting: false });
  save();
  if (on) void startEngine();
  else if (engine) {
    const e = engine;
    engine = null;
    void e.stop();
  }
}

export function setVolume(v: number) {
  boot();
  emit({ volume: Math.max(0, Math.min(1, v)) });
  save();
  engine?.setVolume(state.volume);
}

/** The cinema's fast-forward takes the voice while it runs; the live dish gets it back after. */
export function setSoundSource(s: "live" | "forecast") {
  override = s;
}

export type SingMeta = {
  colors: Map<number, number>;
  mine?: number | null;
  w: number;
  h: number;
  barSec: number;
  tideEvery: number;
  ear?: number;
  maxNotes?: number;
};

/**
 * A new generation from `source`. Sung only while sound is on and this source has the voice, once per generation.
 * Returns the analysis when it ran (the cinema reuses it).
 */
export function feedGeneration(source: "live" | "forecast", prev: Uint16Array, now: Uint16Array, generation: number, meta: SingMeta, report?: GenReport): GenReport | null {
  if (!engine || source !== override || (!report && !analyzeMod)) return null;
  if ((lastSung[source] ?? -1) >= generation) return null;
  lastSung[source] = generation;
  if (!report) report = analyzeMod!.analyze(prev, now, meta.w, meta.h, generation);
  const tideIn = meta.tideEvery - (generation % meta.tideEvery);
  engine.sing({ report, ...meta, tideIn });
  return report;
}

export function soundLog(): SoundLog[] {
  return engine?.log ?? [];
}

export function useSound(): State {
  return useSyncExternalStore(
    (l) => {
      boot();
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => SERVER,
  );
}
