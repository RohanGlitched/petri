// What ties a planting on chain to the model answer that chose it, shared by the runner and scripts/verify-tee.mjs.
//
// A planting a NEAR AI answer chose carries, at the end of its on-chain note, " · tee:" and the first 16 hex characters
// of the SHA-256 of that answer's exact response body. The full answer (request and response bytes, signature,
// attestation hash) is archived under that hash and served by the log window at /tee/<hash or 16-hex prefix>.
// The log entry lists every option the model was shown, with the SHA-256 of each option's cells, so the cells in the
// transaction can be matched to the number the model chose.

import crypto from "node:crypto";

export const TEE_TAG = " · tee:";
export const TEE_TAG_RE = /\s*·\s*tee:[0-9a-f]{16}\s*$/;

/** The note that goes on chain: the cleaned lab note, then the answer's response-hash prefix when there is one. */
export function chainNote(note, tee) {
  const sha = tee?.response_sha256;
  return /^[0-9a-f]{64}$/.test(sha ?? "") ? `${note}${TEE_TAG}${sha.slice(0, 16)}` : note;
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
