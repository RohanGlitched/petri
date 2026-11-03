"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive, petri, int, near } from "@/lib/live";
import s from "./bands.module.css";

function useMotion() {
  const [motion, setMotion] = useState(false);
  useEffect(() => setMotion(!window.matchMedia("(prefers-reduced-motion: reduce)").matches), []);
  return motion;
}

function Dots({ path, n, dur, color, r = 4, on }: { path: string; n: number; dur: number; color: string; r?: number; on: boolean }) {
  if (!on) return null;
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <circle key={i} r={r} fill={color}>
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" begin={`${(i * dur) / n}s`}>
            <mpath href={`#${path}`} />
          </animateMotion>
        </circle>
      ))}
    </>
  );
}

/** The PETRI loop: bought from the agar, fed to the living, spent on planting, half back and half burned. */
function Cycle({ agar, fed, back, burned, sold, perGen }: { agar: string; fed: string; back: string; burned: string; sold: string; perGen: string }) {
  const on = useMotion();
  return (
    <svg className={s.cycle} viewBox="0 0 640 420" role="img" aria-label="The PETRI cycle: the agar sells PETRI for NEAR and feeds living cells; planting pays half back to the agar and burns half.">
      <defs>
        <radialGradient id="cy-agar" cx="40%" cy="35%" r="75%">
          <stop offset="0" stopColor="#ffd796" />
          <stop offset="0.55" stopColor="#e29a3a" />
          <stop offset="1" stopColor="#9c5a14" />
        </radialGradient>
        <radialGradient id="cy-cell" cx="35%" cy="30%" r="80%">
          <stop offset="0" stopColor="#ffb7a3" />
          <stop offset="0.4" stopColor="#c8431f" />
          <stop offset="1" stopColor="#7c2310" />
        </radialGradient>
        <marker id="cy-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#6f5c47" />
        </marker>
      </defs>
      <path id="cy-buy" d="M40 66 C 70 80, 90 98, 104 114" fill="none" stroke="#7fb5a6" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-feed" d="M222 150 C 300 80, 380 80, 448 132" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-spend" d="M500 206 L 500 278" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-back" d="M446 334 C 360 376, 260 346, 208 282" fill="none" stroke="#b8a58e" strokeWidth="2" markerEnd="url(#cy-arrow)" />
      <path id="cy-burn" d="M556 334 C 590 356, 600 376, 600 392" fill="none" stroke="#b8a58e" strokeWidth="2" strokeDasharray="4 5" />
      <Dots path="cy-buy" n={2} dur={2.4} color="#1e8c6e" r={3.5} on={on} />
      <Dots path="cy-feed" n={4} dur={3.2} color="#e29a3a" on={on} />
      <Dots path="cy-spend" n={2} dur={1.6} color="#c8431f" r={3.5} on={on} />
      <Dots path="cy-back" n={3} dur={3.4} color="#e29a3a" r={3.5} on={on} />
      <Dots path="cy-burn" n={2} dur={2.2} color="#4e3d2c" r={3} on={on} />

      <text x="20" y="28" className={s.cyLabel}>NEAR in</text>
      <text x="20" y="46" className={s.cySmall}>sold so far: {sold}</text>

      <circle cx="150" cy="210" r="104" fill="url(#cy-agar)" />
      <circle cx="150" cy="210" r="104" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth="2" />
      <text x="150" y="192" textAnchor="middle" className={s.cyBig}>The agar</text>
      <text x="150" y="224" textAnchor="middle" className={s.cyNum}>{agar}</text>
      <text x="150" y="246" textAnchor="middle" className={s.cySmall}>PETRI left</text>

      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <circle key={i} cx={470 + (i % 4) * 20 + (i > 3 ? 10 : 0)} cy={146 + Math.floor(i / 4) * 20} r="9" fill="url(#cy-cell)" />
      ))}
      <text x="530" y="112" textAnchor="middle" className={s.cyLabel}>Living cells</text>
      <text x="500" y="204" textAnchor="middle" className={s.cySmall}>{perGen} PETRI a cell, a generation</text>

      <rect x="430" y="282" width="140" height="56" rx="28" fill="#1d1208" />
      <text x="500" y="316" textAnchor="middle" className={s.cyBtn}>Planting</text>

      <text x="320" y="72" textAnchor="middle" className={s.cySmall}>fed so far: {fed}</text>
      <text x="320" y="392" textAnchor="middle" className={s.cySmall}>half back to the agar: {back}</text>
      <text x="610" y="412" textAnchor="end" className={s.cySmall}>half burned: {burned}</text>
    </svg>
  );
}

