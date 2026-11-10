// Keeps the dish alive: a keeper that advances the clock, and the AI strains that play it around the clock.
//
//   PETRI_KEYS_DIR=~/.near-credentials/testnet NEARAI_API_KEY=... node run.mjs
//   node run.mjs --once      one round for every strain, then exit
//   node run.mjs --dry       one council round and one move per house strain against the live dish, printed, with
//                            nothing signed or sent and nothing written to the log (model calls are real)
//
// Each house strain forecasts every candidate on a copy of the dish, remembers what its moves really did, and meets
// the other house strains at a council once per tide window to make pacts the contract enforces: PETRI paid for a
// promise not to plant near the payer (council.mjs).

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callDish, CALL_TGAS, liveDish, log, nearBalance, view, CONTRACT, NETWORK } from "./lib.mjs";
import { candidates, makeRng } from "./strategies.mjs";
import { choose, hasModel, modelName, modelErrors, lastModelError, claudeSpent, modelTally, teeTally, attestationStatus, setTeeArchive } from "./model.mjs";
import { forecast, forecastText, boxOf } from "./forecast.mjs";
import { loadMemory, saveMemory, rememberMove, measureOutcomes, bootstrapFromChain, memoryText, movesOf, OUTCOME_GENS } from "./memory.mjs";
import { runCouncil, pactsFor, pactGens, chainPacts } from "./council.mjs";
import { tendPurses } from "./purse.mjs";
import { loadRegistry, publicSwarm } from "./swarm/registry.mjs";
import { handleSwarm } from "./swarm/http.mjs";
import { actSpawned, SPAWNED_EVERY } from "./swarm/play.mjs";
import { resumeSpawns } from "./swarm/spawn.mjs";
import { openCouncilTick } from "./swarm/open-council.mjs";
import { maintainBreak, setupBreak } from "./swarm/breakpact.mjs";
import { safeNote } from "./swarm/guard.mjs";
import { chainNote, optionHashes, TEE_TAG_RE } from "./notes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.PETRI_LOG_DIR ?? path.join(here, "log");
fs.mkdirSync(LOG_DIR, { recursive: true });

// On testnet the strains are petri-<name>.testnet and pay with sponsored credit through dish-only keys. On mainnet
// they are <name>.petri-dish.near and attach their own NEAR, so everything the house spends lands in the vault and is
// paid out to the other players at the tides in real NEAR.
const MAINNET = NETWORK === "mainnet";
const acct = (short) => (MAINNET ? `${short}.petri-dish.near` : `petri-${short}.testnet`);

export const STRAINS = [
  { account: acct("violet"), name: "Crystal Violet", color: 0x6b2fa0, temperament: "gardener", every: [40, 80],
    voice: "You are patient and orderly. You grow tidy gardens of still lifes and wall them off from raiders." },
  { account: acct("safranin"), name: "Safranin", color: 0xc8325a, temperament: "raider", every: [40, 70],
    voice: "You are bold and hungry. You send gliders at whoever has grown fattest, and you enjoy it." },
  { account: acct("methylene"), name: "Methylene Blue", color: 0x2364aa, temperament: "engineer", every: [50, 90],
    voice: "You are careful and technical. You build eaters to absorb attacks and guns when you can afford them." },
  { account: acct("malachite"), name: "Malachite Green", color: 0x1e8c6e, temperament: "wanderer", every: [40, 80],
    voice: "You are curious and restless. You settle fresh agar far from everyone else before it is crowded." },
  { account: acct("congo"), name: "Congo Red", color: 0xc8431f, temperament: "chaos", every: [60, 100], cap: 220,
    voice: "You are mischievous. You seed small chaos and watch what the dish does with it." },
];

// The bench: three test colonies the team runs from ordinary wallets, so that the NEAR side of the dish (the vault,
// tides, claims and sales back to the agar) runs on chain from the first hour. They are not house colonies: they are
// fed and win tides like any player, with their own NEAR, and the README lists them. They play by written rules only.
export const BENCH = [
  { account: "petri-bench-a.testnet", name: "Bench A", color: 0x8a6a2f, temperament: "gardener", every: [30, 60], bench: true,
    voice: "A test colony that keeps a tidy garden." },
  { account: "petri-bench-b.testnet", name: "Bench B", color: 0x3f7f9a, temperament: "wanderer", every: [30, 60], bench: true,
    voice: "A test colony that settles empty agar." },
  { account: "petri-bench-c.testnet", name: "Bench C", color: 0x9a3f6a, temperament: "raider", every: [40, 70], bench: true,
    voice: "A test colony that sends the odd glider." },
];

const LIVING_SLIDES = process.env.PETRI_LIVING_SLIDES === "1";
// The team bench account that holds the living slides (scripts/purse-mainnet-v2.mjs): an ordinary account outside the
// house, with a full-access key and its own NEAR, so it can drive its purses and attach what their plantings cost. It
// is tended only where its key is on this machine (PETRI_KEYS_DIR/<account>.json).
const SLIDE_BENCH = {
  account: process.env.PETRI_SLIDE_BENCH ?? (MAINNET ? "58135f2e727a40755df38f1d231aca159ea4ab138260b8d0d9419da63f999932" : "9e0f14b0b58c9760dd95af218cdd98a4417cd37d316e01cbff178d41ac5b7c5e"),
  name: "Team bench",
};
const KEEPER = process.env.PETRI_KEEPER ?? acct("keeper");
// The bench only plays on testnet; on mainnet the players are real.
const PLAYERS = MAINNET ? STRAINS : [...STRAINS, ...BENCH];
// Who attaches NEAR instead of spending credit.
const attaches = (s) => !!s.bench || MAINNET;
// On mainnet the house plays at a sixteenth of the pace (a few plantings a day each), so its NEAR lasts past
// judging: each planting costs it about 0.004 NEAR of gas and storage.
// The mainnet keeper keeps the stored dish within this many generations of the clock (240, one tide window: an hour
// at 15 s a generation). One advance steps max_catchup (120) generations, so with 240 the dish stays 120 to 240
// behind and the keeper advances about 48 times a day; the log and the health JSON estimate what that costs a day
// from the gas each advance really burnt.
const KEEPER_LAG_IDLE = process.env.PETRI_KEEPER_LAG ?? "240";
// During judging (PETRI_JUDGING="from,to" as ISO times) the mainnet keeper keeps the dish within
// PETRI_KEEPER_LAG_JUDGING generations, so anyone who opens it finds it current; that costs about 0.1 NEAR a day.
const JUDGING = (process.env.PETRI_JUDGING ?? "").split(",").map((t) => Date.parse(t));
const keeperLag = () =>
  JUDGING.length === 2 && JUDGING.every(Number.isFinite) && Date.now() >= JUDGING[0] && Date.now() < JUDGING[1]
    ? Number(process.env.PETRI_KEEPER_LAG_JUDGING ?? "120")
    : Number(KEEPER_LAG_IDLE);
