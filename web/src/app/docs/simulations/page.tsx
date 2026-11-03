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

const cls = (v: string) => (v.startsWith("+") ? "n pos" : v.startsWith("−") ? "n neg" : "n");

export default function Page() {
  return (
    <DocPage
      slug="simulations"
      source={[
        { label: "sim/src/main.rs", path: "sim/src/main.rs" },
        { label: "sim/out-v5/summary.txt", path: "sim/out-v5/summary.txt" },
        { label: "sim/out-v5/fixes.txt", path: "sim/out-v5/fixes.txt" },
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
          <C>summary.txt</C> was produced on the v5 rules just before their last round of changes: tides paid 10% of the vault (<C>tide_bps 1000</C>), a guest&rsquo;s vault shares were paid as NEAR into an account it could not move, and the credit pool&rsquo;s winners were written one record each. <C>fixes.txt</C> then tested one change at a time against those rules, and four changes shipped (see <a href="#changed">What changed because of it</a>). The deployed rules are therefore not exactly the ones in the big table; where a fix measured the difference, both numbers are shown.
        </p>
      </Callout>

      <H2 id="run">Run it</H2>
      <Code lang="sh" title="Shell">{`cd sim
cargo run --release -- out-v5 all          # every scenario: summary.txt, players-*.csv, timeline.csv
cargo run --release -- out-v5 fixes        # one change at a time: fixes.txt
cargo run --release -- out-v5 probe 150 7  # one scenario, printed
cargo run --release -- out-v5 all --set tide_bps=500   # override any rule`}</Code>
      <p>
        It reads <C>../contract/launch-rules.json</C> unless given <C>--rules</C>. The outputs are in <a href={tree("sim/out-v5")}>sim/out-v5</a>.
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
      <Table caption="1 day, 3 seeds: the biggest tide and the biggest call">
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
        A transaction can burn at most 300 TGas. Before the fix, a dish of 15,000 players would have had 23 tides a day that no transaction could run, and it would have stopped. The contract test <C>a_tide_with_fifteen_hundred_winners_stays_well_under_the_gas_limit</C> now asserts under 10 TGas of host calls for a 1,500-winner tide.
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
            <td>Credit winnings kept in packed per-colony arrays; a tide touches no colony or credit record</td>
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
            <td>The keepers are registered for PETRI, and the keeper advances only when 20 generations behind or when the pot holds over 50 PETRI</td>
            <td>
              <C>3ad1c70</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        Earlier simulator rounds (v2 and v3) led to the NEAR buy-in, payback pricing, the reach cap, the house never being fed, the sell-back cap by vault share and the tide bounty cap. See the <Doc to="changelog">Changelog</Doc>.
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
