"use client";
// The live dish in the browser.
//
// The contract stores the board at the last generation someone advanced to. Time keeps running after that, and the
// rules are deterministic, so this store loads the stored board into petri-core (WASM) and steps it forward to the
// generation the clock says is due. When the plant log grows, it reloads the stored board and steps forward again.
// A dish more than max_lag behind is asleep: the contract's next call skips ahead and runs only max_catchup generations
// (projection.mjs), so the browser steps only those, with their feed, and says how many the next call skips.
//
// The chain is read through the site's snapshot (/api/snapshot, shared by every visitor through the CDN): a small
// `part=head` poll every five seconds, and the whole snapshot only when the ledger moved. The browser reads RPC itself
// only for the clock once, if the snapshot cannot answer, and right after its own move (refreshDish).

import { useSyncExternalStore } from "react";
import { Engine, loadEngine } from "@/engine";
import { getBoard, getColonies, getEarnings, getPlants, getRules, getStakes, getState, type Colony, type DishState, type PlantRecord, type Rules } from "./chain";
import { NETWORK } from "./config";
import { projectTarget } from "./projection.mjs";

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
  /** More than max_lag behind the clock: the board shown is the stored one plus max_catchup generations, and the next
   * call skips `skipNext` generations (no Life, no feed) before it runs them. */
  asleep: boolean;
  skipNext: number;
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
  asleep: false,
  skipNext: 0,
};

let snap: Snapshot = empty;
const listeners = new Set<() => void>();
let engine: Engine | null = null;
let started = false;
let clockOffset = 0;
/** The clock offset came from a live `state` read rather than the snapshot's estimate. */
let clockFromChain = false;
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

/** Every page of a paged view, requested at once rather than one after another. */
function pages<T>(total: number, size: number, page: (from: number, limit: number) => Promise<T[]>): Promise<T[]> {
  const n = Math.ceil(total / size);
  return Promise.all(Array.from({ length: n }, (_, i) => page(i * size, size))).then((p) => p.flat().slice(0, total));
}

/** Everything the board is rebuilt from, read together. */
type Inputs = { rules: Rules; state: DishState; board: Uint8Array; colonies: Colony[]; stakes: string[]; earned: string[]; recent: PlantRecord[] };

/** The WASM engine, loading alongside the first chain reads instead of before them. */
let engineReady: Promise<unknown> | null = null;

