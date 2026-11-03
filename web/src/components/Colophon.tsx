import Link from "next/link";
import { CONTRACT, EXPLORER, NETWORK, REPO } from "@/lib/config";
import { BrandMark } from "./BrandMark";

export function Colophon() {
  return (
    <footer className="colophon" aria-label="Site">
      <div>
        <Link href="/" className="brand" style={{ marginBottom: 12 }}>
          <BrandMark className="brand-mark" />
          <span>Petri</span>
        </Link>
        <p className="muted" style={{ fontFamily: "var(--serif)", fontSize: "var(--t-sm)", maxWidth: "32ch" }}>
          A coin that is alive. Conway&rsquo;s Life with owners, run by a NEAR contract, replayed in your browser.
        </p>
      </div>
      <div>
        <h4>Notebook</h4>
        <ul>
          <li><Link href="/dish">The dish</Link></li>
          <li><Link href="/rules">Rules</Link></li>
          <li><Link href="/colonies">Colonies</Link></li>
          <li><Link href="/strains">Strains</Link></li>
          <li><Link href="/verify">Verify the history</Link></li>
        </ul>
      </div>
      <div>
        <h4>On chain</h4>
        <ul>
          <li><a href={`${EXPLORER}/address/${CONTRACT}`}>Contract {CONTRACT}</a></li>
          <li>Network: NEAR {NETWORK}</li>
          <li><a href={`${REPO}/blob/main/RULES.md`}>RULES.md</a></li>
        </ul>
      </div>
      <div>
        <h4>Source</h4>
        <ul>
          <li><a href={REPO}>GitHub repository</a></li>
          <li><a href={`${REPO}/tree/main/core`}>petri-core (the rules)</a></li>
          <li><a href={`${REPO}/tree/main/contract`}>The contract</a></li>
          <li>Built for NEAR HACKATHON, November 2026</li>
        </ul>
      </div>
    </footer>
  );
}
