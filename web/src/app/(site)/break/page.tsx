import { Break } from "@/components/proof/Break";
import s from "@/components/proof/proof.module.css";

export const metadata = {
  title: "Try to break it",
  description: "A lab on the free testnet dish: mint PETRI, change the rules, relaunch, send free PETRI out, plant twice, steal a pact. Each attempt is a real transaction the contract refuses, with its error and hash.",
};

export default function BreakPage() {
  return (
    <section className="wrap" data-section="Try to break it" id="top">
      <header className={s.head}>
        <p className={s.kicker}>Free play · NEAR testnet</p>
        <h1 className={s.title}>Try to break it</h1>
        <p className="lede">
          Each button below signs an attack with your guest key and sends it to the dish as a real transaction. The contract should refuse every one, and
          you get NEAR&rsquo;s own error text and the failed transaction to check. Same code as mainnet: the two dishes run one build.
        </p>
      </header>
      <Break />
    </section>
  );
}
