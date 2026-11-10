# The AI strains' moves, and how to check one

The five house strains (and every strain a visitor spawns) choose their plantings with a model on NEAR AI Cloud,
`z-ai/glm-5.3-flash`, which runs inside an Intel TDX confidential VM with NVIDIA GPUs. Every planting a NEAR AI answer
chose carries, at the end of its on-chain lab note, ` · tee:` and the first 16 hex characters of the SHA-256 of that
answer's exact response body. `scripts/verify-tee.mjs` takes the transaction and checks, from public data only, that
the cells it planted are the option the model chose, and that the model answered inside an attested enclave.

## Check an AI move yourself

```
git clone https://github.com/RohanGlitched/petri && cd petri
npm ci --prefix agents
node scripts/verify-tee.mjs 6SzhCcQDo82GJVbm552zcQdGsSniMAj8f2cjRfsvQ69j
```

That transaction is Congo Red's planting on the mainnet dish (`petri-dish.near`) on 10 November 2026, chosen by NEAR AI
with the signed cells fingerprints described below (the testnet example, Crystal Violet's first such move, is
`9t5xz4qRiwZ6xDMpFYrKbtwCEQA6Lz6zkAfgfttXGX7r`); its archived bytes are committed in `proofs/tee/`, so the
check needs no access to the team's machine. The run takes about 15 seconds and ends with:

```
VERIFIED: every check above passed (---- lines are informational).
```

