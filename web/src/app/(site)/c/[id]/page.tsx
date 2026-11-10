// A colony's share page: what /c/<id> unfurls to on X and elsewhere (its share card is the preview image), and what a
// visitor who follows the link lands on: the card, the facts, and the way into the live dish and its cinema.

import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { cardAge, cardPetri, colonyCard } from "@/lib/colony-card";
import type { Network } from "@/lib/config";
import { ShareActions } from "@/components/delight/ShareActions";
import s from "@/components/delight/share.module.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ net?: string }> };

const netOf = (q?: string): Network => (q === "mainnet" ? "mainnet" : "testnet");
/** This site's own address, where the engine's WASM is served. */
async function origin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "www.playpetri.xyz";
  return `${h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")}://${host.split(",")[0].trim()}`;
}
const int = (n: number) => Math.round(n).toLocaleString("en-US");
/** The account with a break opportunity after each dot, so a long guest account wraps at a dot, not mid-word. */
const breakable = (a: string) => a.split(".").flatMap((part, i) => (i ? [<wbr key={i} />, "." + part] : [part]));

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const net = netOf((await searchParams).net);
  const card = await colonyCard(net, Number(id), await origin());
  const q = net === "mainnet" ? "?net=mainnet" : "";
  const image = { url: `/api/og/colony/${id}?${card ? `g=${card.boardGeneration}&` : ""}${net === "mainnet" ? "net=mainnet" : ""}`.replace(/[?&]$/, ""), width: 1200, height: 630, alt: card ? `${card.name}, a colony on the Petri dish` : "Petri Dish" };
  const title = card ? `${card.name}, alive on the Petri dish` : "A colony on the Petri dish";
  const description = card
    ? `${int(card.live)} living cells${card.house ? "" : `, ${cardPetri(card.earned)} PETRI earned`}, joined ${int(cardAge(card))} generations ago. Conway's Life on NEAR, where every cell belongs to an account.`
    : "Conway's Life on NEAR, where every cell belongs to an account.";
  return {
    title,
    description,
    openGraph: { type: "website", title, description, url: `/c/${id}${q}`, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function ColonyShare({ params, searchParams }: Props) {
  const { id } = await params;
  const net = netOf((await searchParams).net);
  const card = await colonyCard(net, Number(id), await origin());
  const q = net === "mainnet" ? "?net=mainnet" : "";
  const amp = net === "mainnet" ? "&net=mainnet" : "";
  if (!card) {
    return (
      <section className={s.page}>
        <div className={s.copy}>
          <p className={s.kicker}>Petri Dish · NEAR {net}</p>
          <h1 className={s.title}>There is no colony {id} on this dish.</h1>
          <p className={s.lede}>It may live on the other network, or NEAR did not answer just now.</p>
          <div className={s.actions}>
            <Link className="btn btn-amber" href={`/dish${q}`}>Open the dish</Link>
            <Link className="btn btn-ghost" href="/colonies">Every colony</Link>
          </div>
        </div>
      </section>
    );
  }
  const age = cardAge(card);
  const url = `https://www.playpetri.xyz/c/${card.id}${q}`;
  return (
    <section className={s.page}>
      <div className={s.grid}>
        <figure className={s.figure}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/og/colony/${card.id}?g=${card.boardGeneration}${amp}`} width={1200} height={630} alt={`${card.name}'s share card: its living cells on the agar and its numbers`} />
          <figcaption>
            The share card, drawn from the dish at generation {int(card.boardGeneration)}: the board the contract stores, stepped forward by
            the same rules.
          </figcaption>
        </figure>
        <div className={s.copy}>
          <p className={s.kicker}>
            <i style={{ background: "#" + card.color.toString(16).padStart(6, "0") }} aria-hidden="true" />
            {card.stain ?? "A colony"} · NEAR {net}
          </p>
          <h1 className={s.title}>{card.name}</h1>
          <p className={s.lede}>
            A colony on the Petri dish, owned by <b>{breakable(card.account)}</b>. Its cells live and die by Conway&rsquo;s rules,
            a generation every fifteen seconds, and {card.house ? "as a house strain it plays without being paid." : "while they live they earn PETRI, up to what its stake reaches."}
          </p>
          <dl className={s.stats}>
            <div><dt>Living cells</dt><dd>{int(card.live)}</dd></div>
            {!card.house && <div><dt>PETRI earned</dt><dd>{cardPetri(card.earned)}</dd></div>}
            <div><dt>Age, in generations</dt><dd>{int(age)}</dd></div>
            <div><dt>Cells planted</dt><dd>{int(card.cellsPlanted)}</dd></div>
          </dl>
          <div className={s.actions}>
            <Link className="btn btn-amber" href={`/dish?cinema=1&colony=${card.id}${amp}`}>Watch it in cinema</Link>
            <Link className="btn btn-ghost" href={`/dish${q}`}>Open the dish</Link>
          </div>
          <ShareActions url={url} text={`${card.name} is alive on the Petri dish: ${int(card.live)} living cells on NEAR.`} />
        </div>
      </div>
    </section>
  );
}
