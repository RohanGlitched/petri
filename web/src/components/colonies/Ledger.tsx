"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useLive, petri, int, hex } from "@/lib/live";
import { getBalance } from "@/lib/chain";
import { accountUrl, shortAccount } from "@/lib/config";
import { strainOf } from "@/lib/strains";
import s from "./ledger.module.css";

type Sort = "live" | "earned" | "spent" | "net" | "joined";

/** A thumbnail of the dish with only one colony's cells lit, so you can see where it lives. */
function Territory({ cells, id, color, w, h }: { cells?: Uint16Array; id: number; color: number; w: number; h: number }) {
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
  return <canvas ref={ref} width={w} height={h} className={s.terr} aria-hidden="true" />;
}

export function Ledger() {
  const { d, ready, colonies, w, h } = useLive();
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
      const earned = Number(c.petri_earned) + (d.pending[c.id] ?? 0);
      const spent = Number(c.petri_burned);
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
          return (
            <li key={r.id} className={s.row}>
              <span className={`num ${s.rank}`}>{i + 1}</span>
              <div className={s.who}>
                <Territory cells={d.cells} id={r.id} color={r.color} w={w} h={h} />
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
                <div><dt>Net</dt><dd className={`num ${r.net >= 0 ? s.pos : s.neg}`}>{r.net >= 0 ? "+" : "−"}{petri(Math.abs(r.net), 2)}</dd></div>
                <div><dt>Holding</dt><dd className="num">{balances[r.account] !== undefined ? petri(balances[r.account], 2) : "—"}</dd></div>
              </dl>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className={s.empty}>
            No colonies yet. <Link href="/dish">Start the first one</Link>.
          </li>
        )}
      </ol>
      <p className={s.foot}>
        Earned includes PETRI accrued since the dish last advanced on chain. Spent planting is the full price paid; half of it
        was burned and half went back to the agar. Holding is the live token balance, which also counts starter grants,
        keeper shares and transfers.
      </p>
    </>
  );
}
