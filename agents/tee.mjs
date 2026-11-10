// Checks a NEAR AI Cloud answer's TEE signature against an attestation report fetched with our own fresh nonce, so a
// move the strains say came from the enclave can be proven by anyone who reads the archived bytes.
//
// What NEAR AI Cloud publishes (docs.near.ai/cloud/verification):
//   GET /v1/attestation/report?model=<id>&provider=near&signing_algo=ecdsa&nonce=<64 hex>
//     model_attestations[]: { model_name, signing_address, signing_algo, request_nonce, intel_quote, event_log, ... }
//     The Intel TDX quote's 64-byte report_data is <signing address, zero-padded to 32 bytes><our 32-byte nonce>, so a
//     verified quote binds that address to the enclave and proves the report was made after we chose the nonce.
//     gateway_attestation is the gateway's own enclave: its address signs "gateway" signatures only, never ours.
//   GET /v1/signature/<chat id>?model=<id>&signing_algo=ecdsa
//     { text: "<model>:<sha256 request body>:<sha256 response body>", signature, signing_address, signing_algo,
//       signature_kind: "provider_tee" }, an Ethereum personal message (EIP-191) signed inside the model's enclave.
//
// An answer passes only when every check holds; anything missing (no report, no signature, a fetch that failed) fails.

import crypto from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const hex = (b) => bytesToHex(b);
export const sha256Hex = (s) => hex(sha256(typeof s === "string" ? utf8ToBytes(s) : s));
const lower = (s) => String(s ?? "").toLowerCase();

/** A fresh 32-byte nonce as 64 hex characters, as the attestation endpoint takes it. */
export const newNonce = () => crypto.randomBytes(32).toString("hex");

/** The Ethereum address that signed `text` as a personal message (EIP-191), or null. */
export function recoverPersonal(text, signatureHex) {
  try {
    const msg = utf8ToBytes(text);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
    const sig = hexToBytes(String(signatureHex).replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    let v = sig[64];
    if (v >= 27) v -= 27;
    if (v > 1) return null;
    const compact = sig.slice(0, 64);
    const recovered = secp256k1.Signature.fromBytes(new Uint8Array([v, ...compact]), "recovered").recoverPublicKey(digest);
    const pub = recovered.toBytes(false).slice(1);
    return "0x" + hex(keccak_256(pub).slice(-20));
  } catch {
    return null;
  }
}

// A TDX quote (version 4): a 48-byte header, then the TD report body, whose report_data is the 64 bytes at offset 520.
const QUOTE_HEADER = 48;
const TD_REPORT_DATA = 520;

/** The 64-byte report_data inside a TDX quote (hex), read from its fixed offset, or null. Not a verification. */
export function quoteReportData(quoteHex) {
  try {
    const q = hexToBytes(String(quoteHex).replace(/^0x/, ""));
    const version = q[0] | (q[1] << 8);
    const teeType = q[4] | (q[5] << 8) | (q[6] << 16) | (q[7] << 24);
    if (version !== 4 || teeType !== 0x81) return null;
    const at = QUOTE_HEADER + TD_REPORT_DATA;
    if (q.length < at + 64) return null;
    return hex(q.slice(at, at + 64));
  } catch {
    return null;
  }
}

/** What report_data must be for an ECDSA signer and our nonce: the 20-byte address, 12 zero bytes, the nonce. */
export function expectedReportData(address, nonce) {
  return lower(address).replace(/^0x/, "") + "00".repeat(12) + lower(nonce);
}

/**
 * Checks an attestation report (its exact text) for model `model` and our `nonce`. Returns
 * { ok, reason, sha256, nonce, model, signers: [{ address, algo, model_name, quote }], gateway, rejected: [...] }.
 * A signer is a model_attestations entry whose model_name is `model`, whose request_nonce is our nonce, whose algo is
 * ecdsa and whose quote's report_data binds its address and our nonce. The gateway's address is never a signer.
 * `quote` is the candidate's intel_quote (hex), for verifyQuote(). ok means at least one signer.
 */
export function checkAttestation(text, { nonce, model }) {
  const sha = sha256Hex(text);
  const out = { ok: false, reason: null, sha256: sha, nonce: lower(nonce), model, signers: [], gateway: null, rejected: [] };
  if (!/^[0-9a-f]{64}$/.test(out.nonce)) return { ...out, reason: "no nonce of our own (64 hex characters)" };
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return { ...out, reason: "the report is not JSON" };
  }
  out.gateway = report?.gateway_attestation?.signing_address ? lower(report.gateway_attestation.signing_address) : null;
  const list = Array.isArray(report?.model_attestations) ? report.model_attestations : [];
  if (!list.length) return { ...out, reason: "the report has no model attestations" };
  for (const a of list) {
    const address = lower(a?.signing_address);
    const why = [];
    if (a?.model_name !== model) why.push(`model ${a?.model_name ?? "unnamed"}, not ${model}`);
    if (lower(a?.signing_algo) !== "ecdsa") why.push(`signing algo ${a?.signing_algo}`);
    if (lower(a?.request_nonce) !== out.nonce) why.push("request_nonce is not our nonce");
    if (!/^0x[0-9a-f]{40}$/.test(address)) why.push("no ECDSA signing address");
    const rd = quoteReportData(a?.intel_quote);
    if (!rd) why.push("no TDX quote");
    else if (rd !== expectedReportData(address, out.nonce)) why.push("the quote's report_data does not bind this address and our nonce");
    if (why.length) out.rejected.push({ address, model_name: a?.model_name ?? null, why });
    else out.signers.push({ address, algo: "ecdsa", model_name: a.model_name, quote: a.intel_quote });
  }
  out.ok = out.signers.length > 0;
  if (!out.ok) out.reason = `no model attestation passed: ${out.rejected.map((r) => r.why.join(", ")).join("; ")}`.slice(0, 300);
  return out;
}

