"use client";
// Specimen slides as pattern licences. The next contract version adds, as announced by its author:
//   plant(cells, note, credit, slide: token_id)  the slide's holder plants its pattern with a perk; anyone else
//                                                 pays `rules.slide_royalty_bps` of the planting's price in PETRI
//                                                 to the holder;
//   slide_royalties(token_id)                     a view: the PETRI royalties that slide has earned in its lifetime.
// Neither exists on the dishes running today, so everything here detects them at run time: `live` is false until the
// rules carry `slide_royalty_bps`, and the page then shows the licence as not yet live instead of inventing terms.
//
// TODO(contract): once chain.ts exports a typed `getSlideRoyalties` and `Rules.slide_royalty_bps`, swap the two
// adapters below for them, and fill `HOLDER_PERK` with the perk the contract grants (from its rules or its docs).
// TODO(wallet): wallet.ts `plantCells` takes no `slide` argument yet; DishStage must pass the specimen's id once it
// does, or a replanted pattern is planted as an ordinary planting with no royalty and no perk.

import { useEffect, useState } from "react";
import { view, type Rules } from "@/lib/chain";
import { useDish } from "@/lib/dish-store";

/** What the holder's perk is, in words; null until the contract defines one. */
const HOLDER_PERK: string | null = "the licence discount, and no royalty to pay";

/** Adapter: the royalty rate in basis points, if this dish's rules have one. */
export function royaltyBps(rules: Rules | undefined): number | null {
  const v = (rules as (Rules & { slide_royalty_bps?: unknown }) | undefined)?.slide_royalty_bps;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Adapter: lifetime PETRI units of royalty a slide has earned, or null when the view does not exist. */
export async function slideRoyalties(tokenId: string): Promise<number | null> {
  try {
    const r = await view<unknown>("slide_royalties", { token_id: tokenId });
    if (typeof r === "string" || typeof r === "number") return Number(r);
    if (r && typeof r === "object") {
      const o = r as Record<string, unknown>;
      const n = o.petri ?? o.total ?? o.royalties ?? o.paid;
      if (typeof n === "string" || typeof n === "number") return Number(n);
    }
    return null;
  } catch {
    return null;
  }
}

export type SlideLicence = {
  /** The dish has slide licences, and this slide captured enough cells to be one. */
  live: boolean;
  /** The dish has slide licences, but this slide captured fewer than `licence_min_cells`: a keepsake, not a licence. */
  small: boolean;
  royaltyBps: number | null;
  /** The viewer holds the slide. */
  holder: boolean;
  perk: string | null;
  /** Lifetime royalties in PETRI units, null when unknown. */
  lifetime: number | null;
};

/** The licence terms of slide `tokenId` for `viewer`; `cells` is how many cells the slide captured. */
export function useSlideLicence(tokenId: string | null, viewer: string | null, owner?: string | null, cells?: number | null): SlideLicence {
  const d = useDish();
  const bps = royaltyBps(d.rules);
  const min = d.rules?.licence_min_cells;
  const small = bps !== null && typeof min === "number" && typeof cells === "number" && cells < min;
  const [lifetime, setLifetime] = useState<number | null>(null);
  const [holderOf, setHolderOf] = useState<string | null>(owner ?? null);
  useEffect(() => {
    setLifetime(null);
    if (!tokenId || bps === null) return;
    let stop = false;
    slideRoyalties(tokenId).then((v) => !stop && setLifetime(v));
    if (owner === undefined)
      view<{ owner_id?: string } | null>("nft_token", { token_id: tokenId })
        .then((t) => !stop && setHolderOf(t?.owner_id ?? null))
        .catch(() => {});
    return () => {
      stop = true;
    };
  }, [tokenId, bps, owner]);
  const holderAccount = owner ?? holderOf;
  return { live: bps !== null && !small, small, royaltyBps: bps, holder: !!viewer && !!holderAccount && viewer === holderAccount, perk: HOLDER_PERK, lifetime };
}
