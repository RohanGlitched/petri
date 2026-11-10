// A colony's share card (1200 x 630): its living shape as glossy beads on the agar, its name and stain, how many cells
// are alive, the PETRI it has earned and how long it has lived, read from the contract. X and other sites unfurl
// /c/<id> with it. Read-only; cached at the edge for a few minutes.

import { ImageResponse } from "next/og";
import { cardAge, cardPetri, colonyCard, colonySvg } from "@/lib/colony-card";
import type { Network } from "@/lib/config";

export const runtime = "nodejs";

/** Google Fonts serves TrueType to a client that does not ask for WOFF2, which is what the image renderer reads. */
const fonts = new Map<string, Promise<ArrayBuffer | null>>();
function font(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  let p = fonts.get(key);
  if (!p) {
    p = (async () => {
      const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, { signal: AbortSignal.timeout(4000) })).text();
      const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
      if (!url) return null;
      return (await fetch(url, { signal: AbortSignal.timeout(4000) })).arrayBuffer();
    })().catch(() => null);
    fonts.set(key, p);
    p.then((v) => v === null && fonts.delete(key));
  }
  return p;
}

const int = (n: number) => Math.round(n).toLocaleString("en-US");

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const net: Network = q.get("net") === "mainnet" ? "mainnet" : "testnet";
  // ?g= pins the board to the generation the share page shows, so the image and the page print the same numbers.
  const g = q.get("g") ? Number(q.get("g")) : undefined;
  const [card, display, body, bodyBold] = await Promise.all([colonyCard(net, Number(id), new URL(req.url).origin, g), font("Gloock", 400), font("Figtree", 400), font("Figtree", 600)]);
  const families = [
    display && { name: "Gloock", data: display, weight: 400 as const, style: "normal" as const },
    body && { name: "Figtree", data: body, weight: 400 as const, style: "normal" as const },
    bodyBold && { name: "Figtree", data: bodyBold, weight: 600 as const, style: "normal" as const },
  ].filter(Boolean) as { name: string; data: ArrayBuffer; weight: 400 | 600; style: "normal" }[];
  const D = display ? "Gloock" : "serif";
  const B = body ? "Figtree" : "sans-serif";
  const hex = (c: number) => "#" + c.toString(16).padStart(6, "0");

  const shell = (inner: React.ReactNode) => (
    <div style={{ width: 1200, height: 630, display: "flex", background: "radial-gradient(circle at 28% 50%, #2a150a 0%, #120a05 62%)", color: "#f3e9da", fontFamily: B }}>{inner}</div>
  );

  if (!card) {
    return new ImageResponse(
      shell(
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: 80 }}>
          <div style={{ fontSize: 22, letterSpacing: 4, color: "#bba78f", textTransform: "uppercase" }}>Petri Dish</div>
          <div style={{ fontFamily: D, fontSize: 84, marginTop: 16 }}>A memecoin that is alive.</div>
          <div style={{ fontSize: 30, marginTop: 20, color: "#e2d5c3" }}>Conway&rsquo;s Life on NEAR. playpetri.xyz</div>
        </div>,
      ),
      { width: 1200, height: 630, fonts: families, headers: { "cache-control": "public, max-age=60, s-maxage=60" } },
    );
  }

  const svg = colonySvg(card, 540);
  const age = cardAge(card);
  const stats: [string, string][] = [
    ["Living cells", int(card.live)],
    card.house ? ["Plays for the house, unpaid", "House"] : ["PETRI earned", cardPetri(card.earned)],
    ["Age, in generations", int(age)],
    ["Cells planted", int(card.cellsPlanted)],
  ];

  return new ImageResponse(
    shell(
      <>
        <div style={{ width: 630, height: 630, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`} width={540} height={540} alt="" style={{ borderRadius: 270, boxShadow: "0 30px 80px rgba(0,0,0,0.6)" }} />
          {card.live === 0 && (
            <div style={{ position: "absolute", display: "flex", flexDirection: "column", alignItems: "center", padding: "18px 30px", borderRadius: 16, background: "rgba(18,10,5,0.82)" }}>
              <div style={{ fontFamily: D, fontSize: 34 }}>Resting</div>
              <div style={{ fontSize: 19, color: "#bba78f", marginTop: 4 }}>No living cells on the board right now</div>
            </div>
          )}
        </div>
        <div style={{ width: 570, height: 630, display: "flex", flexDirection: "column", justifyContent: "center", padding: "40px 56px 40px 0" }}>
          <div style={{ display: "flex", fontSize: 18, letterSpacing: 4, color: "#bba78f", textTransform: "uppercase", fontWeight: 600 }}>
            Petri Dish · NEAR {card.net}
          </div>
          <div style={{ display: "flex", fontFamily: D, fontSize: card.name.length > 18 ? 50 : card.name.length > 11 ? 60 : 74, lineHeight: 1.04, marginTop: 14 }}>{card.name}</div>
          <div style={{ display: "flex", alignItems: "center", marginTop: 16, fontSize: 24, color: "#e2d5c3" }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: hex(card.color), marginRight: 12, boxShadow: "inset -3px -4px 6px rgba(0,0,0,0.35)" }} />
            {card.stain ?? hex(card.color)}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", marginTop: 30, width: 514 }}>
            {stats.map(([k, v]) => (
              <div key={k} style={{ display: "flex", flexDirection: "column", width: 257, marginBottom: 20 }}>
                <div style={{ fontFamily: D, fontSize: 44, lineHeight: 1 }}>{v}</div>
                <div style={{ fontSize: 17, color: "#bba78f", marginTop: 8 }}>{k}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", marginTop: 14, fontSize: 21, color: "#f2b45a" }}>playpetri.xyz/c/{card.id}</div>
          <div style={{ display: "flex", marginTop: 6, fontSize: 18, color: "#bba78f" }}>A memecoin that is alive: Conway&rsquo;s Life on NEAR.</div>
        </div>
      </>,
    ),
    { width: 1200, height: 630, fonts: families, headers: { "cache-control": "public, max-age=120, s-maxage=300, stale-while-revalidate=3600" } },
  );
}
