import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Formula, H2, H3, Table } from "@/components/docs/ui";
import { EconomyFlow } from "@/components/docs/Diagrams";

export const metadata = docMetadata("economy");

export default function Page() {
  return (
    <DocPage
      slug="economy"
      source={[
        { label: "contract/src/lib.rs", path: "contract/src/lib.rs" },
        { label: "the conservation checks in contract/src/tests.rs", path: "contract/src/tests.rs" },
      ]}
    >
      <H2 id="flow">The flow</H2>
      <p>
        Two currencies move through the dish. <strong>PETRI</strong> never leaves it except into a player&rsquo;s balance, and it can only come back by planting, selling or a slide. <strong>NEAR</strong> comes in with moves and goes out at tides and sales. A third thing, <strong>credit</strong>, is NEAR the contract holds that one account may spend only on moves.
      </p>
      <EconomyFlow />

      <H2 id="petri">Where every PETRI goes</H2>
      <p>All 1,000,000 PETRI are minted to the contract at launch, in one <C>ft_mint</C> event with the memo <C>launch: every PETRI starts in the agar</C>. From then on:</p>
      <Table>
        <thead>
          <tr>
            <th>Movement</th>
            <th>From</th>
            <th>To</th>
            <th>Counter in state()</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Purchase (join or buy)</td>
            <td>agar</td>
            <td>buyer&rsquo;s balance</td>
            <td>
              <C>sold</C>
            </td>
          </tr>
          <tr>
            <td>Feed, every generation</td>
            <td>agar</td>
            <td>colonies&rsquo; unclaimed earnings, and 2% to the keeper pot</td>
            <td>
              <C>fed</C>, <C>unclaimed</C>, <C>keeper_pot</C>
            </td>
          </tr>
          <tr>
            <td>Claim (also done by any planting or slide)</td>
            <td>unclaimed earnings</td>
            <td>colony&rsquo;s balance</td>
            <td>
              <C>unclaimed</C> falls
            </td>
          </tr>
          <tr>
            <td>Keeper pot, on <C>advance</C></td>
            <td>keeper pot</td>
            <td>the caller, if registered</td>
            <td>
              <C>keeper_paid</C>
            </td>
          </tr>
          <tr>
            <td>Planting</td>
            <td>planter&rsquo;s balance</td>
            <td>50% burned, 50% back to the agar</td>
            <td>
              <C>burned</C>, <C>returned</C>
            </td>
          </tr>
          <tr>
            <td>Sale back</td>
            <td>seller&rsquo;s balance</td>
            <td>agar</td>
            <td>
              <C>bought_back</C>
            </td>
          </tr>
          <tr>
            <td>Specimen slide</td>
            <td>minter&rsquo;s balance</td>
            <td>100% burned</td>
            <td>
              <C>burned</C>, <C>slides_burned</C>
            </td>
          </tr>
          <tr>
            <td>Transfer (NEP-141)</td>
            <td>a balance</td>
            <td>another registered balance; never to the contract</td>
            <td>none</td>
          </tr>
        </tbody>
      </Table>
      <p>These identities hold after every call, and most contract tests end by asserting them (<C>conserved</C> in the tests):</p>
      <Formula>{`total_supply                 = max_supply − burned
Σ balances + the dish's own  = total_supply            the dish's own = agar + unclaimed + keeper_pot
agar                         = max_supply − sold − fed + returned + bought_back`}</Formula>
      <p>
        <C>ft_balance_of(&quot;petri-dish.near&quot;)</C> returns the dish&rsquo;s own holding (agar + unclaimed + keeper pot), and <C>ft_total_supply()</C> returns <C>max_supply − burned</C>. Nobody can transfer PETRI to the contract: it comes back only by planting, selling or a slide.
      </p>

      <H2 id="near">Where every yoctoNEAR goes</H2>
      <p>Every NEAR a move brings is first spent on the storage of what that move writes. Storage is paid from credit first, then from attached NEAR. What is left of each goes to its own pool:</p>
      <Table>
        <thead>
          <tr>
            <th>Move</th>
            <th>Storage it pays for</th>
            <th>The rest goes to</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>join</C> (at least 0.01 NEAR)
            </td>
            <td>The colony record, its slots in the per-colony arrays, its name, its balance record, and 140 bytes for the purchase entry</td>
            <td>Buys PETRI; attached NEAR to the vault, credit to the credit pool</td>
          </tr>
          <tr>
            <td>
              <C>buy</C>
            </td>
            <td>140 bytes (0.0014 NEAR) for the purchase entry</td>
            <td>Buys PETRI; vault or credit pool</td>
          </tr>
          <tr>
            <td>
              <C>plant</C>
            </td>
            <td>The planting entry, its index and the note</td>
            <td>Vault or credit pool, including the 0.0001 NEAR per cell fee and anything attached beyond the deposit</td>
          </tr>
          <tr>
            <td>
              <C>sell</C>
            </td>
            <td>The sale entry, paid from the proceeds</td>
            <td>The seller: NEAR, or credit for a colony that never attached NEAR</td>
          </tr>
          <tr>
            <td>A tide</td>
            <td>Its own ledger entry and index, from the vault</td>
            <td>Bounty to the caller, then shares: claimable NEAR or won credit</td>
          </tr>
          <tr>
            <td>
              <C>mint_slide</C>
            </td>
            <td>The slide, its ledger entry, the owner&rsquo;s list, plus 184 bytes reserved for later owners</td>
            <td>Attached NEAR beyond the storage is sent back</td>
          </tr>
          <tr>
            <td>
              <C>sponsor</C>
            </td>
            <td>The credit record</td>
            <td>Credit for the sponsored account</td>
          </tr>
          <tr>
            <td>wNEAR through NEAR Intents</td>
            <td>A pending record, from the amount</td>
            <td>A join or purchase as attached NEAR, or pending NEAR the account claims</td>
          </tr>
        </tbody>
      </Table>
      <p>And NEAR leaves the contract in exactly these ways:</p>
      <ul>
        <li>
          <C>claim</C>: a colony&rsquo;s tide winnings, to its account or payout account. A failed transfer is owed again.
        </li>
        <li>
          <C>sell</C>: proceeds from the vault. A failed transfer goes back to the vault with a <C>Refund</C> entry.
        </li>
        <li>Tide bounties, to the caller who ran the tide (as credit if that caller is a guest colony). A failed transfer is refunded to the vault.</li>
        <li>
          <C>unsponsor</C>: a sponsor takes back sponsored credit an account left unused for a day.
        </li>
        <li>
          <C>claim_pending</C>: NEAR from an intents payment that could not join or buy.
        </li>
        <li>Refunds of excess deposits: a slide&rsquo;s unused deposit, a second <C>storage_deposit</C>, <C>storage_unregister</C>, approvals revoked.</li>
      </ul>
      <Formula>{`vault + Σ tides (bounty + storage + paid + as_credit) + Σ sales (near)  = near_in + Σ refunds
credit_pool + Σ tides (credit_paid)                                      = credit_in
credit_won                                                               = Σ tides (credit_paid) + near_as_credit`}</Formula>

      <H2 id="pools">Two pools</H2>
      <Table>
        <thead>
          <tr>
            <th></th>
            <th>The vault</th>
            <th>The credit pool</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Fed by</th>
            <td>NEAR players attach (after storage)</td>
            <td>Credit players spend (after storage): sponsored credit, and credit won</td>
          </tr>
          <tr>
            <th>Pays at tides</th>
            <td>5%: bounty, entry storage, then shares in NEAR to colonies that attached NEAR, in credit to the rest</td>
            <td>5%, shares as credit only</td>
          </tr>
          <tr>
            <th>Pays sales</th>
            <td>Yes, up to 10% of the vault between tides</td>
            <td>No</td>
          </tr>
          <tr>
            <th>View</th>
            <td>
              <C>state().vault</C>
            </td>
            <td>
              <C>state().credit_pool</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        Keeping the pools apart is what lets free play exist without leaking NEAR: sponsored NEAR can circulate as credit forever but never becomes NEAR anyone withdraws, while the NEAR players attach is the only NEAR that is paid out as NEAR.
      </p>

      <H2 id="credit">Credit</H2>
      <p>
        Credit is NEAR the contract holds on behalf of one account, spendable on <C>join</C>, <C>buy</C>, <C>plant</C> and a slide&rsquo;s storage by passing <C>credit</C> (in yoctoNEAR) as an argument. It comes in two kinds, and <C>credit_of(account_id)</C> returns their sum:
      </p>
      <H3 id="credit-sponsored">Sponsored credit</H3>
      <ul>
        <li>
          Given by anyone with <C>sponsor(account_id)</C> and an attached deposit. On testnet the site&rsquo;s relayer sponsors every guest with 0.05 NEAR.
        </li>
        <li>
          The sponsor may take back what is left with <C>unsponsor(account_id)</C> once the account has not used it for 5,760 generations (a day). Nobody else can, and the account itself never can.
        </li>
        <li>
          <C>credit_record(account_id)</C> shows the amount, the sponsor and when it was last given or used.
        </li>
      </ul>
      <H3 id="credit-won">Won credit</H3>
      <ul>
        <li>
          Every colony&rsquo;s share of the credit pool at each tide; and, for a colony that has never attached NEAR, its share of the vault, its sales back and the bounties of tides it runs.
        </li>
        <li>It is spent before sponsored credit, and no sponsor can take it back.</li>
        <li>It can never be withdrawn. The only way out is spending it on moves, which puts it into the credit pool for the next tides.</li>
      </ul>
      <H3 id="credit-guest">The guest rules, together</H3>
      <ol>
        <li>A guest&rsquo;s key is a function-call key for the dish only, so it cannot attach NEAR and cannot transfer NEAR or PETRI. The relayer refuses any relayed call that carries a deposit.</li>
        <li>A guest never attaches NEAR, so the contract counts its attached total as zero.</li>
        <li>A colony whose attached total is zero is paid every tide share, sale and bounty as credit.</li>
        <li>
          Only a colony that has attached NEAR may <C>set_payout</C>, and the relayer does not relay it.
        </li>
      </ol>
      <p>
        So the most a guest can do with its winnings is play more. The contract tests <C>a_guest_wins_credit_where_a_wallet_wins_near</C>, <C>a_guest_sale_pays_credit</C>, <C>a_guest_cannot_send_winnings_to_a_wallet</C> and <C>a_guest_that_runs_a_tide_is_paid_its_bounty_as_credit</C> cover each step.
      </p>
      <Callout kind="note">
        <p>
          Attaching NEAR is per colony and permanent: once a colony has put any NEAR into the vault itself (a join, purchase or planting with attached NEAR, or wNEAR through NEAR Intents), all of its later tide shares and sales are paid in NEAR.
        </p>
      </Callout>

      <H2 id="house">The house</H2>
      <p>
        The rules name five house accounts, the AI strains. They join and plant like anyone, but the contract treats them three ways differently:
      </p>
      <ul>
        <li>They are never fed, so the house cannot eat the agar on a quiet dish.</li>
        <li>They take no share of any tide.</li>
        <li>Their cells never make a planting a siege, so they cannot wall a newcomer out of cheap ground.</li>
      </ul>
      <p>
        Everything the house spends therefore goes to other players. On mainnet the strains attach their own NEAR, so it lands in the vault and is paid out at tides in real NEAR. On testnet they spend sponsored credit, which goes to the credit pool. On 4 November 2026 the mainnet dish held 0.22559 NEAR in its vault, all of it from the five strains, waiting for the first player outside the house to earn.
      </p>

      <H2 id="solvency">Solvency</H2>
      <p>
        The view <C>solvency()</C> compares what the contract holds with everything it owes, and the verifier checks the same sum independently from the account&rsquo;s balance:
      </p>
      <Formula>{`free   = account balance − storage_usage × 10^19 + wrapped
owed   = vault + credit_pool + credit_outstanding + tides_owed + pending
credit_outstanding = credit_given + credit_won + credit_sold − credit_spent − credit_reclaimed
solvent  ⇔  free ≥ owed          surplus = free − owed`}</Formula>
      <p>
        <C>wrapped</C> is wNEAR the dish holds and has not unwrapped yet. The surplus is the contract&rsquo;s own NEAR: what the deployer left beyond storage, which pays for the few records no player is charged for (Skip entries, and the board&rsquo;s growth during a catch-up).
      </p>
      <Code lang="sh" title="Check it">{`near contract call-function as-read-only petri-dish.near solvency json-args '{}' network-config mainnet now`}</Code>

      <H2 id="storage">Storage</H2>
      <p>
        Every record a move writes is paid by the move, at NEAR&rsquo;s price of 10<sup>19</sup> yoctoNEAR a byte, so nobody can make the contract pay for their data. The deposits are quoted by views:
      </p>
      <Table>
        <thead>
          <tr>
            <th>Record</th>
            <th>Deposit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A planting</td>
            <td>
              <C>plant_deposit(cells, note_bytes)</C> = (220 + 4 × cells + (note bytes + 64 if a note)) × 10<sup>19</sup> + 0.0001 NEAR × cells
            </td>
          </tr>
          <tr>
            <td>A slide</td>
            <td>
              <C>slide_deposit(w, h, title_bytes)</C> = (240 + 64 + 2 × ⌈w·h/8⌉ + (title bytes + 5, with a title) + 120 + 184) × 10<sup>19</sup>; 0.00672 NEAR for 16 × 16 untitled. Unused deposit is sent back.
            </td>
          </tr>
          <tr>
            <td>A PETRI balance for a non-colony</td>
            <td>
              <C>storage_deposit</C>: 125 bytes, 0.00125 NEAR
            </td>
          </tr>
          <tr>
            <td>A slide approval</td>
            <td>12 + the approved account&rsquo;s length, in bytes; refunded when it is revoked or used</td>
          </tr>
        </tbody>
      </Table>
      <p>
        Storage the contract uses is real cost: in the v5 simulator, storage took 37% to 47% of the NEAR players brought, depending on how many played and for how long. That is the single largest drain on the economy, and the main reason most player kinds lose NEAR there; see <Doc to="simulations" hash="storage">Storage and the newcomer</Doc>.
      </p>

      <H2 id="worked">A worked example</H2>
      <p>A wallet colony on a dish with a full agar and at least 1,000 counted cells:</p>
      <ol>
        <li>
          It joins with 0.02 NEAR. About 0.0075 NEAR pays its storage (the exact amount depends on the account&rsquo;s length); about 0.0125 NEAR reaches the vault and buys about 62.5 PETRI.
        </li>
        <li>
          It plants a block: 4 cells × 1.4112 = 5.6448 PETRI. 2.8224 PETRI is burned and 2.8224 returns to the agar. It attaches <C>plant_deposit(4, null)</C> = 0.00276 NEAR; the storage actually used is paid and the rest goes to the vault. Its stake is now 4,000.
        </li>
        <li>
          The block earns 4 × 0.00294 = 0.01176 PETRI a generation. After 480 generations that is 5.6448 PETRI, exactly its price: that is what the payback rule means.
        </li>
        <li>
          At the next tide its share of 5% of the vault is in proportion to what it earned that hour. Its stake decays to 3,500, so it is paid for at most 28 living cells until it plants again.
        </li>
      </ol>
    </DocPage>
  );
}
