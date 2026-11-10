// Scopes the mainnet house accounts' keys: a function-call key per account that can call only the dish (petri-dish.near)
// and only the methods that account uses, so the machine that runs the agents need not hold full-access keys.
// Nothing here is signed unless you run `send`, and only the lead runs it.
//
//   node scripts/scope-keys-mainnet.mjs gen  --out <dir>         make the function-call key pairs (run ON THE VM, so the
//                                                                private keys never leave it); prints their public keys
//   node scripts/scope-keys-mainnet.mjs plan --pub <file.json>   read the chain and print what `send` would do
//   node scripts/scope-keys-mainnet.mjs send --pub <file.json>   add those keys, signed with each account's full-access
//                                                                key from PETRI_KEYS_DIR (default ~/.near-credentials/mainnet)
//   node scripts/scope-keys-mainnet.mjs drop-full --account <id> [--account <id> ...] --confirm
//                                                                OPTIONAL and separate: delete the full-access key(s) of
//                                                                the named accounts that the VM holds (see the trade-off)
//
// <file.json> is what `gen` prints: { "<account>": "ed25519:<public key>", ... }.
//
// The trade-off. A function-call key cannot attach NEAR (its deposit must be 0). On mainnet the strains attach NEAR to
// plant, buy PETRI, offer pacts and mint slides (agents/run.mjs `attaches`), so with only a function-call key they could
// do those only by spending dish credit (the `credit` argument), and credit on mainnet must be sponsored with NEAR.
// The keeper attaches nothing: `advance` and `unwrap_wnear` work with a function-call key alone.
// Recommended split:
//   - keeper.petri-dish.near: function-call key on the VM; its full-access key moves off the VM (drop-full, or keep it
//     only on the lead's machine). Nothing the keeper does needs more.
//   - the five strains: function-call key on the VM for advance, plant, claim, pact_accept and pact_cancel paid with
//     credit when the dish holds credit for them; buys of PETRI with NEAR (and any planting that attaches NEAR) from the
//     lead's machine, which keeps the full-access keys. Until credit is sponsored, a strain whose full-access key has
//     left the VM stops planting: so drop-full for the strains only once that is the plan, never as a side effect.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// near-api-js from the agents' packages (cd agents && npm ci): this script lives outside that folder.
const nearApi = createRequire(new URL("../agents/package.json", import.meta.url)).resolve("near-api-js").replace(/index.cjs$/, "index.js");
const { Account, JsonRpcProvider, KeyPair, PublicKey, actions } = await import(pathToFileURL(nearApi).href);

const DISH = "petri-dish.near";
const RPC = "https://rpc.mainnet.fastnear.com";
// What each account calls on the dish (agents/run.mjs, council.mjs), and the most gas its key may spend before a person
// renews it (allowance, yoctoNEAR): a leaked strain key can burn at most that in gas and can move no NEAR.
const STRAIN_METHODS = ["plant", "claim", "advance", "buy", "pact_offer", "pact_accept", "pact_cancel", "mint_slide"];
const PLAN = {
  // The keeper burns about 0.27 NEAR a day in gas (its log's keeper_cost): a capped allowance would stop it mid-judging,
  // so its key has none (it can still only call these two methods, attach nothing and move no NEAR).
  "keeper.petri-dish.near": { methods: ["advance", "unwrap_wnear"], allowance: null },
  ...Object.fromEntries(["violet", "safranin", "methylene", "malachite", "congo"].map((s) => [`${s}.petri-dish.near`, { methods: STRAIN_METHODS, allowance: "250000000000000000000000" }])),
};

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (n) => (argv.indexOf(`--${n}`) >= 0 ? argv[argv.indexOf(`--${n}`) + 1] : null);
const all = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const KEYS_DIR = process.env.PETRI_KEYS_DIR ?? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".near-credentials", "mainnet");

async function rpc(method, params) {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "scope", method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(JSON.stringify(j.error).slice(0, 200));
  return j.result;
}
const keysOf = async (a) => (await rpc("query", { request_type: "view_access_key_list", finality: "final", account_id: a })).keys;
const describe = (k) => (k.access_key.permission === "FullAccess" ? "FULL ACCESS" : `function call → ${k.access_key.permission.FunctionCall.receiver_id} (${k.access_key.permission.FunctionCall.method_names.join(", ") || "any method"})`);
const readPub = () => {
  const f = opt("pub");
  if (!f) throw new Error("--pub <file.json> (what `gen` printed) is required");
  return JSON.parse(fs.readFileSync(f, "utf8"));
};

