"use client";
// The trade feed: the latest calls to each dish, from NearBlocks through /api/feed, each labelled by who made it.

import { useEffect, useState } from "react";
import { CONTRACTS, EXPLORERS, NETWORK, shortAccount, type Network } from "@/lib/config";
import { sideOf, strainOf } from "@/lib/strains";
import s from "./proof.module.css";

type Row = { hash: string; at: number; account: string; method: string; ok: boolean; relayed: boolean };

const KEEPERS = ["petri-keeper.testnet", "keeper.petri-dish.near"];
const RELAYER = "petri-guests.testnet";

function side(a: string): { label: string; cls: string } {
  if (KEEPERS.includes(a)) return { label: "house keeper", cls: s.sideHouse };
  if (a === RELAYER) return { label: "guest relayer", cls: s.sideHouse };
  if (a === CONTRACTS.mainnet || a === CONTRACTS.testnet) return { label: "the dish", cls: s.sideHouse };
  const k = sideOf(a);
  if (k === "house") return { label: "house strain", cls: s.sideHouse };
  if (k === "bench") return { label: "team bench", cls: s.sideBench };
  return { label: "outside player", cls: s.sidePlayer };
}

export function Feed() {
  const [net, setNet] = useState<Network>("testnet");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => setNet(NETWORK), []);
  useEffect(() => {
    let stop = false;
    setRows(null);
    setErr("");
    fetch(`/api/feed?net=${net}`)
      .then((r) => r.json())
      .then((b) => {
        if (stop) return;
        setRows(b.rows ?? []);
        if (b.error) setErr(b.error);
      })
      .catch((e) => !stop && setErr(String(e)));
    return () => {
      stop = true;
    };
  }, [net]);
  const outside = new Set((rows ?? []).filter((r) => side(r.account).label === "outside player").map((r) => r.account));
  return (
    <>
      <div className={s.filters} role="group" aria-label="Dish">
        {(["testnet", "mainnet"] as Network[]).map((n) => (
          <button key={n} className={net === n ? s.chipOn : s.chip} onClick={() => setNet(n)} aria-pressed={net === n}>
            {n === "mainnet" ? "Mainnet" : "Testnet"}
          </button>
        ))}
      </div>
      {rows && (
        <p className={s.note} style={{ marginTop: 0, marginBottom: 12 }}>
          {rows.length} latest calls on {CONTRACTS[net]}; <b>{outside.size}</b> distinct outside account{outside.size === 1 ? "" : "s"} among them.
        </p>
      )}
      <ol className={s.feed}>
        {(rows ?? []).slice(0, 30).map((r) => {
          const sd = side(r.account);
          const strain = strainOf(r.account);
          return (
            <li key={r.hash} className={s.feedRow}>
              <time dateTime={new Date(r.at).toISOString()}>{new Date(r.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} {new Date(r.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time>
              <span className={s.who}>
                <b>{r.method}</b> by {strain ? strain.name : shortAccount(r.account, 30)}
                {r.relayed ? <span className="muted"> (relayed, no wallet)</span> : null}
                {!r.ok ? <span style={{ color: "var(--bad)" }}> failed</span> : null}
              </span>
              <span className={`${s.side} ${sd.cls}`}>{sd.label}</span>
              <a href={`${EXPLORERS[net]}/txns/${r.hash}`}>tx</a>
            </li>
          );
        })}
        {rows === null && !err && <li className="muted">Reading NearBlocks…</li>}
        {rows?.length === 0 && <li className="muted">{err ? `NearBlocks did not answer (${err}).` : "No calls yet."}</li>}
      </ol>
    </>
  );
}
