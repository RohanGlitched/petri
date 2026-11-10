"use client";
// PETRI's mint and burn log and its supply since genesis, rebuilt in this browser from the contract's ledger with the
// same replay /verify runs (lib/supply.ts). Nothing here is read from a summary: the totals are the replay's, and the
// replay is checked against the contract's own history chain, agar and burn before anything is drawn.

import { useEffect, useMemo, useState } from "react";
import { getAllColonies, getAllLedger, getAllSlides, getRules, getState, pinFinalBlock, type Colony, type DishState, type Rules } from "@/lib/chain";
import { buildCoinBook, type CoinBook, type EventKind } from "@/lib/supply";
import { CONTRACT, REPO, accountUrl, shortAccount } from "@/lib/config";
import { actionIndex, useStrainLog } from "@/lib/strain-log";
import { sideOf } from "@/lib/strains";
import { useNet } from "@/lib/use-net";
import { LineChart } from "@/components/charts/LineChart";
import { NetTag } from "@/components/site/NetTag";
import s from "./proof.module.css";

const P = 1e6;
const Y = 1e24;
const fp = (u: number, dp = 0) => (u / P).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const fn = (y: number, dp = 4) => (y / Y).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const KINDS: { id: EventKind | "all"; label: string }[] = [
  { id: "all", label: "Everything" },
  { id: "feed", label: "Fed to cells" },
  { id: "buy", label: "Bought" },
  { id: "sell", label: "Sold back" },
  { id: "plant", label: "Plantings" },
  { id: "slide", label: "Slides" },
  { id: "royalty", label: "Royalties" },
  { id: "tide", label: "Tides" },
  { id: "pact", label: "Pacts" },
  { id: "burn", label: "Unregistered" },
];
const PAGE = 25;

type Loaded = { rules: Rules; state: DishState; colonies: Colony[]; book: CoinBook };

