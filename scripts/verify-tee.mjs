// Checks, from public data only, that a strain's planting was chosen by a NEAR AI Cloud model running in a TEE.
//
//   node scripts/verify-tee.mjs <tx hash>                    finds the network and the signer (house strains) itself
//   node scripts/verify-tee.mjs <tx hash> --net mainnet      or testnet
//   node scripts/verify-tee.mjs <tx hash> --account <id>     the signer (needed for a spawned strain's move)
//   node scripts/verify-tee.mjs <tx hash> --source <name>    proxy | vm | snapshot | <url>: where the archived bytes come from
//   node scripts/verify-tee.mjs move.json                    a move entry saved from the log (it names its tx and account)
//   node scripts/verify-tee.mjs latest --net mainnet         the newest tagged move in the strains' log (the site's
//                                                            /api/strains, then the VM's log window): what CI checks nightly
//   options: --no-dcap (skip the Intel quote checks: every check that needs them then FAILS), --pccs intel, --json
//
// Transactions are read from FastNEAR, then its archival node (a plain node forgets transactions after a few days), then dRPC.
// Run it from the repo with the agents' packages installed (cd agents && npm ci). It needs no keys and no access to the
// team's machine. The archived answer and attestation report are read from, in order: the site's HTTPS proxy
// (https://www.playpetri.xyz/api/tee/<hash> and /api/tee/attestation/<sha256>), the runner's own log window on the VM,
// and the snapshot committed in proofs/tee/ (pinned example moves). The bytes are checked by hash, so where they come
// from does not matter: a source can withhold them, never alter them unnoticed.
//
// What it checks (every line must PASS; a binding that cannot be checked FAILS, it is never skipped):
//   1. The transaction: a successful `plant` on the dish, its cells, its note, its block time, read from a NEAR RPC node.
//   2. The note ends with " · tee:<16 hex>", the start of the SHA-256 of the model's exact response body, and the
//      dish's own `plants` view holds that tag exactly once, on a planting with the transaction's cells.
//   3. The archived answer: the stored request and response bodies hash to what the record names, and the response
//      hash starts with the tag.
//   4. The signature: its text is "<model>:<sha256 request>:<sha256 response>" for the model asked in the request,
//      signature_kind is provider_tee, and the EIP-191 signer recovered from it is the signing address it names.
//   5. The attestation report: its SHA-256 is the one the record names; it echoes the runner's nonce; exactly one model
//      attestation for that model names the signer; the TDX quote's report_data is <signer><12 zero bytes><nonce>; the
//      quote verifies against Intel's collateral (dcap-qvl); RTMR3 and MRCONFIGID match the report's event log and app
//      compose. The machine: not a debug TD, TCB UpToDate or SWHardeningNeeded, MRTD and RTMR0-2 and the
//      os_image_hash equal to a pinned dstack-nvidia image (agents/tee.mjs PINNED_IMAGES). The compose manager's own
//      quote: same TD, bound to the same nonce and to the hash of its action log, whose latest compose_up is a
//      production GLM compose file (printed with its file_sha256).
//   6. The choice, from the signed request alone (nothing the house logged): the answer picks option N; option N in
//      the signed user message ends with "cells:<12 hex>", and the SHA-256 of the transaction's cells starts with it.
//   7. Freshness: the response's `created` time is within 180 s of the block that holds the transaction, and the
//      generation in the signed prompt is within 3 of the generation the dish recorded for the planting.
//   The lab note on chain is the model's note after the guard, or one the rules wrote: printed, not a binding.
// What remains trusted is printed at the end (and in docs/TEE.md).

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkAttestation, checkComposeManager, checkMachine, expectedReportData, PINNED_IMAGES, quoteReportData, recoverPersonal, sha256Hex, verifyQuote } from "../agents/tee.mjs";
import { cellsHash, parseOption, promptGeneration, teeTagOf, TEE_TAG_RE, userMessage } from "../agents/notes.mjs";
import { safeNote } from "../agents/swarm/guard.mjs";
import { trimNote } from "../agents/model.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(here, "..", "proofs", "tee");
const PROXY = "https://www.playpetri.xyz/api/tee";
const HOUSE = ["violet", "safranin", "methylene", "malachite", "congo"];
const NETS = {
  testnet: { rpcs: ["https://rpc.testnet.fastnear.com", "https://archival-rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"], contract: "petri-v6.testnet", vm: "http://136.64.100.170:8790", house: [...HOUSE.map((s) => `petri-${s}.testnet`), "petri-bench-a.testnet", "petri-strains.testnet"] },
  mainnet: { rpcs: ["https://rpc.mainnet.fastnear.com", "https://archival-rpc.mainnet.fastnear.com", "https://near.drpc.org"], contract: "petri-dish.near", vm: "http://136.64.100.170:8791", house: HOUSE.map((s) => `${s}.petri-dish.near`) },
};
const MAX_SKEW_S = 180;
const MAX_GEN_GAP = 3;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const flag = (name) => args.includes(`--${name}`);
const VALUED = new Set(["--net", "--log", "--account", "--pccs", "--source"]);
const target = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
if (!target) {
  console.error("usage: node scripts/verify-tee.mjs <tx hash | move.json> [--net testnet|mainnet] [--account <signer>] [--source proxy|vm|snapshot|<url>] [--no-dcap] [--pccs intel] [--json]");
  process.exit(2);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: ok === true ? true : ok === false ? false : null, detail });
  return ok === true;
};
const info = (name, detail) => check(name, null, detail);

