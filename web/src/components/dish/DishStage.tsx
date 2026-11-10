"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import { Loupe } from "@/components/site/Loupe";
import { Specimen } from "@/components/site/Specimen";
import { WarmUp } from "@/components/site/WarmUp";
import { PayAnyToken } from "@/components/intents/PayAnyToken";
import { SlideGlass } from "@/components/specimens/SlideGlass";
import { currentEngine, refreshDish } from "@/lib/dish-store";
import { useLive, usePatternOffsets, petri, int, hex, near } from "@/lib/live";
import { requestGuestCredit } from "@/lib/wallet";
import { FreeMainnetOffer } from "./FreeMainnet";
import { BUY_NEAR, GUEST_CREDIT, JOIN_NEAR, buyPetri, sellPetri, claimAll, claimPending, connectWallet, renameColony, createGuest, disconnectWallet, joinDish, mintSlide, plantCells, usePlayer, forgetGuest, offerPact, acceptPact, cancelPact, type Player } from "@/lib/wallet";
import { buy_quote, pattern_cells, quote, sell_quote, PATTERNS, type PatternInfo, type PatternName } from "@/engine";
import { getBalance, getClaimable, getColonyOf, getCredit, getNearBalance, getPending, getPlantDeposit, getSlide, getSlideDeposit, PACT_DEPOSIT, type Colony } from "@/lib/chain";
import { accountUrl, isGuestAccount, shareUrl, shortAccount, switchNetwork, txUrl } from "@/lib/config";
import { BenchTag } from "@/components/site/BenchTag";
import { SLIDE_TITLE_MAX, capture, cellsBitmap, clampRect, densest, normalizeSlide, rectFromDrag, slideOffsets, slideRules, slideSvg, svgUrl, type Rect } from "@/lib/slides";
import { useNet } from "@/lib/use-net";
import { STAINS, firstFreeStain, livingStains } from "@/lib/stains";
import { Term } from "@/components/site/Term";
import { TideCard } from "@/components/site/TideCard";
import { PRODUCT } from "@/lib/facts";
import { strainOf } from "@/lib/strains";
import { actionIndex, chooserOf, useStrainLog } from "@/lib/strain-log";
import { forecast, type Forecast } from "./forecast";
import { readDishCache, writeDishCache, type DishCache } from "./cache";
import { useSlideLicence } from "@/components/specimens/licence";
import { pactZone, usePacts, type Pact } from "@/lib/pacts";
import { Goals } from "./Goals";
import { MyPacts, PickedColony, pactLines, pactsOn, zoneColonies, type PactActions } from "./Pacts";
import s from "./dish.module.css";
import { NetTag } from "@/components/site/NetTag";
import { DishDelight } from "@/components/delight/Delight";

type Cell = { x: number; y: number };

const DOCK_GROUPS: { title: string; kinds: PatternInfo["kind"][] }[] = [
  { title: "Earn", kinds: ["still"] },
  { title: "Shimmer", kinds: ["oscillator"] },
  { title: "Reach", kinds: ["ship", "gun"] },
  { title: "Gamble", kinds: ["wild"] },
];
type Pending = { cells: number[]; label: string; at: number; hash?: string };
/** What is in hand: one of the classic stamps, or a pattern loaded from a specimen. */
type StampInfo = { name: PatternName | null; label: string; cells: number; note: string };
type Custom = { offsets: [number, number][]; label: string; id: string };


/** A specimen's cells as a stamp centred on (x, y), turned and mirrored like any other stamp. */
function customCells(offsets: [number, number][], x: number, y: number, w: number, h: number, rotate: number, flip: boolean): Uint32Array {
  let pts = offsets.map(([a, b]) => [a, b] as [number, number]);
  const size = () => [Math.max(0, ...pts.map((p) => p[0])) + 1, Math.max(0, ...pts.map((p) => p[1])) + 1];
  if (flip) {
    const [sw] = size();
    pts = pts.map(([a, b]) => [sw - 1 - a, b]);
  }
  for (let r = 0; r < rotate; r++) {
    const [, sh] = size();
    pts = pts.map(([a, b]) => [sh - 1 - b, a]);
  }
  const [sw, sh] = size();
  const ox = x - Math.floor(sw / 2);
  const oy = y - Math.floor(sh / 2);
  return new Uint32Array(pts.map(([a, b]) => ((((oy + b) % h) + h) % h) * w + ((((ox + a) % w) + w) % w)));
}

/** Whatever shape the contract reports pending NEAR in, as yoctoNEAR. */
function pendingYocto(v: unknown): bigint {
  try {
    if (typeof v === "string" || typeof v === "number") return BigInt(v);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const n = o.near ?? o.amount ?? o.pending;
      if (typeof n === "string" || typeof n === "number") return BigInt(n);
    }
  } catch {
    /* unreadable: nothing pending */
  }
  return 0n;
}

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

function ago(at: number) {
  const m = Math.max(0, (Date.now() - at) / 60_000);
  if (m < 1.5) return "a minute ago";
  if (m < 90) return `${Math.round(m)} minutes ago`;
  if (m < 36 * 60) return `${Math.round(m / 60)} hours ago`;
  return `${Math.round(m / 1440)} days ago`;
}

/** Generations as the dish counts them, and roughly in wall time. */
function gens(n: number, genMs: number) {
  const min = (n * genMs) / 60_000;
  const t = min < 90 ? `${Math.max(1, Math.round(min))} min` : min < 48 * 60 ? `${(min / 60).toFixed(min < 600 ? 1 : 0).replace(/\.0$/, "")} h` : `${Math.round(min / 1440)} days`;
  return `${int(n)} gens (${t})`;
}

/** A span of generations in wall time, rounded for a label. */
function minutes(n: number, genMs: number) {
  const min = (n * genMs) / 60_000;
  return min < 90 ? `${Math.max(1, Math.round(min))} min` : `${(min / 60).toFixed(1).replace(/\.0$/, "")} h`;
}

/** What the stamp would do where it points, from two copies of the dish stepped forward (forecast.ts). */
function ForecastView({ f, cost, genMs, at }: { f: Forecast; cost: number; genMs: number; at: Cell | null }) {
  const max = Math.max(1, ...f.alive);
  const W = 112;
  const H = 26;
  const last = Math.max(1, f.alive.length - 1);
  const pts = f.alive.map((a, i) => `${((i / last) * W).toFixed(1)},${(H - 2 - (a / max) * (H - 4)).toFixed(1)}`).join(" ");
  const tideX = ((f.tideIn - 1) / last) * W;
  const pay =
    cost <= 0
      ? "free"
      : f.payback === null
        ? f.survives
          ? "not at today's rate"
          : "won't pay back yet"
        : f.payback > 40 * 5760
          ? "over 40 days"
          : `${f.extrapolated ? "about " : ""}${gens(f.payback, genMs)}`;
  return (
    <div className={s.forecast} aria-live="polite">
      <div className={s.fcHead}>
        <p>
          <b>Forecast</b>
          {at ? ` at ${at.x}, ${at.y}` : ""}: the next {int(f.horizon)} generations on a copy of the dish, if nobody else plants
        </p>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Cells this planting adds, generation by generation; the dashed line is the next tide`}>
          <line x1={tideX} y1="0" x2={tideX} y2={H} stroke="rgba(242,180,90,0.5)" strokeDasharray="2 3" />
          <polyline points={pts} fill="none" stroke={f.survives ? "#9fd8a8" : "#ff8f7f"} strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      </div>
      <dl className={s.fcStats}>
        <div>
          <dt>Lifetime</dt>
          <dd className={f.survives ? s.ok : s.bad}>{f.survives ? `survives ${int(f.horizon)}+ generations` : `lasts about ${int(f.diedAt ?? f.horizon)} generations (≈${minutes(f.diedAt ?? f.horizon, genMs)})`}</dd>
        </div>
        <div>
          <dt>At the next tide</dt>
          <dd className="num">
            {int(f.atTide)} <small>cells</small>
          </dd>
        </div>
        <div>
          <dt>Pays back</dt>
          <dd className="num">{pay}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A specimen's licence terms for the planter, once the contract has slide licences (licence.ts). */
function LicenceLine({ licence, cost, licensed }: { licence: ReturnType<typeof useSlideLicence>; cost: number; licensed: boolean }) {
  if (!licence.live) return null;
  if (!licensed) return <p className={s.hint}>Turned or flipped, this is no longer the slide&apos;s pattern: it plants as an ordinary planting, with no licence discount and no royalty.</p>;
  return (
    <p className={s.hint}>
      {licence.holder
        ? `You hold this slide, so you plant its pattern on the holder's terms${licence.perk ? `: ${licence.perk}` : ""}.`
        : licence.royaltyBps !== null
          ? `Planting this slide's pattern pays its holder a ${licence.royaltyBps / 100}% royalty, about ${petri((cost * licence.royaltyBps) / 10_000, 2)} PETRI on this planting.`
          : "This slide's pattern carries a licence; the contract sets its terms."}
    </p>
  );
}

/** /dish?tool=fossil before there is a colony: say what Fossilize needs instead of opening an empty frame. */
function FossilNeedsColony({ onClose }: { onClose: () => void }) {
  return (
    <section className={`${s.card} ${s.fossilAsk}`} aria-labelledby="fossil-ask">
      <div className={s.plantHead}>
        <div>
          <h2 id="fossil-ask">Fossilize</h2>
          <span>Needs a colony: a slide keeps your own living cells, so some must be on the dish first.</span>
        </div>
        <button className={s.close} aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <div className={s.lockedGlass} aria-hidden="true">
        <SlideGlass size="mini" src={null} placeholder="Your colony's cells go here" />
        <span className={s.lock}>
          <svg width="18" height="18" viewBox="0 0 18 18">
            <rect x="3.5" y="8" width="11" height="8" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 8V5.8a3 3 0 0 1 6 0V8" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
      </div>
      <p className={s.hint}>Start a colony below and plant a still life. The frame opens over your cells as soon as they are on the dish.</p>
    </section>
  );
}

function FoldButton({ onFold }: { onFold: () => void }) {
  return (
    <button type="button" className={s.fold} onClick={onFold} aria-expanded="true" aria-controls="start-panel" title="Fold the panel away to see more of the dish">
      <span className="sr">Fold the start panel</span>
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 9l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
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

/** The dish refuses a join without credit with this; a relaunched dish has none for a guest remembered from before. */
const NO_CREDIT = /won and sponsored credit|no credit|credit.*(left|enough)/i;

/** Ask the site to sponsor this guest's free credit on the current dish (it checks the guest and pays at most once). */
async function topUpGuest(accountId: string): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const res = await requestGuestCredit(accountId).catch(() => null);
    const body = res ? await res.json().catch(() => ({})) : {};
    if (res?.ok && body.credited) return;
    // An answer that will not change on a retry: say it plainly.
    if (res && (res.status === 400 || res.status === 403 || res.status === 409) && body.error) throw new Error(body.error);
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(FREE_ON_ITS_WAY);
}

const FREE_ON_ITS_WAY = "Your free PETRI is still on its way. Retry in a few seconds.";

/** What the start panel says when starting failed: plain words, never a raw contract panic. */
function startFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (NO_CREDIT.test(msg)) return FREE_ON_ITS_WAY;
  if (/already (has|joined|a colony)|colony already/i.test(msg)) return "This account already has a colony on the dish. Reload the page to see it.";
  if (/name already exists/i.test(msg)) return "A colony on this dish already has that name. Pick another (the dice button rolls a new one).";
  if (/Smart contract panicked|panicked at|wasm execution failed|FunctionCallError|ExecutionError/i.test(msg)) return "The dish did not take the join this time. Retry in a few seconds.";
  return msg;
}

/** A move that failed before NEAR ran it (the network, a busy RPC, an expired signature): safe to send once more. */
const TRANSIENT = /Failed to fetch|NetworkError|Load failed|network|timed? ?out|aborted|RPC|is busy|Could not read the chain|expired before|answered 5\d\d|answered 429|Every NEAR RPC provider failed/i;

