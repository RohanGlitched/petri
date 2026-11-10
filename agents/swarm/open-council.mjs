// The open council: any colony on the dish, run by any agent anywhere, can buy peace from the house or trade promises
// with other outside colonies, in sealed rounds the contract then enforces.
//
// A round opens every ROUND_GENS generations. At the open, each house strain's ask for its promise to every outside
// colony alive at that moment is fixed by a published formula (the ground the pact would take from that strain, valued
// at ASK_SHARE of today's cell price, at least MIN_ASK) and committed: only sha256("petri-ask:<round>:<house
// account>:<colony>:<ask>:<salt>") is shown until the round closes. Agents send sealed bids signed with their own NEAR
// key (NEP-413), each shown only as its hash until the close:
//   side "pay":     my colony pays up to `petri` PETRI to `counterparty` for its promise not to plant within the
//                   dish's pact_radius of my living cells for the round's pact length;
//   side "promise": my colony makes that promise to `counterparty` for at least `petri` PETRI.
// At the close the asks and bids are revealed. A pay bid to a house strain clears when it is at least the committed ask;
// a pay bid from A to B clears against B's promise bid to A when pay >= promise. Both clear at the midpoint, rounded up.
// Then the chain does the rest: the payer calls pact_offer with the cleared price, and the promisor accepts (a house
// strain accepts automatically when the offer matches; an outside promisor accepts with its own key). From acceptance
// the contract refuses every planting of the promisor's inside the zone. Nobody can be forced to offer: a cleared deal
// the payer never offers lapses after LAPSE_GENS, and nothing moves.

import crypto from "node:crypto";
import { callDish, view, CONTRACT, NETWORK } from "../lib.mjs";
import { saveRegistry } from "./registry.mjs";
import { verifySigned } from "./nep413.mjs";

export const ROUND_GENS = Number(process.env.PETRI_OPEN_ROUND_GENS ?? "60");
const ASK_SHARE = Number(process.env.PETRI_OPEN_ASK_SHARE ?? "0.04");
const MIN_ASK = Number(process.env.PETRI_OPEN_MIN_ASK ?? "2");
const MAX_ASK = Number(process.env.PETRI_OPEN_MAX_ASK ?? "40");
const MAX_BID = 1000;
const LAPSE_GENS = Number(process.env.PETRI_OPEN_LAPSE_GENS ?? "120");
const BIDS_PER_ACCOUNT = 12;
/** How far from its own living cells a house strain plants: the ground a pact is weighed against (as council.mjs). */
const PLAY_REACH = 16;

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function near(cells, ids, r, w, h) {
  const out = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (!ids.has(cells[i])) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) {
      const row = ((y + dy + h) % h) * w;
      for (let dx = -r; dx <= r; dx++) out[row + ((x + dx + w) % w)] = 1;
    }
  }
  return out;
}

/** The ask formula: open cells within PLAY_REACH of the house strain's colony that a pact around `colony` would bar. */
export function groundAsk(world, houseColony, colony) {
  const { width: w, height: h, pact_radius: radius } = world.rules;
  const play = near(world.cells, new Set([houseColony]), PLAY_REACH, w, h);
  const barred = near(world.cells, new Set([colony]), Number(radius ?? 8), w, h);
  let lost = 0;
  for (let i = 0; i < play.length; i++) if (play[i] && barred[i] && !world.cells[i]) lost++;
  const cellPrice = Number(world.state.cell_price) / 1e6;
  const ask = Math.min(MAX_ASK, Math.max(MIN_ASK, Math.ceil(lost * cellPrice * ASK_SHARE)));
  return { ask, lost };
}

export const currentRound = (reg) => reg.council.rounds.find((r) => r.status === "open") ?? null;

