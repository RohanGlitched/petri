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
import { callDish, liveDish, log, nearBalance, view, CONTRACT, NETWORK } from "./lib.mjs";
import { candidates, makeRng } from "./strategies.mjs";
import { choose, hasModel, modelName, modelErrors, lastModelError, claudeSpent, modelTally } from "./model.mjs";
import { forecast, forecastText, boxOf } from "./forecast.mjs";
import { loadMemory, saveMemory, rememberMove, measureOutcomes, bootstrapFromChain, memoryText, movesOf, OUTCOME_GENS } from "./memory.mjs";
import { runCouncil, pactsFor, pactGens, chainPacts } from "./council.mjs";

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

const KEEPER = process.env.PETRI_KEEPER ?? acct("keeper");
// The bench only plays on testnet; on mainnet the players are real.
const PLAYERS = MAINNET ? STRAINS : [...STRAINS, ...BENCH];
// Who attaches NEAR instead of spending credit.
const attaches = (s) => !!s.bench || MAINNET;
// On mainnet the house plays at a sixteenth of the pace (a few plantings a day each), so its NEAR lasts past
// judging: each planting costs it about 0.004 NEAR of gas and storage.
const KEEPER_LAG = process.env.PETRI_KEEPER_LAG ?? "400";
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
  http
    .createServer((req, res) => {
      const body = req.url?.startsWith("/health")
        ? lastHealth
        : { contract: CONTRACT, model: modelName(), health: lastHealth, actions: recent.slice(-200), council: recentCouncil.slice(-150), memory: memoryView(), pacts: pactsNow };
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
const SLIDE_EVERY_MS = Number(process.env.PETRI_SLIDE_HOURS ?? (MAINNET ? "12" : "6")) * 3600_000;
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
  if (s.bench || dry) return;
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
    const r = await callDish(s.account, "mint_slide", args, 300, BigInt(deposit), attaches(s));
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
  await callDish(s.account, "join", { name: s.name, color: s.color }, 300, JOIN_NEAR, attaches(s));
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
        const r = await callDish(s.account, "buy", {}, 300, TOP_UP_NEAR, attaches(s));
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
      await callDish(s.account, "claim", {}, 300);
      lastClaim.set(s.account, Date.now());
      log(s.name, "claimed", (Number(waiting.near) / 1e24).toFixed(5), "NEAR from the tides");
    } catch (e) {
      log(s.name, "claim refused:", e instanceof Error ? e.message : e);
    }
  }
  await maybeFossilize(s, world, me, balance);
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
  try {
    const deposit = await view("plant_deposit", { cells: chosen.cells.length, note_bytes: Buffer.byteLength(note) });
    const r = await callDish(s.account, "plant", { cells: chosen.cells, note }, 300, BigInt(deposit), attaches(s));
    log(s.name, "planted", chosen.pattern, `(${chosen.cells.length})`, "—", note, r.hash);
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
      note,
      tx: r.hash,
      decided_by: pick ? "model" : "rules",
      model_error: pick ? null : lastModelError(),
      model: pick ? pick.model : null,
      chat_id: pick?.chatId ?? null,
      signature: pick?.signature ?? null,
      usage: pick?.usage ?? null,
      forecast: chosen.forecast ?? null,
      forecast_ms: fc?.ms ?? null,
      pacts: pacts.ids,
      options: cands.map((c) => c.why),
      option_forecasts: cands.map((c) => c.forecastText ?? null),
      outcome: null,
    });
  } catch (e) {
    log(s.name, "plant refused:", e instanceof Error ? e.message : e);
  }
}

/** A model's lab note, kept to plain text: no links, no account names, nothing invisible. */
function cleanNote(n) {
  if (!n) return "";
  const t = String(n)
    .normalize("NFKC")
    .replace(/[^ -~À-ɏ]/g, "")
    .replace(/\S+\.(near|testnet|com|org|io|xyz|app)/gi, "")
    .replace(/https?:\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return t.slice(0, 120);
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
  // dish is KEEPER_LAG generations behind (before the clock would skip at max_lag), about 14 times a day.
  // Keepers take no keeper pot (rules.keepers), so the pot is no reason to advance.
  const due = MAINNET ? behind >= Number(KEEPER_LAG) : behind >= 20;
  if (due) {
    try {
      const r = await callDish(KEEPER, "advance", {}, 300);
      log("keeper advanced", behind, "due generation(s)", r.hash);
    } catch (e) {
      log("keeper refused:", e instanceof Error ? e.message : e);
    }
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
  lastHealth = { at: new Date().toISOString(), near: out, model: modelName(), modelErrors: modelErrors(), claudeUsd: Number(claudeSpent().toFixed(4)), modelCalls: modelTally() };
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

async function main() {
  const rules = await view("rules");
  holdGens = pactGens(Number(rules.tide_every), Math.max(...STRAINS.map((s) => s.every[1])) * PACE, Number(rules.pact_max_gens ?? 2880));
  if (dry) return dryRun();
  log(`petri agents on ${CONTRACT}; model ${modelName() ?? "none (rules choose)"}`);
  serve();
  await health();
  if (once) {
    for (const s of PLAYERS) await act(s).catch((e) => log(s.name, "error", e.message));
    return;
  }
  let tick = 0;
  for (;;) {
    try {
      const st = await view("state");
      const due = Number(st.due_generation);
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
      if (++tick % 60 === 0) await health();
      if (tick % 4 === 0) {
        const colonies = await view("colonies", { from: 0, limit: 500 });
        pactsNow = await chainPacts(STRAINS, colonies).catch(() => pactsNow);
      }
    } catch (e) {
      log("loop error", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

main();