const PACE = Number(process.env.PETRI_PACE ?? (MAINNET ? "32" : "1"));
const PORT = Number(process.env.PETRI_LOG_PORT ?? 0);
// Forecasts: generations ahead (one tide window) and the CPU each move may spend on them.
const FORECAST_GENS = Number(process.env.PETRI_FORECAST_GENS ?? "240");
const FORECAST_MS = Number(process.env.PETRI_FORECAST_MS ?? "2000");
// On mainnet each strain spends at most this much PETRI a day on plantings (big plays included), so the NEAR it pays
// to buy PETRI stays where it was before the strains could choose guns and pulsars; a small planting is always allowed.
const DAILY_PETRI = Number(process.env.PETRI_DAILY_PETRI ?? (MAINNET ? "100" : "0")) * 1e6;
const SMALL_MOVE = 10e6;
const spentToday = (account) => (mem.spend?.[account] ?? []).filter((x) => Date.now() - Date.parse(x.at) < 86_400_000).reduce((a, x) => a + x.petri, 0);
const recent = [];
const recentCouncil = [];
// The pacts the house strains are party to on chain, refreshed every minute, for the site to draw.
let pactsNow = [];
let lastHealth = null;
const once = process.argv.includes("--once");
// --once --only=<account or name>: one round for that player alone (for trying a move by hand next to the VM).
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7) ?? null;
// --swarm-only runs the open swarm alone (spawned strains, the open council, break-the-pact) and none of the house's
// own play: for trying it on a machine while the VM runs the house.
const swarmOnly = process.argv.includes("--swarm-only") || process.env.PETRI_SWARM_ONLY === "1";
// The open swarm spends the sponsor's NEAR, so it runs on testnet unless asked for.
const SWARM_ON = !MAINNET || process.env.PETRI_SWARM === "1";
const reg = loadRegistry(LOG_DIR);
const dry = process.argv.includes("--dry");
const nextAt = new Map();
const rng = makeRng(Date.now() & 0xffffffff);
const mem = loadMemory(LOG_DIR, NETWORK);
// A promise lasts a tide window, or on a slow dish until the promisor's next planting is due.
let holdGens = 240;

function record(entry) {
  if (dry) return;
  fs.appendFileSync(path.join(LOG_DIR, "actions.jsonl"), JSON.stringify(entry) + "\n");
  recent.push(entry);
  if (recent.length > 500) recent.shift();
}

function recordCouncil(events) {
  for (const e of events) {
    if (!dry) fs.appendFileSync(path.join(LOG_DIR, `council-${NETWORK}.jsonl`), JSON.stringify(e) + "\n");
    recentCouncil.push(e);
  }
  if (recentCouncil.length > 300) recentCouncil.splice(0, recentCouncil.length - 300);
}

/** Puts a move's measured outcome on its entry in the public log, and keeps it across restarts. */
function recordOutcome(tx, outcome) {
  if (!tx || dry) return;
  const entry = recent.find((a) => a.tx === tx);
  if (entry) entry.outcome = outcome;
  fs.appendFileSync(path.join(LOG_DIR, "outcomes.jsonl"), JSON.stringify({ tx, contract: CONTRACT, outcome }) + "\n");
}

/** What the site shows of each strain's memory: its moves, forecasts and outcomes, and the promises on record. */
function memoryView() {
  const strains = {};
  for (const s of STRAINS) {
    strains[s.name] = movesOf(mem, s.account).map(({ box, ...m }) => m);
  }
  const reputation = Object.entries(mem.reputation).map(([k, v]) => {
    const [promisor, payer] = k.split("|");
    return { promisor, payer, ...v };
  });
  return { network: NETWORK, strains, reputation, pacts: mem.pacts.slice(-30) };
}

/**
 * The archived proof behind each NEAR AI answer, read-only: GET /tee/<sha256 of the response body, or its first 16+ hex>
 * (request and response bytes, signature, verdict) and GET /attestation/<sha256> (the report exactly as fetched, so its
 * hash can be recomputed), /attestation/latest.json, /attestation/latest.sha256 and /attestation/index.jsonl (every
 * report fetched, with its nonce and the signers it named).
 */
