"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@/components/site/Mark";
import { DISH, REPO, SITE } from "./facts";
import { GROUPS, PAGES, docHref } from "./nav";
import { Search } from "./Search";

/** The page being read: /docs/<slug> here, /<slug> on docs.playpetri.xyz, and the introduction at either root. */
export function slugOf(path: string | null): string {
  const last = (path ?? "").split("/").filter(Boolean).pop() ?? "";
  return !last || last === "docs" ? "introduction" : last;
}

/** The main site on the deployment being read: docs.X serves the docs and www.X the site; any other host (localhost,
 * the VM's own address while DNS moves) serves both, the docs under /docs. */
export function siteBase(host: string): string {
  const h = host.toLowerCase();
  if (h.startsWith("docs.")) return `${window.location.protocol}//www.${h.slice(5)}`;
  return window.location.origin;
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  // The canonical site until the browser says which deployment this is.
  const [site, setSite] = useState(SITE);
  useEffect(() => setSite(siteBase(window.location.host)), []);
  const slug = slugOf(path);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearching(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <>
      <a href="#doc" className="d-skip">
        Skip to the page
      </a>
      <header className="d-top">
        <div className="d-top-in">
          <button type="button" className="d-menu" aria-expanded={open} aria-controls="d-side" onClick={() => setOpen((o) => !o)}>
            <span className="d-sr">{open ? "Close the contents" : "Open the contents"}</span>
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
              {open ? (
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              ) : (
                <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <Link href={docHref("introduction")} className="d-brand">
            <Mark className="d-brand-mark" />
            <span>Petri</span>
            <span className="d-brand-docs">docs</span>
          </Link>
          <button type="button" className="d-search-btn" onClick={() => setSearching(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>Search the docs</span>
            <kbd>Ctrl K</kbd>
          </button>
          <nav className="d-top-links" aria-label="Petri">
            <a href={`${site}/dish`}>Play</a>
            <a href={`${site}/verify`}>Verify</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </header>
      <div className="d-frame">
        <nav id="d-side" className={`d-side${open ? " d-side-open" : ""}`} aria-label="Documentation">
          <div className="d-side-in">
            {GROUPS.map((g) => (
              <div key={g} className="d-group">
                <p className="d-group-name">{g}</p>
                <ul>
                  {PAGES.filter((p) => p.group === g).map((p) => (
                    <li key={p.slug}>
                      <Link href={docHref(p.slug)} aria-current={p.slug === slug ? "page" : undefined}>
                        {p.short ?? p.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="d-side-dishes">
              <p className="d-group-name">The dishes</p>
              <a href={`${DISH.mainnet.explorer}/address/${DISH.mainnet.contract}`}>
                <i className="d-netdot d-netdot-mainnet" aria-hidden="true" />
                {DISH.mainnet.contract}
              </a>
              <a href={`${DISH.testnet.explorer}/address/${DISH.testnet.contract}`}>
                <i className="d-netdot d-netdot-testnet" aria-hidden="true" />
                {DISH.testnet.contract}
              </a>
            </div>
          </div>
        </nav>
        {open && <button type="button" className="d-scrim" aria-label="Close the contents" onClick={() => setOpen(false)} />}
        {children}
      </div>
      {searching && <Search onClose={() => setSearching(false)} />}
    </>
  );
}
