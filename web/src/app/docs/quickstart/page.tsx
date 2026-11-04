import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { NetTabs } from "@/components/docs/NetTabs";
import { Callout, Doc, Ext, H2, H3, Steps, Table } from "@/components/docs/ui";
import { BUILD_COMMIT, BUILD_COMMIT_SHORT, CODE_HASH, REPO, SITE } from "@/components/docs/facts";

export const metadata = docMetadata("quickstart");

const view = (net: "mainnet" | "testnet", method: string, args = "{}") =>
  `near contract call-function as-read-only ${net === "mainnet" ? "petri-dish.near" : "petri-v6.testnet"} ${method} json-args '${args}' network-config ${net} now`;

const rpc = (net: "mainnet" | "testnet") => (net === "mainnet" ? "https://rpc.mainnet.fastnear.com" : "https://rpc.testnet.fastnear.com");
const dish = (net: "mainnet" | "testnet") => (net === "mainnet" ? "petri-dish.near" : "petri-v6.testnet");

function cliViews(net: "mainnet" | "testnet") {
  return `# The clock, the agar, the vault and today's prices
${view(net, "state")}

# Every rule parameter, fixed at launch
${view(net, "rules")}

# The first ten colonies
${view(net, "colonies", '{"from":0,"limit":10}')}

# What planting 4 cells costs right now, in PETRI units (6 decimals), inside a rival's buffer, and under a slide's licence
${view(net, "quote", '{"cells":4}')}
${view(net, "quote", '{"cells":4,"siege":true}')}
${view(net, "quote", '{"cells":4,"licensed":true}')}

# The NEAR to attach to that planting (storage plus the cell fee), in yoctoNEAR
${view(net, "plant_deposit", '{"cells":4,"note_bytes":null}')}

# PETRI that 0.02 NEAR buys from the agar right now
${view(net, "buy_quote", '{"near":"20000000000000000000000"}')}

# The first 20 ledger entries
${view(net, "ledger", '{"from":0,"limit":20}')}

# An account's PETRI, its unclaimed earnings and NEAR won, its credit (and each sponsor's part), and its pending NEAR
${view(net, "ft_balance_of", `{"account_id":"YOU.${net === "mainnet" ? "near" : "testnet"}"}`)}
${view(net, "claimable", `{"account_id":"YOU.${net === "mainnet" ? "near" : "testnet"}"}`)}
${view(net, "credit_of", `{"account_id":"YOU.${net === "mainnet" ? "near" : "testnet"}"}`)}
${view(net, "credit_grants", `{"account_id":"YOU.${net === "mainnet" ? "near" : "testnet"}"}`)}
${view(net, "pending_record", `{"account_id":"YOU.${net === "mainnet" ? "near" : "testnet"}"}`)}

# NEAR held against NEAR owed
${view(net, "solvency")}

# Where the code came from (NEP-330), and who can change it
${view(net, "contract_source_metadata")}
near account list-keys ${dish(net)} network-config ${net} now`;
}

function curlViews(net: "mainnet" | "testnet") {
  return `# A view call: args_base64 is the JSON arguments in base64 ("e30=" is {}).
curl -s ${rpc(net)} -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "call_function", "finality": "final",
              "account_id": "${dish(net)}", "method_name": "state", "args_base64": "e30=" }
}' | jq -r '.result.result | implode' | jq '{generation, total_live, colonies, agar, vault, cell_price}'

# quote with {"cells":4}
curl -s ${rpc(net)} -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "call_function", "finality": "final",
              "account_id": "${dish(net)}", "method_name": "quote", "args_base64": "'$(echo -n '{"cells":4}' | base64)'" }
}' | jq -r '.result.result | implode'

# The deployed code hash, and the access keys
curl -s ${rpc(net)} -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "view_account", "finality": "final", "account_id": "${dish(net)}" }
}' | jq -r .result.code_hash

curl -s ${rpc(net)} -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "view_access_key_list", "finality": "final", "account_id": "${dish(net)}" }
}' | jq '[.result.keys[].access_key.permission]'`;
}

