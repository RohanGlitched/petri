import Link from "next/link";
import { FeaturedSlide, Gallery } from "@/components/specimens/Gallery";
import { DishName } from "@/components/site/DishName";
import { SlideRules, CollectionLink } from "@/components/specimens/Bits";
import { LivingStrip } from "@/components/specimens/LivingStrip";
import s from "@/components/specimens/specimens.module.css";

export const metadata = {
  title: "Specimens",
  description: "Fossils of a living coin: colonies fix patches of their own living cells onto slides, minted by the Petri Dish contract as NEP-171 tokens with on-chain pictures, provable by replaying the dish.",
};

export default function SpecimensPage() {
  return (
    <>
      <section id="slides" data-section="The slide box" className="wrap">
        <header className={s.head}>
          <div>
            <h1 className={s.title}>Fossils of a living coin</h1>
            <p className="lede">
              Every cell on the dish dies sooner or later. A specimen keeps one moment of it: a colony frames a patch of its own
              living cells, up to 32 by 32, and the contract fixes them onto a slide at that generation, burns PETRI for each
              cell and mints the slide to the colony&rsquo;s account as a NEAR token. The contract draws the picture itself and
              records the slide in its ledger, so anyone who replays the dish can check those cells were really alive.
            </p>
            <div className={s.headActions}>
              <Link className="btn btn-amber" href="/dish?tool=fossil">Make a specimen</Link>
              <a className="btn btn-ghost" href="#proof">How a slide is proved</a>
            </div>
          </div>
          <FeaturedSlide />
        </header>
        <LivingStrip />
        <h2 className="sr">The slide box</h2>
        <Gallery />
      </section>

      <section id="make" data-section="How a cell becomes a specimen" className="band band-paper" aria-labelledby="make-title" style={{ marginTop: 96 }}>
        <div className="wrap">
          <div className="section-head">
            <h2 id="make-title" className="h2">How a living cell becomes a specimen</h2>
            <p className="lede">
              One transaction, four things in order. The preview while you frame is drawn by this site; the slide itself, its
              cells, its price and its picture, comes from the contract.
            </p>
          </div>
          <ol className={s.steps}>
            <li>
              <b>Frame</b>
              <p>On the dish, open Fossilize and drag a frame across your own colony: 4 to 32 cells a side, wrapping at the edges as the dish does. The preview shows what would be kept.</p>
            </li>
            <li>
              <b>Capture</b>
              <p>The contract reads the board at the generation your transaction lands in and keeps only your colony&rsquo;s living cells inside the frame. Rivals and bare agar stay out. <SlideRules part="min" /></p>
            </li>
            <li>
              <b>Burn</b>
              <p><SlideRules part="price" /> The token&rsquo;s storage is paid in NEAR; on free play it comes out of a guest&rsquo;s sponsored credit.</p>
            </li>
            <li>
              <b>Mint</b>
              <p>The slide becomes a NEP-171 token owned by the colony&rsquo;s account, its picture an SVG inside the token&rsquo;s own metadata. It can be kept, sent, or replanted as a pattern.</p>
            </li>
          </ol>
        </div>
      </section>

      <section id="proof" data-section="A picture anyone can check" className="band" aria-labelledby="proof-title">
        <div className="wrap">
          <div className={s.split}>
            <div className={s.proofText}>
              <h2 id="proof-title" className="h2">A picture anyone can check</h2>
              <p>
                The contract writes every slide into the dish&rsquo;s one ordered ledger: the generation, the colony, the frame and the
                cells it captured. The replay on the verify page rebuilds the whole board from generation zero with the same Rust code
                the contract runs. When it reaches a slide, it checks that every cell on it was alive on the rebuilt board and owned
                by that colony, and that the PETRI burned matches the rules.
              </p>
              <p>A slide of cells that never lived, or that belonged to someone else, would make the replay fail.</p>
              <p><Link className="btn btn-amber btn-small" href="/verify">Replay the dish</Link></p>
            </div>
            <div>
              <h3 className="h3">What a specimen does not say</h3>
              <ul className={s.limits}>
                <li>It shows one generation. The dish moves on; the colony on the slide may have died since.</li>
                <li>The replay checks how a slide was made. Who holds it now is an ordinary NEP-171 fact the contract reports.</li>
                <li>Replanting a slide&rsquo;s pattern is an ordinary planting at the normal price. Holding the slide gives no discount and no claim on the spot.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="token" data-section="An ordinary NEAR token" className="band band-2" aria-labelledby="std-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="std-title" className="h2">An ordinary NEAR token</h2>
            <p className="lede">
              Specimens live in <DishName chain />, the dish contract itself, which implements the NEAR token standards. Any wallet
              or explorer that reads NEP-171 shows them; there is no separate collection contract and no file server.
            </p>
          </div>
          <ul className={s.std}>
            <li>
              <b>NEP-171</b>
              <p>The core: <code>nft_token</code> for one slide, <code>nft_transfer</code> and <code>nft_transfer_call</code> to send it.</p>
            </li>
            <li>
              <b>NEP-177</b>
              <p>Metadata: the title, and as media a <code>data:image/svg+xml</code> picture the contract wrote. No IPFS link that can rot.</p>
            </li>
            <li>
              <b>NEP-181</b>
              <p>Enumeration: <code>nft_tokens</code>, <code>nft_tokens_for_owner</code> and <code>nft_total_supply</code>, to list them.</p>
            </li>
            <li>
              <b>Explorer</b>
              <p><CollectionLink /></p>
            </li>
          </ul>
          <p style={{ marginTop: 40 }}>
            <Link className="btn btn-amber" href="/dish?tool=fossil">Frame a patch of your colony</Link>
          </p>
        </div>
      </section>
    </>
  );
}
