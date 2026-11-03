"use client";

import { useEffect, useState } from "react";
import { RuleDemo, type Seed } from "@/components/site/RuleDemo";
import { buy_quote } from "@/engine";
import { useLive, petri, int, near, hex } from "@/lib/live";
import { view } from "@/lib/chain";
import { CONTRACT, accountUrl, fmtPetri } from "@/lib/config";
import { LAUNCH, DEMO, YOCTO, capOf, nearPer } from "./shared";
import s from "./rules.module.css";

// A grower against two small colonies, on a 40 × 22 dish. The cap floor is scaled down to 8 cells for a dish this
// small, as in the contract tests; the share is 15%, as on the real dish.
const CAP_SEEDS: Seed[] = [
  { colony: 1, pattern: "r-pentomino", x: 8, y: 9 },
  { colony: 2, pattern: "block", x: 28, y: 3 },
  { colony: 2, pattern: "block", x: 34, y: 3 },
  { colony: 2, pattern: "block", x: 31, y: 8 },
  { colony: 3, pattern: "beehive", x: 29, y: 15 },
];
const CAP_COLORS = { 1: DEMO.red, 2: DEMO.green, 3: DEMO.blue };
const CAP_NAMES: Record<number, string> = { 1: "Red", 2: "Green", 3: "Blue" };
const DEMO_CAP_MIN = 8;

