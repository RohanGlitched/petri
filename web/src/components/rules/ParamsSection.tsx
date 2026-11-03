"use client";

import { useLive, int } from "@/lib/live";
import { REPO, fmtPetri } from "@/lib/config";
import { LAUNCH } from "./shared";
import s from "./rules.module.css";

// sim/out/summary.txt, as written by `cargo run --release -p petri-sim` (14 days each).
type Run = { variant: string; society: string; supply: number; agar: number; burnedPct: number; alive: string; gini: number; price: number };
const RUNS: Run[] = [
  { variant: "launch", society: "8 builders", supply: 888186, agar: 254918, burnedPct: 13, alive: "8/8", gini: 0.19, price: 3.35 },
  { variant: "launch", society: "4 builders, 4 raiders", supply: 909646, agar: 244259, burnedPct: 11, alive: "8/8", gini: 0.14, price: 3.95 },
  { variant: "launch", society: "Mixed 12", supply: 819443, agar: 288897, burnedPct: 20, alive: "12/12", gini: 0.18, price: 4.16 },
  { variant: "feed 50 ppm", society: "8 builders", supply: 888186, agar: 45054, burnedPct: 10, alive: "8/8", gini: 0.23, price: 3.35 },
  { variant: "feed 50 ppm", society: "4 builders, 4 raiders", supply: 909646, agar: 39916, burnedPct: 9, alive: "8/8", gini: 0.14, price: 3.95 },
  { variant: "feed 50 ppm", society: "Mixed 12", supply: 819443, agar: 61755, burnedPct: 16, alive: "12/12", gini: 0.21, price: 4.16 },
  { variant: "feed 8 ppm", society: "8 builders", supply: 888186, agar: 606880, burnedPct: 22, alive: "8/8", gini: 0.15, price: 3.35 },
  { variant: "feed 8 ppm", society: "4 builders, 4 raiders", supply: 909646, agar: 591031, burnedPct: 18, alive: "8/8", gini: 0.19, price: 3.95 },
  { variant: "feed 8 ppm", society: "Mixed 12", supply: 874002, agar: 616474, burnedPct: 25, alive: "8/12", gini: 0.43, price: 3.89 },
  { variant: "flat price", society: "8 builders", supply: 940840, agar: 228630, burnedPct: 7, alive: "8/8", gini: 0.2, price: 2.0 },
  { variant: "flat price", society: "4 builders, 4 raiders", supply: 952592, agar: 222757, burnedPct: 6, alive: "8/8", gini: 0.13, price: 2.0 },
  { variant: "flat price", society: "Mixed 12", supply: 911077, agar: 243328, burnedPct: 11, alive: "12/12", gini: 0.18, price: 2.0 },
  { variant: "base price 1", society: "8 builders", supply: 944093, agar: 227099, burnedPct: 7, alive: "8/8", gini: 0.2, price: 1.67 },
  { variant: "base price 1", society: "4 builders, 4 raiders", supply: 954823, agar: 221741, burnedPct: 5, alive: "8/8", gini: 0.13, price: 1.98 },
  { variant: "base price 1", society: "Mixed 12", supply: 909721, agar: 244041, burnedPct: 11, alive: "12/12", gini: 0.18, price: 2.08 },
  { variant: "no burn", society: "8 builders", supply: 1000000, agar: 310556, burnedPct: 0, alive: "8/8", gini: 0.19, price: 3.35 },
  { variant: "no burn", society: "4 builders, 4 raiders", supply: 1000000, agar: 289294, burnedPct: 0, alive: "8/8", gini: 0.14, price: 3.95 },
  { variant: "no burn", society: "Mixed 12", supply: 1000000, agar: 378609, burnedPct: 0, alive: "12/12", gini: 0.18, price: 4.16 },
];

