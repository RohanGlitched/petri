// Spawning a strain: a visitor's temperament, once the guard approves it, becomes a real colony on the dish with its
// own account under one parent (<slug>.petri-strains.testnet), so every move on chain traces back to it.
//
//   1. The parent creates the account with two keys: a temporary full-access key, and the runner's play key, a
//      function-call key that can call only the dish's play methods (it can attach no NEAR and move none).
//   2. With the temporary key the strain joins the dish, attaching its own NEAR (so it is a full player: it can pay
//      for pacts and win NEAR at the tides), and prepays its brain: a transfer of BRAIN_NEAR to the account that pays
//      the team's model bill (PETRI_BRAIN_ACCOUNT). Each decision then draws a flat fee from that budget, logged with
//      the model's chat id; at zero the strain stops thinking and planting until it is topped up.
//   3. The parent sponsors dish credit for its planting fees, and the temporary key is deleted. From then on the
//      account has one key, the runner's, and the chain shows it.
// The NEAR the parent sends is sized from the chain's gas price (strainNearFor). Before each step the account must hold
// what that step can be charged (NEAR reserves prepaid gas at ten times the gas price until the refund lands, which can
// be after the previous step is final), so the runner waits for refunds and the parent tops up a small shortfall.
// A spawn that still fails is not left with a full-access key: before the join the account is deleted and its NEAR
// goes back to the parent; after it the temporary key is deleted (the colony stays, locked and idle).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";
import { account, rpc, view, CONTRACT, NETWORK, RPCS } from "../lib.mjs";
import { saveKey, saveRegistry } from "./registry.mjs";
import { review, TEMPERAMENTS } from "./guard.mjs";

const YOCTO = 10n ** 24n;
const near = (s) => {
  const [a, b = ""] = String(s).split(".");
  return BigInt(a) * YOCTO + BigInt((b + "0".repeat(24)).slice(0, 24));
};
export const PARENT = process.env.PETRI_STRAINS_PARENT ?? (NETWORK === "mainnet" ? "strains.petri-dish.near" : "petri-strains.testnet");
export const BRAIN_ACCOUNT = process.env.PETRI_BRAIN_ACCOUNT ?? "petri-lab.testnet";
// Unset, the NEAR a new account gets is estimated from the gas price (strainNearFor).
const STRAIN_NEAR = process.env.PETRI_SWARM_STRAIN_NEAR ? near(process.env.PETRI_SWARM_STRAIN_NEAR) : null;
const JOIN_TGAS = 30n;
const TRANSFER_TGAS = 1n;
// NEAR charges prepaid gas at up to ten times the current price until the unused part is refunded.
const PESSIMISTIC = 10n;
const BYTE_COST = 10n ** 19n;
// An account with a full-access key and the play key (seven method names) uses about 370 bytes; 420 leaves room.
const ACCOUNT_BYTES = 420n;
const MARGIN = near("0.004");
/** Gas each of a spawned strain's calls prepays (the contract keeps 40 TGas of any call for itself). */
export const SWARM_TGAS = Number(process.env.PETRI_SWARM_TGAS ?? "40");
// What one planting really burns, in TGas (a planting with its catch-up measured about 8 on testnet).
const PLANT_BURN_TGAS = BigInt(process.env.PETRI_SWARM_PLANT_BURN_TGAS ?? "10");
const MAX_TOP_UP = near(process.env.PETRI_SWARM_MAX_TOPUP ?? "0.03");
const JOIN_NEAR = near(process.env.PETRI_SWARM_JOIN_NEAR ?? "0.03");
export const BRAIN_NEAR = near(process.env.PETRI_SWARM_BRAIN_NEAR ?? "0.01");
const CREDIT_NEAR = near(process.env.PETRI_SWARM_CREDIT_NEAR ?? "0.04");
/** What one decision costs a strain's brain budget. */
export const DECISION_FEE = near(process.env.PETRI_SWARM_DECISION_FEE ?? "0.0002");
const PER_DAY = Number(process.env.PETRI_SWARM_PER_DAY ?? "12");
const MAX_STRAINS = Number(process.env.PETRI_SWARM_MAX ?? "40");
const TOPUPS = Number(process.env.PETRI_SWARM_TOPUPS ?? "2");
/** The play methods the runner's key may call, and nothing else. `buy` spends dish credit only (a key like this
 * cannot attach NEAR). */
