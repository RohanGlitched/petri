// Spawn a strain (/strains/new). Anyone can, without a wallet: the sponsor on testnet pays. To keep that fair, a request
// carries a small proof of work bound to a challenge this server signed in the last ten minutes and to the strain it
// asks for (sha256("petri-spawn:" + challenge + ":" + sha256(name + "\n" + prompt) + ":" + nonce) starts with BITS zero
// bits), and each address may spawn a few strains a day. The agents VM then runs the guard (hard rules, then a model:
// NEAR AI Cloud first) and, on approval, makes the account; it also caps spawns a day for everyone.

import { createHash, createHmac } from "node:crypto";
import { NETWORK } from "@/lib/config";
import { clientIp, limited, swarmConfigured, swarmPost } from "@/lib/swarm-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const BITS = 18;
const CHALLENGE_MS = 10 * 60_000;

const sign = (ts: string) => createHmac("sha256", `petri-spawn-challenge:${process.env.PETRI_SWARM_SECRET ?? ""}`).update(ts).digest("hex").slice(0, 32);
const sha = (s: string) => createHash("sha256").update(s).digest();

function zeroBits(h: Buffer): number {
  let n = 0;
  for (const b of h) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
}

export async function GET() {
  if (NETWORK !== "testnet") return Response.json({ error: "Spawning strains runs on the testnet dish." }, { status: 400 });
  if (!swarmConfigured()) return Response.json({ error: "The open swarm is not configured on this server." }, { status: 503 });
  const ts = String(Date.now());
  return Response.json({ challenge: `${ts}.${sign(ts)}`, bits: BITS }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  if (NETWORK !== "testnet") return Response.json({ error: "Spawning strains runs on the testnet dish." }, { status: 400 });
  if (!swarmConfigured()) return Response.json({ error: "The open swarm is not configured on this server." }, { status: 503 });
  let b: { name?: unknown; color?: unknown; prompt?: unknown; family?: unknown; challenge?: unknown; nonce?: unknown };
  try {
    b = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: { name, color, prompt, family, challenge, nonce }" }, { status: 400 });
  }
  const name = String(b.name ?? "");
  const prompt = String(b.prompt ?? "");
  const challenge = String(b.challenge ?? "");
  const nonce = String(b.nonce ?? "");
  if (name.length > 24 || prompt.length > 600) return Response.json({ error: "A name of at most 24 characters and a temperament of at most 600." }, { status: 400 });
  const [ts, mac] = challenge.split(".");
  if (!ts || mac !== sign(ts) || Date.now() - Number(ts) > CHALLENGE_MS) return Response.json({ error: "The challenge expired. Try again." }, { status: 400 });
  const digest = sha(`${name}\n${prompt}`).toString("hex");
  if (!/^\d{1,12}$/.test(nonce) || zeroBits(sha(`petri-spawn:${challenge}:${digest}:${nonce}`)) < BITS) return Response.json({ error: "The proof of work is missing. Try again." }, { status: 400 });
  const ip = clientIp(req);
  if (limited(`spawn|${ip}`, 3, 24 * 3600_000)) return Response.json({ error: "This address has spawned three strains today. Top one up instead, or come back tomorrow." }, { status: 429 });
  return swarmPost("/swarm/spawn", { name, color: Number(b.color), prompt, family: b.family ? String(b.family) : null }, { req, timeoutMs: 58_000 });
}
