// NEP-413 signed messages: how an outside agent proves a sealed bid is its own without a transaction. The payload
// { message, nonce (32 bytes), recipient, callbackUrl } is Borsh-serialised after the tag 2^31 + 413, hashed with
// SHA-256 and signed with ed25519. Wallets implement it as signMessage; the SDK signs the same bytes with a raw key.
// The public key must be one of the account's access keys on chain: full access, or a function-call key for the dish.

import crypto from "node:crypto";
import { PublicKey, baseDecode } from "near-api-js";
import { rpc, CONTRACT } from "../lib.mjs";

const TAG = 2147484061;

const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const str = (s) => {
  const b = Buffer.from(s, "utf8");
  return Buffer.concat([u32(b.length), b]);
};

/** The SHA-256 a NEP-413 signature covers. */
export function nep413Hash({ message, nonce, recipient, callbackUrl = null }) {
  const n = Buffer.from(nonce);
  if (n.length !== 32) throw new Error("the nonce must be 32 bytes");
  const parts = [u32(TAG), str(message), n, str(recipient), callbackUrl == null ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(callbackUrl)])];
  return crypto.createHash("sha256").update(Buffer.concat(parts)).digest();
}

/** Signature bytes from base64 (what wallets return) or `ed25519:<base58>`. */
export function signatureBytes(sig) {
  const s = String(sig);
  if (s.startsWith("ed25519:")) return baseDecode(s.slice(8));
  return Buffer.from(s, "base64");
}

/**
 * Checks a signed message: the signature over the NEP-413 hash, and the key on chain for `accountId`. Returns
 * { ok, reason, permission }.
 */
export async function verifySigned({ accountId, publicKey, signature, message, nonce, recipient }) {
  let pk;
  try {
    pk = PublicKey.fromString(publicKey);
  } catch {
    return { ok: false, reason: "public_key must be ed25519:<base58>" };
  }
  let good = false;
  try {
    good = pk.verify(nep413Hash({ message, nonce, recipient }), signatureBytes(signature));
  } catch {
    good = false;
  }
  if (!good) return { ok: false, reason: "the signature does not match the message and key (NEP-413: tag 2147484061, message, 32-byte nonce, recipient)" };
  let key;
  try {
    key = await rpc("query", { request_type: "view_access_key", finality: "optimistic", account_id: accountId, public_key: publicKey });
  } catch {
    return { ok: false, reason: `${publicKey} is not an access key of ${accountId} on chain` };
  }
  const perm = key.permission;
  if (perm === "FullAccess") return { ok: true, permission: "full access" };
  if (perm?.FunctionCall?.receiver_id === CONTRACT) return { ok: true, permission: `function-call key for ${CONTRACT}` };
  return { ok: false, reason: `that key may only call ${perm?.FunctionCall?.receiver_id ?? "another contract"}; sign with a full-access key or a key for ${CONTRACT}` };
}
