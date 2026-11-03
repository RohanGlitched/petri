"use client";

// The dish's high scores, worked out in this browser from the contract's ledger. The ledger is replayed from
// generation zero with petri-core (the same Replayer the verify page runs), sampling every colony's living cells as it
// goes, so lifetimes and peaks are measured on the rebuilt board, not taken from anyone's word.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAllColonies, getAllLedger, getRules, getState, type Colony, type Entry } from "@/lib/chain";
import { Replayer } from "@/lib/replay";
import { loadEngine } from "@/engine";
import { useLive, hex, int, near, petri } from "@/lib/live";
import { accountUrl, shortAccount } from "@/lib/config";
import { useNet } from "@/lib/use-net";
import { sideOf } from "@/lib/strains";
import s from "./records.module.css";

/** Generations between samples of the rebuilt board: lifetimes are measured to within this. */
const SAMPLE = 8;

type Life = { id: number; from: number; to: number; alive: boolean };
type Result = {
  generation: number;
  lives: Life[];
  peak: { id: number; live: number; at: number } | null;
  biggest: { id: number; cells: number; cost: number; at: number } | null;
  siege: { id: number; cells: number; cost: number; at: number } | null;
  firstTide: { at: number; paid: number; asCredit: number; creditPaid: number; by: number } | null;
  tides: number;
  plants: number;
  sieges: number;
};

type Phase = { kind: "reading" } | { kind: "replaying"; at: number; of: number } | { kind: "done"; r: Result; colonies: Colony[] } | { kind: "error"; msg: string };

function fromLedger(ledger: Entry[]) {
  let biggest: Result["biggest"] = null;
  let siege: Result["siege"] = null;
  let firstTide: Result["firstTide"] = null;
  let tides = 0;
  let plants = 0;
  let sieges = 0;
  for (const e of ledger) {
    if ("Plant" in e) {
      const p = e.Plant;
      const row = { id: p.colony, cells: p.cells.length, cost: Number(p.cost), at: Number(p.generation) };
      plants++;
      if (!biggest || row.cells > biggest.cells || (row.cells === biggest.cells && row.cost > biggest.cost)) biggest = row;
      if (p.siege) {
        sieges++;
        if (!siege || row.cost > siege.cost) siege = row;
      }
    } else if ("Tide" in e) {
      const t = e.Tide;
      tides++;
      if (!firstTide) firstTide = { at: Number(t.generation), paid: Number(t.paid), asCredit: Number(t.as_credit), creditPaid: Number(t.credit_paid), by: t.by };
    }
  }
  return { biggest, siege, firstTide, tides, plants, sieges };
}

