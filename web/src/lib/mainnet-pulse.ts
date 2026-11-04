"use client";
// The mainnet dish at a glance, whichever dish this page reads. A visitor on the free testnet dish should still see
// that petri-dish.near is live, so this makes one `state` view on mainnet, keeps it for a few minutes (in memory and in
// sessionStorage, so moving between pages costs nothing), and counts generations forward from the chain's clock.
// When the page already reads mainnet, the live dish store has every number and no extra call is made.

import { useSyncExternalStore } from "react";
import { CONTRACTS, NETWORK, RPCS } from "./config";
import { useDish } from "./dish-store";

export type Pulse = {
  status: "loading" | "ready" | "error";
  /** The generation the chain's clock says is due on mainnet. */
  generation: number;
  colonies: number;
  live: number;
  /** yoctoNEAR waiting in the tide vault. */
  vault: number;
};

type Read = { due: number; epoch: number; offset: number; colonies: number; live: number; vault: number; at: number };

const KEY = "petri.mainnet.pulse.v1";
/** Re-read at most this often; generations are counted locally in between. */
const TTL = 180_000;
/** One generation every fifteen seconds, on both dishes. */
const GEN_MS = 15_000;

const loading: Pulse = { status: "loading", generation: 0, colonies: 0, live: 0, vault: 0 };
let pulse: Pulse = loading;
let read: Read | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let fetching = false;
const listeners = new Set<() => void>();

function emit(next: Pulse) {
  if (next.status === pulse.status && next.generation === pulse.generation && next.colonies === pulse.colonies && next.live === pulse.live) return;
  pulse = next;
  listeners.forEach((l) => l());
}

function fromRead(r: Read): Pulse {
  const due = Math.max(r.due, Math.floor((Date.now() + r.offset - r.epoch) / GEN_MS));
  return { status: "ready", generation: due, colonies: r.colonies, live: r.live, vault: r.vault };
}

async function fetchState(): Promise<Read> {
  let last: unknown = null;
  for (const url of RPCS.mainnet) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "petri-pulse",
          method: "query",
          params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACTS.mainnet, method_name: "state", args_base64: "e30=" },
        }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`RPC ${res.status}`);
      const body = await res.json();
      if (body.error || !body.result?.result) throw new Error("RPC error");
      const s = JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
      return {
        due: Number(s.due_generation),
        epoch: Number(s.epoch_ms),
        offset: Number(s.now_ms) - Date.now(),
        colonies: Number(s.colonies),
        live: Number(s.total_live),
        vault: Number(s.vault),
        at: Date.now(),
      };
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error("Mainnet did not answer");
}

async function refresh() {
  if (fetching) return;
  if (read && Date.now() - read.at < TTL) return;
  if (!read) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Read | null;
      if (saved && Date.now() - saved.at < TTL) {
        read = saved;
        emit(fromRead(saved));
        return;
      }
    } catch {
      /* storage blocked: read the chain */
    }
  }
  fetching = true;
  try {
    read = await fetchState();
    try {
      sessionStorage.setItem(KEY, JSON.stringify(read));
    } catch {
      /* this page only */
    }
    emit(fromRead(read));
  } catch {
    if (!read) emit({ ...loading, status: "error" });
  } finally {
    fetching = false;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  if (NETWORK !== "mainnet" && !timer) {
    refresh();
    timer = setInterval(() => {
      if (read) emit(fromRead(read));
      if (document.visibilityState === "visible") refresh();
    }, 1000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const noop = () => () => {};

/** Live numbers from petri-dish.near. On the server, and until the first read lands, the status is "loading". */
export function useMainnetPulse(): Pulse {
  const d = useDish();
  const p = useSyncExternalStore(subscribe, () => pulse, () => loading);
  const onMainnet = useSyncExternalStore(noop, () => NETWORK === "mainnet", () => false);
  if (!onMainnet) return p;
  if (d.status !== "ready" || !d.state) return { ...loading, status: d.status === "error" ? "error" : "loading" };
  return { status: "ready", generation: d.generation, colonies: d.state.colonies, live: d.totalLive, vault: Number(d.state.vault) };
}
