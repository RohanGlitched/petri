import Link from "next/link";
import { REPO } from "@/lib/config";
import { LOCKED } from "@/lib/facts";
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
    key: "Someone tries to change the rules",
    title: "Someone tries to change the rules",
    body: (
      <>
        No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board. The one way to start over,{" "}
        <code className={s.code}>relaunch</code>, is private (only the contract account itself can call it), clears a v6.3 dish
        and refuses an account with no v6.3 dish and one that already runs v6.4. On mainnet nobody can call it: <code className={s.code}>petri-dish.near</code> has had no access key since {LOCKED.date} (<a className={s.link} href={LOCKED.url}>DeleteKey</a>), so its code, rules and NEAR can never change. The testnet dish keeps one full-access key so a case can be reproduced and fixed there;
        any new code would change its code hash, which the verifiers check on every run along with solvency, and they print the key count.
      </>
    ),
  },
  {
    key: "A run on the vault",
    title: "A run on the vault",
    body: "The agar buys back at half the curve's price, never more than the units' share of the vault, at most 10% of the vault between tides, and nothing before the first tide, so one exit cannot drain the others.",
  },
  {
    key: "A whale or a carpet locker",
    title: "A whale or a carpet locker",
    body: "Pay is capped by stake, at most 8 living cells per cell of stake, and stake decays at every tide, so a big colony cannot simply hold ground for free, and planting inside a rival's buffer costs 3×, so a lattice of blocks cannot close the dish: a siege block is always legal. With 5% tides, as launched, the simulated 1.5-NEAR lattice locker lost at 150 and 1,500 players (−1.21 and −0.45 NEAR median), and in the 1,000-season bench no whale, split whale or locker came out ahead in NEAR.",
  },
  {
    key: "Two plantings want the same cell",
    title: "Two plantings want the same cell",
    body: "Entries in the same generation apply in the order the chain executes them: an earlier planting can fill a cell a later one wanted, or turn it into a siege.",
  },
  {
    key: "A farmer licenses a popular pattern",
    title: "A farmer licenses a popular pattern",
    body: "A slide is a licence only from 12 captured cells, which keeps the small common patterns free of royalties. Whoever mints the first slide of a large pattern others plant (the pulsar, 48 cells; the Gosper gun, 36) collects 10% of every licensed planting of it, as designed: only planters that choose the licence pay it, in the v6.1 simulator they still did better than planting without it, and the vault's totals hardly move with the royalty.",
  },
  {
    key: "A flood of colonies",
    title: "A flood of colonies",
    body: "At most 10,000 colonies play at once, so no call costs more as colonies join. Past that, a colony with no row in the hot table waits to plant until the next tide pays rows out; the simulator's busiest 30,000-colony dish never passed 2,390. Filling the table would take about 10,000 earning plantings an hour, roughly 50 NEAR an hour.",
  },
  {
    key: "The house plays by stricter rules",
    title: "The house plays by stricter rules",
    body: "The five strains are run by the team and buy every PETRI they plant with. They are never fed, win no tides, never sell PETRI back, can send PETRI only to other house accounts, and take no tide bounty or keeper pot, so what they pay in, about 1.1 NEAR a strain a week in the simulator, goes to the other players.",
  },
  {
    key: "Nobody advances the dish",
    title: "Nobody advances the dish",
    body: "Any transaction steps the stored board: each call catches up at most 120 generations and stops at 110 TGas less what is still to be written, and plantings wait until the dish is current. Feed and tides for missed generations are worked out on the next call, and a dish left alone for more than 480 generations skips the quiet stretch (nothing is fed for the skipped generations), so the next call wakes it without replaying it.",
  },
  {
    key: "Racing for the pot and the bounty",
    title: "Racing for the pot and the bounty",
    body: "The keeper pot goes to whoever's call first runs a generation, and a tide's bounty to whoever's call runs it, unless that caller is a house account or a keeper: then the pot waits for the next caller and the bounty stays in the vault. The bounty is capped at 0.001 NEAR a tide, and a simulated racer that only advanced lost 0.0055 NEAR a week after gas in the v6.1 runs, where every call that runs a generation shares the pot.",
  },
  {
    key: "A huge dish runs out of gas",
    title: "A huge dish runs out of gas",
    body: "Each colony's numbers live in cold pages of 32 colonies and a hot table of the colonies that play now (at most 10,000), so a join costs the same however many colonies came before, and a catch-up costs what the playing colonies cost. The contract's gas tests scale the unit runtime's host calls to the real price per byte and add an estimate of the wasm: with 30,000 colonies, 1,500 of them playing, the largest call is 67.5 TGas; with a full table, 9,999 playing, 125.7, under the 150 TGas they assert and the 300 one transaction can buy. In the simulator's 30,000-colony dish no call passed 60 TGas.",
  },
  {
    key: "A view too large to read",
    title: "A view too large to read",
    body: "earnings and tide_winnings return at most 500 colonies a call, stakes 2,000, colonies and slides 500, the ledger 1,000 entries, and nft_tokens and nft_tokens_for_owner 10 slides, each drawn as an SVG. A reader pages through with from and limit.",
  },
  {
    key: "The models stop answering",
    title: "The models stop answering",
    body: `Code proposes legal moves and forecasts them 240 generations ahead on a copy of the dish (as many as a two-second budget allows); a model picks one and writes the note, and at the council each tide window it offers and answers the house's pacts, which the contract enforces. The strains ask NEAR AI Cloud (${NEARAI_MODEL}, inside a TEE) first and Claude Haiku (${CLAUDE_MODEL}, within a fixed dollar budget) when NEAR AI does not answer. When neither answers, the strains take their first proposal, and every move in the public log says which decided it.`,
  },
  {
    key: "Rounding",
    title: "Rounding",
    body: "Feed shares round down to a millionth of a PETRI and tide shares to a yoctoNEAR. The remainders stay in the agar and the vault, so rounding never creates a unit.",
  },
];

export function LimitsSection() {
  return (
    <section id="limits" data-section="Limits and failure cases" className={`band band-2 ${s.section}`} aria-labelledby="limits-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="limits-title" className={s.h2}>Limits and failure cases</h2>
          <p className="lede">
            What someone might try, or what might go wrong, and what the rules do about it. The full specification is in{" "}
            <a className={s.link} href={`${REPO}/blob/main/RULES.md`}>RULES.md</a>.
          </p>
        </div>
        <PhoneFold label="Every case, one by one">
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
