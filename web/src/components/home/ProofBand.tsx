"use client";

import Link from "next/link";
import { useLive, int } from "@/lib/live";
import { REPO } from "@/lib/config";
import { TESTS } from "@/lib/facts";
import { useNet } from "@/lib/use-net";
import s from "./bands.module.css";
import { ReadMore, PhoneMore } from "@/components/site/ReadMore";

const PARTS = [
  {
    name: "The contract",
    where: "contract",
    text: "Rust on NEAR. Stores the board compactly, runs Life 64 cells at a time, sells and buys back PETRI, feeds the living, takes plantings, burns, pays the tides and mints specimen slides, and writes all of it to one ledger. Every call first catches the dish up to the clock and stops at 180 TGas, so no backlog can break it.",
  },
  {
    name: "The engine in your browser",
    where: "petri-core → WebAssembly",
    text: "The very same crate, compiled for the browser. It draws the dish ahead of the chain, checks a planting before you sign, and replays history to verify it.",
  },
  {
    name: "Gasless guests, on free play",
    where: "NEP-366 meta transactions, testnet",
    text: "On the testnet dish no wallet is needed. Your browser's key is a function-call key for the dish alone; it signs delegate actions, the relayer pays the gas, and the NEAR you play with is credit the relayer sponsored inside the contract. On mainnet there are no guests: connect any NEAR wallet with NEAR Connect.",
  },
  {
    name: "Pay with any token",
    where: "NEAR Intents, mainnet",
    text: "On the mainnet dish you can join or buy with USDC (on Base, Solana or Arbitrum), ETH on Base, SOL or BTC. NEAR Intents swaps the deposit into wNEAR and sends it to the contract with a message naming your account; the contract unwraps it and joins or buys for you. It never refunds: whatever it cannot use at once waits as pending NEAR with your order, which anyone can complete later, or your account can claim back.",
  },
  {
    name: "The keeper and the strains",
    where: "Claude Haiku and NEAR AI Cloud",
    text: "A keeper advances the clock when nobody else does. Five strains forecast every candidate move on a copy of the dish, remember what their moves did, and ask a language model to choose; once a tide window they negotiate pacts, PETRI for a promise not to plant near, which the contract holds them to, and remember who kept faith. Petri Dish is integrated with both Claude Haiku, within a fixed budget, and NEAR AI Cloud, whose answers come back signed by its enclave; when no model answers they play by written rules, and every move says which.",
  },
];

export function ProofBand() {
  const { d, ready } = useLive();
  const net = useNet();
  return (
    <section id="proof" data-section="Replay it yourself" className="band" aria-labelledby="proof-title">
      <div className="wrap">
        <div className={s.proof}>
          <div>
            <h2 id="proof-title" className="h2">Don&rsquo;t trust this page. Replay it.</h2>
            <ReadMore lines={4}>
              <p className="lede">
                Every sixteenth generation the contract folds the board into a history chain. Your browser can download the whole
                ledger since generation zero, replay all of it with the same rules, and arrive at the same chain, the same PETRI
                and the same NEAR the contract holds. If one cell were out of place, the hashes would differ.
              </p>
            </ReadMore>
            <div className={s.chainCard}>
              <span className="muted small">At generation {ready ? int(d.generation) : "—"} the chain reads</span>
              <code>{d.chain || "reading the dish…"}</code>
            </div>
            <p style={{ marginTop: 24 }}>
              <Link className="btn btn-amber" href="/verify">Replay from genesis</Link>
            </p>
          </div>
          <PhoneMore label="The five parts, and where each one lives">
          <ul className={s.parts}>
            {PARTS.map((p) => (
              <li key={p.name}>
                <h3 className="h3">{p.name}</h3>
                <span className={s.where}>{p.where === "contract" ? <><a href={net.contractUrl}>{net.contract}</a> on {net.label.chain}</> : p.where}</span>
                <p className="muted">{p.text}</p>
              </li>
            ))}
            <li>
              <h3 className="h3">All of it is open</h3>
              <span className={s.where}><a href={REPO}>{REPO.replace("https://", "")}</a></span>
              <p className="muted">Contract, engine, simulator, agents and this site. {TESTS.total} tests ({TESTS.contract} for the contract, {TESTS.core} for the engine), including property tests against a plain Life implementation, an exact replay of the ledger, and conservation of every PETRI and every yoctoNEAR.</p>
            </li>
          </ul>
          </PhoneMore>
        </div>
      </div>
    </section>
  );
}

export function CtaBand() {
  const net = useNet();
  return (
    <section id="start" data-section="Plant a colony" className="band" aria-labelledby="cta-title">
      <div className="wrap">
        <div className={s.cta}>
          <h2 id="cta-title" className="h2">Stake a few cents of NEAR, plant a colony, hold your ground.</h2>
          <p className="lede">
            {net.freePlay
              ? "On the free-play dish the site gives you a guest account and testnet credit to start: name it, pick a colour, plant something. No wallet, no gas, about thirty seconds."
              : "On the mainnet dish the NEAR is real: connect a NEAR wallet and stake 0.02 NEAR, or pay with USDC, ETH, SOL or BTC through NEAR Intents."}
          </p>
          <Link className="btn btn-amber" href="/dish">Start a colony</Link>
        </div>
      </div>
    </section>
  );
}
