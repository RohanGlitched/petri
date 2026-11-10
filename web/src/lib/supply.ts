"use client";
// PETRI's whole life, rebuilt in the browser: the replay (replay.ts, the same Replayer /verify runs) is stepped from
// generation zero and sampled every tide window, so the supply chart and the mint and burn log come from the ledger and
// petri-core alone, not from anyone's summary.
//
// Where PETRI goes. All 1,000,000 start in the agar. The agar feeds living cells every generation (the only way PETRI
// is minted to colonies; a keeper share of each feed is set aside for whoever advances the dish). A purchase moves
// PETRI out of the agar for NEAR (or credit); a sale moves it back for NEAR from the vault. A planting burns half its
// cost and returns the rest to the agar; a specimen slide burns all of its price; unregistering burns what the account
// held. A licensed planting pays its royalty to the slide's holder (or, for a planter that never attached NEAR, to the
// agar). The feed is not in the ledger, so each window's feed is worked out from the agar's own balance: what left the
// agar in a window, less what purchases took, plus what plantings, royalties and sales returned.

import { loadEngine } from "@/engine";
import type { Colony, DishState, Entry, Rules, SlideView } from "./chain";
import { entryGeneration } from "./chain";
import { Replayer } from "./replay";

export type SupplyPoint = {
  /** generation */
  g: number;
  /** PETRI units in the agar */
  agar: number;
  /** PETRI units outside the agar and not burned: in colonies' balances, unclaimed earnings, the keeper pot and pact offers */
  held: number;
  burned: number;
  /** NEAR (as a float) in the tide vault, and paid out by tides so far */
  vault: number;
  paidOut: number;
  live: number;
};

export type EventKind = "feed" | "buy" | "sell" | "plant" | "slide" | "burn" | "tide" | "royalty" | "pact";

export type CoinEvent = {
  /** ledger index, or -1 for a feed window */
  index: number;
  g: number;
  /** last generation of a feed window */
  to?: number;
  kind: EventKind;
  colony: number | null;
  /** PETRI units minted to colonies (feed), moved out of the agar (buy) or back (sell), burned, or paid (royalty, pact) */
  petri: number;
  burned: number;
  /** yoctoNEAR (as a float) that moved with it */
  near: number;
  text: string;
};

export type CoinBook = {
  target: number;
  points: SupplyPoint[];
  events: CoinEvent[];
  totals: { fed: number; bought: number; boughtNear: number; sold: number; soldNear: number; burnedPlant: number; burnedSlide: number; burnedOther: number; royalties: number; tides: number; tidesNear: number; tidesCredit: number };
  longest: { id: number; from: number; to: number; alive: boolean } | null;
  /** the history chain and agar the replay reached, against the contract's */
  matches: { chain: boolean; agar: boolean; burned: boolean };
  ms: number;
};

const Y = 1e24;
const LIFE_STEP = 16;

