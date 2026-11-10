"use client";

import { Amount } from "./Amount";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture } from "@/components/Culture";
import { loadEngine } from "@/engine";
import { forReplay, readDishAt } from "@/lib/netread";
import { Replayer, type Check } from "@/lib/replay";
import { CONTRACT, NETWORK, REPO, accountUrl } from "@/lib/config";
import { VERIFY } from "@/lib/facts";
import s from "./verify.module.css";

type Phase = "idle" | "fetching" | "replaying" | "done" | "error";

export function VerifyRun() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [gen, setGen] = useState(0);
  const [target, setTarget] = useState(0);
  const [frame, setFrame] = useState<{ cells: Uint16Array; prev: Uint16Array; at: number } | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [log, setLog] = useState<{ generation: number; text: string; ok: boolean }[]>([]);
  const [palette, setPalette] = useState<Map<number, number>>(new Map());
  const [counts, setCounts] = useState({ plants: 0, colonies: 0, checkpoints: 0 });
  const [ms, setMs] = useState(0);
  const runId = useRef(0);
  /** The first run reuses a read another page made in the last two minutes; a replay asked for again reads anew. */
  const fresh = useRef(false);
  /** Seconds until an automatic retry after a failed read (null when none is waiting), and how many have run. */
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const retries = useRef(0);

  const run = useCallback(async () => {
    const id = ++runId.current;
    setRetryIn(null);
    setPhase("fetching");
    setChecks([]);
    setLog([]);
    setMsg("Reading the contract at one final block: rules, state, colonies, slides and the whole ledger…");
    try {
      await loadEngine();
      // Every read comes from one final block, through the site's cache, and is shared with /judges, /coin and
      // /records for two minutes; "Replay it again" reads a newer block.
      const full = await readDishAt(NETWORK, { fresh: fresh.current });
      fresh.current = true;
      const { rules, state, colonies, ledger, slides } = full;
      const { earnings, winnings, lock } = forReplay(full);
      const plants = ledger.filter((e) => "Plant" in e);
      const tides = ledger.filter((e) => "Tide" in e);
      if (id !== runId.current) return;
      setPalette(new Map(colonies.map((c) => [c.id, c.color])));
      setCounts({ plants: plants.length, colonies: colonies.length, checkpoints: tides.length + 1 });
      const r = new Replayer({ rules, state, colonies, ledger, earnings: earnings.slice(0, colonies.length), winnings: winnings.slice(0, colonies.length), slides, lock });
      setTarget(r.target);
      setPhase("replaying");
      setMsg("Replaying from generation zero with petri-core…");
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Spread the replay over about four seconds so you can watch the dish grow; it would take a fraction of that.
      const per = reduce ? r.target + 1 : Math.max(1, Math.ceil(r.target / 240));
      const t0 = performance.now();
      let work = 0;
      await new Promise<void>((resolve) => {
        const tick = () => {
          if (id !== runId.current) return resolve();
          const prev = r.e.cells();
          const a = performance.now();
          // A hidden tab runs the replay to the end at once; a visible one spreads it out so you can watch.
          const finished = r.run(document.hidden ? r.target + 1 : per);
          work += performance.now() - a;
          setGen(r.generation);
          setFrame({ cells: r.e.cells(), prev, at: performance.now() });
          setLog(r.log.slice(-60));
          // Timers rather than animation frames: some browsers and embedded panes never deliver frames to a page they
          // consider hidden, and the replay must finish anyway.
          if (finished) resolve();
          else setTimeout(tick, document.hidden ? 0 : 16);
        };
        setTimeout(tick, 0);
      });
      if (id !== runId.current) return;
      setMs(Math.round(work));
      setChecks(r.checks());
      setLog(r.log.slice());
      setPhase("done");
      retries.current = 0;
      setMsg(`Replayed ${r.target.toLocaleString("en-US")} generations in ${((performance.now() - t0) / 1000).toFixed(1)} s on screen.`);
      r.free();
    } catch (e) {
      if (id !== runId.current) return;
      setPhase("error");
      const raw = e instanceof Error ? e.message : String(e);
      // A read that failed is nearly always the public RPC refusing a busy address: say so, and try again by itself.
      const busy = /fetch|network|RPC|busy|429|5\d\d|timed? ?out|abort|provider|cache/i.test(raw);
      setMsg(busy ? "NEAR's public RPC is busy right now, so the ledger could not be read." : `The replay stopped: ${raw}`);
      if (busy && retries.current < 4) {
        retries.current++;
        setRetryIn(10);
      }
    }
  }, []);

  // The automatic retry's countdown.
  useEffect(() => {
    if (retryIn === null) return;
    if (retryIn <= 0) {
      setRetryIn(null);
      run();
      return;
    }
    const t = setTimeout(() => setRetryIn((n) => (n === null ? null : n - 1)), 1000);
    return () => clearTimeout(t);
  }, [retryIn, run]);

  useEffect(() => {
    run();
    return () => {
      runId.current++;
    };
  }, [run]);

  // The replay proves the history; the lock is a separate fact about the account, reported on its own.
  const lock = checks.find((c) => c.id === "lock");
  const replayOk = checks.length > 0 && checks.every((c) => c.ok || c.id === "lock");
  const allOk = replayOk && (!lock || lock.ok === true);
  const pct = target > 0 ? Math.min(100, (100 * gen) / target) : 0;
  const checkpointLog = useMemo(() => log.filter((l) => l.text.startsWith("Tide")).reverse(), [log]);
  const real = checks.filter((c) => c.id !== "lock");
  const passed = real.filter((c) => c.ok).length;
  const total = real.length || VERIFY.checks;

  // The verdict leads the page: waiting while the replay runs, then the answer, beside the dish on a desktop and above it
  // on a phone.
  const verdict =
    phase === "done" ? (
      <div className={`${s.verdict} ${allOk ? s.good : replayOk ? s.warnV : s.badV}`}>
        <b>{allOk ? "Everything matches." : replayOk ? "The whole history matches." : "Something differs."}</b>
        <span className={s.verdictCount}>
          <span className="num">{passed}</span> of <span className="num">{total}</span> checks match
          {lock ? <>, plus {VERIFY.notes === 1 ? "one note" : `${VERIFY.notes} notes`} on the contract&rsquo;s key</> : null}
        </span>
        <span>
          {replayOk
            ? `Your browser rebuilt every cell, every owner, every PETRI and every NEAR of the vault from the ledger alone, and arrived where the contract is. The engine itself needed ${ms} ms.${allOk ? "" : " The contract account has one full-access key, held by the team so a bug can be fixed; it is disclosed in the last row."}`
            : "A value below came out differently. That is either a bug or tampering, and either way it is worth reporting."}
        </span>
      </div>
    ) : phase === "error" ? (
      <div className={`${s.verdict} ${retryIn !== null ? s.pendingV : s.badV}`}>
        <b>{retryIn !== null ? `NEAR's public RPC is busy, retrying in ${retryIn} s` : "The replay could not finish."}</b>
        <span>
          {msg} Or run it from a terminal, where nothing is shared with other visitors: <code>node scripts/verify.mjs{NETWORK === "mainnet" ? " --network mainnet" : ""}</code>{" "}
          (<a href={`${REPO}/blob/main/scripts/verify.mjs`}>the script</a>).
        </span>
      </div>
    ) : (
      <div className={`${s.verdict} ${s.pendingV}`} aria-busy="true">
        <b>{phase === "replaying" ? `Replaying… ${Math.floor(pct)}%` : "Reading the ledger…"}</b>
        <span className={s.verdictCount}>
          {total} checks waiting for the replay{VERIFY.notes ? `, and ${VERIFY.notes === 1 ? "one note" : `${VERIFY.notes} notes`}` : ""}
        </span>
        <span className={s.verdictTrack} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
      </div>
    );

  return (
    <section className={s.run} aria-labelledby="run-title">
      <div className={s.stage}>
        <div className={s.verdictSlot} aria-live="polite">{verdict}</div>
        <div className={s.dish}>
          <Culture
            width={128}
            height={128}
            cells={frame?.cells}
            prevCells={frame?.prev}
            changedAt={frame?.at ?? 0}
            palette={palette}
            look="macro"
            round
            transitionMs={120}
            label={`The dish rebuilt in your browser, generation ${gen}`}
          />
          <svg className={s.progress} viewBox="0 0 100 100" aria-hidden="true">
            <circle cx="50" cy="50" r="49" fill="none" stroke="rgba(243,233,218,0.12)" strokeWidth="0.8" />
            <circle
              cx="50"
              cy="50"
              r="49"
              fill="none"
              stroke={phase === "done" ? (replayOk ? "#9fd8a8" : "#ff8f7f") : "#f2b45a"}
              strokeWidth="1.2"
              strokeDasharray={`${(pct / 100) * 307.9} 400`}
              transform="rotate(-90 50 50)"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className={s.readout} aria-live="polite">
          <h2 id="run-title" className={s.genNum}>
            <span className="num">{gen.toLocaleString("en-US")}</span>
            <small>of {target ? target.toLocaleString("en-US") : "—"} generations, the last one the contract stored</small>
          </h2>
          <p className={s.msg}>{msg}</p>
          {phase !== "idle" && (
            <p className={s.inputs}>
              <span className="num">{counts.plants.toLocaleString("en-US")}</span> {counts.plants === 1 ? "planting" : "plantings"},{" "}
              <span className="num">{counts.colonies}</span> {counts.colonies === 1 ? "colony" : "colonies"} and{" "}
              <span className="num">{counts.checkpoints}</span> {counts.checkpoints === 1 ? "checkpoint" : "checkpoints"} ({counts.checkpoints === 1 ? "generation zero; no tide yet" : "generation zero and every tide"}) read from{" "}
              <a href={accountUrl(CONTRACT)}>{CONTRACT}</a> on NEAR {NETWORK}.
            </p>
          )}
          <div className={s.actions}>
            <button className="btn btn-amber" onClick={run} disabled={phase === "fetching" || phase === "replaying"}>
              {phase === "done" || phase === "error" ? "Replay it again" : "Replaying…"}
            </button>
            <a className="btn btn-ghost" href={`${REPO}/blob/main/scripts/verify.mjs`}>Run it from a terminal</a>
          </div>
        </div>
      </div>

      <div className={s.cols}>
        <div>
          <h3 className="h3">What was checked</h3>
          <ul className={s.checks}>
            {(checks.length ? checks : PLACEHOLDER).map((c) => (
              // The lock is a step still to come, not a mismatch, so it waits in amber rather than failing in red.
              <li key={c.id} className={c.ok === null ? s.wait : c.ok ? s.pass : c.id === "lock" ? s.pending : s.fail}>
                <i aria-hidden="true">{c.ok === null ? "" : c.ok ? "✓" : c.id === "lock" ? "!" : "✕"}</i>
                <div>
                  <b>{c.label}</b>
                  <dl>
                    <div><dt>On chain</dt><dd>{c.expected ? <Amount text={c.expected} /> : "—"}</dd></div>
                    <div><dt>Replay or rule</dt><dd>{c.got !== null && c.got !== undefined ? <Amount text={c.got} /> : "waiting for the replay"}</dd></div>
                  </dl>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="h3">Checkpoints, as they were met</h3>
          <ol className={s.log}>
            {checkpointLog.map((l) => (
              <li key={l.generation} className={l.ok ? s.pass : s.fail}>
                <span className="num">{l.generation.toLocaleString("en-US")}</span>
                {l.ok ? "chain matches" : "chain differs"}
              </li>
            ))}
            {checkpointLog.length === 0 && <li className="muted">Tides appear here as the replay reaches them: each one checks the history chain and the NEAR it paid.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}

const PLACEHOLDER: Check[] = [
  ["chain", "History chain"],
  ["board", "Board hash: every cell and its owner"],
  ["live", "Living cells"],
  ["legal", "Every planting was legal, sieges marked"],
  ["prices", "Every planting paid the formula's price"],
  ["fees", "Every planting paid its cell fee"],
  ["licences", "Every licensed planting was a slide of at least 12 cells (the licence minimum), its pattern, and paid the holder of the day (or the agar, for a planter that never attached NEAR or holds kept PETRI beyond the cost)"],
  ["buys", "Every purchase followed the agar's curve"],
  ["sells", "Every sale back followed the curve and the allowance, and none was the house's"],
  ["specimens", "Specimens: every slide is its colony's own cells as the dish stood"],
  ["slide_holders", "Every slide's holder and the royalties it was paid"],
  ["tides", "Every tide: ran when due, chain and stored bytes; its share of the vault, split, bounty (none to the house) and storage worked out from the ledger"],
  ["claims", "Every claim took exactly what its colony was owed"],
  ["refunds", "Every refund is for exactly the payout it names, once"],
  ["kept", "No colony holding kept PETRI (earned before its first NEAR, or bought with credit) sold PETRI for NEAR, claimed NEAR or paid for a pact"],
  ["kept_each", "Every colony's kept PETRI, from the ledger"],
  ["pacts", "Every pact kept to the rules (at least 1 PETRI; 8 pacts and own offers, 16 offers received), and no planting broke a pact binding its colony"],
  ["pact_escrow", "PETRI the dish holds for pact offers not yet accepted"],
  ["agar", "PETRI left in the agar"],
  ["sold", "PETRI sold from the agar for NEAR"],
  ["burned", "PETRI burned by planting, by specimen slides and by unregistering"],
  ["royalties", "PETRI paid to slide holders in royalties"],
  ["returned", "PETRI returned to the agar by planting"],
  ["bought_back", "PETRI bought back by the agar"],
  ["keeper", "PETRI set aside for keepers"],
  ["earned", "Every colony's lifetime PETRI earnings"],
  ["vault", "NEAR in the tide vault"],
  ["near_in", "NEAR paid in by players"],
  ["near_tides", "NEAR paid out at tides"],
  ["won", "Every colony's NEAR won at tides"],
  ["credit_given", "Credit sponsored, from the ledger"],
  ["credit_spent", "Credit spent in the dish, from the ledger"],
  ["credit_reclaimed", "Credit taken back by its sponsors, from the ledger"],
  ["tides_owed", "NEAR won and not yet claimed, from the ledger"],
  ["pending", "Pending NEAR, from the ledger"],
  ["solvent", "The contract's NEAR covers everything it owes, as the ledger counts it"],
  ["lock", "Nobody can change the contract: no full-access key"],
].map(([id, label]) => ({ id, label, expected: "", got: null, ok: null }));
