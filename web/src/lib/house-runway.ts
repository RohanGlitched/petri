// How long the mainnet house can keep playing. The five strains attach their own NEAR on mainnet, and what they spend
// on purchases and plantings goes into the tide vault for the other players. This reads their balances (view_account)
// and their recent pace (the dish's own ledger) straight from NEAR mainnet, whichever dish the page is showing.

import { CONTRACTS } from "./config";
import { rpcCall } from "./rpc";
import { strainsOn } from "./strains";
import { entryGeneration, type DishState, type Entry } from "./chain";

const YOCTO = 10n ** 24n;
/** The pace is measured over the last day of the ledger (5,760 generations of 15 s), or less if the dish is younger. */
const WINDOW_GENS = 5760;

const rpc = <T,>(method: string, params: unknown): Promise<T> => rpcCall<T>("mainnet", method, params, { id: "runway" });

async function view<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const r = await rpc<{ result: number[] }>("query", {
    request_type: "call_function",
    finality: "final",
    account_id: CONTRACTS.mainnet,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export type Runway = {
  strains: { account: string; name: string; balance: bigint | null }[];
  /** yoctoNEAR the five hold now. */
  total: bigint;
  /** yoctoNEAR the house put into the dish over the window. */
  spent: bigint;
  /** Hours the window covers. */
  hours: number;
  /** The dish is younger than the window, so the pace is from its first hours. */
  young: boolean;
  /** yoctoNEAR a day at that pace, null when the house spent nothing in the window. */
  perDay: bigint | null;
  /** Days the balances last at that pace. */
  days: number | null;
};

export async function readRunway(): Promise<Runway> {
  const defs = strainsOn("mainnet");
  const balances = await Promise.all(
    defs.map((s) =>
      rpc<{ amount: string }>("query", { request_type: "view_account", finality: "final", account_id: s.account }).then(
        (a) => BigInt(a.amount),
        () => null,
      ),
    ),
  );
  const total = balances.reduce<bigint>((n, b) => n + (b ?? 0n), 0n);

  const state = await view<DishState>("state", {});
  const house = new Set(state.house);
  const now = Number(state.generation);
  const count = Number(state.ledger);
  const from = Math.max(0, count - 1000);
  const tail = count > 0 ? await view<Entry[]>("ledger", { from, limit: 1000 }) : [];
  const since = Math.max(0, now - WINDOW_GENS);
  // A strain's buy-in at the generation it joined is a one-off, not its pace, so it is left out.
  const joinedAt = new Map<number, number>();
  for (const e of tail) if ("Join" in e) joinedAt.set(e.Join.colony, Number(e.Join.generation));
  let spent = 0n;
  for (const e of tail) {
    const x = "Buy" in e ? e.Buy : "Plant" in e ? e.Plant : null;
    if (!x || Number(x.generation) < since || !house.has(x.colony)) continue;
    if ("Buy" in e && joinedAt.get(x.colony) === Number(x.generation)) continue;
    spent += BigInt(x.near);
  }
  // The last day, or since genesis on a younger dish; if the 1,000 entries read do not reach back a day, the stretch
  // they cover.
  const tailStart = tail.length ? entryGeneration(tail[0]) : now;
  const start = from === 0 ? since : Math.max(since, tailStart);
  const gens = Math.max(240, now - start);
  const hours = (gens * 15) / 3600;
  const perDay = spent > 0n ? (spent * 24n * 3600n) / BigInt(Math.round(gens * 15)) : null;
  const days = perDay ? Number((total * 1000n) / perDay) / 1000 : null;
  return {
    strains: defs.map((s, i) => ({ account: s.account, name: s.name, balance: balances[i] })),
    total,
    spent,
    hours,
    young: from === 0 && now < WINDOW_GENS,
    perDay,
    days,
  };
}

export const nearOf = (yocto: bigint, dp = 3) => (Number((yocto * 10n ** BigInt(dp)) / YOCTO) / 10 ** dp).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
