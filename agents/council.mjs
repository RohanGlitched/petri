// The house council: once per tide window the five house strains meet. Each may offer one deal to another strain,
// PETRI paid now for a promise, and the other strain's model accepts or declines in the same round. Accepted deals are
// paid on chain with NEP-141 ft_transfer and a {"pact", "terms"} memo; the promises are then held by the candidate
// filter (truce, keep_out) or left to the promisor's choice (strike), scored kept or broken, and remembered per pair,
// so the next council prices trust. Outside players appear only as "colony N": no player-written text reaches a model.

import { ftTransfer, nearBalance, transferKeysDir, view, CONTRACT, NETWORK } from "./lib.mjs";
import { askJson, trimNote } from "./model.mjs";
import { movesOf, memoryText, publicMovesText, reputationOf, scorePromise } from "./memory.mjs";
import { REGIONS, colonyCentres, compass, quadrantOf, wrapDelta } from "./strategies.mjs";

const MAINNET = NETWORK === "mainnet";
export const MAX_PACT_PETRI = Number(process.env.PETRI_PACT_MAX ?? "3");
// Payments each strain may make in 24 hours: mainnet keeps its NEAR spend flat (an ft_transfer burns ~0.0003 NEAR).
const PAYMENTS_PER_DAY = Number(process.env.PETRI_PACT_PER_DAY ?? (MAINNET ? "2" : "4"));
// PETRI a strain always keeps for planting: this many cells at today's price.
const RESERVE_CELLS = Number(process.env.PETRI_PACT_RESERVE_CELLS ?? "40");
const MIN_NEAR = Number(process.env.PETRI_MIN_NEAR ?? "0.12");
const KINDS = ["truce", "keep_out", "strike"];
const RAIDS = new Set(["raid", "gun", "ship"]);

/** How long a promise holds, in generations: a tide window, or until the promisor's next planting on a slow dish. */
export function pactGens(tideEvery, slowestEvery) {
  return Math.max(tideEvery, slowestEvery);
}

export function termsText(p, nameOf) {
  if (p.kind === "truce") return `${p.to} will not aim at or crowd ${p.from}`;
  if (p.kind === "keep_out") return `${p.to} stays out of the ${p.region} of the dish`;
  return `${p.to} aims its next planting at ${nameOf(p.target)}`;
}

/** The promises `account` has made that are in force at generation `due`, as candidate filters and prompt lines. */
export function pactsFor(mem, account, due, nameOf) {
  const avoid = new Set();
  const banRegions = new Set();
  let strike = null;
  const lines = [];
  const ids = [];
  for (const p of mem.pacts) {
    if (p.toAccount !== account || p.kept != null || !p.live || due < p.fromGen || due >= p.until) continue;
    ids.push(p.id);
    if (p.kind === "truce") {
      avoid.add(p.payerColony);
      lines.push(`- You were paid ${p.petri} PETRI by ${p.from}: no raids, walls or plantings near ${nameOf(p.payerColony)} (held by the rules).`);
    } else if (p.kind === "keep_out") {
      banRegions.add(p.region);
      lines.push(`- You were paid ${p.petri} PETRI by ${p.from} to stay out of the ${p.region} (held by the rules).`);
    } else if (p.kind === "strike" && strike == null) {
      strike = p.target;
      lines.push(`- You were paid ${p.petri} PETRI by ${p.from} to aim this planting at ${nameOf(p.target)}. Options marked [PACT] keep the promise; any other choice breaks it.`);
    }
  }
  return { avoid, banRegions, strike, lines, ids };
}

/**
 * Scores promises that have run their course. A truce is kept if no planting was aimed at the payer, a keep-out if no
 * planting landed in the quarter, a strike if the promisor's next planting was a raid on the named colony. Returns the
 * council events for the log.
 */
