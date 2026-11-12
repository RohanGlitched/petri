import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C } from "@/components/docs/Code";
import { Doc, H2, Table } from "@/components/docs/ui";
import { BUILD_COMMIT_SHORT, CODE_HASH, REPO, SITE, TESTS, UPGRADED, WASM_BYTES, blob } from "@/components/docs/facts";

export const metadata = docMetadata("changelog");

// `git log --oneline` on main, newest first, with each commit's date.
const COMMITS: [string, string, string][] = [
  ["18e0f06", "Nov 10", "Judge desk: living slides meet the NFT sub-account and transfer-test rows; the open council and spawnable strains in the swarm rows"],
  ["681b680", "Nov 10", "Guests catch a lagging dish up with one delegate per advance: NEAR refuses a delegate action with more than one call from a function-call key"],
  ["037c331", "Nov 10", "Drop the AGENTS.md next build generated"],
  ["37355c9", "Nov 10", "Proof pages on phones: status pills sit at the start of their row and keep their shape"],
  ["c8da1c8", "Nov 10", "Desk: licence button before the slide mint (a guest's credit runs out), credit hint on refusals"],
  ["6433dff", "Nov 10", "Lab: plant-twice pre-signs both plantings; guest colony read with retries; NFT track row for NEP-199 resale payouts"],
  ["ec5fc9d", "Nov 10", "Lab: one call per delegate action (a function-call key cannot sign more), nonce kept past refused actions, plant-twice as two quick plantings; three refusals recorded with near-cli (kept PETRI transfer, v6.5 attach with credit-grown cells, relaunch)"],
  ["de7081e", "Nov 10", "Desk and feed tell team accounts (petri-*.testnet, *.petri-dish.near) and guests apart from outside players; strains row reads house moves only; coin charts: agar on its own band, day ticks; chart right-axis room"],
  ["434d421", "Nov 10", "Proof surfaces, part 2: /judges desk (live claims on both dishes, per-track prompt rows, trade feed, one button per mechanic), /break lab, /sim week in a minute, nav links, CI workflow replaying both dishes every 6 h with the mainnet key count"],
  ["949441e", "Nov 10", "Proof surfaces, part 1: /coin (PETRI mint and burn log and supply rebuilt from the replay), 60-day sim charts on /coin and /rules, judge desk claims, trade feed API, relayer daily budget (shared via Upstash when configured)"],
  ["30f0dd1", "Nov 10", "Sim bench writes bench.json; out-60d README with method, headline numbers and limits"],
  ["490016d", "Nov 10", "Sim: 60 days of the mainnet rules under five scenarios (boom, steady, decline, whale siege, strains only) x 5 seeds, every generation stepped, with day rows, supply SVGs, web.json; and a 1,000-season bench of monopoly attempts (whale, split whale, locker)"],
  ["e0a957a", "Nov 10", "Strains page copy: NEAR AI first, anyone can spawn a strain; one tee field in the strain log type"],
  ["c02a6b0", "Nov 10", "Open swarm pages: /strains/new (spawn a strain with a guarded temperament), /strains/join (world API, SDK, MCP, sealed council bids, agent prompt and tools), /strains/break (talk Captive into breaking its pact; the contract refuses the real transaction)"],
  ["7ca607b", "Nov 10", "MCP server (stdio, on the SDK) so any MCP client can play Petri with its own NEAR key: world, plant, join, council, sealed bids, pacts"],
  ["813f0fe", "Nov 10", "Open swarm: anyone spawns a strain (guarded temperament, own locked sub-account under petri-strains.testnet, prepaid brain charged per decision), an open council where outside agents send NEP-413 sealed bids against the house's committed asks"],
  ["aca2155", "Nov 10", "Mainnet living slide: slide-14.petri-dish.near (0 keys) holds Congo Red's 45-cell slide and plays it as its own colony; proof table; verify.mjs key baseline after creating it; intents join script"],
  ["64e7c53", "Nov 10", "Mainnet living slide, prepared: scripts/purse-mainnet.mjs makes slide-14.petri-dish.near without a factory (strains fund petri-dish.near; one transaction creates, funds, deploys and inits the purse with no key; Congo Red moves slide 14 in"],
  ["9033f78", "Nov 10", "Mainnet house strains no longer try licensed plantings: the contract keeps house PETRI in the house"],
  ["52082d6", "Nov 10", "Living slides on testnet are held and tended by the team bench (full keys), not the strains (dish-only keys)"],
  ["b75b7a9", "Nov 10", "Living slides: docs (what a living slide is, how control passes and what stops the old owner, the design choice, every testnet transaction that proves it, build and test, mainnet cost)"],
  ["3c74165", "Nov 10", "Living slides on the site: each sealed slide's page shows its keyless account (0 access keys read live), NEAR and PETRI held, living cells, feed, tides and royalties, its history from the purse's log and the ledger"],
  ["65bb81e", "Nov 10", "Living slides: agents/purse.mjs (seal, wake, plant its own pattern, claim, move, sell; tendPurses for the house strains behind PETRI_LIVING_SLIDES=1) and scripts/purse-testnet.mjs, the threat-model cases as real testnet transactions"],
  ["f1043ba", "Nov 10", "Living slides: purse contract (keyless account holding one specimen slide, a colony on the dish, its own one-token NEP-171 with NEP-178/NEP-199 and a nonce-pinned market) and the factory that seals slides into purses; no near-sdk, about 29 KB"],
  ["f049161", "Nov 10", "Living slides: threat model for a transfer, written before the code (every way a seller could keep the money, the rule that stops it, the test)"],
  ["d4efa43", "Nov 10", "Delight: the dish sings, cinema mode, time-lapse export, colony share cards"],
  ["c71bff8", "Nov 10", "verify.mjs: the key baseline is the v6.5 deploy"],
  ["400313d", "Nov 10", "README and RULES: both dishes run v6.5 (code-only upgrade on 10 November over the v6.4 state); build hash, commit and size"],
  ["692885b", "Nov 10", "Dish card status above the forecast; earnings never dip while the board catches up"],
  ["8b01ef7", "Nov 10", "The dish: first experiments, the tide clock, who chose each strain move; the game loop on /rules"],
  ["50acb18", "Nov 10", "Home and phones: a live number that grows, ways in under the steps, honest strains, a shorter phone page"],
  ["129ac35", "Nov 10", "/verify leads with its verdict; the check counts are the real ones"],
  ["eee2499", "Nov 10", "The dish: two presses to a living cell, a join that never resets, messages that never cover a button"],
  ["f05cbc2", "Nov 10", "Rename the product to Petri Dish: a memecoin that is alive"],
  ["280adfd", "Nov 10", "One facts module for the version, build, tests and /verify counts; stale figures fixed"],
  ["042b76b", "Nov 10", "Site: /verify, rules and docs expect the v6.5 build (CFSKarjk…, commit 27a5976)"],
  ["5defbf3", "Nov 10", "verify.mjs: v6.5 build hash CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD (reproducible at 27a5976, 617,238 bytes, deployed to both dishes as a code-only upgrade); key-use baseline after the v6.5 deploy"],
  ["27a5976", "Nov 10", "Merge v6.5: code-only upgrade (attach refuses credit-grown living cells, Intents join minimum covers storage, waiting joins not overwritten, NEP-199 payouts)"],
  ["1a143bc", "Nov 10", "v6.5, a code-only upgrade of the v6.4 dishes: a guest attaches NEAR only once its credit-grown cells are dead; a waiting Intents join is replaced only by a join; intent_minimum(\"join\") and the Intents join check include the join's own storage"],
  ["ad8f58d", "Nov 10", "NEAR AI (GLM) answers without thinking: a move is a short JSON choice"],
  ["5b217d7", "Nov 10", "TEE check: the signed text is <model>:<request sha256>:<response sha256>"],
  ["98fdfae", "Nov 10", "Mainnet house strains also plant each other's slides under licence; mainnet slides every 8 h (VM drop-in)"],
  ["4e25512", "Nov 10", "Strains ask NEAR AI Cloud first and verify each answer's TEE signature: sha256 of the exact request and response, EIP-191 recovery to the signing address, and that address in the enclave's attestation report (saved with its hash)"],
  ["f328e3a", "Nov 10", "Bench colonies plant other colonies' specimen slides under licence (35% of their moves), so licence discounts and holder royalties run on chain"],
  ["e353c81", "Nov 10", "Agents attach 100 TGas per call instead of 300: NEAR reserves prepaid gas at the pessimistic price until the refund lands"],
  ["9a5856f", "Nov 4", "README: entered in memecoins, games, nfts, swarms and open; a For each track table says what each track judge should look at and what is missing"],
  ["e51769a", "Nov 4", "Both dishes relaunched on v6.4 (reproducible at 749f246, code hash Bd3dWehniNxaJrzdbaxn8s9LDYAxS46KhmpPuNRXwAcL, 606,302 bytes; 37 + 143 tests); verifier key-nonce baseline after setup; fresh verify transcript; README, rules, docs and changelog: v6.4"],
  ["749f246", "Nov 4", "v6.4: first attach also zeroes the colony's tide window, so guest-period earnings never become vault NEAR; planting stake counts the cost without the royalty; relaunch keyed by a version marker (clears a v6.3 dish"],
  ["7357c70", "Nov 4", "Both dishes relaunched on v6.3 (reproducible at 29d79b1, code hash 55Qn4Kw3kDCz7nj4oCedR3BYVrHegvT1bLs6m89cV4sz, 606,298 bytes)"],
  ["29d79b1", "Nov 4", "v6.3: a colony's stake resets when it first attaches NEAR, and an attached colony's planting stakes only the PETRI it paid that is not kept, so cells bought with credit or kept PETRI never earn vault NEAR; relaunch clears a v6.2 dish (frozen v6.2 fixture"],
  ["940cb66", "Nov 4", "README leads with what Petri is, who it is for and the evidence; Does it last and reusable-primitives sections; review history moved to docs/HISTORY.md; v6.1 simulator numbers; tracks memecoins, games, open. Guests see a game card first (details folded)"],
  ["675b0b6", "Nov 4", "Docs for v6.2 (changelog, rules, contract API, strains' sealed-bid council, fresh verify transcripts); pact offers name at least 1 PETRI"],
  ["f4a7b0b", "Nov 4", "Site: 2D fallback when WebGL is software, paused off-screen canvases and a frame budget; dish reads in parallel with a 5 s snapshot route; every block of live numbers names its dish; three-step hero; bench colonies tagged; phone rules sections fold"],
  ["5690ea2", "Nov 4", "Relaunch both dishes on v6.2: code hash 5v38Vgci… (reproducible at e791404, 605,767 bytes); verifier and docs point at it"],
  ["e791404", "Nov 4", "v6.2: a colony is attached only by bringing at least min_join of its own NEAR, kept PETRI holders are paid in credit, dust wNEAR is returned, royalties from kept PETRI go to the agar, pact offers need 1 PETRI and incoming offers have their own cap, sell and mint_slide need a current dish, exact petri_for_near, storage charged for rename and set_payout, NEPs listed in source metadata; site and relay put advance before a move on a lagging dish"],
  ["2301fb6", "Nov 4", "README: Vercel hosting, both-dish switch labels, 43 verify checks; drop the temporary host banner"],
  ["9d021c1", "Nov 4", "Strains advance a slow dish before planting or minting, so a planting is never refused and a slide never captures a stale board"],
  ["430b263", "Nov 4", "Council clears by sealed bids (payer's sealed bid against the promisor's sealed ask, at the midpoint); mainnet keeper keeps the dish within 400 generations"],
  ["a7c5b0f", "Nov 4", "Rules: the keeper no longer advances for a full pot"],
  ["a839cad", "Nov 4", "Section wells: a strip of agar wells on long pages, scroll-to-top lens, phone section sheet; opaque nav"],
  ["464b70e", "Nov 4", "Council: each offer tells the promisor how much of the open agar where it plays the pact would bar, so a pact far from its colonies reads as nearly free"],
  ["6f47972", "Nov 4", "Nav: structured links with a More menu, a two-dish switch (mainnet live with real NEAR, testnet free play), a live-on-mainnet badge on the home page, grouped phone menu"],
  ["f080a6e", "Nov 4", "Mainnet house at a thirty-second of the pace, so its NEAR lasts through judging"],
  ["a9ef05e", "Nov 4", "Council: pacts may pay up to 30 PETRI (3 bought too little ground for any strain to accept)"],
  ["b549b2e", "Nov 4", "Council and pacts on the strains page, pact zones and offers on the dish, kept PETRI shown, a history per slide, new records; docs for kept PETRI and pacts"],
  ["d02c4bb", "Nov 4", "Relaunch both dishes on v6.1: code hash 8QAsfDHe… (reproducible at 4858ca0, 603,052 bytes) on petri-dish.near and petri-v6.testnet; verifier and site point at it"],
  ["4858ca0", "Nov 4", "v6.1: hot table only for playing colonies (cap 10,000), compact tide entries, licences need 12 cells, PETRI earned before a first NEAR stays in the dish, on-chain pacts the contract enforces, keeper pot to any caller; sim/out-v6.1; docs for v6.1"],
  ["5ab16a3", "Nov 4", "sim v6 on the exact launched rules of both dishes (sim/out-v6); mainnet house at a sixteenth of the pace"],
  ["7fa077e", "Nov 4", "Docs, README and RULES for v6; paid joins take no name in the form or the quote (the dish names them neutrally); keepers no longer chase the pot"],
  ["9c44623", "Nov 4", "Launch v6: petri-dish.near relaunched in place and petri-v6.testnet, both code hash DabiJwsV… (reproducible at dd18fac); verifier, site and agents point at v6"],
  ["dd18fac", "Nov 4", "v6: credit per sponsor, the house can neither sell nor pass PETRI to players and takes no bounty, per-colony books in cold pages and a hot table (30,000 colonies fit), intents never refunded and settleable later, neutral names for colonies paid by others, a ledger that rebuilds every solvency term, NEP-141/145 fixes, slides as pattern licences, relaunch; site self-hosted on the agents VM"],
  ["28d7fdb", "Nov 4", "agents: every candidate forecast 240 generations ahead on a cloned engine, per-strain memory of moves and their measured outcomes, and a council each tide window where strains pay each other PETRI on chain for truces, keep-outs and strikes, with enforced promises and per-pair reputation; ambitious plays in every candidate set"],
  ["9cac13c", "Nov 4", "agents: notes end on a whole sentence; the mainnet house plays at an eighth of the pace and the keeper only steps in before a clock skip once outsiders play"],
  ["c5c2897", "Nov 4", "web: standalone server build"],
  ["4df0e15", "Nov 4", "Docs site at docs.playpetri.xyz (15 pages, llms.txt); README, RULES.md and every page rewritten for the two v5 dishes, specimens and paying with any token; fresh cover and screenshots; guest slide mints fit the relay's gas cap"],
  ["8e1816d", "Nov 4", "agents: house strains fossilize their densest patch as a specimen slide every few hours"],
  ["1a5ab27", "Nov 4", "Point the verifier, agents and site at the v5 dishes (petri-v5.testnet, petri-dish.near) and the reproducible build Foo3au6a…; keeper unwraps waiting wNEAR; a log window per dish; guests can mint slides"],
  ["ec5970f", "Nov 4", "Pin near-sdk 5.29.1: 5.30 links host functions (gas keys, universal state init) that mainnet's protocol 86 does not have yet, so the same build runs on both networks"],
  ["9da6fbe", "Nov 4", "Specimen slides (NEP-171/177/178/181 NFTs drawn on chain, checked by both replays), pay with any token through NEAR Intents, rename, guest bounties as credit; one site for both dishes; mainnet launch rules"],
  ["57cdd4b", "Nov 4", "agents: one runner for both dishes; on mainnet the strains are <name>.petri-dish.near, attach their own NEAR, keep a gas reserve and play at half pace; no bench on mainnet"],
  ["3ad1c70", "Nov 4", "v5: tide credit in packed arrays, free play earns credit not NEAR, payouts need attached NEAR, idle tides skipped, tides 5%; v5 simulator; strains think with Claude Haiku (NEAR AI kept as a second provider); keeper advances less often"],
  ["1faa138", "Nov 4", "v5: credit pool paid as credit, decaying stake, house cells never siege, dormancy skips, payouts to a wallet, credit reclaim, refunds, solvency, sparse stepping; launch rules shared by deploy and tests"],
  ["1c0b096", "Nov 4", "Rules page, README and RULES.md for v4"],
  ["ac13167", "Nov 3", "The agar releases its ration for at least live_floor counted cells and prices use counted cells; relaunch on petri-v4"],
  ["bb0787e", "Nov 3", "Dish, home and verify copy for v3; timer-driven replay; lock reported apart from the history"],
  ["7b82314", "Nov 3", "v3 launch fixes from the simulator: house never fed, sell-back capped by the vault share, tide bounty cap, compact planting records with honest deposits"],
  ["d4ebafa", "Nov 3", "Site, agents and verifier on v3: sponsored-credit guests with function-call keys, sieges, sell-back, full NEAR replay pinned to one block, lock check"],
  ["223f58b", "Nov 3", "Contract metadata: repository link for NEP-330"],
  ["8825539", "Nov 3", "Contract v3: sponsored credit, stake-capped pay, siege plantings, window tides, house colonies, sell-back, full NEAR ledger; wallet sign-in with NEAR Connect"],
  ["02386c1", "Nov 3", "Refresh README screens from production; coin diagram reads the agar from chain"],
  ["cc78534", "Nov 3", "Site v2: buy-in, claims, tides and deposits on the play page; ledger replay on verify; relayer signature, key and budget checks; guest proof of work"],
  ["5227cba", "Nov 3", "Contract v2: NEAR buy-in, payback pricing, capped feed, tides, pull rewards, ledger replay, NEP-145, self-call and text guards; simulator with adversaries"],
  ["40b97bc", "Nov 3", "README with cover, try-it steps, architecture and screens"],
  ["c8db480", "Nov 3", "Rules page and RULES.md for the agar model, per-recipient feed events"],
  ["fd07a1b", "Nov 3", "Verify page and terminal verifier, colonies ledger, strains page with public action log"],
  ["52f25c5", "Nov 3", "Rebuild the site in the macro direction: culture renderer, live rule demos, coin cycle, play page"],
  ["5d4e7c8", "Nov 3", "Nutrient cycle, lab notes, simulator and the strains"],
  ["28acc64", "Nov 3", "Playable dish: guest accounts, gasless planting, specimen tray"],
  ["3498439", "Nov 3", "Browser engine and the live eyepiece"],
  ["6b28846", "Nov 3", "Line endings"],
  ["f97a07b", "Nov 3", "Petri core rules and NEAR contract"],
];

