"use client";
// The live dish in the browser.
//
// The contract stores the board at the last generation someone advanced to. Time keeps running after that, and the
// rules are deterministic, so this store loads the stored board into petri-core (WASM) and steps it forward to the
// generation the clock says is due. When the plant log grows, it reloads the stored board and steps forward again.

import { useSyncExternalStore } from "react";
import { Engine, loadEngine } from "@/engine";
import { getAllColonies, getAllEarnings, getBoard, getPlants, getRules, getStakes, getState, type Colony, type DishState, type PlantRecord, type Rules } from "./chain";

export type Snapshot = {
  status: "loading" | "ready" | "error";
  error?: string;
  rules?: Rules;
  state?: DishState;
  colonies: Colony[];
  generation: number;
  dueGeneration: number;
  cells?: Uint16Array;
  prevCells?: Uint16Array;
  changedAt: number;
  liveCounts: number[];
  totalLive: number;
  /** Cells the last feed counted: prices and per-cell earnings use this. */
  counted: number;
  births: number[];
  deaths: number[];
  chain: string;
  /** Milliseconds until the next generation is due. */
  nextInMs: number;
  /** When the chain was last read. */
  syncedAt: number;
  /** Generations the browser is ahead of the stored board. */
  ahead: number;
  /** PETRI units each colony has earned since the stored board (index = colony id); paid when the dish next advances. */
  pending: number[];
  /** The latest plantings, newest first. */
  recentPlants: PlantRecord[];
  /** PETRI units in the agar at the browser's generation. */
  agar: number;
  /** Each colony's lifetime earnings at the stored board, claimed or not (index = colony id). */
  earnings: number[];
};

const empty: Snapshot = {
  status: "loading",
  colonies: [],
  generation: 0,
  dueGeneration: 0,
  changedAt: 0,
  liveCounts: [],
  totalLive: 0,
  counted: 0,
  births: [],
  deaths: [],
  chain: "",
  nextInMs: 0,
  syncedAt: 0,
  ahead: 0,
  pending: [],
  recentPlants: [],
  agar: 0,
  earnings: [],
};

let snap: Snapshot = empty;
const listeners = new Set<() => void>();
let engine: Engine | null = null;
let started = false;
let clockOffset = 0;
let knownPlants = "";
let knownColonies = -1;
let storedGeneration = 0;

function emit(patch: Partial<Snapshot>) {
  snap = { ...snap, ...patch };
  if (typeof window !== "undefined") (window as unknown as { __petri: Snapshot }).__petri = snap;
  listeners.forEach((l) => l());
}

function nowChain(): number {
  return Date.now() + clockOffset;
}

function dueFor(rules: Rules, state: DishState): number {
  return Math.floor((nowChain() - Number(state.epoch_ms)) / Number(rules.generation_ms));
}

async function loadStored(rules: Rules, state: DishState, colonies: Colony[]) {
  const board = await getBoard();
  const stakes: string[] = [];
  // The view returns at most 2,000 a call.
  for (let from = 0; from < colonies.length; from += 2000) stakes.push(...(await getStakes(from, 2000)));
  const e = new Engine(rules.width, rules.height, rules.feed_ppm, rules.keeper_bps, rules.reach, rules.live_floor, rules.stake_keep_bps);
  e.set_counted(state.counted);
  e.set_colonies(colonies.length);
  // Each colony's pay cap grows with the cells it has planted, so the browser's feed needs those counts.
  e.set_stakes(new BigUint64Array(stakes.map((v) => BigInt(v))));
  e.set_house(new Uint16Array(state.house));
  e.set_agar(state.agar);
  if (!e.load_compact(board, Number(state.generation), state.chain)) throw new Error("The stored board could not be read");
  engine?.free();
  engine = e;
  storedGeneration = Number(state.generation);
}

function advanceTo(due: number, force = false) {
  if (!engine) return;
  const g = engine.generation();
  if (g >= due && !force) return;
  const prev = snap.cells ?? engine.cells();
  // Large gaps are stepped in one go; the renderer only animates the last generation.
  const n = Math.max(0, due - g);
  if (n > 1) engine.step(n - 1);
  const before = engine.cells();
  if (n >= 1) engine.step(1);
  emit({
    generation: engine.generation(),
    cells: engine.cells(),
    prevCells: n >= 1 ? before : prev,
    changedAt: performance.now(),
    liveCounts: Array.from(engine.live_counts()),
    totalLive: engine.total_live(),
    counted: engine.counted(),
    births: Array.from(engine.last_births()),
    deaths: Array.from(engine.last_deaths()),
    chain: engine.chain_hex(),
    ahead: engine.generation() - storedGeneration,
    pending: Array.from(engine.earned()),
    agar: Number(engine.agar()),
  });
}

async function sync(first = false) {
  const [rules, state] = await Promise.all([snap.rules ? Promise.resolve(snap.rules) : getRules(), getState()]);
  if (first) clockOffset = Number(state.now_ms) - Date.now();
  const plantKey = `${state.ledger}:${state.colonies}`;
  // Colonies are re-read whenever the ledger moves: a planting changes the planter's pay cap.
  const coloniesChanged = state.colonies !== knownColonies || plantKey !== knownPlants;
  const colonies = coloniesChanged ? await getAllColonies(state.colonies) : snap.colonies;
  if (first || plantKey !== knownPlants || !engine) {
    await loadStored(rules, state, colonies);
    const total = Number(state.plants);
    const [recent, earned] = await Promise.all([
      total > 0 ? getPlants(Math.max(0, total - 24), 24) : Promise.resolve([] as PlantRecord[]),
      getAllEarnings(state.colonies),
    ]);
    emit({ recentPlants: recent.reverse(), earnings: [0, ...earned.map(Number)] });
    knownPlants = plantKey;
    knownColonies = state.colonies;
    const due = dueFor(rules, state);
    emit({ rules, state, colonies, status: "ready", syncedAt: Date.now(), dueGeneration: due });
    advanceTo(due, true);
  } else {
    emit({ state, colonies, syncedAt: Date.now() });
  }
}

function tick() {
  const { rules, state } = snap;
  if (!rules || !state || !engine) return;
  const due = dueFor(rules, state);
  const genMs = Number(rules.generation_ms);
  const nextInMs = genMs - ((nowChain() - Number(state.epoch_ms)) % genMs);
  if (due > engine.generation()) {
    emit({ dueGeneration: due, nextInMs });
    advanceTo(due);
  } else if (Math.abs(nextInMs - snap.nextInMs) > 400) {
    emit({ nextInMs, dueGeneration: due });
  }
}

export function startDish() {
  if (started || typeof window === "undefined") return;
  started = true;
  (async () => {
    try {
      await loadEngine();
      await sync(true);
    } catch (e) {
      emit({ status: "error", error: e instanceof Error ? e.message : String(e) });
    }
    setInterval(tick, 250);
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          await sync();
          if (snap.status === "error") emit({ status: "ready", error: undefined });
        } catch (e) {
          if (snap.status !== "ready") emit({ status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
      setTimeout(poll, 5000);
    };
    setTimeout(poll, 5000);
  })();
}

/** Re-read the chain now, e.g. right after a planting lands. */
export async function refreshDish() {
  try {
    await sync();
  } catch {
    /* the next poll retries */
  }
}

/** The engine itself, for checks that must match the contract (planting validity). */
export function currentEngine(): Engine | null {
  return engine;
}

export function useDish(): Snapshot {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      startDish();
      return () => listeners.delete(l);
    },
    () => snap,
    () => empty,
  );
}
