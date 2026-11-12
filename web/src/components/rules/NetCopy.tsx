"use client";
// The few lines of the rules that depend on which dish the page reads.

import { useNet } from "@/lib/use-net";
import s from "./rules.module.css";

export function NetLimitTitle() {
  return <>It runs on {useNet().network}</>;
}

export function NetLimitBody() {
  const net = useNet();
  return net.freePlay ? (
    <>
      This dish lives on NEAR testnet and runs the same contract and rules as mainnet, free to play. Guests play with credit
      the site sponsors, which they can spend in the dish but never withdraw, so free play never reaches NEAR.
    </>
  ) : (
    <>
      This dish lives on NEAR mainnet, with real NEAR and real PETRI, under the same contract that runs free play on testnet.
    </>
  );
}

export function ContractLink() {
  const net = useNet();
  return <a className={s.link} href={net.contractUrl}>{net.contract}</a>;
}

export function CtaLine() {
  return useNet().freePlay ? (
    <>Start a colony as a guest or with your own NEAR wallet, and put your first pattern on the dish. The rules above are the only ones there are.</>
  ) : (
    <>Start a colony with your NEAR wallet, or pay with any token through NEAR Intents, and put your first pattern on the dish. The rules above are the only ones there are.</>
  );
}
