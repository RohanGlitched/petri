"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture } from "@/components/Culture";
import { loadEngine } from "@/engine";
import { getAllColonies, getAllLedger, getEarnings, getLock, getRules, getState, getTideWinnings, pinFinalBlock } from "@/lib/chain";
import { Replayer, type Check } from "@/lib/replay";
import { CONTRACT, NETWORK, REPO, accountUrl } from "@/lib/config";
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

  const run = useCallback(async () => {
    const id = ++runId.current;
    setPhase("fetching");
    setChecks([]);
    setLog([]);
    setMsg("Reading the contract at one final block: rules, state, colonies and the whole ledger…");
    try {
      await loadEngine();
      // Every read below comes from the same final block, so nothing can land between them.
      await pinFinalBlock();
      let rules, state, colonies, ledger, earnings, winnings, lock;
      try {
        [rules, state] = await Promise.all([getRules(), getState()]);
        [colonies, ledger, earnings, winnings, lock] = await Promise.all([
          getAllColonies(state.colonies),
          getAllLedger(Number(state.ledger)),
          getEarnings(0, 2000),
          getTideWinnings(0, 2000),
          getLock().catch(() => null),
        ]);
      } finally {
        await pinFinalBlock(false);
      }
      const plants = ledger.filter((e) => "Plant" in e);
      const tides = ledger.filter((e) => "Tide" in e);
      if (id !== runId.current) return;
      setPalette(new Map(colonies.map((c) => [c.id, c.color])));
      setCounts({ plants: plants.length, colonies: colonies.length, checkpoints: tides.length + 1 });
      const r = new Replayer({ rules, state, colonies, ledger, earnings: earnings.slice(0, colonies.length), winnings: winnings.slice(0, colonies.length), lock });
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
      setMsg(`Replayed ${r.target.toLocaleString("en-US")} generations in ${((performance.now() - t0) / 1000).toFixed(1)} s on screen.`);
      r.free();
    } catch (e) {
      if (id !== runId.current) return;
      setPhase("error");
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

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

  return (
    <section className={s.run} aria-labelledby="run-title">
      <div className={s.stage}>
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
          {phase === "done" && (
            <div className={`${s.verdict} ${allOk ? s.good : replayOk ? s.warnV : s.badV}`}>
              <b>{allOk ? "Everything matches." : replayOk ? "The whole history matches." : "Something differs."}</b>
              <span>
                {replayOk
                  ? `Your browser rebuilt every cell, every owner, every PETRI and every NEAR of the vault from the ledger alone, and arrived where the contract is. The engine itself needed ${ms} ms.${allOk ? "" : " One thing is not done yet: the contract account still has a full-access key, so its code could still be replaced. It is deleted before judging; after that this page shows the contract as locked."}`
                  : "A value below came out differently. That is either a bug or tampering, and either way it is worth reporting."}
              </span>
            </div>
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
                    <div><dt>On chain</dt><dd>{c.expected || "—"}</dd></div>
                    <div><dt>Replay or rule</dt><dd>{c.got ?? "waiting for the replay"}</dd></div>
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
  ["buys", "Every purchase followed the agar's curve"],
  ["sells", "Every sale back followed the curve"],
  ["tides", "Every tide: chain, share of the vault and split"],
  ["agar", "PETRI left in the agar"],
  ["sold", "PETRI sold from the agar for NEAR"],
  ["burned", "PETRI burned by planting"],
  ["returned", "PETRI returned to the agar by planting"],
  ["bought_back", "PETRI bought back by the agar"],
  ["keeper", "PETRI set aside for keepers"],
  ["earned", "Every colony's lifetime PETRI earnings"],
  ["vault", "NEAR in the tide vault"],
  ["near_in", "NEAR paid in by players"],
  ["near_tides", "NEAR paid out at tides"],
  ["won", "Every colony's NEAR won at tides"],
  ["lock", "Nobody can change the contract: no full-access key"],
].map(([id, label]) => ({ id, label, expected: "", got: null, ok: null }));
