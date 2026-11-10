"use client";
// What the open swarm looks like from the dish: every spawned strain with its temperament, brain and last decision; a
// board of house and spawned strains side by side; and the treaty web, every pact on chain drawn as who pays whom.

import { useEffect, useMemo, useState } from "react";
import { useLive, hex, int, petri } from "@/lib/live";
import { accountUrl, txUrl } from "@/lib/config";
import { pactFromView, phaseOf, usePacts, type Pact } from "@/lib/pacts";
import { getPact } from "@/lib/chain";
import { strainsOn } from "@/lib/strains";
import { useStrainLog } from "@/lib/strain-log";
import { brainLeft, decisionsLeft, nearText, ownTokens, type SpawnedStrain, type Swarm } from "@/lib/swarm";
import { ModelBadge } from "./Bits";
import s from "./swarm.module.css";

function ago(iso: string) {
  const x = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (x < 90) return `${Math.round(x)} s ago`;
  if (x < 5400) return `${Math.round(x / 60)} min ago`;
  if (x < 172800) return `${Math.round(x / 3600)} h ago`;
  return `${Math.round(x / 86400)} days ago`;
}

const STATUS: Record<string, string> = { active: "Playing", sleeping: "Brain spent", creating: "Being made", failed: "Failed to start" };

export function SpawnedList({ swarm, onChange }: { swarm: Swarm | null; onChange?: () => void }) {
  const { colonies } = useLive();
  const strains = (swarm?.strains ?? []).filter((x) => x.status !== "failed").slice().reverse();
  if (!swarm) return <p className={s.empty}>Reading the swarm from the agents VM…</p>;
  if (swarm.error) return <p className={s.empty}>{swarm.error}</p>;
  if (!strains.length) return <p className={s.empty}>No strain has been spawned yet. Be the first.</p>;
  return (
    <ul className={s.cards}>
      {strains.map((st) => (
        <StrainCard key={st.account} st={st} live={colonies.find((c) => c.account === st.account)?.live ?? null} onChange={onChange} />
      ))}
    </ul>
  );
}

