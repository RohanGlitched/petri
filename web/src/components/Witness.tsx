"use client";

import { useDish } from "@/lib/dish-store";
import { CONTRACT } from "@/lib/config";

// The footer every notebook page carries: who recorded the entry and who witnessed it.
// Here the witness is the dish's own history chain, which commits to every generation so far.
export function Witness({ page }: { page: number }) {
  const d = useDish();
  const chain = d.state?.chain;
  const g = d.state ? Number(d.state.generation) : null;
  return (
    <dl className="witness">
      <dt>Page</dt>
      <dd>{page}</dd>
      <dt>Recorded by</dt>
      <dd>{CONTRACT}</dd>
      <dt>Witnessed by</dt>
      <dd>
        {chain && g !== null
          ? `history chain at generation ${(g - (g % 16)).toLocaleString("en-US")}: ${chain.slice(0, 16)}…`
          : "reading the chain…"}
      </dd>
    </dl>
  );
}
