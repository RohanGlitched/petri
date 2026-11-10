// Checks a NEAR AI Cloud answer's TEE signature, so a move the strains say came from the enclave can be proven to.
//
// NEAR AI Cloud signs "<sha256(request body)>:<sha256(response body)>" with an ECDSA key generated inside the
// model's TEE, as an Ethereum personal message (EIP-191). The key's address is published in the attestation report,
// which carries the Intel TDX quote (and NVIDIA GPU evidence) binding that address to the enclave. We check three
// things per answer: the hashes are of exactly what we sent and received, the signature recovers to the signing
// address, and that address is one the attestation report names. The quote itself can be checked offline by anyone
// (the report is saved beside the log); we record its hash.
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";

const hex = (b) => bytesToHex(b);
export const sha256Hex = (s) => hex(sha256(typeof s === "string" ? utf8ToBytes(s) : s));

/** The Ethereum address that signed `text` as a personal message, or null. */
export function recoverPersonal(text, signatureHex) {
  try {
    const msg = utf8ToBytes(text);
    const digest = keccak_256(new Uint8Array([...utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`), ...msg]));
    const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
    if (sig.length !== 65) return null;
    let v = sig[64];
    if (v >= 27) v -= 27;
    const compact = sig.slice(0, 64);
    const recovered = secp256k1.Signature.fromBytes(new Uint8Array([v, ...compact]), "recovered").recoverPublicKey(digest);
    const pub = recovered.toBytes(false).slice(1);
    return "0x" + hex(keccak_256(pub).slice(-20));
  } catch {
    return null;
  }
}

/** Every signing address an attestation report names (gateway and model enclaves), lowercased. */
export function attestedAddresses(report) {
  const out = new Set();
  const walk = (o) => {
    if (!o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "signing_address" && typeof v === "string") out.add(v.toLowerCase());
      else if (typeof v === "object") walk(v);
    }
  };
  walk(report);
  return out;
}

/**
 * Verdict for one answer: { ok, recovered, signingAddress, requestHashOk, responseHashOk, attested }.
 * `signature` is the body of GET /v1/signature/{chat_id}; `requestBody`/`responseBody` are the exact strings sent and
 * received; `attested` is the set from attestedAddresses().
 */
export function verifyAnswer(signature, requestBody, responseBody, attested) {
  if (!signature?.text || !signature?.signature) return { ok: false, reason: "no signature" };
  const [reqHash, resHash] = String(signature.text).split(":");
  const recovered = recoverPersonal(signature.text, signature.signature);
  const signingAddress = String(signature.signing_address ?? "").toLowerCase();
  const requestHashOk = reqHash === sha256Hex(requestBody);
  const responseHashOk = resHash === sha256Hex(responseBody);
  const sigOk = !!recovered && recovered.toLowerCase() === signingAddress;
  const isAttested = attested ? attested.has(signingAddress) : null;
  return {
    ok: sigOk && requestHashOk && responseHashOk && isAttested !== false,
    recovered,
    signingAddress,
    requestHashOk,
    responseHashOk,
    sigOk,
    attested: isAttested,
  };
}