/**
 * Verifies a TDX quote with Intel's collateral (Phala's dcap-qvl, pure JS; it fetches the collateral over HTTPS).
 * Returns { ok, status, advisory_ids, report_data, mr_config_id, rt_mr3 } or { ok: false, error }.
 */
export async function verifyQuote(quoteHex, { pccsUrl } = {}) {
  try {
    const dcap = await import("@phala/dcap-qvl");
    const lib = dcap.default ?? dcap;
    const v = await lib.getCollateralAndVerify(Buffer.from(String(quoteHex).replace(/^0x/, ""), "hex"), pccsUrl);
    const d = v?.report?.data ?? {};
    if (v?.report?.type !== "td10") return { ok: false, error: `not a TD report (${v?.report?.type})` };
    const h = (x) => (x ? Buffer.from(x).toString("hex") : null);
    return { ok: true, status: v.status, advisory_ids: v.advisory_ids ?? [], report_data: h(d.reportData), mr_config_id: h(d.mrConfigId), rt_mr3: h(d.rtMr3) };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

/**
 * Runs verifyQuote on every signer of a checked attestation and keeps only those whose quote verifies and whose
 * verified report_data is the one we expect. Mutates and returns `att` (each signer gains `tcb_status`).
 */
export async function verifySignerQuotes(att, verify = verifyQuote) {
  if (!att?.ok) return att;
  const kept = [];
  for (const s of att.signers) {
    const q = await verify(s.quote);
    if (q.ok && q.report_data === expectedReportData(s.address, att.nonce)) kept.push({ ...s, tcb_status: q.status, advisory_ids: q.advisory_ids ?? [] });
    else att.rejected.push({ address: s.address, model_name: s.model_name, why: [q.ok ? "the verified quote's report_data differs" : `quote did not verify: ${q.error}`] });
  }
  att.signers = kept;
  att.quotes_verified = true;
  att.ok = kept.length > 0;
  if (!att.ok) att.reason = `no model quote verified: ${att.rejected.map((r) => r.why.join(", ")).join("; ")}`.slice(0, 300);
  return att;
}

/**
 * Verdict for one answer. `signature` is the body of GET /v1/signature/{chat_id}; `requestBody`/`responseBody` are the
 * exact strings sent and received; `model` is the model we asked for; `attestation` is from checkAttestation() (and
 * verifySignerQuotes()). Fails closed: no attestation, a failed one, or any check missing means ok is false.
 */
export function verifyAnswer({ signature, requestBody, responseBody, model, attestation }) {
  const requestSha = sha256Hex(requestBody ?? "");
  const responseSha = sha256Hex(responseBody ?? "");
  const base = { ok: false, request_sha256: requestSha, response_sha256: responseSha, attestation_sha256: attestation?.sha256 ?? null, nonce: attestation?.nonce ?? null, model };
  if (!signature?.text || !signature?.signature) return { ...base, reason: "no signature" };
  const signingAddress = lower(signature.signing_address);
  const text = String(signature.text);
  const parts = text.split(":");
  let askedModel = null;
  try {
    askedModel = JSON.parse(requestBody).model ?? null;
  } catch {
    /* not JSON: the check below fails */
  }
  const checks = {
    kindOk: signature.signature_kind === "provider_tee",
    algoOk: lower(signature.signing_algo ?? "ecdsa") === "ecdsa",
    modelOk: parts.length === 3 && parts[0] === model && askedModel === model,
    requestHashOk: parts.length === 3 && parts[1] === requestSha,
    responseHashOk: parts.length === 3 && parts[2] === responseSha,
  };
  const recovered = recoverPersonal(text, signature.signature);
  checks.sigOk = !!recovered && lower(recovered) === signingAddress;
  const matches = attestation?.ok ? attestation.signers.filter((s) => s.address === signingAddress && s.algo === "ecdsa") : [];
  checks.attested = matches.length === 1;
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  let reason = null;
  if (!attestation) reason = "no attestation report";
  else if (!attestation.ok) reason = `attestation failed: ${attestation.reason}`;
  else if (failed.length) reason = `failed: ${failed.join(", ")}`;
  return {
    ...base,
    ok: !reason,
    reason,
    recovered,
    signingAddress,
    ...checks,
    tcb_status: matches[0]?.tcb_status ?? null,
    quote_verified: !!attestation?.quotes_verified && checks.attested,
  };
}
