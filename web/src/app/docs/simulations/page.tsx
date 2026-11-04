import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, H2, H3, Table } from "@/components/docs/ui";
import { tree } from "@/components/docs/facts";

export const metadata = docMetadata("simulations");

// sim/out-v5/summary.txt, section 1: median (over seeds) of each kind's mean player, NEAR withdrawn minus NEAR paid.
const CASH: [string, string, string, string, string][] = [
  ["Builder", "−0.2656", "−0.1831", "−0.1094", "−0.1854"],
  ["Raider", "−0.2199", "−0.1534", "−0.1256", "−0.1574"],
  ["Defender", "−0.2138", "−0.1603", "−0.0872", "−0.1624"],
  ["Methuselah", "+0.0184", "+0.1419", "−0.0407", "−0.4499"],
  ["Late", "−0.3216", "−0.2682", "−0.1535", "−0.2740"],
  ["Whale", "−3.9720", "−2.1219", "−0.9856", "−2.1404"],
  ["SplitWhale", "−2.3855", "−1.3715", "−1.1381", "−1.1622"],
  ["Sniper", "−0.0764", "−0.0658", "−0.0572", "−0.0648"],
  ["Locker", "−0.8940", "−0.5767", "+0.5901", "−0.6451"],
  ["Racer", "−0.0526", "−0.0542", "−0.0611", "−0.0602"],
  ["Seller", "−0.1055", "−0.1055", "−0.1022", "−0.1054"],
  ["Guest", "0", "0", "0", "0"],
  ["SybilGuest", "−0.1639", "−0.1240", "−0.0986", "−0.1089"],
  ["SelfSponsor", "−0.4696", "−0.4205", "−0.3265", "−0.3966"],
  ["House", "−1.0781", "−1.0810", "−1.1114", "−1.0803"],
];

const KINDS: [string, string][] = [
  ["Builder", "0.05 NEAR at join, up to 0.25 in all; still lifes near home."],
  ["Raider", "Gliders and spaceships at rivals; one move in three a blinker siege."],
  ["Defender", "Eaters and beehives."],
  ["Methuselah", "0.1 / 0.5 NEAR; an R-pentomino an hour within 40 cells."],
  ["Late", "A builder that joins on day 2 or 3."],
  ["Whale", "2 NEAR at join, 3 in all; one colony, pulsars and beehives anywhere."],
  ["SplitWhale", "The same whale spread over 10 colonies (20 at 1,500 players)."],
  ["Sniper", "Plants in the 3 generations before each tide and sells after."],
  ["Locker", "1.5 / 2 NEAR; a 16 × 16 lattice of blocks 8 apart, so every empty cell is in its buffer; repairs every 20 generations."],
  ["Racer", "0.01 NEAR; never plants, advances for the pot and bounties."],
  ["Seller", "0.2 NEAR; buys and sells back."],
  ["Guest", "A relayer guest with 0.05 NEAR of sponsored credit, playing like a builder."],
  ["SybilGuest", "One wallet builder plus 10 relayer guests near it that plant blocks, sell every tide and claim."],
  ["SelfSponsor", "Sponsors 10 of its own full-access accounts with 0.05 NEAR each, plays them, claims, then unsponsors."],
  ["House", "The 5 strains: 0.05 NEAR plus 0.02 top-ups, 1 NEAR budget each, no sieges."],
];

// sim/out-v5/fixes.txt
const FIXES: [string, string, string, string, string, string, string][] = [
  ["150", "launched rules (tide_bps 1000)", "−0.1831", "−0.5767", "−1.0810", "42.2%", "5.8%"],
  ["150", "team keeper registered", "−0.1733", "−0.4554", "−1.0811", "42.0%", "5.7%"],
  ["150", "ledger kept as events", "−0.0293", "−0.2804", "−1.1261", "14.2%", "6.5%"],
  ["150", "tide_bps 500", "−0.1657", "−1.2077", "−1.0808", "42.3%", "3.1%"],
  ["150", "stake_keep_bps 8000", "−0.1741", "−0.5152", "−1.0814", "42.0%", "5.5%"],
  ["150", "reach 4", "−0.1798", "−0.4439", "−1.0805", "42.3%", "5.3%"],
  ["150", "reach 2", "−0.1714", "−0.4850", "−1.0801", "42.1%", "5.8%"],
  ["150", "siege_x 2", "−0.1763", "−0.5863", "−1.0804", "42.5%", "5.8%"],
  ["150", "sell_bps 3000", "−0.1785", "−0.4961", "−1.0807", "42.2%", "4.8%"],
  ["1,500", "launched rules (tide_bps 1000)", "−0.1094", "+0.5901", "−1.1114", "37.1%", "1.4%"],
  ["1,500", "team keeper registered", "−0.1089", "+0.5901", "−1.1128", "37.1%", "1.4%"],
  ["1,500", "ledger kept as events", "−0.0385", "+0.9813", "−1.1627", "9.4%", "2.2%"],
  ["1,500", "tide_bps 500", "−0.1098", "−0.4506", "−1.1107", "36.8%", "0.7%"],
  ["1,500", "stake_keep_bps 8000", "−0.1086", "+0.6376", "−1.1103", "37.1%", "1.4%"],
  ["1,500", "reach 4", "−0.1098", "+0.7034", "−1.1107", "37.1%", "1.4%"],
  ["1,500", "reach 2", "−0.1061", "+0.6222", "−1.1122", "36.9%", "1.4%"],
  ["1,500", "siege_x 2", "−0.1189", "+0.6128", "−1.1098", "37.8%", "1.4%"],
  ["1,500", "sell_bps 3000", "−0.0992", "+0.3890", "−1.1119", "37.1%", "1.2%"],
];

