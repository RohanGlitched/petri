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
    else out.signers.push({ address, algo: "ecdsa", model_name: a.model_name, quote: a.intel_quote, compose_manager: a.compose_manager_attestation ?? null });
  }
  out.ok = out.signers.length > 0;
  if (!out.ok) out.reason = `no model attestation passed: ${out.rejected.map((r) => r.why.join(", ")).join("; ")}`.slice(0, 300);
  return out;
}

/**
 * Verifies a TDX quote with Intel's collateral (Phala's dcap-qvl, pure JS; it fetches the collateral over HTTPS).
 * Returns { ok, status, advisory_ids, report_data, mr_config_id, td_attributes, debug, mr_td, rt_mr0..rt_mr3 } or
 * { ok: false, error }. `debug` is bit 0 of TDATTRIBUTES (TUD.DEBUG): a debug TD's memory is readable by the host.
 */
export async function verifyQuote(quoteHex, { pccsUrl } = {}) {
  try {
    const dcap = await import("@phala/dcap-qvl");
    const lib = dcap.default ?? dcap;
    const v = await lib.getCollateralAndVerify(Buffer.from(String(quoteHex).replace(/^0x/, ""), "hex"), pccsUrl);
    const d = v?.report?.data ?? {};
    if (v?.report?.type !== "td10") return { ok: false, error: `not a TD report (${v?.report?.type})` };
    const h = (x) => (x ? Buffer.from(x).toString("hex") : null);
    const attrs = d.tdAttributes ? Buffer.from(d.tdAttributes) : null;
    return {
      ok: true,
      status: v.status,
      advisory_ids: v.advisory_ids ?? [],
      report_data: h(d.reportData),
      mr_config_id: h(d.mrConfigId),
      td_attributes: h(d.tdAttributes),
      debug: attrs ? (attrs[0] & 1) === 1 : null,
      mr_td: h(d.mrTd),
      rt_mr0: h(d.rtMr0),
      rt_mr1: h(d.rtMr1),
      rt_mr2: h(d.rtMr2),
      rt_mr3: h(d.rtMr3),
    };
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) };
  }
}

/** TCB statuses accepted: the platform is patched (UpToDate), or only software hardening is advised. */
export const TCB_OK = ["UpToDate", "SWHardeningNeeded"];

/**
 * The machine NEAR AI's GLM enclave boots, pinned: MRTD (the TD firmware) and RTMR0-2 (firmware config, kernel and
 * command line, initramfs) of the dstack-nvidia OS image, and the os_image_hash the image extends into RTMR3.
 * No reference values for this image are published by NEAR AI or dstack that we could find (dstack's releases give
 * a reproduce script, not numbers for NEAR AI's nvidia builds), so these are PINNED FROM OBSERVATION on 2026-11-10:
 * identical in all 12 attestation reports the testnet and mainnet runners fetched that day, on two machines
 * (app_name dstack-nvidia-0.5.11 and dstack-nvidia-0.5.12, vm_config 64 vCPU, 2 TiB, 8 GPUs, ovmf pre202505).
 * A new image means new values: the checks then fail until a person reviews the new image and adds it here.
 */
export const PINNED_IMAGES = [
  {
    name: "dstack-nvidia-0.5.11 (vm_config image dstack-nvidia-0.5.12), 8 GPUs",
    source: "pinned from observation on 2026-11-10 (12 reports, 2 machines)",
    os_image_hash: "91fd5d69ccee3e5ea4f2aeb8c9b632c4358c4ecfc29ba1aa6fb1e402af209829",
    mr_td: "df4d77c857de652bd0fafa343a2026b51071ee03773d076d283abf1a7d36ff91ffa279ee4a617ac664f7e2a2c8d5891b",
    rt_mr0: "bc122d143ab768565ba5c3774ff5f03a63c89a4df7c1f5ea38d3bd173409d14f8cbdcc36d40e703cccb996a9d9687590",
    rt_mr1: "4ae609807c765916a31d724786ed74bcb97e168a9d937b04936aeef2015c907eba5ac352c6bcd749c246fd62ffb659ec",
    rt_mr2: "bd67ab7554dc27ab03a077bc1447a1a67d0624ff547c4c809a8626f12d6a89712f8ec60e781e99b98208574065d21a71",
  },
];

