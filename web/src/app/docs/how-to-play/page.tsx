import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Ext, H2, H3, Table } from "@/components/docs/ui";
import { SITE } from "@/components/docs/facts";

export const metadata = docMetadata("how-to-play");

const PATTERNS: [string, string, number, string][] = [
  ["block", "Block", 4, "Still life. The cheapest way to hold ground; it never moves or changes."],
  ["beehive", "Beehive", 6, "Still life, a little wider than a block."],
  ["loaf", "Loaf", 7, "Still life."],
  ["blinker", "Blinker", 3, "Oscillates with period 2 between a row and a column."],
  ["toad", "Toad", 6, "Oscillates with period 2."],
  ["pulsar", "Pulsar", 48, "Oscillates with period 3; 48 cells, one of the largest stamps."],
  ["glider", "Glider", 5, "Travels one cell diagonally every four generations. Births where it lands join its colony when it outnumbers the cells it meets."],
  ["lwss", "Lightweight spaceship", 9, "Travels in a straight line, two cells every four generations."],
  ["eater", "Eater", 7, "Still life that absorbs gliders that hit it the right way."],
  ["r-pentomino", "R-pentomino", 5, "Five cells that grow chaotically for a long time before settling."],
  ["gosper-gun", "Gosper glider gun", 36, "Fires a glider every 30 generations, forever, until something breaks it."],
];

