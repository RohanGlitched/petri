"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDocsHref } from "@/lib/use-docs";
import { CONTRACTS, REPO, accountUrl } from "@/lib/config";
import { useDish } from "@/lib/dish-store";
import { useNet } from "@/lib/use-net";
import { Mark } from "./Mark";

export function Footer() {
  const d = useDish();
  const net = useNet();
  const docs = useDocsHref();
  // The play page fills the window from 800 px up, so it carries no document footer there.
  const onDish = usePathname() === "/dish";
  return (
    <footer className={`footer${onDish ? " footer-dish" : ""}`}>
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link className="brand" href="/">
              <Mark className="brand-mark" />
              <span className="brand-name">Petri Dish</span>
            </Link>
            <p>A memecoin that is alive. Conway&rsquo;s Life with owners, run by a NEAR contract and played by people and AI strains.</p>
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
              <li><Link href="/records">Records</Link></li>
              <li><Link href="/strains">AI strains</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h3>Learn</h3>
            <ul>
              <li><Link href="/rules">How it works</Link></li>
              <li><Link href="/rules#coin">The coin</Link></li>
              <li><Link href="/verify">Verify the dish</Link></li>
              <li><a href={docs}>Documentation</a></li>
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
              <li><a href={accountUrl(CONTRACTS.mainnet, "mainnet")}>{CONTRACTS.mainnet}</a> <span className="foot-net">mainnet, live</span></li>
              <li><a href={accountUrl(CONTRACTS.testnet, "testnet")}>{CONTRACTS.testnet}</a> <span className="foot-net">testnet, free play</span></li>
              <li><a href="https://near.org">NEAR Protocol</a></li>
              <li><a href="https://near-intents.org">NEAR Intents</a></li>
              <li><a href="https://www.anthropic.com/claude/haiku">Claude Haiku</a> and <a href="https://cloud.near.ai">NEAR AI Cloud</a></li>
            </ul>
          </div>
        </div>
        <div className="foot-chain" aria-live="off">
          <span>
            Generation <strong className="num">{d.status === "ready" ? d.generation.toLocaleString("en-US") : "—"}</strong>
            {/* The browser steps the stored board forward to the clock; say how far, quietly. */}
            {d.status === "ready" && d.ahead > 0 ? (
              <small className="foot-ahead num" title="The contract stores the board at the last generation someone advanced to; your browser runs the same rules forward to the clock.">
                {" "}stored at {Number(d.state?.generation ?? 0).toLocaleString("en-US")}, your browser {d.ahead.toLocaleString("en-US")} ahead
              </small>
            ) : null}
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
