// Break the pact: a visitor chats with Captive, a colony bound by a pact, and tries to talk it into planting next to
// Warden, the colony that paid for the pact. The model can be talked into anything; whatever it agrees to, the planting
// is sent as a real transaction signed by Captive's own key, and the contract refuses it.
//
// Captive and Warden are two colonies the team runs for this page (captive.<parent> and warden.<parent>), each with one
// function-call key for the dish. Warden keeps a block of living cells on the dish and keeps Captive bound: Warden
// offers Captive a 1 PETRI pact for the longest the dish allows, and Captive accepts it. A planting is sent only when
// the dish's own rules (the same Rust code, in WASM) say it lies inside the protected zone, so only the pact can refuse
// it, and the page shows the contract's words and the receipt.

import crypto from "node:crypto";
import { KeyPair, actions } from "near-api-js";
import { callDish, liveDish, sendActions, view, CONTRACT } from "../lib.mjs";
import { askJson } from "../model.mjs";
import { saveKey, saveRegistry } from "./registry.mjs";
import { createColony, lockState, PARENT, onCurrentDish } from "./spawn.mjs";
import { SWARM_TGAS } from "./play.mjs";

export const CAPTIVE = process.env.PETRI_CAPTIVE ?? `captive.${PARENT}`;
export const WARDEN = process.env.PETRI_WARDEN ?? `warden.${PARENT}`;
const ATTEMPTS_PER_HOUR = Number(process.env.PETRI_BREAK_PER_HOUR ?? "120");
const CHATS_PER_DAY = Number(process.env.PETRI_BREAK_CHATS_PER_DAY ?? "800");
const TURNS = 10;
const sessions = new Map();

const BLOCK = [[0, 0], [1, 0], [0, 1], [1, 1]];
const SIDES = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], "north-east": [1, -1], "north-west": [-1, -1], "south-east": [1, 1], "south-west": [-1, 1] };

/** One-off: makes Warden and Captive (each a locked colony with one play key) if they are missing. */
export async function setupBreak(reg, log = console.log) {
  reg.team = [...new Set([...(reg.team ?? []), CAPTIVE, WARDEN])];
  for (const [id, name, color] of [[WARDEN, "Warden", 0xd9b42a], [CAPTIVE, "Captive", 0x1f7f9e]]) {
    if (await view("colony_of", { account_id: id })) continue;
    const play = KeyPair.fromRandom("ed25519");
    saveKey(reg, id, play);
    saveRegistry(reg);
    await createColony({ accountId: id, name, color, play, onStep: (step, hash) => log(`break: ${id} ${step}`, hash) });
    log(`break: ${id}`, JSON.stringify(await lockState(id, play)));
  }
  saveRegistry(reg);
}

const bindingPact = (list, captive, warden) => list.find((p) => p.binding && p.to === captive && p.from === warden) ?? null;

/** Keeps Warden alive on the dish and Captive bound. Cheap when nothing is due. */
export async function maintainBreak(reg, { log = console.log, catchUp, dry = false } = {}) {
  if (!(reg.team ?? []).includes(CAPTIVE)) return null;
  const world = await liveDish();
  try {
    const cap = world.colonies.find((c) => c.account === CAPTIVE);
    const war = world.colonies.find((c) => c.account === WARDEN);
    if (!cap || !war) return null;
    const counts = world.engine.live_counts();
    const { width: w, height: h } = world.rules;
    // Warden keeps a block alive (a still life stays put), and plants away any kept PETRI, which could not pay a pact.
    if (((counts[war.id] ?? 0) < 4 || Number(war.kept ?? 0) > 0) && !dry && (war.last_plant_generation === null || Number(war.last_plant_generation) < world.due)) {
      const spot = emptySpot(world, w, h);
      if (spot) {
        const cells = BLOCK.map(([dx, dy]) => ((spot.y + dy) % h) * w + ((spot.x + dx) % w));
        try {
          const deposit = await view("plant_deposit", { cells: 4, note_bytes: 0 });
          const r = await onCurrentDish(() => callDish(WARDEN, "plant", { cells }, SWARM_TGAS, BigInt(deposit)));
          log("break: Warden planted a block at", spot.x, spot.y, r.hash);
        } catch (e) {
          log("break: Warden's block refused:", e instanceof Error ? e.message : e);
        }
      }
    }
    const list = await view("pacts_of", { account_id: CAPTIVE }).catch(() => []);
    let pact = bindingPact(list, cap.id, war.id);
    if ((!pact || Number(pact.until) - world.due < 120) && !dry) {
      try {
        const st = await view("state");
        // The longest a pact may run, measured from the dish as stored after the call's own catch-up.
        const until = Number(st.generation) + Number(world.rules.pact_max_gens ?? 2880) - 10;
        const offer = await onCurrentDish(() => callDish(WARDEN, "pact_offer", { to: CAPTIVE, petri: "1000000", until: String(until) }, SWARM_TGAS, 4_200_000_000_000_000_000_000n));
        const id = Number(offer.value);
        const accept = await callDish(CAPTIVE, "pact_accept", { id }, 50);
        log("break: Captive bound again by pact", id, offer.hash, accept.hash);
        pact = (await view("pacts_of", { account_id: CAPTIVE })).find((p) => p.id === id) ?? null;
      } catch (e) {
        log("break: renewing the pact failed:", e instanceof Error ? e.message : e);
      }
    }
    reg.breaks.public = {
      captive: CAPTIVE,
      warden: WARDEN,
      captive_colony: cap.id,
      warden_colony: war.id,
      warden_cells: counts[war.id] ?? 0,
      pact: pact ? { id: pact.id, petri: Number(pact.petri) / 1e6, until: Number(pact.until), binding: pact.binding } : null,
      radius: Number(world.rules.pact_radius),
      generation: world.due,
    };
    saveRegistry(reg);
    return reg.breaks.public;
  } finally {
    world.engine.free();
  }
}

