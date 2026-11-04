"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { goToSection, scrollToY, useActiveSection, useScrolledPast, useSections, type Section } from "@/lib/use-sections";
import s from "./wells.module.css";

/** The well strip. A long page reads like one column of a culture plate: a well per section, the one being read holding
 * a blinker (Life's smallest oscillator), the wells already passed each keeping a small colony, and a capillary between
 * them that fills as you go down. The round lens above it goes back to the top. Phones get the same wells in a sheet,
 * opened from the current section's name in the corner.
 *
 * Everything here is position: fixed and appears by opacity and transform, so it cannot move the page (CLS 0). Sections
 * are found from markup (`id` plus `data-section`) and tracked with an IntersectionObserver. */
export function Wells({
  root = "main",
  focus = "#main",
  footer = "footer.footer",
  offset = 84,
  topOnly = false,
}: {
  /** Where the page's sections live. */
  root?: string;
  /** What takes focus after going back to the top. */
  focus?: string;
  /** The corner name tag steps aside while this is on screen. */
  footer?: string;
  /** The sticky bar's height plus a little air, for landing a section under it. */
  offset?: number;
  /** Only the back-to-top lens (the docs have their own contents). */
  topOnly?: boolean;
}) {
  const path = usePathname() ?? "";
  const play = path === "/dish" || path.startsWith("/dish/");
  const found = useSections(root, path);
  const list = topOnly || play || found.length < 3 ? NONE : found;
  const active = useActiveSection(list);
  const past = useScrolledPast(0.9);
  const [foot, setFoot] = useState(false);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const pill = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  // Fade in only after the page's first paint has settled.
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => setOpen(false), [path]);

  useEffect(() => {
    const el = document.querySelector(footer);
    if (!el) return setFoot(false);
    const io = new IntersectionObserver(([e]) => setFoot(e.isIntersecting), { rootMargin: "0px 0px -24px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [footer, path]);

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLButtonElement>('[aria-current="location"]')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        pill.current?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open]);

  if (play) return null;

  const toTop = () => {
    scrollToY(0);
    const el = document.querySelector<HTMLElement>(focus);
    if (el) {
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el.focus({ preventScroll: true });
    }
  };
  const rail = list.length > 0;
  const here = list[active];

  return (
    <div className={s.wells} data-ready={ready || undefined} data-past={past || undefined} data-rail={rail || undefined}>
      {rail && (
        <nav className={s.dock} aria-label="Sections on this page">
          <TopLens onClick={toTop} />
          <ol className={s.strip} style={{ "--fill": list.length > 1 ? active / (list.length - 1) : 0 } as React.CSSProperties}>
            <li className={s.track} aria-hidden="true">
              <i />
            </li>
            {list.map((sec, i) => (
              <li key={sec.id}>
                <button
                  type="button"
                  className={s.well}
                  aria-label={sec.title}
                  aria-current={i === active ? "location" : undefined}
                  onClick={() => goToSection(sec.id, offset)}
                >
                  <Dish state={i < active ? "past" : i === active ? "here" : "ahead"} />
                  <span className={s.tag} aria-hidden="true">{sec.title}</span>
                </button>
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className={s.corner} data-foot={foot || undefined}>
        {rail && here && (
          <button
            ref={pill}
            type="button"
            className={s.pill}
            aria-expanded={open}
            aria-controls="wells-sheet"
            onClick={() => setOpen(true)}
          >
            <Dish state="here" />
            <span className={s.pillName}>
              <span className="sr">Sections on this page. Now reading: </span>
              {here.title}
            </span>
          </button>
        )}
        <TopLens onClick={toTop} round />
      </div>

      {rail && (
        <>
          <button type="button" className={s.scrim} data-open={open || undefined} tabIndex={-1} aria-hidden="true" onClick={() => setOpen(false)} />
          <div
            ref={sheet}
            id="wells-sheet"
            className={s.sheet}
            data-open={open || undefined}
            role="dialog"
            aria-modal="false"
            aria-labelledby="wells-sheet-title"
          >
            <div className={s.sheetHead}>
              <p id="wells-sheet-title">On this page</p>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => { setOpen(false); pill.current?.focus(); }}>
                Close
              </button>
            </div>
            <ol className={s.sheetList}>
              {list.map((sec: Section, i) => (
                <li key={sec.id} data-after={i === active + 1 || undefined}>
                  <button
                    type="button"
                    aria-current={i === active ? "location" : undefined}
                    onClick={() => {
                      setOpen(false);
                      goToSection(sec.id, offset);
                    }}
                  >
                    <Dish state={i < active ? "past" : i === active ? "here" : "ahead"} />
                    <span>{sec.title}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

const NONE: Section[] = [];

/** One agar well. "past" keeps a small colony; "here" holds a blinker, which flips between its two phases. */
function Dish({ state }: { state: "past" | "here" | "ahead" }) {
  return (
    <span className={s.dish} data-state={state} aria-hidden="true">
      {state === "here" && (
        <span className={s.blinker}>
          <i />
          <i />
          <i />
        </span>
      )}
    </span>
  );
}

/** The objective lens: back to the top. */
function TopLens({ onClick, round }: { onClick: () => void; round?: boolean }) {
  return (
    <button type="button" className={round ? `${s.lens} ${s.lensCorner}` : s.lens} aria-label="Back to the top" onClick={onClick}>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 8.6L7 4.6l4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {!round && <span className={s.tag} aria-hidden="true">Back to the top</span>}
    </button>
  );
}