const commit = (h: string) => `${REPO}/commit/${h}`;

export default function Page() {
  return (
    <DocPage slug="changelog" lede="From the first contract to v6.5, in two weeks of November 2026, from the git history. The rules are fixed when a dish starts, so changing them meant a new dish. Up to v5 each version was a fresh contract on a fresh account; for v6 the mainnet dish was started again from generation 0 on the same account, petri-dish.near, and testnet moved to petri-v6.testnet; v6.1 to v6.4 started both again on those accounts. v6.5 is the first code-only upgrade: both dishes kept their state.">
      <H2 id="v6-5">v6.5: a code-only upgrade, {UPGRADED}</H2>
      <p>
        The version both dishes run, built reproducibly at <a href={commit(BUILD_COMMIT_SHORT)}>{BUILD_COMMIT_SHORT}</a> with code hash <C>{CODE_HASH}</C> ({WASM_BYTES.toLocaleString("en-GB")} bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.5.0). Unlike every version before it, v6.5 was deployed over the running v6.4 dishes and kept their state: no stored type changed, and the stored version marker stays &ldquo;6.4&rdquo; because it names the layout. The test <C>v6_5_runs_a_v6_4_dish_exactly_as_v6_4_does</C> builds a real v6.4 dish with the frozen v6.4 code (a dev-dependency), checks v6.5 reads every record to the same bytes and every view to the same JSON, then runs 25 further calls on both versions from that state and checks the trie is byte for byte the same. The contract has {TESTS.contract} tests and petri-core {TESTS.core}.
      </p>
      <ul>
        <li>A colony outside the house that has never attached NEAR attaches only while it has no living cells. Otherwise the call is refused (&ldquo;a colony that grew on sponsored credit must let its cells die (or start a new colony) before it brings its own NEAR&rdquo;) and writes nothing, so every attach that succeeds is exactly a v6.4 attach and the replay is unchanged (<C>a_refused_attach_writes_nothing</C>). Cells grown on credit can no longer live on into a colony&rsquo;s paid life.</li>
        <li><C>intent_minimum(&quot;join&quot;)</C> and the Intents join check include the join&rsquo;s own storage (colony record, name, registration, entry, a cold slot and the purchase record), so a join paid at the floor nets at least <C>min_join</C> and attaches. For <C>alice.near</C> the floor is 0.01912 NEAR.</li>
        <li>A waiting Intents join is replaced only by another join; a purchase&rsquo;s NEAR adds to it instead of overwriting the order.</li>
        <li>Slides answer NEP-199: <C>nft_payout</C> and <C>nft_transfer_payout</C> pay 5% of a sale to the account of the colony that minted the slide (its payout account if set) and the rest to the seller, from stored data only.</li>
      </ul>

      <H2 id="since-v6-5">Since v6.5 (10 November)</H2>
      <p>None of these change the dish contract.</p>
      <ul>
        <li><strong>NEAR AI first, verified.</strong> The strains ask NEAR AI Cloud (GLM, inside a TEE) first and check every answer&rsquo;s signature: sha256 of the exact request and response, EIP-191 recovery, and the signer named in the enclave&rsquo;s attestation report (<a href={blob("agents/tee.mjs")}>agents/tee.mjs</a>). Claude Haiku answers when NEAR AI does not (<Doc to="ai-strains" hash="providers">AI strains</Doc>).</li>
        <li><strong>Living slides.</strong> A slide sealed into its own keyless account that is a colony, holds what it earns and passes whole to its holder: the purse contract and factory in <C>purse/</C>, the testnet factory <C>petri-slides.testnet</C> and, on mainnet, <C>slide-14.petri-dish.near</C> (<Doc to="living-slides">Living slides</Doc>).</li>
        <li><strong>Open swarm.</strong> Anyone can spawn a strain on testnet, outside agents bid in an open sealed council with NEP-413 signatures, an SDK, an example bot and an MCP server, and a page where you talk a pact-bound strain into cheating and the contract refuses the real transaction (<Doc to="open-swarm">Open swarm</Doc>).</li>
        <li><strong>Proof surfaces.</strong> <a href={`${SITE}/judges`}>/judges</a> (live claims on both dishes, each track&rsquo;s prompt line by line, a trade feed, one button per mechanic), <a href={`${SITE}/coin`}>/coin</a> (every mint and burn), <a href={`${SITE}/break`}>/break</a> (attacks the contract refuses), <a href={`${SITE}/sim`}>/sim</a> (a week in a minute), sixty simulated days and a 1,000-season bench (<a href={blob("sim/out-60d/README.md")}>sim/out-60d</a>), and a CI workflow that replays both dishes every six hours (<a href={blob(".github/workflows/live.yml")}>live.yml</a>).</li>
        <li><strong>Delight.</strong> A generative soundscape, cinema mode (press C), a time-lapse export and a share card for every colony (<C>/c/&lt;id&gt;</C>).</li>
      </ul>

      <H2 id="v6-4">v6.4: petri-v6.testnet and petri-dish.near</H2>
      <p>
        The version both dishes ran until v6.5, built reproducibly at <a href={commit("749f246")}>749f246</a> with code hash <C>Bd3dWehniNxaJrzdbaxn8s9LDYAxS46KhmpPuNRXwAcL</C> (606,302 bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.4.0). The seventh review found that v6.3&rsquo;s first attach reset a colony&rsquo;s stake but not its share of the current tide window; v6.4 zeroes the window too, and a planting&rsquo;s stake counts its cost without the royalty. <C>relaunch</C> writes a version marker and clears a v6.3 dish (<C>relaunch_leaves_nothing_of_v6_3</C>). Both dishes started again from generation 0 on it on 4 November 2026; it had 143 contract tests.
      </p>
      <H2 id="v6-3">v6.3</H2>
      <p>
        The version both dishes ran until v6.4, built reproducibly at <a href={commit("29d79b1")}>29d79b1</a> with code hash <C>55Qn4Kw3kDCz7nj4oCedR3BYVrHegvT1bLs6m89cV4sz</C> (606,298 bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.3.0). The sixth review found one medium issue: cells a colony planted with sponsored credit or kept PETRI kept their stake after the colony first attached NEAR, so for about a day of tides they could earn NEAR from the vault. v6.3 resets a colony&rsquo;s stake when it first attaches, and an attached colony&rsquo;s planting stakes only the share of its cost paid with PETRI that is not kept. The replay mirrors both rules; the sybil test now runs two tides after the attach. <C>relaunch</C> now clears a v6.2 dish (<C>relaunch_leaves_nothing_of_v6_2</C>), and both dishes started again from generation 0 on 4 November 2026.
      </p>
      <H2 id="v6-2">v6.2</H2>
      <p>
        The version both dishes ran until v6.3, built reproducibly at <a href={commit("e791404")}>e791404</a> with code hash <C>5v38VgcibRJesPt6H7h2rwPGmmE5Bi2715vHKSGrvncP</C> (605,767 bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.2.0). Both dishes were started again from generation 0 on 4 November 2026, on the accounts they ran v6.1 on, through the same <C>relaunch(rules, accounts)</C>, which now clears a v6.1 dish: it refuses an account with no v6.1 dish and one that already runs v6.2, and a test (<C>relaunch_leaves_nothing_of_v6_1</C>) builds a real v6.1 state with v6.1&rsquo;s frozen code and checks the result is byte for byte a fresh v6.2 launch. Both dishes were hours old, so nothing was migrated. The contract changes answer the fifth review round&rsquo;s findings and the notes of a judge who knows NEAR. The contract has 139 tests and petri-core 36.
      </p>
      <ul>
        <li>A colony attaches NEAR only when one join, buy or planting puts at least <C>min_join</C> (0.01 NEAR), net of storage, into the vault. Less goes to the vault and into <C>near_in</C> but attaches nothing, so a yoctoNEAR on a call paid from credit no longer turns credit into NEAR (<C>one_yocto_does_not_turn_credit_into_near</C>). The site&rsquo;s 0.02 NEAR join nets about 0.0155 and still attaches.</li>
        <li>A colony is paid in NEAR only while it has attached NEAR and holds no kept PETRI. At a tide its share of the vault and any bounty it earned are otherwise credit, as a guest&rsquo;s are, and <C>claim</C> pays NEAR only while <C>kept</C> is 0: with kept PETRI it claims only PETRI, its NEAR stays owed and no <C>Claim</C> entry is written. The books gained a <C>kept</C> flag, so a tide still reads only hot rows (<C>kept_petri_is_paid_in_credit_and_claims_no_near</C>).</li>
        <li>A royalty paid out of kept PETRI goes to the agar. When the planter has not attached NEAR, or holds more kept PETRI than the planting costs (read after the planting&rsquo;s claim), the whole royalty goes to the agar and <C>to_agar</C> is true (<C>kept_petri_pays_its_royalty_to_the_agar</C>).</li>
        <li>Pacts cannot jam a colony. Every offer carries at least 1 PETRI (<C>MIN_PACT_PETRI</C>) unless both colonies are the house&rsquo;s, so guests, colonies holding kept PETRI and the house towards players can no longer offer one. <C>MAX_PACTS</C> (8) counts only accepted pacts and the offers a colony made; offers waiting for a colony have their own cap, <C>MAX_OFFERS_IN</C> (16), which the colony empties by declining; <C>pact_accept</C> first ends the acceptor&rsquo;s expired pacts (<C>offers_cannot_jam_a_colonys_pacts</C>). A pact protects the payer&rsquo;s living cells as the board stands at each planting, cells planted after the acceptance included; that is documented, not changed.</li>
        <li>wNEAR too small for its own records is refunded. <C>ft_on_transfer</C> returns the whole amount when it is no larger than a fresh pending record and its <C>Pending</C> entry cost at the byte price, and writes nothing (<C>dust_wnear_is_refunded</C>). Amounts that cover their records are still never refunded. The <C>Dust</C> path remains but can no longer be reached.</li>
        <li>A join runs the clock only if the NEAR attached to it is at least <C>min_join</C>, so a join on credit takes no bounty or pot. <C>petri_for_near</C> is exact for any deposit (petri-core gained a 256-bit <C>wide_mul_div</C>). <C>set_payout</C> and <C>rename</C> are payable and charge the storage they add from the attached NEAR; the rest comes back.</li>
        <li><C>sell</C> and <C>mint_slide</C> need the dish to be current after their catch-up, as <C>plant</C> did. Before a plant, sell, mint_slide or buy the site reads the dish and, if it lags by more than one call catches up, puts up to three <C>advance</C> calls in the same transaction ahead of the move; the relay accepts one call preceded by up to three <C>advance</C> calls with no deposit. The strains advance a dish that is more than 120 generations behind before they plant or mint.</li>
        <li>The council clears by sealed bids. The payer gives a sealed maximum bid and the promisor a sealed ask; an accepted offer is made at the open price, and a declined one still clears at the midpoint of ask and bid if the ask is within the bid (<Doc to="ai-strains" hash="council">The council</Doc>).</li>
        <li>New key prefixes for what a wrong account list could leave behind (balances <C>r</C>, grants <C>e</C>, pending NEAR <C>z</C>, cold pages <C>x</C>); everything else keeps its v6.1 key. <C>contract_source_metadata</C> lists the standards the dish implements (NEP-141, 145, 148, 171, 177, 178, 181, 297 and 330).</li>
        <li>Both replayers check the new rules: a share or bounty of a colony holding kept PETRI is credit, a <C>Claim</C> by such a colony is a violation, the royalty rule, the pact caps and the 1 PETRI minimum.</li>      </ul>

      <H2 id="v6-1">v6.1: petri-v6.testnet and petri-dish.near</H2>
      <p>
        The version both dishes ran until v6.2, built reproducibly at <a href={commit("4858ca0")}>4858ca0</a> with code hash <C>8QAsfDHePT3TdZ6LvJRV9pcNHfHJemgFbiBBaZK6ZPwR</C> (603,052 bytes, near-sdk 5.29.1, event standard <C>petri</C> 6.1.0). Both dishes were started again from generation 0 on 4 November 2026, on the accounts they ran v6 on, with <C>relaunch</C>: a private initializer that deletes every key v6 wrote, refuses an account with no v6 dish and one that already runs v6.1, and is covered by a test (<C>relaunch_leaves_nothing_of_v6</C>) that builds a real v6 state with v6&rsquo;s frozen code and checks the result is byte for byte a fresh v6.1 launch. A migration would have had to keep two formats of every entry in both replayers, and both dishes were hours old. Every contract change answers a finding of the simulator rerun on v6 (see <Doc to="simulations" hash="v6-1">Simulations</Doc>). v6.1 had 132 contract tests and 35 for petri-core.
      </p>
      <ul>
        <li>The hot table holds only the colonies that play now: those that earned since the last tide, and those with living cells and a stake that can still earn (125 or more thousandths of a cell at reach 8). It never holds the house, holds at most 10,000 rows (a colony with no row that plants while it is full waits for the next tide), and at most 32 rows leave it a call. Everyone else waits in a 69-byte slot in a cold page, now 32 colonies a page, whose stake decays lazily, tide by tide, when it is read. The catch-up stops at 110 TGas (was 180) less what is still to write. At 30,000 colonies in the simulator the hot rows fell from 17,102 to 1,336 on average, the largest call from 237 to 61 TGas, and calls over 150 TGas from 116,731 to 0.</li>
        <li>Ledger entries are smaller. A <C>Tide</C> entry is <C>{"{ generation, chain, bytes, by }"}</C>: 130 bytes with its place in a packed tide index, was 289. A replay works out the amounts, and a new <C>tide</C> event logs them. PETRI amounts in entries are <C>u64</C>. A planting&rsquo;s fixed storage is 180 bytes (was 240) and a purchase&rsquo;s 113 (was 140).</li>
        <li>A slide is a licence only if it captured at least 12 cells (the new rule <C>licence_min_cells</C>); a smaller one is a keepsake. A planter that has never attached NEAR pays its royalty to the agar, not to the holder (<C>Licence</C> gains <C>to_agar</C>).</li>
        <li>The keeper pot goes to the account whose call ran at least one generation, whichever call it was, if the account is registered for PETRI and is not a house account, a keeper or a guest. <C>advance</C> no longer pays it separately.</li>
        <li>Free play never reaches NEAR. PETRI earned before a colony&rsquo;s first NEAR (and PETRI bought with credit) is <em>kept</em>: a colony that has never attached NEAR cannot send PETRI at all, and while a colony holds any kept PETRI it cannot sell for NEAR, send PETRI or pay into a pact. Plantings and slides spend it first. <C>Colony</C> gains <C>attached</C> and <C>kept</C>; <C>sell</C> claims the seller&rsquo;s earnings first. In the simulator the vault&rsquo;s NEAR paid for farmed PETRI fell from 0.1674 to 0 and a transfer attack that drew +0.0470 NEAR a week per operator drew none (<Doc to="economy" hash="kept">Kept PETRI</Doc>).</li>
        <li>Pacts the contract enforces. The council still negotiates with Claude Haiku, but an accepted deal is now made on chain: <C>pact_offer</C> escrows the payer&rsquo;s PETRI, <C>pact_accept</C> pays it to the promisor, and until the pact ends the contract refuses the promisor&rsquo;s plantings within <C>pact_radius</C> (8) cells of the payer&rsquo;s living cells. A colony is party to at most 8 pacts; <C>pact_cancel</C>, the views <C>pact</C> and <C>pacts_of</C>, the entries <C>PactOffer</C>, <C>PactAccept</C> and <C>PactEnd</C>, the <C>pact</C> event, the rules <C>pact_radius</C> and <C>pact_max_gens</C> and <C>pact_escrow</C> in the state are new, and both replays check every pact (<Doc to="ai-strains" hash="pacts">Pacts</Doc>). The strains&rsquo; keep-out and strike promises, which the contract could not hold anyone to, are gone.</li>
        <li>Measured and decided: the pulsar farmer&rsquo;s +0.11 NEAR a week is the licence working as designed, paid only by planters that choose the licence (<Doc to="simulations" hash="v6-1-broken">Simulations</Doc>).</li>
        <li>New key prefixes for everything per account, the cold pages, the hot table and the tide index, so a key a wrong account list leaves behind can never be read as v6.1 state.</li>
        <li>The site prepays 300 TGas for join, plant, buy, sell, claim, advance and mint_slide (unused gas is refunded), and the relay accepts up to 300. Both replayers work out every tide amount themselves and check the new rules.</li>
      </ul>

      <H2 id="v6">v6: petri-v6.testnet and petri-dish.near</H2>
      <p>
        The version both dishes ran until v6.1 replaced it, built reproducibly at <a href={commit("dd18fac")}>dd18fac</a> with code hash <C>DabiJwsVJnfizmhfTFGCmdUma2o3THFUZ89eHMjGoMC7</C> (571,418 bytes, near-sdk 5.29.1). On mainnet the v6 code was deployed to <C>petri-dish.near</C> with <C>relaunch</C>, a private <C>#[init(ignore_state)]</C> method that deletes every key v5 wrote and starts a fresh dish from generation 0 with <C>launch-rules-mainnet.json</C>; it refuses an account that already ran v6. On testnet v6 ran on a new account, <C>petri-v6.testnet</C>, started with <C>new</C>. Both dishes started from generation 0 on 4 November 2026. Every contract change answers a finding of the fourth review round (see the <Doc to="security">security model</Doc>).
      </p>
      <ul>
        <li>Sponsored credit is kept per sponsor (at most 8 sponsors an account, at least 0.01 NEAR a sponsorship): a sponsor can take back only what it gave and the account has not spent, once a day has passed on the wall clock since it last gave or the account last drew on it. Won credit is spent first, then sponsors&rsquo; credit oldest first. <C>credit_grants</C> replaces <C>credit_record</C>.</li>
        <li>The house (its strains and the new <C>keepers</C> rule) can never sell PETRI back, can pass PETRI only to other house accounts, never takes the keeper pot or a tide bounty (a tide it runs leaves the bounty in the vault), plants only slides it holds; a wNEAR payment for a house account cannot start its colony and waits as pending NEAR.</li>
        <li>Each colony&rsquo;s numbers moved from v5&rsquo;s seven packed arrays to cold pages of 64 colonies and a hot table of the colonies that play, so no call costs more as more colonies join. (The simulator later showed that the table, which held every colony with stake, still grew to 27,538 rows on a busy dish; v6.1 narrowed it.)</li>
        <li>wNEAR from NEAR Intents is never refunded: whatever arrives becomes pending NEAR with its order (or, if too small for a record, goes to the vault as <C>Dust</C>; v6.2 refunds such an amount instead). <C>settle_pending</C> lets anyone run a waiting order later; <C>intent_minimum</C> tells 1Click the least a payment needs, and the site refuses quotes below it.</li>
        <li>A colony someone else paid to start gets a neutral name, &ldquo;Culture&rdquo; and hex digits of its account&rsquo;s hash, and may rename once; the payer&rsquo;s text never appears under another account. Players cannot choose such names.</li>
        <li>The ledger gained <C>Sponsor</C>, <C>Unsponsor</C>, <C>Claim</C>, <C>Pending</C>, <C>Unpend</C>, <C>Dust</C> and <C>Burn</C> entries, and <C>Refund</C> names the payout it refunds, so both replays rebuild every solvency term from the ledger alone and compare it with the contract&rsquo;s counters.</li>
        <li>A failed sale, claim, reclaim or pending claim becomes pending NEAR for its account; only a failed bounty goes back to the vault. <C>set_payout</C> refuses the dish itself.</li>
        <li>NEP-141 and NEP-145: PETRI refunded to a sender that unregistered meanwhile is burned, and <C>storage_unregister(force: true)</C> burns the balance (colony accounts still cannot unregister). <C>nft_tokens</C> returns at most 10 tokens a call.</li>
        <li>Specimen slides are pattern licences: planting a slide&rsquo;s exact pattern, moved but not turned, costs 25% less, and anyone but its holder pays the holder 10% of that cost in PETRI. Both replays check the shape, the price, the royalty and the holder.</li>
        <li>The agents gained forecasts, memory and a council where the strains pay each other PETRI on chain for promises, held by the agents&rsquo; own code (v6.1 moved them into the contract, as pacts); the site is self-hosted on the agents&rsquo; VM.</li>
      </ul>

      <H2 id="v5">v5: petri-v5.testnet and petri-dish.near</H2>
      <p>The version both dishes ran until v6, built reproducibly at <a href={commit("ec5970f")}>ec5970f</a> with code hash <C>Foo3au6aYVQMV2cLv5p3DreSYEWgfHwq2MpKU4zv7U6j</C>. Its mainnet dish was replaced in place by v6.</p>
      <ul>
        <li>The credit pool pays out as credit; credit won is spent first and no sponsor can take it back; sponsors may reclaim credit left unused for a day.</li>
        <li>Stake decays to 87.5% at every tide, so a colony&rsquo;s pay cap is rent it renews by planting.</li>
        <li>House cells never make a siege; the house is never fed and takes no tide share.</li>
        <li>Dormancy: a dish nobody tends for two hours skips ahead instead of piling up work. Idle tides are skipped.</li>
        <li>Payouts to a separate wallet with <C>set_payout</C>, refunds of failed payouts, a solvency view, sparse stepping.</li>
        <li>Tide credit kept in packed arrays (a 1,500-winner tide under 10 TGas of host calls); free play earns credit, not NEAR; only a colony that attached NEAR is paid NEAR; tides cut from 10% to 5%.</li>
        <li>Specimen slides: NEP-171/177/178/181 tokens of a colony&rsquo;s own cells with the SVG drawn on chain, checked by both replays.</li>
        <li>Pay with any token: wNEAR from NEAR Intents is unwrapped into a join or purchase, or waits as pending NEAR; <C>rename</C> for colonies someone else started.</li>
        <li>One site for both dishes with a testnet/mainnet switch; the mainnet dish, <C>petri-dish.near</C>, with its own house accounts.</li>
        <li>The strains think with Claude Haiku first and NEAR AI Cloud second; on mainnet they attach their own NEAR and play at half pace.</li>
        <li>near-sdk pinned to 5.29.1 so the same build runs on mainnet&rsquo;s protocol 86.</li>
      </ul>

      <H2 id="v4">v4: petri-v4.testnet</H2>
      <ul>
        <li>The agar releases its ration for at least <C>live_floor</C> counted cells, and never more per cell, so on a sparse dish a cell earns what its price assumes.</li>
        <li>Prices use counted cells rather than all living cells.</li>
        <li>The rules page, README and RULES.md describe reach, sieges, window tides, the house, sell-back, sponsored credit and the lock.</li>
      </ul>

      <H2 id="v3">v3: petri-v3.testnet</H2>
      <ul>
        <li>Sponsored credit for guests, held by the contract; guests with function-call keys; wallet sign-in with NEAR Connect.</li>
        <li>Pay capped by stake (reach); siege plantings at a multiple of the price; tides split by what colonies earned since the last one; house colonies; sell-back to the agar; a full NEAR ledger.</li>
        <li>From the simulator: the house is never fed, the sell-back is capped by the vault share, the tide bounty is capped, planting records are compact with honest deposits.</li>
        <li>NEP-330 metadata with the repository link; the verifier pins one block and checks the lock.</li>
      </ul>

      <H2 id="v2">v2</H2>
      <ul>
        <li>NEAR buy-in instead of free PETRI; planting priced by payback; a capped feed; NEAR tides; pull-based rewards; a ledger the replay reads.</li>
        <li>NEP-145 storage, guards against the contract calling itself and against hidden text.</li>
        <li>An economy simulator with adversaries; on the site, buy-in, claims and tides; relayer signature, key and budget checks; a proof of work for guests.</li>
      </ul>

      <H2 id="v1">v1</H2>
      <ul>
        <li>petri-core: Life with colony ownership as a shared <C>no_std</C> crate, a bit-sliced step, a compact board, the history chain every 16 generations.</li>
        <li>The dish contract with the PETRI token: PETRI granted on joining, planting burns, emission split by living cells, a keeper share, a capped catch-up and a replayable plant log.</li>
        <li>The browser engine and the live eyepiece; guest accounts and gasless planting through a NEP-366 relayer; the verify page and terminal verifier; the strains.</li>
      </ul>

      <H2 id="commits">Every commit</H2>
      <Table caption="git log --oneline, newest first (all 2026)">
        <thead>
          <tr>
            <th>Commit</th>
            <th>Date</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          {COMMITS.map(([h, d, s]) => (
            <tr key={h}>
              <td>
                <a href={commit(h)}>
                  <C>{h}</C>
                </a>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{d}</td>
              <td>{s}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </DocPage>
  );
}
