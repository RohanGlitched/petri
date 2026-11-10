"use client";
// The mainnet start card's free-play offer, during judging: a colony with no wallet, on credit the site's mainnet
// relayer sponsors, and how many such colonies are left (some held for judges with a code). Before the window it counts
// down to the opening and offers testnet free play now; after, it says it closed. Nothing shows when the server has free
// mainnet play switched off.

import { useEffect, useState } from "react";
import { switchNetwork } from "@/lib/config";
import { useFreeMainnet, utcWhen } from "@/lib/free-mainnet";
import { setJudgeCode } from "@/lib/wallet";
import f from "./FreeMainnet.module.css";

/** "3 d 4 h", "5 h 12 min", "8 min". */
function until(ms: number): string {
  const m = Math.max(0, Math.ceil(ms / 60_000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return d > 0 ? `${d} d ${h} h` : h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
}

function useNow(every = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [every]);
  return now;
}

/** "N places left (M for judges with a code)". */
function placesText(left: number, judgeLeft: number): string {
  return `${left} ${left === 1 ? "place" : "places"} left${judgeLeft > 0 ? ` (${judgeLeft} for judges with a code)` : ""}`;
}

export function FreeMainnetOffer({ onFree, busy }: { onFree: () => void; busy: boolean }) {
  const st = useFreeMainnet();
  const now = useNow();
  const [code, setCode] = useState("");
  if (!st?.on) return null;
  const cap = st.cap ?? 40;
  const left = st.left ?? 0;
  const judgePlaces = st.judgePlaces ?? 0;
  const judgeLeft = st.judgeLeft ?? 0;
  const publicLeft = st.publicLeft ?? left;
  if (st.why === "soon") {
    return (
      <div className={f.offer}>
        <p className={f.eyebrow}>Free during judging</p>
        <p className={f.lead}>
          Free mainnet play opens in <b className="num">{st.opensAt ? until(st.opensAt - now) : "a few days"}</b>
          {st.opensAt ? `, ${utcWhen(st.opensAt)}` : ""}
          {st.closesAt ? `, until ${utcWhen(st.closesAt)}` : ""}.
        </p>
        <p className={f.fine}>
          {cap > 0 ? `Up to ${cap} colonies, as many as the relayer’s budget pays for${judgePlaces > 0 ? `, ${judgePlaces} of them held for judges with a code` : ""}` : "A few colonies"}, each on 0.05 NEAR of credit the site&rsquo;s relayer sponsors: credit you can play with, not withdraw.
        </p>
        <button type="button" className={`btn ${f.cta}`} onClick={() => switchNetwork("testnet")}>
          Try free play on testnet now
        </button>
      </div>
    );
  }
  if (st.why === "closed") {
    return (
      <div className={f.offer}>
        <p className={f.eyebrow}>Free mainnet play has closed</p>
        <p className={f.fine}>
          It ran during judging{st.made ? `: ${st.made} free colonies were started` : ""}. Those colonies stay on the dish.
        </p>
      </div>
    );
  }
  if (!st.open || left <= 0) {
    return (
      <div className={f.offer}>
        <p className={f.eyebrow}>Free mainnet play</p>
        <p className={f.fine}>
          {st.why === "spent" ? "Its budget is spent" : `All ${cap} free mainnet colonies are taken`}. The colonies it started stay on the dish, and free play on testnet is always open.
        </p>
      </div>
    );
  }
  const needCode = publicLeft <= 0;
  const go = () => {
    setJudgeCode(code);
    onFree();
  };
  return (
    <div className={f.offer}>
      <p className={f.eyebrow}>Free during judging</p>
      {judgePlaces > 0 && (
        <label className={f.code}>
          <span>Judge code {needCode ? "(needed now: the public places are taken)" : "(optional)"}</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="petri-7-…"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-label="Judge code"
          />
        </label>
      )}
      <button className={`btn ${f.cta}`} onClick={go} disabled={busy || (needCode && !code.trim())}>
        Play free on mainnet (no wallet)
      </button>
      <p className={f.lead}>Credit you can play with, not withdraw.</p>
      <p className={f.fine}>
        Your browser makes a key; the site&rsquo;s relayer opens its NEAR account, pays the gas and sponsors 0.05 NEAR of credit
        held by the dish. The colony is real, on mainnet; the credit plants and buys but never becomes NEAR.
      </p>
      <div className={f.meter} aria-label={placesText(left, judgeLeft)}>
        <span className={f.bar} aria-hidden="true">
          <i style={{ width: `${Math.max(3, Math.round((left / Math.max(1, cap)) * 100))}%` }} />
        </span>
        <span>
          <b>{left}</b> {left === 1 ? "place" : "places"} left{judgeLeft > 0 ? ` (${judgeLeft} for judges with a code)` : ""}
        </span>
      </div>
    </div>
  );
}
