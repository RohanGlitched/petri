"use client";

import Link from "next/link";
import { useLive, int } from "@/lib/live";
import { CONTRACT, REPO, accountUrl } from "@/lib/config";
import s from "./bands.module.css";

const PARTS = [
  {
    name: "The contract",
    where: CONTRACT,
    text: "Rust on NEAR. Holds the board as bit rows, runs Life 64 cells at a time, pays the agar out, takes plantings, burns. A planting that also catches the dish up three generations burns about 4.4 TGas.",
  },
  {
    name: "The engine in your browser",
    where: "petri-core → WebAssembly",
    text: "The very same crate, compiled for the browser. It draws the dish ahead of the chain, checks a planting before you sign, and replays history to verify it.",
  },
  {
    name: "Gasless guests",
    where: "NEP-366 meta transactions",
    text: "No wallet needed to play. Your browser makes a key and signs a delegate action; a relayer that only forwards calls to the dish pays the gas.",
  },
  {
    name: "The keeper and the strains",
    where: "NEAR AI Cloud, in a TEE",
    text: "A keeper advances the clock when nobody else does. Five strains choose their moves with a model whose answers come back signed by the enclave.",
  },
];

export function ProofBand() {
  const { d, ready } = useLive();
  return (
    <section className="band band-2" aria-labelledby="proof-title">
      <div className="wrap">
        <div className={s.proof}>
          <div>
            <h2 id="proof-title" className="h2">Don&rsquo;t trust this page. Replay it.</h2>
            <p className="lede">
              Every sixteenth generation the contract folds the board into a history chain. Your browser can download every
              planting since generation zero, replay all of it with the same rules, and arrive at the same chain the contract
              holds. If one cell were out of place, the hashes would differ.
            </p>
            <div className={s.chainCard}>
              <span className="muted small">At generation {ready ? int(d.generation) : "—"} the chain reads</span>
              <code>{d.chain || "reading the dish…"}</code>
            </div>
            <p style={{ marginTop: 24 }}>
              <Link className="btn btn-amber" href="/verify">Replay from genesis</Link>
            </p>
          </div>
          <ul className={s.parts}>
            {PARTS.map((p) => (
              <li key={p.name}>
                <h3 className="h3">{p.name}</h3>
                <span className={s.where}>{p.where === CONTRACT ? <a href={accountUrl(CONTRACT)}>{CONTRACT}</a> : p.where}</span>
                <p className="muted">{p.text}</p>
              </li>
            ))}
            <li>
              <h3 className="h3">All of it is open</h3>
              <span className={s.where}><a href={REPO}>{REPO.replace("https://", "")}</a></span>
              <p className="muted">Contract, engine, simulator, agents and this site. 40 tests, including property tests against a plain Life implementation, an exact replay of the ledger, and conservation of every PETRI.</p>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  const { rules } = useLive();
  return (
    <section className="band" aria-labelledby="cta-title">
      <div className="wrap">
        <div className={s.cta}>
          <h2 id="cta-title" className="h2">Stake a few cents of NEAR, plant a colony, hold your ground.</h2>
          <p className="lede">
            On testnet the site gives you a guest account with the NEAR to start: name it, pick a stain, plant something. No
            wallet, no gas, about thirty seconds.{rules ? "" : ""}
          </p>
          <Link className="btn btn-amber" href="/dish">Start a colony</Link>
        </div>
      </div>
    </section>
  );
}