async function fetchOk(url, asText) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return asText ? r.text() : r.json();
}
let NET = null;
async function rpcOn(url, method, params) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "verify-tee", method, params }), signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (j.error) throw Object.assign(new Error(JSON.stringify(j.error).slice(0, 300)), { rpcError: j.error });
  return j.result;
}
async function rpc(method, params, net = NET) {
  let last;
  for (const url of net.rpcs) {
    try {
      return await rpcOn(url, method, params);
    } catch (e) {
      // A node that does not know the transaction may only have forgotten it: the archival node is asked next.
      last = e;
    }
  }
  throw last;
}
async function viewDish(method, argsObj) {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: NET.contract, method_name: method, args_base64: Buffer.from(JSON.stringify(argsObj)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString("utf8"));
}

/** The committed snapshot: proofs/tee/moves.json (pinned moves), tee/<response sha256>.json, attestation/<sha256>.json. */
function snapshotMoves() {
  try {
    return JSON.parse(fs.readFileSync(path.join(SNAPSHOT, "moves.json"), "utf8"));
  } catch {
    return [];
  }
}
function snapshotFile(sub, prefix) {
  try {
    const dir = path.join(SNAPSHOT, sub);
    const f = fs.readdirSync(dir).find((n) => n.endsWith(".json") && n.startsWith(prefix));
    return f ? fs.readFileSync(path.join(dir, f), "utf8") : null;
  } catch {
    return null;
  }
}

/** Where archived bytes are read from, in order; --source picks one. */
function sources() {
  const want = opt("source") ?? opt("log");
  const all = [
    { name: "proxy", get: (kind, key) => fetchOk(kind === "tee" ? `${PROXY}/${key}` : `${PROXY}/attestation/${key}`, true) },
    { name: "vm", get: (kind, key) => fetchOk(`${NET.vm}/${kind}/${key}`, true) },
    { name: "snapshot", get: async (kind, key) => snapshotFile(kind, key) ?? Promise.reject(new Error(`not in ${path.relative(process.cwd(), SNAPSHOT) || SNAPSHOT}`)) },
  ];
  if (!want) return all;
  const named = all.find((s) => s.name === want);
  if (named) return [named];
  const base = want.replace(/\/$/, "");
  return [{ name: base, get: (kind, key) => fetchOk(`${base}/${kind}/${key}`, true) }];
}
async function archived(kind, key) {
  const errs = [];
  for (const s of sources()) {
    try {
      const text = await s.get(kind, key);
      if (text) return { text, from: s.name };
    } catch (e) {
      errs.push(`${s.name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 90)}`);
    }
  }
  return { text: null, errs };
}

