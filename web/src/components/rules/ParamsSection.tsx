"use client";

import { useLive, int, near } from "@/lib/live";
import { REPO, fmtPetri } from "@/lib/config";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";

// sim/out-v2/summary.txt, as written by `cargo run --release -p petri-sim -- sim/out-v2` (7 days each).
const SOCIETY: Record<string, string> = {
  A: "6 builders, 3 raiders, 2 defenders, 4 late",
  B: "The same, plus 1 methuselah",
  C: "The same as the first, plus 1 whale and 30 sybils",
};

type Kind = { kind: string; n: number; earned: number; pct: number; spent: number; ratio: number; paid: number; won: number };
const V2: { society: keyof typeof SOCIETY; kinds: Kind[] }[] = [
  {
    society: "A",
    kinds: [
      { kind: "Builder", n: 6, earned: 29494, pct: 52, spent: 16785, ratio: 1.76, paid: 0.4952, won: 0.4911 },
      { kind: "Raider", n: 3, earned: 29568, pct: 26, spent: 13436, ratio: 2.2, paid: 0.4072, won: 0.5048 },
      { kind: "Defender", n: 2, earned: 32820, pct: 19, spent: 20258, ratio: 1.62, paid: 0.5859, won: 0.5602 },
      { kind: "Late", n: 4, earned: 2401, pct: 3, spent: 1704, ratio: 1.41, paid: 0.1017, won: 0.0398 },
    ],
  },
  {
    society: "B",
    kinds: [
      { kind: "Builder", n: 6, earned: 21946, pct: 39, spent: 11666, ratio: 1.88, paid: 0.4011, won: 0.4363 },
      { kind: "Raider", n: 3, earned: 22096, pct: 19, spent: 10705, ratio: 2.06, paid: 0.3731, won: 0.4281 },
      { kind: "Defender", n: 2, earned: 17382, pct: 10, spent: 10386, ratio: 1.67, paid: 0.3634, won: 0.3439 },
      { kind: "Methuselah", n: 1, earned: 78602, pct: 23, spent: 56313, ratio: 1.4, paid: 1.781, won: 1.5998 },
      { kind: "Late", n: 4, earned: 7488, pct: 9, spent: 4368, ratio: 1.71, paid: 0.193, won: 0.1448 },
    ],
  },
  {
    society: "C",
    kinds: [
      { kind: "Builder", n: 6, earned: 20422, pct: 36, spent: 13581, ratio: 1.5, paid: 0.4185, won: 0.5824 },
      { kind: "Raider", n: 3, earned: 23208, pct: 21, spent: 9879, ratio: 2.35, paid: 0.3198, won: 0.5105 },
      { kind: "Defender", n: 2, earned: 22699, pct: 13, spent: 10888, ratio: 2.08, paid: 0.3462, won: 0.5925 },
      { kind: "Whale", n: 1, earned: 51097, pct: 15, spent: 50780, ratio: 1.01, paid: 3.3574, won: 1.4486 },
      { kind: "Sybil", n: 30, earned: 215, pct: 2, spent: 19, ratio: 11.5, paid: 0.0254, won: 0.0246 },
      { kind: "Late", n: 4, earned: 10832, pct: 13, spent: 6832, ratio: 1.59, paid: 0.2476, won: 0.2092 },
    ],
  },
];

