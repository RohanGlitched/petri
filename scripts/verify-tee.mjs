// Checks, from public data only, that a strain's planting was chosen by a NEAR AI Cloud model running in a TEE.
//
//   node scripts/verify-tee.mjs <tx hash>                    a planting on the testnet dish (log window :8790)
//   node scripts/verify-tee.mjs <tx hash> --net mainnet      a planting on the mainnet dish (log window :8791)
//   node scripts/verify-tee.mjs <tx hash> --log <url>        another log window (the agents' read-only HTTP port)
//   node scripts/verify-tee.mjs <tx hash> --account <id>     the signer, when the move is older than the log keeps
//   node scripts/verify-tee.mjs move.json                    a move entry saved from the log (it names its tx)
//   options: --no-dcap (skip the Intel quote check), --pccs intel (Intel's PCS instead of Phala's PCCS), --json
//
// Run it from the repo with the agents' packages installed (cd agents && npm ci). It needs no keys. What it checks:
//   1. The transaction: a successful `plant` on the dish, its cells and its note, read from a NEAR RPC node.
//   2. The note ends with " · tee:<16 hex>": the start of the SHA-256 of the model's exact response body.
//   3. The archived answer (log window /tee/<prefix>): SHA-256 of the stored request and response bodies match the
//      hashes the record names, and the response hash starts with the note's 16 hex.
//   4. The signature: its text is "<model>:<sha256 request>:<sha256 response>" for the model asked in the request,
//      signature_kind is provider_tee, and the EIP-191 signer recovered from it is the signing address it names.
//   5. The attestation report (log window /attestation/<sha256>): its SHA-256 is the one the record names; it echoes
//      the runner's nonce; exactly one model attestation for that model names the signer; the TDX quote's
//      report_data is <signer><12 zero bytes><nonce>; the quote verifies against Intel's collateral (dcap-qvl), and
//      its RTMR3 and MRCONFIGID match the report's event log and app compose.
//   6. The choice: the model's answer picks option N; line N of the prompt it was sent is the option the log lists as
//      N, with as many cells as the transaction planted, and the SHA-256 of the transaction's cells is the one the log
//      recorded for option N. The note on chain is the model's note after the guard (or the rules' note if refused).
// Not checked here: the NVIDIA GPU evidence (nvidia_payload: send it to NVIDIA's NRAS, see NEAR AI's docs) and
// whether the measured image is one you trust (compare compose_hash and os_image_hash with NEAR AI's published builds).

import crypto from "node:crypto";
import fs from "node:fs";
import { checkAttestation, expectedReportData, quoteReportData, recoverPersonal, sha256Hex, verifyQuote } from "../agents/tee.mjs";
import { cellsHash, teeTagOf, TEE_TAG_RE } from "../agents/notes.mjs";
import { safeNote } from "../agents/swarm/guard.mjs";
import { trimNote } from "../agents/model.mjs";

const NETS = {
  testnet: { rpc: "https://rpc.testnet.fastnear.com", contract: "petri-v6.testnet", log: "http://136.64.100.170:8790" },
  mainnet: { rpc: "https://rpc.mainnet.fastnear.com", contract: "petri-dish.near", log: "http://136.64.100.170:8791" },
};

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};
const flag = (name) => args.includes(`--${name}`);
const VALUED = new Set(["--net", "--log", "--account", "--pccs"]);
const target = args.find((a, i) => !a.startsWith("--") && !VALUED.has(args[i - 1]));
if (!target) {
  console.error("usage: node scripts/verify-tee.mjs <tx hash | move.json> [--net testnet|mainnet] [--log <url>] [--account <signer>] [--no-dcap] [--pccs intel] [--json]");
  process.exit(2);
}
const netName = opt("net") ?? "testnet";
const NET = NETS[netName];
if (!NET) throw new Error(`--net is testnet or mainnet`);
const LOG = (opt("log") ?? NET.log).replace(/\/$/, "");

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: ok === true ? true : ok === false ? false : null, detail });
  return ok;
};

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.json();
}
async function getText(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  return r.text();
}
async function rpc(method, params) {
  const r = await fetch(NET.rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "verify-tee", method, params }), signal: AbortSignal.timeout(20_000) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 300));
  return j.result;
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