/** What the planting card says when a planting failed: the contract's own reason in plain words, never a raw panic. */
function plantFailure(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const said = msg.match(/Smart contract panicked: ([^"\\]+)/)?.[1]?.trim();
  if (/behind the clock/i.test(msg)) return "The dish moved on while this was signed. Press plant again: it catches the dish up first.";
  if (/one planting per generation/i.test(msg)) return "One planting a generation. Wait for the next one (under 15 seconds) and press plant again.";
  if (NO_CREDIT.test(msg)) return said ? `${said[0].toUpperCase()}${said.slice(1)}.` : "Not enough credit for this planting's deposit.";
  if (/expired before/i.test(msg)) return "The signed planting expired before it reached NEAR. Press plant again.";
  if (TRANSIENT.test(msg)) return "NEAR's public RPC is busy and the planting did not go through, even on a second provider. Press plant again in a few seconds.";
  if (said) return `The dish refused it: ${said}.`;
  if (/wasm execution failed|FunctionCallError|ExecutionError|panicked/i.test(msg)) return "The dish did not take the planting this time. Retry in a few seconds.";
  return msg;
}

/** A lab-bench name for a new colony, so Start works at once: "Night Shift 412", "Agar Watch 77". */
const NAME_A = ["Night", "Late", "Early", "Quiet", "Second", "Warm", "Amber", "Glass", "Lamp", "Bench", "Slow", "North", "Lucky", "Small"];
const NAME_B = ["Shift", "Bench", "Watch", "Culture", "Plate", "Lab", "Bloom", "Colony", "Sample", "Batch", "Strain", "Swab"];
function labName(): string {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return `${pick(NAME_A)} ${pick(NAME_B)} ${10 + Math.floor(Math.random() * 990)}`;
}

/** The NEAR a join spends on storage before it buys PETRI: the colony's record, its name (kept twice: on the colony and
 * in the name index), its balance, the ledger entries and its cold-page slot. Measured from real joins (a colony with an
 * 18-character name paid about 0.00736 NEAR); the contract's figure varies by a few bytes. */
const joinStorage = (nameBytes: number) => 7_000_000_000_000_000_000_000n + BigInt(2 * nameBytes) * 10_000_000_000_000_000_000n;

/** The middle of some cells on the wrapping dish: a circular mean on each axis, so a colony split across an edge is
 * centred on itself, not on the far side of the dish. A large colony is first narrowed to its densest patch. */
function torusCentre(cells: number[], w: number, h: number): { x: number; y: number } | null {
  if (!cells.length) return null;
  let pts = cells;
  if (cells.length > 60) {
    // Its densest 24 by 24 window, then every cell of it within 20 of that window's middle.
    const grid = new Uint16Array(w * h);
    for (const i of cells) grid[i] = 1;
    let best = -1;
    let bx = 0, by = 0;
    for (let y0 = 0; y0 < h; y0 += 4)
      for (let x0 = 0; x0 < w; x0 += 4) {
        let n = 0;
        for (let y = y0; y < y0 + 24; y++) for (let x = x0; x < x0 + 24; x++) n += grid[(y % h) * w + (x % w)];
        if (n > best) {
          best = n;
          bx = x0 + 12;
          by = y0 + 12;
        }
      }
    const near = (a: number, b: number, n: number) => Math.abs(((((a - b) % n) + n + n / 2) % n) - n / 2) <= 20;
    pts = cells.filter((i) => near(i % w, bx, w) && near((i / w) | 0, by, h));
  }
  let cx = 0, sx = 0, cy = 0, sy = 0;
  for (const i of pts) {
    const ax = (2 * Math.PI * (i % w)) / w;
    const ay = (2 * Math.PI * ((i / w) | 0)) / h;
    cx += Math.cos(ax);
    sx += Math.sin(ax);
    cy += Math.cos(ay);
    sy += Math.sin(ay);
  }
  const mean = (s: number, c: number, n: number) => ((Math.round((Math.atan2(s, c) / (2 * Math.PI)) * n) % n) + n) % n;
  return { x: mean(sx, cx, w), y: mean(sy, cy, h) };
}

/** The three steps of a guest's join, as the progress card shows them. */
const JOIN_STEPS = ["Making your account", "Adding free PETRI credit", "Joining the dish"] as const;

export function DishStage() {
  const { d, rules, palette, perCell, warming, ready, colonies, w, h, secs, vault, tideIn } = useLive();
  // The dish as this browser last saw it, drawn at once while the live one is read from NEAR.
  const [cache, setCache] = useState<DishCache | null>(null);
  const player = usePlayer();
  const net = useNet();
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
  const [done, setDone] = useState<{ text: string; hash?: string; link?: { href: string; label: string }; share?: boolean } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [logOpen, setLogOpen] = useState(true);
  // Below 1025 px the panels share the window with the dish: the log starts closed and the start panel can fold away.
  const [startFolded, setStartFolded] = useState(false);
  /** /dish?tool=fossil reached before the visitor has a colony: the panel says what Fossilize needs. */
  const [fossilAsk, setFossilAsk] = useState(false);
  const [snapped, setSnapped] = useState(false);
  const [custom, setCustom] = useState<Custom | null>(null);
  // Fossilize: the frame being drawn over the player's own colony, and the slide's title.
  const [fossil, setFossil] = useState<Rect | null>(null);
  const [fossilOn, setFossilOn] = useState(false);
  const [slideTitle, setSlideTitle] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  /** Mainnet free play chosen on the start card (during the judging window): the join form then makes a guest. */
  const [freeMainnet, setFreeMainnet] = useState(false);
  const [pendingNear, setPendingNear] = useState(0n);
  /** A colony clicked on the dish: its card shows its pacts and lets a player offer it one. */
  const [picked, setPicked] = useState<number | null>(null);
  /** A stamp has been picked in this browser before: the dock's one-time pulse is over. */
  const [everPicked, setEverPicked] = useState(true);
  /** Just after a planting lands the hover verdict stays quiet, so the new cells do not read as "already alive": the
   * stamp as it was planted, until the stamp moves. */
  const [quietKey, setQuietKey] = useState<string | null>(null);
  /** The account whose join just landed: its start form is gone even before its colony is read. */
  const [justJoined, setJustJoined] = useState<string | null>(null);
  /** The account the view has been centred on once (a remembered guest opens on its own colony). */
  const centredFor = useRef<string | null>(null);
  /** The cells just planted, ringed on the dish until a few generations have passed. */
  const [glow, setGlow] = useState<{ cells: number[]; until: number } | null>(null);
  /** A touch screen: the hints say tap, not click. */
  const [coarse, setCoarse] = useState(false);
  /** The player whose colony has been read once, so its card's space is held until then. */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  /** The start form's name and stain live here, so nothing the form shows is lost while a join is under way. */
  const [joinName, setJoinName] = useState("");
  const [joinPicked, setJoinPicked] = useState<number | null>(null);
  /** A join under way: which of its steps is running (1 to 3), and the name and stain it joins with. */
  const [joining, setJoining] = useState<{ step: number; guest: boolean; name: string; color: number } | null>(null);
  /** While a join is under way the eight-second poll leaves the colony alone: the progress card stays until the join's
   * own transaction returns, and the colony card then opens with the balance the join bought. */
  const joiningRef = useRef(false);
  /** The player has typed in the name field (so a random name never merges with what they type). */
  const [joinTouched, setJoinTouched] = useState(false);
  /** After a join, a block is picked and pinned on open agar so the next press plants it. */
  const autoPin = useRef(false);
  /** Where "Find open agar" pinned the stamp, said in the planting card itself (never in a toast over its button). */
  const [pinNote, setPinNote] = useState<{ key: string; text: string } | null>(null);
  /** A colony's cells pulsing for a moment after Find my colony, a planting or a shared link. */
  const [flash, setFlash] = useState<{ colony: number; until: number } | null>(null);
  /** A ring that blooms on the dish where the view was just centred, in CSS px from the canvas's top left. */
  const [bloom, setBloom] = useState<{ x: number; y: number; key: number; color: string } | null>(null);
  /** A planting just landed: its colony's first earnings get their own moment on the dish. */
  const reward = useRef<{ at: number; shown: boolean } | null>(null);
  /** "+0.0123" floating up from the earnings figure each generation the colony earns. */
  const [tick, setTick] = useState<{ key: number; text: string; first: boolean } | null>(null);
  const [shared, setShared] = useState(false);
  /** Seen from this page: the colony launched a glider, spaceship or gun, or minted a slide (for First experiments). */
  const [launched, setLaunched] = useState(false);
  const [minted, setMinted] = useState(false);
  /** Where the last focus put its colony on the canvas: the first-earnings note rises from there. */
  const bloomAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    // A name is ready on the first visit, so Start works at once; the player may type over it.
    setJoinName((n) => n || labName());
    try {
      setEverPicked(localStorage.getItem("petri.stampPicked") === "1");
    } catch {
      setEverPicked(false);
    }
    const mq = window.matchMedia("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const markPicked = () => {
    if (everPicked) return;
    setEverPicked(true);
    try {
      localStorage.setItem("petri.stampPicked", "1");
    } catch {
      /* the pulse just returns next visit */
    }
  };

  const names = useMemo(() => new Map(d.colonies.map((c) => [c.id, c.name])), [d.colonies]);
  // The strains' log says, move by move, whether the model or the written rules chose it.
  const strainLog = useStrainLog();
  const moves = useMemo(() => actionIndex(strainLog?.actions ?? []), [strainLog]);
  // Pacts, from the ledger: they bind colonies the contract will refuse to let plant near the colonies they protect.
  const book = usePacts(strainLog?.pacts);
  const radius = rules?.pact_radius ?? 8;

  const loadMe = useCallback(async () => {
    if (!player) {
      setMe(null);
      setBalance(null);
      return;
    }
    if (joiningRef.current) return;
    try {
      const [c, b, cl, n, cr, pn] = await Promise.all([
        getColonyOf(player.accountId),
        getBalance(player.accountId),
        getClaimable(player.accountId),
        getNearBalance(player.accountId).catch(() => null),
        getCredit(player.accountId).catch(() => "0"),
        getPending(player.accountId).catch(() => "0"),
      ]);
      if (joiningRef.current) return;
      setPendingNear(pendingYocto(pn));
      setMe(c);
      setBalance(Number(b));
      setClaimable({ petri: Number(cl.petri), near: Number(cl.near) });
      setNearLeft(n);
      setCredit(BigInt(cr));
    } catch {
      /* the next poll retries */
    } finally {
      setLoadedFor(player.accountId);
    }
  }, [player]);
  useEffect(() => {
    loadMe();
    const t = setInterval(loadMe, 8000);
    return () => clearInterval(t);
  }, [loadMe]);
  // When someone advances the stored board, the browser's pending earnings fold into what the contract says is
  // claimable: read it at once, so "Earned, unclaimed" never dips to zero while waiting for the next poll.
  const storedGen = d.state?.generation;
  useEffect(() => {
    if (storedGen) loadMe();
  }, [storedGen, loadMe]);

  useEffect(() => {
    setCache(readDishCache(net.network));
    if (window.innerWidth <= 1024) setLogOpen(false);
  }, [net.network]);
  // Keep the cache fresh: at most every half minute, and only from a dish read live.
  const cacheWritten = useRef(0);
  useEffect(() => {
    if (!ready || !d.cells || Date.now() - cacheWritten.current < 30_000) return;
    cacheWritten.current = Date.now();
    writeDishCache(net.network, {
      generation: d.generation,
      at: Date.now(),
      w,
      h,
      cells: d.cells,
      colors: d.colonies.map((c) => [c.id, c.color] as [number, number]),
      totalLive: d.totalLive,
      agar: d.agar,
      perCell,
    });
  }, [ready, d.cells, d.generation, d.colonies, d.totalLive, d.agar, perCell, net.network, w, h]);
  const stale = !ready && !!cache && cache.w === w && cache.h === h;
  const shownCells = d.cells ?? (stale ? cache!.cells : undefined);
  const cachePalette = useMemo(() => new Map(cache?.colors ?? []), [cache]);

  // R rotates, F flips, Escape puts the stamp down.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "r" || e.key === "R") setRotate((r) => (r + 1) % 4);
      if (e.key === "f" || e.key === "F") setFlip((f) => !f);
      if (e.key === "Escape") {
        setPattern(null);
        setCustom(null);
        setTarget(null);
        setFossilOn(false);
      }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  // While framing a slide, the arrow keys move the frame and Shift with them resizes it.
  useEffect(() => {
    if (!fossilOn) return;
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (!dir) return;
      e.preventDefault();
      setFossil((r) => (r ? clampRect(e.shiftKey ? { ...r, w: r.w + dir[0], h: r.h + dir[1] } : { ...r, x: r.x + dir[0], y: r.y + dir[1] }, w, h) : r));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [fossilOn, w, h]);

  const anchor = target ?? hover;
  /** The stamp in hand placed at (x, y): a classic pattern or a specimen's cells. */
  const cellsAt = useCallback(
    (x: number, y: number): Uint32Array | null =>
      pattern ? pattern_cells(pattern, x, y, w, h, rotate, flip) : custom ? customCells(custom.offsets, x, y, w, h, rotate, flip) : null,
    [pattern, custom, rotate, flip, w, h],
  );
  const stamp = useMemo(() => {
    if (!anchor) return null;
    const c = cellsAt(anchor.x, anchor.y);
    return c ? Array.from(c) : null;
  }, [cellsAt, anchor]);
  const stampKey = stamp ? stamp.join(",") : "";
  const quiet = quietKey !== null && quietKey === stampKey;
  // Once the stamp has moved off the planted spot, its verdict speaks again (even if it comes back later).
  useEffect(() => {
    if (quietKey !== null && stampKey !== quietKey) setQuietKey(null);
  }, [stampKey, quietKey]);

  const verdict = useMemo(() => {
    if (!stamp || !rules) return null;
    const e = currentEngine();
    if (!e) return null;
    return e.check_plant(me?.id ?? 65535, new Uint32Array(stamp), rules.buffer, rules.max_plant_cells);
    // d.generation keeps the check fresh as the dish moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, rules, d.generation, me]);

  // The pacts binding the player's colony now: the contract refuses any planting within the radius of the colonies
  // they protect, so the stamp is checked against them with the contract's own test.
  const myBound = useMemo(() => (me ? pactsOn(book.pacts, me.id, d.generation).bound : []), [book.pacts, me, d.generation]);
  const breach = useMemo(() => {
    if (!stamp || !myBound.length) return null;
    const e = currentEngine();
    if (!e) return null;
    const r = e.pact_breach(new Uint32Array(stamp), new Uint16Array(myBound.map((p) => p.from)), radius);
    if (!r) return null;
    const [, prot, colony] = r.split(",").map(Number);
    const p = myBound.find((q) => q.from === colony);
    return p ? { pact: p, at: { x: prot % w, y: Math.floor(prot / w) } } : null;
    // d.generation keeps the check fresh as the dish moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp, myBound, radius, d.generation, w]);
  // A planting inside a rival's buffer is legal but costs the siege price; one that breaks a pact is refused.
  const siege = !!verdict && verdict.startsWith("siege:");
  const legal = (verdict === "" || siege) && !breach;
  // The colony under the cursor, or the one picked: its pacts' protected ground is outlined on the dish.
  const hoverOwner = hover && d.cells ? d.cells[hover.y * w + hover.x] : 0;
  const focus = hoverOwner || picked || 0;
  const zoneIds = useMemo(
    () => (pattern || custom ? myBound.map((p) => p.from) : focus ? zoneColonies(book.pacts, focus, d.generation) : []),
    [pattern, custom, myBound, focus, book.pacts, d.generation],
  );

  // The cells a slide made now would keep: the player's own living cells inside the frame.
  const kept = useMemo(() => (fossilOn && fossil && me ? capture(d.cells, fossil, w, h, me.id) : []), [fossilOn, fossil, me, d.cells, w, h]);

  const overlay = useMemo(() => {
    const o = new Uint8Array(w * h);
    if (fossilOn && fossil) {
      // Everything outside the frame dims, as under a microscope's field stop.
      o.fill(8);
      for (let dy = 0; dy < fossil.h; dy++)
        for (let dx = 0; dx < fossil.w; dx++) {
          const i = ((fossil.y + dy) % h) * w + ((fossil.x + dx) % w);
          o[i] = d.cells && me && d.cells[i] === me.id ? 7 : 6;
        }
      return o;
    }
    // A pact's protected ground: every cell within the radius of the protected colony's living cells, outlined.
    if (zoneIds.length && d.cells) {
      const z = pactZone(d.cells, zoneIds, radius, w, h);
      for (let i = 0; i < z.length; i++) if (z[i]) o[i] = 6;
    }
    // With a stamp in hand, rivals' buffers are shaded lightly, and only within SHADE cells of where the stamp points:
    // a hint about the ground around the stamp, not a wall of hatching over the whole dish.
    if ((pattern || custom) && d.cells && rules && anchor) {
      const b = rules.buffer;
      const myId = me?.id ?? -1;
      const SHADE = 20;
      const R = SHADE + b;
      for (let dy = -R; dy <= R; dy++) {
        const y = (((anchor.y + dy) % h) + h) % h;
        for (let dx = -R; dx <= R; dx++) {
          const c = d.cells[y * w + ((((anchor.x + dx) % w) + w) % w)];
          if (c === 0 || c === myId) continue;
          for (let by = -b; by <= b; by++) {
            if (Math.abs(dy + by) > SHADE) continue;
            const row = ((((anchor.y + dy + by) % h) + h) % h) * w;
            for (let bx = -b; bx <= b; bx++) {
              if (Math.abs(dx + bx) > SHADE) continue;
              const j = row + ((((anchor.x + dx + bx) % w) + w) % w);
              if (o[j] === 0) o[j] = 9;
            }
          }
        }
      }
    }
    if (stamp && !quiet) for (const i of stamp) o[i] = legal ? 1 : 2;
    if (pending) for (const i of pending.cells) o[i] = 4;
    // Find my colony, a planting or a shared link: the colony's living cells pulse for a moment.
    if (flash && d.cells) for (let i = 0; i < d.cells.length; i++) if (d.cells[i] === flash.colony) o[i] = 4;
    // The cells just planted, and the colony's own cells that grew from them, ringed for a few generations.
    if (glow) {
      for (const i of glow.cells) {
        o[i] = 4;
        if (!d.cells || !me) continue;
        const x = i % w;
        const y = (i / w) | 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const j = ((y + dy + h) % h) * w + ((x + dx + w) % w);
            if (d.cells[j] === me.id) o[j] = 4;
          }
      }
    }
    return o;
  }, [pattern, custom, fossilOn, fossil, d.cells, rules, me, stamp, legal, pending, w, h, zoneIds, radius, quiet, glow, anchor, flash]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), Math.max(0, flash.until - Date.now()));
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!bloom) return;
    const t = setTimeout(() => setBloom(null), 2600);
    return () => clearTimeout(t);
  }, [bloom]);

  useEffect(() => {
    if (glow && d.generation >= glow.until) setGlow(null);
  }, [d.generation, glow]);

  useEffect(() => {
    if (!pending) return;
    if (d.cells && pending.cells.every((i) => d.cells![i] !== 0) && Date.now() - pending.at > 1500) setPending(null);
    if (Date.now() - pending.at > 60_000) setPending(null);
  }, [d.cells, pending]);

  const info: StampInfo | undefined =
    PATTERNS.find((p) => p.name === pattern) ??
    (custom
      ? { name: null, label: custom.label, cells: custom.offsets.length, note: `The cells of specimen ${custom.id}, as its slide fixed them. Planted as they are (moved, not turned), they plant under the slide's licence at a discount; a planter that does not hold the slide pays its holder a royalty.` }
      : undefined);
  const infoOffsets = info?.name ? offsets[info.name] : custom?.offsets;
  // The contract's own price formula, from the same crate.
  const costOf = (n: number, besieging = false) =>
    rules && ready ? Number(quote(String(d.agar), rules.feed_ppm, rules.keeper_bps, d.counted, rules.live_floor, rules.payback, rules.min_cell_price, n, besieging, rules.siege_x)) : 0;
  // What 0.02 NEAR buys a newcomer right now, after the colony's storage (about 0.0074 NEAR, a little more for a long name).
  const joinNameBytes = new TextEncoder().encode(joinName.trim() || "Night Shift 412").length;
  const joinPetri = rules && ready ? Number(buy_quote(String(JOIN_NEAR - joinStorage(joinNameBytes)), String(d.agar), rules.petri_price, rules.max_supply)) : 0;
  const cost = info ? costOf(stamp?.length ?? info.cells, siege) : 0;
  // The skill made visible: where the stamp is pointed, step a copy of the dish forward and show what it would do.
  const [fc, setFc] = useState<Forecast | null>(null);
  const fcKey = stamp && legal && ready && !fossilOn ? `${stamp.join(",")}|${d.generation}|${me?.id ?? 0}|${cost}` : "";
  useEffect(() => {
    if (!fcKey || !stamp || !rules) {
      setFc(null);
      return;
    }
    const t = setTimeout(() => {
      const e = currentEngine();
      if (!e) return;
      try {
        setFc(forecast(e, { colony: me?.id ?? d.colonies.length + 1, colonies: d.colonies.length, cells: new Uint32Array(stamp), tideIn, perCell, cost, reach: rules.reach }));
      } catch {
        setFc(null);
      }
    }, 120);
    return () => clearTimeout(t);
    // fcKey carries everything the forecast depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fcKey]);
  // A specimen's pattern loaded as the stamp: what its licence asks, when the contract has slide licences.
  const licence = useSlideLicence(custom?.id ?? null, player?.accountId ?? null, undefined, custom ? custom.offsets.length : null);
  // A specimen planted as its slide fixed it (moved, not turned or flipped) is planted under the slide's licence:
  // slide_discount_bps off the price, and a planter that does not hold the slide pays its holder a royalty on top.
  const licensed = !!custom && licence.live && rotate === 0 && !flip;
  const licensedCost = licensed && rules ? Math.floor((cost * (10_000 - (rules.slide_discount_bps ?? 0))) / 10_000) : cost;
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
  // PETRI earned before a colony's first NEAR (or bought with credit) stays in the dish: while a colony that has
  // attached NEAR holds any, it cannot sell for NEAR; planting spends it first. A guest sells for credit, which is allowed.
  const keptUnits = me ? Number(me.kept ?? "0") : 0;
  const keptBlocksSale = !!me?.attached && keptUnits > 0;
  const canSell = !!d.state && (balance ?? 0) >= SELL_UNITS && sellNear > 0 && sellNear <= Number(d.state.sell_left) && !keptBlocksSale;
  /** Why this colony cannot pay for a pact, or null when it may. */
  const pactPayBlock = !me ? null : !me.attached ? "A colony that has not attached NEAR cannot offer a pact: every pact carries at least 1 PETRI that could be sold." : keptUnits > 0 ? `${petri(keptUnits, 2)} of your PETRI is kept in the dish, so you cannot offer a pact until you have planted it.` : null;
  // Planting claims a colony's waiting earnings first, so they count towards the price.
  const spendable = (balance ?? 0) + claimable.petri + Math.max(0, myPending);
  const canAfford = balance !== null && spendable >= licensedCost + (licensed && !licence.holder && licence.royaltyBps ? Math.ceil((licensedCost * licence.royaltyBps) / 10_000) : 0);
  const myColor = me ? hex(me.color) : "#f2b45a";
  /** What the player can spend: their balance and earnings once joined, what a 0.02 NEAR stake buys before. */
  const budget = me ? spendable : joinPetri;
  // A slide burns a fixed PETRI price for each cell it keeps, from the balance the colony holds.
  const sr = slideRules(rules);
  const slideCost = sr.cellPrice !== null ? Number(sr.cellPrice) * kept.length : null;
  const slideMin = sr.minCells ?? 1;
  // Drawn exactly as the contract will draw the token's picture, from the same bitmap.
  const previewSrc = useMemo(
    () => (fossil && me ? svgUrl(slideSvg(cellsBitmap(kept, fossil.w, fossil.h), fossil.w, fossil.h, me.color, d.generation)) : null),
    [kept, fossil, me, d.generation],
  );
  const fossilBlock = !me
    ? "Start a colony first."
    : !fossil
      ? "Drag across your colony to frame a slide."
      : kept.length === 0
        ? `None of ${me.name}'s living cells are inside the frame. Drag it over your colony.`
        : kept.length < slideMin
          ? `A slide needs at least ${slideMin} of your living cells; this frame holds ${kept.length}.`
          : slideCost !== null && balance !== null && spendable < slideCost
            ? `This slide burns ${petri(slideCost, 2)} PETRI; ${me.name} can spend ${petri(spendable, 2)}.`
            : null;

  async function start(name: string, color: number) {
    setError(null);
    setDone(null);
    if (!player && !net.freePlay && !freeMainnet) {
      setError("Connect a NEAR wallet first: on the mainnet dish your own wallet signs and pays.");
      return;
    }
    const guest = !player || player.kind === "guest";
    joiningRef.current = true;
    // A guest sees the three steps in a progress card where the form was; a wallet sees one busy line.
    const step = (n: number, text: string) => {
      setBusy(guest ? `${n}/3 ${text}…` : `${text}…`);
      setJoining({ step: n, guest, name, color });
    };
    try {
      let accountId = player?.accountId ?? "";
      if (!player) {
        step(1, "Making your account");
        accountId = await createGuest();
      }
      // A guest joins with the credit the relayer sponsored. A relaunched dish starts with none, so a remembered guest
      // (or one whose credit was slow to land) is topped up first.
      if (guest) {
        step(2, "Adding free credit");
        const have = BigInt(await getCredit(accountId).catch(() => "0"));
        if (have < JOIN_NEAR) await topUpGuest(accountId);
      }
      step(3, "Joining the dish");
      let r: { hash: string };
      try {
        r = await joinDish(name, color);
      } catch (e) {
        if (!guest || !NO_CREDIT.test(e instanceof Error ? e.message : String(e))) throw e;
        step(2, "Adding free credit");
        await topUpGuest(accountId);
        step(3, "Joining the dish");
        r = await joinDish(name, color);
      }
      // Swap the start form for the colony card now, from the chain as the join left it, not on the next poll.
      setJustJoined(accountId);
      centredFor.current = accountId;
      setJoining({ step: 4, guest, name, color });
      // The join bought about joinPetri; the card shows that at once and the chain's figure replaces it when read.
      const held = await readJoined(accountId, joinPetri);
      const amount = held !== null ? petri(held, 2) : `about ${petri(joinPetri)}`;
      setDone({
        text: guest
          ? `${name} is on the dish with ${amount} PETRI to plant.`
          : `${name} is on the dish. Its 0.02 NEAR stake bought ${amount} PETRI from the agar.`,
        hash: r.hash,
      });
      // The first planting is one press away: a block (the cheapest stamp that never dies) is picked and pinned on the
      // roomiest open agar as soon as the colony and the dish are read.
      setPattern("block");
      setCustom(null);
      setRotate(0);
      setFlip(false);
      setTarget(null);
      markPicked();
      autoPin.current = true;
      setJoinName(labName());
      setJoinTouched(false);
      setJoinPicked(null);
      await refreshDish();
    } catch (e) {
      setError(startFailure(e));
    } finally {
      joiningRef.current = false;
      setBusy(null);
      setJoining(null);
    }
  }

  /** Read the colony a join just made (an optimistic read can lag a block, so a few tries), show it at once, and
   * return its PETRI balance. */
  async function readJoined(accountId: string, bought: number): Promise<number | null> {
    for (let i = 0; i < 8; i++) {
      const c = await getColonyOf(accountId).catch(() => null);
      if (c) {
        const [b, cr, cl] = await Promise.all([
          getBalance(accountId).catch(() => null),
          getCredit(accountId).catch(() => null),
          getClaimable(accountId).catch(() => null),
        ]);
        setMe(c);
        // Never a colony card that says "needs more" while the join's message says what it bought: until the chain's
        // balance is read, the join's quote stands in for it.
        setBalance(b !== null ? Number(b) : bought);
        if (cr !== null) setCredit(BigInt(cr));
        if (cl) setClaimable({ petri: Number(cl.petri), near: Number(cl.near) });
        setLoadedFor(accountId);
        return b !== null ? Number(b) : null;
      }
      await new Promise((res) => setTimeout(res, 600));
    }
    return null;
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
    const genAtStart = d.generation;
    setPending({ cells, label: info.label, at: Date.now() });
    try {
      const trimmed = note.trim();
      const slide = licensed && custom ? custom.id : null;
      const deposit = BigInt(await getPlantDeposit(cells.length, trimmed ? new TextEncoder().encode(trimmed).length : null, slide));
      let r: { hash: string };
      try {
        r = await plantCells(cells, trimmed, deposit, slide);
      } catch (e) {
        // A guest's planting that never reached NEAR goes once more, through the next RPC provider; a wallet's is not
        // re-sent behind its back.
        if (isWallet || !TRANSIENT.test(e instanceof Error ? e.message : String(e))) throw e;
        await new Promise((res) => setTimeout(res, 1200));
        r = await plantCells(cells, trimmed, deposit, slide);
      }
      const how = slide ? ` under specimen ${slide}'s licence` : "";
      const secsPerGen = Math.round(genMs / 1000);
      setDone({
        text: `Your ${info.label.toLowerCase()} is alive and earns PETRI every ${secsPerGen} seconds. ${cells.length} cells${how} for ${petri(licensedCost, 2)} PETRI, half burned and half back to the agar.`,
        hash: r.hash,
        share: true,
      });
      setPending({ cells, label: info.label, at: Date.now(), hash: r.hash });
      setGlow({ cells, until: genAtStart + 4 });
      // The stamp's verdict would now read "already alive" over the new cells: keep it quiet until the stamp moves.
      setQuietKey(cells.join(","));
      // Bring the new cells to the middle of the open agar (on a phone, scroll the page to the dish first) and let a
      // ring bloom over them; their colony's first earnings get a moment of their own when they land.
      focusCells(cells, { color: myColor });
      reward.current = { at: Date.now(), shown: false };
      if (info.name && PATTERNS.some((p) => p.name === info.name && (p.kind === "ship" || p.kind === "gun"))) setLaunched(true);
      setTarget(null);
      setPinNote(null);
      setNote("");
      await refreshDish();
      await loadMe();
    } catch (e) {
      setPending(null);
      setError(plantFailure(e));
    } finally {
      setBusy(null);
    }
  }

  async function claim() {
    setError(null);
    setDone(null);
    setBusy("Claiming…");
    shownEarned.current = { v: 0, at: 0, id: 0 };
    try {
      const r = await claimAll();
      setDone({ text: isWallet ? "Claimed. Your PETRI is in your balance and any NEAR from the tides is on its way to your account." : "Claimed. Your PETRI is in your balance.", hash: r.hash });
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
      setDone({ text: `Sold ${petri(SELL_UNITS)} PETRI back to the agar for about ${near(sellNear, 4)} NEAR from the tide vault${isWallet ? "" : ", paid to this guest as credit"}.`, hash: r.hash });
      await refreshDish();
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

  /** A refusal in words: a guest made before pacts existed holds a key that cannot call the pact methods. */
  const pactFailure = (e: unknown) => {
    const m = e instanceof Error ? e.message : String(e);
    return /MethodNameMismatch|method name/i.test(m)
      ? "This guest's key was made before pacts existed and cannot call the pact methods. Forget this guest and start a new one to make pacts."
      : m;
  };
  async function runPact(label: string, go: () => Promise<{ hash: string }>, text: string) {
    setError(null);
    setDone(null);
    setBusy(label);
    try {
      const r = await go();
      setDone({ text, hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(pactFailure(e));
    } finally {
      setBusy(null);
    }
  }
  const pactAct: PactActions = {
    offer: (to, units, until) =>
      runPact(
        `Offering ${to.name} a pact…`,
        () => offerPact(to.account, units, until, PACT_DEPOSIT),
        `Offered ${to.name} a pact${units > 0n ? ` for ${petri(Number(units), 2)} PETRI, held by the dish until it accepts` : ""}: it would plant nowhere within ${radius} cells of your living cells until generation ${int(until)}. It binds once ${to.name} accepts.`,
      ),
    accept: (p: Pact) =>
      runPact(
        `Accepting pact ${p.id}…`,
        () => acceptPact(p.id),
        `Pact ${p.id} accepted${p.petri > 0n ? `: ${petri(Number(p.petri), 2)} PETRI is yours` : ""}. Until generation ${int(p.until)} the dish refuses your plantings within ${radius} cells of ${names.get(p.from) ?? `colony ${p.from}`}.`,
      ),
    cancel: (p: Pact, why: string) =>
      runPact(`Ending pact ${p.id}…`, () => cancelPact(p.id), `Pact ${p.id} ${why}${p.accepted === null && p.petri > 0n ? "; its PETRI went back to the colony that offered it" : ""}.`),
  };

  /** Open the Fossilize frame, first over the colony's densest patch. */
  function openFossil() {
    if (!me) return;
    setPattern(null);
    setCustom(null);
    setTarget(null);
    setError(null);
    setDone(null);
    const r = fossil ?? densest(d.cells, w, h, me.id, 16) ?? { x: 56, y: 56, w: 16, h: 16 };
    setFossil(r);
    setFossilOn(true);
    lens.current?.centerOn((r.x + Math.floor(r.w / 2)) % w, (r.y + Math.floor(r.h / 2)) % h, mediumZoom());
  }

  async function mintFossil() {
    if (!me || !fossil || fossilBlock) return;
    setError(null);
    setDone(null);
    setBusy("Fixing the slide…");
    const n = kept.length;
    try {
      // The contract's own figure for the storage, which it keeps; anything over comes back.
      const t = slideTitle.trim();
      const deposit = BigInt(await getSlideDeposit(fossil.w, fossil.h, t ? new TextEncoder().encode(t).length : null));
      const r = await mintSlide({ ...fossil, title: t }, deposit);
      setDone({
        text: `Specimen made: ${int(n)} cells of ${me.name} fixed on a slide${slideCost !== null ? ` for ${petri(slideCost, 2)} PETRI, burned` : ""}.`,
        hash: r.hash,
        link: { href: "/specimens", label: "See it in the slide box" },
      });
      setFossilOn(false);
      setSlideTitle("");
      setMinted(true);
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  // /dish?replant=<id> loads a specimen's cells into the stamp; /dish?tool=fossil opens the frame once the colony is known.
  const asked = useRef<{ fossil: boolean; colony: number | null } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const colony = Number(q.get("colony"));
    asked.current = { fossil: q.get("tool") === "fossil", colony: Number.isInteger(colony) && colony > 0 ? colony : null };
    if (asked.current.fossil) setFossilAsk(true);
    const id = q.get("replant");
    if (!id) return;
    getSlide(id).then(
      (raw) => {
        const sl = raw ? normalizeSlide(raw) : null;
        const cells = sl ? slideOffsets(sl) : null;
        if (!sl || !cells || cells.length === 0) {
          setError(sl ? `Specimen ${id}'s cells could not be read, so it cannot be loaded as a stamp.` : `There is no specimen ${id} on this dish.`);
          return;
        }
        setPattern(null);
        setCustom({ offsets: cells, label: sl.title?.trim() || `Specimen ${id}`, id });
        setDone({ text: `Specimen ${id}'s ${int(cells.length)} cells are in the stamp. Point at open agar and click to place them; R turns them, F flips them.` });
      },
      (e) => setError(`Specimen ${id} could not be read: ${e instanceof Error ? e.message : String(e)}`),
    );
  }, []);
  useEffect(() => {
    if (!me || !d.cells || !asked.current?.fossil) return;
    asked.current.fossil = false;
    setFossilAsk(false);
    openFossil();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, d.cells]);

  /** A payment through NEAR Intents landed: show the colony it made or fed. */
  async function landed(account: string) {
    setPayOpen(false);
    await refreshDish();
    await loadMe();
    const c = await getColonyOf(account).catch(() => null);
    const mine = player?.accountId === account;
    setDone({
      text: c
        ? mine
          ? `${c.name} is on the dish with its PETRI. Pick a stamp below and plant it.`
          : `${c.name} is on the dish for ${shortAccount(account, 28)}. Connect that account's wallet here to plant with it.`
        : `The NEAR reached the dish for ${shortAccount(account, 28)}.`,
    });
  }

  /** A colony started by someone else's payment takes the name its owner chooses, once. */
  async function rename(name: string) {
    if (!me) return;
    setError(null);
    setDone(null);
    setBusy("Renaming the colony…");
    try {
      const r = await renameColony(name, me.color);
      setDone({ text: `The colony is called ${name} now.`, hash: r.hash });
      await refreshDish();
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function claimBack() {
    setError(null);
    setDone(null);
    setBusy("Claiming the pending NEAR…");
    try {
      const r = await claimPending();
      setDone({ text: `Claimed ${near(Number(pendingNear), 4)} NEAR back to your account.`, hash: r.hash });
      await loadMe();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  /** The living cells of one colony, as indexes into the board. */
  function cellsOf(id: number): number[] {
    const out: number[] = [];
    if (!d.cells) return out;
    for (let i = 0; i < d.cells.length; i++) if (d.cells[i] === id) out.push(i);
    return out;
  }

  /** Put the middle of the open agar (above the stamp dock, clear of the panels) on cell (x, y) at zoom z, and say where
   * on the canvas that is, in CSS px. */
  function centreInFree(x: number, y: number, z?: number): { fx: number; fy: number } | null {
    const L = lens.current;
    const v = L?.view();
    if (!L || !v?.w) return null;
    L.centerOn(x, y, z);
    const zz = L.camera().zoom;
    const area = freeArea();
    if (!area) return { fx: v.w / v.dpr / 2, fy: v.h / v.dpr / 2 };
    const fx = (area.left + area.right) / 2;
    const fy = (area.top + area.bottom) / 2;
    const wrap = (a: number, n: number) => ((a % n) + n) % n;
    L.centerOn(wrap(x + ((area.w / 2 - fx) * v.dpr) / zz, w), wrap(y + ((area.h / 2 - fy) * v.dpr) / zz, h), zz);
    return { fx, fy };
  }

  /** Bring a colony's cells into view: on a phone the page scrolls to the dish first; the view zooms to about three
   * times the whole-dish fit (closer if it already was), centres the colony above the dock (a circular mean, so a colony
   * across an edge stays whole), and its cells pulse for two seconds under a blooming ring. */
  function focusCells(cells: number[], opt: { color?: string; colony?: number; scroll?: boolean } = {}) {
    const at = torusCentre(cells, w, h);
    const L = lens.current;
    const v = L?.view();
    if (!at || !L || !v?.w) return;
    const phone = !window.matchMedia("(min-width: 800px)").matches;
    if (phone && opt.scroll !== false) {
      const box = canvasBox.current?.getBoundingClientRect();
      if (box) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: Math.max(0, box.top + window.scrollY - 68), behavior: reduce ? "auto" : "smooth" });
      }
    }
    const cur = L.camera().zoom;
    const z = Math.max(v.roundFit * 3, Math.min(cur, v.roundFit * 6));
    const spot = centreInFree(at.x, at.y, z);
    const colony = opt.colony ?? me?.id;
    if (colony) setFlash({ colony, until: Date.now() + 2200 });
    if (spot) {
      setBloom({ x: spot.fx, y: spot.fy, key: Date.now(), color: opt.color ?? myColor });
      bloomAt.current = { x: spot.fx, y: spot.fy };
    }
  }

  function findMine() {
    if (!me) return;
    focusCells(cellsOf(me.id), { colony: me.id, color: myColor });
  }

  /** Open the start panel (unfolded) and bring it into view: the mainnet "be the first colony" chip's button. */
  function openStart() {
    setStartFolded(false);
    requestAnimationFrame(() => document.getElementById("start-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  }

  /** Copy (or, on a phone, share) a link that opens the dish on this colony. */
  async function shareColony() {
    if (!me) return;
    const url = shareUrl(`/c/${me.id}`);
    try {
      if (coarse && typeof navigator.share === "function") {
        await navigator.share({ title: `${me.name} on ${PRODUCT}`, text: `My colony on ${PRODUCT}, a memecoin that is alive.`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      setTimeout(() => setShared(false), 2200);
    } catch {
      /* the share sheet was closed, or the clipboard refused: nothing to undo */
    }
  }

  /** The legal anchor nearest to (x, y) for the chosen stamp, searching outward ring by ring. */
  function nearestFit(x: number, y: number, maxR = 18): Cell | null {
    const e = currentEngine();
    if (!e || !(pattern || custom) || !rules) return null;
    const id = me?.id ?? 65535;
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const ax = (((x + dx) % w) + w) % w;
          const ay = (((y + dy) % h) + h) % h;
          const cells = cellsAt(ax, ay);
          if (cells && e.check_plant(id, cells, rules.buffer, rules.max_plant_cells) === "") return { x: ax, y: ay };
        }
      }
    }
    return null;
  }

  /** The roomiest open agar where `stamp` actually fits: the legal anchor farthest from any rival. */
  function openSpot(make: (x: number, y: number) => Uint32Array | null, lasts?: (cells: Uint32Array) => boolean): { at: Cell; near: number } | null {
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
    // The roomiest legal spot; with `lasts`, the roomiest of the first few where the forecast says the stamp survives
    // (open agar can still lie in a rival glider's path).
    let first: { at: Cell; near: number } | null = null;
    let tried = 0;
    for (const sp of spots) {
      const cells = make(sp.at.x, sp.at.y);
      if (!cells || e.check_plant(id, cells, rules.buffer, rules.max_plant_cells) !== "") continue;
      first ??= sp;
      if (!lasts) return sp;
      if (lasts(cells)) return sp;
      if (++tried >= 10) break;
    }
    return first;
  }

  /** A medium zoom: about three times the zoom that shows the whole dish in a circle. */
  const mediumZoom = () => {
    const v = lens.current?.view();
    return v && v.w ? v.roundFit * 3 : undefined;
  };

  /** Centre the view on open agar where the chosen stamp (or a block) fits. */
  function findOpen() {
    const inHand = !!(pattern || custom);
    const survives = (cells: Uint32Array) => {
      const e = currentEngine();
      if (!e || !rules || !ready) return true;
      try {
        return forecast(e, { colony: me?.id ?? d.colonies.length + 1, colonies: d.colonies.length, cells, tideIn, perCell, cost: 0, reach: rules.reach }).survives;
      } catch {
        return true;
      }
    };
    const sp = openSpot(inHand ? cellsAt : (x, y) => pattern_cells("block", x, y, w, h, rotate, flip), survives);
    const label = inHand ? info?.label.toLowerCase() ?? "stamp" : "block";
    if (!sp) {
      setDone({ text: `No open agar is left where a ${label} fits. Try a smaller stamp, or send a glider.` });
      return;
    }
    const v = lens.current?.view();
    const cur = lens.current?.camera().zoom ?? 0;
    const zoom = v && v.w ? Math.min(v.roundFit * 3, Math.max(cur, v.roundFit * 2)) : undefined;
    if (!centreInFree(sp.at.x, sp.at.y, zoom)) lens.current?.centerOn(sp.at.x, sp.at.y, zoom);
    const room = `${sp.near >= 99 ? "13 or more" : sp.near} cells from the nearest rival`;
    if (inHand) {
      // Pin the stamp there as a ghost, so one more press plants it. The planting card says so on its own status line,
      // right above its button, so no message ever sits over the button.
      setTarget(sp.at);
      setSnapped(false);
      setHover(sp.at);
      const key = (cellsAt(sp.at.x, sp.at.y) ?? []).join(",");
      if (me) {
        setPinNote({ key, text: `Pinned on open agar at ${sp.at.x}, ${sp.at.y}, ${room}. Press the button below to bring it to life.` });
      } else setDone({ text: `A ${label} fits at ${sp.at.x}, ${sp.at.y}, ${room}. Start a colony to plant it.` });
      return;
    }
    setDone({ text: `A ${label} fits at ${sp.at.x}, ${sp.at.y}, ${room}. Pick a stamp to place it.` });
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
    const desktop = window.matchMedia("(min-width: 800px)").matches;
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
  function fitLiving(cells: Uint16Array | undefined): boolean {
    const L = lens.current;
    const v = L?.view();
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
  // A cached board is fitted the same way, so the view does not jump when the live one arrives.
  useEffect(() => {
    if (opened.current || !shownCells) return;
    const z = mediumZoom();
    if (!z) return;
    if (fitLiving(shownCells)) {
      opened.current = true;
      return;
    }
    if (!d.cells || !rules || !currentEngine()) return;
    opened.current = true;
    const sp = openSpot((x, y) => pattern_cells("block", x, y, w, h, 0, false));
    if (sp) lens.current?.centerOn(sp.at.x, sp.at.y, z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownCells, rules]);

  // A guest remembered from an earlier visit opens on its own colony, once its colony and the dish are read.
  useEffect(() => {
    if (!player || player.kind !== "guest" || !me || !d.cells || centredFor.current === player.accountId) return;
    if (!(d.liveCounts[me.id] > 0)) return;
    centredFor.current = player.accountId;
    findMine();
    // findMine reads the same cells; it runs once per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, me, d.cells]);
  // /dish?colony=<id> (where a /c/<id> share page leads): open on that colony, pulse it and show its card.
  useEffect(() => {
    const id = asked.current?.colony;
    if (!id || !d.cells || !ready || !lens.current?.view().w) return;
    asked.current!.colony = null;
    const c = d.colonies.find((x) => x.id === id);
    if (!c) {
      setDone({ text: `There is no colony ${id} on this dish.` });
      return;
    }
    opened.current = true;
    setPicked(id);
    const cells = cellsOf(id);
    if (cells.length) focusCells(cells, { colony: id, color: hex(c.color), scroll: false });
    else setDone({ text: `${c.name} has no living cells right now. Its record stays on the dish.` });
    // cellsOf and focusCells read the same board; this runs once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.cells, ready, d.colonies]);

  // After a join: the block picked for the new colony is pinned on the roomiest open agar, so the next press plants.
  useEffect(() => {
    if (!autoPin.current || !me || pattern !== "block" || !d.cells || !rules || !currentEngine()) return;
    autoPin.current = false;
    findOpen();
    // findOpen reads the stamp and the dish as they are now; it runs once per join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, pattern, d.cells, rules]);

  // The colony earns each generation it has counted cells: "+0.0123" floats up from its earnings, and the first
  // earnings after a planting get a moment on the dish itself.
  const myEarnedNow = me ? Math.max(0, d.pending[me.id] ?? 0) : 0;
  const lastEarned = useRef<{ id: number; v: number } | null>(null);
  useEffect(() => {
    if (!me) {
      lastEarned.current = null;
      return;
    }
    const prev = lastEarned.current;
    lastEarned.current = { id: me.id, v: myEarnedNow };
    if (!prev || prev.id !== me.id || myEarnedNow <= prev.v) return;
    const gain = myEarnedNow - prev.v;
    const r = reward.current;
    const first = !!r && !r.shown && Date.now() - r.at < 10 * 60_000;
    if (first) r!.shown = true;
    setTick({ key: Date.now(), text: `+${petri(gain, gain >= 10_000 ? 3 : 4)}`, first });
  }, [myEarnedNow, me]);
  useEffect(() => {
    if (!tick) return;
    const t = setTimeout(() => setTick(null), tick.first ? 4200 : 1900);
    return () => clearTimeout(t);
  }, [tick]);

  // Another account (a wallet connected, a guest forgotten) gets its own start form back.
  useEffect(() => {
    if (justJoined && player?.accountId !== justJoined) setJustJoined(null);
  }, [player, justJoined]);

  const hovered = hover && d.cells ? d.cells[hover.y * w + hover.x] : 0;
  const hoveredColony = hovered ? colonies.find((c) => c.id === hovered) : null;
  const pickedColony = picked ? d.colonies.find((c) => c.id === picked) ?? null : null;
  const hoverPacts = hoveredColony ? pactLines(book.pacts, hoveredColony.id, d.generation, radius, names) : [];
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

  // The colony card's pieces: a wallet sees them all at once, a guest finds the chain's side behind Details.
  const tideLine = me ? (
    <p className={s.hint}>
      Your cells earn every generation; the PETRI waits in the dish until you claim it, and planting claims it for you.
      At every <Term k="tide" align="start">tide</Term>, each {rules?.tide_every ?? 240} generations, {rules ? rules.tide_bps / 100 : 10}% of the tide vault ({near(vault, 3)} NEAR
      now) is paid out{isWallet ? " in NEAR" : ""}, split by the PETRI each colony earned since the last
      tide{isWallet ? "" : "; a guest’s share comes as credit"}. Next tide in {int(tideIn)}{" "}
      generations, if anyone has earned by then; the agar buys PETRI back after it.
    </p>
  ) : null;
  const claimButton = (
    <button className="btn btn-amber btn-small" onClick={claim} disabled={!!busy || (claimable.petri <= 0 && claimable.near <= 0)}>
      {claimable.near > 0 ? `Claim ${near(claimable.near, 4)} NEAR and PETRI` : "Claim earnings"}
    </button>
  );
  const buyButton = (
    <button className="btn btn-ghost btn-small" onClick={buy} disabled={!!busy || !canBuy}>
      Buy PETRI with 0.01 NEAR
    </button>
  );
  const sellButton = (
    <button className="btn btn-ghost btn-small" onClick={sell} disabled={!!busy || !canSell} title={keptBlocksSale ? "Kept PETRI must be planted before you can sell for NEAR." : d.state && sellNear > Number(d.state.sell_left) ? "The agar has bought back all it will until the next tide." : undefined}>
      Sell {petri(SELL_UNITS)} back for {near(sellNear, 4)} {isWallet ? "NEAR" : "credit"}
    </button>
  );
  const keptLine =
    me && keptUnits > 0 ? (
      <p className={s.hint}>
        {me.attached
          ? `${petri(keptUnits, 2)} PETRI is kept in the dish: earned before this colony's first NEAR, or bought with credit. It can be planted (plantings spend it first), not sold or sent; once it is planted, everything you hold can be sold for NEAR.`
          : `${petri(keptUnits, 2)} PETRI is kept in the dish: free play's PETRI can be planted or sold back for credit, never sent or sold for NEAR.`}
      </p>
    ) : null;

  // Where a message goes: inside the card the player is using, right above its button, so nothing ever covers a
  // button; with no colony yet, at the top of the column.
  const status =
    busy || error || done ? (
      <div className={s.statusInline} aria-live="polite">
        {busy && <p className={s.busy}><i className={s.spin} />{busy}</p>}
        {error && <p className={s.bad}>{error}</p>}
        {done && (
          <p className={s.ok}>
            {done.text} {done.hash && <a href={txUrl(done.hash)}>See the transaction</a>}
            {done.link && <> <Link href={done.link.href}>{done.link.label}</Link></>}
            {done.share && me && (
              <>
                {" "}
                <button type="button" className={s.shareLink} onClick={shareColony}>
                  {shared ? "Link copied" : "Share my colony"}
                </button>
              </>
            )}
          </p>
        )}
      </div>
    ) : null;
  const joinTaken = livingStains(d.colonies, d.liveCounts);
  const waitingForColony = !me && !!player && loadedFor !== player.accountId && justJoined !== player.accountId && !busy && !joining;
  const showProgress = (!!joining && !(me && joining.step >= 4)) || (!me && !!player && justJoined === player.accountId);
  const showJoin = !me && !startFolded && !showProgress && !(player && loadedFor !== player.accountId);
  /** The pinned-spot line, while the stamp is still where Find open agar put it. */
  const pinned = pinNote && target && pinNote.key === stampKey ? pinNote.text : null;
  // Earnings shown never dip while the stored board catches up with the browser (pending folds into claimable a moment
  // later); a claim, or twelve seconds, resets the floor.
  const earnedRaw = claimable.petri + Math.max(0, myPending);
  const shownEarned = useRef({ v: 0, at: 0, id: 0 });
  if (!me || shownEarned.current.id !== me.id || earnedRaw >= shownEarned.current.v || Date.now() - shownEarned.current.at > 12_000)
    shownEarned.current = { v: earnedRaw, at: Date.now(), id: me?.id ?? 0 };
  const earnTick = tick ? (
    <span key={tick.key} className={s.tick} aria-hidden="true">
      {tick.text}
    </span>
  ) : null;

  return (
    <div className={`${s.app} ${startFolded && !me && !info && !fossilAsk && !busy && !error && !done ? s.folded : ""}`}>
      <h1 className="sr">The live Petri dish</h1>
      <div ref={canvasBox} className={s.canvas}>
        <Culture
          ref={lens}
          width={w}
          height={h}
          cells={shownCells}
          prevCells={d.prevCells}
          changedAt={d.changedAt}
          palette={d.cells ? palette : cachePalette}
          look="macro"
          fit="cover"
          zoomScale={1.15}
          overlay={overlay}
          ghost={me?.color}
          interactive
          maxDpr={1.5}
          onHover={(c) => !target && setHover(c)}
          select={fossilOn}
          onSelect={(a, b, end) => {
            if (end && a.x === b.x && a.y === b.y) {
              // A tap moves the frame so it is centred where you tapped.
              setFossil((r) => clampRect(r ? { ...r, x: a.x - Math.floor(r.w / 2), y: a.y - Math.floor(r.h / 2) } : { x: a.x - 8, y: a.y - 8, w: 16, h: 16 }, w, h));
              return;
            }
            setFossil(rectFromDrag(a, b, w, h));
          }}
          onCellClick={(c) => {
            if (pattern || custom) {
              const e = currentEngine();
              const cells = cellsAt(c.x, c.y);
              const fits = e && rules && cells ? e.check_plant(me?.id ?? 65535, cells, rules.buffer, rules.max_plant_cells) === "" : false;
              const spot = fits ? c : nearestFit(c.x, c.y);
              setTarget(spot ?? c);
              setSnapped(!fits && !!spot);
              setHover(spot ?? c);
              return;
            }
            setHover(c);
            setPicked(d.cells ? d.cells[c.y * w + c.x] || null : null);
          }}
          label={fossilOn ? `The live dish, generation ${d.generation}. Drag across your colony to frame a slide; the arrow keys move the frame.` : `The live dish, generation ${d.generation}. Drag to move, scroll or pinch to zoom.`}
        />
        {/* Phones hide the zoom buttons; with a stamp in hand, finding open agar is one tap away. */}
        {(pattern || custom) && !fossilOn && (
          <button type="button" className={s.findFab} onClick={findOpen}>
            Find open agar
          </button>
        )}
        {bloom && (
          <span key={bloom.key} className={s.bloom} style={{ left: bloom.x, top: bloom.y, "--bloom": bloom.color } as React.CSSProperties} aria-hidden="true">
            <i />
          </span>
        )}
        {tick?.first && bloomAt.current && (
          <p key={tick.key} className={s.firstEarn} style={{ left: bloomAt.current.x, top: bloomAt.current.y }} role="status">
            <b className="num">{tick.text} PETRI</b>
            <span>your colony&rsquo;s first earnings</span>
          </p>
        )}
      </div>

      <div ref={hudBox} className={s.hud} aria-live="polite">
        <div className={s.hudGen}>
          <Countdown ms={d.nextInMs} total={genMs} />
          {ready || stale || d.status === "error" ? (
            <div>
              <span>{stale ? "Last seen" : "Generation"}</span>
              <b className="num">{ready ? int(d.generation) : stale ? int(cache!.generation) : "—"}</b>
            </div>
          ) : (
            // First visit, nothing cached: say what is being read rather than show a dash.
            <div className={s.hudReading}>
              <span>Generation</span>
              <b>reading {net.contract}…</b>
            </div>
          )}
        </div>
        <div><span>Next in</span><b className="num">{ready ? `${secs}s` : "…"}</b></div>
        <div><span>Living cells</span><b className="num">{ready ? int(d.totalLive) : stale ? int(cache!.totalLive) : "…"}</b></div>
        <div>
          <span><Term k="perCell" place="below">A new cell earns</Term></span>
          <b className="num">{ready ? petri(perCell, 4) : stale ? petri(cache!.perCell, 4) : "…"}</b>
        </div>
        <div><span><Term k="agar" place="below" align="end">Agar</Term></span><b className="num">{ready ? petri(d.agar) : stale ? petri(cache!.agar) : "…"}</b></div>
        <div className={s.hudNet}><NetTag short /></div>
      </div>
      {ready && d.asleep ? (
        // More than max_lag behind: the contract's next call skips ahead, so the board shown is where that call leaves it.
        <div
          ref={warmBox}
          className={`${s.warmChip} ${s.sleepChip}`}
          role="status"
          title={`Nobody has moved on this dish for a while. The contract's next call (any move: a join, a planting, an advance) skips ${int(d.skipNext)} generations, which never run and pay no feed, then runs the last ${rules?.max_catchup ?? 120}. The board shown is where that call leaves it.`}
        >
          <p>
            <span className={s.sleepTag}>Asleep</span> The next move wakes the dish and skips <b className="num">{int(d.skipNext)}</b> generations.
          </p>
          {!net.freePlay && d.counted === 0 && (
            <p className={s.firstLine}>
              The first outside colony starts the feed: be it.
              {!me && (
                <button type="button" className={s.linkish} onClick={openStart}>
                  Start a colony
                </button>
              )}
            </p>
          )}
        </div>
      ) : ready && warming && !net.freePlay && d.counted === 0 ? (
        <div ref={warmBox} className={`${s.warmChip} ${s.firstChip}`} role="status">
          <p>The first outside colony starts the feed: be it.</p>
          {!me && (
            <button type="button" className="btn btn-amber btn-small" onClick={openStart}>
              Start a colony
            </button>
          )}
        </div>
      ) : ready && warming ? (
        <div ref={warmBox} className={`${s.warmChip} ${s.warmMini}`}>
          <WarmUp compact />
        </div>
      ) : null}
      {stale && d.status !== "error" && (
        <div ref={warmBox} className={`${s.warmChip} ${s.staleChip}`} role="status">
          <i className={s.spin} aria-hidden="true" />
          The dish as this browser last saw it, {ago(cache!.at)}. Reading the live one from NEAR…
        </div>
      )}

      <aside ref={leftBox} className={s.left}>
        {/* No colony yet: messages sit at the top of the column, where they cover nothing (a join's own errors are in
            its form, right above its button). */}
        {!me && status && !(showJoin && !!error && !busy && !done) && !(showProgress && !!busy && !error) && <section className={`${s.card} ${s.toast}`}>{status}</section>}
        {pickedColony && !info && !fossilOn && (
          <PickedColony
            c={pickedColony}
            live={d.liveCounts[pickedColony.id] ?? 0}
            pacts={book.pacts}
            me={me}
            g={d.generation}
            radius={radius}
            maxGens={rules?.pact_max_gens ?? 2880}
            names={names}
            canPay={pactPayBlock}
            holding={balance}
            busy={!!busy}
            signedIn={!!player}
            act={pactAct}
            onClose={() => setPicked(null)}
          />
        )}
        {!me && fossilAsk && <FossilNeedsColony onClose={() => setFossilAsk(false)} />}
        {!me && startFolded && (
          <button className={s.startPill} onClick={() => setStartFolded(false)} aria-expanded="false" aria-controls="start-panel">
            <i className="swatch" style={{ background: "#f2b45a", width: 12, height: 12 }} />
            Start a colony
            <span>Open</span>
          </button>
        )}
        {/* Until a returning player's colony is read, its card's space is held so nothing below it jumps. */}
        {waitingForColony && (
          <section className={`${s.card} ${s.meWait}`} aria-busy="true">
            <p className={s.busy}><i className={s.spin} />Reading your colony from NEAR…</p>
          </section>
        )}
        {showProgress && <JoinProgress step={joining?.step ?? 4} guest={joining?.guest ?? player?.kind !== "wallet"} name={joining?.name ?? joinName} color={joining?.color ?? joinPicked ?? 0xf2b45a} />}
        {showJoin &&
          (net.freePlay || player || freeMainnet ? (
            <JoinForm
              onStart={start}
              onConnect={connect}
              onPay={net.freePlay ? undefined : () => setPayOpen(true)}
              onFold={() => setStartFolded(true)}
              busy={!!busy}
              player={player}
              grant={ready ? petri(joinPetri) : "…"}
              taken={joinTaken}
              freePlay={net.freePlay || ((freeMainnet || player?.kind === "guest") && player?.kind !== "wallet")}
              mainnet={!net.freePlay}
              name={joinName}
              touched={joinTouched}
              onName={(n) => {
                setJoinName(n);
                setJoinTouched(true);
              }}
              onRoll={() => {
                setJoinName(labName());
                setJoinTouched(false);
              }}
              picked={joinPicked}
              onPick={setJoinPicked}
              error={error && !busy ? error : null}
            />
          ) : (
            <MainnetStart onConnect={connect} onPay={() => setPayOpen(true)} onFold={() => setStartFolded(true)} busy={!!busy} onFree={() => setFreeMainnet(true)} />
          ))}

        {player && pendingNear > 0n && (
          <section className={`${s.card} ${s.status}`}>
            <p>
              {near(Number(pendingNear), 4)} NEAR reached the dish for this account through NEAR Intents and was not used.
              {isWallet ? " It is yours to claim back." : ""}
            </p>
            {isWallet && (
              <div className={s.row}>
                <button className="btn btn-amber btn-small" onClick={claimBack} disabled={!!busy}>Claim {near(Number(pendingNear), 4)} NEAR</button>
              </div>
            )}
          </section>
        )}

        {info && !me && (
          <section className={`${s.card} ${fc ? s.stampCard : s.stampLine}`}>
            <div className={s.stampLine}>
              <Specimen offsets={infoOffsets} color={myColor} size={30} />
              <p>{info.label} selected. Start a colony to plant it.</p>
              <button className={s.close} aria-label="Put the stamp down" onClick={() => { setPattern(null); setCustom(null); setTarget(null); }}>×</button>
            </div>
            {fc && <ForecastView f={fc} cost={cost} genMs={genMs} at={anchor} />}
          </section>
        )}

        {info && me && (
          <section className={`${s.card} ${s.plantCard}`}>
            <div className={s.plantHead}>
              <Specimen offsets={infoOffsets} color={myColor} size={48} />
              <div>
                <h2>{info.label}</h2>
                <span className="num">
                  {stamp?.length ?? info.cells} cells, {petri(licensedCost, 2)} PETRI
                  {licensed ? <> (<Term k="licence" place="below">licensed</Term>)</> : ""}
                  {siege ? <> (<Term k="siege" place="below">siege</Term>, {rules?.siege_x ?? 3}×)</> : ""}
                </span>
              </div>
              <button className={s.close} aria-label="Put the stamp down" onClick={() => { setPattern(null); setCustom(null); setTarget(null); }}>×</button>
            </div>
            <p className={s.hint}>{info.note}</p>
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={() => setRotate((r) => (r + 1) % 4)}>Rotate{!coarse && <> <kbd>R</kbd></>}</button>
              <button className="btn btn-ghost btn-small" onClick={() => setFlip((f) => !f)}>Flip{!coarse && <> <kbd>F</kbd></>}</button>
            </div>
            <p className={`${s.verdict} ${breach ? s.bad : verdict === "" ? s.ok : siege ? s.warn : verdict ? s.bad : ""}`}>
              {pinned && !quiet && verdict === "" ? pinned : quiet ? "Planted. Pick another spot of open agar, or put the stamp down." : !anchor ? (coarse ? "Tap the dish to place, then confirm." : "Point at the dish, then click where it should grow.") : breach ? `Pact ${breach.pact.id} with ${names.get(breach.pact.from) ?? `colony ${breach.pact.from}`}: your colony promised not to plant within ${radius} cells of its living cells until generation ${int(breach.pact.until)}, and this comes that close to its cell at ${breach.at.x}, ${breach.at.y}. The outlined zone is off limits; the dish would refuse it.` : verdict === "" ? `${snapped && target ? "That spot was taken, so the stamp moved to the nearest one that fits: " : "Fits at "}${anchor.x}, ${anchor.y}.${target ? "" : coarse ? " Tap to place it." : " Click to place it."}` : explain(verdict, w, names, rules?.siege_x)}
            </p>
            {status}
            {fc && <ForecastView f={fc} cost={cost} genMs={genMs} at={anchor} />}
            {custom && licence.live && <LicenceLine licence={licence} cost={licensedCost} licensed={licensed} />}
            {me && (
              <label className={s.noteField}>
                <span>Lab note, stored on chain with the planting (optional)</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={140} placeholder="Why here? Anyone reading the dish will see it." />
                <em className="num">{note.length}/140</em>
              </label>
            )}
            <div className={`${s.stickyCta} ${s.actionBar}`}>
            <button className="btn btn-amber" disabled={!me || !target || !legal || !!busy || !canAfford || plantedThisGen} onClick={plant}>
              {!me
                ? "Start a colony to plant"
                : !target
                  ? coarse
                    ? "Tap the dish to place it"
                    : "Click the dish to place it"
                  : !canAfford
                    ? `You need ${petri(licensedCost, 2)} PETRI`
                    : plantedThisGen
                      ? "One planting per generation. Next one soon"
                      : siege
                        ? `Lay siege here for ${petri(licensedCost, 2)} PETRI`
                        : `Plant the ${info.label.toLowerCase()} here`}
            </button>
            </div>
          </section>
        )}

        {me && (info || fossilOn) && (
          // While a stamp is in hand the colony card shrinks to one line, so the planting controls fit the column.
          <section className={`${s.card} ${s.stampLine}`}>
            <i className="swatch" style={{ background: myColor, width: 16, height: 16 }} />
            <p>
              <b>{me.name}</b> can spend <span className="num">{balance === null ? "—" : petri(spendable, 2)}</span> PETRI
            </p>
            {myLive > 0 && (
              <span className={s.earning} title={`${int(myLive)} living cells earning every generation`}>
                <i aria-hidden="true" />
                earning
                {earnTick}
              </span>
            )}
          </section>
        )}

        {me && !info && !fossilOn && (
          <section className={`${s.card} ${isWallet ? "" : s.guestCard}`}>
            {myLive === 0 && (
              <p className={s.firstStep}>
                <b>First step</b> Pick a stamp below and plant it.
              </p>
            )}
            <div className={s.meHead}>
              <i className="swatch" style={{ background: myColor, width: 16, height: 16 }} />
              <h2>{me.name}</h2>
            </div>
            {isWallet && <a className={s.acct} href={accountUrl(me.account)}>{shortAccount(me.account, 34)}</a>}
            <dl className={s.meStats}>
              <div><dt>{isWallet ? "Holding" : "PETRI to plant"}</dt><dd className="num">{balance === null ? "—" : petri(balance, 2)}</dd></div>
              <div>
                <dt>Earned, unclaimed</dt>
                <dd className={`num ${s.earnDd}`}>
                  <span className={s.sign}>+</span>
                  {petri(shownEarned.current.v, 3)}
                  {earnTick}
                </dd>
              </div>
              <div><dt>Living cells</dt><dd className="num">{int(myLive)}</dd></div>
              {isWallet &&
                (d.state && Number(d.state.tides) === 0 && claimable.near === 0 ? (
                  <div><dt>First tide</dt><dd className="num">in {int(tideIn)} <small>gens</small></dd></div>
                ) : (
                  <div><dt>Won at the tides</dt><dd className="num">{near(claimable.near + Number(me.near_claimed), 4)} <small>NEAR</small></dd></div>
                ))}
            </dl>
            {myLive > 0 && (
              <p className={s.earningLine}>
                <i aria-hidden="true" />
                {int(myLive)} living {myLive === 1 ? "cell" : "cells"} earning every {Math.round(genMs / 1000)} s
              </p>
            )}
            {isWallet ? (
              <>
                {tideLine}
                <div className={s.row}>
                  {claimButton}
                  {buyButton}
                  {sellButton}
                </div>
                {keptLine}
              </>
            ) : (
              <>
                <p className={s.hint}>Your cells earn PETRI every generation; planting spends it for you.</p>
                <div className={s.row}>{claimButton}</div>
              </>
            )}
            <MyPacts pacts={book.pacts} me={me} g={d.generation} radius={radius} names={names} busy={!!busy} act={pactAct} />
            {isWallet && (
              <p className={s.hint}>Your wallet signs each move and pays its own gas and deposits{nearLeft !== null ? `; it holds ${near(Number(nearLeft), 3)} NEAR` : ""}.</p>
            )}
            <div className={s.row}>
              <button className="btn btn-ghost btn-small" onClick={findMine} disabled={myLive === 0}>Find my colony</button>
              <button className="btn btn-ghost btn-small" onClick={shareColony} title="Copy a link that opens the dish on your colony">
                {shared ? "Link copied" : "Share"}
              </button>
              <button className="btn btn-ghost btn-small" onClick={openFossil} disabled={myLive === 0 || !!busy} title="Fix a patch of your living cells onto a slide, minted as a NEAR token">
                Fossilize a patch
              </button>
            </div>
            {!isWallet && (
              // Free play keeps the chain out of the way: the account, the tide vault, trading and credit wait here.
              <details className={s.details}>
                <summary>Details</summary>
                <a className={s.acct} href={accountUrl(me.account)}>{shortAccount(me.account, 34)}</a>
                <dl className={s.meStats}>
                  {d.state && Number(d.state.tides) === 0 && claimable.near === 0 ? (
                    <div><dt>First tide</dt><dd className="num">in {int(tideIn)} <small>gens</small></dd></div>
                  ) : (
                    <div><dt>Won at the tides</dt><dd className="num">{near(Number(me.credit_won), 4)} <small>credit</small></dd></div>
                  )}
                </dl>
                {tideLine}
                <div className={s.row}>
                  {buyButton}
                  {sellButton}
                </div>
                {keptLine}
                <p className={s.hint}>The site sponsored {near(Number(GUEST_CREDIT), 2)} {net.freePlay ? "testnet " : ""}NEAR of credit for this guest, held by the dish contract and spendable only on joining, buying and planting; with what it has won, {near(Number(sponsoredLeft), 4)} NEAR of credit is left. Connect a wallet to play with your own.</p>
                <p className={s.hint}>Free play earns credit, not NEAR: a guest&rsquo;s tide shares and sales are paid as credit it can spend here.</p>
              </details>
            )}
            {status}
            <div className={`${s.row} ${s.acctLinks}`}>
              {isWallet ? (
                <>
                  {!net.freePlay && (
                    <button className={s.linkish} onClick={() => setPayOpen(true)}>
                      Top up with any token
                    </button>
                  )}
                  <button className={s.linkish} onClick={() => disconnectWallet().catch(() => {})}>
                    Disconnect wallet
                  </button>
                </>
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
            {me.proxy && isWallet && <Rename current={me.name} busy={!!busy} onRename={rename} />}
          </section>
        )}

        {me && !info && !fossilOn && (
          <Goals
            me={me}
            network={net.network}
            generation={d.generation}
            live={myLive}
            earned={(d.earnings[me.id] ?? 0) + Math.max(0, myPending)}
            wonTide={Number(me.near_claimed) > 0 || Number(me.credit_won) > 0 || claimable.near > 0}
            launched={launched || d.recentPlants.some((p) => p.colony === me.id && p.siege)}
            minted={minted}
          />
        )}

        {me && fossilOn && (
          <section className={`${s.card} ${s.plantCard}`} aria-labelledby="fossil-title">
            <div className={s.plantHead}>
              <div>
                <h2 id="fossil-title">Fossilize</h2>
                <span>A slide of {me.name}&rsquo;s own living cells</span>
              </div>
              <button className={s.close} aria-label="Close the frame" onClick={() => setFossilOn(false)}>×</button>
            </div>
            <div className={s.fossilGlass}>
              <SlideGlass size="mini" src={previewSrc} title={slideTitle} placeholder="Untitled specimen" colony={me} generation={d.generation} count={kept.length} />
            </div>
            <dl className={s.fossilStats} aria-live="polite">
              <div><dt>Frame</dt><dd className="num">{fossil ? `${fossil.w} × ${fossil.h}` : "—"}</dd></div>
              <div><dt>Your cells inside</dt><dd className="num">{int(kept.length)}</dd></div>
              <div><dt>PETRI it burns</dt><dd className="num">{slideCost !== null ? petri(slideCost, 2) : "—"}</dd></div>
            </dl>
            <p className={s.hint}>
              Drag across your colony to frame it, 4 to 32 cells a side; tap to move the frame. The arrow keys move it and Shift with the
              arrows resizes it. Shift and drag, or two fingers, moves the dish.
            </p>
            <label className={s.noteField}>
              <span>Title, stored on the token (optional)</span>
              <input value={slideTitle} onChange={(e) => setSlideTitle(e.target.value)} maxLength={SLIDE_TITLE_MAX} placeholder="e.g. Beehives at dawn" />
              <em className="num">{slideTitle.length}/{SLIDE_TITLE_MAX}</em>
            </label>
            <p className={`${s.verdict} ${fossilBlock ? s.warn : s.ok}`}>
              {fossilBlock ??
                "Ready. The contract keeps your cells as they are when the transaction lands, which may be a generation after this preview: still lifes stay put, gliders move on."}
            </p>
            {status}
            <div className={s.stickyCta}>
              <button className="btn btn-amber" disabled={!!fossilBlock || !!busy} onClick={mintFossil}>
                Mint this specimen
              </button>
            </div>
            <p className={s.hint}>
              {isWallet
                ? "Your wallet also attaches the NEAR for the token's storage, a few thousandths, as the contract quotes it; anything over comes back."
                : "Free play: the token's storage, a few thousandths of a NEAR, comes out of this guest's sponsored credit."}
            </p>
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
        <DishDelight mine={me?.id ?? null} ear={() => lens.current?.camera().cx} />
        <div className={s.zoom}>
          <button onClick={() => lens.current?.zoomBy(1.5)} aria-label="Look closer">+</button>
          <button onClick={() => lens.current?.zoomBy(1 / 1.5)} aria-label="Look wider">−</button>
          <button onClick={() => lens.current?.setZoomFit(Math.SQRT2)}>Whole dish</button>
          <button onClick={findOpen}>Find open agar</button>
        </div>
        <TideCard variant="dish" className={s.tide} />
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
                const who = chooserOf(move);
                // Hover or tap the badge: who chose the move, the options it weighed and its reasoning.
                const why = move
                  ? `${who.long}.${move.options?.length ? ` It weighed ${move.options.length} legal ${move.options.length === 1 ? "option" : "options"}, each forecast 240 generations ahead.` : ""}${move.note ? ` Its reasoning: “${move.note}”` : ""}`
                  : "A house strain; its move is not in the public log yet.";
                return (
                  <li key={`${p.generation}-${i}`}>
                    <i className="swatch" style={{ background: c ? hex(c.color) : "#888" }} />
                    <div>
                      <p>
                        <b>{c?.name ?? `Colony ${p.colony}`}</b>
                        {c && <BenchTag account={c.account} />}
                        {strain && (
                          <Term tip={why} place="below" align="end">
                            <span className={`${s.aiTag} ${move?.decided_by === "model" ? s.aiModel : ""}`}>{move ? who.short : "AI"}</span>
                          </Term>
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

      <div className={`${s.inspect} ${hoverPacts.length ? s.inspectTall : ""}`} aria-live="polite">
        {hover ? (
          <>
            <span className="num">{hover.x}, {hover.y}</span>
            {hoveredColony ? (
              <span className={s.owner}>
                <i className="swatch" style={{ background: hex(hoveredColony.color) }} />
                {hoveredColony.name}
                {!isGuestAccount(hoveredColony.account) && <a href={accountUrl(hoveredColony.account)}>{shortAccount(hoveredColony.account, 24)}</a>}
              </span>
            ) : (
              <span className={s.hintInline}>{bufferOwner ? `bare agar, inside ${bufferOwner}’s buffer` : "bare agar"}</span>
            )}
            {hoverPacts.length > 0 && (
              <span className={s.inspectPact}>
                {hoverPacts[0]}
                {hoverPacts.length > 1 ? `; and ${hoverPacts.length - 1} more ${hoverPacts.length === 2 ? "pact" : "pacts"}` : ""}
              </span>
            )}
          </>
        ) : (
          <span className={s.hintInline}>{fossilOn ? "Drag to frame a slide. Shift and drag moves the dish." : (pattern || custom) && coarse ? "Tap the dish to place, then confirm." : "Drag to move. Scroll or pinch to zoom. The edges wrap."}</span>
        )}
      </div>

      <nav ref={dockBox} className={`${s.dock} ${me && !everPicked && !info ? s.dockPulse : ""}`} aria-label="Stamps">
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
                        // A pointer press does not focus the stamp, so the browser never scrolls the dock or the page to it;
                        // keyboard users still tab to it as usual.
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          const y = window.scrollY;
                          requestAnimationFrame(() => window.scrollY !== y && window.scrollTo({ top: y, behavior: "instant" }));
                          setPattern(pattern === p.name ? null : p.name);
                          markPicked();
                          setCustom(null);
                          setFossilOn(false);
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
        <p className={s.err}>
          {/does not exist|UNKNOWN_ACCOUNT|CodeDoesNotExist/i.test(d.error ?? "")
            ? `${net.contract} is not deployed on ${net.label.chain} yet. Retrying every few seconds.`
            : `The dish could not be read from NEAR (${d.error}). Retrying every few seconds.`}
          {!net.freePlay && (
            <>
              {" "}
              <button className={s.linkish} onClick={() => switchNetwork("testnet")}>Play free on testnet</button>
            </>
          )}
        </p>
      )}

      {!net.freePlay && (
        <PayAnyToken open={payOpen} onClose={() => setPayOpen(false)} account={player?.kind === "wallet" ? player.accountId : null} onLanded={landed} />
      )}
    </div>
  );
}

/** A colony a NEAR Intents payment started for this account carries the payer's name for it until renamed, once. */
function Rename({ current, busy, onRename }: { current: string; busy: boolean; onRename: (name: string) => void }) {
  const [name, setName] = useState("");
  const clean = name.split(/\s+/).filter(Boolean).join(" ");
  const ok = /^[A-Za-z0-9 \-'.&!?_,:()]{1,24}$/.test(clean) && clean !== current;
  return (
    <form
      className={s.renameRow}
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onRename(clean);
      }}
    >
      <p className={s.hint}>Someone&rsquo;s payment started this colony for you, so its name was their choice. You may rename it once.</p>
      <div className={s.row}>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder={current} aria-label="New colony name" />
        <button className="btn btn-ghost btn-small" type="submit" disabled={!ok || busy}>Rename</button>
      </div>
    </form>
  );
}

/** The mainnet dish has no guests: a colony starts from a wallet, or from any token through NEAR Intents. */
function MainnetStart({ onConnect, onPay, onFold, busy, onFree }: { onConnect: () => void; onPay: () => void; onFold: () => void; busy: boolean; onFree: () => void }) {
  return (
    <section className={s.card} id="start-panel">
      <div className={s.joinHead}>
        <h2 className={s.joinTitle}>Start a colony</h2>
        <FoldButton onFold={onFold} />
      </div>
      <p className={s.hint}>
        This is the mainnet dish: the NEAR is real, and a wallet signs and pays for its own moves. Joining stakes 0.02 NEAR; a little
        pays for your colony&rsquo;s storage and the rest buys PETRI from the agar.
      </p>
      <FreeMainnetOffer onFree={onFree} busy={busy} />
      <div className={s.stickyCta}>
        <button className="btn btn-amber" onClick={onConnect} disabled={busy} style={{ width: "100%", marginTop: 16 }}>
          Connect a NEAR wallet
        </button>
      </div>
      <button className="btn btn-ghost" onClick={onPay} style={{ width: "100%", marginTop: 10 }}>
        Pay with any token
      </button>
      <p className={s.hint}>No NEAR? Pay with USDC (on Base, Solana or Arbitrum), ETH on Base, SOL or BTC. NEAR Intents swaps it, and the dish joins for the NEAR account you name.</p>
      <p className={s.hint} style={{ marginTop: 12 }}>
        Just looking? <button className={s.linkish} onClick={() => switchNetwork("testnet")}>Try free play on testnet</button>, with a guest account and no wallet.
      </p>
    </section>
  );
}

/** A join under way: its steps with ticks, where the form was, so nothing seems to reset while NEAR works. */
function JoinProgress({ step, guest, name, color }: { step: number; guest: boolean; name: string; color: number }) {
  const steps: readonly string[] = guest ? JOIN_STEPS : ["Joining the dish"];
  const at = guest ? step : step >= 4 ? 2 : 1;
  const landed = at > steps.length;
  return (
    <section className={`${s.card} ${s.progress}`} id="start-panel" aria-live="polite" aria-busy={!landed}>
      <div className={s.progressHead}>
        <i className="swatch" style={{ background: hex(color), width: 16, height: 16 }} />
        <h2>{name}</h2>
      </div>
      <p className={s.fine}>{landed ? "On the dish. Reading your colony from NEAR…" : "Starting your colony. This takes a few seconds."}</p>
      <ol className={s.steps}>
        {steps.map((label, k) => {
          const n = k + 1;
          const state = n < at ? "done" : n === at ? "now" : "next";
          return (
            <li key={label} data-state={state}>
              <span className={s.stepMark} aria-hidden="true">
                {state === "done" ? (
                  <svg width="12" height="12" viewBox="0 0 12 12">
                    <path d="M2.5 6.2l2.2 2.2 4.8-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : state === "now" ? (
                  <i className={s.spin} />
                ) : null}
              </span>
              <span>{label}</span>
              <span className="sr">{state === "done" ? ", done" : state === "now" ? ", under way" : ", next"}</span>
            </li>
          );
        })}
        <li data-state={landed ? "now" : "next"}>
          <span className={s.stepMark} aria-hidden="true">{landed ? <i className={s.spin} /> : null}</span>
          <span>A block pinned on open agar, ready to plant</span>
        </li>
      </ol>
      <div className={`${s.stickyCta} ${s.actionBar}`}>
        <button className="btn btn-amber" type="button" disabled style={{ width: "100%" }}>
          {landed ? "Reading your colony…" : `Joining… ${at} of ${steps.length}`}
        </button>
      </div>
    </section>
  );
}

function JoinForm({
  onStart,
  onConnect,
  onPay,
  onFold,
  busy,
  player,
  grant,
  taken,
  freePlay,
  mainnet = false,
  name,
  touched,
  onName,
  onRoll,
  picked,
  onPick,
  error,
}: {
  onStart: (name: string, color: number) => void;
  onConnect: () => void;
  onPay?: () => void;
  onFold: () => void;
  busy: boolean;
  player: Player;
  grant: string;
  /** Stains worn by colonies that still have living cells, with the colony wearing each. */
  taken: Map<number, string>;
  freePlay: boolean;
  /** The mainnet dish: a guest here plays on credit the mainnet relayer sponsored (free play during judging). */
  mainnet?: boolean;
  name: string;
  /** The player has typed in the field; until then the name is a suggestion that typing replaces. */
  touched: boolean;
  onName: (name: string) => void;
  onRoll: () => void;
  picked: number | null;
  onPick: (color: number) => void;
  error: string | null;
}) {
  // Until the player picks one, offer the first high-contrast stain no living colony wears.
  const color = picked !== null && !taken.has(picked) ? picked : firstFreeStain(new Set(taken.keys()));
  const valid = name.trim().length > 0 && name.trim().length <= 24;
  const takenStains = STAINS.flatMap((st) => (taken.has(st.color) ? [{ name: st.name, owner: taken.get(st.color)! }] : []));
  // Eight colours at first (the chosen one among them, free ones before worn ones), the rest one tap away.
  const [allStains, setAllStains] = useState(false);
  const shownStains = useMemo(() => {
    const free = STAINS.filter((st) => !taken.has(st.color) && st.color !== color);
    const worn = STAINS.filter((st) => taken.has(st.color) && st.color !== color);
    const chosen = STAINS.filter((st) => st.color === color);
    const pick = [...chosen, ...free, ...worn].slice(0, 7);
    return STAINS.filter((st) => pick.includes(st));
  }, [taken, color]);
  return (
    <section className={s.card} id="start-panel">
      <div className={s.joinHead}>
        <h2 className={s.joinTitle}>Start a colony</h2>
        <FoldButton onFold={onFold} />
      </div>
      {freePlay && mainnet && player?.kind !== "wallet" ? (
        <>
          <p className={s.freeLead}>Free play on mainnet. No wallet: credit you can play with, not withdraw.</p>
          <p className={s.fine}>
            You start with about {grant} PETRI, bought by a 0.02 NEAR stake out of the credit the site&rsquo;s relayer sponsors
            (0.05 NEAR, less a little for its records) for a new account made from a key in this browser. The relayer pays the
            gas. The credit stays in the dish: it plants and buys, but it never turns into NEAR anyone can withdraw.
          </p>
        </>
      ) : freePlay && player?.kind !== "wallet" ? (
        <>
          <p className={s.freeLead}>Free play. No wallet: the dish gives you PETRI to plant.</p>
          <p className={s.fine}>
            You start with about {grant} PETRI, bought by a 0.02 testnet NEAR stake the site sponsors for a guest account: no
            gas, nothing real spent.
          </p>
        </>
      ) : (
        <p className={s.hint}>
          Name it and choose its stain. Joining stakes 0.02 NEAR: a little pays for your colony&rsquo;s storage and the rest
          buys about {grant} PETRI from the agar to plant with.
          {player?.kind === "wallet"
            ? ` You are joining as ${shortAccount(player.accountId, 28)}: your wallet signs and pays.`
            : player
              ? ""
              : " You get a guest account on NEAR testnet: no wallet, no gas."}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onStart(name.trim(), color);
        }}
      >
        <label className={s.field}>
          <span>Colony name</span>
          <span className={s.nameRow}>
            <input
              value={name}
              onFocus={(e) => {
                // The suggested name is selected, so the first key typed replaces it rather than joining it.
                if (!touched) e.currentTarget.select();
              }}
              onChange={(e) => {
                let v = e.target.value;
                // A browser that kept the caret after the suggestion (no selection): keep only what was typed.
                if (!touched && name && v.length > name.length && v.startsWith(name)) v = v.slice(name.length).trimStart();
                onName(v);
              }}
              maxLength={24}
              placeholder="e.g. Night Shift 412"
            />
            <button type="button" className={s.dice} onClick={onRoll} aria-label="Another name" title="Another name">
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <rect x="2.5" y="2.5" width="13" height="13" rx="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="6.2" cy="6.2" r="1.15" fill="currentColor" />
                <circle cx="11.8" cy="11.8" r="1.15" fill="currentColor" />
                <circle cx="9" cy="9" r="1.15" fill="currentColor" />
              </svg>
            </button>
          </span>
        </label>
        <fieldset className={s.stains}>
          <legend>
            <Term k="stain" place="below" align="start">Colour</Term> <em>{STAINS.find((x) => x.color === color)?.name}</em>
          </legend>
          {(allStains ? STAINS : shownStains).map((st) => {
            const owner = taken.get(st.color);
            return (
              <label
                key={st.color}
                className={`${color === st.color ? s.stainOn : ""} ${owner ? s.stainTaken : ""}`}
                title={owner ? `${st.name}, worn by ${owner}` : st.name}
              >
                <input type="radio" name="stain" checked={color === st.color} disabled={!!owner} onChange={() => onPick(st.color)} />
                <i style={{ background: hex(st.color) }} />
                <span className="sr">{owner ? `${st.name}, worn by ${owner}` : st.name}</span>
              </label>
            );
          })}
          {!allStains && STAINS.length > shownStains.length && (
            <button type="button" className={s.moreStains} onClick={() => setAllStains(true)} aria-label={`Show all ${STAINS.length} colours`}>
              +{STAINS.length - shownStains.length}
            </button>
          )}
        </fieldset>
        {takenStains.length > 0 && (
          <>
            <p className={`${s.hint} ${s.hoverOnly}`} style={{ margin: "6px 0 10px" }}>
              A slashed colour is worn by a living colony; hover it to see which.
            </p>
            {/* Touch screens have no hover, so they say it in words, folded away. */}
            <details className={`${s.touchOnly} ${s.takenList}`}>
              <summary>
                {takenStains.length} {takenStains.length === 1 ? "colour is" : "colours are"} worn by living colonies
              </summary>
              <p className={s.hint}>{takenStains.map((x) => `${x.name} by ${x.owner}`).join("; ")}.</p>
            </details>
          </>
        )}
        {error && (
          <p className={`${s.bad} ${s.formError}`} role="alert">
            {error}
          </p>
        )}
        <div className={`${s.stickyCta} ${s.actionBar}`}>
          <button className="btn btn-amber" type="submit" disabled={!valid || busy} style={{ width: "100%" }}>
            {valid ? "Start my colony" : "Name your colony to start"}
          </button>
        </div>
      </form>
      {player?.kind !== "wallet" && (
        <button className="btn btn-ghost btn-small" type="button" onClick={onConnect} disabled={busy} style={{ width: "100%", marginTop: 10 }}>
          Use my NEAR wallet instead
        </button>
      )}
      {onPay && (
        <button className="btn btn-ghost btn-small" type="button" onClick={onPay} disabled={busy} style={{ width: "100%", marginTop: 10 }}>
          Pay with any token instead
        </button>
      )}
      <p className={s.hint} style={{ marginTop: 12 }}>
        New here? <Link href="/rules">Read how it works</Link>, or just start: your first block is pinned for you, one press
        from alive.
      </p>
    </section>
  );
}
