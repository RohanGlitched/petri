"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex, near } from "@/lib/live";
import { getBalance, getTideWinnings } from "@/lib/chain";
import { accountUrl, shortAccount } from "@/lib/config";
import { sideOf, strainOf } from "@/lib/strains";
import s from "./ledger.module.css";

type Sort = "live" | "earned" | "spent" | "net" | "joined";

/** Where each colony lives, for the thumbnails' labels: its living cells and their centre on the wrapping dish. */
function whereabouts(cells: Uint16Array | undefined, w: number, h: number): Map<number, { n: number; x: number; y: number }> {
  const out = new Map<number, { n: number; x: number; y: number }>();
  if (!cells) return out;
  // Circular means, so a colony straddling an edge is placed on the edge rather than mid-dish.
  const acc = new Map<number, number[]>();
  for (let i = 0; i < cells.length; i++) {
    const id = cells[i];
    if (!id) continue;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = [0, 0, 0, 0, 0]));
    const ax = ((i % w) / w) * 2 * Math.PI;
    const ay = (((i / w) | 0) / h) * 2 * Math.PI;
    a[0]++;
    a[1] += Math.cos(ax);
    a[2] += Math.sin(ax);
    a[3] += Math.cos(ay);
    a[4] += Math.sin(ay);
  }
  const at = (c: number, s: number, size: number) => Math.round(((Math.atan2(s, c) / (2 * Math.PI) + 1) % 1) * size) % size;
  acc.forEach((a, id) => out.set(id, { n: a[0], x: at(a[1], a[2], w), y: at(a[3], a[4], h) }));
  return out;
}

