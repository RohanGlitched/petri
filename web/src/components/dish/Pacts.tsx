"use client";
// Pacts on the play page: what binds the colony under the cursor (a line in the inspector and its protected zone on the
// dish), the pacts of the player's own colony with their buttons, and offering a pact to a colony picked on the dish.

import { useState } from "react";
import { hex, int, petri } from "@/lib/live";
import { accountUrl, shortAccount } from "@/lib/config";
import type { Colony } from "@/lib/chain";
import { phaseOf, type Pact } from "@/lib/pacts";
import s from "./dish.module.css";
import { BenchTag } from "@/components/site/BenchTag";

const name = (names: Map<number, string>, id: number) => names.get(id) ?? `colony ${id}`;
const amount = (p: Pact) => (p.petri > 0n ? `${petri(Number(p.petri), Number(p.petri) % 1e6 ? 2 : 0)} PETRI` : "no PETRI");

/** The pacts that bind or protect colony `id` at generation `g`. */
export function pactsOn(pacts: Pact[], id: number, g: number) {
  const live = pacts.filter((p) => phaseOf(p, g) === "binding");
  return { bound: live.filter((p) => p.to === id), protects: live.filter((p) => p.from === id) };
}

/** The colonies whose ground a pact keeps colony `id` off now (`bound`), or that it keeps off its own (`id` itself). */
export function zoneColonies(pacts: Pact[], id: number, g: number): number[] {
  const { bound, protects } = pactsOn(pacts, id, g);
  return [...new Set([...bound.map((p) => p.from), ...(protects.length ? [id] : [])])];
}

/** One line per pact for the inspector chip. */
export function pactLines(pacts: Pact[], id: number, g: number, radius: number, names: Map<number, string>): string[] {
  const { bound, protects } = pactsOn(pacts, id, g);
  return [
    ...bound.map((p) => `Bound by pact ${p.id} until gen ${int(p.until)}: cannot plant within ${radius} cells of ${name(names, p.from)}`),
    ...protects.map((p) => `Protected by pact ${p.id} until gen ${int(p.until)}: ${name(names, p.to)} cannot plant within ${radius} cells of it`),
  ];
}

export type PactActions = {
  offer: (to: Colony, petriUnits: bigint, until: number) => void;
  accept: (p: Pact) => void;
  cancel: (p: Pact, why: string) => void;
};