// sim/out-v6.1/summary.txt, section 5: the largest call of each kind in 30,000 colonies over 2 days (TGas, the 30 TGas payout
// reservation included, and the hot rows when it happened), then calls over 150 TGas and over their prepaid gas, v6 / v6.1.
const V61_CALLS: [string, string, string, string, string, string, string][] = [
  ["Join", "94.0 @ 26,035 rows", "222.0 @ 25,500 rows", "31.1 @ 2,320 rows", "60.2 @ 2,030 rows", "28 / 0", "9 / 0"],
  ["Plant", "204.6 @ 27,534 rows", "236.5 @ 27,468 rows", "26.8 @ 2,033 rows", "58.5 @ 1,820 rows", "67,841 / 0", "15,727 / 0"],
  ["Buy", "203.3 @ 27,528 rows", "234.0 @ 27,272 rows", "23.8 @ 1,793 rows", "56.6 @ 1,726 rows", "623 / 0", "366 / 0"],
  ["Sell", "147.5 @ 27,498 rows", "—", "53.2 @ 1,659 rows", "—", "0 / 0", "0 / 0"],
  ["Claim", "232.7 @ 27,478 rows", "—", "53.7 @ 1,666 rows", "—", "48,237 / 0", "0 / 0"],
  ["Advance", "—", "205.5 @ 27,538 rows", "—", "23.1 @ 1,358 rows", "2 / 0", "0 / 0"],
];

// sim/out-v6.1/summary.txt, section 5: analytic v6.1 at p hot rows on a full board (4,000 live cells, 400 colonies alive), every row a tide winner.
const V61_ANALYTIC: [string, string, string, string, string, string, string][] = [
  ["100", "3.6", "5.6", "44.9", "33.8", "3.4", "120 (120)"],
  ["1,500", "3.6", "15.7", "55.6", "43.9", "5.4", "120 (120)"],
  ["3,000", "3.6", "26.5", "67.0", "54.7", "7.6", "120 (120)"],
  ["5,000", "3.6", "41.0", "82.2", "69.2", "10.5", "120 (120)"],
  ["7,500", "3.6", "59.0", "101.2", "87.2", "14.0", "120 (120)"],
  ["10,000", "3.6", "77.1", "120.3", "105.2", "17.6", "120 (120)"],
];

// sim/out-v6.1/fixes.txt, "Measured": the young mainnet dish, 7 days, median cash per player; vault left; house NEAR paid; tide-entry storage as % of tide pay.
const V61_YOUNG: [string, string, string, string, string, string, string, string, string][] = [
  ["Penny alone", "v6", "+0.4372", "—", "—", "—", "—", "0.0000", "2.3327"],
  ["Penny alone", "v6.1", "+0.5709", "—", "—", "—", "—", "0.0002", "2.2784"],
  ["Penny alone", "v6.1 + tide_cap_bps 2500", "+0.4149", "—", "—", "—", "—", "0.1506", "2.2851"],
  ["Penny alone", "v6.1 + tide_bps 200", "+0.4552", "—", "—", "—", "—", "0.0934", "2.2650"],
  ["Penny alone", "v6.1 + tide_every 960", "+0.6073", "—", "—", "—", "—", "0.2230", "2.2933"],
  ["5 outsiders", "v6", "−0.0479", "−0.2496", "−0.2498", "+0.0667", "—", "0.0000", "2.3080"],
  ["5 outsiders", "v6.1", "−0.0481", "−0.2492", "−0.2504", "+0.0612", "—", "0.0115", "2.2849"],
  ["5 outsiders", "v6.1 + tide_cap_bps 2500", "−0.0497", "−0.2502", "−0.2510", "+0.0058", "—", "0.0198", "2.2885"],
  ["5 outsiders", "v6.1 + tide_bps 200", "−0.0489", "−0.2496", "−0.2531", "+0.0852", "—", "0.0282", "2.2744"],
  ["5 outsiders", "v6.1 + tide_every 960", "−0.0493", "−0.2482", "−0.2476", "+0.1847", "—", "0.2374", "2.3048"],
  ["20 outsiders", "v6", "−0.0469", "−0.2484", "−0.2457", "+0.2724", "−2.9984", "0.0315", "2.2740"],
  ["20 outsiders", "v6.1", "−0.0485", "−0.2483", "−0.2259", "+0.2114", "−3.0001", "0.0364", "2.2602"],
  ["20 outsiders", "v6.1 + tide_cap_bps 2500", "−0.0483", "−0.2495", "−0.2287", "+0.2360", "−3.0017", "0.0417", "2.2199"],
  ["20 outsiders", "v6.1 + tide_bps 200", "−0.0485", "−0.2491", "−0.2433", "+0.3452", "−2.9996", "0.0862", "2.2629"],
  ["20 outsiders", "v6.1 + tide_every 960", "−0.0488", "−0.2484", "−0.2471", "+0.4787", "−2.9651", "0.6431", "2.2770"],
];

const cls = (v: string) => (v.startsWith("+") ? "n pos" : v.startsWith("−") ? "n neg" : "n");

