"use client";
// The time-lapse recorder's panel: what to record, how long, of what, in which shape, then a preview to download or
// share. Loaded only when opened.

import { useEffect, useMemo, useRef, useState } from "react";
import { useLive, int, hex } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { currentEngine } from "@/lib/dish-store";
import { watchedGenerations } from "./live-feed";
import { SIZES, forecastFrames, formats, renderTimelapse, span, watchedFrames, type Aspect, type Format } from "./timelapse";
import s from "./timelapse.module.css";

type Source = "next" | "watched";
const LENGTHS = [60, 240, 600];

export default function TimelapsePanel({ onClose, focus, mine }: { onClose: () => void; focus: number | null; mine: number | null }) {
  const { d, rules, palette, colonies, w, h } = useLive();
  const net = useNet();
  const fmts = useMemo(() => formats(), []);
  const [source, setSource] = useState<Source>("next");
  const [length, setLength] = useState(240);
  const [subject, setSubject] = useState<number>(focus ?? 0);
  const [aspect, setAspect] = useState<Aspect>("16:9");
  const [fmt, setFmt] = useState<Format | null>(fmts[0] ?? null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<{ url: string; blob: Blob; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [watchedN, setWatchedN] = useState(0);

  useEffect(() => {
    setWatchedN(Math.max(0, watchedGenerations().length - 1));
  }, [d.generation]);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  const alive = colonies.filter((c) => c.live > 0);
  const ordered = [...alive].sort((a, b) => (a.id === mine ? -1 : b.id === mine ? 1 : b.live - a.live));
  const chosen = subject ? d.colonies.find((c) => c.id === subject) ?? null : null;
  const genMs = rules ? Number(rules.generation_ms) : 15000;
  const n = source === "next" ? length : Math.min(240, watchedN);
  const perGen = n <= 60 ? 8 : n <= 240 ? 4 : 2;
  const seconds = Math.round((n * perGen) / 30 + 6.2);

  async function go() {
    setError(null);
    if (result) {
      URL.revokeObjectURL(result.url);
      setResult(null);
    }
    if (!fmt) return setError("This browser cannot record video from a canvas.");
    const base = currentEngine();
    if (source === "next" && !base) return setError("The dish is still being read from NEAR.");
    if (source === "watched" && watchedN < 2) return setError("This tab has not watched enough generations yet.");
    const frames = source === "next" ? forecastFrames(base!, n) : watchedFrames(watchedGenerations(), n);
    const first = frames.first;
    const who = chosen ? chosen.name : "The dish";
    const title = source === "next" ? (chosen ? `${chosen.name}: the next ${int(n)} generations` : `The next ${int(n)} generations`) : chosen ? `${chosen.name}: the last ${int(frames.total)} generations` : `The last ${int(frames.total)} generations`;
    const subtitle =
      source === "next"
        ? `${who} from generation ${int(first)} on NEAR ${net.network}, played ahead by the contract's own rules as if nobody planted: about ${span(n, genMs)} of the dish.`
        : `${who} from generation ${int(first)} to ${int(first + frames.total)}, as this browser watched it live from NEAR ${net.network}.`;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setProgress(0);
    try {
      const blob = await renderTimelapse({
        frames,
        size: SIZES[aspect],
        palette,
        colony: chosen ? { id: chosen.id, name: chosen.name, color: chosen.color } : null,
        w,
        h,
        kicker: `${source === "next" ? "Forecast" : "Time-lapse"} · NEAR ${net.network}`,
        title,
        subtitle,
        perGen,
        format: fmt,
        onProgress: setProgress,
        signal: ctrl.signal,
      });
      const name = `petri-dish-${chosen ? chosen.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" : ""}gen${first}-${source === "next" ? "next" : "last"}${frames.total}.${fmt.ext}`;
      const url = URL.createObjectURL(blob);
      setResult({ url, blob, name });
      (window as unknown as { __petriTimelapse: unknown }).__petriTimelapse = { blob, name, size: blob.size, type: blob.type };
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  const shareUrl = chosen ? `https://www.playpetri.xyz/c/${chosen.id}${net.network === "mainnet" ? "?net=mainnet" : ""}` : "https://www.playpetri.xyz/dish";
  const tweet = `https://x.com/intent/post?text=${encodeURIComponent(chosen ? `${chosen.name} is alive on the Petri dish, a memecoin that runs Conway's Life on NEAR.` : "A memecoin that is alive: Conway's Life on NEAR, every cell owned by an account.")}&url=${encodeURIComponent(shareUrl)}`;
  const canShareFile = typeof navigator !== "undefined" && !!result && !!navigator.canShare?.({ files: [new File([result.blob], result.name, { type: result.blob.type })] });

  return (
    <section className={s.panel} aria-labelledby="tl-title">
      <header className={s.head}>
        <h2 id="tl-title">Time-lapse</h2>
        <button type="button" className={s.x} onClick={onClose} aria-label="Close the time-lapse panel">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
      </header>

      <fieldset className={s.field} disabled={progress !== null}>
        <legend>Record</legend>
        <div className={s.seg}>
          <button type="button" aria-pressed={source === "next"} onClick={() => setSource("next")}>The next generations</button>
          <button type="button" aria-pressed={source === "watched"} onClick={() => setSource("watched")} disabled={watchedN < 2}>
            What this tab watched ({int(watchedN)})
          </button>
        </div>
        <p className={s.hint}>
          {source === "next"
            ? "A copy of this browser's engine plays the contract's rules ahead, as if nobody planted. The live dish is not touched."
            : "The generations this tab has shown since it opened, exactly as read from NEAR."}
        </p>
      </fieldset>

      {source === "next" && (
        <fieldset className={s.field} disabled={progress !== null}>
          <legend>Length</legend>
          <div className={s.seg}>
            {LENGTHS.map((g) => (
              <button key={g} type="button" aria-pressed={length === g} onClick={() => setLength(g)} aria-label={`${g} generations, about ${span(g, genMs)} of the dish`}>
                {g} <small>{span(g, genMs)}</small>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className={s.field} disabled={progress !== null}>
        <legend>Of</legend>
        <label className={s.select}>
          {chosen && <i style={{ background: hex(chosen.color) }} aria-hidden="true" />}
          <select value={subject} onChange={(e) => setSubject(Number(e.target.value))} aria-label="Subject">
            <option value={0}>The whole dish</option>
            {ordered.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id === mine ? "Your colony: " : ""}
                {c.name} ({int(c.live)} cells)
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <div className={s.pair}>
        <fieldset className={s.field} disabled={progress !== null}>
          <legend>Shape</legend>
          <div className={s.seg}>
            {(Object.keys(SIZES) as Aspect[]).map((a) => (
              <button key={a} type="button" aria-pressed={aspect === a} onClick={() => setAspect(a)}>{a}</button>
            ))}
          </div>
        </fieldset>
        {fmts.length > 1 && (
          <fieldset className={s.field} disabled={progress !== null}>
            <legend>Format</legend>
            <div className={s.seg}>
              {fmts.map((f) => (
                <button key={f.ext} type="button" aria-pressed={fmt?.ext === f.ext} onClick={() => setFmt(f)}>{f.label}</button>
              ))}
            </div>
          </fieldset>
        )}
      </div>

      {progress === null ? (
        <button type="button" className={`btn btn-amber btn-small ${s.go}`} onClick={go} disabled={!fmt || (source === "watched" && watchedN < 2)}>
          {result ? "Record again" : `Record ${seconds} seconds of video`}
        </button>
      ) : (
        <div className={s.progress} role="status">
          <div className={s.track}><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
          <span>Recording, {Math.round(progress * 100)}%. Keep this tab in front.</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      )}
      {error && <p className={s.err} role="alert">{error}</p>}

      {result && (
        <div className={s.result}>
          <video src={result.url} controls autoPlay muted loop playsInline className={s.video} />
          <div className={s.actions}>
            <a className="btn btn-amber btn-small" href={result.url} download={result.name}>Download {fmt?.label}</a>
            {canShareFile && (
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={() => navigator.share({ files: [new File([result.blob], result.name, { type: result.blob.type })], title: "Petri Dish", url: shareUrl }).catch(() => {})}
              >
                Share video
              </button>
            )}
            <a className="btn btn-ghost btn-small" href={tweet} target="_blank" rel="noreferrer">Post on X</a>
            {chosen && <a className="btn btn-ghost btn-small" href={`/c/${chosen.id}${net.network === "mainnet" ? "?net=mainnet" : ""}`} target="_blank" rel="noreferrer">Colony card</a>}
          </div>
          <p className={s.hint}>{(result.blob.size / 1e6).toFixed(1)} MB · {result.name}</p>
        </div>
      )}
    </section>
  );
}
