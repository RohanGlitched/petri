"use client";
// One button per mechanic, on the free-play dish: each sends a real transaction from this browser's guest colony
// through the relayer (no wallet, no gas prompt) and shows its hash. The Intents button asks NEAR Intents' 1Click for a
// dry mainnet quote, which commits to nothing.

import { useEffect, useState } from "react";
import { getColonyOf, getPlantDeposit, getSlideDeposit, getSlides, getState, slideBits, type Colony } from "@/lib/chain";
import { EXPLORERS, FREE_PLAY } from "@/lib/config";
import { currentEngine, refreshDish, useDish } from "@/lib/dish-store";
import { findSpot, findSpotFor, ownRect, relaySteps, savedGuest, slideOffsets, type Sent } from "@/lib/lab";
import { ORIGINS } from "@/lib/intents";
import { createGuest, JOIN_NEAR } from "@/lib/wallet";
import s from "./proof.module.css";

type Out = { busy: boolean; sent?: Sent; text?: string };
const TX = (h: string) => `${EXPLORERS.testnet}/txns/${h}`;
const BUY_CREDIT = 5n * 10n ** 21n;

export function Mechanics() {
  const dish = useDish();
  const [me, setMe] = useState<{ account: string; colony: Colony | null } | null>(null);
  const [out, setOut] = useState<Record<string, Out>>({});
  const [ready, setReady] = useState(false);

  const look = async () => {
    const g = savedGuest();
    if (!g) return setMe(null);
    const colony = await getColonyOf(g.accountId).catch(() => null);
    setMe({ account: g.accountId, colony });
  };
  useEffect(() => {
    setReady(true);
    look();
  }, []);

  const run = (id: string, f: () => Promise<Sent | { text: string }>) => async () => {
    setOut((o) => ({ ...o, [id]: { busy: true } }));
    try {
      const r = await f();
      setOut((o) => ({ ...o, [id]: { busy: false, ...("text" in r ? { text: r.text } : { sent: r }) } }));
      refreshDish();
      look();
    } catch (e) {
      setOut((o) => ({ ...o, [id]: { busy: false, sent: { ok: false, error: e instanceof Error ? e.message : String(e) } } }));
    }
  };

  const colonyId = () => {
    if (!me?.colony) throw new Error("Start a guest colony first (the first button).");
    return me.colony.id;
  };
  const engine = () => {
    const e = currentEngine();
    if (!e || !dish.rules) throw new Error("The dish is still loading; try again in a moment.");
    return { e, rules: dish.rules };
  };
  const plant = async (cells: number[] | null, slide: string | null = null) => {
    if (!cells) throw new Error("No legal place found right now; try again.");
    const deposit = await getPlantDeposit(cells.length, null, slide);
    return relaySteps([{ method: "plant", args: { cells, note: null, credit: deposit, ...(slide ? { slide } : {}) }, tgas: 240 }], null);
  };

  const mechanics: { id: string; title: string; what: string; act: () => Promise<Sent | { text: string }>; needs?: "colony" | "none" }[] = [
    {
      id: "join",
      title: "Start a guest colony",
      what: "Makes a key in this browser, a guest account the relayer pays for, and joins the dish on sponsored credit. No wallet, no seed phrase, no gas prompt.",
      needs: "none",
      act: async () => {
        if (!savedGuest()) await createGuest();
        const g = savedGuest()!;
        if (await getColonyOf(g.accountId).catch(() => null)) return { text: "This browser's guest already has a colony." };
        const hex = g.accountId.slice(2, 6);
        return relaySteps([{ method: "join", args: { name: `Desk ${hex}`, color: 0x9fd8a8, credit: JOIN_NEAR.toString() }, tgas: 240 }], null);
      },
    },
    {
      id: "buy",
      title: "Buy PETRI from the agar",
      what: "Spends 0.005 NEAR of credit on the agar's curve. A guest's PETRI is kept: it can plant it but never sell it for NEAR.",
      act: async () => {
        colonyId();
        return relaySteps([{ method: "buy", args: { credit: BUY_CREDIT.toString() }, tgas: 240 }], null);
      },
    },
    {
      id: "glider",
      title: "Plant a glider",
      what: "Five cells on open ground, priced by the contract's formula; half the price is burned, half returns to the agar.",
      act: async () => {
        const { e, rules } = engine();
        return plant(findSpot(e, rules, colonyId(), "glider", "open"));
      },
    },
    {
      id: "siege",
      title: "Plant a siege (3x the price)",
      what: "A block inside a rival's three-cell buffer. Allowed, so nobody can close the dish, but it costs siege_x times as much.",
      act: async () => {
        const { e, rules } = engine();
        return plant(findSpot(e, rules, colonyId(), "block", "siege"));
      },
    },
    {
      id: "claim",
      title: "Claim",
      what: "Moves what the colony earned into its balance. A guest's tide shares arrive as credit, which needs no claim.",
      act: async () => {
        colonyId();
        return relaySteps([{ method: "claim", args: {}, tgas: 240 }], null);
      },
    },
    {
      id: "slide",
      title: "Mint a specimen slide",
      what: "Fixes a rectangle of the colony's own living cells as an NEP-171 token; it burns 1 PETRI a cell. Needs at least 5 living cells together: plant a beehive first if you have none.",
      act: async () => {
        const { e, rules } = engine();
        const id = colonyId();
        const r = ownRect(e, rules, id, rules.slide_min_cells);
        if (!r) {
          const sent = await plant(findSpot(e, rules, id, "beehive", "open"));
          return sent.ok ? { text: "Your colony had no 5 living cells together, so this planted a beehive. Press again in a few seconds to mint it." } : sent;
        }
        const deposit = await getSlideDeposit(r.w, r.h, null);
        return relaySteps([{ method: "mint_slide", args: { x: r.x, y: r.y, w: r.w, h: r.h, title: null, credit: deposit }, tgas: 240 }], null);
      },
    },
    {
      id: "licence",
      title: "Plant a slide under licence",
      what: "Plants another colony's slide pattern 25% cheaper. A guest pays its 10% royalty to the agar (free play hands no holder PETRI it could sell); a colony that brought NEAR pays the holder.",
      act: async () => {
        const { e, rules } = engine();
        const id = colonyId();
        const st = await getState();
        const all = await getSlides(Math.max(0, Number(st.slides) - 100), 100);
        const pick = all.filter((x) => x.cells >= rules.licence_min_cells && x.owner_id !== me?.account).sort((a, b) => a.cells - b.cells)[0];
        if (!pick) return { text: `No slide of at least ${rules.licence_min_cells} cells held by someone else yet.` };
        return plant(findSpotFor(e, rules, id, slideOffsets(slideBits(pick.bitmap), pick.w, pick.h)), pick.token_id);
      },
    },
    {
      id: "intents",
      title: "Quote a join with USDC (NEAR Intents)",
      what: "Asks 1Click for a dry quote: 1 USDC on Base, swapped to wNEAR and delivered to petri-dish.near to start a colony. Commits to nothing and spends nothing.",
      needs: "none",
      act: async () => {
        const o = ORIGINS[0];
        const r = await fetch("/api/intents/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dry: true, originAsset: o.id, amount: "1000000", for: "", do: "join" }) });
        const b = await r.json();
        if (!r.ok) return { text: `1Click refused the quote: ${b.error ?? r.status}` };
        return { text: `1 ${o.symbol} on ${o.chain} → ${b.quote?.amountOutFormatted ?? "?"} wNEAR to petri-dish.near (about $${b.quote?.amountOutUsd ?? "?"}), quote ${String(b.correlationId ?? "").slice(0, 8)}.` };
      },
    },
  ];

  if (ready && !FREE_PLAY) {
    return (
      <p className={s.note}>
        The buttons play the free testnet dish with a guest colony. <a href="?net=testnet">Switch this page to testnet</a> to use them.
      </p>
    );
  }

  return (
    <>
      <p className={s.note} style={{ marginTop: 0, marginBottom: 16 }}>
        {me ? (
          <>
            This browser&rsquo;s guest: <a href={`${EXPLORERS.testnet}/address/${me.account}`}>{me.account}</a>
            {me.colony ? `, colony ${me.colony.id} “${me.colony.name}”` : ", no colony yet"}.
          </>
        ) : (
          "No guest in this browser yet: the first button makes one."
        )}
      </p>
      <div className={s.cards}>
        {mechanics.map((m) => {
          const o = out[m.id];
          const disabled = !!o?.busy || (m.needs !== "none" && !me?.colony);
          return (
            <article key={m.id} className={s.card}>
              <h3>{m.title}</h3>
              <p>{m.what}</p>
              <button className="btn btn-amber btn-small" onClick={run(m.id, m.act)} disabled={disabled}>
                {o?.busy ? "Sending…" : m.id === "intents" ? "Get a quote" : "Send it"}
              </button>
              {o?.sent && (
                <div className={`${s.result} ${o.sent.ok ? s.resultOk : s.resultBad}`}>
                  {o.sent.ok ? "Done on chain. " : `${o.sent.error} `}
                  {o.sent.hash && <a href={TX(o.sent.hash)}>View the transaction</a>}
                </div>
              )}
              {o?.text && <div className={`${s.result} ${s.resultOk}`}>{o.text}</div>}
            </article>
          );
        })}
        <article className={s.card}>
          <h3>Replay the whole dish</h3>
          <p>Rebuilds every cell, PETRI and yoctoNEAR from generation zero in your browser and checks it against the contract.</p>
          <a className="btn btn-amber btn-small" href="/verify">
            Run /verify
          </a>
        </article>
      </div>
    </>
  );
}
