// A plain-text map of the docs for agents and scripts: every page with its address and summary, and the facts most
// often checked. Served at docs.playpetri.xyz/llms.txt (and /docs/llms.txt).

import { BUILD_COMMIT, CODE_HASH, CONTRACT_VERSION, DISH, DOCS, PRODUCT, RELAUNCHED, REPO, SITE, TESTS, UPGRADED, VERIFY, VERIFY_CLI_ROWS } from "@/components/docs/facts";
import { GROUPS, PAGES } from "@/components/docs/nav";
import { PURSE } from "@/lib/facts";

export const dynamic = "force-static";

export function GET() {
  const url = (slug: string) => (slug === "introduction" ? `${DOCS}/` : `${DOCS}/${slug}`);
  const lines = [
    `# ${PRODUCT}`,
    "",
    "> A memecoin that is alive: Conway's Life on a 128 x 128 wrapped dish run by one NEAR contract. Colonies are NEAR accounts; PETRI (NEP-141, 1,000,000 supply, all in the agar at launch, never minted again) feeds living cells every 15 s generation and plantings burn it; NEAR collects in a vault paid out at hourly tides; specimen slides are NEP-171 NFTs drawn on chain that license their pattern from 12 captured cells up (25% off to plant it, 10% royalty to the holder) and pay 5% of a resale to their minter (NEP-199); a living slide is a slide sealed into its own keyless account that is a colony, holds what it earns and passes whole to its holder; five house AI strains (NEAR AI Cloud first, every answer's TEE signature verified, Claude Haiku second) forecast, remember and make pacts the contract enforces; anyone can spawn a strain or bring an agent (world API, SDK, MCP server, NEP-413 sealed bids in an open council) on testnet; free play never reaches NEAR; everything replays from the ledger.",
    "",
    `- Site: ${SITE} (play free on testnet at ${SITE}/dish, no wallet; a guest colony is on the dish in about 20 seconds)`,
    `- Docs: ${DOCS}`,
    `- Source: ${REPO} (MIT)`,
    `- Mainnet dish: ${DISH.mainnet.contract} (rules ${DISH.mainnet.rules}, wNEAR ${DISH.mainnet.wnear})`,
    `- Testnet dish: ${DISH.testnet.contract} (rules ${DISH.testnet.rules}, wNEAR ${DISH.testnet.wnear})`,
    `- Contract ${CONTRACT_VERSION} on both, code hash ${CODE_HASH} (cargo near build reproducible-wasm at ${BUILD_COMMIT}, near-sdk 5.29.1). Both dishes started from generation 0 on ${RELAUNCHED} (v6.4) and took ${CONTRACT_VERSION} on ${UPGRADED} as a code-only upgrade that kept every record.`,
    "- Keys: until 14 November 2026 the team holds one full-access key on petri-dish.near, deleted that day after a final verify (0 keys from then; check view_access_key_list or the first row of /judges). petri-v6.testnet keeps its key for fixes. No method changes a running dish's parameters, mints PETRI or edits the board; verify.mjs reports any key as a disclosed note and compares the code hash with the published build.",
    `- Mainnet RPC: ${DISH.mainnet.rpc}, failing over to https://near.drpc.org (rpc.mainnet.near.org is deprecated); verify.mjs --rpc <url> puts your own first`,
    "",
    "## What to run",
    "",
    `- node scripts/verify.mjs   (testnet) and node scripts/verify.mjs --network mainnet: Node 20+, nothing to install; replays the dish from generation 0 at one final block, prints ${VERIFY_CLI_ROWS} rows (${VERIFY_CLI_ROWS - 1} checks and a key note), ends "Everything matches." and exits 0 (1 = a row differs, 2 = the dish could not be read). ${SITE}/verify runs ${VERIFY.checks} checks in the browser.`,
    `- cargo test -p petri-core -p petri-contract   (${TESTS.core} core + ${TESTS.contract} contract = ${TESTS.total} tests)`,
    `- cd purse && cargo test   (living slides: ${PURSE.tests.purse} purse + ${PURSE.tests.factory} factory + ${PURSE.tests.json} JSON tests)`,
    `- Play: open ${SITE}/dish, type a name, press Start my colony; about 20 seconds later the colony is on petri-v6.testnet with a link to its transaction. No wallet, no gas prompt.`,
    `- Agents: curl "${SITE}/api/agent/world?account=<your-account>.testnet"; node agents/sdk/example-bot.mjs; node agents/mcp/server.mjs (stdio MCP, tools petri_world, petri_plant, petri_join, petri_council, petri_bid, petri_offer_pact, petri_accept_pact)`,
    "",
    "## Where the proof is",
    "",
    `- ${SITE}/judges: every claim checked live on both dishes, each track's prompt line by line, a trade feed, one button per mechanic`,
    `- ${SITE}/verify: the whole ledger replayed in the browser`,
    `- ${SITE}/break: attacks sent as real testnet transactions, each refused by the contract`,
    `- ${SITE}/coin: every PETRI mint and burn since genesis, and 60 simulated days`,
    `- ${SITE}/sim: a week of the dish in a minute, on the contract's own core`,
    `- ${SITE}/strains, ${SITE}/strains/new, ${SITE}/strains/join, ${SITE}/strains/break: the swarm, spawning, the open council, a pact the contract keeps`,
    `- ${REPO}/blob/main/sim/out-60d/README.md: 60 days x 5 scenarios x 5 seeds, and 1,000 adversarial seasons (0 came out ahead in NEAR)`,
    `- ${REPO}/blob/main/docs/LIVING-SLIDES.md and docs/SLIDES-THREAT-MODEL.md: living slides, threat model, testnet and mainnet transactions`,
    `- ${REPO}/blob/main/agents/tee.mjs: NEAR AI Cloud TEE signature verification`,
    `- ${REPO}/blob/main/.github/workflows/live.yml: CI replaying both dishes every 6 hours and counting mainnet keys`,
    "",
  ];
  for (const g of GROUPS) {
    lines.push(`## ${g}`, "");
    for (const p of PAGES.filter((x) => x.group === g)) lines.push(`- [${p.title}](${url(p.slug)}): ${p.description}`);
    lines.push("");
  }
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
