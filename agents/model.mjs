// The strains think first with a model on NEAR AI Cloud that runs inside a TEE: each answer's signature is fetched
// and checked against the model enclave's attested signing address, from a report fetched with our own nonce
// (tee.mjs); the bytes are archived for anyone to re-check (scripts/verify-tee.mjs). Claude Haiku, within a fixed dollar budget,
// is the second model, used when NEAR AI cannot answer.
// Either model only chooses among moves the rules already accept (and, at the council, among deals the rules can
// enforce) and writes the lab note; the log says which model chose. If no model answers, the strains fall back to
// their first candidate and the council does not sit.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAttestation, newNonce, sha256Hex, verifyAnswer, verifyQuote, verifySignerQuotes } from "./tee.mjs";
import { optionLine } from "./notes.mjs";
import Anthropic from "@anthropic-ai/sdk";

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const KEY = process.env.NEARAI_API_KEY ?? "";
export const MODEL = process.env.NEARAI_MODEL ?? "z-ai/glm-5.3-flash";

// Where each NEAR AI answer (the exact request and response bytes, the signature, the verdict) and each attestation
// report is archived, so anyone can re-check a move later: <dir>/tee/<sha256 of the response body>.json and
// <dir>/attestation/<sha256 of the report>.json. The log window serves both read-only. null writes nothing (dry runs).
let archiveDir = process.env.PETRI_LOG_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "log");
export const setTeeArchive = (dir) => {
  archiveDir = dir;
};

// The attestation report, fetched with a fresh random nonce of our own at most hourly (PETRI_TEE_ATTEST_MS), or sooner
// when an answer is signed by an address the report we hold does not name. Each model enclave's TDX quote is verified
// with Intel's collateral (PETRI_TEE_DCAP=0 skips that; verdicts then say quote_verified: false). A failed fetch or
// check leaves no signer, so every answer until the next good report fails verification: fail closed.
const ATTEST_MS = Number(process.env.PETRI_TEE_ATTEST_MS ?? "3600000");
const VERIFY_QUOTES = process.env.PETRI_TEE_DCAP !== "0";
let attestation = null;
let attestRetryAt = 0;
export const teeTally = { verified: 0, unverified: 0 };

// Every request sent to NEAR AI, answered or not, in order: { seq, at, purpose, request_sha256, response_sha256 }. The
// house could ask the model several times for one move (it answers at temperature 0.7) and plant the answer it likes;
// the runner never does, and to make that visible each move's log entry lists every request sent while the move was
// being decided (nearaiSince), and the health JSON counts requests by purpose (nearaiRequestTally).
const nearaiLog = [];
let nearaiSeq = 0;
const nearaiCount = {};
/** A position in the request log: pass it to nearaiSince() once the move is decided. */
export const nearaiMark = () => nearaiSeq;
/** The NEAR AI requests sent since `mark` (for `purpose`, if given): { count, requests: [{ request_sha256, response_sha256 }] }. */
export function nearaiSince(mark, purpose = null) {
  const list = nearaiLog.filter((e) => e.seq > mark && (!purpose || e.purpose === purpose));
  return { count: list.length, requests: list.map((e) => ({ request_sha256: e.request_sha256, response_sha256: e.response_sha256 })) };
}
export const nearaiRequestTally = () => ({ ...nearaiCount });
function noteRequest(purpose, requestSha, responseSha) {
  nearaiLog.push({ seq: ++nearaiSeq, at: new Date().toISOString(), purpose, request_sha256: requestSha, response_sha256: responseSha });
  if (nearaiLog.length > 500) nearaiLog.shift();
  nearaiCount[purpose] = (nearaiCount[purpose] ?? 0) + 1;
}

function archive(sub, name, text) {
  if (!archiveDir) return;
  try {
    const dir = path.join(archiveDir, sub);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, text);
  } catch (e) {
    console.error("tee archive failed:", e instanceof Error ? e.message : e);
  }
}

