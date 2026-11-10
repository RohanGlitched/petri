// The darkroom door, tested with a real NEP-413 signature: sign the message with an account's key from the keychain
// (PETRI_KEYS_DIR) and post it to /api/living/gate. The holder gets in; anyone else, and a tampered message, do not.
//   node darkroom-test.mjs <account> <token> <site base url>
import fs from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
const [acct, token, base] = process.argv.slice(2);
const { private_key, public_key } = JSON.parse(fs.readFileSync(`${process.env.PETRI_KEYS_DIR}/${acct}.json`, "utf8"));
const kp = KeyPair.fromString(private_key);
const issued = new Date().toISOString();
const message = `Open the darkroom of living slide #${token} on NEAR testnet. Issued ${issued}.`;
const nonce = randomBytes(32);
const recipient = new URL(base).host;
const str = (s) => { const b = Buffer.from(s); const l = Buffer.alloc(4); l.writeUInt32LE(b.length); return [l, b]; };
const tag = Buffer.alloc(4); tag.writeUInt32LE(2 ** 31 + 413);
const hash = createHash("sha256").update(Buffer.concat([tag, ...str(message), nonce, ...str(recipient), Buffer.from([0])])).digest();
const sig = kp.sign(hash).signature;
const body = { net: "testnet", token, accountId: acct, publicKey: public_key, signature: Buffer.from(sig).toString("base64"), issued, nonce: nonce.toString("base64"), recipient };
const r = await fetch(`${base}/api/living/gate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
console.log(acct, r.status, await r.text());
// A tampered message must fail.
const bad = { ...body, token: token === "1" ? "2" : "1" };
const r2 = await fetch(`${base}/api/living/gate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bad) });
console.log("tampered", r2.status, await r2.text());
