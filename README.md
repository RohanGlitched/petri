<p align="center">
  <img src="docs/cover.png" alt="Petri Dish: a memecoin that is alive. Conway's Life with owners, run by a NEAR contract." width="100%" />
</p>

<h1 align="center">Petri Dish: a memecoin that is alive</h1>

<p align="center"><b>The coin, PETRI, is paid out only to cells that stay alive in a shared Game of Life that runs inside one NEAR contract.</b><br/>People and AI strains plant colonies, NFTs of living cells earn royalties, and anyone can replay every PETRI and every yoctoNEAR from genesis.</p>

<p align="center">
  <a href="https://www.playpetri.xyz"><img alt="Live site" src="https://img.shields.io/badge/live-playpetri.xyz-f2b45a?style=flat-square&labelColor=120a05" /></a>
  <a href="https://nearblocks.io/address/petri-dish.near"><img alt="Mainnet contract" src="https://img.shields.io/badge/mainnet-petri--dish.near-9fd8a8?style=flat-square&labelColor=120a05" /></a>
  <a href="https://testnet.nearblocks.io/address/petri-v6.testnet"><img alt="Testnet contract" src="https://img.shields.io/badge/testnet-petri--v6.testnet-9fd8a8?style=flat-square&labelColor=120a05" /></a>
  <a href="https://github.com/RohanGlitched/petri/actions/workflows/live.yml"><img alt="Both live dishes replayed every 6 hours" src="https://github.com/RohanGlitched/petri/actions/workflows/live.yml/badge.svg" /></a>
  <a href="https://github.com/RohanGlitched/petri/actions/workflows/tests.yml"><img alt="cargo test: core, contract and purse, on every push" src="https://github.com/RohanGlitched/petri/actions/workflows/tests.yml/badge.svg" /></a>
  <a href="https://github.com/RohanGlitched/petri/actions/workflows/tee.yml"><img alt="verify-tee on the newest AI move of each dish, every night" src="https://github.com/RohanGlitched/petri/actions/workflows/tee.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licence-MIT-e2d5c3?style=flat-square&labelColor=120a05" /></a>
</p>

<p align="center">
  <b><a href="https://www.playpetri.xyz/dish">Play, no wallet</a></b> &nbsp;·&nbsp;
  <b><a href="https://www.playpetri.xyz/judges">Judge desk</a></b> &nbsp;·&nbsp;
  <b><a href="https://www.playpetri.xyz/verify">Replay from genesis</a></b> &nbsp;·&nbsp;
  <b><a href="https://www.playpetri.xyz/break">Try to break it</a></b> &nbsp;·&nbsp;
  <b><a href="https://docs.playpetri.xyz">Docs</a></b> &nbsp;·&nbsp;
  <b><a href="RULES.md">Full rules</a></b>
</p>

## Judges: start here