type Run = {
  variant: string;
  society: keyof typeof SOCIETY;
  live: number;
  peak: number;
  supply: number;
  agar: number;
  burned: number;
  largest: number;
  gini: number;
  big: string;
  sybil: number | null;
  late: number;
};
const RUNS: Run[] = [
  { variant: "launch-like", society: "A", live: 1130, peak: 1807, supply: 944568, agar: 484869, burned: 55432, largest: 18, gini: 0.3, big: "—", sybil: null, late: 3.42 },
  { variant: "launch-like", society: "B", live: 1180, peak: 1852, supply: 941435, agar: 486739, burned: 58565, largest: 35, gini: 0.56, big: "Methuselah 8.20", sybil: null, late: 3.05 },
  { variant: "launch-like", society: "C", live: 994, peak: 1803, supply: 930929, agar: 493447, burned: 69071, largest: 19, gini: 0.74, big: "Whale 3.32", sybil: 25.08, late: 3.69 },
  { variant: "v2", society: "A", live: 962, peak: 1639, supply: 905825, agar: 742662, burned: 94175, largest: 22, gini: 0.34, big: "—", sybil: null, late: 1.41 },
  { variant: "v2", society: "B", live: 1253, peak: 1846, supply: 901664, agar: 745951, burned: 98336, largest: 66, gini: 0.36, big: "Methuselah 1.40", sybil: null, late: 1.71 },
  { variant: "v2", society: "C", live: 1142, peak: 1616, supply: 894216, agar: 743930, burned: 105784, largest: 14, gini: 0.75, big: "Whale 1.01", sybil: 11.5, late: 1.59 },
  { variant: "v2-uncapped", society: "A", live: 1430, peak: 1511, supply: 917295, agar: 733153, burned: 82705, largest: 37, gini: 0.45, big: "—", sybil: null, late: 1.7 },
  { variant: "v2-uncapped", society: "B", live: 1037, peak: 1752, supply: 935493, agar: 717620, burned: 64507, largest: 83, gini: 0.79, big: "Methuselah 3.57", sybil: null, late: 2.33 },
  { variant: "v2-uncapped", society: "C", live: 1083, peak: 1617, supply: 898914, agar: 739852, burned: 101086, largest: 41, gini: 0.81, big: "Whale 1.48", sybil: 5.1, late: 1.54 },
  { variant: "v2-cap-10", society: "A", live: 908, peak: 1620, supply: 910316, agar: 738943, burned: 89684, largest: 19, gini: 0.34, big: "—", sybil: null, late: 2.27 },
  { variant: "v2-cap-10", society: "B", live: 1130, peak: 1827, supply: 903035, agar: 744736, burned: 96965, largest: 53, gini: 0.34, big: "Methuselah 1.09", sybil: null, late: 1.93 },
  { variant: "v2-cap-10", society: "C", live: 1245, peak: 1648, supply: 885690, agar: 750133, burned: 114310, largest: 21, gini: 0.73, big: "Whale 0.82", sybil: 5.89, late: 1.59 },
  { variant: "v2-payback-240", society: "A", live: 1477, peak: 1681, supply: 949940, agar: 706798, burned: 50060, largest: 33, gini: 0.21, big: "—", sybil: null, late: 3.69 },
  { variant: "v2-payback-240", society: "B", live: 966, peak: 1827, supply: 951410, agar: 705210, burned: 48590, largest: 32, gini: 0.33, big: "Methuselah 2.85", sybil: null, late: 3.34 },
  { variant: "v2-payback-240", society: "C", live: 1277, peak: 1686, supply: 940700, agar: 705593, burned: 59300, largest: 21, gini: 0.73, big: "Whale 1.96", sybil: 14.72, late: 2.78 },
  { variant: "v2-payback-960", society: "A", live: 1114, peak: 1504, supply: 873379, agar: 768479, burned: 126621, largest: 45, gini: 0.56, big: "—", sybil: null, late: 0.65 },
  { variant: "v2-payback-960", society: "B", live: 1378, peak: 1757, supply: 867760, agar: 773241, burned: 132240, largest: 58, gini: 0.66, big: "Methuselah 1.00", sybil: null, late: 0.85 },
  { variant: "v2-payback-960", society: "C", live: 1000, peak: 1547, supply: 869161, agar: 763428, burned: 130839, largest: 34, gini: 0.87, big: "Whale 0.88", sybil: 3.07, late: 1.44 },
  { variant: "v2-20ppm", society: "A", live: 778, peak: 1561, supply: 841390, agar: 550276, burned: 158610, largest: 19, gini: 0.39, big: "—", sybil: null, late: 1.16 },
  { variant: "v2-20ppm", society: "B", live: 1247, peak: 1790, supply: 857207, agar: 538806, burned: 142793, largest: 56, gini: 0.56, big: "Methuselah 1.48", sybil: null, late: 0.72 },
  { variant: "v2-20ppm", society: "C", live: 937, peak: 1672, supply: 809090, agar: 565377, burned: 190910, largest: 20, gini: 0.8, big: "Whale 0.99", sybil: 9.87, late: 1.89 },
];

