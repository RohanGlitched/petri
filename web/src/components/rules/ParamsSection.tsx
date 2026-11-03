"use client";

import { useLive, int, near } from "@/lib/live";
import { REPO, fmtPetri } from "@/lib/config";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";

// sim/out-v3/summary.txt, as written by sim/src/main.rs (7 days; 20 seeds at 15 players, 10 at 150 and 1,500).
// Net NEAR = tides + sold + PETRI held at the sell-back price − everything paid, for the kind's mean player:
// [min, median, max] over seeds. These runs use reach 4 and siege ×3 as launched, but tides of 50%, a fed house and an
// uncapped bounty, which the launched contract changed (see FIXES).
type Net = [number, number, number];
const KINDS: { kind: string; stake: string; net: [Net, Net, Net] }[] = [
  { kind: "Builder", stake: "0.05 NEAR, still lifes near home", net: [[-0.2267, -0.0169, 1.7052], [-0.146, -0.1282, -0.0949], [-0.0591, -0.0561, -0.049]] },
  { kind: "Raider", stake: "0.05, gliders at rivals, one move in three a siege", net: [[-0.2191, -0.1396, 0.1379], [-0.1385, -0.1045, -0.077], [-0.0862, -0.0824, -0.0766]] },
  { kind: "Defender", stake: "0.05, eaters and beehives", net: [[-0.2467, -0.1086, 2.8928], [-0.1177, -0.098, -0.0472], [-0.0355, -0.0251, -0.0196]] },
  { kind: "Methuselah", stake: "0.1, one R-pentomino an hour", net: [[3.3633, 9.513, 13.7593], [1.2711, 1.8176, 2.0621], [0.0308, 0.0853, 0.1204]] },
  { kind: "Late", stake: "0.05, a builder joining on day 2 or 3", net: [[-0.1949, 0.28, 1.9726], [-0.2023, -0.1664, -0.1313], [-0.0765, -0.0717, -0.0623]] },
  { kind: "Whale", stake: "2 NEAR in one colony", net: [[-2.7371, -1.1119, 3.6826], [-1.4652, -1.1479, -0.8745], [-0.7257, -0.6096, -0.5181]] },
  { kind: "Split whale", stake: "the same 2 NEAR over 10 colonies (20 at 1,500)", net: [[-1.0354, 3.0438, 8.1421], [-1.4746, -0.8901, -0.5932], [-0.7845, -0.6815, -0.4962]] },
  { kind: "Sniper", stake: "0.05, plants only just before tides, sells after", net: [[-0.2071, -0.0579, 0.0563], [-0.0556, -0.0219, 0.1208], [-0.0385, -0.0183, 0.0109]] },
  { kind: "Locker", stake: "1.5, a lattice of 256 blocks putting every empty cell in its buffer", net: [[-0.7314, 1.6646, 2.3601], [2.8569, 3.5628, 4.2829], [8.8846, 11.1225, 12.7054]] },
  { kind: "Racer", stake: "0.01, never plants, races the keeper to advance", net: [[0.311, 0.341, 0.5375], [0.4432, 0.459, 0.4957], [0.9644, 1.0299, 1.0731]] },
  { kind: "Seller", stake: "0.2, buys and sells back as fast as allowed", net: [[-0.1042, -0.1042, -0.1033], [-0.1043, -0.1038, -0.1033], [-0.0964, -0.0955, -0.0945]] },
  { kind: "House strain", stake: "0.05 + 0.02 top-ups, 1 NEAR budget, no tide share", net: [[-0.921, -0.8202, -0.69], [-0.9759, -0.9645, -0.9386], [-0.9937, -0.9909, -0.9872]] },
];