export async function buildCoinBook(
  input: { rules: Rules; state: DishState; colonies: Colony[]; ledger: Entry[]; slides?: SlideView[] },
  onProgress?: (g: number, of: number) => void,
): Promise<CoinBook> {
  await loadEngine();
  const t0 = performance.now();
  const { rules, state, colonies, ledger } = input;
  const r = new Replayer({ rules, state, colonies, ledger, earnings: [], winnings: [], slides: input.slides, lock: null });
  const every = rules.tide_every;
  const target = r.target;
  const points: SupplyPoint[] = [];
  const events: CoinEvent[] = [];
  const max = Number(rules.max_supply);
  const counters = () => ({ agar: Number(r.e.agar()), sold: Number(r.sold), returned: Number(r.returned), back: Number(r.boughtBack), burned: Number(r.burned) });
  let fedTotal = 0;
  const point = () => {
    const agar = Number(r.e.agar());
    const burned = Number(r.burned);
    const paidOut = r.tidesPaid.reduce((a, t) => a + Number(t.paid + t.asCredit + t.bounty), 0) / Y;
    points.push({ g: r.generation, agar, held: max - agar - burned, burned, vault: Number(r.vault) / Y, paidOut, live: r.e.total_live() });
  };
  // Lifetimes of colonies, sampled every LIFE_STEP generations of the rebuilt board.
  const since = new Map<number, number>();
  const seen = new Map<number, number>();
  let longest: CoinBook["longest"] = null;
  const lives = () => {
    const g = r.generation;
    const live = r.e.live_counts();
    for (let id = 1; id < live.length; id++) {
      if (live[id] > 0) {
        if (!since.has(id)) since.set(id, g);
        seen.set(id, g);
      } else if (since.has(id)) {
        const life = { id, from: since.get(id)!, to: seen.get(id)!, alive: false };
        if (!longest || life.to - life.from > longest.to - longest.from) longest = life;
        since.delete(id);
      }
    }
  };
  point();
  let last = performance.now();
  while (r.generation < target) {
    const before = counters();
    const g0 = r.generation;
    const end = Math.min(target, (Math.floor(g0 / every) + 1) * every);
    while (r.generation < end) {
      r.run(Math.min(LIFE_STEP, end - r.generation));
      lives();
    }
    const after = counters();
    const fed = before.agar - after.agar - (after.sold - before.sold) + (after.returned - before.returned) + (after.back - before.back);
    if (fed > 0) {
      fedTotal += fed;
      events.push({ index: -1, g: g0, to: r.generation, kind: "feed", colony: null, petri: fed, burned: 0, near: 0, text: "The agar fed the living cells" });
    }
    point();
    if (onProgress && performance.now() - last > 120) {
      last = performance.now();
      onProgress(r.generation, target);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  r.run(1);
  for (const [id, from] of since) {
    const life = { id, from, to: target, alive: true };
    if (!longest || life.to - life.from > longest.to - longest.from) longest = life;
  }
  // The ledger's own entries, in order.
  const tidePaid = new Map(r.tidesPaid.map((t) => [t.generation, t]));
  const totals: CoinBook["totals"] = { fed: fedTotal, bought: 0, boughtNear: 0, sold: 0, soldNear: 0, burnedPlant: 0, burnedSlide: 0, burnedOther: 0, royalties: 0, tides: 0, tidesNear: 0, tidesCredit: 0 };
  ledger.forEach((e, index) => {
    const g = entryGeneration(e);
    if ("Buy" in e) {
      const b = e.Buy;
      const near = Number(b.near) + Number(b.credit);
      totals.bought += Number(b.petri);
      totals.boughtNear += near;
      events.push({ index, g, kind: "buy", colony: b.colony, petri: Number(b.petri), burned: 0, near, text: Number(b.credit) > 0 && Number(b.near) === 0 ? "Bought from the agar with credit" : "Bought from the agar" });
    } else if ("Sell" in e) {
      const x = e.Sell;
      totals.sold += Number(x.petri);
      totals.soldNear += Number(x.near);
      events.push({ index, g, kind: "sell", colony: x.colony, petri: Number(x.petri), burned: 0, near: Number(x.near), text: x.as_credit ? "Sold back to the agar, paid as credit" : "Sold back to the agar for NEAR" });
    } else if ("Plant" in e) {
      const p = e.Plant;
      const cost = Number(p.cost);
      const burn = Math.floor((cost * rules.burn_bps) / 10000);
      totals.burnedPlant += burn;
      events.push({ index, g, kind: "plant", colony: p.colony, petri: cost, burned: burn, near: Number(p.near) + Number(p.credit), text: `Planted ${p.cells.length} cells${p.siege ? " inside a rival's buffer (siege)" : ""}: half burned, half back to the agar` });
      if (p.licence && Number(p.licence.royalty) > 0) {
        const roy = Number(p.licence.royalty);
        if (!p.licence.to_agar) totals.royalties += roy;
        events.push({ index, g, kind: "royalty", colony: p.colony, petri: roy, burned: 0, near: 0, text: p.licence.to_agar ? `Royalty for slide ${p.licence.token}, to the agar (the planter never attached NEAR)` : `Royalty for slide ${p.licence.token} to ${p.licence.holder}` });
      }
    } else if ("Slide" in e) {
      const x = e.Slide;
      totals.burnedSlide += Number(x.cost);
      events.push({ index, g, kind: "slide", colony: x.colony, petri: Number(x.cost), burned: Number(x.cost), near: 0, text: `Minted specimen slide ${x.token} (${x.cells} cells), its price all burned` });
    } else if ("Burn" in e) {
      totals.burnedOther += Number(e.Burn.petri);
      events.push({ index, g, kind: "burn", colony: null, petri: Number(e.Burn.petri), burned: Number(e.Burn.petri), near: 0, text: `${e.Burn.account} unregistered; what it held was burned` });
    } else if ("Tide" in e) {
      const t = tidePaid.get(g);
      const near = t ? Number(t.paid) + Number(t.bounty) : 0;
      const credit = t ? Number(t.asCredit + t.creditPaid) : 0;
      totals.tides++;
      totals.tidesNear += near;
      totals.tidesCredit += credit;
      events.push({ index, g, kind: "tide", colony: null, petri: 0, burned: 0, near: near + credit, text: `Tide: ${(near / Y).toFixed(4)} NEAR and ${(credit / Y).toFixed(4)} credit to colonies` });
    } else if ("PactOffer" in e) {
      const o = e.PactOffer;
      if (Number(o.petri) > 0) events.push({ index, g, kind: "pact", colony: o.from, petri: Number(o.petri), burned: 0, near: 0, text: `Pact ${o.pact} offered: the dish holds the PETRI until colony ${o.to} accepts` });
    }
  });
  events.sort((a, b) => a.g - b.g || a.index - b.index);
  const matches = { chain: r.e.chain_hex() === state.chain, agar: r.e.agar() === state.agar, burned: r.burned.toString() === state.burned };
  r.free();
  return { target, points, events, totals, longest, matches, ms: Math.round(performance.now() - t0) };
}