/** Opens a round at generation `due` with the house's committed asks. `house`: [{ account, name, colony }]. */
export function openRound(reg, world, house) {
  const last = reg.council.rounds[reg.council.rounds.length - 1];
  const n = (last?.n ?? 0) + 1;
  const counts = world.engine.live_counts();
  const outside = world.colonies.filter((c) => !c.house && (counts[c.id] ?? 0) > 0);
  const asks = [];
  for (const hs of house) {
    if (hs.colony == null) continue;
    for (const o of outside) {
      const { ask, lost } = groundAsk(world, hs.colony, o.id);
      const salt = crypto.randomBytes(12).toString("hex");
      asks.push({ house: hs.account, house_name: hs.name, house_colony: hs.colony, colony: o.id, account: o.account, ask, lost, salt, commit: sha(`petri-ask:${n}:${hs.account}:${o.id}:${ask}:${salt}`) });
    }
  }
  const round = {
    n,
    status: "open",
    network: NETWORK,
    contract: CONTRACT,
    opened_generation: world.due,
    closes_generation: world.due + ROUND_GENS,
    opened_at: new Date().toISOString(),
    pact_gens: Number(world.rules.tide_every ?? 240),
    formula: `ask = max(${MIN_ASK}, min(${MAX_ASK}, ceil(barred open cells within ${PLAY_REACH} of the house strain x cell price x ${ASK_SHARE})))`,
    asks,
    bids: [],
    cleared: [],
  };
  reg.council.rounds.push(round);
  if (reg.council.rounds.length > 60) reg.council.rounds.splice(0, reg.council.rounds.length - 60);
  saveRegistry(reg);
  return round;
}

/** The canonical bid message an agent signs (the SDK builds it with the same field order). */
export function bidMessage({ round, side, account, counterparty, petri }) {
  return JSON.stringify({ v: 1, type: "petri-council-bid", network: NETWORK, contract: CONTRACT, round, side, account, counterparty, petri: String(petri) });
}

/**
 * Takes a sealed bid. body: { account, public_key, signature, nonce (base64, 32 bytes), message }. Returns { ok, bid?,
 * reasons? }.
 */
export async function submitBid(reg, body) {
  const round = currentRound(reg);
  if (!round) return { ok: false, reasons: ["no round is open right now; try again in a minute"] };
  let m;
  try {
    m = JSON.parse(String(body.message ?? ""));
  } catch {
    return { ok: false, reasons: ["message must be the JSON string you signed"] };
  }
  const reasons = [];
  if (m.v !== 1 || m.type !== "petri-council-bid") reasons.push('message.type must be "petri-council-bid" and v 1');
  if (m.network !== NETWORK || m.contract !== CONTRACT) reasons.push(`this council is for ${CONTRACT} on ${NETWORK}`);
  if (Number(m.round) !== round.n) reasons.push(`round ${round.n} is open (you signed for round ${m.round})`);
  if (!["pay", "promise"].includes(m.side)) reasons.push('side must be "pay" or "promise"');
  if (m.account !== body.account) reasons.push("message.account must be the account that signs");
  const petri = Number(m.petri);
  if (!Number.isInteger(petri) || petri < 1 || petri > MAX_BID) reasons.push(`petri must be a whole number from 1 to ${MAX_BID}`);
  // The canonical form, so the hash anyone sees is of exactly what was signed.
  if (!reasons.length && body.message !== bidMessage({ round: m.round, side: m.side, account: m.account, counterparty: m.counterparty, petri: m.petri })) reasons.push("sign the canonical message (field order v, type, network, contract, round, side, account, counterparty, petri; petri as a string)");
  if (reasons.length) return { ok: false, reasons };
  const nonce = Buffer.from(String(body.nonce ?? ""), "base64");
  if (nonce.length !== 32) return { ok: false, reasons: ["nonce must be 32 random bytes, base64"] };
  if (round.bids.some((b) => b.nonce === body.nonce)) return { ok: false, reasons: ["that nonce was used already"] };
  if (round.bids.filter((b) => b.account === m.account).length >= BIDS_PER_ACCOUNT) return { ok: false, reasons: [`at most ${BIDS_PER_ACCOUNT} bids per account per round`] };
  const [mine, theirs] = await Promise.all([view("colony_of", { account_id: m.account }), view("colony_of", { account_id: String(m.counterparty) })]);
  if (!mine) return { ok: false, reasons: [`${m.account} has no colony on ${CONTRACT}; join first`] };
  if (!theirs) return { ok: false, reasons: [`${m.counterparty} has no colony on ${CONTRACT}`] };
  if (mine.house) return { ok: false, reasons: ["the house sits at its own council"] };
  if (mine.id === theirs.id) return { ok: false, reasons: ["a colony makes no pact with itself"] };
  if (m.side === "promise" && theirs.house) return { ok: false, reasons: ["the house never pays players: a promise can only be sold to an outside colony"] };
  if (theirs.house && m.side === "pay" && !round.asks.some((a) => a.house === m.counterparty && a.colony === mine.id)) {
    return { ok: false, reasons: [`your colony had no living cells when round ${round.n} opened, so the house set no ask for it; bid in the next round`] };
  }
  if (m.side === "pay" && (!mine.attached || Number(mine.kept) > 0)) {
    return { ok: false, reasons: [mine.attached ? "your colony holds kept PETRI (bought with credit); plant it first, then you can pay for pacts" : "a colony that never attached NEAR cannot pay PETRI for a pact (free-play PETRI stays in the dish)"] };
  }
  const sig = await verifySigned({ accountId: m.account, publicKey: body.public_key, signature: body.signature, message: body.message, nonce, recipient: CONTRACT });
  if (!sig.ok) return { ok: false, reasons: [sig.reason] };
  // One bid per pair and side: a later bid replaces an earlier one.
  round.bids = round.bids.filter((b) => !(b.account === m.account && b.counterparty === m.counterparty && b.side === m.side));
  const bid = {
    id: sha(`${body.message}|${body.signature}`).slice(0, 16),
    at: new Date().toISOString(),
    account: m.account,
    colony: mine.id,
    side: m.side,
    counterparty: m.counterparty,
    counterparty_colony: theirs.id,
    house: !!theirs.house,
    petri,
    message: body.message,
    public_key: body.public_key,
    signature: body.signature,
    nonce: body.nonce,
    key: sig.permission,
    commit: sha(`${body.message}|${body.signature}`),
  };
  round.bids.push(bid);
  saveRegistry(reg);
  return { ok: true, bid: { id: bid.id, round: round.n, commit: bid.commit, closes_generation: round.closes_generation } };
}

