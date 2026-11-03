"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import { Loupe } from "@/components/site/Loupe";
import { Specimen } from "@/components/site/Specimen";
import { WarmUp } from "@/components/site/WarmUp";
import { currentEngine, refreshDish } from "@/lib/dish-store";
import { useLive, usePatternOffsets, petri, int, hex, near } from "@/lib/live";
import { BUY_NEAR, GUEST_CREDIT, JOIN_NEAR, buyPetri, sellPetri, claimAll, connectWallet, createGuest, disconnectWallet, joinDish, plantCells, setPayout, usePlayer, forgetGuest, type Player } from "@/lib/wallet";
import { buy_quote, pattern_cells, quote, sell_quote, PATTERNS, type PatternInfo, type PatternName } from "@/engine";
import { getBalance, getClaimable, getColonyOf, getCredit, getNearBalance, getPlantDeposit, type Colony } from "@/lib/chain";
import { accountUrl, shortAccount, txUrl } from "@/lib/config";
import { STAINS, firstFreeStain } from "@/lib/stains";
import { strainOf } from "@/lib/strains";
import { actionIndex, useStrainLog } from "@/lib/strain-log";
import s from "./dish.module.css";

type Cell = { x: number; y: number };

const DOCK_GROUPS: { title: string; kinds: PatternInfo["kind"][] }[] = [
  { title: "Earn", kinds: ["still"] },
  { title: "Shimmer", kinds: ["oscillator"] },
  { title: "Reach", kinds: ["ship", "gun"] },
  { title: "Gamble", kinds: ["wild"] },
];
type Pending = { cells: number[]; label: string; at: number; hash?: string };