// The fix experiments in the same file: one rule changed at a time, median net NEAR.
const FIX_KINDS = ["Builder", "Late", "Methuselah", "Whale", "Split whale", "Sniper", "Locker", "Racer"];
const FIXES: { society: string; rows: { rule: string; net: number[]; lock: number; launched?: boolean }[] }[] = [
  {
    society: "15 players",
    rows: [
      { rule: "Simulator baseline: tides 50%, house fed, bounty uncapped", net: [-0.017, 0.28, 9.513, -1.112, 3.044, -0.058, 1.665, 0.341], lock: 34.0 },
      { rule: "Tides of 10% (launched)", net: [-0.077, 0.204, 9.578, -0.223, 3.208, -0.068, 0.13, 0.312], lock: 19.9 },
      { rule: "The house is never fed (launched)", net: [0.103, 0.183, 7.825, -0.427, 3.09, -0.049, 1.441, 0.356], lock: 34.6 },
      { rule: "Bounty capped at 0.001 NEAR (launched)", net: [0.061, 0.141, 9.192, 0.34, 3.341, -0.058, 1.522, 0.254], lock: 32.8 },
      { rule: "All three, with a smaller ledger estimate", net: [0.078, -0.001, 2.976, 0.89, 0.58, -0.034, 0.856, 0.475], lock: 20.0, launched: true },
    ],
  },
  {
    society: "150 players",
    rows: [
      { rule: "Simulator baseline: tides 50%, house fed, bounty uncapped", net: [-0.128, -0.166, 1.818, -1.148, -0.89, -0.022, 3.563, 0.459], lock: 11.8 },
      { rule: "Tides of 10% (launched)", net: [-0.107, -0.178, 1.828, -1.197, -0.825, -0.062, -0.152, 0.408], lock: 4.5 },
      { rule: "The house is never fed (launched)", net: [-0.127, -0.164, 1.736, -1.225, -0.785, -0.009, 3.672, 0.463], lock: 12.3 },
      { rule: "Bounty capped at 0.001 NEAR (launched)", net: [-0.123, -0.18, 1.78, -1.283, -0.861, -0.022, 3.619, 0.273], lock: 11.7 },
      { rule: "All three, with a smaller ledger estimate", net: [-0.006, -0.09, 1.023, -0.728, -0.206, -0.019, 0.137, 0.345], lock: 6.2, launched: true },
    ],
  },
];

// Newcomer lockout with the carpet locker: a colony with no cells looking for its cheapest 2 × 2 block.
// mNEAR is the block's cost in NEAR, PETRI and deposit together. Without siege (the v2 rule) some seeds had no legal spot.
const LOCKOUT: { society: string; rows: [string, string, string, string, string, string][] }[] = [
  {
    society: "15 players, 20 seeds",
    rows: [
      ["1 h", "1.7 (0.6–9.0)", "6.63", "12.62", "0.6 (0.0–1.8)", "5 of 20"],
      ["6 h", "22.4 (16.9–31.0)", "6.48", "12.17", "18.5 (0.0–30.8)", "2 of 20"],
      ["day 1", "32.6 (19.7–44.0)", "7.19", "14.30", "30.8 (0.0–40.8)", "2 of 20"],
      ["day 7", "50.0 (40.3–57.4)", "7.40", "14.93", "46.2 (0.0–57.6)", "2 of 20"],
    ],
  },
  {
    society: "150 players, 10 seeds",
    rows: [
      ["1 h", "3.4 (0.8–8.7)", "6.32", "11.67", "0.4 (0.0–2.1)", "2 of 10"],
      ["6 h", "19.2 (10.9–28.6)", "6.19", "11.28", "11.7 (6.0–19.9)", "0 of 10"],
      ["day 1", "17.9 (12.3–25.4)", "6.13", "11.12", "13.3 (9.8–17.3)", "0 of 10"],
      ["day 7", "37.1 (27.5–45.1)", "7.29", "14.60", "39.1 (28.5–45.8)", "0 of 10"],
    ],
  },
];

const EMPTY: [string, string, string, string][] = [
  ["Only the 5 house strains, house fed (the rule before the fix)", "179,035", "0", "0.51 NEAR left; the house was fed 828,726 PETRI"],
  ["Only the 5 house strains, house never fed (launched)", "994,026", "0", "1.56 NEAR left; nothing fed"],
  ["Nobody at all", "1,000,000", "0", "The contract pays 1.728 NEAR for 720 tide entries"],
];