/** A thumbnail of the dish with only one colony's cells lit, so you can see where it lives. */
function Territory({ cells, id, color, w, h, label }: { cells?: Uint16Array; id: number; color: number; w: number; h: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !cells) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(w, h);
    const r = (color >> 16) & 255, g = (color >> 8) & 255, b = color & 255;
    for (let i = 0; i < cells.length; i++) {
      const o = i * 4;
      const v = cells[i];
      if (v === id) {
        img.data[o] = Math.min(255, r + 60);
        img.data[o + 1] = Math.min(255, g + 60);
        img.data[o + 2] = Math.min(255, b + 60);
        img.data[o + 3] = 255;
      } else if (v !== 0) {
        img.data[o] = 120;
        img.data[o + 1] = 90;
        img.data[o + 2] = 60;
        img.data[o + 3] = 70;
      } else {
        img.data[o + 3] = 0;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [cells, id, color, w, h]);
  return <canvas ref={ref} width={w} height={h} className={s.terr} role="img" aria-label={label} />;
}

const territoryLabel = (name: string, at?: { n: number; x: number; y: number }) =>
  at?.n ? `${name}, ${int(at.n)} ${at.n === 1 ? "cell" : "cells"} near ${at.x}, ${at.y}` : `${name}, no living cells`;

export function Ledger() {
  const { d, ready, colonies, w, h } = useLive();
  // Until the agar has fed anyone, every Net is just what planting cost, so it is shown as neutral, not as a loss.
  const places = useMemo(() => whereabouts(d.cells, w, h), [d.cells, w, h]);
  const fedYet = !!d.state && (Number(d.state.fed) > 0 || d.pending.some((p) => p > 0));
  const [sort, setSort] = useState<Sort>("live");
  const [balances, setBalances] = useState<Record<string, number>>({});
  // NEAR each colony has won at the tides, claimed or not (index = colony id - 1), for the outside-players counter.
  const [winnings, setWinnings] = useState<number[] | null>(null);
  const tides = d.state?.tides;
  useEffect(() => {
    let stop = false;
    getTideWinnings(0, 2000).then(
      (w) => !stop && setWinnings(w.map(Number)),
      () => !stop && setWinnings((x) => x),
    );
    return () => {
      stop = true;
    };
  }, [tides, d.colonies.length]);

  // Balances are one view call per colony; read them for the colonies on screen, refreshed every half minute.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const want = d.colonies.slice(0, 120);
      const out: Record<string, number> = {};
      await Promise.all(
        want.map(async (c) => {
          try {
            out[c.account] = Number(await getBalance(c.account));
          } catch {
            /* keep the last value */
          }
        }),
      );
      if (!stop) setBalances((b) => ({ ...b, ...out }));
    };
    if (d.colonies.length) load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [d.colonies]);

  const rows = useMemo(() => {
    const r = colonies.map((c) => {
      // Lifetime earnings at the stored board (claimed or not), plus what accrued since in the browser.
      const earned = (d.earnings[c.id] ?? 0) + (d.pending[c.id] ?? 0);
      const spent = Number(c.petri_spent);
      return { ...c, earned, spent, net: earned - spent, joined: Number(c.joined_generation) };
    });
    const key: Record<Sort, (x: (typeof r)[number]) => number> = {
      live: (x) => x.live,
      earned: (x) => x.earned,
      spent: (x) => x.spent,
      net: (x) => x.net,
      joined: (x) => -x.joined,
    };
    return r.sort((a, b) => key[sort](b) - key[sort](a));
  }, [colonies, d.pending, sort]);

  const total = d.totalLive || 1;
  const alive = rows.filter((r) => r.live > 0);
  // The honest counters: who outside the team plays, and what the dish has paid them.
  const outside = rows.filter((r) => sideOf(r.account, r.house) === "player");
  const outsideAlive = outside.filter((r) => r.live > 0).length;
  const outsideWon = winnings ? outside.reduce((n, r) => n + (winnings[r.id - 1] ?? 0), 0) : null;
  const teamWon = winnings ? rows.filter((r) => sideOf(r.account, r.house) !== "player").reduce((n, r) => n + (winnings[r.id - 1] ?? 0), 0) : null;
  const slides = d.state ? Number(d.state.slides) : null;
  const legend = alive.slice().sort((a, b) => b.live - a.live);

  return (
    <>
      <dl className={s.counters} aria-live="polite">
        <div>
          <dt>Outside colonies</dt>
          <dd className="num">{ready ? int(outside.length) : "—"}</dd>
          <p>{ready ? `${int(outsideAlive)} alive now. Not counted: the five house strains${d.colonies.some((c) => sideOf(c.account) === "bench") ? " and the team's three bench colonies" : ""}.` : "Reading the colonies…"}</p>
        </div>
        <div>
          <dt>NEAR won at tides by outside players</dt>
          <dd className="num">{outsideWon !== null ? near(outsideWon, 4) : "—"}</dd>
          <p>
            {outsideWon === null
              ? "Reading the tide winnings…"
              : teamWon && teamWon > 0
                ? `Claimed or waiting to be claimed. The bench won ${near(teamWon, 4)} more; the house wins nothing.`
                : "Claimed or waiting to be claimed. The house strains never win a tide."}
          </p>
        </div>
        <div>
          <dt>Specimen slides minted</dt>
          <dd className="num">{slides !== null ? int(slides) : "—"}</dd>
          <p>
            <Link href="/specimens">See the slide box</Link>
          </p>
        </div>
      </dl>

      <section className={s.share} aria-label="Share of the dish">
        <div className={s.bar}>
          {legend.map((r) => (
            <span key={r.id} style={{ width: `${(100 * r.live) / total}%`, background: hex(r.color) }} title={`${r.name}: ${int(r.live)} cells`} />
          ))}
        </div>
        {legend.length > 0 && (
          <ul className={s.legend}>
            {legend.slice(0, 12).map((r) => {
              const side = sideOf(r.account, r.house);
              return (
                <li key={r.id}>
                  <i className="swatch" style={{ background: hex(r.color) }} />
                  {r.name}
                  <span className="num">{((100 * r.live) / total).toFixed(1)}%</span>
                  {side !== "player" && <em title={side === "house" ? "A house strain: never fed, wins no tides" : "A team bench colony, played from the team's own testnet NEAR"}>{side}</em>}
                </li>
              );
            })}
            {legend.length > 12 && <li className={s.legendMore}>and {int(legend.length - 12)} more</li>}
          </ul>
        )}
        <p className={s.shareText}>
          <span className="num">{ready ? int(d.totalLive) : "—"}</span> living cells across{" "}
          <span className="num">{alive.length}</span> of <span className="num">{rows.length}</span> colonies.
          {alive[0] && ready ? ` The largest holds ${((100 * Math.max(...alive.map((a) => a.live))) / total).toFixed(1)}% of the dish.` : ""}
        </p>
      </section>

      <div className={s.sorts} role="group" aria-label="Sort colonies by">
        {(
          [
            ["live", "Living cells"],
            ["earned", "Earned"],
            ["spent", "Spent planting"],
            ["net", "Net"],
            ["joined", "Newest"],
          ] as [Sort, string][]
        ).map(([k, label]) => (
          <button key={k} aria-pressed={sort === k} className={sort === k ? s.on : undefined} onClick={() => setSort(k)}>
            {label}
          </button>
        ))}
      </div>

      <ol className={s.list}>
        {ready && outside.length === 0 && (
          // Every colony so far is the team's: say so first, and invite the first outside player in.
          <li className={`${s.row} ${s.pinned}`}>
            <span className={`num ${s.rank}`} aria-hidden="true">·</span>
            <div className={s.who}>
              <span className={s.terrEmpty} aria-hidden="true" />
              <div>
                <p className={s.name}>No player colonies yet. Be the first.</p>
                <p className={s.joined}>Every colony below belongs to the team: the house strains{d.colonies.some((c) => sideOf(c.account) === "bench") ? " and the bench" : ""}.</p>
              </div>
            </div>
            <div className={s.pinnedCta}>
              <Link className="btn btn-amber btn-small" href="/dish">Start a colony on the dish</Link>
            </div>
          </li>
        )}
        {rows.map((r, i) => {
          const ai = strainOf(r.account);
          const preFeed = !fedYet || r.earned === 0;
          return (
            <li key={r.id} className={s.row}>
              <span className={`num ${s.rank}`}>{i + 1}</span>
              <div className={s.who}>
                <Territory cells={d.cells} id={r.id} color={r.color} w={w} h={h} label={territoryLabel(r.name, places.get(r.id))} />
                <div>
                  <p className={s.name}>
                    <i className="swatch" style={{ background: hex(r.color) }} />
                    {r.name}
                    {ai && <span className={s.ai}>AI, {ai.temperament.toLowerCase()}</span>}
                  </p>
                  <a className={s.acct} href={accountUrl(r.account)}>{shortAccount(r.account, 30)}</a>
                  <p className={s.joined}>Joined at generation {int(r.joined)}, planted {int(Number(r.cells_planted))} cells</p>
                </div>
              </div>
              <dl className={s.nums}>
                <div><dt>Living</dt><dd className="num">{int(r.live)}</dd><em>{((100 * r.live) / total).toFixed(1)}%</em></div>
                <div><dt>Earned</dt><dd className="num">{petri(r.earned, 2)}</dd></div>
                <div><dt>Spent planting</dt><dd className="num">{petri(r.spent, 2)}</dd></div>
                <div>
                  <dt>Net</dt>
                  <dd className={`num ${preFeed ? s.flat : r.net >= 0 ? s.pos : s.neg}`}><span className={s.sign} aria-hidden="true">{r.net >= 0 ? "+" : "−"}</span><span className="sr">{r.net >= 0 ? "plus " : "minus "}</span>{petri(Math.abs(r.net), 2)}</dd>
                  {preFeed &&
                    (sideOf(r.account, r.house) === "bench" ? (
                      <em title="A team bench colony; nothing has been fed to it yet">bench</em>
                    ) : r.house ? (
                      <em title="A house strain: the contract never feeds it and never pays it at a tide">house</em>
                    ) : (
                      <em title="Nothing has been fed to this colony yet; its cells start earning with the next feed">pre-feed</em>
                    ))}
                </div>
                <div><dt>Holding</dt><dd className="num">{balances[r.account] !== undefined ? petri(balances[r.account], 2) : "—"}</dd></div>
              </dl>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className={s.empty}>
            {ready ? (
              <>
                No colonies yet. <Link href="/dish">Start the first one</Link>.
              </>
            ) : (
              "Reading the colonies from NEAR…"
            )}
          </li>
        )}
      </ol>
      <p className={s.foot}>
        Earned includes PETRI accrued since the dish last advanced on chain. Spent planting is the full price paid; half of it
        was burned and half went back to the agar. Holding is the live token balance, which also counts PETRI bought from the agar,
        keeper shares and transfers.
        {ready && !fedYet ? " The agar has not fed anyone yet, so Net is only what planting cost so far; it is shown in neutral until the first feed." : ""}
      </p>
    </>
  );
}