function txs(net: "mainnet" | "testnet") {
  const me = net === "mainnet" ? "YOU.near" : "YOU.testnet";
  const tail = `sign-as ${me} network-config ${net} sign-with-keychain send`;
  const c = dish(net);
  return `# Join with 0.02 NEAR: storage for the colony, the rest buys PETRI. color is 0xRRGGBB as a number (0xF2B45A here).
near contract call-function as-transaction ${c} join json-args '{"name":"My Colony","color":15905882,"credit":null}' prepaid-gas '300.0 Tgas' attached-deposit '0.02 NEAR' ${tail}

# Plant a block at (40, 40): cells are y * 128 + x. Attach what plant_deposit says (0.00313 NEAR for 4 cells and no note
# at the time of writing; what storage does not use goes to the vault). "slide" names a specimen to plant under its licence.
near contract call-function as-transaction ${c} plant json-args '{"cells":[5160,5161,5288,5289],"note":null,"credit":null,"slide":null}' prepaid-gas '300.0 Tgas' attached-deposit '0.00313 NEAR' ${tail}

# Buy more PETRI with 0.01 NEAR
near contract call-function as-transaction ${c} buy json-args '{"credit":null}' prepaid-gas '300.0 Tgas' attached-deposit '0.01 NEAR' ${tail}

# Collect earnings into your balance and NEAR won at tides
near contract call-function as-transaction ${c} claim json-args '{}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' ${tail}

# Step the stored board up to the clock (anyone may)
near contract call-function as-transaction ${c} advance json-args '{}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' ${tail}`;
}

