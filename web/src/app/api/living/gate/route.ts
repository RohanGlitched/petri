// The darkroom's door: a living slide's holder proves it holds the slide now with a NEP-413 signed message.
//
// Checked here, on the server, before the darkroom opens:
//   1. the message is the one the page asked for, for this slide and network, issued in the last five minutes, to this
//      site, with a 32-byte nonce;
//   2. the ed25519 signature is valid over NEP-413's payload (sha256 of the borsh-encoded tag 2^31 + 413, message,
//      nonce, recipient, no callback URL);
//   3. the public key is a full-access key of the account, read from NEAR now;
//   4. the account is the purse's holder, read from NEAR now.
// Read-only: view calls and nothing else. Nothing is stored.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { Network } from "@/lib/config";
import { rpcCall } from "@/lib/rpc";
import { darkroomMessage, dishView, isLiving, viewOn, type PurseInfo } from "@/lib/living";

export const dynamic = "force-dynamic";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) {
    const i = B58.indexOf(c);
    if (i < 0) throw new Error("bad base58");
    n = n * 58n + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 255n));
    n >>= 8n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return new Uint8Array(bytes);
}

function b64(s: string): Uint8Array {
  return Uint8Array.from(Buffer.from(s, "base64"));
}

/** NEP-413's payload hash: sha256(borsh(u32 tag) ++ borsh({ message, nonce, recipient, callbackUrl: None })). */
function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const enc = new TextEncoder();
  const str = (v: string) => {
    const b = enc.encode(v);
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, b.length, true);
    return [len, b];
  };
  const tag = new Uint8Array(4);
  new DataView(tag.buffer).setUint32(0, 2 ** 31 + 413, true);
  const parts = [tag, ...str(message), nonce, ...str(recipient), new Uint8Array([0])];
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return sha256(all);
}

async function keyPermission(net: Network, account: string, publicKey: string): Promise<unknown> {
  try {
    const r = await rpcCall<{ permission?: unknown }>(net, "query", { request_type: "view_access_key", finality: "optimistic", account_id: account, public_key: publicKey }, { id: "gate", timeoutMs: 6000 });
    return r.permission ?? null;
  } catch {
    return null;
  }
}

const no = (why: string, status = 403) => Response.json({ ok: false, why }, { status });

export async function POST(req: Request) {
  let b: { net?: string; token?: string; accountId?: string; publicKey?: string; signature?: string; issued?: string; nonce?: string; recipient?: string };
  try {
    b = await req.json();
  } catch {
    return no("send JSON", 400);
  }
  const net: Network = b.net === "mainnet" ? "mainnet" : "testnet";
  const { token, accountId, publicKey, signature, issued, nonce, recipient } = b;
  if (!token || !/^[1-9]\d{0,9}$/.test(token) || !accountId || !publicKey?.startsWith("ed25519:") || !signature || !issued || !nonce || !recipient) return no("incomplete proof", 400);
  // The slide's purse is its owner on the dish, under whichever parent sealed it.
  const slide = await dishView<{ owner_id: string } | null>(net, "slide", { token_id: token }).catch(() => null);
  const purse = slide && isLiving(token, slide.owner_id, net) ? slide.owner_id : null;
  if (!purse) return no(`slide #${token} is not a living slide on ${net}`, 404);
  const at = Date.parse(issued);
  if (!isFinite(at) || Math.abs(Date.now() - at) > 5 * 60_000) return no("the signed message is older than five minutes: sign a fresh one");
  const host = new URL(req.url).host;
  if (recipient !== host && recipient !== "playpetri.xyz" && recipient !== "www.playpetri.xyz") return no("the message was signed for another site");
  const n = b64(nonce);
  if (n.length !== 32) return no("the nonce must be 32 bytes", 400);
  let valid = false;
  try {
    valid = ed25519.verify(b64(signature), nep413Hash(darkroomMessage(token, net, issued), n, recipient), b58decode(publicKey.slice(8)));
  } catch {
    valid = false;
  }
  if (!valid) return no("the signature does not match the message and key");
  const [permission, info] = await Promise.all([keyPermission(net, accountId, publicKey), viewOn<PurseInfo>(net, purse, "purse").catch(() => null)]);
  if (permission !== "FullAccess") return no("that key is not a full-access key of the account");
  if (!info) return no("the purse did not answer", 502);
  if (info.holder !== accountId) return no(`${accountId} does not hold living slide #${token}: ${info.holder} does`);
  return Response.json({ ok: true, token, holder: accountId, purse, checkedAt: new Date().toISOString(), nonce: info.nonce });
}