export const PLAY_METHODS = ["plant", "buy", "claim", "advance", "pact_offer", "pact_accept", "pact_cancel"];

export const STAIN_COLORS = [0x6b2fa0, 0xc8325a, 0x2364aa, 0x1e8c6e, 0xb0287e, 0xc8431f, 0x3a4fa3, 0x7a4a22, 0x1f7f9e, 0xe0567f, 0xd9b42a, 0x4c9a3a];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const yoctoText = (y) => (Number(y) / 1e24).toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

export function slugOf(name) {
  const s = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20).replace(/-+$/, "");
  return s || "strain";
}

async function exists(accountId) {
  try {
    await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
    return true;
  } catch (e) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e?.message ?? e))) return false;
    throw e;
  }
}

async function gasPrice() {
  try {
    return BigInt((await rpc("gas_price", [null])).gas_price);
  } catch {
    return 10n ** 8n; // the protocol's minimum on both networks
  }
}

/** yoctoNEAR the account may spend now: its balance less the storage its bytes lock. */
async function spendable(accountId) {
  const a = await rpc("query", { request_type: "view_account", finality: "optimistic", account_id: accountId });
  return BigInt(a.amount) - BigInt(a.storage_usage) * BYTE_COST;
}

/** NEAR a planting needs on hand before it is sent: its prepaid gas at ten times the gas price, refunded after. */
export const playReserve = (price) => BigInt(SWARM_TGAS) * 10n ** 12n * price * PESSIMISTIC;
/** NEAR the plantings that `brainNear` of brain pays for will burn in gas. */
export const playGas = (brainNear, price) => (brainNear / DECISION_FEE) * PLANT_BURN_TGAS * 10n ** 12n * price;

/**
 * The NEAR a new strain account needs: its join deposit, its brain prepayment, the storage of the account and its two
 * keys, the reserve each planting must have on hand (prepaid gas at ten times the gas price, more than the join's), the
 * gas the spawn's steps and every planting its brain pays for will burn, and a small margin. At testnet's minimum gas
 * price that is about 0.13 NEAR.
 */
export async function strainNearFor({ joinNear = JOIN_NEAR, brain = true } = {}) {
  if (STRAIN_NEAR) return STRAIN_NEAR;
  const price = await gasPrice();
  const tgas = 10n ** 12n;
  const joinReserve = JOIN_TGAS * tgas * price * PESSIMISTIC;
  const reserve = brain && playReserve(price) > joinReserve ? playReserve(price) : joinReserve;
  const burnt = (JOIN_TGAS / 2n + 2n * TRANSFER_TGAS) * tgas * price + (brain ? playGas(BRAIN_NEAR, price) : 0n);
  return joinNear + (brain ? BRAIN_NEAR : 0n) + ACCOUNT_BYTES * BYTE_COST + reserve + burnt + MARGIN;
}

/** Whether a strain holds enough NEAR to send a planting now (its prepaid gas reserve). */
export async function canPayGas(accountId) {
  return (await spendable(accountId).catch(() => 0n)) >= playReserve(await gasPrice());
}

/** The account's access keys as the chain lists them. */
export async function keysOf(accountId) {
  const r = await rpc("query", { request_type: "view_access_key_list", finality: "optimistic", account_id: accountId });
  return r.keys.map((k) => ({ public_key: k.public_key, permission: k.access_key.permission }));
}

/**
 * Creates `accountId` under the parent and makes it a colony that attached its own NEAR, then locks it so the only key
 * left is `play` (a function-call key for the dish's play methods). With `brain`, the account also prepays its brain
 * budget to BRAIN_ACCOUNT before the lock. `onStep(step, hash)` hears each transaction.
 */
