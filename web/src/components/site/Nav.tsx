"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NETWORK, wantedNetwork } from "@/lib/config";
import { useDocsHref } from "@/lib/use-docs";
import { Mark } from "./Mark";
import { NetSwitch } from "./NetSwitch";

type Item = {
  href: string;
  label: string;
  /** One line for the More menu and the phone menu. */
  note: string;
  group: "play" | "learn";
  /**
   * Where the link sits in the bar. 1 stays until the phone menu takes over; 2 and 3 fold into More as the window
   * narrows (3 first); 0 always lives in More.
   */
  rank: 0 | 1 | 2 | 3;
};

export const LINKS: Item[] = [
  { href: "/dish", label: "The dish", note: "Watch it live and plant cells", group: "play", rank: 1 },
  { href: "/rules", label: "How it works", note: "The rules and the coin", group: "learn", rank: 1 },
  { href: "/strains", label: "AI strains", note: "Five AI colonies, their moves and their pacts", group: "play", rank: 2 },
  { href: "/specimens", label: "Specimens", note: "Living cells fixed onto slides, as NFTs", group: "play", rank: 3 },
  { href: "/judges", label: "Judges", note: "Every claim checked live, track by track", group: "learn", rank: 1 },
  { href: "/verify", label: "Verify", note: "Replay the dish from generation zero", group: "learn", rank: 2 },
  { href: "docs", label: "Docs", note: "Guides and the contract API", group: "learn", rank: 3 },
  { href: "/colonies", label: "Colonies", note: "Every colony, its cells and its PETRI", group: "play", rank: 0 },
  { href: "/records", label: "Records", note: "The dish's high scores, from its ledger", group: "play", rank: 0 },
  { href: "/coin", label: "The coin", note: "Every mint and burn of PETRI since genesis", group: "learn", rank: 0 },
  { href: "/break", label: "Try to break it", note: "Attacks the contract refuses, live", group: "learn", rank: 0 },
  { href: "/sim", label: "A week in a minute", note: "Seven days simulated with the real rules", group: "play", rank: 0 },
];

const HOME: Item = { href: "/", label: "Home", note: "", group: "play", rank: 1 };

const GROUPS = [
  { id: "play", title: "Play" },
  { id: "learn", title: "Learn" },
] as const;

/** The More menu lists what has folded out of the bar first, then what always lives there. */
const MORE = [...LINKS.filter((l) => l.rank === 2), ...LINKS.filter((l) => l.rank === 3), ...LINKS.filter((l) => l.rank === 0)];

/** The colony this browser has on the dish being read (the dish page remembers it), read after the first render so
 * the server's HTML and the first client render agree. */
function useMyColony(): number | null {
  const [id, setId] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      try {
        const v = Number(localStorage.getItem(`petri.colony.${NETWORK}`));
        setId(Number.isInteger(v) && v > 0 ? v : null);
      } catch {
        setId(null);
      }
    };
    read();
    window.addEventListener("petri:colony", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("petri:colony", read);
      window.removeEventListener("storage", read);
    };
  }, []);
  return id;
}

/** "My colony" pressed on the dish itself: no navigation, the dish brings the colony into view. */
function goMine(e: React.MouseEvent, path: string) {
  if (path !== "/dish") return;
  e.preventDefault();
  window.dispatchEvent(new Event("petri:find-mine"));
}

export function Nav() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const moreBox = useRef<HTMLLIElement>(null);
  const moreBtn = useRef<HTMLButtonElement>(null);
  const docs = useDocsHref();
  const mine = useMyColony();
  const hrefOf = (h: string) => (h === "docs" ? docs : h);
  const current = (h: string) => h !== "docs" && (path === h || path.startsWith(h + "/"));

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
    setMore(false);
  }, [path]);

  // Every reader is fixed to one network when the page loads, so a client-side move to a page that wants the other dish
  // (a link naming ?net=, a testnet-only page, or back from one) reloads into it.
  useEffect(() => {
    if (wantedNetwork(path) !== NETWORK) window.location.reload();
  }, [path]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  useEffect(() => {
    if (!more) return;
    const away = (e: PointerEvent) => !moreBox.current?.contains(e.target as Node) && setMore(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMore(false);
      moreBtn.current?.focus();
    };
    const blur = (e: FocusEvent) => {
      if (e.relatedTarget && !moreBox.current?.contains(e.relatedTarget as Node)) setMore(false);
    };
    const box = moreBox.current;
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    box?.addEventListener("focusout", blur);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
      box?.removeEventListener("focusout", blur);
    };
  }, [more]);

  // The More button carries the active mark when the page you are on is one of its links (at any width, since the
  // folded links are only hidden by CSS, the mark follows the rank: see .nav-more[data-here]).
  const hereRank = MORE.find((l) => current(l.href))?.rank;

  return (
    <header className="nav">
      <div className="wrap nav-in">
        <Link className="brand" href="/" onClick={() => setOpen(false)}>
          <Mark className="brand-mark" />
          <span className="brand-name">Petri Dish</span>
        </Link>
        <nav className="nav-main" aria-label="Main">
          <ul className="nav-links">
            {LINKS.filter((l) => l.rank > 0).map((l) => (
              <li key={l.href} data-rank={l.rank}>
                <Link href={hrefOf(l.href)} aria-current={current(l.href) ? "page" : undefined}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li className="nav-more" ref={moreBox} data-here={hereRank ?? undefined}>
              <button
                ref={moreBtn}
                type="button"
                className="nav-more-btn"
                aria-expanded={more}
                aria-controls="nav-more-menu"
                onClick={() => setMore((m) => !m)}
              >
                More
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <ul id="nav-more-menu" className="nav-more-menu" hidden={!more}>
                {MORE.map((l) => (
                  <li key={l.href} data-rank={l.rank}>
                    <Link href={hrefOf(l.href)} aria-current={current(l.href) ? "page" : undefined} onClick={() => setMore(false)}>
                      <b>{l.label}</b>
                      <span>{l.note}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        </nav>
        <div className="nav-end">
          <NetSwitch />
          <Link className="btn btn-amber btn-small nav-cta" href={mine ? `/dish?colony=${mine}` : "/dish"} onClick={(e) => mine && goMine(e, path)}>
            {mine ? "My colony" : "Start a colony"}
          </Link>
          <button className="menu-btn" type="button" aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen((o) => !o)}>
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
          <div className="sheet-in">
            <div className="sheet-groups">
              {GROUPS.map((g) => (
                <section key={g.id} className="sheet-group" aria-labelledby={`sheet-${g.id}`}>
                  <h2 id={`sheet-${g.id}`} className="sheet-title">{g.title}</h2>
                  <ul>
                    {[...(g.id === "play" ? [HOME] : []), ...LINKS.filter((l) => l.group === g.id)].map((l) => (
                      <li key={l.href}>
                        <Link href={hrefOf(l.href)} onClick={() => setOpen(false)} aria-current={(l.href === "/" ? path === "/" : current(l.href)) ? "page" : undefined}>
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <section className="sheet-group sheet-net" aria-labelledby="sheet-net">
              <h2 id="sheet-net" className="sheet-title">Which dish</h2>
              <NetSwitch variant="sheet" />
            </section>
            <Link
              className="btn btn-amber"
              href={mine ? `/dish?colony=${mine}` : "/dish"}
              onClick={(e) => {
                setOpen(false);
                if (mine) goMine(e, path);
              }}
            >
              {mine ? "My colony" : "Start a colony"}
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