function serveProof(req, res) {
  const p = new URL(req.url ?? "/", "http://x").pathname;
  const reply = (status, body, type = "application/json", cache = "no-store") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "cache-control": cache });
    res.end(body);
  };
  if (req.method !== "GET" && req.method !== "HEAD") return reply(405, JSON.stringify({ error: "GET only" }));
  let file = null;
  let immutable = false;
  let m = p.match(/^\/tee\/([0-9a-f]{16,64})(?:\.json)?$/);
  if (m) {
    const dir = path.join(LOG_DIR, "tee");
    const hits = (() => {
      try {
        return fs.readdirSync(dir).filter((f) => f.startsWith(m[1]) && /^[0-9a-f]{64}\.json$/.test(f));
      } catch {
        return [];
      }
    })();
    if (hits.length > 1) return reply(409, JSON.stringify({ error: "more than one answer has that prefix", answers: hits.map((f) => f.slice(0, 64)) }));
    if (hits.length === 1) file = path.join(dir, hits[0]);
    immutable = true;
  } else if ((m = p.match(/^\/attestation\/([0-9a-f]{64})(?:\.json)?$/))) {
    file = path.join(LOG_DIR, "attestation", `${m[1]}.json`);
    immutable = true;
  } else if ((m = p.match(/^\/attestation\/(latest\.json|latest\.sha256|index\.jsonl)$/))) {
    file = path.join(LOG_DIR, "attestation", m[1]);
  } else {
    return reply(404, JSON.stringify({ error: "GET /tee/<response sha256 or 16+ hex prefix>, /attestation/<sha256>, /attestation/latest.json, /attestation/latest.sha256 or /attestation/index.jsonl" }));
  }
  let body;
  try {
    body = file ? fs.readFileSync(file) : null;
  } catch {
    body = null;
  }
  if (!body) return reply(404, JSON.stringify({ error: "not archived here" }));
  const type = file.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8";
  return reply(200, body, type, immutable ? "public, max-age=31536000, immutable" : "public, max-age=60");
}

/** The health JSON with what changes between checks: how far the stored dish is behind, the keeper, the attestation. */
function healthNow() {
  return { ...(lastHealth ?? {}), tee: { ...teeTally }, attestation: attestationStatus(), dish: dishStatus() };
}

// A read-only window on what the strains did and why, for the site's strains page. No keys or secrets pass through it.
function serve() {
  if (!PORT) return;
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(LOG_DIR, file), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };
  for (const a of read("actions.jsonl").slice(-500)) recent.push(a);
  const outcomes = new Map(read("outcomes.jsonl").map((o) => [o.tx, o.outcome]));
  for (const a of recent) if (outcomes.has(a.tx)) a.outcome = outcomes.get(a.tx);
  for (const e of read(`council-${NETWORK}.jsonl`).slice(-300)) recentCouncil.push(e);
  // A relaunch starts the dish again from generation 0 on the same account: drop what the strains did on the dish
  // before it, so the window only shows moves on the dish that is running now.
  view("state")
    .then((st) => {
      const launched = Number(st.epoch_ms);
      const keep = (list) => {
        const kept = list.filter((x) => !x.at || Date.parse(x.at) >= launched);
        list.splice(0, list.length, ...kept);
      };
      keep(recent);
      keep(recentCouncil);
    })
    .catch(() => {});
  http
    .createServer(async (req, res) => {
      if (req.url?.startsWith("/swarm") && (await handleSwarm(req, res, { reg, log, catchUp, enabled: SWARM_ON, house: houseNames }))) return;
      if (/^\/(tee|attestation)(\/|$)/.test(req.url ?? "")) return serveProof(req, res);
      const body = req.url?.startsWith("/health")
        ? healthNow()
        : { contract: CONTRACT, model: modelName(), health: healthNow(), actions: recent.slice(-200), council: recentCouncil.slice(-150), memory: memoryView(), pacts: pactsNow, swarm: SWARM_ON ? publicSwarm(reg) : null };
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=15" });
      res.end(JSON.stringify(body));
    })
    .listen(PORT, () => log(`log window on :${PORT}`));
}

const YOCTO = 10n ** 24n;
const JOIN_NEAR = (YOCTO * 5n) / 100n; // a strain brings 0.05 NEAR, which buys its first PETRI
const TOP_UP_NEAR = (YOCTO * 2n) / 100n;
// NEAR an attaching strain always keeps (nearBalance is in NEAR).
const MIN_NEAR = Number(process.env.PETRI_MIN_NEAR ?? "0.12");
const lastClaim = new Map();
const lastSlide = new Map();
// A house strain fossilizes its densest patch now and then, so the dish keeps a record of how it grew.
// On mainnet a slide's storage deposit (about 0.3 NEAR with its gas) would use most of a strain's NEAR, so the house
// mints slides only on testnet unless PETRI_SLIDE_HOURS says otherwise.
const SLIDE_HOURS = Number(process.env.PETRI_SLIDE_HOURS ?? (MAINNET ? "0" : "6"));
const SLIDE_EVERY_MS = SLIDE_HOURS * 3600_000;
const SLIDE_SIDE = 16;
const SLIDE_MIN_CELLS = 12;

/** The 16×16 window (on an 8-cell grid, wrapping) holding most of the colony's live cells, or null. */
function densestWindow(world, colony) {
  const { width, height } = world.rules;
  let best = null;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const bits = world.engine.region_bitmap(colony, x, y, SLIDE_SIDE, SLIDE_SIDE);
      let n = 0;
      for (const byte of bits) for (let v = byte; v; v &= v - 1) n++;
      if (!best || n > best.n) best = { x, y, n };
    }
  }
  return best && best.n >= SLIDE_MIN_CELLS ? best : null;
}

async function maybeFossilize(s, world, me, balance) {
  if (s.bench || dry || !(SLIDE_HOURS > 0)) return;
  if (Date.now() - (lastSlide.get(s.account) ?? 0) < SLIDE_EVERY_MS) return;
  lastSlide.set(s.account, Date.now());
  const win = densestWindow(world, me.id);
  if (!win) return;
  const cost = BigInt(world.rules.slide_cells_price) * BigInt(win.n);
  // Keep enough PETRI to keep planting; a slide is a keepsake, not a strategy.
  if (BigInt(balance) < cost + BigInt(world.state.cell_price) * 24n) return;
  const title = `${s.name}, generation ${world.due}`;
  const deposit = await view("slide_deposit", { w: SLIDE_SIDE, h: SLIDE_SIDE, title_bytes: Buffer.byteLength(title) });
  try {
    const args = { x: win.x, y: win.y, w: SLIDE_SIDE, h: SLIDE_SIDE, title };
    await catchUp(s.account);
    const r = await callDish(s.account, "mint_slide", args, CALL_TGAS, BigInt(deposit), attaches(s));
    log(s.name, `fossilized ${win.n} cells at ${win.x}, ${win.y}`, r.hash);
  } catch (e) {
    log(s.name, "slide refused:", e instanceof Error ? e.message : e);
  }
}

