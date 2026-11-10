"use client";

import { setSound, setVolume, useSound } from "./sound-store";
import s from "./delight.module.css";

const speaker = (on: boolean) => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
    {on ? (
      <path d="M10.4 5.4a3.6 3.6 0 0 1 0 5.2M12.3 3.6a6.2 6.2 0 0 1 0 8.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    ) : (
      <path d="M10.6 6.2l3.4 3.6M14 6.2l-3.4 3.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    )}
  </svg>
);

/** "The dish sings": off by default, remembered, with a volume slider while it is on. */
export function SoundToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  const st = useSound();
  const playing = st.on && !st.waiting && !st.loading;
  return (
    <span className={`${s.sound} ${st.on ? s.on : ""} ${playing ? s.playing : ""} ${className ?? ""}`}>
      <button
        type="button"
        className={s.pill}
        aria-pressed={st.on}
        onClick={() => setSound(!st.on)}
        title={st.on ? "Turn the dish's sound off (M)" : "Let the dish sing: every birth and death on the board becomes a note (M)"}
      >
        {playing ? (
          <span className={s.bars} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        ) : (
          speaker(st.on)
        )}
        {compact ? <span className="sr">{st.on ? "Sound on" : "Sound off"}</span> : <span>{st.on ? (st.waiting ? "Sound on" : "Sound") : "Sound"}</span>}
        {st.loading && <i className={s.spin} aria-hidden="true" />}
        {st.on && st.waiting && !compact && <span className={s.waiting}>click to start</span>}
      </button>
      <span className={s.vol}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={st.volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume"
          tabIndex={st.on ? 0 : -1}
        />
      </span>
    </span>
  );
}