function loadStored({ rules, state, colonies, board, stakes }: Inputs) {
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

/** Step the board to where the contract's next catch-up would leave it for the clock's `due` generation. */
function advanceTo(due: number, force = false) {
  if (!engine || !snap.rules) return;
  const lag = projectTarget(storedGeneration, due, snap.rules);
  if (lag.asleep !== snap.asleep || lag.skip !== snap.skipNext) emit({ asleep: lag.asleep, skipNext: lag.skip });
  due = lag.target;
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

async function apply(inp: Inputs) {
  await engineReady;
  const { rules, state, colonies } = inp;
  loadStored(inp);
  emit({ recentPlants: [...inp.recent].reverse(), earnings: [0, ...inp.earned.map(Number)] });
  knownPlants = `${state.ledger}:${state.colonies}`;
  knownColonies = state.colonies;
  const due = dueFor(rules, state);
  emit({ rules, state, colonies, status: "ready", syncedAt: Date.now(), dueGeneration: due });
  advanceTo(due, true);
  knownPlants = `${state.ledger}:${state.colonies}`;
}

async function sync(first = false) {
  const [rules, state] = await Promise.all([snap.rules ? Promise.resolve(snap.rules) : getRules(), getState()]);
  if (first) {
    clockOffset = Number(state.now_ms) - Date.now();
    clockFromChain = true;
  }
  const plantKey = `${state.ledger}:${state.colonies}`;
  // The board is rebuilt whenever the ledger moves (a planting also changes the planter's pay cap). All of its inputs
  // are independent views, so they are read in parallel: one round trip instead of five.
  if (plantKey !== knownPlants || !engine) {
    const total = Number(state.plants);
    const [colonies, board, stakes, recent, earned] = await Promise.all([
      state.colonies !== knownColonies || plantKey !== knownPlants ? pages(state.colonies, 500, getColonies) : Promise.resolve(snap.colonies),
      getBoard(),
      // The view returns at most 2,000 a call.
      pages(state.colonies, 2000, getStakes),
      total > 0 ? getPlants(Math.max(0, total - 24), 24) : Promise.resolve([] as PlantRecord[]),
      pages(state.colonies, 500, getEarnings),
    ]);
    await apply({ rules, state, board, colonies, stakes, earned, recent });
  } else {
    emit({ state, syncedAt: Date.now() });
  }
}

/** A snapshot URL that changes every four seconds, so every visitor in those four seconds shares one CDN answer. */
const snapUrl = (head: boolean) => `/api/snapshot?net=${NETWORK}${head ? "&part=head" : ""}&t=${Math.floor(Date.now() / 4000)}`;

/** Carry the chain's clock forward by how long the snapshot sat in the server's cache and the CDN, and half the trip. */
function clockFrom(j: { state: DishState; at: number; servedAt: number }, res: Response, t0: number) {
  if (clockFromChain) return;
  const age = Number(res.headers.get("age") ?? 0) * 1000;
  clockOffset = Number(j.state.now_ms) + (Number(j.servedAt) - Number(j.at)) + (Number.isFinite(age) ? age : 0) + (Date.now() - t0) / 2 - Date.now();
}

/**
 * The site's own five-second snapshot of the same views (/api/snapshot): the first paint, and again whenever the
 * ledger moves. Returns false when it could not be read.
 */
async function fromSnapshot(): Promise<boolean> {
  const t0 = Date.now();
  const res = await fetch(snapUrl(false), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const j = await res.json();
  if (j.error || !j.state || !j.rules) throw new Error("no snapshot");
  clockFrom(j, res, t0);
  // An older snapshot than the board this page already holds (its own move was read straight from RPC) is skipped.
  if (engine && Number(j.state.ledger) < Number(snap.state?.ledger ?? 0)) return true;
  const bin = atob(j.board as string);
  const board = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) board[i] = bin.charCodeAt(i);
  await apply({ rules: j.rules, state: j.state, board, colonies: j.colonies, stakes: j.stakes, earned: j.earnings, recent: j.plants });
  return true;
}

/** The five-second poll: the snapshot's state only, and the whole snapshot when the ledger or the colonies moved. */
async function pollSnapshot() {
  const t0 = Date.now();
  const res = await fetch(snapUrl(true), { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const j = await res.json();
  if (j.error || !j.state) throw new Error("no snapshot");
  clockFrom(j, res, t0);
  const st = j.state as DishState;
  if (`${st.ledger}:${st.colonies}` !== knownPlants && Number(st.ledger) >= Number(snap.state?.ledger ?? 0)) await fromSnapshot();
  else if (Number(st.ledger) >= Number(snap.state?.ledger ?? 0)) emit({ state: st, syncedAt: Date.now() });
}

let settled: Promise<void> | null = null;
/** Resolves once the dish has been read (or failed), or after `maxMs`: other reads wait for it to stay off its path. */
export function dishSettled(maxMs = 4000): Promise<void> {
  if (snap.status !== "loading") return Promise.resolve();
  if (!settled)
    settled = new Promise<void>((done) => {
      const l = () => {
        if (snap.status !== "loading") {
          listeners.delete(l);
          done();
        }
      };
      listeners.add(l);
    });
  return Promise.race([settled, new Promise<void>((r) => setTimeout(r, maxMs))]);
}

function tick() {
  const { rules, state } = snap;
  if (!rules || !state || !engine) return;
  const due = dueFor(rules, state);
  const genMs = Number(rules.generation_ms);
  const nextInMs = genMs - ((nowChain() - Number(state.epoch_ms)) % genMs);
  const lag = projectTarget(storedGeneration, due, rules);
  if (lag.target > engine.generation()) {
    emit({ dueGeneration: due, nextInMs });
    advanceTo(due);
  } else if (due !== snap.dueGeneration || lag.skip !== snap.skipNext || Math.abs(nextInMs - snap.nextInMs) > 400) {
    emit({ nextInMs, dueGeneration: due, asleep: lag.asleep, skipNext: lag.skip });
  }
}

export function startDish() {
  if (started || typeof window === "undefined") return;
  started = true;
  (async () => {
    engineReady = loadEngine();
    let drawn = false;
    try {
      drawn = await fromSnapshot();
    } catch {
      drawn = false;
    }
    if (!drawn) {
      // The site's snapshot did not answer: read the chain directly.
      try {
        await sync(true);
      } catch (e) {
        if (snap.status !== "ready") emit({ status: "error", error: e instanceof Error ? e.message : String(e) });
      }
    } else {
      // One read of the chain's own clock, so the generation counter is exact (the snapshot's is a close estimate).
      getState()
        .then((st) => {
          clockOffset = Number(st.now_ms) - Date.now();
          clockFromChain = true;
        })
        .catch(() => {});
    }
    setInterval(tick, 250);
    let misses = 0;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          // Two misses in a row and the poll reads the chain directly until the snapshot answers again.
          if (misses >= 2) await sync();
          else await pollSnapshot();
          misses = 0;
          if (snap.status === "error") emit({ status: "ready", error: undefined });
        } catch (e) {
          misses++;
          if (misses > 2) {
            try {
              await pollSnapshot();
              misses = 0;
            } catch {
              /* keep the last board */
            }
          }
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
