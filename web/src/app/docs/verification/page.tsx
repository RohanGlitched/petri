import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { NetTabs } from "@/components/docs/NetTabs";
import { Callout, Doc, Ext, Formula, H2, H3, Steps, Table } from "@/components/docs/ui";
import { BUILD_COMMIT, BUILD_DIGEST, BUILD_IMAGE, CODE_HASH, CONTRACT_VERSION, NEAR_SDK, RELAUNCHED, REPO, SITE, UPGRADED, VERIFY, VERIFY_CLI_CHECKS, VERIFY_CLI_ROWS, LOCKED } from "@/components/docs/facts";
import { MAINNET_CAPTURE } from "@/components/docs/verify-capture";

export const metadata = docMetadata("verification");

const CHECKS: [string, string][] = [
  ["History chain", "The chain the replay computed at the stored generation equals state().chain."],
  ["Board hash", "The hash of every live cell and its owner equals state().board_hash."],
  ["Living cells", "The replayed count equals state().total_live."],
  ["Legal plantings", "Every Plant entry passes check_plant on the replayed board, and its siege flag matches."],
  ["Planting prices", "Every Plant paid exactly quote(agar, counted, …) for its cell count and siege flag, less the licence discount (slide_discount_bps) when it names a slide."],
  ["Planting fees", "Every Plant brought at least cell_fee per cell to the pools (near + credit)."],
  ["Licensed plantings: shape, holder, royalty", "Every Plant under a licence is exactly its slide's pattern moved on the dish (Engine.fits_slide, not turned); its price and royalty are licence(cost, discount, royalty); its slide captured at least licence_min_cells (12) cells; its holder is the minter until the slide's first move and one account between moves; no royalty when the planter held it, and to_agar is true exactly when there is a holder and the planter had never attached NEAR or held more kept PETRI than the cost, read at the planting after its claim (the royalty then goes to the agar)."],
  ["Purchases on the curve", "Every Buy got exactly buy_quote(near + credit) units from the replayed agar."],
  ["Sales on the curve and allowance", "Every Sell got exactly sell_quote, within the allowance left since the last tide, paid in credit exactly when the colony never attached NEAR, and none by a house colony."],
  ["Tides", "A tide ran at exactly the tide generations where some non-house colony had earned; each has the right chain and stored bytes (130, or 175 on the tide that starts a new index page), and the replay works out its vault share, NEAR shares, credit shares, capped bounty (none when a house colony or keeper ran it) and storage from the ledger before it; the share and bounty of a colony holding kept PETRI are credit, not NEAR."],
  ["Claims of exactly what was owed", "Every Claim took exactly the NEAR its colony was owed in the replay (all it won at the tides, less what it claimed before), sent it less at most a record's storage, and was made by a colony holding no kept PETRI."],
  ["Refunds tied to their payouts", "Every Refund names a payout entry (of) of its kind, refunds exactly the NEAR that entry sent, no payout is refunded twice, and its storage is at most a record's; the rest goes to the vault (a bounty) or to pending NEAR (everything else)."],
  ["Sales for NEAR, NEAR claims and pact payments by colonies holding no kept PETRI", "No Sell for NEAR, no Claim and no PETRI pact offer was made by a colony whose replayed kept PETRI was above zero (the house is exempt from the pact check)."],
  ["Pacts kept to the rules and plantings under pacts", "Every pact follows the rules: numbered in order, until within (g, g + pact_max_gens], at most 8 pacts per colony that are accepted or that it offered, at most 16 offers waiting for a colony, one open offer per pair, every offer at least 1 PETRI (house-to-house pacts excepted), PETRI offered only by a colony that attached NEAR and holds no kept PETRI, no house PETRI offered to a player, an accept only while open and before until, an accepted pact ended only at until; and every Plant is checked with the engine's pact_breach against the colonies that accepted pacts binding its planter protect, on the board as it stood."],
  ["PETRI held for pact offers", "state().pact_escrow equals the PETRI of the offers made and not yet accepted or ended, rebuilt from the PactOffer, PactAccept and PactEnd entries."],
  ["Pacts", "state().pacts equals the number of PactOffer entries."],
  ["Specimens", "Every Slide is the colony's own cells in its rectangle as the replayed board stood, numbered in order, at least slide_min_cells, priced at slide_cells_price per cell."],
  ["Slide holders and royalties", "Each slide's owner, move count and royalties (the slides view) agree with the holder and royalties the replay last saw."],
  ["Agar", "The replayed agar equals state().agar, to the unit."],
  ["Sold", "PETRI sold from the agar."],
  ["Burned", "PETRI burned by plantings, slides and Burn entries (forced unregistrations, refunds to unregistered senders)."],
  ["Burned by specimens", "PETRI burned by slides alone."],
  ["Royalties", "PETRI paid to slide holders under their licences."],
  ["Returned to the agar", "The half of each planting that went back."],
  ["Bought back", "PETRI sold back to the agar."],
  ["Keeper share", "keeper_pot + keeper_paid equals the replayed 2% of every feed."],
  ["Colony earnings", "Every colony's lifetime PETRI earnings (the earnings view) equal the replay's."],
  ["Vault (NEAR)", "The replayed vault equals state().vault, to the yoctoNEAR."],
  ["NEAR paid in", "NEAR that reached the vault: attached by players (and, on ledgers written by v6.1, Dust entries; none have been written since)."],
  ["NEAR paid at tides", "Vault shares paid as claimable NEAR."],
  ["Vault shares, bounties as credit", "Vault shares and bounties paid as credit to colonies that have not attached NEAR or hold kept PETRI."],
  ["Sales paid as credit", "Sales by such colonies, paid as credit."],
  ["Colony tide winnings", "Every colony's NEAR won (the tide_winnings view) equals the replay's."],
  ["Credit pool", "The replayed credit pool equals state().credit_pool."],
  ["Credit paid at tides", "state().credit_won equals the replay's credit shares, vault shares as credit and guest bounties."],
  ["Credit sponsored", "state().credit_given equals the sum of the Sponsor entries."],
  ["Credit spent", "state().credit_spent equals the credit the Buy, Plant and Slide entries say they took (spent)."],
  ["Credit taken back", "state().credit_reclaimed equals the sum of the Unsponsor entries."],
  ["NEAR owed to colonies", "state().tides_owed equals the NEAR the replayed tides made claimable, less the Claim entries."],
  ["Pending NEAR", "state().pending equals the Pending entries and pending refunds, less the Unpend entries."],
  ["Colony credit winnings", "Every colony's credit_won equals the replay's."],
  ["Colony kept PETRI", "Every colony's kept PETRI (the colonies view) equals the replay's: a guest's claims, purchases and royalties, a first NEAR's unclaimed earnings, credit-bought PETRI, less what plantings and slides spent first."],
  ["Solvent (NEAR held >= owed, from the ledger)", "The account's balance minus its storage, plus wNEAR held, covers the vault, the credit pool, unspent credit, unclaimed winnings and pending NEAR, every term recomputed from the ledger rather than read from the contract."],
  ["Deployed code hash", "The account's code hash equals the reproducible build's (or --code-hash)."],
  ["Full-access keys", "The count of full-access keys on the contract account, never a failure. 0 prints as PASS (mainnet since 10 November 2026: nobody can deploy other code or relaunch); a key prints as a disclosed note (testnet keeps one for fixes), and new code would change the code hash, which the row above checks."],
];

