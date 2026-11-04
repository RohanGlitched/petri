"use client";

import { useRef } from "react";
import { CONTRACTS, NETWORK, switchNetwork, type Network } from "@/lib/config";
import { useDish } from "@/lib/dish-store";
import { useMainnetPulse } from "@/lib/mainnet-pulse";
import { useNet } from "@/lib/use-net";

/** Mainnet first: it is the dish with real NEAR, and the one a visitor should know is live. */
const ORDER: Network[] = ["mainnet", "testnet"];

const SEG: Record<Network, { name: string; sub: string; line: string }> = {
  mainnet: { name: "Mainnet", sub: "Live, real NEAR", line: "Your own wallet and your own NEAR, or pay with any token through NEAR Intents." },
  testnet: { name: "Testnet", sub: "Free play", line: "A guest account in one click and sponsored credit. Nothing here costs real money." },
};

const int = (n: number) => n.toLocaleString("en-US");

/**
 * Which dish the site reads, with both always in view: mainnet (live, real NEAR) and testnet (free play). Choosing the
 * other one reloads the page on that network (see `switchNetwork`). `bar` sits in the nav; `sheet` is the phone menu's
 * fuller version with a line about each dish.
 */
export function NetSwitch({ variant = "bar" }: { variant?: "bar" | "sheet" }) {
  const net = useNet();
  const d = useDish();
  const main = useMainnetPulse();
  const group = useRef<HTMLDivElement>(null);

  const choose = (n: Network) => {
    if (n !== NETWORK) switchNetwork(n);
  };

  // Arrow keys move between the two options; Enter or Space picks one (picking reloads, so arrows never do).
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const opts = Array.from(group.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? []);
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? opts.length - 1 : (at + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) + opts.length) % opts.length;
    opts[next]?.focus();
  };

  const liveMain = main.status === "ready";
  const hint = (n: Network) => {
    const here = net.network === n;
    if (n === "mainnet") {
      const gen = liveMain ? `, live at generation ${int(main.generation)} with ${int(main.colonies)} ${main.colonies === 1 ? "colony" : "colonies"}` : "";
      return `${CONTRACTS.mainnet} on NEAR mainnet${gen}. ${here ? "You are reading this dish." : "Switch to the dish with real NEAR."}`;
    }
    const ahead = here && d.status === "ready" && d.ahead > 0 ? ` The contract stored generation ${int(Number(d.state?.generation ?? 0))}; your browser runs the same rules ${int(d.ahead)} ahead.` : "";
    return `${CONTRACTS.testnet} on NEAR testnet, free play.${ahead} ${here ? "You are reading this dish." : "Switch to free play: no wallet needed."}`;
  };

  if (variant === "sheet") {
    return (
      <div ref={group} className="netsheet" role="radiogroup" aria-label="Which dish to read" onKeyDown={onKey}>
        {ORDER.map((n) => {
          const on = net.network === n;
          return (
            <button key={n} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className="netsheet-opt" onClick={() => choose(n)} title={hint(n)}>
              <i className={`netdot netdot-${n}${n === "mainnet" && liveMain ? " netdot-live" : ""}`} aria-hidden="true" />
              <span>
                <b>{SEG[n].name}</b> <small>{SEG[n].sub}</small>
                <em>
                  {n === "mainnet" && liveMain ? <>Live now at generation <span className="num">{int(main.generation)}</span>. </> : null}
                  {SEG[n].line}
                </em>
              </span>
              <span className="netsheet-state">{on ? "Reading" : "Switch"}</span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div ref={group} className="netseg" role="radiogroup" aria-label="Which dish to read" onKeyDown={onKey}>
      {ORDER.map((n) => {
        const on = net.network === n;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={`netseg-opt netseg-${n}`}
            onClick={() => choose(n)}
            title={hint(n)}
          >
            <i className={`netdot netdot-${n}${n === "mainnet" && liveMain ? " netdot-live" : ""}`} aria-hidden="true" />
            <span className="netseg-text">
              <span className="netseg-name">{SEG[n].name}</span>
              <span className="netseg-sub">{SEG[n].sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
