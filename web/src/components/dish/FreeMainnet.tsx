"use client";
// The mainnet start card's free-play offer, during judging: a colony with no wallet, on credit the site's mainnet
// relayer sponsors, and how many such colonies are left. Before the window it says when it opens; after, that it
// closed. Nothing shows when the server has free mainnet play switched off.

import { useFreeMainnet, utcWhen } from "@/lib/free-mainnet";
import f from "./FreeMainnet.module.css";

export function FreeMainnetOffer({ onFree, busy }: { onFree: () => void; busy: boolean }) {
  const st = useFreeMainnet();
  if (!st?.on) return null;
  const cap = st.cap ?? 40;
  const left = st.left ?? 0;
  if (st.why === "soon") {
    return (
      <div className={f.offer}>
        <p className={f.eyebrow}>Free during judging</p>
        <p className={f.lead}>Play free on mainnet, with no wallet, from {st.opensAt ? utcWhen(st.opensAt) : "the judging window"}{st.closesAt ? ` to ${utcWhen(st.closesAt)}` : ""}.</p>
        <p className={f.fine}>{cap > 0 ? `${cap} colonies` : "A few colonies"}, each on 0.05 NEAR of credit the site&rsquo;s relayer sponsors: credit you can play with, not withdraw.</p>
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
  return (
    <div className={f.offer}>
      <p className={f.eyebrow}>Free during judging</p>
      <button className={`btn ${f.cta}`} onClick={onFree} disabled={busy}>
        Play free on mainnet (no wallet)
      </button>
      <p className={f.lead}>Credit you can play with, not withdraw.</p>
      <p className={f.fine}>
        Your browser makes a key; the site&rsquo;s relayer opens its NEAR account, pays the gas and sponsors 0.05 NEAR of credit
        held by the dish. The colony is real, on mainnet; the credit plants and buys but never becomes NEAR.
      </p>
      <div className={f.meter} aria-label={`${left} of ${cap} free mainnet colonies left`}>
        <span className={f.bar} aria-hidden="true">
          <i style={{ width: `${Math.max(3, Math.round((left / Math.max(1, cap)) * 100))}%` }} />
        </span>
        <span>
          <b>{left}</b> of {cap} free mainnet colonies left
        </span>
      </div>
    </div>
  );
}
