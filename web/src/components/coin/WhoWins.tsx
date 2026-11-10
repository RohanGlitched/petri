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
const HOUSE_ONLY = ALL.find((x) => x.players === 0);

const pct = (v: number, d = 1) => `${(100 * v).toFixed(d)}%`;
const near = (v: number) => {
  const a = Math.abs(v);
  return a === 0 ? "0" : a < 0.001 ? a.toFixed(5) : a < 0.1 ? a.toFixed(4) : a.toFixed(3);
};
const signed = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "") + near(v);
const petri = (v: number) => Math.round(v).toLocaleString("en-US");

export function WhoWins() {
  const [i, setI] = useState(Math.max(0, SCEN.findIndex((x) => x.name === "steady")));
  const [kind, setKind] = useState("Builder");
  const sc = SCEN[i];
  const m = sc.money;
  const rt = sc.round_trip;
  const rows = sc.kinds.filter((k) => !k.credit);
  const guest = sc.kinds.find((k) => k.credit);
  const top = Math.min(2, Math.max(1.2, ...rows.map((k) => k.back_per_near[2])));
  const x = (v: number) => `${(100 * Math.min(Math.max(v, 0), top)) / top}%`;
  const ticks = [0, 0.5, 1, 1.5, 2].filter((t) => t <= top);
  const day = sc.day1.find((d) => d.kind === kind) ?? sc.day1[0];
  const best = [...rows].sort((a, b) => b.share_positive - a.share_positive)[0];

  return (
    <div className={s.root}>
      <div className="section-head">
        <h2 className="h2">Who wins, and who pays</h2>
        <p className="lede">
          PETRI pays no yield. What a tide pays a colony is NEAR other players put into the vault, plus a sliver of the house strains&rsquo; while
          their small budget lasts. Petri is a redistribution game with a burn: a few players win other players&rsquo; NEAR, and every move pays
          its own storage and gas. The numbers below are the simulator&rsquo;s, player by player.
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
          <dt>Players ahead in NEAR after 60 days</dt>
          <dd className="num">{pct(sc.share_positive)}</dd>
        </div>
        <div>
          <dt>Median player&rsquo;s net NEAR</dt>
          <dd className="num">{signed(sc.net[1])}</dd>
        </div>
        <div>
          <dt>Of what the vault paid out, the house&rsquo;s NEAR</dt>
          <dd className="num">{pct(m.house_share[1])}</dd>
        </div>
        <div>
          <dt>A 0.05 NEAR round trip on day 1 returns</dt>
          <dd className="num">{pct(rt.day1_net)}</dd>
        </div>
      </dl>

      <section className={s.block} aria-labelledby="ww-who">
        <h3 className="h3" id="ww-who">Who wins</h3>
        <p className={s.what}>
          What each kind of player got back for every NEAR it put in over 60 days: NEAR it took out, NEAR still owed to it, and the PETRI it still
          holds at the sell-back price, over the NEAR it attached and its gas. The bar runs from the 10th to the 90th percentile of players; the
          dot is the median; 1.00 breaks even. Best placed: {best.label} ({pct(best.share_positive)} ended ahead).
        </p>
        <div className={s.scale} aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className={t === 1 ? s.even : t === 0 ? s.first : undefined} style={{ left: x(t) }}>
              {t.toFixed(2)}
            </span>
          ))}
        </div>
        <ol className={s.rows}>
          {rows.map((k) => (
            <li key={k.kind} className={s.row}>
              <div className={s.who}>
                <b>{k.label}</b>
                <span>{k.plays}</span>
              </div>
              <div
                className={s.track}
                role="img"
                aria-label={`${k.label}: got back ${k.back_per_near[1].toFixed(2)} per NEAR put in (median), ${k.back_per_near[0].toFixed(2)} to ${k.back_per_near[2].toFixed(2)} for the middle 80% of players`}
              >
                {ticks.map((t) => (
                  <i key={t} className={t === 1 ? s.evenLine : s.tick} style={{ left: x(t) }} />
                ))}
                <span className={k.back_per_near[1] >= 1 ? s.rangeUp : s.range} style={{ left: x(k.back_per_near[0]), width: `calc(${x(k.back_per_near[2])} - ${x(k.back_per_near[0])})` }} />
                <span className={k.back_per_near[1] >= 1 ? s.dotUp : s.dot} style={{ left: x(k.back_per_near[1]) }} />
              </div>
              <div className={s.nums}>
                <span className={s.ahead}>{pct(k.share_positive)} ahead</span>
                <span>
                  net {signed(k.net[1])} NEAR of {near(k.paid)} put in
                </span>
              </div>
            </li>
          ))}
        </ol>
        {guest && (
          <p className={`${s.what} small`}>
            Sponsored guests ({guest.players.toLocaleString("en-US")}) play on 0.05 NEAR of credit someone else paid and attach no NEAR of their own,
            so they neither win nor lose NEAR: what they win is credit that stays in the dish. {pct(guest.credit_above_grant)} ended with more credit
            and PETRI than their grant.
          </p>
        )}
      </section>

      <section className={s.block} aria-labelledby="ww-pays">
        <h3 className="h3" id="ww-pays">Who pays</h3>
        <p className={s.what}>
          Outside players together put in {near(m.players_paid[1])} NEAR and ended with {near(m.players_back[1])} of it (median run). Where
          it went:
        </p>
        <Split
          label="Where players' NEAR went"
          parts={[
            { name: "into the vault", v: m.players_to_vault[1], cls: s.pVault },
            { name: "storage of their own records", v: m.players_to_storage[1], cls: s.pStore },
            { name: "gas", v: m.players_to_gas[1], cls: s.pGas },
          ]}
          marker={{ name: "came back to players", v: m.players_back_share[1] }}
        />
        <p className={s.what}>
          The storage is NEAR&rsquo;s price for the bytes a player&rsquo;s own moves write (its colony, its plantings, its purchases): the contract
          keeps it while the records exist and nobody is paid it. The vault pays back nearly all it takes in, to the colonies alive at each tide.
          Where that pay came from:
        </p>
        <Split
          label="Where the vault's payouts came from"
          parts={[
            { name: "the house strains' NEAR", v: m.house_share[1], cls: s.pHouse },
            { name: "other players' NEAR", v: 1 - m.house_share[1], cls: s.pVault },
          ]}
        />
        <div className={s.after}>
          <h4>After the house runs out</h4>
          <p>
            The five house strains bring {near(m.house_paid[1])} NEAR in all ({near(m.vault_in_house[1])} of it reaches the vault) and are never paid.
            They reach the floor they keep for gas on day {m.house_out_day ?? "—"} and stop buying. The dish keeps running: after that day the
            vault paid {near(m.after_house_out.paid_to_players[1])} NEAR more over {Math.round(m.after_house_out.tides).toLocaleString("en-US")} tides,
            {" "}{pct(m.after_house_out.house_share[1], 2)} of it the house&rsquo;s leftover share. From then on a tide only moves players&rsquo; NEAR
            between players.
            {HOUSE_ONLY && <> With the house alone no tide runs at all: nobody outside the house is alive to be paid.</>}
          </p>
        </div>
      </section>

      <section className={s.block} aria-labelledby="ww-day">
        <h3 className="h3" id="ww-day">A player&rsquo;s first day</h3>
        <p className={s.what}>
          One real player from the run: the median of its kind by its first day&rsquo;s result, with its books as they stood 24 hours after it
          joined.
        </p>
        <div className={s.pills} role="tablist" aria-label="Kind of player">
          {sc.day1.map((d) => (
            <button key={d.kind} role="tab" aria-selected={d.kind === day.kind} className={d.kind === day.kind ? s.tabOn : s.tab} onClick={() => setKind(d.kind)}>
              {d.label}
            </button>
          ))}
        </div>
        <div className={s.card}>
          <p className={s.cardHead}>
            {day.label} (seed {day.seed}), joined on day {day.join_day.toFixed(1)}. {pct(day.share_positive)} of {day.players.toLocaleString("en-US")} ended their first day
            ahead.
          </p>
          <dl className={s.receipt}>
            <div>
              <dt>{day.credit ? "Credit spent (someone else’s NEAR)" : "NEAR attached (join, plantings, top-ups)"}</dt>
              <dd className="num">{day.credit ? "sponsored" : `−${near(day.attached)}`}</dd>
            </div>
            <div>
              <dt>Gas</dt>
              <dd className="num">{day.credit ? "paid by the sponsor" : `−${near(day.gas)}`}</dd>
            </div>
            <div>
              <dt>PETRI bought at join</dt>
              <dd className="num">{petri(day.join_petri)} PETRI</dd>
            </div>
            <div>
              <dt>PETRI the agar fed its living cells</dt>
              <dd className="num">{petri(day.fed)} PETRI</dd>
            </div>
            <div>
              <dt>
                PETRI spent on {day.plantings} {day.plantings === 1 ? "planting" : "plantings"} (half burned, half back to the agar)
              </dt>
              <dd className="num">{petri(day.planted)} PETRI</dd>
            </div>
            <div>
              <dt>Its tide shares{day.credit ? " (credit)" : ""}</dt>
              <dd className="num">{near(day.tide)}</dd>
            </div>
            <div>
              <dt>Sold back for NEAR</dt>
              <dd className="num">+{near(day.sold)}</dd>
            </div>
            <div>
              <dt>Tide NEAR claimed, owed, and bounties</dt>
              <dd className="num">+{near(day.claimed + day.owed + day.bounty)}</dd>
            </div>
            <div>
              <dt>
                PETRI still held ({petri(day.held_petri)}) at the sell-back, with {day.live} living {day.live === 1 ? "cell" : "cells"}
              </dt>
              <dd className="num">+{near(day.held_value)}</dd>
            </div>
            <div className={s.total}>
              <dt>Net after one day{day.credit ? " (no NEAR of its own at stake)" : ""}</dt>
              <dd className="num">{day.credit ? "0" : `${signed(day.net)} NEAR`}</dd>
            </div>
          </dl>
          {!day.credit && (
            <p className={`${s.what} small`}>
              The middle 80% of this kind after one day: {signed(day.net_p10)} to {signed(day.net_p90)} NEAR.
            </p>
          )}
        </div>
      </section>

      <section className={s.block} aria-labelledby="ww-spread">
        <h3 className="h3" id="ww-spread">What the spread costs</h3>
        <p className={s.what}>
          The agar sells PETRI on a curve and buys it back at half the curve&rsquo;s price, never paying more than the vault&rsquo;s share for the
          PETRI outside it, and at most 10% of the vault between two tides. A round trip of {rt.deposit} NEAR at each day&rsquo;s prices:
        </p>
        <dl className={s.receipt}>
          <div>
            <dt>Attached</dt>
            <dd className="num">{rt.deposit} NEAR</dd>
          </div>
          <div>
            <dt>The purchase record&rsquo;s storage</dt>
            <dd className="num">&minus;{near(rt.buy_record)}</dd>
          </div>
          <div>
            <dt>PETRI bought (median day)</dt>
            <dd className="num">{petri(rt.petri[1])} PETRI</dd>
          </div>
          <div>
            <dt>The curve&rsquo;s half price for them</dt>
            <dd className="num">{pct(rt.curve[1])}</dd>
          </div>
          <div>
            <dt>What the sell-back pays, the vault&rsquo;s share counted (median day; range)</dt>
            <dd className="num">
              {pct(rt.back[1])} ({pct(rt.back[0])}&ndash;{pct(rt.back[2])})
            </dd>
          </div>
          <div className={s.total}>
            <dt>Back after the sale record&rsquo;s storage: day 1 / median day / day 60</dt>
            <dd className="num">
              {pct(rt.day1_net)} / {pct(rt.net[1])} / {pct(rt.day60_net)}
            </dd>
          </div>
        </dl>
        <p className={`${s.what} small`}>
          Gas is not counted here. The tides pay most of the vault to living colonies, so later in a busy dish the vault&rsquo;s share, not the
          curve, sets the price: PETRI is not a store of NEAR. The allowance left before the next tide was smaller than this sale on{" "}
          {pct(rt.allowance_short_days)} of days.
        </p>
      </section>

      {sc.cohorts.length > 1 && (
        <section className={s.block} aria-labelledby="ww-late">
          <h3 className="h3" id="ww-late">Early and late</h3>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">Joined</th>
                  <th scope="col">Players</th>
                  <th scope="col">Ahead after 60 days</th>
                  <th scope="col">Net NEAR, p10 / median / p90</th>
                  <th scope="col">Tide NEAR, median</th>
                </tr>
              </thead>
              <tbody>
                {sc.cohorts.map((c) => (
                  <tr key={c.joined}>
                    <td>{c.joined}</td>
                    <td className="num">{c.players.toLocaleString("en-US")}</td>
                    <td className="num">{pct(c.share_positive)}</td>
                    <td className="num">
                      {signed(c.net[0])} / {signed(c.net[1])} / {signed(c.net[2])}
                    </td>
                    <td className="num">{near(c.tide_median)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className={s.details}>
        <summary>Every kind as a table</summary>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th scope="col">Player</th>
                <th scope="col">Players</th>
                <th scope="col">Put in, median</th>
                <th scope="col">Ahead</th>
                <th scope="col">Net NEAR, p10 / median / p90</th>
                <th scope="col">Back per NEAR, median</th>
                <th scope="col">Tide NEAR, median</th>
                <th scope="col">Sold back, median</th>
              </tr>
            </thead>
            <tbody>
              {sc.kinds.map((k) => (
                <tr key={k.kind}>
                  <td>{k.label}</td>
                  <td className="num">{k.players.toLocaleString("en-US")}</td>
                  <td className="num">{k.credit ? "credit" : near(k.paid)}</td>
                  <td className="num">{k.credit ? "—" : pct(k.share_positive)}</td>
                  <td className="num">{k.credit ? "—" : `${signed(k.net[0])} / ${signed(k.net[1])} / ${signed(k.net[2])}`}</td>
                  <td className="num">{k.credit ? "—" : k.back_per_near[1].toFixed(3)}</td>
                  <td className="num">
                    {near(k.tide)}
                    {k.credit ? " credit" : ""}
                  </td>
                  <td className="num">
                    {near(k.sold)}
                    {k.credit ? " credit" : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <p className={`${s.what} small`}>
        Scripted players on the mainnet rules, every generation stepped with petri-core; a model, not a forecast. Players here never learn, and
        nobody new arrives unless the scenario says so.{" "}
        <a href={`${REPO}/blob/main/docs/ECONOMICS.md`}>Method, numbers and limits</a> &middot;{" "}
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
