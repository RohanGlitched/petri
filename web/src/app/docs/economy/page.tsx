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
        Two currencies move through the dish. <strong>PETRI</strong> never leaves it except into a player&rsquo;s balance, and it can only come back to the agar by planting or selling, or leave the supply when a slide or an unregistration burns it. <strong>NEAR</strong> comes in with moves and goes out at tides and sales. A third thing, <strong>credit</strong>, is NEAR the contract holds that one account may spend only on moves.
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
            <td>Keeper pot, on any call that runs a generation</td>
            <td>keeper pot</td>
            <td>the caller, if its call ran a generation, it is registered for PETRI and it is not a house strain or keeper</td>
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
            <td>Slide royalty, on a licensed planting by anyone but the slide&rsquo;s holder</td>
            <td>planter&rsquo;s balance</td>
            <td>the slide&rsquo;s holder: 10% of the planting&rsquo;s discounted cost, a transfer, not a burn</td>
            <td>
              <C>royalties</C>
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
            <td>another registered balance; never to the contract, from a house strain or keeper only to another house account, and not from a colony that has never attached NEAR or one holding kept PETRI</td>
            <td>none</td>
          </tr>
          <tr>
            <td>Pact offer (<C>pact_offer</C>)</td>
            <td>the payer&rsquo;s balance</td>
            <td>held by the dish (<C>pact_escrow</C>); paid to the promisor on <C>pact_accept</C>, or back to the payer if the offer is withdrawn, declined or expires</td>
            <td>
              <C>pact_escrow</C> while held
            </td>
          </tr>
          <tr>
            <td>Forced unregistration, or a transfer refund whose sender has unregistered meanwhile</td>
            <td>that balance</td>
            <td>100% burned, with a <C>Burn</C> entry</td>
            <td>
              <C>burned</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <p>These identities hold after every call, and most contract tests end by asserting them (<C>conserved</C> in the tests):</p>
      <Formula>{`total_supply                 = max_supply − burned
Σ balances + the dish's own  = total_supply            the dish's own = agar + unclaimed + keeper_pot + pact_escrow
agar                         = max_supply − sold − fed + returned + bought_back`}</Formula>
      <p>
        <C>ft_balance_of(&quot;petri-dish.near&quot;)</C> returns the dish&rsquo;s own holding (agar + unclaimed + keeper pot + the PETRI held for pact offers), and <C>ft_total_supply()</C> returns <C>max_supply − burned</C>. Nobody can transfer PETRI to the contract: it comes back only by planting or selling.
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
            <td>The colony record, its one slot at the end of the last cold page, its name, its balance record, the join entry, and 113 bytes for the purchase entry</td>
            <td>Buys PETRI; attached NEAR to the vault, credit to the credit pool. The colony attaches NEAR only if what reaches the vault, net of storage, is at least 0.01 NEAR</td>
          </tr>
          <tr>
            <td>
              <C>buy</C>
            </td>
            <td>113 bytes (0.00113 NEAR) for the purchase entry</td>
            <td>Buys PETRI; vault or credit pool</td>
          </tr>
          <tr>
            <td>
              <C>plant</C>
            </td>
            <td>The planting entry (with its licence under a slide), its index, the note, the colony&rsquo;s hot row if it has none yet, and the slide holder&rsquo;s PETRI registration if a royalty needs one</td>
            <td>Vault or credit pool, including the 0.0001 NEAR per cell fee and anything attached beyond the deposit</td>
          </tr>
          <tr>
            <td>
              <C>sell</C>
            </td>
            <td>The sale entry, paid from the proceeds; a sale paid in NEAR must also be large enough to pay for a refund&rsquo;s records, should the transfer fail</td>
            <td>The seller: NEAR, or credit for a colony that never attached NEAR. House colonies cannot sell</td>
          </tr>
          <tr>
            <td>A tide</td>
            <td>Its own ledger entry and index, from the vault</td>
            <td>Bounty to the caller (none to a house colony or keeper: it stays in the vault), then shares: claimable NEAR or won credit</td>
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
            <td>The account&rsquo;s grant list, the <C>Sponsor</C> entry and, for a new grant, 210 bytes set aside for the <C>Unsponsor</C> entry its sponsor may write later</td>
            <td>Credit for the sponsored account, kept as this sponsor&rsquo;s grant</td>
          </tr>
          <tr>
            <td>wNEAR through NEAR Intents</td>
            <td>A pending record and its <C>Pending</C> entry, from the amount; an amount no larger than what those two records can cost is refunded whole and writes nothing</td>
            <td>Pending NEAR with its order, spent on a join or purchase as attached NEAR (at once, or later with <C>settle_pending</C>), or claimed by the account. Never refunded once it covers its records</td>
          </tr>
        </tbody>
      </Table>
      <p>And NEAR leaves the contract in exactly these ways:</p>
      <ul>
        <li>
          <C>claim</C>: a colony&rsquo;s tide winnings, to its account or payout account, less the storage of its <C>Claim</C> entry. Winnings too small to pay for that entry and a possible refund&rsquo;s records (about 0.0034 NEAR) stay owed until they grow.
        </li>
        <li>
          <C>sell</C>: proceeds from the vault.
        </li>
        <li>Tide bounties, to the caller who ran the tide (as credit if that caller is a colony not paid in NEAR: a guest, or one holding kept PETRI; none to a house colony or keeper). A failed bounty goes back to the vault with a <C>Refund</C> entry.</li>
        <li>
          <C>unsponsor</C>: a sponsor takes back what is left of its own grant once the account has left it untouched for a day.
        </li>
        <li>
          <C>claim_pending</C>: an account&rsquo;s pending NEAR (an intents payment it did not spend, or a payout that failed).
        </li>
        <li>Every other failed payout (a claim, a sale, a reclaim, a pending claim) stays the account&rsquo;s: a <C>Refund</C> entry records it, its records are paid from the NEAR that came back, and the rest becomes pending NEAR for the account it was for.</li>
        <li>Refunds of excess deposits: a slide&rsquo;s unused deposit, a second <C>storage_deposit</C>, <C>storage_unregister</C>, approvals revoked.</li>
      </ul>
      <p>
        A Tide entry stores only the chain, <C>bytes</C> and <C>by</C>; the amounts below (<C>bounty</C>, <C>storage</C>, <C>paid</C>, <C>as_credit</C>, <C>credit_paid</C>) are the ones a replay works out for each tide from the ledger before it, and the <C>tide</C> event logs.
      </p>
      <Formula>{`vault + Σ tides (bounty + storage + paid + as_credit) + Σ sales (near)  = near_in + Σ bounty refunds (near − storage)
credit_pool + Σ tides (credit_paid)                                      = credit_in
credit_won                                                               = Σ tides (credit_paid) + near_as_credit
tides_owed                                                               = Σ tides (paid) − Σ claims (near)
pending                                                                  = Σ Pending (near) + Σ other refunds (near − storage) − Σ Unpend (near)`}</Formula>
      <p>
        <C>near_in</C> is what joins, purchases and plantings put into the vault (on ledgers written by v6.1 it also counts <C>Dust</C> entries; v6.2 refunds that wNEAR instead), however little a call brings. Every term is a sum over ledger entries, so both replays rebuild each one from the ledger alone and compare it with the contract&rsquo;s own counter.
      </p>

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
            <td>5%: bounty, entry storage, then shares in NEAR to colonies that attached NEAR and hold no kept PETRI, in credit to the rest</td>
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
        Keeping the pools apart is what lets free play exist without leaking NEAR: sponsored NEAR can circulate as credit forever but never becomes NEAR anyone withdraws, while the NEAR players attach is the only NEAR that is paid out as NEAR. PETRI bought with credit is kept PETRI (<a href="#kept">below</a>), so credit does not become vault NEAR by a sale either.
      </p>

      <H2 id="credit">Credit</H2>
      <p>
        Credit is NEAR the contract holds on behalf of one account, spendable on <C>join</C>, <C>buy</C>, <C>plant</C> and a slide&rsquo;s storage by passing <C>credit</C> (in yoctoNEAR) as an argument. It comes in two kinds, and <C>credit_of(account_id)</C> returns their sum:
      </p>
      <H3 id="credit-sponsored">Sponsored credit</H3>
      <ul>
        <li>
          Given by anyone with <C>sponsor(account_id)</C> and an attached deposit of at least 0.01 NEAR. On testnet the site&rsquo;s relayer sponsors every guest with 0.05 NEAR.
        </li>
        <li>
          Each sponsor&rsquo;s credit is a grant of its own. An account holds grants from at most 8 sponsors at once; a sponsor topping up its own grant always can.
        </li>
        <li>The account spends what it won first, then its grants, oldest first. Drawing on a grant restarts that grant&rsquo;s day only.</li>
        <li>
          A sponsor may take back what is left of its own grant with <C>unsponsor(account_id)</C> once 5,760 generations (a day) of wall-clock time have passed since it last gave or the account last drew on that grant. It can never reach another sponsor&rsquo;s grant or the account&rsquo;s won credit, and the account itself can never withdraw. If the transfer fails, the NEAR becomes pending for the sponsor.
        </li>
        <li>
          <C>credit_grants(account_id)</C> lists the grants in spending order, each with its sponsor, amount and the generation it was last given or drawn on.
        </li>
      </ul>
      <H3 id="credit-won">Won credit</H3>
      <ul>
        <li>
          Every colony&rsquo;s share of the credit pool at each tide; and, for a colony that has not attached NEAR or holds kept PETRI, its share of the vault and the bounties of tides it runs, and, for a colony that has not attached NEAR, its sales back.
        </li>
        <li>It is spent before sponsored credit, and no sponsor can take it back.</li>
        <li>It can never be withdrawn. The only way out is spending it on moves, which puts it into the credit pool for the next tides.</li>
      </ul>
      <H3 id="credit-guest">The guest rules, together</H3>
      <ol>
        <li>A guest&rsquo;s key is a function-call key for the dish only, so it cannot attach NEAR and cannot transfer NEAR or PETRI. The relayer refuses any relayed call that carries a deposit. And the contract refuses <C>ft_transfer</C> and <C>ft_transfer_call</C> from any colony that has never attached NEAR, whatever key signs.</li>
        <li>A guest never attaches NEAR, so the contract counts its attached total as zero. A colony attaches NEAR only when one join, buy or planting puts at least 0.01 NEAR, net of storage, into the vault; a smaller amount goes to the vault but attaches nothing, so a yoctoNEAR on a call paid from credit never turns credit into NEAR.</li>
        <li>A colony whose attached total is zero is paid every tide share, sale and bounty as credit. So is one that has attached NEAR while it holds kept PETRI, apart from its sales, which it cannot make for NEAR at all.</li>
        <li>
          Only a colony that has attached NEAR may <C>set_payout</C>, and the relayer does not relay it.
        </li>
        <li>A guest takes no keeper pot (nor does a join on credit run a generation), and a royalty from a guest, or from a colony whose kept PETRI is more than the planting costs, goes to the agar, not to the holder.</li>
        <li>PETRI a colony earned before its first NEAR, or bought with credit, is kept: it cannot be sold for NEAR or sent until it has been planted (<a href="#kept">kept PETRI</a>).</li>
      </ol>
      <p>
        So the most a guest can do with its winnings is play more. The contract tests <C>a_guest_wins_credit_where_a_wallet_wins_near</C>, <C>a_guest_sale_pays_credit</C>, <C>a_guest_cannot_send_winnings_to_a_wallet</C> and <C>a_guest_that_runs_a_tide_is_paid_its_bounty_as_credit</C> cover each step.
      </p>
      <Callout kind="note">
        <p>
          Attaching NEAR is per colony and permanent: once one join, purchase or planting (or wNEAR through NEAR Intents) has put at least 0.01 NEAR, net of storage, into the vault, its later tide shares and sales are paid in NEAR, but only while it holds no kept PETRI. With any, its tide shares and bounties are credit and a claim brings only PETRI.
        </p>
      </Callout>

      <H2 id="kept">Kept PETRI: free play never reaches NEAR</H2>
      <p>
        Before v6.1 a guest could earn PETRI for free and turn it into vault NEAR in two ways: <C>ft_transfer</C> it to a wallet that sells it, or attach a little NEAR and sell what it had farmed. Now PETRI earned before a colony&rsquo;s first NEAR stays in the dish. Every colony has a <C>kept</C> amount (a u64 in its record, shown in the <C>Colony</C> views as <C>kept</C> next to <C>attached</C>):
      </p>
      <ul>
        <li>While a colony is a guest, everything it claims, buys (all of a guest&rsquo;s purchases are credit) and is paid in royalties as a slide holder is added to <C>kept</C>.</li>
        <li>When it first attaches NEAR (a join, purchase or planting that puts at least 0.01 NEAR into the vault in one call, a wNEAR join or purchase included), its unclaimed earnings are added; what it claimed as a guest already is.</li>
        <li>PETRI anyone buys with credit is added, attached or not: <C>credit_share(units, credit, near + credit)</C> of the purchase.</li>
        <li>Plantings (cost and royalty) and slides spend kept PETRI first; a guest&rsquo;s sale for credit spends it too.</li>
      </ul>
      <p>
        While a colony holds any kept PETRI it cannot sell PETRI for NEAR, send PETRI or pay PETRI into a pact. A guest cannot send PETRI at all, kept or not (it can plant, mint slides, receive PETRI and sell back for credit). While it holds any, a colony is also paid in credit, not NEAR: its tide share and bounties are credit, <C>claim</C> pays out only its PETRI and leaves its NEAR owed (no <C>Claim</C> entry is written), and a royalty it would pay out of kept PETRI goes to the agar. Once its plantings have spent its kept PETRI, everything it holds is its own, what it earns afterwards is sellable, and its NEAR is paid again.
      </p>
      <p>
        The rule is &ldquo;none while any is held&rdquo; rather than &ldquo;sellable = balance − kept&rdquo; because balances are not in the ledger (transfers and the keeper pot are not entries), so no replay could check the second exactly. With the first every check is exact: both replays rebuild every colony&rsquo;s <C>kept</C> from the ledger entry by entry and compare it with the view, and a sale for NEAR, a claim of NEAR or a PETRI pact by a colony whose replayed <C>kept</C> is above zero is a violation. The house is exempt from the send check (its PETRI cannot leave the house anyway).
      </p>
      <Table caption="sim/out-v6.1, fixes.txt P1: testnet, 150 players plus 3 operators of each kind (a wallet and 10 relayer guests), 7 days, 6 seeds, per operator">
        <thead>
          <tr>
            <th>Attack</th>
            <th className="n">Without the rule</th>
            <th className="n">With the rule</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Guests <C>ft_transfer</C> their PETRI to one wallet that sells it: vault NEAR paid a week (PETRI moved)</td>
            <td className="n neg">+0.0470 NEAR (476.9 PETRI)</td>
            <td className="n">0 (0 PETRI: every transfer refused)</td>
          </tr>
          <tr>
            <td>Guests farm a day, attach 0.01 NEAR each and sell what they farmed: vault NEAR paid</td>
            <td className="n">+0.0008 NEAR</td>
            <td className="n">0 (82 sales refused)</td>
          </tr>
          <tr>
            <td>Every colony of the run: vault NEAR paid for PETRI earned before a first NEAR, bought with credit or moved in by a guest&rsquo;s transfer</td>
            <td className="n neg">0.167 NEAR</td>
            <td className="n">0</td>
          </tr>
        </tbody>
      </Table>
      <p>
        The day a guest farms (about 30 PETRI, 0.003 NEAR) is worth less than a sale&rsquo;s own record and refund reserve (0.0035 NEAR), which is why the second attack drew almost nothing even without the rule; with it, it draws nothing. Everyone else&rsquo;s cash is within seed noise (<Doc to="simulations" hash="v6-1-kept">the numbers</Doc>). The contract tests: <C>guest_cannot_transfer_free_petri</C>, <C>guest_that_attaches_cannot_sell_what_it_farmed</C>, <C>attached_player_sells_what_it_earned_after</C>, <C>kept_petri_can_still_be_planted</C>, <C>petri_bought_with_credit_is_kept</C> and <C>sybil_guests_that_attach_reach_no_vault_near</C> (ten guests farm, attach 0.01 NEAR each, try to sell and to send everything to one wallet: all refused, <C>near_sold</C> 0).
      </p>
      <Callout kind="check" title="Why free play can never extract NEAR">
        <p>
          NEAR leaves the vault to a colony only as tide winnings (paid as NEAR only to a colony that has attached NEAR and holds no kept PETRI), as the price of a sale back to the agar, or as a tide bounty. Sponsored credit is never vault NEAR. A guest is paid in credit; it cannot send PETRI to anyone who could sell it; PETRI it earned or bought with credit cannot be sold for NEAR even after it attaches, until it has been planted. Each step is a refusal in the contract, rebuilt and checked by both replays.
        </p>
      </Callout>

      <H2 id="house">The house</H2>
      <p>
        The rules name five house accounts, the AI strains, and the keepers (<C>keeper.petri-dish.near</C> on mainnet, <C>petri-keeper.testnet</C> on testnet). The strains join and plant like anyone, but the contract treats every house account differently:
      </p>
      <ul>
        <li>House colonies are never fed, so the house cannot eat the agar on a quiet dish.</li>
        <li>They take no share of any tide.</li>
        <li>They never sell PETRI back: the vault is the players&rsquo;.</li>
        <li>A house account sends PETRI only to another house account, so nothing the house bought can reach a player who could sell it. The strains&rsquo; pacts with each other are the one way house PETRI moves: a pact with a player carries no house PETRI.</li>
        <li>A tide run by a house colony or a keeper pays no bounty: it stays in the vault. No house account takes the keeper pot.</li>
        <li>The house plants only slides it holds, so it never pays a player a royalty.</li>
        <li>Their cells never make a planting a siege, so they cannot wall a newcomer out of cheap ground.</li>
        <li>A wNEAR payment cannot start a colony for a house account; it waits as pending NEAR for that account to claim.</li>
      </ul>
      <p>
        Everything the house spends therefore goes to other players. On mainnet the strains attach their own NEAR, so it lands in the vault and is paid out at tides in real NEAR. On testnet they spend sponsored credit, which goes to the credit pool. <C>state().vault</C> gives the vault today, and the judge desk reads every tide paid so far.
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
      <Code lang="sh" title="Check it (curl and jq)">{`curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "call_function", "finality": "final",
              "account_id": "petri-dish.near", "method_name": "solvency", "args_base64": "e30=" }
}' | jq -r '.result.result | implode'`}</Code>

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
              <C>plant_deposit(cells, note_bytes, slide)</C> = (180 + 77 + 4 × cells + (note bytes + 64, with a note) + (82 while no colony plays) + (under a slide&rsquo;s licence: 26 + the holder&rsquo;s account length, and 125 more if the holder has no PETRI registration)) × 10<sup>19</sup> + 0.0001 NEAR × cells; 0.00313 NEAR for a block with no note. The 77 bytes are the colony&rsquo;s row in the hot table, which its first planting makes.
            </td>
          </tr>
          <tr>
            <td>A slide</td>
            <td>
              <C>slide_deposit(w, h, title_bytes)</C> = (240 + 21 + 64 + 2 × ⌈w·h/8⌉ + (title bytes + 5, with a title) + 120 + 184) × 10<sup>19</sup>; 0.00693 NEAR for 16 × 16 untitled. Unused deposit is sent back.
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
        Storage is NEAR&rsquo;s own price for the bytes a move writes, and the contract keeps it while the records exist. Those records are the ledger that lets anyone replay the whole dish from generation zero; see <Doc to="simulations" hash="storage">Storage and the newcomer</Doc>.
      </p>

      <H2 id="worked">A worked example</H2>
      <p>A wallet colony on a dish with a full agar and at least 1,000 counted cells:</p>
      <ol>
        <li>
          It joins with 0.02 NEAR. About 0.007 NEAR pays its storage (the exact amount depends on the account&rsquo;s length); about 0.013 NEAR reaches the vault and buys about 65 PETRI.
        </li>
        <li>
          It plants a block: 4 cells × 1.4112 = 5.6448 PETRI. 2.8224 PETRI is burned and 2.8224 returns to the agar. It attaches <C>plant_deposit(4, null, null)</C> = 0.00313 NEAR; the storage actually used is paid and the rest goes to the vault. Its stake is now 4,000.
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
