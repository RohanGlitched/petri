// The world as an outside agent sees it: one compact JSON a language model can read and act on. Its colony, who threatens
// it, the plantings the contract would accept from it right now (each with a forecast from the contract's own rules),
// the pacts that bind or protect it, prices, and the council. Colonies are named by number (house strains by name):
// no player-written text is in it, so it is safe to paste into a model's context.

import { liveDish, view, CONTRACT, NETWORK } from "../lib.mjs";
import { candidates, colonyCentres, makeRng, wrapDelta, compass, quadrantOf } from "../strategies.mjs";
import { forecast, forecastText } from "../forecast.mjs";
import { pactsFor } from "../council.mjs";
import { TEMPERAMENTS } from "./guard.mjs";

const cache = new Map();

export async function worldFor(accountId, { temperament = "gardener", house = new Map(), limit = 6 } = {}) {
  const t = TEMPERAMENTS.includes(temperament) ? temperament : "gardener";
  const key = `${accountId}|${t}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.body;
  const world = await liveDish();
  try {
    const body = await build(world, accountId, t, house, limit);
    // An account that has not joined yet is about to: never serve it a stale "no colony".
    if (body.you?.colony != null) cache.set(key, { at: Date.now(), body });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
    return body;
  } finally {
    world.engine.free();
  }
}

async function build(world, accountId, temperament, house, limit) {
  const { rules } = world;
  const w = rules.width;
  const h = rules.height;
  const counts = world.engine.live_counts();
  const centres = colonyCentres(world.cells, w, h);
  const nameOf = (id) => (house.has(id) ? `${house.get(id)} (colony ${id})` : `colony ${id}`);
  const me = accountId ? world.colonies.find((c) => c.account === accountId) ?? null : null;
  const cellPrice = Number(world.state.cell_price);
  const out = {
    network: NETWORK,
    contract: CONTRACT,
    generation: world.due,
    stored_generation: Number(world.state.generation),
    rules: {
      width: w,
      height: h,
      buffer: rules.buffer,
      pact_radius: rules.pact_radius,
      max_plant_cells: rules.max_plant_cells,
      tide_every: rules.tide_every,
      next_tide_in_generations: rules.tide_every - (world.due % rules.tide_every),
      generation_seconds: Number(rules.generation_ms) / 1000,
      cells: "a cell index is y * width + x; the dish wraps at its edges",
    },
    prices: {
      cell_petri: cellPrice / 1e6,
      petri_in_near: Number(world.state.petri_price) / 1e24,
      pact_storage_near: 0.0042,
      plant_fee_near_per_cell: Number(rules.cell_fee) / 1e24,
    },
    dish: { live_cells: world.engine.total_live(), colonies: world.colonies.length, agar_petri: Math.round(Number(world.engine.agar()) / 1e6) },
    house: world.colonies.filter((c) => c.house).map((c) => ({ colony: c.id, account: c.account, name: house.get(c.id) ?? `colony ${c.id}`, cells: counts[c.id] ?? 0 })),
    you: null,
    threats: [],
    plantings: [],
    pacts: { binding_you: [], protecting_you: [], open_offers_to_you: [], your_open_offers: [] },
    how_to: {
      plant: `call plant on ${CONTRACT} with { "cells": <one planting's cells> , "note": "<optional, at most 140 chars>" } attaching the plant_deposit view's amount (or pass "credit" instead if you hold sponsored credit); one planting per generation`,
      council: "GET /api/agent/council for the open round; POST a NEP-413 signed bid to /api/agent/council (see /strains/join)",
      refresh: "plantings are valid for the generation shown; ask again after the dish moves (every few seconds)",
    },
  };
  if (!me) {
    out.you = accountId ? { account: accountId, colony: null, note: `no colony on ${CONTRACT}: call join { name, color } attaching at least ${Number(rules.min_join) / 1e24} NEAR` } : null;
    return out;
  }
  const [held, waiting, credit, bound] = await Promise.all([
    view("ft_balance_of", { account_id: accountId }),
    view("claimable", { account_id: accountId }),
    view("credit_of", { account_id: accountId }).catch(() => "0"),
    view("pacts_of", { account_id: accountId }).catch(() => []),
  ]);
  const balance = Number(held) + Number(waiting.petri);
  const mine = centres.get(me.id);
  out.you = {
    account: accountId,
    colony: me.id,
    cells: counts[me.id] ?? 0,
    centre: mine ? { x: mine.x, y: mine.y, quarter: quadrantOf(mine.x, mine.y, w, h) } : null,
    petri: Number(held) / 1e6,
    claimable_petri: Number(waiting.petri) / 1e6,
    claimable_near: Number(waiting.near) / 1e24,
    credit_near: Number(credit) / 1e24,
    attached: !!me.attached,
    kept_petri: Number(me.kept ?? 0) / 1e6,
    can_pay_for_pacts: !!me.attached && Number(me.kept ?? 0) === 0,
    last_plant_generation: me.last_plant_generation === null ? null : Number(me.last_plant_generation),
    can_plant_now: me.last_plant_generation === null || Number(me.last_plant_generation) < world.due,
  };
  if (mine) {
    out.threats = [...centres.entries()]
      .filter(([id]) => id !== me.id)
      .map(([id, c]) => {
        const dx = wrapDelta(mine.x, c.x, w);
        const dy = wrapDelta(mine.y, c.y, h);
        return { colony: id, name: nameOf(id), house: house.has(id), cells: c.n, distance: Math.round(Math.hypot(dx, dy)), direction: compass(dx, dy) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
  }
  for (const p of bound) {
    const v = { id: p.id, from: p.from, to: p.to, petri: Number(p.petri) / 1e6, until: Number(p.until), binding: p.binding, accepted: p.accepted !== null };
    if (p.ended !== null) continue;
    if (p.to === me.id && p.binding) out.pacts.binding_you.push({ ...v, meaning: `you may not plant within ${rules.pact_radius} cells of ${nameOf(p.from)}'s living cells until generation ${v.until}; the contract refuses it` });
    else if (p.from === me.id && p.binding) out.pacts.protecting_you.push({ ...v, meaning: `${nameOf(p.to)} may not plant within ${rules.pact_radius} cells of your living cells until generation ${v.until}` });
    else if (p.to === me.id && p.accepted === null) out.pacts.open_offers_to_you.push({ ...v, accept: `pact_accept { "id": ${p.id} }` });
    else if (p.from === me.id && p.accepted === null) out.pacts.your_open_offers.push(v);
  }
  const pacts = pactsFor(bound, me.id, rules, nameOf);
  const rng = makeRng((world.due * 2654435761) ^ me.id);
  const cands = out.you.can_plant_now ? candidates({ ...world, totalLive: world.engine.total_live() }, { id: me.id, temperament, cap: 400 }, balance, rng, limit, pacts) : [];
  if (cands.length) forecast(world, me.id, cands, { gens: 240, budgetMs: 1500, house: (world.state.house ?? []).map(Number) });
  out.plantings = cands.map((c, i) => ({
    option: i + 1,
    what: c.why,
    pattern: c.pattern,
    kind: c.kind,
    ambitious: c.ambitious,
    target_colony: c.target,
    cells: c.cells,
    cost_petri: c.cost / 1e6,
    forecast: c.forecast ? { generations: c.forecast.gens, your_cells: c.forecast.mine, vs_not_planting: c.forecast.vsIdle, kept_in_place: c.forecast.kept, rivals: c.forecast.rivals, you_earn_petri: c.forecast.petri } : null,
    forecast_text: forecastText(c.forecast, nameOf),
  }));
  out.plantings_valid_at = world.due;
  out.plantings_note = out.you.can_plant_now ? `${cands.length} plantings the contract accepts from you now, picked to suit a ${temperament}; add ?temperament= (${TEMPERAMENTS.join(", ")}) for another set` : "you planted this generation; ask again next generation";
  return out;
}
