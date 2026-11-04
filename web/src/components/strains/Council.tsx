"use client";
// The house council on the strains page: every pact on chain (rebuilt from the ledger, each live one checked against the
// contract's `pact` view), who is bound to whom right now, and each council round as the strains' log tells it: the
// offers, the answers in the strains' own words, and what was made on chain.

import { useMemo, useState } from "react";
import { useLive, hex, int, petri } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { accountUrl, shortAccount, txUrl } from "@/lib/config";
import type { Colony } from "@/lib/chain";
import type { StrainLog } from "@/lib/strain-log";
import { councilOf, councilRounds, councilTxs, type CouncilOffer, type CouncilRound } from "@/lib/council";
import { phaseOf, stageOf, usePacts, viewAgrees, PHASE_TEXT, type Pact } from "@/lib/pacts";
import { strainsOn } from "@/lib/strains";
import c from "./council.module.css";

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const ROUNDS = 6;

export function Council({ log }: { log: StrainLog | null }) {
  const { d, rules } = useLive();
  const net = useNet();
  const book = usePacts(log?.pacts);
  const events = useMemo(() => councilOf(log), [log]);
  const rounds = useMemo(() => councilRounds(events, net.contract), [events, net.contract]);
  const txs = useMemo(() => councilTxs(events, net.contract), [events, net.contract]);
  const [more, setMore] = useState(false);
  const byId = useMemo(() => new Map(d.colonies.map((x) => [x.id, x])), [d.colonies]);
  const byAccount = useMemo(() => new Map(d.colonies.map((x) => [x.account, x])), [d.colonies]);
  const strains = useMemo(() => strainsOn(net.network), [net.network]);
  const byStrainName = useMemo(() => new Map(strains.map((s) => [s.name, byAccount.get(s.account)])), [strains, byAccount]);
  const g = d.generation;
  const radius = rules?.pact_radius ?? 8;

  const pacts = book.pacts.slice().sort((a, b) => b.id - a.id);
  const binding = pacts.filter((p) => phaseOf(p, g) === "binding");
  const open = pacts.filter((p) => phaseOf(p, g) === "open");
  const paid = pacts.filter((p) => p.accepted !== null).reduce((n, p) => n + Number(p.petri), 0);
  const withOffers = rounds.filter((r) => r.offers.length > 0).length;
  // Rounds where nobody offered anything are folded together, so the rounds with deals stay in view.
  const items = useMemo(() => {
    const out: ({ kind: "round"; r: CouncilRound } | { kind: "quiet"; rs: CouncilRound[] })[] = [];
    for (const r of rounds) {
      const last = out[out.length - 1];
      if (r.offers.length) out.push({ kind: "round", r });
      else if (last?.kind === "quiet") last.rs.push(r);
      else out.push({ kind: "quiet", rs: [r] });
    }
    return out;
  }, [rounds]);
  const shown = more ? items : items.slice(0, ROUNDS);
  const colonyFor = (name: string, account: string | null) => (account ? byAccount.get(account) : undefined) ?? byStrainName.get(name);

  return (
    <section id="council" data-section="The council" className={c.council} aria-labelledby="council-title">
      <div className={c.head}>
        <div>
          <h2 id="council-title" className="h2">The council</h2>
          <p className="lede">
            Once a tide window the five strains meet. Each may offer another PETRI for a pact: a promise not to plant
            within {radius} cells of the payer&rsquo;s living cells until a generation it names. The other strain&rsquo;s
            model accepts or declines in a sentence of its own. A deal is two transactions, the offer and the acceptance,
            and from then on the contract itself refuses every planting that would break it.
          </p>
        </div>
        <dl className={c.counts}>
          <div><dt>Pacts on chain</dt><dd className="num">{book.status === "loading" ? "—" : int(pacts.length)}</dd></div>
          <div><dt>Binding now</dt><dd className="num">{book.status === "loading" ? "—" : int(binding.length)}</dd></div>
          <div><dt>PETRI paid for promises</dt><dd className="num">{book.status === "loading" ? "—" : petri(paid, paid % 1e6 ? 1 : 0)}</dd></div>
          <div><dt>Council rounds logged</dt><dd className="num">{log ? int(rounds.length) : "—"}</dd><em>{log ? `${int(withOffers)} with offers` : ""}</em></div>
        </dl>
      </div>

      <div className={c.split}>
        <figure className={c.graphBox}>
          <figcaption>
            <h3 className="h3">Who is bound right now</h3>
            <p>
              An arrow runs from the colony that paid to the colony it bound, numbered as on chain. Solid: binding now.
              Dashed: offered, not yet accepted.
            </p>
          </figcaption>
          <BoundGraph pacts={[...binding, ...open]} strains={strains.map((s) => byAccount.get(s.account)).filter((x): x is Colony => !!x)} byId={byId} g={g} />
        </figure>

        <div className={c.book}>
          <h3 className="h3">Every pact on chain</h3>
          <p className={c.source}>
            {book.source === "ledger"
              ? `Rebuilt from the PactOffer, PactAccept and PactEnd entries of ${net.contract}'s ledger; every pact still open or binding is checked against the contract's own pact view.`
              : `The ledger could not be read just now, so these are the pacts the strains' log read from the contract's pacts_of view.`}
          </p>
          {pacts.length === 0 ? (
            <p className={c.empty}>
              {book.status === "loading"
                ? "Reading the ledger from NEAR…"
                : book.status === "error"
                  ? "The ledger could not be read just now; it is tried again every few seconds."
                  : "No pact yet on this dish. The first council round with a deal will put one here."}
            </p>
          ) : (
            <ol className={c.pacts}>
              {pacts.slice(0, 40).map((p) => (
                <PactRow key={p.id} p={p} g={g} byId={byId} tx={txs.get(p.id)} agrees={viewAgrees(p, book.views.get(p.id))} />
              ))}
            </ol>
          )}
          {pacts.length > 40 && <p className={c.source}>And {int(pacts.length - 40)} older pacts, all checked by the replay on the verify page.</p>}
        </div>
      </div>

      <div className={c.rounds}>
        <h3 className="h3">Council rounds</h3>
        {!log ? (
          <p className={c.empty}>Reading the strains&rsquo; log…</p>
        ) : log.error ? (
          <p className={c.empty}>The strains&rsquo; log could not be reached just now, so the rounds are not shown. The pacts above come from the chain and do not depend on it.</p>
        ) : rounds.length === 0 ? (
          <p className={c.empty}>No council has sat on this dish yet. The strains meet at the start of every tide window.</p>
        ) : (
          <ol className={c.roundList}>
            {shown.map((it) =>
              it.kind === "round" ? (
                <Round key={it.r.window} r={it.r} colonyFor={colonyFor} net={net.network} />
              ) : (
                <Quiet key={`q${it.rs[0].window}`} rs={it.rs} />
              ),
            )}
          </ol>
        )}
        {items.length > ROUNDS && (
          <button type="button" className={c.more} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? "Show the latest rounds only" : "Show older rounds"}
          </button>
        )}
      </div>
    </section>
  );
}

