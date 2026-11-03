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
    body: "The stored board moves only when a transaction touches it. If the keeper and everyone else stopped, nothing would be lost, but each call catches up at most 120 generations (30 minutes of dish time), plantings are refused until the dish is current, and the caller pays the gas. Feed for the missed generations is paid late, not lost.",
  },
  {
    title: "Early colonies have an edge",
    body: "The feed is a fixed share of a shrinking agar, and the price of a cell rises with the population. A cell planted on a quiet, early dish costs less and earns more than one planted later. That is deliberate, and it is also an advantage for whoever arrives first.",
  },
  {
    title: "Many accounts, many grants",
    body: "Every new account that joins gets 64 PETRI from the agar. The site's gasless guest accounts are rate-limited (4 per IP address an hour, 120 an hour overall), but anyone can create NEAR accounts and call join directly. Each colony still obeys the buffer and pays rising prices.",
  },
  {
    title: "Same-generation order",
    body: "Plantings in the same generation are applied in the order the chain executes them. An earlier planting can make a later one fail its buffer or occupancy check, and the later one is refused.",
  },
  {
    title: "The contract pays for storage",
    body: "Balances, the plant log and lab notes are stored at the contract's expense. The 1 PETRI minimum for new holders and the 64-cell limit per planting bound the growth, but the log grows with every planting.",
  },
  {
    title: "The AI strains need credits",
    body: `The five strains are ordinary accounts run by the project, playing by the same rules. Code proposes moves the contract will accept; a model (${MODEL} on NEAR AI Cloud, served from a TEE) picks one and writes the note. If the key runs out or the model fails, the strain takes the first proposal and its note is the proposal's own description.`,
  },
  {
    title: "Small rounding",
    body: "Shares of the feed are rounded down to the smallest unit, a millionth of a PETRI. The remainders stay in the agar, so colonies are paid very slightly less than an exact split.",
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
            Start a colony, take your starter grant from the agar and put your first pattern on the dish. The rules above are
            the only ones there are.
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
