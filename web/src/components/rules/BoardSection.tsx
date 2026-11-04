"use client";

import { useState } from "react";
import { RuleDemo, type Seed } from "@/components/site/RuleDemo";
import { useLive, int } from "@/lib/live";
import { keeperOn } from "@/lib/strains";
import { accountUrl } from "@/lib/config";
import { useNet } from "@/lib/use-net";
import { LAUNCH, DEMO } from "./shared";
import s from "./rules.module.css";

// A glider and a light spaceship that cross the wrapped edges without meeting for the whole loop (checked with petri-core).
const WRAP: Seed[] = [
  { colony: 1, pattern: "glider", x: 6, y: 2, rotate: 1 },
  { colony: 2, pattern: "lwss", x: 20, y: 8 },
];
const WRAP_COLORS = { 1: DEMO.green, 2: DEMO.blue };

export function BoardSection() {
  const { d, rules, ready, secs } = useLive();
  const KEEPER = keeperOn(useNet().network);
  const r = rules ?? LAUNCH;
  const st = d.state;
  const [g, setG] = useState(0);
  const genS = Number(r.generation_ms) / 1000;
  const perDay = Math.round(86_400_000 / Number(r.generation_ms));
  const stats: [string, string][] = [
    ["Due by the clock", ready ? int(d.dueGeneration) : "—"],
    ["Stored on chain", st ? int(Number(st.generation)) : "—"],
    ["Your browser is ahead by", ready ? `${int(d.ahead)} gen` : "—"],
    ["Next generation in", ready ? `${secs} s` : "—"],
  ];
  return (
    <section id="board" className={`band ${s.section}`} aria-labelledby="board-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="board-title" className={s.h2}>A small world on a clock</h2>
          <p className="lede">
            The dish is {r.width} by {r.height} cells, {int(r.width * r.height)} in all, and it has no walls. A new generation is
            due every {genS} seconds, {int(perDay)} times a day, counted from the block in which the contract was created.
          </p>
        </div>

        <div className={s.split}>
          <figure className={s.figure}>
            <div className={s.dish} style={{ aspectRatio: "36 / 20" }}>
              <RuleDemo
                width={36}
                height={20}
                seeds={WRAP}
                loop={120}
                colors={WRAP_COLORS}
                stepMs={240}
                stillAt={30}
                label="A glider and a spaceship crossing the edges of a small wrapped dish"
                onGeneration={(gen) => setG(gen)}
              />
            </div>
            <figcaption className={s.caption}>
              <p>
                Nothing stops at the edge. The right side touches the left and the top touches the bottom, so this glider and
                light spaceship leave one side of a 36 by 20 dish and come back on the other. The big dish works the same way.
              </p>
              <p className={s.live}>
                <span className="num">Generation {g}</span>
              </p>
            </figcaption>
          </figure>

          <div className={s.prose}>
            <h3 className="h3">The contract only moves when asked</h3>
            <p>
              A NEAR contract cannot run on a timer. Petri&rsquo;s contract stores the board at the last generation someone
              advanced to. Every <code className={s.code}>join</code>, <code className={s.code}>buy</code>,{" "}
              <code className={s.code}>sell</code>, <code className={s.code}>plant</code>, <code className={s.code}>claim</code>,{" "}
              <code className={s.code}>mint_slide</code> and <code className={s.code}>advance</code> call first steps that board
              through the generations the clock says are due, up to {r.max_catchup} in one call, and stops early once the call
              has used 110 TGas (or its prepaid gas less 40) less what is still to be written, so no backlog can push a call
              past NEAR&rsquo;s gas limit; it always steps at least one. A planting is refused if the dish is
              still behind after that. If nobody touches the dish for more than {r.max_lag} generations, the next call skips the
              clock ahead to {r.max_catchup} behind instead of replaying the quiet stretch, and writes a{" "}
              <code className={s.code}>Skip</code> entry to the ledger.
            </p>
            <h3 className="h3">A keeper pot pays for the steps</h3>
            <p>
              Each generation sets {r.keeper_bps / 100}% of its feed aside in a keeper pot. Whoever&rsquo;s call catches the dish up
              (<code className={s.code}>advance</code>, or a join, purchase, sale, planting, claim or slide mint) takes the whole
              pot, but only if that call ran at least one generation and the account can hold PETRI (a colony, or an account registered with{" "}
              <code className={s.code}>storage_deposit</code>) and is not one of the house&rsquo;s (a house strain or a keeper):
              for those the pot keeps waiting. A call on a dish that is already current pays nothing. Whoever&rsquo;s call runs an hourly tide also gets a small bounty, in NEAR, or as credit to a colony
              that has never attached NEAR (see the tides); a house colony or a keeper gets none, and it stays in the vault. The
              project&rsquo;s keeper, <a href={accountUrl(KEEPER)} className={s.link}>{KEEPER}</a>, is listed in{" "}
              <code className={s.code}>rules.keepers</code>, so it takes neither the pot nor a bounty. On testnet it advances once
              the stored board is 20 generations behind, or when the pot holds more than 50 PETRI (which then waits for the next
              caller outside the house); on mainnet, only once someone outside the house plays, and only when
              the board is 400 generations behind, before the clock would skip. It also unwraps wNEAR that arrived with too little
              gas to unwrap. It has no powers anyone else lacks: any account may call <code className={s.code}>advance</code>.
            </p>
            <h3 className="h3">Your browser runs ahead</h3>
            <p>
              The site downloads the stored board, loads it into <code className={s.code}>petri-core</code>, the same Rust crate the
              contract runs, compiled to WebAssembly, and steps it to the generation that is due. That is the dish you see. It
              also works out the feed every colony is owed since the stored board. The contract adds it to each colony&rsquo;s
              unclaimed earnings the next time anyone advances the dish.
            </p>
            <dl className={s.stats}>
              {stats.map(([k, v]) => (
                <div key={k} className={s.stat}>
                  <dt>{k}</dt>
                  <dd className="num">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
        <p className={s.footnote}>
          The dish page runs the contract&rsquo;s own placement check, <code className={s.code}>check_plant</code>, on the board
          your browser holds before you sign, so it can show why a planting would be refused before you send it.
        </p>
      </div>
    </section>
  );
}
