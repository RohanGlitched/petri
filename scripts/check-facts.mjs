#!/usr/bin/env node
// Fails when a stale figure is written out by hand: an older contract version stated as the current one, an old test
// count, an old /verify count or the old hosting note. The current figures live in web/src/lib/facts.ts; pages read
// them from there, so a release bumps one file. Run from the repository root:
//
//   node scripts/check-facts.mjs
//
// Exit 0 when nothing stale is found, 1 otherwise (each hit is printed as file:line).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const facts = readFileSync(join(root, "web/src/lib/facts.ts"), "utf8");
const pick = (re, what) => {
  const m = facts.match(re);
  if (!m) throw new Error(`web/src/lib/facts.ts: cannot read ${what}`);
  return m[1];
};
const version = pick(/CONTRACT_VERSION = "v(\d+\.\d+)"/, "CONTRACT_VERSION");
const tests = { contract: +pick(/contract: (\d+)/, "TESTS.contract"), core: +pick(/core: (\d+)/, "TESTS.core") };
const checks = +pick(/checks: (\d+)/, "VERIFY.checks");
const cliChecks = +pick(/VERIFY_CLI_CHECKS = (\d+)/, "VERIFY_CLI_CHECKS");
const cliRows = cliChecks + 1;
const purse = { purse: +pick(/purse: (\d+), factory/, "PURSE.tests.purse"), factory: +pick(/factory: (\d+), json/, "PURSE.tests.factory"), json: +pick(/json: (\d+)/, "PURSE.tests.json"), bytes: pick(/bytes: ([\d_]+)/, "PURSE.bytes").replaceAll("_", "") };
purse.total = purse.purse + purse.factory + purse.json;
const purseBytes = Number(purse.bytes).toLocaleString("en-US");
const [major, minor] = version.split(".").map(Number);

/** Figures that are wrong wherever they appear. */
const STALE = [
  [/\b175 tests\b/i, "old test total"],
  [/\b139 (contract|for the contract|passed)\b/i, "old contract test count"],
  [/\b36 (core|for the engine|engine)\b/i, "old core test count"],
  [/sslip\.io/i, "old temporary host"],
  [/changing hosts/i, "old hosting note"],
  [/without the code hash|code hash is not among them/i, "/verify checks the code hash"],
  [/\bContract v\d+\.\d+/, "the version belongs in lib/facts.ts"],
];

/** An older v<major>.<n> stated as what runs now. Mentions that only date a change ("since v6.2", "no v6.3 dish") are
 * fine; a line that also names the current version (or reads it from lib/facts.ts) is about history by construction. */
const OLDER = new RegExp(`\\bv${major}\\.([0-${Math.max(0, minor - 1)}])\\b`);
const NOW = /\b(now runs|runs now|run now|dishes run|build both|same build|the build,|at the time of writing|minutes after|after the v\d+\.\d+ relaunch|from the first contract to)\b|v\d+\.\d+ build\b/i;
const CURRENT = new RegExp(`\\bv${major}\\.${minor}\\b|CONTRACT_VERSION`);
const EVENT = /"version":\s*"(\d+)\.(\d+)\.\d+"|<C>petri<\/C> (\d+)\.(\d+)\.\d+/;

const FILES = ["README.md", "RULES.md", "docs/LIVING-SLIDES.md", "scripts/verify.mjs", ".github/workflows/live.yml"];
const SKIP = [/web\/src\/engine\/pkg\//, /web\/src\/app\/docs\/changelog\//];
function walk(dir) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = `${dir}/${name}`;
    if (SKIP.some((re) => re.test(rel + "/"))) continue;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/\.(tsx?|mjs|css|md)$/.test(name) && !SKIP.some((re) => re.test(rel))) FILES.push(rel);
  }
}
walk("web/src");

