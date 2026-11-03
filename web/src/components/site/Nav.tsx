"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NETWORK, networkInUrl } from "@/lib/config";
import { useDish } from "@/lib/dish-store";
import { useNet } from "@/lib/use-net";
import { Mark } from "./Mark";
import { NetSwitch } from "./NetSwitch";

export const LINKS = [
  { href: "/dish", label: "The dish" },
  { href: "/rules", label: "How it works" },
  { href: "/colonies", label: "Colonies" },
  { href: "/specimens", label: "Specimens" },
  { href: "/strains", label: "AI strains" },
  { href: "/verify", label: "Verify" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const d = useDish();
  const net = useNet();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => setOpen(false), [path]);
  // A link that names the other network in its address reloads into that dish.
  useEffect(() => {
    const wanted = networkInUrl();
    if (wanted && wanted !== NETWORK) window.location.reload();
  }, [path]);

  return (
    <header className="nav">
      <div className="wrap nav-in">
        <Link className="brand" href="/" onClick={() => setOpen(false)}>
          <Mark className="brand-mark" />
          Petri
        </Link>
        <ul className="nav-links">
          {LINKS.map((l) => (
            <li key={l.href}>
              <Link href={l.href} aria-current={path === l.href ? "page" : undefined}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="nav-end">
          <span
            className="net"
            title={
              d.status === "ready" && d.state
                ? `The contract stored generation ${Number(d.state.generation).toLocaleString("en-US")}; your browser runs the same rules ${d.ahead} ${d.ahead === 1 ? "generation" : "generations"} ahead until someone advances it`
                : `Reading ${net.contract} live from ${net.label.chain}`
            }
          >
            <i className="pulse" aria-hidden="true" />
            {d.status === "ready" ? `Generation ${d.generation.toLocaleString("en-US")}` : d.status === "error" ? "Not answering" : "Reading…"}
            {/* The browser steps the stored board forward to the clock; say how far, quietly. */}
            {d.status === "ready" && d.ahead > 0 && <small className="net-ahead num">browser ahead by {d.ahead.toLocaleString("en-US")}</small>}
          </span>
          <NetSwitch />
          <Link className="btn btn-amber btn-small" href="/dish">
            Start a colony
          </Link>
          <button className="menu-btn" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
            <span className="sr">{open ? "Close menu" : "Open menu"}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <nav id="site-menu" className="sheet" aria-label="Site">
          <Link href="/" onClick={() => setOpen(false)}>Home</Link>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} aria-current={path === l.href ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
          <NetSwitch variant="sheet" />
          <Link className="btn btn-amber" href="/dish" onClick={() => setOpen(false)}>
            Start a colony
          </Link>
        </nav>
      )}
    </header>
  );
}
