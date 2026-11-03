"use client";

import Link from "next/link";
import { REPO } from "@/lib/config";
import { useDish } from "@/lib/dish-store";
import { useNet } from "@/lib/use-net";
import { Mark } from "./Mark";

export function Footer() {
  const d = useDish();
  const net = useNet();
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link className="brand" href="/">
              <Mark className="brand-mark" />
              Petri
            </Link>
            <p>A coin that is alive. Conway&rsquo;s Life with owners, run by a NEAR contract and played by people and AI strains.</p>
            <Link className="btn btn-amber btn-small" href="/dish">
              Start a colony
            </Link>
          </div>
          <div className="foot-col">
            <h3>Play</h3>
            <ul>
              <li><Link href="/dish">The live dish</Link></li>
              <li><Link href="/colonies">Colonies</Link></li>
              <li><Link href="/specimens">Specimens</Link></li>
              <li><Link href="/strains">AI strains</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h3>Learn</h3>
            <ul>
              <li><Link href="/rules">How it works</Link></li>
              <li><Link href="/rules#coin">The coin</Link></li>
              <li><Link href="/verify">Verify the dish</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h3>Source</h3>
            <ul>
              <li><a href={REPO}>Code on GitHub</a></li>
              <li><a href={`${REPO}/blob/main/RULES.md`}>The rules, in full</a></li>
              <li><a href={`${REPO}/tree/main/sim`}>Economy simulator</a></li>
            </ul>
          </div>
          <div className="foot-col">
            <h3>Runs on</h3>
            <ul>
              <li><a href={net.contractUrl}>{net.contract}</a></li>
              <li><a href="https://near.org">NEAR Protocol</a></li>
              <li><a href="https://cloud.near.ai">NEAR AI Cloud</a></li>
            </ul>
          </div>
        </div>
        <div className="foot-chain" aria-live="off">
          <span>
            Generation <strong className="num">{d.status === "ready" ? d.generation.toLocaleString("en-US") : "—"}</strong>
          </span>
          <span>
            History chain <code>{d.chain ? d.chain.slice(0, 32) + "…" : "reading…"}</code>
          </span>
          <Link href="/verify">Check it yourself</Link>
        </div>
        <div className="foot-bottom">
          <span>Built for the NEAR HACKATHON, November 2026. Open source under the MIT licence.</span>
          <span>
            Reading {net.contract} on {net.label.chain}{net.freePlay ? ", the free-play dish" : ", where the NEAR is real"}.{" "}
            <a href={net.contractUrl}>Explorer</a>
          </span>
        </div>
      </div>
    </footer>
  );
}
