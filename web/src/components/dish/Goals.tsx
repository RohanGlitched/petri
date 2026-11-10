"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getSlidesFor, type Colony } from "@/lib/chain";
import { int, petri } from "@/lib/live";
import s from "./dish.module.css";

/** What the page knows about the player's colony, live from the chain and the browser's replay of it. */
export type GoalFacts = {
  me: Colony;
  network: string;
  generation: number;
  live: number;
  /** PETRI units the colony has earned in its life, claimed or not. */
  earned: number;
  /** NEAR or credit won at a tide, claimed or not. */
  wonTide: boolean;
  /** This colony has planted a glider, spaceship or gun (seen by this page, or in the lab log as a siege). */
  launched: boolean;
  /** A slide was minted from this page. */
  minted: boolean;
};

type Saved = { done: string[]; aliveSince: number | null; folded: boolean };

const SURVIVE = 100;

/**
 * First experiments: six small goals for a new colony, ticked off live from the chain and the replay. Progress is kept
 * in this browser per colony, so a goal once met stays met even if the colony later dies.
 */
export function Goals(f: GoalFacts) {
  const key = `petri.goals.${f.network}.${f.me.account}`;
  const [saved, setSaved] = useState<Saved>({ done: [], aliveSince: null, folded: false });
  const loaded = useRef<string | null>(null);
  const [hasSlide, setHasSlide] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setSaved(raw ? { done: [], aliveSince: null, folded: false, ...JSON.parse(raw) } : { done: [], aliveSince: null, folded: false });
    } catch {
      /* this visit only */
    }
    loaded.current = key;
    getSlidesFor(f.me.account, 0, 1)
      .then((sl) => setHasSlide(sl.length > 0))
      .catch(() => {});
  }, [key, f.me.account]);

  // Alive since: the first generation this page saw the colony with living cells, reset if it dies out.
  useEffect(() => {
    if (loaded.current !== key) return;
    setSaved((sv) => {
      const next = f.live > 0 ? sv.aliveSince ?? f.generation : null;
      return next === sv.aliveSince ? sv : { ...sv, aliveSince: next };
    });
  }, [f.live, f.generation, key]);

  const alive = saved.aliveSince !== null && f.live > 0 ? Math.max(0, f.generation - saved.aliveSince) : 0;
  const goals = useMemo(
    () => [
      { id: "plant", label: "Plant your first colony", met: Number(f.me.cells_planted) > 0, note: "Pick a stamp and plant it on open agar." },
      { id: "survive", label: `Survive ${SURVIVE} generations`, met: alive >= SURVIVE, note: f.live > 0 ? `${int(Math.min(alive, SURVIVE))} of ${SURVIVE}, alive without a break` : "Still lifes like the block never die on their own." },
      { id: "earn", label: "Earn your first PETRI", met: f.earned >= 1_000_000, note: `${petri(Math.min(f.earned, 1_000_000), 3)} of 1 PETRI` },
      { id: "glider", label: "Land a glider on a rival", met: f.launched, note: "Plant a glider or spaceship on a course for a rival colony." },
      { id: "tide", label: "Win your first tide", met: f.wonTide, note: "Have cells earning when the hourly tide comes round." },
      { id: "slide", label: "Mint a specimen slide", met: f.minted || hasSlide, note: "Fossilize a patch of your own living cells." },
    ],
    [f.me.cells_planted, alive, f.live, f.earned, f.launched, f.wonTide, f.minted, hasSlide],
  );

  // A goal once met stays met in this browser.
  const done = useMemo(() => new Set([...saved.done, ...goals.filter((g) => g.met).map((g) => g.id)]), [saved.done, goals]);
  useEffect(() => {
    if (loaded.current !== key) return;
    const ids = [...done].sort();
    if (ids.join() === [...saved.done].sort().join()) return;
    setSaved((sv) => ({ ...sv, done: ids }));
  }, [done, saved.done, key]);
  useEffect(() => {
    if (loaded.current !== key) return;
    try {
      localStorage.setItem(key, JSON.stringify(saved));
    } catch {
      /* this visit only */
    }
  }, [saved, key]);

  const count = goals.filter((g) => done.has(g.id)).length;
  const next = goals.find((g) => !done.has(g.id));
  const folded = saved.folded;
  return (
    <section className={`${s.card} ${s.goals}`} aria-labelledby="goals-title">
      <button type="button" className={s.goalsHead} aria-expanded={!folded} aria-controls="goals-list" onClick={() => setSaved((sv) => ({ ...sv, folded: !sv.folded }))}>
        <h2 id="goals-title">First experiments</h2>
        <span className={s.goalsCount}>
          <span className="num">{count}</span> of {goals.length}
        </span>
        <span className={s.goalsMeter} aria-hidden="true">
          <i style={{ width: `${(100 * count) / goals.length}%` }} />
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={s.goalsChevron}>
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {folded ? (
        next && <p className={s.goalsNext}>Next: {next.label.toLowerCase()}</p>
      ) : (
        <ol id="goals-list" className={s.goalsList}>
          {goals.map((g) => {
            const ok = done.has(g.id);
            return (
              <li key={g.id} data-done={ok || undefined}>
                <span className={s.goalMark} aria-hidden="true">
                  {ok && (
                    <svg width="12" height="12" viewBox="0 0 12 12">
                      <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
                <div>
                  <b>{g.label}</b>
                  {!ok && <span>{g.note}</span>}
                </div>
                <span className="sr">{ok ? ", done" : ", not yet"}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
