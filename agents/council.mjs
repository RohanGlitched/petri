// The house council: once per tide window the five house strains meet. Each may offer one pact to another strain:
// PETRI paid for a promise not to plant within the dish's pact_radius of the payer's living cells until a generation.
// The other strain's model accepts or declines in the same round. An accepted deal is made on chain: the payer calls
// pact_offer (the dish holds the PETRI), the promisor calls pact_accept (the dish pays it the PETRI), and from then on
// the contract itself refuses every planting of the promisor's that would break the pact, until it ends. The council
// logs the pact numbers the contract gave. Beyond the radius a promisor can still aim gliders at the payer; such
// raids are scored as broken faith and remembered per pair, so the next council prices trust. Outside players appear
// only as "colony N": no player-written text reaches a model.

import { callDish, nearBalance, view, CONTRACT, NETWORK } from "./lib.mjs";
import { askJson, trimNote } from "./model.mjs";
import { movesOf, memoryText, publicMovesText, reputationOf, scorePromise } from "./memory.mjs";
import { colonyCentres, compass, quadrantOf, wrapDelta } from "./strategies.mjs";

const MAINNET = NETWORK === "mainnet";
export const MAX_PACT_PETRI = Number(process.env.PETRI_PACT_MAX ?? "30");
// Pacts each strain may pay for in 24 hours: mainnet keeps its NEAR spend flat (an offer and its acceptance cost about
// 0.001 NEAR of gas and 0.0042 NEAR of storage).
const PAYMENTS_PER_DAY = Number(process.env.PETRI_PACT_PER_DAY ?? (MAINNET ? "2" : "4"));
/** How far from its own living cells a strain plants (cells across or down): the ground a pact is weighed against. */
const PLAY_REACH = 16;

/** Cells within `r` (across or down, wrapping) of colony `id`'s living cells, as 0/1 per cell. */
function near(cells, id, r, w, h) {
  const out = new Uint8Array(cells.length);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] !== id) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -r; dy <= r; dy++) {
      const row = ((y + dy + h) % h) * w;
      for (let dx = -r; dx <= r; dx++) out[row + ((x + dx + w) % w)] = 1;
    }
  }
  return out;
}

// PETRI a strain always keeps for planting: this many cells at today's price.
const RESERVE_CELLS = Number(process.env.PETRI_PACT_RESERVE_CELLS ?? "40");
const MIN_NEAR = Number(process.env.PETRI_MIN_NEAR ?? "0.12");
/** NEAR that always covers a pact offer's storage (the contract's PACT_DEPOSIT); what is not used comes back. */
const PACT_DEPOSIT = 4_200_000_000_000_000_000_000n;
const RAIDS = new Set(["raid", "gun", "ship"]);

/** How long a pact holds, in generations: a tide window, or until the promisor's next planting on a slow dish (and
 * never longer than the dish allows). */
export function pactGens(tideEvery, slowestEvery, maxGens = Infinity) {
  return Math.min(Math.max(tideEvery, slowestEvery), maxGens);
}

export function termsText(p) {
  return `${p.to} plants nowhere within ${p.radius} cells of ${p.from}'s living cells until generation ${p.until}`;
}

/**
 * The pacts binding colony `me` on chain now (from the `pacts_of` view), as candidate filters and prompt lines:
 * `protected` are the colonies it may not plant near (the contract refuses those plantings, so they are dropped before
 * the model sees them), `avoid` the same colonies, which it should not aim at either.
 */
export function pactsFor(chainPacts, me, rules, nameOf) {
  const avoid = new Set();
  const lines = [];
  const ids = [];
  for (const p of chainPacts) {
    if (!p.binding || p.to !== me) continue;
    ids.push(p.id);
    avoid.add(p.from);
    lines.push(`- Pact ${p.id}: you were paid ${(Number(p.petri) / 1e6).toFixed(1)} PETRI by ${nameOf(p.from)}. Until generation ${p.until} the contract refuses any planting of yours within ${rules.pact_radius} cells of its living cells; aiming raids at it from farther away breaks faith, and the council remembers.`);
  }
  return { avoid, protected: [...avoid], radius: Number(rules.pact_radius), banRegions: new Set(), strike: null, lines, ids };
}