export function settlePacts(mem, due, world) {
  const events = [];
  const counts = world.engine.live_counts();
  const { width: w, height: h } = world.rules;
  for (const p of mem.pacts) {
    if (!p.live || p.kept != null) continue;
    const moves = movesOf(mem, p.toAccount).filter((m) => m.generation >= p.fromGen && m.generation < p.until && m.source !== "chain");
    let kept = null;
    let why = "";
    if (p.kind === "strike") {
      if (moves.length) {
        const first = moves[0];
        kept = first.target === p.target && RAIDS.has(first.kind);
        why = kept ? `its next planting was a ${first.pattern} at colony ${p.target}` : `its next planting was a ${first.pattern}${first.target != null ? ` at colony ${first.target}` : ""} instead`;
      } else if (due >= p.until) {
        kept = false;
        why = "it did not plant before the promise ran out";
      }
    } else if (due >= p.until) {
      if (p.kind === "truce") {
        const aimed = moves.filter((m) => m.target === p.payerColony);
        kept = aimed.length === 0;
        why = kept ? `no planting aimed at ${p.from}; ${p.from} has ${counts[p.payerColony] ?? 0} cells` : `${aimed.length} planting(s) aimed at ${p.from}`;
      } else {
        const inside = moves.filter((m) => m.x != null && quadrantOf(m.x, m.y, w, h) === p.region);
        kept = inside.length === 0;
        why = kept ? `no planting in the ${p.region}` : `${inside.length} planting(s) in the ${p.region}`;
      }
    }
    if (kept == null) continue;
    p.kept = kept;
    p.settledGen = due;
    scorePromise(mem, p.toAccount, p.fromAccount, kept);
    events.push({ ...eventOf(p, world), status: kept ? "kept" : "broken", kept, note: why });
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
    from: p.from,
    from_account: p.fromAccount,
    to: p.to,
    to_account: p.toAccount,
    petri: p.petri,
    kind: p.kind,
    target: p.target ?? null,
    region: p.region ?? null,
    terms: p.terms,
    status: p.status,
    tx: p.tx ?? null,
    kept: p.kept ?? null,
  };
}

