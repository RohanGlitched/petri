"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NETWORK } from "@/lib/config";
import { useDish } from "@/lib/dish-store";
import { Mark } from "./Mark";

export const LINKS = [
  { href: "/dish", label: "The dish" },
  { href: "/rules", label: "How it works" },
  { href: "/colonies", label: "Colonies" },
  { href: "/strains", label: "AI strains" },
  { href: "/verify", label: "Verify" },
];

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const d = useDish();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => setOpen(false), [path]);

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
          <span className="net" title={`Reading the dish live from NEAR ${NETWORK}`}>
            <i className="pulse" aria-hidden="true" />
            {d.status === "ready" ? `Generation ${d.generation.toLocaleString("en-US")}` : `NEAR ${NETWORK}`}
          </span>
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
          <Link className="btn btn-amber" href="/dish" onClick={() => setOpen(false)}>
            Start a colony
          </Link>
        </nav>
      )}
    </header>
  );
}
