"use client";

import Link from "next/link";
import { useLive, int } from "@/lib/live";
import s from "./rules.module.css";

const CHAIN_EVERY = 16;
const CHECKPOINT_EVERY = 240;

export function VerifySection() {
  const { d, ready } = useLive();
  const st = d.state;
  const stored = st ? Number(st.generation) : 0;
  const toFold = ready ? CHAIN_EVERY - (d.generation % CHAIN_EVERY) : 0;
  const checkpoints = st ? Math.floor(stored / CHECKPOINT_EVERY) + 1 : 0;
  return (
    <section id="verify" className={`band ${s.section}`} aria-labelledby="verify-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="verify-title" className={s.h2}>Check every generation yourself</h2>
          <p className="lede">
            The contract keeps a running hash of the board&rsquo;s whole history. Anyone holding the plant log can replay the dish
            from generation zero and arrive at the same hash, or find the first place where it differs.
          </p>
        </div>

        <div className={s.split}>
          <div className={s.prose}>
            <h3 className="h3">The board hash</h3>
            <pre className={s.formula}>sha256(width ‖ height ‖ for every live cell, in index order: index ‖ owner)</pre>
            <p>Width and height are 16-bit, the index 32-bit and the owner 16-bit, all little-endian.</p>
            <h3 className="h3">The history chain</h3>
            <pre className={s.formula}>chain = sha256(previous chain ‖ generation ‖ board hash)</pre>
            <p>
              The chain starts as 32 zero bytes. It folds in the board after every {CHAIN_EVERY}th generation, once every four
              minutes, with the generation as a 64-bit little-endian number. Every {CHECKPOINT_EVERY} generations, once an hour,
              the contract also stores the chain as a checkpoint you can read with the <code className={s.code}>checkpoints</code>{" "}
              view.
            </p>
            <h3 className="h3">The replay</h3>
            <ol className={s.steps}>
              <li>Start from an empty board at generation 0 and a chain of zeros.</li>
              <li>For each generation, apply the plantings the log records for it, in log order.</li>
              <li>Step once with the petri-core rules.</li>
              <li>If the new generation is a multiple of {CHAIN_EVERY}, fold the board hash into the chain.</li>
              <li>Compare the chain with each stored checkpoint, and at the end with the contract&rsquo;s chain and board hash.</li>
            </ol>
            <p>
              A contract test does exactly this in Rust. The verify page does it in your browser, with the plant log fetched from
              the contract and the same engine compiled to WebAssembly.
            </p>
            <p>
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
            <div className={s.hashCard}>
              <span className="muted small">The contract&rsquo;s board hash at stored generation {st ? int(stored) : "—"}</span>
              <code className={s.hash}>{st?.board_hash ?? "reading the dish"}</code>
            </div>
            <dl className={s.stats}>
              <div className={s.stat}>
                <dt>Checkpoints stored</dt>
                <dd className="num">{st ? int(checkpoints) : "—"}</dd>
              </div>
              <div className={s.stat}>
                <dt>Plantings in the log</dt>
                <dd className="num">{st ? int(Number(st.plants)) : "—"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
}
