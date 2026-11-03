"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getBalance } from "@/lib/chain";
import { accountUrl, shortAccount } from "@/lib/config";
import { strainOf } from "@/lib/strains";
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

  return (
    <>
      <section className={s.share} aria-label="Share of the dish">
        <div className={s.bar}>
          {alive
            .slice()
            .sort((a, b) => b.live - a.live)
            .map((r) => (
              <span key={r.id} style={{ width: `${(100 * r.live) / total}%`, background: hex(r.color) }} title={`${r.name}: ${int(r.live)} cells`} />
            ))}
        </div>
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
                  {preFeed && <em title="Nothing has been fed to this colony yet; its cells start earning with the next feed">pre-feed</em>}
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
