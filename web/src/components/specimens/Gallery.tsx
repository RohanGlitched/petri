"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLive, hex, int, petri } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { slideRules, type Slide } from "@/lib/slides";
import { SlideGlass } from "./SlideGlass";
import { order, pictureOf, useAllSlides, useColonyOf } from "./data";
import s from "./specimens.module.css";

/** Why a read failed, in words: usually the dish predates specimens or is not deployed yet. */
export function readableReadError(e: string | undefined, contract: string, chain: string): string {
  const m = e ?? "";
  if (/does not exist|UNKNOWN_ACCOUNT|CodeDoesNotExist/i.test(m)) return `${contract} is not deployed on ${chain} yet, so there is nothing to read.`;
  if (/MethodNotFound|MethodResolveError/i.test(m)) return `${contract} has no specimen views: this dish was launched before slides existed.`;
  return `${contract} did not answer (${m || "no reply"}). The page tries again every half minute.`;
}

export function useSpecimenRows() {
  const all = useAllSlides();
  const colonyOf = useColonyOf();
  const rows = useMemo(() => all.data.map((sl) => ({ sl, c: colonyOf(sl) })).sort((a, b) => order(a.sl, b.sl)), [all.data, colonyOf]);
  return { all, rows };
}

/** The newest specimen, large, beside the page's opening words. */
export function FeaturedSlide() {
  const { all, rows } = useSpecimenRows();
  const first = rows[0];
  if (all.status === "loading") return <SlideGlass src={null} size="large" placeholder="Reading the slide box…" />;
  if (!first) return <SlideGlass src={null} size="large" placeholder="The first slide is still blank" />;
  return (
    <div className={s.feature}>
      <SlideGlass
        size="large"
        href={`/specimens/${encodeURIComponent(first.sl.id)}`}
        src={pictureOf(first.sl, first.c?.color)}
        id={first.sl.id}
        title={first.sl.title}
        colony={first.c}
        generation={first.sl.generation}
        count={first.sl.count}
      />
      <p className={s.featureCap}>The newest specimen on the dish. <Link href={`/specimens/${encodeURIComponent(first.sl.id)}`}>See its proof</Link>.</p>
    </div>
  );
}

type Sort = "new" | "old";

export function Gallery() {
  const net = useNet();
  const { ready, rules } = useLive();
  const price = slideRules(rules).cellPrice;
  const { all, rows } = useSpecimenRows();
  const [colony, setColony] = useState<number | null>(null);
  const [sort, setSort] = useState<Sort>("new");
  const [shown, setShown] = useState(24);

  const makers = useMemo(() => {
    const m = new Map<number, { id: number; name: string; color: number; n: number }>();
    rows.forEach(({ c }) => {
      if (!c || c.id === null) return;
      const e = m.get(c.id) ?? { id: c.id, name: c.name, color: c.color, n: 0 };
      e.n++;
      m.set(c.id, e);
    });
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [rows]);

  const list = useMemo(() => {
    const f = colony === null ? rows : rows.filter((r) => r.c?.id === colony);
    return sort === "new" ? f : [...f].reverse();
  }, [rows, colony, sort]);

  const cells = rows.reduce((a, r) => a + (r.sl.count ?? 0), 0);
  // The price per cell is fixed in the rules, so what the slides burned is the cells they hold times that price.
  const burned = price !== null ? Number(price) * cells : null;

  return (
    <>
      <dl className={`${s.counts} num`} aria-live="polite">
        <div><dt>Specimens on {net.contract}</dt><dd>{all.status === "ready" ? int(rows.length) : "—"}</dd></div>
        <div><dt>Cells fixed on glass</dt><dd>{all.status === "ready" ? int(cells) : "—"}</dd></div>
        <div><dt>PETRI burned to make them</dt><dd>{all.status === "ready" && burned !== null ? petri(burned, 2) : "—"}</dd></div>
        <div><dt>Colonies with a slide</dt><dd>{all.status === "ready" ? int(makers.length) : "—"}</dd></div>
      </dl>

      {all.status === "error" ? (
        <div className={s.state} role="status">
          <h2>The slide box could not be read</h2>
          <p>{readableReadError(all.error, net.contract, net.label.chain)}</p>
          <Link className="btn btn-ghost btn-small" href="/dish">Open the dish</Link>
        </div>
      ) : all.status === "loading" ? (
        <ul className={s.grid} aria-label="Reading specimens">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className={s.skeleton}>
              <SlideGlass src={null} placeholder="Reading…" />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className={s.state} role="status">
          <h2>No specimens yet</h2>
          <p>
            Nobody has fixed a slide on this dish{ready ? "" : " yet"}. Any colony with living cells can make the first: frame a patch of
            your own cells on the dish, give it a title, and the contract mints it.
          </p>
          <Link className="btn btn-amber" href="/dish?tool=fossil">Make the first specimen</Link>
        </div>
      ) : (
        <>
          <div className={s.tools}>
            <div className={s.chips} role="group" aria-label="Show specimens from">
              <button className={colony === null ? s.on : ""} aria-pressed={colony === null} onClick={() => setColony(null)}>
                Every colony <span className="num">{int(rows.length)}</span>
              </button>
              {makers.map((m) => (
                <button key={m.id} className={colony === m.id ? s.on : ""} aria-pressed={colony === m.id} onClick={() => setColony(colony === m.id ? null : m.id)}>
                  <i className="swatch" style={{ background: hex(m.color) }} />
                  {m.name} <span className="num">{m.n}</span>
                </button>
              ))}
            </div>
            <div className={s.sort} role="group" aria-label="Order">
              <button className={sort === "new" ? s.on : ""} aria-pressed={sort === "new"} onClick={() => setSort("new")}>Newest</button>
              <button className={sort === "old" ? s.on : ""} aria-pressed={sort === "old"} onClick={() => setSort("old")}>Oldest</button>
            </div>
          </div>
          <ul className={s.grid}>
            {list.slice(0, shown).map(({ sl, c }) => (
              <li key={sl.id}>
                <SpecimenCard sl={sl} c={c} />
              </li>
            ))}
          </ul>
          {list.length > shown && (
            <p className={s.more}>
              <button className="btn btn-ghost" onClick={() => setShown((n) => n + 24)}>Show {Math.min(24, list.length - shown)} more</button>
            </p>
          )}
        </>
      )}
    </>
  );
}

export function SpecimenCard({ sl, c, size }: { sl: Slide; c: { name: string; color: number } | null; size?: "card" | "mini" }) {
  return (
    <SlideGlass
      size={size}
      href={`/specimens/${encodeURIComponent(sl.id)}`}
      src={pictureOf(sl, c?.color)}
      id={sl.id}
      title={sl.title}
      colony={c}
      generation={sl.generation}
      count={sl.count}
    />
  );
}
