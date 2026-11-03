"use client";

import Link from "next/link";
import { PATTERNS, type PatternInfo } from "@/engine";
import { Specimen } from "@/components/site/Specimen";
import { useLive, usePatternOffsets, petri } from "@/lib/live";
import s from "./bands.module.css";

const GROUPS: { kind: PatternInfo["kind"][]; title: string; line: string; color: string }[] = [
  { kind: ["still"], title: "Earn", line: "Still lifes never change, so they earn every generation until something hits them.", color: "#1e8c6e" },
  { kind: ["oscillator"], title: "Shimmer", line: "Oscillators pulse in place: bigger at their peak, easier to knock apart.", color: "#6b2fa0" },
  { kind: ["ship", "gun"], title: "Reach", line: "Ships travel and guns fire them. The only way past a rival’s buffer.", color: "#c8431f" },
  { kind: ["wild"], title: "Gamble", line: "Small seeds that grow wild for hundreds of generations, into everyone’s agar.", color: "#c99a2e" },
];

export function TrayBand() {
  const { rules, d, ready } = useLive();
  const offsets = usePatternOffsets();
  const cost = (n: number) => (rules ? (Number(rules.plant_cost) * n * (rules.capacity + d.totalLive)) / rules.capacity : 0);
  return (
    <section className="band band-2" aria-labelledby="tray-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="tray-title" className="h2">Eleven stamps, four ways to play</h2>
          <p className="lede">
            You plant up to {rules?.max_plant_cells ?? 64} cells at a time, once a generation. These are the classic patterns of
            Life, priced live from the contract&rsquo;s own formula. What you build with them is up to you.
          </p>
        </div>
        <div className={s.groups}>
          {GROUPS.map((g) => (
            <div key={g.title} className={s.group}>
              <h3 className="h3" style={{ color: g.color === "#c99a2e" ? "#e8b957" : undefined }}>{g.title}</h3>
              <p className="muted">{g.line}</p>
              <ul className={s.stamps}>
                {PATTERNS.filter((p) => g.kind.includes(p.kind)).map((p) => (
                  <li key={p.name} className={s.stamp}>
                    <Specimen offsets={offsets[p.name]} color={g.color} size={60} />
                    <div>
                      <b>{p.label}</b>
                      <span className="num">
                        {p.cells} cells{ready ? `, ${petri(cost(p.cells), 1)} PETRI now` : ""}
                      </span>
                      <p>{p.note}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className={s.after}>
          <Link className="btn btn-amber" href="/dish">Choose one and plant it</Link>
        </p>
      </div>
    </section>
  );
}