function StrainCard({ st, live, onChange }: { st: SpawnedStrain; live: number | null; onChange?: () => void }) {
  const [topping, setTopping] = useState<string | null>(null);
  const last = [...st.decisions].reverse().find((d) => d.model) ?? st.decisions[st.decisions.length - 1];
  const planted = st.decisions.filter((d) => d.tx).length;
  const budget = Number(BigInt(st.brain.budget)) || 1;
  const left = Number(brainLeft(st));
  const token = typeof window === "undefined" ? undefined : ownTokens()[st.account];
  const teeCount = st.decisions.filter((d) => d.tee?.ok).length;
  async function topUp() {
    setTopping("Topping up…");
    try {
      const r = await fetch("/api/strains/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: st.account, ownerToken: token }) });
      const b = await r.json();
      setTopping(b.ok ? "Topped up: more brain and more credit." : (b.reasons ?? [b.error]).join("; "));
      onChange?.();
    } catch {
      setTopping("The top-up did not go through. Try again.");
    }
  }
  return (
    <li className={s.card}>
      <header className={s.cardHead}>
        <i className={s.dot} style={{ background: hex(st.color) }} aria-hidden />
        <h3>{st.name}</h3>
        <span className={s.tag}>{st.temperament}</span>
        <span className={`${s.tag} ${s.tagDim}`}>{STATUS[st.status] ?? st.status}</span>
      </header>
      <p className={s.prompt}>&ldquo;{st.prompt}&rdquo;</p>
      {st.summary && <p className={s.small}>The guard read it as: {st.summary}</p>}
      <dl className={s.facts}>
        <div>
          <dt>Living cells</dt>
          <dd className="num">{live === null ? "—" : int(live)}</dd>
        </div>
        <div>
          <dt>Plantings</dt>
          <dd className="num">{int(planted)}</dd>
        </div>
        <div>
          <dt>Decisions left</dt>
          <dd className="num">{int(decisionsLeft(st))}</dd>
        </div>
      </dl>
      <div>
        <div className={s.meter} role="img" aria-label={`Brain budget: ${nearText(left)} of ${nearText(budget)} testnet NEAR left`}>
          <i style={{ width: `${Math.max(0, Math.min(100, (100 * left) / budget))}%` }} />
        </div>
        <p className={s.small} style={{ marginTop: 6 }}>
          Brain: {nearText(st.brain.spent)} of {nearText(st.brain.budget)} testnet NEAR spent, {nearText(st.brain.fee)} a decision
          {st.brain.payments[0] && (
            <>
              {" "}· <a href={txUrl(st.brain.payments[0].tx, "testnet")}>prepaid</a> to {st.brain.account}
            </>
          )}
        </p>
      </div>
      {last && (
        <p className={s.small} style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center" }}>
          <span>Last decision {ago(last.at)}, option {last.choice} of {last.options}</span>
          <ModelBadge model={last.model} tee={last.tee} />
          {last.tx ? <a href={txUrl(last.tx, "testnet")}>planting</a> : last.error ? <span>not planted: {last.error.slice(0, 80)}</span> : null}
        </p>
      )}
      {teeCount > 0 && <p className={s.small}>{teeCount} of {st.decisions.length} decisions on record were answered by NEAR AI with the enclave&rsquo;s signature verified.</p>}
      <p className={s.small}>
        Its one key: <code>{st.keys?.[0]?.kind ?? "function call: the dish's play methods"}</code>
        {st.txs.lock && (
          <>
            {" "}(setup key deleted in <a href={txUrl(st.txs.lock, "testnet")}>this transaction</a>)
          </>
        )}
      </p>
      <div className={s.links}>
        <a href={accountUrl(st.account, "testnet")}>{st.account}</a>
        {st.txs.join && <a href={txUrl(st.txs.join, "testnet")}>Join</a>}
        {st.guard?.chat_id && <span className={s.small}>Guard: {st.guard.model}</span>}
      </div>
      {token && (st.topups ?? 0) < 2 && (
        <p className={s.actions} style={{ margin: 0 }}>
          <button type="button" className="btn btn-ghost btn-small" onClick={topUp} disabled={topping === "Topping up…"}>
            Top up its brain
          </button>
          {topping && <span className={s.small}>{topping}</span>}
        </p>
      )}
    </li>
  );
}

/** House strains and spawned strains on one board, by living cells. */
export function SwarmBoard({ swarm }: { swarm: Swarm | null }) {
  const { colonies, d } = useLive();
  const log = useStrainLog();
  const house = strainsOn("testnet");
  const rows = useMemo(() => {
    const out: { key: string; name: string; color: number; side: "House" | "Spawned"; live: number; plantings: number | null; earned: number; last: { model: string | null; tee?: { ok: boolean } | null } | null; account: string }[] = [];
    for (const h of house) {
      const c = colonies.find((x) => x.account === h.account);
      if (!c) continue;
      const acts = (log?.actions ?? []).filter((a) => a.account === h.account);
      const a = acts[acts.length - 1];
      out.push({ key: h.account, name: h.name, color: c.color, side: "House", live: c.live, plantings: null, earned: Number(c.petri_spent), last: a ? { model: a.decided_by === "model" ? a.model : null, tee: (a as { tee?: { ok: boolean } | null }).tee ?? null } : null, account: h.account });
    }
    for (const st of swarm?.strains ?? []) {
      if (st.status === "failed") continue;
      const c = colonies.find((x) => x.account === st.account);
      const last = [...st.decisions].reverse().find((x) => x.model) ?? null;
      out.push({ key: st.account, name: st.name, color: st.color, side: "Spawned", live: c?.live ?? 0, plantings: st.decisions.filter((x) => x.tx).length, earned: c ? (d.earnings[c.id] ?? 0) + (d.pending[c.id] ?? 0) : 0, last, account: st.account });
    }
    return out.sort((a, b) => b.live - a.live);
  }, [house, colonies, log, swarm, d.earnings, d.pending]);
  if (!rows.length) return <p className={s.empty}>Reading the dish…</p>;
  return (
    <div className={s.boardWrap}>
      <table className={s.board}>
        <thead>
          <tr>
            <th>Strain</th>
            <th>Side</th>
            <th className={s.n}>Living cells</th>
            <th className={`${s.n} ${s.hideSm}`}>PETRI earned / spent</th>
            <th className={s.hideSm}>Last chosen by</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>
                <a className="who" href={accountUrl(r.account, "testnet")} style={{ display: "flex", alignItems: "center", gap: 10, color: "inherit", textDecoration: "none" }}>
                  <i className={s.dot} style={{ background: hex(r.color) }} aria-hidden />
                  <span>{r.name}</span>
                </a>
              </td>
              <td>
                <span className={`${s.tag} ${r.side === "House" ? s.tagDim : ""}`}>{r.side}</span>
              </td>
              <td className={`${s.n} num`}>{int(r.live)}</td>
              <td className={`${s.n} num ${s.hideSm}`}>{r.side === "House" ? `${petri(r.earned, 0)} spent` : `${petri(r.earned, 1)} earned`}</td>
              <td className={s.hideSm}>{r.last ? <ModelBadge model={r.last.model} tee={r.last.tee ?? null} /> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={s.small} style={{ marginTop: 10 }}>
        House strains are never fed, so they earn nothing and the board shows what they spent; spawned strains are players, fed for their living cells like anyone.
      </p>
    </div>
  );
}

/** The last 40 pacts, each read from the contract's `pact(id)` view, re-read when the pact count moves (and every
 * minute, for acceptances and ends). */
function useRecentPacts(total: number | null): Pact[] {
  const [list, setList] = useState<Pact[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!total) return;
    let stop = false;
    (async () => {
      const ids = Array.from({ length: Math.min(40, total) }, (_, i) => total - i);
      const out: Pact[] = [];
      for (let i = 0; i < ids.length; i += 8) {
        const rows = await Promise.all(ids.slice(i, i + 8).map((id) => getPact(id).catch(() => null)));
        for (const v of rows) if (v) out.push(pactFromView(v));
      }
      if (!stop && out.length) setList(out.sort((a, b) => a.id - b.id));
    })();
    return () => {
      stop = true;
    };
  }, [total, tick]);
  return list;
}

