"use client";
// Who wins and who pays: the sixty-day scenarios read player by player (sim/out-econ, `cargo run --release -- out-econ
// econ --seeds 10` from sim/), drawn from the run's own web.json (copied to web/src/data/whowins.json by the run).
// Every number on this component comes from that file; the words around them are fixed.

import { useState } from "react";
import data from "@/data/whowins.json";
import { REPO } from "@/lib/config";
import s from "./whowins.module.css";

type Band = number[];
type KindRow = {
  kind: string;
  label: string;
  plays: string;
  players: number;
  budget: number;
  paid: number;
  share_positive: number;
  net: Band;
  back_per_near: Band;
  tide: number;
  sold: number;
  credit: boolean;
  credit_above_grant: number;
};
type Day1 = {
  kind: string;
  label: string;
  players: number;
  share_positive: number;
  seed: number;
  join_day: number;
  attached: number;
  gas: number;
  join_petri: number;
  bought: number;
  fed: number;
  planted: number;
  plantings: number;
  live: number;
  tide: number;
  claimed: number;
  sold: number;
  bounty: number;
  owed: number;
  held_petri: number;
  held_value: number;
  net: number;
  net_p10: number;
  net_p90: number;
  credit: boolean;
};
type Money = {
  paid_to_players: Band;
  house_share: Band;
  vault_in_house: Band;
  house_paid: Band;
  house_out_day: number | null;
  after_house_out: { paid_to_players: Band; house_share: Band; tides: number };
  players_to_vault: Band;
  players_to_storage: Band;
  players_to_gas: Band;
  players_back_share: Band;
  players_paid: Band;
  players_back: Band;
  players_net: Band;
};
type Trip = { deposit: number; buy_record: number; sell_record: number; petri: Band; curve: Band; back: Band; net: Band; day1_net: number; day60_net: number; allowance_short_days: number };
type Cohort = { joined: string; players: number; share_positive: number; net: Band; tide_median: number };
type Scenario = {
  name: string;
  what: string;
  seeds: number;
  players: number;
  guests: number;
  share_positive: number;
  net: Band;
  kinds: KindRow[];
  money: Money;
  round_trip: Trip;
  cohorts: Cohort[];
  day1: Day1[];
};

const ALL = (data as unknown as { scenarios: Scenario[]; seeds: number }).scenarios;
const SCEN = ALL.filter((x) => x.players > 0);

const pct = (v: number, d = 1) => `${(100 * v).toFixed(d)}%`;
const near = (v: number) => {
  const a = Math.abs(v);
  return a === 0 ? "0" : a < 0.001 ? a.toFixed(5) : a < 0.1 ? a.toFixed(4) : a.toFixed(3);
};

