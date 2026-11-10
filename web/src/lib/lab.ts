"use client";
// Calls for the judge desk's mechanics and the break-it lab, on the free-play dish. The lab signs, with this browser's
// guest key, calls the contract is meant to refuse, and sends them through the relayer marked `lab`, so the refusal is
// a real failed transaction with a hash. The guest key is the one wallet.ts made (petri.guest.v1).

import { Account, KeyPair, KeyPairSigner, actions, encodeSignedDelegate, type KeyPairString } from "near-api-js";
import { pattern_cells, type Engine, type PatternName } from "@/engine";
import { getColonyOf, getRules, getState, type Colony, type Rules } from "./chain";
import { CONTRACT, NETWORK } from "./config";
import { nearProvider } from "./near-provider";

const STORE = "petri.guest.v1";

export function savedGuest(): { accountId: string; secretKey: KeyPairString } | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as { accountId: string; secretKey: KeyPairString }) : null;
  } catch {
    return null;
  }
}

export type Step = { method: string; args: Record<string, unknown>; tgas: number };
export type Sent = { hash?: string; error?: string; raw?: string; ok: boolean };

let rulesOnce: Promise<Rules> | null = null;

/** When the stored dish is more than a catch-up behind the clock, advance it first, in its own delegate action: a
 * function-call key may sign only one call per action (NEAR refuses more with RequiresFullAccess). */
async function catchUp(): Promise<void> {
  try {
    rulesOnce ??= getRules();
    const [rules, state] = await Promise.all([rulesOnce, getState()]);
    const lag = Number(state.due_generation) - Number(state.generation) + 4;
    if (lag > rules.max_catchup) await relayOne({ method: "advance", args: { max: rules.max_catchup }, tgas: 100 }, null);
  } catch {
    /* the call itself will say if the dish is behind */
  }
}

/** The last nonce this page signed per guest: a delegate action NEAR refused before running it leaves the key's nonce
 * where it was, so the next one must still move past it. */
const lastNonce = new Map<string, bigint>();

/** Sign one call as a delegate action with the guest key and have the relayer submit it (after an advance, when the
 * dish is far behind and `current` is set). */
export async function relaySteps(steps: Step[], lab: string | null, current = true): Promise<Sent> {
  if (current) await catchUp();
  return relayOne(steps[0], lab);
}

async function relayOne(step: Step, lab: string | null): Promise<Sent> {
  const signed = await signOne(step);
  if (!signed) return { ok: false, error: "Make a guest colony first." };
  return sendSigned(signed, lab);
}

/** One call signed as a delegate action by the guest key, base64, ready for the relayer (null without a guest). */
export async function signOne(step: Step): Promise<string | null> {
  const g = savedGuest();
  if (!g) return null;
  const kp = KeyPair.fromString(g.secretKey);
  const acct = new Account(g.accountId, nearProvider(NETWORK), g.secretKey);
  const da = await acct.createMetaTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall(step.method, step.args, BigInt(Math.min(300, step.tgas)) * 10n ** 12n, 0n)],
    blockHeightTtl: 120,
    publicKey: kp.getPublicKey(),
  });
  const last = lastNonce.get(g.accountId) ?? 0n;
  if (da.nonce <= last) da.nonce = last + 1n;
  lastNonce.set(g.accountId, da.nonce);
  const { signedDelegate } = await new KeyPairSigner(kp).signDelegateAction(da);
  const bytes = encodeSignedDelegate(signedDelegate);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** Hand a signed delegate action to the relayer. */
export async function sendSigned(signed: string, lab: string | null): Promise<Sent> {
  const res = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedDelegate: signed, ...(lab ? { lab } : {}) }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.hash) return { ok: true, hash: body.hash };
  return { ok: false, hash: body.hash, error: body.error ?? `The relayer answered ${res.status}.`, raw: body.raw };
}

/** A place for `pattern` where the contract would accept a planting by `colony`: on open ground, or (siege) only
 * inside a rival's buffer. Returns the cells, or null after `tries` random places. */
export function findSpot(e: Engine, rules: Rules, colony: number, pattern: PatternName, want: "open" | "siege", tries = 1500): number[] | null {
  const { width: w, height: h } = rules;
  for (let i = 0; i < tries; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    const cells = Array.from(pattern_cells(pattern, x, y, w, h, Math.floor(Math.random() * 4), false));
    const r = e.check_plant(colony, new Uint32Array(cells), rules.buffer, rules.max_plant_cells);
    if (want === "open" && r === "") return cells;
    if (want === "siege" && r.startsWith("siege:")) return cells;
  }
  return null;
}

/** `offsets` (cells relative to a corner) placed at some legal open spot. */
export function findSpotFor(e: Engine, rules: Rules, colony: number, offsets: [number, number][], tries = 2000): number[] | null {
  const { width: w, height: h } = rules;
  for (let i = 0; i < tries; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    const cells = offsets.map(([dx, dy]) => ((y + dy) % h) * w + ((x + dx) % w));
    if (e.check_plant(colony, new Uint32Array(cells), rules.buffer, rules.max_plant_cells) === "") return cells;
  }
  return null;
}

/** A living cell of some colony other than `colony` (and the cells of its rectangle around it), for the lab. */
export function rivalCell(e: Engine, rules: Rules, colony: number): { index: number; owner: number } | null {
  const cells = e.cells();
  const start = Math.floor(Math.random() * cells.length);
  for (let k = 0; k < cells.length; k++) {
    const i = (start + k) % cells.length;
    if (cells[i] !== 0 && cells[i] !== colony) return { index: i, owner: cells[i] };
  }
  return null;
}

/** The w × h rectangle (at most 12 a side) holding the most of `colony`'s living cells, if it holds at least `min`. */
export function ownRect(e: Engine, rules: Rules, colony: number, min: number): { x: number; y: number; w: number; h: number; n: number } | null {
  const cells = e.cells();
  const { width: W, height: H } = rules;
  const mine: [number, number][] = [];
  for (let i = 0; i < cells.length; i++) if (cells[i] === colony) mine.push([i % W, Math.floor(i / W)]);
  let best: { x: number; y: number; w: number; h: number; n: number } | null = null;
  const side = 12;
  for (const [cx, cy] of mine) {
    const x = (cx - 3 + W) % W;
    const y = (cy - 3 + H) % H;
    let n = 0;
    for (const [mx, my] of mine) {
      const dx = (mx - x + W) % W;
      const dy = (my - y + H) % H;
      if (dx < side && dy < side) n++;
    }
    if (!best || n > best.n) best = { x, y, w: side, h: side, n };
  }
  return best && best.n >= min ? best : null;
}

/** A slide's cells as offsets from its corner (its bitmap, row by row). */
export function slideOffsets(bitmap: Uint8Array, w: number, h: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < w * h; i++) if (bitmap[i >> 3] & (1 << (i & 7))) out.push([i % w, Math.floor(i / w)]);
  return out;
}

/** The guest's colony, asking RPC up to three times (a public provider sometimes drops a read). */
export async function colonyWithRetry(account: string): Promise<Colony | null> {
  for (let i = 0; i < 3; i++) {
    try {
      return await getColonyOf(account);
    } catch {
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  return null;
}
