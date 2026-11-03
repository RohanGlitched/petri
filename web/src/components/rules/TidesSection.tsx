"use client";

import { useLive, int, near, hex } from "@/lib/live";
import { LAUNCH, capOf, genTime } from "./shared";
import s from "./rules.module.css";

export function TidesSection() {
  const { d, rules, ready, colonies, vault, tideIn } = useLive();
  const r = rules ?? LAUNCH;
  const st = d.state;
  const tidePct = r.tide_bps / 100;
  const capPct = r.cap_bps / 100;
  const genMs = Number(r.generation_ms);
  const nextPay = (vault * r.tide_bps) / 10000;
  const nextAt = ready ? d.generation + tideIn : 0;

  const cap = capOf(d.totalLive, r.cap_bps, r.cap_min);
  const alive = colonies.filter((c) => c.live > 0);
  const wsum = alive.reduce((a, c) => a + Math.min(c.live, cap), 0);
  const shown = alive.slice(0, 8);
  const rest = alive.slice(8);
  const restW = rest.reduce((a, c) => a + Math.min(c.live, cap), 0);

  const big = (k: "vault" | "near_in" | "near_tides") => (st ? BigInt(st[k]) : 0n);
  const nearOk = st ? big("vault") + big("near_tides") === big("near_in") : null;

  const stats: [string, string][] = [
    ["In the vault", st ? `${near(vault, 4)} NEAR` : "—"],
    ["Next tide", ready ? `${int(tideIn)} gen, ${genTime(tideIn, genMs)}` : "—"],
    ["Paid at the tides so far", st ? `${near(Number(st.near_tides), 4)} NEAR` : "—"],
    ["Tides paid", st ? int(Number(st.tides)) : "—"],
  ];

  const ways: [string, string][] = [
    [
      "Joining",
      `At least ${near(Number(r.min_join), 2)} NEAR. The contract keeps what the new colony's storage costs and spends the rest on PETRI from the agar. That NEAR goes to the vault.`,
    ],
    ["Buying", "Everything attached buys PETRI from the agar, and all of it goes to the vault."],
    [
      "Planting",
      `The storage the planting used, plus ${near(Number(r.cell_fee), 4)} NEAR for every cell. The contract keeps the storage; everything above it goes to the vault.`,
    ],
    ["Registering to hold PETRI", "The storage of one balance record, kept by the contract and refunded by storage_unregister once the account is empty."],
    ["Gas", "Every transaction pays its own gas, as on any NEAR contract. Guests on the site have theirs paid by the relayer."],
  ];

  return (
    <section id="tides" className={`band band-2 ${s.section}`} aria-labelledby="tides-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="tides-title" className={s.h2}>The NEAR goes back to whoever holds ground</h2>
          <p className="lede">
            The NEAR that colonies pay in does not stay with the contract or with the project. It collects in the tide vault,
            and every {r.tide_every} generations ({genTime(r.tide_every, genMs)} of dish time), {tidePct}% of the
            vault is paid out to colonies in proportion to their territory, counted with the same {capPct}% cap as the feed.
          </p>
        </div>

        <div className={s.split}>
          <div className={s.prose}>
            <h3 className="h3">The vault</h3>
            <p>
              Purchases from the agar, the NEAR a join spends on PETRI, and whatever a planting attaches above its storage all
              go to the vault. Nothing else does, and nothing else comes out of it. The contract counts every yoctoNEAR that
              went in, <code className={s.code}>near_in</code>, and every one paid out, <code className={s.code}>near_tides</code>.
            </p>
            <h3 className="h3">The tide</h3>
            <pre className={s.formula}>
              {`at every generation that is a multiple of ${r.tide_every}:
paid out = vault × ${tidePct}%
a colony's share = paid out × counted cells ÷ all counted cells`}
            </pre>
            <p>
              Counted cells are the colony&rsquo;s living cells at that generation, capped at {capPct}% of all living cells and
              never capped below {int(r.cap_min)}, exactly as for the feed. A colony with no living cells at the tide gets
              nothing. Rounding remainders stay in the vault, and so does the other {100 - tidePct}%, so the vault never empties
              and each tide pays half of what is there.
            </p>
            <h3 className="h3">Claiming it</h3>
            <p>
              Tide winnings wait under the colony&rsquo;s name until it calls <code className={s.code}>claim</code>, which sends
              the NEAR to the colony&rsquo;s account and moves its PETRI earnings into its balance in the same call. The{" "}
              <code className={s.code}>claimable</code> view shows both. Winnings never expire.
            </p>
            <h3 className="h3">Where the NEAR comes from</h3>
            <p>
              The vault only ever holds what players paid in. The tides move NEAR from those who bought and planted to those
              who hold ground at the right moments. There is no outside yield. As a group, players get back less than they
              paid: the contract keeps what their colonies and plantings store, and the vault always holds back part of what
              came in.
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
              <h3 className="h3">The next tide, if the dish stood still</h3>
              <p>
                {ready && st
                  ? `At generation ${int(nextAt)} the vault pays ${tidePct}% of what it holds then. If nothing more came in, that would be ${near(nextPay, 4)} NEAR, split like this by the cells alive now. The real split uses the cells alive at the tide.`
                  : "Reading the dish."}
              </p>
              <div className={s.tableWrap} tabIndex={0} role="region" aria-label="The next tide by colony">
                <table className={`${s.table} ${s.tideTable}`}>
                  <thead>
                    <tr>
                      <th scope="col">Colony</th>
                      <th scope="col">Counted cells</th>
                      <th scope="col">NEAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((c) => {
                      const w = Math.min(c.live, cap);
                      return (
                        <tr key={c.id}>
                          <th scope="row">
                            <span className={s.who}>
                              <i className="swatch" style={{ background: hex(c.color) }} />
                              {c.name}
                            </span>
                          </th>
                          <td className="num">{int(w)}</td>
                          <td className="num">{wsum > 0 ? near((nextPay * w) / wsum, 5) : "—"}</td>
                        </tr>
                      );
                    })}
                    {rest.length > 0 && (
                      <tr>
                        <th scope="row">{rest.length} more</th>
                        <td className="num">{int(restW)}</td>
                        <td className="num">{wsum > 0 ? near((nextPay * restW) / wsum, 5) : "—"}</td>
                      </tr>
                    )}
                    {ready && alive.length === 0 && (
                      <tr>
                        <td colSpan={3}>Nothing is alive, so a tide now would pay nothing.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div className={s.hashCard}>
              <code className={s.hash}>vault + paid at the tides = all NEAR in</code>
              <span className={nearOk === false ? s.badDark : s.goodDark}>
                {nearOk === null ? "Reading the contract" : nearOk ? "Holds on the live dish" : "Does not hold"}
              </span>
            </div>
          </div>
        </div>

        <div className={s.refuseBlock}>
          <h3 className="h3">Every NEAR a player spends, and where it goes</h3>
          <dl className={s.refusals}>
            {ways.map(([k, val]) => (
              <div key={k} className={s.refusal}>
                <dt>{k}</dt>
                <dd className={s.wayText}>{val}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}
