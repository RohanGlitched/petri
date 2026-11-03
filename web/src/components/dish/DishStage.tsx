"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import { Loupe } from "@/components/site/Loupe";
import { Specimen } from "@/components/site/Specimen";
import { currentEngine, refreshDish } from "@/lib/dish-store";
import { useLive, usePatternOffsets, petri, int, hex } from "@/lib/live";
import { createGuest, joinDish, plantCells, usePlayer, forgetGuest } from "@/lib/wallet";
import { pattern_cells, quote, PATTERNS, type PatternName } from "@/engine";
import { getBalance, getColonyOf, type Colony } from "@/lib/chain";
import { accountUrl, shortAccount, txUrl } from "@/lib/config";
import { STAINS } from "@/lib/stains";
import { strainOf } from "@/lib/strains";
import s from "./dish.module.css";

type Cell = { x: number; y: number };
type Pending = { cells: number[]; label: string; at: number; hash?: string };

function explain(v: string | null, w: number, names: Map<number, string>): string {
  if (!v) return "";
  const [kind, a, b] = v.split(":");
  const at = (i: string) => `${Number(i) % w}, ${Math.floor(Number(i) / w)}`;
  switch (kind) {
    case "occupied":
      return `Cell ${at(a)} is already alive. Move the stamp onto empty agar.`;
    case "too_close":
      return `Cell ${at(a)} is inside ${names.get(Number(b)) ?? `colony ${b}`}’s buffer, the hatched zone. Plant further out, or send a glider.`;
    case "too_many":
      return `At most ${a} cells in one planting.`;
    default:
      return "That spot does not work.";
  }
}

function Countdown({ ms, total }: { ms: number; total: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  const f = total > 0 ? Math.min(1, Math.max(0, ms / total)) : 0;
  return (
    <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true" className={s.ring}>
      <circle cx="19" cy="19" r={r} fill="none" stroke="rgba(243,233,218,0.14)" strokeWidth="3" />
      <circle cx="19" cy="19" r={r} fill="none" stroke="#f2b45a" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * f} transform="rotate(-90 19 19)" style={{ transition: "stroke-dashoffset 0.25s linear" }} />
    </svg>
  );
}

