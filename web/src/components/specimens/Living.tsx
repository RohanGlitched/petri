"use client";
// A living slide on its specimen page: the slide's own keyless account (its purse), what it holds and has earned, who
// has held it, how control passes on a sale, and the holder's darkroom (opened with a NEP-413 signed message checked
// by the server). A slide that is not living yet shows how its holder can seal it.

import { useCallback, useEffect, useMemo, useState } from "react";
import { getPlantDeposit, type Claimable, type Colony, type Entry, type Grant, type PactView } from "@/lib/chain";
import { accountUrl, shortAccount, txUrl, REPO } from "@/lib/config";
import { currentEngine, useDish } from "@/lib/dish-store";
import { useLedger } from "@/lib/ledger-feed";
import { useLive, int, petri } from "@/lib/live";
import { accessKeysOf, accountView, colonyCrop, darkroomMessage, dishView, purseOf, viewOn, FACTORIES, type AccountView, type PurseHistory, type PurseInfo } from "@/lib/living";
import { livingSvg } from "@/lib/living-svg";
import type { Slide } from "@/lib/slides";
import { useNet, type Net } from "@/lib/use-net";
import { usePlayer, walletCallTo, walletSignMessage } from "@/lib/wallet";
import l from "./living.module.css";

const YOCTO = 10n ** 24n;
const nearText = (yocto: string | bigint, dp = 4) => (Number(BigInt(yocto) / 10n ** 18n) / 1e6).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
const petriText = (units: string | bigint | number, dp = 2) => petri(Number(units), dp);
const svgUrl = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

type PurseData = {
  info: PurseInfo;
  history: PurseHistory;
  keys: number;
  account: AccountView | null;
  colony: Colony | null;
  petri: string;
  claimable: Claimable;
  pacts: PactView[];
  grants: Grant[];
  storageRegistered: boolean;
};

function usePurse(net: Net, purse: string | null, living: boolean) {
  const [data, setData] = useState<PurseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!purse || !living) return;
    let stop = false;
    const n = net.network;
    const run = async () => {
      try {
        const [info, history, keys, account, colony, petriHeld, claimable, pacts, grants] = await Promise.all([
          viewOn<PurseInfo>(n, purse, "purse"),
          viewOn<PurseHistory>(n, purse, "history"),
          accessKeysOf(n, purse).then((k) => k.length),
          accountView(n, purse),
          dishView<Colony | null>(n, "colony_of", { account_id: purse }),
          dishView<string>(n, "ft_balance_of", { account_id: purse }),
          dishView<Claimable>(n, "claimable", { account_id: purse }),
          dishView<PactView[]>(n, "pacts_of", { account_id: purse }).catch(() => []),
          dishView<Grant[]>(n, "credit_grants", { account_id: purse }).catch(() => []),
        ]);
        const storageRegistered = !!(await dishView<unknown>(n, "storage_balance_of", { account_id: info.holder }).catch(() => null));
        if (!stop) {
          setData({ info, history, keys, account, colony, petri: petriHeld, claimable, pacts, grants, storageRegistered });
          setError(null);
        }
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : String(e));
      }
    };
    run();
    const t = setInterval(run, 20_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [net.network, purse, living, tick]);
  return { data, error, refresh: useCallback(() => setTick((x) => x + 1), []) };
}

