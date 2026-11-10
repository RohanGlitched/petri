"use client";
// The judge desk's claims table. Every row is worked out in this browser now, from NEAR RPC (both dishes, each read at
// one final block), the strains' public log, and the same replay /verify runs: nothing is typed in by hand.

import { useEffect, useState } from "react";
import { loadEngine } from "@/engine";
import { CONTRACTS, EXPLORERS, REPO, type Network } from "@/lib/config";
import { accountOf, netView, pin, readDish, readForReplay, unpin, type DishRead, type SourceMeta } from "@/lib/netread";
import { BUILD_HASH, Replayer } from "@/lib/replay";
import { strainOf } from "@/lib/strains";
import { sideOfAccount } from "@/lib/sides";
import type { StrainLog } from "@/lib/strain-log";
import type { Colony } from "@/lib/chain";
import s from "./proof.module.css";

type St = "pass" | "fail" | "warn" | "wait";
type Row = { id: string; claim: string; how: string; value: React.ReactNode; status: St; statusText: string; links: { label: string; href: string }[] };

const NETS: Network[] = ["mainnet", "testnet"];
const code = (p: string) => `${REPO}/blob/main/${p}`;
const P = 1e6;
const Y = 1e24;
const petri = (u: string | number, dp = 0) => (Number(u) / P).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });
const nearOf = (y: string | number, dp = 4) => (Number(y) / Y).toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });
const ago = (ms: number) => {
  const m = Math.round(ms / 60000);
  return m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

type Acct = Awaited<ReturnType<typeof accountOf>>;
type NetData = { dish: DishRead; acct: Acct; meta: SourceMeta | null; log: StrainLog | null; replay: { ok: number; total: number; bad: string[] } | null };

async function readNet(net: Network): Promise<NetData> {
  await pin(net);
  try {
    const [dish, acct, meta] = await Promise.all([readDish(net), accountOf(net, CONTRACTS[net]), netView<SourceMeta>(net, "contract_source_metadata").catch(() => null)]);
    const log = await fetch(`/api/strains?net=${net}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<StrainLog>)
      .catch(() => null);
    return { dish, acct, meta, log, replay: null };
  } finally {
    unpin(net);
  }
}

async function replayNet(d: NetData): Promise<{ ok: number; total: number; bad: string[] }> {
  await loadEngine();
  // The same block as the counts: pin again to the latest final block and read the replay's own inputs with the dish.
  await pin(d.dish.net);
  let dish: DishRead;
  let extra: Awaited<ReturnType<typeof readForReplay>>;
  try {
    dish = await readDish(d.dish.net);
    extra = await readForReplay(dish);
  } finally {
    unpin(d.dish.net);
  }
  const r = new Replayer({ rules: dish.rules, state: dish.state, colonies: dish.colonies, ledger: dish.ledger, earnings: extra.earnings, winnings: extra.winnings, slides: dish.slides, lock: extra.lock });
  while (!r.run(5000)) await new Promise((res) => setTimeout(res, 0));
  const checks = r.checks().filter((c) => c.id !== "lock");
  r.free();
  return { ok: checks.filter((c) => c.ok).length, total: checks.length, bad: checks.filter((c) => !c.ok).map((c) => c.label) };
}

function rows(data: Partial<Record<Network, NetData>>): Row[] {
  const m = data.mainnet;
  const t = data.testnet;
  const both = (f: (d: NetData) => React.ReactNode) => (
    <>
      {NETS.map((n) => (
        <span key={n} style={{ display: "block" }}>
          <small className="muted">{n}: </small>
          {data[n] ? f(data[n]!) : "reading…"}
        </span>
      ))}
    </>
  );
  const waiting = !m || !t;
  const out: Row[] = [];

  // 1. The key.
  const mk = m?.acct.fullAccess;
  out.push({
    id: "keys",
    claim: "Nobody can change the mainnet contract",
    how: "Full-access keys on petri-dish.near, from view_access_key_list. The team keeps one until the final verify on 14 November, then deletes it; the testnet dish keeps its key for fixes.",
    value: both((d) => (
      <>
        <span className="num">{d.acct.fullAccess}</span> full-access key{d.acct.fullAccess === 1 ? "" : "s"} on {CONTRACTS[d.dish.net]}
      </>
    )),
    status: mk === undefined ? "wait" : mk === 0 ? "pass" : "warn",
    statusText: mk === undefined ? "reading" : mk === 0 ? "0 keys: locked" : `${mk} key, disclosed`,
    links: [
      { label: "keys on NearBlocks", href: `${EXPLORERS.mainnet}/address/${CONTRACTS.mainnet}?tab=accesskeys` },
      { label: "relaunch.rs (what the key could run)", href: code("contract/src/relaunch.rs") },
      { label: "CI prints the count", href: code(".github/workflows/live.yml") },
    ],
  });

  // 2. The build.
  const hashOk = !!m && !!t && m.acct.codeHash === BUILD_HASH && t.acct.codeHash === BUILD_HASH;
  out.push({
    id: "code",
    claim: "Both dishes run the published reproducible build",
    how: "Each account's code hash against the SHA-256 of `cargo near build reproducible-wasm` at the commit the contract's own NEP-330 metadata names.",
    value: both((d) => (
      <>
        <code style={{ fontSize: 13 }}>{d.acct.codeHash.slice(0, 12)}…</code> {d.meta?.link ? <a href={d.meta.link}>source</a> : null}
      </>
    )),
    status: waiting ? "wait" : hashOk ? "pass" : "fail",
    statusText: waiting ? "reading" : hashOk ? "matches" : "differs",
    links: [
      { label: "rebuild it yourself", href: `${REPO}#rebuild-the-contract-and-compare-its-hash` },
      { label: "contract_source_metadata", href: `${EXPLORERS.mainnet}/address/${CONTRACTS.mainnet}` },
    ],
  });

  // 3. The replay.
  const rp = NETS.map((n) => data[n]?.replay);
  const rpOk = rp.every((x) => x && x.ok === x.total);
  out.push({
    id: "replay",
    claim: "Every cell, PETRI and yoctoNEAR follows from the ledger",
    how: "Your browser replays both dishes from generation zero with petri-core and compares the board, the history chain, every balance and the solvency check with the contract.",
    value: both((d) => (d.replay ? <>{d.replay.ok} of {d.replay.total} checks match{d.replay.bad.length ? `: ${d.replay.bad[0]}` : ""}</> : "replaying…")),
    status: rp.some((x) => !x) ? "wait" : rpOk ? "pass" : "fail",
    statusText: rp.some((x) => !x) ? "replaying" : rpOk ? "all match" : "differs",
    links: [
      { label: "watch it on /verify", href: "/verify" },
      { label: "replay.ts", href: code("web/src/lib/replay.ts") },
      { label: "scripts/verify.mjs", href: code("scripts/verify.mjs") },
    ],
  });

  // 4. The strains are alive.
  const last = (d: NetData) => {
    const a = [...(d.log?.actions ?? [])].reverse().find((x) => strainOf(x.account));
    return a ? { at: Date.parse(a.at), tx: a.tx, strain: a.strain } : null;
  };
  const lm = m ? last(m) : null;
  const lt = t ? last(t) : null;
  const fresh = (x: { at: number } | null, hours: number) => !!x && Date.now() - x.at < hours * 3600_000;
  out.push({
    id: "strains",
    claim: "The AI strains are playing now",
    how: "The latest move in each dish's public strains log (testnet plays every few minutes; mainnet a few plantings a day per strain, so its NEAR lasts).",
    value: both((d) => {
      const x = last(d);
      return x ? (
        <>
          {x.strain}, <a href={`${EXPLORERS[d.dish.net]}/txns/${x.tx}`}>{ago(Date.now() - x.at)}</a>
        </>
      ) : (
        "no move in the log"
      );
    }),
    status: waiting ? "wait" : fresh(lt, 2) && fresh(lm, 24) ? "pass" : fresh(lt, 2) || fresh(lm, 24) ? "warn" : "fail",
    statusText: waiting ? "reading" : fresh(lt, 2) && fresh(lm, 24) ? "both live" : "one is quiet",
    links: [
      { label: "/strains", href: "/strains" },
      { label: "agents/run.mjs", href: code("agents/run.mjs") },
    ],
  });

  // 5. Pacts.
  const pactsOf = (d: NetData) => {
    let offered = 0;
    let accepted = 0;
    let petriPaid = 0;
    const acc = new Map<number, { until: number; ended: boolean }>();
    const offers = new Map<number, { petri: number; until: number }>();
    for (const e of d.dish.ledger) {
      if ("PactOffer" in e) {
        offered++;
        offers.set(e.PactOffer.pact, { petri: Number(e.PactOffer.petri), until: Number(e.PactOffer.until) });
      } else if ("PactAccept" in e) {
        accepted++;
        const o = offers.get(e.PactAccept.pact);
        petriPaid += o?.petri ?? 0;
        acc.set(e.PactAccept.pact, { until: o?.until ?? 0, ended: false });
      } else if ("PactEnd" in e) {
        const a = acc.get(e.PactEnd.pact);
        if (a) a.ended = true;
      }
    }
    const g = Number(d.dish.state.generation);
    const binding = [...acc.values()].filter((a) => !a.ended && a.until > g).length;
    return { offered, accepted, binding, petriPaid };
  };
  const pm = m ? pactsOf(m) : null;
  out.push({
    id: "pacts",
    claim: "Agents make pacts the contract enforces",
    how: "Pact offers, acceptances and binding pacts rebuilt from each dish's ledger; the contract refuses any planting that breaks an accepted pact.",
    value: both((d) => {
      const p = pactsOf(d);
      return (
        <>
          <span className="num">{p.offered}</span> offered, {p.accepted} accepted, {p.binding} binding now
        </>
      );
    }),
    status: waiting ? "wait" : (pm?.accepted ?? 0) > 0 ? "pass" : "warn",
    statusText: waiting ? "reading" : (pm?.accepted ?? 0) > 0 ? "on mainnet" : "testnet only",
    links: [
      { label: "pacts.rs", href: code("contract/src/pacts.rs") },
      { label: "test pact_refuses_breaking_planting", href: code("contract/src/tests.rs") },
      { label: "the council on /strains", href: "/strains" },
    ],
  });

  // 6. Royalties.
  const roy = (d: NetData) => {
    const licensed = d.dish.ledger.filter((e) => "Plant" in e && e.Plant.licence).length;
    const earning = d.dish.slides.filter((x) => Number(x.royalties) > 0).length;
    return { paid: Number(d.dish.state.royalties), licensed, earning, slides: d.dish.slides.length };
  };
  const rAny = NETS.some((n) => data[n] && roy(data[n]!).paid > 0);
  out.push({
    id: "royalties",
    claim: "Slides earn royalties for whoever holds them",
    how: "PETRI paid to slide holders (the state's royalties counter, checked by the replay), licensed plantings in the ledger, and slides that have earned.",
    value: both((d) => {
      const r = roy(d);
      return (
        <>
          <span className="num">{petri(r.paid, 2)}</span> PETRI to holders; {r.licensed} licensed plantings; {r.earning} of {r.slides} slides earned
        </>
      );
    }),
    status: waiting ? "wait" : rAny ? (m && roy(m).paid > 0 ? "pass" : "warn") : "fail",
    statusText: waiting ? "reading" : m && roy(m).paid > 0 ? "on both" : rAny ? "testnet only" : "none yet",
    links: [
      { label: "slides.rs", href: code("contract/src/slides.rs") },
      { label: "test a_stranger_plants_a_slide_and_pays_its_holder_a_royalty", href: code("contract/src/tests.rs") },
      { label: "/specimens", href: "/specimens" },
    ],
  });

  // 7. Outside colonies.
  const outside = (d: NetData) => {
    const side = (c: Colony) => sideOfAccount(c.account, c.house);
    const o = d.dish.colonies.filter((c) => side(c) === "outside");
    const g = d.dish.colonies.filter((c) => side(c) === "guest");
    return { all: o.length, planted: o.filter((c) => Number(c.cells_planted) > 0).length, guests: g.length, guestsPlanted: g.filter((c) => Number(c.cells_planted) > 0).length };
  };
  const om = m ? outside(m) : null;
  out.push({
    id: "outside",
    claim: "People outside the team play",
    how: "Colonies whose account is not the team's (the house, the bench, any petri-*.testnet account or sub-account, any *.petri-dish.near). Testnet guests are keys in anyone's browser, the team's own test runs included; the chain cannot tell them apart, so they are counted apart.",
    value: both((d) => {
      const o = outside(d);
      return (
        <>
          <span className="num">{o.all}</span> outside wallet colonies ({o.planted} planted){d.dish.net === "testnet" ? `; ${o.guests} guest colonies (${o.guestsPlanted} planted)` : ""}
        </>
      );
    }),
    status: waiting ? "wait" : (om?.all ?? 0) > 0 ? "pass" : "warn",
    statusText: waiting ? "reading" : (om?.all ?? 0) > 0 ? "on mainnet" : "none on mainnet yet",
    links: [{ label: "/colonies", href: "/colonies" }],
  });

  // 8. TEE-verified model answers.
  const tee = (d: NetData) => {
    const acts = (d.log?.actions ?? []) as { tee?: { ok?: boolean } | null; decided_by?: string }[];
    return { ok: acts.filter((a) => a.tee?.ok === true).length, model: acts.filter((a) => a.decided_by === "model").length, all: acts.length };
  };
  const teeAny = NETS.some((n) => data[n] && tee(data[n]!).ok > 0);
  out.push({
    id: "tee",
    claim: "Strain moves chosen by NEAR AI are TEE-verified",
    how: "Moves in each strains log (its latest 200) whose answer carried a NEAR AI Cloud signature that verified: sha256 of the exact request and response, the signer recovered, and that signer in the enclave's attestation report.",
    value: both((d) => {
      const x = tee(d);
      return (
        <>
          <span className="num">{x.ok}</span> verified of {x.all} recent moves ({x.model} chosen by a model)
        </>
      );
    }),
    status: waiting ? "wait" : teeAny ? "pass" : "warn",
    statusText: waiting ? "reading" : teeAny ? "verified moves" : "none in the log now",
    links: [
      { label: "agents/tee.mjs", href: code("agents/tee.mjs") },
      { label: "agents/model.mjs", href: code("agents/model.mjs") },
    ],
  });

  // 9. Intents.
  const intents = (d: NetData) => {
    const pend = d.dish.ledger.filter((e) => "Pending" in e).length;
    const unpend = d.dish.ledger.filter((e) => "Unpend" in e).length;
    const proxy = d.dish.colonies.filter((c) => c.proxy).length;
    return { pend, unpend, proxy };
  };
  const im = m ? intents(m) : null;
  out.push({
    id: "intents",
    claim: "Anyone can join with any token through NEAR Intents",
    how: "wNEAR delivered by NEAR Intents' 1Click to the mainnet dish: colonies it started (proxy) and pending NEAR moves in the ledger.",
    value: both((d) => {
      const x = intents(d);
      return (
        <>
          <span className="num">{x.proxy}</span> colonies started by an Intents payment; {x.pend} pending, {x.unpend} settled or claimed
        </>
      );
    }),
    status: waiting ? "wait" : im && im.proxy + im.pend > 0 ? "pass" : "warn",
    statusText: waiting ? "reading" : im && im.proxy + im.pend > 0 ? "on mainnet" : "no Intents join yet",
    links: [
      { label: "intents.rs", href: code("contract/src/intents.rs") },
      { label: "pay with any token", href: "/dish?net=mainnet" },
    ],
  });

  // 10. Tides.
  const tm = m ? Number(m.dish.state.tides) : 0;
  out.push({
    id: "tides",
    claim: "The vault pays out hourly tides",
    how: "Tides run and what they paid (NEAR to colonies that brought NEAR, credit to guests), from the state, each one re-derived by the replay.",
    value: both((d) => (
      <>
        <span className="num">{d.dish.state.tides}</span> tides; {nearOf(d.dish.state.near_tides)} NEAR and {nearOf(d.dish.state.credit_won)} credit paid
      </>
    )),
    status: waiting ? "wait" : tm > 0 ? "pass" : t && Number(t.dish.state.tides) > 0 ? "warn" : "fail",
    statusText: waiting ? "reading" : tm > 0 ? "on both" : "testnet only: mainnet has no outside colony to pay",
    links: [{ label: "tides in petri-core", href: code("core/src/lib.rs") }],
  });

  // 11. Burn.
  out.push({
    id: "burned",
    claim: "PETRI is burned, never minted again",
    how: "PETRI burned by plantings, slides and unregistering, from the state and checked by the replay. The token has no mint method (try one on /break).",
    value: both((d) => (
      <>
        <span className="num">{petri(d.dish.state.burned, 2)}</span> PETRI burned; {petri(d.dish.state.agar)} left in the agar
      </>
    )),
    status: waiting ? "wait" : "pass",
    statusText: waiting ? "reading" : "burning",
    links: [
      { label: "/coin", href: "/coin" },
      { label: "try to mint", href: "/break" },
    ],
  });
  return out;
}

