"use client";

import { useState, type ReactNode } from "react";

/**
 * Long prose on a phone: the first few lines, faded, with "Read more" under them; on wider screens it is simply the
 * text (the button is hidden by CSS, so nothing changes on a desktop). Nothing is removed: the rest is one tap away and
 * stays in the page for search and screen readers.
 */
export function ReadMore({ children, lines = 4, className = "" }: { children: ReactNode; lines?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`readmore ${open ? "is-open" : ""} ${className}`} style={{ "--rm-lines": lines } as React.CSSProperties}>
      <div className="readmore-body">{children}</div>
      <button type="button" className="readmore-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "Show less" : "Read more"}
      </button>
    </div>
  );
}

/**
 * A secondary block of a home band: on a phone it waits behind one button that names what is inside; on wider screens
 * it is simply shown.
 */
export function PhoneMore({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`phonemore ${open ? "is-open" : ""}`}>
      <button type="button" className="phonemore-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Show less" : label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <div className="phonemore-body">{children}</div>
    </div>
  );
}
