"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive, int } from "@/lib/live";
import { getLock } from "@/lib/chain";
import { CONTRACTS, REPO } from "@/lib/config";
import { useNet } from "@/lib/use-net";
import s from "./rules.module.css";

const CHAIN_EVERY = 16;
/** The SHA-256 (base58) of `cargo near build reproducible-wasm` of contract/ at the deployed commit (as in scripts/verify.mjs). */
const BUILD_HASH = "7GNyLTrzbFSmSxVp92Ne7bVXaKpUtxPsMYGqtx9ULuaS";
const LOCK_COMMAND = `near account delete-keys ${CONTRACTS.testnet} public-keys ed25519:CDu2wUQhzNN3JKwHcduXqjS5TLSM78WVhowgPByum4LE network-config testnet sign-with-legacy-keychain send`;

const CHECKS = [
  "History chain",
  "Board hash",
  "Living cells",
  "Every planting legal, sieges marked",
  "Every planting at the formula's price",
  "Every purchase on the curve",
  "Every sale back on the curve",
  "Every tide: chain, pay and split",
  "PETRI in the agar",
  "PETRI sold",
  "PETRI burned",
  "PETRI returned by planting",
  "PETRI bought back",
  "Keeper share",
  "Every colony's PETRI earnings",
  "NEAR in the vault",
  "NEAR paid in",
  "NEAR paid at tides",
  "Every colony's NEAR winnings",
  "Deployed code hash (terminal only)",
  "No full-access key",
];