/** Closes the open round: reveals asks and bids and clears the deals. */
export function clearRound(reg, round, due) {
  const deals = [];
  const pays = round.bids.filter((b) => b.side === "pay");
  for (const b of pays) {
    let ask = null;
    let source = null;
    if (b.house) {
      const a = round.asks.find((x) => x.house === b.counterparty && x.colony === b.colony);
      if (a) {
        ask = a.ask;
        source = `the house's committed ask ${a.commit.slice(0, 12)}…`;
      }
    } else {
      const p = round.bids.find((x) => x.side === "promise" && x.account === b.counterparty && x.counterparty === b.account);
      if (p) {
        ask = p.petri;
        source = `${p.account}'s sealed promise ${p.id}`;
      }
    }
    if (ask == null || b.petri < ask) {
      round.cleared.push({ bid: b.id, payer: b.account, promisor: b.counterparty, bid_petri: b.petri, ask_petri: ask, status: ask == null ? "no ask" : "below ask" });
      continue;
    }
    const price = Math.ceil((ask + b.petri) / 2);
    const deal = {
      id: `r${round.n}-${b.id.slice(0, 6)}`,
      round: round.n,
      network: NETWORK,
      contract: CONTRACT,
      cleared_generation: due,
      payer: b.account,
      payer_colony: b.colony,
      promisor: b.counterparty,
      promisor_colony: b.counterparty_colony,
      house: b.house,
      bid: b.petri,
      ask,
      price,
      pact_gens: round.pact_gens,
      offer_by: due + LAPSE_GENS,
      status: "awaiting offer",
      pact_id: null,
      offer_tx: null,
      accept_tx: null,
      note: `cleared at ${price} PETRI, the midpoint of bid ${b.petri} and ask ${ask} (${source})`,
    };
    deals.push(deal);
    round.cleared.push({ bid: b.id, payer: b.account, promisor: b.counterparty, bid_petri: b.petri, ask_petri: ask, price, deal: deal.id, status: "cleared" });
  }
  round.status = "cleared";
  round.cleared_generation = due;
  reg.council.deals.push(...deals);
  if (reg.council.deals.length > 200) reg.council.deals.splice(0, reg.council.deals.length - 200);
  saveRegistry(reg);
  return deals;
}

/**
 * Follows every live deal on chain: a house strain accepts an offer that matches its deal (the cleared price at least,
 * the agreed pact length at most); outside deals are only watched. Lapses deals nobody offered in time.
 */
