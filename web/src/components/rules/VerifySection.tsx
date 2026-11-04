"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLive, int } from "@/lib/live";
import { getLock } from "@/lib/chain";
import { CONTRACTS, REPO } from "@/lib/config";
import { useNet } from "@/lib/use-net";
import s from "./rules.module.css";
import { PhoneFold } from "./PhoneFold";

const CHAIN_EVERY = 16;
/** The SHA-256 (base58) of `cargo near build reproducible-wasm` of contract/ at the deployed commit (as in scripts/verify.mjs). */
const BUILD_HASH = "5v38VgcibRJesPt6H7h2rwPGmmE5Bi2715vHKSGrvncP";
/** The one full-access key each dish's account still holds, as `view_access_key_list` returns it. */
const FULL_KEYS: Record<"testnet" | "mainnet", string> = {
  testnet: "ed25519:8kGYoPJ6jVEZRrjjYKGVLfXD7LCyTDDqu41Cxx9UjHUu",
  mainnet: "ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH",
};
const lockCommand = (net: "testnet" | "mainnet") =>
  `near account delete-keys ${CONTRACTS[net]} public-keys ${FULL_KEYS[net]} network-config ${net} sign-with-legacy-keychain send`;

/** The rows `node scripts/verify.mjs` prints, in order. */
const CHECKS = [
  "History chain",
  "Board hash",
  "Living cells",
  "Every planting legal, sieges marked",
  "Every planting at the formula's price",
  "Every planting paid its cell fee",
  "Every licensed planting: a slide of at least 12 cells, its exact pattern, the licence price, the royalty to the holder of the day (or the agar, for a planter that never attached NEAR)",
  "Every purchase on the curve",
  "Every sale back on the curve and within the allowance",
  "Every tide: ran exactly when due, chain, stored bytes; shares of the vault and the credit pool, bounty (none to the house) and storage worked out from the ledger",
  "Every claim took exactly what its colony was owed",
  "Every refund is for exactly the payout it names, once",
  "No colony holding kept PETRI sold PETRI for NEAR or paid for a pact",
  "Every pact kept to the rules, and no planting broke a pact binding its colony",
  "PETRI the dish holds for pact offers not yet accepted",
  "Pacts offered",
  "Every specimen slide is its colony's own cells as the dish stood, at the rule's price",
  "Every slide's holder, moves and royalties",
  "PETRI in the agar",
  "PETRI sold",
  "PETRI burned",
  "PETRI burned by specimen slides",
  "PETRI paid to slide holders in royalties",
  "PETRI returned by planting",
  "PETRI bought back",
  "Keeper share",
  "Every colony's PETRI earnings",
  "NEAR in the vault",
  "NEAR paid in",
  "NEAR paid at tides",
  "Vault shares and bounties paid as credit",
  "Sales paid as credit",
  "Every colony's NEAR winnings",
  "Credit in the credit pool",
  "Credit paid at tides",
  "Credit sponsored, from the ledger",
  "Credit spent, from the ledger",
  "Credit taken back by sponsors, from the ledger",
  "NEAR owed to colonies, from the ledger",
  "Pending NEAR, from the ledger",
  "Every colony's credit winnings",
  "Every colony's kept PETRI",
  "The contract's NEAR covers everything it owes, every term rebuilt from the ledger",
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
    <section id="verify" data-section="Verification and the lock" className={`band ${s.section}`} aria-labelledby="verify-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="verify-title" className={s.h2}>Check every generation, and every yoctoNEAR, yourself</h2>
          <p className="lede">
            The contract keeps a running hash of the board&rsquo;s history and one ordered ledger of every join, purchase, sale,
            planting, specimen slide, tide, clock skip, refund, sponsorship, reclaim, claim, pending payment, dust and burn, with
            the PETRI, NEAR and credit each moved. Anyone can replay that ledger from generation zero and arrive at the same
            board, agar, vault, credit pool, credit, pending NEAR and earnings for every colony, or find the first place where
            they differ.
          </p>
        </div>
        <PhoneFold label="The hashes, the replay and the lock">

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
                <li>Start from an empty board at generation 0, a chain of zeros, an agar holding the whole supply, an empty vault and an empty credit pool.</li>
                <li>
                  For each generation, apply its ledger entries in order. A join adds a colony. A purchase and a sale are checked
                  against the curve, and a sale against the allowance. A planting is checked for legality and its siege flag, must
                  cost the formula&rsquo;s price and bring its cell fee, and adds its NEAR to the vault and its credit to the pool.
                  A planting under a slide&rsquo;s licence must name a slide of at least 12 cells, exactly its pattern, moved but not turned, at the
                  licence price, and must have paid the royalty to whoever held the slide then (or the agar, if the planter had never attached NEAR). A slide must hold exactly its
                  colony&rsquo;s living cells in its rectangle and burn the rule&rsquo;s price. A tide must run exactly when some
                  colony outside the house had earned, carry the same chain and stored bytes, pay the same shares of the vault and the pool, as NEAR
                  or as credit to the right colonies, and pay no bounty when the house ran it. A claim must take exactly what its
                  colony was owed, and a refund must match the payout it names. Every colony&rsquo;s kept PETRI is rebuilt, and no colony holding any may sell for NEAR or pay PETRI into a pact. Every pact entry is checked against the pact rules and the escrow, and every planting against the pacts binding its planter.
                </li>
                <li>Step with petri-core and feed the living, with the reach cap on each colony&rsquo;s decaying stake, the house and the keeper&rsquo;s share.</li>
                <li>
                  At the end, compare every counter, every colony&rsquo;s PETRI earnings, NEAR winnings and credit winnings, and
                  every slide&rsquo;s holder, moves and royalties with the contract. Rebuild each term of the solvency check (the
                  vault, the credit pool, credit given, won, sold, spent and taken back, NEAR owed and pending NEAR) from the ledger
                  alone, compare it with the contract&rsquo;s counter, and check that the contract&rsquo;s NEAR covers them.
                </li>
              </ol>
              <p>
                The terminal script <code className={s.code}>node scripts/verify.mjs</code> (add{" "}
                <code className={s.code}>--network mainnet</code> for the mainnet dish) pins every read to one final block and
                prints {CHECKS.length} checks. The <Link className={s.link} href="/verify">verify page</Link> runs the same replay in
                your browser, also pinned to one block, and shows 37 checks covering the same ground, grouped a little
                differently and without the code hash. The contract test{" "}
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
                  No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board. The one way to start over is{" "}
                  <code className={s.code}>relaunch</code>, a private method only the contract account itself can call, which
                  clears a v6 dish and refuses an account with no v6 dish and one that already runs v6.1. What remains is the account itself: whoever holds a
                  full-access key to <a className={s.link} href={net.contractUrl}>{net.contract}</a> could deploy other code.
                </p>
                <p>
                  The code was built with <code className={s.code}>cargo near build reproducible-wasm</code> at commit{" "}
                  <a className={s.link} href={`${REPO}/tree/e791404e63d03c2010bdb216b9792a8559512653`}>e791404</a>; its hash is{" "}
                  <code className={s.code}>{BUILD_HASH}</code>, and the contract&rsquo;s NEP-330{" "}
                  <code className={s.code}>contract_source_metadata</code> names that{" "}
                  <a className={s.link} href={REPO}>GitHub</a> commit, so anyone can rebuild it and compare.
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
                    : "The account still has one full-access key. The team will delete it before judging, so the code can never change; until then the full-access check is the one that fails on /verify and in the terminal, which then exits 1. The command:"}
                </p>
                {!(lock && lock.fullAccessKeys === 0) && <pre className={s.formula}>{lockCommand(net.network)}</pre>}
              </div>
            </div>
          </div>
        </PhoneFold>
      </div>
    </section>
  );
}