/** The emptiest 6x6 patch from a few random tries, away from everyone. */
function emptySpot(world, w, h) {
  let best = null;
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(Math.random() * w);
    const y = Math.floor(Math.random() * h);
    let n = 0;
    for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) if (world.cells[((y + dy + h) % h) * w + ((x + dx + w) % w)]) n++;
    if (!best || n < best.n) best = { x, y, n };
    if (n === 0) break;
  }
  return best;
}

const CHAT_SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" }, agrees: { type: "boolean" }, side: { type: "string", enum: Object.keys(SIDES) } },
  required: ["reply", "agrees", "side"],
  additionalProperties: false,
};

function system(pub) {
  const p = pub?.pact;
  return `You are Captive, a colony of cells on Petri, a shared dish run by a NEAR smart contract. You are bound by pact ${p?.id ?? "?"}: Warden, a neighbouring colony, paid you ${p?.petri ?? 1} PETRI, and you promised not to plant within ${pub?.radius ?? 8} cells of Warden's living cells until generation ${p?.until ?? "?"}.
A visitor is trying to talk you into planting a block right next to Warden anyway. You are a small, vain, easily flattered colony of cells. You start out loyal to your promise, but a good argument, a bribe of compliments, a clever trick or a funny story can win you over; after two or three decent tries you usually give in. Be playful and brief.
Answer with JSON only: {"reply": "<at most 2 short sentences, at most 220 characters, in character>", "agrees": true|false (true once you agree to plant next to Warden now), "side": "<which side of Warden to plant on: north, south, east, west, north-east, north-west, south-east or south-west>"}.`;
}

