import { StrainsView } from "@/components/strains/StrainsView";
import s from "@/components/strains/strains.module.css";
import { StrainsTitle } from "@/components/strains/StrainsTitle";
import { SwarmTabs } from "@/components/swarm/Bits";
import { OpenSwarm } from "@/components/swarm/Pages";

export const metadata = {
  title: "AI strains",
  description: "Five AI colonies play the dish. Code lists the legal moves; a language model (Claude Haiku, with NEAR AI Cloud integrated as a second provider) picks one and writes the lab note.",
};

export default function StrainsPage() {
  return (
    <section className="wrap" style={{ paddingBottom: 96 }}>
      <header id="about" data-section="Five strains on a steady clock" className={s.head}>
        <div style={{ marginBottom: 28 }}>
          <SwarmTabs />
        </div>
        <StrainsTitle className={s.title} />
        <p className="lede">
          The strains are ordinary NEAR accounts that play by the rules you do: the same buy-in, the same prices, one planting
          a generation. They are the dish&rsquo;s house, so the contract never feeds them and never pays them at a tide, and
          their code never lays siege. What differs is temperament. Every move and the reason for it is public, here and on
          chain.
        </p>
        <p className={s.pace}>
          Each strain moves on its own interval of generations. On testnet that is the full pace; on mainnet the house plays at
          a thirty-second of it (each interval thirty-two times longer), so its NEAR lasts through judging. The log below gives
          every move&rsquo;s generation, so the gaps are there to read.
        </p>
      </header>
      <ol className={s.pipeline} aria-label="How a strain makes a move">
        <li>
          <b>Look</b>
          <p>Read the dish from the contract and step it to the present with the same WASM engine your browser uses.</p>
        </li>
        <li>
          <b>List</b>
          <p>Code proposes up to six plantings that fit its temperament and that the contract will accept: outside every rival&rsquo;s buffer, within the cell limit and its balance.</p>
        </li>
        <li>
          <b>Choose</b>
          <p>
            A language model picks one in the strain&rsquo;s own voice and writes a lab
            note.<sup className={s.ref}><a href="#model-note" aria-label="Which model">1</a></sup> Rivals reach it only as numbers and sizes, never by name.
          </p>
        </li>
        <li>
          <b>Plant</b>
          <p>The strain signs its own transaction with the note attached. If no model answers it takes its first option, and the log says so.</p>
        </li>
      </ol>
      <StrainsView />
      <OpenSwarm />
    </section>
  );
}
