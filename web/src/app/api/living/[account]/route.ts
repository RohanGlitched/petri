// A living slide's picture, as its NEP-171 token names it (`media`): the fossil beside the colony its purse keeps alive
// on the stored board, stamped EXTINCT when that colony has no living cell. Read-only: view calls, nothing else.

import { accessKeysOf, colonyCrop, decodeBoard, fromB64, tokenOfPurse, viewOn, type PurseInfo } from "@/lib/living";
import { livingSvg } from "@/lib/living-svg";
import type { Network } from "@/lib/config";

export const dynamic = "force-dynamic";

type Slide = { token_id: string; owner_id: string; color: number; generation: string; w: number; h: number; bitmap: string };
type Colony = { id: number; color: number } | null;

export async function GET(_req: Request, ctx: { params: Promise<{ account: string }> }) {
  const raw = decodeURIComponent((await ctx.params).account).replace(/\.svg$/, "");
  const net: Network = raw.endsWith(".near") ? "mainnet" : "testnet";
  const token = tokenOfPurse(raw, net);
  if (!token) return new Response("not a living slide", { status: 404 });
  try {
    // The purse names its dish: read the slide and the board from there.
    const info = await viewOn<PurseInfo>(net, raw, "purse");
    const on = <T,>(method: string, args: Record<string, unknown> = {}) => viewOn<T>(net, info.dish, method, args);
    const [slide, colony, keys, board, state, rules] = await Promise.all([
      on<Slide | null>("slide", { token_id: token }),
      on<Colony>("colony_of", { account_id: raw }),
      accessKeysOf(net, raw).then((k) => k.length).catch(() => null),
      on<string>("board"),
      on<{ generation: string }>("state"),
      on<{ width: number; height: number }>("rules"),
    ]);
    if (!slide) return new Response("no such slide", { status: 404 });
    let live = null;
    if (colony) {
      const owners = decodeBoard(fromB64(board), rules.width, rules.height);
      const crop = colonyCrop(owners, rules.width, rules.height, colony.id);
      live = crop ? { cells: crop.cells, cw: crop.w, ch: crop.h } : { cells: [], cw: 8, ch: 8 };
    }
    const svg = livingSvg({
      token,
      bitmap: fromB64(slide.bitmap),
      w: slide.w,
      h: slide.h,
      color: slide.color,
      fossilGeneration: Number(slide.generation),
      live,
      liveColor: colony?.color ?? slide.color,
      generation: Number(state.generation),
      holder: info.holder,
      keys,
    });
    return new Response(svg, { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=30, s-maxage=30", "access-control-allow-origin": "*" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "NEAR did not answer", { status: 502 });
  }
}