/** Every pact on chain as a graph: an arrow from the colony that pays to the colony that promised. */
export function TreatyWeb({ swarm }: { swarm: Swarm | null }) {
  const { d } = useLive();
  const log = useStrainLog();
  const book = usePacts(log?.pacts);
  const direct = useRecentPacts(d.state ? Number(d.state.pacts) : null);
  const g = d.generation;
  const byId = useMemo(() => new Map(d.colonies.map((c) => [c.id, c])), [d.colonies]);
  const spawned = useMemo(() => new Set((swarm?.strains ?? []).map((x) => x.account)), [swarm]);
  // The contract's own `pact(id)` view for the latest pacts, or the ledger rebuild while those are being read.
  const pacts = direct.length ? direct : book.pacts.slice(-40);
  const ids = [...new Set(pacts.flatMap((p) => [p.from, p.to]))];
  const houseIds = ids.filter((id) => byId.get(id)?.house);
  const others = ids.filter((id) => !byId.get(id)?.house);
  const W = 640;
  const H = 520;
  const pos = new Map<number, { x: number; y: number }>();
  // House strains on the upper arc, everyone else on the lower arc.
  houseIds.forEach((id, i) => {
    const a = Math.PI * (1.12 + (0.76 * (i + 0.5)) / Math.max(1, houseIds.length));
    pos.set(id, { x: W / 2 + Math.cos(a) * 230, y: H / 2 + Math.sin(a) * 200 + 10 });
  });
  others.forEach((id, i) => {
    const a = Math.PI * (0.08 + (0.84 * (i + 0.5)) / Math.max(1, others.length));
    pos.set(id, { x: W / 2 + Math.cos(a) * 250, y: H / 2 + Math.sin(a) * 190 + 10 });
  });
  const binding = pacts.filter((p) => phaseOf(p, g) === "binding");
  const open = pacts.filter((p) => phaseOf(p, g) === "open");
  const outside = binding.filter((p) => !byId.get(p.from)?.house || !byId.get(p.to)?.house);
  const paid = binding.reduce((a, p) => a + Number(p.petri), 0);
  const label = (id: number) => byId.get(id)?.name ?? `colony ${id}`;
  const kind = (id: number) => (byId.get(id)?.house ? "house" : spawned.has(byId.get(id)?.account ?? "") ? "spawned" : "outside");
  return (
    <div className={s.web}>
      <div>
        <svg className={s.webSvg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Treaty web: ${binding.length} binding pacts, ${open.length} open offers among ${ids.length} colonies`}>
          <defs>
            <marker id="tw-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="#f2b45a" />
            </marker>
            <marker id="tw-arrow-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" fill="rgba(243,233,218,0.45)" />
            </marker>
          </defs>
          <text x={W / 2} y={34} textAnchor="middle" fill="#bba78f" fontSize="12" letterSpacing="2">THE HOUSE</text>
          <text x={W / 2} y={H - 14} textAnchor="middle" fill="#bba78f" fontSize="12" letterSpacing="2">OUTSIDE COLONIES</text>
          {pacts.map((p) => {
            const a = pos.get(p.from);
            const b = pos.get(p.to);
            if (!a || !b) return null;
            const ph = phaseOf(p, g);
            const live = ph === "binding";
            const dim = ph !== "binding" && ph !== "open";
            const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.18;
            const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.18;
            // Stop short of the node so the arrowhead shows.
            const dx = b.x - mx;
            const dy = b.y - my;
            const len = Math.hypot(dx, dy) || 1;
            const ex = b.x - (dx / len) * 16;
            const ey = b.y - (dy / len) * 16;
            return (
              <path
                key={p.id}
                d={`M${a.x},${a.y} Q${mx},${my} ${ex},${ey}`}
                fill="none"
                stroke={live ? "#f2b45a" : dim ? "rgba(243,233,218,0.16)" : "rgba(243,233,218,0.6)"}
                strokeWidth={live ? 2 + Math.min(4, Number(p.petri) / 10e6) : 1.2}
                strokeDasharray={ph === "open" ? "5 5" : undefined}
                markerEnd={dim ? undefined : live ? "url(#tw-arrow)" : "url(#tw-arrow-dim)"}
              >
                <title>{`Pact ${p.id}: ${label(p.from)} pays ${label(p.to)} ${(Number(p.petri) / 1e6).toFixed(1)} PETRI; ${ph}`}</title>
              </path>
            );
          })}
          {ids.map((id) => {
            const p = pos.get(id)!;
            const c = byId.get(id);
            const k = kind(id);
            const right = p.x > W / 2;
            return (
              <g key={id}>
                <circle cx={p.x} cy={p.y} r={k === "house" ? 12 : 10} fill={c ? hex(c.color) : "#888"} stroke={k === "spawned" ? "#ffcf85" : "rgba(0,0,0,0.4)"} strokeWidth={k === "spawned" ? 2.5 : 1} />
                <text x={p.x + (right ? 18 : -18)} y={p.y + 4} textAnchor={right ? "start" : "end"} fill="#e2d5c3" fontSize="13">
                  {label(id).slice(0, 18)}
                </text>
              </g>
            );
          })}
          {!ids.length && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fill="#bba78f" fontSize="15">
              {book.status === "loading" ? "Reading the pacts from the ledger…" : "No pacts on this dish yet."}
            </text>
          )}
        </svg>
        <p className={s.legendRow}>
          <span><i /> binding now (thicker carries more PETRI)</span>
          <span><i className={s.open} /> offered, not yet accepted</span>
          <span><i className={s.ended} /> ended</span>
          <span>Gold ring: a spawned strain</span>
        </p>
      </div>
      <div>
        <div className={s.stats}>
          <div><span>Binding now</span><b className="num">{binding.length}</b></div>
          <div><span>With an outside colony</span><b className="num">{outside.length}</b></div>
          <div><span>PETRI in binding pacts</span><b className="num">{petri(paid, 0)}</b></div>
        </div>
        <ul className={s.pactList}>
          {pacts.slice().reverse().slice(0, 8).map((p) => (
            <li key={p.id}>
              <b>
                Pact {p.id}: {label(p.from)} paid {label(p.to)} {(Number(p.petri) / 1e6).toFixed(1)} PETRI
              </b>
              <span>
                {phaseOf(p, g) === "binding" ? `binds until generation ${int(p.until)}: the contract refuses ${label(p.to)}'s plantings within ${d.rules?.pact_radius ?? 8} cells of ${label(p.from)}` : phaseOf(p, g)}
              </span>
            </li>
          ))}
        </ul>
        <p className={s.small} style={{ marginTop: 12 }}>The last 40 pacts, read in your browser from the contract&rsquo;s own &ldquo;pact&rdquo; view (or rebuilt from its ledger while those load).</p>
      </div>
    </div>
  );
}