/**
 * Scores pacts that have run their course: kept if no planting of the promisor's was aimed at the payer while it held
 * (the contract already refused every planting near the payer). Returns the council events for the log.
 */
export function settlePacts(mem, due, world) {
  const events = [];
  const counts = world.engine.live_counts();
  for (const p of mem.pacts) {
    if (!p.live || p.kept != null || due < p.until) continue;
    const moves = movesOf(mem, p.toAccount).filter((m) => m.generation >= p.fromGen && m.generation < p.until && m.source !== "chain");
    const aimed = moves.filter((m) => m.target === p.payerColony && RAIDS.has(m.kind));
    const kept = aimed.length === 0;
    p.kept = kept;
    p.settledGen = due;
    scorePromise(mem, p.toAccount, p.fromAccount, kept);
    events.push({ ...eventOf(p, world), status: kept ? "kept" : "broken", kept, note: kept ? `no raid aimed at ${p.from}; ${p.from} has ${counts[p.payerColony] ?? 0} cells` : `${aimed.length} raid(s) aimed at ${p.from} from beyond the pact's radius` });
  }
  // Keep the last 60 pacts.
  if (mem.pacts.length > 60) mem.pacts.splice(0, mem.pacts.length - 60);
  return events;
}

function eventOf(p, world) {
  return {
    at: new Date().toISOString(),
    network: NETWORK,
    contract: CONTRACT,
    window: p.window,
    generation: world.due,
    id: p.id,
    pact_id: p.chainId ?? null,
    from: p.from,
    from_account: p.fromAccount,
    to: p.to,
    to_account: p.toAccount,
    petri: p.petri,
    kind: "pact",
    until: p.until ?? null,
    terms: p.terms,
    status: p.status,
    tx: p.tx ?? null,
    accept_tx: p.acceptTx ?? null,
    kept: p.kept ?? null,
  };
}

const PROPOSE_SCHEMA = {
  type: "object",
  properties: {
    deal: { type: "boolean" },
    to: { type: "string" },
    petri: { type: "integer" },
    pitch: { type: "string" },
  },
  required: ["deal", "to", "petri", "pitch"],
  additionalProperties: false,
};

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: { offer: { type: "integer" }, accept: { type: "boolean" }, reply: { type: "string" } },
        required: ["offer", "accept", "reply"],
        additionalProperties: false,
      },
    },
  },
  required: ["answers"],
  additionalProperties: false,
};

/**
 * Runs one council round. strains: the house strains ({ account, name, voice, temperament }). Returns the council
 * events (proposals, answers, pacts made on chain, settlements) in order. With `dry`, nothing is sent: pacts are
 * reported as "would offer".
 */