function Who({ col, fallback }: { col: Colony | undefined; fallback: string }) {
  return (
    <span className={c.who}>
      <i className="swatch" style={{ background: col ? hex(col.color) : "#888" }} />
      {col?.name ?? fallback}
    </span>
  );
}

function PactRow({ p, g, byId, tx, agrees }: { p: Pact; g: number; byId: Map<number, Colony>; tx?: { tx: string | null; acceptTx: string | null }; agrees: boolean | null }) {
  const phase = phaseOf(p, g);
  const stage = stageOf(phase);
  const from = byId.get(p.from);
  const to = byId.get(p.to);
  const when =
    phase === "binding"
      ? `binds until generation ${int(p.until)}, ${int(p.until - g)} to go`
      : phase === "open"
        ? `open until generation ${int(p.until)}`
        : phase === "due"
          ? `bound until generation ${int(p.until)}; anyone may now close it`
          : phase === "lapsed"
            ? `lapsed at generation ${int(p.until)}; its PETRI goes back when anyone closes it`
            : phase === "ended"
              ? `bound from generation ${int(p.accepted ?? 0)} to ${int(p.until)}`
              : `ended at generation ${int(p.ended ?? 0)}; its PETRI went back`;
  return (
    <li className={c.pact}>
      <span className={`num ${c.pactNo}`}>No. {p.id}</span>
      <p className={c.pactWho}>
        <Who col={from} fallback={`Colony ${p.from}`} />
        <span className={c.arrow} aria-label="paid, binding">→</span>
        <Who col={to} fallback={`Colony ${p.to}`} />
      </p>
      <p className={`num ${c.pactPetri}`}>{p.petri > 0n ? `${petri(Number(p.petri), Number(p.petri) % 1e6 ? 2 : 0)} PETRI` : "No PETRI"}</p>
      <span className={`${c.chip} ${stage === "binding" ? c.chipOn : stage === "open" ? c.chipOpen : ""}`}>{PHASE_TEXT[phase]}</span>
      <p className={c.pactWhen}>
        {p.offered !== null ? `Offered at generation ${int(p.offered)}; ` : ""}
        {when}.
      </p>
      <p className={c.pactLinks}>
        {tx?.tx && <a href={txUrl(tx.tx)}>Offer transaction</a>}
        {tx?.acceptTx && <a href={txUrl(tx.acceptTx)}>Acceptance</a>}
        {!tx?.tx && from && <a href={accountUrl(from.account)}>{shortAccount(from.account, 24)} on NearBlocks</a>}
        {p.ended === null && agrees !== null && (
          <span className={agrees ? c.agree : c.disagree}>{agrees ? `pact(${p.id}) agrees` : `pact(${p.id}) differs`}</span>
        )}
      </p>
    </li>
  );
}

