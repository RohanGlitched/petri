import Link from "next/link";
import { REPO } from "@/lib/config";
import { CLAUDE_MODEL, NEARAI_MODEL } from "@/lib/strains";
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
    body: "In the simulator (sim/out-v5, run with 10% tides) a player planting one R-pentomino an hour was the only kind ahead in cash at 15 and 150 players: +0.02 and +0.14 NEAR median after a week, while builders, raiders and defenders lost 0.15 to 0.27. With 5% tides, as launched, the fix experiment put it at +0.29 at 150 players.",
  },
  {
    key: "PETRI is paper until it is sold back",
    title: "PETRI is paper until it is sold back",
    body: "The agar buys back at half the curve's price, never more than the units' share of the vault, at most 10% of the vault between tides, and nothing before the first tide. That price holds for one seller at a time: all holders together could not exit at it.",
  },
  {
    key: "A carpet locker can still earn at scale",
    title: "A carpet locker can still earn at scale",
    body: "Sieges keep the dish open, but a 1.5-NEAR lattice of blocks lost at 15 and 150 simulated players (−0.89 and −0.58 NEAR median) and won +0.59 at 1,500, with 10% tides. With 5% tides, as launched, the fix experiment put it at −1.21 and −0.45 NEAR at 150 and 1,500 players.",
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
    body: "The five strains are run by the team and buy every PETRI they plant with. They are never fed and win no tides, so what they pay in, about 1.1 NEAR a strain a week in the simulator, goes to the other players. On mainnet that is the team's real NEAR; on testnet it is sponsored credit.",
  },
  {
    key: "Somebody has to advance it",
    title: "Somebody has to advance it",
    body: "The stored board moves only when a transaction touches it. Each call catches up at most 120 generations and stops at 180 TGas; plantings are refused until the dish is current. Feed and tides for missed generations are worked out late, but a dish left alone for more than 480 generations skips the quiet stretch, and nothing is fed for the skipped generations.",
  },
  {
    key: "Races for the pot and the bounty",
    title: "Races for the pot and the bounty",
    body: "The keeper pot goes to whoever advances first, and a tide's bounty to whoever's call runs it. A simulated racer that only did that lost 0.05 to 0.06 NEAR a week after gas; the bounty is capped at 0.001 NEAR a tide.",
  },
  {
    key: "The simulator is a model",
    title: "The simulator is a model",
    body: "It estimates storage and gas instead of measuring them, and its players follow fixed habits. Its main runs predate three launched changes: they paid 10% tides (now 5%), paid guests' shares in NEAR their accounts could not move (now credit), and ran tides with nobody to pay (now skipped).",
  },
  {
    key: "The strains need a model to answer",
    title: "The strains need a model to answer",
    body: `Code proposes legal moves and a model picks one and writes the note. Petri is integrated with both Claude Haiku (${CLAUDE_MODEL}, within a fixed dollar budget) and NEAR AI Cloud (${NEARAI_MODEL}, used when Claude does not answer and NEAR AI has credits). When neither answers, the strains take their first proposal, and every move in the public log says which decided it.`,
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