/**
 * The machine checks on a verified quote: not a debug TD, an accepted TCB status, and MRTD/RTMR0-2 equal to one pinned
 * image. Returns { ok, image, checks: [{ name, ok, detail }] }.
 */
export function checkMachine(q) {
  const checks = [];
  checks.push({ name: "TD is not a debug TD (TDATTRIBUTES bit 0 clear)", ok: q?.debug === false, detail: `td_attributes ${q?.td_attributes ?? "?"}` });
  checks.push({ name: `TCB status is ${TCB_OK.join(" or ")}`, ok: TCB_OK.includes(q?.status), detail: `${q?.status ?? "?"}${q?.advisory_ids?.length ? `, advisories ${q.advisory_ids.join(", ")}` : ""}` });
  const image = PINNED_IMAGES.find((p) => p.mr_td === q?.mr_td && p.rt_mr0 === q?.rt_mr0 && p.rt_mr1 === q?.rt_mr1 && p.rt_mr2 === q?.rt_mr2) ?? null;
  checks.push({ name: "MRTD and RTMR0-2 are a pinned OS image", ok: !!image, detail: image ? `${image.name}; ${image.source}` : `MRTD ${String(q?.mr_td).slice(0, 16)}…, RTMR0 ${String(q?.rt_mr0).slice(0, 16)}… match no pinned image` });
  return { ok: checks.every((c) => c.ok), image, checks };
}