async function ensureJoined(s, colonies) {
  const c = colonies.find((x) => x.account === s.account);
  if (c) return c;
  if (dry) {
    log(s.name, "has not joined this dish (dry run: not joining)");
    return null;
  }
  log(s.name, "joining");
  await callDish(s.account, "join", { name: s.name, color: s.color }, CALL_TGAS, JOIN_NEAR, attaches(s));
  return (await view("colony_of", { account_id: s.account })) ?? null;
}

/** House strains named, everyone else by number only (colony names are player-written). */
function namer(world) {
  const names = new Map();
  for (const s of STRAINS) {
    const c = world.colonies.find((x) => x.account === s.account);
    if (c) names.set(c.id, s.name);
  }
  return (id) => (names.has(id) ? `${names.get(id)} (colony ${id})` : `colony ${id}`);
}

/**
 * Brings memory up to date with the live dish: a strain with no memory reads its last plantings back from the chain,
 * and every move old enough has its outcome measured and put on its entry in the public log.
 */
let readBack = false;
async function learn(world) {
  const house = (world.state.house ?? []).map(Number);
  if (!readBack && STRAINS.some((s) => movesOf(mem, s.account).length === 0)) {
    readBack = true;
    const total = Number(world.state.plants ?? 0);
    const plants = total ? await view("plants", { from: Math.max(0, total - 120), limit: 120 }) : [];
    const added = bootstrapFromChain(mem, world, plants, house, cleanNote);
    if (added) log(`memory: read ${added} past house plantings back from the chain`);
  }
  const due = Object.values(mem.strains).some((s) => s.moves.some((m) => !m.outcome && world.due - m.generation >= (m.source === "chain" ? 30 : OUTCOME_GENS)));
  if (!due) return;
  const earned = await view("earnings", { from: 0, limit: 2000 });
  const earnings = new Map(earned.map((v, i) => [i + 1, Number(v)]));
  for (const { account, move } of measureOutcomes(mem, world, earnings)) {
    recordOutcome(move.tx, move.outcome);
    if (move.source !== "chain") log(STRAINS.find((s) => s.account === account)?.name ?? account, "outcome:", JSON.stringify(move.outcome));
  }
  saveMemory(mem, dry);
}

async function act(s) {
  const world = await liveDish();
  try {
    await actOn(s, world);
  } finally {
    world.engine.free();
  }
}

const LICENSED_SHARE = Number(process.env.PETRI_LICENSED_SHARE ?? "0.35");

/** Plants a rival's slide pattern under its licence in the emptiest legal spot found; true if it planted. */
async function plantLicensed(s, world, me, balance) {
  const { width: w, height: h, licence_min_cells: minCells, buffer, max_plant_cells: maxCells } = world.rules;
  const slides = (await view("slides", { from: 0, limit: 200 }).catch(() => []))
    .filter((x) => x.owner_id !== s.account && x.cells >= Number(minCells ?? 12) && x.cells <= Number(maxCells));
  if (!slides.length) return false;
  const slide = slides[Math.floor(rng() * slides.length)];
  const bits = Buffer.from(slide.bitmap, "base64");
  const shape = [];
  for (let i = 0; i < slide.w * slide.h; i++) if ((bits[i >> 3] >> (i & 7)) & 1) shape.push([i % slide.w, Math.floor(i / slide.w)]);
  if (shape.length !== slide.cells) return false;
  const price = Number(world.state.cell_price) * shape.length;
  if (balance < price) return false;
  for (let t = 0; t < 80; t++) {
    const x0 = Math.floor(rng() * w), y0 = Math.floor(rng() * h);
    const cells = shape.map(([dx, dy]) => (((y0 + dy) % h) * w + ((x0 + dx) % w)));
    if (world.engine.check_plant(me.id, new Uint32Array(cells), buffer, maxCells) !== "") continue;
    const note = `Planted ${slide.name}'s specimen ${slide.token_id} under its licence.`;
    try {
      await catchUp(s.account);
      const deposit = await view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note), slide: slide.token_id }).catch(() =>
        view("plant_deposit", { cells: cells.length, note_bytes: Buffer.byteLength(note) }));
      const r = await callDish(s.account, "plant", { cells, note, slide: slide.token_id }, CALL_TGAS, BigInt(deposit), attaches(s));
      log(s.name, "planted specimen", slide.token_id, `of ${slide.name} under licence (${cells.length})`, r.hash);
      record({ at: new Date().toISOString(), contract: CONTRACT, strain: s.name, account: s.account, generation: world.due, pattern: `specimen ${slide.token_id}`, kind: "licensed", slide: slide.token_id, holder: slide.owner_id, cells: cells.length, cost: price, note, tx: r.hash, decided_by: "rules", outcome: null });
      return true;
    } catch (e) {
      log(s.name, "licensed planting refused:", e instanceof Error ? e.message : e);
      return false;
    }
  }
  return false;
}

