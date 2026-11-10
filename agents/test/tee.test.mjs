// node --test test/   (from agents/)
import test from "node:test";
import assert from "node:assert/strict";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { checkAttestation, expectedReportData, quoteReportData, recoverPersonal, sha256Hex, verifyAnswer, verifySignerQuotes } from "../tee.mjs";

const MODEL = "z-ai/glm-5.3-flash";

/** An enclave key: signs like NEAR AI Cloud (EIP-191 personal message, r ‖ s ‖ v). */
function enclave() {
  const sk = secp256k1.utils.randomSecretKey();
  const address = "0x" + bytesToHex(keccak_256(secp256k1.getPublicKey(sk, false).slice(1)).slice(-20));
  const sign = (text) => {
    const msg = utf8ToBytes(text);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
    const rec = secp256k1.sign(digest, sk, { prehash: false, format: "recovered" });
    return "0x" + bytesToHex(new Uint8Array([...rec.slice(1), rec[0] + 27]));
  };
  return { address, sign };
}

/** A TDX v4 quote shaped enough to carry report_data at its offset (the real one is checked by dcap-qvl). */
function quote(reportDataHex) {
  const q = new Uint8Array(1000);
  q[0] = 4;
  q[4] = 0x81;
  q.set(Buffer.from(reportDataHex, "hex"), 568);
  return bytesToHex(q);
}

function report({ nonce, signer, gateway, model = MODEL, echo = nonce, bind = nonce }) {
  return JSON.stringify({
    gateway_attestation: { signing_address: gateway.address, signing_algo: "ecdsa", request_nonce: echo, intel_quote: quote(expectedReportData(gateway.address, bind)) },
    model_attestations: [{ model_name: model, signing_address: signer.address, signing_algo: "ecdsa", request_nonce: echo, intel_quote: quote(expectedReportData(signer.address, bind)) }],
  });
}

function answer(signer, { model = MODEL, kind = "provider_tee" } = {}) {
  const requestBody = JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "1. a block (4 cells, 0.20 PETRI)" }] });
  const responseBody = JSON.stringify({ id: "chat-1", choices: [{ message: { content: '{"choice":1,"note":"A tidy block."}' } }] });
  const text = `${model}:${sha256Hex(requestBody)}:${sha256Hex(responseBody)}`;
  return { requestBody, responseBody, signature: { text, signature: signer.sign(text), signing_address: signer.address, signing_algo: "ecdsa", signature_kind: kind } };
}

const nonce = "ab".repeat(32);

test("recovers the EIP-191 signer", () => {
  const e = enclave();
  assert.equal(recoverPersonal("hello", e.sign("hello")), e.address);
  assert.notEqual(recoverPersonal("hello!", e.sign("hello")), e.address);
});

test("a good answer verifies", () => {
  const signer = enclave();
  const att = checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce, model: MODEL });
  assert.equal(att.ok, true, att.reason);
  const a = answer(signer);
  const v = verifyAnswer({ ...a, model: MODEL, attestation: att });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.response_sha256, sha256Hex(a.responseBody));
  assert.equal(v.attestation_sha256, att.sha256);
});

test("fails closed without an attestation (fetch failed)", () => {
  const signer = enclave();
  const a = answer(signer);
  for (const attestation of [null, undefined, { ok: false, reason: "attestation fetch failed: 503", signers: [] }]) {
    const v = verifyAnswer({ ...a, model: MODEL, attestation });
    assert.equal(v.ok, false);
  }
});

test("fails without a signature", () => {
  const signer = enclave();
  const att = checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce, model: MODEL });
  const a = answer(signer);
  assert.equal(verifyAnswer({ ...a, signature: null, model: MODEL, attestation: att }).ok, false);
});

test("a report that does not echo our nonce has no signer", () => {
  const signer = enclave();
  const other = "cd".repeat(32);
  assert.equal(checkAttestation(report({ nonce, signer, gateway: enclave(), echo: other }), { nonce, model: MODEL }).ok, false);
  // Echoed, but the quote binds another nonce (a replayed quote).
  assert.equal(checkAttestation(report({ nonce, signer, gateway: enclave(), bind: other }), { nonce, model: MODEL }).ok, false);
  // No nonce of our own at all.
  assert.equal(checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce: "", model: MODEL }).ok, false);
});

test("the wrong model fails: in the report and in the signed text", () => {
  const signer = enclave();
  assert.equal(checkAttestation(report({ nonce, signer, gateway: enclave(), model: "other/model" }), { nonce, model: MODEL }).ok, false);
  const att = checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce, model: MODEL });
  const v = verifyAnswer({ ...answer(signer, { model: "other/model" }), model: MODEL, attestation: att });
  assert.equal(v.ok, false);
  assert.equal(v.modelOk, false);
});

test("the gateway's address is never accepted for an answer", () => {
  const signer = enclave();
  const gateway = enclave();
  const att = checkAttestation(report({ nonce, signer, gateway }), { nonce, model: MODEL });
  const v = verifyAnswer({ ...answer(gateway), model: MODEL, attestation: att });
  assert.equal(v.ok, false);
  assert.equal(v.attested, false);
  // And a gateway-kind signature is refused even from the model's key.
  assert.equal(verifyAnswer({ ...answer(signer, { kind: "gateway" }), model: MODEL, attestation: att }).ok, false);
});

test("tampered bodies fail", () => {
  const signer = enclave();
  const att = checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce, model: MODEL });
  const a = answer(signer);
  assert.equal(verifyAnswer({ ...a, responseBody: a.responseBody.replace("chat-1", "chat-2"), model: MODEL, attestation: att }).ok, false);
  assert.equal(verifyAnswer({ ...a, requestBody: a.requestBody + " ", model: MODEL, attestation: att }).ok, false);
});

test("a signature by a key the report does not name fails", () => {
  const signer = enclave();
  const att = checkAttestation(report({ nonce, signer, gateway: enclave() }), { nonce, model: MODEL });
  assert.equal(verifyAnswer({ ...answer(enclave()), model: MODEL, attestation: att }).ok, false);
});

test("quote report_data is read at its offset; a failed quote check drops the signer", async () => {
  const signer = enclave();
  const text = report({ nonce, signer, gateway: enclave() });
  assert.equal(quoteReportData(JSON.parse(text).model_attestations[0].intel_quote), expectedReportData(signer.address, nonce));
  const att = checkAttestation(text, { nonce, model: MODEL });
  await verifySignerQuotes(att, async () => ({ ok: false, error: "collateral unavailable" }));
  assert.equal(att.ok, false);
  assert.equal(verifyAnswer({ ...answer(signer), model: MODEL, attestation: att }).ok, false);
  const good = checkAttestation(text, { nonce, model: MODEL });
  await verifySignerQuotes(good, async () => ({ ok: true, status: "UpToDate", report_data: expectedReportData(signer.address, nonce) }));
  const v = verifyAnswer({ ...answer(signer), model: MODEL, attestation: good });
  assert.equal(v.ok, true, v.reason);
  assert.equal(v.quote_verified, true);
  assert.equal(v.tcb_status, "UpToDate");
});