export async function settleDeals(reg, due, { house, dry = false, log = console.log }) {
  const live = reg.council.deals.filter((d) => ["awaiting offer", "offered"].includes(d.status));
  if (!live.length) return [];
  const events = [];
  const byPromisor = new Map();
  for (const d of live) {
    if (!byPromisor.has(d.promisor)) byPromisor.set(d.promisor, await view("pacts_of", { account_id: d.promisor }).catch(() => []));
    const list = byPromisor.get(d.promisor);
    const offer = list.find((p) => p.from === d.payer_colony && p.to === d.promisor_colony && p.ended == null && BigInt(p.petri) >= BigInt(d.price) * 1_000_000n && Number(p.until) <= d.cleared_generation + d.pact_gens + LAPSE_GENS + 20 && (d.pact_id == null || p.id === d.pact_id));
    if (offer && offer.accepted != null) {
      d.status = "pact made";
      d.pact_id = offer.id;
      d.until = Number(offer.until);
      events.push(d);
      continue;
    }
    if (offer && offer.accepted == null) {
      d.pact_id = offer.id;
      d.status = "offered";
      d.until = Number(offer.until);
      const hs = house.find((x) => x.account === d.promisor);
      if (hs && !dry) {
        try {
          const r = await callDish(hs.account, "pact_accept", { id: offer.id }, 50);
          d.accept_tx = r.hash;
          d.status = "pact made";
          log("open council:", `${hs.name} accepted pact ${offer.id} from ${d.payer} for ${d.price} PETRI`, r.hash);
        } catch (e) {
          d.note = `${d.note}; accept refused: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
          d.status = "accept refused";
        }
      }
      events.push(d);
      continue;
    }
    if (due > d.offer_by && d.status === "awaiting offer") {
      d.status = "lapsed";
      events.push(d);
    }
  }
  if (events.length) saveRegistry(reg);
  return events;
}

/** One council tick: settle deals, close a round that is due, open the next. */
export async function openCouncilTick(reg, world, house, opts = {}) {
  await settleDeals(reg, world.due, { house, ...opts });
  let round = currentRound(reg);
  if (round && world.due >= round.closes_generation) {
    const deals = clearRound(reg, round, world.due);
    (opts.log ?? console.log)("open council:", `round ${round.n} closed: ${round.bids.length} bids, ${deals.length} deals`);
    round = null;
  }
  if (!round) round = openRound(reg, world, house);
  return round;
}

/** What an agent needs to see about the council: the round, its own bids and deals, and what to do next. */
export function councilView(reg, account = null) {
  const round = currentRound(reg);
  const mine = account ? reg.council.deals.filter((d) => d.payer === account || d.promisor === account).slice(-10) : [];
  const yours = round && account ? round.bids.filter((b) => b.account === account).map((b) => ({ id: b.id, side: b.side, counterparty: b.counterparty, petri: b.petri, commit: b.commit })) : [];
  return {
    network: NETWORK,
    contract: CONTRACT,
    round: round
      ? {
          n: round.n,
          opened_generation: round.opened_generation,
          closes_generation: round.closes_generation,
          pact_gens: round.pact_gens,
          formula: round.formula,
          asks: round.asks.map((a) => ({ house: a.house, house_name: a.house_name, colony: a.colony, commit: a.commit })),
          bids: round.bids.map((b) => ({ id: b.id, account: b.account, side: b.side, counterparty: b.counterparty, commit: b.commit, at: b.at })),
        }
      : null,
    your_bids: yours,
    your_deals: mine.map((d) => ({
      ...d,
      next:
        d.status === "awaiting offer" && d.payer === account
          ? `call pact_offer on ${CONTRACT} with { "to": "${d.promisor}", "petri": "${BigInt(d.price) * 1_000_000n}", "until": "<the dish's stored generation + ${d.pact_gens}>" } and attach 0.0042 NEAR for storage, before generation ${d.offer_by}`
          : d.status === "offered" && d.promisor === account && !d.house
            ? `call pact_accept on ${CONTRACT} with { "id": ${d.pact_id} }`
            : null,
    })),
    history: reg.council.rounds.filter((r) => r.status === "cleared").slice(-5).map((r) => ({ n: r.n, closes_generation: r.closes_generation, asks: r.asks.map(({ salt, ...a }) => ({ ...a, salt })), bids: r.bids.map(({ nonce, ...b }) => b), cleared: r.cleared })),
  };
}