function useLock() {
  const [lock, setLock] = useState<{ codeHash: string; fullAccessKeys: number } | null>(null);
  useEffect(() => {
    let live = true;
    getLock()
      .then((l) => live && setLock(l))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return lock;
}

export function VerifySection() {
  const { d, rules, ready } = useLive();
  const net = useNet();
  const st = d.state;
  const lock = useLock();
  const stored = st ? Number(st.generation) : 0;
  const tideEvery = rules?.tide_every ?? 240;
  const toFold = ready ? CHAIN_EVERY - (d.generation % CHAIN_EVERY) : 0;
  return (
    <section id="verify" className={`band ${s.section}`} aria-labelledby="verify-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="verify-title" className={s.h2}>Check every generation, and every yoctoNEAR, yourself</h2>
          <p className="lede">
            The contract keeps a running hash of the board&rsquo;s history and one ordered ledger of every join, purchase, sale,
            planting and tide, with the PETRI and the NEAR each moved. Anyone can replay that ledger from generation zero and
            arrive at the same board, agar, vault and earnings for every colony, or find the first place where they differ.
          </p>
        </div>

        <div className={s.split}>
          <div className={s.prose}>
            <h3 className="h3">The hashes</h3>
            <pre className={s.formula}>
              {`board hash = sha256(width ‖ height ‖ for every live cell, in index order: index ‖ owner)
chain      = sha256(previous chain ‖ generation ‖ board hash)`}
            </pre>
            <p>
              Width and height are 16-bit, the index 32-bit, the owner 16-bit and the generation 64-bit, all little-endian. The
              chain starts as 32 zero bytes and folds in the board every {CHAIN_EVERY}th generation, once every four minutes.
              Every tide, once every {tideEvery} generations, writes the chain into its <code className={s.code}>Tide</code>{" "}
              ledger entry; the <code className={s.code}>checkpoints</code> view lists generation 0 and every tide.
            </p>
            <h3 className="h3">The replay</h3>
            <ol className={s.steps}>
              <li>Start from an empty board at generation 0, a chain of zeros, an agar holding the whole supply and an empty vault.</li>
              <li>
                For each generation, apply its ledger entries in order. A join adds a colony. A purchase and a sale are checked
                against the curve. A planting is checked for legality and its siege flag, must cost the formula&rsquo;s price,
                and adds its NEAR to the vault. A tide must carry the same chain and pay the same share, split the same way.
              </li>
              <li>Step once with petri-core and feed the living, with the reach cap, the house and the keeper&rsquo;s share.</li>
              <li>At the end, compare every counter and every colony&rsquo;s PETRI earnings and NEAR winnings with the contract.</li>
            </ol>
            <p>
              The terminal script <code className={s.code}>node scripts/verify.mjs</code> pins every read to one final block and
              runs {CHECKS.length} checks. The <Link className={s.link} href="/verify">verify page</Link> runs the same replay in
              your browser, also pinned to one block, and shows the same checks except the code hash. The contract test{" "}
              <code className={s.code}>replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault</code> does it in Rust.
            </p>
            <details className={s.fold}>
              <summary>
                The {CHECKS.length} checks <small>scripts/verify.mjs</small>
              </summary>
              <div className={s.foldBody}>
                <ol className={s.steps}>
                  {CHECKS.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ol>
              </div>
            </details>
            <p className={s.spaced}>
              <Link className="btn btn-amber" href="/verify">Replay from genesis</Link>
            </p>
          </div>
          <div className={s.hashes}>
            <div className={s.hashCard}>
              <span className="muted small">Your browser&rsquo;s chain at generation {ready ? int(d.generation) : "—"}</span>
              <code className={s.hash}>{d.chain || "reading the dish"}</code>
              <span className="muted small">{ready ? `Next fold in ${toFold} generation${toFold === 1 ? "" : "s"}.` : ""}</span>
            </div>
            <div className={s.hashCard}>
              <span className="muted small">The contract&rsquo;s chain at stored generation {st ? int(stored) : "—"}</span>
              <code className={s.hash}>{st?.chain ?? "reading the dish"}</code>
            </div>
            <dl className={s.stats}>
              <div className={s.stat}>
                <dt>Tides (checkpoints)</dt>
                <dd className="num">{st ? int(Number(st.tides)) : "—"}</dd>
              </div>
              <div className={s.stat}>
                <dt>Entries in the ledger</dt>
                <dd className="num">{st ? int(Number(st.ledger)) : "—"}</dd>
              </div>
              <div className={s.stat}>
                <dt>Of which plantings</dt>
                <dd className="num">{st ? int(Number(st.plants)) : "—"}</dd>
              </div>
              <div className={s.stat}>
                <dt>Colonies</dt>
                <dd className="num">{st ? int(st.colonies) : "—"}</dd>
              </div>
            </dl>
            <div className={s.card}>
              <h3 className="h3">The lock</h3>
              <p>
                No method changes a parameter, mints PETRI or edits the board. What remains is the account itself: whoever holds a
                full-access key to <a className={s.link} href={net.contractUrl}>{net.contract}</a> could deploy other code.
              </p>
              <p>
                The code was built with <code className={s.code}>cargo near build reproducible-wasm</code>; its hash is{" "}
                <code className={s.code}>{BUILD_HASH}</code>, and the contract&rsquo;s NEP-330{" "}
                <code className={s.code}>contract_source_metadata</code> names the{" "}
                <a className={s.link} href={REPO}>GitHub</a> commit it came from, so anyone can rebuild it and compare.
              </p>
              <dl className={s.workings}>
                <div>
                  <dt>Deployed code hash</dt>
                  <dd className="num">{lock ? (lock.codeHash === BUILD_HASH ? "matches the build" : "differs from the build") : "—"}</dd>
                </div>
                <div>
                  <dt>Full-access keys now</dt>
                  <dd className="num">{lock ? int(lock.fullAccessKeys) : "—"}</dd>
                </div>
              </dl>
              <p>
                {lock && lock.fullAccessKeys === 0
                  ? "The account has no full-access key, so its code can never change."
                  : "The account still has one full-access key. The team will delete it before judging, so the code can never change; until then the full-access check is the one that fails on /verify and in the terminal." + (net.freePlay ? " The command:" : "")}
              </p>
              {!(lock && lock.fullAccessKeys === 0) && net.freePlay && <pre className={s.formula}>{LOCK_COMMAND}</pre>}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
