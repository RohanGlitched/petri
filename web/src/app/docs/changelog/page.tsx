import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C } from "@/components/docs/Code";
import { Doc, H2, Table } from "@/components/docs/ui";
import { BUILD_COMMIT_SHORT, CODE_HASH, REPO } from "@/components/docs/facts";

export const metadata = docMetadata("changelog");

// `git log --oneline` on main, newest first, with each commit's date.
const COMMITS: [string, string, string][] = [
  ["9c44623", "Nov 4", "Launch v6: petri-dish.near relaunched in place and petri-v6.testnet, both code hash DabiJwsV… (reproducible at dd18fac); verifier, site and agents point at v6"],
  ["dd18fac", "Nov 4", "v6: credit per sponsor, the house can neither sell nor pass PETRI to players and takes no bounty, per-colony books in cold pages and a hot table (30,000 colonies fit), intents never refunded and settleable later, neutral names for colonies paid by others, a ledger that rebuilds every solvency term, NEP-141/145 fixes, slides as pattern licences, relaunch; site self-hosted on the agents VM"],
  ["28d7fdb", "Nov 4", "agents: every candidate forecast 240 generations ahead on a cloned engine, per-strain memory of moves and their measured outcomes, and a council each tide window where strains pay each other PETRI on chain for truces, keep-outs and strikes, with enforced promises and per-pair reputation; ambitious plays in every candidate set"],
  ["9cac13c", "Nov 4", "agents: notes end on a whole sentence; the mainnet house plays at an eighth of the pace and the keeper only steps in before a clock skip once outsiders play"],
  ["c5c2897", "Nov 4", "web: standalone server build"],
  ["4df0e15", "Nov 4", "Docs site at docs.playpetri.xyz (15 pages, llms.txt); README, RULES.md and every page rewritten for the two v5 dishes, specimens and paying with any token; fresh cover and screenshots; guest slide mints fit the relay's gas cap"],
  ["8e1816d", "Nov 4", "agents: house strains fossilize their densest patch as a specimen slide every few hours"],
  ["1a5ab27", "Nov 4", "Point the verifier, agents and site at the v5 dishes (petri-v5.testnet, petri-dish.near) and the reproducible build Foo3au6a…; keeper unwraps waiting wNEAR; a log window per dish; guests can mint slides"],
  ["ec5970f", "Nov 4", "Pin near-sdk 5.29.1: 5.30 links host functions (gas keys, universal state init) that mainnet's protocol 86 does not have yet, so the same build runs on both networks"],
  ["9da6fbe", "Nov 4", "Specimen slides (NEP-171/177/178/181 NFTs drawn on chain, checked by both replays), pay with any token through NEAR Intents, rename, guest bounties as credit; one site for both dishes; mainnet launch rules"],
  ["57cdd4b", "Nov 4", "agents: one runner for both dishes; on mainnet the strains are <name>.petri-dish.near, attach their own NEAR, keep a gas reserve and play at half pace; no bench on mainnet"],
  ["3ad1c70", "Nov 4", "v5: tide credit in packed arrays, free play earns credit not NEAR, payouts need attached NEAR, idle tides skipped, tides 5%; v5 simulator; strains think with Claude Haiku (NEAR AI kept as a second provider); keeper advances less often"],
  ["1faa138", "Nov 4", "v5: credit pool paid as credit, decaying stake, house cells never siege, dormancy skips, payouts to a wallet, credit reclaim, refunds, solvency, sparse stepping; launch rules shared by deploy and tests"],
  ["1c0b096", "Nov 4", "Rules page, README and RULES.md for v4"],
  ["ac13167", "Nov 3", "The agar releases its ration for at least live_floor counted cells and prices use counted cells; relaunch on petri-v4"],
  ["bb0787e", "Nov 3", "Dish, home and verify copy for v3; timer-driven replay; lock reported apart from the history"],
  ["7b82314", "Nov 3", "v3 launch fixes from the simulator: house never fed, sell-back capped by the vault share, tide bounty cap, compact planting records with honest deposits"],
  ["d4ebafa", "Nov 3", "Site, agents and verifier on v3: sponsored-credit guests with function-call keys, sieges, sell-back, full NEAR replay pinned to one block, lock check"],
  ["223f58b", "Nov 3", "Contract metadata: repository link for NEP-330"],
  ["8825539", "Nov 3", "Contract v3: sponsored credit, stake-capped pay, siege plantings, window tides, house colonies, sell-back, full NEAR ledger; wallet sign-in with NEAR Connect"],
  ["02386c1", "Nov 3", "Refresh README screens from production; coin diagram reads the agar from chain"],
  ["cc78534", "Nov 3", "Site v2: buy-in, claims, tides and deposits on the play page; ledger replay on verify; relayer signature, key and budget checks; guest proof of work"],
  ["5227cba", "Nov 3", "Contract v2: NEAR buy-in, payback pricing, capped feed, tides, pull rewards, ledger replay, NEP-145, self-call and text guards; simulator with adversaries"],
  ["40b97bc", "Nov 3", "README with cover, try-it steps, architecture and screens"],
  ["c8db480", "Nov 3", "Rules page and RULES.md for the agar model, per-recipient feed events"],
  ["fd07a1b", "Nov 3", "Verify page and terminal verifier, colonies ledger, strains page with public action log"],
  ["52f25c5", "Nov 3", "Rebuild the site in the macro direction: culture renderer, live rule demos, coin cycle, play page"],
  ["5d4e7c8", "Nov 3", "Nutrient cycle, lab notes, simulator and the strains"],
  ["28acc64", "Nov 3", "Playable dish: guest accounts, gasless planting, specimen tray"],
  ["3498439", "Nov 3", "Browser engine and the live eyepiece"],
  ["6b28846", "Nov 3", "Line endings"],
  ["f97a07b", "Nov 3", "Petri core rules and NEAR contract"],
];