async function compute(onProgress: (at: number, of: number) => void): Promise<{ r: Result; colonies: Colony[] }> {
  await loadEngine();
  const [rules, state] = await Promise.all([getRules(), getState()]);
  const [colonies, ledger] = await Promise.all([getAllColonies(state.colonies), getAllLedger(Number(state.ledger))]);
  const rp = new Replayer({ rules, state, colonies, ledger, earnings: [], winnings: [], lock: null });
  const target = Number(state.generation);
  const since = new Map<number, number>();
  const lastSeen = new Map<number, number>();
  const lives: Life[] = [];
  const best = new Map<number, Life>();
  let peak: Result["peak"] = null;
  const sample = () => {
    const g = rp.generation;
    const live = rp.e.live_counts();
    for (let id = 1; id < live.length; id++) {
      const n = live[id];
      if (n > 0) {
        if (!since.has(id)) since.set(id, g);
        lastSeen.set(id, g);
        if (!peak || n > peak.live) peak = { id, live: n, at: g };
      } else if (since.has(id)) {
        const life = { id, from: since.get(id)!, to: lastSeen.get(id)!, alive: false };
        const b = best.get(id);
        if (!b || life.to - life.from > b.to - b.from) best.set(id, life);
        since.delete(id);
      }
    }
  };
  try {
    let done = false;
    let steps = 0;
    while (!done) {
      done = rp.run(SAMPLE);
      sample();
      // Hand the page back now and then so the progress shows and nothing freezes.
      if (++steps % 120 === 0) {
        onProgress(rp.generation, target);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } finally {
    rp.free();
  }
  since.forEach((from, id) => {
    const life = { id, from, to: target, alive: true };
    const b = best.get(id);
    if (!b || life.to - life.from >= b.to - b.from) best.set(id, life);
  });
  best.forEach((l) => lives.push(l));
  lives.sort((a, b) => b.to - b.from - (a.to - a.from));
  return { r: { generation: target, lives, peak, ...fromLedger(ledger) }, colonies };
}

function Holder({ c }: { c: Colony | undefined }) {
  if (!c) return <span className={s.holder}>a colony</span>;
  const side = sideOf(c.account, c.house);
  return (
    <span className={s.holder}>
      <i className="swatch" style={{ background: hex(c.color) }} />
      <b>{c.name}</b>
      {side !== "player" && <em>{side}</em>}
      <a href={accountUrl(c.account)}>{shortAccount(c.account, 26)}</a>
    </span>
  );
}

const hours = (g: number) => {
  const h = (g * 15) / 3600;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`;
};

export function Records() {
  const net = useNet();
  const { d } = useLive();
  const [phase, setPhase] = useState<Phase>({ kind: "reading" });
  useEffect(() => {
    let stop = false;
    compute((at, of) => !stop && setPhase({ kind: "replaying", at, of })).then(
      ({ r, colonies }) => !stop && setPhase({ kind: "done", r, colonies }),
      (e) => !stop && setPhase({ kind: "error", msg: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      stop = true;
    };
  }, []);

  const colonies = phase.kind === "done" ? phase.colonies : d.colonies;
  const byId = useMemo(() => new Map(colonies.map((c) => [c.id, c])), [colonies]);
  const burner = useMemo(() => colonies.slice().sort((a, b) => Number(b.petri_burned) - Number(a.petri_burned))[0], [colonies]);
  // Lifetime earnings at the stored board, claimed or not, plus what accrued since in this browser. The house earns nothing.
  const earners = useMemo(
    () =>
      d.colonies
        .filter((c) => !c.house)
        .map((c) => ({ c, earned: (d.earnings[c.id] ?? 0) + (d.pending[c.id] ?? 0) }))
        .filter((x) => x.earned > 0)
        .sort((a, b) => b.earned - a.earned)
        .slice(0, 5),
    [d.colonies, d.earnings, d.pending],
  );

  const r = phase.kind === "done" ? phase.r : null;
  const longest = r?.lives[0];
  const pending = <span className={s.wait}>{phase.kind === "error" ? "—" : "replaying…"}</span>;

  return (
    <>
      <p className={s.status} aria-live="polite">
        {phase.kind === "reading" && `Reading the whole ledger of ${net.contract} from ${net.label.chain}…`}
        {phase.kind === "replaying" && `Replaying generation ${int(phase.at)} of ${int(phase.of)} with petri-core…`}
        {phase.kind === "done" && `Replayed all ${int(phase.r.generation)} generations of ${net.contract} in this browser, from ${int(phase.r.plants)} ${phase.r.plants === 1 ? "planting" : "plantings"} and ${int(phase.r.tides)} ${phase.r.tides === 1 ? "tide" : "tides"}.`}
        {phase.kind === "error" && `The ledger could not be read (${phase.msg}). Reload the page to try again.`}
        {phase.kind === "replaying" && (
          <span className={s.track} aria-hidden="true">
            <i style={{ width: `${Math.min(100, (100 * phase.at) / Math.max(1, phase.of))}%` }} />
          </span>
        )}
      </p>

      <ul className={s.board}>
        <li className={s.feature}>
          <h2>Longest-lived colony</h2>
          <p className={s.big}>
            {longest ? (
              <>
                <span className="num">{int(longest.to - longest.from)}</span> <small>generations, {hours(longest.to - longest.from)}</small>
              </>
            ) : (
              r ? "—" : pending
            )}
          </p>
          {longest && <Holder c={byId.get(longest.id)} />}
          <p className={s.detail}>
            {longest
              ? longest.alive
                ? `Alive without a break since generation ${int(longest.from)}, and still alive.`
                : `Alive from generation ${int(longest.from)} to ${int(longest.to)}.`
              : "The longest unbroken stretch any colony has had at least one living cell."}
          </p>
          {r && r.lives.length > 1 && (
            <ol className={s.runners}>
              {r.lives.slice(1, 4).map((l) => (
                <li key={l.id}>
                  <i className="swatch" style={{ background: hex(byId.get(l.id)?.color ?? 0x888888) }} />
                  {byId.get(l.id)?.name ?? `Colony ${l.id}`}
                  <span className="num">{int(l.to - l.from)} gens</span>
                </li>
              ))}
            </ol>
          )}
        </li>

        <li>
          <h2>Biggest colony ever</h2>
          <p className={s.big}>{r?.peak ? <><span className="num">{int(r.peak.live)}</span> <small>living cells</small></> : r ? "—" : pending}</p>
          {r?.peak && <Holder c={byId.get(r.peak.id)} />}
          <p className={s.detail}>{r?.peak ? `At generation ${int(r.peak.at)}.` : "The most living cells one colony has held at once."}</p>
        </li>

        <li>
          <h2>Biggest planting</h2>
          <p className={s.big}>{r?.biggest ? <><span className="num">{int(r.biggest.cells)}</span> <small>cells at once</small></> : r ? "—" : pending}</p>
          {r?.biggest && <Holder c={byId.get(r.biggest.id)} />}
          <p className={s.detail}>{r?.biggest ? `${petri(r.biggest.cost, 2)} PETRI at generation ${int(r.biggest.at)}.` : "The most cells planted in one transaction."}</p>
        </li>

        <li>
          <h2>Most PETRI burned</h2>
          <p className={s.big}>{burner && Number(burner.petri_burned) > 0 ? <><span className="num">{petri(Number(burner.petri_burned), 2)}</span> <small>PETRI</small></> : r ? "—" : pending}</p>
          {burner && Number(burner.petri_burned) > 0 && <Holder c={burner} />}
          <p className={s.detail}>Half of every planting and the whole price of every specimen slide burns for good. Supply only falls.</p>
        </li>

        <li>
          <h2>Biggest siege</h2>
          <p className={s.big}>{r?.siege ? <><span className="num">{petri(r.siege.cost, 2)}</span> <small>PETRI</small></> : r ? <span className={s.none}>No siege yet</span> : pending}</p>
          {r?.siege && <Holder c={byId.get(r.siege.id)} />}
          <p className={s.detail}>
            {r?.siege
              ? `${int(r.siege.cells)} cells inside a rival's buffer at generation ${int(r.siege.at)}, at ${d.rules?.siege_x ?? 3} times the price. ${int(r.sieges)} ${r.sieges === 1 ? "siege" : "sieges"} in all.`
              : "Planting within three cells of a rival costs three times as much. Nobody has paid it yet; the house never does."}
          </p>
        </li>

        <li>
          <h2>First tide</h2>
          <p className={s.big}>
            {r?.firstTide ? <><small>generation</small> <span className="num">{int(r.firstTide.at)}</span></> : r ? <span className={s.none}>Not yet</span> : pending}
          </p>
          {r?.firstTide && r.firstTide.by > 0 && <Holder c={byId.get(r.firstTide.by)} />}
          <p className={s.detail}>
            {r?.firstTide
              ? `Paid ${near(r.firstTide.paid, 4)} NEAR${r.firstTide.asCredit + r.firstTide.creditPaid > 0 ? ` and ${near(r.firstTide.asCredit + r.firstTide.creditPaid, 4)} as credit` : ""} to the colonies that had earned${r.firstTide.by > 0 ? "; this colony's transaction ran it" : ""}.`
              : "A tide runs every 240 generations once some colony outside the house has earned. The first one is still to come."}
          </p>
        </li>
      </ul>

      <section className={s.earners} aria-labelledby="earners-title">
        <h2 id="earners-title" className="h3">Top earners</h2>
        {earners.length > 0 ? (
          <ol>
            {earners.map(({ c, earned }, i) => (
              <li key={c.id}>
                <span className={`num ${s.rank}`}>{i + 1}</span>
                <Holder c={c} />
                <span className={`num ${s.earned}`}>{petri(earned, 2)} <small>PETRI</small></span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">
            {d.status === "ready" ? (
              <>
                Nobody outside the house has earned yet. <Link href="/dish">Start a colony</Link> and the top line is yours.
              </>
            ) : (
              "Reading the dish…"
            )}
          </p>
        )}
        <p className={s.note}>Lifetime PETRI each colony&rsquo;s cells earned, claimed or not. The house strains are never fed, so they never appear here.</p>
      </section>

      <p className={s.method}>
        How this page knows: it reads every entry of the ledger from {net.contract} and replays the dish from an empty board
        with petri-core, the Rust code the contract runs, compiled to WebAssembly. Lifetimes and peaks are measured on that
        rebuilt board every {SAMPLE} generations or sooner; plantings, sieges and tides come straight from their ledger entries;
        PETRI burned and earned come from the contract&rsquo;s own counters. <Link href="/verify">Check the whole replay</Link>.
      </p>
    </>
  );
}
