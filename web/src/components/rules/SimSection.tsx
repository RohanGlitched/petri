import { SimSixty } from "@/components/charts/SimSixty";

/** The 60-day supply simulation (sim/out-60d) on the rules page. */
export function SimSection() {
  return (
    <section id="sixty" data-section="Sixty days, simulated" className="band band-2" aria-labelledby="sixty-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="sixty-title" className="h2">What these rules do over sixty days</h2>
          <p className="lede">
            Before picking the parameters we ran them: sixty days on the mainnet rules under five scenarios, five seeds each, every generation
            stepped with petri-core. Supply only falls, the agar never runs dry, and no attempt to own the dish came out ahead.
          </p>
        </div>
        <SimSixty compact />
      </div>
    </section>
  );
}
