import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C } from "@/components/docs/Code";
import { H2, Table } from "@/components/docs/ui";
import { REPO } from "@/components/docs/facts";

export const metadata = docMetadata("changelog");

// `git log --oneline` on main, newest first, with each commit's date.
const COMMITS: [string, string, string][] = [
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
    <DocPage slug="changelog" lede="From the first contract to v5, in two days of November 2026, from the git history. Each version was a fresh contract on a fresh account: the rules are fixed at launch, so changing them means a new dish.">
      <H2 id="v5">v5: petri-v5.testnet and petri-dish.near</H2>
      <p>The version both dishes run, built reproducibly at <a href={commit("ec5970f")}>ec5970f</a> with code hash <C>Foo3au6aYVQMV2cLv5p3DreSYEWgfHwq2MpKU4zv7U6j</C>.</p>
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
