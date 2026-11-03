"use client";

import { useId, useSyncExternalStore } from "react";

// One choice of network for every tab set on the page, remembered for the next visit. Both panels are in the HTML, so
// a reader without JavaScript (or an agent reading the page source) sees both.
type Net = "mainnet" | "testnet";
const KEY = "petri.docs.net";
const listeners = new Set<() => void>();
let current: Net | null = null;

function read(): Net {
  if (current) return current;
  try {
    const v = localStorage.getItem(KEY);
    current = v === "testnet" ? "testnet" : "mainnet";
  } catch {
    current = "mainnet";
  }
  return current;
}

function choose(n: Net) {
  current = n;
  try {
    localStorage.setItem(KEY, n);
  } catch {
    /* this visit only */
  }
  listeners.forEach((l) => l());
}

export function NetTabs({ mainnet, testnet, label = "Network" }: { mainnet: React.ReactNode; testnet: React.ReactNode; label?: string }) {
  const net = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => "mainnet" as Net,
  );
  const id = useId();
  const tabs: { n: Net; label: string }[] = [
    { n: "mainnet", label: "Mainnet" },
    { n: "testnet", label: "Testnet" },
  ];
  return (
    <div className="d-tabs">
      <div role="tablist" aria-label={label} className="d-tablist">
        {tabs.map((t) => (
          <button
            key={t.n}
            type="button"
            role="tab"
            id={`${id}-${t.n}-tab`}
            aria-controls={`${id}-${t.n}`}
            aria-selected={net === t.n}
            tabIndex={net === t.n ? 0 : -1}
            onClick={() => choose(t.n)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const other = t.n === "mainnet" ? "testnet" : "mainnet";
                choose(other);
                document.getElementById(`${id}-${other}-tab`)?.focus();
              }
            }}
          >
            <i className={`d-netdot d-netdot-${t.n}`} aria-hidden="true" />
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-mainnet`} aria-labelledby={`${id}-mainnet-tab`} hidden={net !== "mainnet"}>
        {mainnet}
      </div>
      <div role="tabpanel" id={`${id}-testnet`} aria-labelledby={`${id}-testnet-tab`} hidden={net !== "testnet"}>
        {testnet}
      </div>
    </div>
  );
}
