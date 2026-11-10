// What ties a planting on chain to the model answer that chose it, shared by the runner and scripts/verify-tee.mjs.
//
// A planting a NEAR AI answer chose, once the runner verified that answer, carries at the end of its on-chain note
// " · tee:" and the first 16 hex characters of the SHA-256 of that answer's exact response body. The full answer
// (request and response bytes, signature, attestation hash) is archived under that hash and served by the log window at
// /tee/<hash or 16-hex prefix>. Each option line in the signed prompt ends with "cells:" and 16 hex characters of its
// cells' SHA-256 (optionLine; prompts before round 11 carry 12), so the cells in the transaction can be matched to the
// number the model chose from the signed request alone; the log entry's option_cells_sha256 repeats the full hashes.

import crypto from "node:crypto";

export const TEE_TAG = " · tee:";
export const TEE_TAG_RE = /\s*·\s*tee:[0-9a-f]{16}\s*$/;

/**
 * The note that goes on chain: the cleaned lab note, then the answer's response-hash prefix, but only when the runner
 * verified that answer (tee.ok: the enclave's signature, an attestation fetched with our own nonce, the pinned machine).
 * An answer that did not verify plants with a plain note, so the tag on chain always means "verified when planted".
 */
export function chainNote(note, tee) {
  const sha = tee?.response_sha256;
  return tee?.ok === true && /^[0-9a-f]{64}$/.test(sha ?? "") ? `${note}${TEE_TAG}${sha.slice(0, 16)}` : note;
}

/** The 16-hex response-hash prefix in an on-chain note, or null. */
export function teeTagOf(note) {
  const m = String(note ?? "").match(/·\s*tee:([0-9a-f]{16})\s*$/);
  return m ? m[1] : null;
}

/** SHA-256 of a planting's cells as the transaction carries them (JSON array of cell indices). */
export const cellsHash = (cells) => crypto.createHash("sha256").update(JSON.stringify(cells.map(Number))).digest("hex");

/** One hash per option, in the order the model saw them. */
export const optionHashes = (cands) => cands.map((c) => cellsHash(c.cells));

// Each option line in the prompt ends its parenthesis with "cells:<first 16 hex of cellsHash>", so the request the
// enclave signs names the exact cells of every option: a verifier needs nothing the house logged, only the signed
// request, to check that the transaction planted the option the model chose. 16 hex (64 bits) since round 11; the
// 12-hex fingerprints of round-10 prompts are still read.
export const CELLS_PREFIX = 16;
export const cellsTag = (cells) => `cells:${cellsHash(cells).slice(0, CELLS_PREFIX)}`;

/** One numbered option as the model reads it (house and spawned strains alike). */
export function optionLine(c, i) {
  return `${i + 1}. ${c.pact ? "[PACT] " : ""}${c.why} (${c.cells.length} cells, ${c.costText} PETRI, ${cellsTag(c.cells)}) — ${c.forecastText ?? "no forecast"}`;
}

/**
 * Option `n` (1-based) in the user message the runner wrote (never the system message, which for a spawned strain
 * holds the player's temperament): { line, why, cells, prefix, count } where count is how many lines start "n. "
 * (a verifier wants exactly one), or null when there is none. Older prompts (no cells tag) give prefix null.
 */
export function parseOption(userText, n) {
  const lines = String(userText ?? "").split("\n").filter((l) => l.startsWith(`${n}. `));
  if (!lines.length) return null;
  const line = lines[0];
  const m = line.match(/^\d+\. (?:\[PACT\] )?(.*) \((\d+) cells, [^)]*?PETRI(?:, cells:([0-9a-f]{16}|[0-9a-f]{12}))?\)/);
  return { line, count: lines.length, why: m ? m[1] : null, cells: m ? Number(m[2]) : null, prefix: m?.[3] ?? null };
}

/** The generation a prompt's user message says the dish was at ("Generation 4186."), or null. */
export function promptGeneration(userText) {
  const m = String(userText ?? "").match(/^Generation (\d+)\./m);
  return m ? Number(m[1]) : null;
}

/** The last user message of a chat request body (the exact JSON string the enclave signed), or "". */
export function userMessage(requestBody) {
  try {
    const msgs = JSON.parse(requestBody).messages ?? [];
    return String(msgs.filter((m) => m.role === "user").at(-1)?.content ?? "");
  } catch {
    return "";
  }
}
