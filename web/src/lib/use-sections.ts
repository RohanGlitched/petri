"use client";

import { useEffect, useState } from "react";

export type Section = { id: string; title: string };

/** A page declares its sections in markup: any element with an `id` and `data-section` (its short name; empty means
 * "use my first heading"). The list is read once the page has painted and again only when main's children change,
 * debounced, so a page that renders its sections after a fetch (a specimen, say) still gets them. */
export function useSections(root: string, path: string): Section[] {
  const [list, setList] = useState<Section[]>([]);
  useEffect(() => {
    const host = document.querySelector(root);
    if (!host) return setList([]);
    let sig = "";
    const scan = () => {
      const found = Array.from(host.querySelectorAll<HTMLElement>("[data-section][id]")).map((el) => ({
        id: el.id,
        title: el.dataset.section || (el.querySelector("h1, h2")?.textContent ?? el.id).trim(),
      }));
      const next = found.map((s) => s.id + "\u0000" + s.title).join("\u0001");
      if (next !== sig) {
        sig = next;
        setList(found);
      }
    };
    let t = 0;
    const later = () => {
      clearTimeout(t);
      t = window.setTimeout(scan, 250);
    };
    // After first paint, when the browser is idle (Safari has no requestIdleCallback, so a short timer there).
    const ric = typeof window.requestIdleCallback === "function";
    const idle = ric ? window.requestIdleCallback(scan, { timeout: 600 }) : globalThis.setTimeout(scan, 200);
    const mo = new MutationObserver(later);
    mo.observe(host, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      clearTimeout(t);
      if (ric) window.cancelIdleCallback(idle as number);
      else clearTimeout(idle);
    };
  }, [root, path]);
  return list;
}

/** Which section the reader is in: the one crossing a thin line 40% down the viewport. Only an IntersectionObserver,
 * so nothing is measured while scrolling. Between sections (a gap with no marker) the last one stays current. */
export function useActiveSection(list: Section[]): number {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (list.length === 0) return;
    const els = list.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    const on = new Set<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) e.isIntersecting ? on.add(e.target) : on.delete(e.target);
        // The last one in page order wins, so a section nested in another (the keeper's card in the strains' list)
        // takes over from its parent.
        let i = -1;
        els.forEach((el, k) => on.has(el) && (i = k));
        if (i >= 0) setActive(i);
      },
      { rootMargin: "-40% 0px -59% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [list]);
  return Math.min(active, Math.max(0, list.length - 1));
}

/** True once the reader is about a screen down. A passive scroll listener that reads only scrollY, once a frame, and
 * re-renders only when the answer flips. */
export function useScrolledPast(fraction = 0.9): boolean {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let raf = 0;
    let last = false;
    const check = () => {
      raf = 0;
      const now = window.scrollY > window.innerHeight * fraction;
      if (now !== last) setPast((last = now));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [fraction]);
  return past;
}

/** Smooth, unless the reader asked for less motion; then instant (the site sets `scroll-behavior: smooth` on html, so
 * "auto" would still animate). */
export function scrollToY(top: number) {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: Math.max(0, top), behavior: still ? "instant" : "smooth" });
}

/** Scroll a section under the sticky bar and move focus into it, so the next Tab continues from there. */
export function goToSection(id: string, offset: number) {
  const el = document.getElementById(id);
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  scrollToY(top);
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}