/** The transaction, its network and its signer: from the flags, a saved move, the snapshot index, the VM log or by trying the house strains. */
async function findTx(tx, hint) {
  const nets = opt("net") ? [opt("net")] : hint?.net ? [hint.net] : hint?.account?.endsWith(".near") ? ["mainnet"] : hint?.account?.endsWith(".testnet") ? ["testnet"] : ["mainnet", "testnet"];
  for (const n of nets) {
    const net = NETS[n];
    if (!net) throw new Error("--net is testnet or mainnet");
    // The sender only routes the lookup to a shard; the signer is read from the transaction. A lookup that does not
    // wait (NONE) answers at once when the transaction is not on this network; a found one is read again when final.
    const accounts = hint?.account ? [hint.account] : net.house;
    for (const a of accounts) {
      try {
        const seen = await rpc("tx", { tx_hash: tx, sender_account_id: a, wait_until: "NONE" }, net);
        const t = seen?.transaction_outcome && seen.final_execution_status === "FINAL" ? seen : await rpc("tx", { tx_hash: tx, sender_account_id: a, wait_until: "FINAL" }, net);
        return { t, net: n, account: t.transaction.signer_id };
      } catch (e) {
        if (!e.rpcError) throw e;
      }
    }
  }
  return null;
}

/** RTMR3 replayed from the event log: SHA-384 chain over each IMR 3 event's digest (dstack's event digest rule). */
function replayRtmr3(events) {
  let mr = Buffer.alloc(48);
  for (const e of events.filter((x) => Number(x.imr) === 3)) {
    const type = Buffer.alloc(4);
    type.writeUInt32LE(Number(e.event_type) >>> 0);
    const computed = crypto.createHash("sha384").update(Buffer.concat([type, Buffer.from(":"), Buffer.from(String(e.event ?? ""), "utf8"), Buffer.from(":"), Buffer.from(String(e.event_payload ?? ""), "hex")])).digest();
    if (e.digest && e.digest !== computed.toString("hex")) return { ok: false, why: `event ${e.event} digest differs` };
    mr = crypto.createHash("sha384").update(Buffer.concat([mr, computed])).digest();
  }
  return { ok: true, rtmr3: mr.toString("hex") };
}

/** Every planting on the dish whose note carries `tag` (the `plants` view, paged). */
async function plantsWithTag(tag) {
  const st = await viewDish("state", {});
  const total = Number(st.plants ?? 0);
  const found = [];
  for (let from = 0; from < total; from += 200) {
    for (const p of await viewDish("plants", { from, limit: 200 })) if (teeTagOf(p.note) === tag) found.push(p);
  }
  return { total, found };
}

