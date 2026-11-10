"use client";

import { useState } from "react";
import s from "./share.module.css";

/** Post on X, copy the link, or the phone's own share sheet. */
export function ShareActions({ url, text }: { url: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const x = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <p className={s.share}>
      <a href={x} target="_blank" rel="noreferrer">Post on X</a>
      <button
        type="button"
        onClick={async () => {
          try {
            if (navigator.share && window.matchMedia("(pointer: coarse)").matches) await navigator.share({ url, text });
            else {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }
          } catch {
            /* cancelled */
          }
        }}
      >
        {copied ? "Link copied" : "Copy link"}
      </button>
      <span aria-live="polite" className="sr">{copied ? "Link copied" : ""}</span>
    </p>
  );
}
