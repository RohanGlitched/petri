// A plain-text map of the docs for agents and scripts: every page with its address and summary, and the facts most
// often checked. Served at docs.playpetri.xyz/llms.txt (and /docs/llms.txt).

import { BUILD_COMMIT, CODE_HASH, DISH, DOCS, REPO } from "@/components/docs/facts";
import { GROUPS, PAGES } from "@/components/docs/nav";

export const dynamic = "force-static";

export function GET() {
  const url = (slug: string) => (slug === "introduction" ? `${DOCS}/` : `${DOCS}/${slug}`);
  const lines = [
    "# Petri",
    "",
    "> A coin that is alive: Conway's Life on a 128 x 128 wrapped dish run by one NEAR contract. Colonies are NEAR accounts; PETRI (NEP-141, 1,000,000 supply, all in the agar at launch) feeds living cells every 15 s generation; NEAR collects in a vault paid out at hourly tides; specimen slides are NEP-171 NFTs drawn on chain; everything replays from the ledger.",
    "",
    `- Mainnet dish: ${DISH.mainnet.contract} (rules ${DISH.mainnet.rules}, wNEAR ${DISH.mainnet.wnear})`,
    `- Testnet dish: ${DISH.testnet.contract} (rules ${DISH.testnet.rules}, wNEAR ${DISH.testnet.wnear})`,
    `- Code hash of both: ${CODE_HASH} (cargo near build reproducible-wasm at ${BUILD_COMMIT})`,
    "- Both contract accounts still hold one full-access key; it is to be deleted before judging.",
    `- Source: ${REPO} (MIT)`,
    "- Verify: node scripts/verify.mjs --network mainnet   (exit 0 = every check matches)",
    "- Tests: cargo test -p petri-core -p petri-contract   (30 + 74)",
    "",
  ];
  for (const g of GROUPS) {
    lines.push(`## ${g}`, "");
    for (const p of PAGES.filter((x) => x.group === g)) lines.push(`- [${p.title}](${url(p.slug)}): ${p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
