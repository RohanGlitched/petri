"use client";
// Pay with any token, on the mainnet dish. The payer sends USDC, ETH, SOL or BTC from their own wallet on its own chain
// to a one-time deposit address; NEAR Intents swaps it into wNEAR and sends that to the dish contract with a message
// saying which NEAR account to join or buy for. This page never sends anything: it asks for a quote, shows where to
// pay, and watches.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Qr } from "@/components/site/Qr";
import { buy_quote } from "@/engine";
import { getColonyOf, getNearBalance, type Colony } from "@/lib/chain";
import { CONTRACT, isAccountId, shortAccount, txUrl } from "@/lib/config";
import {
  ADDRESS_HINT,
  FINAL,
  ORIGINS,
  fromBase,
  getIntentsQuote,
  getIntentsStatus,
  getTokens,
  originById,
  readableIntentsError,
  refundOk,
  saveOrder,
  savedOrders,
  submitDepositTx,
  toBase,
  type Plan,
  type QuoteResponse,
  type SavedOrder,
  type StatusResponse,
  type Token,
} from "@/lib/intents";
import { useLive, hex, int, near, petri } from "@/lib/live";
import { STAINS, firstFreeStain } from "@/lib/stains";
import s from "./intents.module.css";

/** NEAR a join keeps for the new colony's storage before the rest buys PETRI (as on the join form). */
const JOIN_STORAGE = 6n * 10n ** 21n;
/** A floor for the form only: the deposit-address request is checked against the dish's own `intent_minimum` for the order
 * (the server refuses a quote whose guaranteed output is below it; nothing that arrives is ever sent back). */
const MIN_INTENT = 10n ** 22n;
const NAME = /^[A-Za-z0-9 \-'.&!?_,:()]{1,24}$/;

type Stage = { kind: "form" } | { kind: "deposit"; order: SavedOrder };

const STEPS: { key: string; title: string; line: string }[] = [
  { key: "deposit", title: "Waiting for your deposit", line: "Send the exact amount from any wallet you control on that chain." },
  { key: "seen", title: "Deposit seen", line: "The origin chain confirmed it; NEAR Intents takes it from here." },
  { key: "swap", title: "Swapping to NEAR", line: "Solvers fill the swap and the wNEAR is sent to the dish." },
  { key: "done", title: "On the dish", line: "The contract unwrapped the NEAR and did what the message asked." },
];

function stepOf(st: StatusResponse["status"] | undefined): number {
  switch (st) {
    case "KNOWN_DEPOSIT_TX":
    case "INCOMPLETE_DEPOSIT":
      return 1;
    case "PROCESSING":
      return 2;
    case "SUCCESS":
      return 3;
    default:
      return 0;
  }
}

function useCountdown(until: string | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? Math.max(0, new Date(until).getTime() - now) : 0;
  const m = Math.floor(left / 60000);
  const sec = Math.floor((left % 60000) / 1000);
  return { left, text: `${m}:${String(sec).padStart(2, "0")}` };
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={s.copy}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        }, () => {});
      }}
      aria-label={`Copy ${label}`}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

/** The quote and 1Click's signature as a file the payer keeps: the evidence if a swap ever needs disputing. */
/** The app fee a 1Click quote carries, in basis points (1Click adds 20 to quotes made without an API key). */
function appFeeBps(r: QuoteResponse | null | undefined): number {
  const fees = r?.quoteRequest?.appFees;
  return Array.isArray(fees) ? fees.reduce((n, f) => n + (Number.isFinite(Number(f?.fee)) ? Number(f.fee) : 0), 0) : 0;
}

