"use client";

import { useState } from "react";

/** A NEAR amount printed to the yoctoNEAR (as replay.ts `fmtNear` does) has up to 24 decimals: anything with more than
 * six decimal places is NEAR, since PETRI has exactly six. */
const LONG = /-?\d+\.\d{7,}/g;

/**
 * A check's value with every long NEAR amount shown to 4 decimals. The exact amount is the button's title and is copied
 * to the clipboard on click, so the yocto-exact comparison stays one click away. Anything else in the text passes
 * through unchanged.
 *
 * In VerifyRun.tsx: `<dd>{c.expected ? <Amount text={c.expected} /> : "—"}</dd>` and
 * `<dd>{c.got !== null ? <Amount text={c.got} /> : "waiting for the replay"}</dd>`.
 */
export function Amount({ text }: { text: string }) {
  const parts: (string | { exact: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(LONG)) {
    if (m.index! > last) parts.push(text.slice(last, m.index));
    parts.push({ exact: m[0] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => (typeof p === "string" ? p : <Exact key={i} exact={p.exact} />))}</>;
}

function Exact({ exact }: { exact: string }) {
  const [copied, setCopied] = useState(false);
  const [whole, frac = ""] = exact.split(".");
  const short = `${Number(whole).toLocaleString("en-US")}.${frac.slice(0, 4).padEnd(4, "0")}`;
  return (
    <button
      type="button"
      className="num"
      title={`${exact} NEAR exactly. Click to copy.`}
      onClick={() =>
        navigator.clipboard?.writeText(exact).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          },
          () => {},
        )
      }
      style={{ font: "inherit", color: "inherit", background: "none", border: 0, padding: 0, cursor: "copy", textDecoration: "underline dotted", textUnderlineOffset: 3 }}
    >
      {copied ? "copied" : short}
    </button>
  );
}