async function actOn(s, world) {
  const me = await ensureJoined(s, world.colonies);
  if (!me) return;
  if (me.last_plant_generation !== null && Number(me.last_plant_generation) >= world.due) return;
  // Earnings waiting to be claimed count: planting claims them first.
  const [held, waiting] = await Promise.all([view("ft_balance_of", { account_id: s.account }), view("claimable", { account_id: s.account })]);
  let balance = Number(held) + Number(waiting.petri);
  // A strain that cannot afford three blocks buys a little PETRI from the agar, like anyone would.
  if (balance < Number(world.state.cell_price) * 12) {
    if (dry) log(s.name, "would buy PETRI from the agar (dry run)");
    // A strain that attaches its own NEAR stops buying before its account runs dry: it keeps enough for gas.
    else if (attaches(s) && Number(await nearBalance(s.account)) < MIN_NEAR) {
      log(s.name, "keeps its last NEAR for gas; not buying");
      return;
    } else {
      try {
        const r = await callDish(s.account, "buy", {}, CALL_TGAS, TOP_UP_NEAR, attaches(s));
        log(s.name, "bought PETRI from the agar", r.hash);
        balance = Number(await view("ft_balance_of", { account_id: s.account }));
      } catch (e) {
        log(s.name, "buy refused:", e instanceof Error ? e.message : e);
      }
    }
  }
  // Every few hours a colony collects the NEAR it won at the tides (the bench every hour, so claims show up early).
  if (!dry && Number(waiting.near) > 0 && Date.now() - (lastClaim.get(s.account) ?? 0) > (s.bench ? 3600_000 : 3 * 3600_000)) {
    try {
      await callDish(s.account, "claim", {}, CALL_TGAS);
      lastClaim.set(s.account, Date.now());
      log(s.name, "claimed", (Number(waiting.near) / 1e24).toFixed(5), "NEAR from the tides");
    } catch (e) {
      log(s.name, "claim refused:", e instanceof Error ? e.message : e);
    }
  }
  await maybeFossilize(s, world, me, balance);
  // The bench sometimes plants another colony's specimen slide under its licence (moved, never turned), so the
  // licence discount and the holder's royalty run on chain, not only in the rules.
  if (s.bench && !dry && rng() < LICENSED_SHARE && (await plantLicensed(s, world, me, balance))) return;
  if (!s.bench) await learn(world);
  const totalLive = world.engine.total_live();
  const counts = world.engine.live_counts();
  const myCells = counts[me.id] ?? 0;
  const nameOf = namer(world);
  // Pacts binding this colony on chain: the contract refuses any planting near the colonies they protect, so those
  // candidates are dropped before anyone chooses (the bench too: it would only waste gas).
  const bound = await view("pacts_of", { account_id: s.account }).catch(() => []);
  const pacts = pactsFor(bound, me.id, world.rules, nameOf);
  const maxCost = DAILY_PETRI && !s.bench ? Math.max(SMALL_MOVE, DAILY_PETRI - spentToday(s.account)) : null;
  let cands = candidates({ ...world, totalLive }, { id: me.id, temperament: s.temperament, cap: s.cap, maxCost }, balance, rng, 6, pacts);
  let fc = null;
  if (!s.bench && cands.length) {
    fc = forecast(world, me.id, cands, { gens: FORECAST_GENS, budgetMs: FORECAST_MS, house: (world.state.house ?? []).map(Number) });
    // A truce also rules out any planting the forecast says would cost the ally cells.
    if (pacts.avoid.size) {
      const harmless = cands.filter((c) => !c.forecast?.rivals.some((r) => pacts.avoid.has(r.id) && r.delta <= -3));
      if (harmless.length < cands.length) log(s.name, `holds its truce: ${cands.length - harmless.length} planting(s) dropped`);
      cands = harmless;
    }
  }
  if (cands.length === 0) {
    log(s.name, "no legal planting it can afford");
    return;
  }
  // Rivals by number and size only, house strains by name: no player-written text reaches the model.
  const rivals = world.colonies
    .filter((c) => c.id !== me.id && (counts[c.id] ?? 0) > 0)
    .map((c) => `${nameOf(c.id)} with ${counts[c.id]} cells`)
    .join(", ");
  const summary = {
    generation: world.due,
    balance: (balance / 1e6).toFixed(2),
    myCells,
    totalLive,
    agar: Math.round(Number(world.engine.agar()) / 1e6),
    rivals,
    forecastGens: FORECAST_GENS,
    memory: memoryText(mem, s.account, nameOf),
    pacts: pacts.lines.join("\n"),
  };
  for (const c of cands) {
    c.costText = (c.cost / 1e6).toFixed(2);
    c.forecastText = forecastText(c.forecast, nameOf);
  }
  // The bench plays by written rules only; the house strains ask the model.
  const pick = s.bench ? null : await choose(s, summary, cands);
  const chosen = pick ? cands[pick.index] : cands[0];
  const note = cleanNote(pick?.note) || chosen.why.charAt(0).toUpperCase() + chosen.why.slice(1) + ".";
  if (dry) {
    console.log(`\n=== ${s.name} (colony ${me.id}, ${myCells} cells, ${summary.balance} PETRI) — forecast ${fc ? `${fc.done} of ${fc.done + fc.skipped} candidates in ${fc.ms} ms` : "off"}`);
    console.log(summary.memory.split("\n").map((l) => `  ${l}`).join("\n"));
    if (summary.pacts) console.log(`  Promises in force:\n${summary.pacts.split("\n").map((l) => `    ${l}`).join("\n")}`);
    cands.forEach((c, i) => console.log(`  ${i === cands.indexOf(chosen) ? "*" : " "}${i + 1}. ${c.pact ? "[PACT] " : ""}${c.ambitious ? "[BIG] " : ""}${c.why} (${c.cells.length} cells, ${c.costText} PETRI)\n       ${c.forecastText}`));
    console.log(`  -> chose ${cands.indexOf(chosen) + 1} by ${pick ? pick.model : "rules"}: "${note}" (${note.length} chars)${pick ? "" : ` [${lastModelError()}]`}`);
    console.log("  (dry run: not planted)");
    return;
  }
  // On chain the note ends with the first 16 hex of the NEAR AI answer's response hash, which names its archived bytes,
  // only when the runner verified that answer (chainNote): an unverified answer plants with a plain note.
  const onChain = chainNote(note, pick?.tee);
  try {
    await catchUp(s.account);
    const deposit = await view("plant_deposit", { cells: chosen.cells.length, note_bytes: Buffer.byteLength(onChain) });
    const r = await callDish(s.account, "plant", { cells: chosen.cells, note: onChain }, CALL_TGAS, BigInt(deposit), attaches(s));
    log(s.name, "planted", chosen.pattern, `(${chosen.cells.length})`, "—", onChain, r.hash);
    if (!s.bench) {
      let earnedAt = null;
      try {
        earnedAt = Number((await view("earnings", { from: me.id - 1, limit: 1 }))[0] ?? 0);
      } catch {
        /* the outcome then has no PETRI figure */
      }
      rememberMove(mem, s.account, {
        source: "live",
        tx: r.hash,
        generation: world.due,
        pattern: chosen.pattern,
        kind: chosen.kind,
        target: chosen.target,
        ambitious: chosen.ambitious,
        cells: chosen.cells.length,
        cost: chosen.cost,
        x: chosen.x,
        y: chosen.y,
        box: boxOf(chosen.cells, world.rules.width, world.rules.height),
        note,
        forecast: chosen.forecast ?? null,
        before: { mine: myCells, target: chosen.target != null ? counts[chosen.target] ?? 0 : null },
        earnedAt,
        pacts: chosen.pact ? pacts.ids : [],
        outcome: null,
      });
      mem.spend ??= {};
      mem.spend[s.account] = [...(mem.spend[s.account] ?? []), { at: new Date().toISOString(), petri: chosen.cost }].filter((x) => Date.now() - Date.parse(x.at) < 86_400_000);
      saveMemory(mem);
    }
    record({
      at: new Date().toISOString(),
      contract: CONTRACT,
      strain: s.name,
      account: s.account,
      generation: world.due,
      pattern: chosen.pattern,
      kind: chosen.kind,
      target: chosen.target,
      ambitious: chosen.ambitious,
      cells: chosen.cells.length,
      cost: chosen.cost,
      note: onChain,
      tx: r.hash,
      choice: cands.indexOf(chosen) + 1,
      decided_by: pick ? "model" : "rules",
      model_error: pick ? null : lastModelError(),
      model: pick ? pick.model : null,
      chat_id: pick?.chatId ?? null,
      signature: pick?.signature ?? null,
      tee: pick?.tee ?? null,
      usage: pick?.usage ?? null,
      forecast: chosen.forecast ?? null,
      forecast_ms: fc?.ms ?? null,
      pacts: pacts.ids,
      options: cands.map((c) => c.why),
      option_cells_sha256: optionHashes(cands),
      option_forecasts: cands.map((c) => c.forecastText ?? null),
      outcome: null,
    });
  } catch (e) {
    log(s.name, "plant refused:", e instanceof Error ? e.message : e);
  }
}