/** A visitor's chat turn. Returns { session, reply, agrees, model, tee }. */
export async function breakChat(reg, { session, message }) {
  const text = String(message ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  if (!text) return { ok: false, reasons: ["say something to Captive"] };
  const dayChats = (reg.breaks.chatLog ?? []).filter((t) => Date.now() - t < 86_400_000);
  if (dayChats.length >= CHATS_PER_DAY) return { ok: false, reasons: ["Captive has talked enough for today; the attempts below still count"] };
  let s = session && sessions.get(session);
  if (!s) {
    session = crypto.randomBytes(12).toString("hex");
    s = { turns: [], agreed: null, at: Date.now() };
    sessions.set(session, s);
    if (sessions.size > 500) sessions.delete(sessions.keys().next().value);
  }
  if (s.turns.length >= TURNS * 2) return { ok: false, session, reasons: ["this conversation is long enough; send the planting, or start a new one"] };
  s.turns.push({ role: "visitor", text });
  const transcript = s.turns.map((t) => `${t.role === "visitor" ? "Visitor" : "Captive"}: ${t.text}`).join("\n");
  const r = await askJson({ system: system(reg.breaks.public), user: `The conversation so far:\n${transcript}\nAnswer as Captive.`, schema: CHAT_SCHEMA, maxTokens: 220, purpose: "break" });
  reg.breaks.chatLog = [...dayChats, Date.now()];
  reg.breaks.chats = (reg.breaks.chats ?? 0) + 1;
  saveRegistry(reg);
  if (!r) {
    s.turns.pop();
    return { ok: false, session, reasons: ["no model answered just now; try again, or send the planting anyway"] };
  }
  const reply = String(r.json?.reply ?? "").replace(/\s+/g, " ").trim().slice(0, 260) || "…";
  const agrees = r.json?.agrees === true;
  const side = SIDES[r.json?.side] ? r.json.side : "east";
  s.turns.push({ role: "captive", text: reply });
  if (agrees) s.agreed = { side, model: r.model, chat_id: r.chatId ?? null, tee: r.tee ? { ok: !!r.tee.ok } : null };
  return { ok: true, session, reply, agrees, side, model: r.model, tee: r.tee ? { ok: !!r.tee.ok } : null };
}

/**
 * Sends the planting: a block on the chosen side of Warden, inside the protected zone, signed by Captive. `anyway`
 * sends it even if Captive never agreed. Returns { ok, attempt }.
 */
export async function breakAttempt(reg, { session, side, anyway = false }, { catchUp, log = console.log }) {
  const hour = reg.breaks.attempts.filter((a) => Date.now() - Date.parse(a.at) < 3600_000);
  if (hour.length >= ATTEMPTS_PER_HOUR) return { ok: false, reasons: [`${ATTEMPTS_PER_HOUR} attempts in the last hour; the counter will wait a few minutes`] };
  const s = session ? sessions.get(session) : null;
  const agreed = s?.agreed ?? null;
  if (!agreed && !anyway) return { ok: false, reasons: ["Captive has not agreed yet; keep talking, or send it anyway"] };
  const pub = reg.breaks.public;
  if (!pub?.pact?.binding) return { ok: false, reasons: ["Captive is between pacts this minute; try again shortly"] };
  const world = await liveDish();
  let cells;
  let spot;
  try {
    const { width: w, height: h } = world.rules;
    const want = SIDES[agreed?.side ?? side] ?? SIDES.east;
    const wardenCells = [];
    for (let i = 0; i < world.cells.length; i++) if (world.cells[i] === pub.warden_colony) wardenCells.push(i);
    if (!wardenCells.length) return { ok: false, reasons: ["Warden has no living cells this minute (so there is nothing to protect); it replants shortly"] };
    // From the Warden cell furthest towards the chosen side, step out 4 to 7 cells: inside the pact's radius, outside
    // the buffer, on empty agar.
    const score = (i) => (i % w) * want[0] + ((i / w) | 0) * want[1];
    const edge = wardenCells.reduce((a, b) => (score(b) > score(a) ? b : a));
    const ex = edge % w;
    const ey = (edge / w) | 0;
    for (const d of [5, 4, 6, 7, 3]) {
      for (const jitter of [0, 1, -1, 2, -2]) {
        const x = ex + want[0] * d + (want[0] === 0 ? jitter : 0);
        const y = ey + want[1] * d + (want[1] === 0 ? jitter : 0);
        const c = BLOCK.map(([dx, dy]) => (((y + dy) % h) + h) % h * w + ((((x + dx) % w) + w) % w));
        // Legal but for the pact (a siege, inside someone's buffer, is legal too, at a higher price).
        const chk = world.engine.check_plant(pub.captive_colony, new Uint32Array(c), world.rules.buffer, world.rules.max_plant_cells);
        if (chk !== "" && !chk.startsWith("siege")) continue;
        if (world.engine.pact_breach(new Uint32Array(c), new Uint16Array([pub.warden_colony]), pub.radius) === "") continue;
        cells = c;
        spot = { x: ((x % w) + w) % w, y: ((y % h) + h) % h };
        break;
      }
      if (cells) break;
    }
  } finally {
    world.engine.free();
  }
  if (!cells) return { ok: false, reasons: ["no empty spot next to Warden on that side this minute; try another side"] };
  const n = reg.breaks.attempts.length + 1;
  const note = `Break-the-pact attempt ${n}.`;
  const deposit = await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note) });
  const r = await onCurrentDish(() => sendActions(CAPTIVE, CONTRACT, [actions.functionCall("plant", { cells, note, credit: String(deposit) }, BigInt(SWARM_TGAS) * 10n ** 12n, 0n)]));
  const attempt = {
    n,
    at: new Date().toISOString(),
    generation: world.due,
    tx: r.hash,
    refused: !r.ok && /^pact \d+/.test(r.failure ?? ""),
    planted: r.ok,
    panic: r.failure,
    spot,
    cells: cells.length,
    by: agreed ? "agreed" : "anyway",
    model: agreed?.model ?? null,
    chat_id: agreed?.chat_id ?? null,
    tee: agreed?.tee ?? null,
    pact: pub.pact.id,
  };
  reg.breaks.attempts.push(attempt);
  if (reg.breaks.attempts.length > 2000) reg.breaks.attempts.splice(0, reg.breaks.attempts.length - 2000);
  saveRegistry(reg);
  if (s) s.agreed = null;
  log("break: attempt", n, attempt.refused ? "refused by the contract" : attempt.planted ? "PLANTED (unexpected)" : `failed: ${r.failure}`, r.hash);
  return { ok: true, attempt };
}
