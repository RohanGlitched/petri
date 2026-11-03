"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NETWORK } from "@/lib/config";
import { BrandMark } from "./BrandMark";

const LINKS = [
  { href: "/dish", label: "The dish" },
  { href: "/rules", label: "Rules" },
  { href: "/colonies", label: "Colonies" },
  { href: "/strains", label: "Strains" },
  { href: "/verify", label: "Verify" },
];

export function TopBar() {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Petri, home">
        <BrandMark className="brand-mark" />
        <span>Petri</span>
      </Link>
      <nav aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={path?.startsWith(l.href) ? "page" : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <span className="spacer" />
      <span className="net">NEAR {NETWORK}</span>
    </header>
  );
}
