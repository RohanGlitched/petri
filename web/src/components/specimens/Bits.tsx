"use client";
// Small live pieces for the server-rendered specimen pages.

import { fmtPetri } from "@/lib/config";
import { useLive } from "@/lib/live";
import { slideRules } from "@/lib/slides";
import { useNet } from "@/lib/use-net";

/** The slide rules as the contract states them, or a plain description until they are read. */
export function SlideRules({ part }: { part: "min" | "price" }) {
  const { rules } = useLive();
  const r = slideRules(rules);
  if (part === "min") return <>{r.minCells !== null ? `It needs at least ${r.minCells} of them.` : "It needs a minimum number of them, set in the rules."}</>;
  return <>{r.cellPrice !== null ? `Each captured cell burns ${fmtPetri(r.cellPrice.toString(), 4)} PETRI, a price fixed in the rules.` : "Each captured cell burns a fixed amount of PETRI, set in the rules."}</>;
}

/** NearBlocks' page for the dish's tokens. */
export function CollectionLink() {
  const net = useNet();
  const base = net.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";
  return (
    <>
      NearBlocks lists every specimen on <a href={`${base}/nft-token/${net.contract}`}>{net.contract}</a>, with each token&rsquo;s owner and
      transfers.
    </>
  );
}
