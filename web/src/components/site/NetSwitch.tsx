"use client";

import { useEffect, useRef, useState } from "react";
import { NETWORK, NETWORK_LABEL, switchNetwork, type Network } from "@/lib/config";
import { useNet } from "@/lib/use-net";

const ORDER: Network[] = ["testnet", "mainnet"];

/** Which dish the site reads: free play on testnet or real NEAR on mainnet. Choosing the other one reloads the page. */
export function NetSwitch({ variant = "pill" }: { variant?: "pill" | "sheet" }) {
  const net = useNet();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const choose = (n: Network) => {
    setOpen(false);
    if (n !== NETWORK) switchNetwork(n);
  };

  if (variant === "sheet") {
    return (
      <div className="netsheet" role="radiogroup" aria-label="Which dish to read">
        {ORDER.map((n) => (
          <button key={n} role="radio" aria-checked={net.network === n} className="netsheet-opt" onClick={() => choose(n)}>
            <i className={`netdot netdot-${n}`} aria-hidden="true" />
            <span>
              <b>{NETWORK_LABEL[n].name}</b> <small>{NETWORK_LABEL[n].chain}</small>
              <em>{NETWORK_LABEL[n].line}</em>
            </span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="netswitch" ref={box}>
      <button
        className="netswitch-btn"
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls="net-menu"
        onClick={() => setOpen((o) => !o)}
        title={`Reading ${net.contract} on ${net.label.chain}`}
      >
        <i className={`netdot netdot-${net.network}`} aria-hidden="true" />
        <span className="netswitch-name">{net.label.name}</span>
        <small>{net.network}</small>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div id="net-menu" className="netswitch-menu" role="menu" aria-label="Which dish to read">
          <p className="netswitch-head">One contract, two dishes. Pick the one to read and play.</p>
          {ORDER.map((n) => (
            <button key={n} role="menuitemradio" aria-checked={net.network === n} className="netswitch-opt" onClick={() => choose(n)}>
              <i className={`netdot netdot-${n}`} aria-hidden="true" />
              <span>
                <b>{NETWORK_LABEL[n].name}</b> <small>{NETWORK_LABEL[n].chain}</small>
                <em>{NETWORK_LABEL[n].line}</em>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
