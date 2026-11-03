"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture } from "@/components/Culture";
import { loadEngine } from "@/engine";
import { getAllColonies, getAllLedger, getCheckpoints, getEarnings, getRules, getState } from "@/lib/chain";
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
    setMsg("Reading the contract: rules, state, colonies, every planting and every checkpoint…");
    try {
      await loadEngine();
      const [rules, state] = await Promise.all([getRules(), getState()]);
      // Read everything up to the counts in this one state, so a planting that lands mid-read cannot skew the replay.
      const [colonies, ledger, allCheckpoints, earnings] = await Promise.all([
        getAllColonies(state.colonies),
        getAllLedger(Number(state.ledger)),
        getCheckpoints(0, 2000),
        getEarnings(0, 2000),
      ]);
      const plants = ledger.filter((e) => "Plant" in e);
      const checkpoints = allCheckpoints.filter((c) => Number(c.generation) <= Number(state.generation));
      if (id !== runId.current) return;
      setPalette(new Map(colonies.map((c) => [c.id, c.color])));
      setCounts({ plants: plants.length, colonies: colonies.length, checkpoints: checkpoints.length });
      const r = new Replayer({ rules, state, colonies, ledger, checkpoints, earnings: earnings.slice(0, colonies.length) });
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
          // A background tab gets no animation frames, so there the replay simply runs to the end.
          const finished = r.run(document.hidden ? r.target + 1 : per);
          work += performance.now() - a;
          setGen(r.generation);
          setFrame({ cells: r.e.cells(), prev, at: performance.now() });
          setLog(r.log.slice(-60));
          if (finished) resolve();
          else if (document.hidden) setTimeout(tick, 0);
          else requestAnimationFrame(tick);
        };
        if (document.hidden) setTimeout(tick, 0);
        else requestAnimationFrame(tick);
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

  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  const pct = target > 0 ? Math.min(100, (100 * gen) / target) : 0;
  const checkpointLog = useMemo(() => log.filter((l) => l.text.startsWith("Checkpoint")).reverse(), [log]);

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
              stroke={phase === "done" ? (allOk ? "#9fd8a8" : "#ff8f7f") : "#f2b45a"}
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
            <small>of {target ? target.toLocaleString("en-US") : "—"} generations</small>
          </h2>
          <p className={s.msg}>{msg}</p>
          {phase !== "idle" && (
            <p className={s.inputs}>
              <span className="num">{counts.plants.toLocaleString("en-US")}</span> plantings,{" "}
              <span className="num">{counts.colonies}</span> colonies and{" "}
              <span className="num">{counts.checkpoints}</span> checkpoints read from{" "}
              <a href={accountUrl(CONTRACT)}>{CONTRACT}</a> on NEAR {NETWORK}.
            </p>
          )}
          {phase === "done" && (
            <div className={`${s.verdict} ${allOk ? s.good : s.badV}`}>
              <b>{allOk ? "Everything matches." : "Something differs."}</b>
              <span>
                {allOk
                  ? `Your browser rebuilt every cell, every owner and every PETRI from the plant log alone, and arrived where the contract is. The engine itself needed ${ms} ms.`
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
              <li key={c.id} className={c.ok === null ? s.wait : c.ok ? s.pass : s.fail}>
                <i aria-hidden="true">{c.ok === null ? "" : c.ok ? "✓" : "✕"}</i>
                <div>
                  <b>{c.label}</b>
                  <dl>
                    <div><dt>Contract</dt><dd>{c.expected || "—"}</dd></div>
                    <div><dt>Your browser</dt><dd>{c.got ?? "waiting for the replay"}</dd></div>
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
            {checkpointLog.length === 0 && <li className="muted">Checkpoints appear here as the replay reaches them.</li>}
          </ol>
        </div>
      </div>
    </section>
  );
}

const PLACEHOLDER: Check[] = [
  { id: "chain", label: "History chain", expected: "", got: null, ok: null },
  { id: "board", label: "Board hash: every cell and its owner", expected: "", got: null, ok: null },
  { id: "checkpoints", label: "Checkpoints every 240 generations", expected: "", got: null, ok: null },
  { id: "prices", label: "Every planting paid the formula's price", expected: "", got: null, ok: null },
  { id: "agar", label: "PETRI left in the agar", expected: "", got: null, ok: null },
  { id: "sold", label: "PETRI sold from the agar for NEAR", expected: "", got: null, ok: null },
  { id: "burned", label: "PETRI burned by planting", expected: "", got: null, ok: null },
  { id: "returned", label: "PETRI returned to the agar", expected: "", got: null, ok: null },
  { id: "keeper", label: "PETRI set aside for keepers", expected: "", got: null, ok: null },
  { id: "earned", label: "Every colony's lifetime earnings", expected: "", got: null, ok: null },
];
