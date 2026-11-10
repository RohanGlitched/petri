"use client";

import Link from "next/link";
import { useLive } from "@/lib/live";
import { LAUNCH } from "./shared";
import s from "./loops.module.css";

/**
 * How a session of Petri Dish plays, at three time scales: the half-minute of choosing and planting, the few minutes of
 * watching it grow and collide, and the hour of tides, slides and pacts. Numbers come from the live rules.
 */
export function LoopsSection() {
  const { rules } = useLive();
  const r = rules ?? LAUNCH;
  const gen = Number(r.generation_ms) / 1000;
  const loops = [
    {
      when: "30 seconds",
      title: "Pick, forecast, plant",
      steps: [
        <>Pick a stamp from the dock: a still life to earn, an oscillator to shimmer, a glider to reach.</>,
        <>Point at the dish. The page checks the spot with the contract&rsquo;s own code and forecasts the next 240 generations on a copy of the dish: how long it lives, its cells at the next tide, when it pays back.</>,
        <>Plant. One transaction; the cells are alive on chain within a generation ({gen} s).</>,
      ],
      cta: { href: "/dish", label: "Plant a block now" },
    },
    {
      when: "5 minutes",
      title: "Watch, claim, replant, besiege",
      steps: [
        <>Watch it grow and collide: every {gen} s the whole dish steps once, for everyone at once. Births with parents of three different colonies are contested, and nothing grows.</>,
        <>Your living cells earn PETRI every generation, up to your reach. Planting claims it for you, or claim it yourself.</>,
        <>Replant where the forecast is good, or lay siege: inside a rival&rsquo;s buffer costs {r.siege_x} times the price, so a glider sent from farther away is the cheaper raid.</>,
      ],
      cta: { href: "/colonies", label: "See who is winning" },
    },
    {
      when: "An hour and more",
      title: "Tides, slides and pacts",
      steps: [
        <>Every {r.tide_every} generations, about an hour, the tide pays {r.tide_bps / 100}% of the NEAR vault to the colonies that earned since the last one (credit on free play).</>,
        <>Fossilize a patch of your colony into a specimen slide, an NFT the contract draws; a slide of 12 cells or more licenses its pattern and earns royalties.</>,
        <>Trade promises with the five AI strains: pacts escrow PETRI for a promise not to plant near you, and the contract enforces them.</>,
      ],
      cta: { href: "/strains", label: "Meet the strains" },
    },
  ];
  return (
    <section id="loops" data-section="The game, at three speeds" className={`band ${s.section}`} aria-labelledby="loops-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="loops-title" className="h2">The game, at three speeds</h2>
          <p className="lede">
            Half a minute to plant, a few minutes to see whether it was a good idea, an hour to be paid for it. Each loop feeds
            the next.
          </p>
        </div>
        <ol className={s.loops}>
          {loops.map((l, i) => (
            <li key={l.when} className={s.loop}>
              <p className={s.when}>
                <span className={s.ring} aria-hidden="true" style={{ "--k": (i + 1) / loops.length } as React.CSSProperties} />
                {l.when}
              </p>
              <h3 className="h3">{l.title}</h3>
              <ol className={s.steps}>
                {l.steps.map((st, k) => (
                  <li key={k}>{st}</li>
                ))}
              </ol>
              <Link className={s.cta} href={l.cta.href}>
                {l.cta.label} <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