if (cmd === "gen") {
  const out = opt("out");
  if (!out) throw new Error("--out <dir> is required (the runner's PETRI_KEYS_DIR for the scoped keys)");
  fs.mkdirSync(out, { recursive: true });
  const pub = {};
  for (const a of Object.keys(PLAN)) {
    const file = path.join(out, `${a}.json`);
    if (fs.existsSync(file)) throw new Error(`${file} exists; refusing to overwrite a key`);
    const kp = KeyPair.fromRandom("ed25519");
    fs.writeFileSync(file, JSON.stringify({ account_id: a, public_key: kp.getPublicKey().toString(), private_key: kp.toString() }), { mode: 0o600 });
    pub[a] = kp.getPublicKey().toString();
  }
  console.log(JSON.stringify(pub, null, 1));
} else if (cmd === "plan" || cmd === "send") {
  const pub = readPub();
  for (const [a, p] of Object.entries(PLAN)) {
    const keys = await keysOf(a);
    const want = pub[a];
    console.log(`\n${a}`);
    for (const k of keys) console.log(`  now: ${k.public_key.slice(0, 20)}…  ${describe(k)}`);
    if (!want) {
      console.log("  (no public key in --pub for this account: skipped)");
      continue;
    }
    if (keys.some((k) => k.public_key === want)) {
      console.log(`  already has ${want.slice(0, 20)}…`);
      continue;
    }
    console.log(`  add: ${want.slice(0, 20)}…  function call → ${DISH} (${p.methods.join(", ")}), gas allowance ${p.allowance ? `${Number(BigInt(p.allowance) / 10n ** 21n) / 1000} NEAR` : "none (unlimited)"}`);
    if (cmd === "send") {
      const file = path.join(KEYS_DIR, `${a}.json`);
      const { private_key } = JSON.parse(fs.readFileSync(file, "utf8"));
      const acct = new Account(a, new JsonRpcProvider({ url: RPC }), private_key);
      const r = await acct.signAndSendTransaction({ receiverId: a, actions: [actions.addFunctionCallAccessKey(PublicKey.fromString(want), DISH, p.methods, p.allowance ? BigInt(p.allowance) : undefined)], waitUntil: "FINAL" });
      console.log(`  sent ${r.transaction.hash}`);
    }
  }
  if (cmd === "plan") console.log("\nplan only: nothing was signed. `send` adds the keys above; the full-access keys stay until drop-full.");
} else if (cmd === "drop-full") {
  const targets = all("account");
  if (!targets.length) throw new Error("--account <id> (one or more) is required");
  for (const a of targets) {
    if (!PLAN[a]) throw new Error(`${a} is not one of the house accounts this script scopes`);
    const keys = await keysOf(a);
    const fc = keys.filter((k) => k.access_key.permission !== "FullAccess" && k.access_key.permission.FunctionCall.receiver_id === DISH);
    if (!fc.length) throw new Error(`${a} has no function-call key for ${DISH} yet: run send first`);
    const file = path.join(KEYS_DIR, `${a}.json`);
    const { public_key, private_key } = JSON.parse(fs.readFileSync(file, "utf8"));
    const full = keys.filter((k) => k.access_key.permission === "FullAccess");
    console.log(`${a}: would delete the full-access key ${public_key} (${full.length} full-access key(s) now${full.length > 1 ? "; the others stay" : ""})`);
    if (full.length === 1 && full[0].public_key === public_key) console.log("  WARNING: it is the account's last full-access key: afterwards nobody can attach NEAR from this account, ever.");
    if (!argv.includes("--confirm")) continue;
    const acct = new Account(a, new JsonRpcProvider({ url: RPC }), private_key);
    const r = await acct.signAndSendTransaction({ receiverId: a, actions: [actions.deleteKey(KeyPair.fromString(private_key).getPublicKey())], waitUntil: "FINAL" });
    console.log(`  deleted ${r.transaction.hash}`);
  }
  if (!argv.includes("--confirm")) console.log("\nnothing was signed: add --confirm to delete.");
} else {
  console.error("usage: node scripts/scope-keys-mainnet.mjs gen --out <dir> | plan --pub <file> | send --pub <file> | drop-full --account <id> ... [--confirm]");
  process.exit(2);
}
