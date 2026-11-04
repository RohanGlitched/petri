<p align="center">
  <img src="docs/cover.png" alt="Petri: a coin that is alive. Conway's Life with owners, run by a NEAR contract." width="100%" />
</p>

> **The site is changing hosts.** Until the playpetri.xyz DNS records point at its new server, the same live site is at **<https://136-64-100-170.sslip.io>**, with the docs at <https://136-64-100-170.sslip.io/docs/introduction>. Every `www.playpetri.xyz/<path>` link below works there with the same path, and every `docs.playpetri.xyz/<page>` link as `/docs/<page>`.

<p align="center">
  <a href="https://www.playpetri.xyz"><img alt="Live site" src="https://img.shields.io/badge/live-playpetri.xyz-f2b45a?style=flat-square&labelColor=120a05" /></a>
  <a href="https://nearblocks.io/address/petri-dish.near"><img alt="Mainnet contract" src="https://img.shields.io/badge/mainnet-petri--dish.near-9fd8a8?style=flat-square&labelColor=120a05" /></a>
  <a href="https://testnet.nearblocks.io/address/petri-v6.testnet"><img alt="Testnet contract" src="https://img.shields.io/badge/testnet-petri--v6.testnet-9fd8a8?style=flat-square&labelColor=120a05" /></a>
  <img alt="Tests" src="https://img.shields.io/badge/tests-152-9fd8a8?style=flat-square&labelColor=120a05" />
  <img alt="Rust" src="https://img.shields.io/badge/rust-near--sdk%205.29.1-e2d5c3?style=flat-square&labelColor=120a05" />
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licence-MIT-e2d5c3?style=flat-square&labelColor=120a05" /></a>
</p>

<p align="center">
  <b><a href="https://www.playpetri.xyz">Live dish</a></b> &nbsp;&nbsp;
  <b><a href="https://www.playpetri.xyz/dish">Play, no wallet</a></b> &nbsp;&nbsp;
  <b><a href="https://www.playpetri.xyz/verify">Replay from genesis</a></b> &nbsp;&nbsp;
  <b><a href="https://www.playpetri.xyz/rules">How it works</a></b> &nbsp;&nbsp;
  <b><a href="https://docs.playpetri.xyz">Docs</a></b> &nbsp;&nbsp;
  <b><a href="RULES.md">Full rules</a></b>
</p>

**Petri is a coin that is alive.** One shared 128×128 dish runs Conway's Game of Life inside a NEAR smart contract, and every living cell belongs to a NEAR account. All 1,000,000 PETRI were minted once, into the dish's own reserve, the *agar*. You buy PETRI from the agar with NEAR, at a price that rises as it empties, and can sell it back at half that price. Every 15 seconds the agar feeds a sliver of itself to whatever is alive, but a colony is paid for at most 8 living cells per cell of stake (the cells it planted, of which 87.5% remains after each tide), so splitting into many colonies never earns more and holding ground means planting again now and then. Planting costs what a cell earns in two hours; half is burned and half goes back to the agar. Planting within three cells of a rival is allowed but costs three times as much, so nobody can close the dish to newcomers. The NEAR players attach collects in a tide vault, and every hour 5% of it is paid out by what each colony earned that hour. A colony can fix a patch of its living cells as a specimen slide, an NFT whose picture the contract draws itself and which licenses its pattern: planting that exact pattern elsewhere costs 25% less, and anyone but the slide's holder pays the holder 10% of that cost in PETRI. On mainnet anyone can pay with other tokens through NEAR Intents. Five AI strains play around the clock, forecasting every move on a copy of the dish and paying each other PETRI on chain for promises, without ever taking a share of the tides or selling PETRI back, and the browser runs the very same Rust engine as the contract, so anyone can rebuild the whole history, PETRI and NEAR, from the ledger and check it to the last unit.

Built for the NEAR HACKATHON (November 2026). Tracks: Memecoins With Mechanics, Games With Real Economies, NFTs That Do Something (the specimen slides), AI Swarms, Open Innovation. The full documentation is at <https://docs.playpetri.xyz>.

---

## Two dishes

The same build of the same contract, v6.1, runs twice. Both dishes started again from generation 0 on 4 November 2026, in place: on mainnet on `petri-dish.near`, and on testnet on `petri-v6.testnet` (named for the v6 it first ran; the v5 testnet dish, `petri-v5.testnet`, is no longer played). Each had run v6 for a few hours before v6.1 replaced it. The switch in the site's navigation picks which one you read and play.

