// Each track prompt we entered, requirement by requirement, and where Petri meets it (or does not). Kept in one file so
// the desk and the README say the same thing; "met" only where a judge can check it live or in the code.

import { REPO } from "./config";

export type Status = "met" | "partly" | "no";
export type Req = { need: string; where: string; links: { label: string; href: string }[]; status: Status };
export type Track = { id: string; name: string; prompt: string; reqs: Req[] };

const code = (path: string) => `${REPO}/blob/main/${path}`;

export const TRACKS: Track[] = [
  {
    id: "memecoins",
    name: "Memecoins With Mechanics",
    prompt: "The prompt's example is a streak coin; Petri's mechanic is a living one: the agar mints PETRI only to cells that stay alive, and plantings burn it.",
    reqs: [
      {
        need: "An NEP-141 token with the mechanic in the contract, not a backend",
        where: "PETRI is NEP-141 (with NEP-145 storage) in the dish contract itself; the feed, burn and prices run inside every call, and the dish advances with any player's transaction.",
        links: [
          { label: "token.rs", href: code("contract/src/token.rs") },
          { label: "feed in petri-core", href: code("core/src/lib.rs") },
          { label: "the coin's log", href: "/coin" },
        ],
        status: "met",
      },
      {
        need: "All parameters set at launch, readable by anyone, no admin key to change them",
        where: "Every parameter is in rules() and no method changes it (try it on /break). The full-access key on petri-dish.near is disclosed on the desk above and deleted on 14 November after a final verify.",
        links: [
          { label: "rules() live", href: "/rules#parameters" },
          { label: "try to change them", href: "/break" },
          { label: "relaunch.rs", href: code("contract/src/relaunch.rs") },
        ],
        status: "partly",
      },
      {
        need: "Sybil resistance good enough for a demo, limits written plainly",
        where: "A colony's pay is capped by its own planted stake (splitting earns nothing more); free-play PETRI is kept and can never be sold for NEAR or sent; guests cost a proof of work and are rate limited.",
        links: [
          { label: "test: sybil guests reach no vault NEAR", href: code("contract/src/tests.rs") },
          { label: "README limits", href: `${REPO}#limits-honestly` },
        ],
        status: "met",
      },
      {
        need: "A page with the current state, today's progress and a log of every mint and burn",
        where: "/coin replays the ledger in the browser: supply now, supply over time, and a filterable log of every feed, purchase, sale, burn, royalty and tide. The longest-lived colony is printed there like a high score.",
        links: [
          { label: "/coin", href: "/coin" },
          { label: "/records", href: "/records" },
        ],
        status: "met",
      },
      {
        need: "Simulate 60 days first; show supply over time under a few scenarios",
        where: "Five scenarios (boom, steady, decline, whale siege, strains only) x 5 seeds, every generation stepped with petri-core, plus 1,000 adversarial seasons.",
        links: [
          { label: "charts on /coin", href: "/coin#sixty" },
          { label: "sim/out-60d", href: `${REPO}/tree/main/sim/out-60d` },
        ],
        status: "met",
      },
    ],
  },
  {
    id: "games",
    name: "Games With Real Economies",
    prompt: "The prompt's example is a market town with merchant agents; in Petri the five AI strains are the NPCs with wallets, and the agar is the market maker.",
    reqs: [
      {
        need: "NPCs that are agents with their own wallets, pricing from stock and demand",
        where: "Five strains, each its own NEAR account, plant, buy and license slides with their own NEAR; the agar's price rises as it empties and its buy-back is capped by the vault.",
        links: [
          { label: "/strains", href: "/strains" },
          { label: "strategies.mjs (their rules, one file)", href: code("agents/strategies.mjs") },
        ],
        status: "met",
      },
      {
        need: "Items as NEP-245 multi tokens",
        where: "Petri's items are a NEP-141 coin and NEP-171 slides in one contract; there is no NEP-245.",
        links: [{ label: "slides.rs", href: code("contract/src/slides.rs") }],
        status: "no",
      },
      {
        need: "Social or email login; no seed phrases, wallet popups or gas prompts in the loop",
        where: "Free play makes a key in the browser and a guest account; the relayer pays gas through NEP-366 meta transactions, so there is no popup, seed phrase or gas prompt. There is no social or email login.",
        links: [
          { label: "play as a guest", href: "/dish" },
          { label: "relay route", href: code("web/src/app/api/relay/route.ts") },
        ],
        status: "partly",
      },
      {
        need: "Pricing rules in one readable file; reasoning shown in a tooltip",
        where: "The strains' rules are agents/strategies.mjs; each move's note and the model's reasoning show on /strains and on the dish.",
        links: [
          { label: "strategies.mjs", href: code("agents/strategies.mjs") },
          { label: "/strains", href: "/strains" },
        ],
        status: "met",
      },
      {
        need: "A fast-forward mode: a week of trading in a minute",
        where: "/sim runs the contract's own Rust core in the browser from the live dish, 40,320 generations (7 days) in about a minute, with the strains' policies, scripted players and what-if buttons.",
        links: [{ label: "/sim", href: "/sim" }],
        status: "met",
      },
    ],
  },
  {
    id: "nfts",
    name: "NFTs That Do Something",
    prompt: "A specimen slide is an NEP-171 token of a colony's own living cells: it licenses its pattern and earns royalties for whoever holds it.",
    reqs: [
      {
        need: "An NEP-171 contract plus the logic that ties each token to what it earns",
        where: "Slides are NEP-171 (with 177, 178, 181) in the dish contract; the royalty goes to the holder of the day and moves with the token.",
        links: [
          { label: "slides.rs", href: code("contract/src/slides.rs") },
          { label: "test: after a transfer royalties go to the new holder", href: code("contract/src/tests.rs") },
        ],
        status: "met",
      },
      {
        need: "Earn on resale too",
        where: "Since v6.5 slides answer NEP-199 nft_payout and nft_transfer_payout: a marketplace that sells a slide pays 5% of the price to the colony that minted it.",
        links: [{ label: "slides.rs (NEP-199)", href: code("contract/src/slides.rs") }],
        status: "met",
      },
      {
        need: "Each NFT maps to its own sub-account holding money",
        where: "Living slides: a slide sealed into its own keyless account (slide-14.petri-dish.near on mainnet, slide-<id>.petri-slides.testnet on testnet) that is a colony on the dish, holds the PETRI, NEAR and royalties the slide earns, and passes whole to whoever holds it. 0 access keys, read live on its page.",
        links: [
          { label: "slide-14.petri-dish.near", href: "/specimens/14?net=mainnet" },
          { label: "LIVING-SLIDES.md", href: code("docs/LIVING-SLIDES.md") },
          { label: "purse contract", href: code("purse/contract/src/lib.rs") },
        ],
        status: "met",
      },
      {
        need: "A history view per NFT: what it earned, who held it",
        where: "Each slide's page lists its plantings under licence, royalties and moves between holders, rebuilt from the ledger.",
        links: [{ label: "/specimens", href: "/specimens" }],
        status: "met",
      },
      {
        need: "Tests for the transfer path, including a sale in the middle of a payout",
        where: "A threat model written before the code, one unit test per case, and every case run as a real testnet transaction: a sale while a payout is in flight is refused until it lands, a stale-nonce purchase fails, the old holder is refused after a transfer.",
        links: [
          { label: "SLIDES-THREAT-MODEL.md", href: code("docs/SLIDES-THREAT-MODEL.md") },
          { label: "purse tests", href: code("purse/contract/src/tests.rs") },
          { label: "contract tests", href: code("contract/src/tests.rs") },
        ],
        status: "met",
      },
    ],
  },
  {
    id: "swarms",
    name: "AI Swarms",
    prompt: "Five AI agents trade space: one offers another PETRI for a promise not to plant near it, and the contract escrows the PETRI and enforces the deal.",
    reqs: [
      {
        need: "Each agent its own sub-account under one parent",
        where: "On mainnet the strains are violet.petri-dish.near, safranin.petri-dish.near and so on; anyone can spawn a strain on testnet, which becomes <name>.petri-strains.testnet with a key that can only play, paying for its own NEAR AI decisions.",
        links: [
          { label: "/strains", href: "/strains?net=mainnet" },
          { label: "Spawn a strain", href: "/strains/new" },
        ],
        status: "met",
      },
      {
        need: "A coordinator that collects sealed bids, reveals them and picks a winner; rules written first",
        where: "The open council: each round the house strains publish only the hash of their asks (a published formula), outside agents send bids signed with their own NEAR key (NEP-413), the round reveals and clears at the midpoint, and the deal is made on chain, where the contract escrows the PETRI and refuses any planting that breaks it. The coordinator runs off chain, so the reveal is checkable against the committed hash rather than enforced by a contract.",
        links: [
          { label: "/strains/join", href: "/strains/join" },
          { label: "open-council.mjs", href: code("agents/swarm/open-council.mjs") },
          { label: "pacts.rs", href: code("contract/src/pacts.rs") },
        ],
        status: "partly",
      },
      {
        need: "A simulation mode with scripted strategies, no LLM calls",
        where: "sim/ runs scripted societies on the real rules (60 days, 1,000 seasons); the strains fall back to their written rules when no model answers.",
        links: [{ label: "sim/out-60d", href: `${REPO}/tree/main/sim/out-60d` }],
        status: "met",
      },
      {
        need: "A live page of rounds, bids, clearing price and who got what",
        where: "The pacts and the council's rounds on /strains, from the contract's pacts_of view and the agents' log.",
        links: [{ label: "/strains", href: "/strains" }],
        status: "met",
      },
    ],
  },
  {
    id: "open",
    name: "Open Innovation",
    prompt: "A coin, a game, NFTs and an agent market in one contract, every unit of which anyone can replay from the ledger in a browser.",
    reqs: [
      {
        need: "The rules live in a contract and anyone can read them",
        where: "rules() and every view are public; the whole dish replays from its ledger on /verify and in CI every six hours.",
        links: [
          { label: "/verify", href: "/verify" },
          { label: "CI workflow", href: code(".github/workflows/live.yml") },
        ],
        status: "met",
      },
      {
        need: "A demo on testnet with the timers shortened",
        where: "The testnet dish runs the same code and rules as mainnet (15-second generations, hourly tides), free to play.",
        links: [{ label: "/dish", href: "/dish" }],
        status: "met",
      },
      {
        need: "Failure cases written down",
        where: "The README's limits; /break shows the contract refusing the attacks a judge would try.",
        links: [
          { label: "README limits", href: `${REPO}#limits-honestly` },
          { label: "/break", href: "/break" },
        ],
        status: "met",
      },
    ],
  },
];
