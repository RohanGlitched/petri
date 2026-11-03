"use client";
// Slides read from the dish contract, normalised, plus the colony each one came from.

import { useEffect, useMemo, useState } from "react";
import { getSlide, getSlides, type Colony } from "@/lib/chain";
import { useDish } from "@/lib/dish-store";
import { normalizeSlide, slideSvg, svgUrl, type Slide } from "@/lib/slides";

/** Who a slide belongs to, as the page shows it: the colony on the dish, or what the slide itself records. */
export type Maker = { id: number | null; name: string; color: number; account: string | null };

export type Loaded<T> = { status: "loading" | "ready" | "error"; data: T; error?: string };

const PAGE = 100;

// One read shared by every part of a page that shows slides, at most every 20 seconds.
let shared: { at: number; p: Promise<Slide[]> } | null = null;
function allSlides(): Promise<Slide[]> {
  if (!shared || Date.now() - shared.at > 20_000) {
    shared = { at: Date.now(), p: readAll() };
    shared.p.catch(() => (shared = null));
  }
  return shared.p;
}

async function readAll(): Promise<Slide[]> {
  const out: Slide[] = [];
  for (let from = 0; from < 5000; from += PAGE) {
    const page = (await getSlides(from, PAGE)) as unknown[];
    out.push(...page.map(normalizeSlide).filter((x): x is Slide => !!x));
    if (page.length < PAGE) break;
  }
  return out;
}

function useLoad<T>(load: () => Promise<T>, empty: T, key: string, everyMs = 30_000): Loaded<T> {
  const [st, setSt] = useState<Loaded<T>>({ status: "loading", data: empty });
  useEffect(() => {
    let live = true;
    const run = () =>
      load().then(
        (data) => live && setSt({ status: "ready", data }),
        (e) => live && setSt((x) => (x.status === "ready" ? x : { status: "error", data: empty, error: e instanceof Error ? e.message : String(e) })),
      );
    run();
    const t = everyMs ? setInterval(run, everyMs) : null;
    return () => {
      live = false;
      if (t) clearInterval(t);
    };
    // `key` stands for the loader's inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return st;
}

export const useAllSlides = () => useLoad(allSlides, [] as Slide[], "all");

export const useSlide = (id: string) =>
  useLoad(
    async () => {
      const raw = await getSlide(id);
      return raw ? normalizeSlide(raw) : null;
    },
    null as Slide | null,
    `one:${id}`,
    0,
  );

/** The colony a slide came from: the live colony by id, else the name and stain the slide records. */
export function useColonyOf() {
  const d = useDish();
  return useMemo(() => {
    const byId = new Map<number, Colony>(d.colonies.map((c) => [c.id, c]));
    return (s: Slide): Maker | null => {
      const c = s.colony !== null ? byId.get(s.colony) : undefined;
      if (c) return { id: c.id, name: c.name, color: c.color, account: c.account };
      if (s.name) return { id: s.colony, name: s.name, color: s.color ?? 0xf2b45a, account: null };
      return null;
    };
  }, [d.colonies]);
}

/** The picture to show: the contract's own media, or the same SVG drawn here from the slide's bitmap. */
export function pictureOf(s: Slide, color?: number): string | null {
  if (s.media) return s.media;
  if (s.bitmap && s.rect) return svgUrl(slideSvg(s.bitmap, s.rect.w, s.rect.h, s.color ?? color ?? 0xf2b45a, s.generation ?? 0));
  return null;
}

/** Newest first by id (ids count up as slides are minted), or by mint time when ids are not numbers. */
export function order(a: Slide, b: Slide): number {
  const na = Number(a.id);
  const nb = Number(b.id);
  if (isFinite(na) && isFinite(nb)) return nb - na;
  return (b.minted ?? 0) - (a.minted ?? 0);
}
