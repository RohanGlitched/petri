"use client";
// Sixty days of the mainnet rules under five scenarios (sim/out-60d, `cargo run --release -- out-60d days60`), drawn
// from the run's own web.json, and the 1,000-season bench of monopoly attempts (bench.json).

import { useState } from "react";
import sim from "@/data/sim60.json";
import bench from "@/data/bench.json";
import { REPO } from "@/lib/config";
import { LineChart } from "./LineChart";
import s from "./charts.module.css";

type Band = [number, number, number];
type Scenario = {
  name: string;
  what: string;
  seeds: number;
  top_live_share: Band;
  top_held_share: Band;
  burned: Band;
  vault_out: Band;
  agar_end: Band;
  days: number[];
  agar: Band[];
  held: Band[];
  burned_by_day: Band[];
  vault_out_by_day: Band[];
};

const SCEN = (sim as unknown as { scenarios: Scenario[] }).scenarios;
const k = (v: number) => (v >= 1000 ? `${Math.round(v / 1000).toLocaleString("en-US")}k` : Math.round(v).toLocaleString("en-US"));
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
const names: Record<string, string> = { Whale: "2-NEAR whale", SplitWhale: "10-colony split whale", Locker: "Lattice locker" };

export function SimSixty({ compact = false }: { compact?: boolean }) {
  const [i, setI] = useState(0);
  const sc = SCEN[i];
  const mid = (b: Band[]) => b.map((x) => x[1]);
  const band = (b: Band[]) => b.map((x) => [x[0], x[2]] as [number, number]);
  return (
    <div className={s.sim}>
      <div className={s.tabs} role="tablist" aria-label="Scenario">
        {SCEN.map((x, j) => (
          <button key={x.name} role="tab" aria-selected={j === i} className={j === i ? s.tabOn : s.tab} onClick={() => setI(j)}>
            {x.name}
          </button>
        ))}
      </div>
      <p className={s.what}>
        <b>{sc.name}:</b> {sc.what}. Median of {sc.seeds} seeds, their range shaded.
      </p>
      <LineChart
        label={`PETRI supply over 60 days, scenario ${sc.name}`}
        x={sc.days}
        fmtX={(d) => `day ${Math.round(d)}`}
        ticks={[1, 10, 20, 30, 40, 50, 60]}
        fmt={k}
        fmtRight={(v) => `${v.toFixed(v < 10 ? 2 : 0)} NEAR`}
        maxLeft={1_000_000}
        height={compact ? 280 : 320}
        series={[
          { label: "PETRI in the agar", color: "#f2b45a", values: mid(sc.agar), band: band(sc.agar) },
          { label: "Held by players", color: "#e2d5c3", values: mid(sc.held), band: band(sc.held) },
          { label: "Burned", color: "#ff8f7f", values: mid(sc.burned_by_day), band: band(sc.burned_by_day) },
          { label: "NEAR the vault paid out", color: "#9fd8a8", values: mid(sc.vault_out_by_day), band: band(sc.vault_out_by_day), right: true, dashed: true },
        ]}
      />
      <dl className={s.stats}>
        <div>
          <dt>PETRI burned by day 60</dt>
          <dd className="num">{Math.round(sc.burned[1]).toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>NEAR the vault paid out</dt>
          <dd className="num">{sc.vault_out[1].toFixed(2)}</dd>
        </div>
        <div>
          <dt>PETRI left in the agar</dt>
          <dd className="num">{Math.round(sc.agar_end[1]).toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt>Most of the living cells one player held (day 7 on)</dt>
          <dd className="num">{pct(sc.top_live_share[1])}</dd>
        </div>
        <div>
          <dt>Most of players&rsquo; PETRI one player held</dt>
          <dd className="num">{pct(sc.top_held_share[1])}</dd>
        </div>
      </dl>
      {!compact && (
        <>
          <h3 className="h3" style={{ marginTop: 40 }}>1,000 seasons of trying to own the dish</h3>
          <p className={s.what}>
            One-day seasons on the mainnet rules: the five strains, 20 mixed players and one attacker. Net NEAR counts what the attacker withdrew, is owed and still holds in PETRI at the sell-back price, against everything it paid.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Attacker</th>
                  <th>Seasons</th>
                  <th>Living cells it held, median</th>
                  <th>Its share of tide pay</th>
                  <th>Seasons it came out ahead</th>
                  <th>Net NEAR, median</th>
                </tr>
              </thead>
              <tbody>
                {bench.attackers.map((a) => (
                  <tr key={a.kind}>
                    <td>{names[a.kind] ?? a.kind}</td>
                    <td className="num">{a.seasons}</td>
                    <td className="num">{pct(a.live_share_median)}</td>
                    <td className="num">{pct(a.tide_share_median)}</td>
                    <td className="num">{a.paid_off} of {a.seasons}</td>
                    <td className="num">{a.net_near_median.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className={`${s.what} small`}>
        Every generation stepped with petri-core, the contract&rsquo;s own Rust core. Scripted players, not a forecast.{" "}
        <a href={`${REPO}/tree/main/sim/out-60d`}>CSV, charts and method</a>.
      </p>
    </div>
  );
}