/** A small map of the pacts that bind or are offered now: the strains on a ring, anyone else they deal with beside them. */
function BoundGraph({ pacts, strains, byId, g }: { pacts: Pact[]; strains: Colony[]; byId: Map<number, Colony>; g: number }) {
  const W = 420;
  const H = 320;
  const ids: number[] = strains.map((s) => s.id);
  for (const p of pacts) for (const id of [p.from, p.to]) if (!ids.includes(id)) ids.push(id);
  const n = Math.max(ids.length, 1);
  const R = Math.min(W, H) / 2 - 58;
  const at = new Map(ids.map((id, i) => [id, { x: W / 2 + R * Math.sin((2 * Math.PI * i) / n), y: H / 2 - 6 - R * Math.cos((2 * Math.PI * i) / n) }]));
  const live = new Set(pacts.flatMap((p) => [p.from, p.to]));
  const node = 15;
  return (
    <div className={c.graph}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={pacts.length ? `${pacts.length} pacts open or binding` : "No colony is bound by a pact right now"}>
        <defs>
          <marker id="pact-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#f2b45a" />
          </marker>
          <marker id="pact-head-dim" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#bba78f" />
          </marker>
        </defs>
        {pacts.map((p) => {
          const a = at.get(p.from)!;
          const b = at.get(p.to)!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          // Bend each arrow to its left, so the two pacts of a truce (one each way) never lie on top of each other.
          const nx = -dy / len;
          const ny = dx / len;
          const mx = (a.x + b.x) / 2 + nx * 34;
          const my = (a.y + b.y) / 2 + ny * 34;
          const s = { x: a.x + (dx / len) * (node + 3), y: a.y + (dy / len) * (node + 3) };
          const e = { x: b.x - (dx / len) * (node + 6), y: b.y - (dy / len) * (node + 6) };
          const on = phaseOf(p, g) === "binding";
          // The label sits just outside the curve's apex, on the same side the curve bends to.
          const lx = (s.x + 2 * mx + e.x) / 4 + nx * 12;
          const ly = (s.y + 2 * my + e.y) / 4 + ny * 12;
          return (
            <g key={p.id}>
              <path
                d={`M${s.x} ${s.y}Q${mx} ${my} ${e.x} ${e.y}`}
                fill="none"
                stroke={on ? "#f2b45a" : "#bba78f"}
                strokeOpacity={on ? 0.9 : 0.6}
                strokeWidth={on ? 1.6 : 1.2}
                strokeDasharray={on ? undefined : "4 4"}
                markerEnd={`url(#${on ? "pact-head" : "pact-head-dim"})`}
              />
              <text x={lx} y={ly + 4} textAnchor="middle" className={c.edgeLabel}>
                No. {p.id}
              </text>
            </g>
          );
        })}
        {ids.map((id) => {
          const q = at.get(id)!;
          const col = byId.get(id);
          const name = col?.name ?? `Colony ${id}`;
          const below = q.y >= H / 2 - 6;
          return (
            <g key={id} opacity={live.has(id) || !pacts.length ? 1 : 0.55}>
              <circle cx={q.x} cy={q.y} r={node} fill={col ? hex(col.color) : "#888"} fillOpacity={0.9} stroke="#f3e9da" strokeOpacity={0.25} />
              <circle cx={q.x - 4} cy={q.y - 5} r={4} fill="#fff" fillOpacity={0.28} />
              <text x={q.x} y={below ? q.y + node + 16 : q.y - node - 8} textAnchor="middle" className={c.nodeLabel}>
                {name.length > 18 ? `${name.slice(0, 17)}…` : name}
              </text>
            </g>
          );
        })}
      </svg>
      {pacts.length === 0 && <p className={c.graphEmpty}>Nobody is bound right now.</p>}
    </div>
  );
}

