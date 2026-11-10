import { CoinLog } from "@/components/proof/CoinLog";
import { SimSixty } from "@/components/charts/SimSixty";
import { DishName } from "@/components/site/DishName";
import s from "@/components/proof/proof.module.css";

export const metadata = {
  title: "The coin",
  description: "PETRI since generation zero: every mint (the agar feeding living cells) and every burn (plantings, specimen slides), purchases, sales and tides, rebuilt in your browser from the contract's ledger, with the supply over time and a 60-day simulation of five scenarios.",
};

export default function CoinPage() {
  return (
    <>
      <section className="wrap" data-section="The coin" id="top">
        <header className={s.head}>
          <p className={s.kicker}>PETRI · NEP-141</p>
          <h1 className={s.title}>Every PETRI, from the first generation to this one</h1>
          <p className="lede">
            A fixed million PETRI start in the agar. Living cells are fed from it every generation, plantings burn half of what they cost and
            slides burn all of theirs. This page replays the whole ledger of <DishName chain /> in your browser and builds the log and the chart from
            that replay alone.
          </p>
          <nav className={s.jump} aria-label="On this page">
            <a href="#now">Supply now</a>
            <a href="#chart">Supply over time</a>
            <a href="#log">Mint and burn log</a>
            <a href="#sixty">60 days, simulated</a>
          </nav>
        </header>
        <CoinLog />
      </section>
      <section className="band band-2" data-section="60 days, simulated" id="sixty">
        <div className="wrap">
          <div className="section-head">
            <h2 className="h2">Sixty days, simulated before anyone lives them</h2>
            <p className="lede">
              Five communities on the mainnet rules, five seeds each: a boom, a steady trickle, a decline, a whale siege and the house strains alone.
              The charts are the run&rsquo;s own output, every generation stepped with the contract&rsquo;s Rust core.
            </p>
          </div>
          <SimSixty />
        </div>
      </section>
    </>
  );
}
