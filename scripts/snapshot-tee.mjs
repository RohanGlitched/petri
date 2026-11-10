// Pins an AI move's archived bytes into the repo, so scripts/verify-tee.mjs can check it with no access to the team's
// machine: proofs/tee/tee/<response sha256>.json (request, response, signature), proofs/tee/attestation/<sha256>.json
// (the attestation report) and an entry in proofs/tee/moves.json { net, tx, account, tag, note }.
//
//   node scripts/snapshot-tee.mjs <tx hash> --net mainnet|testnet [--from <log dir> | --log <url>] [--label <text>]
//
// --from reads a runner's own archive directory (<PETRI_LOG_DIR> with tee/ and attestation/); --log a log window
// (default: the VM's for that network, then the site's proxy). The bytes are stored exactly as archived: verify-tee
// re-hashes them, so a snapshot cannot vouch for anything the hashes do not.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { teeTagOf } from "../agents/notes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "proofs", "tee");
const NETS = {
  testnet: { rpc: "https://rpc.testnet.fastnear.com", vm: "http://136.64.100.170:8790" },
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com", vm: "http://136.64.100.170:8791" },
};
const args = process.argv.slice(2);
const opt = (n) => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : null);
const tx = args.find((a, i) => !a.startsWith("--") && !String(args[i - 1]).startsWith("--"));
const net = NETS[opt("net") ?? ""];
if (!tx || !net) {
  console.error("usage: node scripts/snapshot-tee.mjs <tx hash> --net mainnet|testnet [--from <log dir> | --log <url>] [--label <text>]");
  process.exit(2);
}

async function rpc(method, params) {
  const r = await fetch(net.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "snap", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
async function get(kind, key) {
  if (opt("from")) {
    const dir = path.join(opt("from"), kind);
    const f = fs.readdirSync(dir).find((n) => n.startsWith(key) && n.endsWith(".json"));
    if (!f) throw new Error(`${key} not in ${dir}`);
    return fs.readFileSync(path.join(dir, f), "utf8");
  }
  for (const base of [opt("log") ?? net.vm, "https://www.playpetri.xyz/api/tee"]) {
    const url = base.includes("/api/tee") ? (kind === "tee" ? `${base}/${key}` : `${base}/attestation/${key}`) : `${base}/${kind}/${key}`;
    const r = await fetch(url).catch(() => null);
    if (r?.ok) return r.text();
  }
  throw new Error(`${kind}/${key} not found`);
}

// Any sender routes the lookup on these providers; the signer is read from the transaction itself.
const t = await rpc("tx", { tx_hash: tx, sender_account_id: opt("account") ?? "near", wait_until: "FINAL" });
const call = t.transaction.actions.map((a) => a.FunctionCall).find(Boolean);
const note = String(JSON.parse(Buffer.from(call.args, "base64").toString("utf8")).note ?? "");
const tag = teeTagOf(note);
if (!tag) throw new Error("the note carries no tee tag");
const recText = await get("tee", tag);
const rec = JSON.parse(recText);
const attText = await get("attestation", rec.attestation_sha256);
for (const sub of ["tee", "attestation"]) fs.mkdirSync(path.join(OUT, sub), { recursive: true });
fs.writeFileSync(path.join(OUT, "tee", `${rec.response_sha256}.json`), recText);
fs.writeFileSync(path.join(OUT, "attestation", `${rec.attestation_sha256}.json`), attText);
const listFile = path.join(OUT, "moves.json");
const list = fs.existsSync(listFile) ? JSON.parse(fs.readFileSync(listFile, "utf8")) : [];
const entry = { net: opt("net"), tx, account: t.transaction.signer_id, tag, note, label: opt("label") ?? null, pinned: new Date().toISOString().slice(0, 10) };
fs.writeFileSync(listFile, JSON.stringify([...list.filter((m) => m.tx !== tx), entry], null, 1) + "\n");
console.log(`pinned ${tx} (${entry.net}, ${entry.account}): tee/${rec.response_sha256}.json, attestation/${rec.attestation_sha256}.json`);