/** The player's own pacts, in the colony card: offers to answer, offers waiting, and what binds now. */
export function MyPacts({ pacts, me, g, radius, names, busy, act }: { pacts: Pact[]; me: Colony; g: number; radius: number; names: Map<number, string>; busy: boolean; act: PactActions }) {
  const mine = pacts.filter((p) => (p.from === me.id || p.to === me.id) && p.ended === null);
  if (!mine.length) return null;
  return (
    <div className={s.pactBox}>
      <h3>Pacts</h3>
      <ul>
        {mine.map((p) => {
          const phase = phaseOf(p, g);
          const other = name(names, p.from === me.id ? p.to : p.from);
          const toMe = p.to === me.id;
          return (
            <li key={p.id}>
              <p>
                <span className={`num ${s.pactNo}`}>No. {p.id}</span>
                {phase === "open" && toMe && <>{other} offers you {amount(p)} if you plant nowhere within {radius} cells of its living cells until generation {int(p.until)}.</>}
                {phase === "open" && !toMe && <>Your offer of {amount(p)} to {other} waits for its answer, open until generation {int(p.until)}.</>}
                {phase === "binding" && toMe && <>Bound until generation {int(p.until)}: you cannot plant within {radius} cells of {other}. The dish refuses any planting that would.</>}
                {phase === "binding" && !toMe && <>{other} cannot plant within {radius} cells of your living cells until generation {int(p.until)}.</>}
                {phase === "lapsed" && <>The offer {toMe ? `from ${other}` : `to ${other}`} lapsed at generation {int(p.until)}; closing it sends its PETRI back to {toMe ? other : "you"}.</>}
                {phase === "due" && <>The pact with {other} ran its course at generation {int(p.until)}; anyone may close it.</>}
              </p>
              <div className={s.row}>
                {phase === "open" && toMe && (
                  <>
                    <button className="btn btn-amber btn-small" disabled={busy} onClick={() => act.accept(p)}>
                      Accept{p.petri > 0n ? ` ${amount(p)}` : ""}
                    </button>
                    <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => act.cancel(p, "declined")}>Decline</button>
                  </>
                )}
                {phase === "open" && !toMe && (
                  <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => act.cancel(p, "withdrawn")}>Withdraw the offer</button>
                )}
                {(phase === "lapsed" || phase === "due") && (
                  <button className="btn btn-ghost btn-small" disabled={busy} onClick={() => act.cancel(p, "closed")}>Close it</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LENGTHS = [
  { gens: 240, label: "1 hour" },
  { gens: 960, label: "4 hours" },
  { gens: 2880, label: "12 hours" },
];

/** A colony picked on the dish: who it is, what binds it, and (for a player with a colony) a pact to offer it. */
export function PickedColony({ c, live, pacts, me, g, radius, maxGens, names, canPay, holding, busy, signedIn, act, onClose }: {
  c: Colony;
  live: number;
  pacts: Pact[];
  me: Colony | null;
  g: number;
  radius: number;
  maxGens: number;
  names: Map<number, string>;
  /** why this player's colony can offer only pacts without PETRI, or null when it can pay */
  canPay: string | null;
  holding: number | null;
  busy: boolean;
  signedIn: boolean;
  act: PactActions;
  onClose: () => void;
}) {
  const [amt, setAmt] = useState("1");
  const [len, setLen] = useState(LENGTHS[0].gens);
  const lines = pactLines(pacts, c.id, g, radius, names);
  const isMe = me?.id === c.id;
  const openMine = me ? pacts.find((p) => p.from === me.id && p.to === c.id && phaseOf(p, g) === "open") : undefined;
  const liveCount = (id: number) => pacts.filter((p) => (p.from === id || p.to === id) && p.ended === null && !["due", "lapsed"].includes(phaseOf(p, g))).length;
  const full = me ? liveCount(me.id) >= 8 || liveCount(c.id) >= 8 : false;
  const units = canPay ? 0n : BigInt(Math.max(0, Math.round(Number(amt || "0") * 1e6)));
  const badAmt = !canPay && (!/^\d+(\.\d{0,6})?$/.test(amt.trim() || "0") || (holding !== null && Number(units) > holding));
  // A pact must end within pact_max_gens of the dish's generation when the offer lands; a few generations are kept spare.
  const length = Math.min(len, maxGens - 4);
  const until = g + length;
  return (
    <section className={`${s.card} ${s.pickCard}`} aria-labelledby="picked-title">
      <div className={s.plantHead}>
        <i className="swatch" style={{ background: hex(c.color), width: 16, height: 16 }} />
        <div>
          <h2 id="picked-title">{c.name}<BenchTag account={c.account} /></h2>
          <span>
            <a href={accountUrl(c.account)}>{shortAccount(c.account, 28)}</a> · <span className="num">{int(live)}</span> living cells
          </span>
        </div>
        <button className={s.close} aria-label="Close" onClick={onClose}>×</button>
      </div>
      {/* The house is exempt: it never sells and sends PETRI only within the house, whatever it holds. */}
      {!c.house && Number(c.kept ?? "0") > 0 && (
        <p className={s.hint}>
          {c.attached
            ? `${petri(Number(c.kept), 2)} of its PETRI is kept in the dish, earned before its first NEAR or bought with credit: it can plant it, not sell or send it.`
            : `It has never attached NEAR, so its ${petri(Number(c.kept), 2)} PETRI stays in the dish: it can plant it or sell it back for credit, never send it or sell it for NEAR.`}
        </p>
      )}
      {lines.length ? (
        <ul className={s.pactLines}>
          {lines.map((l) => <li key={l}>{l}.</li>)}
        </ul>
      ) : (
        <p className={s.hint}>No pact binds or protects {isMe ? "your colony" : "this colony"} now.</p>
      )}
      {lines.length > 0 && <p className={s.hint}>The outlined zone on the dish is the ground the pact keeps clear: every cell within {radius} of the protected colony&rsquo;s living cells.</p>}
      {!isMe && me && signedIn && (
        <div className={s.offerBox}>
          <h3>Offer {c.name} a pact</h3>
          <p className={s.hint}>
            {c.name} would promise to plant nowhere within {radius} cells of {me.name}&rsquo;s living cells until the generation you name. The dish
            holds the PETRI until it accepts, and pays it back if it never does. Once accepted, the contract refuses every planting of {c.name}&rsquo;s that breaks it.
          </p>
          {openMine ? (
            <p className={s.verdict}>Your offer No. {openMine.id} to {c.name} is still open: one open offer to a colony at a time.</p>
          ) : full ? (
            <p className={s.verdict}>One of the two colonies is already party to 8 pacts, the most the dish allows.</p>
          ) : (
            <>
              <div className={s.offerFields}>
                <label className={s.noteField}>
                  <span>PETRI it is paid</span>
                  <input inputMode="decimal" value={canPay ? "0" : amt} disabled={!!canPay} onChange={(e) => setAmt(e.target.value)} aria-invalid={badAmt} />
                </label>
                <fieldset className={s.lengths}>
                  <legend>For</legend>
                  {LENGTHS.map((l) => (
                    <label key={l.gens} className={len === l.gens ? s.on : undefined}>
                      <input type="radio" name="pact-len" checked={len === l.gens} onChange={() => setLen(l.gens)} />
                      {l.label}
                    </label>
                  ))}
                </fieldset>
              </div>
              <p className={s.hint}>
                {canPay ? `${canPay} ` : ""}Until generation <span className="num">{int(until)}</span>. The offer&rsquo;s storage, at most 0.0042 NEAR,
                comes from your credit or your wallet; what it does not use comes back.
              </p>
              <div className={s.stickyCta}>
                <button className="btn btn-amber" disabled={busy || badAmt} onClick={() => act.offer(c, units, until)}>
                  {units > 0n ? `Offer ${petri(Number(units), Number(units) % 1e6 ? 2 : 0)} PETRI for this pact` : "Offer a pact without PETRI"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {!isMe && !me && <p className={s.hint}>Start a colony to offer {c.name} a pact.</p>}
    </section>
  );
}