const hits = [];
for (const f of FILES) {
  if (f === "web/src/lib/facts.ts") continue;
  readFileSync(join(root, f), "utf8")
    .split("\n")
    .forEach((line, i) => {
      const at = `${relative(root, join(root, f)).replaceAll("\\", "/")}:${i + 1}`;
      for (const [re, why] of STALE) if (re.test(line)) hits.push(`${at}  ${why}: ${line.trim().slice(0, 140)}`);
      // A count of checks written out must be one of today's: /verify's or the terminal script's.
      for (const m of line.matchAll(/\b(\d{2}) checks\b/g))
        if (+m[1] !== checks && +m[1] !== cliChecks) hits.push(`${at}  /verify shows ${checks} checks, verify.mjs ${cliChecks}: ${line.trim().slice(0, 140)}`);
      // Row and test counts written out by hand: /verify's checks, verify.mjs's rows, the engine's and contract's tests.
      for (const m of line.matchAll(/\b(\d{2}) (?:rows|checks) on the page\b|\bshows (\d{2}) (?:rows|checks)\b|\b(\d{2}) on the page\b/g)) {
        const n = +(m[1] ?? m[2] ?? m[3]);
        if (n !== checks) hits.push(`${at}  /verify shows ${checks} checks: ${line.trim().slice(0, 140)}`);
      }
      for (const m of line.matchAll(/\b(\d{2}) rows (?:on the command line|<C>scripts\/verify\.mjs<\/C> prints|verify\.mjs prints)|\bThe (\d{2}) rows\b/g)) {
        const n = +(m[1] ?? m[2]);
        if (n !== cliRows) hits.push(`${at}  verify.mjs prints ${cliRows} rows (${cliChecks} checks and a note): ${line.trim().slice(0, 140)}`);
      }
      for (const m of line.matchAll(/\b(\d{2}) tests, including property tests|\b(\d{2}) (?:engine|core) tests\b/g)) {
        const n = +(m[1] ?? m[2]);
        if (n !== tests.core) hits.push(`${at}  petri-core has ${tests.core} tests: ${line.trim().slice(0, 140)}`);
      }
      for (const m of line.matchAll(/\b(\d{2,3}) contract tests\b/g))
        if (+m[1] !== tests.contract) hits.push(`${at}  the contract has ${tests.contract} tests: ${line.trim().slice(0, 140)}`);
      // The purse's test counts ("18 purse + 6 factory + 2 JSON tests", "16 purse and 5 factory tests", "23 tests" in purse/).
      for (const m of line.matchAll(/\b(\d{1,2}) purse (?:\+|and) (\d{1,2}) factory\b/g))
        if (+m[1] !== purse.purse || +m[2] !== purse.factory) hits.push(`${at}  purse/ has ${purse.purse} purse + ${purse.factory} factory + ${purse.json} JSON tests: ${line.trim().slice(0, 140)}`);
      for (const m of line.matchAll(/\bthe purse has (\d{1,2}) tests and the factory (\d{1,2})\b/g))
        if (+m[1] !== purse.purse || +m[2] !== purse.factory) hits.push(`${at}  purse/ has ${purse.purse} purse + ${purse.factory} factory tests: ${line.trim().slice(0, 140)}`);
      if (/\[`purse\/`\]/.test(line)) for (const m of line.matchAll(/\b(\d{1,2}) tests\b/g)) if (+m[1] !== purse.total) hits.push(`${at}  purse/ has ${purse.total} tests: ${line.trim().slice(0, 140)}`);
      // The v1 purse's size is history (slide 14, testnet slides 1 and 2); stated as the purse contract's size, it is stale.
      if (/29,404 bytes/.test(line) && !/\bv1\b|slide[- ]?14|slide-1\b|slide-2\b|first purse|Both purses/i.test(line)) hits.push(`${at}  the purse is ${purseBytes} bytes (29,404 was v1): ${line.trim().slice(0, 140)}`);
      // A live count of NEAR AI moves goes stale the next hour; link /judges, which counts them live.
      if (/\b\d+ of \d+ \(of (?:\d+ moves|the latest)/.test(line)) hits.push(`${at}  a hard-coded live count (link /judges instead): ${line.trim().slice(0, 140)}`);
      // The deprecated NEAR Foundation RPC is not a provider any more.
      if (/https:\/\/rpc\.(?:mainnet|testnet)\.near\.org/.test(line)) hits.push(`${at}  rpc.*.near.org is deprecated: ${line.trim().slice(0, 140)}`);
      if (OLDER.test(line) && NOW.test(line) && !CURRENT.test(line)) hits.push(`${at}  an older version stated as current: ${line.trim().slice(0, 140)}`);
      const ev = line.match(EVENT);
      if (ev) {
        const [a, b] = ev[1] ? [ev[1], ev[2]] : [ev[3], ev[4]];
        if (+a === major && +b < minor) hits.push(`${at}  old event version ${a}.${b}: ${line.trim().slice(0, 140)}`);
      }
    });
}

if (hits.length) {
  console.error(`check-facts: ${hits.length} stale ${hits.length === 1 ? "figure" : "figures"} (current: contract v${version}, ${tests.contract} + ${tests.core} tests, ${checks} checks on /verify)`);
  for (const h of hits) console.error("  " + h);
  process.exit(1);
}
console.log(`check-facts: nothing stale in ${FILES.length} files (contract v${version}, ${tests.contract} + ${tests.core} tests, ${checks} checks on /verify, purse ${purse.purse} + ${purse.factory} + ${purse.json} tests and ${purseBytes} bytes)`);
