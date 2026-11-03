"use client";

import { useNet } from "@/lib/use-net";

/** The contract this page reads, linked to the explorer, for server-rendered copy that must name the right dish. */
export function DishName({ chain = false, className }: { chain?: boolean; className?: string }) {
  const net = useNet();
  return (
    <>
      <a className={className} href={net.contractUrl}>{net.contract}</a>
      {chain ? ` on ${net.label.chain}` : null}
    </>
  );
}

/** Just the network's name ("testnet" or "mainnet"). */
export function NetName() {
  return <>{useNet().network}</>;
}