export default function Page() {
  return (
    <DocPage
      slug="verification"
      source={[
        { label: "scripts/verify.mjs", path: "scripts/verify.mjs" },
        { label: "web/src/lib/replay.ts", path: "web/src/lib/replay.ts" },
        { label: "wasm/src/lib.rs", path: "wasm/src/lib.rs" },
      ]}
    >
      <H2 id="what">What gets checked</H2>
      <p>
        Verification answers three questions, and each has its own check:
      </p>
      <Table>
        <thead>
          <tr>
            <th>Question</th>
            <th>How it is answered</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Is the code on chain the code in the repository?</td>
            <td>
              Rebuild it reproducibly at the commit its NEP-330 metadata names, and compare the hash with the account&rsquo;s code hash. <a href="#rebuild">Rebuild the wasm</a>.
            </td>
          </tr>
          <tr>
            <td>Can that code be replaced?</td>
            <td>
              On mainnet, never: <C>petri-dish.near</C> has had no access key since {LOCKED.date}. On testnet, only by the one full-access key the team keeps for fixes, and new code changes the code hash this check compares. <a href="#keys">The lock</a>.
            </td>
          </tr>
          <tr>
            <td>Did the code do what the rules say, every time?</td>
            <td>Replay the whole ledger from an empty dish with the same engine and compare every number. <a href="#replay">How the replay works</a>.</td>
          </tr>
        </tbody>
      </Table>
      <Code lang="sh" title="All three at once">{`git clone ${REPO} && cd petri
node scripts/verify.mjs --network mainnet           # petri-dish.near
node scripts/verify.mjs --network testnet           # petri-v6.testnet (the default)
node scripts/verify.mjs --contract other.testnet --code-hash <base58>   # any dish, any expected hash
node scripts/verify.mjs --dump <file>               # a snapshot the contract's replay test wrote with PETRI_DUMP`}</Code>
      <p>
        Exit status 0 means everything matched (a full-access key is a note, not a failed check), 1 means at least one differed, 2 means the dish could not be read. It needs Node 20 or later. Reads go to FastNEAR first and fail over to dRPC and other keyless public providers, backing off on a 429 as its <C>Retry-After</C> asks; <C>--rpc &lt;url&gt;</C> puts a provider you choose (or several, comma-separated) first. The deprecated <C>rpc.*.near.org</C> endpoints are not used. With <C>--dump</C> it replays a snapshot written by <C>PETRI_DUMP=&lt;file&gt; cargo test -p petri-contract replaying_the_ledger</C> instead of a live dish, and leaves out the two account rows.
      </p>
      <Callout kind="note">
        <p>
          Both dishes exit 0 when everything matches. On mainnet the last row reads <C>PASS Full-access keys 0 (nobody can deploy other code or relaunch)</C>. On testnet it prints as a disclosed note on the key the team keeps there, <C>note Full-access keys 1 (team-held, see The lock; …)</C>, and does not count as a difference.
        </p>
      </Callout>

      <H2 id="checks">Every check</H2>
      <p>The {VERIFY_CLI_ROWS} rows <C>scripts/verify.mjs</C> prints, in order: {VERIFY_CLI_CHECKS} that must match and one on the keys. The browser&rsquo;s <C>/verify</C> runs the same replay and shows {VERIFY.checks} checks and the keys row in its own wording (<a href="#browser">below</a>).</p>
      <Table>
        <thead>
          <tr>
            <th>Row</th>
            <th>Passes when</th>
          </tr>
        </thead>
        <tbody>
          {CHECKS.map(([k, v]) => (
            <tr key={k}>
              <td style={{ whiteSpace: "nowrap" }}>{k}</td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        After the rows it prints the NEP-330 source link and build command, how many idle tide generations were skipped, the NEAR owed against the NEAR held, and the full-access key count (PASS at 0, a note otherwise). For the first colonies whose earnings or winnings differ, and the first slides whose holder or royalties differ, it prints the contract&rsquo;s and the replay&rsquo;s numbers.
      </p>
      <Code lang="text" title="node scripts/verify.mjs --network mainnet, 10 November 2026 (block 223923613, after the key was deleted)" copy={false}>{MAINNET_CAPTURE}</Code>

      <H2 id="replay">How the replay works</H2>
      <Steps>
        <li>
          <strong>Pin one block.</strong> It reads the latest final block height and makes every read at that block: <C>rules</C>, <C>state</C>, the account (balance, storage, code hash), its access keys, every page of <C>colonies</C>, <C>ledger</C>, <C>earnings</C>, <C>tide_winnings</C> and <C>slides</C>, and <C>contract_source_metadata</C>. A transaction landing mid-read cannot skew anything.
        </li>
        <li>
          <strong>Load the engine.</strong> The engine is <C>petri-core</C> compiled to WebAssembly (<C>wasm/</C>, built into <C>web/src/engine/pkg</C>). It is the same Rust code the contract runs: the step, the feed, the prices, the curves and the tide split.
        </li>
        <li>
          <strong>Start empty.</strong> A 128 × 128 dish, the agar at <C>max_supply</C>, no colonies.
        </li>
        <li>
          <strong>Walk the generations.</strong> At each generation it first checks the tide schedule and works out that tide&rsquo;s amounts itself (a Tide entry stores only the chain, its bytes and who ran it), then applies that generation&rsquo;s entries in ledger order, checking each against the rules. Then it steps Life and the feed to the next generation that has an entry or is a tide generation.
        </li>
        <li>
          <strong>Track the attachers.</strong> A colony whose join, <C>Buy</C> or <C>Plant</C> put at least <C>min_join</C> (0.01 NEAR) into the vault in one call has attached NEAR; from then on its tide shares and sales are NEAR, before then credit, and while it holds kept PETRI its tide shares and bounties are credit and it makes no NEAR claim.
        </li>
        <li>
          <strong>Track the money.</strong> Every NEAR and credit movement is an entry (<C>Sponsor</C>, <C>Unsponsor</C>, <C>Claim</C>, <C>Refund</C>, <C>Pending</C>, <C>Unpend</C>, <C>Dust</C> (v6.1 only), <C>Burn</C>, and the <C>spent</C> field of purchases, plantings and slides), so the replay keeps its own vault, credit pool, credit given, won, sold, spent and reclaimed, NEAR owed and pending NEAR, without reading any of the contract&rsquo;s counters.
        </li>
        <li>
          <strong>Track the slides.</strong> Each slide starts with its minter as holder. A licensed planting records the slide&rsquo;s move count, the holder, the royalty and whether it went to the agar; the replay checks the slide had at least 12 cells, that the royalty went to the agar exactly when the planter had never attached NEAR or held more kept PETRI than the cost, and the holder is the minter while the count is 0 and the same account for as long as the count stays the same, and adds the royalty to the slide.
        </li>
        <li>
          <strong>Compare.</strong> At the stored generation it compares every total and every colony&rsquo;s numbers with the contract&rsquo;s views, each slide&rsquo;s owner, moves and royalties with the <C>slides</C> view, and solvency with the replay&rsquo;s own terms.
        </li>
      </Steps>
      <p>
        A <C>Skip</C> entry only moves the clock, so the replay ignores it. Slide transfers are not in the ledger (a transfer carries one yoctoNEAR, too little to pay for an entry), so the replay checks holders against move counts, not who held a slide between two moves. The cost of a replay grows with the stored generation and the living cells, not with wall-clock time, and generations with no entry and no tide are stepped in one call.
      </p>

      <H2 id="chain">History chain and board hash</H2>
      <p>Both are computed by petri-core and stored or returned by the contract, and both replays recompute them.</p>
      <Formula>{`board_hash = sha256( width as u16 LE ‖ height as u16 LE ‖
                      for every live cell in index order: index as u32 LE ‖ owner as u16 LE )

chain_0    = 32 zero bytes
chain_g    = sha256( chain_prev ‖ g as u64 LE ‖ board_hash at g )      when g is a multiple of 16
           = chain_prev                                                  otherwise`}</Formula>
      <p>
        <C>state().chain</C> is the chain at the stored generation, and <C>state().board_hash</C> the hash of the stored board, both in hex. Every <C>Tide</C> entry carries the chain at its generation, and <C>checkpoints</C> lists them, so a replay can be checked tide by tide.
      </p>
      <H3 id="chain-board">The board&rsquo;s compact form</H3>
      <p>
        <C>board()</C> returns the stored board base64-encoded: first the liveness bit rows, 2 little-endian <C>u64</C> words per row for a width of 128 (bit <C>x mod 64</C> of word <C>x ÷ 64</C>), 128 rows; then one little-endian <C>u16</C> owner for each live cell in index order. A dish with L live cells takes 2,048 + 2L bytes.
      </p>
      <Code lang="ts" title="Decode it (TypeScript)">{`const bytes = Uint8Array.from(atob(board), (c) => c.charCodeAt(0));
const W = 128, H = 128, words = 2, bitBytes = 8 * words * H;      // 2,048
const view = new DataView(bytes.buffer);
const cells = new Uint16Array(W * H);
let o = bitBytes;
for (let y = 0; y < H; y++)
  for (let k = 0; k < words; k++) {
    let word = view.getBigUint64((y * words + k) * 8, true);
    for (let b = 0; word; b++, word >>= 1n)
      if (word & 1n) { cells[y * W + k * 64 + b] = view.getUint16(o, true); o += 2; }
  }`}</Code>

      <H2 id="rebuild">Rebuild the wasm</H2>
      <p>
        The contract is built with <C>cargo near build reproducible-wasm</C>, which runs the build inside a pinned Docker image, so the same commit always yields the same bytes. The image and its digest are in <C>contract/Cargo.toml</C>:
      </p>
      <Code lang="text" title="contract/Cargo.toml" copy={false}>{`[package.metadata.near.reproducible_build]
image = "${BUILD_IMAGE}"
image_digest = "${BUILD_DIGEST}"
passed_env = []
container_build_command = ["cargo", "near", "build", "non-reproducible-wasm", "--locked"]`}</Code>
      <Steps>
        <li>
          Install <Ext href="https://github.com/near/cargo-near">cargo-near</Ext> and Docker.
        </li>
        <li>
          Check out the commit both contracts name, and build:
          <Code lang="sh" title="Shell">{`git clone ${REPO} && cd petri
git checkout ${BUILD_COMMIT}
cd contract
cargo near build reproducible-wasm`}</Code>
        </li>
        <li>
          Hash the output, <C>target/near/petri_contract/petri_contract.wasm</C> at the repository root (cargo-near also prints its SHA-256). NEAR shows code hashes as base58 of the SHA-256:
          <Code lang="sh" title="Shell, with Node">{`node -e 'const h=require("crypto").createHash("sha256").update(require("fs").readFileSync(process.argv[1])).digest();const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";let n=BigInt("0x"+h.toString("hex")),s="";while(n>0n){s=A[Number(n%58n)]+s;n/=58n}for(const b of h){if(b)break;s="1"+s}console.log(s)' target/near/petri_contract/petri_contract.wasm`}</Code>
        </li>
        <li>
          It prints <C>{CODE_HASH}</C>, and the file is 606,302 bytes. Compare it with what both accounts report:
          <NetTabs
            mainnet={<Code lang="sh" title="mainnet">{`near account view-account-summary petri-dish.near network-config mainnet now
node scripts/verify.mjs --network mainnet | grep "code hash"`}</Code>}
            testnet={<Code lang="sh" title="testnet">{`near account view-account-summary petri-v6.testnet network-config testnet now
node scripts/verify.mjs --network testnet | grep "code hash"`}</Code>}
          />
        </li>
      </Steps>
      <H3 id="rebuild-metadata">What the contract says about itself</H3>
      <Code lang="json" title="contract_source_metadata() on petri-dish.near">{`{
  "version": "0.3.0",
  "link": "https://github.com/RohanGlitched/petri/tree/${BUILD_COMMIT}",
  "standards": [
    { "standard": "nep141", "version": "1.0.0" },
    { "standard": "nep145", "version": "1.0.0" },
    { "standard": "nep148", "version": "1.0.0" },
    { "standard": "nep171", "version": "1.2.0" },
    { "standard": "nep177", "version": "2.1.0" },
    { "standard": "nep178", "version": "1.0.0" },
    { "standard": "nep181", "version": "1.0.0" },
    { "standard": "nep297", "version": "1.0.0" },
    { "standard": "nep330", "version": "1.3.0" }
  ],
  "build_info": {
    "build_environment": "${BUILD_IMAGE}@${BUILD_DIGEST}",
    "build_command": ["cargo", "near", "build", "non-reproducible-wasm", "--locked"],
    "contract_path": "contract",
    "source_code_snapshot": "git+https://github.com/RohanGlitched/petri?rev=${BUILD_COMMIT}",
    "output_wasm_path": "/home/near/code/target/near/petri_contract/petri_contract.wasm"
  }
}`}</Code>
      <p>
        <C>build_command</C> reads <C>cargo near build non-reproducible-wasm --locked</C>, and that is not a second, unverifiable build. When you run <C>cargo near build reproducible-wasm</C>, cargo-near starts the pinned image and runs its <C>container_build_command</C> inside it, which is exactly that command. NEP-330 records the command that ran in the container, so a verifier (SourceScan, or you) reruns that command in that image at that commit and must get the same bytes. near-sdk is pinned to <C>={NEAR_SDK}</C>: version 5.30 links host functions (gas keys, universal state init) that mainnet&rsquo;s protocol version 86 does not have yet, and pinning lets one build run on both networks.
      </p>

      <H2 id="keys">The lock: check the keys</H2>
      <p>
        A NEAR account&rsquo;s code can be replaced only by a transaction signed with a full-access key of that account. Until {LOCKED.date} each contract account had one, held by the team so a bug could be fixed: new code plus <C>relaunch</C>, the private method that started <C>petri-dish.near</C> and <C>petri-v6.testnet</C> again from generation 0 on {RELAUNCHED}, with a fresh ledger anyone can replay (the {CONTRACT_VERSION} code-only upgrade on {UPGRADED} kept that state). On {LOCKED.date}, after a final verify (Everything matches, 5,016 generations, 4 tides), the team deleted the mainnet key (<a href={LOCKED.url}>the DeleteKey transaction</a>): <C>petri-dish.near</C> has no keys at all, so nobody can deploy other code, relaunch it or move its NEAR, the team included. The testnet dish, <C>petri-v6.testnet</C>, keeps its key so a bug can still be fixed there. No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board.
      </p>
      <NetTabs
        mainnet={<Code lang="sh" title="mainnet">{`near account list-keys petri-dish.near network-config mainnet now

curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "view_access_key_list", "finality": "final", "account_id": "petri-dish.near" }
}' | jq '.result.keys[] | {public_key, permission: .access_key.permission}'`}</Code>}
        testnet={<Code lang="sh" title="testnet">{`near account list-keys petri-v6.testnet network-config testnet now

curl -s https://rpc.testnet.fastnear.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "view_access_key_list", "finality": "final", "account_id": "petri-v6.testnet" }
}' | jq '.result.keys[] | {public_key, permission: .access_key.permission}'`}</Code>}
      />
      <Table caption={`Keys now (since ${LOCKED.date})`}>
        <thead>
          <tr>
            <th>Account</th>
            <th>Key</th>
            <th>Permission</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>petri-dish.near</C>
            </td>
            <td>
              none (<C>ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH</C> was deleted in <a href={LOCKED.url}>{LOCKED.tx.slice(0, 8)}…</a>)
            </td>
            <td>none: <C>&quot;keys&quot;:[]</C></td>
          </tr>
          <tr>
            <td>
              <C>petri-v6.testnet</C>
            </td>
            <td>
              <C>ed25519:8kGYoPJ6jVEZRrjjYKGVLfXD7LCyTDDqu41Cxx9UjHUu</C>
            </td>
            <td>full access</td>
          </tr>
        </tbody>
      </Table>
      <Callout kind="note" title="What the testnet key can and cannot do">
        <p>
          The testnet key cannot change anything quietly. New code changes the account&rsquo;s code hash, and <C>scripts/verify.mjs</C> compares that hash with the published reproducible build on every run; the verifier reports the key as a disclosed note, not a failed check. On mainnet there is nothing left to report: the verifier prints <C>PASS Full-access keys 0</C>. To see the keys yourself, run the commands above and compare them with the table.
        </p>
      </Callout>

      <H2 id="browser">/verify in the browser</H2>
      <p>
        <Ext href={`${SITE}/verify`}>playpetri.xyz/verify</Ext> runs the same replay (<C>web/src/lib/replay.ts</C>) with the same engine, in your browser, against the dish the site is reading (switch networks in the header). It pins one final block exactly as the CLI does, and shows each check as it completes, with the tide log as it goes.
      </p>
      <ul>
        <li>
          It shows {VERIFY.checks} checks and the note in its own wording (listed in <C>web/src/components/verify/VerifyRun.tsx</C>). Next to the CLI it has one row for every PETRI burned, and no rows of their own for the credit pool, credit paid at tides, sales and shares paid as credit, or each colony&rsquo;s credit winnings. Its credit, NEAR owed, pending and solvency rows are recomputed from the ledger as the CLI&rsquo;s are.
        </li>
        <li>The lock (full-access keys) is shown apart from the replay: on mainnet as a pass with 0 keys, on testnet as a disclosed note on the key the team keeps there for fixes.</li>
        <li>
          The page compares the account&rsquo;s code hash with the reproducible build&rsquo;s too; only the terminal script also reads the chain, board and code hash again from a second and third provider.
        </li>
      </ul>

      <H2 id="limits">What verification covers</H2>
      <ul>
        <li>
          <strong>Every unit on chain.</strong> The replay rebuilds the board, the history chain and every PETRI and yoctoNEAR from the ledger alone and compares each with the contract.
        </li>
        <li>
          <strong>The code that wrote the ledger.</strong> That the ledger records every state change is a property of the contract&rsquo;s code, which is why the replay also checks the code hash against the reproducible build and counts the keys.
        </li>
        <li>
          <strong>Which RPC you trust.</strong> Both replays pin one final block and read through public RPC providers (FastNEAR, then dRPC and other keyless providers; the browser&rsquo;s through the site&rsquo;s cache of final blocks), and the terminal script re-reads the chain, board and code hash from a second and a third provider. To cross-check further, run the script against your own node with <C>--rpc &lt;url&gt;</C>.
        </li>
        <li>
          <strong>Off-chain parts, in the open.</strong> The site, the strains and the relayer are open source in the repository; the strains&rsquo; every move and its reasoning are in the public log at <C>/api/strains</C>, and none of these parts can move a player&rsquo;s NEAR or PETRI. See <Doc to="security" hash="limits">Limits and failure cases</Doc>.
        </li>
      </ul>
    </DocPage>
  );
}
