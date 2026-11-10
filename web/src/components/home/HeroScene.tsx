"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { Culture, type CultureHandle } from "@/components/Culture";
import { Loupe } from "@/components/site/Loupe";
import { LiveBadge } from "./LiveBadge";
import { NetTag } from "@/components/site/NetTag";
import { useNet } from "@/lib/use-net";
import { useLive, int, petri, hex } from "@/lib/live";
import s from "./hero.module.css";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const band = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

/** The busiest patch of the dish, so the close-up opens on living colonies rather than bare agar. */
function busiest(cells: Uint16Array, w: number, h: number) {
  const B = 16;
  let best = -1;
  let at = { x: w / 2, y: h / 2 };
  for (let by = 0; by < h; by += B / 2)
    for (let bx = 0; bx < w; bx += B / 2) {
      let n = 0;
      for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) if (cells[(y % h) * w + (x % w)]) n++;
      if (n > best) {
        best = n;
        at = { x: bx + B / 2, y: by + B / 2 };
      }
    }
  return { ...at, n: best };
}

/** Placeholder for a number still being read from NEAR: a faint shimmer, never a fake zero. */
const skel = (
  <>
    <span className={s.skel} aria-hidden="true" />
    <span className="sr">Reading from NEAR</span>
  </>
);

export function HeroScene() {
  const { d, rules, palette, perCell, warming, warmth, ready, colonies, supply, w, h, secs } = useLive();
  const scene = useRef<HTMLDivElement>(null);
  const lens = useRef<CultureHandle>(null);
  const net = useNet();
  const mask = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const rim = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLElement | null)[]>([]);
  const centred = useRef(false);
  const floor = rules?.live_floor ?? 1000;
  const alive = colonies.filter((c) => c.live > 0);
  const lead = alive[0];

  useEffect(() => {
    if (centred.current || !d.cells) return;
    const at = busiest(d.cells, w, h);
    const k = lens.current?.camera().zoom;
    const v = lens.current?.view();
    // A young dish may read as bare agar for a frame or two: wait for living cells (and a measured view) to aim at.
    if (at.n <= 0 || !k || !v?.w) return;
    centred.current = true;
    // On a phone the headline and stats cover the lower half, so the busy patch is placed in the open band above them.
    const copy = layers.current[0];
    if (k && v?.w && copy && window.innerWidth < 900) {
      const H = v.h / v.dpr;
      // Between the nav and where the scrim starts to darken above the copy.
      const want = Math.max(110, (68 + copy.offsetTop - 100) / 2);
      lens.current?.centerOn(at.x, at.y + ((H / 2 - want) * v.dpr) / k, k);
    } else if (copy) {
      // On a desktop the headline covers the left of the dish: put the busy patch in the open area right of it.
      const W = v.w / v.dpr;
      const right = copy.getBoundingClientRect().right;
      const wantX = right > 0 && right < W * 0.75 ? (right + W) / 2 : W / 2;
      lens.current?.centerOn((((at.x + ((W / 2 - wantX) * v.dpr) / k) % w) + w) % w, at.y, k);
    } else lens.current?.centerOn(at.x, at.y, k);
  }, [d.cells, w, h]);

  // Scroll drives the zoom: from a close-up of a few colonies out to the whole round dish.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = -1;
    const apply = () => {
      raf = 0;
      const el = scene.current;
      const L = lens.current;
      if (!el || !L) return;
      const rect = el.getBoundingClientRect();
      const span = el.offsetHeight - window.innerHeight;
      const p = clamp01(-rect.top / Math.max(1, span));
      if (Math.abs(p - last) < 0.0005) return;
      last = p;
      const v = L.view();
      if (!v.w) return;
      // The close-up fills the longer side, but never shows fewer than about 32 cells across the shorter one (a phone held
      // upright would otherwise open on a couple of dozen beads).
      const close = Math.min((Math.max(v.w, v.h) / w) * 2.4, Math.min(v.w, v.h) / 32) / v.roundFit;
      const z = band(p, 0.18, 0.9);
      const k = Math.exp(Math.log(close) * (1 - ease(z)));
      L.setZoomFit(k);
      const W = window.innerWidth;
      const H = el.querySelector<HTMLElement>(`.${s.stage}`)!.clientHeight;
      const NAV = 68;
      const full = Math.hypot(W, H) / 2 + 4;
      // Where the pulled-back dish comes to rest: clear of the nav, and clear of the "One dish" caption.
      let cx = W / 2;
      let cy = H / 2;
      let end: number;
      if (W < 900) {
        // Phones and tablets: the dish sits high, the caption below it, with neither touching.
        const top = NAV + 22;
        const bottom = (layers.current[2]?.offsetTop ?? H) - 24;
        end = Math.max(80, Math.min(W / 2 - 18, H * 0.34, (bottom - top) / 2));
        cy = Math.max(top + end, Math.min(H * 0.36, bottom - end));
      } else {
        const capLeft = layers.current[2]?.offsetLeft ?? W;
        cy = H / 2 + NAV / 2;
        end = Math.max(120, Math.min((H - NAV) / 2 - 36, (capLeft - 56) / 2));
        cx = Math.max(end + 24, Math.min(W * 0.38, capLeft - 32 - end));
      }
      const r = full + (end - full) * ease(band(p, 0.45, 0.9));
      // Shift the dish towards its resting centre only as far as the shrinking circle allows, so no straight edge shows.
      const toward = (want: number, room: number) => Math.sign(want) * Math.min(Math.abs(want), Math.max(0, room));
      const ox = toward(cx - W / 2, W / 2 - r);
      const oy = toward(cy - H / 2, H / 2 - r);
      if (mask.current) {
        mask.current.style.clipPath = `circle(${r}px at 50% 50%)`;
        mask.current.style.translate = `${ox}px ${oy}px`;
      }
      if (scrim.current) {
        scrim.current.style.opacity = String(1 - band(p, 0.4, 0.75));
        // How tall the copy stands, so the phone scrim stays solid behind it and only fades above it.
        scrim.current.style.setProperty("--copy", `${layers.current[0]?.offsetHeight ?? 0}px`);
      }
      if (rim.current) {
        rim.current.style.width = rim.current.style.height = `${2 * r + 18}px`;
        rim.current.style.left = `${W / 2 + ox}px`;
        rim.current.style.top = `${H / 2 + oy}px`;
        rim.current.style.opacity = String(band(p, 0.72, 0.9));
      }
      const first = 1 - band(p, 0.06, 0.2);
      const show = [first, band(p, 0.26, 0.36) * (1 - band(p, 0.56, 0.64)), band(p, 0.82, 0.92), first];
      layers.current.forEach((n, i) => {
        if (!n) return;
        const o = reduce ? (i === 0 ? 1 : 0) : show[i];
        n.style.opacity = String(o);
        n.style.transform = `translateY(${(1 - o) * 14}px)`;
        n.style.visibility = o < 0.02 ? "hidden" : "visible";
      });
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const t = setInterval(onScroll, 400);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      clearInterval(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [w]);

  return (
    <div ref={scene} id="alive" data-section="A memecoin that is alive" className={s.scene}>
      <div className={s.stage}>
        <div ref={mask} className={s.mask}>
          <div className={s.reveal}>
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
              zoomScale={2.4}
              drift={[0.5, 0.22]}
              maxDpr={1.25}
              label={`The live dish at generation ${d.generation}: ${d.totalLive} living cells in ${alive.length} colonies`}
            />
          </div>
        </div>
        <div ref={rim} className={s.rim} aria-hidden="true" />
        <div ref={scrim} className={s.scrim} aria-hidden="true" />

        <section ref={(n) => { layers.current[0] = n; }} className={s.copy} aria-labelledby="hero-title">
          <LiveBadge />
          <h1 id="hero-title" className={s.title}>A memecoin that is alive.</h1>
          <div className={s.row}>
            <div className={s.ledeBox}>
              <ol className={s.steps} aria-label="How to play">
                <li><span><b>Plant a pattern</b> on the one shared dish.</span></li>
                <li><span><b>It lives by Conway&rsquo;s rules,</b> a generation every fifteen seconds.</span></li>
                <li><span><b>Living cells earn PETRI,</b> and the hourly tide pays out NEAR.</span></li>
              </ol>
              <p className={s.dishes}>
                Every bead here is a living cell on NEAR, owned by a real account. Two dishes run the same contract:{" "}
                <b>mainnet</b>, with real NEAR, and <b>testnet</b>, free with a guest account in one click.
              </p>
            </div>
            <div className={s.actions}>
              {net.freePlay ? (
                <Link className="btn btn-amber" href="/dish">Play free on testnet</Link>
              ) : (
                <Link className="btn btn-amber" href="/dish">Start a colony</Link>
              )}
              <Link className="btn btn-ghost" href="/rules">How the coin works</Link>
            </div>
          </div>
          <p className={s.statsHead}>
            <NetTag />
            <span>{net.freePlay ? "The free-play dish, read live from NEAR testnet" : "Read live from NEAR mainnet"}</span>
          </p>
          <dl className={s.stats} aria-live="polite" aria-busy={!ready}>
            <div><dt>Living cells</dt><dd className="num">{ready ? int(d.totalLive) : skel}</dd></div>
            {ready && warming ? (
              // A young dish feeds a fraction of the ration (none at all before a player cell is counted), so the
              // first screen shows how far it has to go rather than a rate nobody is being paid yet.
              <div title={`Counted cells are players' living cells, each colony up to its reach. Until ${int(floor)} are counted the agar releases that fraction of its ration; the house strains are never counted.`}>
                <dt>{d.counted === 0 ? `Not feeding yet: full feed at ${int(floor)} counted cells` : `Feeding in part: full at ${int(floor)} counted cells`}</dt>
                <dd className="num">{int(d.counted)} <small className={s.of}>/ {int(floor)}</small></dd>
                <span className={s.warmTrack} aria-hidden="true"><i style={{ width: `${Math.max(0.6, warmth * 100)}%` }} /></span>
              </div>
            ) : (
              <div title="What one more living cell would earn each generation at today's feed, before its colony's reach cap">
                <dt>A new cell would earn, per generation</dt>
                <dd className="num">{ready ? petri(perCell, 4) : skel}</dd>
              </div>
            )}
            <div><dt>PETRI still in the agar</dt><dd className="num">{ready ? petri(d.agar) : skel}</dd></div>
            <div><dt>Next generation in</dt><dd className="num">{ready ? `${secs}s` : skel}</dd></div>
          </dl>
          <p className={s.cue}>
            <span className={s.cueText} aria-hidden="true">Scroll to pull back</span>
            <button
              type="button"
              className={s.skip}
              onClick={() => {
                const el = scene.current;
                if (el) window.scrollTo({ top: el.offsetTop + el.offsetHeight - 68, behavior: "smooth" });
              }}
            >
              Skip the zoom
            </button>
          </p>
        </section>

        <aside ref={(n) => { layers.current[1] = n; }} className={s.caption} style={{ opacity: 0, visibility: "hidden" }}>
          <p className={s.capKicker}>One cell</p>
          <p className={s.capText}>
            Each glossy bead is one cell. It lives or dies by Conway&rsquo;s rules, and while it lives it earns PETRI for
            whoever owns it, up to that colony&rsquo;s reach (the house strains&rsquo; cells earn nothing).
            {lead ? (
              <>
                {" "}Right now <span className={s.name}><i className="swatch" style={{ background: hex(lead.color) }} />{lead.name}</span> owns{" "}
                {int(lead.live)} of them.
              </>
            ) : null}
          </p>
        </aside>

        <aside ref={(n) => { layers.current[2] = n; }} className={`${s.caption} ${s.capEnd}`} style={{ opacity: 0, visibility: "hidden" }}>
          <p className={s.capKicker}>One dish</p>
          <p className={s.capText}>
            Pull back and it is all one plate: {w} by {h} cells, wrapping at every edge, {ready ? int(d.totalLive) : "—"} cells across{" "}
            {alive.length} colonies and {ready ? petri(supply) : "—"} PETRI in existence. It changes shape every fifteen
            seconds, for everyone at once.
          </p>
          <Link className="btn btn-amber" href="/dish">Open the dish</Link>
        </aside>

        <div className={s.loupe} ref={(n) => { layers.current[3] = n; }}>
          <Loupe target={lens} width={w} height={h} cells={d.cells} prevCells={d.prevCells} changedAt={d.changedAt} palette={palette} className={s.loupeLens} />
          <p>The whole dish. The frame shows where you are looking.</p>
        </div>
      </div>
    </div>
  );
}
