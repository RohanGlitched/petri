"use client";

import { useEffect, useState } from "react";
import { RuleDemo, type Seed } from "@/components/site/RuleDemo";
import { buy_quote } from "@/engine";
import { useLive, petri, int, near, hex } from "@/lib/live";
import { viewShared } from "@/lib/chain";
import { fmtPetri } from "@/lib/config";
import { useNet } from "@/lib/use-net";
import { LAUNCH, DEMO, YOCTO, nearPer, weightOf } from "./shared";
import s from "./rules.module.css";
import { BenchTag } from "@/components/site/BenchTag";
import { PhoneFold } from "./PhoneFold";

// A grower against two small colonies, on a 40 × 22 dish. Each colony's planted count is what its seeds plant, so the
// reach cap here is exactly the contract's: an R-pentomino planted as 5 cells is paid for at most 5 × reach.
const REACH_SEEDS: Seed[] = [
  { colony: 1, pattern: "r-pentomino", x: 8, y: 9 },
  { colony: 2, pattern: "block", x: 28, y: 3 },
  { colony: 2, pattern: "block", x: 34, y: 3 },
  { colony: 2, pattern: "block", x: 31, y: 8 },
  { colony: 3, pattern: "beehive", x: 29, y: 15 },
];
const REACH_PLANTED: Record<number, number> = { 1: 5, 2: 12, 3: 6 };
const REACH_COLORS = { 1: DEMO.red, 2: DEMO.green, 3: DEMO.blue };
const REACH_NAMES: Record<number, string> = { 1: "Red", 2: "Green", 3: "Blue" };