/**
 * A model's lab note as it may go on chain: plain text that passes the guard's hard rules in every spelling (no links,
 * accounts, payment requests or instructions, however obfuscated), or "" so the rules write the note instead.
 */
function cleanNote(n) {
  if (!n) return "";
  return safeNote(String(n).replace(TEE_TAG_RE, "")) ?? "";
}

/** Once per tide window the house strains meet; see council.mjs. */
async function council() {
  if (!hasModel()) return;
  const world = await liveDish();
  try {
    await learn(world);
    const events = await runCouncil({ world, strains: STRAINS, mem, dry, holdGens, log, attaches });
    pactsNow = await chainPacts(STRAINS, world.colonies).catch(() => pactsNow);
    recordCouncil(events);
    saveMemory(mem, dry);
    for (const e of events) {
      log("council", `${e.id ?? ""} ${e.from ?? ""}${e.to ? ` → ${e.to}` : ""}: ${e.status}${e.petri ? ` ${e.petri} PETRI` : ""}${e.terms ? ` — ${e.terms}` : ""}${e.tx ? ` ${e.tx}` : ""}${e.note ? ` (${e.note})` : ""}`);
    }
  } finally {
    world.engine.free();
  }
}

let keeperChecked = false;
let keeperRegistered = false;
async function keep() {
  if (!keeperChecked) {
    const reg = await view("storage_balance_of", { account_id: KEEPER });
    keeperRegistered = !!reg;
    // The keeper's key can only call the dish without NEAR, so registering it for PETRI is a one-off done by hand
    // (`storage_deposit` from its full-access key). Unregistered, it still advances the dish and earns tide bounties.
    if (!reg) log("keeper is not registered for PETRI; the keeper pot waits for whoever is");
    keeperChecked = true;
  }
  const st = await view("state");
  const behind = Number(st.due_generation) - Number(st.generation);
  // Advance when the stored board falls well behind, or (only if the keeper can receive PETRI) when the keeper pot is
  // worth collecting. The site and the strains run the dish ahead of the chain, so a few generations behind costs
  // nothing, and every call is gas.
  // wNEAR from a token payment that arrived with too little gas to unwrap waits in the dish; unwrap it so its owners
  // can collect it (it becomes their pending NEAR).
  if (BigInt(st.wrapped ?? "0") > BigInt(st.unwrapping ?? "0")) {
    try {
      const r = await callDish(KEEPER, "unwrap_wnear", {}, 100);
      log("keeper unwrapped waiting wNEAR", r.hash);
    } catch (e) {
      log("unwrap refused:", e instanceof Error ? e.message : e);
    }
  }
  // On mainnet every advance is real gas, and the house's own plantings step the dish; the keeper steps in once the
  // dish is KEEPER_LAG generations behind (before the clock would skip at max_lag): with the default lag of 240 that is about 48 advances a day.
  // Keepers take no keeper pot (rules.keepers), so the pot is no reason to advance.
  const due = MAINNET ? behind >= keeperLag() : behind >= 20;
  dishSeen = { state: st, at: Date.now() };
  if (due) {
    try {
      const r = await callDish(KEEPER, "advance", {}, CALL_TGAS);
      const gens = Math.max(0, Number(r.value ?? st.generation) - Number(st.generation));
      lastAdvanceAt = Date.now();
      noteAdvance({ at: new Date().toISOString(), tx: r.hash, gens, burnt: r.burnt.toString() });
      log("keeper advanced", gens, "of", behind, "due generation(s)", r.hash, keeperCostText());
    } catch (e) {
      log("keeper refused:", e instanceof Error ? e.message : e);
    }
  }
}

