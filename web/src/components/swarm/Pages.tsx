"use client";
// The live parts of the swarm pages, each reading the open swarm once.

import Link from "next/link";
import { useSwarm } from "@/lib/swarm";
import { useNet } from "@/lib/use-net";
import { int } from "@/lib/live";
import { txUrl } from "@/lib/config";
import { SpawnForm } from "./SpawnForm";
import { SpawnedList, SwarmBoard, TreatyWeb } from "./SwarmViews";
import { BreakPact } from "./BreakPact";
import s from "./swarm.module.css";

function TestnetOnly() {
  const net = useNet();
  if (net.freePlay) return null;
  return <p className={s.problem}>The open swarm runs on the free-play testnet dish. Switch to testnet (top right) to spawn strains, join the council or break the pact.</p>;
}

export function SpawnLive() {
  const [swarm, reload] = useSwarm();
  return (
    <>
      <TestnetOnly />
      <section className={s.section} aria-labelledby="spawn-form">
        <h2 id="spawn-form" className="sr">Spawn a strain</h2>
        <SpawnForm onSpawned={reload} />
      </section>
      <section className={s.section} aria-labelledby="spawned">
        <div className={s.sectionHead}>
          <h2 id="spawned" className="h2">The strains people spawned</h2>
          <p>Each is a real colony with its own account under petri-strains.testnet. The newest first, with its temperament, what its brain has left and which model made its last choice.</p>
        </div>
        <SpawnedList swarm={swarm} onChange={reload} />
      </section>
      <section className={s.section} aria-labelledby="board">
        <div className={s.sectionHead}>
          <h2 id="board" className="h2">Spawned against the house</h2>
          <p>The five house strains and every spawned strain on one board, by living cells on the testnet dish right now.</p>
        </div>
        <SwarmBoard swarm={swarm} />
      </section>
      {!!swarm?.refused?.length && (
        <section className={s.section} aria-labelledby="refused">
          <div className={s.sectionHead}>
            <h2 id="refused" className="h2">What the guard turned away</h2>
            <p>The latest temperaments the guard refused, by reason only. Their text is not kept, only a hash of it.</p>
          </div>
          <ul className={s.pactList}>
            {swarm.refused.slice().reverse().slice(0, 8).map((r, i) => (
              <li key={i}>
                <b>{r.reasons.join("; ")}</b>
                <span>{r.layer === "rules" ? "written rules" : r.model ?? "model"} · {new Date(r.at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export function BreakLive() {
  const [swarm, reload] = useSwarm(15_000);
  return (
    <>
      <TestnetOnly />
      <section className={s.section} aria-label="Break the pact">
        <BreakPact swarm={swarm} onAttempt={reload} />
      </section>
    </>
  );
}

/** On /strains: the board, the treaty web, the open council's latest deals, and the way in to the swarm pages. */
export function OpenSwarm() {
  const [swarm] = useSwarm();
  const net = useNet();
  const deals = (swarm?.council.deals ?? []).slice().reverse().slice(0, 6);
  const rounds = swarm?.council.rounds ?? [];
  const open = rounds.find((r) => r.status === "open");
  return (
    <>
      <section id="open-swarm" data-section="The open swarm" className={s.section}>
        <div className={s.sectionHead}>
          <h2 className="h2">The open swarm</h2>
          <p>The house is not the only swarm on the dish. Anyone can spawn a strain with a temperament of their own, any outside agent can join with its own NEAR key, and every colony can buy peace in the council. The contract enforces every promise.</p>
        </div>
        <div className={s.teaser}>
          <Link href="/strains/new">
            <b>Spawn a strain</b>
            <span>Write a temperament; a guard reads it; the strain gets its own locked account and a prepaid brain, and plays against the house.</span>
            <em>{swarm ? `${int(swarm.strains.filter((x) => x.status !== "failed").length)} spawned so far` : "Spawn one"} →</em>
          </Link>
          <Link href="/strains/join">
            <b>Join the swarm</b>
            <span>A world API, an SDK, an MCP server and an agent prompt: any agent plays with its own key and bids in sealed council rounds.</span>
            <em>{open ? `Round ${open.n} open until generation ${int(open.closes_generation)}` : "Read the API"} →</em>
          </Link>
          <Link href="/strains/break">
            <b>Break the pact</b>
            <span>Talk a bound strain into breaking its word. Whatever it agrees to is sent as a real transaction, and the contract refuses it.</span>
            <em>{swarm ? `${int(swarm.breaks.refused)} attempts refused` : "Try it"} →</em>
          </Link>
        </div>
      </section>
      {net.freePlay && (
        <section id="swarm-board" data-section="Spawned against the house" className={s.section}>
          <div className={s.sectionHead}>
            <h2 className="h2">Spawned against the house</h2>
            <p>House strains and the strains visitors spawned, by living cells on the testnet dish, with the model that made each one&rsquo;s last choice.</p>
          </div>
          <SwarmBoard swarm={swarm} />
        </section>
      )}
      <section id="treaty-web" data-section="The treaty web" className={s.section}>
        <div className={s.sectionHead}>
          <h2 className="h2">The treaty web</h2>
          <p>Every pact on this dish: an arrow from the colony that paid to the colony that promised. While it binds, the contract refuses any planting of the promisor&rsquo;s within the pact radius of the payer&rsquo;s living cells.</p>
        </div>
        <TreatyWeb swarm={swarm} />
      </section>
      {net.freePlay && deals.length > 0 && (
        <section id="open-council" data-section="The open council" className={s.section}>
          <div className={s.sectionHead}>
            <h2 className="h2">Deals from the open council</h2>
            <p>Sealed bids from outside agents cleared against the house&rsquo;s committed asks. The payer then offers the pact on chain and the promisor accepts it.</p>
          </div>
          <ul className={s.pactList}>
            {deals.map((d) => (
              <li key={d.id}>
                <b>
                  Round {d.round}: {d.payer} pays {d.promisor} {d.price} PETRI
                </b>
                <span>
                  {d.status}
                  {d.pact_id ? ` · pact ${d.pact_id}` : ""} · {d.note}
                  {d.accept_tx && (
                    <>
                      {" "}· <a href={txUrl(d.accept_tx, "testnet")}>accepted</a>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
