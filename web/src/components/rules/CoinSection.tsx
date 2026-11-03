"use client";

import { useLive, petri, int } from "@/lib/live";
import { CONTRACT, accountUrl, fmtPetri } from "@/lib/config";
import { LAUNCH, genTime } from "./shared";
import s from "./rules.module.css";

export function CoinSection() {
  const { d, rules, ready, feed, perCell } = useLive();
  const r = rules ?? LAUNCH;
  const st = d.state;
  const keeperPct = r.keeper_bps / 100;
  const burnPct = r.burn_bps / 100;
  const keeperCut = feed * (r.keeper_bps / 10000);
  const perGenRate = r.feed_ppm / 1e6;
  const perDay = Math.round(86_400_000 / Number(r.generation_ms));
  const dayShare = 1 - Math.pow(1 - perGenRate, perDay);
  const halfLife = Math.log(2) / -Math.log(1 - perGenRate);

  // Conservation, checked on the contract's own counters with exact integers.
  const big = (k: keyof NonNullable<typeof st>) => (st ? BigInt(st[k] as string) : 0n);
  const max = BigInt(r.max_supply);
  const supplyOk = st ? big("total_supply") === max - big("burned") : null;
  const agarOk = st ? big("agar") === max - big("granted") - big("fed") + big("returned") : null;
  const held = st ? big("total_supply") - big("agar") : 0n;
  const v = (k: keyof NonNullable<typeof st>) => (st ? fmtPetri(st[k] as string, 2) : "—");

  const ledger: [string, string, string][] = [
    ["Minted at launch", fmtPetri(r.max_supply, 0), "The whole supply, once, into the agar."],
    ["Still in the agar", v("agar"), "The contract's own balance, paid out a sliver at a time."],
    ["Held by accounts", st ? fmtPetri(held.toString(), 2) : "—", "Total supply minus the agar."],
    ["Granted to new colonies", v("granted"), `${fmtPetri(r.starter_grant)} PETRI each, from the agar.`],
    ["Fed to the living", v("fed"), "Everything the agar has paid out, keeper share included."],
    ["Of which keepers earned", v("keeper_paid"), `${keeperPct}% of every generation's feed.`],
    ["Returned by planting", v("returned"), `${100 - burnPct}% of every planting goes back into the agar.`],
    ["Burned", v("burned"), `The other ${burnPct}%. Gone for good.`],
    ["Total supply", v("total_supply"), "What ft_total_supply reports, the agar included."],
  ];

  const check = (ok: boolean | null) => (ok === null ? "Reading the contract" : ok ? "Holds on the live dish" : "Does not hold");

  return (
    <section id="coin" className={`band band-paper ${s.section}`} aria-labelledby="coin-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="coin-title" className={s.h2}>PETRI moves from the agar to the living and back</h2>
          <p className="lede">
            All {fmtPetri(r.max_supply, 0)} PETRI were minted once, at launch, into the contract&rsquo;s own balance. That
            balance is the agar. There is no other mint. Living cells are fed from it, and planting pays half of its cost back
            into it while the other half is burned.
          </p>
        </div>

        <div className={s.flows}>
          <article className={s.paperCard}>
            <h3 className="h3">Every generation</h3>
            <p>
              If anything is alive after the step, the agar pays {r.feed_ppm} parts per million of its balance. The account whose
              transaction ran the generation takes {keeperPct}%. The rest is shared between colonies in proportion to their live
              cells. Rounding remainders stay in the agar. An empty dish pays nothing.
            </p>
            <dl className={s.sums}>
              <div>
                <dt>Agar at your browser&rsquo;s generation</dt>
                <dd className="num">{ready ? petri(d.agar, 2) : "—"}</dd>
              </div>
              <div>
                <dt>Feed: agar × {r.feed_ppm} ÷ 1,000,000</dt>
                <dd className="num">{ready ? petri(feed, 4) : "—"}</dd>
              </div>
              <div>
                <dt>To the keeper, {keeperPct}%</dt>
                <dd className="num">{ready ? petri(keeperCut, 4) : "—"}</dd>
              </div>
              <div>
                <dt>To each live cell, of {ready ? int(d.totalLive) : "—"}</dt>
                <dd className="num">{ready ? petri(perCell, 5) : "—"}</dd>
              </div>
            </dl>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">Every planting</h3>
            <p>
              The price is paid in full by the planter. {burnPct}% of it is burned, which is the only way PETRI leaves the supply.
              The other {100 - burnPct}% goes back into the agar and is fed out again to whoever is alive. Planting is also the only
              way PETRI can go back to the agar; a transfer to the contract is refused.
            </p>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">Every new colony</h3>
            <p>
              Joining pays {fmtPetri(r.starter_grant)} PETRI from the agar to the new colony, once per account, enough to plant a
              few small patterns. If the agar ever held less than that, the grant would be whatever is left.
            </p>
          </article>
          <article className={s.paperCard}>
            <h3 className="h3">A slowly draining agar</h3>
            <p>
              The feed is a share of what is left, so it shrinks as the agar does. At {r.feed_ppm} ppm a generation, the agar pays
              out <b className="num">{(dayShare * 100).toFixed(1)}%</b> of its balance a day while anything lives, before
              plantings put any back. On its own it would halve in about <b className="num">{int(halfLife)}</b> generations,{" "}
              {genTime(halfLife, Number(r.generation_ms))}.
            </p>
          </article>
        </div>

        <div className={s.coinGrid}>
          <div>
            <h3 className="h3">The ledger, from the contract</h3>
            <p className={s.paperMuted}>
              Read from the <code className={s.codePaper}>state</code> view of{" "}
              <a className={s.linkPaper} href={accountUrl(CONTRACT)}>{CONTRACT}</a> at stored generation{" "}
              {st ? int(Number(st.generation)) : "—"}. Feed for the generations since then is paid when the dish next advances.
            </p>
            <dl className={s.ledger}>
              {ledger.map(([k, val, note]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="num">{val}</dd>
                  <p>{note}</p>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="h3">Nothing is created or lost</h3>
            <p className={s.paperMuted}>
              The contract tests check three identities after every scenario. The first two are checked again here, on the live
              counters, with exact integers.
            </p>
            <ul className={s.checks}>
              <li className={s.checkItem}>
                <code className={s.codePaper}>total supply = minted − burned</code>
                <span className={supplyOk === false ? s.bad : s.good}>{check(supplyOk)}</span>
              </li>
              <li className={s.checkItem}>
                <code className={s.codePaper}>agar = minted − granted − fed + returned</code>
                <span className={agarOk === false ? s.bad : s.good}>{check(agarOk)}</span>
              </li>
              <li className={s.checkItem}>
                <code className={s.codePaper}>agar + every account&rsquo;s balance = total supply</code>
                <span className={s.paperMuted}>Checked in the tests by summing every holder</span>
              </li>
            </ul>

            <h3 className={`h3 ${s.spaced}`}>A standard token, with two restrictions</h3>
            <ul className={s.standards}>
              <li>
                <b>NEP-141.</b> <code className={s.codePaper}>ft_transfer</code>, <code className={s.codePaper}>ft_transfer_call</code>{" "}
                (with refunds through <code className={s.codePaper}>ft_resolve_transfer</code>),{" "}
                <code className={s.codePaper}>ft_balance_of</code> and <code className={s.codePaper}>ft_total_supply</code>. Transfers
                attach exactly 1 yoctoNEAR, as the standard asks.
              </li>
              <li>
                <b>NEP-148.</b> Name Petri, symbol PETRI, 6 decimals and an inline icon.
              </li>
              <li>
                <b>NEP-145 views.</b> The contract pays for every balance record, so every account reports as registered and{" "}
                <code className={s.codePaper}>storage_deposit</code> refunds whatever is attached.
              </li>
              <li>
                <b>No sends to the agar.</b> A transfer to the contract account is refused. PETRI goes back to the agar only by
                planting.
              </li>
              <li>
                <b>At least 1 PETRI to a new holder.</b> The first transfer to an account that has never held PETRI must move at
                least one whole PETRI, so nobody can fill the contract&rsquo;s storage with dust.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