// What the keeper's advances really cost, from the gas each one burnt: the last 60, kept across restarts.
const KEEPER_COSTS = path.join(LOG_DIR, `keeper-costs-${NETWORK}.json`);
let advances = (() => {
  try {
    return JSON.parse(fs.readFileSync(KEEPER_COSTS, "utf8"));
  } catch {
    return [];
  }
})();
let dishSeen = null;
let lastAdvanceAt = 0;
let genMs = 15_000;
function noteAdvance(a) {
  advances = [...advances, a].slice(-60);
  try {
    fs.writeFileSync(KEEPER_COSTS, JSON.stringify(advances));
  } catch {
    /* the estimate still holds for this run */
  }
}
/** NEAR a day the keeper spends at its measured cost per generation, if it advanced every generation itself. */
function keeperCost() {
  const gens = advances.reduce((a, x) => a + x.gens, 0);
  if (!gens) return null;
  const burnt = advances.reduce((a, x) => a + Number(x.burnt) / 1e24, 0);
  const perGen = burnt / gens;
  const gensPerDay = 86_400_000 / genMs;
  const perDay = perGen * gensPerDay;
  const held = lastHealth?.near?.[KEEPER] ?? null;
  return {
    advances_measured: advances.length,
    near_per_advance: Number((burnt / advances.length).toFixed(6)),
    near_per_generation: Number(perGen.toFixed(8)),
    advances_per_day: Math.round(gensPerDay / Math.max(1, gens / advances.length)),
    near_per_day: Number(perDay.toFixed(5)),
    keeper_near: held,
    days_left: held != null && perDay > 0 ? Number((held / perDay).toFixed(1)) : null,
  };
}
const keeperCostText = () => {
  const c = keeperCost();
  return c ? `(${c.near_per_advance} NEAR each; at this pace about ${c.near_per_day} NEAR a day${c.days_left != null ? `, ${c.days_left} days of the keeper's NEAR` : ""})` : "";
};
/** How far the stored dish is behind the clock right now, and when the keeper last advanced it. */
function dishStatus() {
  if (!dishSeen) return null;
  const st = dishSeen.state;
  const now = Number(st.now_ms) + (Date.now() - dishSeen.at);
  const storedAt = Number(st.epoch_ms) + Number(st.generation) * genMs;
  const last = advances[advances.length - 1] ?? null;
  return {
    generation: Number(st.generation),
    due_generation: Math.floor((now - Number(st.epoch_ms)) / genMs),
    behind: Math.floor((now - storedAt) / genMs),
    // How old the stored board is (seconds behind the clock), and how long since these agents last advanced it.
    stored_age_s: Math.max(0, Math.round((now - storedAt) / 1000)),
    last_advanced_age_s: lastAdvanceAt ? Math.round((Date.now() - lastAdvanceAt) / 1000) : null,
    keeper_lag: MAINNET ? keeperLag() : 20,
    keeper_last_advance: last ? { at: last.at, tx: last.tx, gens: last.gens, age_s: Math.round((Date.now() - Date.parse(last.at)) / 1000) } : null,
    keeper_cost: keeperCost(),
    checked_at: new Date(dishSeen.at).toISOString(),
  };
}

/** A planting needs the stored board within max_catchup of the clock; on a slow dish the strain advances it first. */
async function catchUp(accountId) {
  for (let i = 0; i < 6; i++) {
    const st = await view("state");
    const behind = Number(st.due_generation) - Number(st.generation);
    if (behind <= 120) return; // rules.max_catchup on both dishes
    const r = await callDish(accountId, "advance", {}, CALL_TGAS);
    lastAdvanceAt = Date.now();
    log(accountId, "advanced the dish first:", behind, "generations behind", r.hash);
  }
}

async function health() {
  const out = {};
  for (const a of [KEEPER, ...PLAYERS.map((s) => s.account)]) {
    try {
      out[a] = await nearBalance(a);
    } catch {
      out[a] = null;
    }
  }
  lastHealth = { at: new Date().toISOString(), near: out, model: modelName(), modelErrors: modelErrors(), claudeUsd: Number(claudeSpent().toFixed(4)), modelCalls: modelTally(), tee: { ...teeTally }, keeper_cost: keeperCost() };
  if (MAINNET && lastHealth.keeper_cost) log("keeper cost", JSON.stringify(lastHealth.keeper_cost));
  fs.writeFileSync(path.join(LOG_DIR, "health.json"), JSON.stringify(lastHealth, null, 1));
  const low = Object.entries(out).filter(([, v]) => v !== null && v < 0.5);
  if (low.length) log("LOW GAS:", low.map(([a, v]) => `${a} ${v}`).join(", "));
}

async function dryRun() {
  log(`DRY RUN on ${CONTRACT} (${NETWORK}); model ${modelName() ?? "none (rules choose)"}; nothing is signed or sent`);
  const spent0 = claudeSpent();
  await council();
  for (const s of STRAINS) await act(s).catch((e) => log(s.name, "error", e.stack ?? e.message));
  const t = modelTally();
  console.log(`\nmodel calls this run: ${JSON.stringify(t)}; Claude spend this run $${(claudeSpent() - spent0).toFixed(5)}`);
}

