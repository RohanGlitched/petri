import Link from "next/link";
import { CONTRACT, NETWORK, REPO, accountUrl } from "@/lib/config";
import { MODEL } from "@/lib/strains";
import s from "./rules.module.css";

const LIMITS: { title: string; body: React.ReactNode }[] = [
  {
    title: `It runs on ${NETWORK}`,
    body: `The dish lives on NEAR ${NETWORK} for now. PETRI there is a real token on a real chain, but ${NETWORK === "testnet" ? "testnet tokens have no market and are worth nothing" : "nothing about the game guarantees it a price"}.`,
  },
  {
    title: "Fixed parameters, not frozen code",
    body: (
      <>
        No contract method changes a parameter, mints PETRI or edits the board. Whoever holds full-access keys to{" "}
        <a className={s.link} href={accountUrl(CONTRACT)}>{CONTRACT}</a> could still deploy new code, so check the
        account&rsquo;s access keys on an explorer before you rely on that.
      </>
    ),
  },
  {
    title: "Somebody has to advance it",
    body: "The stored board moves only when a transaction touches it. If the keeper and everyone else stopped, nothing would be lost, but each call catches up at most 120 generations (30 minutes of dish time), plantings are refused until the dish is current, and the caller pays the gas. Feed and tides for the missed generations are worked out late, not lost.",
  },
  {
    title: "The keeper pot is a race",
    body: "Every call that catches the dish up adds to the keeper pot, but only advance pays it out, all at once, to whoever calls it. A bot that calls advance right after someone else's planting collects a pot it did no work for. The sums are small: 2% of the feed.",
  },
  {
    title: "Early colonies still have an edge",
    body: "While fewer than 1,000 cells are alive, the price counts 1,000 anyway, so each cell earns more than its price assumes and pays back sooner. The agar is fullest at the start, and PETRI is cheapest in NEAR while the agar is full. Whoever arrives first gets all three.",
  },
  {
    title: "The cap limits pay, not ground",
    body: "A colony can still cover most of the dish. In the simulator a methuselah grower held 66% of the cells. The cap stops it being paid for more than 15% of the living, at the feed and at the tides; it does not stop it crowding others out.",
  },
  {
    title: "Many accounts are cheaper on testnet",
    body: "Splitting into many colonies gains nothing from the cap, and each colony has to join with at least 0.01 NEAR of its own. But the site's guest accounts are funded by its relayer with 0.04 testnet NEAR each. They are rate-limited (4 per IP address an hour, 120 an hour overall) and each needs a second of proof of work, yet a farmer of guests plays with the relayer's NEAR, not their own.",
  },
  {
    title: "The tides move players' own NEAR",
    body: "The vault only ever holds what players paid in. A tide moves NEAR from those who bought and planted to those holding ground at that generation. There is no outside yield, and the contract keeps whatever storage players' colonies and plantings use.",
  },
  {
    title: "PETRI cannot be sold back",
    body: "The agar sells PETRI for NEAR but never buys it back. PETRI can be planted, transferred or held. The rising price is what the next buyer pays the agar, not what a holder can get for it.",
  },
  {
    title: "Same-generation order",
    body: "Ledger entries in the same generation apply in the order the chain executes them. An earlier planting can make a later one fail its buffer or occupancy check, and the later one is refused.",
  },
  {
    title: "Storage still grows",
    body: "Players pay for the storage of their colony, their plantings and their notes, and accounts pay to register. Checkpoints, one every 240 generations, are stored at the contract's expense. The earnings and tide records grow with the number of colonies, and every catch-up reads and writes them whole.",
  },
  {
    title: "Wallets see less than the supply",
    body: "ft_total_supply counts the agar, every colony's unclaimed earnings and the keeper pot. Until those are claimed they show in no account's balance, so adding up balances gives less than the supply.",
  },
  {
    title: "The replay trusts the purchase figures",
    body: "The browser replay takes each purchase's PETRI from the ledger as recorded and checks everything else. The NEAR paid sits beside it, so anyone can check it against the curve, but the verify page does not yet do that sum.",
  },
  {
    title: "The AI strains need credits",
    body: `The five strains are ordinary accounts run by the project, playing by the same rules: each joined with 0.05 NEAR, buys PETRI when it runs low, claims its tides and attaches its own planting deposits. Code proposes moves the contract will accept; a model (${MODEL} on NEAR AI Cloud, served from a TEE) picks one and writes the note. If the key runs out or the model fails, the strain takes the first proposal and its note is the proposal's own description.`,
  },
  {
    title: "Small rounding",
    body: "Shares of the feed are rounded down to a millionth of a PETRI and shares of a tide to a yoctoNEAR. The remainders stay in the agar and the vault, so colonies are paid very slightly less than an exact split.",
  },
];

export function LimitsSection() {
  return (
    <section id="limits" className={`band band-2 ${s.section}`} aria-labelledby="limits-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="limits-title" className={s.h2}>Limits and honest trade-offs</h2>
          <p className="lede">
            These are the places where the design is weaker than it looks, or where you are trusting something other than the
            code. The full specification is in{" "}
            <a className={s.link} href={`${REPO}/blob/main/RULES.md`}>RULES.md</a>.
          </p>
        </div>
        <ul className={s.limitsGrid}>
          {LIMITS.map((l) => (
            <li key={l.title} className={s.card}>
              <h3 className="h3">{l.title}</h3>
              <p>{l.body}</p>
            </li>
          ))}
        </ul>
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
            Start a colony with a little NEAR, buy your first PETRI from the agar and put your first pattern on the dish. The
            rules above are the only ones there are.
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
