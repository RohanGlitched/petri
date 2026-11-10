"use client";

import Link from "next/link";
import { hex, int } from "@/lib/live";
import s from "./specimens.module.css";

export type GlassProps = {
  /** The specimen's picture: the token's own media, or a preview drawn the same way. */
  src: string | null;
  id?: string | null;
  title?: string | null;
  colony?: { name: string; color: number } | null;
  generation?: number | null;
  /** The generation it was minted in, when that differs from the one its cells were fixed at. */
  mintedGen?: number | null;
  count?: number | null;
  /** Rectangle size, so a wide or tall specimen keeps its proportions under the coverslip. */
  w?: number;
  h?: number;
  size?: "card" | "large" | "mini";
  href?: string;
  /** Shown on the label when there is no title yet, e.g. while framing. */
  placeholder?: string;
  /** The large label's ruled lines, written like a lab's own notes (frame, holder, minted): a big label is not blank. */
  lines?: string[];
};

/** A specimen mounted the way a lab keeps one: a glass slide with a frosted label at one end, the cells under a
 * coverslip at the other. */
export function SlideGlass({ src, id, title, colony, generation, mintedGen, count, w = 1, h = 1, size = "card", href, placeholder, lines }: GlassProps) {
  // Numbers in a title read like the rest of the site's ("generation 33,366"); a long one wraps within two lines.
  const label = (title?.trim() || placeholder || "Untitled specimen").replace(/\b\d{4,}\b/g, (n) => int(Number(n)));
  const body = (
    <>
      <div className={s.label}>
        <span className={`num ${s.labelNo}`}>{id != null ? `No. ${id}` : "Unmounted"}</span>
        <b className={s.labelTitle}>{label}</b>
        {size === "large" && !!lines?.length && (
          <ul className={s.labelLines}>
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        <span className={s.labelMeta}>
          {colony && (
            <span className={s.labelColony}>
              <i className="swatch" style={{ background: hex(colony.color) }} />
              {colony.name}
            </span>
          )}
          {generation != null && (
            <span className="num" title="The generation of the board the contract fixed these cells from">
              fixed at gen {int(generation)}
              {count != null && size !== "large" ? ` · ${int(count)} ${count === 1 ? "cell" : "cells"}` : ""}
            </span>
          )}
          {mintedGen != null && generation != null && mintedGen !== generation && (
            <span className="num" title="The generation the slide was minted in; the stored board can trail the dish's clock">
              minted gen {int(mintedGen)}
            </span>
          )}
          {count != null && (generation == null || size === "large") && <span className="num">{int(count)} {count === 1 ? "cell" : "cells"}</span>}
        </span>
      </div>
      <div className={s.well}>
        <div className={s.cover} style={{ aspectRatio: `${w} / ${h}` }}>
          {src ? (
            // A data: URL the contract (or the preview) drew; next/image has nothing to optimise here.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt={`${label}: ${count != null ? `${int(count)} living cells` : "living cells"}${colony ? ` of ${colony.name}` : ""}${generation != null ? ` at generation ${int(generation)}` : ""}`} />
          ) : (
            <span className={s.empty} role="img" aria-label="A blank slide" />
          )}
        </div>
      </div>
    </>
  );
  const cls = `${s.glass} ${size === "large" ? s.large : size === "mini" ? s.mini : ""}`;
  return href ? (
    <Link href={href} className={`${cls} ${s.glassLink}`} aria-label={`${label}${id != null ? `, specimen ${id}` : ""}`}>
      {body}
    </Link>
  ) : (
    <figure className={cls}>{body}</figure>
  );
}
