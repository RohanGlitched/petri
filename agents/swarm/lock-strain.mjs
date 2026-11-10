// Locks a spawned strain whose spawn stopped before its temporary full-access key was deleted: runs abandonSpawn(),
// which reads from the dish whether the strain joined, has the parent top it up for the gas, then deletes the
// temporary key (joined) or the account (not joined, its NEAR back to the parent). Run it on the machine that holds
// the temporary key (the runner's swarm key folder) with the runner's environment:
//
//   cd agents && node swarm/lock-strain.mjs <account>            e.g. gram-positive.petri-strains.testnet
//   cd agents && node swarm/lock-strain.mjs --all                every strain in the registry with a key still on disk
//
// The key folder is PETRI_SWARM_KEYS_DIR (default <PETRI_LOG_DIR>/swarm-keys); the parent's key is in PETRI_KEYS_DIR.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KeyPair } from "near-api-js";
import { loadRegistry, saveRegistry } from "./registry.mjs";
import { abandonSpawn, keysOf } from "./spawn.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.PETRI_LOG_DIR ?? path.join(here, "..", "log");
const reg = loadRegistry(LOG_DIR);
const arg = process.argv[2];
if (!arg) {
  console.error("usage: node swarm/lock-strain.mjs <account> | --all");
  process.exit(2);
}
const tempFile = (a) => path.join(reg.keysDir, `${a}.temp.json`);
const targets = arg === "--all" ? reg.strains.map((s) => s.account).filter((a) => fs.existsSync(tempFile(a))) : [arg];
let bad = 0;
for (const accountId of targets) {
  if (!fs.existsSync(tempFile(accountId))) {
    console.log(`${accountId}: no temporary key in ${reg.keysDir}; nothing this machine can sign`);
    bad++;
    continue;
  }
  let strain = reg.strains.find((s) => s.account === accountId);
  if (!strain) {
    strain = { account: accountId, status: "failed", txs: {} };
    reg.strains.push(strain);
  }
  const temp = KeyPair.fromString(JSON.parse(fs.readFileSync(tempFile(accountId), "utf8")).private_key);
  await abandonSpawn(reg, strain, temp, (...m) => console.log(...m));
  const keys = await keysOf(accountId).catch(() => null);
  const full = keys ? keys.filter((k) => k.permission === "FullAccess").length : 0;
  console.log(`${accountId}: ${keys === null ? "account deleted" : `${full} full-access key(s), ${keys.length} key(s) in all`}`);
  if (full) bad++;
}
saveRegistry(reg);
process.exit(bad ? 1 : 0);