export async function runCouncil({ world, strains, mem, dry = false, holdGens, log = console.log, attaches = () => MAINNET }) {
  const T = Number(world.rules.tide_every);
  const radius = Number(world.rules.pact_radius ?? 8);
  const window = Math.floor(world.due / T);
  const events = settlePacts(mem, world.due, world);
  const { width: w, height: h } = world.rules;
  const counts = world.engine.live_counts();
  const centres = colonyCentres(world.cells, w, h);
  const idOf = new Map(world.colonies.map((c) => [c.account, c.id]));
  const house = strains.filter((s) => idOf.has(s.account));
  const byName = new Map(house.map((s) => [s.name.toLowerCase(), s]));
  const nameOfId = new Map(house.map((s) => [idOf.get(s.account), s.name]));
  const nameOf = (id) => (nameOfId.has(id) ? `${nameOfId.get(id)} (colony ${id})` : `colony ${id}`);
  const cellPrice = Number(world.state.cell_price);
  const reserve = cellPrice * RESERVE_CELLS;
  const now = Date.now();

  const held = new Map();
  const onChain = new Map();
  await Promise.all(
    house.map(async (s) => {
      held.set(s.account, Number(await view("ft_balance_of", { account_id: s.account })));
      onChain.set(s.account, await view("pacts_of", { account_id: s.account }).catch(() => []));
    }),
  );
  // Pacts already open or binding between two strains, from the chain (one open offer per pair; at most 8 a colony).
  const between = (a, b) => (onChain.get(a.account) ?? []).some((p) => p.ended == null && p.from === idOf.get(a.account) && p.to === idOf.get(b.account) && (p.binding || p.accepted == null));
  const full = (s) => (onChain.get(s.account) ?? []).filter((p) => p.ended == null).length >= 8;

  const where = (id) => {
    const c = centres.get(id);
    return c ? `${c.n} cells around ${c.x}, ${c.y} (${quadrantOf(c.x, c.y, w, h)})` : "no living cells";
  };
  const houseLines = house.map((s) => `- ${s.name}, colony ${idOf.get(s.account)}: ${where(idOf.get(s.account))}; holds ${(held.get(s.account) / 1e6).toFixed(1)} PETRI`);
  const outside = world.colonies.filter((c) => !c.house && (counts[c.id] ?? 0) > 0).map((c) => `colony ${c.id} with ${where(c.id)}`);
  const dish = `Generation ${world.due}, tide window ${window}. The dish has ${world.engine.total_live()} living cells. One cell costs about ${(cellPrice / 1e6).toFixed(2)} PETRI to plant.
House strains:
${houseLines.join("\n")}
Outside colonies: ${outside.length ? outside.join("; ") : "none alive"}.`;

  const trust = (s) => {
    const r = reputationOf(mem, s.account);
    return r.kept + r.broken ? `${s.name} kept faith in ${r.kept} of ${r.kept + r.broken} pacts` : `${s.name} has no pacts on record`;
  };
  const recentPayments = (account) => (mem.payments[account] ?? []).filter((t) => now - Date.parse(t) < 86_400_000);

  // 1. Proposals: each strain that can spare PETRI may offer one pact.
  const offers = [];
  const passed = [];
  let n = 0;
  for (const s of house) {
    const me = idOf.get(s.account);
    const spare = Math.floor((held.get(s.account) - reserve) / 1e6);
    const maxPay = Math.min(MAX_PACT_PETRI, spare);
    const left = PAYMENTS_PER_DAY - recentPayments(s.account).length;
    if (maxPay < 1 || left <= 0 || full(s)) continue;
    const others = house.filter((o) => o !== s);
    const threats = others
      .map((o) => ({ o, aimed: movesOf(mem, o.account).filter((m) => m.target === me).length }))
      .filter((x) => x.aimed)
      .map((x) => `${x.o.name} aimed ${x.aimed} of its recent plantings at you`);
    const system = `You are ${s.name}, one of the five house strains on a shared Petri dish run by a NEAR smart contract. ${s.voice}
The dish follows Conway's Life. House strains are never fed: you play for living cells and territory. The house council meets once per tide window (${T} generations). You may offer at most one pact to another house strain: you pay it PETRI, held by the contract until it accepts, and in return the contract itself refuses every planting of that strain within ${radius} cells of your living cells for the next ${holdGens} generations. It cannot break the pact; it could still aim gliders at you from farther away, and the council remembers faith broken that way.
PETRI you pay is PETRI you cannot plant. Offer only when the protection is worth more to you than the cells it would buy. No deal is often the right answer.
Answer with JSON only. If you offer nothing, set deal false, to "", petri 0, pitch "". The pitch is one short sentence to the other strain, at most 80 characters.`;
    const user = `${dish}
${memoryText(mem, s.account, nameOf, 4)}
What the other house strains did lately:
${others.map((o) => `- ${o.name}: ${publicMovesText(mem, o.account, nameOf)}`).join("\n")}
Threats: ${threats.length ? threats.join("; ") : "no house strain has aimed at you lately"}.
Trust: ${others.map(trust).join("; ")}.
You hold ${(held.get(s.account) / 1e6).toFixed(1)} PETRI and may offer 1 to ${maxPay} PETRI. Strains you can deal with: ${others.map((o) => o.name).join(", ")}.`;
    const r = await askJson({ system, user, schema: PROPOSE_SCHEMA, maxTokens: 300, purpose: "propose" });
    if (!r) {
      log(s.name, "council: no answer from a model");
      continue;
    }
    const j = r.json;
    if (!j.deal) {
      passed.push(s.name);
      continue;
    }
    // Only pacts the contract will take are offered on.
    const to = byName.get(String(j.to).trim().toLowerCase());
    const petri = Math.round(Number(j.petri));
    let bad = null;
    if (!to || to === s) bad = `unknown counterparty ${String(j.to).slice(0, 30)}`;
    else if (!(petri >= 1 && petri <= maxPay)) bad = `amount ${j.petri} outside 1..${maxPay}`;
    else if (between(s, to)) bad = `a pact between them is already open or binding`;
    else if (full(to)) bad = `${to.name} is party to 8 pacts already`;
    const p = {
      id: `${NETWORK[0]}${window}-${++n}`,
      window,
      from: s.name,
      fromAccount: s.account,
      to: to?.name ?? String(j.to).slice(0, 30),
      toAccount: to?.account ?? null,
      payerColony: me,
      petri,
      radius,
      until: world.due + holdGens,
      pitch: trimNote(j.pitch),
      status: bad ? "invalid" : "proposed",
      live: false,
    };
    p.terms = termsText(p);
    events.push({ ...eventOf(p, world), note: bad ?? p.pitch, model: r.model });
    if (!bad) offers.push(p);
  }

  // 2. Answers: each strain that received offers accepts or declines each one.
  for (const s of house) {
    const mine = offers.filter((p) => p.toAccount === s.account);
    if (!mine.length) continue;
    const me = idOf.get(s.account);
    // The ground a pact takes from this strain: the cells it could no longer plant (within the radius of the payer's
    // living cells, the contract's square), counted where this strain plays (within PLAY_REACH of its own cells).
    const playGround = near(world.cells, me, PLAY_REACH, w, h);
    const cost = (p) => {
      const aimed = movesOf(mem, s.account).filter((m) => m.target === p.payerColony).length;
      const c = centres.get(p.payerColony);
      const home = centres.get(me);
      const d = c && home ? Math.round(Math.hypot(wrapDelta(home.x, c.x, w), wrapDelta(home.y, c.y, h))) : null;
      const barred = near(world.cells, p.payerColony, radius, w, h);
      let lost = 0;
      let play = 0;
      for (let i = 0; i < playGround.length; i++) if (playGround[i] && !world.cells[i]) { play++; if (barred[i]) lost++; }
      const share = play ? Math.round((100 * lost) / play) : 0;
      return `you aimed ${aimed} of your recent plantings at ${p.from}${d != null ? `; it lies ${d} cells ${compass(wrapDelta(home.x, c.x, w), wrapDelta(home.y, c.y, h))} of you` : ""}; the pact would bar ${lost} of the ${play} open cells within ${PLAY_REACH} of your own colonies (${share}%), worth about ${((lost * cellPrice) / 1e6).toFixed(0)} PETRI at today's cell price if you planted them all`;
    };
    const system = `You are ${s.name}, one of the five house strains on a shared Petri dish run by a NEAR smart contract. ${s.voice}
At the house council other strains offer you PETRI for a pact: if you accept, the contract pays you the PETRI and then refuses every planting of yours within ${radius} cells of the payer's living cells for ${holdGens} generations. You cannot break it. PETRI buys cells (about ${(cellPrice / 1e6).toFixed(2)} PETRI each). Accept when the PETRI is worth more than the ground you give up. Each offer says how much of the open agar where you play the pact would bar: a pact around a colony far from your own costs you almost nothing, so its PETRI is nearly free; one around your close neighbour costs ground you would use.
Answer with JSON only: one answer per offer, with a reply of one short sentence, at most 80 characters.`;
    const user = `${dish}
${memoryText(mem, s.account, nameOf, 3)}
Offers to you:
${mine.map((p, i) => `${i + 1}. ${p.from} offers ${p.petri} PETRI: ${p.terms}. ${p.from} says: "${p.pitch}". For you: ${cost(p)}. ${trust(house.find((o) => o.account === p.fromAccount))}.`).join("\n")}`;
    const r = await askJson({ system, user, schema: ANSWER_SCHEMA, maxTokens: 300, purpose: "answer" });
    for (const [i, p] of mine.entries()) {
      const a = r?.json?.answers?.find((x) => Number(x.offer) === i + 1);
      p.reply = trimNote(a?.reply ?? "");
      p.status = a?.accept ? "accepted" : "declined";
      events.push({ ...eventOf(p, world), note: p.reply || (r ? "" : "no answer from a model"), model: r?.model ?? null });
    }
  }

  // 3. On chain: the payer offers the pact (the dish holds its PETRI), the promisor accepts it (the dish pays it).
  for (const p of offers.filter((o) => o.status === "accepted")) {
    const balance = held.get(p.fromAccount);
    if (balance - p.petri * 1e6 < reserve) {
      p.status = "cancelled";
      events.push({ ...eventOf(p, world), note: "the payer would dip into the PETRI it keeps for planting" });
      continue;
    }
    const payer = strains.find((s) => s.account === p.fromAccount);
    const args = { to: p.toAccount, petri: String(BigInt(p.petri) * 1_000_000n), until: String(p.until) };
    if (dry) {
      p.status = "would offer";
      p.note = `dry run: would call pact_offer ${JSON.stringify(args)} and pact_accept as ${p.toAccount}`;
    } else {
      try {
        if (attaches(payer) && (await nearBalance(p.fromAccount)) < MIN_NEAR) throw new Error("payer keeps its last NEAR for gas");
        const offer = await callDish(p.fromAccount, "pact_offer", args, 300, PACT_DEPOSIT, attaches(payer));
        p.tx = offer.hash;
        p.chainId = Number(offer.value);
        if (!(p.chainId > 0)) throw new Error("pact_offer returned no pact number");
        p.status = "offered";
        held.set(p.fromAccount, balance - p.petri * 1e6);
        (mem.payments[p.fromAccount] ??= []).push(new Date().toISOString());
        mem.payments[p.fromAccount] = recentPayments(p.fromAccount);
        const accept = await callDish(p.toAccount, "pact_accept", { id: p.chainId }, 50);
        p.acceptTx = accept.hash;
        p.status = "pact made";
        log(p.from, `pact ${p.chainId}: paid ${p.to} ${p.petri} PETRI for "${p.terms}"`, offer.hash, accept.hash);
      } catch (e) {
        p.note = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        // An offer that was made but not accepted goes back to the payer.
        if (p.chainId > 0 && p.status === "offered") {
          p.status = "offer withdrawn";
          await callDish(p.fromAccount, "pact_cancel", { id: p.chainId }, 50).catch(() => {});
        } else p.status = "offer failed";
      }
    }
    if (["pact made", "would offer"].includes(p.status)) {
      p.live = true;
      p.fromGen = world.due;
      p.kept = null;
      mem.pacts.push(stripPact(p));
    }
    events.push({ ...eventOf(p, world), note: p.note ?? "" });
  }
  // One line for the round itself: who sat, who passed, what was agreed.
  const agreed = offers.filter((o) => o.live).length;
  events.push({
    ...baseEvent(world, window),
    id: `${NETWORK[0]}${window}`,
    pact_id: null,
    from: null,
    to: null,
    petri: offers.filter((o) => o.live).reduce((a, o) => a + o.petri, 0),
    terms: null,
    status: "round",
    tx: null,
    kept: null,
    note: `${offers.length} ${offers.length === 1 ? "offer" : "offers"}, ${agreed} ${agreed === 1 ? "pact" : "pacts"} made on chain${passed.length ? `; passed: ${passed.join(", ")}` : ""}`,
  });
  mem.councilWindow = window;
  return events;
}

/** Every pact the house strains are party to that has not ended, from the chain, with the strains named: what the
 * site draws on the dish. */
export async function chainPacts(strains, colonies) {
  const nameOf = new Map(colonies.map((c) => [c.id, strains.find((s) => s.account === c.account)?.name ?? `colony ${c.id}`]));
  const seen = new Map();
  for (const s of strains) {
    const list = await view("pacts_of", { account_id: s.account }).catch(() => []);
    for (const p of list) seen.set(p.id, { ...p, from_name: nameOf.get(p.from) ?? `colony ${p.from}`, to_name: nameOf.get(p.to) ?? `colony ${p.to}` });
  }
  return [...seen.values()].sort((a, b) => a.id - b.id);
}

function baseEvent(world, window) {
  return { at: new Date().toISOString(), network: NETWORK, contract: CONTRACT, window, generation: world.due };
}

function stripPact(p) {
  const { pitch, reply, note, ...rest } = p;
  return { ...rest, pitch, reply };
}
