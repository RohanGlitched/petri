"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eyepiece, type EyepieceHandle } from "./Eyepiece";
import { PatternGlyph } from "./PatternGlyph";
import { usePalette } from "./LiveHero";
import { currentEngine, refreshDish, useDish } from "@/lib/dish-store";
import { createGuest, joinDish, plantCells, usePlayer, forgetGuest } from "@/lib/wallet";
import { loadEngine, pattern_cells, quote, PATTERNS, type PatternName } from "@/engine";
import { colorHex, getBalance, getColonyOf, type Colony } from "@/lib/chain";
import { accountUrl, fmtPetri, shortAccount, txUrl } from "@/lib/config";
import { STAINS, stainName } from "@/lib/stains";

type Cell = { x: number; y: number };
type Pending = { cells: number[]; label: string; at: number; hash?: string };

export function DishApp() {
  const d = useDish();
  const player = usePlayer();
  const palette = usePalette(d.colonies);
  const lens = useRef<EyepieceHandle>(null);
  const w = d.rules?.width ?? 128;
  const h = d.rules?.height ?? 128;

  const [me, setMe] = useState<Colony | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [hover, setHover] = useState<Cell | null>(null);
  const [pattern, setPattern] = useState<PatternName | null>(null);
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip] = useState(false);
  const [target, setTarget] = useState<Cell | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ text: string; hash?: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [glyphs, setGlyphs] = useState<Record<string, [number, number][]>>({});

  // Pattern drawings come from the same pattern table the contract tests use.
  useEffect(() => {
    loadEngine().then(() => {
      const out: Record<string, [number, number][]> = {};
      for (const p of PATTERNS) {
        const idx = Array.from(pattern_cells(p.name, 0, 0, 128, 128, 0, false));
        out[p.name] = idx.map((i) => [i % 128, Math.floor(i / 128)] as [number, number]);
      }
      setGlyphs(out);
    });
  }, []);

  // Who am I on the dish?
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
      /* next poll */
    }
  }, [player]);
  useEffect(() => {
    loadMe();
    const t = setInterval(loadMe, 8000);
    return () => clearInterval(t);
  }, [loadMe]);

  // Keyboard: R rotates, F flips, Escape leaves planting.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
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
    if (!stamp || !d.rules) return null;
    const e = currentEngine();
    if (!e) return null;
    const id = me?.id ?? 65535;
    return e.check_plant(id, new Uint32Array(stamp), d.rules.buffer, d.rules.max_plant_cells);
    // d.generation keeps this fresh as the dish moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, d.rules, d.generation, me]);

  // Overlay: rival buffers while planting, the ghost stamp, and a planting waiting for the chain.
  const overlay = useMemo(() => {
    const o = new Uint8Array(w * h);
    if (pattern && d.cells && d.rules) {
      const b = d.rules.buffer;
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
  }, [pattern, d.cells, d.rules, me, stamp, verdict, pending, w, h]);

  // A pending planting clears once the chain shows it (the plant log grows) or after a minute.
  useEffect(() => {
    if (!pending) return;
    if (d.cells && pending.cells.every((i) => d.cells![i] !== 0) && Date.now() - pending.at > 1500) setPending(null);
    if (Date.now() - pending.at > 60_000) setPending(null);
  }, [d.cells, pending]);

  const info = PATTERNS.find((p) => p.name === pattern);
  const cost = info && d.rules && glyphs[info.name] ? Number(quote(d.rules.plant_cost, info.cells, d.totalLive, d.rules.capacity)) : 0;
  const myLive = me ? d.liveCounts[me.id] ?? 0 : 0;
  const myPending = me ? d.pending[me.id] ?? 0 : 0;
  const plantedThisGen = me?.last_plant_generation != null && Number(me.last_plant_generation) >= d.generation;
  const canAfford = balance !== null && balance >= cost;

  async function start(name: string, color: number) {
    setError(null);
    setDone(null);
    try {
      let account = player?.accountId;
      if (!account) {
        setBusy("Making your guest account on NEAR testnet…");
        account = await createGuest();
      }
      setBusy("Joining the dish…");
      const r = await joinDish(name, color);
      setDone({ text: `${name} joined the dish with ${fmtPetri(d.rules?.starter_grant ?? 0)} PETRI from the agar. Pick a pattern and plant it.`, hash: r.hash });
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
      const r = await plantCells(cells);
      setDone({ text: `Planted a ${info.label.toLowerCase()} (${cells.length} cells for ${fmtPetri(cost)} PETRI: half burned, half back to the agar).`, hash: r.hash });
      setPending({ cells, label: info.label, at: Date.now(), hash: r.hash });
      setTarget(null);
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
    let sx = 0, sy = 0, n = 0, first = -1;
    for (let i = 0; i < d.cells.length; i++) {
      if (d.cells[i] === me.id) {
        if (first < 0) first = i;
        sx += i % w;
        sy += (i / w) | 0;
        n++;
      }
    }
    if (n === 0) return;
    // Wrapped colonies can average to empty space; centre on the first cell when they spread too wide.
    lens.current?.centerOn(first % w, (first / w) | 0);
    if (n < 400) lens.current?.centerOn(Math.round(sx / n), Math.round(sy / n));
  }

  const hovered = hover && d.cells ? d.cells[hover.y * w + hover.x] : 0;
  const hoveredColony = hovered ? d.colonies.find((c) => c.id === hovered) : null;

  return (
    <div className="dishapp">
      <div className="dishapp-lens">
        <Eyepiece
          ref={lens}
          width={w}
          height={h}
          cells={d.cells}
          prevCells={d.prevCells}
          changedAt={d.changedAt}
          palette={palette}
          overlay={overlay}
          onHover={(c) => !target && setHover(c)}
          onCellClick={(c) => {
            if (pattern) setTarget(c);
            setHover(c);
          }}
          label={`The live dish, generation ${d.generation}`}
        />
        <div className="lens-tools">
          <button className="btn btn-quiet btn-small" onClick={() => lens.current?.zoomBy(1.6)} aria-label="Look closer">+</button>
          <button className="btn btn-quiet btn-small" onClick={() => lens.current?.zoomBy(1 / 1.6)} aria-label="Look wider">−</button>
          <button className="btn btn-quiet btn-small" onClick={() => lens.current?.fit()}>Whole dish</button>
          {me && <button className="btn btn-quiet btn-small" onClick={findMine}>Find my colony</button>}
        </div>
        <div className="inspector inst" aria-live="polite">
          {hover ? (
            <>
              <span>Cell {hover.x}, {hover.y}</span>
              {hoveredColony ? (
                <span>
                  <i className="swatch" style={{ background: colorHex(hoveredColony.color) }} />
                  {hoveredColony.name} <a href={accountUrl(hoveredColony.account)}>{shortAccount(hoveredColony.account)}</a>
                </span>
              ) : (
                <span className="muted">empty agar</span>
              )}
            </>
          ) : (
            <span className="muted">Point at a cell to see who owns it.</span>
          )}
        </div>
      </div>

      <aside className="dishapp-panel">
        <section className="panel-block">
          <dl className="mini-readout">
            <div><dt>Generation</dt><dd className="num">{d.status === "ready" ? d.generation.toLocaleString("en-US") : "—"}</dd></div>
            <div><dt>Next in</dt><dd className="num">{d.status === "ready" ? `${Math.ceil(d.nextInMs / 1000)}s` : "—"}</dd></div>
            <div><dt>Living cells</dt><dd className="num">{d.totalLive.toLocaleString("en-US")}</dd></div>
            <div><dt>Colonies</dt><dd className="num">{d.colonies.length}</dd></div>
          </dl>
          {d.ahead > 0 && (
            <p className="hint">
              Your browser is {d.ahead} generation{d.ahead === 1 ? "" : "s"} ahead of the stored board. Same rules, same
              result; the next transaction catches the contract up.
            </p>
          )}
        </section>

        {!me ? (
          <JoinForm onStart={start} busy={!!busy} player={player?.accountId ?? null} />
        ) : (
          <section className="panel-block">
            <h2 className="panel-title">
              <i className="swatch" style={{ background: colorHex(me.color) }} />
              {me.name}
            </h2>
            <p className="muted inst small">
              <a href={accountUrl(me.account)}>{shortAccount(me.account, 30)}</a>
              {stainName(me.color) ? `, stained ${stainName(me.color)!.toLowerCase()}` : ""}
            </p>
            <dl className="mini-readout">
              <div><dt>Holding</dt><dd className="num">{balance === null ? "—" : fmtPetri(balance)}<small> PETRI</small></dd></div>
              <div><dt>Accruing</dt><dd className="num">+{fmtPetri(myPending, 3)}</dd></div>
              <div><dt>Living cells</dt><dd className="num">{myLive}</dd></div>
              <div><dt>Share of the dish</dt><dd className="num">{d.totalLive ? ((100 * myLive) / d.totalLive).toFixed(1) : "0"}%</dd></div>
            </dl>
            <p className="hint">
              Accruing PETRI is already yours by the rules; it lands in your balance when the dish next advances on chain.
            </p>
          </section>
        )}

        <section className="panel-block">
          <h2 className="panel-title">Specimen tray</h2>
          <p className="hint">Choose a pattern, then click the dish where it should grow. R rotates, F flips.</p>
          <div className="tray" role="listbox" aria-label="Patterns">
            {PATTERNS.map((p) => (
              <button
                key={p.name}
                role="option"
                aria-selected={pattern === p.name}
                className={`stamp ${pattern === p.name ? "is-on" : ""}`}
                onClick={() => {
                  setPattern(pattern === p.name ? null : p.name);
                  setTarget(null);
                }}
                title={p.note}
              >
                {glyphs[p.name] && <PatternGlyph offsets={glyphs[p.name]} color={me ? colorHex(me.color) : "currentColor"} size={40} />}
                <span className="stamp-name">{p.label}</span>
                <span className="stamp-cost num">{p.cells}</span>
              </button>
            ))}
          </div>
          {info && (
            <div className="plant-box">
              <p className="plant-note">{info.note}</p>
              <div className="plant-controls">
                <button className="btn btn-quiet btn-small" onClick={() => setRotate((r) => (r + 1) % 4)}>Rotate</button>
                <button className="btn btn-quiet btn-small" onClick={() => setFlip((f) => !f)}>Flip</button>
                <span className="num cost">{fmtPetri(cost)} PETRI</span>
              </div>
              <p className="plant-status">
                {!anchor
                  ? "Click a spot on the dish."
                  : verdict === ""
                    ? `Fits at ${anchor.x}, ${anchor.y}.`
                    : explain(verdict, w)}
              </p>
              <button
                className="btn"
                disabled={!me || !target || verdict !== "" || !!busy || !canAfford || plantedThisGen}
                onClick={plant}
              >
                {!me
                  ? "Start a colony to plant"
                  : !target
                    ? "Click the dish to place it"
                    : !canAfford
                      ? `You need ${fmtPetri(cost)} PETRI`
                      : plantedThisGen
                        ? "Planted this generation; wait for the next"
                        : `Plant ${info.label.toLowerCase()} here`}
              </button>
            </div>
          )}
        </section>

        {(busy || error || done) && (
          <section className="panel-block" aria-live="polite">
            {busy && <p className="status-busy">{busy}</p>}
            {error && <p className="status-bad">{error}</p>}
            {done && (
              <p className="status-ok">
                {done.text} {done.hash && <a href={txUrl(done.hash)}>See the transaction</a>}
              </p>
            )}
          </section>
        )}

        <section className="panel-block">
          <h2 className="panel-title">Lab log</h2>
          <ol className="log">
            {d.recentPlants.slice(0, 10).map((p, i) => {
              const c = d.colonies.find((x) => x.id === p.colony);
              return (
                <li key={i}>
                  <i className="swatch" style={{ background: c ? colorHex(c.color) : "#999" }} />
                  <span>
                    {c?.name ?? `Colony ${p.colony}`} planted {p.cells.length} cells
                  </span>
                  <span className="num muted">gen {Number(p.generation).toLocaleString("en-US")}</span>
                </li>
              );
            })}
            {d.recentPlants.length === 0 && <li className="muted">Nothing planted yet. The first colony sets the tone.</li>}
          </ol>
        </section>

        {player && (
          <p className="hint">
            Playing as guest <a href={accountUrl(player.accountId)}>{shortAccount(player.accountId, 30)}</a>. The key lives
            only in this browser.{" "}
            <button className="linklike" onClick={() => confirm("Forget this guest? Its colony stays on the dish, but this browser loses the key and cannot plant for it again.") && forgetGuest()}>
              Forget this guest
            </button>
          </p>
        )}
      </aside>
    </div>
  );
}

function explain(v: string | null, w: number): string {
  if (!v) return "";
  const [kind, a, b] = v.split(":");
  const at = (i: string) => `${Number(i) % w}, ${Math.floor(Number(i) / w)}`;
  switch (kind) {
    case "occupied":
      return `Cell ${at(a)} is already alive. Move the stamp to empty agar.`;
    case "too_close":
      return `Cell ${at(a)} is inside colony ${b}'s buffer (the hatched zone). Plant further away, or send a glider.`;
    case "too_many":
      return `At most ${a} cells per planting.`;
    default:
      return "That spot does not work.";
  }
}

function JoinForm({ onStart, busy, player }: { onStart: (name: string, color: number) => void; busy: boolean; player: string | null }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(STAINS[0].color);
  useEffect(() => setColor(STAINS[Math.floor(Math.random() * STAINS.length)].color), []);
  const valid = name.trim().length > 0 && name.trim().length <= 24;
  return (
    <section className="panel-block">
      <h2 className="panel-title">Start a colony</h2>
      <p className="hint">
        Name it and choose its stain. The agar grants you 64 PETRI to plant with{player ? "" : ", and you get a guest account on NEAR testnet: no wallet, no gas"}.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onStart(name.trim(), color);
        }}
      >
        <label className="field">
          <span>Colony name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Strain 7" />
        </label>
        <fieldset className="stains">
          <legend>Stain</legend>
          {STAINS.map((s) => (
            <label key={s.color} className={`stain ${color === s.color ? "is-on" : ""}`} title={s.name}>
              <input type="radio" name="stain" checked={color === s.color} onChange={() => setColor(s.color)} />
              <i className="swatch" style={{ background: colorHex(s.color) }} />
              <span className="sr">{s.name}</span>
            </label>
          ))}
        </fieldset>
        <p className="muted inst small">{STAINS.find((s) => s.color === color)?.name}</p>
        <button className="btn" type="submit" disabled={!valid || busy}>
          Start my colony
        </button>
      </form>
    </section>
  );
}