| | Free play | Real NEAR |
|---|---|---|
| Network | NEAR testnet | NEAR mainnet |
| Contract | [`petri-v6.testnet`](https://testnet.nearblocks.io/address/petri-v6.testnet) | [`petri-dish.near`](https://nearblocks.io/address/petri-dish.near) |
| How you play | A guest account with no wallet: the site's relayer pays the gas and sponsors 0.05 NEAR of credit. Or your own testnet wallet. | Your own NEAR wallet, or other tokens through NEAR Intents. There are no guests. |
| What you win | NEAR, if your colony has attached NEAR; otherwise credit, spendable in the dish and never withdrawable | NEAR (the same credit rule applies to a colony that has never attached NEAR) |
| House strains | `petri-violet`, `petri-safranin`, `petri-methylene`, `petri-malachite`, `petri-congo` (`.testnet`), spending sponsored credit | `violet`, `safranin`, `methylene`, `malachite`, `congo` (`.petri-dish.near`), attaching their own NEAR, so what the house spends lands in the vault for the other players |
| Keeper (in `rules.keepers`: takes no tide bounty or keeper pot) | `petri-keeper.testnet` | `keeper.petri-dish.near` |
| Bench | `petri-bench-a`, `-b`, `-c` (`.testnet`): three colonies the team plays from its own testnet NEAR, fed and paid like any player, so the vault, tides and claims run from the first hour | none |
| wNEAR | `wrap.testnet` | `wrap.near` |

## Try it in two minutes

Each step says what to do and what you should see. Everything runs against the live free-play dish, `petri-v6.testnet`, unless it says mainnet.

1. **Watch the coin live.** Open <https://www.playpetri.xyz>. You see glossy colonies drifting across the agar and a generation counter that advances every 15 seconds. The switch in the navigation reads **Free play**; choose **Real NEAR** to read the mainnet dish instead.
2. **Start a colony with no wallet.** Open [/dish](https://www.playpetri.xyz/dish), type a name, pick a stain and press **Start my colony**. Your browser makes a key, fetches a signed challenge and solves a small proof of work bound to it; the site creates a testnet guest account for that key and sponsors it with 0.05 NEAR, which the contract holds as credit. The panel then says your colony is on the dish and that its 0.02 NEAR stake bought PETRI from the agar, with a link to the transaction. The relayer paid the gas; no NEAR moved with the relayed call. To play with your own NEAR instead, press **Use my NEAR wallet instead** and connect through NEAR Connect; your wallet signs and pays for each move.
3. **Plant something.** Pick **Block** in the dock and click the dish to place it. On a rival's hatched buffer the verdict turns amber and the button reads **Lay siege here for X PETRI** (three times the price); on open agar it reads **Plant the block here**. **Find open agar** centres the view on a spot where the stamp fits and says how far it is from the nearest rival. While you point the stamp, the card shows a forecast: the site steps two copies of the dish 240 generations ahead with the same engine, one with the stamp and one without, and says whether it survives, how many cells it adds at the next tide and roughly when it earns back its price (assuming nobody else plants). Type a lab note and press the button. The cells pulse until the chain confirms; the lab log shows your note, stored on chain.
4. **Claim, buy and sell.** Your colony card shows what your cells have earned. **Claim earnings** (or **Claim X NEAR and PETRI** once NEAR is waiting) moves PETRI to your balance and sends NEAR won at the tides, **Buy PETRI with 0.01 NEAR** buys more from the agar, and **Sell 20 back for X NEAR** sells PETRI to the agar from the tide vault, enabled once the first tide has opened the buy-back allowance. A guest's button reads **Sell 20 back for X credit**: a colony that has never attached NEAR is paid in credit, never in NEAR.
5. **Make a specimen.** Press **Fossilize a patch**. A frame opens over your colony's densest patch; move or resize it (4 to 32 cells a side) and press **Mint this specimen**. The contract keeps only your own living cells in the frame (at least 5), burns 1 PETRI for each and mints the slide to your account; a guest pays its storage from credit. It appears at [/specimens](https://www.playpetri.xyz/specimens), where each slide's page offers **Plant this pattern**: it loads the slide's cells into the stamp, and if the slide captured at least 12 cells, placed as they are (moved, not turned or flipped) they plant under the slide's licence at 25% off, with a 10% royalty to the slide's holder from anyone else who has attached NEAR (a guest's royalty goes to the agar). A smaller slide is a keepsake and carries no licence.
6. **Rebuild the dish from nothing.** Open [/verify](https://www.playpetri.xyz/verify). Your browser pins one final block, downloads the whole ledger (every join, purchase, sale, planting, specimen slide, tide, clock skip, refund, sponsorship, claim, pending payment and burn since generation 0), replays it with petri-core and shows 33 checks: the history chain, the board hash, living cells, every planting's legality, price and fee, every licensed planting's shape and the royalty it paid the holder of the day, every purchase and sale on the curve (none by the house), every slide, its holder and its royalties, every tide (when it ran, its share, split and bounty), every claim and every refund, the PETRI counters, every colony's earnings and NEAR winnings, the vault, NEAR paid in and out, credit sponsored, spent and taken back, NEAR owed and pending NEAR, each rebuilt from the ledger alone, whether the contract's NEAR covers what it owes, and the contract's full-access keys. Until the team deletes the contract's last full-access key (see [The lock](#the-lock)), the page says **The whole history matches.** and that last check waits in amber.
7. **Do the same from a terminal.** With Node 20 or later, see [Verify it yourself](#verify-it-yourself).
8. **Read what the AI strains decided.** Open [/strains](https://www.playpetri.xyz/strains): each strain's temperament, its last move with the options it had, and its lab notes, each linked to its transaction and marked with the model that chose it or as written rules. Its Runway note reads the mainnet strains' balances and recent spending from NEAR and says how long the house lasts at that pace.
9. **See the records.** Open [/records](https://www.playpetri.xyz/records): the browser replays the ledger and names the longest-lived colony, the biggest colony and planting, the most PETRI burned, the biggest siege, the top earners and the first tide. [/colonies](https://www.playpetri.xyz/colonies) counts the outside colonies (not the house or the bench), the NEAR they have won at tides and the slides minted.
10. **On mainnet, pay with any token.** With **Real NEAR** selected, the dish offers **Connect a NEAR wallet** and **Pay with any token**. The second asks for the NEAR account the colony is for, a colony name and a refund address on the paying chain, quotes a swap from USDC (on Base, Solana or Arbitrum), ETH on Base, SOL or BTC, and shows a deposit address. A 1Click payment arrives from the intents contract, not from that account, so the contract starts the colony under a neutral name ("Culture" and a few hex digits) whatever name the form sent, and the account may choose its own once with `rename`. This step spends real money; the others do not.

## How it works

| | |
|---|---|
| **The board** | 128×128 cells on a torus. One generation every 15 seconds by the block clock. Any join, buy, sell, plant, claim, mint_slide or advance first steps the dish to the present, up to 120 generations per call, fewer if they would use more than 110 TGas of the call's gas (or its prepaid gas less 40 TGas) less what is still to be written, and always at least one; a keeper advances it when nobody else does. If nobody touches the dish for more than 480 generations, the next call skips the clock ahead to 120 behind (a `Skip` entry) instead of replaying the quiet stretch. |
| **Life with owners** | Standard B3/S23 rules. A new cell takes the owner of the majority of its three parents; if all three belong to different colonies the birth is *contested* and does not happen. |
| **Buying and selling** | No free grants. A colony joins with at least 0.01 NEAR (the site stakes 0.02): its storage is kept and the rest buys PETRI at 0.0002 NEAR × (1,000,000 / PETRI left in the agar). The agar buys PETRI back at half the curve's price, never more than the units' share of the vault, and at most 10% of the vault between tides. A colony that has never attached NEAR is paid for its PETRI in credit. The house never sells. |
| **Planting** | Up to 64 empty cells, once per generation, by a colony that is playing or can join the 10,000 colonies the dish lets play at once (past that, a colony that is not playing yet waits for the next tide). A cell costs what an average counted cell earns in 480 generations (two hours) at today's feed, never under 0.5 PETRI. A planting within 3 cells of a rival's live cell is a siege and costs 3× (house cells never make one). Half the cost is burned, half returns to the agar. The planter also brings the planting's storage plus 0.0001 NEAR a cell, which goes to the tide vault, or to the credit pool when paid in credit. An optional 140-character lab note is stored with it. Under a specimen slide's licence (a slide that captured at least 12 cells; exactly its cells, moved anywhere with wrapping but not turned) the price is 25% lower, and a planter that does not hold the slide also pays 10% of that lower price in PETRI, a transfer rather than a burn: to the slide's holder, or to the agar if the planter has never attached NEAR; the siege surcharge still applies in full. |
| **The feed** | Each generation the agar's ration is 3 ppm of itself, released in full only when at least 1,000 cells are counted (with fewer, that fraction of it): 2% to a keeper pot, paid to the account whose call (join, buy, sell, plant, claim, mint_slide, advance, or a settled wNEAR order) ran at least one generation, if that account is registered for PETRI and is not a house strain or keeper, and the rest by living cells, each colony capped at 8 per cell of stake. Planting adds one cell of stake per cell, and every tide keeps 87.5% of each colony's stake. House colonies are never fed. |
| **The tides** | Every 240 generations (an hour) 5% of the vault is paid out in NEAR and 5% of the credit pool as credit, both split by the PETRI each colony earned since the last tide. A colony that has never attached NEAR is paid its share of the vault as credit too. Whoever's transaction runs the tide gets 1% of the vault's share, at most 0.001 NEAR (as credit, for such a colony); when a house strain or keeper runs it, that bounty stays in the vault. A tide with nobody to pay, because no colony outside the house earned since the last one, is skipped: no entry, no bounty, no decay. |
| **Credit** | Sponsored NEAR is credit an account can spend only in the dish (joining, buying, planting and a slide's storage); what it spends on joining, buying and planting goes to the credit pool, never the vault. A sponsorship brings at least 0.01 NEAR, and each sponsor's credit is kept apart, from at most 8 sponsors an account. Credit a colony wins is spent first, then its sponsors' credit, oldest first; no sponsor can take won credit back. A sponsor may take back only what is left of its own credit (`unsponsor`), once a day of the clock (5,760 generations) has passed since it last gave or the account last drew on it. Credit is never withdrawable. |
| **The house** | The five AI strains (`rules.house`) and the keeper (`rules.keepers`) are the dish's own accounts. The strains play like anyone and buy every PETRI they plant with, but are never fed, never have a row in the hot table and win no tides; what they pay in goes to the other players. House accounts never sell PETRI back, can send PETRI only to one another, take no tide bounty or keeper pot, and plant only slides they hold, so they never pay a player a royalty. The strains never lay siege. |
| **Guests** | Testnet only. A guest account gets 0.003 NEAR for its own storage, a function-call key for the dish only (`join`, `buy`, `plant`, `sell`, `claim`, `advance`, `mint_slide`, `settle_pending`; it cannot attach or move NEAR), and 0.05 NEAR the relayer gives it on chain with `sponsor`, held as credit less the record's storage. |
| **The coin** | NEP-141 with NEP-148 metadata and real NEP-145 storage registration, 6 decimals, a fixed supply of 1,000,000 minted into the agar at launch. Supply only falls: plantings and specimen slides burn it, and so does a forced `storage_unregister` (or a transfer refund to a sender that unregistered meanwhile). |
| **Specimens** | NFTs in the same contract (NEP-171, 177, 178, 181): a rectangle of one colony's own living cells at one generation, its picture an SVG the contract draws from the stored cells. Each slide of at least 12 cells is also a licence for its pattern (see Planting) and counts its moves between owners and the royalties its holders were paid. |
| **Proof** | Every 16th generation the board hash is folded into a history chain, `sha256(previous ‖ generation ‖ board hash)`. One ordered ledger holds Join, Buy (PETRI, NEAR, credit, credit spent), Plant (cells, cost, NEAR, credit, siege, credit spent, licence), Sell (PETRI, NEAR, paid, as credit), Slide (token, rectangle, cells, bitmap, cost, credit spent), Tide (chain, bytes, by), Skip, Refund (kind, the entry it refunds, NEAR, storage), Sponsor, Unsponsor, Claim, Pending, Unpend, Dust and Burn entries; the Tide entries are the checkpoints, and a replay works out each tide's amounts itself (the `tide` event logs them). Replaying it reproduces the board, the chain, the agar, the vault, the credit pool, every credit and NEAR counter, and every colony's PETRI, NEAR and credit. |
| **Solvency** | The `solvency` view compares the contract's NEAR (less its storage, plus any wNEAR not yet unwrapped) with everything it owes: the vault, the credit pool, unspent credit, unclaimed tide winnings and pending NEAR. Both replays rebuild every one of those terms from the ledger alone, compare each with the contract's own counter, and check the contract's NEAR covers them. |

### Pay with any token

On mainnet, the site asks NEAR Intents (its 1Click API) for a quote, and the payer sends USDC on Base, Solana or Arbitrum, ETH on Base, SOL or BTC to the deposit address it returns. NEAR Intents swaps it into wNEAR and sends it to `petri-dish.near` with `ft_transfer_call`. The contract accepts wNEAR only from `wrap.near` (any other token is refunded) and never refunds wNEAR, so no delivery can bounce back to the intents contract and be lost to its payer. It reads the transfer's message:

```json
{"for": "<account>", "do": "join", "name": "<colony name>", "color": 16753242}
```

`do` is `join` or `buy`. The contract keeps the whole amount as pending NEAR for `for` (or for the sender, if the message names nobody), with the order, less what that pending record and its `Pending` ledger entry cost; an amount too small even for those goes to the vault with a `Dust` entry. It unwraps the wNEAR and then, in a receipt of its own, joins or buys for `for` exactly as if that account had attached the NEAR itself; an account that already has a colony buys. If the order cannot run then (too little gas, a failed unwrap, a purchase for an account with no colony), it waits with its NEAR: anyone may complete it later with `settle_pending(account_id)`, or the account can take the NEAR back with `claim_pending`, and `pending_record` shows both. Anyone may call `unwrap_wnear` for wNEAR left waiting; the keeper does. The message's name and colour are used only when the transfer's sender is `for` itself: a colony someone else paid to start (every 1Click payment, whose sender is the intents contract) is called "Culture" and a few hex digits of its account's hash, in a colour from the same hash, and its account may choose its own name and colour once with `rename`; nobody can choose a name of that form. A payment for a house account waits as pending NEAR. `intent_minimum(what, account_id)` is the least a payment must deliver for its order to run (`min_join` or a purchase's record, plus its own records: 0.01184 NEAR to join and 0.00298 NEAR to buy for a 10-character account such as `alice.near`), and the site's quote route refuses any 1Click quote whose guaranteed output is below it, before anyone pays. 1Click adds a 0.2% app fee of its own to quotes made without an API key (the live site's quotes return `appFees` of 20 basis points today); the site asks for no fee of its own, and the payment dialog reads the fee from each quote and shows it with the amount.

### Specimens

`mint_slide(x, y, w, h, title?, credit?)` catches the dish up, claims the colony's waiting earnings, and keeps only that colony's living cells in the `w` × `h` rectangle at (`x`, `y`) (4 to 32 cells a side, wrapping at the edges, at least 5 cells). It burns 1 PETRI per captured cell and mints the slide to the colony's account. The slide's storage comes from credit first and then from attached NEAR; attached NEAR left over is sent back. The token lives in the dish contract itself, with NEP-177 metadata whose `media` is an SVG drawn from the stored bitmap whenever a wallet asks, NEP-178 approvals and NEP-181 enumeration, so any NEP-171 wallet or explorer shows it. Each slide is a `Slide` entry in the ledger, and both replays check it is exactly its colony's cells as the board stood and burned the rule's price.

A slide of at least `licence_min_cells` (12) cells is a licence for its pattern; a smaller one is a keepsake and `plant` refuses it ("slide N captured C cells; only a slide of at least 12 cells is a licence"). `plant(cells, note, credit, slide)` with a token id must plant exactly the slide's living cells, moved anywhere on the dish (wrapping at the edges) but not turned or flipped. Such a planting costs `slide_discount_bps` (25%) less for anyone, and a planter that does not hold the slide also pays its holder `slide_royalty_bps` (10%) of that discounted cost in PETRI, transferred, not burned; a holder with no PETRI registration is registered at the planter's expense. A planter that has never attached NEAR before the planting pays that royalty to the agar instead: the holder and the slide's royalties get nothing. The siege surcharge still applies in full, so a licence never makes a rival's ground cheap. The house plants only slides it holds. Each slide counts its moves (every transfer and return) and the royalties its holders were paid (`slide_royalties(token_id)`); each licensed Plant entry names the slide, its move count, the holder paid, the royalty and whether it went to the agar, and both replays check the shape, the 12-cell minimum, the price, the royalty and that the holder was the minter until the first move and the slide's owner after the last.

### The economics, in NEAR

The simulator (`sim/`, results in `sim/out-v5/`, and for v6.1 in `sim/out-v6.1/`) plays petri-core's rules from `contract/launch-rules.json` for 7 and 30 days with 15, 150 and 1,500 scripted players, relayer guests and the five strains, and counts cash: NEAR actually withdrawn minus NEAR actually paid, gas included. Its published runs predate three launched changes (they paid 10% tides, paid guests' winnings in NEAR their accounts could not move, and ran tides with nobody to pay); its fix table re-runs single changes, including 5% tides. Median cash per player after 7 days:

- Builders, raiders, defenders and late joiners: −0.27 to −0.15 NEAR at 150 players, −0.15 to −0.09 at 1,500. Storage takes 37% to 44% of all the NEAR that comes in.
- The methuselah (an R-pentomino an hour): +0.02 at 15 players and +0.14 at 150, the only kind ahead; −0.04 at 1,500. With 5% tides, +0.29 at 150.
- The carpet locker (a lattice of blocks laid at launch so every empty cell is in its buffer): −0.89, −0.58 and +0.59. With 5% tides, −1.21 at 150 and −0.45 at 1,500.
- The 2-NEAR whale: −3.97, −2.12, −0.99. Sybils lose too: a builder with 10 relayer guests beside it −0.16 to −0.10, and a player sponsoring 10 of its own accounts and taking the credit back −0.47 to −0.33.
- Each house strain: about −1.1 NEAR a week, paid to the other players.

Tables, the lockout runs and the zero-player runs are in [RULES.md](RULES.md) and on [/rules](https://www.playpetri.xyz/rules#parameters).

### What changed after review

The first dish (`petri-dish.testnet`) gave every colony free PETRI and split the feed in plain proportion; the first review found it paid players about 2.8 times what they spent and could lock up at about 115 colonies. v2 (`petri-v2.testnet`) fixed that with a NEAR buy-in, payback pricing and accrued earnings. A second round of review found eleven more problems, fixed in v4 and kept since:

| Found | Fixed |
|---|---|
| **Relayer drain.** The relayer attached guests' deposits; calls that failed inside the contract refunded them to the guest. | The relayer relays only zero-deposit calls. Guests pay from on-chain credit (`sponsor`) spendable only in the dish, and hold function-call keys that cannot attach or move NEAR. |
| **Proof-of-work replay.** One solution could make many guests. | A server-signed 10-minute challenge, an 18-bit proof of work bound to it and the key, and an account name derived from the key: one guest per key. |
| **Cap splitting.** The 15%-of-the-dish cap rewarded splitting into colonies just under it. | The reach: a fixed number of paid cells per cell a colony paid for (4 per cell planted in v4; 8 per cell of stake now); the parts of a split never weigh more than the whole (property test). |
| **Carpet lockout.** Blocks spread everywhere could put every empty cell inside someone's buffer. | Sieges: planting inside a rival's buffer is allowed at 3× the price. Ground is never closed. |
| **Tide sniping.** Tides split by cells alive at the tide, so planting just before one took a full share. | Window tides, split by PETRI earned since the previous tide. |
| **Keeper pot for nothing.** `advance` on a current dish still paid the pot. | The pot is paid only if the call ran at least one generation. |
| **Prompt injection through names.** The strains' model read colony names. | Rivals reach the model by number and size only; names are ASCII-only and notes refuse hidden and tag characters. |
| **No NEAR replay.** The NEAR side was only counters. | Every Buy, Plant, Sell and Tide records its NEAR; the replay checks the vault, NEAR in, tide payouts and every colony's winnings. |
| **Changeable, unverifiable code.** A full-access key and a non-reproducible build. | `cargo near build reproducible-wasm` with NEP-330 metadata linking the commit; the key is to be deleted before judging (below). |
| **Claims in PETRI.** The simulator reported PETRI earned over PETRI spent. | It now reports NEAR per player, cash and PETRI held (valued at the sell-back price) apart. |
| **The house ate the agar.** The strains were fed like players; on a quiet dish they drained it. | House colonies are never fed and take no tide share. |

v4 (`petri-v4.testnet`) also made the agar release its ration for at least 1,000 counted cells and never more per cell, so on a sparse dish a cell earns what its price assumes. v5 (`petri-v5.testnet`, and the first `petri-dish.near`) then: put sponsored credit in its own credit pool paid out only as credit, and paid colonies that never attached NEAR in credit, so free play never yields NEAR; made stake decay at each tide, with the reach raised to 8; skipped tides with nobody to pay; kept tide winnings in packed per-colony arrays (the simulator's biggest 1,500-player tide fell from about 104 TGas to about 11); cut tides from 10% to 5%; skipped a long-idle clock ahead; sent failed sale and bounty payouts back to the vault with a `Refund` entry; added the `solvency` view; and added specimen slides, paying with any token and rename. The build pins near-sdk 5.29.1, because 5.30 links host functions mainnet's protocol 86 does not have yet, so the same code runs on both networks.

A fourth round of review, of v5, found nine more problems. v6 fixed each with a regression test named after the attack (v6.1, the version both dishes run now, is below):

| Found | Fixed in v6 |
|---|---|
| **Sponsor hijack.** `sponsor` overwrote an account's one sponsor, so anyone could sponsor 1 yoctoNEAR and a day later `unsponsor` everyone's credit as NEAR. | Credit is kept per sponsor (at most 8), a sponsorship brings at least 0.01 NEAR, and a sponsor takes back only what is left of its own, a day after it last gave or the account drew on it (`sponsor_hijack_takes_nothing_but_its_own_and_the_real_sponsor_still_reclaims`). |
| **House sell drain.** The house holds most PETRI outside the agar and could sell it into the vault. | House strains and keepers never sell, send PETRI only to one another, take no tide bounty or keeper pot and plant only slides they hold (`house_sell_drain_is_refused`, `house_petri_cannot_reach_a_player_to_sell`, `house_bounties_stay_in_the_vault`, `a_keeper_takes_no_keeper_pot`). |
| **Gas grew with every colony.** v5 rewrote seven arrays covering every colony on each join and catch-up; it would have halted near 27,000 colonies. | Each colony's numbers live in cold pages of 64 and, while it plays, in a hot table of the colonies with stake. A join writes one slot; a catch-up and a tide touch only the hot table (v6.1 narrowed the table, below; its gas tests are `thirty_thousand_colonies_with_stake_every_call_under_150_tgas_on_the_real_network` and `a_full_hot_table_keeps_every_call_under_150_tgas_on_the_real_network`). |
| **Small intents refunded and lost.** A 1Click delivery under 0.01 wNEAR was refunded to the intents contract. | wNEAR is never refunded; any amount is pending NEAR for its account, or `Dust` in the vault if too small for a record, and the quote route refuses quotes below `intent_minimum` (`an_intent_below_the_minimum_is_kept_for_its_account_not_refunded`, `the_dish_tells_1click_the_least_a_payment_needs`). |
| **Colonies named by strangers.** Anyone paying for an account chose its colony's name. | A colony someone else paid to start gets a neutral "Culture" name and may rename once (`a_proxy_join_gets_a_neutral_name_and_never_the_payers_text`, `neutral_names_cannot_be_taken_first`). |
| **Orders stuck without gas.** Pending NEAR could not be spent on its order later. | The order is stored with the NEAR and anyone may run it with `settle_pending` (`an_order_without_gas_waits_and_anyone_can_settle_it`, `a_settle_spends_only_the_orders_near`). |
| **Self-reported solvency.** /verify trusted the contract's credit, owed and pending counters. | Sponsor, Unsponsor, Claim, Pending, Unpend, Dust and Burn entries, and Refunds tied to the payout they refund, so both replays rebuild every solvency term from the ledger alone. |
| **Failed payouts and token edge cases.** A failed sale went to the vault; a reclaim had no callback; NEP-141 and NEP-145 edge cases kept PETRI that should burn; `nft_tokens` drew up to 50 SVGs a call. | Every failed payout but a bounty becomes pending NEAR for its account; a refund to an unregistered sender and a forced unregistration burn, with a `Burn` entry; NFT pages hold at most 10 (`a_failed_sale_payout_is_pending_for_the_seller`, `a_failed_reclaim_is_pending_for_the_sponsor`, `a_refund_to_an_unregistered_sender_is_burned`, `a_forced_unregistration_burns_the_balance`, `nft_enumeration_draws_at_most_ten_images_a_call`). |
| **Slides did nothing.** Owning a slide changed nothing in the dish. | Slides are pattern licences: a discount on the exact pattern and a royalty to the holder, checked by both replays (`a_stranger_plants_a_slide_and_pays_its_holder_a_royalty`, `a_turned_slide_is_not_licensed`, `after_a_transfer_royalties_go_to_the_new_holder`). |

The v5 dishes were hours old and held only the team's colonies, so v6 started both from generation 0 rather than carry their history: on mainnet the account kept its name and ran `relaunch`, a private initializer that deletes every key v5 wrote and launches a fresh dish; on testnet v6 is a new account.

### What changed after the simulator found more (v6.1)

Re-running the simulator on v6 (`sim/out-v6/`) found more, and v6.1 fixes each; `sim/out-v6.1/` re-runs the same seeds with v6's rules set back and measures the difference. Both dishes were hours old, so v6.1 started them again from generation 0 with `relaunch`, which deletes every key v6 wrote and refuses an account with no v6 dish or one that already runs v6.1 (`relaunch_leaves_nothing_of_v6` builds a real v6 state with v6's frozen code and checks the result is byte for byte a fresh v6.1 launch). A new layout for tides and cold slots meant old entries would no longer deserialize, so a migration would have had to keep both formats in both replayers.

| Found in the v6 simulator | Fixed in v6.1 |
|---|---|
| **Gas at 30,000 colonies.** The hot table held every colony with stake, which lingers about a day, so on a busy dish it held up to 27,538 rows and a planting cost 237 TGas; 116,731 calls passed 150 TGas and 16,102 passed their prepaid gas. | The hot table holds only colonies that earned since the last tide or have living cells and a stake that can still earn (never the house), at most 10,000 rows, 32 leaving a call; the rest wait in 69-byte cold slots whose stake decays lazily. The catch-up reserves only what the rest of the call will write. Hot rows 17,102 to 1,315 on average, the largest call 237 to 60 TGas, calls over 150 TGas to 0. |
| **Tide entries cost too much.** A tide stored 289 bytes, 39% of a lone outsider's tide pay. | A tide is 130 bytes (126 plus 4 in a packed index), 21% of that pay; its amounts are worked out by the replay and logged in a `tide` event. Buy, Plant, Sell, Claim and the other entries shrank too. |
| **Royalty farming.** Minting small common patterns (blocks, gliders, beehives) and licensing them paid 10% of every planting of them. | A slide is a licence only if it captured at least 12 cells (`licence_min_cells`). Licensed plantings 7,852 to 402, royalties 6,296 to 2,846 PETRI. The pulsar and the Gosper gun are still licensable, so a farmer still nets +0.08 NEAR a week at 150 players in the model. |
| **Guest royalty leak.** Planters that had never attached NEAR paid royalties to a sybil wallet: 56 PETRI. | Their royalty goes to the agar. 56 to 0 PETRI. |
| **Stranded keeper pot.** The pot waited for `advance` and stood at 1,480 PETRI after a week on a young dish with 20 outsiders. | It goes to the account whose call ran the generation. 1,480 to 1.1 PETRI. |
| **Gas on the site.** The heaviest calls could pass the gas the site prepaid. | 300 TGas prepaid for join, plant, buy, sell, claim, advance and mint_slide (unused gas is refunded); the relay cap is 300. |

What the simulator still shows as broken is in [RULES.md](RULES.md) under Known limits.

## Verify it yourself

### Replay a dish from genesis

```bash
git clone https://github.com/RohanGlitched/petri && cd petri
node scripts/verify.mjs                     # petri-v6.testnet
node scripts/verify.mjs --network mainnet   # petri-dish.near
```

Node 20 or later, nothing to install: the script loads the committed WebAssembly build of petri-core from `web/src/engine/pkg`. It pins every read to one final block, replays the whole ledger and prints 40 checks: those of /verify, some split finer (the burned, specimen, royalty and keeper counters; credit paid at tides and as sales; each colony's credit winnings), plus the deployed code hash against the reproducible build. It exits 0 when all match, 1 on any mismatch and 2 if the dish cannot be read. Today, on both dishes, every row says `match` except the last, so it ends:

```
  match   Solvent (NEAR held >= owed, from the ledger) yes
  match   Deployed code hash                           8QAsfDHePT3TdZ6LvJRV9pcNHfHJemgFbiBBaZK6ZPwR
  DIFFERS  Full-access keys                             1  (expected: 0)
Source: https://github.com/RohanGlitched/petri/tree/4858ca09b809be6a8af9254a2c9260c48fd60bf8; built with cargo near build non-reproducible-wasm --locked in sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb
…
  The contract account still has a full-access key: whoever holds it could deploy different code.
1 check(s) differ.
```

`--contract <account>` checks another dish, `--code-hash <base58>` another build, and `--dump <file>` replays a snapshot the contract's replay test writes when run with `PETRI_DUMP` set.

### Rebuild the contract and compare its hash

Both dishes run one build, made with `cargo near build reproducible-wasm` at commit `4858ca0`. With [cargo-near](https://github.com/near/cargo-near) 0.22 and Docker:

```bash
git clone https://github.com/RohanGlitched/petri && cd petri
git checkout 4858ca09b809be6a8af9254a2c9260c48fd60bf8
cd contract && cargo near build reproducible-wasm
```

It builds inside `sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb` (pinned in `contract/Cargo.toml`), in under a minute once the image is pulled, and ends with (the file is 603,052 bytes):

```
     - SHA-256 checksum hex : 6df154bd52b56999299185743e7011e0cec690dacdba1d3e8be2a15c49a2bd7c
     - SHA-256 checksum bs58: 8QAsfDHePT3TdZ6LvJRV9pcNHfHJemgFbiBBaZK6ZPwR
```
 The contract's `contract_source_metadata` (NEP-330) names the same commit and image. Its `build_info.build_command` reads `cargo near build non-reproducible-wasm --locked`, and that is not a different build: it is the command cargo-near runs *inside* the pinned container when you run `cargo near build reproducible-wasm` outside it (`container_build_command` in `contract/Cargo.toml`). NEP-330 records the command that ran in the container, so a verifier reruns exactly that command in exactly that image and must get the same bytes. To read the deployed hash yourself:

```bash
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_account","finality":"final","account_id":"petri-dish.near"}}'
# "code_hash":"8QAsfDHePT3TdZ6LvJRV9pcNHfHJemgFbiBBaZK6ZPwR"; use https://rpc.testnet.fastnear.com and petri-v6.testnet for testnet

near account view-account-summary petri-dish.near network-config mainnet now
# near-cli-rs shows it in hex, as "Local Contract (SHA-256 checksum hex)": 6df154bd52b56999299185743e7011e0cec690dacdba1d3e8be2a15c49a2bd7c
```

### The lock

No method changes a running dish's parameters, mints PETRI or edits the board. The only way to start over is `relaunch`, a private initializer that only a transaction from the contract account itself can run, and that refuses an account with no v6 dish and one that already runs v6.1. Parameters are fixed when a dish starts, with `new` or `relaunch`, both callable only through the account's own key. At the time of writing each contract account still has one full-access key, so whoever holds it could deploy different code; the team will delete it before judging, after which the code can never change and `relaunch` can never run:

```bash
near account delete-keys petri-dish.near public-keys ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH network-config mainnet sign-with-legacy-keychain send
near account delete-keys petri-v6.testnet public-keys ed25519:8kGYoPJ6jVEZRrjjYKGVLfXD7LCyTDDqu41Cxx9UjHUu network-config testnet sign-with-legacy-keychain send
```

Until then, "no full-access key" is the one check that fails on /verify and in `scripts/verify.mjs`, which therefore exits 1. Anyone can list the keys:

```bash
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"petri-dish.near"}}'
```

### Run the tests

```bash
cargo test -p petri-core -p petri-contract
```

33 engine tests (including property tests against a plain reference implementation of Life, one showing that splitting a colony never earns more, and the slide-pattern match) and 119 contract tests, among them a regression test for each attack the reviews found and dishes of 30,000 colonies whose calls must stay well under the gas limit. Most contract tests end by checking that every PETRI and every yoctoNEAR is accounted for and that the contract is solvent; one replays the ledger and must land on the same board, chain, agar, vault and earnings.

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
    W[wrap.near]
  end
  subgraph VM["Google Cloud VM (e2-micro)"]
    C[Caddy<br/>automatic HTTPS]
    N[Next.js standalone server<br/>site and docs]
    G[/api/guest<br/>challenge, PoW, sponsor/]
    R[/api/relay<br/>zero-deposit meta tx/]
    I[/api/intents<br/>quotes, deposit address/]
    K[keeper]
    S[5 AI strains]
  end
  X[NEAR Intents<br/>1Click]
  AI[Claude Haiku, or<br/>NEAR AI Cloud in a TEE]
  CORE[(petri-core crate)]
  CORE --> T
  CORE --> M
  CORE --> WASM
  UI --> WASM
  UI -- HTTPS --> C --> N
  UI -- view calls --> T
  UI -- view calls --> M
  KEY -- proof of work --> G -- create account, sponsor credit --> T
  KEY -- signed delegate action --> R -- pays gas --> T
  NC -- signs and pays --> M
  UI --> I --> X -- wNEAR --> W -- ft_on_transfer --> M
  K -- advance --> T
  K -- advance --> M
  S -- rivals by number only --> AI
  S -- plant --> T
  S -- plant --> M
  S -- pacts: ft_transfer --> M
```

- **One engine, three places.** `core/` is a `no_std` Rust crate: a bit-sliced Life step that does 64 cells per machine word and touches owners only where cells are born or die, plus the feed, reach, stake decay, prices, curves, tide split and slide pictures. The contract, the browser (via `wasm/`) and the simulator all call it, so they cannot disagree.
- **The contract.** `contract/` stores the board compactly, keeps the clock lazily, holds the agar, the vault, the credit pool and sponsored credit, and writes every movement of PETRI and NEAR to one ledger. `token.rs` is PETRI, `slides.rs` the specimen NFTs and their licences, `intents.rs` the wNEAR receiver and pending NEAR, `books.rs` each colony's numbers (cold pages of 32 colonies, plus a hot table of the colonies that play now, at most 10,000, so no call costs more as more colonies join) and `relaunch.rs` the v6-to-v6.1 restart. A failed bounty payout goes back to the vault; every other failed payout becomes pending NEAR for its account. Catch-up stops at 110 TGas of the call's gas, less what is still to be written.
- **Guests.** `GET /api/guest` signs a 10-minute challenge; the browser solves an 18-bit proof of work bound to it and its key; `POST /api/guest` creates `g-<hash of the key>.<relayer>` with 0.003 NEAR and a function-call key for the dish, then calls `sponsor` with 0.05 NEAR. Their calls are NEP-366 delegate actions; `/api/relay` checks the sender is a guest, the call is a dish method with no deposit and at most 300 TGas, the delegate action has not expired, the ed25519 signature matches, and the key exists with a fresh nonce, then pays the gas.
- **Wallets.** Wallet players connect with NEAR Connect (`@hot-labs/near-connect`); wallet code runs in its own sandboxed iframe, and the wallet signs and pays for its own transactions.
- **Any token.** `/api/intents` passes quote, submit and status requests to NEAR Intents' 1Click API. It builds the transfer message itself from the checked form and pins the destination asset (wNEAR), the recipient (`petri-dish.near`), refunds on the origin chain and the deadline, and shows no deposit address unless 1Click's quote pays the dish.
- **The strains.** Code reads the dish with the same WASM, lists legal, non-siege plantings that suit the strain's temperament, and runs each 240 generations ahead on a copy of the live engine, so the model sees what every option would do to the strain, its rivals and the outside players' PETRI. Each strain remembers its last ten moves and what they really did, measured on the live dish 240 generations later. Once per tide window the five meet at a council: each may offer another strain 1 to 3 PETRI for a promise (a truce, keeping out of a quarter of the dish, or a strike on a named colony), the other's model accepts or declines, and an accepted deal is paid on chain with `ft_transfer` and a `{"pact", "terms"}` memo (on testnet, where a strain's key cannot attach the 1 yoctoNEAR a transfer needs, it is recorded as a promise instead). The contract keeps those payments inside the house. Truces and keep-outs are enforced by removing the plantings that would break them; strikes are scored kept or broken, and each pair's record is shown to the next council. The model picks a planting and writes the note, naming rivals only by number and size. Petri is integrated with both Claude Haiku (asked first, within a fixed dollar budget) and NEAR AI Cloud (its answers signed inside a TEE), which takes over when Claude does not answer and NEAR AI has credits. If neither answers, the strain takes its first option. Every move in the public log says which model, or the written rules, decided it.
- **The renderer.** A WebGL2 shader turns the owner grid into stained colonies, and the browser steps the stored board to the due generation with the same engine.
- **Hosting.** Everything off chain runs on one small Google Cloud VM (e2-micro, us-central1): the site, its API routes (guest faucet, relayer, intents) and the docs as a Next.js standalone server behind Caddy, which serves HTTPS with automatically renewed certificates, next to the keeper, the strains and the bench, one agent process per dish.

## Screens

| The play page | Verified from genesis |
|---|---|
| ![The play page: the join panel, the stamp dock, the loupe and the lab log](docs/screens/dish.png) | ![The checks on /verify after a full replay](docs/screens/verify.png) |
| **Life with owners, on /rules** | **The coin, on /rules** |
| ![The four rules of a generation and three live demos running the real engine](docs/screens/rules-demos.png) | ![Buying in, the feed and selling back, with live numbers](docs/screens/coin.png) |
| **Colonies** | **AI strains** |
| ![The colonies ledger with territory maps](docs/screens/colonies.png) | ![The AI strains and how they choose a move](docs/screens/strains.png) |

## Repository

| Path | What it is |
|---|---|
| `core/` | petri-core: the Life-with-owners engine, planting checks and sieges, the feed with reach, stake decay and floor release, prices, the purchase and sell-back curves, the tide split, the history chain, slide pictures and the slide-pattern match, patterns. 33 tests. |
| `contract/` | The NEAR contract: dish state, buy-in, sell-back, sponsored credit and the credit pool, plantings, catch-up and skips, tides, claims with payout callbacks, the ledger, the PETRI token (NEP-141/145/148), specimen slides (NEP-171/177/178/181) and their licences, the wNEAR receiver and pending NEAR, the cold pages and hot table, `relaunch`, solvency, views. 119 tests. `launch-rules.json` and `launch-rules-mainnet.json` are the two dishes' parameters. |
| `wasm/` | wasm-bindgen wrapper around petri-core for the browser and Node. |
| `sim/` | The economy simulator (`sim/out-v6.1/` for the current rules and their effect against v6; `out-v5/`, `out-v3/`, `out-v2/` and `out/` are earlier runs). |
| `agents/` | The keeper, the five AI strains with their forecasts (`forecast.mjs`), memory (`memory.mjs`) and council (`council.mjs`), and the bench (Node), plus the read-only action-log window. |
| `web/` | The Next.js site: renderer, play page with the planting forecast, any-token payment, verify, rules, colonies, specimens, records, strains, guest faucet and relayer. |
| `scripts/verify.mjs` | Replay a dish from genesis against the live contract, from a terminal. |
| `RULES.md` | The complete rules, economics and known limits, checked against the code. |

### Build it yourself

```bash
# engine and contract tests
cargo test -p petri-core -p petri-contract

# the contract, reproducibly (needs cargo-near and Docker; see above for the deployed commit)
cd contract && cargo near build reproducible-wasm && cd ..

# the browser engine, copied into the site (needs wasm-pack)
bash scripts/build-engine.sh

# the economy simulator, from sim/ (writes sim/out-mine/summary.txt)
cd sim && cargo run --release -- out-mine all && cd ..

# the site
cd web && npm install && npm run dev        # http://localhost:3210
```

The site reads `NEXT_PUBLIC_NEAR_NETWORK` (the dish a first visit reads, testnet by default) and `NEXT_PUBLIC_PETRI_CONTRACT_TESTNET` / `NEXT_PUBLIC_PETRI_CONTRACT_MAINNET`; the guest faucet and relayer need `PETRI_RELAYER_ACCOUNT` and `PETRI_RELAYER_KEY` (see `web/src/app/api/`), and `INTENTS_API_KEY` is optional.

## Limits, honestly

- Free play runs on NEAR testnet: its NEAR and PETRI have no market, and guests play with credit the site sponsors. On mainnet the NEAR is real, and nothing about the game guarantees PETRI a price.
- Each contract account keeps one full-access key until the team deletes it before judging; until then `scripts/verify.mjs` exits 1 on that one check.
- PETRI is paper until sold back, and the vault caps buy-backs: half the curve's price, at most the units' share of the vault, at most 10% of the vault per tide, nothing before the first tide. That price holds one seller at a time; all holders together could not exit at it.
- In the simulator the methuselah is the one kind ahead at 15 and 150 players, and the carpet locker came out ahead at 1,500 players with 10% tides (+0.59 NEAR); 5% tides turned that to −0.45 in the fix run.
- Early colonies have an edge: the agar is fullest at the start and PETRI cheapest while it is full.
- Entries in the same generation apply in execution order, so an earlier planting can take a cell a later one wanted.
- The house strains are a subsidy run by the team: about 1.1 NEAR a strain a week in the simulator, paid to the other players. On mainnet it is the team's real NEAR.
- The simulator estimates storage and gas, its players follow fixed habits, and its published runs predate three launched changes (5% tides, guests paid in credit, idle tides skipped).
- The site, the relayer, the keeper, the strains and the bench all run on one small VM. If it stops, the site and free-play guests stop with it, but the contracts do not: any wallet transaction still catches the dish up, `scripts/verify.mjs` still replays it, and the site runs locally with `npm run dev`; a dish left alone for more than 480 generations skips the quiet stretch, and nothing is fed for the skipped generations.
- The council's promises are held by the agents' own code, not the contract: the contract only carries the PETRI payments and keeps them inside the house. On testnet the pacts are promises on record, not transfers.
- The strains need a model to answer: Claude Haiku within a fixed budget, NEAR AI Cloud when it has credits. Without either they play by written rules, and the log says so.
- Verification proves the board and balances follow from the ledger; it trusts the RPC provider you read the ledger from.

## Built with

Everything in this repository was written during the hackathon window; no templates or earlier code of ours were used. Open-source libraries:

| Where | Libraries |
|---|---|
| Contract | [near-sdk](https://github.com/near/near-sdk-rs) 5.29.1, `hex`, `base64`; built with [cargo-near](https://github.com/near/cargo-near) 0.22 (reproducible image) |
| Engine | `sha2` (history chain); `proptest` for the property tests |
| Browser engine | [wasm-bindgen](https://github.com/rustwasm/wasm-bindgen) 0.2, `hex`, built with wasm-pack |
| Site | [Next.js](https://nextjs.org) 16.4, React 19.3, [near-api-js](https://github.com/near/near-api-js) 7.4, [@hot-labs/near-connect](https://www.npmjs.com/package/@hot-labs/near-connect) 0.11.4 (wallets), [borsh](https://github.com/near/borsh-js) 2.0, [@noble/curves](https://github.com/paulmillr/noble-curves) and [@noble/hashes](https://github.com/paulmillr/noble-hashes) 2.2 (relayer signature checks, guest proof of work), `qrcode-generator` 2.0 (deposit addresses); fonts Gloock and Figtree from Google Fonts |
| Agents | near-api-js 7.4 and `@anthropic-ai/sdk` 1.3 (the strains' model calls) on Node |

The patterns (block, glider, Gosper glider gun and the rest) are the classic public-domain shapes of Conway's Game of Life.

## Licence

MIT. See [LICENSE](LICENSE).
