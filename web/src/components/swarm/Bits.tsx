"use client";
// Small pieces the swarm pages share: the strains section's tabs, the model badge and a copyable code block.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { modelLabel, type Tee } from "@/lib/swarm";
import s from "./swarm.module.css";

const TABS = [
  { href: "/strains", label: "House strains" },
  { href: "/strains/new", label: "Spawn a strain" },
  { href: "/strains/join", label: "Join the swarm" },
  { href: "/strains/break", label: "Break the pact" },
];

export function SwarmTabs() {
  const path = usePathname();
  return (
    <nav aria-label="AI strains">
      <ul className={s.tabs}>
        {TABS.map((t) => (
          <li key={t.href}>
            <Link href={t.href} aria-current={path === t.href ? "page" : undefined}>
              {t.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Which model chose a move: NEAR AI with the enclave's signature checked against its attestation, or a fallback. */
export function ModelBadge({ model, tee }: { model: string | null | undefined; tee?: Tee }) {
  const l = modelLabel(model, tee);
  return (
    <span className={`${s.badge} ${l.tee ? s.badgeTee : ""}`} title={l.tee ? "Answered by NEAR AI Cloud inside a TEE; the answer's signature was checked against the enclave's attested signing address" : model ?? "No model answered"}>
      <i aria-hidden />
      {l.text}
    </span>
  );
}

export function Code({ children, label }: { children: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className={s.code}>
      {label && <figcaption className={s.codeLabel}>{label}</figcaption>}
      <pre tabIndex={0}>{children}</pre>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(children).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            },
            () => {},
          );
        }}
        style={label ? { top: 34 } : undefined}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </figure>
  );
}
