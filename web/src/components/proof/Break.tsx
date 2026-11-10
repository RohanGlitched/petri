"use client";
// Try to break it: each button signs, with this browser's guest key, a call the contract should refuse, and sends it
// through the relayer as a lab attempt. The refusal comes back as a failed transaction with NEAR's own error text.

import { useEffect, useState } from "react";
import { PACT_DEPOSIT, getColonyOf, getPact, getPlantDeposit, getRules, getState, type Colony } from "@/lib/chain";
import { CONTRACT, EXPLORERS, FREE_PLAY, REPO } from "@/lib/config";
import { currentEngine, refreshDish, useDish } from "@/lib/dish-store";
import { findSpot, ownRect, relaySteps, rivalCell, savedGuest, type Sent, type Step } from "@/lib/lab";
import { createGuest, JOIN_NEAR } from "@/lib/wallet";
import s from "./proof.module.css";

type Attempt = { id: string; title: string; why: string; build: () => Promise<Step[] | string> };
type Res = { busy: boolean; sent?: Sent; note?: string };
type Tally = { total: number; by: Record<string, number>; recent: { attempt: string; hash: string; text: string; at: number }[]; shared: boolean };
const TX = (h: string) => `${EXPLORERS.testnet}/txns/${h}`;

/** Refusals recorded with near-cli from ordinary testnet accounts, for what a guest's key cannot even ask. */
export const RECORDED: { title: string; why: string; text: string; hash: string; cmd: string }[] = [
  {
    title: "A free-play colony sends its PETRI to a wallet",
    why: "lab-kept.petri-lab.testnet joined on sponsored credit only, as a guest does, but with a full-access key, so it can attach the 1 yoctoNEAR a transfer needs.",
    text: "free play's PETRI stays in the dish: a colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)",
    hash: "7MNF1BS9oErV9bTvih51KdRQPjEdbZqvBPDH2MvSMDQy",
    cmd: `near contract call-function as-transaction petri-v6.testnet ft_transfer json-args '{"receiver_id":"petri-bench-a.testnet","amount":"1000000","memo":null}' prepaid-gas '30 Tgas' attached-deposit '1 yoctoNEAR' sign-as <your account> network-config testnet sign-with-keychain send`,
  },
  {
    title: "A colony grown on credit brings its own NEAR (v6.5)",
    why: "The same colony, with a block it planted on credit still alive, attaches 0.02 NEAR to buy PETRI, which would turn its free-play cells into NEAR-earning ones.",
    text: "a colony that grew on sponsored credit must let its cells die (or start a new colony) before it brings its own NEAR",
    hash: "FseHY8ihnKznXhrDHgE6DRpDizGj8b82HCMdrwQdfdwj",
    cmd: `near contract call-function as-transaction petri-v6.testnet buy json-args '{}' prepaid-gas '150 Tgas' attached-deposit '0.02 NEAR' sign-as <your account> network-config testnet sign-with-keychain send`,
  },
  {
    title: "Relaunch from an ordinary account",
    why: "relaunch would wipe the dish; only the contract account's own key can run it, at a deploy, and that key goes on 14 November for mainnet.",
    text: "Method relaunch is private",
    hash: "GwMj4tp4s9je1jw383Jzgo51etebFb2WuLuMA8gSVCJ3",
    cmd: `near contract call-function as-transaction petri-v6.testnet relaunch json-args '{"rules":{},"accounts":[]}' prepaid-gas '30 Tgas' attached-deposit '0 NEAR' sign-as <your account> network-config testnet sign-with-keychain send`,
  },
];