export function DishStage() {
  const { d, rules, palette, perCell, ready, colonies, w, h, secs } = useLive();
  const player = usePlayer();
  const offsets = usePatternOffsets();
  const lens = useRef<CultureHandle>(null);

  const [me, setMe] = useState<Colony | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [pattern, setPattern] = useState<PatternName | null>(null);
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip] = useState(false);
  const [target, setTarget] = useState<Cell | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  const [snapped, setSnapped] = useState(false);

  const names = useMemo(() => new Map(d.colonies.map((c) => [c.id, c.name])), [d.colonies]);

  const loadMe = useCallback(async () => {
    if (!player) {
      setMe(null);
      setBalance(null);
      return;
    }
    try {
      const [c, b] = await Promise.all([getColonyOf(player.accountId), getBalance(player.accountId)]);
      setMe(c);
      setBalance(Number(b));
    } catch {
      /* the next poll retries */
    }
  }, [player]);
  useEffect(() => {
    loadMe();
    const t = setInterval(loadMe, 8000);
    return () => clearInterval(t);
  }, [loadMe]);

  // R rotates, F flips, Escape puts the stamp down.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "r" || e.key === "R") setRotate((r) => (r + 1) % 4);
      if (e.key === "f" || e.key === "F") setFlip((f) => !f);
      if (e.key === "Escape") {
        setPattern(null);
        setTarget(null);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  const anchor = target ?? hover;
  const stamp = useMemo(() => {
    if (!pattern || !anchor) return null;
    return Array.from(pattern_cells(pattern, anchor.x, anchor.y, w, h, rotate, flip));
  }, [pattern, anchor, rotate, flip, w, h]);

  const verdict = useMemo(() => {
    if (!stamp || !rules) return null;
    const e = currentEngine();
    if (!e) return null;
    return e.check_plant(me?.id ?? 65535, new Uint32Array(stamp), rules.buffer, rules.max_plant_cells);
    // d.generation keeps the check fresh as the dish moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, rules, d.generation, me]);

  const overlay = useMemo(() => {
    const o = new Uint8Array(w * h);
    if (pattern && d.cells && rules) {
      const b = rules.buffer;
      const myId = me?.id ?? -1;
      for (let i = 0; i < d.cells.length; i++) {
        const c = d.cells[i];
        if (c === 0 || c === myId) continue;
        const x = i % w;
        const y = (i / w) | 0;
        for (let dy = -b; dy <= b; dy++) {
          const row = ((y + dy + h) % h) * w;
          for (let dx = -b; dx <= b; dx++) o[row + ((x + dx + w) % w)] = 3;
        }
      }
    }
    if (stamp) for (const i of stamp) o[i] = verdict === "" ? 1 : 2;
    if (pending) for (const i of pending.cells) o[i] = 4;
    return o;
  }, [pattern, d.cells, rules, me, stamp, verdict, pending, w, h]);

  useEffect(() => {
    if (!pending) return;
    if (d.cells && pending.cells.every((i) => d.cells![i] !== 0) && Date.now() - pending.at > 1500) setPending(null);
    if (Date.now() - pending.at > 60_000) setPending(null);
  }, [d.cells, pending]);

  const info = PATTERNS.find((p) => p.name === pattern);
  // The contract's own price formula, from the same crate.
  const costOf = (n: number) => (rules && ready ? Number(quote(rules.plant_cost, n, d.totalLive, rules.capacity)) : 0);
  const cost = info ? costOf(stamp?.length ?? info.cells) : 0;
  const myLive = me ? d.liveCounts[me.id] ?? 0 : 0;
  const myPending = me ? d.pending[me.id] ?? 0 : 0;
  const plantedThisGen = me?.last_plant_generation != null && Number(me.last_plant_generation) >= d.generation;
  const canAfford = balance !== null && balance >= cost;
  const myColor = me ? hex(me.color) : "#f2b45a";

  async function start(name: string, color: number) {
    setError(null);
    setDone(null);
    try {
      if (!player) {
        setBusy("Making your guest account on NEAR testnet…");
        await createGuest();
      }
      setBusy("Joining the dish…");
      const r = await joinDish(name, color);
      setDone({ text: `${name} is on the dish with ${petri(Number(rules?.starter_grant ?? 0))} PETRI from the agar. Pick a stamp below and plant it.`, hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function plant() {
    if (!stamp || !info) return;
    setError(null);
    setDone(null);
    setBusy(`Planting a ${info.label.toLowerCase()}…`);
    const cells = stamp.slice();
    setPending({ cells, label: info.label, at: Date.now() });
    try {
      const r = await plantCells(cells, note);
      setDone({ text: `Planted a ${info.label.toLowerCase()}: ${cells.length} cells for ${petri(cost, 2)} PETRI, half burned and half back to the agar.`, hash: r.hash });
      setPending({ cells, label: info.label, at: Date.now(), hash: r.hash });
      setTarget(null);
      setNote("");
      await refreshDish();
      await loadMe();
    } catch (e) {
      setPending(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function findMine() {
    if (!me || !d.cells) return;
    let first = -1;
    let sx = 0, sy = 0, n = 0;
    for (let i = 0; i < d.cells.length; i++) {
      if (d.cells[i] === me.id) {
        if (first < 0) first = i;
        sx += i % w;
        sy += (i / w) | 0;
        n++;
      }
    }
    if (n === 0) return;
    lens.current?.centerOn(first % w, (first / w) | 0);
    if (n < 400) lens.current?.centerOn(Math.round(sx / n), Math.round(sy / n));
  }

  /** The legal anchor nearest to (x, y) for the chosen stamp, searching outward ring by ring. */
  function nearestFit(x: number, y: number, maxR = 18): Cell | null {
    const e = currentEngine();
    if (!e || !pattern || !rules) return null;
    const id = me?.id ?? 65535;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ax = (((x + dx) % w) + w) % w;
          const ay = (((y + dy) % h) + h) % h;
          const cells = pattern_cells(pattern, ax, ay, w, h, rotate, flip);
          if (e.check_plant(id, cells, rules.buffer, rules.max_plant_cells) === "") return { x: ax, y: ay };
        }
      }
    }
    return null;
  }

  /** Centre the view on the roomiest open agar: the free spot farthest from any rival. */
  function findOpen() {
    const e = currentEngine();
    if (!e || !d.cells || !rules) return;
    const myId = me?.id ?? -1;
    const step = 4;
    let best = -1;
    let at: Cell | null = null;
    for (let y = 0; y < h; y += step)
      for (let x = 0; x < w; x += step) {
        let near = 99;
        for (let r = 1; r < 14 && near === 99; r++)
          for (let dy = -r; dy <= r && near === 99; dy++)
            for (let dx = -r; dx <= r; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const c = d.cells[(((y + dy) % h + h) % h) * w + ((((x + dx) % w) + w) % w)];
              if (c !== 0 && c !== myId) {
                near = r;
                break;
              }
            }
        if (near > best) {
          best = near;
          at = { x, y };
        }
      }
    if (at) {
      lens.current?.centerOn(at.x, at.y, Math.max(lens.current.camera().zoom, lens.current.view().roundFit * 6));
      setDone({ text: `The roomiest open agar is around ${at.x}, ${at.y}, ${best >= 99 ? "13+" : best} cells from the nearest rival.` });
    }
  }

  const hovered = hover && d.cells ? d.cells[hover.y * w + hover.x] : 0;
  const hoveredColony = hovered ? colonies.find((c) => c.id === hovered) : null;
  const genMs = rules ? Number(rules.generation_ms) : 15000;

  return (
    <div className={s.app}>
      <div className={s.canvas}>
        <Culture
          ref={lens}
          width={w}
          height={h}
          cells={d.cells}
          prevCells={d.prevCells}
          changedAt={d.changedAt}
          palette={palette}
          look="macro"
          fit="cover"
          zoomScale={1.15}
          overlay={overlay}
          interactive
          maxDpr={1.5}
          onHover={(c) => !target && setHover(c)}
          onCellClick={(c) => {
            if (pattern) {
              const e = currentEngine();
              const cells = pattern_cells(pattern, c.x, c.y, w, h, rotate, flip);
              const fits = e && rules ? e.check_plant(me?.id ?? 65535, cells, rules.buffer, rules.max_plant_cells) === "" : false;
              const spot = fits ? c : nearestFit(c.x, c.y);
              setTarget(spot ?? c);
              setSnapped(!fits && !!spot);
              setHover(spot ?? c);
              return;
            }
            setHover(c);
          }}
          label={`The live dish, generation ${d.generation}. Drag to move, scroll or pinch to zoom.`}
        />
      </div>

      <div className={s.hud} aria-live="polite">
        <div className={s.hudGen}>
          <Countdown ms={d.nextInMs} total={genMs} />
          <div>
            <span>Generation</span>
            <b className="num">{ready ? int(d.generation) : "—"}</b>
          </div>
        </div>
        <div><span>Next in</span><b className="num">{ready ? `${secs}s` : "—"}</b></div>
        <div><span>Living cells</span><b className="num">{ready ? int(d.totalLive) : "—"}</b></div>
        <div><span>Each cell earns</span><b className="num">{ready ? petri(perCell, 4) : "—"}</b></div>
        <div><span>Agar</span><b className="num">{ready ? petri(d.agar) : "—"}</b></div>
      </div>

      <aside className={s.left}>
        {info && (
          <section className={`${s.card} ${s.plantCard}`}>
            <div className={s.plantHead}>
              <Specimen offsets={offsets[info.name]} color={myColor} size={48} />
              <div>
                <h2>{info.label}</h2>
                <span className="num">{stamp?.length ?? info.cells} cells, {petri(cost, 2)} PETRI</span>
              </div>
              <button className={s.close} aria-label="Put the stamp down" onClick={() => { setPattern(null); setTarget(null); }}>×</button>
            </div>
            <p className={s.hint}>{info.note}</p>
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={() => setRotate((r) => (r + 1) % 4)}>Rotate <kbd>R</kbd></button>
              <button className="btn btn-ghost btn-small" onClick={() => setFlip((f) => !f)}>Flip <kbd>F</kbd></button>
            </div>
            <p className={`${s.verdict} ${verdict === "" ? s.ok : verdict ? s.bad : ""}`}>
              {!anchor ? "Point at the dish, then click where it should grow." : verdict === "" ? `${snapped && target ? "That spot was taken, so the stamp moved to the nearest one that fits: " : "Fits at "}${anchor.x}, ${anchor.y}.${target ? "" : " Click to place it."}` : explain(verdict, w, names)}
            </p>
            {me && (
              <label className={s.noteField}>
                <span>Lab note, stored on chain with the planting (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Why here? Anyone reading the dish will see it." />
                <em className="num">{note.length}/140</em>
              </label>
            )}
            <button className="btn btn-amber" disabled={!me || !target || verdict !== "" || !!busy || !canAfford || plantedThisGen} onClick={plant}>
              {!me
                ? "Start a colony to plant"
                : !target
                  ? "Click the dish to place it"
                  : !canAfford
                    ? `You need ${petri(cost, 2)} PETRI`
                    : plantedThisGen
                      ? "One planting per generation. Next one soon"
                      : `Plant the ${info.label.toLowerCase()} here`}
            </button>
          </section>
        )}

        {!me ? (
          <JoinForm onStart={start} busy={!!busy} hasGuest={!!player} grant={rules ? petri(Number(rules.starter_grant)) : "64"} />
        ) : (
          <section className={s.card}>
            <div className={s.meHead}>
              <i className="swatch" style={{ background: myColor, width: 16, height: 16 }} />
              <h2>{me.name}</h2>
            </div>
            <a className={s.acct} href={accountUrl(me.account)}>{shortAccount(me.account, 34)}</a>
            <dl className={s.meStats}>
              <div><dt>Holding</dt><dd className="num">{balance === null ? "—" : petri(balance, 2)}</dd></div>
              <div><dt>Accruing</dt><dd className="num">+{petri(Math.max(0, myPending), 3)}</dd></div>
              <div><dt>Living cells</dt><dd className="num">{int(myLive)}</dd></div>
              <div><dt>Share of dish</dt><dd className="num">{d.totalLive ? ((100 * myLive) / d.totalLive).toFixed(1) : "0"}%</dd></div>
            </dl>
            <p className={s.hint}>Accruing PETRI is already yours by the rules. It lands in your balance the next time anyone advances the dish.</p>
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={findMine} disabled={myLive === 0}>Find my colony</button>
              <button
                className={s.linkish}
                onClick={() => confirm("Forget this guest? The colony stays on the dish, but this browser loses its key and cannot plant for it again.") && forgetGuest()}
              >
                Forget this guest
              </button>
            </div>
          </section>
        )}

        {(busy || error || done) && (
          <section className={`${s.card} ${s.status}`} aria-live="polite">
            {busy && <p className={s.busy}><i className={s.spin} />{busy}</p>}
            {error && <p className={s.bad}>{error}</p>}
            {done && (
              <p className={s.ok}>
                {done.text} {done.hash && <a href={txUrl(done.hash)}>See the transaction</a>}
              </p>
            )}
          </section>
        )}
      </aside>

      <aside className={s.right}>
        <Loupe
          target={lens}
          width={w}
          height={h}
          cells={d.cells}
          prevCells={d.prevCells}
          changedAt={d.changedAt}
          palette={palette}
          className={s.loupe}
          onPick={(x, y) => lens.current?.centerOn(x, y)}
        />
        <div className={s.zoom}>
          <button onClick={() => lens.current?.zoomBy(1.5)} aria-label="Look closer">+</button>
          <button onClick={() => lens.current?.zoomBy(1 / 1.5)} aria-label="Look wider">−</button>
          <button onClick={() => lens.current?.setZoomFit(Math.SQRT2)}>Whole dish</button>
          <button onClick={findOpen}>Find open agar</button>
        </div>
        <section className={`${s.card} ${s.log}`}>
          <button className={s.logHead} onClick={() => setLogOpen((o) => !o)} aria-expanded={logOpen}>
            <h2>Lab log</h2>
            <span>{logOpen ? "Hide" : "Show"}</span>
          </button>
          {logOpen && (
            <ol>
              {d.recentPlants.slice(0, 12).map((p, i) => {
                const c = d.colonies.find((x) => x.id === p.colony);
                const ai = c ? strainOf(c.account) : null;
                return (
                  <li key={`${p.generation}-${i}`}>
                    <i className="swatch" style={{ background: c ? hex(c.color) : "#888" }} />
                    <div>
                      <p>
                        <b>{c?.name ?? `Colony ${p.colony}`}</b>
                        {ai && <span className={s.aiTag}>AI</span>} planted {p.cells.length} cells
                        <span className={`num ${s.gen}`}>gen {int(Number(p.generation))}</span>
                      </p>
                      {p.note && <q>{p.note}</q>}
                    </div>
                  </li>
                );
              })}
              {d.recentPlants.length === 0 && <li className={s.hint}>Nothing planted yet.</li>}
            </ol>
          )}
        </section>
      </aside>

      <div className={s.inspect} aria-live="polite">
        {hover ? (
          <>
            <span className="num">{hover.x}, {hover.y}</span>
            {hoveredColony ? (
              <span className={s.owner}>
                <i className="swatch" style={{ background: hex(hoveredColony.color) }} />
                {hoveredColony.name}
                <a href={accountUrl(hoveredColony.account)}>{shortAccount(hoveredColony.account, 24)}</a>
              </span>
            ) : (
              <span className={s.hintInline}>bare agar</span>
            )}
          </>
        ) : (
          <span className={s.hintInline}>Drag to move. Scroll or pinch to zoom. The edges wrap.</span>
        )}
      </div>

      <nav className={s.dock} aria-label="Stamps">
        <ul>
          {PATTERNS.map((p) => (
            <li key={p.name}>
              <button
                className={`${s.stamp} ${pattern === p.name ? s.on : ""}`}
                aria-pressed={pattern === p.name}
                onClick={() => {
                  setPattern(pattern === p.name ? null : p.name);
                  setTarget(null);
                }}
                title={p.note}
              >
                <Specimen offsets={offsets[p.name]} color={myColor} size={40} />
                <span className={s.stampName}>{p.label}</span>
                <span className={`num ${s.stampCost}`}>{ready ? petri(costOf(p.cells), 1) : p.cells}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {d.status === "error" && (
        <p className={s.err}>The dish could not be read from NEAR ({d.error}). Retrying every few seconds.</p>
      )}
    </div>
  );
}

function JoinForm({ onStart, busy, hasGuest, grant }: { onStart: (name: string, color: number) => void; busy: boolean; hasGuest: boolean; grant: string }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(STAINS[0].color);
  useEffect(() => setColor(STAINS[Math.floor(Math.random() * STAINS.length)].color), []);
  const valid = name.trim().length > 0 && name.trim().length <= 24;
  return (
    <section className={s.card}>
      <h2 className={s.joinTitle}>Start a colony</h2>
      <p className={s.hint}>
        Name it and choose its stain. The agar grants it {grant} PETRI to plant with.
        {hasGuest ? "" : " You get a guest account on NEAR testnet: no wallet, no gas."}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onStart(name.trim(), color);
        }}
      >
        <label className={s.field}>
          <span>Colony name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Night Shift" />
        </label>
        <fieldset className={s.stains}>
          <legend>Stain <em>{STAINS.find((x) => x.color === color)?.name}</em></legend>
          {STAINS.map((st) => (
            <label key={st.color} className={color === st.color ? s.stainOn : undefined} title={st.name}>
              <input type="radio" name="stain" checked={color === st.color} onChange={() => setColor(st.color)} />
              <i style={{ background: hex(st.color) }} />
              <span className="sr">{st.name}</span>
            </label>
          ))}
        </fieldset>
        <button className="btn btn-amber" type="submit" disabled={!valid || busy} style={{ width: "100%" }}>
          Start my colony
        </button>
      </form>
      <p className={s.hint} style={{ marginTop: 12 }}>
        New here? <Link href="/rules">Read how it works</Link> first, or just plant a block and watch.
      </p>
    </section>
  );
}