export async function createColony({ accountId, name, color, play, temp = KeyPair.fromRandom("ed25519"), brain = false, strainNear = null, joinNear = JOIN_NEAR, creditNear = CREDIT_NEAR, done = [], onStep = () => {} }) {
  const parent = account(PARENT);
  const self = new Account(accountId, new JsonRpcProvider({ url: RPCS[0] }), temp.toString());
  strainNear ??= await strainNearFor({ joinNear, brain });
  const price = await gasPrice();
  /** Waits for gas refunds until the account can pay `need`; the parent sends what is still missing (capped). */
  const ensure = async (need, step) => {
    for (let i = 0; i < 15; i++) {
      if ((await spendable(accountId).catch(() => 0n)) >= need) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    const short = need - (await spendable(accountId));
    if (short <= 0n) return;
    if (short > MAX_TOP_UP) throw new Error(`${step}: the account is ${yoctoText(short)} NEAR short, more than the parent tops up`);
    const r = await parent.signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(short + MARGIN)], waitUntil: "FINAL" });
    onStep(`topup-${step}`, r.transaction.hash, true);
  };
  const reserve = (tg) => tg * 10n ** 12n * price * PESSIMISTIC;
  const send = async (who, receiverId, acts, step) => {
    if (done.includes(step)) return null;
    // FINAL: each step's gas refund has landed before the next spends from the same small balance.
    const res = await who.signAndSendTransaction({ receiverId, actions: acts, waitUntil: "FINAL", throwOnFailure: false });
    const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
    onStep(step, res.transaction.hash, !fail);
    if (fail) throw new Error(`${step}: ${JSON.stringify(fail).slice(0, 200)}`);
    return res;
  };
  await send(parent, accountId, [
    actions.createAccount(),
    actions.transfer(strainNear),
    actions.addFullAccessKey(temp.getPublicKey()),
    actions.addFunctionCallAccessKey(play.getPublicKey(), CONTRACT, PLAY_METHODS),
  ], "create");
  // The new key needs a moment before RPC lets it sign.
  for (let i = 0; i < 12 && !(await keysOf(accountId).catch(() => [])).some((k) => k.public_key === temp.getPublicKey().toString()); i++) await new Promise((r) => setTimeout(r, 800));
  if (!done.includes("join")) await ensure(joinNear + reserve(JOIN_TGAS), "join");
  await send(self, CONTRACT, [actions.functionCall("join", { name, color }, JOIN_TGAS * 10n ** 12n, joinNear)], "join");
  if (brain && !done.includes("brain")) await ensure(BRAIN_NEAR + reserve(TRANSFER_TGAS), "brain");
  if (brain) await send(self, BRAIN_ACCOUNT, [actions.transfer(BRAIN_NEAR)], "brain");
  await send(parent, CONTRACT, [actions.functionCall("sponsor", { account_id: accountId }, 30n * 10n ** 12n, creditNear)], "credit");
  if (!done.includes("lock")) await ensure(reserve(TRANSFER_TGAS), "lock");
  await send(self, accountId, [actions.deleteKey(temp.getPublicKey())], "lock");
}

/** What the chain says about an account's keys and colony after the lock. */
export async function lockState(accountId, play) {
  const keys = await keysOf(accountId);
  const colony = await view("colony_of", { account_id: accountId });
  return {
    keys: keys.map((k) => ({ public_key: k.public_key, kind: k.permission === "FullAccess" ? "full access" : `function call: ${k.permission.FunctionCall.receiver_id} (${k.permission.FunctionCall.method_names.join(", ")})` })),
    locked: keys.length === 1 && keys[0].permission !== "FullAccess" && keys[0].public_key === play.getPublicKey().toString(),
    colony: colony?.id ?? null,
  };
}

/** Spawns per day, counted from the registry (the web's own limits are per address; this one is for everyone). */
function spawnsToday(reg) {
  return reg.spawns.filter((t) => Date.now() - Date.parse(t) < 86_400_000).length;
}