export function Break() {
  const dish = useDish();
  const [me, setMe] = useState<{ account: string; colony: Colony | null } | null>(null);
  const [res, setRes] = useState<Record<string, Res>>({});
  const [tally, setTally] = useState<Tally | null>(null);
  const [ready, setReady] = useState(false);
  const [making, setMaking] = useState(false);

  const look = async () => {
    const g = savedGuest();
    if (!g) return setMe(null);
    setMe({ account: g.accountId, colony: await getColonyOf(g.accountId).catch(() => null) });
  };
  const loadTally = () =>
    fetch("/api/lab", { cache: "no-store" })
      .then((r) => r.json())
      .then(setTally)
      .catch(() => {});
  useEffect(() => {
    setReady(true);
    look();
    loadTally();
    const t = setInterval(loadTally, 15000);
    return () => clearInterval(t);
  }, []);

  const ctx = () => {
    const e = currentEngine();
    if (!e || !dish.rules || !dish.state) throw new Error("The dish is still loading; try again in a moment.");
    if (!me?.colony) throw new Error("Make a guest colony first.");
    return { e, rules: dish.rules, state: dish.state, id: me.colony.id };
  };

  const attempts: Attempt[] = [
    {
      id: "mint",
      title: "Mint PETRI to yourself",
      why: "There is no mint: all 1,000,000 PETRI were made once, into the agar. Calls ft_mint.",
      build: async () => [{ method: "ft_mint", args: { account_id: me?.account, amount: "1000000000000" }, tgas: 30 }],
    },
    {
      id: "rules",
      title: "Change the rules",
      why: "No method changes a dish's rules once it starts. Calls set_rules with a feed a thousand times richer.",
      build: async () => {
        const rules = await getRules();
        return [{ method: "set_rules", args: { rules: { ...rules, feed_ppm: rules.feed_ppm * 1000 } }, tgas: 30 }];
      },
    },
    {
      id: "relaunch",
      title: "Relaunch the dish",
      why: "relaunch is private: only the contract account's own key could run it, at a deploy.",
      build: async () => [{ method: "relaunch", args: { rules: await getRules(), accounts: [] }, tgas: 60 }],
    },
    {
      id: "reinit",
      title: "Initialise it again",
      why: "new runs once. A second call would wipe every balance; the SDK refuses it.",
      build: async () => [{ method: "new", args: { rules: await getRules() }, tgas: 30 }],
    },
    {
      id: "transfer",
      title: "Send your free PETRI to a wallet",
      why: "Free play never reaches NEAR: a guest cannot send PETRI. Its key cannot even attach the 1 yoctoNEAR every transfer needs, so the contract refuses at that check first.",
      build: async () => [{ method: "ft_transfer", args: { receiver_id: "petri-bench-a.testnet", amount: "1000000", memo: null }, tgas: 30 }],
    },
    {
      id: "unsponsor",
      title: "Take another sponsor's credit",
      why: "Only the sponsor who gave credit can take back what is left of it. Calls unsponsor on a strain the relayer sponsored.",
      build: async () => [{ method: "unsponsor", args: { account_id: "petri-violet.testnet" }, tgas: 30 }],
    },
    {
      id: "oversell",
      title: "Sell more PETRI than you hold",
      why: "The agar buys back only what a colony holds (and a guest is paid in credit). Tries to sell 1,000,000 PETRI.",
      build: async () => {
        ctx();
        return [{ method: "sell", args: { petri: "1000000000000" }, tgas: 240 }];
      },
    },
    {
      id: "twice",
      title: "Plant twice in one generation",
      why: "One planting per colony per generation. Plants a blinker, then a second one straight after, within the same 15-second generation: the second is refused.",
      build: async () => {
        const { e, rules, id } = ctx();
        const a = findSpot(e, rules, id, "blinker", "open");
        const b = findSpot(e, rules, id, "blinker", "open");
        if (!a || !b) return "No open ground for two blinkers right now; try again.";
        const da = await getPlantDeposit(a.length, null);
        const db = await getPlantDeposit(b.length, null);
        // The first is a real planting; the second is the attempt.
        const first = await relaySteps([{ method: "plant", args: { cells: a, note: null, credit: da }, tgas: 240 }], null);
        if (!first.ok) return `The first planting did not go through (${first.error}); try again.`;
        return [{ method: "plant", args: { cells: b, note: null, credit: db }, tgas: 240 }];
      },
    },
    {
      id: "occupied",
      title: "Plant on a rival's living cells",
      why: "A planting may only bring dead cells to life. Tries to plant a single cell on top of another colony's living one.",
      build: async () => {
        const { e, rules, id } = ctx();
        const r = rivalCell(e, rules, id);
        if (!r) return "No rival cell alive right now.";
        return [{ method: "plant", args: { cells: [r.index], note: null, credit: await getPlantDeposit(1, null) }, tgas: 240 }];
      },
    },
    {
      id: "rival-slide",
      title: "Mint a slide of a rival's cells",
      why: "A slide captures only the minter's own living cells (at least 5). Tries a rectangle around another colony.",
      build: async () => {
        const { e, rules, id } = ctx();
        const others = new Set<number>();
        const cells = e.cells();
        for (let i = 0; i < cells.length; i++) if (cells[i] && cells[i] !== id) others.add(cells[i]);
        for (const o of others) {
          const r = ownRect(e, rules, o, rules.slide_min_cells);
          if (r) return [{ method: "mint_slide", args: { x: r.x, y: r.y, w: r.w, h: r.h, title: "not mine", credit: "20000000000000000000000" }, tgas: 240 }];
        }
        return "No rival holds 5 living cells together right now.";
      },
    },
    {
      id: "pact-pay",
      title: "Pay for a pact with free PETRI",
      why: "Only PETRI a colony could sell pays for a pact; a guest's is kept in the dish. Offers a strain 1 PETRI.",
      build: async () => {
        const { state } = ctx();
        return [{ method: "pact_offer", args: { to: "petri-violet.testnet", petri: "1000000", until: String(Number(state.generation) + 200), credit: PACT_DEPOSIT.toString() }, tgas: 240 }];
      },
    },
    {
      id: "pact-steal",
      title: "Accept a pact made to someone else",
      why: "Only the colony a pact was offered to can accept it (and take its PETRI). Tries the most recent pact.",
      build: async () => {
        ctx();
        const n = Number((await getState()).pacts);
        if (n === 0) return "No pact has been offered on this dish yet.";
        return [{ method: "pact_accept", args: { id: n }, tgas: 50 }];
      },
    },
    {
      id: "pact-break",
      title: "End a binding pact early",
      why: "An accepted pact binds until its generation; nobody, not even its two colonies, can end it sooner.",
      build: async () => {
        ctx();
        const n = Number((await getState()).pacts);
        for (let id = n; id >= Math.max(1, n - 40); id--) {
          const p = await getPact(id).catch(() => null);
          if (p?.binding) return [{ method: "pact_cancel", args: { id }, tgas: 50 }];
        }
        return "No pact is binding right now, so there is none to end early.";
      },
    },
  ];

  const fire = (a: Attempt) => async () => {
    setRes((r) => ({ ...r, [a.id]: { busy: true } }));
    try {
      const steps = await a.build();
      if (typeof steps === "string") return setRes((r) => ({ ...r, [a.id]: { busy: false, note: steps } }));
      const sent = await relaySteps(steps, a.id, a.id === "oversell" || a.id === "occupied" || a.id === "rival-slide");
      // Two plantings both land only when the generation turned between them: that is the rule working, not a break.
      if (a.id === "twice" && sent.ok) setRes((r) => ({ ...r, [a.id]: { busy: false, note: "Both landed: the 15-second generation turned between them, so each was the first of its generation. Try again." } }));
      else setRes((r) => ({ ...r, [a.id]: { busy: false, sent } }));
      loadTally();
      refreshDish();
    } catch (e) {
      setRes((r) => ({ ...r, [a.id]: { busy: false, sent: { ok: false, error: e instanceof Error ? e.message : String(e) } } }));
    }
  };

  const makeGuest = async () => {
    setMaking(true);
    try {
      if (!savedGuest()) await createGuest();
      const g = savedGuest()!;
      if (!(await getColonyOf(g.accountId).catch(() => null))) {
        const r = await relaySteps([{ method: "join", args: { name: `Lab ${g.accountId.slice(2, 6)}`, color: 0xff8f7f, credit: JOIN_NEAR.toString() }, tgas: 240 }], null, false);
        if (!r.ok) throw new Error(r.error);
      }
      await look();
      refreshDish();
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setMaking(false);
    }
  };

  if (ready && !FREE_PLAY) {
    return (
      <p className={s.note}>
        The lab fires its attempts on the free testnet dish with a guest colony. <a href="?net=testnet">Switch this page to testnet</a> to use it.
      </p>
    );
  }

  return (
    <>
      <dl className={s.tiles} style={{ marginBottom: 28 }}>
        <div className={s.tile}>
          <dt>Attempts refused</dt>
          <dd className="num">{tally ? tally.total.toLocaleString("en-US") : "—"}</dd>
          <small>{tally?.shared ? "since the lab opened, every visitor" : "on this server instance since it started"}</small>
        </div>
        <div className={s.tile}>
          <dt>Attempts that got through</dt>
          <dd className="num">0</dd>
          <small>a success would show here as a transaction that changed the dish</small>
        </div>
        <div className={s.tile}>
          <dt>Your guest</dt>
          <dd style={{ fontSize: 16, fontFamily: "var(--body)" }}>{me ? (me.colony ? `colony ${me.colony.id}, “${me.colony.name}”` : "no colony yet") : "none yet"}</dd>
          {(!me || !me.colony) && (
            <button className="btn btn-amber btn-small" style={{ marginTop: 8 }} onClick={makeGuest} disabled={making}>
              {making ? "Making it…" : "Make a guest colony"}
            </button>
          )}
        </div>
      </dl>
      <div className={s.cards}>
        {attempts.map((a) => {
          const r = res[a.id];
          return (
            <article key={a.id} className={s.card}>
              <h3>{a.title}</h3>
              <p>{a.why}</p>
              <button className="btn btn-ghost btn-small" onClick={fire(a)} disabled={!!r?.busy || !me}>
                {r?.busy ? "Trying…" : "Try it"}
              </button>
              {r?.note && <div className={s.result}>{r.note}</div>}
              {r?.sent &&
                (r.sent.ok ? (
                  <div className={`${s.result} ${s.resultBad}`}>
                    It went through. That should not happen: please report it. <a href={TX(r.sent.hash!)}>Transaction</a>
                  </div>
                ) : (
                  <div className={`${s.result} ${r.sent.hash ? s.resultRefused : s.resultBad}`}>
                    {r.sent.hash ? "Refused on chain: " : "Not sent: "}
                    {r.sent.error}
                    {r.sent.raw && <span className={s.panic}>{r.sent.raw}</span>}
                    {r.sent.hash && (
                      <>
                        {" "}
                        <a href={TX(r.sent.hash)}>The failed transaction</a>
                      </>
                    )}
                  </div>
                ))}
              {tally?.by[a.id] ? <span className="muted small">{tally.by[a.id]} refused so far</span> : null}
            </article>
          );
        })}
      </div>
      {tally && tally.recent.length > 0 && (
        <>
          <h3 className="h3" style={{ marginTop: 48 }}>Latest refusals</h3>
          <ol className={s.feed}>
            {tally.recent.slice(0, 12).map((x) => (
              <li key={x.hash} className={s.feedRow}>
                <time>{new Date(x.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</time>
                <span className={s.who}>
                  <b>{attempts.find((a) => a.id === x.attempt)?.title ?? x.attempt}</b>: {x.text}
                </span>
                <span className={`${s.side} ${s.sideBench}`}>refused</span>
                <a href={TX(x.hash)}>tx</a>
              </li>
            ))}
          </ol>
        </>
      )}
      <h3 className="h3" style={{ marginTop: 48 }}>What a guest key cannot even ask, from a wallet</h3>
      <p className={s.note} style={{ marginTop: 0, marginBottom: 16 }}>
        A guest&rsquo;s key cannot attach NEAR, so these were sent with near-cli from a team test account that plays exactly like a guest. Run any of
        them yourself from your own testnet account.
      </p>
      <div className={s.cards}>
        {RECORDED.map((r) => (
          <article key={r.hash} className={s.card}>
            <h3>{r.title}</h3>
            <p>{r.why}</p>
            <div className={`${s.result} ${s.resultRefused}`}>
              Refused on chain: <span className={s.panic}>{r.text}</span> <a href={TX(r.hash)}>The failed transaction</a>
            </div>
            <pre className={s.cli}>{r.cmd}</pre>
          </article>
        ))}
      </div>
      <p className={s.note}>
        Every attempt is a real transaction on {CONTRACT}, signed by your guest key and relayed for free; the relayer allows at most a few dozen lab
        attempts a guest a day. The lab&rsquo;s code is <a href={`${REPO}/blob/main/web/src/components/proof/Break.tsx`}>Break.tsx</a>; what the
        relayer accepts is in <a href={`${REPO}/blob/main/web/src/app/api/relay/route.ts`}>the relay route</a>.
      </p>
    </>
  );
}