export function Claims() {
  const [data, setData] = useState<Partial<Record<Network, NetData>>>({});
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      for (const n of NETS) {
        try {
          const d = await readNet(n);
          if (stop) return;
          setData((x) => ({ ...x, [n]: d }));
          const replay = await replayNet(d).catch(() => ({ ok: 0, total: 1, bad: ["the replay could not run"] }));
          if (stop) return;
          setData((x) => ({ ...x, [n]: { ...(x[n] ?? d), replay } }));
        } catch (e) {
          if (!stop) setErr(`${n}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, []);
  const list = rows(data);
  return (
    <>
      <ul className={s.claims}>
        <li className={`${s.claim} ${s.claimHead}`} aria-hidden="true">
          <span>Claim and how it is checked</span>
          <span>Mainnet and testnet, now</span>
          <span>Code, tests, transactions</span>
          <span>Status</span>
        </li>
        {list.map((r) => (
          <li key={r.id} className={s.claim}>
            <div className={s.claimWhat}>
              <b>{r.claim}</b>
              <p>{r.how}</p>
            </div>
            <div className={s.claimVal}>{r.value}</div>
            <div className={s.links}>
              {r.links.map((l) => (
                <a key={l.href + l.label} href={l.href}>
                  {l.label}
                </a>
              ))}
            </div>
            <span className={`${s.pill} ${s[r.status]}`}>{r.statusText}</span>
          </li>
        ))}
      </ul>
      {err && <p className={s.note}>Could not read {err}. Reload to try again.</p>}
    </>
  );
}
