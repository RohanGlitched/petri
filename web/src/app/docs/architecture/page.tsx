import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Doc, H2, H3, Steps, Table } from "@/components/docs/ui";
import { ArchitectureFlow } from "@/components/docs/Diagrams";
import { tree } from "@/components/docs/facts";

export const metadata = docMetadata("architecture");

export default function Page() {
  return (
    <DocPage slug="architecture" source={[{ label: "Cargo.toml", path: "Cargo.toml" }, { label: "web/src/lib/dish-store.ts", path: "web/src/lib/dish-store.ts" }, { label: "web/src/lib/wallet.ts", path: "web/src/lib/wallet.ts" }]}>
      <H2 id="overview">Overview</H2>
      <p>
        Petri is one Rust rules crate used in three places, one NEAR contract deployed twice, one Next.js site serving both dishes, and one agents process per dish. Everything that decides an outcome lives in the contract; everything else reads it, replays it or submits moves to it.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Part</th>
            <th>Runs</th>
            <th>Holds money?</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>petri-dish.near</C>, <C>petri-v6.testnet</C>
            </td>
            <td>NEAR mainnet and testnet</td>
            <td>Yes: the agar, the vault, the credit pool, every balance</td>
          </tr>
          <tr>
            <td>The site</td>
            <td>
              A Next.js standalone server behind Caddy (automatic HTTPS) on the agents&rsquo; Google Cloud VM (e2-micro, us-central1) for
              www.playpetri.xyz and docs.playpetri.xyz; reachable at 136-64-100-170.sslip.io while the domain&rsquo;s DNS moves
            </td>
            <td>No. Its server holds the testnet relayer key, which sponsors guests and pays their gas</td>
          </tr>
          <tr>
            <td>The agents</td>
            <td>The same VM, one process per dish</td>
            <td>Only the strains&rsquo; and keeper&rsquo;s own accounts</td>
          </tr>
          <tr>
            <td>NEAR Intents (1Click)</td>
            <td>Third party</td>
            <td>A payer&rsquo;s tokens while a swap is in flight</td>
          </tr>
        </tbody>
      </Table>

      <H2 id="diagram">Data flow</H2>
      <ArchitectureFlow />

      <H2 id="crates">Crates</H2>
      <p>A Cargo workspace with four members (<C>core</C>, <C>contract</C>, <C>wasm</C>, <C>sim</C>), built with LTO, one codegen unit, <C>panic = &quot;abort&quot;</C> and overflow checks on. The contract itself is built for size (<C>opt-level = &quot;z&quot;</C>), because mainnet charges storage for every byte of code; petri-core stays at <C>opt-level = 3</C>.</p>
      <Table>
        <thead>
          <tr>
            <th>Crate</th>
            <th>What it is</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>petri-core</C> (<C>core/</C>)
            </td>
            <td>
              The rules, <C>no_std</C>: the bit-sliced Life step with owners, planting checks and sieges, the feed with reach and the floor, prices, the buy and sell-back curves, the tide split, the history chain, the board&rsquo;s compact form and hash, slide bitmaps, their SVG and their licence (<C>fits_slide</C>, <C>licensed_cost</C>, <C>royalty</C>), the named patterns. Depends only on <C>sha2</C>. 35 tests, including property tests against a reference Life.
            </td>
          </tr>
          <tr>
            <td>
              <C>petri-contract</C> (<C>contract/</C>)
            </td>
            <td>
              The NEAR contract (near-sdk 5.29.1, event standard <C>petri</C> 6.2.0): state, the clock and catch-up, joins, purchases, sales, plantings, tides, claims and payouts, credit per sponsor, the ledger, each colony&rsquo;s books in cold pages and a hot table of the colonies that play now (<C>books.rs</C>), PETRI (NEP-141/145/148), slides and their licences (NEP-171/177/178/181), NEAR Intents with pending orders, and the one-off <C>relaunch</C> from v6.1 (<C>relaunch.rs</C>). 139 tests.
            </td>
          </tr>
          <tr>
            <td>
              <C>petri-wasm</C> (<C>wasm/</C>)
            </td>
            <td>
              petri-core for JavaScript through wasm-bindgen: an <C>Engine</C> that steps, feeds, plants, runs tides, checks a slide&rsquo;s pattern (<C>fits_slide</C>) and hashes exactly as the contract does, and can clone itself for forecasts (<C>clone_engine</C>), plus <C>quote</C>, <C>licence</C>, <C>buy_quote</C>, <C>sell_quote</C>, <C>slide_svg</C> and <C>pattern_cells</C>. Built by <C>scripts/build-engine.sh</C> into <C>web/src/engine/pkg</C> and <C>web/public/petri_bg.wasm</C>; the site, the agents and the CLI verifier all load it.
            </td>
          </tr>
          <tr>
            <td>
              <C>petri-sim</C> (<C>sim/</C>)
            </td>
            <td>
              The economy simulator on petri-core and the launch rules. See <Doc to="simulations">Economics and simulations</Doc>.
            </td>
          </tr>
        </tbody>
      </Table>
      <Code lang="sh" title="Build each part">{`cargo test -p petri-core -p petri-contract        # the tests
cd contract && cargo near build reproducible-wasm   # the contract, in Docker
bash scripts/build-engine.sh                       # the browser engine (needs wasm-pack and sha256sum)
cd web && npm install && npm run dev                 # the site on http://localhost:3210`}</Code>

      <H3 id="crates-storage">The contract&rsquo;s storage</H3>
      <p>
        The keys a wrong account list could leave behind when <C>relaunch</C> clears v6.3 (PETRI balances, sponsored credit, pending NEAR and the cold pages) have prefixes v6.1 never used, <C>r</C>, <C>e</C>, <C>z</C> and <C>x</C>, so none of them can be read as v6.2 state; it only keeps its storage. Everything else keeps its v6.1 key and is cleared by <C>relaunch</C> itself. Each colony&rsquo;s numbers (unclaimed earnings, NEAR won and not claimed, credit won, whether it attached NEAR, its stake, and while it plays its tide window) are in exactly one of two places: a 69-byte slot in a cold page of 32 colonies, or the hot table of the colonies that play now (at most 10,000). A join appends one slot to the last cold page; the feed, tides and decay read and write only the hot table, so no call costs more as more colonies join.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Holds</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["STATE", "The contract's own fields: rules, clock, counters"],
            ["board", "The board in compact form"],
            ["C", "Colonies (a vector)"],
            ["F", "Colony id by account"],
            ["A", "Colony names in use, lower-cased"],
            ["L", "The ledger"],
            ["I", "The planting index (ledger positions of Plant entries, u32; 49 bytes a planting)"],
            ["V + page (u32)", "The tide index: ledger positions of Tide entries, 4 bytes each, 256 to a key"],
            ["r", "PETRI balances (NEP-141 registrations)"],
            ["e", "Sponsored credit: each account's grants, one per sponsor"],
            ["D", "Specimen slides"],
            ["T", "Each owner's slides, for enumeration"],
            ["z", "Pending NEAR, with the order it may still be spent on"],
            ["P + id (u32)", "A pact: from, to, PETRI, offered, until, accepted, ended (75 bytes with key and record)"],
            ["Q + colony id (u16)", "A colony's live pacts (4 bytes a pact; 47 for a new list)"],
            ["x + page (u16)", "Cold pages of 32 colonies each, 69 bytes a colony (its numbers, its stake and the tide count the stake was last decayed at)"],
            ["h", "The hot table's feed part: id, stake, window, earnings (26 bytes a row); every catch-up rewrites it"],
            ["j", "The hot table's purse part: id, NEAR owed, credit won and held, attached (51 bytes a row); only tides and a playing colony's own moves rewrite it"],
            ["N + ledger index (u32)", "Lab notes (5-byte keys)"],
          ].map(([k, v]) => (
            <tr key={k}>
              <td>
                <C>{k}</C>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="site">The site</H2>
      <p>
        Next.js 16 with React 19, in <C>web/</C>. One deployment serves both dishes: which one a visitor reads is chosen in the browser by <C>?net=testnet</C> or <C>?net=mainnet</C>, then remembered; switching reloads the page so every reader, wallet and cache starts on the new network. The server always sees the default (testnet) dish.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Page</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["/", "The home page"],
            ["/dish", "The live dish: join, plant with stamps, buy, sell, claim, fossilize, pay with any token"],
            ["/rules", "How it works, with live rule demos"],
            ["/colonies", "Every colony and its numbers"],
            ["/specimens, /specimens/[id]", "The slides, drawn with slide_svg; replant a pattern"],
            ["/records", "The dish's high scores, from a replay of the ledger in the browser"],
            ["/strains", "The house strains, their log, their plantings and the mainnet house's runway"],
            ["/verify", "The full replay in the browser"],
            ["docs.playpetri.xyz", "These docs (app/docs, rewritten from the docs host by src/proxy.ts)"],
          ].map(([p, w]) => (
            <tr key={p}>
              <td>
                <C>{p}</C>
              </td>
              <td>{w}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        A player is either a <strong>wallet</strong> connected through NEAR Connect (<C>@hot-labs/near-connect</C>), which signs and pays for its own transactions, or a <strong>guest</strong>: a key made in the browser, kept in its local storage, for a testnet account the site creates. Guests exist only on testnet.
      </p>

      <H2 id="api">Server routes</H2>
      <Table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>GET /api/guest</C>
            </td>
            <td>A signed challenge for the guest proof of work (testnet only)</td>
          </tr>
          <tr>
            <td>
              <C>POST /api/guest</C>
            </td>
            <td>
              Checks the proof of work and creates <C>g-&lt;hash&gt;.&lt;relayer&gt;</C> with 0.003 NEAR and a function-call key for the dish, then sponsors it with 0.05 NEAR of credit
            </td>
          </tr>
          <tr>
            <td>
              <C>POST /api/relay</C>
            </td>
            <td>Checks a guest&rsquo;s signed delegate action (NEP-366) and submits it, paying the gas</td>
          </tr>
          <tr>
            <td>
              <C>/api/intents/quote</C>, <C>status</C>, <C>submit</C>, <C>tokens</C>
            </td>
            <td>
              1Click quotes that can only pay <C>petri-dish.near</C>, swap status and prices. See <Doc to="intents" hash="routes">NEAR Intents</Doc>
            </td>
          </tr>
          <tr>
            <td>
              <C>GET /api/strains?net=…</C>
            </td>
            <td>The agents&rsquo; log window for that dish, over HTTPS</td>
          </tr>
        </tbody>
      </Table>

      <H2 id="agents">Agents and the VM</H2>
      <p>
        <C>agents/run.mjs</C>, one process per dish on a VM, plays the five house strains and the keeper (and the bench on testnet). It reads the chain over JSON-RPC, steps the dish with the same engine, forecasts every candidate move 240 generations ahead on a cloned engine (<C>forecast.mjs</C>), keeps each strain&rsquo;s memory of its moves and their measured outcomes (<C>memory.mjs</C>), holds a council of the strains once per tide window where they negotiate pacts and make them on chain with <C>pact_offer</C> and <C>pact_accept</C> (<C>council.mjs</C>), asks Claude Haiku or NEAR AI Cloud to pick among rule-checked moves, signs with each account&rsquo;s own key, and serves a read-only log on port 8790 (testnet) or 8791 (mainnet). Details in <Doc to="ai-strains">AI strains</Doc>.
      </p>

      <H2 id="reads">How the site reads the dish</H2>
      <Steps>
        <li>
          <C>web/src/lib/chain.ts</C> calls views over JSON-RPC with failover between providers (FastNEAR first, then near.org).
        </li>
        <li>
          <C>web/src/lib/dish-store.ts</C> loads <C>rules</C>, <C>state</C>, <C>colonies</C>, <C>board</C>, <C>stakes</C>, <C>earnings</C> and the latest plantings, puts the stored board into the engine and steps it to the generation the clock says is due. It ticks every 250 ms and polls the chain every 5 seconds; when the plant log grows it reloads the board and steps forward again.
        </li>
        <li>
          The header shows how many generations the browser is ahead of the stored board. The site&rsquo;s cells, earnings and prices are what the contract will compute when someone next advances it.
        </li>
        <li>
          <C>/verify</C> pins every read to one final block and replays from generation zero (<C>web/src/lib/replay.ts</C>).
        </li>
      </Steps>

      <H2 id="writes">How a move reaches the chain</H2>
      <H3 id="writes-wallet">A wallet</H3>
      <p>
        <C>web/src/lib/wallet.ts</C> builds one <C>FunctionCall</C> to the dish with the method&rsquo;s gas and deposit, and the wallet signs and sends it. The page reads the outcome and shows the contract&rsquo;s panic message, if any, in plain words.
      </p>
      <H3 id="writes-guest">A guest</H3>
      <p>
        The browser signs a NEP-366 delegate action with the guest&rsquo;s key, valid for 120 blocks, with any deposit moved into the <C>credit</C> argument (a function-call key cannot attach NEAR). <C>/api/relay</C> checks it and submits it inside a transaction from the relayer, which pays the gas.
      </p>
      <H3 id="writes-intents">Any token</H3>
      <p>
        The page gets a deposit address from <C>/api/intents/quote</C>; the payer sends tokens on their own chain; NEAR Intents delivers wNEAR to the mainnet dish with a message, and the contract joins or buys for the account it names.
      </p>
      <H3 id="writes-agents">The agents</H3>
      <p>
        Each strain and the keeper sign with keys on the VM. On testnet those are function-call keys for the dish that pay with credit; their method lists must include <C>pact_offer</C>, <C>pact_accept</C> and <C>pact_cancel</C> (or be empty) for the council&rsquo;s pacts. On mainnet the strains attach their own NEAR for the offer&rsquo;s storage. A pact needs no 1 yoctoNEAR transfer: the PETRI moves inside the contract.
      </p>

      <H2 id="repo">Repository map</H2>
      <Code lang="text" title="github.com/RohanGlitched/petri" copy={false}>{`core/            petri-core: the rules (lib.rs) and their tests (tests.rs)
contract/        the NEAR contract: lib.rs (dish, economy, views), books.rs (cold pages, hot table), token.rs,
                 slides.rs, intents.rs, relaunch.rs, tests.rs
  launch-rules.json            testnet rules (petri-v6.testnet)
  launch-rules-mainnet.json    mainnet rules (petri-dish.near)
wasm/            petri-core for the browser (wasm-bindgen)
sim/             the economy simulator; out-v6.1/ holds its latest results (on the v6.1 rules and v6's, same seeds), out-v5/ the v5 ones
scripts/         verify.mjs (the CLI replay), build-engine.sh
agents/          run.mjs (keeper and strains), council.mjs, forecast.mjs, memory.mjs, model.mjs,
                 strategies.mjs, lib.mjs
web/             the site and these docs (Next.js 16)
  src/app/(site)/     the pages
  src/app/docs/       the documentation
  src/app/api/        guest, relay, intents, strains
  src/lib/            chain reads, replay, wallet, intents, config
  src/engine/pkg/     the built engine
  src/proxy.ts        serves docs.playpetri.xyz
README.md, RULES.md, LICENSE (MIT)`}</Code>
      <p>
        Browse it on <a href={tree("")}>GitHub</a>.
      </p>
    </DocPage>
  );
}
