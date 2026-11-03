import Link from "next/link";
import { REPO } from "@/lib/config";
import { MODEL } from "@/lib/strains";
import { ContractLink, CtaLine, NetLimitBody, NetLimitTitle } from "./NetCopy";
import s from "./rules.module.css";

const LIMITS: { key: string; title: React.ReactNode; body: React.ReactNode }[] = [
  {
    key: "network",
    title: <NetLimitTitle />,
    body: <NetLimitBody />,
  },
  {
    key: "The lock is a plan until the key is gone",
    title: "The lock is a plan until the key is gone",
    body: (
      <>
        No method changes a parameter, mints PETRI or edits the board, but{" "}
        <ContractLink /> still has one full-access key that could deploy other
        code. The team will delete it before judging; until then the full-access check fails on /verify and in the terminal.
      </>
    ),
  },
  {
    key: "The methuselah edge",
    title: "The methuselah edge",
    body: "In the simulator one R-pentomino planter ended +9.51 NEAR (median) in a 15-player society and +1.82 at 150 players, far ahead of everyone. Nearly all of it was PETRI valued at the sell-back price, not NEAR in hand.",
  },
  {
    key: "PETRI is paper until it is sold back",
    title: "PETRI is paper until it is sold back",
    body: "The agar buys back at half the curve's price, never more than the units' share of the vault, and at most 10% of the vault between tides. In the simulator players ended holding PETRI worth 13 to 22 NEAR at that price against under 0.06 NEAR in the vault.",
  },
  {
    key: "A carpet locker still earns",
    title: "A carpet locker still earns",
    body: "Sieges keep the dish open, but a 1.5-NEAR lattice of blocks still won NEAR at the tides in the simulator: +0.86 NEAR in a 15-player society and +0.14 at 150 with the launched tide, bounty and house rules.",
  },
  {
    key: "Early colonies have an edge",
    title: "Early colonies have an edge",
    body: "The agar is fullest at the start, so the first colonies are fed the most PETRI, and PETRI is cheapest in NEAR while the agar is full. On a sparse dish the agar releases only part of its ration, which narrows but does not remove the edge.",
  },
  {
    key: "Ordering within a generation",
    title: "Ordering within a generation",
    body: "Entries in the same generation apply in the order the chain executes them. An earlier planting can fill a cell a later one wanted, or turn it into a siege.",
  },
  {
    key: "The house is a subsidy",
    title: "The house is a subsidy",
    body: "The five strains are run by the team and buy every PETRI they plant with. They are never fed and win no tides, so the NEAR they pay in, about 0.8 to 1 NEAR a strain a week in the simulator, goes to the other players.",
  },
  {
    key: "Somebody has to advance it",
    title: "Somebody has to advance it",
    body: "The stored board moves only when a transaction touches it. Each call catches up at most 120 generations and stops at 180 TGas; plantings are refused until the dish is current. Feed and tides for missed generations are worked out late, not lost.",
  },
  {
    key: "Races for the pot and the bounty",
    title: "Races for the pot and the bounty",
    body: "The keeper pot goes to whoever advances first, and a tide's bounty to whoever's call runs it. A simulated racer that only did that made +0.07 to +0.87 NEAR after gas; the bounty is capped at 0.001 NEAR a tide.",
  },
  {
    key: "The simulator is a model",
    title: "The simulator is a model",
    body: "It estimates storage and gas instead of measuring them, no run has exactly the launched rules, it predates the rule that releases only part of the ration on a sparse dish, and its players follow fixed habits.",
  },
  {
    key: "The strains play by written rules for now",
    title: "The strains play by written rules for now",
    body: `Code proposes legal moves and a model (${MODEL} on NEAR AI Cloud) picks one and writes the note. The model currently answers 402 while credits are pending, so the strains take their first proposal, and every move in the public log says which decided it.`,
  },
  {
    key: "Small rounding",
    title: "Small rounding",
    body: "Feed shares round down to a millionth of a PETRI and tide shares to a yoctoNEAR. The remainders stay in the agar and the vault.",
  },
];

export function LimitsSection() {
  return (
    <section id="limits" className={`band band-2 ${s.section}`} aria-labelledby="limits-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="limits-title" className={s.h2}>Known limits</h2>
          <p className="lede">
            Where the design is weaker than it looks, or where you are trusting something other than the code. The full
            specification is in <a className={s.link} href={`${REPO}/blob/main/RULES.md`}>RULES.md</a>.
          </p>
        </div>
        <dl className={s.limitsList}>
          {LIMITS.map((l) => (
            <div key={l.key}>
              <dt>{l.title}</dt>
              <dd>{l.body}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

export function RulesCta() {
  return (
    <section className="band" aria-labelledby="rules-cta-title">
      <div className="wrap">
        <div className={s.cta}>
          <h2 id="rules-cta-title" className={s.h2}>Now plant something</h2>
          <p className="lede">
            <CtaLine />
          </p>
          <div className={s.ctaRow}>
            <Link className="btn btn-amber" href="/dish">Go to the dish</Link>
            <Link className="btn btn-ghost" href="/verify">Verify the dish</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
