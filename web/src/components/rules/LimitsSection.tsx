import Link from "next/link";
import { REPO } from "@/lib/config";
import { CLAUDE_MODEL, NEARAI_MODEL } from "@/lib/strains";
import { ContractLink, CtaLine, NetLimitBody, NetLimitTitle } from "./NetCopy";
import s from "./rules.module.css";
import { PhoneFold } from "./PhoneFold";

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
        No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board. The one way to start over,{" "}
        <code className={s.code}>relaunch</code>, is private (only the contract account itself can call it), clears a v6.3 dish
        and refuses an account with no v6.3 dish and one that already runs v6.4. <ContractLink /> has one full-access key, held by the team so a bug can be fixed; it could deploy other
        code, move the contract&rsquo;s NEAR or relaunch. The verifiers check the code hash and solvency on every run, and the terminal one says whether the key has signed anything since the v6.4 setup.
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
    key: "Large licensed patterns earn royalties, by design",
    title: "Large licensed patterns earn royalties, by design",
    body: "A slide is a licence only from 12 captured cells, which stops the small common patterns, but whoever mints the first slide of a large pattern others plant (the pulsar, 48 cells; the Gosper gun, 36) collects 10% of every licensed planting of it: in the v6.1 simulator +0.11 NEAR a week at 150 players, down from +0.29. Only planters that choose the licence pay it, and they still come out ahead of planting without it (whales −1.97 with the farmer, −2.01 with none, −2.05 with no licence at all); the vault's totals hardly move with the royalty. The launch rules keep 12; 49 or no royalty would make the farmer lose about 0.16.",
  },
  {
    key: "A full hot table makes newcomers wait",
    title: "A full hot table makes newcomers wait",
    body: "At most 10,000 colonies can play at once. Past that, a colony with no row in the hot table cannot plant until the next tide pays rows out; the simulator's busiest 30,000-colony dish never passed 2,390. Filling the table would take about 10,000 earning plantings an hour, roughly 50 NEAR an hour.",
  },
  {
    key: "The house is a subsidy",
    title: "The house is a subsidy",
    body: "The five strains are run by the team and buy every PETRI they plant with. They are never fed, win no tides, never sell PETRI back, can send PETRI only to other house accounts, and take no tide bounty or keeper pot, so what they pay in, about 1.1 NEAR a strain a week in the simulator, goes to the other players. On mainnet that is the team's real NEAR; on testnet it is sponsored credit.",
  },
  {
    key: "Somebody has to advance it",
    title: "Somebody has to advance it",
    body: "The stored board moves only when a transaction touches it. Each call catches up at most 120 generations and stops at 110 TGas less what is still to be written; plantings are refused until the dish is current. Feed and tides for missed generations are worked out late, but a dish left alone for more than 480 generations skips the quiet stretch, and nothing is fed for the skipped generations.",
  },
  {
    key: "Races for the pot and the bounty",
    title: "Races for the pot and the bounty",
    body: "The keeper pot goes to whoever's call first runs a generation, and a tide's bounty to whoever's call runs it, unless that caller is a house account or a keeper: then the pot waits for the next caller and the bounty stays in the vault. A simulated racer that only advanced lost 0.05 to 0.06 NEAR a week after gas in the v5 runs and 0.0055 in the v6.1 runs, where every call that runs a generation shares the pot; the bounty is capped at 0.001 NEAR a tide.",
  },
  {
    key: "The simulator is a model",
    title: "The simulator is a model",
    body: "It estimates storage and gas instead of measuring them, and its players follow fixed habits. Its main runs predate three launched changes: they paid 10% tides (now 5%), paid guests' shares in NEAR their accounts could not move (now credit), and ran tides with nobody to pay (now skipped). They also predate v6, in which a keeper takes no pot and no bounty, and v6.1, which the simulator was rerun on (sim/out-v6.1).",
  },
  {
    key: "Gas at scale is measured in a unit test",
    title: "Gas at scale is measured in a unit test",
    body: "Each colony's numbers live in cold pages of 32 colonies and a hot table of the colonies that play now (at most 10,000), so a join costs the same however many colonies came before, and a catch-up costs what the playing colonies cost. The contract's gas tests scale the unit runtime's host calls to the real price per byte and add an estimate of the wasm, which the unit runtime does not charge: with 30,000 colonies, 1,500 of them playing, the largest call is 67.5 TGas; with a full table, 9,999 playing, 125.7, under the 150 TGas they assert and the 300 one transaction can buy. In the simulator's 30,000-colony dish no call passed 60 TGas.",
  },
  {
    key: "Views come in pages",
    title: "Views come in pages",
    body: "earnings and tide_winnings return at most 500 colonies a call, stakes 2,000, colonies and slides 500, the ledger 1,000 entries, and nft_tokens and nft_tokens_for_owner 10 slides, each drawn as an SVG. A reader pages through with from and limit.",
  },
  {
    key: "The strains need a model to answer",
    title: "The strains need a model to answer",
    body: `Code proposes legal moves and forecasts them 240 generations ahead on a copy of the dish (as many as a two-second budget allows); a model picks one and writes the note, and at the council each tide window it offers and answers the house's pacts, which the contract enforces. Petri is integrated with both Claude Haiku (${CLAUDE_MODEL}, within a fixed dollar budget) and NEAR AI Cloud (${NEARAI_MODEL}, used when Claude does not answer and NEAR AI has credits). When neither answers, the strains take their first proposal, and every move in the public log says which decided it.`,
  },
  {
    key: "Small rounding",
    title: "Small rounding",
    body: "Feed shares round down to a millionth of a PETRI and tide shares to a yoctoNEAR. The remainders stay in the agar and the vault.",
  },
];

export function LimitsSection() {
  return (
    <section id="limits" data-section="Known limits" className={`band band-2 ${s.section}`} aria-labelledby="limits-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="limits-title" className={s.h2}>Known limits</h2>
          <p className="lede">
            Where the design is weaker than it looks, or where you are trusting something other than the code. The full
            specification is in <a className={s.link} href={`${REPO}/blob/main/RULES.md`}>RULES.md</a>.
          </p>
        </div>
        <PhoneFold label="Every known limit, one by one">
          <dl className={s.limitsList}>
            {LIMITS.map((l) => (
              <div key={l.key}>
                <dt>{l.title}</dt>
                <dd>{l.body}</dd>
              </div>
            ))}
          </dl>
        </PhoneFold>
      </div>
    </section>
  );
}

export function RulesCta() {
  return (
    <section id="plant" data-section="Now plant something" className="band" aria-labelledby="rules-cta-title">
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
