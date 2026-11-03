import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { NetTabs } from "@/components/docs/NetTabs";
import { Callout, Doc, Ext, Formula, H2, H3, Steps, Table } from "@/components/docs/ui";
import { BUILD_COMMIT, BUILD_DIGEST, BUILD_IMAGE, CODE_HASH, NEAR_SDK, REPO, SITE } from "@/components/docs/facts";

export const metadata = docMetadata("verification");

const CHECKS: [string, string][] = [
  ["History chain", "The chain the replay computed at the stored generation equals state().chain."],
  ["Board hash", "The hash of every live cell and its owner equals state().board_hash."],
  ["Living cells", "The replayed count equals state().total_live."],
  ["Legal plantings", "Every Plant entry passes check_plant on the replayed board, and its siege flag matches."],
  ["Planting prices", "Every Plant paid exactly quote(agar, counted, …) for its cell count and siege flag."],
  ["Planting fees", "Every Plant brought at least cell_fee per cell to the pools (near + credit)."],
  ["Purchases on the curve", "Every Buy got exactly buy_quote(near + credit) units from the replayed agar."],
  ["Sales on the curve and allowance", "Every Sell got exactly sell_quote, within the allowance left since the last tide, paid in credit exactly when the colony never attached NEAR."],
  ["Tides", "A tide ran at exactly the tide generations where some non-house colony had earned; each has the right chain, vault share, NEAR shares, credit shares, capped bounty, and at most 0.003 NEAR of storage."],
  ["Specimens", "Every Slide is the colony's own cells in its rectangle as the replayed board stood, numbered in order, at least slide_min_cells, priced at slide_cells_price per cell."],
  ["Agar", "The replayed agar equals state().agar, to the unit."],
  ["Sold", "PETRI sold from the agar."],
  ["Burned", "PETRI burned by plantings and slides."],
  ["Burned by specimens", "PETRI burned by slides alone."],
  ["Returned to the agar", "The half of each planting that went back."],
  ["Bought back", "PETRI sold back to the agar."],
  ["Keeper share", "keeper_pot + keeper_paid equals the replayed 2% of every feed."],
  ["Colony earnings", "Every colony's lifetime PETRI earnings (the earnings view) equal the replay's."],
  ["Vault (NEAR)", "The replayed vault equals state().vault, to the yoctoNEAR."],
  ["NEAR paid in", "Attached NEAR that reached the vault."],
  ["NEAR paid at tides", "Vault shares paid as claimable NEAR."],
  ["Vault shares, bounties as credit", "Vault shares and bounties paid as credit to colonies that never attached NEAR."],
  ["Sales paid as credit", "Sales by such colonies, paid as credit."],
  ["Colony tide winnings", "Every colony's NEAR won (the tide_winnings view) equals the replay's."],
  ["Credit pool", "The replayed credit pool equals state().credit_pool."],
  ["Credit paid at tides", "state().credit_won equals the replay's credit shares, vault shares as credit and guest bounties."],
  ["Colony credit winnings", "Every colony's credit_won equals the replay's."],
  ["Solvent (NEAR held >= owed)", "The account's balance minus its storage, plus wNEAR held, covers the vault, the credit pool, unspent credit, unclaimed winnings and pending NEAR."],
  ["Deployed code hash", "The account's code hash equals the reproducible build's (or --code-hash)."],
  ["Full-access keys", "The contract account has no full-access key, so nobody can deploy other code."],
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
              Only by a full-access key on the contract account. <a href="#keys">Check the keys</a>.
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
node scripts/verify.mjs --contract other.testnet --code-hash <base58>   # any dish, any expected hash`}</Code>
      <p>Exit status 0 means every check matched, 1 means at least one differed, 2 means the dish could not be read. It needs Node 20 or later.</p>
      <Callout kind="warn">
        <p>
          Today both dishes exit 1, for one reason: <C>Full-access keys 1 (expected: 0)</C>. Every other row matches. The keys are to be deleted with the owner&rsquo;s approval before judging.
        </p>
      </Callout>

      <H2 id="checks">Every check</H2>
      <p>The rows <C>scripts/verify.mjs</C> prints, in order. The browser&rsquo;s <C>/verify</C> runs the same checks with its own wording.</p>
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
        After the rows it prints the NEP-330 source link and build command, how many idle tide generations were skipped, the NEAR owed against the NEAR held, and a warning while a full-access key exists. For the first colonies whose earnings or winnings differ, it prints the contract&rsquo;s and the replay&rsquo;s numbers.
      </p>

      <H2 id="replay">How the replay works</H2>
      <Steps>
        <li>
          <strong>Pin one block.</strong> It reads the latest final block height and makes every read at that block: <C>rules</C>, <C>state</C>, the account (balance, storage, code hash), its access keys, every page of <C>colonies</C>, <C>ledger</C>, <C>earnings</C> and <C>tide_winnings</C>, and <C>contract_source_metadata</C>. A transaction landing mid-read cannot skew anything.
        </li>
        <li>
          <strong>Load the engine.</strong> The engine is <C>petri-core</C> compiled to WebAssembly (<C>wasm/</C>, built into <C>web/src/engine/pkg</C>). It is the same Rust code the contract runs: the step, the feed, the prices, the curves and the tide split.
        </li>
        <li>
          <strong>Start empty.</strong> A 128 × 128 dish, the agar at <C>max_supply</C>, no colonies.
        </li>
        <li>
          <strong>Walk the generations.</strong> At each generation it first checks the tide schedule, then applies that generation&rsquo;s entries in ledger order, checking each against the rules. Then it steps Life and the feed to the next generation that has an entry or is a tide generation.
        </li>
        <li>
          <strong>Track the attachers.</strong> A colony whose <C>Buy</C> or <C>Plant</C> brought <C>near &gt; 0</C> has attached NEAR; from then on its tide shares and sales must be NEAR, before then credit.
        </li>
        <li>
          <strong>Compare.</strong> At the stored generation it compares every total and every colony&rsquo;s numbers with the contract&rsquo;s views.
        </li>
      </Steps>
      <p>
        A <C>Skip</C> entry only moves the clock, so the replay ignores it. The cost of a replay grows with the stored generation and the living cells, not with wall-clock time, and generations with no entry and no tide are stepped in one call.
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
          It prints <C>{CODE_HASH}</C>, and the file is 503,043 bytes. Compare it with what both accounts report:
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
  "standards": [{ "standard": "nep330", "version": "1.3.0" }],
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

      <H2 id="keys">Check the keys</H2>
      <p>
        A NEAR account&rsquo;s code can be replaced only by a transaction signed with a full-access key of that account. A contract with no full-access key, and no method that deploys code (Petri has none), can never change.
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
      <Table caption="Keys on 4 November 2026">
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
              <C>ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH</C>
            </td>
            <td>full access</td>
          </tr>
          <tr>
            <td>
              <C>petri-v6.testnet</C>
            </td>
            <td>
              <C>ed25519:Gx338TCzmupYDbRw7DPPXZVsF45yCPRnazrM173h2yCZ</C>
            </td>
            <td>full access</td>
          </tr>
        </tbody>
      </Table>
      <Callout kind="warn" title="Not locked yet">
        <p>
          Both contract accounts still hold a full-access key, so the code could still be replaced. The owner will delete each key before judging with a command like the one below, after which nobody, the team included, can upgrade or patch the contract. Until then, treat the code as changeable and check this table against the chain.
        </p>
        <Code lang="sh" title="What the owner will run (signed by the key itself)">{`near account delete-keys petri-dish.near public-keys ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH network-config mainnet sign-with-keychain send`}</Code>
      </Callout>

      <H2 id="browser">/verify in the browser</H2>
      <p>
        <Ext href={`${SITE}/verify`}>playpetri.xyz/verify</Ext> runs the same replay (<C>web/src/lib/replay.ts</C>) with the same engine, in your browser, against the dish the site is reading (switch networks in the header). It pins one final block exactly as the CLI does, and shows each check as it completes, with the tide log as it goes.
      </p>
      <ul>
        <li>The lock (full-access keys) is shown apart from the replay, in amber rather than red: it is a step still to come, not a mismatch.</li>
        <li>
          The page does not compare the code hash with the reproducible build; that check is in <C>scripts/verify.mjs</C>, which carries the expected hash.
        </li>
      </ul>

      <H2 id="limits">What verification does not prove</H2>
      <ul>
        <li>
          <strong>It trusts the RPC.</strong> Both replays read through public RPC providers (FastNEAR first, then near.org). A dishonest provider could serve consistent lies; run the script against your own node with <C>--contract</C> if that matters, or compare providers.
        </li>
        <li>
          <strong>It proves the ledger follows the rules, given the code.</strong> That the ledger records every state change is a property of the contract&rsquo;s code, which is why the code hash and the key check matter.
        </li>
        <li>
          <strong>It says nothing about off-chain parts:</strong> what the site shows, how the strains choose, or whether the relayer serves every guest. Those are open source but run on servers you cannot inspect.
        </li>
        <li>
          <strong>It is not an audit.</strong> The economy can follow its rules exactly and still lose players money; see <Doc to="simulations">Economics and simulations</Doc> and <Doc to="security" hash="limits">Known limits</Doc>.
        </li>
      </ul>
    </DocPage>
  );
}
