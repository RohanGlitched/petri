"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PAGES, docHref } from "./nav";

type Hit = { slug: string; hash?: string; title: string; page: string; text: string };

const INDEX: Hit[] = PAGES.flatMap((p) => [
  { slug: p.slug, title: p.title, page: p.group, text: `${p.title} ${p.description}`.toLowerCase() },
  ...p.sections.map((s) => ({ slug: p.slug, hash: s.id, title: s.title, page: p.title, text: `${s.title} ${s.keywords ?? ""} ${p.title}`.toLowerCase() })),
]);

function score(h: Hit, words: string[]): number {
  let n = 0;
  const title = h.title.toLowerCase();
  for (const w of words) {
    if (!h.text.includes(w)) return 0;
    n += title.startsWith(w) ? 6 : title.includes(w) ? 4 : 1;
  }
  return n + (h.hash ? 0 : 0.5);
}

export function Search({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const back = useRef<Element | null>(null);

  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return INDEX.filter((h) => !h.hash);
    return INDEX.map((h) => ({ h, s: score(h, words) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map((x) => x.h);
  }, [q]);

  useEffect(() => {
    back.current = document.activeElement;
    input.current?.focus();
    return () => {
      if (back.current instanceof HTMLElement) back.current.focus();
    };
  }, []);
  useEffect(() => setAt(0), [q]);

  const go = (h: Hit) => {
    onClose();
    // Resolve the relative docs link against this page, so it lands right on either host.
    const u = new URL(docHref(h.slug, h.hash), window.location.href);
    router.push(`${u.pathname}${u.hash}`);
  };

  return (
    <div
      className="d-search-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className="d-search"
        role="dialog"
        aria-modal="true"
        aria-label="Search the docs"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setAt((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setAt((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && hits[at]) {
            e.preventDefault();
            go(hits[at]);
          } else if (e.key === "Tab") {
            // Keep focus inside the dialog.
            e.preventDefault();
            input.current?.focus();
          }
        }}
      >
        <div className="d-search-field">
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="7" cy="7" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.6 10.6L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search pages, sections and methods"
            aria-label="Search the docs"
            aria-controls="d-search-results"
            aria-activedescendant={hits[at] ? `d-hit-${at}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="button" className="d-search-close" onClick={onClose}>
            Esc
          </button>
        </div>
        <ul id="d-search-results" role="listbox" aria-label="Results">
          {hits.length === 0 && <li className="d-search-empty">Nothing matches. Try a method name such as plant, or a word such as tide.</li>}
          {hits.map((h, i) => (
            <li key={`${h.slug}#${h.hash ?? ""}`} id={`d-hit-${i}`} role="option" aria-selected={i === at}>
              <button type="button" tabIndex={-1} onMouseEnter={() => setAt(i)} onClick={() => go(h)}>
                <span className="d-hit-title">{h.title}</span>
                <span className="d-hit-page">{h.page}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="d-search-hint">Up and down to move, Enter to open, Esc to close.</p>
      </div>
    </div>
  );
}
