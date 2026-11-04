"use client";
// One slide's life, rebuilt from the dish's ledger: the Slide entry that minted it and every planting made under its
// licence (each Plant entry's `licence` names the slide, how often it had moved, the holder it paid and the royalty, or
// that the royalty went to the agar). Royalties are summed from those entries and checked against the contract's own
// `slide_royalties`. The ledger does not record transfers (a slide only counts its moves), so holder changes come from
// the NEP-171 `nft_transfer` events NearBlocks indexes, checked against that count; the holder each licensed planting
// paid is shown either way.

import { useEffect, useState } from "react";
import { getSlideRoyalties, type Entry } from "@/lib/chain";
import { CONTRACT, NETWORK } from "@/lib/config";

export type Minted = { generation: number; colony: number; cells: number; cost: bigint; spent: bigint | null; index: number };
export type Licensed = { generation: number; colony: number; cells: number; cost: bigint; royalty: bigint; holder: string | null; toAgar: boolean; moves: number; index: number };
export type Moved = { at: number; from: string | null; to: string; tx: string; mint: boolean };

export type SlideHistory = {
  minted: Minted | null;
  licensed: Licensed[];
  /** PETRI units paid to holders (the slide's `royalties`), and paid to the agar by planters that never attached NEAR */
  toHolders: bigint;
  toAgar: bigint;
  /** PETRI units each holder was paid, by account */
  byHolder: Map<string, bigint>;
};

export function slideHistory(entries: Entry[], token: string): SlideHistory {
  let minted: Minted | null = null;
  const licensed: Licensed[] = [];
  let toHolders = 0n;
  let toAgar = 0n;
  const byHolder = new Map<string, bigint>();
  entries.forEach((e, index) => {
    if ("Slide" in e && e.Slide.token === token) {
      const x = e.Slide;
      minted = { generation: Number(x.generation), colony: x.colony, cells: x.cells, cost: BigInt(x.cost), spent: x.spent ? BigInt(x.spent) : null, index };
    } else if ("Plant" in e && e.Plant.licence?.token === token) {
      const p = e.Plant;
      const l = p.licence!;
      const royalty = BigInt(l.royalty);
      licensed.push({ generation: Number(p.generation), colony: p.colony, cells: p.cells.length, cost: BigInt(p.cost), royalty, holder: l.holder, toAgar: l.to_agar, moves: l.moves, index });
      if (l.to_agar) toAgar += royalty;
      else if (l.holder) {
        toHolders += royalty;
        byHolder.set(l.holder, (byHolder.get(l.holder) ?? 0n) + royalty);
      }
    }
  });
  return { minted, licensed, toHolders, toAgar, byHolder };
}

/** The contract's own count of royalties paid to the slide's holders. */
export function useSlideRoyalties(token: string, key: unknown): bigint | null {
  const [v, setV] = useState<bigint | null>(null);
  useEffect(() => {
    let stop = false;
    getSlideRoyalties(token).then(
      (r) => !stop && setV(BigInt(r)),
      () => !stop && setV(null),
    );
    return () => {
      stop = true;
    };
  }, [token, key]);
  return v;
}

const NEARBLOCKS_API = NETWORK === "mainnet" ? "https://api.nearblocks.io" : "https://api-testnet.nearblocks.io";

type NbTxn = { affected_account_id: string; involved_account_id: string | null; cause: string; delta_amount: number; transaction_hash: string; block_timestamp: string };

/** The slide's NEP-171 events as NearBlocks indexed them: its mint and every move, oldest first. `null` while reading,
 * and `"unavailable"` when NearBlocks did not answer (it limits requests without a key). */
export function useSlideMoves(token: string, moves: number): Moved[] | null | "unavailable" {
  const [out, setOut] = useState<Moved[] | null | "unavailable">(null);
  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        const r = await fetch(`${NEARBLOCKS_API}/v1/nfts/${CONTRACT}/tokens/${encodeURIComponent(token)}/txns?per_page=100&order=asc`, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) throw new Error(String(r.status));
        const body = (await r.json()) as { txns?: NbTxn[] };
        // A transfer is two rows, one per side; the row that adds the token names the new holder.
        const rows = (body.txns ?? []).filter((t) => t.delta_amount > 0);
        const list = rows
          .map((t) => ({ at: Number(BigInt(t.block_timestamp) / 1_000_000n), from: t.involved_account_id, to: t.affected_account_id, tx: t.transaction_hash, mint: /MINT/i.test(t.cause) }))
          .sort((a, b) => a.at - b.at);
        if (!stop) setOut(list);
      } catch {
        if (!stop) setOut("unavailable");
      }
    })();
    return () => {
      stop = true;
    };
  }, [token, moves]);
  return out;
}