export function ParamsSection() {
  const { rules } = useLive();
  const r = rules ?? LAUNCH;
  const params: [string, string, string][] = [
    ["width × height", `${r.width} × ${r.height}`, "Cells on the dish, edges wrapped."],
    ["generation_ms", int(Number(r.generation_ms)), "Milliseconds between generations."],
    ["max_supply", `${fmtPetri(r.max_supply, 0)} PETRI`, "Minted once, into the agar."],
    ["feed_ppm", String(r.feed_ppm), "Parts per million of the agar fed each generation."],
    ["keeper_bps", `${r.keeper_bps} (${r.keeper_bps / 100}%)`, "Share of the feed for whoever advanced the dish."],
    ["burn_bps", `${r.burn_bps} (${r.burn_bps / 100}%)`, "Share of a planting burned; the rest returns to the agar."],
    ["plant_cost", `${fmtPetri(r.plant_cost)} PETRI`, "Price of one cell on an empty dish."],
    ["capacity", int(r.capacity), "Live cells at which the price of a cell has doubled."],
    ["starter_grant", `${fmtPetri(r.starter_grant)} PETRI`, "Paid from the agar when a colony joins."],
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
            The numbers were set once, when the contract was created, and no method can change them. Before launch, an economy
            simulator ran the real rules for two simulated weeks under six parameter sets and three kinds of society.
          </p>
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
              <a className={s.link} href={`${REPO}/tree/main/sim`}>sim/src/main.rs</a> runs <code className={s.code}>petri-core</code>{" "}
              on a 128 by 128 dish for 80,640 generations, fourteen days at 15 seconds each. Scripted players plant on their own
              schedules, every 20 to 119 generations, and keep a reserve: they skip a planting that would cost more than half their balance
              and leave them under 4 PETRI. Builders plant blocks, beehives and
              loaves; raiders mostly gliders; defenders eaters and beehives; a chaos player R-pentominoes. The mixed society is six
              builders, three raiders, two defenders and one chaos player.
            </p>
            <h3 className="h3">What the runs show</h3>
            <ul className={s.findings}>
              <li>
                At the launch values the agar still held between 244,259 and 288,897 PETRI after fourteen days, every colony was
                alive, and the Gini coefficient of balances stayed between 0.14 and 0.19.
              </li>
              <li>A feed of 50 ppm drained the agar to between 39,916 and 61,755 PETRI in the same time.</li>
              <li>A feed of 8 ppm left over 590,000 PETRI unpaid, and in the mixed society 4 of 12 colonies died out, with a Gini of 0.43.</li>
              <li>A flat price or a 1 PETRI base price burned only 5% to 11% of what was fed. At launch values it was 11% to 20%.</li>
              <li>Without the burn, supply stayed at exactly 1,000,000.</li>
            </ul>
            <p className="muted small">
              The scripted players do not react to prices or feed beyond keeping a reserve, which is why the live-cell counts
              barely change between variants. The simulator shows how PETRI moves under each rule set, not how people would
              change their play.
            </p>
          </div>
        </div>

        <div className={s.card}>
          <h3 className="h3">Every run, after fourteen days</h3>
          <p className="muted small">
            From <a className={s.link} href={`${REPO}/blob/main/sim/out/summary.txt`}>sim/out/summary.txt</a>. Supply and agar in
            PETRI; burned as a share of everything fed; Gini across players&rsquo; balances; price of one cell at the end.
          </p>
          <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Simulator results">
            <table className={`${s.table} ${s.simTable}`}>
              <thead>
                <tr>
                  <th scope="col">Parameters</th>
                  <th scope="col">Society</th>
                  <th scope="col">Supply</th>
                  <th scope="col">Agar left</th>
                  <th scope="col">Burned</th>
                  <th scope="col">Colonies alive</th>
                  <th scope="col">Gini</th>
                  <th scope="col">Cell price</th>
                </tr>
              </thead>
              <tbody>
                {RUNS.map((x) => (
                  <tr key={x.variant + x.society} className={x.variant === "launch" ? s.nowRow : undefined}>
                    <th scope="row">{x.variant === "launch" ? "Launch values" : x.variant}</th>
                    <td>{x.society}</td>
                    <td className="num">{int(x.supply)}</td>
                    <td className="num">{int(x.agar)}</td>
                    <td className="num">{x.burnedPct}%</td>
                    <td className="num">{x.alive.replace("/", " of ")}</td>
                    <td className="num">{x.gini.toFixed(2)}</td>
                    <td className="num">{x.price.toFixed(2)}</td>
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
