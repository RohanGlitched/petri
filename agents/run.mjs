// Keeps the dish alive: a keeper that advances the clock, and the AI strains that play it around the clock.
//
//   PETRI_KEYS_DIR=~/.near-credentials/testnet NEARAI_API_KEY=... node run.mjs
//   node run.mjs --once      one round for every strain, then exit

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { callDish, liveDish, log, nearBalance, view, CONTRACT } from "./lib.mjs";
import { candidates, makeRng } from "./strategies.mjs";
import { choose, hasModel, MODEL, modelErrors, lastModelError } from "./model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.PETRI_LOG_DIR ?? path.join(here, "log");
fs.mkdirSync(LOG_DIR, { recursive: true });

export const STRAINS = [
  { account: "petri-violet.testnet", name: "Crystal Violet", color: 0x6b2fa0, temperament: "gardener", every: [40, 80],
    voice: "You are patient and orderly. You grow tidy gardens of still lifes and wall them off from raiders." },
  { account: "petri-safranin.testnet", name: "Safranin", color: 0xc8325a, temperament: "raider", every: [40, 70],
    voice: "You are bold and hungry. You send gliders at whoever has grown fattest, and you enjoy it." },
  { account: "petri-methylene.testnet", name: "Methylene Blue", color: 0x2364aa, temperament: "engineer", every: [50, 90],
    voice: "You are careful and technical. You build eaters to absorb attacks and guns when you can afford them." },
  { account: "petri-malachite.testnet", name: "Malachite Green", color: 0x1e8c6e, temperament: "wanderer", every: [40, 80],
    voice: "You are curious and restless. You settle fresh agar far from everyone else before it is crowded." },
  { account: "petri-congo.testnet", name: "Congo Red", color: 0xc8431f, temperament: "chaos", every: [60, 100], cap: 220,
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

const KEEPER = process.env.PETRI_KEEPER ?? "petri-keeper.testnet";
const PORT = Number(process.env.PETRI_LOG_PORT ?? 0);
const recent = [];
let lastHealth = null;
const once = process.argv.includes("--once");
const nextAt = new Map();
const rng = makeRng(Date.now() & 0xffffffff);

function record(entry) {
  fs.appendFileSync(path.join(LOG_DIR, "actions.jsonl"), JSON.stringify(entry) + "\n");
  recent.push(entry);
  if (recent.length > 500) recent.shift();
}

// A read-only window on what the strains did and why, for the site's strains page. No keys or secrets pass through it.
function serve() {
  if (!PORT) return;
  try {
    const lines = fs.readFileSync(path.join(LOG_DIR, "actions.jsonl"), "utf8").trim().split("\n").slice(-500);
    for (const l of lines) if (l) recent.push(JSON.parse(l));
  } catch {
    /* no log yet */
  }
  http
    .createServer((req, res) => {
      const body = req.url?.startsWith("/health") ? lastHealth : { contract: CONTRACT, model: hasModel() ? MODEL : null, health: lastHealth, actions: recent.slice(-200) };
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "public, max-age=15" });
      res.end(JSON.stringify(body));
    })
    .listen(PORT, () => log(`log window on :${PORT}`));
}

const YOCTO = 10n ** 24n;
const JOIN_NEAR = (YOCTO * 5n) / 100n; // a strain brings 0.05 NEAR, which buys its first PETRI
const TOP_UP_NEAR = (YOCTO * 2n) / 100n;
const lastClaim = new Map();

async function ensureJoined(s, colonies) {
  const c = colonies.find((x) => x.account === s.account);
  if (c) return c;
  log(s.name, "joining");
  await callDish(s.account, "join", { name: s.name, color: s.color }, 200, JOIN_NEAR, !!s.bench);
  return (await view("colony_of", { account_id: s.account })) ?? null;
}

