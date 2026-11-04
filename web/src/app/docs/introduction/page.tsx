import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C } from "@/components/docs/Code";
import { Callout, Doc, Ext, H2, Table } from "@/components/docs/ui";
import { BUILD_COMMIT_SHORT, CODE_HASH, DISH, REPO, SITE, account } from "@/components/docs/facts";
import { DishSketch } from "@/components/docs/Diagrams";
import { docHref } from "@/components/docs/nav";

export const metadata = docMetadata("introduction");

export default function Page() {
  return (
    <DocPage
      slug="introduction"
      lede={
        <>
          Petri is a coin that is alive. One NEAR contract runs Conway&rsquo;s Game of Life on a 128 × 128 dish that wraps at its edges, and every living cell belongs to a NEAR account. The coin, PETRI, feeds the cells that are alive, and the NEAR players bring is paid back out to the colonies that grow.
        </>
      }
      source={[
        { label: "core/src/lib.rs", path: "core/src/lib.rs" },
        { label: "contract/src/lib.rs", path: "contract/src/lib.rs" },
      ]}
    >
      <DishSketch />

      <H2 id="what-it-is">What Petri is</H2>
      <p>
        A <strong>colony</strong> is a NEAR account that has joined the dish. It plants cells, and from then on the cells follow Life&rsquo;s rules (B3/S23) on their own: a dead cell with exactly three living neighbours is born, a living cell with two or three survives, everything else dies. A cell that is born joins the colony that owns most of its three parents; when all three parents belong to different colonies the birth does not happen. That one rule turns Life into a territory game where gliders convert what they hit and borders are fought over.
      </p>
      <p>
        <strong>PETRI</strong> is a NEP-141 token with 6 decimals and a fixed supply of 1,000,000. All of it is minted once, at launch, into the <strong>agar</strong>: the contract&rsquo;s own reserve. Every generation (15 seconds) the agar pays 3 parts per million of itself to the living, split by each colony&rsquo;s living cells, capped by how much it has planted. Planting costs PETRI at a price that tracks what a cell earns; half of it is burned and half goes back to the agar.
      </p>
      <p>
        NEAR enters when a colony joins, buys PETRI or plants, and collects in a <strong>vault</strong>. Every 240 generations (an hour) a <strong>tide</strong> pays 5% of the vault to the colonies, split by what each earned from the feed since the last tide. Colonies outside the house can also sell PETRI back to the agar for NEAR, at half the curve&rsquo;s price.
      </p>
      <p>
        A colony can fix a rectangle of its own living cells as a <strong>specimen slide</strong>: a NEP-171 NFT whose SVG image the contract draws from the captured cells. A slide of at least 12 cells is a pattern licence: its exact pattern, planted anywhere, costs 25% less, and anyone but its holder pays the holder a 10% royalty in PETRI (a planter that has not attached NEAR, or holds more kept PETRI than the planting costs, pays the agar instead). Players can pay with almost any token through <strong>NEAR Intents</strong>, and on testnet anyone can play free as a <strong>guest</strong>. Five <strong>AI strains</strong> play as house colonies around the clock: each forecasts its candidate plantings on a copy of the dish, remembers what its moves really did, and meets the others once a tide window to negotiate pacts: PETRI paid, on chain, for a promise the contract enforces. And everything, every cell and every yoctoNEAR, can be replayed from the contract&rsquo;s ledger in a browser or from the command line.
      </p>

      <H2 id="different">What makes it different</H2>
      <ul>
        <li>
          <strong>The game is the token&rsquo;s monetary policy.</strong> There is no team allocation and no mint function. Supply only falls (plantings, slides and forced unregistrations burn), and the only way PETRI leaves the agar is the feed (with the keeper&rsquo;s share) and purchases, all set by the parameters fixed at launch. No method changes a parameter of a running dish; the one way to start over, <C>relaunch</C>, is private to the contract account&rsquo;s own key and refuses a dish that already runs v6.
        </li>
        <li>
          <strong>One engine, three places.</strong> The rules live in one <C>no_std</C> Rust crate, <C>petri-core</C>. The contract runs it, the browser runs it compiled to WebAssembly, and the economy simulator runs it natively. The replay cannot drift from the contract because it is the same code.
        </li>
        <li>
          <strong>Every claim can be checked.</strong> <C>node scripts/verify.mjs</C> reads the contract at one finalized block, replays the whole ledger from generation zero and prints forty-five checks: the history chain, the board hash, every planting&rsquo;s price and licence, every tide&rsquo;s split, every claim and refund, that no colony holding kept PETRI sold for NEAR, every pact, the agar, the vault, every credit counter, every colony&rsquo;s earnings, and that the contract holds the NEAR it owes, each term rebuilt from the ledger alone. See <Doc to="verification">Verification</Doc>.
        </li>
        <li>
          <strong>Free play cannot leak NEAR.</strong> A guest plays on sponsored credit through a function-call key and a relayer. Whatever it wins comes back as credit that can only be spent in the dish, never as NEAR; a guest cannot send PETRI; and PETRI earned before a colony&rsquo;s first NEAR (or bought with credit) is kept: it cannot be sold for NEAR or sent until it has been planted. See <Doc to="economy" hash="kept">Kept PETRI</Doc> and <Doc to="economy" hash="credit">Credit</Doc>.
        </li>
        <li>
          <strong>The house never profits.</strong> The AI strains and the keeper are named in the rules as house accounts: the strains are never fed and take no share of any tide, no house account sells PETRI back, passes PETRI to a player, takes a tide bounty or takes the keeper pot, so every NEAR they spend ends up with the other players.
        </li>
      </ul>

      <H2 id="tour">A 60-second tour</H2>
      <ol>
        <li>
          Open <Ext href={`${SITE}/dish`}>the dish</Ext>. The board you see is the contract&rsquo;s stored board stepped forward to the current generation by the same engine in your browser.
        </li>
        <li>Type a colony name, pick a stain and start a colony. On testnet the site makes you a guest account with no wallet; on mainnet you connect a NEAR wallet.</li>
        <li>Pick a pattern (a block, a glider, a pulsar), point at open agar and click. Before you sign, the page checks the planting with petri-core exactly as the contract will: it says where it fits, refuses an illegal one, and marks a planting inside a rival&rsquo;s buffer as a siege at three times the price.</li>
        <li>Watch it live. Your cells earn PETRI every generation, up to a cap set by how much you have planted. Every 240 generations (an hour) a tide pays NEAR, or credit for a guest.</li>
        <li>
          Open <Ext href={`${SITE}/verify`}>/verify</Ext> and replay the whole dish in your browser. Every row should say it matches, except one: the contract account still holds a full-access key (see below).
        </li>
      </ol>

      <H2 id="dishes">The two dishes</H2>
      <p>
        The same build, v6.2, runs on both networks. Both contract accounts report the code hash <C>{CODE_HASH}</C>, which is what <C>cargo near build reproducible-wasm</C> produces at commit <Ext href={`${REPO}/tree/${BUILD_COMMIT_SHORT}`}>{BUILD_COMMIT_SHORT}</Ext>. Both dishes were relaunched in place from generation zero on the accounts they ran v6 and v6.1 on: <C>petri-dish.near</C>, and <C>petri-v6.testnet</C>, which v6 started on a new account (<C>petri-v5.testnet</C> is abandoned). The rules differ only in who the house and the keeper are and which wNEAR contract is trusted.
      </p>
      <Table caption="The dishes as deployed">
        <thead>
          <tr>
            <th></th>
            <th>Mainnet</th>
            <th>Testnet</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Contract</th>
            <td>
              <a href={account("mainnet", DISH.mainnet.contract)}>
                <C>{DISH.mainnet.contract}</C>
              </a>
            </td>
            <td>
              <a href={account("testnet", DISH.testnet.contract)}>
                <C>{DISH.testnet.contract}</C>
              </a>
            </td>
          </tr>
          <tr>
            <th>Play</th>
            <td>
              <a href={DISH.mainnet.play}>playpetri.xyz/dish?net=mainnet</a>
            </td>
            <td>
              <a href={DISH.testnet.play}>playpetri.xyz/dish?net=testnet</a>
            </td>
          </tr>
          <tr>
            <th>Who plays</th>
            <td>NEAR wallets, and any token through NEAR Intents</td>
            <td>Guests on sponsored credit, wallets, the bench</td>
          </tr>
          <tr>
            <th>Rules file</th>
            <td>
              <a href={`${REPO}/blob/main/${DISH.mainnet.rules}`}>
                <C>{DISH.mainnet.rules}</C>
              </a>
            </td>
            <td>
              <a href={`${REPO}/blob/main/${DISH.testnet.rules}`}>
                <C>{DISH.testnet.rules}</C>
              </a>
            </td>
          </tr>
          <tr>
            <th>House strains</th>
            <td>
              <C>violet</C>, <C>safranin</C>, <C>methylene</C>, <C>malachite</C>, <C>congo</C> <C>.petri-dish.near</C>
            </td>
            <td>
              <C>petri-violet</C>, <C>petri-safranin</C>, <C>petri-methylene</C>, <C>petri-malachite</C>, <C>petri-congo</C> <C>.testnet</C>
            </td>
          </tr>
          <tr>
            <th>Keeper</th>
            <td>
              <C>{DISH.mainnet.keeper}</C>
            </td>
            <td>
              <C>{DISH.testnet.keeper}</C>
            </td>
          </tr>
          <tr>
            <th>wNEAR</th>
            <td>
              <C>wrap.near</C>
            </td>
            <td>
              <C>wrap.testnet</C>
            </td>
          </tr>
          <tr>
            <th>Bench colonies</th>
            <td>none</td>
            <td>
              <C>petri-bench-a</C>, <C>-b</C>, <C>-c</C> <C>.testnet</C>: test colonies with their own NEAR, fed and paid like any player
            </td>
          </tr>
        </tbody>
      </Table>
      <Callout kind="warn">
        <p>
          Both contract accounts still hold one full-access key, so whoever holds it could deploy different code. It is to be deleted with the owner&rsquo;s approval before judging; until then the verifier reports <C>Full-access keys 1 (expected: 0)</C> and exits with status 1. <Doc to="verification" hash="keys">Check the keys yourself</Doc>.
        </p>
      </Callout>

      <H2 id="glossary">Words used in these docs</H2>
      <Table>
        <thead>
          <tr>
            <th>Word</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr><th>Dish</th><td>The 128 × 128 board (16,384 cells) and the contract that runs it. It wraps: a glider leaving the right edge comes back on the left.</td></tr>
          <tr><th>Generation</th><td>One step of Life. The clock makes one due every 15 seconds; anyone&rsquo;s transaction steps the stored board up to the clock.</td></tr>
          <tr><th>Colony</th><td>A NEAR account that joined. It has a name, a stain (colour) and an id from 1 upward.</td></tr>
          <tr><th>Agar</th><td>The PETRI the contract holds itself. It sells PETRI, feeds the living and buys PETRI back.</td></tr>
          <tr><th>Feed</th><td>What the agar pays each generation: 3 ppm of itself, 2% of that to the keeper pot and the rest to colonies by weight.</td></tr>
          <tr><th>Stake</th><td>Cells a colony has planted, kept in thousandths and decayed to 87.5% at every tide. It caps what the colony is paid for.</td></tr>
          <tr><th>Reach</th><td>8: a colony is paid for at most 8 living cells per cell of stake.</td></tr>
          <tr><th>Buffer</th><td>The 3 cells around every living cell. Planting inside a rival&rsquo;s buffer is a siege and costs 3 times as much.</td></tr>
          <tr><th>Vault</th><td>NEAR that players attached, after storage. Tides and sales back are paid from it.</td></tr>
          <tr><th>Credit pool</th><td>Sponsored or won credit that has been spent in the dish. Tides pay from it as credit only.</td></tr>
          <tr><th>Credit</th><td>NEAR held by the contract that one account can spend only on moves in the dish. Sponsored credit comes from a sponsor; won credit comes from tides, sales and bounties of a colony that never attached NEAR.</td></tr>
          <tr><th>Guest</th><td>A testnet account the site makes for a browser key, with a function-call key for the dish and 0.05 NEAR of sponsored credit.</td></tr>
          <tr><th>Tide</th><td>Every 240 generations, when some non-house colony earned since the last one: 5% of the vault and of the credit pool, split by those earnings.</td></tr>
          <tr><th>House</th><td>The dish&rsquo;s own accounts, named in the rules: the five AI strains (<C>house</C>) and the keeper (<C>keepers</C>). Never fed, no tide shares, no tide bounty or keeper pot, never sell PETRI back, send PETRI only to each other, and their cells never make a siege.</td></tr>
          <tr><th>Keeper</th><td>Whoever advances the clock. The keeper pot (2% of every feed) goes to the account whose call ran at least one generation (<C>advance</C>, or any call that catches the dish up), and tides pay their caller a bounty, unless the caller is a house account. The dish&rsquo;s own keeper (<C>keeper.petri-dish.near</C>, <C>petri-keeper.testnet</C>) advances it and is paid nothing for it: the bounties of its tides stay in the vault and the pot waits for another caller.</td></tr>
          <tr><th>Slide</th><td>A specimen: a NEP-171 token fixing a rectangle of one colony&rsquo;s own living cells at one generation, and, from 12 cells up, a licence to plant that exact pattern for 25% less; anyone but its holder also pays the holder a 10% royalty (to the agar, from a planter that has never attached NEAR).</td></tr>
          <tr><th>Ledger</th><td>Every join, purchase, planting, sale, tide, skip, refund, slide, sponsorship, claim, pending movement and burn, in order. Replaying it reproduces the dish, every balance and every term of the solvency check.</td></tr>
        </tbody>
      </Table>

      <H2 id="next">Where to go next</H2>
      <div className="d-cards">
        <a className="d-card" href={docHref("quickstart")}>
          <strong>Quickstart</strong>
          <span>Play free, play with a wallet, read the dish from the CLI and verify it.</span>
        </a>
        <a className="d-card" href={docHref("rules")}>
          <strong>Rules reference</strong>
          <span>Every parameter and every formula, taken from petri-core.</span>
        </a>
        <a className="d-card" href={docHref("contract-api")}>
          <strong>Contract API</strong>
          <span>Every method and view, with deposits, gas, errors and events.</span>
        </a>
        <a className="d-card" href={docHref("verification")}>
          <strong>Verification</strong>
          <span>Rebuild the wasm, compare the hash and replay the ledger.</span>
        </a>
        <a className="d-card" href={docHref("security")}>
          <strong>Security model</strong>
          <span>Each threat, its defense and the test that covers it.</span>
        </a>
        <a className="d-card" href={docHref("simulations")}>
          <strong>Economics and simulations</strong>
          <span>Who wins and who loses money, from the simulator.</span>
        </a>
      </div>
    </DocPage>
  );
}
