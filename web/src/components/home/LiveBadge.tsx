"use client";

import { CONTRACTS, EXPLORERS, switchNetwork } from "@/lib/config";
import { useMainnetPulse } from "@/lib/mainnet-pulse";
import { useNet } from "@/lib/use-net";
import s from "./hero.module.css";

const int = (n: number) => n.toLocaleString("en-US");

const arrow = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** The first thing above the headline. It names the dish the numbers below are read from: on the free-play dish it says
 * so and offers the mainnet one; on mainnet, petri-dish.near is live, with its numbers read from the chain. */
export function LiveBadge() {
  const p = useMainnetPulse();
  const net = useNet();
  const ready = p.status === "ready";
  if (net.freePlay) {
    return (
      <p className={`${s.live} ${s.liveFree}`}>
        <i className="netdot" aria-hidden="true" />
        <span className={s.liveLead}>Free play on testnet</span>
        <span className={`${s.liveFact} ${s.liveMinor}`}>no wallet, nothing real spent</span>
        <a
          className={s.liveGo}
          href="/?net=mainnet"
          onClick={(e) => {
            e.preventDefault();
            switchNetwork("mainnet");
          }}
          title={ready ? `${CONTRACTS.mainnet}, generation ${int(p.generation)}` : CONTRACTS.mainnet}
        >
          Mainnet live
          {arrow}
        </a>
      </p>
    );
  }
  return (
    <p className={s.live}>
      <i className={`netdot netdot-mainnet${ready ? " netdot-live" : ""}`} aria-hidden="true" />
      <span className={s.liveLead}>Live on NEAR mainnet</span>
      <a className={s.liveAcct} href={`${EXPLORERS.mainnet}/address/${CONTRACTS.mainnet}`} title="The contract on NearBlocks">
        {CONTRACTS.mainnet}
      </a>
      {ready ? (
        <>
          <span className={`${s.liveFact} num`}>generation {int(p.generation)}</span>
          <span className={`${s.liveFact} ${s.liveMinor} num`}>
            {int(p.live)} living {p.live === 1 ? "cell" : "cells"}
          </span>
        </>
      ) : null}
      <a className={s.liveGo} href="/dish?net=mainnet">
        Open the mainnet dish
        {arrow}
      </a>
    </p>
  );
}