/** Price of one cell against living cells, at today's agar: flat until the floor count, then it falls. */
function PriceCurve({ live, agar, feedPpm, keeperBps, liveFloor, payback, minPrice }: { live: number; agar: number; feedPpm: number; keeperBps: number; liveFloor: number; payback: number; minPrice: number }) {
  const W = 520;
  const H = 180;
  const maxLive = Math.max(4000, Math.ceil((live * 1.6) / 500) * 500);
  const price = (l: number) => Math.max(minPrice, ((agar * feedPpm) / 1e6) * (1 - keeperBps / 1e4) / Math.max(l, liveFloor) * payback) / 1e6;
  const maxP = price(0);
  const x = (l: number) => 40 + (l / maxLive) * (W - 60);
  const y = (p: number) => H - 30 - (p / maxP) * (H - 50);
  const pts = Array.from({ length: 81 }, (_, i) => (i / 80) * maxLive);
  const d = pts.map((l, i) => `${i ? "L" : "M"}${x(l).toFixed(1)} ${y(price(l)).toFixed(1)}`).join(" ");
  const px = x(Math.min(live, maxLive));
  const py = y(price(live));
  return (
    <svg className={s.curve} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price of a cell against living cells. Now ${price(live).toFixed(2)} PETRI at ${live} living cells.`}>
      <line x1="40" y1={H - 30} x2={W - 20} y2={H - 30} stroke="#cdbba3" />
      <line x1="40" y1="16" x2="40" y2={H - 30} stroke="#cdbba3" />
      <path d={d} stroke="#9c5a14" strokeWidth="2.5" fill="none" />
      <line x1={px} y1={py} x2={px} y2={H - 30} stroke="#9c5a14" strokeDasharray="3 4" />
      <circle cx={px} cy={py} r="6" fill="#c8431f" stroke="#fff" strokeWidth="2" />
      <text x={px + 10} y={py - 10} className={s.cySmall}>now {price(live).toFixed(2)}</text>
      <text x="40" y={H - 10} className={s.cyTick}>0 cells</text>
      <text x={W - 20} y={H - 10} textAnchor="end" className={s.cyTick}>{int(maxLive)} counted cells</text>
      <text x={W - 20} y="26" textAnchor="end" className={s.cyTick}>top of the scale: {maxP.toFixed(1)} PETRI a cell</text>
    </svg>
  );
}

export function CoinBand() {
  const { d, rules, ready, perCell, supply, cellPrice, petriPrice, vault, tideIn } = useLive();
  const st = d.state;
  const v = (k: "agar" | "sold" | "fed" | "returned" | "burned" | "near_tides" | "near_in" | "tides" | "keeper_pot" | "keeper_paid" | "bought_back") => (st ? Number(st[k]) : 0);
  const max = rules ? Number(rules.max_supply) : 1e12;
  const rows: [string, string, string][] = [
    ["Created, once, at launch", petri(max), "No mint function exists after this."],
    ["Still in the agar", petri(v("agar")), "Sold for NEAR and fed to the living, a sliver at a time."],
    ["Sold from the agar for NEAR", petri(v("sold")), "Every colony buys in. The price rises as the agar empties."],
    ["Fed to the living so far", petri(v("fed")), `${rules ? rules.feed_ppm : 10} parts per million of the agar, every generation.`],
    ["Paid back by planting", petri(v("returned")), "Half of every planting returns to the agar."],
    ["Bought back by the agar", petri(v("bought_back")), "Sold back for NEAR at half the curve's price."],
    ["Burned for good", petri(v("burned")), `The other half. PETRI in existence: ${petri(supply)}.`],
  ];
  const tideMinutes = rules ? Math.ceil((tideIn * Number(rules.generation_ms)) / 60_000) : 0;
  return (
    <section id="coin" className="band band-paper" aria-labelledby="coin-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="coin-title" className="h2">The coin is the nutrient</h2>
          <p className="lede">
            All {rules ? petri(max) : "1,000,000"} PETRI were made once and put in the agar. Nobody can mint more. You buy PETRI
            from the agar with NEAR, at a price that rises as it empties. Living cells are fed from the agar every generation;
            planting feeds it back and burns as much again. And the NEAR you pay does not go to anyone running the dish: it
            collects in the tide vault and is paid out every hour to whoever holds ground.
          </p>
        </div>
        <div className={s.coinGrid}>
          <div className={s.coinFig}>
            <Cycle
              agar={st ? petri(v("agar")) : "—"}
              fed={st ? petri(v("fed")) : "—"}
              back={st ? petri(v("returned")) : "—"}
              burned={st ? petri(v("burned")) : "—"}
              sold={st ? petri(v("sold")) : "—"}
              perGen={ready ? petri(perCell, 4) : "—"}
            />
          </div>
          <dl className={s.ledger}>
            {rows.map(([k, val, note]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="num">{st ? val : "—"}</dd>
                <p>{note}</p>
              </div>
            ))}
          </dl>
        </div>

        <div className={s.tides}>
          <div>
            <h3 className="h3">The tide pays NEAR to whoever holds ground</h3>
            <p className="muted">
              Every NEAR that comes in, from buying PETRI and from the small fee on each planting, waits in the tide vault
              (minus the storage it pays for). Every {rules ? rules.tide_every : 240} generations, about an hour, a tenth of the
              vault is paid out to colonies in proportion to the PETRI each earned since the last tide, so arriving just before
              a tide wins almost nothing. The dish&rsquo;s own AI strains are never fed and take no share: they buy every PETRI
              they plant with, and that NEAR goes to you. Between tides the agar also buys PETRI back at half the curve&rsquo;s
              price, never more than that PETRI&rsquo;s share of the vault, so what you earn can always be turned into NEAR.
              You claim it whenever you like.
            </p>
          </div>
          <dl className={s.tideNums} aria-live="polite">
            <div><dt>In the vault now</dt><dd className="num">{st ? near(vault, 4) : "—"} <small>NEAR</small></dd></div>
            <div><dt>Next tide</dt><dd className="num">{ready ? `${int(tideIn)} gens` : "—"}</dd><p>about {tideMinutes} minutes</p></div>
            <div><dt>Paid at {st ? `${int(v("tides"))} ${v("tides") === 1 ? "tide" : "tides"}` : "tides"} so far</dt><dd className="num">{st ? near(v("near_tides"), 4) : "—"} <small>NEAR</small></dd></div>
            <div><dt>One PETRI from the agar</dt><dd className="num">{ready ? near(petriPrice, 6) : "—"} <small>NEAR</small></dd></div>
            <div><dt>The agar buys back, until the next tide</dt><dd className="num">{st ? near(Number(st.sell_left), 4) : "—"} <small>NEAR</small></dd><p>at half the curve&rsquo;s price</p></div>
          </dl>
        </div>

        <div className={s.priceRow}>
          <div>
            <h3 className="h3">A cell costs what it earns in two hours</h3>
            <p className="muted">
              The price of planting follows the feed: one cell costs what an average living cell earns in{" "}
              {rules ? int(rules.payback) : "480"} generations at today&rsquo;s rate (counting at least{" "}
              {rules ? int(rules.live_floor) : "1,000"} cells, never under {rules ? petri(Number(rules.min_cell_price), 1) : "0.5"}{" "}
              PETRI). Right now a cell costs <b className="num">{ready ? petri(cellPrice, 2) : "—"} PETRI</b> and earns{" "}
              <b className="num">{ready ? petri(perCell, 4) : "—"}</b> a generation. So planting only pays if your cells live
              longer than two hours, and the dish decides that, not the price.
            </p>
            <Link className="btn btn-ink btn-small" href="/rules#coin">Read the full economics</Link>
          </div>
          {rules && ready && (
            <PriceCurve
              live={d.counted}
              agar={d.agar}
              feedPpm={rules.feed_ppm}
              keeperBps={rules.keeper_bps}
              liveFloor={rules.live_floor}
              payback={rules.payback}
              minPrice={Number(rules.min_cell_price)}
            />
          )}
        </div>
      </div>
    </section>
  );
}