function CapDemo({ capBps }: { capBps: number }) {
  const [g, setG] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const total = counts.slice(1).reduce((a, b) => a + b, 0);
  const cap = capOf(total, capBps, DEMO_CAP_MIN);
  const weights = [1, 2, 3].map((c) => Math.min(counts[c] ?? 0, cap));
  const wsum = weights.reduce((a, b) => a + b, 0);
  return (
    <figure className={s.figure}>
      <div className={s.dish} style={{ aspectRatio: "40 / 22" }}>
        <RuleDemo
          width={40}
          height={22}
          seeds={CAP_SEEDS}
          loop={160}
          colors={CAP_COLORS}
          stepMs={260}
          stillAt={60}
          label="A growing R-pentomino beside two small colonies, with the cells the feed counts for each"
          onGeneration={(gen, c) => {
            setG(gen);
            setCounts(c);
          }}
        />
      </div>
      <figcaption className={s.caption}>
        <p>
          Red plants an R-pentomino, which grows. Green holds three blocks and Blue a beehive. The table below
          shows each colony&rsquo;s cells, the cells the feed counts for it, and its share of the feed. Red can cover as much ground as it
          likes; past the cap, the extra cells earn nothing.
        </p>
        <p className={s.live} aria-live="off">
          <span className="num">Generation {g}</span>
          <span>
            Cap <b className="num">{cap}</b> cells
          </span>
        </p>
        <table className={`${s.table} ${s.demoTable}`}>
          <thead>
            <tr>
              <th scope="col">Colony</th>
              <th scope="col">Cells</th>
              <th scope="col">Counted</th>
              <th scope="col">Share of the feed</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((c, i) => (
              <tr key={c}>
                <th scope="row">
                  <span className={s.who}>
                    <i className="swatch" style={{ background: hex(CAP_COLORS[c as 1 | 2 | 3]) }} />
                    {CAP_NAMES[c]}
                  </span>
                </th>
                <td className="num">{counts[c] ?? 0}</td>
                <td className="num">{weights[i]}</td>
                <td className="num">{wsum > 0 ? `${Math.round((100 * weights[i]) / wsum)}%` : "0%"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}

const BUYS = [0.01, 0.05, 0.5, 2, 10];

export function CoinSection() {
  const { d, rules, ready, feed, perCell, petriPrice, colonies } = useLive();
  const r = rules ?? LAUNCH;
  const st = d.state;
  const keeperPct = r.keeper_bps / 100;
  const burnPct = r.burn_bps / 100;
  const capPct = r.cap_bps / 100;
  const keeperCut = feed * (r.keeper_bps / 10000);
  const launchPrice = Number(r.petri_price);
  const maxPetri = Number(r.max_supply) / 1e6;
  const k = (launchPrice * maxPetri) / 1e24;

  // The registration price, from the contract's own NEP-145 view.
  const [reg, setReg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    view<{ min: string }>("storage_balance_bounds")
      .then((b) => live && setReg(b.min))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  // What NEAR buys from the agar now, by the engine's copy of the contract's curve.
  const agarStr = String(Math.round(d.agar));
  const buys = BUYS.map((n) => {
    if (!ready) return null;
    const yocto = (YOCTO * BigInt(Math.round(n * 1000))) / 1000n;
    const units = Number(buy_quote(yocto.toString(), agarStr, r.petri_price, r.max_supply));
    const after = d.agar - units > 0 ? (launchPrice * Number(r.max_supply)) / (d.agar - units) : NaN;
    return { n, units, avg: units > 0 ? (n * 1e24 * 1e6) / units : NaN, after };
  });

  // The capped split of this generation's feed, with the cells your browser counts.
  const total = d.totalLive;
  const cap = capOf(total, r.cap_bps, r.cap_min);
  const alive = colonies.filter((c) => c.live > 0);
  const wsum = alive.reduce((a, c) => a + Math.min(c.live, cap), 0);
  const toColonies = feed - keeperCut;
  const shown = alive.slice(0, 8);
  const rest = alive.slice(8);
  const capped = alive.filter((c) => c.live > cap).length;

  // Conservation, checked on the contract's own counters with exact integers.
  const big = (key: keyof NonNullable<typeof st>) => (st ? BigInt(st[key] as string) : 0n);
  const max = BigInt(r.max_supply);
  const supplyOk = st ? big("total_supply") === max - big("burned") : null;
  const agarOk = st ? big("agar") === max - big("sold") - big("fed") + big("returned") : null;
  const held = st ? big("total_supply") - big("agar") - big("keeper_pot") : 0n;
  const v = (key: keyof NonNullable<typeof st>) => (st ? fmtPetri(st[key] as string, 2) : "—");

  const ledger: [string, string, string][] = [
    ["Minted at launch", fmtPetri(r.max_supply, 0), "The whole supply, once, into the agar."],
    ["Sold for NEAR", v("sold"), "Bought from the agar by colonies, at the curve's price."],
    ["Fed to the living", v("fed"), `Everything the agar has paid out each generation, the keeper's ${keeperPct}% included.`],
    ["Returned by planting", v("returned"), `${100 - burnPct}% of every planting goes back into the agar.`],
    ["Still in the agar", v("agar"), "The contract's own balance: minted, less sold and fed, plus returned."],
    ["Waiting in the keeper pot", v("keeper_pot"), "Set aside from the feed until someone calls advance."],
    ["Paid to keepers", v("keeper_paid"), "Pots already collected."],
    ["Burned", v("burned"), `The other ${burnPct}% of every planting. Gone for good.`],
    ["Total supply", v("total_supply"), "What ft_total_supply reports: minted less burned."],
    ["Held by accounts or waiting to be claimed", st ? fmtPetri(held.toString(), 2) : "—", "Total supply less the agar and the keeper pot."],
  ];

  const check = (ok: boolean | null) => (ok === null ? "Reading the contract" : ok ? "Holds on the live dish" : "Does not hold");

  return (
    <section id="coin" className={`band band-paper ${s.section}`} aria-labelledby="coin-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="coin-title" className={s.h2}>PETRI leaves the agar for NEAR and for life, and comes back with planting</h2>
          <p className="lede">
            All {fmtPetri(r.max_supply, 0)} PETRI were minted once, at launch, into the contract&rsquo;s own balance. That
            balance is the agar, and there is no other mint and no free grant. PETRI leaves the agar two ways: colonies buy it
            with NEAR, and the agar feeds a sliver of itself to living cells every generation. It comes back one way: half of
            every planting returns to it, and the other half is burned.
          </p>
        </div>

        <div className={s.flows}>
          <article className={s.paperCard}>
            <h3 className="h3">Buying in</h3>
            <p>
              A colony gets its first PETRI by joining with at least <b className="num">{near(Number(r.min_join), 2)} NEAR</b>. That
              NEAR first pays for the colony&rsquo;s own storage, and the rest buys PETRI from the agar. After that,{" "}
              <code className={s.codePaper}>buy</code> spends whatever NEAR is attached the same way. Only colonies can buy, so
              every purchase is in the ledger with the NEAR paid and the PETRI received. All of that NEAR goes to the tide vault.
            </p>
            <pre className={s.formulaPaper}>
              {`price of one PETRI = ${nearPer(launchPrice)} NEAR × ${int(maxPetri)} ÷ PETRI in the agar
PETRI bought = agar × NEAR paid ÷ (${int(k)} NEAR + NEAR paid ÷ 2)`}
            </pre>
            <p>
              At launch one PETRI cost {nearPer(launchPrice)} NEAR. The price rises as the agar empties: with half of it left, a
              PETRI costs twice as much. A purchase is priced at the midpoint of the stretch of curve it moves along, so a big
              buy pays more for its last PETRI than its first. Splitting a purchase into smaller buys does not get more PETRI.
            </p>
            <dl className={s.sums}>
              <div>
                <dt>Agar at your browser&rsquo;s generation</dt>
                <dd className="num">{ready ? petri(d.agar, 2) : "—"}</dd>
              </div>
              <div>
                <dt>One PETRI from the agar now</dt>
                <dd className="num">{ready ? `${nearPer(petriPrice)} NEAR` : "—"}</dd>
              </div>
            </dl>
            <div className={s.tableWrap}>
              <table className={`${s.paperTable}`}>
                <thead>
                  <tr>
                    <th scope="col">NEAR paid</th>
                    <th scope="col">PETRI received</th>
                    <th scope="col">NEAR per PETRI</th>
                    <th scope="col">Price after</th>
                  </tr>
                </thead>
                <tbody>
                  {BUYS.map((n, i) => {
                    const b = buys[i];
                    return (
                      <tr key={n}>
                        <td className="num">{n}</td>
                        <td className="num">{b ? petri(b.units, 2) : "—"}</td>
                        <td className="num">{b ? nearPer(b.avg) : "—"}</td>
                        <td className="num">{b ? nearPer(b.after) : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className={s.paperNote}>
              Computed in your browser with <code className={s.codePaper}>buy_quote</code> from petri-core, the function the
              contract runs. A join buys with its NEAR less its storage, so it receives a little less than this table shows.
              There is no sell-back: PETRI never turns back into NEAR through the agar.
            </p>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">Every generation</h3>
            <p>
              If anything is alive after the step, the agar pays {r.feed_ppm} parts per million of its balance. {keeperPct}% of
              that goes to the keeper pot. The rest is split between colonies by their capped cell counts. Rounding remainders
              stay in the agar. An empty dish pays nothing.
            </p>
            <dl className={s.sums}>
              <div>
                <dt>Feed: agar × {r.feed_ppm} ÷ 1,000,000</dt>
                <dd className="num">{ready ? petri(feed, 4) : "—"}</dd>
              </div>
              <div>
                <dt>To the keeper pot</dt>
                <dd className="num">{ready ? petri(keeperCut, 4) : "—"}</dd>
              </div>
              <div>
                <dt>Average per live cell, of {ready ? int(total) : "—"}</dt>
                <dd className="num">{ready ? petri(perCell, 5) : "—"}</dd>
              </div>
            </dl>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">The keeper pot</h3>
            <p>
              The pot collects {keeperPct}% of every generation&rsquo;s feed, whichever call ran it. Only{" "}
              <code className={s.codePaper}>advance</code> pays it out, all of it, to the caller, and only if the caller can
              hold PETRI. That pays whoever keeps the dish close to the clock.
            </p>
            <dl className={s.sums}>
              <div>
                <dt>In the pot now</dt>
                <dd className="num">{st ? fmtPetri(st.keeper_pot, 4) : "—"}</dd>
              </div>
              <div>
                <dt>Paid to keepers so far</dt>
                <dd className="num">{st ? fmtPetri(st.keeper_paid, 2) : "—"}</dd>
              </div>
            </dl>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">Claiming</h3>
            <p>
              Earnings do not land in a balance on their own. Each colony&rsquo;s feed adds up in one shared record, so catching
              the dish up reads and writes that one record and logs one summary line however many colonies are alive. A colony
              moves its earnings into its balance with <code className={s.codePaper}>claim</code>, which also sends the NEAR it
              has won at the tides. Planting claims the waiting PETRI first, so it always counts towards the price. The{" "}
              <code className={s.codePaper}>claimable</code> view shows what is waiting, and{" "}
              <code className={s.codePaper}>earnings</code> shows every colony&rsquo;s lifetime total, claimed or not.
            </p>
          </article>
        </div>

        <div className={s.capGrid}>
          <div>
            <h3 className="h3">No colony is paid for more than {capPct}% of the living</h3>
            <p className={s.paperMuted}>
              Each colony&rsquo;s claim on the feed is its living cells, but never more than {capPct}% of all living cells, and
              the cap is never below {int(r.cap_min)} cells. The feed is split in proportion to those capped counts, so what a
              runaway grower is not paid for goes to everyone else. Small colonies are counted cell for cell, so splitting into
              many accounts gains nothing. The tides use the same counts.
            </p>
            <pre className={s.formulaPaper}>
              {`cap = max(all living cells × ${capPct}%, ${int(r.cap_min)})
counted cells = min(a colony's living cells, cap)
share = this generation's feed × (1 − ${keeperPct}%) × counted ÷ all counted cells`}
            </pre>
            <CapDemo capBps={r.cap_bps} />
          </div>
          <div>
            <h3 className="h3">The split on the live dish</h3>
            <p className={s.paperMuted}>
              {ready
                ? `${int(total)} cells are alive at your browser's generation, so the cap is ${int(cap)} cells${total * r.cap_bps < r.cap_min * 10000 ? `, the floor, because ${capPct}% of the dish is fewer` : ""}. ${capped === 0 ? "No colony is over it right now." : `${capped} ${capped === 1 ? "colony is" : "colonies are"} over it right now.`}`
                : "Reading the dish."}
            </p>
            <div className={s.tableWrap} tabIndex={0} role="region" aria-label="This generation's feed by colony">
              <table className={`${s.paperTable} ${s.splitTable}`}>
                <thead>
                  <tr>
                    <th scope="col">Colony</th>
                    <th scope="col">Living cells</th>
                    <th scope="col">Counted</th>
                    <th scope="col">Share</th>
                    <th scope="col">PETRI a generation</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => {
                    const w = Math.min(c.live, cap);
                    return (
                      <tr key={c.id} className={c.live > cap ? s.paperNow : undefined}>
                        <th scope="row">
                          <span className={s.who}>
                            <i className="swatch" style={{ background: hex(c.color) }} />
                            {c.name}
                          </span>
                        </th>
                        <td className="num">{int(c.live)}</td>
                        <td className="num">{int(w)}</td>
                        <td className="num">{wsum > 0 ? `${((100 * w) / wsum).toFixed(1)}%` : "—"}</td>
                        <td className="num">{wsum > 0 ? petri((toColonies * w) / wsum, 4) : "—"}</td>
                      </tr>
                    );
                  })}
                  {rest.length > 0 && (
                    <tr>
                      <th scope="row">{rest.length} more</th>
                      <td className="num">{int(rest.reduce((a, c) => a + c.live, 0))}</td>
                      <td className="num">{int(rest.reduce((a, c) => a + Math.min(c.live, cap), 0))}</td>
                      <td className="num">{wsum > 0 ? `${((100 * rest.reduce((a, c) => a + Math.min(c.live, cap), 0)) / wsum).toFixed(1)}%` : "—"}</td>
                      <td className="num">{wsum > 0 ? petri((toColonies * rest.reduce((a, c) => a + Math.min(c.live, cap), 0)) / wsum, 4) : "—"}</td>
                    </tr>
                  )}
                  {ready && alive.length === 0 && (
                    <tr>
                      <td colSpan={5}>Nothing is alive, so nothing is fed.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className={s.paperNote}>
              Highlighted rows are over the cap. Figures are this generation&rsquo;s feed at your browser&rsquo;s generation,
              rounded for display; the contract rounds each share down to a millionth of a PETRI.
            </p>
          </div>
        </div>

        <div className={s.coinGrid}>
          <div>
            <h3 className="h3">The ledger, from the contract</h3>
            <p className={s.paperMuted}>
              Read from the <code className={s.codePaper}>state</code> view of{" "}
              <a className={s.linkPaper} href={accountUrl(CONTRACT)}>{CONTRACT}</a> at stored generation{" "}
              {st ? int(Number(st.generation)) : "—"}. Feed for the generations since then is added when the dish next advances.
            </p>
            <dl className={s.ledger}>
              {ledger.map(([key, val, note]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd className="num">{val}</dd>
                  <p>{note}</p>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="h3">Nothing is created or lost</h3>
            <p className={s.paperMuted}>
              Every PETRI is in the agar, in an account, waiting to be claimed, in the keeper pot, or burned. The contract tests
              assert these identities after every scenario. The first two are checked again here, on the live counters, with
              exact integers.
            </p>
            <ul className={s.checks}>
              <li className={s.checkItem}>
                <code className={s.codePaper}>total supply = minted − burned</code>
                <span className={supplyOk === false ? s.bad : s.good}>{check(supplyOk)}</span>
              </li>
              <li className={s.checkItem}>
                <code className={s.codePaper}>agar = minted − sold − fed + returned</code>
                <span className={agarOk === false ? s.bad : s.good}>{check(agarOk)}</span>
              </li>
              <li className={s.checkItem}>
                <code className={s.codePaper}>every balance + agar + unclaimed + keeper pot = total supply</code>
                <span className={s.paperMuted}>Checked in the tests by summing every holder</span>
              </li>
            </ul>

            <h3 className={`h3 ${s.spaced}`}>A standard token that the dish never plays with</h3>
            <ul className={s.standards}>
              <li>
                <b>NEP-141.</b> <code className={s.codePaper}>ft_transfer</code>, <code className={s.codePaper}>ft_transfer_call</code>{" "}
                (with refunds through <code className={s.codePaper}>ft_resolve_transfer</code>),{" "}
                <code className={s.codePaper}>ft_balance_of</code> and <code className={s.codePaper}>ft_total_supply</code>. Transfers
                attach exactly 1 yoctoNEAR, as the standard asks, and any amount above zero may move.
              </li>
              <li>
                <b>NEP-148.</b> Name Petri, symbol PETRI, 6 decimals and an inline icon.
              </li>
              <li>
                <b>NEP-145, for real.</b> A receiver must be registered before it can hold PETRI. Joining registers a colony;
                anyone else calls <code className={s.codePaper}>storage_deposit</code>, which costs{" "}
                <b className="num">{reg ? `${near(Number(reg), 5)} NEAR` : "the storage of one balance record"}</b> and refunds
                the rest. <code className={s.codePaper}>storage_unregister</code> refunds an empty account that is not a colony.
              </li>
              <li>
                <b>The dish does not play on itself.</b> The contract account cannot join, buy, plant, claim, advance or send
                PETRI, and a transfer to it is refused with &ldquo;PETRI goes back to the agar only by planting&rdquo;. Its{" "}
                <code className={s.codePaper}>ft_balance_of</code> is the agar.
              </li>
              <li>
                <b>Supply counts what no balance shows.</b> <code className={s.codePaper}>ft_total_supply</code> includes the agar,
                unclaimed earnings and the keeper pot, so the balances of every account add up to less than it until those are
                claimed.
              </li>
              <li>
                <b>Events.</b> NEP-141 <code className={s.codePaper}>ft_mint</code> once at launch,{" "}
                <code className={s.codePaper}>ft_transfer</code> for purchases, claims, keeper pots, planting returns, transfers
                and refunds, and <code className={s.codePaper}>ft_burn</code> for planting. The dish&rsquo;s own events are{" "}
                <code className={s.codePaper}>join</code>, <code className={s.codePaper}>plant</code>,{" "}
                <code className={s.codePaper}>claim</code> and one <code className={s.codePaper}>generation</code> summary per
                catch-up.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
