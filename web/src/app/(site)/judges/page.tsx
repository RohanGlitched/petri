import Link from "next/link";
import { Claims } from "@/components/proof/Claims";
import { Feed } from "@/components/proof/Feed";
import { Mechanics } from "@/components/proof/Mechanics";
import { TRACKS } from "@/lib/tracks";
import s from "@/components/proof/proof.module.css";

export const metadata = {
  title: "Judge desk",
  description: "Every claim Petri makes, checked live in your browser against both NEAR dishes; each track prompt's requirements and where Petri meets them; the latest on-chain moves; and one button per mechanic that sends a real transaction.",
};

const STATUS = { met: { cls: s.pass, text: "met" }, partly: { cls: s.warn, text: "partly" }, no: { cls: s.fail, text: "not met" } } as const;

export default function JudgesPage() {
  return (
    <>
      <section className="wrap" data-section="Judge desk" id="top">
        <header className={s.head}>
          <p className={s.kicker}>For judges and screeners</p>
          <h1 className={s.title}>The judge desk</h1>
          <p className="lede">
            Every claim we make, checked now in your browser against both dishes: petri-dish.near on mainnet and petri-v6.testnet. Nothing in the table
            below is typed in by hand; each row reads NEAR RPC, the strains&rsquo; public log or a full replay of the ledger, and links the code, the
            test and the transactions behind it.
          </p>
          <nav className={s.jump} aria-label="On this page">
            <a href="#claims">Live claims</a>
            <a href="#tracks">Each track&rsquo;s prompt</a>
            <a href="#feed">Trade feed</a>
            <a href="#mechanics">One button per mechanic</a>
            <Link href="/coin">Mint and burn log</Link>
            <Link href="/break">Try to break it</Link>
            <Link href="/sim">A week in a minute</Link>
            <Link href="/verify">Replay from genesis</Link>
          </nav>
        </header>
      </section>

      <section className="wrap" data-section="Live claims" id="claims">
        <div className={s.sect} style={{ paddingTop: 24 }}>
          <div className={s.sectHead}>
            <h2 className="h2">Live claims</h2>
            <p>Green holds on chain now; amber is disclosed or holds on one dish only; red would be a failure. The replay rows download each dish&rsquo;s whole ledger and replay it from generation zero in this browser, so they finish last.</p>
          </div>
          <Claims />
        </div>
      </section>

      <section className="wrap" data-section="Each track's prompt" id="tracks">
        <div className={s.sect}>
          <div className={s.sectHead}>
            <h2 className="h2">Each track&rsquo;s prompt, line by line</h2>
            <p>The requirements each prompt lists, where Petri meets them, and where it does not.</p>
          </div>
          <div className={s.tracks}>
            {TRACKS.map((t) => (
              <div key={t.id} className={s.track} id={`track-${t.id}`}>
                <h3 className="h3">{t.name}</h3>
                <p>{t.prompt}</p>
                <ul className={s.reqs}>
                  {t.reqs.map((r) => (
                    <li key={r.need} className={s.req}>
                      <span>{r.need}</span>
                      <span>
                        {r.where}{" "}
                        {r.links.map((l, i) => (
                          <span key={l.href + l.label}>
                            {i > 0 ? " · " : ""}
                            <a href={l.href}>{l.label}</a>
                          </span>
                        ))}
                      </span>
                      <span className={`${s.pill} ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="wrap" data-section="Trade feed" id="feed">
        <div className={s.sect}>
          <div className={s.sectHead}>
            <h2 className="h2">Trade feed</h2>
            <p>The latest calls to each dish from NearBlocks, labelled by who made them: the five house strains and their keeper, the team&rsquo;s three bench accounts, or outside players.</p>
          </div>
          <Feed />
        </div>
      </section>

      <section className="wrap" data-section="One button per mechanic" id="mechanics">
        <div className={s.sect}>
          <div className={s.sectHead}>
            <h2 className="h2">One button per mechanic</h2>
            <p>Each button sends a real transaction on the free testnet dish from a guest colony in this browser, relayed for free, and shows its hash.</p>
          </div>
          <Mechanics />
        </div>
      </section>
    </>
  );
}