Any other move: `node scripts/verify-tee.mjs <tx hash>` (add `--net mainnet` or `--net testnet` to skip the search,
and `--account <signer>` for a spawned strain's move), or `node scripts/verify-tee.mjs latest --net mainnet` for the
newest tagged move in the strains' log. Moves made before the cells fingerprints (before 10 November 2026) FAIL the
choice check on purpose: their signed prompt does not name the cells, so the choice cannot be tied to them from signed
data. `proofs/tee/moves.json` lists the pinned moves, including one such older mainnet move.

## What the check proves, step by step

1. **The transaction.** A successful `plant` on the dish, its cells and note, and the time of the block that holds it,
   read from public RPC (FastNEAR, its archival node, dRPC).
2. **The tag, on the dish itself.** The note ends with ` · tee:<16 hex>`, and the dish's own `plants` view holds that
   tag exactly once, on a planting of exactly those cells.
3. **The archived answer.** The request and response bodies hash to what the record names, and the response hash
   starts with the tag.
4. **The signature.** NEAR AI's enclave signs `<model>:<sha256 request>:<sha256 response>` (EIP-191). The signer
   recovered from the signature is the signing address it names, and the model is the one the request asked for.
5. **The attestation.** The report was fetched with a fresh nonce of the runner's own. One model attestation for the
   model names the signer; its TDX quote's report_data is `<signer><12 zero bytes><nonce>`; the quote verifies against
   Intel's collateral (dcap-qvl); RTMR3 replays from the event log; MRCONFIGID is the hash of the app compose.
   - **The machine is pinned.** Not a debug TD (TDATTRIBUTES bit 0 clear); TCB status UpToDate or SWHardeningNeeded;
     MRTD and RTMR0-2 equal to the pinned dstack-nvidia image, and the os_image_hash in the event log (bound by RTMR3)
     equal to it too. The values are in `agents/tee.mjs` (`PINNED_IMAGES`).
   - **The compose manager.** NEAR AI's compose manager adds its own quote from the same TD: report_data is
     `sha256(action log as canonical JSON) ‖ our nonce`. The check recomputes the hash, verifies that quote, requires
     the same MRTD and RTMR0-3 as the model's quote, and requires the latest compose_up still running to be a production
     GLM compose file (`prod/…`, starting a `glm53` service); it prints the file and its `file_sha256`.
6. **The choice, from the signed request alone.** Every option line the model reads ends with `cells:` and the first
   12 hex characters of the SHA-256 of that option's cells (JSON array of cell indices). The model's answer picks
   option N; option N in the signed user message must be the only line numbered N, and the SHA-256 of the
   transaction's cells must start with its fingerprint. Nothing the house logged is needed.
7. **Freshness.** The response's `created` time is within 180 seconds of the transaction's block, and the generation
   in the signed prompt is within 3 of the generation the dish recorded for the planting.

The runner applies the same machine and compose-manager checks to every attestation report it fetches
(`agents/model.mjs`): an answer from an unpinned image, a debug TD or another compose file is marked unverified.

A check that cannot be made FAILS; it is never skipped. With `--no-dcap` the quote, machine and compose-manager checks
fail too.

## What remains trusted

- **The menu.** The house code (`agents/strategies.mjs`) builds the options the model chooses among, checked against
  the contract's own rules. The signature proves which option the model picked, not that the menu was a fair one.
- **NEAR AI's KMS and compose repository.** The KMS derives the enclave's signing key for its app; the compose manager
  reports each compose file by path, commit and sha256, but the file's contents are not published with the report.
- **The GPUs.** The NVIDIA evidence (`nvidia_payload` in the report) is not checked here; send it to NVIDIA's NRAS.
- **The pinned image values.** No reference values for NEAR AI's dstack-nvidia image are published that we could find
  (dstack publishes a reproduce script, not numbers for these builds). The values in `agents/tee.mjs` were pinned from
  observation on 10 November 2026: identical in all 12 attestation reports the two runners fetched that day, on two
  machines (`dstack-nvidia-0.5.11` and `-0.5.12` app names, 8 GPUs). A new image fails the check until someone reviews
  it and adds its values.
- **Intel's collateral**, fetched by dcap-qvl through Phala's PCCS (or Intel's own with `--pccs intel`).

## Where the archived bytes come from

`verify-tee.mjs` reads the answer and the report from, in order:

1. the site's HTTPS proxy: `https://www.playpetri.xyz/api/tee/<16-hex tag or response sha256>` and
   `https://www.playpetri.xyz/api/tee/attestation/<report sha256>`;
2. the runner's own log window on the VM (`http://136.64.100.170:8790` testnet, `:8791` mainnet), same paths without
   `/api/tee`;
3. the snapshot committed in `proofs/tee/` (`scripts/snapshot-tee.mjs <tx> --net <net>` adds one).

`--source proxy|vm|snapshot|<url>` picks one. The bytes are checked by hash, so a source can withhold them but cannot
alter them unnoticed. A nightly workflow (`.github/workflows/tee.yml`) runs the check on the newest tagged move on each
dish and on the pinned testnet move from the snapshot alone.

## The lab note guard

The model's lab note goes on chain only if it passes `safeNote` (`agents/swarm/guard.mjs`) in every spelling the guard
folds (lookalike letters, spaced and dotted letters, "dot" and "(at)"). It refuses links and domains (also spelled with
"slash" or "dot"), handles, account names joined by `.` `_` `-` `,` `/` `|`, e-mail addresses, long hex strings, keys,
instructions to a model, payment requests in any phrasing ("send 5 near", "pay alice", "tip jar"), shilling, voting,
violence against people and a short slur list (kept base64-encoded in `agents/swarm/slurs.mjs`, never printed). A
refused note is replaced by one the rules write, so the guard leans strict. A bare word before "near" ("alice near")
stays legal: "cells near the wall" is ordinary game talk.

## Keys

- **Spawned strains.** Each spawned strain is an account under `petri-strains.testnet` that should hold one key: the
  runner's play key, a function-call key for the dish's play methods. `scripts/check-strain-keys.mjs` lists every
  account under the parent (the dish's colonies, the site's swarm registry, and NearBlocks with `--deep`) and fails if
  any holds a full-access key; it runs in the "Live dishes" workflow. A spawn that stops half-way is cleaned up from
  what the dish says (`colony_of`), with a top-up from the parent first; `agents/swarm/lock-strain.mjs <account>` does
  it by hand on the machine that holds the temporary key.
- **Mainnet house accounts.** `scripts/scope-keys-mainnet.mjs` (plan/send, signed only by the lead) gives the keeper and
  the five strains function-call keys for `petri-dish.near`. The keeper needs nothing more. The strains attach NEAR on
  mainnet to plant and buy PETRI, which a function-call key cannot do; the script's header explains the split: the
  function-call key on the VM for what credit can pay, buys with NEAR from the lead's machine.
