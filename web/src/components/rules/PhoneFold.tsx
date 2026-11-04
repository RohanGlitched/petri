"use client";

import { useEffect, useState, type ReactNode } from "react";
import s from "./rules.module.css";

const PHONE = "(max-width: 700px)";

/**
 * The body of a long rules section. On a phone it starts folded under its heading and lede, so the page is a list of
 * sections to open rather than forty screens to scroll; elsewhere it is simply the section. A visit that names a place
 * on the page (`#coin`) keeps everything open so the browser lands where it was sent.
 */
export function PhoneFold({ label, paper = false, children }: { label: string; paper?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (window.location.hash) return;
    if (window.matchMedia(PHONE).matches) setOpen(false);
  }, []);
  return (
    <details className={`${s.fold} ${s.phoneFold} ${paper ? s.foldPaper : ""}`} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        {open ? "Fold this section" : label}
        <small>{open ? "" : "Tap to read it in full"}</small>
      </summary>
      <div className={s.phoneFoldBody}>{children}</div>
    </details>
  );
}