function explain(v: string | null, w: number, names: Map<number, string>, siegeX = 3): string {
  if (!v) return "";
  const [kind, a, b] = v.split(":");
  const at = (i: string) => `${Number(i) % w}, ${Math.floor(Number(i) / w)}`;
  switch (kind) {
    case "occupied":
      return `Cell ${at(a)} is already alive. Move the stamp onto empty agar.`;
    case "siege":
      return `Inside ${names.get(Number(a)) ?? `colony ${a}`}’s buffer, the hatched zone: allowed, but a siege costs ${siegeX} times the price. Plant further out to pay the normal price, or send a glider.`;
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
  const { d, rules, palette, perCell, warming, ready, colonies, w, h, secs, vault, tideIn } = useLive();
  const player = usePlayer();
  const offsets = usePatternOffsets();
  const lens = useRef<CultureHandle>(null);
  // The panels that float over the dish, measured so the opening view lands in the agar they leave uncovered.
  const canvasBox = useRef<HTMLDivElement>(null);
  const hudBox = useRef<HTMLDivElement>(null);
  const warmBox = useRef<HTMLDivElement>(null);
  const leftBox = useRef<HTMLElement>(null);
  const rightBox = useRef<HTMLElement>(null);
  const dockBox = useRef<HTMLElement>(null);

  const [me, setMe] = useState<Colony | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [claimable, setClaimable] = useState<{ petri: number; near: number }>({ petri: 0, near: 0 });
  const [nearLeft, setNearLeft] = useState<bigint | null>(null);
  const [credit, setCredit] = useState<bigint | null>(null);
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
  // The strains' log says, move by move, whether the model or the written rules chose it.
  const strainLog = useStrainLog();
  const moves = useMemo(() => actionIndex(strainLog?.actions ?? []), [strainLog]);

  const loadMe = useCallback(async () => {
    if (!player) {
      setMe(null);
      setBalance(null);
      return;
    }
    try {
      const [c, b, cl, n, cr] = await Promise.all([
        getColonyOf(player.accountId),
        getBalance(player.accountId),
        getClaimable(player.accountId),
        getNearBalance(player.accountId).catch(() => null),
        getCredit(player.accountId).catch(() => "0"),
      ]);
      setMe(c);
      setBalance(Number(b));
      setClaimable({ petri: Number(cl.petri), near: Number(cl.near) });
      setNearLeft(n);
      setCredit(BigInt(cr));
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

  // A planting inside a rival's buffer is legal but costs the siege price.
  const siege = !!verdict && verdict.startsWith("siege:");
  const legal = verdict === "" || siege;

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
    if (stamp) for (const i of stamp) o[i] = legal ? 1 : 2;
    if (pending) for (const i of pending.cells) o[i] = 4;
    return o;
  }, [pattern, d.cells, rules, me, stamp, legal, pending, w, h]);

  useEffect(() => {
    if (!pending) return;
    if (d.cells && pending.cells.every((i) => d.cells![i] !== 0) && Date.now() - pending.at > 1500) setPending(null);
    if (Date.now() - pending.at > 60_000) setPending(null);
  }, [d.cells, pending]);

  const info = PATTERNS.find((p) => p.name === pattern);
  // The contract's own price formula, from the same crate.
  const costOf = (n: number, besieging = false) =>
    rules && ready ? Number(quote(String(d.agar), rules.feed_ppm, rules.keeper_bps, d.counted, rules.live_floor, rules.payback, rules.min_cell_price, n, besieging, rules.siege_x)) : 0;
  // What 0.02 NEAR buys a newcomer right now, after about 0.006 NEAR of colony storage.
  const joinPetri = rules && ready ? Number(buy_quote(String(JOIN_NEAR - 6n * 10n ** 21n), String(d.agar), rules.petri_price, rules.max_supply)) : 0;
  const cost = info ? costOf(stamp?.length ?? info.cells, siege) : 0;
  const myLive = me ? d.liveCounts[me.id] ?? 0 : 0;
  const myPending = me ? d.pending[me.id] ?? 0 : 0;
  const plantedThisGen = me?.last_plant_generation != null && Number(me.last_plant_generation) >= d.generation;
  // A guest spends the credit the relayer sponsored on chain; a wallet pays its own NEAR.
  const isWallet = player?.kind === "wallet";
  const sponsoredLeft = credit ?? 0n;
  const canBuy = isWallet ? nearLeft === null || nearLeft >= BUY_NEAR + 3n * 10n ** 21n : sponsoredLeft >= BUY_NEAR;
  // Selling back: the agar pays half the curve's price, up to what is left of this tide's allowance.
  const SELL_UNITS = 20_000_000;
  const sellNear = rules && ready && d.state ? Number(sell_quote(String(SELL_UNITS), String(d.agar), rules.petri_price, rules.max_supply, rules.sell_bps, d.state.vault, String(BigInt(d.state.total_supply) - BigInt(d.state.agar)))) : 0;
  const canSell = !!d.state && (balance ?? 0) >= SELL_UNITS && sellNear > 0 && sellNear <= Number(d.state.sell_left);
  // Planting claims a colony's waiting earnings first, so they count towards the price.
  const spendable = (balance ?? 0) + claimable.petri + Math.max(0, myPending);
  const canAfford = balance !== null && spendable >= cost;
  const myColor = me ? hex(me.color) : "#f2b45a";
  /** What the player can spend: their balance and earnings once joined, what a 0.02 NEAR stake buys before. */
  const budget = me ? spendable : joinPetri;

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
      setDone({ text: `${name} is on the dish. Its 0.02 NEAR stake bought about ${petri(joinPetri)} PETRI from the agar. Pick a stamp below and plant it.`, hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setError(null);
    setDone(null);
    try {
      await connectWallet();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/reject|cancel|closed/i.test(msg)) setError(`The wallet did not connect: ${msg}`);
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
      const trimmed = note.trim();
      const deposit = BigInt(await getPlantDeposit(cells.length, trimmed ? new TextEncoder().encode(trimmed).length : null));
      const r = await plantCells(cells, trimmed, deposit);
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

  async function claim() {
    setError(null);
    setDone(null);
    setBusy("Claiming…");
    try {
      const r = await claimAll();
      setDone({ text: "Claimed. Your PETRI is in your balance and any NEAR from the tides is on its way to your account.", hash: r.hash });
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function sell() {
    setError(null);
    setDone(null);
    setBusy("Selling PETRI back to the agar…");
    try {
      const r = await sellPetri(BigInt(SELL_UNITS));
      setDone({ text: `Sold ${petri(SELL_UNITS)} PETRI back to the agar for about ${near(sellNear, 4)} NEAR, paid from the tide vault.`, hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function savePayout(to: string | null) {
    setError(null);
    setDone(null);
    setBusy(to ? `Sending your winnings to ${to} from now on…` : "Sending your winnings back to this guest…");
    try {
      const r = await setPayout(to);
      setDone({ text: to ? `Done. NEAR you win at the tides or get for sales now goes to ${to}.` : "Done. Your NEAR winnings go to this guest account again.", hash: r.hash });
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function buy() {
    setError(null);
    setDone(null);
    setBusy("Buying PETRI from the agar…");
    try {
      const r = await buyPetri();
      setDone({ text: "Bought PETRI from the agar. The NEAR went into the tide vault.", hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
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

  /** The roomiest open agar where `stamp` actually fits: the legal anchor farthest from any rival. */
  function openSpot(stamp: PatternName): { at: Cell; near: number } | null {
    const e = currentEngine();
    if (!e || !d.cells || !rules) return null;
    const myId = me?.id ?? -1;
    const id = me?.id ?? 65535;
    const step = 4;
    const spots: { at: Cell; near: number }[] = [];
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
        spots.push({ at: { x, y }, near });
      }
    spots.sort((a, b) => b.near - a.near);
    for (const sp of spots) {
      const cells = pattern_cells(stamp, sp.at.x, sp.at.y, w, h, rotate, flip);
      if (e.check_plant(id, cells, rules.buffer, rules.max_plant_cells) === "") return sp;
    }
    return null;
  }

  /** A medium zoom: about three times the zoom that shows the whole dish in a circle. */
  const mediumZoom = () => {
    const v = lens.current?.view();
    return v && v.w ? v.roundFit * 3 : undefined;
  };

  /** Centre the view on open agar where the chosen stamp (or a block) fits. */
  function findOpen() {
    const stampName = pattern ?? "block";
    const sp = openSpot(stampName);
    const label = PATTERNS.find((p) => p.name === stampName)?.label.toLowerCase() ?? "block";
    if (!sp) {
      setDone({ text: `No open agar is left where a ${label} fits. Try a smaller stamp, or send a glider.` });
      return;
    }
    const v = lens.current?.view();
    const cur = lens.current?.camera().zoom ?? 0;
    const zoom = v && v.w ? Math.min(v.roundFit * 3, Math.max(cur, v.roundFit * 2)) : undefined;
    lens.current?.centerOn(sp.at.x, sp.at.y, zoom);
    if (pattern && !target) setHover(sp.at);
    setDone({ text: `A ${label} fits at ${sp.at.x}, ${sp.at.y}, ${sp.near >= 99 ? "13 or more" : sp.near} cells from the nearest rival.` });
  }

  /** The part of the canvas no panel covers, in CSS px from the canvas's top left. */
  function freeArea() {
    const c = canvasBox.current?.getBoundingClientRect();
    if (!c) return null;
    let left = 0, right = c.width, top = 0, bottom = c.height;
    for (const el of [hudBox.current, warmBox.current]) {
      const r = el?.getBoundingClientRect();
      if (r && r.height) top = Math.max(top, r.bottom - c.top + 10);
    }
    const desktop = window.matchMedia("(min-width: 901px)").matches;
    const dock = dockBox.current?.getBoundingClientRect();
    // On a desktop the cell inspector chip sits just above the dock.
    if (dock && dock.top < c.bottom) bottom = Math.min(bottom, dock.top - c.top - (desktop ? 46 : 8));
    if (desktop) {
      // The side columns float over the dish only on wide screens; on phones they stack below it.
      const l = leftBox.current?.getBoundingClientRect();
      const r = rightBox.current?.getBoundingClientRect();
      if (l) left = Math.max(left, l.right - c.left + 12);
      if (r) right = Math.min(right, r.left - c.left - 12);
    }
    if (right - left < 160 || bottom - top < 140) return { left: 0, top: 0, right: c.width, bottom: c.height, w: c.width, h: c.height };
    return { left, top, right, bottom, w: c.width, h: c.height };
  }

  /** Open on the living: the densest cluster of cells, fitted into the agar the panels leave free. */
  function fitLiving(): boolean {
    const L = lens.current;
    const v = L?.view();
    const cells = d.cells;
    const area = freeArea();
    if (!L || !v?.w || !cells || !area) return false;
    const B = 24;
    let best = 0;
    let cx = 0, cy = 0;
    for (let by = 0; by < h; by += 4)
      for (let bx = 0; bx < w; bx += 4) {
        let n = 0;
        for (let y = by; y < by + B; y++) {
          const row = (y % h) * w;
          for (let x = bx; x < bx + B; x++) if (cells[row + (x % w)]) n++;
        }
        if (n > best) {
          best = n;
          cx = bx + B / 2;
          cy = by + B / 2;
        }
      }
    if (best === 0) return false;
    // The cells around that window, measured from its centre across the wrapping edges; the outer 5% are left out so
    // one stray glider does not pull the view wide.
    const R = 40;
    const dxs: number[] = [];
    const dys: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i]) continue;
      const dx = (((((i % w) - cx) % w) + w + w / 2) % w) - w / 2;
      const dy = ((((((i / w) | 0) - cy) % h) + h + h / 2) % h) - h / 2;
      if (Math.abs(dx) <= R && Math.abs(dy) <= R) {
        dxs.push(dx);
        dys.push(dy);
      }
    }
    dxs.sort((a, b) => a - b);
    dys.sort((a, b) => a - b);
    const q = (a: number[], f: number) => a[Math.min(a.length - 1, Math.max(0, Math.round(f * (a.length - 1))))];
    const x0 = q(dxs, 0.05), x1 = q(dxs, 0.95), y0 = q(dys, 0.05), y1 = q(dys, 0.95);
    const midX = cx + (x0 + x1) / 2;
    const midY = cy + (y0 + y1) / 2;
    const dpr = v.dpr;
    const pad = 12;
    const fitZ = Math.min(((area.right - area.left) * dpr) / (x1 - x0 + 1 + pad), ((area.bottom - area.top) * dpr) / (y1 - y0 + 1 + pad));
    L.centerOn(midX, midY, Math.min(v.roundFit * 5, Math.max(v.roundFit * 2, fitZ)));
    // The view may refuse to zoom out that far; place the cluster at the free area's centre at the zoom it settled on.
    const z = L.camera().zoom;
    const fx = (area.left + area.right) / 2;
    const fy = (area.top + area.bottom) / 2;
    const wrap = (a: number, n: number) => ((a % n) + n) % n;
    L.centerOn(wrap(midX + ((area.w / 2 - fx) * dpr) / z, w), wrap(midY + ((area.h / 2 - fy) * dpr) / z, h), z);
    return true;
  }

  // On the first frame with cells, open on the living colonies in the uncovered agar; an empty dish opens on open agar.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !d.cells || !rules || !currentEngine()) return;
    const z = mediumZoom();
    if (!z) return;
    opened.current = true;
    if (fitLiving()) return;
    const sp = openSpot("block");
    if (sp) lens.current?.centerOn(sp.at.x, sp.at.y, z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.cells, rules]);

  const hovered = hover && d.cells ? d.cells[hover.y * w + hover.x] : 0;
  const hoveredColony = hovered ? colonies.find((c) => c.id === hovered) : null;
  /** The rival whose buffer the hovered bare cell sits in, if any (the nearest one). */
  const bufferOwner = useMemo(() => {
    if (!hover || !d.cells || !rules || hovered) return null;
    const b = rules.buffer;
    const myId = me?.id ?? -1;
    let best = 0;
    let bd = Infinity;
    for (let dy = -b; dy <= b; dy++)
      for (let dx = -b; dx <= b; dx++) {
        const c = d.cells[(((hover.y + dy) % h + h) % h) * w + ((((hover.x + dx) % w) + w) % w)];
        if (c === 0 || c === myId) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (dist < bd) {
          bd = dist;
          best = c;
        }
      }
    return best ? names.get(best) ?? `colony ${best}` : null;
  }, [hover, hovered, d.cells, rules, me, names, w, h]);
  const genMs = rules ? Number(rules.generation_ms) : 15000;

  return (
    <div className={s.app}>
      <h1 className="sr">The live Petri dish</h1>
      <div ref={canvasBox} className={s.canvas}>
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
          ghost={me?.color}
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

      <div ref={hudBox} className={s.hud} aria-live="polite">
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
      {ready && warming && (
        <div ref={warmBox} className={s.warmChip}>
          <WarmUp />
        </div>
      )}

      <aside ref={leftBox} className={s.left}>
        {!me && (
          <JoinForm onStart={start} onConnect={connect} busy={!!busy} player={player} grant={ready ? petri(joinPetri) : "…"} colonies={d.colonies} />
        )}

        {info && !me && (
          <section className={`${s.card} ${s.stampLine}`}>
            <Specimen offsets={offsets[info.name]} color={myColor} size={30} />
            <p>{info.label} selected. Start a colony to plant it.</p>
            <button className={s.close} aria-label="Put the stamp down" onClick={() => { setPattern(null); setTarget(null); }}>×</button>
          </section>
        )}

        {info && me && (
          <section className={`${s.card} ${s.plantCard}`}>
            <div className={s.plantHead}>
              <Specimen offsets={offsets[info.name]} color={myColor} size={48} />
              <div>
                <h2>{info.label}</h2>
                <span className="num">{stamp?.length ?? info.cells} cells, {petri(cost, 2)} PETRI{siege ? ` (siege, ${rules?.siege_x ?? 3}×)` : ""}</span>
              </div>
              <button className={s.close} aria-label="Put the stamp down" onClick={() => { setPattern(null); setTarget(null); }}>×</button>
            </div>
            <p className={s.hint}>{info.note}</p>
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={() => setRotate((r) => (r + 1) % 4)}>Rotate <kbd>R</kbd></button>
              <button className="btn btn-ghost btn-small" onClick={() => setFlip((f) => !f)}>Flip <kbd>F</kbd></button>
            </div>
            <p className={`${s.verdict} ${verdict === "" ? s.ok : siege ? s.warn : verdict ? s.bad : ""}`}>
              {!anchor ? "Point at the dish, then click where it should grow." : verdict === "" ? `${snapped && target ? "That spot was taken, so the stamp moved to the nearest one that fits: " : "Fits at "}${anchor.x}, ${anchor.y}.${target ? "" : " Click to place it."}` : explain(verdict, w, names, rules?.siege_x)}
            </p>
            {me && (
              <label className={s.noteField}>
                <span>Lab note, stored on chain with the planting (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Why here? Anyone reading the dish will see it." />
                <em className="num">{note.length}/140</em>
              </label>
            )}
            <button className="btn btn-amber" disabled={!me || !target || !legal || !!busy || !canAfford || plantedThisGen} onClick={plant}>
              {!me
                ? "Start a colony to plant"
                : !target
                  ? "Click the dish to place it"
                  : !canAfford
                    ? `You need ${petri(cost, 2)} PETRI`
                    : plantedThisGen
                      ? "One planting per generation. Next one soon"
                      : siege
                        ? `Lay siege here for ${petri(cost, 2)} PETRI`
                        : `Plant the ${info.label.toLowerCase()} here`}
            </button>
          </section>
        )}

        {me && info && (
          // While a stamp is in hand the colony card shrinks to one line, so the planting controls fit the column.
          <section className={`${s.card} ${s.stampLine}`}>
            <i className="swatch" style={{ background: myColor, width: 16, height: 16 }} />
            <p>
              <b>{me.name}</b> can spend <span className="num">{balance === null ? "—" : petri(spendable, 2)}</span> PETRI
            </p>
          </section>
        )}

        {me && !info && (
          <section className={s.card}>
            <div className={s.meHead}>
              <i className="swatch" style={{ background: myColor, width: 16, height: 16 }} />
              <h2>{me.name}</h2>
            </div>
            <a className={s.acct} href={accountUrl(me.account)}>{shortAccount(me.account, 34)}</a>
            <dl className={s.meStats}>
              <div><dt>Holding</dt><dd className="num">{balance === null ? "—" : petri(balance, 2)}</dd></div>
              <div><dt>Earned, unclaimed</dt><dd className="num"><span className={s.sign}>+</span>{petri(claimable.petri + Math.max(0, myPending), 3)}</dd></div>
              <div><dt>Living cells</dt><dd className="num">{int(myLive)}</dd></div>
              {d.state && Number(d.state.tides) === 0 && claimable.near === 0 ? (
                <div><dt>First tide</dt><dd className="num">in {int(tideIn)} <small>gens</small></dd></div>
              ) : (
                <div><dt>Won at the tides</dt><dd className="num">{near(claimable.near + Number(me.near_claimed), 4)} <small>NEAR</small></dd></div>
              )}
            </dl>
            <p className={s.hint}>
              Your cells earn every generation; the PETRI waits in the dish until you claim it, and planting claims it for you.
              Every {rules?.tide_every ?? 240} generations {rules ? rules.tide_bps / 100 : 10}% of the tide vault ({near(vault, 3)} NEAR
              now) is paid out in NEAR, split by the PETRI each colony earned since the last tide. Next tide in {int(tideIn)}{" "}
              generations; the agar buys PETRI back after it.
            </p>
            <div className={s.row}>
              <button className="btn btn-amber btn-small" onClick={claim} disabled={!!busy || (claimable.petri <= 0 && claimable.near <= 0)}>
                {claimable.near > 0 ? `Claim ${near(claimable.near, 4)} NEAR and PETRI` : "Claim earnings"}
              </button>
              <button className="btn btn-ghost btn-small" onClick={buy} disabled={!!busy || !canBuy}>
                Buy PETRI with 0.01 NEAR
              </button>
              <button className="btn btn-ghost btn-small" onClick={sell} disabled={!!busy || !canSell} title={d.state && sellNear > Number(d.state.sell_left) ? "The agar has bought back all it will until the next tide." : undefined}>
                Sell {petri(SELL_UNITS)} back for {near(sellNear, 4)} NEAR
              </button>
            </div>
            {isWallet ? (
              <p className={s.hint}>Your wallet signs each move and pays its own gas and deposits{nearLeft !== null ? `; it holds ${near(Number(nearLeft), 3)} NEAR` : ""}.</p>
            ) : (
              <>
                <p className={s.hint}>The site sponsored {near(Number(GUEST_CREDIT), 2)} testnet NEAR of credit for this guest, held by the dish contract and spendable only on joining, buying and planting; {near(Number(sponsoredLeft), 4)} NEAR of it is left. Connect a wallet to play with your own.</p>
                <PayoutForm current={me.payout} busy={!!busy} onSave={savePayout} />
              </>
            )}
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={findMine} disabled={myLive === 0}>Find my colony</button>
              {isWallet ? (
                <button className={s.linkish} onClick={() => disconnectWallet().catch(() => {})}>
                  Disconnect wallet
                </button>
              ) : (
                <>
                <button className={s.linkish} onClick={connect} disabled={!!busy}>
                  Use my NEAR wallet
                </button>
                <button
                  className={s.linkish}
                  onClick={() => confirm("Forget this guest? The colony stays on the dish, but this browser loses its key and cannot plant for it again.") && forgetGuest()}
                >
                  Forget this guest
                </button>
                </>
              )}
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

      <aside ref={rightBox} className={s.right}>
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
                const strain = c ? strainOf(c.account) : null;
                const move = strain && c ? moves.find(c.account, Number(p.generation)) : undefined;
                const byModel = move?.decided_by === "model";
                return (
                  <li key={`${p.generation}-${i}`}>
                    <i className="swatch" style={{ background: c ? hex(c.color) : "#888" }} />
                    <div>
                      <p>
                        <b>{c?.name ?? `Colony ${p.colony}`}</b>
                        {strain && (
                          <span className={s.aiTag} title={byModel ? "A house strain; the model chose this move" : "A house strain; its written rules chose this move"}>
                            {byModel ? "AI" : "Rules"}
                          </span>
                        )}{" "}
                        planted {p.cells.length} cells{p.siege ? ", a siege" : ""}
                        <span className={`num ${s.gen}`}>gen {int(Number(p.generation))}</span>
                      </p>
                      {p.note && <q>{p.note}</q>}
                    </div>
                  </li>
                );
              })}
              {d.recentPlants.length === 0 && <li className={s.hint}>{d.status === "ready" ? "Nothing planted yet." : "Reading the dish from NEAR…"}</li>}
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
              <span className={s.hintInline}>{bufferOwner ? `bare agar, inside ${bufferOwner}’s buffer` : "bare agar"}</span>
            )}
          </>
        ) : (
          <span className={s.hintInline}>Drag to move. Scroll or pinch to zoom. The edges wrap.</span>
        )}
      </div>

      <nav ref={dockBox} className={s.dock} aria-label="Stamps">
        <div className={s.dockScroll}>
          {DOCK_GROUPS.map((g) => (
            <div key={g.title} className={s.dockGroup} role="group" aria-label={g.title}>
              <span className={s.dockLabel} aria-hidden="true">{g.title}</span>
              <ul>
                {PATTERNS.filter((p) => g.kinds.includes(p.kind)).map((p) => {
                  const c = costOf(p.cells);
                  const short = ready && budget !== null && c > budget;
                  const gap = short ? petri(c - (budget ?? 0), 1) : "";
                  const price = ready ? `${petri(c, 1)} PETRI` : null;
                  const whose = me ? "you can spend" : "a 0.02 NEAR stake buys";
                  return (
                    <li key={p.name}>
                      <button
                        className={`${s.stamp} ${pattern === p.name ? s.on : ""} ${short ? s.short : ""}`}
                        aria-pressed={pattern === p.name}
                        aria-label={`${p.label}, ${p.cells} cells${price ? `, ${price}` : ""}${short ? `, ${gap} PETRI more than ${whose}` : ""}`}
                        onClick={() => {
                          setPattern(pattern === p.name ? null : p.name);
                          setTarget(null);
                        }}
                        title={short ? `${p.note} Costs ${gap} PETRI more than ${whose} right now.` : p.note}
                      >
                        <Specimen offsets={offsets[p.name]} color={myColor} size={36} />
                        <span className={s.stampName}>{p.label}</span>
                        <span className={`num ${s.stampCost}`}>{price ?? `${p.cells} cells`}</span>
                        {short && <span className={`num ${s.needs}`}>needs {gap} more</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      {d.status === "error" && (
        <p className={s.err}>The dish could not be read from NEAR ({d.error}). Retrying every few seconds.</p>
      )}
    </div>
  );
}

function JoinForm({ onStart, onConnect, busy, player, grant, colonies }: { onStart: (name: string, color: number) => void; onConnect: () => void; busy: boolean; player: Player; grant: string; colonies: Colony[] }) {
  const [name, setName] = useState("");
  const taken = useMemo(() => {
    const m = new Map<number, string>();
    colonies.forEach((c) => {
      if (!m.has(c.color)) m.set(c.color, c.name);
    });
    return m;
  }, [colonies]);
  const [picked, setPicked] = useState<number | null>(null);
  // Until the player picks one, offer the first high-contrast stain nobody is using.
  const color = picked !== null && !taken.has(picked) ? picked : firstFreeStain(new Set(taken.keys()));
  const valid = name.trim().length > 0 && name.trim().length <= 24;
  const takenStains = STAINS.flatMap((st) => (taken.has(st.color) ? [{ name: st.name, owner: taken.get(st.color)! }] : []));
  return (
    <section className={s.card}>
      <h2 className={s.joinTitle}>Start a colony</h2>
      <p className={s.hint}>
        Name it and choose its stain. Joining stakes 0.02 NEAR: a little pays for your colony's storage and the rest buys about {grant} PETRI from the agar to plant with.
        {player?.kind === "wallet"
          ? ` You are joining as ${shortAccount(player.accountId, 28)}: your wallet signs and pays.`
          : player
            ? ""
            : " You get a guest account on NEAR testnet: no wallet, no gas."}
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
          {STAINS.map((st) => {
            const owner = taken.get(st.color);
            return (
              <label
                key={st.color}
                className={`${color === st.color ? s.stainOn : ""} ${owner ? s.stainTaken : ""}`}
                title={owner ? `taken by ${owner}` : st.name}
              >
                <input type="radio" name="stain" checked={color === st.color} disabled={!!owner} onChange={() => setPicked(st.color)} />
                <i style={{ background: hex(st.color) }} />
                <span className="sr">{owner ? `${st.name}, taken by ${owner}` : st.name}</span>
              </label>
            );
          })}
        </fieldset>
        {takenStains.length > 0 && (
          <>
            <p className={`${s.hint} ${s.hoverOnly}`} style={{ margin: "6px 0 10px" }}>A slashed stain is already taken; hover it to see by whom.</p>
            {/* Touch screens have no hover, so they say it in words. */}
            <p className={`${s.hint} ${s.touchOnly}`} style={{ margin: "6px 0 10px" }}>
              Slashed stains are taken: {takenStains.map((x) => `${x.name} by ${x.owner}`).join("; ")}.
            </p>
          </>
        )}
        <button className="btn btn-amber" type="submit" disabled={!valid || busy} style={{ width: "100%" }}>
          {valid ? "Start my colony" : "Name your colony to start"}
        </button>
      </form>
      {player?.kind !== "wallet" && (
        <button className="btn btn-ghost btn-small" type="button" onClick={onConnect} disabled={busy} style={{ width: "100%", marginTop: 10 }}>
          Use my NEAR wallet instead
        </button>
      )}
      <p className={s.hint} style={{ marginTop: 12 }}>
        New here? <Link href="/rules">Read how it works</Link> first, or just plant a block and watch.
      </p>
    </section>
  );
}

/** A NEAR account id: lowercase parts of letters, digits, - and _, joined by dots, 2 to 64 characters. */
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

// A guest's NEAR winnings land in the guest account, whose key lives only in this browser. This sends them to a wallet.
function PayoutForm({ current, busy, onSave }: { current: string | null; busy: boolean; onSave: (to: string | null) => void }) {
  const [to, setTo] = useState("");
  const clean = to.trim().toLowerCase();
  const ok = ACCOUNT_ID.test(clean);
  return (
    <details className={s.payout} open={!!current || undefined}>
      <summary>Send my winnings to a wallet</summary>
      {current && (
        <p className={s.hint}>
          NEAR winnings and sales go to <a href={accountUrl(current)}>{shortAccount(current, 30)}</a>.{" "}
          <button type="button" className={s.linkish} onClick={() => onSave(null)} disabled={busy}>
            Keep them here instead
          </button>
        </p>
      )}
      <form
        className={s.payoutRow}
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(clean);
        }}
      >
        <label className="sr" htmlFor="payout-to">NEAR account to receive the winnings</label>
        <input id="payout-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="you.testnet" autoComplete="off" spellCheck={false} />
        <button className="btn btn-ghost btn-small" type="submit" disabled={!ok || busy || clean === current}>
          {current ? "Change" : "Send there"}
        </button>
      </form>
      <p className={s.hint}>Tide winnings and PETRI sold back are paid in NEAR to that account. Your PETRI stays with the colony, and no deposit is needed.</p>
    </details>
  );
}