/** JSON as Python's json.dumps(v, sort_keys=True, separators=(",", ":")) writes it (ensure_ascii on). */
export function pyCanonicalJson(v) {
  const str = (s) => JSON.stringify(s).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(pyCanonicalJson).join(",")}]`;
  if (typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${str(k)}:${pyCanonicalJson(v[k])}`).join(",")}}`;
  if (typeof v === "string") return str(v);
  return JSON.stringify(v);
}

// The compose files NEAR AI's compose manager may have last brought up on a machine serving GLM: production files
// (prod/, never experiments/) that start a glm53 service. Seen on 2026-11-10: prod/GLM-5.3-Flash-SGL-TP2x4-W4AFP8-
// V12Q8.yaml (sha256 e88b040e…) on one machine, prod/small-models.yaml (sha256 5cd125c7…) on the other.
const PROD_COMPOSE = /^prod\/[\w.-]+\.ya?ml$/;
const MAINTENANCE_COMPOSE = /^prod\/rotate-compose-manager-token\.ya?ml$/;

/**
 * The compose manager's own attestation, which NEAR AI adds to each model attestation: a log of every compose file it
 * brought up or down, hashed (actions_hash = sha256 of the actions as canonical JSON) into a second TDX quote whose
 * report_data is actions_hash ‖ our nonce. Checks the hash, the binding to our nonce, and (with `verify`) that the
 * quote verifies on the same TD as the model's quote (`modelQuote`, a verifyQuote() result). Then requires the latest
 * compose_up still running (a maintenance file brought up and down again is skipped) to be a production file that
 * starts a glm53 service. Returns { ok, latest, checks }.
 */
export async function checkComposeManager(cm, { nonce, modelQuote, verify = verifyQuote } = {}) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: !!ok, detail });
  if (!cm || !Array.isArray(cm.actions)) {
    add("the report carries the compose manager's attestation", false, "no compose_manager_attestation");
    return { ok: false, latest: null, checks };
  }
  const actionsHash = sha256Hex(pyCanonicalJson(cm.actions));
  add("actions_hash = sha256 of the compose manager's action log", actionsHash === lower(cm.actions_hash), `${cm.actions.length} actions, ${actionsHash.slice(0, 16)}…`);
  add("the compose manager's report_data = actions_hash ‖ our nonce", lower(cm.report_data) === actionsHash + lower(nonce) && lower(cm.nonce) === lower(nonce), `nonce ${String(cm.nonce).slice(0, 16)}…`);
  if (verify) {
    const q = await verify(cm.quote);
    add("the compose manager's TDX quote verifies (dcap-qvl)", q.ok, q.ok ? `TCB ${q.status}` : q.error);
    if (q.ok) {
      add("its verified report_data = actions_hash ‖ our nonce", q.report_data === actionsHash + lower(nonce));
      const same = modelQuote?.ok && ["mr_td", "rt_mr0", "rt_mr1", "rt_mr2", "rt_mr3"].every((k) => q[k] === modelQuote[k]);
      add("it comes from the same TD as the model's quote (MRTD, RTMR0-3 equal)", same, same ? "" : "measurements differ or the model quote was not verified");
    }
  }
  // The latest compose_up whose file was not brought down again after it, skipping maintenance files.
  const downAfter = new Set();
  let latest = null;
  for (let i = cm.actions.length - 1; i >= 0 && !latest; i--) {
    const a = cm.actions[i];
    if (a?.action === "compose_down") downAfter.add(a.file);
    else if (a?.action === "compose_up" && !(MAINTENANCE_COMPOSE.test(a.file) && downAfter.has(a.file))) latest = a;
  }
  const glm = !!latest && cm.actions.some((a) => a?.action === "compose_up" && a.file === latest.file && (a.services ?? []).some((s) => /glm53/i.test(s)));
  add(
    "the latest compose_up is a production GLM compose file",
    !!latest && PROD_COMPOSE.test(latest.file) && !MAINTENANCE_COMPOSE.test(latest.file) && glm,
    latest ? `${latest.file} (file_sha256 ${latest.file_sha256}, tag ${latest.tag}, commit ${String(latest.commit).slice(0, 12)}, ${latest.timestamp})` : "no compose_up in the log",
  );
  return { ok: checks.every((c) => c.ok), latest, checks };
}

/**
 * Runs verifyQuote on every signer of a checked attestation and keeps only those whose quote verifies, whose
 * verified report_data is the one we expect, and whose machine passes checkMachine() (no debug TD, an accepted TCB,
 * a pinned image). With composeManager, the signer's compose manager attestation must pass checkComposeManager() too.
 * Mutates and returns `att` (each signer gains `tcb_status`, and `compose` with composeManager).
 */
export async function verifySignerQuotes(att, verify = verifyQuote, { composeManager = false } = {}) {
  if (!att?.ok) return att;
  const kept = [];
  for (const s of att.signers) {
    const q = await verify(s.quote);
    const machine = q.ok ? checkMachine(q) : null;
    const cm = q.ok && machine.ok && composeManager ? await checkComposeManager(s.compose_manager, { nonce: att.nonce, modelQuote: q, verify }) : null;
    if (cm && !cm.ok) att.rejected.push({ address: s.address, model_name: s.model_name, why: [`compose manager: ${cm.checks.filter((c) => !c.ok).map((c) => `${c.name} (${c.detail})`).join(", ")}`] });
    else if (q.ok && q.report_data === expectedReportData(s.address, att.nonce) && machine.ok)
      kept.push({ ...s, tcb_status: q.status, advisory_ids: q.advisory_ids ?? [], image: machine.image?.name ?? null, compose: cm?.latest ? { file: cm.latest.file, file_sha256: cm.latest.file_sha256 } : null });
    else
      att.rejected.push({
        address: s.address,
        model_name: s.model_name,
        why: [!q.ok ? `quote did not verify: ${q.error}` : q.report_data !== expectedReportData(s.address, att.nonce) ? "the verified quote's report_data differs" : `machine: ${machine.checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`],
      });
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