/**
 * Validates, reviews and (on approval) creates a strain. Returns { ok, strain?, reasons?, guard }. `log` gets one line
 * per step. Throws only on a chain failure after the account exists (the registry then records it as "failed").
 */
export async function spawnStrain(reg, { name, color, prompt, family }, log = console.log) {
  name = String(name ?? "").split(/\s+/).filter(Boolean).join(" ");
  prompt = String(prompt ?? "").trim();
  color = Number(color);
  const problems = [];
  if (!name || name.length > 24 || !/^[A-Za-z0-9 \-'.&!?_,:()]+$/.test(name)) problems.push("a name of 1 to 24 letters, digits, spaces or - ' . & ! ? _ , : ( )");
  if (/^culture [0-9a-f]+$/i.test(name)) problems.push("names like \"Culture 1a2b\" are kept for colonies someone else started");
  if (!STAIN_COLORS.includes(color)) problems.push("one of the stains on the list");
  if (family && !TEMPERAMENTS.includes(family)) problems.push("a family from the list");
  if (reg.strains.filter((s) => s.status !== "failed").length >= MAX_STRAINS) problems.push(`the swarm is full (${MAX_STRAINS} spawned strains); try again when one runs out`);
  if (spawnsToday(reg) >= PER_DAY) problems.push(`${PER_DAY} strains were spawned in the last 24 hours, the most the sponsor pays for; try again later`);
  if (!problems.length) {
    const colonies = await view("colonies", { from: 0, limit: 1000 });
    if (colonies.some((c) => c.name.toLowerCase() === name.toLowerCase())) problems.push("a colony with that name is already on the dish");
  }
  if (problems.length) return { ok: false, reasons: problems, guard: null };

  const guard = await review({ name, prompt, family });
  const guardLog = { ok: guard.ok, layer: guard.layer, model: guard.model ?? null, chat_id: guard.chatId ?? null, tee: guard.tee ? { ok: !!guard.tee.ok, reason: guard.tee.reason ?? null } : null, reasons: guard.reasons };
  if (!guard.ok) {
    reg.refused.push({ at: new Date().toISOString(), name_hash: sha(name).slice(0, 12), prompt_hash: sha(prompt).slice(0, 16), ...guardLog });
    if (reg.refused.length > 100) reg.refused.splice(0, reg.refused.length - 100);
    saveRegistry(reg);
    return { ok: false, reasons: guard.reasons, guard: guardLog };
  }

  const base = slugOf(name);
  let accountId = `${base}.${PARENT}`;
  const taken = async (a) => reg.strains.some((s) => s.account === a) || (await exists(a));
  for (let i = 2; await taken(accountId); i++) {
    accountId = i < 10 ? `${base.slice(0, 17)}-${i}.${PARENT}` : `${base.slice(0, 15)}-${crypto.randomBytes(2).toString("hex")}.${PARENT}`;
  }
  const slug = accountId.split(".")[0];
  const play = KeyPair.fromRandom("ed25519");
  const temp = KeyPair.fromRandom("ed25519");
  const ownerToken = crypto.randomBytes(18).toString("base64url");
  const strain = {
    id: slug,
    account: accountId,
    name,
    color,
    temperament: guard.temperament,
    prompt,
    summary: guard.summary,
    guard: guardLog,
    owner_hash: sha(ownerToken),
    created_at: new Date().toISOString(),
    status: "creating",
    play_key: play.getPublicKey().toString(),
    methods: PLAY_METHODS,
    txs: {},
    brain: { budget: BRAIN_NEAR.toString(), spent: "0", fee: DECISION_FEE.toString(), account: BRAIN_ACCOUNT, payments: [] },
    decisions: [],
    topups: 0,
  };
  saveKey(reg, accountId, play);
  // The temporary key is kept on disk until the lock, so a spawn cut short can be finished (resumeSpawns).
  saveKey(reg, `${accountId}.temp`, temp);
  reg.strains.push(strain);
  reg.spawns.push(strain.created_at);
  saveRegistry(reg);

  await finishSpawn(reg, strain, play, temp, log);
  return { ok: strain.status === "active", strain: publicStrain(strain), ownerToken, guard: guardLog, reasons: strain.status === "active" ? [] : [strain.error ?? "the account could not be finished"] };
}

/** Runs the chain steps a strain still lacks, then reads back its keys and colony. */
async function finishSpawn(reg, strain, play, temp, log) {
  strain.done ??= [];
  try {
    await createColony({
      accountId: strain.account,
      name: strain.name,
      color: strain.color,
      play,
      temp,
      brain: true,
      done: strain.done,
      onStep: (step, hash, ok) => {
        strain.txs[step] = hash;
        if (ok) strain.done.push(step);
        if (ok && step === "brain") strain.brain.payments.push({ at: new Date().toISOString(), near: BRAIN_NEAR.toString(), tx: hash, from: strain.account });
        saveRegistry(reg);
        log(`swarm: ${strain.account} ${step}`, hash);
      },
    });
    Object.assign(strain, await lockState(strain.account, play));
    strain.status = strain.locked && strain.colony != null ? "active" : "failed";
    delete strain.error;
    if (strain.locked) fs.rmSync(path.join(reg.keysDir, `${strain.account}.temp.json`), { force: true });
  } catch (e) {
    strain.status = "failed";
    strain.error = (e instanceof Error ? e.message : String(e)).slice(0, 240);
    saveRegistry(reg);
    await abandonSpawn(reg, strain, temp, log);
  }
  saveRegistry(reg);
}

/**
 * Leaves no full-access key behind a spawn that failed: before the join, the account is deleted and its NEAR returns
 * to the parent; after it, the temporary key is deleted, so the account holds only the play key (the colony stays on
 * the dish, idle, with status "failed"). If even that fails, the temporary key stays on disk and the log says so.
 */
export async function abandonSpawn(reg, strain, temp, log = console.log) {
  const self = new Account(strain.account, new JsonRpcProvider({ url: RPCS[0] }), temp.toString());
  const tempKey = temp.getPublicKey().toString();
  try {
    const keys = await keysOf(strain.account).catch(() => null);
    if (keys === null) {
      if (!(await exists(strain.account))) strain.status = "reclaimed";
    } else if (!keys.some((k) => k.public_key === tempKey)) {
      strain.locked = keys.every((k) => k.permission !== "FullAccess");
    } else if (!(strain.done ?? []).includes("join")) {
      const r = await self.signAndSendTransaction({ receiverId: strain.account, actions: [actions.deleteAccount(PARENT)], waitUntil: "FINAL" });
      strain.txs.reclaim = r.transaction.hash;
      strain.status = "reclaimed";
      log(`swarm: ${strain.account} deleted, its NEAR back to ${PARENT}`, r.transaction.hash);
    } else {
      const r = await self.signAndSendTransaction({ receiverId: strain.account, actions: [actions.deleteKey(temp.getPublicKey())], waitUntil: "FINAL" });
      strain.txs.lock = r.transaction.hash;
      strain.locked = true;
      log(`swarm: ${strain.account} failed after joining; its temporary key is deleted`, r.transaction.hash);
    }
    if (strain.status === "reclaimed" || strain.locked) fs.rmSync(path.join(reg.keysDir, `${strain.account}.temp.json`), { force: true });
  } catch (e) {
    strain.abandon_error = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    log(`swarm: ${strain.account} could not be cleaned up; its temporary key stays in ${reg.keysDir}`, strain.abandon_error);
  }
  saveRegistry(reg);
}

/** Finishes spawns a restart or a failed step cut short (their temporary key is still on disk). */
export async function resumeSpawns(reg, log = console.log) {
  for (const s of reg.strains.filter((x) => x.status === "failed" || x.status === "creating")) {
    const file = (a) => path.join(reg.keysDir, `${a}.json`);
    if (!fs.existsSync(file(`${s.account}.temp`)) || !fs.existsSync(file(s.account))) continue;
    const read = (a) => KeyPair.fromString(JSON.parse(fs.readFileSync(file(a), "utf8")).private_key);
    log(`swarm: finishing the spawn of ${s.account}`);
    await finishSpawn(reg, s, read(s.account), read(`${s.account}.temp`), log);
  }
}

/** A strain as the site may show it. */
export function publicStrain(s) {
  const { owner_hash, ...rest } = s;
  return rest;
}

/** Brain budget left, in yoctoNEAR. */
export const brainLeft = (s) => BigInt(s.brain.budget) - BigInt(s.brain.spent);

/**
 * Tops up a strain: the parent sponsors more dish credit and prepays more brain to the inference account. Only its
 * owner (who holds the token the spawn returned) may, and only TOPUPS times.
 */
export async function topUp(reg, { account: accountId, ownerToken }, log = console.log) {
  const s = reg.strains.find((x) => x.account === accountId);
  if (!s) return { ok: false, reasons: ["no spawned strain with that account"] };
  if (!ownerToken || sha(String(ownerToken)) !== s.owner_hash) return { ok: false, reasons: ["only the browser that spawned this strain can top it up"] };
  if ((s.topups ?? 0) >= TOPUPS) return { ok: false, reasons: [`a strain can be topped up ${TOPUPS} times on testnet`] };
  if (s.status === "failed") return { ok: false, reasons: ["this strain failed to start"] };
  const parent = account(PARENT);
  // More brain means more plantings: the strain also gets the gas they will burn.
  const gas = playGas(BRAIN_NEAR, await gasPrice());
  const fuel = await parent.signAndSendTransaction({ receiverId: accountId, actions: [actions.transfer(gas)], waitUntil: "EXECUTED_OPTIMISTIC" });
  const brain = await parent.signAndSendTransaction({ receiverId: BRAIN_ACCOUNT, actions: [actions.transfer(BRAIN_NEAR)], waitUntil: "EXECUTED_OPTIMISTIC" });
  const credit = await parent.signAndSendTransaction({ receiverId: CONTRACT, actions: [actions.functionCall("sponsor", { account_id: accountId }, 30n * 10n ** 12n, CREDIT_NEAR)], waitUntil: "EXECUTED_OPTIMISTIC" });
  s.topups = (s.topups ?? 0) + 1;
  s.brain.budget = (BigInt(s.brain.budget) + BRAIN_NEAR).toString();
  s.brain.payments.push({ at: new Date().toISOString(), near: BRAIN_NEAR.toString(), tx: brain.transaction.hash, from: PARENT, credit_tx: credit.transaction.hash, gas_near: gas.toString(), gas_tx: fuel.transaction.hash });
  if (s.status === "sleeping") s.status = "active";
  saveRegistry(reg);
  log(`swarm: topped up ${accountId} (${yoctoText(BRAIN_NEAR)} NEAR of brain)`, brain.transaction.hash, credit.transaction.hash);
  return { ok: true, strain: publicStrain(s) };
}

/**
 * Brings the stored dish up to the clock before a swarm account plants. The contract keeps 40 TGas of any call for
 * itself, and these accounts hold too little NEAR to prepay much more (NEAR reserves prepaid gas at a pessimistic
 * price), so their calls cannot catch the dish up themselves: the parent, which has NEAR for gas, advances it first.
 */
export async function swarmCatchUp() {
  const st = await view("state");
  if (Number(st.due_generation) <= Number(st.generation)) return;
  await account(PARENT).signAndSendTransaction({
    receiverId: CONTRACT,
    actions: [actions.functionCall("advance", {}, 150n * 10n ** 12n, 0n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
}

const BEHIND = /behind the clock/;
/** Runs `send` (a swarm account's call) on a current dish, again if the clock ticked in between. */
export async function onCurrentDish(send) {
  for (let i = 0; ; i++) {
    await swarmCatchUp();
    try {
      const r = await send();
      if (r?.failure && BEHIND.test(r.failure) && i < 2) continue;
      return r;
    } catch (e) {
      if (!BEHIND.test(String(e?.message ?? e)) || i >= 2) throw e;
    }
  }
}