const CHANGES_V3: [string, string][] = [
  [
    "The relayer attached the guest's deposits itself. A guest could sign calls that fail inside the contract, and each failure refunded the deposit to the guest, draining the relayer.",
    "The relayer relays only calls with no deposit. Guests pay from credit the relayer gives them on chain with sponsor, spendable only in the dish, and their keys are function-call keys for the dish, which cannot attach or move NEAR.",
  ],
  [
    "The guest proof of work was not bound to anything, so one solution could be replayed for many guests.",
    "A guest needs a challenge the server signed in the last ten minutes, an 18-bit proof of work bound to that challenge and its key, and the account name comes from the key: one guest per key.",
  ],
  [
    "The 15% cap counted living cells, so splitting into colonies just under the cap earned more.",
    "The reach: a colony is paid for at most 4 living cells per cell it ever planted, and the parts of a split never weigh more than the whole.",
  ],
  [
    "A carpet of blocks could put every empty cell inside someone's buffer and close the dish to newcomers.",
    "Sieges: planting inside a rival's buffer is allowed at 3× the price. In the simulator the locker left no legal spot in 5 of 20 seeds without siege; with it every seed has one.",
  ],
  [
    "Tides split by cells alive at the tide generation, so a colony planted just before a tide took a full share.",
    "Window tides: each tide splits by the PETRI each colony earned since the previous one.",
  ],
  [
    "advance paid the keeper pot even when it ran no generation.",
    "The pot is paid only by a call that ran at least one generation.",
  ],
  [
    "The strains' model read colony names, so a name written as an instruction could steer it.",
    "Rivals reach the model by number and size only, and names are plain ASCII; notes refuse hidden and tag characters.",
  ],
  [
    "NEAR moved through counters the replay could not rebuild.",
    "Every purchase, planting, sale and tide records its NEAR in the ledger, and the replay checks the vault, NEAR in, tide payouts and every colony's winnings.",
  ],
  [
    "The contract was not a reproducible build and the account kept a full-access key.",
    "Built with cargo near build reproducible-wasm, with NEP-330 metadata linking the commit; the key is to be deleted before judging, and /verify fails that check until it is.",
  ],
  [
    "The simulator's claims were ratios of PETRI earned to PETRI spent.",
    "Every result is now net NEAR per player, with PETRI held valued at the sell-back price and labelled as paper.",
  ],
  [
    "On a sparse dish the price counted 1,000 cells but the whole ration went to the few alive, so early cells paid back far faster than the price assumed.",
    "The agar releases its ration for at least 1,000 counted cells and never more per cell; with fewer, it releases that fraction and keeps the rest. This rule came after the simulator runs below.",
  ],
  [
    "The house strains were fed like players, so on a quiet dish they slowly ate the agar.",
    "House colonies are never fed and take no tide share; the NEAR they pay in goes to the other players.",
  ],
];