export default function Page() {
  return (
    <DocPage slug="how-to-play" source={[{ label: "contract/src/lib.rs", path: "contract/src/lib.rs" }, { label: "core/src/lib.rs", path: "core/src/lib.rs" }]}>
      <H2 id="dish">The dish and its clock</H2>
      <p>
        The dish is 128 cells wide and 128 high, 16,384 cells in all, and it wraps: the top edge meets the bottom and the left meets the right. A cell is addressed by its flat index <C>y * 128 + x</C>.
      </p>
      <p>
        The clock makes one generation due every 15 seconds since launch (5,760 a day). The contract does not step by itself: any transaction that touches the dish (a join, a purchase, a planting, a sale, a claim, a slide or <C>advance</C>) first steps the stored board up to the clock, at most 120 generations per call. Between transactions the site runs the same engine in your browser, so what you see is the board the contract will reach.
      </p>

      <H2 id="join">Join</H2>
      <p>
        <C>join(name, color, credit)</C> makes the calling account a colony, once per account. It needs at least 0.01 NEAR, attached or taken from credit. The colony&rsquo;s storage (its record, its name, its balance, its slot in a cold page, the join entry and the purchase entry) comes out of that, and the rest buys PETRI from the agar at the current price. On testnet the house strains joined with 0.05 NEAR of credit each and 0.0426 to 0.0431 NEAR of it was left to buy with, so a join&rsquo;s storage is about 0.007 NEAR (it depends on the account&rsquo;s length); the site attaches 0.02 NEAR.
      </p>
      <ul>
        <li>
          A name is 1 to 24 characters of ASCII letters, digits, spaces and <C>- &apos; . &amp; ! ? _ , : ( )</C>, with runs of spaces folded to one. Names are unique, ignoring case. Names of the form <C>Culture &lt;hex digits&gt;</C> are kept for colonies someone else paid to start (see <Doc to="intents">Pay with any token</Doc>), and nobody can choose one.
        </li>
        <li>
          A colour is <C>0xRRGGBB</C>, sent as a number (<C>15905882</C> is <C>0xF2B45A</C>).
        </li>
        <li>Colonies are numbered from 1 in the order they join. The id is what the board stores in each cell.</li>
      </ul>

      <H2 id="planting">Planting</H2>
      <p>
        <C>plant(cells, note, credit, slide)</C> brings 1 to 64 cells to life at once. It succeeds only when every cell is on the dish, empty and listed once, the stored board is at the current generation, and the colony has not already planted in this generation. If 10,000 colonies are playing at once (the most the dish holds) and none can leave the table yet, a colony that is not playing yet has to wait for the next tide to plant. With <C>slide</C> (a token id) the planting is made under that specimen slide&rsquo;s licence; see <a href="#replant">Replanting a slide</a>.
      </p>
      <Table>
        <thead>
          <tr>
            <th>It costs</th>
            <th>Where it goes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              PETRI: the cell price times the number of cells, times 3 for a siege, and 25% less under a slide&rsquo;s licence. At launch, with the agar full, one cell costs 1.41 PETRI.
            </td>
            <td>Half is burned; half goes back to the agar. Unclaimed earnings are claimed first and count toward it. Under a licence, a planter that does not hold the slide also pays the holder a 10% royalty on top.</td>
          </tr>
          <tr>
            <td>
              NEAR: the storage of the planting record (and, for a colony&rsquo;s first planting since it last played, its 77-byte row in the hot table) plus 0.0001 NEAR per cell. For a 4-cell planting with no note that is 0.00313 NEAR (<C>plant_deposit</C>).
            </td>
            <td>Storage pays for the record. Everything else, including anything attached beyond the deposit, goes to the vault (or, from credit, to the credit pool). Nothing is sent back.</td>
          </tr>
        </tbody>
      </Table>
      <p>
        A planting also adds the cells to the colony&rsquo;s stake (see <a href="#reach">Reach and stake</a>). An optional lab note of up to 140 characters is stored with it and returned by the <C>plants</C> view, which the dish page reads for its lab log; it may not contain control, direction, invisible or tag characters.
      </p>
      <p>
        The cell price follows the feed: it is what one counted cell earns in 480 generations (two hours) at today&rsquo;s feed, never less than 0.5 PETRI. A planting pays for itself only if its cells live about that long and keep within the colony&rsquo;s cap. The exact formula is in the <Doc to="rules" hash="price">Rules reference</Doc>.
      </p>

      <H2 id="patterns">Patterns</H2>
      <p>
        The site&rsquo;s stamps come from <C>petri_core::patterns</C>, the same list the strains and the tests use. Any shape of up to 64 cells can be planted; these are the named ones. On the dish page, R rotates the stamp and F flips it; a turned or flipped specimen is a different pattern, so it plants without the slide&rsquo;s licence.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Name</th>
            <th className="n">Cells</th>
            <th>Behaviour</th>
          </tr>
        </thead>
        <tbody>
          {PATTERNS.map(([id, name, n, what]) => (
            <tr key={id}>
              <td>
                {name} <C>{id}</C>
              </td>
              <td className="n">{n}</td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="buffer">The buffer and sieges</H2>
      <p>
        Every living cell has a buffer of 3: the 7 × 7 square around it, wrapping at the edges. A planting with any cell inside a rival&rsquo;s buffer is a <strong>siege</strong>. It is allowed, and the ledger marks it, but it costs 3 times the price. Ground near a rival is never closed, only dearer.
      </p>
      <ul>
        <li>Your own cells never make a siege, however close.</li>
        <li>House cells (the AI strains) never make a siege for anyone, so the house can never wall a newcomer out.</li>
        <li>
          Ask the price either way with <C>quote(cells, siege, licensed)</C>; the site checks the spot with the same petri-core function the contract uses and shows the siege price before you sign.
        </li>
      </ul>

      <H2 id="births">Births, deaths and contested ground</H2>
      <p>
        Life&rsquo;s rule is standard B3/S23. A living cell with two or three living neighbours survives and keeps its owner. A dead cell with exactly three living neighbours is born, and its owner is decided by its three parents:
      </p>
      <Table>
        <thead>
          <tr>
            <th>Parents</th>
            <th>The new cell</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>All three from colony A</td>
            <td>Belongs to A</td>
          </tr>
          <tr>
            <td>Two from A, one from B</td>
            <td>Belongs to A</td>
          </tr>
          <tr>
            <td>One each from A, B and C</td>
            <td>Is not born: the birth is contested and the cell stays empty</td>
          </tr>
        </tbody>
      </Table>
      <p>
        So a glider that runs into a rival&rsquo;s colony converts cells where it outnumbers them, and where three colonies meet, nothing grows. Deaths free the cell; the next birth there may belong to anyone.
      </p>

      <H2 id="feeding">Feeding</H2>
      <p>
        Every generation the agar releases 3 parts per million of itself (3 PETRI a generation while it holds 1,000,000). Two percent of that goes to the keeper pot. The rest is split between living colonies by weight: each colony&rsquo;s living cells, capped by its reach. House colonies are never fed.
      </p>
      <p>
        The agar releases its full ration only when at least 1,000 cells are counted. With fewer, it releases the same amount per cell as it would for 1,000 and keeps the rest, so a cell never earns more than its price assumes. A dish with only house cells is fed nothing.
      </p>
      <p>
        What a colony earns waits in the contract as unclaimed earnings. It counts toward the next planting or slide automatically, and <C>claim</C> moves it into the colony&rsquo;s PETRI balance.
      </p>

      <H2 id="reach">Reach and stake</H2>
      <p>
        A colony is paid for at most 8 living cells per cell of <strong>stake</strong>. Stake is the cells it has planted, kept in thousandths, and every tide keeps only 87.5% of it. So pay is rent: to keep earning on ground you hold, you plant again now and then. Splitting into many colonies never helps, because the caps add up to exactly what one colony with the same stake would have.
      </p>
      <Table caption="A colony that plants one block (4 cells) and nothing else">
        <thead>
          <tr>
            <th>After tide</th>
            <th className="n">Stake (thousandths)</th>
            <th className="n">Most living cells paid for</th>
          </tr>
        </thead>
        <tbody>
          {[
            [0, 4000, 32],
            [1, 3500, 28],
            [2, 3062, 24],
            [3, 2679, 21],
            [4, 2344, 18],
            [5, 2051, 16],
          ].map(([t, s, c]) => (
            <tr key={t}>
              <td>{t === 0 ? "planted" : t}</td>
              <td className="n">{s.toLocaleString("en-US")}</td>
              <td className="n">{c}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        The view <C>stakes</C> returns every colony&rsquo;s stake, 2,000 colonies a call. Stake halves in a little over five tides (about five hours).
      </p>

      <H2 id="tides">Tides</H2>
      <p>
        Every 240 generations (one hour), if any colony outside the house earned from the feed since the last tide, the tide runs inside whichever transaction catches the dish up past that generation:
      </p>
      <ol>
        <li>It records the history chain at that generation in the ledger.</li>
        <li>
          It takes 5% of the vault. 1% of that, at most 0.001 NEAR, is a bounty for the caller whose transaction ran the tide, unless that caller is a house strain or keeper, when the bounty stays in the vault; the tide&rsquo;s own ledger entry is paid for; the rest is split by what each colony earned from the feed since the last tide.
        </li>
        <li>
          A colony that has ever attached NEAR itself receives its share as NEAR it can claim. A colony that never has (a guest) receives it as credit.
        </li>
        <li>It takes 5% of the credit pool and splits it the same way, as credit.</li>
        <li>Every colony&rsquo;s stake decays to 87.5%, the earnings window resets, and the sale allowance reopens at 10% of the vault.</li>
      </ol>
      <p>
        A tide with nobody to pay is skipped completely: no entry, no decay, and the allowance stays as it was. Because shares follow earnings over the whole hour, a colony that appears just before a tide gets only its few generations&rsquo; worth.
      </p>

      <H2 id="claiming">Claiming</H2>
      <p>
        <C>claim()</C> moves the colony&rsquo;s unclaimed PETRI into its balance and sends the NEAR it has won at tides to its account, or to the payout account set with <C>set_payout</C> (only a colony that has attached NEAR can set one, and never the dish itself). The claim&rsquo;s own <C>Claim</C> entry is paid from the NEAR, so winnings too small to cover it and a possible refund (about 0.0034 NEAR) stay owed until they grow. If the transfer fails, the NEAR becomes pending NEAR for the colony&rsquo;s account, which it takes with <C>claim_pending</C>. Credit won needs no claim: it is spendable as soon as the tide runs. Check what is waiting with <C>claimable(account_id)</C>.
      </p>

      <H2 id="selling">Selling back</H2>
      <p>
        <C>sell(petri)</C> hands PETRI back to the agar for NEAR from the vault. The agar pays half of the curve&rsquo;s price at the midpoint of the move, and never more than those units&rsquo; share of the vault (vault × units ÷ all PETRI outside the agar). The sale&rsquo;s ledger record is paid for out of the proceeds; a sale paid in NEAR must also be big enough to pay for a refund&rsquo;s records (0.00239 NEAR), and if its transfer fails the NEAR becomes pending for the seller.
      </p>
      <ul>
        <li>House colonies cannot sell: the vault is the players&rsquo;.</li>
        <li>
          Between two tides the agar buys back at most 10% of the vault. The allowance is set at each tide, so <strong>no sales are possible before the first tide</strong>; <C>state().sell_left</C> says how much is left.
        </li>
        <li>A colony that has never attached NEAR is paid in credit, not NEAR.</li>
        <li>
          <strong>Kept PETRI cannot be sold for NEAR.</strong> PETRI you earned before your colony&rsquo;s first NEAR, and PETRI you bought with credit, is kept: while you hold any, <C>sell</C> for NEAR is refused (and so is sending PETRI, and a guest can never send PETRI). Plant it: plantings and slides spend kept PETRI first, and once it is gone what you hold and what you earn afterwards is sellable. A guest can still sell back for credit. See <Doc to="economy" hash="kept">Kept PETRI</Doc>.
        </li>
        <li><C>sell</C> claims your waiting earnings first, so they count toward what you hold.</li>
        <li>Buying and selling straight back always loses: the sell price is half the curve and the curve moves against you both ways.</li>
        <li>The dish page sells 20 PETRI at a time; the contract takes any amount.</li>
      </ul>

      <H2 id="slides">Fossilizing a slide</H2>
      <p>
        <C>mint_slide(x, y, w, h, title, credit)</C> fixes a rectangle of the colony&rsquo;s own living cells as a specimen slide, a NEP-171 token. On the dish page the <strong>Fossilize</strong> tool opens a frame over your densest patch.
      </p>
      <ul>
        <li>The rectangle is 4 to 32 cells a side, starts at (x, y) and wraps at the edges.</li>
        <li>Only your colony&rsquo;s cells are captured; rivals&rsquo; cells inside it are left out. It must capture at least 5.</li>
        <li>It costs 1 PETRI per captured cell, all burned (unclaimed earnings count), plus NEAR for the token&rsquo;s storage; attached NEAR beyond that is sent back.</li>
        <li>The token&rsquo;s image is an SVG the contract draws from the captured cells every time a wallet asks.</li>
      </ul>
      <p>
        Details are in <Doc to="specimens">Specimens</Doc>. A slide that captured at least 12 cells is also a pattern licence: its exact pattern plants for less, and its holder is paid a royalty when others plant it (next section). A smaller slide (5 to 11 cells) is a keepsake; it can be minted and traded, but carries no licence.
      </p>

      <H2 id="replant">Replanting a slide</H2>
      <p>
        Any slide can be loaded back into the dish page&rsquo;s stamp (only one of 12 cells or more plants under a licence; the contract refuses a planting under a smaller slide, whose pattern you can still plant as an ordinary planting without <C>slide</C>): open it in the <Ext href={`${SITE}/specimens`}>specimens gallery</Ext> and choose <strong>Replant this pattern</strong>, or go to <C>/dish?replant=&lt;token id&gt;</C>. The cells are read from the slide&rsquo;s bitmap and placed wherever you click; R and F turn and flip them.
      </p>
      <p>
        Planted as the slide fixed them (moved anywhere, wrapping at the edges, but not turned or flipped), the cells go in under the slide&rsquo;s licence: <C>plant</C> with the slide&rsquo;s token id, which the dish page passes for you. The contract checks the cells are exactly the slide&rsquo;s pattern, and then:
      </p>
      <ul>
        <li>The planting costs 25% less (<C>slide_discount_bps</C>), whoever plants it. The siege surcharge still applies in full, so a licence never makes a rival&rsquo;s ground cheap.</li>
        <li>A planter that does not hold the slide also pays the holder 10% of that discounted cost (<C>slide_royalty_bps</C>) in PETRI: a transfer, not a burn. A holder with no PETRI registration is registered at the planter&rsquo;s expense. A planter that has never attached NEAR pays that royalty to the agar instead, and the holder gets nothing.</li>
        <li>The holder plants its own slide at the discount and pays no royalty. The house plants only slides it holds.</li>
      </ul>
      <p>
        A turned or flipped copy, or any other shape, is refused under the licence; plant it without <C>slide</C> as an ordinary planting. A slide that captured more than 64 cells cannot be replanted in one planting. Holding a slide gives no claim on any spot of the dish.
      </p>

      <H2 id="advance">Advancing the clock</H2>
      <p>
        <C>advance(max)</C> steps the stored board up to <C>max</C> due generations (at most 120). Anyone may call it. If it ran at least one generation, the caller receives the keeper pot (as does the caller of any other call that runs a generation: plant, buy, join, sell, claim or mint_slide), provided the caller can hold PETRI (it is a colony or registered with <C>storage_deposit</C>) and is not a house strain or keeper. Tides it runs pay it their bounties, again except to a house strain or keeper.
      </p>
      <p>
        If nobody touches the dish for more than 480 generations (two hours), the next call does not try to replay all of it: the clock skips ahead to 120 generations behind, records a <C>Skip</C> entry, and catches up from there. A planting refuses to run while the dish is behind; if a planting says <C>the dish is behind the clock; call advance first</C>, call <C>advance</C> once or twice and plant again.
      </p>
      <Code lang="sh" title="Advance the mainnet dish yourself">{`near contract call-function as-transaction petri-dish.near advance json-args '{"max":120}' prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' sign-as YOU.near network-config mainnet sign-with-keychain send`}</Code>

      <H2 id="strategy">Strategy notes</H2>
      <H3 id="strategy-earn">What earns</H3>
      <ul>
        <li>A cell pays back its price in about two hours of life at today&rsquo;s feed, so still lifes in open agar are the steady earners.</li>
        <li>Your pay is capped at 8 living cells per cell of stake. Growing far beyond that earns nothing more until you plant again.</li>
        <li>Tides follow the whole hour&rsquo;s earnings. Arriving just before a tide gets you only those few generations.</li>
      </ul>
      <H3 id="strategy-fight">What fights</H3>
      <ul>
        <li>Gliders and spaceships convert the cells they hit where they outnumber them; eaters absorb them.</li>
        <li>A siege is three times the price, and a crowded spot also dies fast. Open agar is usually cheaper than a fight.</li>
        <li>Where three colonies meet, births fail. A border between three colonies stays thin.</li>
      </ul>
      <Callout kind="note">
        <p>
          The simulator measures how these play out with many kinds of players, including who loses money. Read <Doc to="simulations">Economics and simulations</Doc> before putting in real NEAR.
        </p>
      </Callout>
    </DocPage>
  );
}
