"use client";
// The living slides on this dish, at the top of the slide box. A first visit that lands on a dish with no living slides
// (no factory there yet) moves to the one that has them; a visitor who chose a dish keeps it.

import Link from "next/link";
import { useEffect } from "react";
import { NET_STORE, networkInUrl, shortAccount, switchNetwork, type Network } from "@/lib/config";
import { FACTORIES, isLiving, purseOf } from "@/lib/living";
import { useNet } from "@/lib/use-net";
import { useAllSlides } from "./data";
import l from "./living.module.css";

function chosen(): boolean {
  if (networkInUrl()) return true;
  try {
    return !!localStorage.getItem(NET_STORE);
  } catch {
    return false;
  }
}

export function LivingStrip() {
  const net = useNet();
  const all = useAllSlides();
  const other: Network = net.network === "testnet" ? "mainnet" : "testnet";
  useEffect(() => {
    if (!FACTORIES[net.network] && FACTORIES[other] && !chosen()) switchNetwork(other);
  }, [net.network, other]);
  const living = all.data.filter((s) => isLiving(s.id, s.owner, net.network));

  return (
    <div id="living" aria-labelledby="living-title" style={{ margin: "48px 0 56px" }}>
      <h2 id="living-title" className="h2">Living slides</h2>
      <p className="lede">
        A slide sealed into an account of its own, with no key. The account owns the slide and collects its royalties, plays on the dish as a colony and keeps what
        it earns, and is itself a collectible: sell it and the account goes with it, everything inside.
      </p>
      {!FACTORIES[net.network] ? (
        <div className={l.banner}>
          <span>Living slides run on the testnet dish for now; the {net.label.chain} factory is not deployed.</span>
          <button className="btn btn-ghost btn-small" onClick={() => switchNetwork(other)}>See them on testnet</button>
        </div>
      ) : all.status === "loading" ? (
        <p className="muted">Reading the slide box…</p>
      ) : living.length === 0 ? (
        <p className="muted">No slide on this dish has been sealed yet. A slide&rsquo;s holder can seal it from the slide&rsquo;s page.</p>
      ) : (
        <div className={l.strip}>
          {living.map((s) => (
            <Link key={s.id} href={`/specimens/${encodeURIComponent(s.id)}#living`} className={l.stripCard}>
              {/* The token's own picture, drawn by the server from the stored board. */}
              <img src={`/api/living/${purseOf(s.id, net.network)}`} alt={`Living slide ${s.id}`} loading="lazy" />
              <span>
                <b>Living slide #{s.id}</b>
                <span>{s.title ?? s.name ?? "Untitled"}</span>
                <span>{shortAccount(purseOf(s.id, net.network)!, 32)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
