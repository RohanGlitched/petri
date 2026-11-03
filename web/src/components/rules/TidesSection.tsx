"use client";

import { useLive, int, near, hex } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { LAUNCH, genTime, weightOf } from "./shared";
import s from "./rules.module.css";

export function TidesSection() {
  const { d, rules, ready, colonies, vault, tideIn } = useLive();
  const net = useNet();
  const r = rules ?? LAUNCH;
  const st = d.state;
  const tidePct = r.tide_bps / 100;
  const genMs = Number(r.generation_ms);
  const pay = (vault * r.tide_bps) / 10000;
  const bounty = Math.min((pay * r.tide_bounty_bps) / 10000, Number(r.max_bounty));
  const nextAt = ready ? d.generation + tideIn : 0;

  // What each colony adds to this tide's window right now: its share of the feed. The contract keeps the window itself.
  const alive = colonies
    .filter((c) => c.live > 0)
    .map((c) => ({ ...c, w: weightOf(c.live, Number(c.cells_planted), r.reach, c.house) }));
  const wsum = alive.reduce((a, c) => a + c.w, 0);
  const shown = alive.slice(0, 8);
  const rest = alive.slice(8);
  const restW = rest.reduce((a, c) => a + c.w, 0);

  // NEAR in = vault + everything paid out. Tide and sale records are paid from the vault too, and are not counted in
  // `state`, so the live counters can only show the gap they leave.
  // Shares and sales paid as credit to colonies that never attached NEAR left the vault too.
  const big = (k: "vault" | "near_in" | "near_tides" | "near_as_credit" | "near_bounties" | "near_sold" | "credit_sold") => (st ? BigInt(st[k]) : 0n);
  const out = big("vault") + big("near_tides") + big("near_as_credit") + big("near_bounties") + big("near_sold") + big("credit_sold");
  const gap = big("near_in") - out;
  const nearOk = st ? gap >= 0n : null;

  const stats: [string, string][] = [
    ["In the vault", st ? `${near(vault, 4)} NEAR` : "—"],
    ["Next tide", ready ? `${int(tideIn)} gen, ${genTime(tideIn, genMs)}` : "—"],
    ["Paid at the tides so far", st ? `${near(Number(st.near_tides), 4)} NEAR` : "—"],
    ["Tides run", st ? int(Number(st.tides)) : "—"],
    ["In the credit pool", st ? `${near(Number(st.credit_pool), 4)} NEAR` : "—"],
    ["Credit sponsored", st ? `${near(Number(st.credit_given), 3)} NEAR` : "—"],
    ["Credit spent in the dish, won or sponsored", st ? `${near(Number(st.credit_spent), 3)} NEAR` : "—"],
  ];

  const ways: [string, string][] = [
    [
      "Joining",
      `At least ${near(Number(r.min_join), 2)} NEAR, attached or from credit. The contract keeps what the new colony's storage costs and spends the rest on PETRI from the agar. Attached NEAR goes to the vault, credit to the credit pool.`,
    ],
    ["Buying", "Everything brought, less the purchase record's storage, buys PETRI from the agar. Attached NEAR goes to the vault, credit to the credit pool."],
    [
      "Planting",
      `The storage the planting used, plus ${near(Number(r.cell_fee), 4)} NEAR for every cell. The contract keeps the storage; everything above it goes to the vault if attached, to the credit pool if it was credit.`,
    ],
    ["Selling back", "Comes out of the vault: the sale record's storage, and the rest to the seller, in NEAR, or as credit to a colony that has never attached NEAR."],
    ["A specimen slide", "Its storage, from the colony's credit first and then from attached NEAR; attached NEAR left over is sent back. Its PETRI price is burned, and none of its NEAR reaches the vault."],
    [
      "Paying with any token",
      "On mainnet, wNEAR that NEAR Intents delivers is unwrapped and joins or buys for the account it names, exactly as attached NEAR. Whatever cannot be used that way waits as pending NEAR, which that account takes back with claim_pending.",
    ],
    ["Registering to hold PETRI", "The storage of one balance record, refunded by storage_unregister once the account is empty."],
    ["Gas", net.freePlay ? "Every transaction pays its own gas. Guests on the free-play dish have theirs paid by the site's relayer." : "Every transaction pays its own gas, from the wallet that signs it."],
  ];

  return (
    <section id="tides" className={`band band-2 ${s.section}`} aria-labelledby="tides-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="tides-title" className={s.h2}>The NEAR goes back to whoever earned this hour</h2>
          <p className="lede">
            The NEAR that colonies attach collects in the tide vault; sponsored credit spent in the dish collects in a
            separate credit pool. Every {r.tide_every} generations ({genTime(r.tide_every, genMs)}) {tidePct}% of each is paid
            out, split by the PETRI each colony earned from the feed since the previous tide: the vault in NEAR, the credit pool
            as credit. A colony planted a minute before the tide gets a minute&rsquo;s worth.
          </p>
        </div>

        <div className={s.split}>
          <div className={s.prose}>
            <h3 className="h3">The tide</h3>
            <pre className={s.formula}>
              {`at every ${r.tide_every}th generation, if a colony outside the house earned since the last tide:
pay      = vault × ${tidePct}%
bounty   = min(pay × ${r.tide_bounty_bps / 100}%, ${near(Number(r.max_bounty), 3)} NEAR)    to whoever's call ran the tide
storage  = the tide's own ledger entry
a colony's share  = (pay − bounty − storage) × its window ÷ every window
its credit share  = credit pool × ${tidePct}% × its window ÷ every window`}
            </pre>
            <p>
              A colony&rsquo;s window is the PETRI it was fed since the last tide, so it already carries the reach cap. The
              windows reset at every tide, and every colony&rsquo;s stake keeps {r.stake_keep_bps / 100}% of itself. Rounding
              remainders and the other {100 - tidePct}% stay in the vault and the pool. A tide with nobody to pay, because no
              colony outside the house earned since the last one, does not run at all: no entry, no bounty, no decay, and the
              buy-back allowance stays as it was. Every tide that runs writes a <code className={s.code}>Tide</code> entry to
              the ledger with the history chain, every figure above and the colony whose call ran it; those entries are the
              dish&rsquo;s checkpoints.
            </p>
            <p>
              A colony that has attached NEAR of its own wins NEAR. It waits under the colony&rsquo;s name until it calls{" "}
              <code className={s.code}>claim</code>, and goes to the account it named with{" "}
              <code className={s.code}>set_payout</code> if it set one. A colony that has never attached NEAR, such as a
              free-play guest, is paid its share of the vault as credit instead, and so is the bounty of a tide its call runs.
              Credit won is spendable in the dish at once, needs no claim, is spent before sponsored credit and can never be
              withdrawn. Each tide that runs also reopens the buy-back allowance: the agar may pay up to{" "}
              {r.sell_cap_bps / 100}% of the vault for PETRI before the next tide.
            </p>
            <h3 className="h3">The house takes nothing</h3>
            <p>
              The five AI strains are listed in <code className={s.code}>rules.house</code>
              {r.house.length > 0 ? ` (${r.house.length} accounts)` : ""}. They plant like anyone and buy every PETRI they plant
              with, but they are never fed and take no share of any tide, and their cells never make a planting a siege.{" "}
              {net.freePlay
                ? "On this testnet dish they spend sponsored credit, which goes to the credit pool."
                : "On mainnet they attach their own NEAR, so what they spend lands in the vault and is paid to the other players."}{" "}
              In an early simulator, where the house was fed, a dish with only the house on it fed the agar down from 1,000,000 to
              about 179,000 PETRI in 30 days, nearly all of it to the house. Under the launched rules the same run ends with
              996,880 PETRI in the agar, all of the difference bought with NEAR.
            </p>
            <h3 className="h3">Sponsored credit</h3>
            <p>
              Anyone can call <code className={s.code}>sponsor(account_id)</code> with NEAR attached. The contract keeps the
              NEAR (less its record&rsquo;s storage) as credit for that account, spendable only on joining, buying, planting
              and a slide&rsquo;s storage, and never withdrawable by the account. Its sponsor may take back credit left unused
              for a day with <code className={s.code}>unsponsor</code>; credit a colony wins is its own.{" "}
              {net.freePlay
                ? "On this free-play dish the site's relayer gives every guest 0.05 NEAR of credit this way, so it never has to attach NEAR to a call it relays."
                : "The site sponsors nobody on mainnet; guests and their sponsored credit exist only on the free-play testnet dish."}
            </p>
          </div>
          <div className={s.hashes}>
            <dl className={s.stats}>
              {stats.map(([k, val]) => (
                <div key={k} className={s.stat}>
                  <dt>{k}</dt>
                  <dd className="num">{val}</dd>
                </div>
              ))}
            </dl>
            <div className={s.card}>
              <h3 className="h3">The next tide, if nothing more came in</h3>
              <p>
                {ready && st
                  ? `At generation ${int(nextAt)}, if a colony outside the house has earned by then, the vault pays ${tidePct}% of what it holds: ${near(pay, 4)} NEAR at today's vault, ${near(bounty, 5)} of it as the bounty. Each colony's share of the feed right now is how fast its window is growing.`
                  : "Reading the dish."}
              </p>
              <details className={s.fold}>
                <summary>
                  Window growth by colony <small>{ready ? `${alive.length} alive` : "reading"}</small>
                </summary>
                <div className={s.foldBody}>
                  <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Each colony's share of the feed now">
                    <table className={`${s.table} ${s.tideTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">Colony</th>
                          <th scope="col">Paid cells</th>
                          <th scope="col">Share now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((c) => (
                          <tr key={c.id}>
                            <th scope="row">
                              <span className={s.who}>
                                <i className="swatch" style={{ background: hex(c.color) }} />
                                {c.name}
                                {c.house ? " (house)" : ""}
                              </span>
                            </th>
                            <td className="num">{int(c.w)}</td>
                            <td className="num">{wsum > 0 ? `${((100 * c.w) / wsum).toFixed(1)}%` : "—"}</td>
                          </tr>
                        ))}
                        {rest.length > 0 && (
                          <tr>
                            <th scope="row">{rest.length} more</th>
                            <td className="num">{int(restW)}</td>
                            <td className="num">{wsum > 0 ? `${((100 * restW) / wsum).toFixed(1)}%` : "—"}</td>
                          </tr>
                        )}
                        {ready && wsum === 0 && (
                          <tr>
                            <td colSpan={3}>No paid colony is alive, so no window is growing.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className={s.note}>
                    The real split uses each colony&rsquo;s whole window since the last tide, which the contract keeps; this
                    table shows only the rate at this generation.
                  </p>
                </div>
              </details>
            </div>
            <div className={s.hashCard}>
              <code className={s.hash}>vault + tides + bounties + sales ≤ all NEAR in</code>
              <span className={nearOk === false ? s.badDark : s.goodDark}>
                {nearOk === null
                  ? "Reading the contract"
                  : nearOk
                    ? `Holds on the live dish; the ${near(Number(gap), 5)} NEAR gap paid for tide and sale records`
                    : "Does not hold"}
              </span>
            </div>
          </div>
        </div>

        <details className={s.fold}>
          <summary>
            Every NEAR a player spends, and where it goes <small>{ways.length} ways</small>
          </summary>
          <div className={s.foldBody}>
            <dl className={s.refusals}>
              {ways.map(([k, val]) => (
                <div key={k} className={s.refusal}>
                  <dt>{k}</dt>
                  <dd className={s.wayText}>{val}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </section>
  );
}