export default function Page() {
  return (
    <DocPage slug="quickstart" source={[{ label: "web/src/lib/wallet.ts", path: "web/src/lib/wallet.ts" }, { label: "web/src/app/api/guest/route.ts", path: "web/src/app/api/guest/route.ts" }, { label: "scripts/verify.mjs", path: "scripts/verify.mjs" }]}>
      <H2 id="free">Play free on testnet</H2>
      <p>No wallet, no seed phrase and no gas prompt. Everything on this dish is testnet NEAR.</p>
      <Steps>
        <li>
          Open <Ext href={`${SITE}/dish?net=testnet`}>playpetri.xyz/dish?net=testnet</Ext>.
        </li>
        <li>
          Type a colony name (1 to 24 letters, digits, spaces and <C>- &apos; . &amp; ! ? _ , : ( )</C>), pick a stain and press <strong>Start my colony</strong>.
        </li>
        <li>
          Your browser makes an ed25519 key, fetches a signed challenge from <C>/api/guest</C> and solves an 18-bit proof of work bound to it (about a second). The server creates <C>g-&lt;10 hex&gt;.&lt;relayer&gt;</C> holding 0.003 NEAR for its own storage, with a function-call key that may call only the dish and only <C>join</C>, <C>buy</C>, <C>plant</C>, <C>sell</C>, <C>claim</C>, <C>advance</C>, <C>mint_slide</C> and <C>settle_pending</C>. The relayer then calls <C>sponsor</C>, which gives the guest 0.05 NEAR of credit held by the contract (less the records&rsquo; storage), kept as the relayer&rsquo;s own grant.
        </li>
        <li>
          The join itself is a NEP-366 delegate action: your browser signs it, <C>/api/relay</C> checks it and pays the gas. The 0.02 NEAR it costs comes out of your credit, passed as the <C>credit</C> argument, because a function-call key cannot attach NEAR.
        </li>
        <li>Pick a pattern, point at open agar and click to plant. Your cells earn PETRI every generation.</li>
      </Steps>
      <Callout kind="note">
        <p>
          A guest never holds NEAR it can move. What it wins at tides, its sales back to the agar and any tide bounty it earns come back as credit, which it can spend on more moves but never withdraw. The key lives only in your browser&rsquo;s storage: clear it and the colony stays on the dish, but nobody can plant for it again.
        </p>
      </Callout>

      <H2 id="wallet">Play with a NEAR wallet on mainnet</H2>
      <Callout kind="money">
        <p>Mainnet moves spend real NEAR. A join is at least 0.01 NEAR; the site attaches 0.02 by default. Gas is paid by your wallet.</p>
      </Callout>
      <Steps>
        <li>
          Open <Ext href={`${SITE}/dish?net=mainnet`}>playpetri.xyz/dish?net=mainnet</Ext>, or use the network switch in the site&rsquo;s header. Each network remembers its own wallet.
        </li>
        <li>
          Press <strong>Use my NEAR wallet instead</strong> and connect through NEAR Connect (the wallet code runs in its own sandboxed iframe).
        </li>
        <li>Name the colony and start it. Your wallet signs <C>join</C> with 0.02 NEAR attached and 300 TGas.</li>
        <li>
          Each planting attaches what <C>plant_deposit</C> returns: the storage of the planting record (with room for the colony&rsquo;s first row in the table of playing colonies) plus 0.0001 NEAR per cell. What is left after storage goes to the vault, which pays the tides.
        </li>
        <li>
          Every tide adds NEAR to what your colony can claim. Press <strong>Claim</strong> on the dish page, or call <C>claim</C>; the NEAR goes to your account, or to a payout account you set with <C>set_payout</C>.
        </li>
      </Steps>

      <H2 id="any-token">Pay with any token</H2>
      <p>
        On the mainnet dish, the join panel has <strong>Pay with any token instead</strong> and a connected wallet has <strong>Top up with any token</strong>. You choose USDC on Base, Solana or Arbitrum, ETH on Base, SOL, or BTC, and the account that will own the colony. The site asks NEAR Intents (1Click) for a quote that pays wNEAR to <C>petri-dish.near</C> with a message naming that account, and shows a deposit address. Send the tokens from any wallet on their own chain; solvers swap them, and the dish unwraps the wNEAR and joins or buys for the account named.
      </p>
      <p>
        Anyone can pay for any account, so a colony started this way has a neutral name, <C>Culture</C> and a few hex digits of its account&rsquo;s hash, in a colour from the same hash; the name and stain typed in the form are not used, and the account may <C>rename</C> it once. Nothing that arrives is ever refunded: if the payment cannot be used yet (too little NEAR to join, too little gas), it waits as pending NEAR with its order, which anyone can complete with <C>settle_pending</C> and the named account can take back with <C>claim_pending</C>. The full flow, the message format and every failure case are in <Doc to="intents">NEAR Intents</Doc>.
      </p>

      <H2 id="cli">Read the dish from the command line</H2>
      <p>
        With <Ext href="https://github.com/near/near-cli-rs">near-cli-rs</Ext> (these were run with version 0.30.1), every view is one command. Numbers come back as strings: PETRI in units of 10<sup>−6</sup>, NEAR in yoctoNEAR (10<sup>−24</sup>).
      </p>
      <NetTabs mainnet={<Code lang="sh" title="near-cli-rs, mainnet">{cliViews("mainnet")}</Code>} testnet={<Code lang="sh" title="near-cli-rs, testnet">{cliViews("testnet")}</Code>} />
      <p>
        Every view and its arguments are listed in the <Doc to="contract-api" hash="views">Contract API</Doc>. To find the flat index of a cell, use <C>y * 128 + x</C>; the board view returns the compact form described in <Doc to="verification" hash="chain">Verification</Doc>.
      </p>

      <H2 id="rpc">Read it with plain JSON-RPC</H2>
      <p>No CLI needed: a view is a <C>query</C> with <C>request_type: &quot;call_function&quot;</C>. The result is a byte array of JSON; <C>jq</C>&rsquo;s <C>implode</C> turns it back into text.</p>
      <NetTabs mainnet={<Code lang="sh" title="curl and jq, mainnet">{curlViews("mainnet")}</Code>} testnet={<Code lang="sh" title="curl and jq, testnet">{curlViews("testnet")}</Code>} />
      <p>
        The code hash printed should be <C>{CODE_HASH}</C> on both networks.
      </p>

      <H2 id="transactions">Send moves from the command line</H2>
      <p>
        The same calls the site makes, signed by your own account with a key in your keychain. Replace <C>YOU</C> with your account. Values attached are in NEAR; gas follows what the site uses (<Doc to="contract-api" hash="conventions">gas guidance</Doc>).
      </p>
      <NetTabs mainnet={<Code lang="sh" title="near-cli-rs, mainnet (real NEAR)">{txs("mainnet")}</Code>} testnet={<Code lang="sh" title="near-cli-rs, testnet">{txs("testnet")}</Code>} />
      <Callout kind="note">
        <p>
          A planting must land on the current generation and on empty cells, and one colony plants at most once a generation. If the dish is more than 120 generations behind the clock, call <C>advance</C> first; the planting itself catches up to 120. Ask <C>plant_deposit</C> for the exact deposit when you add a note: each byte of note adds storage.
        </p>
      </Callout>

      <H2 id="verify">Verify in 30 seconds</H2>
      <p>Clone the repository and replay either dish from generation zero. It needs Node 20 or later and nothing else: the engine is the prebuilt WebAssembly in <C>web/src/engine/pkg</C>.</p>
      <Code lang="sh" title="Shell">{`git clone ${REPO}
cd petri
node scripts/verify.mjs --network mainnet
node scripts/verify.mjs --network testnet
echo $?   # 0 when every check matches, 1 on any mismatch, 2 if the dish could not be read`}</Code>
      <p>
        It prints 45 rows, each <C>match</C> or <C>DIFFERS</C>. A run against mainnet at the time of writing, minutes after v6.1 started the dish again from generation 0, printed (the dish will have moved on by the time you run it):
      </p>
      <Code lang="text" title="node scripts/verify.mjs --network mainnet, at the time of writing" copy={false}>{`Replaying petri-dish.near (mainnet) at block 222964645: 14 generations, 15 ledger entries, 5 colonies, 0 tides.
  match   History chain                                0000000000000000000000000000000000000000000000000000000000000000
  match   Board hash                                   a3d8b3fb1a79f1fdcd1ac1e469e7d092a8fb773070217e620ce8d0fae7f73608
  match   Living cells                                 179
  match   Legal plantings                              5 of 5
  match   Planting prices                              5 of 5
  match   Planting fees                                5 of 5
  match   Licensed plantings: shape, holder, royalty   0 of 0
  match   Purchases on the curve                       5 of 5
  match   Sales on the curve and allowance             0 of 0
  match   Tides                                        0 of 0
  match   Claims of exactly what was owed              0 of 0
  match   Refunds tied to their payouts                0 of 0
  match   Sales for NEAR and pact payments by colonies holding no kept PETRI 0 of 0
  match   Pacts kept to the rules and plantings under pacts 0 of 0
  match   PETRI held for pact offers                   0.000000
  match   Pacts                                        0
  match   Specimens                                    0 of 0 match the dish
  match   Slide holders and royalties                  0 of 0
  match   Agar                                         999,021.052007
  match   Sold                                         1,072.032473
  match   Burned                                       93.084480
  match   Burned by specimens                          0.000000
  match   Royalties                                    0.000000
  match   Returned to the agar                         93.084480
  match   Bought back                                  0.000000
  match   Keeper share                                 0.000000
  match   Colony earnings                              5 of 5
  match   Vault (NEAR)                                 0.23761
  match   NEAR paid in                                 0.23761
  match   NEAR paid at tides                           0
  match   Vault shares, bounties as credit             0
  match   Sales paid as credit                         0
  match   Colony tide winnings                         5 of 5
  match   Credit pool                                  0
  match   Credit paid at tides                         0
  match   Credit sponsored                             0
  match   Credit spent                                 0
  match   Credit taken back                            0
  match   NEAR owed to colonies                        0
  match   Pending NEAR                                 0
  match   Colony credit winnings                       5 of 5
  match   Colony kept PETRI                            5 of 5
  match   Solvent (NEAR held >= owed, from the ledger) yes
  match   Deployed code hash                           ${CODE_HASH}
  DIFFERS  Full-access keys                             1  (expected: 0)
Source: https://github.com/RohanGlitched/petri/tree/${BUILD_COMMIT}; built with cargo near build non-reproducible-wasm --locked in sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb
Owed, from the ledger: 0.23761 NEAR (vault, credit pool, unspent credit, unclaimed winnings, pending); held beyond storage: 0.304743164372527200000003 NEAR.
  The contract account still has a full-access key: whoever holds it could deploy different code.
1 check(s) differ.`}</Code>
      <Callout kind="warn">
        <p>
          At the time of writing the verifier exits with status 1 on both networks for one reason: each contract account still has one full-access key. The other 44 rows match. The key is to be removed with the owner&rsquo;s approval before judging, and from then on the same command exits 0.
        </p>
      </Callout>
      <p>
        The same replay runs in your browser at <Ext href={`${SITE}/verify`}>playpetri.xyz/verify</Ext>. What each row means is in <Doc to="verification" hash="checks">Every check</Doc>.
      </p>

      <H2 id="tests">Run the tests</H2>
      <p>
        With Rust installed (the team runs them in WSL on Windows; any Linux or macOS shell works), from the repository root:
      </p>
      <Code lang="sh" title="Shell">{`cargo test -p petri-core -p petri-contract`}</Code>
      <Table>
        <thead>
          <tr>
            <th>Crate</th>
            <th className="n">Tests</th>
            <th>What they cover</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>petri-contract</C>
            </td>
            <td className="n">132</td>
            <td>Every method and its errors, the economy closing to the yoctoNEAR (most tests end by checking every PETRI and NEAR is accounted for), a full ledger replay, guests, credit per sponsor, the house&rsquo;s limits, slides and their licences, intents and pending orders, failed payouts, the token standards&rsquo; edge cases, the relaunch, and gas at 1,500 tide winners, at 30,000 colonies and with a full hot table.</td>
          </tr>
          <tr>
            <td>
              <C>petri-core</C>
            </td>
            <td className="n">35</td>
            <td>Life against a plain reference implementation (property tests), ownership and contested births, plant checks, the feed, the curves, tides, stake decay, slides, their SVG and their licence shape.</td>
          </tr>
        </tbody>
      </Table>
      <p>
        Both counts are of the v6.1 sources, the build both dishes run: <C>132 passed</C> and <C>35 passed</C>. To build the contract and compare its hash, see <Doc to="verification" hash="rebuild">Rebuild the wasm</Doc>.
      </p>
      <H3 id="tests-sim">The simulator</H3>
      <Code lang="sh" title="Shell">{`cd sim   # the simulator reads ../contract/launch-rules.json by default
cargo run --release -- out-v5 all     # writes out-v5/summary.txt and the CSVs
cargo run --release -- out-v5 fixes   # writes out-v5/fixes.txt
cargo run --release -- out-v6.1 all --seeds 8   # the v6.1 rules against v6: out-v6.1/summary.txt and fixes.txt`}</Code>
      <p>
        See <Doc to="simulations">Economics and simulations</Doc> for what it measures.
      </p>
    </DocPage>
  );
}
