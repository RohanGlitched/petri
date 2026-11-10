#!/usr/bin/env node
// The README's "What is real, today" table, read from both chains now. Every figure comes from view calls pinned to one
// final block per network: the dish's state, every colony, the whole ledger, every slide, the stored board, and the
// access keys of the dish, the slide factory and every living slide's purse. Nothing is typed in by hand.
//
//   node scripts/facts-now.mjs            print the table (Markdown)
//   node scripts/facts-now.mjs --diff     compare it with README.md's table. Rows that grow with play (generation,
//                                         plantings, supply, tides, royalties, slides, pacts, joins, living cells)
//                                         are printed as "moved with play" and exit 0. It exits 1 only when what
//                                         must not move does: the contract, keys on the dish, the factory or a
//                                         purse, the deployed code (dish, factory, purses), or which side an account
//                                         is filed on (a side's count fell, or the team bench changed).
//   node scripts/facts-now.mjs --write    rewrite README.md's table in place
//   node scripts/facts-now.mjs --json     the raw figures
//
// The README table sits between <!-- facts-now:start --> and <!-- facts-now:end -->. Needs Node 20 or later.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const README = path.join(root, "README.md");
const START = "<!-- facts-now:start -->";
const END = "<!-- facts-now:end -->";

const NETS = {
  mainnet: {
    dish: "petri-dish.near",
    factory: "slides.petri-dish.near",
    parents: ["slides.petri-dish.near", "petri-dish.near"],
    rpcs: ["https://rpc.mainnet.fastnear.com", "https://near.drpc.org", "https://free.rpc.fastnear.com"],
    explorer: "https://nearblocks.io",
  },
  testnet: {
    dish: "petri-v6.testnet",
    factory: "slides.petri-v6.testnet",
    parents: ["slides.petri-v6.testnet", "petri-slides.testnet"],
    rpcs: ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org", "https://test.rpc.fastnear.com"],
    explorer: "https://testnet.nearblocks.io",
  },
};
const STRAINS = ["violet", "safranin", "methylene", "malachite", "congo"];
// The team bench is the site's own list (web/src/lib/strains.ts BENCH_ACCOUNTS), read from that file so the two never
// differ: the testnet bench, both implicit benches and the testnet rehearsal guests of mainnet free play.
const STRAINS_TS = path.join(root, "web", "src", "lib", "strains.ts");
function benchAccounts() {
  const src = fs.readFileSync(STRAINS_TS, "utf8");
  const m = src.match(/export const BENCH_ACCOUNTS\s*=\s*\[([\s\S]*?)\];/);
  const list = m ? [...m[1].replace(/\/\/.*$/gm, "").matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  if (!list.length) {
    console.error(`facts-now: no BENCH_ACCOUNTS list in ${path.relative(root, STRAINS_TS)}`);
    process.exit(2);
  }
  return list;
}
const BENCH = benchAccounts();

// The deployed code that must not change, by NEAR code hash (base58). The dish: README's "Fixed facts" (v6.5). The v2
// slide factory and the purses it makes, and the v1 purses (docs/LIVING-SLIDES.md).
const CODE = {
  dish: "CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD",
  factory: "5QTHyZ64eudxyGctrqdwbKiUvZK8oMnpWELzdyD2SG2N",
  purses: ["CDyvfMn9zQJyArwxrY3ASaASoEHH8JTp5S7uC8ShziCe", "HRSkpLzDjnevFrwEV8B9TadHyTiYr6NoXbUyFufxXF44"],
};

/** Mainnet free-play guests: accounts the dish's ledger shows were sponsored (Sponsor entries), as lib/sides.ts files them. */
const sponsored = new Set();
/** Who an account plays for (the same rule as web/src/lib/sides.ts). */
function side(a, house) {
  if (house || STRAINS.some((s) => a === `${s}.petri-dish.near` || a === `petri-${s}.testnet`) || a === "petri-keeper.testnet" || a === "keeper.petri-dish.near") return "house";
  if (BENCH.includes(a)) return "bench";
  if (/^g-[0-9a-f]{10}\.petri-guests\.testnet$/.test(a) || sponsored.has(a)) return "guest";
  if (/(^|\.)petri-[a-z0-9-]+\.testnet$/.test(a) || a === "petri-dish.near" || a.endsWith(".petri-dish.near")) return "team";
  return "outside";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(net, method, params) {
  let last;
  for (let round = 0; round < 4; round++)
    for (const url of NETS[net].rpcs) {
      try {
        const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "facts", method, params }), signal: AbortSignal.timeout(20_000) });
        if (res.status === 429 || res.status >= 500) throw new Error(`${new URL(url).host} ${res.status}`);
        const b = await res.json();
        if (b.error) {
          const e = new Error(JSON.stringify(b.error).slice(0, 200));
          if (/UNKNOWN_ACCOUNT|MethodNotFound|CodeDoesNotExist|FunctionCallError/.test(e.message)) e.final = true;
          throw e;
        }
        return b.result;
      } catch (e) {
        if (e.final) throw e;
        last = e;
        await sleep(300 * (round + 1));
      }
    }
  throw last;
}

