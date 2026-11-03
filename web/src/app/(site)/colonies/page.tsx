import Link from "next/link";
import { Ledger } from "@/components/colonies/Ledger";
import s from "@/components/colonies/ledger.module.css";

export const metadata = {
  title: "Colonies",
  description: "Every colony on the Petri dish: living cells, share of the dish, PETRI earned and spent, and where on the dish each one lives.",
};

export default function ColoniesPage() {
  return (
    <section className="wrap" style={{ paddingBottom: 96 }}>
      <header className={s.head}>
        <h1 className={s.title}>Who is alive on the dish</h1>
        <p className="lede">
          Every colony is a NEAR account. Its income is the share of the agar its living cells earn each generation; its cost
          is what it paid to plant them. The small maps show where each colony&rsquo;s cells are right now. Numbers update with
          every generation. <Link href="/dish" style={{ color: "var(--amber)" }}>Join them</Link>.
        </p>
      </header>
      <Ledger />
    </section>
  );
}