const VARIANT: Record<string, string> = {
  "launch-like": "Close to the first dish",
  v2: "Launch values",
  "v2-uncapped": "No cap",
  "v2-cap-10": "Cap at 10%",
  "v2-payback-240": "Payback 240",
  "v2-payback-960": "Payback 960",
  "v2-20ppm": "Feed 20 ppm",
};

const CHANGES: [string, string][] = [
  [
    "The first dish paid players about 2.8 times the PETRI they spent. Its cell price had no link to what a cell earned, and every new colony got PETRI for free.",
    "Now a cell costs what an average cell earns in 480 generations, the feed is half as fast, and PETRI has to be bought from the agar with NEAR.",
  ],
  [
    "A planter of methuselahs, small seeds that grow for a long time, took 45% of the dish and earned 12.8 times what it spent.",
    "Now no colony is counted for more than 15% of the living cells, in the feed or at the tides. In the simulator the same grower covered 66% of the cells, took 23% of the earnings and earned 1.40 times its spend.",
  ],
  [
    "Every new account got 64 PETRI free, so many accounts meant many grants.",
    "Now there is no grant. Joining takes at least 0.01 NEAR and buys PETRI at the curve's price. In the simulator 30 one-shot accounts each paid 0.0254 NEAR and won back 0.0246 at the tides.",
  ],
  [
    "The feed logged one event per colony per generation. NEAR caps the logs of one call at 16 KB, so at about 115 colonies a catch-up could no longer fit, and the dish would have stopped.",
    "Now earnings accrue in one record and each colony claims its own. A catch-up logs one summary line; the contract test with 25 living colonies logs at most three lines and under 1,500 bytes.",
  ],
  [
    "The contract account could send PETRI to itself and mint it.",
    "Now the contract refuses itself as the caller of join, buy, plant, claim, advance and every transfer, refuses transfers to its own account, and will not register itself. Two contract tests check it.",
  ],
];