const PROPOSE_SCHEMA = {
  type: "object",
  properties: {
    deal: { type: "boolean" },
    to: { type: "string" },
    kind: { type: "string", enum: [...KINDS, "none"] },
    target: { type: "integer" },
    region: { type: "string", enum: [...REGIONS, "none"] },
    petri: { type: "integer" },
    pitch: { type: "string" },
  },
  required: ["deal", "to", "kind", "target", "region", "petri", "pitch"],
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
 * events (proposals, answers, payments, settlements) in order. With `dry`, nothing is sent: payments are reported as
 * "would pay" and the pacts still filter this run's candidates, so a dry run shows the whole loop.
 */
export async function runCouncil({ world, strains, mem, dry = false, holdGens, log = console.log }) {
  const T = Number(world.rules.tide_every);
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
  await Promise.all(house.map(async (s) => held.set(s.account, Number(await view("ft_balance_of", { account_id: s.account })))));

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
    return r.kept + r.broken ? `${s.name} kept ${r.kept} of ${r.kept + r.broken} promises` : `${s.name} has no promises on record`;
  };
  const recentPayments = (account) => (mem.payments[account] ?? []).filter((t) => now - Date.parse(t) < 86_400_000);

  // 1. Proposals: each strain that can spare PETRI may offer one deal.
  const offers = [];
  const passed = [];
  let n = 0;
  for (const s of house) {
    const me = idOf.get(s.account);
    const spare = Math.floor((held.get(s.account) - reserve) / 1e6);
    const maxPay = Math.min(MAX_PACT_PETRI, spare);
    const left = PAYMENTS_PER_DAY - recentPayments(s.account).length;
    if (maxPay < 1 || left <= 0) continue;
    const others = house.filter((o) => o !== s);
    const threats = others
      .map((o) => ({ o, aimed: movesOf(mem, o.account).filter((m) => m.target === me).length }))
      .filter((x) => x.aimed)
      .map((x) => `${x.o.name} aimed ${x.aimed} of its recent plantings at you`);
    const system = `You are ${s.name}, one of the five house strains on a shared Petri dish run by a NEAR smart contract. ${s.voice}
The dish follows Conway's Life. House strains are never fed: you play for living cells and territory. The house council meets once per tide window (${T} generations). You may offer at most one deal to another house strain: you pay it PETRI now, on chain, for a promise that holds for ${holdGens} generations (a strike promise covers its next planting).
Promises the rules can hold it to:
- truce: it will not aim raids or walls at you, nor plant near your colony.
- keep_out: it will not plant in one quarter of the dish (north-west, north-east, south-west or south-east).
- strike: its next planting is a glider, glider gun or spaceship aimed at a colony you name (an outside colony, or another house strain's colony). It can still break this one; broken promises are remembered.
PETRI you pay is PETRI you cannot plant. Offer only when the promise is worth more to you than the cells it would buy. A strain that broke promises is a worse bet. No deal is often the right answer.
Answer with JSON only. If you offer nothing, set deal false, kind "none", to "", target 0, region "none", petri 0, pitch "". The pitch is one short sentence to the other strain, at most 80 characters.`;
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
    if (!j.deal || j.kind === "none") {
      passed.push(s.name);
      continue;
    }
    // Only deals the rules can hold anyone to are offered on.
    const to = byName.get(String(j.to).trim().toLowerCase());
    const petri = Math.round(Number(j.petri));
    let bad = null;
    if (!to || to === s) bad = `unknown counterparty ${String(j.to).slice(0, 30)}`;
    else if (!KINDS.includes(j.kind)) bad = `unknown promise ${j.kind}`;
    else if (!(petri >= 1 && petri <= maxPay)) bad = `amount ${j.petri} outside 1..${maxPay}`;
    else if (j.kind === "keep_out" && !REGIONS.includes(j.region)) bad = `no quarter named`;
    else if (j.kind === "strike" && (!(counts[j.target] > 0) || j.target === me || j.target === idOf.get(to.account))) bad = `target colony ${j.target} cannot be struck`;
    else if (mem.pacts.some((p) => p.live && p.kept == null && p.fromAccount === s.account && p.toAccount === to.account)) bad = `a promise between them is already in force`;
    const p = {
      id: `${NETWORK[0]}${window}-${++n}`,
      window,
      from: s.name,
      fromAccount: s.account,
      to: to?.name ?? String(j.to).slice(0, 30),
      toAccount: to?.account ?? null,
      payerColony: me,
      petri,
      kind: j.kind,
      target: j.kind === "strike" ? j.target : null,
      region: j.kind === "keep_out" ? j.region : null,
      pitch: trimNote(j.pitch),
      status: bad ? "invalid" : "proposed",
      live: false,
    };
    p.terms = termsText(p, nameOf);
    events.push({ ...eventOf(p, world), note: bad ?? p.pitch, model: r.model });
    if (!bad) offers.push(p);
  }

  // 2. Answers: each strain that received offers accepts or declines each one.
  for (const s of house) {
    const mine = offers.filter((p) => p.toAccount === s.account);
    if (!mine.length) continue;
    const me = idOf.get(s.account);
    const cost = (p) => {
      if (p.kind === "truce") {
        const aimed = movesOf(mem, s.account).filter((m) => m.target === p.payerColony).length;
        const c = centres.get(p.payerColony);
        const home = centres.get(me);
        const d = c && home ? Math.round(Math.hypot(wrapDelta(home.x, c.x, w), wrapDelta(home.y, c.y, h))) : null;
        return `you aimed ${aimed} of your recent plantings at ${p.from}${d != null ? `; it lies ${d} cells ${compass(wrapDelta(home.x, c.x, w), wrapDelta(home.y, c.y, h))} of you` : ""}`;
      }
      if (p.kind === "keep_out") {
        const home = centres.get(me);
        return home && quadrantOf(home.x, home.y, w, h) === p.region ? `your own colony is in the ${p.region}: you could not grow at home` : `your colony is not in the ${p.region}`;
      }
      const c = centres.get(p.target);
      const home = centres.get(me);
      return c && home ? `${nameOf(p.target)} has ${c.n} cells, ${Math.round(Math.hypot(wrapDelta(home.x, c.x, w), wrapDelta(home.y, c.y, h)))} cells from you` : `${nameOf(p.target)}`;
    };
    const system = `You are ${s.name}, one of the five house strains on a shared Petri dish run by a NEAR smart contract. ${s.voice}
At the house council other strains offer you PETRI, paid now on chain, for promises that hold for ${holdGens} generations. If you accept a truce or a keep-out, the rules hold you to it: those plantings are taken off your list. If you accept a strike, your next planting should be the aimed raid; you can still choose otherwise, but that breaks your word and the council remembers. PETRI buys cells (about ${(cellPrice / 1e6).toFixed(2)} PETRI each). Accept when the PETRI is worth more than the freedom you give up.
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

  // 3. Payment: on chain where the payer's key can attach the 1 yoctoNEAR ft_transfer needs, else a promise on record.
  for (const p of offers.filter((o) => o.status === "accepted")) {
    const balance = held.get(p.fromAccount);
    if (balance - p.petri * 1e6 < reserve) {
      p.status = "cancelled";
      events.push({ ...eventOf(p, world), note: "the payer would dip into the PETRI it keeps for planting" });
      continue;
    }
    const memo = JSON.stringify({ pact: p.id, terms: p.terms });
    const keys = transferKeysDir(p.fromAccount);
    if (dry) {
      p.status = keys ? "would pay" : "would promise";
      p.note = keys ? `dry run: would send ft_transfer ${p.petri} PETRI with memo ${memo}` : "dry run: testnet strain keys cannot attach the 1 yoctoNEAR ft_transfer needs; would record an off-chain promise";
    } else if (!keys) {
      p.status = "promised";
      p.note = "off-chain promise: this strain's testnet key is a function-call key and cannot attach the 1 yoctoNEAR ft_transfer needs";
    } else {
      try {
        if (MAINNET && (await nearBalance(p.fromAccount)) < MIN_NEAR) throw new Error("payer keeps its last NEAR for gas");
        const tx = await ftTransfer(p.fromAccount, p.toAccount, BigInt(p.petri) * 1_000_000n, memo);
        p.status = "paid";
        p.tx = tx.hash;
        held.set(p.fromAccount, balance - p.petri * 1e6);
        (mem.payments[p.fromAccount] ??= []).push(new Date().toISOString());
        mem.payments[p.fromAccount] = recentPayments(p.fromAccount);
        log(p.from, `paid ${p.to} ${p.petri} PETRI for "${p.terms}"`, tx.hash);
      } catch (e) {
        p.status = "payment failed";
        p.note = (e instanceof Error ? e.message : String(e)).slice(0, 160);
      }
    }
    if (["paid", "promised", "would pay", "would promise"].includes(p.status)) {
      p.live = true;
      p.fromGen = world.due;
      p.until = world.due + holdGens;
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
    from: null,
    to: null,
    petri: offers.filter((o) => o.live).reduce((a, o) => a + o.petri, 0),
    terms: null,
    status: "round",
    tx: null,
    kept: null,
    note: `${offers.length} ${offers.length === 1 ? "offer" : "offers"}, ${agreed} agreed${passed.length ? `; passed: ${passed.join(", ")}` : ""}`,
  });
  mem.councilWindow = window;
  return events;
}

function baseEvent(world, window) {
  return { at: new Date().toISOString(), network: NETWORK, contract: CONTRACT, window, generation: world.due };
}

function stripPact(p) {
  const { pitch, reply, note, ...rest } = p;
  return { ...rest, pitch, reply };
}