export function WhoWins() {
  const [i, setI] = useState(Math.max(0, SCEN.findIndex((x) => x.name === "steady")));
  const sc = SCEN[i];
  const m = sc.money;
  const guest = sc.kinds.find((k) => k.credit);
  // The kinds of player that ended ahead in NEAR in this scenario, best placed first.
  const winners = sc.kinds.filter((k) => !k.credit && k.share_positive > 0).sort((a, b) => b.share_positive - a.share_positive);
  const topShare = winners[0]?.share_positive ?? 1;
  // Whales, split whales and lattice lockers: the players who try to buy the board.
  const attackers = sc.kinds.filter((k) => ["Whale", "SplitWhale", "Locker"].includes(k.kind));
  const attackersN = attackers.reduce((n, k) => n + k.players, 0);
  const attackersAhead = attackers.reduce((n, k) => n + Math.round(k.share_positive * k.players), 0);

  return (
    <div className={s.root}>
      <div className="section-head">
        <h2 className="h2">Who wins, and who pays</h2>
        <p className="lede">
          Petri is an arcade game with a burn: nobody extracts, and the house only pays in. Every tide pays the vault&rsquo;s NEAR to the colonies
          that earned that hour, so skill moves NEAR between players. The numbers below are the simulator&rsquo;s, player by player, on the mainnet
          rules.
        </p>
      </div>

      <div className={s.tabs} role="tablist" aria-label="Scenario">
        {SCEN.map((x, j) => (
          <button key={x.name} role="tab" aria-selected={j === i} className={j === i ? s.tabOn : s.tab} onClick={() => setI(j)}>
            {x.name}
          </button>
        ))}
      </div>
      <p className={s.what}>
        <b>{sc.name}:</b> {sc.what}. {sc.players.toLocaleString("en-US")} players with their own NEAR and {sc.guests.toLocaleString("en-US")} sponsored
        guests over {sc.seeds} seeds; medians unless a range is given.
      </p>

      <dl className={s.stats}>
        <div>
          <dt>Of every NEAR players put in, reaches the vault</dt>
          <dd className="num">{pct(m.players_to_vault[1], 0)}</dd>
        </div>
        <div>
          <dt>Of the vault&rsquo;s payouts, NEAR the house put in</dt>
          <dd className="num">{pct(m.house_share[1])}</dd>
        </div>
        {attackersN > 0 && attackersAhead === 0 && (
          <div>
            <dt>Whales{attackers.length > 1 ? ", split whales and lattice lockers" : ""} that came out ahead</dt>
            <dd className="num">0 of {attackersN.toLocaleString("en-US")}</dd>
          </div>
        )}
        {winners[0] && (
          <div>
            <dt>Best placed</dt>
            <dd className="num" style={{ fontSize: 20 }}>{winners[0].label}</dd>
          </div>
        )}
      </dl>

      {winners.length > 0 && (
        <section className={s.block} aria-labelledby="ww-who">
          <h3 className="h3" id="ww-who">Who wins</h3>
          <p className={s.what}>
            The kinds of player that ended ahead in NEAR after 60 days, best placed first, with the NEAR the tides paid each one (median). The
            winners are the players who read the dish, mostly with R-pentominoes.
          </p>
          <ol className={s.rows}>
            {winners.map((k) => (
              <li key={k.kind} className={s.row}>
                <div className={s.who}>
                  <b>{k.label}</b>
                  <span>{k.plays}</span>
                </div>
                <div className={s.track} aria-hidden="true">
                  <span className={s.rangeUp} style={{ left: 0, width: `${(100 * k.share_positive) / topShare}%` }} />
                </div>
                <div className={s.nums}>
                  <span className={s.ahead}>{near(k.tide)} NEAR</span>
                  <span>from the tides, median</span>
                </div>
              </li>
            ))}
          </ol>
          {attackersN > 0 && attackersAhead === 0 && (
            <p className={s.what}>
              Buying the board does not pay: {attackers.map((k) => `${k.label.toLowerCase()}s`).join(", ").replace(/, ([^,]*)$/, " and $1")} put in the
              most NEAR and came out ahead in no run.
            </p>
          )}
          {guest && (
            <p className={`${s.what} small`}>
              Sponsored guests ({guest.players.toLocaleString("en-US")}) play on 0.05 NEAR of credit someone else paid and attach no NEAR of their own,
              so they never lose NEAR: what they win is credit that stays in the dish.
            </p>
          )}
        </section>
      )}

      <section className={s.block} aria-labelledby="ww-pays">
        <h3 className="h3" id="ww-pays">Who pays</h3>
        <p className={s.what}>
          The NEAR a player attaches does not go to anyone running the dish. About {pct(m.players_to_vault[1], 0)} of it reaches the tide vault, and the
          vault pays back nearly all it takes in, to the colonies alive at each tide; the rest is the storage of the player&rsquo;s own records, which
          the contract keeps while they exist, and gas. Where the vault&rsquo;s payouts came from:
        </p>
        <Split
          label="Where the vault's payouts came from"
          parts={[
            { name: "the house strains' NEAR", v: m.house_share[1], cls: s.pHouse },
            { name: "other players' NEAR", v: 1 - m.house_share[1], cls: s.pVault },
          ]}
        />
        <p className={s.what}>
          The five house strains buy every PETRI they plant with, are never fed and take no tide share, so all of their NEAR that reaches the vault
          goes to the other players.
        </p>
      </section>

      <p className={`${s.what} small`}>
        Scripted players on the mainnet rules, every generation stepped with petri-core.{" "}
        <a href={`${REPO}/blob/main/docs/ECONOMICS.md`}>Method and every number</a> &middot;{" "}
        <a href={`${REPO}/tree/main/sim/out-econ`}>every player&rsquo;s row as CSV</a>.
      </p>
    </div>
  );
}

function Split({ label, parts, marker }: { label: string; parts: { name: string; v: number; cls: string }[]; marker?: { name: string; v: number } }) {
  const text = parts.map((p) => `${p.name} ${pct(p.v)}`).join(", ") + (marker ? `; ${marker.name} ${pct(marker.v)}` : "");
  return (
    <figure className={s.split}>
      <div className={s.bar} role="img" aria-label={`${label}: ${text}`}>
        {parts.map((p) => (
          <span key={p.name} className={p.cls} style={{ width: `${100 * p.v}%` }} />
        ))}
        {marker && <i className={s.marker} style={{ left: `${100 * marker.v}%` }} />}
      </div>
      <figcaption className={s.legend}>
        {parts.map((p) => (
          <span key={p.name} className={s.key}>
            <i className={p.cls} />
            {p.name} <b className="num">{pct(p.v)}</b>
          </span>
        ))}
        {marker && (
          <span className={s.key}>
            <i className={s.markerKey} />
            {marker.name} <b className="num">{pct(marker.v)}</b>
          </span>
        )}
      </figcaption>
    </figure>
  );
}