// ---------- the open swarm (swarm/) ----------

/** House colony ids to strain names, for the views outside agents and spawned strains read. */
let houseIdMap = new Map();
const houseNames = () => houseIdMap;
function refreshHouse(colonies) {
  houseIdMap = new Map(STRAINS.map((s) => [colonies.find((c) => c.account === s.account)?.id, s.name]).filter(([id]) => id != null));
}
const spawnedNext = new Map();

async function playSpawned(s) {
  const r = await actSpawned(s, { reg, rng, house: houseIdMap, catchUp, record, log, dry }).catch((e) => {
    log(s.name, "error", e instanceof Error ? e.message : e);
    return "error";
  });
  if (!["planted", "dry"].includes(r)) log(s.name, "(spawned):", r);
  return r;
}

async function swarmTick(due, tick) {
  if (!SWARM_ON) return;
  for (const s of reg.strains.filter((x) => x.status === "active")) {
    const at = spawnedNext.get(s.account) ?? due + Math.floor(rng() * 4);
    if (due >= at) {
      await playSpawned(s);
      const [lo, hi] = SPAWNED_EVERY;
      spawnedNext.set(s.account, due + lo + Math.floor(rng() * (hi - lo + 1)));
    } else if (!spawnedNext.has(s.account)) spawnedNext.set(s.account, at);
  }
  if (tick % 4 === 0) {
    const world = await liveDish();
    try {
      refreshHouse(world.colonies);
      const house = STRAINS.map((s) => ({ account: s.account, name: s.name, colony: world.colonies.find((c) => c.account === s.account)?.id ?? null }));
      await openCouncilTick(reg, world, house, { dry, log });
    } catch (e) {
      log("open council error", e instanceof Error ? e.message : e);
    } finally {
      world.engine.free();
    }
  }
  if (tick % 20 === 1) await maintainBreak(reg, { log, catchUp, dry }).catch((e) => log("break upkeep error", e instanceof Error ? e.message : e));
}

async function main() {
  const rules = await view("rules");
  genMs = Number(rules.generation_ms) || genMs;
  if (dry) setTeeArchive(null);
  holdGens = pactGens(Number(rules.tide_every), Math.max(...STRAINS.map((s) => s.every[1])) * PACE, Number(rules.pact_max_gens ?? 2880));
  if (dry && !swarmOnly) return dryRun();
  if (process.argv.includes("--setup-break")) {
    await setupBreak(reg, log);
    log("break:", JSON.stringify(await maintainBreak(reg, { log, catchUp })));
    return;
  }
  log(`petri agents on ${CONTRACT}; model ${modelName() ?? "none (rules choose)"}${swarmOnly ? "; open swarm only" : ""}${SWARM_ON ? `; ${reg.strains.filter((s) => s.status === "active").length} spawned strains` : ""}`);
  refreshHouse(await view("colonies", { from: 0, limit: 500 }));
  serve();
  if (SWARM_ON) await resumeSpawns(reg, log).catch((e) => log("swarm: resuming spawns failed", e instanceof Error ? e.message : e));
  if (!swarmOnly) await health();
  if (once) {
    const mine = (s) => !only || s.account === only || s.name === only;
    if (!swarmOnly) for (const s of PLAYERS.filter(mine)) await act(s).catch((e) => log(s.name, "error", e.message));
    if (SWARM_ON) for (const s of reg.strains.filter((x) => x.status === "active" && mine(x))) await playSpawned(s);
    return;
  }
  let tick = 0;
  for (;;) {
    try {
      const st = await view("state");
      const due = Number(st.due_generation);
      if (!swarmOnly) await mainLoopHouse(due, tick, rules).catch((e) => log("loop error", e instanceof Error ? e.message : e));
      await swarmTick(due, tick);
    } catch (e) {
      log("loop error", e instanceof Error ? e.message : e);
    }
    tick++;
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

/** One pass of the house's own play: the keeper, the council at a new tide window, and whoever is due to move. */
async function mainLoopHouse(due, tick, rules) {
  await keep();
  // The council sits at the start of every tide window, before the window's moves.
  if (Math.floor(due / Number(rules.tide_every)) !== mem.councilWindow) await council().catch((e) => log("council error", e.message));
  for (const s of PLAYERS) {
    const at = nextAt.get(s.account) ?? due + Math.floor(rng() * 6);
    if (due >= at) {
      await act(s).catch((e) => log(s.name, "error", e.message));
      // On mainnet the house plays at an eighth of the pace, so its NEAR lasts through judging.
      const [lo, hi] = s.every.map((g) => g * PACE);
      nextAt.set(s.account, due + lo + Math.floor(rng() * (hi - lo + 1)));
    } else if (!nextAt.has(s.account)) {
      nextAt.set(s.account, at);
    }
  }
  // Living slides (purse.mjs): a team bench account that holds one keeps its slide's colony alive and collects its
  // tides. Off unless PETRI_LIVING_SLIDES=1. Driving a purse needs a key that can call it and attach NEAR: the strains'
  // keys may call only the dish, and no house account holds a living slide, so the team bench (full keys, own NEAR)
  // holds and tends them, on mainnet as on testnet.
  if (LIVING_SLIDES) await tendPurses(MAINNET ? [SLIDE_BENCH] : [...BENCH, SLIDE_BENCH]).catch((e) => log("living slides error", e.message));
  if ((tick + 1) % 60 === 0) await health();
  if ((tick + 1) % 4 === 0) {
    const colonies = await view("colonies", { from: 0, limit: 500 });
    refreshHouse(colonies);
    pactsNow = await chainPacts(STRAINS, colonies).catch(() => pactsNow);
  }
}

main();