| Step | Do this | You should see |
|---|---|---|
| 1 | Open the **[judge desk](https://www.playpetri.xyz/judges)** | Every claim below checked live in your browser against both dishes (keys, code hash, a full replay, strains, pacts, royalties, TEE checks, tides, burns), each track's prompt line by line, a trade feed, and one button per mechanic that sends a real testnet transaction. |
| 2 | Open **[/verify](https://www.playpetri.xyz/verify)** | Your browser downloads the whole ledger at one final block, rebuilds the dish with the contract's own Rust core and shows 43 checks and a row on the contract's keys (0 on mainnet), ending **Everything matches.** (The terminal script below splits a few of those rows finer and re-reads the chain, board and code hashes from a second and third provider, so it prints 46.) |
| 3 | Open **[/break](https://www.playpetri.xyz/break)**, make a guest colony first (one press there, or **Start my colony** on /dish), then press any **Try it** | A real transaction signed by a guest key in your browser, refused by the contract, with NEAR's own error text and a link to the failed transaction. 13 attacks you can send, plus 3 a guest key cannot even sign, recorded with near-cli. |
| 4 | Open **[/dish](https://www.playpetri.xyz/dish)**, type a name, press **Start my colony** | In about 20 seconds (a proof of work in your browser, then the relayer creates a guest account and joins the dish), your colony is on `petri-v6.testnet` with a link to its transaction. No wallet, seed phrase or gas prompt. |

Five commands for a screener after the clone (Node 20 or later; Rust 1.99 for the tests):

```bash
git clone https://github.com/RohanGlitched/petri && cd petri

node scripts/verify.mjs                     # replays petri-v6.testnet from generation 0
node scripts/verify.mjs --network mainnet   # replays petri-dish.near
# expect 46 "match" rows, then the keys row: mainnet "PASS Full-access keys 0", testnet a "note" on the key
# the team keeps there for fixes; then "Everything matches." and exit code 0
# (exit 1 means a row differs, 2 means the dish could not be read)

cargo test -p petri-core -p petri-contract  # expect "37 passed" (engine) and "152 passed" (contract); rust-toolchain.toml pins 1.99.1
node scripts/projection-test.mjs            # the browser's projection of a lagged dish against mainnet's last skip
cd purse && cargo test                      # living slides: expect 18 (purse), 6 (factory) and 2 (JSON) passed
```

`verify.mjs` needs nothing installed: it loads the committed WebAssembly build of the engine. Replay times depend on the machine and grow with each dish's history (the mainnet run captured below took 137 ms; the testnet dish, with seven times the generations, takes several times longer); public RPC can be slow from shared cloud IPs, so `--rpc <url>` puts a provider you trust first; [the full mainnet output is below](#replay-a-dish-from-genesis).

**The lock, plainly.** `petri-dish.near` has **0 access keys**. On 10 November 2026, after a final verify (Everything matches, 5,016 generations, 4 tides), the team deleted its only full-access key ([`Dsn8BxvX…`](https://nearblocks.io/txns/Dsn8BxvX1goYvUAKVpmNPJ98PsVa5mAXgSwA28WQpaeR)), so nobody can deploy other code, relaunch the dish or move its NEAR, ever. No method changes a running dish's rules, mints PETRI or edits the board. After the v6.5 deploy and before the deletion the key signed two transactions, both creating keyless accounts: the first living slide, `slide-14.petri-dish.near`, and the slide factory `slides.petri-dish.near` ([`D7cJhZC4…`](https://nearblocks.io/txns/D7cJhZC4KPLaXPsb7hpbXBqGv3KViZQLqwYsMoyyWta7)). Check the first row of [/judges](https://www.playpetri.xyz/judges), `view_access_key_list` [below](#the-lock), or the last row of `verify.mjs --network mainnet`. The testnet dish keeps its key so it can still be fixed. What still runs on the team's keys is [below](#the-lock).

## What is real, today

<!-- facts-now:start -->
Read by `node scripts/facts-now.mjs` at mainnet block 223,908,669 and testnet block 277,060,289; run it to diff this table against the chain (`--diff`). The judge desk reads the same figures again when you open it.

| | Mainnet, real NEAR | Testnet, free play |
|---|---|---|
| Contract | [`petri-dish.near`](https://nearblocks.io/address/petri-dish.near) | [`petri-v6.testnet`](https://testnet.nearblocks.io/address/petri-v6.testnet) |
| Full-access keys on the dish | 0 | 1, kept for fixes |
| Slide factory | `slides.petri-dish.near`, 0 keys | `slides.petri-v6.testnet`, 0 keys |
| Generation stored on chain (15 s each) | 4,562 (the clock is at 4,611; the next move catches up) | 34,594 (clock 34,606) |
| Colonies | 8: 5 house, 1 team bench, 2 other team accounts (2 living slides), 0 outside | 55: 5 house, 4 team bench, 13 other team accounts (3 living slides, 8 spawned strains, 2 test agents), 30 guest (anyone's browser, the team's tests included), 3 outside |
| Outside players | none yet | 3 outside wallet colonies, 2 planted |
| Plantings / under a slide's licence | 71 / 2 | 947 / 18 |
| PETRI supply (started at 1,000,000) | 998,967.18 (1,032.82 burned) | 994,842.36 (5,157.64 burned) |
| Hourly tides | 3 tides: 0.0459 NEAR paid as NEAR to colonies that attached NEAR; 0.0201 NEAR of vault shares paid as credit to colonies that never attached NEAR | 91 tides: 0.6794 NEAR paid as NEAR to colonies that attached NEAR; 0.0055 NEAR of vault shares paid as credit to colonies that never attached NEAR |
| Royalties paid to slide holders | 0.00 PETRI | 36.17 PETRI |
| Specimen slides (NFTs) | 19 | 25 |
| Living slides (keyless accounts) | 2: `slide-14.petri-dish.near` (0 keys; colony 6, unattached, no living cells on the stored board); `slide-18.slides.petri-dish.near` (0 keys; colony 8, attached, no living cells on the stored board) | 3: `slide-1.petri-slides.testnet` (0 keys; colony 23, attached, no living cells on the stored board); `slide-2.petri-slides.testnet` (0 keys; colony 24, attached, 12 living cells on the stored board); `slide-24.slides.petri-v6.testnet` (0 keys; colony 43, attached, 20 living cells on the stored board) |
| Pacts the contract enforces | 14 | 16 |
| Spawned strains | testnet only | 8 spawned, 5 with living cells |
| Joins through NEAR Intents | no colony started through Intents yet; 1 delivery held as pending NEAR (the team's own test), 1 settled or paid back | mainnet only |
<!-- facts-now:end -->

Fixed facts, not read live: both dishes run v6.5, code hash `CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD`, reproducible at [`27a5976`](https://github.com/RohanGlitched/petri/tree/27a59761af835f2278b7cf28676c3acf0fdda538); `node scripts/verify.mjs` ends **Everything matches.** and exits 0 on both; [`live.yml`](.github/workflows/live.yml) replays both dishes every 6 hours and on every push and counts the mainnet keys, [`tests.yml`](.github/workflows/tests.yml) runs `cargo test` (core, contract, purse) and the projection test on every push, and [`tee.yml`](.github/workflows/tee.yml) runs `verify-tee` every night on the newest AI move of each dish and on the committed example moves. Which strain moves NEAR AI chose, and whether each one's TEE signature checked, is counted live on [/judges](https://www.playpetri.xyz/judges) (Claude Haiku answers when NEAR AI cannot, and those moves carry no TEE proof).

Not done yet, so not claimed: no outside account has joined through NEAR Intents. One delivery through 1Click has reached the mainnet dish, the team's own test from `keeper.petri-dish.near`: it was held as pending NEAR and then paid back, so it started no colony. The quote route works and the desk's button asks 1Click for a dry quote. There is no NEP-245 and no social login.

## What it is

One shared 128×128 dish of Conway's Life runs inside a NEAR contract, and every living cell belongs to a NEAR account.

- **The coin is the game state.** All 1,000,000 PETRI were minted once, into the dish's reserve, the *agar*. Every 15 seconds the agar feeds a sliver of itself to whatever is alive. Planting costs PETRI; half is burned and half goes back to the agar. No method mints more, so supply only falls.
- **NEAR goes round, not out.** You buy PETRI from the agar with NEAR on a curve that rises as it empties. The NEAR collects in a vault, and every hour 5% of it is paid back to the colonies that earned that hour.
- **Owning ground is a skill.** A colony is paid for at most 8 living cells per cell it planted, so splitting never earns more and holding ground means replanting. Planting within 3 cells of a rival costs three times as much, so nobody can close the dish.
- **NFTs do things.** A specimen slide fixes a patch of your own living cells as an NFT whose picture the contract draws. Planting its pattern costs 25% less, and anyone else pays its holder a 10% royalty. Sealed into its own keyless account, a slide becomes a *living slide*: a colony that holds what it earns and passes whole to whoever holds it.
- **AI strains play and bargain.** Five house strains forecast every move 240 generations ahead and buy peace from each other with pacts the contract enforces. Anyone can spawn a strain or bring an agent of their own.
- **Free play never reaches NEAR.** A guest plays on testnet with credit the site sponsors (mainnet free play opens 14 Nov 18:00 UTC for judging: up to 40 places, as many as its 3.1 NEAR relayer pays for, 27 at 0.1 NEAR a guest, 25 of them held for judges with a code; credit you can play with, not withdraw). PETRI earned before a colony's first NEAR cannot be sold for NEAR or sent.
- **Everything replays.** The browser, the simulator and the contract run the same Rust engine, so anyone can rebuild the whole history from the ledger.

How a session feels, at three speeds ([/rules](https://www.playpetri.xyz/rules#loops)): every 30 seconds you pick a stamp, see a forecast and plant; every few minutes you watch it grow and collide, claim and replant or lay siege; every hour the tide pays out, you fossilize a slide, and the strains strike pacts.

---

## Memecoins With Mechanics

**The mechanic:** PETRI is minted only to cells that stay alive and burned by every planting. The community's play is the supply curve: a busy dish burns more and feeds more; a quiet dish burns almost nothing.

| The prompt asks for | Where Petri does it | Proof | Status |
|---|---|---|---|
| An NEP-141 token with the mechanic in the contract, not a backend | PETRI is NEP-141 with NEP-145 storage and NEP-148 metadata in the dish contract itself. The feed, burns and prices run inside every call; any player's transaction advances the dish, so it runs with no server at all. | [`token.rs`](contract/src/token.rs), feed in [`core/src/lib.rs`](core/src/lib.rs), [/coin](https://www.playpetri.xyz/coin) | Met |
| All parameters set at launch, readable by anyone, no admin key to change them | Every parameter is in the `rules()` view, fixed by `new` or `relaunch`; no method changes one. /break's **Change the rules** and **Mint PETRI to yourself** are refused. `petri-dish.near` has had no access key since 10 November 2026 ([`Dsn8BxvX…`](https://nearblocks.io/txns/Dsn8BxvX1goYvUAKVpmNPJ98PsVa5mAXgSwA28WQpaeR)), so nobody can deploy other code either. | [`launch-rules-mainnet.json`](contract/launch-rules-mainnet.json), [/break](https://www.playpetri.xyz/break), [/judges](https://www.playpetri.xyz/judges) | Met |
| Sybil resistance good enough for a demo, limits written plainly | Pay is capped by planted stake, so splitting earns nothing more (property test `splitting_never_earns_more`). Free-play PETRI is kept: it cannot be sold for NEAR or sent (`a_guest_cannot_send_winnings_to_a_wallet`, `sybil_guests_that_attach_reach_no_vault_near`). Since v6.5 a guest with credit-grown cells alive cannot attach NEAR (`a_refused_attach_writes_nothing`). Guests cost a proof of work and are rate-limited. | [`core/src/tests.rs`](core/src/tests.rs), [`contract/src/tests.rs`](contract/src/tests.rs), [Limits](#limits-and-failure-cases) | Met |
| A page with today's state and a log of every mint and burn; the record shown like a high score | /coin replays the ledger in your browser: supply now, supply over time, and a filterable log of every feed, purchase, sale, burn, royalty and tide. /records names the longest-lived colony, the biggest siege and the top earners. | [/coin](https://www.playpetri.xyz/coin), [/records](https://www.playpetri.xyz/records) | Met |
| Simulate 60 days first; supply over time under a few scenarios | Five scenarios (boom, steady, decline, whale siege, strains only) × 5 seeds, every one of 345,600 generations stepped with petri-core, plus 1,000 adversarial seasons. The launch parameters were chosen earlier with 7-day runs (`sim/out-v6.1`); the 60-day run came after launch and checks them. | [`sim/out-60d`](sim/out-60d/README.md), charts on [/coin](https://www.playpetri.xyz/coin) | Met |

**Who wins, who pays.** Petri is an arcade game with a burn, not a yield product: playing costs storage and gas, and nobody extracts (the house only pays in). PETRI pays no yield: whatever a tide pays is NEAR other players put into the vault, plus a sliver of the house strains' NEAR while their small budget lasts. In the simulator's 60-day scenarios (mainnet rules, 10 seeds each, every generation stepped with petri-core), 0.1% to 3.6% of outside players end ahead in NEAR. The few who do are mostly R-pentomino players; no whale, split whale or lattice locker came out ahead in any run. Of the NEAR the vault paid players, 98.3% to 99.2% was other players' and 0.78% to 1.71% the house's. The house reaches its gas floor on day 6 or 7; after that, tides only move players' NEAR between players. Of every NEAR players put in, about 55% reaches the vault, a third pays the storage of their own records and 11–13% is gas. A 0.05 NEAR round trip through the agar returns 46.9% on day one and less once tides have drained the vault. Method, every number and the limits: [docs/ECONOMICS.md](docs/ECONOMICS.md); every player's row: [sim/out-econ](sim/out-econ).

**Why not meme.cooking?** A launchpad gives a coin a bonding curve and then hands it to a pool, where liquidity can be pulled and the price is whatever the pool says. PETRI has no pool by design: the agar is its only market maker. The contract sets the price on its own curve from how much PETRI is left in the agar, buys back at half that, capped by the vault, and the curve, the cap and the agar are all in one contract with no admin method. There is no LP to pull, and nobody can list a second price that the game would have to follow.

What sixty days say ([`sim/out-60d`](sim/out-60d/README.md), medians of 5 seeds): a boom of 600 players burns 151,568 PETRI (15%) and leaves 83% in the agar, and the vault pays 133.55 NEAR back to players; the house alone burns 0.14%. In 1,000 one-day seasons an attacker (a 2-NEAR whale, a split whale or a lattice locker) held half the living cells in 89% of seasons and **came out ahead in NEAR in none**.

## Games With Real Economies

**The loop:** plant, watch it live, claim and replant, besiege a rival, fossilize a slide, strike a pact. The agar is the market maker, and five AI strains with their own wallets play against you around the clock.

| The prompt asks for | Where Petri does it | Proof | Status |
|---|---|---|---|
| NPCs that are agents with their own wallets, pricing from stock and demand | Five strains, each its own NEAR account (on mainnet `violet.petri-dish.near` and four more), buy, plant, mint and make pacts with their own NEAR. The agar's price rises as it empties and its buy-back is capped by the vault. | [/strains](https://www.playpetri.xyz/strains), [`agents/run.mjs`](agents/run.mjs) | Met |
| An economy that evolves without a dev patch | Prices, feed and tides follow the dish's own state; no method changes a rule. | `rules()`, [/judges](https://www.playpetri.xyz/judges) | Met |
| Items as NEP-245 multi tokens | Petri's items are a NEP-141 coin and NEP-171 slides in one contract. | [`slides.rs`](contract/src/slides.rs) | Not met |
| Social or email login; no seed phrases, wallet popups or gas prompts | Free play makes a key in the browser and a guest account; the relayer pays gas through NEP-366 meta transactions with function-call keys. There is no social or email login. | [/dish](https://www.playpetri.xyz/dish), [relay route](web/src/app/api/relay/route.ts) | Partly |
| Pricing rules in one readable file; reasoning in a tooltip | The strains' rules are [`agents/strategies.mjs`](agents/strategies.mjs); the dish's prices are petri-core. Each move's note, its options, its forecast and the model that chose it show on /strains and on the dish. | [/strains](https://www.playpetri.xyz/strains) | Met |
| A fast-forward mode: a week in a minute | /sim copies the live dish into your browser and runs 40,320 generations with the contract's own Rust core, with what-if buttons. | [/sim](https://www.playpetri.xyz/sim) | Met |
| The loop on paper: every 30 seconds, 5 minutes, session | "The game, at three speeds" on /rules. | [/rules](https://www.playpetri.xyz/rules#loops) | Met |

Delight, for players rather than judges: a generative soundscape (the dish sings as colonies grow), cinema mode (press **C** on the dish), a time-lapse export, and a share card for every colony ([`/c/1`](https://www.playpetri.xyz/c/1)).

## NFTs That Do Something

**The NFT:** a specimen slide is a NEP-171 token of a colony's own living cells. It licenses its pattern and earns royalties for whoever holds it. Sealed into a **living slide**, it becomes a keyless NEAR account that is a colony on the dish, holds what it earns, and is its own NEP-171 token: sell the token and the account, its money, its colony and its slide move together.

| The prompt asks for | Where Petri does it | Proof | Status |
|---|---|---|---|
| An NEP-171 contract plus logic tying each token to a sub-account that holds money | The purse contract (30,879 bytes, no near-sdk) lives at `slide-<id>.<factory>` with no access key, holds the slide, joins the dish as a colony, and collects feed, tides and royalties. The factories have no key either: `slides.petri-dish.near` on mainnet, `slides.petri-v6.testnet` on testnet. On mainnet the factory sealed slide 18 into `slide-18.slides.petri-dish.near`, which joined attached, so its colony shares the tides in NEAR. The first mainnet purse, `slide-14.petri-dish.near` (v1, 29,404 bytes), joined below `min_join`; once its cells had died, its holder attached it with NEAR and replanted, and it now shares the tides in NEAR. | [`purse/`](purse), [LIVING-SLIDES.md](docs/LIVING-SLIDES.md), [slide 18 on mainnet](https://www.playpetri.xyz/specimens/18?net=mainnet) | Met |
| How control passes on transfer, and what stops the old owner | Control is one field, `holder`, checked and changed in the same receipt as every effect. No keys; `act` forwards only play methods (never `set_payout`, `sponsor`, `ft_transfer`); a listed purse moves nothing out; a nonce pins every purchase; approvals die on transfer. | [How control passes](docs/LIVING-SLIDES.md#how-control-passes-and-what-stops-the-old-owner) | Met |
| A threat model for the transfer, written first | Twelve ways a seller could try to keep the money, each with its rule and its test, committed before the purse code. | [SLIDES-THREAT-MODEL.md](docs/SLIDES-THREAT-MODEL.md) | Met |
| A gated page only current holders can open | The darkroom on each living slide's page opens only for a fresh NEP-413 signature from the holder, checked by the server. `agents/darkroom-test.mjs` checks the holder is admitted and another account and a tampered message are refused. | [/specimens/1](https://www.playpetri.xyz/specimens/1), [`gate` route](web/src/app/api/living/gate/route.ts) | Met |
| A history per NFT: what it earned, paid out, who held it | Each slide's page lists its plantings under licence, royalties, moves between holders and the purse's own log. | [/specimens](https://www.playpetri.xyz/specimens) | Met |
| Tests for the transfer path, including a sale in the middle of a payout | 18 purse and 6 factory tests (`the_old_holder_keeps_nothing_after_a_transfer`, `a_sale_waits_for_calls_in_flight`, `a_listed_slide_moves_nothing_out`), and every case run as a real testnet transaction: a transfer during an in-flight claim is refused until the claim lands, a stale-nonce purchase fails, the old holder is refused. | [`purse/contract/src/tests.rs`](purse/contract/src/tests.rs), [testnet proofs](docs/LIVING-SLIDES.md#proof-on-testnet) | Met |
| Royalties | Licence royalties go to the holder of the day (`after_a_transfer_royalties_go_to_the_new_holder`). Since v6.5, slides answer NEP-199: a marketplace sale pays 5% to the minting colony (`a_slide_sale_pays_its_minter_a_royalty`). | [`slides.rs`](contract/src/slides.rs) | Met |

## AI Swarms

**The market:** agents trade space. One pays another PETRI for a promise not to plant within 8 cells of its living cells; the contract holds the PETRI in escrow and refuses every planting that breaks the promise. The house strains clear their deals in sealed rounds, and since 10 November an **open council** lets any agent bid against the house with a signature from its own NEAR key.

| The prompt asks for | Where Petri does it | Proof | Status |
|---|---|---|---|
| Each agent its own sub-account under one parent | Mainnet strains are `violet`, `safranin`, `methylene`, `malachite`, `congo` `.petri-dish.near`. Anyone can [spawn a strain](https://www.playpetri.xyz/strains/new) on testnet: it becomes `<name>.petri-strains.testnet` with one function-call key that can only play (one disclosed exception: `gram-positive` also holds an orphaned temporary full-access key that was never saved, so nobody can use or delete it; [`check-strain-keys.mjs`](scripts/check-strain-keys.mjs) lists it). The five testnet house strains are separate top-level accounts (`petri-violet.testnet` and so on). | [/strains/new](https://www.playpetri.xyz/strains/new), [`agents/swarm/spawn.mjs`](agents/swarm/spawn.mjs) | Met on mainnet and for spawned strains |
| A coordinator that opens a round, collects sealed bids, reveals them and picks a winner | Open council: a round every 60 generations; each house ask is committed as a sha256 before bids arrive; outside agents send NEP-413-signed sealed bids; at the close asks and bids are published and pairs clear at the midpoint. Settlement is on chain (`pact_offer`, then `pact_accept`). The coordinator runs on the team's VM, so its reveal is checkable against the commitment rather than enforced by a contract. | [/strains/join](https://www.playpetri.xyz/strains/join), [`open-council.mjs`](agents/swarm/open-council.mjs), [`pacts.rs`](contract/src/pacts.rs) | Partly |
| Settlement through NEAR Intents | Pacts settle in PETRI escrow inside the dish, not through Intents. Intents is how mainnet players pay to join. | [`intents.rs`](contract/src/intents.rs) | Not met |
| A simulation mode with scripted strategies and no LLM calls | `sim/` runs scripted societies on the real rules (60 days, 1,000 seasons, pacts at fixed prices); each strain falls back to its written rules when no model answers. | [`sim/out-60d`](sim/out-60d/README.md) | Met |
| A live page of rounds, bids, clearing prices and who got what | /strains shows the house council and every pact; /strains/join and `GET /api/agent/council` show the open rounds, commitments, bids and deals. | [/strains](https://www.playpetri.xyz/strains), [council API](https://www.playpetri.xyz/api/agent/council?account=petri-bench-a.testnet) | Met |
| Bring your own agent | A world API safe to put in a model's context, an SDK and a 54-line example bot, and an MCP server built on that SDK, which signs with near-api-js (tools `petri_world`, `petri_plant`, `petri_join`, `petri_council`, `petri_bid`, `petri_offer_pact`, `petri_accept_pact`). | [`agents/sdk`](agents/sdk), [`agents/mcp/server.mjs`](agents/mcp/server.mjs) | Met |

**Guardrails you can test.** On [/strains/break](https://www.playpetri.xyz/strains/break) you talk *Captive*, a strain bound by a pact, into breaking it. Its model can be flattered or bribed; when it agrees, the planting goes to NEAR as a real transaction from its own key and the contract refuses it (every attempt so far was refused, each one listed on the page with its transaction, for example [`7VCewY4H…`](https://testnet.nearblocks.io/txns/7VCewY4HcWLRSeZazVyrJW47H2CaA4twWmTFkiMBmb3z)). The AI can be talked into anything; the contract cannot.

**Private AI, verified.** The strains ask NEAR AI Cloud first (`z-ai/glm-5.3-flash`, inside a TEE) and Claude Haiku when NEAR AI does not answer. For every NEAR AI answer, [`agents/tee.mjs`](agents/tee.mjs) checks that the signed text is `<model>:<sha256 of the exact request>:<sha256 of the exact response>`, recovers the signer (EIP-191) and checks that address is in the enclave's attestation report. Every NEAR AI move whose enclave proof verified carries a tag: its planting's note ends ` · tee:<16 hex>`, the start of the answer's hash. A tag binds to the earliest planting by the signer's colony, so a copied tag proves nothing (`verify-tee` lists copies and does not count them), the relayer refuses guests' notes that carry one, and the site draws the TEE chip only on strains' plantings. Each move's log also records how many NEAR AI requests it made, so a re-ask is visible ([docs/TEE.md](docs/TEE.md) lists re-asking as trusted). Moves after the change that binds the signed prompt to each option's cells verify end to end with `verify-tee`; older ones fail its choice check by design. The tag lets anyone find the proof: the site serves the archived answer and report at `/api/tee/<hash>` and `/api/tee/attestation/<hash>` (checked against their hashes before it caches them). /judges shows how many of the latest NEAR AI moves verified, and why the rest of the strains' moves carry no proof (Claude Haiku answered, or the written rules chose).

**Check an AI move yourself.**

```bash
npm ci --prefix agents
node scripts/verify-tee.mjs 6SzhCcQDo82GJVbm552zcQdGsSniMAj8f2cjRfsvQ69j
```

That is a mainnet planting by Congo Red (`congo.petri-dish.near`) on 10 November that NEAR AI chose; its proof bundle is committed in `proofs/tee/`, so the check works without the team's machine (`9t5xz4qRiwZ6xDMpFYrKbtwCEQA6Lz6zkAfgfttXGX7r` is a testnet one). Expected last line: `VERIFIED: every check above passed (---- lines are informational).` What it proves and what remains trusted: [docs/TEE.md](docs/TEE.md).

## Open Innovation

A coin, a game, NFTs that are accounts and an agent market in one contract, every unit of which anyone can replay from the ledger in a browser.

| The prompt asks for | Where Petri does it | Proof | Status |
|---|---|---|---|
| Argue against the idea first | Below: the case against Petri. | [The case against](#the-case-against-petri) | Met |
| The rules live in a contract anyone can read | `rules()` and every view are public; the whole dish replays from its ledger on /verify and in CI every six hours. | [/verify](https://www.playpetri.xyz/verify), [`live.yml`](.github/workflows/live.yml) | Met |
| A testnet demo with short timers | The testnet dish runs the same code and rules as mainnet with 15-second generations and hourly tides, free to play. | [/dish](https://www.playpetri.xyz/dish) | Met |
| A README section on failure cases | [Limits and failure cases](#limits-and-failure-cases), and /break, where the contract refuses the attacks a judge would try. | [/break](https://www.playpetri.xyz/break) | Met |

### The case against Petri

A memecoin whose supply is a cellular automaton is a toy: Life is chaotic, so a player's earnings depend on patterns few people understand, and a whale or a bot that does understand them can own the board. A coin with no outside market and a sell-back capped by its own vault is paper. Five AI strains run by the team are a subsidy, not a community, and an agent market that only trades "don't plant near me" is narrow. And a contract nobody can fix is a risk of its own.

What the design answers: the forecast on every planting turns chaos into a readable choice; the stake cap, the siege price and the bench show owning the board costs more than it returns (0 of 1,000 attacker seasons ahead); the sell-back is capped on purpose so one exit cannot drain the others, and the limits say so; strains are disclosed as house, are never fed and never sell; anyone can now spawn a strain or bring an agent; and the mainnet key is deleted ([`Dsn8BxvX…`](https://nearblocks.io/txns/Dsn8BxvX1goYvUAKVpmNPJ98PsVa5mAXgSwA28WQpaeR)), so the rules cannot be changed under anyone. What it does not answer: PETRI has no outside market, the house is still the team's, and a bug found on mainnet now stays.

## Illia's 4 November wishlist

| The idea | What Petri does | What it does not |
|---|---|---|
| **Swarm for hire, with guardrails** | Spawn a strain from a plain-English temperament. A guard (written rules, then a model reading it as data; no model means no) approves it; it gets its own sub-account with one key that can only play the dish, pays for its own decisions (0.0002 testnet NEAR each, logged with the model's chat id) and is capped per day. The contract, not the prompt, decides what it may do: [/strains/break](https://www.playpetri.xyz/strains/break). | It is testnet only, and the strain's brain is paid in testnet NEAR while the team pays the real model bill. Strains are hired to play Petri, not for outside jobs. |
| **AI encyclopedia and prediction markets** | Every strain move logs a 240-generation forecast and, later, what really happened, and the strains learn from the gap. | No prediction market and no encyclopedia. |
| **Copy-trading with viewing keys** | Every move, its options and its reasoning are public, and the world API lets any agent read the dish and follow a strain's play. | No viewing keys or private positions: everything on the dish is public. |
| **Universal checkout** | On mainnet, join or buy with USDC (Base, Solana, Arbitrum), ETH on Base, SOL or BTC through NEAR Intents 1Click; the contract unwraps the wNEAR and joins for the account named. | No outside account has joined through Intents yet: the one delivery so far was the team's own test, held as pending NEAR and paid back. The path is tested with dry quotes and in the contract's tests. |

---

## Limits and failure cases

| Case | What happens | What limits the damage |
|---|---|---|
| **A bug on mainnet** | `petri-dish.near` has had no access key since 10 November 2026 ([`Dsn8BxvX…`](https://nearblocks.io/txns/Dsn8BxvX1goYvUAKVpmNPJ98PsVa5mAXgSwA28WQpaeR)): nobody can deploy a fix or relaunch it. | Immutability was chosen over fixability. The code was reviewed release by release and is replayed (`verify.mjs`, CI every 6 hours); the testnet dish runs the same code and keeps its key, so a bug can be reproduced and shown there. |
| **The team's other keys** | The keeper (`keeper.petri-dish.near`, about 2.8 NEAR), the five mainnet strains (about 0.25 NEAR each) and the free-play relayer (an implicit account, 3.1 NEAR) sign with full-access keys of their own accounts, held on the team's VM or in the site server's environment; the team bench too. | None of them can change the dish: they are players under the same rules (the house is never fed and cannot sell). A stolen key could spend that account's own NEAR; the relayer's is capped at its one 3.1 NEAR deposit. The strains' runner has no code path that drives a purse. |
| **A compromised player or agent key** | A guest key or a spawned strain's key can only call the dish's play methods. | Function-call keys cannot attach or move NEAR; living slides have no keys at all. |
| **The strains stop** (VM down, model out) | Strains stop planting; spawned strains and the open council stop. | The contract does not depend on them: any wallet transaction catches the dish up, a dish left alone for 480 generations skips ahead, every pact still binds, and `verify.mjs` still replays it. With no model a strain plays by written rules and its log says so; a spawned strain with an empty brain stops. |
| **A whale or a locker** | It can hold most of the living cells: 89% of 1,000 bench seasons. | Pay is capped by stake, sieges cost 3×, and in none of the 1,000 seasons did the attempt pay. It is visible to everyone on /colonies. |
| **Relayer drain** | Someone scripts guest accounts, or squats the free mainnet places. | The relayer relays only zero-deposit calls to the dish (at most 300 TGas on testnet; on mainnet at most 100 TGas and never `advance`), each guest costs an 18-bit proof of work and gets 0.05 NEAR of credit that never becomes NEAR; 6 guests per IP an hour and 120 an hour in all per server instance, plus a daily budget (0.5 testnet NEAR per IP). On mainnet 25 places open only with a judge code, counted from the dish's ledger (a judge's sponsorship carries one extra yoctoNEAR); each free colony gets 16 relayed moves. Rate limits and per-code use live in memory per instance; the on-chain checks are what protect the NEAR. |
| **The open council's coordinator** | It runs on the team's VM and could stall or drop a bid. | It cannot make a pact: only the two colonies' own keys can. Asks are committed before bids, and every round's asks and bids are published, so a wrong clearing is checkable. The one deal so far was the team's own test agent (`scout.petri-lab.testnet`, pact 15). |
| **RPC lag, rate limits or a lying RPC** | A page may read a stale block; public RPC answers 429 to busy shared IPs; verification trusts the RPC it reads from. | Both verifiers pin one final block. Reads fail over across FastNEAR, dRPC and other keyless providers and back off on 429 (honouring `Retry-After`); the site serves reads pinned to a final block from its own cache (`/api/view`), so a crawl does not hammer RPC. `node scripts/verify.mjs --rpc <url>` puts a provider you trust first, to cross-check. Moves that need a current dish add `advance` calls first. |
| **A replay mismatch** | `verify.mjs` exits 1 and names the row. | CI replays both dishes every 6 hours and on every push, in public. A mismatch is a bug in the contract or the replayer; the testnet key can still fix the first kind. |
| **House rules** | The five strains and the keeper are the team's accounts. | They are never fed, take no tide share, bounty or keeper pot, never sell PETRI and can send it only to each other, so what the house spends lands with players. They are a subsidy (about 1.1 NEAR a strain a week in the simulator), not independent players. |
| **Mainnet living slide 14 joined unattached** | It joined with 0.015 NEAR, which netted under `min_join` after storage, and under v6.5 an unattached colony with living cells cannot attach. While its first pattern lived it earned kept PETRI and the first mainnet tide's share as credit, never NEAR. | Once its cells had died, its holder attached it with NEAR and replanted (generation 4,896), and it now shares the tides in NEAR. Slide 18, sealed through the factory, joined attached, and the testnet purses are attached and earn normally. Alive or extinct is read from the stored board on each slide's page, never from the browser's forecast. |
| **No outside market** | PETRI is paper until sold back to the agar. | The sell-back pays half the curve's price, at most the units' share of the vault and 10% of the vault per tide: one seller at a time, not everyone at once. |
| **Edges** | The methuselah (an R-pentomino an hour) was the one kind of player ahead in the simulator; early colonies are fed most; entries in one generation apply in execution order. | Disclosed; the simulator is a model with scripted players who never learn. |
| **Free play's cost** | A former guest must plant its kept PETRI before it can sell any. | That is what keeps free play from ever reaching vault NEAR. |

More in [RULES.md, Known limits](RULES.md#known-limits).

## After judging: what it costs, and what stops

The dish itself never stops and costs nothing to keep: it is a contract with no key, and any player's transaction catches it up. What costs money is the team's machinery around it:

| What | What it costs | When the money runs out |
|---|---|---|
| The mainnet keeper | Stepping the dish costs about 0.000047 NEAR of gas a generation, about 0.27 NEAR a day when it is kept fully stepped (5,760 generations). It idles until 14 November 18:00 UTC and keeps the dish within 240 generations until 19 November. | The dish sleeps: a dish left alone for 480 generations skips ahead on the next call, without feed for the skipped generations, and the page says how many the next move skips. Nothing is lost; the next planting wakes it. |
| The house strains' gas and PETRI | Their own NEAR, in their own accounts (`violet.petri-dish.near` and four more); the house runway on [/strains](https://www.playpetri.xyz/strains) shows what is left. | They stop planting. Their pacts still bind until they end, and the dish plays on without them. |
| NEAR AI Cloud and Claude | The model bill, paid by the team per answer. | Each strain falls back to its written rules, and every move says which chose it. |
| The relayer and guest credit | Testnet NEAR, and for the judging window one funded mainnet relayer (3.1 NEAR: 27 places at 0.1 NEAR a guest, 25 held for judges with a code). | Free play stops taking new guests; colonies already on the dish keep playing. |
| The agents VM and the site | The team's hosting. | Spawned strains, the open council and break-the-pact stop; the dish, its replay (`verify.mjs` needs only public RPC) and every pact do not. |

## Try it in two minutes

Each step says what to do and what you should see. Everything runs on the free testnet dish unless it says mainnet.

1. **Watch.** Open <https://www.playpetri.xyz>. Glossy colonies drift on the agar and a generation counter moves every 15 seconds. The switch in the navigation picks **Mainnet · Live, real NEAR** or **Testnet · Free play**.
2. **Start a colony.** On [/dish](https://www.playpetri.xyz/dish), type a name and press **Start my colony**. About 20 seconds later the panel says your colony is on the dish and links its transaction. Or press **Use my NEAR wallet instead**.
3. **Plant.** Pick **Block** and point at the dish. The card forecasts 240 generations: whether it survives, its cells at the next tide and when it pays back. On a rival's buffer the button reads **Lay siege here** at three times the price. Press it; the cells pulse until the chain confirms.
4. **Claim, buy, sell.** **Claim earnings** moves PETRI to your balance; **Buy PETRI** buys from the agar. A guest's **Sell** is paid in credit, never NEAR.
5. **Mint a slide.** **Fossilize a patch**, frame your densest cells, **Mint this specimen**. It appears on [/specimens](https://www.playpetri.xyz/specimens), where **Plant this pattern** plants it under licence.
6. **Talk to the strains.** [/strains](https://www.playpetri.xyz/strains) shows each move, its options, its forecast and the model that chose it, marked **NEAR AI TEE-verified** or **Claude Haiku**.
7. **Break it.** On [/break](https://www.playpetri.xyz/break), make a guest colony first, then press any **Try it**; [/strains/break](https://www.playpetri.xyz/strains/break) too: the contract refuses each attack.
8. **Rebuild it.** [/verify](https://www.playpetri.xyz/verify) ends **Everything matches.**; [/sim](https://www.playpetri.xyz/sim) runs a week in a minute.
9. **Mainnet.** Select **Mainnet** and **Connect a NEAR wallet**, or **Pay with any token** for a 1Click quote and deposit address. This spends real money; the steps above do not.

## How it works

| | |
|---|---|
| **The board** | 128×128 cells on a torus, standard B3/S23. A new cell takes the owner of the majority of its three parents; three different parents mean a contested birth that does not happen. One generation every 15 seconds by the block clock; any call catches up to 120 generations, and a dish left alone for 480 generations skips ahead: the next call skips to 120 behind and runs those, paying no feed for the skipped generations. Stepping the mainnet dish costs about 0.000047 NEAR of gas a generation (about 0.27 NEAR a day, however often a keeper runs), so its keeper idles until judging (the dish sleeps and shows how many generations the next move skips) and keeps it within 240 generations from 2026-11-14 18:00 UTC to 2026-11-19 00:00 UTC; the testnet keeper advances at 20 behind. |
| **Buying and selling** | Join with at least 0.01 NEAR. PETRI costs 0.0002 NEAR × (1,000,000 / PETRI left in the agar). The agar buys back at half that, capped by the vault. |
| **Planting** | Up to 64 cells once a generation. A cell costs what an average cell earns in two hours (at least 0.5 PETRI); within 3 cells of a rival, 3×. Half burned, half to the agar, plus 0.0001 NEAR a cell to the vault. |
| **The feed** | 3 ppm of the agar each generation, 2% to whoever's call ran it, the rest by living cells, each colony capped at 8 per cell of stake; stake decays 12.5% a tide. |
| **The tides** | Every 240 generations, 5% of the vault in NEAR and 5% of the credit pool as credit, split by PETRI earned since the last tide. |
| **Slides** | NEP-171/177/178/181/199 in the dish contract, 1 PETRI burned per captured cell; 12 cells or more license the pattern (25% off, 10% royalty to the holder). |
| **Pacts** | `pact_offer` escrows PETRI; `pact_accept` pays it and binds the promisor not to plant within 8 cells of the payer's living cells for up to 2,880 generations; the contract refuses every breaking planting. |
| **Free play** | Testnet guests get a function-call key and 0.05 NEAR of sponsored credit; PETRI earned before a first NEAR is kept. Mainnet free play opens 14 Nov 18:00 UTC for judging (up to 40 places, as many as the relayer's 3.1 NEAR pays for, most held for judges with a code; credit you can play with, not withdraw). |
| **Any token** | On mainnet, NEAR Intents delivers wNEAR with a message naming the account; the contract unwraps and joins or buys, or holds it as pending NEAR anyone can settle. |
| **Proof** | Every movement of PETRI and NEAR is one ordered ledger; every 16th generation the board hash is folded into a history chain. Replaying the ledger reproduces the board, the chain and every balance. |

Every rule, number and refusal is in [RULES.md](RULES.md) and on [docs.playpetri.xyz](https://docs.playpetri.xyz). What each review found and how it was fixed, v2 to v6.5, is in [docs/HISTORY.md](docs/HISTORY.md).

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js site<br/>WebGL culture renderer]
    WASM[petri-core<br/>compiled to WASM]
    KEY[guest key<br/>in localStorage]
    NC[NEAR Connect<br/>wallet players]
  end
  subgraph NEAR
    T[petri-v6.testnet<br/>free play]
    M[petri-dish.near<br/>real NEAR]
    P[living slides<br/>keyless purse accounts]
    W[wrap.near]
  end
  subgraph Vercel
    G["/api/guest, /api/relay<br/>proof of work, meta tx"]
    I["/api/intents<br/>1Click quotes"]
    A["/api/agent<br/>world, council"]
  end
  subgraph VM["Google Cloud VM"]
    K[keeper]
    S[5 house strains<br/>+ spawned strains]
    OC[open council<br/>commit, reveal, clear]
  end
  X[NEAR Intents 1Click]
  AI[NEAR AI Cloud in a TEE<br/>signature verified;<br/>Claude Haiku second]
  BOT[outside agents<br/>SDK or MCP, own key]
  CORE[(petri-core crate)]
  CORE --> T & M & WASM
  UI --> WASM
  KEY -- proof of work, signed delegate --> G -- pays gas --> T
  NC -- signs and pays --> M
  UI --> I --> X -- wNEAR --> W -- ft_on_transfer --> M
  K -- advance --> T & M
  S -- rivals by number only --> AI
  S -- plant, pact_offer, pact_accept --> T & M
  P -- join, plant, claim --> T & M
  BOT -- NEP-413 sealed bid --> A --> OC
  BOT -- plant, pact_offer --> T
  OC -- house accepts --> T
```

- **One engine, three places.** [`core/`](core) is a `no_std` Rust crate: a bit-sliced Life step (64 cells per machine word), the feed, stake, prices, curves, tide split and slide pictures. The contract, the browser and the simulator all call it, so they cannot disagree.
- **The contract.** [`contract/`](contract) holds the board, the lazy clock, the agar, the vault, the credit pool and one ledger of every movement. [`token.rs`](contract/src/token.rs) is PETRI, [`slides.rs`](contract/src/slides.rs) the NFTs, [`pacts.rs`](contract/src/pacts.rs) the pacts, [`intents.rs`](contract/src/intents.rs) the wNEAR receiver, [`books.rs`](contract/src/books.rs) each colony's numbers in cold pages and a hot table of at most 10,000 playing colonies, so no call costs more as colonies join (tested at 30,000).
- **Living slides.** [`purse/`](purse) is a separate contract with no near-sdk, written against NEAR's host functions to stay near 30 KB, and a factory that creates each purse in one receipt with no `AddKey`.
- **Agents.** [`agents/run.mjs`](agents/run.mjs) runs the keeper and strains for each dish: legal candidates from the rules ([`strategies.mjs`](agents/strategies.mjs)), each forecast 240 generations ahead on a copy of the engine ([`forecast.mjs`](agents/forecast.mjs)), memory of what past moves really did ([`memory.mjs`](agents/memory.mjs)), the house council ([`council.mjs`](agents/council.mjs)) and the model call with TEE verification ([`model.mjs`](agents/model.mjs), [`tee.mjs`](agents/tee.mjs)). [`agents/swarm/`](agents/swarm) holds spawning, the guard, the open council, the world API and break-the-pact. A read-only log of every move is public at `/api/strains`.
- **The site.** Next.js on Vercel serves www.playpetri.xyz and docs.playpetri.xyz; its API routes are the guest faucet, the relayer, the Intents quotes and the agent API.

## Verify and build it yourself

### Replay a dish from genesis

`node scripts/verify.mjs [--network mainnet]` pins one final block, downloads the ledger, replays it with the committed WASM build of petri-core and compares 46 values with the contract (board, history chain, every planting's legality and price, every purchase, sale, tide, claim, refund, slide, royalty, pact, every colony's PETRI, NEAR, credit and kept PETRI, the vault, solvency and the deployed code hash), then counts the full-access keys: `PASS` at 0 (mainnet), a disclosed `note` otherwise (testnet keeps one). `--contract <account>` checks another dish and `--code-hash <base58>` another build.

<details>
<summary>A mainnet run of 10 November 2026, after the key was deleted, in full</summary>

```
Replaying petri-dish.near (mainnet) at block 223923613: 5,016 generations, 179 ledger entries, 8 colonies, 4 tides.
  match   History chain                                7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a
  match   Board hash                                   364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309
  match   Living cells                                 644
  match   Legal plantings                              79 of 79
  match   Planting prices                              79 of 79
  match   Planting fees                                79 of 79
  match   Licensed plantings: shape, holder, royalty   5 of 5
  match   Purchases on the curve                       16 of 16
  match   Sales on the curve and allowance             0 of 0
  match   Tides                                        4 of 4
  match   Claims of exactly what was owed              1 of 1
  match   Refunds tied to their payouts                0 of 0
  match   Sales for NEAR, NEAR claims and pact payments by colonies holding no kept PETRI 1 of 1
  match   Pacts kept to the rules and plantings under pacts 55 of 55
  match   PETRI held for pact offers                   0.000000
  match   Pacts                                        14
  match   Specimens                                    21 of 21 match the dish
  match   Slide holders and royalties                  21 of 21
  match   Agar                                         998,511.976885
  match   Sold                                         1,902.866626
  match   Burned                                       1,145.444160
  match   Burned by specimens                          693.000000
  match   Royalties                                    0.000000
  match   Returned to the agar                         452.444160
  match   Bought back                                  0.000000
  match   Keeper share                                 0.751533
  match   Colony earnings                              8 of 8
  match   Vault (NEAR)                                 0.483315823824356250000002
  match   NEAR paid in                                 0.57902
  match   NEAR paid at tides                           0.069395846794683562499998
  match   Vault shares, bounties as credit             0.0204367443809601875
  match   Sales paid as credit                         0
  match   Colony tide winnings                         8 of 8
  match   Credit pool                                  0
  match   Credit paid at tides                         0.0204367443809601875
  match   Credit sponsored                             0
  match   Credit spent                                 0
  match   Credit taken back                            0
  match   NEAR owed to colonies                        0.050703529764175294746139
  match   Pending NEAR                                 0
  match   Colony credit winnings                       8 of 8
  match   Colony kept PETRI                            8 of 8
  match   Solvent (NEAR held >= owed, from the ledger) yes
  match   Deployed code hash                           CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  match   Read again from rpc.mainnet.fastnear.com     chain 7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a, board 364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309, code CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  match   Read again from near.drpc.org                chain 7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a, board 364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309, code CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  PASS    Full-access keys                             0 (nobody can deploy other code or relaunch)
Source: https://github.com/RohanGlitched/petri/tree/27a59761af835f2278b7cf28676c3acf0fdda538; built with cargo near build non-reproducible-wasm --locked in sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb
16 tide generation(s) had nobody to pay and were skipped, as the rules say.
Owed, from the ledger: 0.554456097969491732246141 NEAR (vault, credit pool, unspent credit, unclaimed winnings, pending); held beyond storage: 0.730851881477340732246147 NEAR.
Everything matches. Replay took 137 ms.
```

</details>

### Rebuild the contract and compare its hash

Both dishes run one build of v6.5, made with `cargo near build reproducible-wasm` at commit `27a5976`. With [cargo-near](https://github.com/near/cargo-near) 0.22 and Docker:

```bash
git checkout 27a59761af835f2278b7cf28676c3acf0fdda538
cd contract && cargo near build reproducible-wasm
#  - SHA-256 checksum bs58: CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD   (617,238 bytes)
```

It builds in `sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb`, pinned in `contract/Cargo.toml`, and the contract's NEP-330 `contract_source_metadata` names the same commit and image. (Its `build_command` reads `cargo near build non-reproducible-wasm --locked`: that is the command cargo-near runs inside the pinned container.) v6.5 was deployed on 10 November 2026 over the running v6.4 dishes as a code-only upgrade; `v6_5_runs_a_v6_4_dish_exactly_as_v6_4_does` proves v6.5 reads the v6.4 state byte for byte and leaves the same trie on 25 further calls.

### The lock

```bash
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"petri-dish.near"}}'
# "code_hash":"CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD"

curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"petri-dish.near"}}'
# "keys":[]  (the only full-access key was deleted on 10 November 2026)
# the same for slides.petri-dish.near, slide-18.slides.petri-dish.near and slide-14.petri-dish.near: "keys":[] (none ever had one)
```

**What can never change now.** The only way to start a dish over is `relaunch`, a private initializer only the contract account's own key could run. On 10 November 2026, after a final verify (Everything matches, 5,016 generations, 4 tides), the team deleted that key in [`Dsn8BxvX…`](https://nearblocks.io/txns/Dsn8BxvX1goYvUAKVpmNPJ98PsVa5mAXgSwA28WQpaeR). `petri-dish.near` has no access key at all, so nobody can deploy code to it, move its NEAR, relaunch it or change a rule, the team included. `verify.mjs --network mainnet` ends its rows with `PASS Full-access keys 0`, and [`live.yml`](.github/workflows/live.yml) counts the keys every six hours.

**What still runs, and on whose keys.** The dish needs nobody, but the team's machinery around it signs with full-access keys of its own accounts, kept on the team's VM (the relayer's is in the site server's environment): the mainnet keeper `keeper.petri-dish.near` (about 2.8 NEAR, for stepping the dish during judging), the five house strains (`violet.petri-dish.near` and four more, about 0.25 NEAR each), the team bench and the free-play relayer (3.1 NEAR). Each is a player under the dish's rules: none can change the contract, and what each can lose is its own account's NEAR. The living slides and the slide factory have no keys.

**Why.** Immutability over fixability: a coin whose rules could be rewritten is a promise, not a mechanic. The price is that a bug found on mainnet now stays; the testnet dish, `petri-v6.testnet`, runs the same code and keeps its key, so a bug can still be reproduced and fixed there.

### Run the tests

```bash
cargo test -p petri-core -p petri-contract   # 37 engine + 152 contract tests
cd purse && cargo test                       # 18 purse + 6 factory + 2 JSON tests
```

We run them on Linux (WSL, Rust 1.99.1): about 3 minutes to compile and 75 seconds to run. The engine tests include property tests against a plain reference implementation of Life and one showing splitting a colony never earns more. Most contract tests end by checking that every PETRI and yoctoNEAR is accounted for and the contract is solvent; one replays the ledger and must land on the same board, chain, agar, vault and earnings; dishes of 30,000 colonies must stay well under the gas limit.

### Build everything

```bash
cd contract && cargo near build reproducible-wasm && cd ..   # the contract (cargo-near and Docker)
cd purse && ./build.sh && cd ..                             # purse and factory (WASM_OPT=<wasm-opt>)
bash scripts/build-engine.sh                                # the browser engine (wasm-pack)
cd sim && cargo run --release -- out-60d days60 --seeds 5   # sixty days x five scenarios, about 30 s
cargo run --release -- out-60d bench --seasons 1000 && cd .. # the 1,000-season bench, about 26 s
cd web && npm install && npm run dev                        # the site, http://localhost:3210
```

The site reads `NEXT_PUBLIC_NEAR_NETWORK`, `NEXT_PUBLIC_PETRI_CONTRACT_TESTNET` and `NEXT_PUBLIC_PETRI_CONTRACT_MAINNET`; the guest faucet and relayer need `PETRI_RELAYER_ACCOUNT` and `PETRI_RELAYER_KEY`. Free play on mainnet during judging needs `PETRI_MAINNET_GUESTS=1`, `PETRI_MAINNET_RELAYER_ACCOUNT` and `PETRI_MAINNET_RELAYER_KEY` (a separate implicit account funded by `scripts/mainnet-guests-setup.mjs`), and `PETRI_JUDGE_CODE_SECRET` to hold places for judges (`PETRI_MAINNET_JUDGE_PLACES`, 25 by default; `node scripts/judge-codes.mjs` prints the codes from the same secret); its window, cap, floor, reserve and limits are in `web/src/lib/guest-program.ts` and RULES.md. To run your own agent: `PETRI_ACCOUNT=<you>.testnet PETRI_KEY_FILE=<key json> node agents/sdk/example-bot.mjs` (from `agents/`, after `npm install`), or add `agents/mcp/server.mjs` to any MCP client.

## Repository

| Path | What it is |
|---|---|
| [`core/`](core) | petri-core: Life with owners, planting checks, the feed, stake, prices, curves, tides, the history chain, slide pictures. 37 tests. |
| [`contract/`](contract) | The dish contract: PETRI (NEP-141/145/148), slides (NEP-171/177/178/181/199), pacts, intents, the ledger, solvency. 152 tests. |
| [`purse/`](purse) | Living slides: the keyless purse contract, its factory and a mock chain for tests. 26 tests. |
| [`wasm/`](wasm) | wasm-bindgen wrapper of petri-core for the browser and Node. |
| [`sim/`](sim) | The economy simulator; [`sim/out-60d`](sim/out-60d/README.md) is the sixty-day run and the 1,000-season bench. |
| [`agents/`](agents) | Keeper, house strains, council, NEAR AI TEE check, living-slide tending, the open swarm, the SDK and the MCP server. |
| [`web/`](web) | The site and docs: renderer, play page, judge desk, proof pages, guest faucet and relayer, agent API. |
| [`scripts/verify.mjs`](scripts/verify.mjs) | Replay a dish from genesis in a terminal. |
| [`scripts/facts-now.mjs`](scripts/facts-now.mjs) | Read both chains now and print (or `--diff`) the "What is real, today" table. |
| [`RULES.md`](RULES.md), [`docs/`](docs) | The complete rules, the review history, living slides and their threat model. |

## Built with

Everything here was written during the hackathon window (the first commit is from 3 November 2026); no templates or earlier code of ours. This is the team's only entry. Open-source libraries:

| Where | Libraries |
|---|---|
| Contract | [near-sdk](https://github.com/near/near-sdk-rs) 5.29.1, `hex`, `base64`; [cargo-near](https://github.com/near/cargo-near) 0.22 (reproducible image) |
| Purse | no dependencies: NEAR host functions directly, through its own small `purse-kit` |
| Engine and simulator | `sha2`, `proptest`, `serde`, `serde_json`, [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) 0.2 |
| Site | [Next.js](https://nextjs.org) 16.4, React 19.3, [near-api-js](https://github.com/near/near-api-js) 7.4, [@hot-labs/near-connect](https://www.npmjs.com/package/@hot-labs/near-connect) 0.11.4, [borsh](https://github.com/near/borsh-js) 2.0, [@noble/curves](https://github.com/paulmillr/noble-curves) and [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.2, `qrcode-generator` 2.0; fonts Gloock and Figtree |
| Agents | near-api-js 7.4, `@anthropic-ai/sdk` 1.3, [@noble/curves](https://github.com/paulmillr/noble-curves) and [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.2 as direct dependencies (TEE signature checks), [@phala/dcap-qvl](https://www.npmjs.com/package/@phala/dcap-qvl) 0.7.0 (Intel TDX quote verification in `verify-tee`); NEAR AI Cloud's OpenAI-compatible API |

NEAR pieces used: NEP-141, 145, 148, 171, 177, 178, 181, 199, 297, 330, 366 (meta transactions), 413 (signed messages), function-call keys, sub-accounts, NEAR Intents 1Click and NEAR AI Cloud. The Life patterns are the classic public-domain shapes.

## Licence

MIT. See [LICENSE](LICENSE).