async function read(net) {
  const n = NETS[net];
  const block = (await rpc(net, "block", { finality: "final" })).header.height;
  const view = async (method, args = {}, account = n.dish) => {
    const r = await rpc(net, "query", { request_type: "call_function", block_id: block, account_id: account, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
    return JSON.parse(Buffer.from(r.result).toString("utf8"));
  };
  const codeOf = async (account) => {
    try {
      return (await rpc(net, "query", { request_type: "view_account", block_id: block, account_id: account })).code_hash;
    } catch {
      return null;
    }
  };
  const keys = async (account) => {
    try {
      const r = await rpc(net, "query", { request_type: "view_access_key_list", block_id: block, account_id: account });
      return { all: r.keys.length, full: r.keys.filter((k) => k.access_key.permission === "FullAccess").length };
    } catch {
      return null;
    }
  };
  const paged = async (method, total, size) => {
    const out = [];
    for (let from = 0; from < total; from += size) out.push(...(await view(method, { from, limit: size })));
    return out.slice(0, total);
  };
  const [rules, state] = await Promise.all([view("rules"), view("state")]);
  const [colonies, ledger, slides, board, dishKeys, factoryKeys, dishCode, factoryCode] = await Promise.all([
    paged("colonies", state.colonies, 500),
    paged("ledger", Number(state.ledger), 1000),
    paged("slides", Number(state.slides), 500),
    view("board"),
    keys(n.dish),
    keys(n.factory),
    codeOf(n.dish),
    codeOf(n.factory),
  ]);

  // Living cells per colony on the stored board (the contract's compact form: liveness rows, then each cell's owner).
  const bytes = Buffer.from(board, "base64");
  const words = Math.ceil(rules.width / 64);
  const live = new Map();
  let o = words * rules.height * 8;
  for (let i = 0; i < words * rules.height * 8; i++) {
    let v = bytes[i];
    while (v) {
      v &= v - 1;
      const owner = bytes[o] | (bytes[o + 1] << 8);
      live.set(owner, (live.get(owner) ?? 0) + 1);
      o += 2;
    }
  }

  if (net === "mainnet") for (const e of ledger) if (e.Sponsor) sponsored.add(e.Sponsor.account);
  const bySide = { house: 0, bench: 0, team: 0, guest: 0, outside: 0 };
  const planted = { house: 0, bench: 0, team: 0, guest: 0, outside: 0 };
  for (const c of colonies) {
    const s = side(c.account, c.house);
    bySide[s]++;
    if (Number(c.cells_planted) > 0) planted[s]++;
  }
  const spawned = colonies.filter((c) => c.account.endsWith(".petri-strains.testnet"));
  const plants = ledger.filter((e) => e.Plant);
  // NEAR Intents: wNEAR deliveries held as pending NEAR, and colonies an Intents payment started (proxy).
  const pending = ledger.filter((e) => e.Pending).map((e) => e.Pending);
  const intents = {
    pending: pending.length,
    team: pending.filter((p) => side(p.account) !== "outside" && side(p.account) !== "guest").length,
    unpend: ledger.filter((e) => e.Unpend).length,
    proxy: colonies.filter((c) => c.proxy).length,
  };
  const licensed = plants.filter((e) => e.Plant.licence).length;

  // Living slides: a slide whose owner is its own purse, slide-<id>.<parent>.
  const living = [];
  for (const sl of slides) {
    const id = String(sl.token_id ?? sl.id);
    const owner = sl.owner_id ?? sl.owner;
    if (!n.parents.some((p) => owner === `slide-${id}.${p}`)) continue;
    const c = colonies.find((x) => x.account === owner) ?? null;
    living.push({ id, purse: owner, keys: await keys(owner), code: await codeOf(owner), colony: c?.id ?? null, attached: c ? !!c.attached : null, live: c ? live.get(c.id) ?? 0 : null });
  }

  const Y = 10n ** 24n;
  const nearOf = (y) => Number((BigInt(y) * 10000n) / Y) / 10000;
  return {
    net,
    block,
    generation: Number(state.generation),
    due: Math.floor((Number(state.now_ms) - Number(state.epoch_ms)) / Number(rules.generation_ms)),
    dishKeys,
    factoryKeys,
    code: { dish: dishCode, factory: factoryCode },
    colonies: colonies.length,
    bySide,
    planted,
    spawned: { all: spawned.length, alive: spawned.filter((c) => (live.get(c.id) ?? 0) > 0).length },
    plantings: plants.length,
    licensed,
    supply: Number(state.total_supply) / 1e6,
    burned: Number(state.burned) / 1e6,
    tides: Number(state.tides),
    nearTides: nearOf(state.near_tides),
    nearAsCredit: nearOf(state.near_as_credit),
    creditWon: nearOf(state.credit_won),
    slides: slides.length,
    living,
    pacts: Number(state.pacts),
    intents,
    royalties: Number(state.royalties) / 1e6,
  };
}

const int = (n) => n.toLocaleString("en-US");
const dec = (n, dp = 2) => n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const plural = (n, one, many = one + "s") => `${int(n)} ${n === 1 ? one : many}`;
const keysText = (k) => (k === null ? "keys unknown" : plural(k.all, "key"));

function colonyLine(f) {
  const parts = [`${f.bySide.house} house`, `${f.bySide.bench} team bench`];
  if (f.bySide.team) {
    const purses = f.living.filter((l) => l.colony !== null).length;
    const what = [purses ? plural(purses, "living slide") : null, f.spawned.all ? `${int(f.spawned.all)} spawned strains` : null, f.bySide.team - purses - f.spawned.all > 0 ? `${int(f.bySide.team - purses - f.spawned.all)} test agents` : null].filter(Boolean);
    parts.push(`${int(f.bySide.team)} other team ${f.bySide.team === 1 ? "account" : "accounts"} (${what.join(", ")})`);
  }
  if (f.net === "testnet") parts.push(`${f.bySide.guest} guest (anyone's browser, the team's tests included)`);
  else if (f.bySide.guest) parts.push(`${f.bySide.guest} free-play guest (anyone's browser)`);
  parts.push(`${f.bySide.outside} outside`);
  return `${int(f.colonies)}: ${parts.join(", ")}`;
}
function tideLine(f) {
  if (!f.tides) return "0 (a tide pays only colonies outside the house; none had earned at one yet)";
  const asNear = f.nearTides > 0 ? `${dec(f.nearTides, 4)} NEAR paid as NEAR to colonies that attached NEAR` : "no NEAR paid as NEAR yet";
  const asCredit = f.nearAsCredit > 0 ? `${dec(f.nearAsCredit, 4)} NEAR of vault shares paid as credit to colonies that never attached NEAR` : "none paid as credit";
  return `${plural(f.tides, "tide")}: ${asNear}; ${asCredit}`;
}
function livingLine(f) {
  if (!f.living.length) return "none";
  const one = (l) => {
    const keys = l.keys === null ? "keys unknown" : `${l.keys.all} keys`;
    const play = l.colony === null ? "not joined" : `colony ${l.colony}, ${l.attached ? "attached" : "unattached"}, ${l.live === 0 ? "no living cells" : plural(l.live, "living cell")} on the stored board`;
    return `\`${l.purse}\` (${keys}; ${play})`;
  };
  return `${f.living.length}: ${f.living.map(one).join("; ")}`;
}

function intentsLine(f) {
  const i = f.intents;
  const parts = [i.proxy ? `${plural(i.proxy, "colony", "colonies")} started by an Intents payment` : "no colony started through Intents yet"];
  if (i.pending) parts.push(`${plural(i.pending, "delivery", "deliveries")} held as pending NEAR (${i.team === i.pending ? (i.pending === 1 ? "the team's own test" : "all the team's own tests") : `${int(i.team)} the team's`}), ${int(i.unpend)} settled or paid back`);
  return parts.join("; ");
}

function table(m, t) {
  const row = (k, a, b) => `| ${k} | ${a} | ${b} |`;
  return [
    `Read by \`node scripts/facts-now.mjs\` at mainnet block ${int(m.block)} and testnet block ${int(t.block)}; run it to diff this table against the chain (\`--diff\`). The judge desk reads the same figures again when you open it.`,
    "",
    "| | Mainnet, real NEAR | Testnet, free play |",
    "|---|---|---|",
    row("Contract", `[\`petri-dish.near\`](https://nearblocks.io/address/petri-dish.near)`, `[\`petri-v6.testnet\`](https://testnet.nearblocks.io/address/petri-v6.testnet)`),
    row("Full-access keys on the dish", `${m.dishKeys?.full ?? "unknown"}${m.dishKeys?.full ? ", held by the team until the final verify on 14 November, then deleted" : ""}`, `${t.dishKeys?.full ?? "unknown"}, kept for fixes`),
    row("Slide factory", `\`slides.petri-dish.near\`, ${keysText(m.factoryKeys)}`, `\`slides.petri-v6.testnet\`, ${keysText(t.factoryKeys)}`),
    row("Generation stored on chain (15 s each)", `${int(m.generation)} (the clock is at ${int(m.due)}; the next move catches up)`, `${int(t.generation)} (clock ${int(t.due)})`),
    row("Colonies", colonyLine(m), colonyLine(t)),
    row("Outside players", m.bySide.outside ? `${plural(m.bySide.outside, "outside colony", "outside colonies")}, ${int(m.planted.outside)} planted` : "none yet", t.bySide.outside ? `${plural(t.bySide.outside, "outside wallet colony", "outside wallet colonies")}, ${int(t.planted.outside)} planted` : "none yet"),
    row("Plantings / under a slide's licence", `${int(m.plantings)} / ${int(m.licensed)}`, `${int(t.plantings)} / ${int(t.licensed)}`),
    row("PETRI supply (started at 1,000,000)", `${dec(m.supply)} (${dec(m.burned)} burned)`, `${dec(t.supply)} (${dec(t.burned)} burned)`),
    row("Hourly tides", tideLine(m), tideLine(t)),
    row("Royalties paid to slide holders", `${dec(m.royalties)} PETRI`, `${dec(t.royalties)} PETRI`),
    row("Specimen slides (NFTs)", int(m.slides), int(t.slides)),
    row("Living slides (keyless accounts)", livingLine(m), livingLine(t)),
    row("Pacts the contract enforces", int(m.pacts), int(t.pacts)),
    row("Spawned strains", "testnet only", `${int(t.spawned.all)} spawned, ${int(t.spawned.alive)} with living cells`),
    row("Joins through NEAR Intents", intentsLine(m), "mainnet only"),
  ].join("\n");
}

const [m, t] = await Promise.all([read("mainnet"), read("testnet")]).catch((e) => {
  console.error(`facts-now: could not read the chains: ${e.message ?? e}`);
  process.exit(2);
});
if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ mainnet: m, testnet: t }, null, 1));
  process.exit(0);
}
const out = table(m, t);
const mode = process.argv.includes("--write") ? "write" : process.argv.includes("--diff") ? "diff" : "print";
if (mode === "print") {
  console.log(out);
  process.exit(0);
}
const text = fs.readFileSync(README, "utf8");
const a = text.indexOf(START);
const b = text.indexOf(END);
if (a < 0 || b < a) {
  console.error(`facts-now: README.md has no ${START} … ${END} block`);
  process.exit(2);
}
const before = text.slice(a + START.length, b).trim();
if (mode === "write") {
  fs.writeFileSync(README, text.slice(0, a + START.length) + "\n" + out + "\n" + text.slice(b));
  console.log(`facts-now: README.md table rewritten (mainnet block ${int(m.block)}, testnet block ${int(t.block)})`);
  process.exit(0);
}
// --diff: rows by their first cell; the provenance line always differs (block heights), so it is left out.
const rows = (txt) => new Map(txt.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---")).map((l) => [l.split(" | ")[0], l]));
const cellsOf = (line) => line.split(" | ").slice(1).map((c) => c.replace(/ \|$/, ""));
// Rows whose figures grow as people play: a change there is the dish being played, not a broken claim.
const PLAY = new Set(["| Generation stored on chain (15 s each)", "| Plantings / under a slide's licence", "| PETRI supply (started at 1,000,000)", "| Hourly tides", "| Royalties paid to slide holders", "| Specimen slides (NFTs)", "| Pacts the contract enforces", "| Spawned strains", "| Joins through NEAR Intents"]);
// Rows that must not move at all.
const FIXED = new Set(["| Contract", "| Full-access keys on the dish", "| Slide factory"]);
/** Per-side counts in a Colonies cell ("55: 5 house, 4 team bench, 13 other team accounts (...), 30 guest (...), 3 outside"). */
function sideCounts(cell) {
  const n = (re) => Number(((cell.match(re) ?? [])[1] ?? "0").replace(/,/g, ""));
  return { house: n(/(\d[\d,]*) house/), bench: n(/(\d[\d,]*) team bench/), team: n(/(\d[\d,]*) other team/), guest: n(/(\d[\d,]*) (?:free-play )?guest/), outside: n(/(\d[\d,]*) outside(?! wallet)/) };
}
/** Why a changed row is not just play, or null when it moved with play. */
function structural(key, was, now) {
  if (FIXED.has(key)) return "this row must not change";
  if (PLAY.has(key)) return null;
  const [a, b] = [cellsOf(was), cellsOf(now)];
  if (key === "| Colonies") {
    for (let i = 0; i < 2; i++) {
      const [x, y] = [sideCounts(a[i] ?? ""), sideCounts(b[i] ?? "")];
      if (x.bench !== y.bench) return `the team bench changed (${x.bench} → ${y.bench}): the list or an account's side moved`;
      const fell = Object.keys(x).filter((k) => y[k] < x[k]);
      if (fell.length) return `${fell.join(", ")} fell (${fell.map((k) => `${x[k]} → ${y[k]}`).join(", ")}): an account moved to another side`;
    }
    return null;
  }
  if (key === "| Outside players") {
    const out = (c) => Number((c.match(/^(\d[\d,]*) outside/) ?? [])[1]?.replace(/,/g, "") ?? 0);
    for (let i = 0; i < 2; i++) if (out(b[i] ?? "") < out(a[i] ?? "")) return "fewer outside colonies than before: an account moved to another side";
    return null;
  }
  if (key === "| Living slides (keyless accounts)") {
    // Keys, purses and colonies must stay; whether a purse has living cells (and has attached NEAR) moves with play.
    const shape = (c) => c.replace(/(\d[\d,]*) living cells?|no living cells/g, "N living cells").replace(/\b(un)?attached\b/g, "attached?");
    for (let i = 0; i < 2; i++) if (shape(a[i] ?? "") !== shape(b[i] ?? "")) return "a purse, its keys or its colony changed";
    return null;
  }
  return "a row this script does not know";
}
const was = rows(before);
const now = rows(out);
let moved = 0;
let broken = 0;
for (const [k, l] of now) {
  if (was.get(k) === l) continue;
  const why = was.has(k) ? structural(k, was.get(k), l) : "a new row";
  if (why) broken++;
  else moved++;
  console.log(`${why ? `DIFFERS (${why})` : "moved with play"}:\n- ${was.get(k) ?? "(missing)"}\n+ ${l}`);
}
for (const k of was.keys()) if (!now.has(k)) (broken++, console.log(`DIFFERS (a row is gone):\n- ${was.get(k)}\n+ (gone)`));
// The deployed code, which the table does not print: the dish, the factory and every living slide's purse.
for (const f of [m, t]) {
  const bad = [];
  if (f.code.dish !== CODE.dish) bad.push(`dish code ${f.code.dish ?? "unknown"}, not ${CODE.dish}`);
  if (f.code.factory !== CODE.factory) bad.push(`factory code ${f.code.factory ?? "unknown"}, not ${CODE.factory}`);
  for (const l of f.living) if (!CODE.purses.includes(l.code)) bad.push(`${l.purse} code ${l.code ?? "unknown"}, not a known purse build`);
  if (bad.length) (broken++, console.log(`DIFFERS (${f.net} code): ${bad.join("; ")}`));
}
if (!text.includes(CODE.dish)) (broken++, console.log(`DIFFERS: README.md no longer names the dish's code hash ${CODE.dish}`));
console.log(
  broken
    ? `facts-now: ${broken} ${broken === 1 ? "thing differs" : "things differ"} from the chain beyond play (keys, code, or who is filed where)${moved ? `; ${moved} more ${moved === 1 ? "row" : "rows"} moved with play` : ""}`
    : moved
      ? `facts-now: README.md matches the chain; ${moved} ${moved === 1 ? "row has" : "rows have"} moved with play since it was written (run --write to refresh them)`
      : "facts-now: README.md matches the chain",
);
process.exit(broken ? 1 : 0);
