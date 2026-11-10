"use client";

import { useEffect, useState } from "react";
import { getAllTideWinnings } from "@/lib/chain";
import { useLive, int, near } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { Term } from "./Term";

/** Colonies the tides have paid so far: NEAR won (claimed or not) or credit won. Read once a minute. */
function useTideWinners(colonies: { id: number; near_claimed: string; credit_won: string }[], count: number) {
  const [won, setWon] = useState<string[] | null>(null);
  useEffect(() => {
    if (!count) return;
    let live = true;
    const load = () =>
      getAllTideWinnings(count)
        .then((w) => live && setWon(w))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [count]);
  if (!won) return null;
  return colonies.filter((c) => Number(won[c.id - 1] ?? 0) > 0 || Number(c.near_claimed) > 0 || Number(c.credit_won) > 0).length;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

/**
 * The next tide, counting down, with what it will share out and what the tides have paid so far, all read live from
 * the contract. `variant="dish"` is the compact card in the play page's right column.
 */
export function TideCard({ variant = "band", className = "" }: { variant?: "band" | "dish"; className?: string }) {
  const { d, rules, ready, vault, tideIn } = useLive();
  const net = useNet();
  const st = d.state;
  const winners = useTideWinners(d.colonies, st ? Number(st.colonies) : 0);
  // The clock ticks once a second between generations, so the countdown moves smoothly.
  const [, setNow] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!rules || !ready || !st) return <div className={`tide-card tide-${variant} is-loading ${className}`} aria-hidden="true" />;
  const genMs = Number(rules.generation_ms);
  const ms = Math.max(0, (tideIn - 1) * genMs + d.nextInMs);
  const share = (vault * rules.tide_bps) / 10_000;
  const tides = Number(st.tides);
  const paidNear = Number(st.near_tides);
  const paidCredit = Number(st.near_as_credit);
  const unit = net.freePlay && variant === "band" ? "testnet NEAR" : "NEAR";
  return (
    <section className={`tide-card tide-${variant} ${className}`} aria-label="The next tide">
      <div className="tide-clock">
        <span className="tide-k">
          Next <Term k="tide" place={variant === "dish" ? "below" : "above"} align="start">tide</Term> in
        </span>
        <b className="num" aria-live="off">{mmss(ms)}</b>
        <span className="tide-sub num">generation {int(d.generation + tideIn)}</span>
      </div>
      <dl className="tide-nums">
        <div>
          <dt>It shares out</dt>
          <dd className="num">
            {near(share, share >= 1e22 ? 3 : 4)} <small>{unit}</small>
          </dd>
          <p>{rules.tide_bps / 100}% of the vault, split by what each colony earned since the last tide</p>
        </div>
        <div>
          <dt>Paid so far</dt>
          <dd className="num">
            {near(paidNear + paidCredit, 3)} <small>{unit}</small>
          </dd>
          <p>
            {tides === 0
              ? "No tide has run yet"
              : `at ${int(tides)} ${tides === 1 ? "tide" : "tides"}${winners !== null ? `, to ${int(winners)} ${winners === 1 ? "colony" : "colonies"}` : ""}${paidCredit > 0 ? `; ${near(paidCredit, 3)} of it as credit to guests` : ""}`}
          </p>
        </div>
      </dl>
    </section>
  );
}