async function fetchAttestation() {
  const nonce = newNonce();
  const q = new URLSearchParams({ model: MODEL, provider: "near", include_tls_fingerprint: "false", signing_algo: "ecdsa", nonce });
  const r = await fetch(`${BASE}/attestation/report?${q}`, {
    headers: { authorization: `Bearer ${KEY}`, accept: "application/json", "x-no-aliasing": "true" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`attestation report ${r.status}`);
  const text = await r.text();
  let att = checkAttestation(text, { nonce, model: MODEL });
  // The machine is pinned (no debug TD, TCB UpToDate or SWHardeningNeeded, the pinned OS image) and the compose
  // manager's own quote must say a production GLM compose file is what runs (tee.mjs).
  if (VERIFY_QUOTES) att = await verifySignerQuotes(att, verifyQuote, { composeManager: true });
  if (att.unpinned?.length) {
    if (!unpinnedSeen || unpinnedSeen.mr_td !== att.unpinned[0].mr_td || unpinnedSeen.rt_mr2 !== att.unpinned[0].rt_mr2) console.error("TEE ALERT: NEAR AI served an image that is not pinned; moves fail closed until it is reviewed:", JSON.stringify(att.unpinned[0]));
    unpinnedSeen = { ...att.unpinned[0], seen_at: new Date().toISOString(), report_sha256: att.sha256, report_ok: att.ok };
  } else if (att.ok) unpinnedSeen = null;
  archive("attestation", `${att.sha256}.json`, text);
  if (archiveDir) {
    try {
      fs.writeFileSync(path.join(archiveDir, "attestation", "latest.json"), text);
      fs.writeFileSync(path.join(archiveDir, "attestation", "latest.sha256"), att.sha256 + "\n");
      const entry = { sha256: att.sha256, at: new Date().toISOString(), nonce, model: MODEL, ok: att.ok, reason: att.reason, quotes_verified: !!att.quotes_verified, signers: att.signers.map((s) => ({ address: s.address, tcb_status: s.tcb_status ?? null, image: s.image ?? null, compose: s.compose ?? null })), gateway: att.gateway, rejected: att.rejected, unpinned: att.unpinned ?? [] };
      fs.appendFileSync(path.join(archiveDir, "attestation", "index.jsonl"), JSON.stringify(entry) + "\n");
    } catch {
      /* the report itself is archived under its hash */
    }
  }
  return { ...att, at: Date.now() };
}

/** The attestation to check an answer signed by `address` against: refetched when stale or when it does not name it. */
async function attestationFor(address) {
  const a = String(address ?? "").toLowerCase();
  const fresh = attestation?.ok && Date.now() - attestation.at < ATTEST_MS;
  if (fresh && attestation.signers.some((s) => s.address === a)) return attestation;
  if (attestation && Date.now() < attestRetryAt) return attestation;
  attestRetryAt = Date.now() + 600_000;
  try {
    attestation = await fetchAttestation();
  } catch (e) {
    attestation = { ok: false, reason: `attestation fetch failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`, sha256: null, nonce: null, signers: [], rejected: [], at: Date.now() };
  }
  return attestation;
}

/** The attestation report the strains hold now, for the health JSON. */
export const attestationStatus = () =>
  attestation
    ? { sha256: attestation.sha256, at: new Date(attestation.at).toISOString(), ok: attestation.ok, reason: attestation.reason ?? null, quotes_verified: !!attestation.quotes_verified, signers: attestation.signers.map((s) => ({ address: s.address, tcb_status: s.tcb_status ?? null })), unpinned: attestation.unpinned ?? [] }
    : null;

// The newest machine NEAR AI served that verified but matched no pinned image (tee.mjs PINNED_IMAGES), kept until a
// report passes again: moves fail closed meanwhile, and the health JSON shows it as tee_image_unpinned so a person can
// review it and add a pin (docs/TEE.md, "A new image").
let unpinnedSeen = null;
export const teeImageUnpinned = () => unpinnedSeen;

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
// Dollars per token for Claude Haiku 5.5 (prompts under 100K tokens), and the most the strains may spend in total.
const PRICE_IN = 0.1 / 1e6;
const PRICE_OUT = 0.5 / 1e6;
const BUDGET = Number(process.env.CLAUDE_BUDGET_USD ?? "10");
const SPENT_FILE = new URL("./log/claude-spent.json", import.meta.url);
const readSpent = () => {
  try {
    return Number(JSON.parse(fs.readFileSync(SPENT_FILE, "utf8")).usd) || 0;
  } catch {
    return 0;
  }
};
let spent = readSpent();
// Both dishes' agents share the one budget file, so each charge is added to what the file holds now.
function charge(usd) {
  spent = Math.max(spent, readSpent()) + usd;
  try {
    fs.writeFileSync(SPENT_FILE, JSON.stringify({ usd: spent, at: new Date().toISOString() }));
  } catch {
    /* the budget still holds for this run */
  }
}
export const claudeSpent = () => spent;
// Calls and tokens this process has used, by purpose (move, propose, answer), for the cost report.
const tally = {};
export const modelTally = () => tally;

const ORDER = (process.env.PETRI_MODELS ?? "nearai,claude").split(",").map((p) => p.trim());

export const hasModel = () => KEY.length > 0 || claude !== null;
export const modelName = () =>
  ORDER.map((p) => (p === "claude" ? claude && CLAUDE_MODEL : p === "nearai" ? KEY && MODEL : null)).filter(Boolean).join(" / ") || null;

let errors = 0;
let lastError = null;
export const modelErrors = () => errors;
export const lastModelError = () => (hasModel() ? lastError : "no model configured");

function prompt(strain, summary, cands) {
  const system = `You are ${strain.name}, a colony of cells living on a shared Petri dish run by a NEAR smart contract. ${strain.voice}
The dish follows Conway's Life. New cells join the colony owning most of their three parents. Every generation the agar feeds PETRI to living cells outside the house; you are one of the dish's five house strains, which are never fed, so what you play for is living cells, territory, and what you do to the rivals. Planting costs PETRI; half is burned, half returns to the agar. Planting inside a rival's buffer is a siege and costs several times as much, so you never do it. Rivals outside the house are known only by number.
Each option comes with a forecast: the contract's own rules run ${summary.forecastGens} generations ahead on a copy of the dish as it is now (other players' future moves are unknown, so it can be wrong). Your memory shows what your past moves really did. Small still lifes are cheap and safe but change little; a glider gun, spaceship, eater wall or methuselah costs more and can change the dish. Choose a big play when its forecast earns it.
Promises from the house council are listed; an option marked [PACT] keeps one. Breaking a paid promise costs you trust at the next council.
Choose exactly one of the numbered plantings, all of which the contract will accept (each ends with "cells:" and 16 hex characters, a fingerprint of its exact cells for the record). Then write a lab note of one or two short sentences, at most 100 characters in all, in your own voice, saying why. Answer with JSON only: {"choice": <number>, "note": "<text>"}.`;
  const user = `Generation ${summary.generation}. You hold ${summary.balance} PETRI and ${summary.myCells} living cells. The dish has ${summary.totalLive} living cells; ${summary.agar} PETRI remain in the agar.
Rivals: ${summary.rivals || "none yet"}.
${summary.memory ?? "You have no moves on record yet."}
${summary.pacts ? `Council promises this window:\n${summary.pacts}\n` : ""}Plantings you can make:
${cands.map(optionLine).join("\n")}`;
  return { system, user };
}

/** Returns { index, note, model, chatId, signature } or null when no model can answer. */
export async function choose(strain, summary, cands) {
  if (cands.length === 0) return null;
  const { system, user } = prompt(strain, summary, cands);
  const r = await askJson({ system, user, schema: PICK_SCHEMA, maxTokens: 400, purpose: "move" });
  if (!r) return null;
  try {
    const { index, note } = parsePick(r.json, cands);
    return { index, note, model: r.model, chatId: r.chatId, signature: r.signature, tee: r.tee ?? null, usage: r.usage };
  } catch (e) {
    errors++;
    lastError = `${r.model}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    return null;
  }
}

/** Picks a candidate from a model's JSON answer, or throws. */
function parsePick(json, cands) {
  const index = Number(json.choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= cands.length) throw new Error(`choice out of range: ${json.choice}`);
  return { index, note: trimNote(json.note) };
}

/**
 * A note of at most 100 characters: whole sentences, or failing that whole clauses, or failing that whole words, and
 * never a trailing ellipsis.
 */
export function trimNote(n) {
  let note = String(n ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 100) {
    const head = note.slice(0, 100);
    const sentences = head.match(/^.*[.!?](?=\s|$)/);
    let clause = -1;
    for (const m of head.matchAll(/[,;:](?=\s)|\s[–—-](?=\s)/g)) if (m.index >= 40) clause = m.index;
    note = sentences ? sentences[0] : clause > 0 ? `${head.slice(0, clause)}.` : `${note.slice(0, 98).replace(/[\s,;:–—-]+\S*$/, "")}.`;
  }
  return note.replace(/(\.\.+|…)$/, ".");
}

const PICK_SCHEMA = {
  type: "object",
  properties: { choice: { type: "integer" }, note: { type: "string" } },
  required: ["choice", "note"],
  additionalProperties: false,
};

/**
 * Asks the providers in order (PETRI_MODELS="nearai,claude" by default) for a JSON answer matching `schema`; the first
 * that answers wins. Returns { json, model, chatId, signature, tee, usage } or null (lastModelError() says why).
 */
export async function askJson({ system, user, schema, maxTokens = 400, purpose = "move" }) {
  lastError = null;
  const errs = [];
  for (const p of ORDER) {
    const r = p === "claude" ? await askClaude(system, user, schema, maxTokens) : p === "nearai" && KEY ? await askNearAI(system, user, maxTokens, purpose) : null;
    if (r) {
      const t = (tally[purpose] ??= { calls: 0, input: 0, output: 0 });
      t.calls++;
      t.input += r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0;
      t.output += r.usage?.output_tokens ?? r.usage?.completion_tokens ?? 0;
      return r;
    }
    if (lastError) errs.push(lastError);
    lastError = null;
  }
  lastError = errs.join("; ").slice(0, 240) || null;
  return null;
}

const parseJson = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

async function askClaude(system, user, schema, maxTokens) {
  if (!claude) return null;
  if (spent >= BUDGET) {
    lastError = `Claude budget of $${BUDGET} spent`;
    return null;
  }
  try {
    const res = await claude.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      },
      { timeout: 40_000 },
    );
    charge(res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT);
    if (res.stop_reason === "refusal") throw new Error("Claude declined");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { json: parseJson(text), model: CLAUDE_MODEL, chatId: res.id, signature: null, usage: res.usage };
  } catch (e) {
    errors++;
    lastError = `Claude: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    console.error("model failed:", lastError);
    return null;
  }
}

async function askNearAI(system, user, maxTokens, purpose = "move") {
  let requestSha = null;
  let responseSha = null;
  try {
    // The exact bytes sent and received: the enclave signs their SHA-256 hashes.
    const requestBody = JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      response_format: { type: "json_object" },
      // GLM thinks before answering by default; a move needs a short JSON answer, so thinking is off (1-2 s, not 10).
      ...(process.env.NEARAI_THINKING === "1" ? {} : { chat_template_kwargs: { enable_thinking: false } }),
    });
    requestSha = sha256Hex(requestBody);
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-no-aliasing": "true" },
      body: requestBody,
      signal: AbortSignal.timeout(40_000),
    });
    const responseBody = await res.text();
    responseSha = sha256Hex(responseBody);
    if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${responseBody.slice(0, 200)}`);
    const body = JSON.parse(responseBody);
    const json = parseJson(body.choices?.[0]?.message?.content ?? "");
    // A 404 means the signature is not stored yet: ask again for a few seconds. A 2xx carrying error_code means none.
    let signature = null;
    for (let i = 0; i < 4 && !signature; i++) {
      try {
        const s = await fetch(`${BASE}/signature/${encodeURIComponent(body.id)}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`, {
          headers: { authorization: `Bearer ${KEY}`, accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        });
        if (s.ok) {
          const j = await s.json();
          if (j?.text && j?.signature && !j.error_code) signature = j;
          else break;
        } else if (s.status !== 404) break;
      } catch {
        /* the answer stands; the verdict says the signature is missing */
      }
      if (!signature) await new Promise((r) => setTimeout(r, 1000));
    }
    const att = signature ? await attestationFor(signature.signing_address) : null;
    const tee = verifyAnswer({ signature, requestBody, responseBody, model: MODEL, attestation: att });
    teeTally[tee.ok ? "verified" : "unverified"]++;
    // The exact bytes, so anyone can recompute both hashes, recover the signer and check it against the report.
    archive(
      "tee",
      `${tee.response_sha256}.json`,
      JSON.stringify({ v: 1, at: new Date().toISOString(), base_url: BASE, model: MODEL, chat_id: body.id, request_body: requestBody, response_body: responseBody, request_sha256: tee.request_sha256, response_sha256: tee.response_sha256, signature, attestation_sha256: tee.attestation_sha256, nonce: tee.nonce, verdict: tee }, null, 1),
    );
    return { json, model: MODEL, chatId: body.id, signature, tee, usage: body.usage ?? null };
  } catch (e) {
    errors++;
    lastError = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.error("model failed:", lastError);
    return null;
  } finally {
    if (requestSha) noteRequest(purpose, requestSha, responseSha);
  }
}