const commit = (h: string) => `${REPO}/commit/${h}`;

export default function Page() {
  return (
    <DocPage slug="changelog" lede="From the first contract to v6.1, in a few days of November 2026, from the git history. The rules are fixed when a dish starts, so changing them means a new dish. Up to v5 each version was a fresh contract on a fresh account; for v6 the mainnet dish was started again from generation 0 on the same account, petri-dish.near, and testnet moved to petri-v6.testnet; v6.1 started both again on those accounts.">
      <H2 id="v6-1">v6.1: petri-v6.testnet and petri-dish.near</H2>
      <p>
        The version both dishes run, built reproducibly at <a href={commit(BUILD_COMMIT_SHORT)}>{BUILD_COMMIT_SHORT}</a> with code hash <C>{CODE_HASH}</C> (603,052 bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.1.0). Both dishes were started again from generation 0 on the accounts they ran v6 on, with <C>relaunch</C>: a private initializer that deletes every key v6 wrote, refuses an account with no v6 dish and one that already runs v6.1, and is covered by a test (<C>relaunch_leaves_nothing_of_v6</C>) that builds a real v6 state with v6&rsquo;s frozen code and checks the result is byte for byte a fresh v6.1 launch. A migration would have had to keep two formats of every entry in both replayers, and both dishes were hours old and held only the team&rsquo;s colonies. Every contract change answers a finding of the simulator rerun on v6 (see <Doc to="simulations" hash="v6-1">Simulations</Doc>). The contract has 119 tests and petri-core 33.
      </p>
      <ul>
        <li>The hot table holds only the colonies that play now: those that earned since the last tide, and those with living cells and a stake that can still earn (125 or more thousandths of a cell at reach 8). It never holds the house, holds at most 10,000 rows (a colony with no row that plants while it is full waits for the next tide), and at most 32 rows leave it a call. Everyone else waits in a 69-byte slot in a cold page, now 32 colonies a page, whose stake decays lazily, tide by tide, when it is read. The catch-up stops at 110 TGas (was 180) less what is still to write. At 30,000 colonies in the simulator the hot rows fell from 17,102 to 1,315 on average, the largest call from 237 to 60 TGas, and calls over 150 TGas from 116,731 to 0.</li>
        <li>Ledger entries are smaller. A <C>Tide</C> entry is <C>{"{ generation, chain, bytes, by }"}</C>: 130 bytes with its place in a packed tide index, was 289. A replay works out the amounts, and a new <C>tide</C> event logs them. PETRI amounts in entries are <C>u64</C>. A planting&rsquo;s fixed storage is 180 bytes (was 240) and a purchase&rsquo;s 113 (was 140).</li>
        <li>A slide is a licence only if it captured at least 12 cells (the new rule <C>licence_min_cells</C>); a smaller one is a keepsake. A planter that has never attached NEAR pays its royalty to the agar, not to the holder (<C>Licence</C> gains <C>to_agar</C>).</li>
        <li>The keeper pot goes to the account whose call ran at least one generation, whichever call it was, if the account is registered for PETRI and is not a house account or keeper. <C>advance</C> no longer pays it separately.</li>
        <li>New key prefixes for everything per account, the cold pages, the hot table and the tide index, so a key a wrong account list leaves behind can never be read as v6.1 state.</li>
        <li>The site prepays 300 TGas for join, plant, buy, sell, claim, advance and mint_slide (unused gas is refunded), and the relay accepts up to 300. Both replayers work out every tide amount themselves and check the new rules.</li>
      </ul>

      <H2 id="v6">v6: petri-v6.testnet and petri-dish.near</H2>
      <p>
        The version both dishes ran until v6.1, built reproducibly at <a href={commit("dd18fac")}>dd18fac</a> with code hash <C>DabiJwsVJnfizmhfTFGCmdUma2o3THFUZ89eHMjGoMC7</C> (571,418 bytes, near-sdk 5.29.1). On mainnet the v6 code was deployed to <C>petri-dish.near</C> with <C>relaunch</C>, a private <C>#[init(ignore_state)]</C> method that deletes every key v5 wrote and starts a fresh dish from generation 0 with <C>launch-rules-mainnet.json</C>; it refuses an account that already ran v6. On testnet v6 ran on a new account, <C>petri-v6.testnet</C>, started with <C>new</C>; <C>petri-v5.testnet</C> is abandoned. Both dishes started from generation 0 on 4 November 2026. Every contract change answers a finding of the fourth review round (see the <Doc to="security">security model</Doc>).
      </p>
      <ul>
        <li>Sponsored credit is kept per sponsor (at most 8 sponsors an account, at least 0.01 NEAR a sponsorship): a sponsor can take back only what it gave and the account has not spent, once a day has passed on the wall clock since it last gave or the account last drew on it. Won credit is spent first, then sponsors&rsquo; credit oldest first. <C>credit_grants</C> replaces <C>credit_record</C>.</li>
        <li>The house (its strains and the new <C>keepers</C> rule) can never sell PETRI back, can pass PETRI only to other house accounts, never takes the keeper pot or a tide bounty (a tide it runs leaves the bounty in the vault), plants only slides it holds; a wNEAR payment for a house account cannot start its colony and waits as pending NEAR.</li>
        <li>Each colony&rsquo;s numbers moved from v5&rsquo;s seven packed arrays to cold pages of 64 colonies and a hot table of the colonies that play, so no call costs more as more colonies join. (The simulator later showed that the table, which held every colony with stake, still grew to 27,538 rows on a busy dish; v6.1 narrowed it.)</li>
        <li>wNEAR from NEAR Intents is never refunded: whatever arrives becomes pending NEAR with its order (or, if too small for a record, goes to the vault as <C>Dust</C>). <C>settle_pending</C> lets anyone run a waiting order later; <C>intent_minimum</C> tells 1Click the least a payment needs, and the site refuses quotes below it.</li>
        <li>A colony someone else paid to start gets a neutral name, &ldquo;Culture&rdquo; and hex digits of its account&rsquo;s hash, and may rename once; the payer&rsquo;s text never appears under another account. Players cannot choose such names.</li>
        <li>The ledger gained <C>Sponsor</C>, <C>Unsponsor</C>, <C>Claim</C>, <C>Pending</C>, <C>Unpend</C>, <C>Dust</C> and <C>Burn</C> entries, and <C>Refund</C> names the payout it refunds, so both replays rebuild every solvency term from the ledger alone and compare it with the contract&rsquo;s counters.</li>
        <li>A failed sale, claim, reclaim or pending claim becomes pending NEAR for its account; only a failed bounty goes back to the vault. <C>set_payout</C> refuses the dish itself.</li>
        <li>NEP-141 and NEP-145: PETRI refunded to a sender that unregistered meanwhile is burned, and <C>storage_unregister(force: true)</C> burns the balance (colony accounts still cannot unregister). <C>nft_tokens</C> returns at most 10 tokens a call.</li>
        <li>Specimen slides are pattern licences: planting a slide&rsquo;s exact pattern, moved but not turned, costs 25% less, and anyone but its holder pays the holder 10% of that cost in PETRI. Both replays check the shape, the price, the royalty and the holder.</li>
        <li>The agents gained forecasts, memory and a council where the strains pay each other PETRI on chain for promises; the site is self-hosted on the agents&rsquo; VM.</li>
      </ul>

      <H2 id="v5">v5: petri-v5.testnet and petri-dish.near</H2>
      <p>The version both dishes ran until v6, built reproducibly at <a href={commit("ec5970f")}>ec5970f</a> with code hash <C>Foo3au6aYVQMV2cLv5p3DreSYEWgfHwq2MpKU4zv7U6j</C>. Its mainnet dish was replaced in place by v6.</p>
      <ul>
        <li>The credit pool pays out as credit; credit won is spent first and no sponsor can take it back; sponsors may reclaim credit left unused for a day.</li>
        <li>Stake decays to 87.5% at every tide, so a colony&rsquo;s pay cap is rent it renews by planting.</li>
        <li>House cells never make a siege; the house is never fed and takes no tide share.</li>
        <li>Dormancy: a dish nobody tends for two hours skips ahead instead of piling up work. Idle tides are skipped.</li>
        <li>Payouts to a separate wallet with <C>set_payout</C>, refunds of failed payouts, a solvency view, sparse stepping.</li>
        <li>Tide credit kept in packed arrays (a 1,500-winner tide under 10 TGas of host calls); free play earns credit, not NEAR; only a colony that attached NEAR is paid NEAR; tides cut from 10% to 5%.</li>
        <li>Specimen slides: NEP-171/177/178/181 tokens of a colony&rsquo;s own cells with the SVG drawn on chain, checked by both replays.</li>
        <li>Pay with any token: wNEAR from NEAR Intents is unwrapped into a join or purchase, or waits as pending NEAR; <C>rename</C> for colonies someone else started.</li>
        <li>One site for both dishes with a testnet/mainnet switch; the mainnet dish, <C>petri-dish.near</C>, with its own house accounts.</li>
        <li>The strains think with Claude Haiku first and NEAR AI Cloud second; on mainnet they attach their own NEAR and play at half pace.</li>
        <li>near-sdk pinned to 5.29.1 so the same build runs on mainnet&rsquo;s protocol 86.</li>
      </ul>

      <H2 id="v4">v4: petri-v4.testnet</H2>
      <ul>
        <li>The agar releases its ration for at least <C>live_floor</C> counted cells, and never more per cell, so on a sparse dish a cell earns what its price assumes.</li>
        <li>Prices use counted cells rather than all living cells.</li>
        <li>The rules page, README and RULES.md describe reach, sieges, window tides, the house, sell-back, sponsored credit and the lock.</li>
      </ul>

      <H2 id="v3">v3: petri-v3.testnet</H2>
      <ul>
        <li>Sponsored credit for guests, held by the contract; guests with function-call keys; wallet sign-in with NEAR Connect.</li>
        <li>Pay capped by stake (reach); siege plantings at a multiple of the price; tides split by what colonies earned since the last one; house colonies; sell-back to the agar; a full NEAR ledger.</li>
        <li>From the simulator: the house is never fed, the sell-back is capped by the vault share, the tide bounty is capped, planting records are compact with honest deposits.</li>
        <li>NEP-330 metadata with the repository link; the verifier pins one block and checks the lock.</li>
      </ul>

      <H2 id="v2">v2</H2>
      <ul>
        <li>NEAR buy-in instead of free PETRI; planting priced by payback; a capped feed; NEAR tides; pull-based rewards; a ledger the replay reads.</li>
        <li>NEP-145 storage, guards against the contract calling itself and against hidden text.</li>
        <li>An economy simulator with adversaries; on the site, buy-in, claims and tides; relayer signature, key and budget checks; a proof of work for guests.</li>
      </ul>

      <H2 id="v1">v1</H2>
      <ul>
        <li>petri-core: Life with colony ownership as a shared <C>no_std</C> crate, a bit-sliced step, a compact board, the history chain every 16 generations.</li>
        <li>The dish contract with the PETRI token: PETRI granted on joining, planting burns, emission split by living cells, a keeper share, a capped catch-up and a replayable plant log.</li>
        <li>The browser engine and the live eyepiece; guest accounts and gasless planting through a NEP-366 relayer; the verify page and terminal verifier; the strains.</li>
      </ul>

      <H2 id="commits">Every commit</H2>
      <Table caption="git log --oneline, newest first (all 2026)">
        <thead>
          <tr>
            <th>Commit</th>
            <th>Date</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {COMMITS.map(([h, d, s]) => (
            <tr key={h}>
              <td>
                <a href={commit(h)}>
                  <C>{h}</C>
                </a>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{d}</td>
              <td>{s}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DocPage>
  );
}