async function main() {
  // The move: from a saved entry, the snapshot's index, or the VM's log window (only for the signer's name).
  let move = null;
  let tx = target;
  if (fs.existsSync(target)) {
    move = JSON.parse(fs.readFileSync(target, "utf8"));
    tx = move.tx;
  }
  if (target === "latest") {
    const net = opt("net");
    if (!NETS[net]) throw new Error("latest needs --net mainnet or --net testnet");
    let log = null;
    for (const url of [`https://www.playpetri.xyz/api/strains?net=${net}`, `${NETS[net].vm}/`]) {
      log = await fetchOk(url).catch(() => null);
      if (log?.actions?.length) break;
    }
    const newest = (log?.actions ?? []).filter((a) => a.tx && a.contract === NETS[net].contract && teeTagOf(a.note)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    if (!check("the strains' log names a tagged move", !!newest, newest ? `${newest.strain}, ${newest.at}, tx ${newest.tx}` : "no tagged move in the log (the site's /api/strains and the VM's log window)")) return;
    move = newest;
    tx = newest.tx;
  }
  const pinned = snapshotMoves().find((m) => m.tx === tx) ?? null;
  const hint = { account: opt("account") ?? move?.account ?? pinned?.account ?? null, net: opt("net") ?? pinned?.net ?? null };
  const found = await findTx(tx, hint);
  if (!check("transaction found on chain", !!found, found ? `${found.net}, signed by ${found.account}` : `not found as a transaction by ${hint.account ?? "any house strain"} on ${hint.net ?? "mainnet or testnet"}: pass --account <signer> (and --net); a non-archival RPC node also forgets transactions after a few days`)) return;
  NET = NETS[found.net];
  const t = found.t;

  // 1. The transaction.
  const call = t.transaction.actions.map((a) => a.FunctionCall).find(Boolean);
  const failed = t.status?.Failure ?? t.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  check("transaction is a successful plant on the dish", !failed && call?.method_name === "plant" && t.transaction.receiver_id === NET.contract, `${t.transaction.signer_id} → ${t.transaction.receiver_id}.${call?.method_name}`);
  if (call?.method_name !== "plant") return;
  const planted = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  const cells = planted.cells.map(Number);
  const note = String(planted.note ?? "");
  const block = await rpc("block", { block_id: t.transaction_outcome.block_hash });
  const blockS = Number(BigInt(block.header.timestamp) / 1_000_000_000n);
  console.log(`tx ${tx} (${found.net}, block ${block.header.height}, ${new Date(blockS * 1000).toISOString()})\n  ${cells.length} cells; note on chain: ${JSON.stringify(note)}`);

  // 2. The tag, and the dish's own record of it.
  const tag = teeTagOf(note);
  if (!check("note carries a tee tag", !!tag, tag ? `tee:${tag}` : "no \" · tee:<16 hex>\" at the end: this planting was not chosen by a NEAR AI answer the runner archived")) return;
  const { total, found: tagged } = await plantsWithTag(tag);
  const plant = tagged[0] ?? null;
  check("the dish's plants view holds this tag exactly once, on a planting of these cells", tagged.length === 1 && JSON.stringify(plant.cells.map(Number)) === JSON.stringify(cells), `${tagged.length} of ${total} plantings carry tee:${tag}${plant ? `; planting ${plant.index} at generation ${plant.generation}, colony ${plant.colony}` : ""}`);

  // 3. The archived answer.
  const recSrc = await archived("tee", tag);
  if (!check("archived answer found", !!recSrc.text, recSrc.text ? `from ${recSrc.from}` : `no source had /tee/${tag} (${recSrc.errs.join("; ")}): the signature, the attestation and the choice cannot be checked, so they FAIL below`)) {
    for (const n of ["signature is the model enclave's", "attestation binds the signer to a verified TDX quote", "option N in the signed prompt names these cells", "response time matches the block", "prompt generation matches the planting"]) check(n, false, "no archived answer");
    return;
  }
  const rec = JSON.parse(recSrc.text);
  const reqSha = sha256Hex(rec.request_body);
  const resSha = sha256Hex(rec.response_body);
  check("request body hashes to the recorded sha256", reqSha === rec.request_sha256, reqSha);
  check("response body hashes to the recorded sha256, which the note's tag starts", resSha === rec.response_sha256 && resSha.startsWith(tag), resSha);

  // 4. The signature.
  const sig = rec.signature ?? {};
  let asked = null;
  try {
    asked = JSON.parse(rec.request_body).model;
  } catch {
    /* fails below */
  }
  check("signature is the model enclave's (provider_tee, ecdsa)", sig.signature_kind === "provider_tee" && String(sig.signing_algo ?? "ecdsa").toLowerCase() === "ecdsa", `${sig.signature_kind}, ${sig.signing_algo}`);
  check("signed text is <model asked>:<sha256 request>:<sha256 response>", sig.text === `${asked}:${reqSha}:${resSha}` && asked === rec.model, String(sig.text).slice(0, 90));
  const recovered = recoverPersonal(String(sig.text), String(sig.signature));
  const address = String(sig.signing_address ?? "").toLowerCase();
  check("EIP-191 signer recovered from the signature is the signing address", !!recovered && recovered === address, `${recovered}`);

  // 5. The attestation.
  const attSrc = await archived("attestation", rec.attestation_sha256);
  if (!check("attestation report found", !!attSrc.text, attSrc.text ? `from ${attSrc.from}` : `no source had it (${attSrc.errs?.join("; ")})`)) check("attestation binds the signer to a verified TDX quote", false, "no report");
  else {
    const attText = attSrc.text;
    check("attestation report hashes to the recorded sha256", sha256Hex(attText) === rec.attestation_sha256, rec.attestation_sha256);
    const att = checkAttestation(attText, { nonce: rec.nonce, model: asked });
    const report = JSON.parse(attText);
    const named = att.signers.filter((s) => s.address === address);
    check("the report echoes the runner's nonce and one model attestation for that model names the signer, bound by the quote's report_data", att.ok && named.length === 1, named.length === 1 ? `nonce ${String(rec.nonce).slice(0, 16)}…, signer ${address}` : att.reason ?? "the signer is not named");
    const gw = report.gateway_attestation?.signing_address?.toLowerCase();
    check("the signer is not the gateway's address", address !== gw, `gateway ${gw}`);
    const entry = (report.model_attestations ?? []).find((a) => a.signing_address?.toLowerCase() === address && a.model_name === asked);
    if (!entry) check("attestation binds the signer to a verified TDX quote", false, "no model attestation for the signer");
    else {
      const tcb = typeof entry.info?.tcb_info === "string" ? JSON.parse(entry.info.tcb_info) : entry.info?.tcb_info;
      const rawEvents = typeof entry.event_log === "string" ? JSON.parse(entry.event_log) : entry.event_log ?? tcb?.event_log ?? [];
      const events = typeof rawEvents === "string" ? JSON.parse(rawEvents) : rawEvents;
      const replay = replayRtmr3(events);
      const composeHash = tcb?.app_compose != null ? sha256Hex(tcb.app_compose) : null;
      const osEvent = events.find((e) => Number(e.imr) === 3 && e.event === "os-image-hash");
      const osImage = osEvent ? Buffer.from(String(osEvent.event_payload ?? ""), "hex").toString("hex") : null;
      if (flag("no-dcap")) {
        const rd = quoteReportData(entry.intel_quote) === expectedReportData(address, rec.nonce);
        check("TDX quote verified against Intel's collateral", false, `skipped (--no-dcap): the quote, the machine and the compose manager are NOT verified; report_data read at its offset ${rd ? "binds signer and nonce" : "does NOT bind them"}`);
      } else {
        const pccs = opt("pccs") === "intel" ? "https://api.trustedservices.intel.com" : undefined;
        const q = await verifyQuote(entry.intel_quote, { pccsUrl: pccs });
        check("TDX quote verified against Intel's collateral (dcap-qvl)", q.ok, q.ok ? `TCB status ${q.status}${q.advisory_ids?.length ? `, advisories ${q.advisory_ids.join(", ")}` : ""}` : q.error);
        if (q.ok) {
          check("verified report_data = signer, 12 zero bytes, nonce", q.report_data === expectedReportData(address, rec.nonce));
          check("RTMR3 replayed from the event log equals the quote's", replay.ok && replay.rtmr3 === q.rt_mr3, replay.ok ? replay.rtmr3.slice(0, 24) + "…" : replay.why);
          check("MRCONFIGID = 01 ‖ sha256(app_compose) ‖ zeros", !!composeHash && q.mr_config_id === `01${composeHash}${"00".repeat(15)}`, composeHash ? `compose hash ${composeHash}` : "no app_compose in the report");
          const machine = checkMachine(q);
          for (const c of machine.checks) check(c.name, c.ok, c.detail);
          check("os_image_hash in the event log (bound by RTMR3) is the pinned image's", !!machine.image && osImage === machine.image.os_image_hash, `os_image_hash ${osImage ?? "not in the event log"}`);
          const cm = await checkComposeManager(entry.compose_manager_attestation, { nonce: rec.nonce, modelQuote: q, verify: (x) => verifyQuote(x, { pccsUrl: pccs }) });
          for (const c of cm.checks) check(c.name, c.ok, c.detail);
        }
      }
      info("enclave", `${entry.info?.app_name ?? "?"}, compose_hash ${tcb?.compose_hash ?? entry.info?.compose_hash ?? "?"}, os_image_hash ${tcb?.os_image_hash ?? entry.info?.os_image_hash ?? "?"}`);
    }
  }

  // 6. The choice, bound to the cells by the signed request alone.
  let answer = null;
  let created = null;
  try {
    const body = JSON.parse(rec.response_body);
    created = Number(body.created);
    const content = body.choices?.[0]?.message?.content ?? "";
    answer = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch {
    /* fails below */
  }
  const choice = Number(answer?.choice);
  check("the answer picks a numbered option", Number.isInteger(choice) && choice >= 1, `choice ${answer?.choice}`);
  const user = userMessage(rec.request_body);
  const opt_ = parseOption(user, choice);
  const sha = cellsHash(cells);
  check(
    "option N in the signed prompt names these cells: sha256(tx cells) starts with its cells: prefix",
    !!opt_?.prefix && opt_.count === 1 && sha.startsWith(opt_.prefix) && opt_.cells === cells.length,
    !opt_ ? `no line "${choice}. " in the signed user message` : !opt_.prefix ? `this prompt predates the cells fingerprints (round 10): option ${choice} reads "${opt_.line.slice(0, 80)}", so the choice cannot be bound to the cells from signed data` : `option ${choice}: cells:${opt_.prefix}, ${opt_.cells} cells; tx cells sha256 ${sha.slice(0, 16)}…, ${cells.length} cells`,
  );

  // 7. Freshness.
  check(`the response was created within ${MAX_SKEW_S} s of the transaction's block`, Number.isFinite(created) && Math.abs(created - blockS) <= MAX_SKEW_S, Number.isFinite(created) ? `created ${new Date(created * 1000).toISOString()}, block ${new Date(blockS * 1000).toISOString()} (${blockS - created} s)` : "no created time in the response");
  const gen = promptGeneration(user);
  check(`the prompt's generation is within ${MAX_GEN_GAP} of the planting's`, gen != null && plant != null && Math.abs(gen - Number(plant.generation)) <= MAX_GEN_GAP, `prompt generation ${gen ?? "?"}, dish recorded ${plant?.generation ?? "?"}`);

  // The log, if there is one, should agree; it is the house's own account and binds nothing.
  if (move?.options) info("the house log agrees", `log choice ${move.choice ?? "?"}${Number(move.choice) === choice ? " = " : " ≠ "}model choice ${choice}`);
  const bodyNote = note.replace(TEE_TAG_RE, "");
  const fromModel = [safeNote(trimNote(answer?.note)), safeNote(answer?.note)].filter(Boolean);
  info("lab note", fromModel.includes(bodyNote) ? `the model's note after the guard: ${JSON.stringify(bodyNote)}` : `written by the rules (the model's note was refused or replaced): model said ${JSON.stringify(String(answer?.note ?? "")).slice(0, 80)}`);
}

const TRUSTED = [
  "What remains trusted (not checked here):",
  "  - The menu: the house code (agents/strategies.mjs) builds the options the model chooses among; the signature proves",
  "    which option the model picked, not that the menu was a fair one.",
  "  - NEAR AI's KMS, which derives the enclave's signing key for its app, and NEAR AI's compose repository, whose file",
  "    the compose manager reports by path and sha256 (the file's contents are not published with the report).",
  "  - The NVIDIA GPU evidence (nvidia_payload): send it to NVIDIA's NRAS to check the GPUs; this script does not.",
  `  - The pinned image values (agents/tee.mjs): ${PINNED_IMAGES[0].source}; no published reference values were found.`,
  "  - Intel's collateral (fetched by dcap-qvl through Phala's PCCS, or Intel's with --pccs intel).",
];

main()
  .catch((e) => check("verification ran", false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    if (flag("json")) console.log(JSON.stringify({ results, trusted: TRUSTED.slice(1).join("\n") }, null, 1));
    else {
      for (const r of results) console.log(`${r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "----"}  ${r.name}${r.detail ? `\n        ${r.detail}` : ""}`);
      console.log(`\n${TRUSTED.join("\n")}`);
    }
    const failed = results.filter((r) => r.ok === false);
    console.log(failed.length ? `\nNOT VERIFIED: ${failed.length} check(s) failed.` : "\nVERIFIED: every check above passed (---- lines are informational).");
    process.exit(failed.length ? 1 : 0);
  });
