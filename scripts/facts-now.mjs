#!/usr/bin/env node
// The README's "What is real, today" table, read from both chains now. Every figure comes from view calls pinned to one
// final block per network: the dish's state, every colony, the whole ledger, every slide, the stored board, and the
// access keys of the dish, the slide factory and every living slide's purse. Nothing is typed in by hand.
//
//   node scripts/facts-now.mjs            print the table (Markdown)
//   node scripts/facts-now.mjs --diff     compare it with README.md's table; exit 1 if a row changed
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
const BENCH = ["petri-bench-a.testnet", "petri-bench-b.testnet", "petri-bench-c.testnet", "9e0f14b0b58c9760dd95af218cdd98a4417cd37d316e01cbff178d41ac5b7c5e", "58135f2e727a40755df38f1d231aca159ea4ab138260b8d0d9419da63f999932"];

/** Who an account plays for (the same rule as web/src/lib/sides.ts). */
function side(a, house) {
  if (house || STRAINS.some((s) => a === `${s}.petri-dish.near` || a === `petri-${s}.testnet`) || a === "petri-keeper.testnet" || a === "keeper.petri-dish.near") return "house";
  if (BENCH.includes(a)) return "bench";
  if (/^g-[0-9a-f]{10}\.petri-guests\.testnet$/.test(a)) return "guest";
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
  const [colonies, ledger, slides, board, dishKeys, factoryKeys] = await Promise.all([
    paged("colonies", state.colonies, 500),
    paged("ledger", Number(state.ledger), 1000),
    paged("slides", Number(state.slides), 500),
    view("board"),
    keys(n.dish),
    keys(n.factory),
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
    living.push({ id, purse: owner, keys: await keys(owner), colony: c?.id ?? null, attached: c ? !!c.attached : null, live: c ? live.get(c.id) ?? 0 : null });
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
const rows = (s) => new Map(s.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---")).map((l) => [l.split(" | ")[0], l]));
const was = rows(before);
const now = rows(out);
let changed = 0;
for (const [k, l] of now) {
  if (was.get(k) === l) continue;
  changed++;
  console.log(`- ${was.get(k) ?? "(missing)"}\n+ ${l}`);
}
for (const k of was.keys()) if (!now.has(k)) (changed++, console.log(`- ${was.get(k)}\n+ (gone)`));
console.log(changed ? `facts-now: ${changed} ${changed === 1 ? "row differs" : "rows differ"} from the chain now` : "facts-now: README.md matches the chain");
process.exit(changed ? 1 : 0);