export function ParamsSection() {
  const { rules } = useLive();
  const r = rules ?? LAUNCH;
  const params: [string, string, string][] = [
    ["width × height", `${r.width} × ${r.height}`, "Cells on the dish, edges wrapped."],
    ["generation_ms", int(Number(r.generation_ms)), "Milliseconds between generations."],
    ["max_supply", `${fmtPetri(r.max_supply, 0)} PETRI`, "Minted once, into the agar."],
    ["feed_ppm", String(r.feed_ppm), "Parts per million of the agar fed to the living each generation."],
    ["keeper_bps", `${r.keeper_bps} (${r.keeper_bps / 100}%)`, "Share of the feed set aside in the keeper pot."],
    ["cap_bps", `${r.cap_bps} (${r.cap_bps / 100}%)`, "Most of the living cells one colony counts for, in the feed and the tides."],
    ["cap_min", int(r.cap_min), "The cap is never below this many cells."],
    ["burn_bps", `${r.burn_bps} (${r.burn_bps / 100}%)`, "Share of a planting burned; the rest returns to the agar."],
    ["payback", int(r.payback), "Generations of an average cell's feed that a cell costs."],
    ["min_cell_price", `${fmtPetri(r.min_cell_price)} PETRI`, "The lowest price of one cell."],
    ["live_floor", int(r.live_floor), "The price counts at least this many living cells."],
    ["petri_price", `${nearPer(Number(r.petri_price))} NEAR`, "Launch price of one PETRI; the agar asks this × max supply ÷ agar."],
    ["min_join", `${near(Number(r.min_join), 2)} NEAR`, "The least NEAR a colony joins with."],
    ["cell_fee", `${near(Number(r.cell_fee), 4)} NEAR`, "NEAR per planted cell, on top of storage, to the tide vault."],
    ["tide_every", int(r.tide_every), "Generations between tides."],
    ["tide_bps", `${r.tide_bps} (${r.tide_bps / 100}%)`, "Share of the vault paid out at each tide."],
    ["buffer", String(r.buffer), "Clear cells required around every rival's live cell."],
    ["max_plant_cells", String(r.max_plant_cells), "Most cells in one planting."],
    ["max_catchup", String(r.max_catchup), "Most generations one call advances."],
  ];
  return (
    <section id="parameters" className={`band ${s.section}`} aria-labelledby="params-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="params-title" className={s.h2}>How the parameters were chosen</h2>
          <p className="lede">
            The numbers were set once, when the contract was created, and no method can change them. They are the second set:
            a review of the first dish found real problems, and the economy was rebuilt and tested in a simulator before this
            dish launched.
          </p>
        </div>

        <div className={s.changes}>
          <h3 className="h3">What changed after review</h3>
          <p className="muted">
            The first dish ran on a different contract. This one, with the rules on this page, started again from an empty
            board at generation zero.
          </p>
          <dl className={s.changeList}>
            {CHANGES.map(([was, now]) => (
              <div key={was} className={s.change}>
                <dt>{was}</dt>
                <dd>{now}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className={s.paramsGrid}>
          <div className={s.card}>
            <h3 className="h3">The dish&rsquo;s parameters, read now</h3>
            <p className="muted small">From the contract&rsquo;s <code className={s.code}>rules</code> view.</p>
            <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Contract parameters">
              <table className={s.table}>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    <th scope="col">Value</th>
                    <th scope="col">Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map(([k, val, m]) => (
                    <tr key={k}>
                      <th scope="row">
                        <code className={s.code}>{k}</code>
                      </th>
                      <td className="num">{val}</td>
                      <td className={s.cellDim}>{m}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={s.prose}>
            <h3 className="h3">The simulator</h3>
            <p>
              <a className={s.link} href={`${REPO}/tree/main/sim`}>sim/src/main.rs</a> runs <code className={s.code}>petri-core</code>
              &rsquo;s own Life step, feed, cap, price and purchase curve on a 128 by 128 dish for 40,320 generations, seven days
              at 15 seconds each, under seven parameter sets and three societies. Each player buys its PETRI at join: 0.05 NEAR
              for most, 0.1 for the methuselah, 2 for the whale and 0.02 for each sybil.
            </p>
            <p>
              Builders plant still lifes near home, raiders mostly gliders, defenders eaters and beehives, every 20 to 119
              generations, and skip a planting that would cost more than half of what they hold. The methuselah plants an
              R-pentomino every 12 generations whenever it can pay. The whale plants pulsars and beehives. Each sybil plants its
              stake once as blocks and stops. Late players join on day two and play like builders. A tide pays half the vault
              every 240 generations.
            </p>
            <h3 className="h3">What the runs show</h3>
            <ul className={s.findings}>
              <li>
                Close to the first dish&rsquo;s rules, every kind of player earned at least 3.05 times the PETRI it spent, the
                sybils 25.08 times, and the methuselah took 49% of all earnings at 8.20.
              </li>
              <li>
                At the launch values, ordinary players earned 1.41 to 2.35 times their spend. The methuselah covered 66% of the
                cells but took 23% of the earnings, at 1.40. The whale earned 1.01 and paid 3.36 NEAR to win back 1.45.
              </li>
              <li>Late joiners stayed ahead at 1.41, 1.71 and 1.59, and the 30 sybils together took 2% of all earnings.</li>
              <li>Without the cap the methuselah held 83% of the cells, took 63% of the earnings and earned 3.57 times its spend.</li>
              <li>
                A payback of 240 generations let ordinary players earn 2.61 to 4.67 times their spend. A payback of 960 left
                late joiners at 0.65 and 0.85.
              </li>
              <li>
                A feed of 20 ppm paid out 599,951 to 609,108 PETRI in seven days, against 345,344 to 348,249 at 10 ppm, and left
                late joiners at 0.72 in one society.
              </li>
            </ul>
            <p className="muted small">
              Earned over spent compares PETRI fed to a player with PETRI it spent planting. It is not profit: there is no way to
              sell PETRI back to the agar, and the ratio leaves out the NEAR a player paid for its PETRI, which the NEAR columns
              show. The scripted players do not react to prices beyond keeping a reserve, never buy more after joining, and pay a
              flat 0.005 NEAR into the vault at join instead of paying for storage. The simulator shows how PETRI and NEAR move under each rule set, not how people would change their
              play.
            </p>
          </div>
        </div>

        <div className={`${s.card} ${s.simBlock}`}>
          <h3 className="h3">The launch values, by kind of player, after seven days</h3>
          <p className="muted small">
            From <a className={s.link} href={`${REPO}/blob/main/sim/out-v2/summary.txt`}>sim/out-v2/summary.txt</a>. PETRI and
            NEAR per player of that kind. Share is of all PETRI earned in that society.
          </p>
          <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Simulator results by kind of player">
            <table className={`${s.table} ${s.simTable}`}>
              <thead>
                <tr>
                  <th scope="col">Society</th>
                  <th scope="col">Player</th>
                  <th scope="col">Earned</th>
                  <th scope="col">Share</th>
                  <th scope="col">Spent planting</th>
                  <th scope="col">Earned over spent</th>
                  <th scope="col">NEAR paid</th>
                  <th scope="col">NEAR won</th>
                </tr>
              </thead>
              <tbody>
                {V2.flatMap(({ society, kinds }) =>
                  kinds.map((k, i) => (
                    <tr key={society + k.kind} className={["Methuselah", "Whale", "Sybil"].includes(k.kind) ? s.nowRow : undefined}>
                      <td className={s.cellDim}>{i === 0 ? SOCIETY[society] : ""}</td>
                      <th scope="row">
                        {k.kind}
                        {k.n > 1 ? `, ${k.n} of them` : ""}
                      </th>
                      <td className="num">{int(k.earned)}</td>
                      <td className="num">{k.pct}%</td>
                      <td className="num">{int(k.spent)}</td>
                      <td className="num">{k.ratio.toFixed(2)}</td>
                      <td className="num">{k.paid.toFixed(4)}</td>
                      <td className="num">{k.won.toFixed(4)}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className={`${s.card} ${s.simBlock}`}>
          <h3 className="h3">Every run, after seven days</h3>
          <p className="muted small">
            Supply, agar and burned in PETRI. Largest colony is its share of the living cells; Gini is across players&rsquo;
            earnings. The last three columns are earned over spent.
          </p>
          <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Simulator results by parameter set">
            <table className={`${s.table} ${s.simTable}`}>
              <thead>
                <tr>
                  <th scope="col">Parameters</th>
                  <th scope="col">Society</th>
                  <th scope="col">Living cells</th>
                  <th scope="col">Supply</th>
                  <th scope="col">Agar left</th>
                  <th scope="col">Burned</th>
                  <th scope="col">Largest colony</th>
                  <th scope="col">Gini</th>
                  <th scope="col">Methuselah or whale</th>
                  <th scope="col">Sybils</th>
                  <th scope="col">Late joiners</th>
                </tr>
              </thead>
              <tbody>
                {RUNS.map((x) => (
                  <tr key={x.variant + x.society} className={x.variant === "v2" ? s.nowRow : undefined}>
                    <th scope="row">{VARIANT[x.variant]}</th>
                    <td className={s.cellDim}>{SOCIETY[x.society]}</td>
                    <td className="num">
                      {int(x.live)}, peak {int(x.peak)}
                    </td>
                    <td className="num">{int(x.supply)}</td>
                    <td className="num">{int(x.agar)}</td>
                    <td className="num">{int(x.burned)}</td>
                    <td className="num">{x.largest}%</td>
                    <td className="num">{x.gini.toFixed(2)}</td>
                    <td className="num">{x.big}</td>
                    <td className="num">{x.sybil === null ? "—" : x.sybil.toFixed(2)}</td>
                    <td className="num">{x.late.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
