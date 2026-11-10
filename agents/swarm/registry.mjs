// The swarm's registry: the strains visitors spawned (their temperament, account, brain budget and what each decision
// cost), the open council's rounds, and the break-the-pact attempts. One JSON file beside the agents' log on the VM
// (PETRI_SWARM_FILE), and the spawned strains' play keys in their own folder (PETRI_SWARM_KEYS_DIR), never in the file.

import fs from "node:fs";
import path from "node:path";
import { useKeysDir } from "../lib.mjs";

export function swarmPaths(logDir) {
  const file = process.env.PETRI_SWARM_FILE ?? path.join(logDir, "spawned.json");
  const keys = process.env.PETRI_SWARM_KEYS_DIR ?? path.join(path.dirname(file), "swarm-keys");
  return { file, keys };
}

const EMPTY = () => ({ strains: [], refused: [], spawns: [], council: { rounds: [], deals: [] }, breaks: { attempts: [], chats: 0 } });

export function loadRegistry(logDir) {
  const { file, keys } = swarmPaths(logDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.mkdirSync(keys, { recursive: true });
  let reg = EMPTY();
  try {
    reg = { ...EMPTY(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    /* a fresh registry */
  }
  reg.file = file;
  reg.keysDir = keys;
  for (const s of reg.strains) useKeysDir(s.account, keys);
  for (const a of reg.team ?? []) useKeysDir(a, keys);
  return reg;
}

export function saveRegistry(reg) {
  const { file, keysDir, ...rest } = reg;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rest, null, 1));
  fs.renameSync(tmp, file);
}

/** Saves a key pair for `accountId` in the swarm's key folder, in the near-cli legacy keychain format. */
export function saveKey(reg, accountId, keyPair) {
  const file = path.join(reg.keysDir, `${accountId}.json`);
  fs.writeFileSync(file, JSON.stringify({ account_id: accountId, public_key: keyPair.getPublicKey().toString(), private_key: keyPair.toString() }), { mode: 0o600 });
  useKeysDir(accountId, reg.keysDir);
}

/** What the public log window shows of the swarm: no owner tokens, no keys. */
export function publicSwarm(reg, extra = {}) {
  return {
    strains: reg.strains.map(({ owner_hash, ...s }) => ({ ...s, decisions: (s.decisions ?? []).slice(-12) })),
    refused: reg.refused.slice(-20),
    council: { rounds: reg.council.rounds.slice(-8).map(publicRound), deals: reg.council.deals.slice(-40) },
    breaks: { refused: reg.breaks.attempts.filter((a) => a.refused).length, attempts: reg.breaks.attempts.slice(-25), chats: reg.breaks.chats ?? 0, ...(reg.breaks.public ?? {}) },
    ...extra,
  };
}

/** A round as anyone may see it: while it is open, bids and asks only as their hashes. */
export function publicRound(r) {
  const open = r.status === "open";
  return {
    n: r.n,
    status: r.status,
    opened_generation: r.opened_generation,
    closes_generation: r.closes_generation,
    opened_at: r.opened_at,
    pact_gens: r.pact_gens,
    asks: r.asks.map((a) => (open ? { house: a.house, colony: a.colony, commit: a.commit } : a)),
    bids: r.bids.map((b) => (open ? { id: b.id, account: b.account, colony: b.colony, side: b.side, counterparty: b.counterparty, commit: b.commit, at: b.at } : b)),
    cleared: r.cleared ?? [],
  };
}
