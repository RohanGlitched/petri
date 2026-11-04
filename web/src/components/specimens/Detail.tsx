"use client";

import Link from "next/link";
import { useState } from "react";
import { accountUrl, nftUrl, shareUrl, shortAccount } from "@/lib/config";
import { useLive, hex, int, petri } from "@/lib/live";
import { slideOffsets, slideRules } from "@/lib/slides";
import { useNet } from "@/lib/use-net";
import { usePlayer } from "@/lib/wallet";
import { LAUNCH } from "@/components/rules/shared";
import { Specimen } from "@/components/site/Specimen";
import { readableReadError, SpecimenCard } from "./Gallery";
import { useSlideLicence } from "./licence";
import { SlideGlass } from "./SlideGlass";
import { SlideHistoryBand } from "./History";
import { order, pictureOf, useAllSlides, useColonyOf, useSlide } from "./data";
import s from "./specimens.module.css";

export function SpecimenDetail({ id }: { id: string }) {
  const net = useNet();
  const { rules, ready, cellPrice } = useLive();
  const player = usePlayer();
  const one = useSlide(id);
  const colonyOf = useColonyOf();
  const sl = one.data;
  const c = sl ? colonyOf(sl) : null;
  const maker = c?.account ?? null;
  const all = useAllSlides();
  const [copied, setCopied] = useState(false);
  const licence = useSlideLicence(sl ? sl.id : null, player?.accountId ?? null, sl?.owner ?? null, sl?.count ?? sl?.cells?.length ?? null);

  if (one.status === "loading")
    return (
      <section className="wrap" style={{ paddingBottom: 96 }}>
        <p className={s.crumb}><Link href="/specimens">Specimens</Link> / No. {id}</p>
        <SlideGlass src={null} size="large" id={id} placeholder="Reading the slide…" />
      </section>
    );

  if (one.status === "error" || !sl)
    return (
      <section className="wrap" style={{ paddingBottom: 96 }}>
        <p className={s.crumb}><Link href="/specimens">Specimens</Link> / No. {id}</p>
        <div className={s.state} role="status">
          <h2>{one.status === "error" ? "This slide could not be read" : `No specimen ${id} on this dish`}</h2>
          <p>
            {one.status === "error"
              ? readableReadError(one.error, net.contract, net.label.chain)
              : `${net.contract} on ${net.label.chain} has no token with id ${id}. It may live on the other dish: the switch at the top of the page changes networks.`}
          </p>
          <Link className="btn btn-ghost btn-small" href="/specimens">Back to the slide box</Link>
        </div>
      </section>
    );

  const offsets = slideOffsets(sl);
  const price = slideRules(rules).cellPrice;
  const maxCells = rules?.max_plant_cells ?? 64;
  const tooBig = !!offsets && offsets.length > maxCells;
  const title = sl.title?.trim() || "Untitled specimen";
  const others = all.data.filter((k) => k.id !== sl.id && k.colony !== null && k.colony === sl.colony).sort(order).slice(0, 6);

  return (
    <>
      <section className="wrap">
        <p className={s.crumb}><Link href="/specimens">Specimens</Link> / No. {sl.id}</p>
        <div className={s.detailTop}>
          <SlideGlass size="large" src={pictureOf(sl, c?.color)} id={sl.id} title={sl.title} colony={c} generation={sl.generation} count={sl.count} />
          <div className={s.detailHead}>
            <div>
              <h1 className={s.detailTitle}>{title}</h1>
              <p className="lede">
                {sl.count !== null ? `${int(sl.count)} living ${sl.count === 1 ? "cell" : "cells"}` : "Living cells"} of{" "}
                {c ? c.name : "a colony"}
                {sl.generation !== null ? `, fixed at generation ${int(sl.generation)}` : ""}
                {sl.rect ? ` inside a ${sl.rect.w} by ${sl.rect.h} frame at ${sl.rect.x}, ${sl.rect.y}` : ""}. Read from{" "}
                <a href={net.contractUrl} style={{ color: "var(--amber)" }}>{net.contract}</a> on {net.label.chain}.
              </p>
              <div className={s.actions}>
                {offsets && !tooBig ? (
                  <Link className="btn btn-amber" href={`/dish?replant=${encodeURIComponent(sl.id)}`}>Plant this pattern</Link>
                ) : (
                  <button className="btn btn-amber" disabled>Plant this pattern</button>
                )}
                <a className="btn btn-ghost" href={nftUrl(net.contract, sl.id, net.network)}>See it on NearBlocks</a>
                <button
                  className="btn btn-ghost"
                  onClick={() =>
                    navigator.clipboard?.writeText(shareUrl(`/specimens/${encodeURIComponent(sl.id)}`)).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1600);
                    }, () => {})
                  }
                >
                  {copied ? "Link copied" : "Copy link"}
                </button>
              </div>
              <p className={s.actionNote}>
                {!offsets
                  ? "The cells could not be read back from this slide, so it cannot be loaded as a stamp."
                  : tooBig
                    ? `This slide holds ${int(offsets.length)} cells and a planting takes at most ${maxCells}, so it cannot be replanted in one go.`
                    : licence.live
                      ? `Planting loads these ${int(offsets.length)} cells into the dish's stamp, wherever they fit, on the licence terms below.`
                      : `Planting loads these ${int(offsets.length)} cells into the dish's stamp. It is an ordinary planting at the normal price, wherever it fits; holding the slide changes nothing about that.`}
              </p>
              {offsets && !tooBig && (
                <PatternLicence
                  offsets={offsets}
                  color={c?.color ?? 0xf2b45a}
                  live={licence.live}
                  small={licence.small ? rules?.licence_min_cells ?? null : null}
                  bps={licence.royaltyBps}
                  holder={licence.holder}
                  perk={licence.perk}
                  lifetime={licence.lifetime}
                  price={ready ? cellPrice * offsets.length : null}
                  owner={sl.owner}
                />
              )}
            </div>
            <dl className={s.facts}>
              <div>
                <dt>Colony</dt>
                <dd className={s.big}>{c ? <><i className="swatch" style={{ background: hex(c.color) }} />{c.name}</> : "—"}</dd>
              </div>
              <div>
                <dt>Generation</dt>
                <dd className={`${s.big} num`}>{sl.generation !== null ? int(sl.generation) : "—"}</dd>
              </div>
              <div>
                <dt>Made by</dt>
                <dd>{maker ? <a href={accountUrl(maker)}>{shortAccount(maker, 34)}</a> : "—"}</dd>
              </div>
              <div>
                <dt>Held by</dt>
                <dd>{sl.owner ? <a href={accountUrl(sl.owner)}>{shortAccount(sl.owner, 34)}</a> : "—"}</dd>
              </div>
              <div>
                <dt>Cells on the slide</dt>
                <dd className="num">{sl.count !== null ? int(sl.count) : "—"}</dd>
              </div>
              <div>
                <dt>PETRI burned</dt>
                <dd className="num">{price !== null && sl.count !== null ? petri(Number(price) * sl.count, 4) : "—"}</dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd className="num">{sl.rect ? `${sl.rect.w} × ${sl.rect.h} at ${sl.rect.x}, ${sl.rect.y}` : "—"}</dd>
              </div>
              <div>
                <dt>Minted</dt>
                <dd>{sl.minted ? new Date(sl.minted).toLocaleString() : "—"}</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      <SlideHistoryBand id={sl.id} cells={sl.count} />

      <section className="band band-paper" aria-labelledby="sp-proof">
        <div className="wrap">
          <div className={s.split}>
            <div>
              <h2 id="sp-proof" className="h2">How you know these cells lived</h2>
              <p className="lede">
                Specimen {sl.id} is an entry in the dish&rsquo;s ledger{sl.generation !== null ? ` at generation ${int(sl.generation)}` : ""}. The picture is
                only a drawing of it; the entry is what gets checked.
              </p>
            </div>
            <div className={s.proofCard}>
              <ol>
                <li>The verify page reads the whole ledger from {net.contract} at one final block, slides included.</li>
                <li>It rebuilds the board from an empty dish with petri-core, the code the contract runs, applying every join, planting and tide in order.</li>
                <li>At this slide&rsquo;s generation it checks each cell on the slide against its rebuilt board: alive, and owned by {c?.name ?? "the colony"}. It checks the PETRI burned against the rules too.</li>
                <li>If any cell were wrong, the replay would report a mismatch.</li>
              </ol>
              <Link className="btn btn-ink btn-small" href="/verify">Replay the dish now</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="band" aria-labelledby="sp-token">
        <div className="wrap">
          <div className={s.split}>
            <div>
              <h2 id="sp-token" className="h2">The token</h2>
              <p className="lede">
                A NEP-171 token in the dish contract itself. Ask the contract for <code style={{ fontFamily: "var(--body)", color: "var(--amber-2)" }}>nft_token(&quot;{sl.id}&quot;)</code> and
                it returns the owner and the metadata, picture included. Any wallet that lists NEP-171 collectibles on {net.label.chain} shows it.
              </p>
              <p className="muted small" style={{ maxWidth: "60ch" }}>
                No marketplace is linked: we have not confirmed one that lists tokens from any NEP-171 contract on {net.label.chain}, and a link
                that shows nothing would mislead. NearBlocks shows the token, its owner and its transfers.
              </p>
            </div>
            <div>
              {others.length > 0 ? (
                <>
                  <h3 className="h3">More from {c?.name ?? "this colony"}</h3>
                  <ul className={s.siblings}>
                    {others.map((k) => (
                      <li key={k.id}>
                        <SpecimenCard sl={k} c={c} size="mini" />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <h3 className="h3">The only one of its kind, so far</h3>
                  <p className="muted">{c?.name ?? "This colony"} has made no other specimen on this dish. <Link href="/specimens" style={{ color: "var(--amber)" }}>See every specimen</Link>.</p>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** "Plant this pattern": what planting a slide's cells costs its holder and everyone else, and what the slide has earned.
 * The licence comes with the next contract version (licence.ts); until a dish has it, the block says plainly that both
 * sides pay the normal price and the slide earns nothing. */
function PatternLicence({ offsets, color, live, small, bps, holder, perk, lifetime, price, owner }: {
  offsets: [number, number][];
  color: number;
  live: boolean;
  /** `licence_min_cells`, when this slide captured fewer cells than that and is a keepsake. */
  small: number | null;
  bps: number | null;
  holder: boolean;
  perk: string | null;
  lifetime: number | null;
  price: number | null;
  owner: string | null;
}) {
  // The licence price is the same for everyone (slide_discount_bps off); the royalty is a share of that price.
  const discount = LAUNCH.slide_discount_bps ?? 0;
  const royalty = live && bps !== null && price !== null ? (((price * (10_000 - discount)) / 10_000) * bps) / 10_000 : null;
  return (
    <section className={s.licence} aria-labelledby="licence-title">
      <div className={s.licenceHead}>
        <Specimen offsets={offsets} color={hex(color)} size={44} />
        <div>
          <h2 id="licence-title">Plant this pattern</h2>
          <p>
            {int(offsets.length)} cells{price !== null ? `, ${petri(price, 2)} PETRI at today's price` : ""}.{" "}
            {live ? "The slide is a licence for its pattern." : small !== null ? `Only a slide of ${small} cells or more is a licence; this one is a keepsake.` : "Slides are not pattern licences on this dish."}
          </p>
        </div>
        <span className={`${s.licenceTag} ${live ? s.licenceLive : ""}`}>{live ? "Licence live" : "No licence"}</span>
      </div>
      <dl className={s.licenceTerms}>
        <div className={holder ? s.you : ""}>
          <dt>The holder{owner ? `, ${shortAccount(owner, 22)}` : ""}{holder ? " (you)" : ""}</dt>
          <dd>{live ? perk ?? "Plants it with the holder's perk the contract grants" : "Pays the normal price"}</dd>
        </div>
        <div className={!holder ? s.you : ""}>
          <dt>Anyone else{!holder ? " (you)" : ""}</dt>
          <dd>
            {live && bps !== null
              ? `Pays the licence price (${discount / 100}% off) plus a ${bps / 100}% royalty on it to the holder${royalty !== null ? `, about ${petri(royalty, 2)} PETRI` : ""}`
              : "Pays the normal price; no royalty"}
          </dd>
        </div>
        <div>
          <dt>Royalties this slide has earned</dt>
          <dd className="num">{live ? (lifetime !== null ? `${petri(lifetime, 2)} PETRI` : "—") : "None: no royalties on this dish"}</dd>
        </div>
      </dl>
    </section>
  );
}