/** The app fee in words, from the quote itself: "0.2% (20 bps), about 0.02 USDC". */
function feeLine(r: QuoteResponse | null | undefined, symbol: string): string | null {
  const bps = appFeeBps(r);
  if (!r || bps <= 0) return null;
  const amount = (Number(r.quote.amountInFormatted) * bps) / 10_000;
  const pct = `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return `${pct}, or ${bps} bps${Number.isFinite(amount) && amount > 0 ? `, about ${amount.toLocaleString("en-US", { maximumSignificantDigits: 3 })} ${symbol}` : ""}`;
}

function receiptUrl(o: SavedOrder) {
  return URL.createObjectURL(new Blob([JSON.stringify(o, null, 2)], { type: "application/json" }));
}

export function PayAnyToken({ open, onClose, account, onLanded }: { open: boolean; onClose: () => void; account: string | null; onLanded: (account: string) => void }) {
  const { d, rules, ready } = useLive();
  const box = useRef<HTMLDialogElement>(null);
  const [stage, setStage] = useState<Stage>({ kind: "form" });

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  // A payment still in flight from an earlier visit picks up where it left off.
  const [resume, setResume] = useState<SavedOrder | null>(null);
  useEffect(() => {
    const last = savedOrders()[0];
    if (last && !FINAL.includes(last.last ?? "PENDING_DEPOSIT") && Date.now() - last.savedAt < 6 * 3600_000) setResume(last);
  }, []);

  return (
    <dialog ref={box} className={s.dialog} onClose={onClose} aria-labelledby="pay-title">
      <div className={s.head}>
        <div>
          <h2 id="pay-title">Pay with any token</h2>
          <p>USDC, ETH, SOL or BTC from another chain becomes NEAR on the dish, through NEAR Intents.</p>
        </div>
        <button className={s.close} onClick={onClose} aria-label="Close">×</button>
      </div>
      {stage.kind === "form" ? (
        <PayForm
          account={account}
          resume={resume}
          onResume={(o) => {
            setResume(null);
            setStage({ kind: "deposit", order: o });
          }}
          onQuoted={(o) => setStage({ kind: "deposit", order: o })}
          colonies={d.colonies}
          agar={d.agar}
          rulesReady={ready && !!rules}
          rules={rules ?? null}
        />
      ) : (
        <Deposit order={stage.order} onRestart={() => setStage({ kind: "form" })} onLanded={onLanded} />
      )}
    </dialog>
  );
}

function PayForm({
  account,
  resume,
  onResume,
  onQuoted,
  colonies,
  agar,
  rulesReady,
  rules,
}: {
  account: string | null;
  resume: SavedOrder | null;
  onResume: (o: SavedOrder) => void;
  onQuoted: (o: SavedOrder) => void;
  colonies: Colony[];
  agar: number;
  rulesReady: boolean;
  rules: ReturnType<typeof useLive>["rules"] | null;
}) {
  const [originId, setOriginId] = useState(ORIGINS[0].id);
  const origin = originById(originId)!;
  const [amount, setAmount] = useState(ORIGINS[0].start);
  const [owner, setOwner] = useState(account ?? "");
  const [name, setName] = useState("");
  const [picked, setPicked] = useState<number | null>(null);
  const [refund, setRefund] = useState("");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [dry, setDry] = useState<{ q: QuoteResponse | null; error: string | null; loading: boolean }>({ q: null, error: null, loading: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // What the chain says about the owning account: whether it exists, and whether it already has a colony.
  const [who, setWho] = useState<{ account: string; exists: boolean | null; colony: Colony | null } | null>(null);

  useEffect(() => {
    if (account && !owner) setOwner(account);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);
  useEffect(() => {
    getTokens().then(setTokens, () => {});
  }, []);

  const ownerId = owner.trim().toLowerCase();
  const ownerOk = isAccountId(ownerId);
  useEffect(() => {
    if (!ownerOk) {
      setWho(null);
      return;
    }
    let live = true;
    const t = setTimeout(async () => {
      const [exists, colony] = await Promise.all([
        getNearBalance(ownerId).then(() => true, (e) => (/does not exist|UNKNOWN_ACCOUNT/i.test(String(e)) ? false : null)),
        getColonyOf(ownerId).catch(() => null),
      ]);
      if (live) setWho({ account: ownerId, exists, colony });
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [ownerId, ownerOk]);

  const known = who?.account === ownerId ? who : null;
  const action: Plan["do"] = known?.colony ? "buy" : "join";
  const implicit = /^[0-9a-f]{64}$/.test(ownerId) || /^0x[0-9a-f]{40}$/.test(ownerId);

  const taken = useMemo(() => new Map(colonies.map((c) => [c.color, c.name])), [colonies]);
  const color = picked !== null && !taken.has(picked) ? picked : firstFreeStain(new Set(taken.keys()));
  const cleanName = name.split(/\s+/).filter(Boolean).join(" ");
  const nameTaken = colonies.some((c) => c.name.toLowerCase() === cleanName.toLowerCase());
  const nameOk = NAME.test(cleanName) && !nameTaken;
  const base = toBase(amount, origin.decimals);
  const refundValid = refundOk(origin, refund);

  // A dry quote as the payer types: what the amount becomes, with no deposit address and no commitment.
  useEffect(() => {
    if (!base) {
      setDry({ q: null, error: amount.trim() ? `Enter an amount of ${origin.symbol} with at most ${origin.decimals} decimals.` : null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setDry((x) => ({ ...x, loading: true }));
    const t = setTimeout(() => {
      getIntentsQuote(
        { dry: true, originAsset: origin.id, amount: base, refundTo: refundValid ? refund.trim() : undefined, for: ownerOk ? ownerId : "", do: action, ...(action === "join" ? { name: nameOk ? cleanName : "", color } : {}) },
        ctrl.signal,
      ).then(
        (q) => setDry({ q, error: null, loading: false }),
        (e) => !ctrl.signal.aborted && setDry({ q: null, error: readableIntentsError(e instanceof Error ? e.message : String(e), origin), loading: false }),
      );
    }, 550);
    return () => {
      ctrl.abort();
      clearTimeout(t);
    };
    // Only the amount, the asset and what it is for change the price.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, origin.id, action]);

  const q = dry.q?.quote;
  const nearOut = q ? BigInt(q.amountOut) : 0n;
  const nearMin = q ? BigInt(q.minAmountOut) : 0n;
  const minJoin = rules ? BigInt(rules.min_join) : 0n;
  const belowJoin = action === "join" && !!q && !!rules && nearMin < minJoin;
  const petriFor = (y: bigint) => {
    if (!rules || !rulesReady || y <= 0n) return 0;
    const spend = action === "join" ? y - JOIN_STORAGE : y;
    return spend > 0n ? Number(buy_quote(spend.toString(), String(agar), rules.petri_price, rules.max_supply)) : 0;
  };
  const priceOf = (id: string) => tokens.find((t) => t.assetId === id)?.price;
  const roughNear = base && priceOf(origin.id) && priceOf("nep141:wrap.near") ? (Number(amount) * priceOf(origin.id)!) / priceOf("nep141:wrap.near")! : null;
  const refundFee = q?.refundFee ? fromBase(q.refundFee, origin.decimals, 8) : null;
  const appFee = feeLine(dry.q, origin.symbol);

  // No deposit address until the dish itself answers: NEAR sent to a contract that is not there would be stranded.
  const blocker = !rulesReady
    ? `The mainnet dish, ${CONTRACT}, is not answering yet. A deposit address is offered only once it does.`
    : !ownerOk
    ? "Name the NEAR account that will own the colony."
    : known === null
      ? "Checking that account on NEAR…"
      : known.exists === false && !implicit
        ? `${ownerId} does not exist on NEAR mainnet. Create it first, or use an account you already have.`
        : action === "join" && !nameOk
          ? nameTaken
            ? "A colony with that name already exists. Pick another."
            : "Name the colony: 1 to 24 letters, digits, spaces and - ' . & ! ? _ , : ( )."
          : !refundValid
            ? `Add your refund address: ${ADDRESS_HINT[origin.address]}.`
            : !q
              ? dry.error ?? "Pricing the swap…"
              : belowJoin
                ? `Joining needs at least ${near(Number(minJoin), 3)} NEAR after the swap. Send a little more ${origin.symbol}.`
                : nearMin < MIN_INTENT
                  ? `The dish takes at least ${near(Number(MIN_INTENT), 2)} NEAR in one payment. Send a little more ${origin.symbol}.`
                  : null;

  async function getAddress() {
    if (!base || blocker) return;
    setBusy(true);
    setError(null);
    try {
      const plan: Plan = { for: ownerId, do: action, ...(action === "join" ? { name: cleanName, color } : {}) };
      const response = await getIntentsQuote({ dry: false, originAsset: origin.id, amount: base, refundTo: refund.trim(), ...plan });
      const order: SavedOrder = { savedAt: Date.now(), plan, origin: origin.id, response, last: "PENDING_DEPOSIT" };
      saveOrder(order);
      onQuoted(order);
    } catch (e) {
      setError(readableIntentsError(e instanceof Error ? e.message : String(e), origin));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={s.body}
      onSubmit={(e) => {
        e.preventDefault();
        getAddress();
      }}
    >
      {resume && (
        <div className={s.resume}>
          <p>
            A payment from this browser is still open: {fromBase(resume.response.quote.amountIn, originById(resume.origin)?.decimals ?? 6)}{" "}
            {originById(resume.origin)?.symbol} for {shortAccount(resume.plan.for, 28)}.
          </p>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onResume(resume)}>Show it</button>
        </div>
      )}

      <fieldset className={s.assets}>
        <legend>Pay with</legend>
        {ORIGINS.map((o) => (
          <label key={o.id} className={o.id === originId ? s.assetOn : ""}>
            <input
              type="radio"
              name="origin"
              checked={o.id === originId}
              onChange={() => {
                setOriginId(o.id);
                setAmount(o.start);
                if (!refundOk(o, refund)) setRefund("");
              }}
            />
            <b>{o.symbol}</b>
            <span>on {o.chain}</span>
          </label>
        ))}
      </fieldset>

      <label className={s.field}>
        <span>Amount of {origin.symbol}</span>
        <div className={s.amountRow}>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(",", "."))} aria-describedby="pay-quote" />
          <em>{origin.symbol}</em>
        </div>
      </label>

      <div id="pay-quote" className={s.quote} aria-live="polite">
        {q ? (
          <>
            <p className={s.becomes}>
              <span className="num">{q.amountInFormatted} {origin.symbol}</span>
              <small>about ${Number(q.amountInUsd).toFixed(2)}</small>
              <i aria-hidden="true" />
              <span className="num">{near(Number(nearOut), 4)} NEAR</span>
              <small>at least {near(Number(nearMin), 4)}</small>
            </p>
            <p className={s.buys}>
              {!rulesReady
                ? <>{action === "join" ? "That joins the dish and buys PETRI" : "That buys PETRI"} at the agar&rsquo;s price when the NEAR lands; the price shows once the dish is read.</>
                : action === "join"
                  ? <>That joins the dish and buys about <b className="num">{petri(petriFor(nearMin))}</b> PETRI at the agar&rsquo;s price now.</>
                  : <>That buys about <b className="num">{petri(petriFor(nearMin))}</b> PETRI for {known?.colony?.name ?? "the colony"} at the agar&rsquo;s price now.</>}{" "}
              Typical time {Math.max(10, Math.round(q.timeEstimate))} s after the deposit confirms.
            </p>
            <p className={s.fee}>
              {appFee
                ? <>Includes NEAR Intents&rsquo; app fee on this quote: <b className="num">{appFee}</b>, already taken out of the NEAR above. This site adds no fee of its own.</>
                : <>This quote carries no app fee. Swap and bridge costs are already taken out of the NEAR above.</>}
            </p>
          </>
        ) : (
          <p className={dry.error ? s.bad : s.dim}>
            {dry.error ?? (dry.loading ? `Pricing ${amount} ${origin.symbol}${roughNear ? `, roughly ${roughNear.toFixed(3)} NEAR` : ""}…` : "Enter an amount to see what it becomes.")}
          </p>
        )}
      </div>

      <label className={s.field}>
        <span>NEAR account that will own the colony</span>
        <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="you.near" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <small className={ownerId && !ownerOk ? s.bad : s.dim}>
          {!ownerId
            ? account
              ? ""
              : "Your NEAR mainnet account. Only it can plant for the colony afterwards."
            : !ownerOk
              ? "That is not a NEAR mainnet account id."
              : known?.colony
                ? <>Already has a colony, <i className="swatch" style={{ background: hex(known.colony.color) }} /> {known.colony.name}: this payment buys it PETRI.</>
                : known?.exists === false && implicit
                  ? "This implicit account has no NEAR yet. That is fine if you hold its key."
                  : known
                    ? "Has no colony yet: this payment starts one."
                    : "Checking…"}
        </small>
      </label>

      {action === "join" && (
        <>
          <label className={s.field}>
            <span>Colony name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="e.g. Night Shift" />
          </label>
          <fieldset className={s.stains}>
            <legend>Stain <em>{STAINS.find((x) => x.color === color)?.name}</em></legend>
            {STAINS.map((st) => {
              const owner = taken.get(st.color);
              return (
                <label key={st.color} className={`${color === st.color ? s.stainOn : ""} ${owner ? s.stainTaken : ""}`} title={owner ? `taken by ${owner}` : st.name}>
                  <input type="radio" name="pay-stain" checked={color === st.color} disabled={!!owner} onChange={() => setPicked(st.color)} />
                  <i style={{ background: hex(st.color) }} />
                  <span className="sr">{owner ? `${st.name}, taken by ${owner}` : st.name}</span>
                </label>
              );
            })}
          </fieldset>
        </>
      )}

      <label className={s.field}>
        <span>Your refund address on {origin.chain}</span>
        <input value={refund} onChange={(e) => setRefund(e.target.value)} placeholder={origin.address === "evm" ? "0x…" : origin.address === "sol" ? "Solana address" : "bc1…"} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <small className={refund && !refundValid ? s.bad : s.dim}>
          {refund && !refundValid ? `That is not ${ADDRESS_HINT[origin.address]}.` : `If the swap cannot complete, the ${origin.symbol} goes back here, less the refund fee${refundFee ? ` (${refundFee} ${origin.symbol})` : ""}.`}
        </small>
      </label>

      <button className="btn btn-amber" type="submit" disabled={!!blocker || busy} style={{ width: "100%" }}>
        {busy ? "Asking NEAR Intents…" : "Get a deposit address"}
      </button>
      {(blocker || error) && <p className={error ? s.bad : s.note}>{error ?? blocker}</p>}

      <details className={s.fine}>
        <summary>How this works, fees and refunds</summary>
        <ul>
          <li>
            NEAR Intents gives you a one-time deposit address on {origin.chain}. You send the {origin.symbol} yourself, from any wallet; this site never
            sends anything and never holds your funds.
          </li>
          <li>
            Solvers swap it into wNEAR (wrapped NEAR) and NEAR Intents sends that to the dish contract, <code>{CONTRACT}</code>, with a message naming the
            account and whether to join or buy. The contract unwraps the wNEAR into NEAR and does exactly what a wallet attaching that NEAR would.
          </li>
          <li>
            Fees: 1Click adds an app fee of its own to quotes made without an API key, read from each quote&rsquo;s <code>appFees</code>:{" "}
            {appFee ? `${appFee} on the quote above` : "0.2%, or 20 bps, on such quotes today"}. A bridge fee that depends on the chain comes on top. The
            quote already has both taken out, and this site asks for no fee.
            Slippage is capped at 1%, so you receive at least the smaller figure.
          </li>
          <li>
            If the NEAR arrives but the dish cannot use it as asked (the name was taken in the meantime, say), the contract keeps it as
            pending NEAR for that account, which it can claim back with its wallet on the dish page.
          </li>
          <li>
            If the swap cannot complete before the deposit address expires, or you send less than the quoted amount, NEAR Intents refunds the{" "}
            {origin.symbol} to your refund address on {origin.chain}, less the refund fee. Send more and the extra is refunded after the swap.
          </li>
          <li>The quote and 1Click&rsquo;s signature are kept in this browser and can be saved as a file. They are your evidence if anything goes wrong.</li>
        </ul>
      </details>
    </form>
  );
}

function Deposit({ order, onRestart, onLanded }: { order: SavedOrder; onRestart: () => void; onLanded: (account: string) => void }) {
  const origin = originById(order.origin)!;
  const q = order.response.quote;
  const address = q.depositAddress!;
  const [st, setSt] = useState<StatusResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hash, setHash] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [colony, setColony] = useState<Colony | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const clock = useCountdown(q.deadline);

  const poll = useCallback(async () => {
    try {
      const r = await getIntentsStatus(address, q.depositMemo);
      setSt(r);
      setErr(null);
      if (r.status !== order.last) saveOrder({ ...order, last: r.status });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      // A fresh deposit address is unknown to the status service for a moment.
      if (!/does not know/.test(m)) setErr(m);
    }
  }, [address, q.depositMemo, order]);

  const done = st ? FINAL.includes(st.status) : false;
  useEffect(() => {
    if (done) return;
    poll();
    const t = setInterval(poll, 5000);
    return () => clearInterval(t);
  }, [poll, done]);

  // Once the swap lands, watch for the colony itself.
  useEffect(() => {
    if (st?.status !== "SUCCESS") return;
    let live = true;
    let tries = 0;
    const look = async () => {
      const c = await getColonyOf(order.plan.for).catch(() => null);
      if (!live) return;
      if (c) setColony(c);
      else if (tries++ < 30) setTimeout(look, 4000);
    };
    look();
    return () => {
      live = false;
    };
  }, [st?.status, order.plan.for]);

  useEffect(() => {
    const u = receiptUrl({ ...order, last: st?.status ?? order.last });
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [order, st?.status]);

  const step = stepOf(st?.status);
  const status = st?.status;
  const expired = clock.left === 0 && (!status || status === "PENDING_DEPOSIT");

  return (
    <div className={s.body}>
      {status !== "SUCCESS" && status !== "REFUNDED" && status !== "FAILED" && (
        <div className={s.payBox}>
          <div className={s.qr}>
            <Qr text={address} size={184} label={`QR code of the deposit address on ${origin.chain}`} />
          </div>
          <div className={s.payText}>
            <p className={s.sendLine}>
              Send exactly <b className="num">{q.amountInFormatted} {origin.symbol}</b> on {origin.chain}
              <Copy text={q.amountInFormatted} label="the amount" />
            </p>
            <p className={s.addrLabel}>to this one-time address</p>
            <p className={s.addr}>
              <code>{address}</code>
              <Copy text={address} label="the deposit address" />
            </p>
            {q.depositMemo && (
              <p className={s.addr}>
                <span>Memo, required:</span> <code>{q.depositMemo}</code>
                <Copy text={q.depositMemo} label="the memo" />
              </p>
            )}
            <p className={s.dim}>
              Only {origin.symbol} on {origin.chain}. The code holds the address alone; type the amount in your wallet. It becomes about{" "}
              {near(Number(q.amountOut), 4)} NEAR (at least {near(Number(q.minAmountOut), 4)}) for {shortAccount(order.plan.for, 30)}.
            </p>
            <p className={expired ? s.bad : s.clock}>
              {expired ? "This address has expired. Anything sent now is refunded; start a new payment." : <>Open for <b className="num">{clock.text}</b></>}
            </p>
          </div>
        </div>
      )}

      <ol className={s.steps} aria-label="Progress">
        {STEPS.map((x, i) => {
          const failedHere = (status === "REFUNDED" || status === "FAILED") && i === 3;
          const state = failedHere ? s.stepBad : i < step || (i === 3 && status === "SUCCESS") ? s.stepDone : i === step ? s.stepNow : "";
          return (
            <li key={x.key} className={state} aria-current={i === step && !done ? "step" : undefined}>
              <b>{failedHere ? (status === "REFUNDED" ? "Refunded" : "Failed") : x.title}</b>
              <span>
                {failedHere
                  ? status === "REFUNDED"
                    ? `${st?.swapDetails?.refundedAmountFormatted ?? ""} ${origin.symbol} went back to your refund address${st?.swapDetails?.refundReason ? ` (${st.swapDetails.refundReason.toLowerCase().replace(/_/g, " ")})` : ""}.`
                    : "NEAR Intents could not complete the swap. Keep the saved quote and contact NEAR Intents support with it."
                  : i === 1 && status === "INCOMPLETE_DEPOSIT"
                    ? `Less than the quoted amount arrived${st?.swapDetails?.depositedAmountFormatted ? ` (${st.swapDetails.depositedAmountFormatted} ${origin.symbol})` : ""}. Send the rest before the address expires, or it is refunded.`
                    : x.line}
              </span>
            </li>
          );
        })}
      </ol>

      {status === "SUCCESS" && (
        <div className={s.landed}>
          {colony ? (
            <>
              <p>
                <i className="swatch" style={{ background: hex(colony.color), width: 14, height: 14 }} /> <b>{colony.name}</b>{" "}
                {order.plan.do === "join" ? "is on the dish" : "has its PETRI"}, owned by {shortAccount(colony.account, 30)}.
                {order.plan.do === "join" ? " Connect that account's wallet to plant with it; it may also rename the colony, once." : ""}
              </p>
              <button className="btn btn-amber btn-small" onClick={() => onLanded(colony.account)}>Show it on the dish</button>
            </>
          ) : (
            <p className={s.dim}>
              {st?.swapDetails?.amountOutFormatted ?? near(Number(q.amountOut), 4)} NEAR reached the dish. Waiting for the colony to appear…
              If it does not, the contract keeps the NEAR as pending for {shortAccount(order.plan.for, 30)}, and that account can claim it back
              from the dish page.
            </p>
          )}
          {(st?.swapDetails?.nearTxHashes ?? []).slice(-1).map((h) => (
            <a key={h} href={txUrl(h)} className={s.link}>See the NEAR transaction</a>
          ))}
        </div>
      )}

      {!done && !expired && (
        <form
          className={s.hashRow}
          onSubmit={(e) => {
            e.preventDefault();
            submitDepositTx(address, hash).then(
              (r) => {
                setSt(r);
                setSent("Thanks. NEAR Intents is looking for that transaction.");
              },
              (e2) => setSent(e2 instanceof Error ? e2.message : String(e2)),
            );
          }}
        >
          <label className={s.field}>
            <span>Sent it? Paste the transaction hash to speed things up (optional)</span>
            <div className={s.amountRow}>
              <input value={hash} onChange={(e) => setHash(e.target.value)} placeholder="Transaction hash" spellCheck={false} />
              <button className="btn btn-ghost btn-small" type="submit" disabled={hash.trim().length < 32}>Send hash</button>
            </div>
          </label>
          {sent && <p className={s.dim}>{sent}</p>}
        </form>
      )}

      {err && <p className={s.bad}>{err} Still checking every few seconds.</p>}

      <div className={s.row}>
        {url && (
          <a className="btn btn-ghost btn-small" href={url} download={`petri-intents-${address.slice(0, 10)}.json`}>
            Save the quote and signature
          </a>
        )}
        <button
          type="button"
          className={s.linkish}
          onClick={() => {
            if (done || expired || confirm("Start a new payment? If you already sent funds to this address, keep this one open instead: it is saved in this browser.")) onRestart();
          }}
        >
          {done ? "Make another payment" : "Start over"}
        </button>
      </div>
      <p className={s.fineLine}>
        NEAR Intents signed this quote at {new Date(order.response.timestamp).toLocaleString()}
        {q.deadline ? `; the address closes at ${new Date(q.deadline).toLocaleTimeString()}` : ""}. Quote{" "}
        <span className="num">{order.response.correlationId.slice(0, 8)}</span>, about {int(Math.round(q.timeEstimate))} s once the deposit confirms.
        {feeLine(order.response, origin.symbol) ? ` It includes NEAR Intents' app fee of ${feeLine(order.response, origin.symbol)}.` : ""}
      </p>
    </div>
  );
}