/** Everything the purse's colony did on the dish, and every royalty paid into it, from the ledger. */
function fromLedger(entries: Entry[], colonyId: number | null, purse: string) {
  type Row = { generation: number; kind: string; what: string; amount: string; dir: "in" | "out" | "play" };
  const rows: Row[] = [];
  let royalties = 0n;
  let royaltyCount = 0;
  for (const e of entries) {
    if ("Plant" in e) {
      const p = e.Plant;
      if (p.licence && p.licence.holder === purse && !p.licence.to_agar && p.colony !== colonyId) {
        royalties += BigInt(p.licence.royalty);
        royaltyCount++;
        rows.push({ generation: Number(p.generation), kind: "Royalty", what: `Colony ${p.colony} planted its pattern under licence (${p.cells.length} cells)`, amount: `+${petriText(p.licence.royalty)} PETRI`, dir: "in" });
      } else if (colonyId !== null && p.colony === colonyId) {
        rows.push({ generation: Number(p.generation), kind: "Planting", what: `${p.cells.length} cells${p.licence ? `, slide ${p.licence.token}'s pattern under licence` : ""}${p.siege ? ", a siege" : ""}`, amount: `${petriText(p.cost)} PETRI`, dir: "play" });
      }
    } else if (colonyId !== null && "Join" in e && e.Join.colony === colonyId) {
      rows.push({ generation: Number(e.Join.generation), kind: "Joined", what: "The purse joined the dish as a colony", amount: "", dir: "play" });
    } else if (colonyId !== null && "Claim" in e && e.Claim.colony === colonyId) {
      const c = e.Claim;
      rows.push({ generation: Number(c.generation), kind: "Claim", what: "Feed and tides claimed into the purse", amount: `${petriText(c.petri)} PETRI${BigInt(c.paid) > 0n ? ` + ${nearText(c.paid)} NEAR` : ""}`, dir: "in" });
    } else if (colonyId !== null && "Buy" in e && e.Buy.colony === colonyId) {
      rows.push({ generation: Number(e.Buy.generation), kind: "Bought", what: "PETRI bought from the agar", amount: `+${petriText(e.Buy.petri)} PETRI`, dir: "in" });
    } else if (colonyId !== null && "Sell" in e && e.Sell.colony === colonyId) {
      rows.push({ generation: Number(e.Sell.generation), kind: "Sold", what: "PETRI sold back to the agar", amount: `${nearText(e.Sell.paid)} NEAR`, dir: "in" });
    }
  }
  return { rows, royalties, royaltyCount };
}

const LOG_TEXT: Record<string, (a: string, amount: string) => { kind: string; what: string; amount: string; dir: "in" | "out" | "hand" }> = {
  seal: (a) => ({ kind: "Sealed", what: `Sealed into its own account; ${shortAccount(a, 30)} holds it`, amount: "", dir: "hand" }),
  transfer: (a) => ({ kind: "Passed on", what: `Now held by ${shortAccount(a, 30)}`, amount: "", dir: "hand" }),
  sale: (a, n) => ({ kind: "Sold", what: `Bought by ${shortAccount(a, 30)}; the price went to the seller`, amount: `${nearText(n)} NEAR`, dir: "hand" }),
  returned: (a) => ({ kind: "Returned", what: `A transfer was refused by its receiver; back with ${shortAccount(a, 30)}`, amount: "", dir: "hand" }),
  withdraw: (a, n) => ({ kind: "Paid out", what: `NEAR to its holder ${shortAccount(a, 30)}`, amount: `${nearText(n)} NEAR`, dir: "out" }),
  ft_withdraw: (a, n) => ({ kind: "Paid out", what: `PETRI to its holder ${shortAccount(a, 30)}`, amount: `${petriText(n)} PETRI`, dir: "out" }),
  release: (a, n) => ({ kind: "Released", what: `Slide ${n} sent to its holder ${shortAccount(a, 30)}`, amount: "", dir: "out" }),
  failed: (a) => ({ kind: "Failed", what: `A payout to ${shortAccount(a, 30)} failed; it stayed in the purse`, amount: "", dir: "out" }),
};

export function LivingSlideBand({ sl }: { sl: Slide }) {
  const net = useNet();
  const purse = purseOf(sl.id, net.network);
  const living = !!purse && sl.owner === purse;
  const { data, error, refresh } = usePurse(net, purse, living);

  if (!purse)
    return (
      <section id="living" data-section="A living slide" className="band band-2" aria-labelledby="lv-title">
        <div className="wrap">
          <h2 id="lv-title" className="h2">Living slides</h2>
          <p className="lede">
            On the testnet dish a slide can be sealed into its own keyless account that plays as a colony and keeps what it earns. The factory for {net.label.chain} is
            not deployed yet, so slides here stay ordinary tokens. <a href="?net=testnet" style={{ color: "var(--amber)" }}>See the living slides on testnet</a>.
          </p>
        </div>
      </section>
    );
  if (!living) return <SealBand sl={sl} net={net} purse={purse} />;
  return <LivingView sl={sl} net={net} purse={purse} data={data} error={error} refresh={refresh} />;
}

function LivingView({ sl, net, purse, data, error, refresh }: { sl: Slide; net: Net; purse: string; data: PurseData | null; error: string | null; refresh: () => void }) {
  const d = useDish();
  const ledger = useLedger();
  const [all, setAll] = useState(false);
  const colonyId = data?.colony?.id ?? null;
  const alive = colonyId !== null ? d.liveCounts[colonyId] ?? 0 : null;
  const genMs = d.rules ? Number(d.rules.generation_ms) : 15000;
  const epoch = d.state ? Number(d.state.epoch_ms) : 0;

  const picture = useMemo(() => {
    if (!sl.bitmap || !sl.rect || !data) return null;
    let live = null;
    if (data.colony && d.cells && d.rules) {
      const crop = colonyCrop(d.cells, d.rules.width, d.rules.height, data.colony.id);
      live = crop ? { cells: crop.cells, cw: crop.w, ch: crop.h } : { cells: [] as [number, number][], cw: 8, ch: 8 };
    }
    return svgUrl(
      livingSvg({ token: sl.id, bitmap: sl.bitmap, w: sl.rect.w, h: sl.rect.h, color: sl.color ?? 0xf2b45a, fossilGeneration: sl.generation ?? 0, live, liveColor: data.colony?.color ?? sl.color ?? 0xf2b45a, generation: d.generation, holder: data.info.holder, keys: data.keys }),
    );
    // Redrawn each generation the dish steps.
  }, [sl, data, d.cells, d.rules, d.generation]);

  const led = useMemo(() => fromLedger(ledger.entries, colonyId, purse), [ledger.entries, colonyId, purse]);

  if (!data)
    return (
      <section id="living" data-section="A living slide" className="band band-2">
        <div className="wrap">
          <h2 className="h2">A living slide</h2>
          <p className="lede">{error ? `Its account did not answer: ${error}` : `Reading ${purse}…`}</p>
        </div>
      </section>
    );

  const { info } = data;
  const earnedFeed = colonyId !== null ? d.earnings[colonyId] ?? 0 : 0;
  const tides = data.colony ? BigInt(data.colony.near_claimed) + BigInt(data.claimable.near) : 0n;
  const sponsored = data.grants.reduce((n, g) => n + BigInt(g.amount), 0n);
  const binding = data.pacts.filter((p) => p.binding);

  type HRow = { at: number; kind: string; what: string; amount: string; dir: "in" | "out" | "hand" | "play" };
  const rows: HRow[] = [
    ...data.history.entries.map((e) => ({ at: e.at_ms, ...LOG_TEXT[e.kind](e.account, e.amount) })),
    ...led.rows.map((r) => ({ at: epoch + r.generation * genMs, kind: r.kind, what: r.what, amount: r.amount, dir: r.dir })),
  ].sort((a, b) => b.at - a.at);
  const shown = all ? rows : rows.slice(0, 12);
  const holders: { account: string; at: number; how: string }[] = data.history.entries
    .filter((e) => e.kind === "seal" || e.kind === "transfer" || e.kind === "sale" || e.kind === "returned")
    .map((e) => ({ account: e.account, at: e.at_ms, how: e.kind === "seal" ? "sealed it" : e.kind === "sale" ? `bought it for ${nearText(e.amount)} NEAR` : e.kind === "returned" ? "had it returned" : "was given it" }));

  return (
    <>
      <section id="living" data-section="A living slide" className="band band-2" aria-labelledby="lv-title">
        <div className="wrap">
          <div className={l.top}>
            <div>
              <figure className={l.card}>{picture ? <img src={picture} alt={`Living slide ${sl.id}: its fossil beside its colony now, ${alive ?? 0} living cells`} /> : null}</figure>
              <p className={l.cardNote}>
                Drawn from the live dish, generation {int(d.generation)}. The token&rsquo;s own picture is the same card, <a href={`/api/living/${purse}`} style={{ color: "var(--amber)" }}>served from the stored board</a>.
              </p>
            </div>
            <div>
              <p className={l.kicker}>
                <i className={`${l.pulse} ${alive === 0 ? l.pulseDead : ""}`} />
                {alive === null ? "Sealed, not playing yet" : alive === 0 ? "Its colony is extinct" : `Alive: ${int(alive)} living cells`}
              </p>
              <h2 id="lv-title" className="h2">A living slide</h2>
              <p className="lede">
                This slide lives in an account of its own. The account owns the slide, so its licence royalties are paid there. It plays on the dish as a colony, so
                its cells earn there. And it is itself a one-token NEAR collectible: whoever holds that token is the only account that can make it act, and selling the
                token hands over everything at once.
              </p>
              <div className={l.account}>
                <code>{purse}</code>
                <span className={`${l.keys} ${data.keys === 0 ? l.keysOk : l.keysBad}`} title="view_access_key_list, read just now">
                  {data.keys === 0 ? "0 access keys, checked live" : `${data.keys} access keys`}
                </span>
                <a className="btn btn-ghost btn-small" href={accountUrl(purse, net.network)}>Open on NearBlocks</a>
              </div>
              <dl className={l.stats}>
                <div>
                  <dt>Held by</dt>
                  <dd style={{ fontSize: 18 }}><a href={accountUrl(info.holder, net.network)} style={{ color: "var(--bone)" }}>{shortAccount(info.holder, 28)}</a><small>{info.moves} hand-overs, {info.sales} sales</small></dd>
                </div>
                <div>
                  <dt>NEAR in the account</dt>
                  <dd className="num">{data.account ? nearText(data.account.amount, 3) : "—"}<small>{nearText(info.available, 4)} free to withdraw; the rest pays its storage</small></dd>
                </div>
                <div>
                  <dt>PETRI it holds</dt>
                  <dd className="num">{petriText(data.petri)}<small>{BigInt(data.claimable.petri) > 0n ? `+${petriText(data.claimable.petri)} waiting to be claimed` : "nothing waiting"}</small></dd>
                </div>
                <div>
                  <dt>Living cells</dt>
                  <dd className="num">{alive === null ? "—" : int(alive)}<small>{data.colony ? `colony ${data.colony.id}, ${int(Number(data.colony.cells_planted))} cells planted` : "not joined yet"}</small></dd>
                </div>
                <div>
                  <dt>Earned by its cells</dt>
                  <dd className="num">{petriText(earnedFeed)}<small>PETRI of feed{tides > 0n ? `, ${nearText(tides)} NEAR from tides` : ", no tide NEAR yet"}</small></dd>
                </div>
                <div>
                  <dt>Royalties into it</dt>
                  <dd className="num">{petriText(led.royalties)}<small>PETRI from {led.royaltyCount} licensed {led.royaltyCount === 1 ? "planting" : "plantings"} since it was sealed</small></dd>
                </div>
              </dl>
              {info.price !== null && <BuyBox purse={purse} info={info} net={net} refresh={refresh} />}
            </div>
          </div>

          <div className={l.ways}>
            <div className={l.way}>
              <b>It owns money</b>
              <p>NEAR and PETRI sit in the account itself, not with a person. Payouts from the dish land there, so a sale in the middle of a payout cannot misroute it.</p>
            </div>
            <div className={l.way}>
              <b>It earns</b>
              <p>Its colony is fed every generation and shares the tides; anyone who plants its pattern under licence pays the royalty into it.</p>
            </div>
            <div className={l.way}>
              <b>It holds inventory</b>
              <p>The specimen itself, sealed for good, and any slides its colony mints. Its holder can release the extra slides, never the sealed one.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="living-history" data-section="What it earned, paid and who held it" className="band" aria-labelledby="lv-hist">
        <div className="wrap">
          <div className={l.top}>
            <div>
              <h2 id="lv-hist" className="h2">What it earned, paid out, and who held it</h2>
              <p className="lede">
                Hand-overs and payouts come from the purse&rsquo;s own on-chain log ({data.history.total <= 12 ? `all ${data.history.total} of them` : `the last 12 of ${data.history.total}`}); plantings, claims and royalties come from
                the dish&rsquo;s ledger, read in this browser.
              </p>
              <h3 className="h3" style={{ marginTop: 28 }}>Who has held it</h3>
              <ul className={l.holders}>
                {holders.map((h, i) => (
                  <li key={i}>
                    <span><a href={accountUrl(h.account, net.network)} style={{ color: "var(--bone)" }}>{shortAccount(h.account, 30)}</a> {h.how}</span>
                    <span>{new Date(h.at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              <dl className={l.stats} style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <div>
                  <dt>Paid out to holders</dt>
                  <dd className="num">{nearText(info.near_out)} NEAR<small>{petriText(info.petri_out)} PETRI</small></dd>
                </div>
                <div>
                  <dt>Paid to sellers</dt>
                  <dd className="num">{nearText(info.sales_volume)} NEAR<small>across {info.sales} {info.sales === 1 ? "sale" : "sales"}</small></dd>
                </div>
              </dl>
              {(sponsored > 0n || binding.length > 0) && (
                <p className="muted small" style={{ marginTop: 18 }}>
                  {sponsored > 0n ? `${nearText(sponsored)} NEAR of its credit is sponsored and its sponsors may reclaim it. ` : ""}
                  {binding.length ? `${binding.length} pact${binding.length === 1 ? "" : "s"} bind its colony: it may not plant near the colonies they protect.` : ""}
                </p>
              )}
            </div>
            <div>
              <table className={l.table}>
                <thead>
                  <tr>
                    <th>When</th>
                    <th>What</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={i}>
                      <td>{new Date(r.at).toLocaleString()}</td>
                      <td>
                        <span className={`${l.tag} ${r.dir === "in" ? l.tagIn : r.dir === "out" ? l.tagOut : r.dir === "hand" ? l.tagHand : ""}`}>{r.kind}</span> {r.what}
                      </td>
                      <td className="num">{r.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 12 && (
                <button className="btn btn-ghost btn-small" style={{ marginTop: 16 }} onClick={() => setAll((x) => !x)}>
                  {all ? "Show the latest 12" : `Show all ${rows.length}`}
                </button>
              )}
              {ledger.status === "loading" && <p className="muted small">Reading the ledger for plantings and royalties…</p>}
            </div>
          </div>
        </div>
      </section>

      <section id="living-control" data-section="How control passes" className="band band-paper" aria-labelledby="lv-ctrl">
        <div className="wrap">
          <div className={l.top}>
            <div>
              <h2 id="lv-ctrl" className="h2">How control passes, and why the seller keeps nothing</h2>
              <p className="lede" style={{ color: "var(--ink-2)" }}>
                Control is one field in the purse, its holder, checked in the same step as everything it guards. Moving the token rewrites that field; there is no
                key to keep and no check that could go stale.
              </p>
              <p><a className="btn btn-ink btn-small" href={`${REPO}/blob/main/docs/SLIDES-THREAT-MODEL.md`}>Read the threat model</a></p>
            </div>
            <ol className={l.rules}>
              <li><b>No keys, ever.</b> The factory creates the account, funds it, deploys the purse and names the holder in one receipt without adding a key. The count above is read live.</li>
              <li><b>Only the holder.</b> Acting, withdrawing NEAR or PETRI, listing and transferring all check the caller against the holder first.</li>
              <li><b>Payouts go to the account.</b> The purse cannot redirect its payouts, sponsor anyone, offer a paying pact or approve anyone on its sealed slide: those calls are not on its list.</li>
              <li><b>Listed means frozen.</b> While it is for sale, nothing leaves it; any change bumps its nonce, and a purchase pinned to an older nonce fails.</li>
              <li><b>Nothing in flight.</b> While a call it made is still on its way, it cannot change hands.</li>
              <li><b>Approvals die with a sale.</b> Every transfer clears them and refunds their storage.</li>
            </ol>
          </div>
        </div>
      </section>

      <Darkroom sl={sl} net={net} purse={purse} data={data} refresh={refresh} />
    </>
  );
}

function TxNote({ r, net }: { r: { hash?: string; error?: string } | null; net: Net }) {
  if (!r) return null;
  return (
    <p className={l.result} role="status">
      {r.error ? <span className={l.gateBad}>{r.error}</span> : r.hash ? <>Done: <a href={txUrl(r.hash, net.network)}>{r.hash.slice(0, 10)}…</a></> : "Waiting for the wallet…"}
    </p>
  );
}

function useTx(refresh: () => void) {
  const [r, setR] = useState<{ hash?: string; error?: string } | null>(null);
  const run = async (f: () => Promise<{ hash: string }>) => {
    setR({});
    try {
      const out = await f();
      setR({ hash: out.hash });
      setTimeout(refresh, 1500);
    } catch (e) {
      setR({ error: e instanceof Error ? e.message : String(e) });
    }
  };
  return { r, run };
}

function BuyBox({ purse, info, net, refresh }: { purse: string; info: PurseInfo; net: Net; refresh: () => void }) {
  const player = usePlayer();
  const { r, run } = useTx(refresh);
  return (
    <div className={l.banner}>
      <span>
        For sale on its own market: <b className="num">{nearText(info.price!)} NEAR</b>, pinned to nonce {info.nonce}. If anything changes before your purchase lands, it fails and costs you nothing.
      </span>
      <button className="btn btn-amber btn-small" disabled={player?.kind !== "wallet" || player.accountId === info.holder} onClick={() => run(() => walletCallTo(purse, "buy", { nonce: info.nonce }, 60, BigInt(info.price!)))}>
        {player?.kind !== "wallet" ? "Connect a wallet to buy" : player.accountId === info.holder ? "You hold it" : "Buy it"}
      </button>
      <TxNote r={r} net={net} />
    </div>
  );
}

function SealBand({ sl, net, purse }: { sl: Slide; net: Net; purse: string }) {
  const player = usePlayer();
  const factory = FACTORIES[net.network]!;
  const [cost, setCost] = useState<bigint | null>(null);
  const [credit, setCredit] = useState<bigint>(0n);
  const [tick, setTick] = useState(0);
  const { r, run } = useTx(() => setTick((x) => x + 1));
  const mine = !!player && player.accountId === sl.owner;
  useEffect(() => {
    let stop = false;
    viewOn<string>(net.network, factory, "create_cost").then((c) => !stop && setCost(BigInt(c)), () => {});
    if (player) viewOn<string>(net.network, factory, "credit_of", { account_id: player.accountId }).then((c) => !stop && setCredit(BigInt(c)), () => {});
    return () => {
      stop = true;
    };
  }, [net.network, factory, player, tick]);
  const owed = cost !== null && credit < cost ? cost - credit : 0n;
  return (
    <section id="living" data-section="Make it a living slide" className="band band-2" aria-labelledby="lv-seal">
      <div className="wrap">
        <div className={l.top}>
          <div>
            <h2 id="lv-seal" className="h2">Make it a living slide</h2>
            <p className="lede">
              Its holder can seal this slide into an account of its own, <code style={{ fontFamily: "var(--body)", color: "var(--amber-2)" }}>{purse}</code>. The account never
              has a key. It owns the slide, so royalties are paid into it. It can join the dish as a colony and plant the slide&rsquo;s own pattern, so its cells earn there.
              And it is a NEAR collectible of its own: sell it and the account, its NEAR, its PETRI and its colony all go to the buyer.
            </p>
            <p className="muted small">Sealing is for good: the slide stays inside its account. The account&rsquo;s storage, about {cost !== null ? nearText(cost, 3) : "0.32"} NEAR, is paid once and stays in it.</p>
          </div>
          <div>
            <ol className={l.rules} style={{ color: "var(--text-2)" }}>
              <li>Pay the factory the account&rsquo;s storage{cost !== null ? `: ${nearText(cost, 3)} NEAR` : ""}{credit > 0n ? ` (you have ${nearText(credit, 3)} NEAR prepaid)` : ""}.</li>
              <li>Send the slide to the factory with <code>nft_transfer_call</code>. In one receipt it creates the account with the purse code and no key, then moves the slide in and makes you its holder. If anything fails, the slide comes back.</li>
              <li>From the account&rsquo;s darkroom on this page, have it join the dish and plant the slide&rsquo;s pattern.</li>
            </ol>
            {mine && player?.kind === "wallet" ? (
              <div className={l.row} style={{ marginTop: 20 }}>
                <button className="btn btn-ghost" disabled={owed === 0n} onClick={() => run(() => walletCallTo(factory, "prepay", {}, 30, owed < YOCTO / 100n ? YOCTO / 100n : owed))}>
                  {owed === 0n ? "Storage prepaid" : `1. Prepay ${nearText(owed, 3)} NEAR`}
                </button>
                <button className="btn btn-amber" disabled={owed > 0n} onClick={() => run(() => walletCallTo(net.contract, "nft_transfer_call", { receiver_id: factory, token_id: sl.id, msg: "" }, 300, 1n))}>
                  2. Seal it
                </button>
              </div>
            ) : (
              <p className="muted small" style={{ marginTop: 18 }}>
                {mine ? "Connect a NEAR wallet to seal it: a guest's key may only call the dish." : `Only its holder, ${shortAccount(sl.owner, 30)}, can seal it.`}
              </p>
            )}
            <TxNote r={r} net={net} />
          </div>
        </div>
      </div>
    </section>
  );
}

type Gate = { status: "idle" | "signing" | "ok" | "refused"; why?: string; checkedAt?: string };

function Darkroom({ sl, net, purse, data, refresh }: { sl: Slide; net: Net; purse: string; data: PurseData; refresh: () => void }) {
  const player = usePlayer();
  const [gate, setGate] = useState<Gate>({ status: "idle" });
  const holder = data.info.holder;
  const isHolder = !!player && player.accountId === holder;
  // A new holder, or a different player, closes the door again.
  useEffect(() => setGate({ status: "idle" }), [holder, player?.accountId]);

  const open = async () => {
    setGate({ status: "signing" });
    try {
      const issued = new Date().toISOString();
      const nonce = crypto.getRandomValues(new Uint8Array(32));
      const recipient = window.location.host;
      const sig = await walletSignMessage(darkroomMessage(sl.id, net.network, issued), recipient, nonce);
      let bin = "";
      nonce.forEach((b) => (bin += String.fromCharCode(b)));
      const res = await fetch("/api/living/gate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ net: net.network, token: sl.id, accountId: sig.accountId, publicKey: sig.publicKey, signature: sig.signature, issued, nonce: btoa(bin), recipient }),
      });
      const body = await res.json().catch(() => ({}));
      setGate(body.ok ? { status: "ok", checkedAt: body.checkedAt } : { status: "refused", why: body.why ?? `the door did not answer (${res.status})` });
    } catch (e) {
      setGate({ status: "refused", why: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <section id="darkroom" data-section="The darkroom" className="band" aria-labelledby="lv-dark">
      <div className="wrap">
        <div className={l.darkroom}>
          <p className={l.safelight}><i /> Holders only</p>
          <h2 id="lv-dark" className="h2">The darkroom</h2>
          {gate.status !== "ok" ? (
            <>
              <p className="lede">
                Where the slide&rsquo;s holder develops its future and works its account. The door opens for {shortAccount(holder, 30)} alone: sign a fresh message with
                your wallet (NEP-413), and the server checks the signature, that the key is a full-access key of your account, and that the purse names you its holder
                right now.
              </p>
              <div className={l.row} style={{ marginTop: 18 }}>
                <button className="btn btn-amber" onClick={open} disabled={gate.status === "signing" || player?.kind !== "wallet"}>
                  {player?.kind !== "wallet" ? "Connect a NEAR wallet first" : gate.status === "signing" ? "Waiting for the signature…" : "Sign and open the door"}
                </button>
              </div>
              {player?.kind === "wallet" && !isHolder && <p className={l.gateMsg}>You are signed in as {shortAccount(player.accountId, 30)}, not its holder: the server will refuse, and say why.</p>}
              {gate.status === "refused" && <p className={`${l.gateMsg} ${l.gateBad}`}>The door stays shut: {gate.why}.</p>}
            </>
          ) : (
            <Inside sl={sl} net={net} purse={purse} data={data} refresh={refresh} checkedAt={gate.checkedAt!} />
          )}
        </div>
      </div>
    </section>
  );
}

const HORIZON = 1000;

function Inside({ sl, net, purse, data, refresh, checkedAt }: { sl: Slide; net: Net; purse: string; data: PurseData; refresh: () => void; checkedAt: string }) {
  const d = useDish();
  const { rules } = useLive();
  const [fc, setFc] = useState<{ series: number[]; diedAt: number | null; peak: number; end: number; from: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState("1");
  const [to, setTo] = useState("");
  const { r, run } = useTx(refresh);
  const colonyId = data.colony?.id ?? null;

  const develop = () => {
    const e = currentEngine();
    if (!e || colonyId === null) return;
    setBusy(true);
    setTimeout(() => {
      const c = e.clone_engine();
      const series: number[] = [];
      let diedAt: number | null = null;
      try {
        for (let t = 1; t <= HORIZON; t++) {
          c.step(1);
          if (t % 5 === 0) {
            const n = c.live_counts()[colonyId] ?? 0;
            series.push(n);
            if (n === 0 && diedAt === null) diedAt = t;
          }
        }
      } finally {
        c.free();
      }
      setFc({ series, diedAt, peak: Math.max(0, ...series), end: series[series.length - 1] ?? 0, from: e.generation() });
      setBusy(false);
    }, 30);
  };

  const replant = async () => {
    const e = currentEngine();
    if (!e || colonyId === null || !sl.cells || !rules) throw new Error("The dish is still loading.");
    const { width: w, height: h, buffer, max_plant_cells: maxCells } = rules;
    for (let t = 0; t < 300; t++) {
      const x0 = Math.floor(Math.random() * w);
      const y0 = Math.floor(Math.random() * h);
      const cells = sl.cells.map(([dx, dy]) => ((y0 + dy) % h) * w + ((x0 + dx) % w));
      if (e.check_plant(colonyId, new Uint32Array(cells), buffer, maxCells) !== "") continue;
      const note = `Living slide ${sl.id} plants its own specimen.`;
      const deposit = BigInt(await getPlantDeposit(cells.length, note.length, sl.id));
      return walletCallTo(purse, "act", { method: "plant", args: { cells, note, slide: sl.id } }, 300, deposit);
    }
    throw new Error("No legal spot for the pattern right now; try again in a few generations.");
  };

  const W = 600;
  const H = 150;
  const path = fc ? fc.series.map((n, i) => `${i ? "L" : "M"}${((i / Math.max(1, fc.series.length - 1)) * W).toFixed(1)},${(H - (n / Math.max(1, fc.peak)) * (H - 10)).toFixed(1)}`).join(" ") : "";

  return (
    <>
      <p className={`${l.gateMsg} ${l.gateOk}`}>Open for {shortAccount(data.info.holder, 30)}: the server checked your signature and the purse&rsquo;s holder at {new Date(checkedAt).toLocaleTimeString()}.</p>
      <div className={l.forecast}>
        <h3 className="h3" style={{ marginTop: 0 }}>Its next {int(HORIZON)} generations</h3>
        <p className="muted small" style={{ margin: "0 0 12px" }}>
          The dish&rsquo;s own Life engine (WebAssembly, the code the contract runs) steps a copy of the board forward. It cannot know what other players will plant, so it is the
          colony&rsquo;s future if nobody touches it.
        </p>
        {colonyId === null ? (
          <p>The purse has not joined the dish yet: there is nothing alive to forecast.</p>
        ) : fc ? (
          <>
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Living cells over ${HORIZON} generations: peak ${fc.peak}, ${fc.end} at the end`}>
              <path d={`${path} L${W},${H} L0,${H} Z`} fill="rgba(242,180,90,0.12)" />
              <path d={path} fill="none" stroke="#f2b45a" strokeWidth="2" />
            </svg>
            <div className={l.forecastFacts}>
              <span><b className="num">{int(d.liveCounts[colonyId] ?? 0)}</b>living now</span>
              <span><b className="num">{int(fc.peak)}</b>at its peak</span>
              <span><b className="num">{fc.diedAt === null ? int(fc.end) : "extinct"}</b>{fc.diedAt === null ? `at generation ${int(fc.from + HORIZON)}` : `by generation ${int(fc.from + fc.diedAt)}`}</span>
            </div>
          </>
        ) : (
          <button className="btn btn-amber btn-small" onClick={develop} disabled={busy || d.status !== "ready"}>{busy ? "Developing…" : "Develop the forecast"}</button>
        )}
      </div>
      <div className={l.controls}>
        <div className={l.control}>
          <b>Keep it alive</b>
          <p>{colonyId === null ? "Have the purse join the dish (0.02 NEAR buys its first PETRI)." : "Plant the slide's own pattern somewhere free, under the licence the purse holds: no royalty, the licence discount."}</p>
          <div className={l.row}>
            {colonyId === null ? (
              <button className="btn btn-amber btn-small" onClick={() => run(() => walletCallTo(purse, "act", { method: "join", args: { name: `Living slide ${sl.id}`, color: sl.color ?? 0xf2b45a } }, 300, 2n * 10n ** 22n))}>Join the dish</button>
            ) : (
              <button className="btn btn-amber btn-small" onClick={() => run(replant)}>Replant its pattern</button>
            )}
            <button className="btn btn-ghost btn-small" disabled={colonyId === null} onClick={() => run(() => walletCallTo(purse, "act", { method: "claim", args: {} }, 300))}>Claim its earnings</button>
          </div>
        </div>
        <div className={l.control}>
          <b>Take out what it holds</b>
          <p>
            {nearText(data.info.available, 4)} NEAR and {petriText(data.petri)} PETRI, paid to you only.
            {!data.storageRegistered ? " Register for PETRI on the dish first (storage_deposit), or the PETRI comes back." : ""}
          </p>
          <div className={l.row}>
            <button className="btn btn-ghost btn-small" disabled={BigInt(data.info.available) === 0n} onClick={() => run(() => walletCallTo(purse, "withdraw", {}, 60, 1n))}>Withdraw NEAR</button>
            <button className="btn btn-ghost btn-small" disabled={BigInt(data.petri) === 0n} onClick={() => run(() => walletCallTo(purse, "ft_withdraw", { amount: data.petri }, 80, 1n))}>Withdraw PETRI</button>
          </div>
        </div>
        <div className={l.control}>
          <b>{data.info.price === null ? "Sell it" : "It is listed"}</b>
          <p>{data.info.price === null ? "List it on its own market. While listed, nothing leaves it." : `For ${nearText(data.info.price)} NEAR. Unlist it to take anything out.`}</p>
          <div className={l.row}>
            {data.info.price === null ? (
              <>
                <input aria-label="Price in NEAR" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 120 }} />
                <button className="btn btn-ghost btn-small" onClick={() => run(() => walletCallTo(purse, "list", { price: (BigInt(Math.round(Number(price) * 1e6)) * 10n ** 18n).toString() }, 30, 1n))}>List for {price} NEAR</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={() => run(() => walletCallTo(purse, "unlist", {}, 30, 1n))}>Unlist</button>
            )}
          </div>
        </div>
        <div className={l.control}>
          <b>Give it away</b>
          <p>The account, its NEAR, PETRI, colony and slide go with the token. You keep nothing.</p>
          <div className={l.row}>
            <input aria-label="Receiver account" placeholder="receiver.testnet" value={to} onChange={(e) => setTo(e.target.value.trim().toLowerCase())} />
            <button className="btn btn-ghost btn-small" disabled={!to} onClick={() => run(() => walletCallTo(purse, "nft_transfer", { receiver_id: to, token_id: sl.id }, 30, 1n))}>Transfer</button>
          </div>
        </div>
      </div>
      <TxNote r={r} net={net} />
    </>
  );
}
