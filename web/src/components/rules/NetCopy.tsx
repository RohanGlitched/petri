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
      This dish lives on NEAR testnet. PETRI there is a real token on a real chain, but testnet NEAR and PETRI have no market, and
      guests play with credit the site sponsors. The same contract runs with real NEAR on mainnet.
    </>
  ) : (
    <>
      This dish lives on NEAR mainnet. The NEAR is real and so is PETRI, but nothing about the game guarantees PETRI a price. There
      are no guests here; free play runs the same contract on testnet.
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