async function main() {
  // The move: from a saved entry, or found in the log window by its tx.
  let move = null;
  let tx = target;
  if (fs.existsSync(target)) {
    move = JSON.parse(fs.readFileSync(target, "utf8"));
    tx = move.tx;
  } else {
    const log = await getJson(`${LOG}/`).catch(() => null);
    move = log?.actions?.find((a) => a.tx === tx) ?? null;
  }
  const signer = opt("account") ?? move?.account;
  check("move found in the strains log", move ? true : null, move ? `${move.strain} at generation ${move.generation}, decided by ${move.decided_by} (${move.model ?? "rules"})` : `not in ${LOG}/ (the log keeps the latest 200); pass --account to check the chain and the archive only`);
  if (!signer) throw new Error("the signer is unknown: pass --account <id>");

  // 1. The transaction.
  const t = await rpc("tx", { tx_hash: tx, sender_account_id: signer, wait_until: "FINAL" });
  const call = t.transaction.actions.map((a) => a.FunctionCall).find(Boolean);
  const failed = t.status?.Failure ?? t.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  check("transaction is a successful plant on the dish", !failed && call?.method_name === "plant" && t.transaction.receiver_id === (move?.contract ?? NET.contract), `${t.transaction.signer_id} → ${t.transaction.receiver_id}.${call?.method_name}`);
  const planted = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  const cells = planted.cells.map(Number);
  const note = String(planted.note ?? "");
  console.log(`tx ${tx}\n  ${cells.length} cells; note on chain: ${JSON.stringify(note)}`);

  // 2. The tag.
  const tag = teeTagOf(note);
  if (!check("note carries a tee tag", !!tag, tag ? `tee:${tag}` : "no \" · tee:<16 hex>\" at the end: this planting was not chosen by a NEAR AI answer the runner archived")) return;

  // 3. The archived answer.
  const rec = await getJson(`${LOG}/tee/${tag}`);
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
  const attText = await getText(`${LOG}/attestation/${rec.attestation_sha256}`);
  check("attestation report hashes to the recorded sha256", sha256Hex(attText) === rec.attestation_sha256, rec.attestation_sha256);
  const att = checkAttestation(attText, { nonce: rec.nonce, model: asked });
  const report = JSON.parse(attText);
  const named = att.signers.filter((s) => s.address === address);
  check("the report echoes the runner's nonce and one model attestation for that model names the signer, bound by the quote's report_data", att.ok && named.length === 1, named.length === 1 ? `nonce ${rec.nonce.slice(0, 16)}…, signer ${address}` : att.reason ?? "the signer is not named");
  const gw = report.gateway_attestation?.signing_address?.toLowerCase();
  check("the signer is not the gateway's address", address !== gw, `gateway ${gw}`);
  const entry = (report.model_attestations ?? []).find((a) => a.signing_address?.toLowerCase() === address && a.model_name === asked);
  if (entry) {
    const tcb = typeof entry.info?.tcb_info === "string" ? JSON.parse(entry.info.tcb_info) : entry.info?.tcb_info;
    const events = typeof entry.event_log === "string" ? JSON.parse(entry.event_log) : entry.event_log ?? tcb?.event_log ?? [];
    const replay = replayRtmr3(typeof events === "string" ? JSON.parse(events) : events);
    const composeHash = tcb?.app_compose != null ? sha256Hex(tcb.app_compose) : null;
    if (flag("no-dcap")) {
      check("TDX quote verified against Intel's collateral", null, `skipped (--no-dcap); report_data read from the quote at its fixed offset: ${quoteReportData(entry.intel_quote) === expectedReportData(address, rec.nonce) ? "binds signer and nonce" : "does NOT bind them"}`);
    } else {
      let pccs;
      if (opt("pccs") === "intel") pccs = "https://api.trustedservices.intel.com";
      const q = await verifyQuote(entry.intel_quote, { pccsUrl: pccs });
      check("TDX quote verified against Intel's collateral (dcap-qvl)", q.ok, q.ok ? `TCB status ${q.status}${q.advisory_ids?.length ? `, advisories ${q.advisory_ids.join(", ")}` : ""}` : q.error);
      if (q.ok) {
        check("verified report_data = signer, 12 zero bytes, nonce", q.report_data === expectedReportData(address, rec.nonce));
        check("RTMR3 replayed from the event log equals the quote's", replay.ok && replay.rtmr3 === q.rt_mr3, replay.ok ? replay.rtmr3.slice(0, 24) + "…" : replay.why);
        check("MRCONFIGID = 01 ‖ sha256(app_compose) ‖ zeros", !!composeHash && q.mr_config_id === `01${composeHash}${"00".repeat(15)}`, composeHash ? `compose hash ${composeHash}` : "no app_compose in the report");
      }
    }
    console.log(`  enclave: ${entry.info?.app_name ?? "?"}, compose_hash ${tcb?.compose_hash ?? entry.info?.compose_hash ?? "?"}, os_image_hash ${tcb?.os_image_hash ?? entry.info?.os_image_hash ?? "?"}`);
  }

  // 6. The choice.
  let answer = null;
  try {
    const content = JSON.parse(rec.response_body).choices?.[0]?.message?.content ?? "";
    answer = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch {
    /* fails below */
  }
  const choice = Number(answer?.choice);
  check("the answer picks a numbered option", Number.isInteger(choice) && choice >= 1, `choice ${answer?.choice}`);
  const prompt = (() => {
    try {
      return JSON.parse(rec.request_body).messages.map((m) => m.content).join("\n");
    } catch {
      return "";
    }
  })();
  const line = prompt.split("\n").find((l) => l.startsWith(`${choice}. `)) ?? "";
  const m = line.match(/^\d+\. (?:\[PACT\] )?(.*) \((\d+) cells, /);
  check("option N in the prompt has as many cells as the transaction planted", !!m && Number(m[2]) === cells.length, line.slice(0, 110));
  if (move) {
    check("the log's option N is the prompt's option N", !!m && move.options?.[choice - 1] === m[1], move.options?.[choice - 1] ?? "no options in the log entry");
    check("the log says the model chose option N", Number(move.choice) === choice, `log choice ${move.choice ?? "(not recorded)"}`);
    const want = move.option_cells_sha256?.[choice - 1];
    check("sha256 of the planted cells is the log's hash for option N", want ? want === cellsHash(cells) : null, want ? cellsHash(cells) : "this entry predates option hashes");
  }
  const body = note.replace(TEE_TAG_RE, "");
  const fromModel = [safeNote(trimNote(answer?.note)), safeNote(answer?.note)].filter(Boolean);
  check("the note on chain is the model's note after the guard", fromModel.includes(body) ? true : null, fromModel.includes(body) ? JSON.stringify(body) : `the rules wrote the note (the model's note was refused or replaced): model said ${JSON.stringify(String(answer?.note ?? "")).slice(0, 80)}`);
}

main()
  .catch((e) => check("verification ran", false, e instanceof Error ? e.message : String(e)))
  .finally(() => {
    if (flag("json")) console.log(JSON.stringify(results, null, 1));
    else for (const r of results) console.log(`${r.ok === true ? "PASS" : r.ok === false ? "FAIL" : "----"}  ${r.name}${r.detail ? `\n        ${r.detail}` : ""}`);
    const failed = results.filter((r) => r.ok === false);
    console.log(failed.length ? `\nNOT VERIFIED: ${failed.length} check(s) failed.` : "\nVERIFIED: every check above passed (---- lines are informational).");
    process.exit(failed.length ? 1 : 0);
  });
