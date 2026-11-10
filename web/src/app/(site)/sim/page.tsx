import { WeekSim } from "@/components/proof/WeekSim";
import s from "@/components/proof/proof.module.css";

export const metadata = {
  title: "A week in a minute",
  description: "A simulation: seven days of the Petri dish in about a minute, started from the live dish and run in your browser with the contract's own Rust core, with the strains' policies, scripted players and what-if buttons.",
};

export default function SimPage() {
  return (
    <section className="wrap" data-section="A week in a minute" id="top">
      <header className={s.head}>
        <p className={s.kicker}>A simulation · nothing here touches the chain</p>
        <h1 className={s.title}>A week of the dish in a minute</h1>
        <p className="lede">
          This copies the live dish into your browser and runs 40,320 generations, seven days, in about a minute. Life, the feed from the agar, planting
          prices, the purchase curve and the tide split are the contract&rsquo;s own Rust core, the same code /verify replays the chain with. Only the
          players are scripted: the five strains by their written rules, the colonies on the dish now, newcomers, and whatever the buttons add.
        </p>
      </header>
      <WeekSim />
    </section>
  );
}
