"use client";

import { useNet } from "@/lib/use-net";

/** Which dish a block of live numbers comes from, so testnet numbers never pass for mainnet ones. */
export function NetTag({ short = false, className = "" }: { short?: boolean; className?: string }) {
  const net = useNet();
  const main = net.network === "mainnet";
  return (
    <span className={`nettag nettag-${net.network} ${className}`} title={`Numbers from ${net.contract} on NEAR ${main ? "mainnet" : "testnet"}`}>
      <i className={`netdot netdot-${net.network}`} aria-hidden="true" />
      {main ? "Mainnet" : "Testnet"}
      {short ? null : <span className="nettag-sub">{main ? " · real NEAR" : " · free play"}</span>}
    </span>
  );
}
