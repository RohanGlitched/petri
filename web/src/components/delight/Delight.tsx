"use client";
// The doors into the delight features, small enough to load with the page: a Cinema button (and the C key), the
// sound toggle, and on the dish a Time-lapse button. Cinema, the recorder and the audio engine load only when used.
//
//   <DishDelight mine={id} ear={fn} />  the dish page's row, beside the zoom buttons
//   <HeroDelight />                     the home hero's corner
// /dish?cinema=1 opens cinema straight away (cinema=clean hides every control, cinema=fast starts in fast-forward,
// colony=<id> keeps coming back to one colony), for recording the demo.

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveFeed } from "./live-feed";
import { SoundToggle } from "./SoundToggle";
import { setSound, useSound } from "./sound-store";
import type { CinemaProps } from "./Cinema";
import s from "./delight.module.css";

const Cinema = lazy(() => import("./Cinema"));
const TimelapsePanel = lazy(() => import("./TimelapsePanel"));

const film = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="3.5" width="9.5" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M11 7l3.5-2v6L11 9z" fill="currentColor" />
  </svg>
);
const dot = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <circle cx="6" cy="6" r="4.5" fill="#ff6a4d" />
  </svg>
);

/** One owner of the C key per page. */
let keyOwner: symbol | null = null;

function useCinema(opts: { mine?: number | null }) {
  const [open, setOpen] = useState<null | Omit<CinemaProps, "onClose">>(null);
  const me = useRef(Symbol("cinema"));
  const soundState = useSound();
  const soundOn = useRef(soundState.on);
  soundOn.current = soundState.on;
  const show = useCallback((extra: Partial<CinemaProps> = {}) => setOpen({ mine: opts.mine ?? null, ...extra }), [opts.mine]);

  useEffect(() => {
    const id = me.current;
    if (!keyOwner) keyOwner = id;
    const k = (e: KeyboardEvent) => {
      if (keyOwner !== id || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.tagName === "SELECT" || t?.isContentEditable) return;
      if (e.key === "c" || e.key === "C") {
        setOpen((o) => (o ? o : { mine: opts.mine ?? null }));
      } else if ((e.key === "m" || e.key === "M") && !document.querySelector("[aria-label^='Cinema']")) {
        setSound(!soundOn.current);
      }
    };
    window.addEventListener("keydown", k);
    // Opened from the address, for recording.
    const q = new URLSearchParams(window.location.search);
    const c = q.get("cinema");
    if (c && keyOwner === id) {
      const colony = Number(q.get("colony")) || null;
      setOpen({ mine: opts.mine ?? null, clean: c === "clean", fast: c === "fast", focus: colony });
    }
    return () => {
      window.removeEventListener("keydown", k);
      if (keyOwner === id) keyOwner = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const node =
    open && typeof document !== "undefined"
      ? createPortal(
          <Suspense fallback={null}>
            <Cinema {...open} mine={opts.mine ?? open.mine} onClose={() => setOpen(null)} />
          </Suspense>,
          document.querySelector(".site") ?? document.body,
        )
      : null;
  return { show, node, open: !!open };
}

const cinemaButton = (show: () => void, label = "Cinema") => (
  <button type="button" className={s.pill} onClick={() => show()} title="Watch the live dish full screen, with a camera that follows the action (C)">
    {film}
    <span>{label}</span>
    <span className={s.kbd} aria-hidden="true">C</span>
  </button>
);

/** The dish page's row: cinema, sound and time-lapse. */
export function DishDelight({ mine, ear }: { mine?: number | null; ear?: () => number | undefined }) {
  useLiveFeed({ mine, ear });
  const cinema = useCinema({ mine });
  const [rec, setRec] = useState(false);
  useEffect(() => {
    if (!rec) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setRec(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [rec]);
  return (
    <>
      <div className={s.row}>
        {cinemaButton(() => cinema.show())}
        <SoundToggle />
        <button type="button" className={s.pill} aria-pressed={rec} onClick={() => setRec((r) => !r)} title="Record the next generations, or the ones you watched, as a video">
          {dot}
          <span>Time-lapse</span>
        </button>
      </div>
      {rec &&
        createPortal(
          <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 900, width: "min(420px, calc(100vw - 32px))", maxHeight: "calc(100vh - 96px)", overflow: "auto" }}>
            <Suspense fallback={null}>
              <TimelapsePanel onClose={() => setRec(false)} focus={null} mine={mine ?? null} />
            </Suspense>
          </div>,
          document.querySelector(".site") ?? document.body,
        )}
      {cinema.node}
    </>
  );
}

/** The home hero's corner: cinema and sound. */
export function HeroDelight() {
  useLiveFeed();
  const cinema = useCinema({});
  // Only on the opening view: as the hero pulls back, its captions take this corner.
  const [away, setAway] = useState(false);
  useEffect(() => {
    const on = () => setAway(window.scrollY > window.innerHeight * 0.12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // On a phone the corner is hidden (it would float over the headline); HeroTools, in the hero's own flow, opens this
  // cinema through an event.
  const show = cinema.show;
  useEffect(() => {
    const open = () => show();
    window.addEventListener("petri:cinema", open);
    return () => window.removeEventListener("petri:cinema", open);
  }, [show]);
  return (
    <div className={`${s.heroDock} ${away ? s.away : ""}`}>
      <SoundToggle compact />
      {cinemaButton(() => cinema.show(), "Watch in cinema")}
      {cinema.node}
    </div>
  );
}

/** The phone's hero tools, in the flow under the numbers: cinema and sound, beside "Skip the zoom". */
export function HeroTools() {
  return (
    <span className={s.heroTools}>
      {cinemaButton(() => window.dispatchEvent(new Event("petri:cinema")), "Cinema")}
      <SoundToggle compact />
    </span>
  );
}