const sign = (x: number, dp = 3) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(dp)}`;

export function ParamsSection() {
  const { rules } = useLive();
  const r = rules ?? LAUNCH;
  const params: [string, string, string][] = [
    ["width × height", `${r.width} × ${r.height}`, "Cells on the dish, edges wrapped."],
    ["generation_ms", int(Number(r.generation_ms)), "Milliseconds between generations."],
    ["max_supply", `${fmtPetri(r.max_supply, 0)} PETRI`, "Minted once, into the agar."],
    ["feed_ppm", String(r.feed_ppm), "Parts per million of the agar fed to the living each generation."],
    ["keeper_bps", `${r.keeper_bps} (${r.keeper_bps / 100}%)`, "Share of the feed set aside in the keeper pot."],
    ["reach", String(r.reach), "Most living cells a colony is paid for, per cell it ever planted."],
    ["burn_bps", `${r.burn_bps} (${r.burn_bps / 100}%)`, "Share of a planting burned; the rest returns to the agar."],
    ["payback", int(r.payback), "Generations of an average cell's feed that a cell costs."],
    ["min_cell_price", `${fmtPetri(r.min_cell_price)} PETRI`, "The lowest price of one cell."],
    ["live_floor", int(r.live_floor), "The price counts at least this many living cells."],
    ["petri_price", `${nearPer(Number(r.petri_price))} NEAR`, "Launch price of one PETRI; the agar asks this × max supply ÷ agar."],
    ["min_join", `${near(Number(r.min_join), 2)} NEAR`, "The least NEAR a colony joins with."],
    ["cell_fee", `${near(Number(r.cell_fee), 4)} NEAR`, "NEAR per planted cell, on top of storage, to the tide vault."],
    ["tide_every", int(r.tide_every), "Generations between tides."],
    ["tide_bps", `${r.tide_bps} (${r.tide_bps / 100}%)`, "Share of the vault paid out at each tide."],
    ["tide_bounty_bps", `${r.tide_bounty_bps} (${r.tide_bounty_bps / 100}%)`, "Share of a tide paid to the caller whose transaction runs it."],
    ["max_bounty", `${near(Number(r.max_bounty), 3)} NEAR`, "The most a tide bounty pays."],
    ["sell_bps", `${r.sell_bps} (${r.sell_bps / 100}%)`, "Share of the curve's price the agar pays when it buys PETRI back."],
    ["sell_cap_bps", `${r.sell_cap_bps} (${r.sell_cap_bps / 100}%)`, "Most of the vault the agar buys back with between two tides."],
    ["siege_x", String(r.siege_x), "Price multiple of a planting inside a rival's buffer."],
    ["buffer", String(r.buffer), "Cells around a rival's live cell where a planting is a siege."],
    ["max_plant_cells", String(r.max_plant_cells), "Most cells in one planting."],
    ["max_catchup", String(r.max_catchup), "Most generations one call advances."],
    ["house", r.house.join(", "), "The dish's own players: never fed, no tide share."],
  ];
  return (
    <section id="parameters" className={`band ${s.section}`} aria-labelledby="params-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="params-title" className={s.h2}>How the parameters were chosen</h2>
          <p className="lede">
            The numbers were set once, when the contract was created, and no method changes them. This is the fourth dish. Two
            rounds of review found real problems; each time the rules were changed, tested in the simulator, and launched on a
            new contract that started again from an empty board. The last relaunch added one rule after the simulator runs below.
          </p>
        </div>

        <div className={s.paramsGrid}>
          <div className={s.prose}>
            <h3 className="h3">The simulator</h3>
            <p>
              <a className={s.link} href={`${REPO}/tree/main/sim`}>sim/src/main.rs</a> runs <code className={s.code}>petri-core</code>
              &rsquo;s own Life step, feed, reach, price, curve, sell-back and window tides on a 128 by 128 dish for 7 and 30 days,
              with 15, 150 and 1,500 scripted players and the five house strains, and counts every yoctoNEAR: what each player
              paid, won at tides, got for sales, and the PETRI it still holds valued at the sell-back price. It estimates storage
              and gas rather than measuring them on chain, and it predates the rule that releases only part of the ration on a
              sparse dish, so it shows early colonies earning more than they now would. A sweep over reach 4, 8 and 16 and siege 3×, 4× and 6× chose reach 4
              and siege 3×: net results barely moved, a reach of 4 left under 1% of any kind&rsquo;s cell-generations unpaid, and
              a day-7 siege block costs 14.9 mNEAR at 3× against 26.2 at 6×.
            </p>
            <h3 className="h3">What the runs show</h3>
            <ul className={s.findings}>
              <li>
                Ordinary players lose a little NEAR: builders, raiders, defenders and late joiners end between −0.17 and −0.10
                NEAR at 150 players and −0.08 to −0.03 at 1,500 (medians). Their stakes go to the tides and to storage.
              </li>
              <li>
                The methuselah is the outlier: +9.51 NEAR median at 15 players, +1.82 at 150, but nearly all of it is PETRI valued
                at the sell-back price. Its cash, NEAR actually back, is −0.01 and +0.30. At the end players hold PETRI worth 13 to
                22 NEAR at that price against under 0.06 NEAR in the vault, so held PETRI is paper.
              </li>
              <li>
                The carpet locker won NEAR in cash in the baseline (+1.66, +3.56, +11.12). Tides of 10% cut that to +0.13 and −0.15;
                with all three launched fixes it is +0.86 and +0.14. It is the biggest weakness the simulator found.
              </li>
              <li>
                Splitting a whale into colonies did not pay at 150 and 1,500 players. In the 15-player society the split whale did
                better in the baseline (+3.04 against −1.11), and worse once all three fixes were in (+0.58 against +0.89).
              </li>
              <li>
                Sellers always lose (−0.10 NEAR on a 0.2 stake). Snipers lose a little with the locker present; in the 15-player
                society without it the sniper&rsquo;s median was +0.53. The racer makes +0.34 to +1.03 before gas, +0.07 to +0.87
                after.
              </li>
              <li>Each house strain costs the team 0.82 to 0.99 NEAR a week, all of it paid to the other players.</li>
            </ul>
          </div>
          <div>
            <details className={s.fold}>
              <summary>
                What changed after the second review <small>{CHANGES_V3.length} findings, v2 to v4</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V3.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
                <p className="muted small">
                  The first review (v1 to v2) found free 64-PETRI grants that could be farmed, a cell price unrelated to what a
                  cell earns, a methuselah taking 45% of the dish, one log line per colony per catch-up (the dish would stop at
                  about 115 colonies), and a contract that could mint by sending PETRI to itself. v2 fixed those with the NEAR
                  buy-in, the payback price, accrued earnings and the self-call guard; the current dish keeps all of it.
                </p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                The dish&rsquo;s parameters, read now <small>{params.length} fields of rules</small>
              </summary>
              <div className={s.foldBody}>
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
                <p className="muted small">
                  From the contract&rsquo;s <code className={s.code}>rules</code> view. Fixed in code: names of 1 to 24 ASCII
                  characters, notes of at most 140 characters, the chain folded every 16 generations, catch-up stopping at 180
                  TGas.
                </p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                Net NEAR per player after 7 days <small>12 kinds, 3 societies</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  Median, with the lowest and highest over seeds below. Tides + sales + PETRI held at the sell-back price − all
                  NEAR paid, gas not included. These runs have reach 4 and siege 3× as launched, but tides of 50%, a fed house
                  and an uncapped bounty; the next table shows the launched changes.
                </p>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Net NEAR by kind of player">
                  <table className={`${s.table} ${s.simSmall}`}>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">15 players</th>
                        <th scope="col">150</th>
                        <th scope="col">1,500</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KINDS.map((k) => (
                        <tr key={k.kind}>
                          <th scope="row">
                            {k.kind}
                            <span className={s.range}>{k.stake}</span>
                          </th>
                          {k.net.map(([lo, med, hi], i) => (
                            <td key={i} className={`num ${med > 0 ? s.pos : ""}`}>
                              {sign(med)}
                              <span className={s.range}>
                                {sign(lo, 2)} to {sign(hi, 2)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                The launched fixes, one at a time <small>median net NEAR</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  The launched contract has all three. No run has exactly the launched rules: the combined row also assumes a
                  planting stores about 20 bytes, where the contract stores at most 200 + 4 a cell. The last column is the
                  locker&rsquo;s share of all tide NEAR.
                </p>
                {FIXES.map((f) => (
                  <div key={f.society} className={s.tableWrap} tabIndex={0} role="region" aria-label={`Fix experiments, ${f.society}`}>
                    <table className={`${s.table} ${s.simTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">{f.society}</th>
                          {FIX_KINDS.map((k) => (
                            <th key={k} scope="col">{k}</th>
                          ))}
                          <th scope="col">Locker tides</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.rows.map((row) => (
                          <tr key={row.rule} className={row.launched ? s.nowRow : undefined}>
                            <th scope="row">{row.rule}</th>
                            {row.net.map((x, i) => (
                              <td key={i} className="num">{sign(x)}</td>
                            ))}
                            <td className="num">{row.lock.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                The lockout, with and without sieges <small>a newcomer&rsquo;s first block</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  A locker lays 256 blocks 8 cells apart at launch so every empty cell is inside its buffer. Free spots are 2 × 2
                  blocks a newcomer could plant at the normal price (median, range). Without the locker, 59.5% of spots are free
                  after 1 h at 15 players.
                </p>
                {LOCKOUT.map((l) => (
                  <div key={l.society} className={s.tableWrap} tabIndex={0} role="region" aria-label={`Lockout, ${l.society}`}>
                    <table className={`${s.table} ${s.simTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">{l.society}</th>
                          <th scope="col">Free spots %, siege allowed</th>
                          <th scope="col">Cheapest block, mNEAR</th>
                          <th scope="col">Siege block, mNEAR</th>
                          <th scope="col">Free spots %, siege forbidden</th>
                          <th scope="col">Seeds with no legal spot</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.rows.map((row) => (
                          <tr key={row[0]}>
                            <th scope="row">{row[0]}</th>
                            {row.slice(1).map((c, i) => (
                              <td key={i} className="num">{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <p className="muted small">With sieges allowed, every empty cell can be planted, so no seed is ever without a legal spot.</p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                A dish with no players, 30 days <small>3 runs</small>
              </summary>
              <div className={s.foldBody}>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Zero-player runs">
                  <table className={`${s.table} ${s.simSmall}`}>
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col">Agar after 30 days, PETRI</th>
                        <th scope="col">NEAR paid at tides</th>
                        <th scope="col">Vault</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EMPTY.map((row) => (
                        <tr key={row[0]} className={row[0].includes("launched") ? s.nowRow : undefined}>
                          <th scope="row">{row[0]}</th>
                          <td className="num">{row[1]}</td>
                          <td className="num">{row[2]}</td>
                          <td className={s.cellDim}>{row[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  From <a className={s.link} href={`${REPO}/blob/main/sim/out-v3/summary.txt`}>sim/out-v3/summary.txt</a>. The
                  scripted players follow fixed habits and do not adapt to prices, so the runs show how NEAR moves under each
                  rule set, not how people would change their play.
                </p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}
