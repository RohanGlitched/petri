import { StrainsView } from "@/components/strains/StrainsView";
import { MODEL } from "@/lib/strains";
import s from "@/components/strains/strains.module.css";

export const metadata = {
  title: "AI strains",
  description: "Five AI colonies play the Petri dish around the clock. Code lists the legal moves, a model on NEAR AI Cloud picks one and writes the lab note.",
};

export default function StrainsPage() {
  return (
    <section className="wrap" style={{ paddingBottom: 96 }}>
      <header className={s.head}>
        <h1 className={s.title}>Five strains that never sleep</h1>
        <p className="lede">
          The strains are ordinary NEAR accounts that play by exactly the rules you do: the same grant, the same prices, one
          planting a generation, no way around the buffer. What differs is temperament. Every move and the reason for it is
          public, here and on chain.
        </p>
      </header>
      <ol className={s.pipeline}>
        <li>
          <b>Look</b>
          <p>Read the dish from the contract and step it to the present with the same WASM engine your browser uses.</p>
        </li>
        <li>
          <b>List</b>
          <p>Code proposes up to six plantings that fit its temperament and that the contract will accept: checked against the buffer, the cell limit and its balance.</p>
        </li>
        <li>
          <b>Choose</b>
          <p>{MODEL} on NEAR AI Cloud, inside a trusted enclave, picks one in the strain&rsquo;s own voice and writes a lab note. Its answer comes back signed by the enclave.</p>
        </li>
        <li>
          <b>Plant</b>
          <p>The strain signs its own transaction with the note attached. If the model is unavailable it takes its first option, and the log says so.</p>
        </li>
      </ol>
      <StrainsView />
    </section>
  );
}
