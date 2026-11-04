// A plain-text map of the docs for agents and scripts: every page with its address and summary, and the facts most
// often checked. Served at docs.playpetri.xyz/llms.txt (and /docs/llms.txt).

import { BUILD_COMMIT, CODE_HASH, DISH, DOCS, REPO, TESTS } from "@/components/docs/facts";
import { GROUPS, PAGES } from "@/components/docs/nav";

export const dynamic = "force-static";

export function GET() {
  const url = (slug: string) => (slug === "introduction" ? `${DOCS}/` : `${DOCS}/${slug}`);
  const lines = [
    "# Petri",
    "",
    "> A coin that is alive: Conway's Life on a 128 x 128 wrapped dish run by one NEAR contract. Colonies are NEAR accounts; PETRI (NEP-141, 1,000,000 supply, all in the agar at launch) feeds living cells every 15 s generation; NEAR collects in a vault paid out at hourly tides; specimen slides are NEP-171 NFTs drawn on chain that license their pattern from 12 captured cells up (25% off to plant it, 10% royalty to the holder, or to the agar from a planter that has not attached NEAR or holds more kept PETRI than the cost); five house AI strains forecast, remember and make pacts with each other on chain (PETRI in escrow for a promise not to plant near, enforced by the contract); free play never reaches NEAR (PETRI earned before a first NEAR is kept until planted); everything replays from the ledger.",
    "",
    "Hosting note: the site is changing hosts. Until the playpetri.xyz DNS records point at its new server, the live site is at https://136-64-100-170.sslip.io and these docs at https://136-64-100-170.sslip.io/docs/introduction (a docs.playpetri.xyz/<page> link is /docs/<page> there).",
    "",
    `- Mainnet dish: ${DISH.mainnet.contract} (rules ${DISH.mainnet.rules}, wNEAR ${DISH.mainnet.wnear})`,
    `- Testnet dish: ${DISH.testnet.contract} (rules ${DISH.testnet.rules}, wNEAR ${DISH.testnet.wnear})`,
    "- Contract v6.2 on both. Both dishes were relaunched in place (from generation 0, with the private relaunch method) on petri-dish.near and petri-v6.testnet, the accounts they ran v6 and v6.1 on (petri-v5.testnet is abandoned).",
    `- Code hash of both: ${CODE_HASH} (cargo near build reproducible-wasm at ${BUILD_COMMIT}, near-sdk 5.29.1)`,
    "- Each contract account keeps one full-access key, held by the team, on purpose: it exists only so a bug can be fixed (new code plus relaunch, which restarts the dish from generation 0 with a fresh ledger). It will not be deleted. No method changes a running dish's parameters, mints PETRI or edits the board, and new code changes the code hash, which verify.mjs compares with the published build on every run. verify.mjs reports the key as a disclosed note, not a failed check.",
    `- Mainnet RPC: ${DISH.mainnet.rpc} (rpc.mainnet.near.org rate-limits)`,
    `- Source: ${REPO} (MIT)`,
    "- Verify: node scripts/verify.mjs --network mainnet   (45 rows; exit 0 = everything matches, 1 = a row differs)",
    `- Tests: cargo test -p petri-core -p petri-contract   (${TESTS.core} + ${TESTS.contract})`,
    "",
  ];
  for (const g of GROUPS) {
    lines.push(`## ${g}`, "");
    for (const p of PAGES.filter((x) => x.group === g)) lines.push(`- [${p.title}](${url(p.slug)}): ${p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
