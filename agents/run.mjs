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
  { account: "petri-violet.testnet", name: "Crystal Violet", color: 0x6b2fa0, temperament: "gardener", every: [10, 18],
    voice: "You are patient and orderly. You grow tidy gardens of still lifes and wall them off from raiders." },
  { account: "petri-safranin.testnet", name: "Safranin", color: 0xc8325a, temperament: "raider", every: [8, 14],
    voice: "You are bold and hungry. You send gliders at whoever has grown fattest, and you enjoy it." },
  { account: "petri-methylene.testnet", name: "Methylene Blue", color: 0x2364aa, temperament: "engineer", every: [12, 20],
    voice: "You are careful and technical. You build eaters to absorb attacks and guns when you can afford them." },
  { account: "petri-malachite.testnet", name: "Malachite Green", color: 0x1e8c6e, temperament: "wanderer", every: [10, 18],
    voice: "You are curious and restless. You settle fresh agar far from everyone else before it is crowded." },
  { account: "petri-congo.testnet", name: "Congo Red", color: 0xc8431f, temperament: "chaos", every: [14, 24], cap: 220,
    voice: "You are mischievous. You seed small chaos and watch what the dish does with it." },
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

async function ensureJoined(s, colonies) {
  const c = colonies.find((x) => x.account === s.account);
  if (c) return c;
  log(s.name, "joining");
  await callDish(s.account, "join", { name: s.name, color: s.color }, 100);
  return (await view("colony_of", { account_id: s.account })) ?? null;
}

async function act(s) {
  const world = await liveDish();
  const me = await ensureJoined(s, world.colonies);
  if (!me) return;
  if (me.last_plant_generation !== null && Number(me.last_plant_generation) >= world.due) return;
  const balance = Number(await view("ft_balance_of", { account_id: s.account }));
  const totalLive = world.engine.total_live();
  const myCells = world.engine.live_counts()[me.id] ?? 0;
  const cands = candidates({ ...world, totalLive }, { id: me.id, temperament: s.temperament, cap: s.cap }, balance, rng);
  if (cands.length === 0) {
    log(s.name, "no legal planting it can afford");
    return;
  }
  const counts = world.engine.live_counts();
  const rivals = world.colonies
    .filter((c) => c.id !== me.id && (counts[c.id] ?? 0) > 0)
    .map((c) => `${c.name} ${counts[c.id]} cells`)
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
  const pick = await choose(s, summary, cands);
  const chosen = pick ? cands[pick.index] : cands[0];
  const note = pick?.note || chosen.why.charAt(0).toUpperCase() + chosen.why.slice(1) + ".";
  try {
    const r = await callDish(s.account, "plant", { cells: chosen.cells, note }, 150);
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

async function keep() {
  const st = await view("state");
  const behind = Number(st.due_generation) - Number(st.generation);
  if (behind >= 20) {
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
  for (const a of [KEEPER, ...STRAINS.map((s) => s.account)]) {
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
    for (const s of STRAINS) await act(s).catch((e) => log(s.name, "error", e.message));
    return;
  }
  let tick = 0;
  for (;;) {
    try {
      const st = await view("state");
      const due = Number(st.due_generation);
      await keep();
      for (const s of STRAINS) {
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