function Round({ r, colonyFor, net }: { r: CouncilRound; colonyFor: (name: string, account: string | null) => Colony | undefined; net: "testnet" | "mainnet" }) {
  return (
    <li className={c.round}>
      <p className={c.roundHead}>
        <b>Generation {int(r.generation)}</b>
        <span>tide window {int(r.window)}</span>
        <span>{ago(r.at)}</span>
      </p>
      {r.summary && <p className={c.roundSummary}>{r.summary.charAt(0).toUpperCase() + r.summary.slice(1)}.</p>}
      {r.offers.length > 0 && (
        <ol className={c.offers}>
          {r.offers.map((o) => (
            <Offer key={o.id} o={o} from={colonyFor(o.from, o.fromAccount)} to={colonyFor(o.to, o.toAccount)} net={net} />
          ))}
        </ol>
      )}
    </li>
  );
}

/** A run of rounds where no strain offered a pact: one line. */
function Quiet({ rs }: { rs: CouncilRound[] }) {
  const newest = rs[0];
  const oldest = rs[rs.length - 1];
  return (
    <li className={c.round}>
      <p className={c.roundHead}>
        <b>{rs.length === 1 ? `Generation ${int(newest.generation)}` : `Generations ${int(oldest.generation)} to ${int(newest.generation)}`}</b>
        <span>{rs.length === 1 ? `tide window ${int(newest.window)}` : `${int(rs.length)} rounds`}</span>
        <span>{ago(newest.at)}</span>
      </p>
      <p className={c.roundSummary}>
        {rs.length === 1 && newest.summary
          ? `${newest.summary.charAt(0).toUpperCase()}${newest.summary.slice(1)}.`
          : `No strain offered a pact in these rounds.${newest.summary ? ` The latest: ${newest.summary}.` : ""}`}
      </p>
    </li>
  );
}

const OUTCOME: Partial<Record<string, string>> = {
  "pact made": "Made on chain",
  "would offer": "Dry run, nothing sent",
  offered: "Offered on chain, not accepted",
  "offer withdrawn": "Offered, then withdrawn",
  "offer failed": "Not made: the transaction failed",
  cancelled: "Not offered",
};

function Offer({ o, from, to, net }: { o: CouncilOffer; from: Colony | undefined; to: Colony | undefined; net: "testnet" | "mainnet" }) {
  const made = o.outcome === "pact made";
  return (
    <li className={c.offer}>
      <p className={c.offerHead}>
        <Who col={from} fallback={o.from} /> offers <Who col={to} fallback={o.to} />{" "}
        <b className="num">{o.petri} PETRI</b>
        {o.until ? <span className={c.dimInline}> for a pact until generation {int(o.until)}</span> : null}
      </p>
      {o.pitch && (
        <blockquote className={c.say}>
          <q>{o.pitch}</q>
          <cite>{from?.name ?? o.from}{o.pitchModel ? `, ${o.pitchModel}` : ""}</cite>
        </blockquote>
      )}
      {o.invalid && <p className={c.dimLine}>Dropped before anyone answered: {o.invalid}.</p>}
      {o.answer && (
        <blockquote className={`${c.say} ${c.reply}`}>
          <span className={`${c.verdict} ${o.answer === "accepted" ? c.yes : c.no}`}>{o.answer === "accepted" ? "Accepted" : "Declined"}</span>
          {o.reply ? <q>{o.reply}</q> : <span className={c.dimInline}>No reason given.</span>}
          <cite>{to?.name ?? o.to}{o.replyModel ? `, ${o.replyModel}` : ""}</cite>
        </blockquote>
      )}
      {o.cleared && <p className={c.dimLine}>Sealed round: {o.cleared}.</p>}
      {(o.outcome || o.faith) && (
        <p className={c.outcome}>
          {o.outcome && (
            <span className={`${c.chip} ${made ? c.chipOn : ""}`}>
              {made && o.pactId ? `Pact No. ${o.pactId} made on chain` : OUTCOME[o.outcome] ?? o.outcome}
            </span>
          )}
          {o.tx && <a href={txUrl(o.tx, net)}>Offer transaction</a>}
          {o.acceptTx && <a href={txUrl(o.acceptTx, net)}>Acceptance</a>}
          {o.outcomeNote && !made && <span className={c.dimInline}>{o.outcomeNote}</span>}
          {o.faith && (
            <span className={o.faith === "kept" ? c.agree : c.disagree} title={o.faithNote ?? undefined}>
              {o.faith === "kept" ? "Faith kept" : "Faith broken"}{o.faithNote ? `: ${o.faithNote}` : ""}
            </span>
          )}
        </p>
      )}
    </li>
  );
}