async function act(s) {
  const world = await liveDish();
  const me = await ensureJoined(s, world.colonies);
  if (!me) return;
  if (me.last_plant_generation !== null && Number(me.last_plant_generation) >= world.due) return;
  // Earnings waiting to be claimed count: planting claims them first.
  const [held, waiting] = await Promise.all([view("ft_balance_of", { account_id: s.account }), view("claimable", { account_id: s.account })]);
  let balance = Number(held) + Number(waiting.petri);
  // A strain that cannot afford three blocks buys a little PETRI from the agar, like anyone would.
  if (balance < Number(world.state.cell_price) * 12) {
    try {
      const r = await callDish(s.account, "buy", {}, 150, TOP_UP_NEAR, !!s.bench);
      log(s.name, "bought PETRI from the agar", r.hash);
      balance = Number(await view("ft_balance_of", { account_id: s.account }));
    } catch (e) {
      log(s.name, "buy refused:", e instanceof Error ? e.message : e);
    }
  }
  // Every few hours a colony collects the NEAR it won at the tides (the bench every hour, so claims show up early).
  if (Number(waiting.near) > 0 && Date.now() - (lastClaim.get(s.account) ?? 0) > (s.bench ? 3600_000 : 3 * 3600_000)) {
    try {
      await callDish(s.account, "claim", {}, 150);
      lastClaim.set(s.account, Date.now());
      log(s.name, "claimed", (Number(waiting.near) / 1e24).toFixed(5), "NEAR from the tides");
    } catch (e) {
      log(s.name, "claim refused:", e instanceof Error ? e.message : e);
    }
  }
  const totalLive = world.engine.total_live();
  const myCells = world.engine.live_counts()[me.id] ?? 0;
  const cands = candidates({ ...world, totalLive }, { id: me.id, temperament: s.temperament, cap: s.cap }, balance, rng);
  if (cands.length === 0) {
    log(s.name, "no legal planting it can afford");
    return;
  }
  const counts = world.engine.live_counts();
  // Rivals by number and size only: no player-written text reaches the model.
  const rivals = world.colonies
    .filter((c) => c.id !== me.id && (counts[c.id] ?? 0) > 0)
    .map((c) => `colony ${c.id} with ${counts[c.id]} cells`)
    .join(", ");
  const summary = {
    generation: world.due,
    balance: (balance / 1e6).toFixed(2),
    myCells,
    totalLive,
    agar: Math.round(Number(world.engine.agar()) / 1e6),
    rivals,
  };
  for (const c of cands) c.costText = (c.cost / 1e6).toFixed(2);
  // The bench plays by written rules only; the house strains ask the model.
  const pick = s.bench ? null : await choose(s, summary, cands);
  const chosen = pick ? cands[pick.index] : cands[0];
  const note = cleanNote(pick?.note) || chosen.why.charAt(0).toUpperCase() + chosen.why.slice(1) + ".";
  try {
    const deposit = await view("plant_deposit", { cells: chosen.cells.length, note_bytes: Buffer.byteLength(note) });
    const r = await callDish(s.account, "plant", { cells: chosen.cells, note }, 200, BigInt(deposit), !!s.bench);
    log(s.name, "planted", chosen.pattern, `(${chosen.cells.length})`, "—", note, r.hash);
    record({
      at: new Date().toISOString(),
      contract: CONTRACT,
      strain: s.name,
      account: s.account,
      generation: world.due,
      pattern: chosen.pattern,
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
      options: cands.map((c) => c.why),
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

let keeperRegistered = false;
async function keep() {
  if (!keeperRegistered) {
    const reg = await view("storage_balance_of", { account_id: KEEPER });
    // The keeper's key can only call the dish without NEAR, so registering it for PETRI is a one-off done by hand
    // (`storage_deposit` from its full-access key). Unregistered, it still advances the dish and earns tide bounties.
    if (!reg) log("keeper is not registered for PETRI; the keeper pot waits for whoever is");
    keeperRegistered = true;
  }
  const st = await view("state");
  const behind = Number(st.due_generation) - Number(st.generation);
  // Advance when the stored board falls behind, or when the keeper pot is worth collecting.
  if (behind >= 5 || Number(st.keeper_pot) > 5_000_000) {
    try {
      const r = await callDish(KEEPER, "advance", {}, 250);
      log("keeper advanced", behind, "due generation(s)", r.hash);
    } catch (e) {
      log("keeper refused:", e instanceof Error ? e.message : e);
    }
  }
}

async function health() {
  const out = {};
  for (const a of [KEEPER, ...STRAINS.map((s) => s.account), ...BENCH.map((s) => s.account)]) {
    try {
      out[a] = await nearBalance(a);
    } catch {
      out[a] = null;
    }
  }
  lastHealth = { at: new Date().toISOString(), near: out, model: hasModel() ? MODEL : null, modelErrors: modelErrors() };
  fs.writeFileSync(path.join(LOG_DIR, "health.json"), JSON.stringify(lastHealth, null, 1));
  const low = Object.entries(out).filter(([, v]) => v !== null && v < 0.5);
  if (low.length) log("LOW GAS:", low.map(([a, v]) => `${a} ${v}`).join(", "));
}

async function main() {
  log(`petri agents on ${CONTRACT}; model ${hasModel() ? MODEL : "none (rules choose)"}`);
  serve();
  await health();
  if (once) {
    for (const s of [...STRAINS, ...BENCH]) await act(s).catch((e) => log(s.name, "error", e.message));
    return;
  }
  let tick = 0;
  for (;;) {
    try {
      const st = await view("state");
      const due = Number(st.due_generation);
      await keep();
      for (const s of [...STRAINS, ...BENCH]) {
        const at = nextAt.get(s.account) ?? due + Math.floor(rng() * 6);
        if (due >= at) {
          await act(s).catch((e) => log(s.name, "error", e.message));
          const [lo, hi] = s.every;
          nextAt.set(s.account, due + lo + Math.floor(rng() * (hi - lo + 1)));
        } else if (!nextAt.has(s.account)) {
          nextAt.set(s.account, at);
        }
      }
      if (++tick % 60 === 0) await health();
    } catch (e) {
      log("loop error", e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }
}

main();