export function CoinLog() {
  const net = useNet();
  const [phase, setPhase] = useState<"reading" | "replaying" | "done" | "error">("reading");
  const [prog, setProg] = useState(0);
  const [err, setErr] = useState("");
  const [data, setData] = useState<Loaded | null>(null);
  const [kind, setKind] = useState<EventKind | "all">("all");
  const [page, setPage] = useState(0);
  const log = useStrainLog();

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        await pinFinalBlock();
        let rules, state, colonies, ledger, slides;
        try {
          [rules, state] = await Promise.all([getRules(), getState()]);
          [colonies, ledger, slides] = await Promise.all([getAllColonies(state.colonies), getAllLedger(Number(state.ledger)), getAllSlides(Number(state.slides))]);
        } finally {
          await pinFinalBlock(false);
        }
        if (stop) return;
        setPhase("replaying");
        const book = await buildCoinBook({ rules, state, colonies, ledger, slides }, (g, of) => !stop && setProg(g / Math.max(1, of)));
        if (stop) return;
        setData({ rules, state, colonies, book });
        setPhase("done");
      } catch (e) {
        if (!stop) {
          setErr(e instanceof Error ? e.message : String(e));
          setPhase("error");
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, []);

  const byId = useMemo(() => new Map((data?.colonies ?? []).map((c) => [c.id, c])), [data]);
  const idx = useMemo(() => actionIndex(log?.actions ?? []), [log]);
  const events = useMemo(() => {
    const all = (data?.book.events ?? []).filter((e) => kind === "all" || e.kind === kind);
    return [...all].reverse();
  }, [data, kind]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of data?.book.events ?? []) m.set(e.kind, (m.get(e.kind) ?? 0) + 1);
    return m;
  }, [data]);
  useEffect(() => setPage(0), [kind]);

  if (phase !== "done" || !data) {
    return (
      <div className={s.sect} aria-live="polite">
        <p className="lede">
          {phase === "reading" && <>Reading the whole ledger of {CONTRACT} at one final block…</>}
          {phase === "replaying" && <>Replaying PETRI from generation zero with petri-core…</>}
          {phase === "error" && <>The dish could not be read: {err}. Reload to try again.</>}
        </p>
        {phase === "replaying" && (
          <div className={s.progress} aria-hidden="true">
            <i style={{ width: `${(prog * 100).toFixed(1)}%` }} />
          </div>
        )}
      </div>
    );
  }

  const { rules, state, book } = data;
  const t = book.totals;
  const gen = (g: number) => new Date(Number(state.epoch_ms) + g * Number(rules.generation_ms));
  const when = (g: number) => gen(g).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
  const xs = book.points.map((p) => p.g);
  const ok = book.matches.chain && book.matches.agar && book.matches.burned;
  const shown = events.slice(page * PAGE, page * PAGE + PAGE);
  const pages = Math.max(1, Math.ceil(events.length / PAGE));
  const longest = book.longest ? byId.get(book.longest.id) : null;
  const hoursOf = (g: number) => (g * Number(rules.generation_ms)) / 3_600_000;
  const xfmt = (g: number) => {
    const h = hoursOf(g);
    return h >= 48 ? `day ${Math.round(h / 24)}` : `${Math.round(h)} h`;
  };

  return (
    <>
      <section className={s.sect} data-section="Supply now" id="now">
        <div className={s.sectHead}>
          <h2 className="h2">Where every PETRI is <NetTag /></h2>
          <p>
            All {fp(Number(rules.max_supply))} PETRI were in the agar at generation zero, and no call can mint more. Replayed to generation{" "}
            {book.target.toLocaleString("en-US")} in {(book.ms / 1000).toFixed(1)} s;{" "}
            <span className={`${s.pill} ${ok ? s.pass : s.fail}`}>{ok ? "history chain, agar and burn match the contract" : "the replay differs from the contract"}</span>
          </p>
        </div>
        <dl className={s.tiles}>
          <div className={s.tile}>
            <dt>In the agar</dt>
            <dd className="num">{fp(Number(state.agar))}</dd>
            <small>{((100 * Number(state.agar)) / Number(rules.max_supply)).toFixed(3)}% of all PETRI</small>
          </div>
          <div className={s.tile}>
            <dt>Outside the agar</dt>
            <dd className="num">{fp(Number(rules.max_supply) - Number(state.agar) - Number(state.burned))}</dd>
            <small>colonies, unclaimed earnings, keeper pot, pact offers</small>
          </div>
          <div className={s.tile}>
            <dt>Burned for good</dt>
            <dd className="num">{fp(Number(state.burned))}</dd>
            <small>{fp(t.burnedPlant)} by plantings, {fp(t.burnedSlide)} by slides{t.burnedOther > 0 ? `, ${fp(t.burnedOther)} unregistered` : ""}</small>
          </div>
          <div className={s.tile}>
            <dt>Fed to living cells</dt>
            <dd className="num">{fp(t.fed)}</dd>
            <small>the only way PETRI is minted to colonies</small>
          </div>
          <div className={s.tile}>
            <dt>Bought / sold back</dt>
            <dd className="num">{fp(t.bought)} / {fp(t.sold)}</dd>
            <small>for {fn(t.boughtNear, 3)} NEAR in and {fn(t.soldNear, 3)} out</small>
          </div>
          <div className={s.tile}>
            <dt>Tides</dt>
            <dd className="num">{t.tides}</dd>
            <small>{fn(t.tidesNear, 4)} NEAR and {fn(t.tidesCredit, 4)} credit paid; vault holds {fn(Number(state.vault), 4)}</small>
          </div>
        </dl>
      </section>

      <section className={s.sect} data-section="Supply over time" id="chart">
        <div className={s.sectHead}>
          <h2 className="h2">Supply since generation zero</h2>
          <p>One point every tide window ({rules.tide_every} generations, an hour), read off the rebuilt dish. Hover or touch the chart to read every line.</p>
        </div>
        <LineChart
          label="PETRI outside the agar and burned, and the NEAR vault, by generation"
          x={xs}
          fmtX={xfmt}
          fmt={(v) => fp(v)}
          fmtRight={(v) => `${v.toFixed(3)} N`}
          series={[
            { label: "PETRI outside the agar", color: "#e2d5c3", values: book.points.map((p) => p.held) },
            { label: "PETRI burned", color: "#ff8f7f", values: book.points.map((p) => p.burned) },
            { label: "NEAR in the vault", color: "#9fd8a8", values: book.points.map((p) => p.vault), right: true },
            { label: "NEAR paid out by tides", color: "#9fd8a8", values: book.points.map((p) => p.paidOut), right: true, dashed: true },
          ]}
        />
        <div style={{ marginTop: 28 }}>
          <LineChart
            label="PETRI in the agar by generation"
            x={xs}
            fmtX={xfmt}
            height={200}
            fmt={(v) => fp(v)}
            maxLeft={Number(rules.max_supply)}
            series={[{ label: "PETRI in the agar", color: "#f2b45a", values: book.points.map((p) => p.agar) }]}
          />
        </div>
      </section>

      {book.longest && (
        <section className={s.sect} data-section="Longest-lived colony" id="record">
          <div className={s.record}>
            <b className="num">{Math.round(hoursOf(book.longest.to - book.longest.from)).toLocaleString("en-US")} h</b>
            <p>
              <strong>Longest-lived colony:</strong> {longest?.name ?? `colony ${book.longest.id}`}
              {longest ? (
                <>
                  {" "}(<a href={accountUrl(longest.account)}>{shortAccount(longest.account)}</a>, {sideOf(longest.account, longest.house) === "house" ? "a house strain" : sideOf(longest.account) === "bench" ? "the team's bench" : "an outside player"})
                </>
              ) : null}
              , alive without a break from generation {book.longest.from.toLocaleString("en-US")}
              {book.longest.alive ? " and still alive" : ` to ${book.longest.to.toLocaleString("en-US")}`}. Measured on the rebuilt board every 16 generations.
            </p>
          </div>
        </section>
      )}

      <section className={s.sect} data-section="Mint and burn log" id="log">
        <div className={s.sectHead}>
          <h2 className="h2">Every mint and burn</h2>
          <p>
            Each ledger entry that moves PETRI, and each window&rsquo;s feed worked out from the agar&rsquo;s balance. The ledger keeps generations, not
            transaction hashes: house moves link to their transaction from the strains&rsquo; log, everything else to the colony&rsquo;s account on NearBlocks,
            where the call at that time is listed.
          </p>
        </div>
        <div className={s.filters} role="group" aria-label="Show">
          {KINDS.filter((k) => k.id === "all" || counts.get(k.id)).map((k) => (
            <button key={k.id} className={kind === k.id ? s.chipOn : s.chip} onClick={() => setKind(k.id)} aria-pressed={kind === k.id}>
              {k.label}
              <span>{k.id === "all" ? book.events.length : counts.get(k.id)}</span>
            </button>
          ))}
        </div>
        <ol className={s.log}>
          {shown.map((e, i) => {
            const c = e.colony !== null ? byId.get(e.colony) : null;
            const act = c && e.kind === "plant" ? idx.find(c.account, e.g) : undefined;
            return (
              <li key={`${e.index}-${e.kind}-${e.g}-${i}`} className={s.logRow}>
                <span className="num" title={when(e.g)}>
                  gen {e.g.toLocaleString("en-US")}
                  {e.to ? `–${e.to.toLocaleString("en-US")}` : ""}
                </span>
                <span className={`${s.kind} ${e.kind === "feed" ? s.kfeed : e.burned > 0 ? s.kburn : ""}`}>{e.kind}</span>
                <span>
                  {e.text}
                  {c ? (
                    <>
                      {" "}· {c.name}{" "}
                      {act?.tx ? <a href={`${net.network === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io"}/txns/${act.tx}`}>tx</a> : <a href={accountUrl(c.account)}>account</a>}
                    </>
                  ) : null}
                </span>
                <span className="num">
                  {e.kind === "tide" ? "" : `${e.kind === "feed" || e.kind === "buy" ? "+" : ""}${fp(e.petri, 2)} PETRI`}
                  {e.burned > 0 ? <small className="muted"> ({fp(e.burned, 2)} burned)</small> : null}
                </span>
                <span className="num">{e.near > 0 ? `${fn(e.near, 4)} N` : ""}</span>
              </li>
            );
          })}
        </ol>
        <div className={s.pager}>
          <button className="btn btn-ghost btn-small" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Newer
          </button>
          <span className="muted small">
            Page {page + 1} of {pages} · {events.length.toLocaleString("en-US")} entries
          </span>
          <button className="btn btn-ghost btn-small" onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
            Older
          </button>
        </div>
        <p className={s.note}>
          The feed is minted to cells every generation; the log groups it by tide window. The replay code is <a href={`${REPO}/blob/main/web/src/lib/supply.ts`}>web/src/lib/supply.ts</a> on top of{" "}
          <a href={`${REPO}/blob/main/web/src/lib/replay.ts`}>replay.ts</a>.
        </p>
      </section>
    </>
  );
}
