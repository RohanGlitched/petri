"use client";
// A slide's history on its page: minted, moved, planted under its licence, and what it has earned its holders.

import { useEffect, useMemo, useState } from "react";
import { getSlide, type Colony, type SlideView } from "@/lib/chain";
import { accountUrl, nftUrl, shortAccount, txUrl } from "@/lib/config";
import { useLedger } from "@/lib/ledger-feed";
import { useLive, hex, int, petri } from "@/lib/live";
import { useNet } from "@/lib/use-net";
import { slideHistory, useSlideMoves, useSlideRoyalties, type Licensed, type Moved } from "./slide-history";
import s from "./specimens.module.css";

type Item =
  | { kind: "mint"; at: number; generation: number; colony: number; cells: number; cost: bigint; spent: bigint | null; tx: string | null; owner: string | null }
  | { kind: "move"; at: number; m: Moved }
  | { kind: "licence"; at: number; l: Licensed };

const SHOWN = 10;
const units = (v: bigint, dp = 2) => petri(Number(v), v % 1_000_000n ? dp : 0);

export function SlideHistoryBand({ id, cells }: { id: string; cells: number | null }) {
  const net = useNet();
  const { d, rules } = useLive();
  const ledger = useLedger();
  const [view, setView] = useState<SlideView | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let stop = false;
    getSlide(id).then((v) => !stop && setView(v), () => {});
    return () => {
      stop = true;
    };
  }, [id, ledger.entries.length]);
  const h = useMemo(() => slideHistory(ledger.entries, id), [ledger.entries, id]);
  const royalties = useSlideRoyalties(id, ledger.entries.length);
  const moves = view?.moves ?? 0;
  const nb = useSlideMoves(id, moves);
  const byId = useMemo(() => new Map(d.colonies.map((c) => [c.id, c])), [d.colonies]);
  const min = rules?.licence_min_cells ?? 12;
  const count = cells ?? view?.cells ?? null;
  const keepsake = count !== null && count < min;
  const genMs = rules ? Number(rules.generation_ms) : 15000;
  const epoch = d.state ? Number(d.state.epoch_ms) : 0;
  const timeOf = (g: number) => epoch + g * genMs;

  const transfers = Array.isArray(nb) ? nb.filter((m) => !m.mint) : [];
  const mintRow = Array.isArray(nb) ? nb.find((m) => m.mint) ?? null : null;
  const items: Item[] = [];
  if (h.minted) {
    const m = h.minted;
    items.push({ kind: "mint", at: timeOf(m.generation), generation: m.generation, colony: m.colony, cells: m.cells, cost: m.cost, spent: m.spent, tx: mintRow?.tx ?? null, owner: mintRow?.to ?? null });
  }
  for (const m of transfers) items.push({ kind: "move", at: m.at, m });
  for (const l of h.licensed) items.push({ kind: "licence", at: timeOf(l.generation), l });
  items.sort((a, b) => b.at - a.at);
  const shown = all ? items : items.slice(0, SHOWN);

  // The contract's counter against the ledger's sum: they must agree to the unit.
  const check = royalties === null ? null : royalties === h.toHolders;
  const holders = new Set<string>([...(mintRow ? [mintRow.to] : []), ...transfers.map((t) => t.to), ...h.licensed.map((l) => l.holder).filter((x): x is string => !!x)]);
  if (view?.owner_id) holders.add(view.owner_id);
  const guestPlantings = h.licensed.filter((l) => l.toAgar).length;
  const own = h.licensed.filter((l) => !l.holder && !l.toAgar).length;

  return (
    <section className="band band-2" aria-labelledby="sp-history">
      <div className="wrap">
        <div className={s.split}>
          <div>
            <h2 id="sp-history" className="h2">Its history</h2>
            <p className="lede">
              Who made it, who has held it, every planting made under its licence and what each one paid. Rebuilt in this
              browser from {net.contract}&rsquo;s ledger, and the royalties checked against the contract&rsquo;s own count.
            </p>
            <dl className={s.histFacts}>
              <div>
                <dt>What it is</dt>
                <dd className={s.big}>{count === null ? "—" : keepsake ? "A keepsake" : "A licence"}</dd>
                <p>
                  {count === null
                    ? "Reading the slide…"
                    : keepsake
                      ? `It captured ${int(count)} cells; only a slide of ${min} or more licenses its pattern, so nobody plants under it and it earns no royalties.`
                      : `It captured ${int(count)} cells, at least the ${min} a licence needs: its exact pattern plants at ${(rules?.slide_discount_bps ?? 2500) / 100}% off, and anyone else pays its holder ${(rules?.slide_royalty_bps ?? 1000) / 100}% of that.`}
                </p>
              </div>
              <div>
                <dt>Royalties earned</dt>
                <dd className={`${s.big} num`}>{ledger.status === "loading" && !ledger.entries.length ? "—" : `${units(h.toHolders)} PETRI`}</dd>
                <p>
                  {check === null ? (
                    "Paid to its holders, summed from the ledger."
                  ) : check ? (
                    <span className={s.agree}>Matches slide_royalties(&quot;{id}&quot;) on chain, {units(royalties!)} PETRI.</span>
                  ) : (
                    <span className={s.disagree}>The contract&rsquo;s slide_royalties says {units(royalties!)} PETRI{ledger.status !== "ready" ? "; the ledger is still being read" : ""}.</span>
                  )}
                  {h.toAgar > 0n ? ` ${units(h.toAgar)} PETRI more went to the agar from planters who had never attached NEAR.` : ""}
                </p>
              </div>
              <div>
                <dt>Plantings under its licence</dt>
                <dd className={`${s.big} num`}>{ledger.status === "loading" && !ledger.entries.length ? "—" : int(h.licensed.length)}</dd>
                <p>
                  {h.licensed.length === 0
                    ? keepsake
                      ? "None can be made: it is a keepsake."
                      : "None yet. Plant this pattern from the button above to make the first."
                    : `${int(h.licensed.length - guestPlantings - own)} paid a holder${guestPlantings ? `, ${int(guestPlantings)} paid the agar` : ""}${own ? `, ${int(own)} by the holder itself, who pays no royalty` : ""}.`}
                </p>
              </div>
              <div>
                <dt>Holders</dt>
                <dd className={`${s.big} num`}>{view ? int(Math.max(1, holders.size)) : "—"}</dd>
                <p>
                  {!view
                    ? "Reading the slide…"
                    : moves === 0
                      ? "It has never changed hands."
                      : nb === "unavailable"
                        ? `It has changed hands ${int(moves)} ${moves === 1 ? "time" : "times"} (the slide counts its moves). NearBlocks did not answer, so only the holders its licensed plantings paid are named here.`
                        : nb === null
                          ? `It has changed hands ${int(moves)} ${moves === 1 ? "time" : "times"}. Reading the transfers…`
                          : transfers.length === moves
                            ? `${int(moves)} ${moves === 1 ? "move" : "moves"}, each a NEP-171 transfer NearBlocks lists, matching the slide's own count.`
                            : `The slide counts ${int(moves)} ${moves === 1 ? "move" : "moves"}; NearBlocks lists ${int(transfers.length)} so far.`}
                </p>
              </div>
            </dl>
            {h.byHolder.size > 0 && (
              <div className={s.paidTo}>
                <h3 className="h3">Paid out, by holder</h3>
                <ul>
                  {[...h.byHolder.entries()]
                    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
                    .map(([acct, v]) => (
                      <li key={acct}>
                        <a href={accountUrl(acct)}>{shortAccount(acct, 30)}</a>
                        <span className="num">{units(v)} PETRI</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <h3 className="h3">Timeline</h3>
            {ledger.status === "error" && !ledger.entries.length ? (
              <p className="muted">The ledger could not be read just now; it is tried again every few seconds.</p>
            ) : items.length === 0 ? (
              <p className="muted">{ledger.status === "loading" ? "Reading the ledger from NEAR…" : "Its Slide entry is not in the ledger read so far."}</p>
            ) : (
              <ol className={s.timeline}>
                {shown.map((it, i) => (
                  <Step key={i} it={it} byId={byId} />
                ))}
              </ol>
            )}
            {items.length > SHOWN && (
              <button type="button" className={s.showAll} onClick={() => setAll((a) => !a)} aria-expanded={all}>
                {all ? "Show the latest only" : `Show all ${int(items.length)} events`}
              </button>
            )}
            {moves > 0 && <p className={s.timelineNote}>Transfers are NEP-171 events, not ledger entries. <a href={nftUrl(net.contract, id, net.network)}>See them on NearBlocks</a>.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}

function Who({ c, id }: { c: Colony | undefined; id: number }) {
  return (
    <span className={s.histWho}>
      <i className="swatch" style={{ background: c ? hex(c.color) : "#888" }} />
      {c?.name ?? `Colony ${id}`}
    </span>
  );
}

function Step({ it, byId }: { it: Item; byId: Map<number, Colony> }) {
  const when = new Date(it.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  if (it.kind === "mint") {
    const c = byId.get(it.colony);
    return (
      <li className={s.stepMint}>
        <p className={s.stepMeta}><span className="num">Generation {int(it.generation)}</span><span>{when}</span></p>
        <p className={s.stepText}>
          <b>Minted</b> by <Who c={c} id={it.colony} />
          {c && <> (<a href={accountUrl(c.account)}>{shortAccount(c.account, 26)}</a>)</>}: {int(it.cells)} of its living cells, {units(it.cost)} PETRI burned
          {it.spent ? ", its storage paid from credit" : ""}.
        </p>
        {it.tx && <p className={s.stepLinks}><a href={txUrl(it.tx)}>Transaction</a></p>}
      </li>
    );
  }
  if (it.kind === "move") {
    return (
      <li>
        <p className={s.stepMeta}><span>{when}</span></p>
        <p className={s.stepText}>
          <b>Moved</b> to <a href={accountUrl(it.m.to)}>{shortAccount(it.m.to, 30)}</a>
          {it.m.from ? <> from <a href={accountUrl(it.m.from)}>{shortAccount(it.m.from, 30)}</a></> : null}.
        </p>
        <p className={s.stepLinks}><a href={txUrl(it.m.tx)}>Transaction</a></p>
      </li>
    );
  }
  const l = it.l;
  const c = byId.get(l.colony);
  return (
    <li>
      <p className={s.stepMeta}><span className="num">Generation {int(l.generation)}</span><span>{when}</span></p>
      <p className={s.stepText}>
        <b>Planted under its licence</b> by <Who c={c} id={l.colony} />: {int(l.cells)} cells for {units(l.cost)} PETRI.{" "}
        {l.toAgar ? (
          <>Royalty {units(l.royalty)} PETRI <em>to the agar</em>: the planter had never attached NEAR.</>
        ) : l.holder ? (
          <>Royalty {units(l.royalty)} PETRI to <a href={accountUrl(l.holder)}>{shortAccount(l.holder, 28)}</a>, {l.moves === 0 ? "its first holder" : `its holder after ${int(l.moves)} ${l.moves === 1 ? "move" : "moves"}`}.</>
        ) : (
          <>The planter held the slide, so no royalty.</>
        )}
      </p>
    </li>
  );
}