function ReachDemo({ reach }: { reach: number }) {
  const [g, setG] = useState(0);
  const [counts, setCounts] = useState<number[]>([]);
  const weights = [1, 2, 3].map((c) => weightOf(counts[c] ?? 0, REACH_PLANTED[c], reach));
  const wsum = weights.reduce((a, b) => a + b, 0);
  return (
    <figure className={s.figure}>
      <div className={s.dish} style={{ aspectRatio: "40 / 22" }}>
        <RuleDemo
          width={40}
          height={22}
          seeds={REACH_SEEDS}
          loop={160}
          colors={REACH_COLORS}
          stepMs={260}
          stillAt={60}
          label="A growing R-pentomino beside two small colonies, with the cells the feed pays each for"
          onGeneration={(gen, c) => {
            setG(gen);
            setCounts(c);
          }}
        />
      </div>
      <figcaption className={s.caption}>
        <p>
          Red plants an R-pentomino, 5 cells, which grows. Green planted three blocks (12 cells) and Blue a beehive (6). Each is
          paid for at most {reach} living cells per cell it planted, so Red can cover as much ground as it likes and is still
          paid for {5 * reach} at most. (No tide runs in this small demo, so no stake decays.)
        </p>
        <p className={s.live} aria-live="off">
          <span className="num">Generation {g}</span>
        </p>
        <table className={`${s.table} ${s.demoTable}`}>
          <thead>
            <tr>
              <th scope="col">Colony</th>
              <th scope="col">Cells</th>
              <th scope="col">Paid for</th>
              <th scope="col">Share of the feed</th>
            </tr>
          </thead>
          <tbody>
            {[1, 2, 3].map((c, i) => (
              <tr key={c}>
                <th scope="row">
                  <span className={s.who}>
                    <i className="swatch" style={{ background: hex(REACH_COLORS[c as 1 | 2 | 3]) }} />
                    {REACH_NAMES[c]}
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
  const net = useNet();
  const r = rules ?? LAUNCH;
  const st = d.state;
  const keeperPct = r.keeper_bps / 100;
  const burnPct = r.burn_bps / 100;
  // The agar releases its full ration only for at least `live_floor` counted cells; below that, that fraction of it.
  const counted = d.counted;
  const released = counted > 0 ? (feed * Math.min(counted, r.live_floor)) / Math.max(r.live_floor, 1) : 0;
  const keeperCut = released * (r.keeper_bps / 10000);
  const launchPrice = Number(r.petri_price);
  const maxPetri = Number(r.max_supply) / 1e6;
  const k = (launchPrice * maxPetri) / 1e24;

  // The registration price, from the contract's own NEP-145 view.
  const [reg, setReg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    viewShared<{ min: string }>("storage_balance_bounds")
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

  // This generation's feed by colony, with the reach cap and the house left out, from the cells your browser counts.
  const total = d.totalLive;
  const alive = colonies
    .filter((c) => c.live > 0)
    .map((c) => ({ ...c, w: weightOf(c.live, Number(c.cells_planted), r.reach, c.house) }));
  const wsum = alive.reduce((a, c) => a + c.w, 0);
  const toColonies = released - keeperCut;
  const shown = alive.slice(0, 8);
  const rest = alive.slice(8);
  const restW = rest.reduce((a, c) => a + c.w, 0);
  const capped = alive.filter((c) => !c.house && c.live > c.w).length;

  // Conservation, checked on the contract's own counters with exact integers.
  const big = (key: keyof NonNullable<typeof st>) => (st ? BigInt(st[key] as string) : 0n);
  const max = BigInt(r.max_supply);
  const supplyOk = st ? big("total_supply") === max - big("burned") : null;
  const agarOk = st ? big("agar") === max - big("sold") - big("fed") + big("returned") + big("bought_back") : null;
  const held = st ? big("total_supply") - big("agar") - big("keeper_pot") : 0n;
  const v = (key: keyof NonNullable<typeof st>) => (st ? fmtPetri(st[key] as string, 2) : "—");

  const ledger: [string, string, string][] = [
    ["Minted at launch", fmtPetri(r.max_supply, 0), "The whole supply, once, into the agar."],
    ["Sold for NEAR", v("sold"), "Bought from the agar by colonies, at the curve's price."],
    ["Fed to the living", v("fed"), `Everything the agar has paid out each generation, the keeper's ${keeperPct}% included.`],
    ["Returned by planting", v("returned"), `${100 - burnPct}% of every planting goes back into the agar.`],
    ["Bought back", v("bought_back"), "PETRI the agar bought back for NEAR from the vault."],
    ["Still in the agar", v("agar"), "Minted, less sold and fed, plus returned and bought back."],
    ["Waiting in the keeper pot", v("keeper_pot"), "Set aside from the feed until a call outside the house runs a generation."],
    ["Paid from the keeper pot", v("keeper_paid"), "Pots already collected by the calls that ran a generation (never a house account or keeper)."],
    ["Burned", v("burned"), `The other ${burnPct}% of every planting, the whole price of every specimen slide, and PETRI burned by a forced unregistration or a refund to a sender that had unregistered. Gone for good.`],
    ["Total supply", v("total_supply"), "What ft_total_supply reports: minted less burned."],
    ["Held by accounts or waiting to be claimed", st ? fmtPetri(held.toString(), 2) : "—", "Total supply less the agar and the keeper pot."],
  ];

  const check = (ok: boolean | null) => (ok === null ? "Reading the contract" : ok ? "Holds on the live dish" : "Does not hold");

  return (
    <section id="coin" data-section="The coin and the reach" className={`band band-paper ${s.section}`} aria-labelledby="coin-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="coin-title" className={s.h2}>PETRI leaves the agar for NEAR and for life, and comes back with planting</h2>
          <p className="lede">
            All {fmtPetri(r.max_supply, 0)} PETRI were minted once, at launch, into the contract&rsquo;s own balance. That
            balance is the agar, and there is no other mint and no free grant. PETRI leaves the agar two ways: colonies buy it
            with NEAR, and the agar feeds a sliver of itself to living cells every generation. It comes back two ways: half of
            every planting returns to it, and the agar buys PETRI back for NEAR at half its price. The rest of every planting,
            and every PETRI spent on a specimen slide, is burned.
          </p>
        </div>
        <PhoneFold label="Buying, feeding, payback and the reach, with live numbers" paper>

          <div className={s.flows}>
            <article className={s.paperCard}>
              <h3 className="h3">Buying in</h3>
              <p>
                A colony gets its first PETRI by joining with at least <b className="num">{near(Number(r.min_join), 2)} NEAR</b>,
                attached by a wallet or spent from sponsored credit. That NEAR first pays for the colony&rsquo;s storage and the
                rest buys PETRI from the agar. After that, <code className={s.codePaper}>buy</code> spends NEAR the same way. Every
                purchase is in the ledger with the NEAR and credit paid and the PETRI received; attached NEAR goes to the tide
                vault and credit to the credit pool.{" "}
                {net.freePlay ? "" : "On mainnet a purchase can also arrive as wNEAR through NEAR Intents, which the contract unwraps and treats as attached NEAR. It never refunds wNEAR that pays for its own records: an amount that cannot join or buy at once waits as pending NEAR for its account, with its order (an amount too small for its records is returned and writes nothing). A colony attaches NEAR only if what reaches the vault, net of storage, is at least 0.01 NEAR in that one call."}
              </p>
              <pre className={s.formulaPaper}>
                {`price of one PETRI = ${nearPer(launchPrice)} NEAR × ${int(maxPetri)} ÷ PETRI in the agar
  PETRI bought = agar × NEAR paid ÷ (${int(k)} NEAR + NEAR paid ÷ 2)`}
              </pre>
              <p>
                At launch one PETRI cost {nearPer(launchPrice)} NEAR. With half of the agar left, it costs twice as much. A purchase
                is priced at the midpoint of the stretch of curve it moves along, so splitting a purchase does not get more PETRI.
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
              <details className={`${s.fold} ${s.foldPaper}`}>
                <summary>
                  What NEAR buys now <small>5 amounts</small>
                </summary>
                <div className={s.foldBody}>
                  <div className={s.tableWrap}>
                    <table className={s.paperTable}>
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
                    contract runs. A join buys with its NEAR less its storage, so it receives a little less.
                  </p>
                </div>
              </details>
            </article>
            <article className={s.paperCard}>
              <h3 className="h3">Every generation</h3>
              <p>
                The agar&rsquo;s ration is {r.feed_ppm} parts per million of its balance. It releases the whole ration only when
                at least {int(r.live_floor)} cells are counted (living cells of fed colonies, capped by reach); with fewer, it
                releases that fraction and keeps the rest, so a lone block earns 4/{int(r.live_floor)} of the ration, what its
                price assumes. {keeperPct}% of what is released goes to the keeper pot, paid to the account whose call next runs at least one generation
                (<code className={s.codePaper}>advance</code> or any call that catches the dish up) and can hold PETRI, unless it is
                a house account or a keeper: then the pot keeps waiting for the next caller. The rest is split by each colony&rsquo;s paid cells (see the reach, below). House
                colonies are never fed. Rounding remainders stay in the agar.
              </p>
              <dl className={s.sums}>
                <div>
                  <dt>Ration: agar × {r.feed_ppm} ÷ 1,000,000</dt>
                  <dd className="num">{ready ? petri(feed, 4) : "—"}</dd>
                </div>
                <div>
                  <dt>Released for {ready ? int(counted) : "—"} counted cells</dt>
                  <dd className="num">{ready ? petri(released, 4) : "—"}</dd>
                </div>
                <div>
                  <dt>To the keeper pot</dt>
                  <dd className="num">{ready ? petri(keeperCut, 4) : "—"}</dd>
                </div>
                <div>
                  <dt>Per counted cell</dt>
                  <dd className="num">{ready ? petri(perCell, 5) : "—"}</dd>
                </div>
                <div>
                  <dt>Keeper pot now / paid so far</dt>
                  <dd className="num">{st ? `${fmtPetri(st.keeper_pot, 2)} / ${fmtPetri(st.keeper_paid, 2)}` : "—"}</dd>
                </div>
              </dl>
            </article>
            <article className={s.paperCard}>
              <h3 className="h3">Selling back</h3>
              <p>
                <code className={s.codePaper}>sell(petri)</code> hands PETRI back to the agar for NEAR from the tide vault, at{" "}
                {r.sell_bps / 100}% of the curve&rsquo;s price, and never more than those units&rsquo; pro-rata share of the vault.
                Between two tides the agar buys back at most {r.sell_cap_bps / 100}% of the vault, first come first served, and
                nothing before the first tide. A round trip through the agar always loses. A colony that has not attached NEAR
                (a free-play guest) is paid for its PETRI in credit it can spend in the dish, never in NEAR. House colonies never
                sell: the vault is the players&rsquo;.
              </p>
              <pre className={s.formulaPaper}>
                {`NEAR = min(curve price × ${r.sell_bps / 100}%, vault × PETRI sold ÷ PETRI outside the agar)`}
              </pre>
              <dl className={s.sums}>
                <div>
                  <dt>The agar may still buy back, this tide</dt>
                  <dd className="num">{st ? `${near(Number(st.sell_left), 4)} NEAR` : "—"}</dd>
                </div>
                <div>
                  <dt>NEAR paid for PETRI so far</dt>
                  <dd className="num">{st ? `${near(Number(st.near_sold), 4)} NEAR` : "—"}</dd>
                </div>
              </dl>
            </article>
            <article className={s.paperCard}>
              <h3 className="h3">Claiming</h3>
              <p>
                Earnings do not land in a balance on their own. Each playing colony&rsquo;s feed adds up in one row of a table of
                the colonies that play now, so a catch-up reads and writes that table once and logs one summary line however
                many colonies are alive. A colony moves its earnings into its balance with{" "}
                <code className={s.codePaper}>claim</code>, which also sends the NEAR it has won at the tides, less what the
                claim&rsquo;s own <code className={s.codePaper}>Claim</code> entry costs; winnings too small to cover that and a
                possible refund stay owed until they grow. If the transfer of a claim, a sale, a sponsor&rsquo;s reclaim or a
                pending claim fails, a callback writes a <code className={s.codePaper}>Refund</code> entry and the NEAR becomes
                pending NEAR for the account, which <code className={s.codePaper}>claim_pending</code> collects; only a failed
                bounty goes back to the vault. Planting and minting a slide claim waiting PETRI first. Credit won at the tides needs no claim. The{" "}
                <code className={s.codePaper}>claimable</code> view shows what is waiting.
              </p>
            </article>
          </div>

          <div className={s.capGrid}>
            <div>
              <h3 className="h3">The reach: paid for {r.reach} living cells per cell of stake</h3>
              <p className={s.paperMuted}>
                A colony&rsquo;s claim on the feed, and so on the tides, is its living cells, but never more than {r.reach} cells
                for every cell of stake. Planting adds one cell of stake per cell planted, and every tide that runs keeps{" "}
                {r.stake_keep_bps / 100}% of each colony&rsquo;s stake, so holding ground means planting again now and then. The
                cap grows only with what the colony paid for, so splitting into many colonies never earns more: the capped weights
                of the parts add up to at most the capped weight of the whole, and a property test in petri-core checks it. A
                growing pattern can still cover ground; past its reach that ground earns nothing.
              </p>
              <pre className={s.formulaPaper}>
                {`paid cells = min(a colony's living cells, ${r.reach} × its stake)   (0 for the house)
  stake      = cells planted, × ${r.stake_keep_bps / 100}% at every tide that runs
  released = ration × min(all paid cells, ${int(r.live_floor)}) ÷ ${int(r.live_floor)}
  share = released × (1 − ${keeperPct}%) × paid cells ÷ all paid cells`}
              </pre>
              <ReachDemo reach={r.reach} />
            </div>
            <div>
              <h3 className="h3">The split on the live dish</h3>
              <p className={s.paperMuted}>
                {ready
                  ? `${int(total)} cells are alive at your browser's generation. ${capped === 0 ? "No colony is past its reach right now." : `${capped} ${capped === 1 ? "colony is" : "colonies are"} past their reach right now.`}`
                  : "Reading the dish."}
              </p>
              <details className={`${s.fold} ${s.foldPaper}`}>
                <summary>
                  This generation&rsquo;s feed by colony <small>{ready ? `${alive.length} alive` : "reading"}</small>
                </summary>
                <div className={s.foldBody}>
                  <div className={s.tableWrap} tabIndex={0} role="region" aria-label="This generation's feed by colony">
                    <table className={`${s.paperTable} ${s.splitTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">Colony</th>
                          <th scope="col">Living cells</th>
                          <th scope="col">Paid for</th>
                          <th scope="col">Share</th>
                          <th scope="col">PETRI a generation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((c) => (
                          <tr key={c.id} className={!c.house && c.live > c.w ? s.paperNow : undefined}>
                            <th scope="row">
                              <span className={s.who}>
                                <i className="swatch" style={{ background: hex(c.color) }} />
                                {c.name}
                                {c.house ? " (house)" : ""}
                                <BenchTag account={c.account} />
                              </span>
                            </th>
                            <td className="num">{int(c.live)}</td>
                            <td className="num">{int(c.w)}</td>
                            <td className="num">{wsum > 0 ? `${((100 * c.w) / wsum).toFixed(1)}%` : "—"}</td>
                            <td className="num">{wsum > 0 ? petri((toColonies * c.w) / wsum, 4) : "—"}</td>
                          </tr>
                        ))}
                        {rest.length > 0 && (
                          <tr>
                            <th scope="row">{rest.length} more</th>
                            <td className="num">{int(rest.reduce((a, c) => a + c.live, 0))}</td>
                            <td className="num">{int(restW)}</td>
                            <td className="num">{wsum > 0 ? `${((100 * restW) / wsum).toFixed(1)}%` : "—"}</td>
                            <td className="num">{wsum > 0 ? petri((toColonies * restW) / wsum, 4) : "—"}</td>
                          </tr>
                        )}
                        {ready && wsum === 0 && (
                          <tr>
                            <td colSpan={5}>No paid colony is alive, so nothing is fed and the agar keeps its PETRI.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className={s.paperNote}>
                    Highlighted rows are past their reach. Figures are this generation&rsquo;s feed at your browser&rsquo;s
                    generation, rounded for display; the contract rounds each share down to a millionth of a PETRI. &ldquo;Paid
                    for&rdquo; here counts every cell a colony planted; once tides have run, the contract&rsquo;s cap is lower by
                    the stake that decayed.
                  </p>
                </div>
              </details>

              <h3 className={`h3 ${s.spaced}`}>Nothing is created or lost</h3>
              <p className={s.paperMuted}>
                Every PETRI is in the agar, in an account, waiting to be claimed, in the keeper pot, or burned. The contract tests
                assert these identities after their scenarios; the first two are checked again here on the live counters.
              </p>
              <ul className={s.checks}>
                <li className={s.checkItem}>
                  <code className={s.codePaper}>total supply = minted − burned</code>
                  <span className={supplyOk === false ? s.bad : s.good}>{check(supplyOk)}</span>
                </li>
                <li className={s.checkItem}>
                  <code className={s.codePaper}>agar = minted − sold − fed + returned + bought back</code>
                  <span className={agarOk === false ? s.bad : s.good}>{check(agarOk)}</span>
                </li>
                <li className={s.checkItem}>
                  <code className={s.codePaper}>every balance + agar + unclaimed + keeper pot = total supply</code>
                  <span className={s.paperMuted}>Checked in the tests by summing every holder</span>
                </li>
              </ul>
            </div>
          </div>

          <div className={s.coinGrid}>
            <details className={`${s.fold} ${s.foldPaper}`}>
              <summary>
                The PETRI ledger, from the contract <small>11 counters</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  Read from the <code className={s.codePaper}>state</code> view of{" "}
                  <a className={s.linkPaper} href={net.contractUrl}>{net.contract}</a> at stored generation{" "}
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
            </details>
            <details className={`${s.fold} ${s.foldPaper}`}>
              <summary>
                Standard tokens <small>NEP-141, 145, 148; slides NEP-171, 177, 178, 181</small>
              </summary>
              <div className={s.foldBody}>
                <ul className={s.standards}>
                  <li>
                    <b>NEP-141.</b> <code className={s.codePaper}>ft_transfer</code>,{" "}
                    <code className={s.codePaper}>ft_transfer_call</code> (with refunds through{" "}
                    <code className={s.codePaper}>ft_resolve_transfer</code>), <code className={s.codePaper}>ft_balance_of</code> and{" "}
                    <code className={s.codePaper}>ft_total_supply</code>. Transfers attach exactly 1 yoctoNEAR. PETRI refunded to a
                    sender that has unregistered meanwhile is burned. House accounts (the strains and the keepers) can send PETRI
                    only to other house accounts. A colony that has not attached NEAR cannot send PETRI at all, and neither can
                    one holding kept PETRI (PETRI earned before its first NEAR, or bought with credit, until it has been planted).
                  </li>
                  <li>
                    <b>NEP-148.</b> Name Petri, symbol PETRI, 6 decimals and an inline icon.
                  </li>
                  <li>
                    <b>NEP-145.</b> A receiver must be registered before it can hold PETRI. Joining registers a colony; anyone else
                    calls <code className={s.codePaper}>storage_deposit</code>, which costs{" "}
                    <b className="num">{reg ? `${near(Number(reg), 5)} NEAR` : "the storage of one balance record"}</b>. A
                    slide&rsquo;s holder is registered by the planting that pays it its first royalty.{" "}
                    <code className={s.codePaper}>storage_unregister</code> with <code className={s.codePaper}>force</code> burns
                    the PETRI still held; a colony&rsquo;s account cannot unregister, forced or not.
                  </li>
                  <li>
                    <b>The dish does not play on itself.</b> The contract account cannot join, buy, sell, plant, claim, advance or
                    send PETRI, and a transfer to it is refused with &ldquo;PETRI goes back to the agar only by planting or
                    selling&rdquo;. Its <code className={s.codePaper}>ft_balance_of</code> is the agar plus unclaimed earnings,
                    the keeper pot and the PETRI held in escrow for pact offers.
                  </li>
                  <li>
                    <b>Specimen slides.</b> Each slide is an NFT in the same contract: NEP-171 transfers (with{" "}
                    <code className={s.codePaper}>nft_transfer_call</code>), NEP-177 metadata whose image is an SVG the contract
                    draws from the captured cells (at most 10 a call from the enumeration views), NEP-178 approvals and NEP-181
                    enumeration. A slide of 12 or more cells is also a pattern licence: see planting.
                  </li>
                  <li>
                    <b>Events.</b> NEP-141 <code className={s.codePaper}>ft_mint</code> once at launch,{" "}
                    <code className={s.codePaper}>ft_transfer</code> for purchases, sales, claims, keeper pots, planting returns,
                    slide royalties, transfers and their refunds, <code className={s.codePaper}>ft_burn</code> for planting, slides,
                    forced unregistrations and refunds to unregistered senders; NEP-171{" "}
                    <code className={s.codePaper}>nft_mint</code> and <code className={s.codePaper}>nft_transfer</code>; and the
                    dish&rsquo;s own <code className={s.codePaper}>sponsor</code>, <code className={s.codePaper}>unsponsor</code>,{" "}
                    <code className={s.codePaper}>join</code>, <code className={s.codePaper}>rename</code>,{" "}
                    <code className={s.codePaper}>plant</code>, <code className={s.codePaper}>sell</code>,{" "}
                    <code className={s.codePaper}>claim</code>, <code className={s.codePaper}>payout</code>,{" "}
                    <code className={s.codePaper}>payout_failed</code>, <code className={s.codePaper}>slide</code>,{" "}
                    <code className={s.codePaper}>pact</code>, <code className={s.codePaper}>intents</code>,{" "}
                    <code className={s.codePaper}>claim_pending</code>,{" "}
                    <code className={s.codePaper}>skip</code>, <code className={s.codePaper}>relaunch</code> and one{" "}
                    <code className={s.codePaper}>generation</code> summary per catch-up.
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </PhoneFold>
      </div>
    </section>
  );
}