export default function Page() {
  return (
    <DocPage
      slug="simulations"
      source={[
        { label: "sim/src/main.rs", path: "sim/src/main.rs" },
        { label: "sim/out-v5/summary.txt", path: "sim/out-v5/summary.txt" },
        { label: "sim/out-v5/fixes.txt", path: "sim/out-v5/fixes.txt" },
        { label: "sim/out-v6.1/summary.txt", path: "sim/out-v6.1/summary.txt" },
        { label: "sim/out-v6.1/fixes.txt", path: "sim/out-v6.1/fixes.txt" },
      ]}
    >
      <H2 id="what">What the simulator is</H2>
      <p>
        <C>sim/</C> is a Rust program that runs the real rules from <C>petri-core</C> (the Life step, the capped feed on decaying stake, the planting price with the siege surcharge, the purchase and sell-back curves and the tide split) for days of generations, with scripted players including adversaries. It mirrors the contract&rsquo;s book-keeping: the two pools, storage paid from credit first, the tide&rsquo;s bounty and storage, the house, the sell-back cap, the catch-up cap and gas limit, and dormancy. Storage is computed from the borsh layout of what each call writes; gas is estimated from NEAR&rsquo;s fee schedule.
      </p>
      <p>
        It reports what every kind of player ends up with <strong>in NEAR actually withdrawn</strong>: tide claims, sales back, bounties and credit taken back, minus every NEAR attached, sponsored and spent on gas. PETRI still held is not counted as money, because the dish cannot buy it all back.
      </p>
      <Callout kind="note" title="Which rules these numbers describe">
        <p>
          <C>summary.txt</C> was produced on the v5 rules just before their last round of changes: tides paid 10% of the vault (<C>tide_bps 1000</C>), a guest&rsquo;s vault shares were paid as NEAR into an account it could not move, and the credit pool&rsquo;s winners were written one record each. <C>fixes.txt</C> then tested one change at a time against those rules, and four changes shipped in v5 (see <a href="#changed">What changed because of it</a>). The deployed rules are therefore not exactly the ones in the big table; where a fix measured the difference, both numbers are shown. v6 kept v5&rsquo;s economic parameters and changed who can do what (the house can neither sell nor take bounties or the keeper pot, sponsored credit is kept per sponsor, wNEAR is never refunded, slides license their pattern) and how each colony&rsquo;s numbers are stored. The simulator was then rerun on v6 (<C>sim/out-v6</C>), and on v6.1, the contract both dishes run now, with v6&rsquo;s rules and layout set back on the same seeds for comparison; those runs are described under <a href="#v6-1">v6.1</a>.
        </p>
      </Callout>

      <H2 id="run">Run it</H2>
      <Code lang="sh" title="Shell">{`cd sim
cargo run --release -- out-v5 all          # every scenario: summary.txt, players-*.csv, timeline.csv
cargo run --release -- out-v5 fixes        # one change at a time: fixes.txt
cargo run --release -- out-v5 probe 150 7  # one scenario, printed
cargo run --release -- out-v5 all --set tide_bps=500   # override any rule
cargo run --release -- out-v6.1 all --seeds 8          # the v6.1 rules, 84 s on 12 threads`}</Code>
      <p>
        It reads <C>../contract/launch-rules.json</C> unless given <C>--rules</C>. The outputs are in <a href={tree("sim/out-v5")}>sim/out-v5</a>, and for v6.1 in <a href={tree("sim/out-v6.1")}>sim/out-v6.1</a>. Both launch files were loaded exactly (<C>contract/launch-rules.json</C> for testnet, <C>contract/launch-rules-mainnet.json</C> for mainnet): their economic parameters are identical, and they differ only in the house, keeper and wNEAR account names.
      </p>

      <H2 id="kinds">Player kinds</H2>
      <p>Careful players spend at most half their PETRI per planting and try 30 spots before paying for a siege. After each tide, sellers race for the sale allowance: bots first, then a random quarter of the rest.</p>
      <Table>
        <thead>
          <tr>
            <th>Kind</th>
            <th>Plays</th>
          </tr>
        </thead>
        <tbody>
          {KINDS.map(([k, v]) => (
            <tr key={k}>
              <th>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="cash">Cash per player</H2>
      <p>
        NEAR withdrawn minus NEAR paid, gas included, for the mean player of each kind; the median over seeds (20, 12, 10 and 5 seeds per column). Positive means the kind took out more NEAR than it put in.
      </p>
      <Table caption="sim/out-v5/summary.txt, section 1 (tide_bps 1000)">
        <thead>
          <tr>
            <th>Kind</th>
            <th className="n">15 players, 7 days</th>
            <th className="n">150 players, 7 days</th>
            <th className="n">1,500 players, 7 days</th>
            <th className="n">150 players, 30 days</th>
          </tr>
        </thead>
        <tbody>
          {CASH.map(([k, ...v]) => (
            <tr key={k} className={k === "Locker" || k === "Methuselah" ? "hl" : undefined}>
              <th>{k}</th>
              {v.map((x, i) => (
                <td key={i} className={cls(x)}>
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        A Guest is 0 by construction: it attaches nothing and can withdraw nothing. The House loses about 1.08 to 1.11 NEAR each, by design: everything it spends goes to other players.
      </p>
      <H3 id="cash-petri">PETRI earned against PETRI spent</H3>
      <p>
        The PETRI side tells a different story from the NEAR side. At 150 players for a week a Builder earned 0.65 PETRI from the feed for every PETRI it planted, a Methuselah 5.16 and a Late joiner 1.07; at 1,500 players the ratios fall to between 0.09 and 0.44 for every kind. A crowded dish shares the same feed among more cells.
      </p>

      <H2 id="fixes">Fix experiments</H2>
      <p>
        One change at a time against the rules above, same seeds, 7 days, 12 seeds at 150 players and 10 at 1,500. <em>stor%</em> is storage as a share of NEAR in; <em>lock%</em> the Locker&rsquo;s share of all tide NEAR.
      </p>
      <Table caption="sim/out-v5/fixes.txt (selected columns)">
        <thead>
          <tr>
            <th className="n">Players</th>
            <th>Change</th>
            <th className="n">Builder</th>
            <th className="n">Locker</th>
            <th className="n">House</th>
            <th className="n">stor%</th>
            <th className="n">lock%</th>
          </tr>
        </thead>
        <tbody>
          {FIXES.map(([p, c, b, l, h, s, lt]) => (
            <tr key={p + c} className={c === "tide_bps 500" ? "hl" : undefined}>
              <td className="n">{p}</td>
              <td>{c}</td>
              <td className={cls(b)}>{b}</td>
              <td className={cls(l)}>{l}</td>
              <td className={cls(h)}>{h}</td>
              <td className="n">{s}</td>
              <td className="n">{lt}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Halving the tide is the only change that turns the Locker negative at 1,500 players (+0.59 to −0.45 NEAR) while leaving the Builder about where it was. Keeping the ledger as events instead of stored entries would cut storage from 42% to 14% of NEAR in, and helps every honest kind, but it also helps the Locker and it would remove the ledger the replay reads.
      </p>

      <H2 id="gas">Gas at scale</H2>
      <p>The simulator measured v5&rsquo;s gas, and its finding drove v5&rsquo;s packed arrays:</p>
      <Table caption="v5 simulator, 1 day, 3 seeds: the biggest tide and the biggest call">
        <thead>
          <tr>
            <th>Players</th>
            <th>Rules</th>
            <th className="n">Biggest tide</th>
            <th className="n">Tides over 300 TGas</th>
            <th className="n">Biggest call</th>
            <th className="n">Most winners</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>1,500</td>
            <td>credit winners written one record each</td>
            <td className="n">104 TGas</td>
            <td className="n">0</td>
            <td className="n">110 TGas</td>
            <td className="n">369</td>
          </tr>
          <tr className="hl">
            <td>1,500</td>
            <td>credit tide kept in a packed array (shipped)</td>
            <td className="n">11 TGas</td>
            <td className="n">0</td>
            <td className="n">19 TGas</td>
            <td className="n">365</td>
          </tr>
          <tr>
            <td>15,000</td>
            <td>credit winners written one record each</td>
            <td className="n">595 TGas</td>
            <td className="n neg">23</td>
            <td className="n">635 TGas</td>
            <td className="n">2,195</td>
          </tr>
          <tr className="hl">
            <td>15,000</td>
            <td>credit tide kept in a packed array (shipped)</td>
            <td className="n">70 TGas</td>
            <td className="n">0</td>
            <td className="n">115 TGas</td>
            <td className="n">2,195</td>
          </tr>
        </tbody>
      </Table>
      <p>
        A transaction can burn at most 300 TGas. Before that fix, a dish of 15,000 players would have had 23 tides a day that no transaction could run, and it would have stopped.
      </p>
      <H3 id="gas-v6">v6: cold pages and a hot table</H3>
      <p>
        The packed arrays had a limit of their own: each covered every colony that ever joined, so a join rewrote seven of them and every catch-up and tide rewrote several, and the gas grew with every colony until it would have run out at about 27,000. In v6 each colony&rsquo;s numbers lived in exactly one of two places (<C>contract/src/books.rs</C>): a <strong>cold page</strong> of 64 colonies, where a join appends one slot, or the <strong>hot table</strong> of the colonies with stake, which a colony entered when it planted and left (16 a call) once its stake had decayed to nothing. The feed, the tides and the decay touched only the hot table. v6&rsquo;s contract tests built a dish of 30,000 colonies and measured each call&rsquo;s host-call gas in the unit runtime:
      </p>
      <Table caption="v6 contract tests: TGas of host calls with 30,000 colonies">
        <thead>
          <tr>
            <th>Call</th>
            <th className="n">1,501 playing</th>
            <th className="n">All 30,000 playing</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>join</td>
            <td className="n">1.53</td>
            <td className="n">1.53</td>
          </tr>
          <tr>
            <td>plant</td>
            <td className="n">7.28</td>
            <td className="n">118.88</td>
          </tr>
          <tr>
            <td>advance through a tide, paying every winner</td>
            <td className="n">36.60</td>
            <td className="n">148.20</td>
          </tr>
          <tr>
            <td>claim, a playing colony</td>
            <td className="n">34.55</td>
            <td className="n">28.47</td>
          </tr>
          <tr>
            <td>claim, the newcomer, with NEAR</td>
            <td className="n">36.28</td>
            <td className="n">147.88</td>
          </tr>
          <tr>
            <td>claim, an idle colony</td>
            <td className="n">1.85</td>
            <td className="n">—</td>
          </tr>
        </tbody>
      </Table>
      <p>
        Every figure for a call that pays NEAR includes about 30 TGas for the transfer and its callback. v6&rsquo;s tests asserted under 60 TGas a call at 1,501 playing and under 200 TGas with all 30,000 playing. These are host calls measured in the unit runtime, which charges neither the wasm execution on chain nor the real price per rewritten byte. The simulator, which does count both, found that v6&rsquo;s hot table was still far too large on a busy dish: stake lingers about a day after a colony&rsquo;s last planting, so with 30,000 colonies it held up to 27,538 rows and a plant cost 237 TGas. That is what v6.1 fixes, next.
      </p>

      <H2 id="v6-1">v6.1: what the rerun measured</H2>
      <p>
        The simulator was rerun on v6.1 (<C>sim/out-v6.1</C>, 8 seeds). Every v6.1 run mirrors the contract: the hot table holds only colonies that earned since the last tide or have living cells and a stake that can still earn (125 or more thousandths of a cell at reach 8; never the house), at most 10,000 rows, 32 leaving a call; stake waits in a 69-byte cold slot (pages of 32) and decays lazily; the catch-up reserves the purse part of the table only when a tide falls in it, and stops at the lesser of 110 TGas and the prepaid gas less 40, less what is still to write; PETRI amounts in entries are <C>u64</C> and a tide stores 130 bytes (was 289); <C>PLANT_STORAGE_BASE</C> is 180 (was 240) and <C>BUY_BYTES</C> 113 (was 140); licences only for slides of at least 12 cells; royalties from planters that never attached NEAR go to the agar; the keeper pot goes to any outside caller whose call ran a generation; the site prepays 300 TGas. Runs marked V6 set all of v6&rsquo;s rules and layout back on the same seeds, and reproduce <C>sim/out-v6</C> exactly. Cash is again NEAR a player actually got back minus NEAR it actually paid, storage and gas included; the table cells are medians over seeds.
      </p>

      <H3 id="v6-1-gas">Gas at 30,000 colonies</H3>
      <p>
        Mixed outsiders joining over 1.5 days plus the house, 30,005 colonies, 2 days, 2 seeds. Each cell is the largest call of that kind, in TGas with the 30 TGas payout reservation included, and the hot rows when it happened.
      </p>
      <Table caption="sim/out-v6.1/summary.txt, section 5: largest gas per call (TGas)">
        <thead>
          <tr>
            <th>Call</th>
            <th className="n">v6, no tide</th>
            <th className="n">v6, with a tide</th>
            <th className="n">v6.1, no tide</th>
            <th className="n">v6.1, with a tide</th>
            <th className="n">Over 150 TGas, v6 / v6.1</th>
            <th className="n">Over prepaid gas, v6 / v6.1</th>
          </tr>
        </thead>
        <tbody>
          {V61_CALLS.map(([c, ...v]) => (
            <tr key={c}>
              <th>{c}</th>
              {v.map((x, i) => (
                <td key={i} className={i === 2 || i === 3 ? "n pos" : "n"}>
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        Hot rows averaged 1,315 (1,303 to 1,327) and peaked at 2,389 (2,381 to 2,397); in v6 they averaged 17,102 and peaked at 27,538. In v6.1, 68,304 rows left the table; catch-ups cut short by the gas limit: 0; plantings refused as behind the clock: 0; plantings refused because the table held 10,000 rows: 0 of 427,131 (v6: 413,134 plantings in all). Calls over 150 TGas fell from 116,731 to 0, and calls over their prepaid gas from 16,102 to 0 (prepaid is now 300 on the site).
      </p>
      <p>
        The worst case cannot be reached in a simulation of this size, so it is computed: at <em>p</em> hot rows on a full board (4,000 live cells, 400 colonies alive), every row a tide winner, NEAR payouts reserving 30 TGas, the tide call also moving 32 rows to their cold pages. The table holds at most 10,000 rows.
      </p>
      <Table caption="sim/out-v6.1/summary.txt, section 5: analytic v6.1 (TGas)">
        <thead>
          <tr>
            <th className="n">Rows</th>
            <th className="n">Join</th>
            <th className="n">Plant</th>
            <th className="n">Advance through a tide</th>
            <th className="n">Claim with NEAR</th>
            <th className="n">Claim, idle</th>
            <th className="n">Generations per catch-up at 300 (tide in)</th>
          </tr>
        </thead>
        <tbody>
          {V61_ANALYTIC.map(([p, ...v]) => (
            <tr key={p} className={p === "10,000" ? "hl" : undefined}>
              <td className="n">{p}</td>
              {v.map((x, i) => (
                <td key={i} className="n">
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        With 10,000 rows (the cap) the tide call is 120 TGas, a claim with NEAR 105 and a plant 77, and a catch-up steps all 120 generations with or without a tide in it. v6 stepped 1 at 25,000 rows. The contract&rsquo;s own tests run 30,000 colonies that all have stake, scale the unit runtime&rsquo;s host calls by the real price per rewritten byte (×1.83, measured in the test) and add an estimate of the wasm, which the unit runtime does not charge: with 1,500 playing the largest call is 67.5 TGas (advance through a paying tide; plant 20.4, claim with NEAR 47.7); with 9,999 playing, a full table, 125.7 (advance through a tide; claim with NEAR 115.6, plant 88.3). They assert that every call stays under 150 TGas (<C>thirty_thousand_colonies_with_stake_every_call_under_150_tgas_on_the_real_network</C>, <C>a_full_hot_table_keeps_every_call_under_150_tgas_on_the_real_network</C>). On the ordinary mainnet dish, 150 players for 7 days, the largest calls (TGas, v6 / v6.1) are Join 21 / 22, Plant 40 / 39, Buy 7 / 6, Sell 67 / 34, Claim 68 / 68, Advance 38 / 37, Slide 5 / 5, Unsponsor 33 / 33; hot rows average 111 (v6) and 25 (v6.1).
      </p>

      <H3 id="v6-1-tides">Smaller ledger entries</H3>
      <p>
        A tide stored 289 bytes in v6 and stores 130 in v6.1 (a 126-byte entry and 4 bytes in the packed tide index), because its amounts are worked out by the replay instead of stored. On the young mainnet dish, the tide entry&rsquo;s storage as a share of tide pay fell from 39% to 21% with one outsider, from 31% to 16% with 5 and from 8% to 4% with 20. Colonies received 0.69 to 0.80 and 1.00 to 1.10 NEAR of those tides (with 20 outsiders 5.81 to 5.47: the tides are smaller, 6.32 to 5.74, because plantings attach 60 fewer bytes of storage deposit, whose surplus fed the vault). Of all NEAR that comes in, storage fell from 70% to 61% with one outsider. The other compacted entries (Buy 105 to 97, Sell 105 to 97, Claim 104 to 96, Plant 111 to 103 + 2 per cell, the plant index 53 to 49, the note key 9 to 5 bytes) are modelled too.
      </p>
      <Table caption="sim/out-v6.1/fixes.txt, Measured: the young mainnet dish, 7 days. Median cash per player (NEAR); vault left and NEAR paid in by the house">
        <thead>
          <tr>
            <th>Outsiders</th>
            <th>Rules</th>
            <th className="n">Penny</th>
            <th className="n">Builder</th>
            <th className="n">Raider</th>
            <th className="n">Methuselah</th>
            <th className="n">Whale</th>
            <th className="n">Vault left</th>
            <th className="n">House paid</th>
          </tr>
        </thead>
        <tbody>
          {V61_YOUNG.map(([o, r, ...v]) => (
            <tr key={o + r} className={r === "v6.1" ? "hl" : undefined}>
              <td>{o}</td>
              <td>{r}</td>
              {v.map((x, i) => (
                <td key={i} className={i < 5 ? cls(x) : "n"}>
                  {x}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>

      <H3 id="v6-1-royalty">Royalties</H3>
      <p>
        <strong>Royalty farming</strong> is one player minting slides of the common patterns at launch (in v6: beehive, loaf, eater, glider, LWSS, R-pentomino, toad, pulsar) so every other player who plants one pays it 10%. With <C>licence_min_cells</C> 12 only the pulsar (48 cells) of the farmer&rsquo;s eight patterns is still a licence. At 150 players for 7 days the farmer&rsquo;s cash fell from +0.2910 (+0.0243 to +0.3565) to +0.0834 (−0.0063 to +0.1261) NEAR; with <C>licence_min_cells</C> 0, v6.1 would pay it +0.3240 (+0.0823 to +0.3614). Licensed plantings fell from 7,852 to 402 (all pulsars) and royalties from 6,296.1 to 2,845.7 PETRI. On the young dish with 20 outsiders the farmer went from +0.2095 to +0.0341 (−0.0286 to +0.2112), royalties from 2,202.9 to 1,503.9 PETRI. The whales, who plant the pulsars, lose −1.9446 with the farmer and −1.9477 without it: the licence&rsquo;s 25% discount covers the royalty for them.
      </p>
      <p>
        <strong>Guests&rsquo; royalties.</strong> The royalty operator mints a beehive slide (6 cells: no licence in v6.1). Royalties paid by colonies that never attached NEAR, received by the royalty operator&rsquo;s wallet: 56.2 (42.0 to 74.7) PETRI in v6, 0.0 in v6.1 and 0.0 in v6.1 with <C>licence_min_cells</C> 0 and the beehive licence kept, so the agar rule alone closes it (152.8 PETRI of royalties went to the agar instead). The operator&rsquo;s cash: −0.1580 (v6), −0.1492 (v6.1, licence kept) and −0.0967 (v6.1, no 6-cell licence, so its guests plant beehives without paying it). Its royalties in: 773.5 (525.3 to 880.8) PETRI in v6, 667.0 and 0.0.
      </p>

      <H3 id="v6-1-pot">The keeper pot</H3>
      <p>
        Pot left at the end of 7 days: 1.1 (0.1 to 3.7) PETRI on the 150-player mainnet dish against 12.3 (0.1 to 21.8) in v6; 1.1 (0.0 to 1.9) against 1,479.7 (1,420.7 to 1,692.7) on the young dish with 20 outsiders. It now goes to whoever&rsquo;s call runs the generation; the median received per player at 150 players was Penny 1.0, Builder 9.4, Raider 5.8, Defender 9.6, Methuselah 70.6, Late 22.5, Whale 32.5, Sniper 1.3, Racer 12.0, Guest 1.8 and Locker 23.6 PETRI (in v6 the Racer alone took 1,081.8). The Racer&rsquo;s cash went from −0.0192 (−0.0204 to −0.0170) to −0.0054 (−0.0063 to −0.0046). Keepers and the house never take it.
      </p>
      <p>
        The testnet keeper (<C>agents/run.mjs</C>, unchanged) still advances whenever a registered keeper sees more than 50 PETRI in the pot. Players&rsquo; calls now empty the pot every generation, so it never gets there: 29 (26 to 31) calls a day registered or unregistered (v6: 4,820 against 30), 0.0151 NEAR a day at mainnet gas price, pot left 1.3 (0.4 to 1.6) PETRI.
      </p>
      <p>
        Otherwise the economy is within seed noise at 150 players for 7 days (mainnet, v6 against v6.1): Builder −0.1931 and −0.1899, Methuselah +0.4100 and +0.3680, Whale −1.9995 and −1.9477, Penny −0.0431 and −0.0454. The mainnet house lasts a day longer, out of NEAR on day 7 (6 to 7) where v6 was out on day 6, because its plantings carry less storage deposit.
      </p>

      <H3 id="v6-1-broken">What still looks broken</H3>
      <ul>
        <li>
          <strong>A pulsar farmer still pays (N1).</strong> +0.08 NEAR a week at 150 players, from 2,846 PETRI of royalties out of 402 whale plantings. <C>licence_min_cells</C> 12 removes the small common patterns but not the big ones: whoever mints the first slide of a pattern others will plant (the pulsar, 48 cells; the glider gun, 36) collects 10% of every licensed planting of it. Measured on v6.1, <C>licence_min_cells</C> 49 makes the farmer lose 0.156 (150 players) and 0.158 (young dish, 20 outsiders), with royalties 0; <C>slide_royalty_bps</C> 0 makes it lose 0.158 and 0.077, with royalties 0 and the whales keeping the discount (−1.96). Either closes it in the model; 49 would keep royalties for large original slides, though no model here has players planting other people&rsquo;s large custom patterns, so how much of the licence idea survives at 49 is not measured. The launch rules keep 12.
        </li>
        <li>
          <strong>The first outsider still takes the house&rsquo;s subsidy (F2).</strong> Whoever is alone on the dish collects every tide (100% of about 165), and more of it reaches that player now that tides store less: a lone 0.01 NEAR Penny nets +0.57 (+0.54 to +0.62) NEAR of the house&rsquo;s 2.28 NEAR in a week (v6 +0.44). With 5 outsiders its share of all tide shares is 15% (4% to 43%), with 20 under 1%. <C>tide_cap_bps</C> 2500 (no colony more than 25% of a tide) gives +0.41 with 0.15 NEAR left in the vault; <C>tide_every</C> 960 gives +0.61 and <C>tide_bps</C> 200 +0.46 (table above). A judgment call.
        </li>
        <li>
          <strong>The house runs dry (F8).</strong> The mainnet house runs out of NEAR on day 7 (6 to 7) at 0.55 NEAR a strain, 1/8 pace and 100 PETRI a day (v6: day 6); about 1.2 NEAR a strain would last to Nov 18 (a linear estimate, not simulated).
        </li>
        <li>
          <strong>The Methuselah is still ahead (N2).</strong> +0.38 at 15 players and +0.37 at 150 (v6 +0.42, +0.41), −0.05 at 1,500 and −0.39 over 30 days.
        </li>
      </ul>
      <p>
        Not broken, checked again on v6.1: house laundering (all paths refused; 0 PETRI moved in 423 runs), sybil guests (no NEAR in guest accounts; operators lose 0.10 to 0.12 at the median), self-sponsoring (−0.51 to −0.72 at the median), the carpet locker (loses at every size), dormancy and idle-tide skips, the join&rsquo;s cost on a current dish (3.6 TGas analytic, 60 TGas at most when it caught up through a paying tide) and the 10,000-row cap (never reached at 30,000 colonies).
      </p>

      <H2 id="zero">A dish with no players</H2>
      <Table caption="30 days, sim/out-v5/fixes.txt and summary.txt section 7">
        <thead>
          <tr>
            <th>Scenario</th>
            <th className="n">Contract&rsquo;s own storage</th>
            <th className="n">Keeper gas</th>
            <th className="n">Vault left</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Empty dish, keeper on, a tide entry every hour</td>
            <td className="n neg">+1.9512 NEAR</td>
            <td className="n">3.1755 NEAR</td>
            <td className="n">0</td>
          </tr>
          <tr className="hl">
            <td>Empty dish, keeper on, idle tides skipped (shipped)</td>
            <td className="n">0</td>
            <td className="n">3.1755 NEAR</td>
            <td className="n">0</td>
          </tr>
          <tr>
            <td>Nobody calls for 30 days, then one visitor</td>
            <td className="n">0</td>
            <td className="n">0.00053 NEAR, 1 call</td>
            <td className="n">0</td>
          </tr>
          <tr>
            <td>House only, keeper on</td>
            <td className="n">−0.0796 NEAR</td>
            <td className="n">3.4962 NEAR</td>
            <td className="n">0.2696 NEAR (2.2208 with idle tides skipped)</td>
          </tr>
        </tbody>
      </Table>
      <p>
        The dormant dish woke with a single Skip of 172,680 generations and caught up in one call. With only the house playing, nobody outside the house earns, so once idle tides are skipped the vault keeps what the house paid in for the first real player.
      </p>

      <H2 id="storage">Storage and the newcomer</H2>
      <p>
        Storage took 37.1% to 47.2% of all NEAR that came in, depending on the scenario: 44.2% at 15 players, 42.2% at 150, 37.1% at 1,500 and 45.2% at 150 players over 30 days. It is the largest single cost in the economy.
      </p>
      <p>
        A newcomer&rsquo;s cheapest planting (a 2 × 2 block, a siege if there is no free spot) cost 3.2 to 3.9 mNEAR all in on dishes of up to 1,500 players, or about 4.1 to 6.2 mNEAR as a siege. With a Locker on a 15-player dish, only 0.2% of 2 × 2 spots were free after the first hour (94.8% without one), recovering to 51% by day 7. At 15,000 players almost no spot was free all day, so most plantings were sieges.
      </p>

      <H2 id="changed">What changed because of it</H2>
      <Table>
        <thead>
          <tr>
            <th>Finding</th>
            <th>Change in the contract or agents</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>A Locker made money at 1,500 players and took the most tide NEAR</td>
            <td>
              <C>tide_bps</C> from 1000 to 500: tides pay 5% of each pool
            </td>
            <td>
              <C>3ad1c70</C>
            </td>
          </tr>
          <tr>
            <td>A 15,000-player tide needed up to 595 TGas and would halt the dish</td>
            <td>v5: credit winnings kept in packed per-colony arrays, so a tide touches no colony or credit record. v6 replaced the arrays, whose cost grew with every colony that ever joined, with cold pages and a hot table of the colonies with stake (<C>dd18fac</C>)</td>
            <td>
              <C>3ad1c70</C>
            </td>
          </tr>
          <tr>
            <td>Guests were paid NEAR into accounts that could not move it (stranded)</td>
            <td>A colony that never attached NEAR is paid tide shares, sales and bounties as credit</td>
            <td>
              <C>3ad1c70</C>, <C>9da6fbe</C>
            </td>
          </tr>
          <tr>
            <td>An empty dish wrote a tide entry every hour at the contract&rsquo;s expense</td>
            <td>A tide with nobody to pay is skipped: no entry, no decay</td>
            <td>
              <C>3ad1c70</C>
            </td>
          </tr>
          <tr>
            <td>An unregistered keeper called every time the pot passed 5 PETRI (0.53 NEAR of gas a day at 150 players; 0.04 registered)</td>
            <td>v5: the keepers were registered for PETRI and advanced only when 20 generations behind or when the pot held over 50 PETRI. Since v6 a keeper never takes the pot or a bounty (both stay with the players), and on mainnet it advances only before the clock would skip, once someone outside the house plays</td>
            <td>
              <C>3ad1c70</C>
            </td>
          </tr>
          <tr>
            <td>In v6 a 30,000-colony dish held up to 27,538 hot rows, a plant cost 237 TGas, and 116,731 calls passed 150 TGas</td>
            <td>v6.1: the hot table holds only colonies that play now, at most 10,000, 32 leaving a call; cold pages of 32; the catch-up reserves only what the rest of the call writes; the site prepays 300 TGas</td>
            <td>v6.1</td>
          </tr>
          <tr>
            <td>A tide cost 289 bytes, 39% of a lone outsider&rsquo;s tide pay</td>
            <td>v6.1: a 130-byte tide entry; the replay works out the amounts, and a <C>tide</C> event logs them; Buy, Plant, Sell and Claim shrank too</td>
            <td>v6.1</td>
          </tr>
          <tr>
            <td>A farmer licensing small common slides took 10% of every planting of them</td>
            <td>v6.1: a slide is a licence only from <C>licence_min_cells</C> 12</td>
            <td>v6.1</td>
          </tr>
          <tr>
            <td>Free-play planters paid royalties to a sybil wallet (56 PETRI)</td>
            <td>v6.1: a planter that never attached NEAR pays its royalty to the agar</td>
            <td>v6.1</td>
          </tr>
          <tr>
            <td>The keeper pot stranded at 1,480 PETRI after a week on a young dish</td>
            <td>v6.1: the pot goes to the account whose call ran the generation</td>
            <td>v6.1</td>
          </tr>
        </tbody>
      </Table>
      <p>
        Earlier simulator rounds (v2 and v3) led to the NEAR buy-in, payback pricing, the reach cap, the house never being fed, the sell-back cap by vault share and the tide bounty cap. v6&rsquo;s changes came from a review of the contract rather than the simulator; v6.1&rsquo;s came from rerunning the simulator on v6. See the <Doc to="changelog">Changelog</Doc>.
      </p>

      <H2 id="losses">What loses money</H2>
      <ul>
        <li>
          <strong>Almost every kind.</strong> In 49 of the 52 cells of the cash table outside Guest and House, the kind ends a week or a month with less NEAR than it brought. Storage takes 37% to 47% of the NEAR that comes in, gas takes more, and what is left is shared.
        </li>
        <li>
          <strong>Whales lose the most</strong>: about 1 to 4 NEAR a week, because they pay for far more cells than their reach can be paid for.
        </li>
        <li>
          <strong>The winners</strong> were the Methuselah over a week on small and mid-sized dishes (+0.02 and +0.14 NEAR; it loses at 1,500 players and over 30 days) and the Locker at 1,500 players under the old tide rate (+0.59 NEAR), which the shipped 5% tide turns into a loss.
        </li>
        <li>
          <strong>Every adversary kind loses</strong> in every scenario measured (Sniper, Racer, Seller, SybilGuest, SelfSponsor, SplitWhale), except the Locker at 1,500 players, which the shipped 5% tide turns into a loss.
        </li>
      </ul>
      <Callout kind="money">
        <p>
          Petri is a game whose prizes are paid from what players put in, less storage and gas. Play with NEAR you are happy to spend on it.
        </p>
      </Callout>
    </DocPage>
  );
}
