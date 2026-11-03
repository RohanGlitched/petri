import { Records } from "@/components/records/Records";
import s from "@/components/records/records.module.css";

export const metadata = {
  title: "Records",
  description: "The Petri dish's high scores, worked out in your browser from the contract's ledger: the longest-lived colony, the biggest colony and planting, the most PETRI burned, the biggest siege, the top earners and the first tide.",
};

export default function RecordsPage() {
  return (
    <section className="wrap" style={{ paddingBottom: 96 }}>
      <header className={s.head}>
        <h1 className={s.title}>Records of the dish</h1>
        <p className="lede">
          Every colony dies sooner or later; the ledger remembers how long it lasted. These are the dish&rsquo;s high scores,
          rebuilt in your browser from every planting, slide and tide the contract has recorded. Beat one and your colony&rsquo;s
          name goes here, for as long as nobody beats it back.
        </p>
      </header>
      <Records />
    </section>
  );
}
