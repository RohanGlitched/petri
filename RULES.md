# Petri rules

Petri is Conway's Game of Life on a shared dish run by a NEAR smart contract, with colony ownership and a token,
PETRI. Colonies buy PETRI from the dish with NEAR, spend it to plant cells, and are fed PETRI for the cells that stay
alive. Every hour 5% of the NEAR in the tide vault is paid back out, split by what each colony earned that hour. This
file describes what the contract enforces. The documentation site, <https://docs.playpetri.xyz>, covers the same
ground with examples.

The code is the source of truth. The rules of a generation, the feed, the reach cap and stake decay, the planting
price, the purchase and sell-back curves, the tide split and slide pictures live in `core/src/lib.rs` (the `petri-core`
crate). The clock, the ledger, the vault, the credit pool, sponsored credit and the dish's own methods live in
`contract/src/lib.rs`; the token in `contract/src/token.rs`, specimen slides in `contract/src/slides.rs` and payment
in wNEAR in `contract/src/intents.rs`. The same `petri-core` crate runs in the contract, in the browser (compiled to
WebAssembly) and in the economy simulator (`sim/src/main.rs`), so the three cannot disagree. The contract has 74 tests
(`contract/src/tests.rs`) and the core 30 (`core/src/tests.rs`).

Every parameter is set once, when the contract is initialised, and can be read with the `rules` view. The contract has
no method that changes a parameter, mints PETRI after launch, or edits the board.

## Two dishes

The same build runs on two networks. `petri-v6.testnet` is free play: guests, a relayer and sponsored credit.
`petri-dish.near` is mainnet: real NEAR, wallets only, and payment in other tokens through NEAR Intents. Their
parameters are `contract/launch-rules.json` and `contract/launch-rules-mainnet.json`, which differ only in `house` and
`wnear`.

## Launch parameters

These are the values both dishes return from `rules`. PETRI has 6 decimals, so the contract stores 1 PETRI as
`1000000` units. NEAR amounts are in yoctoNEAR (10^24 per NEAR).

| Field | Value | Meaning |
| --- | --- | --- |
| `width` × `height` | 128 × 128 | Cells on the dish. The edges wrap. |
| `generation_ms` | 15000 | One generation every 15 seconds (5,760 a day). |
| `max_supply` | 1,000,000 PETRI | Every PETRI that will ever exist. All of it is minted at launch into the agar. |
| `feed_ppm` | 3 | The agar's ration each generation: 3 parts per million of itself. |
| `keeper_bps` | 200 | 2% of each generation's feed goes to the keeper pot. |
| `reach` | 8 | A colony is paid for at most 8 living cells per cell of stake. |
| `stake_keep_bps` | 8750 | Every tide that runs keeps 87.5% of each colony's stake. |
| `burn_bps` | 5000 | 50% of a planting's cost is burned; the rest goes back to the agar. |
| `payback` | 480 | A cell costs what an average cell earns in 480 generations (2 hours) at today's feed. |
| `min_cell_price` | 0.5 PETRI | The lowest price of one cell. |
| `live_floor` | 1000 | The agar releases its full ration only for at least 1,000 counted cells, and prices count at least 1,000. |
| `petri_price` | 0.0002 NEAR | Launch price of one PETRI. The agar sells at `petri_price × max_supply / agar`. |
| `min_join` | 0.01 NEAR | The least NEAR a colony joins with. |
| `cell_fee` | 0.0001 NEAR | NEAR per planted cell, on top of the planting's storage, to the tide vault (or the credit pool). |
| `tide_every` | 240 | Generations between tides (one hour). |
| `tide_bps` | 500 | 5% of the tide vault, and 5% of the credit pool, is paid out at each tide. |
| `tide_bounty_bps` | 100 | 1% of the vault's share goes to the caller whose transaction runs the tide... |
| `max_bounty` | 0.001 NEAR | ...but never more than 0.001 NEAR. |
| `sell_bps` | 5000 | The agar buys PETRI back at 50% of the curve's price. |
| `sell_cap_bps` | 1000 | Between two tides the agar spends at most 10% of the vault on buy-backs. |
| `siege_x` | 3 | A planting inside a rival's buffer costs 3 times the price. |
| `buffer` | 3 | The buffer: cells within 3 (a 7 × 7 square) of a rival's live cell. |
| `max_plant_cells` | 64 | Most cells in one planting. |
| `max_catchup` | 120 | Most generations one call will advance. |
| `max_lag` | 480 | When the stored dish is more than 480 generations behind, the clock skips ahead to 120 behind. |
| `slide_cells_price` | 1 PETRI | A specimen slide burns 1 PETRI per living cell it captures. |
| `slide_min_cells` | 5 | A slide must capture at least 5 of the colony's own living cells. |
| `wnear` | `wrap.testnet` / `wrap.near` | The wNEAR contract whose transfers join or buy. |
| `house` | 5 accounts | The dish's own players: `petri-violet`, `petri-safranin`, `petri-methylene`, `petri-malachite`, `petri-congo` (`.testnet`) on testnet; `violet`, `safranin`, `methylene`, `malachite`, `congo` (`.petri-dish.near`) on mainnet. Never fed, no tide share. |

Fixed in code rather than in `rules`: a colony name is 1 to 24 ASCII characters; a lab note is at most 140 characters
and 280 bytes; a slide's title at most 40 characters and 160 bytes, and a slide 4 to 32 cells a side; the history chain
advances every 16 generations (`CHAIN_EVERY`); a catch-up stops once its call has used 180 TGas
(`CATCHUP_GAS_LIMIT`); a sponsor may take back credit unused for 5,760 generations (`RECLAIM_AFTER`); a wNEAR
transfer under 0.01 is refunded (`MIN_INTENT`).

## The dish

- A grid of `width × height` cells whose edges wrap, so the dish is a torus with no walls.
- Every cell is either empty (`0`) or alive and owned by one colony (a colony id from 1 upwards).
- A colony is one NEAR account. It joins once, with a name and a colour (`0xRRGGBB`), and keeps its id for good.

## A generation

Every cell is updated at once from the board as it was at the end of the previous generation.

1. **Survival.** A live cell with 2 or 3 live neighbours stays alive and keeps its owner. Any other live cell dies.
2. **Birth.** An empty cell with exactly 3 live neighbours comes alive. Those three are its parents.
3. **Ownership.** The new cell joins the colony that owns at least two of its three parents.
4. **Contested ground.** If the three parents belong to three different colonies, no cell is born.

Rules 1 and 2 are exactly Conway's Life (B3/S23). When no birth has three distinct parents the dish plays exactly like
Life; property tests in `core/src/tests.rs` check this against a plain reference implementation.

## Time and catch-up

Generation `g` is due once `(block time − epoch) / generation_ms ≥ g`, where `epoch` is the block time of `new`
(moved forward by every skip, below).

The contract stores the board at the last generation someone advanced to. `join`, `buy`, `sell`, `plant`, `claim`,
`mint_slide`, `unsponsor` and `advance` each first step the stored board through the due generations, up to
`max_catchup` (120) per call, and stop early once the call has used 180 TGas (or its prepaid gas less 40 TGas), so no
backlog can push a call past NEAR's gas limit. Each generation runs Life, folds the history chain when due, adds the
feed to unclaimed earnings, the tide window and the keeper pot, and runs a tide when one is due (below). A catch-up
reads and writes one record of each kind however many colonies are alive, and logs one `generation` event.

If the stored board is more than `max_lag` (480) generations behind when a call arrives, the clock first skips ahead
so that it is `max_catchup` (120) behind: the epoch moves forward, the skipped generations are counted in
`state().skipped`, a `Skip` entry is written to the ledger and a `skip` event is logged. Nothing is fed and no tide
runs for skipped generations.

`plant` requires the dish to be current after its own catch-up ("the dish is behind the clock; call advance first").

The site does not wait for the stored board: it loads it into the same `petri-core` engine in WebAssembly and steps it
to the due generation.

## The agar: buying and selling PETRI

At launch all of `max_supply` is minted once into the contract's own balance, the agar. There is no other mint and no
free grant. With `k = petri_price × max_supply` (200 NEAR):

```
price of one PETRI = k / agar                          (0.0002 NEAR at launch; twice that with half the agar left)
PETRI bought       = agar × near / (k + near / 2)      (petri_for_near)
NEAR for a sale    = min(sell_bps × curve price at the midpoint, vault × units / PETRI outside the agar)   (sell_back)
```

- **Joining.** `join(name, color, credit?)` must bring at least `min_join` (0.01 NEAR), attached or from credit. The
  contract keeps the colony's storage (plus 140 bytes for its purchase entry) and spends the rest on PETRI.
- **Buying.** `buy(credit?)` spends what it brings, less 140 bytes for the purchase record, on PETRI.
- Storage is paid from credit first, then from attached NEAR. What is left of the attached NEAR goes to the tide
  vault and what is left of the credit to the credit pool. The `Buy` entry records both (`near`, `credit`).
- **Selling back.** `sell(petri)` returns PETRI to the agar for NEAR from the vault: half the curve's price, never more
  than the units' pro-rata share of the vault. The sale's record storage comes out of that NEAR (`near` in the `Sell`
  entry) and the rest (`paid`) goes to the seller: as NEAR, to its payout account if it set one, or, for a colony that
  has never attached NEAR, as credit it can spend only in the dish (`as_credit: true`, counted in `credit_sold`).
  Between two tides the agar pays out at most `sell_cap_bps` (10%) of the vault as it stood at the last tide, first
  come first served; before the first tide it buys nothing back. A round trip through the agar always loses (core test
  `selling_back_always_loses_against_buying`).
- The `buy_quote(near)` and `sell_quote(petri)` views give prices now.

## Credit

`sponsor(account_id)` is payable and open to anyone. The contract keeps the attached NEAR, less the record's storage, as
sponsored credit for that account. The site's relayer sponsors each guest with 0.05 NEAR this way, so it never attaches
NEAR to the calls it relays.

A colony can also win credit: its share of the credit pool at every tide, and, if it has never attached NEAR, its share
of the vault, the bounties of tides its calls run and what it is paid for sales. Credit won is spent before sponsored
credit and no sponsor can take it back.

Credit can be spent only by passing `credit` to `join`, `buy`, `plant` or `mint_slide` (for a slide's storage), and can
never be withdrawn by the account. Credit spent on joining, buying and planting goes to the credit pool, never the
vault. `unsponsor(account_id)` lets an account's last sponsor take back its sponsored credit (not credit won) once it
has gone unused for 5,760 generations of the clock.

`credit_of(account_id)` shows what an account can spend (won plus sponsored); `credit_record(account_id)` shows the
sponsored part with its sponsor. `state` shows `credit_given`, `credit_won`, `credit_sold`, `credit_spent`,
`credit_reclaimed`, `credit_in` and `credit_pool`.

## Planting

`plant(cells, note?, credit?)` brings cells to life for the caller's colony. `cells` are flat indices `y × width + x`.

### The price

```
counted        = sum over fed colonies of min(living cells, reach × stake)   (the last feed's weight)
feed per cell  = (agar × feed_ppm / 1,000,000) × (1 − keeper_bps / 10,000) / max(counted, live_floor)
price of a cell = max(feed per cell × payback, min_cell_price)
cost           = price of a cell × cells × (siege_x if any planted cell is inside a rival's buffer, else 1)
```

in PETRI units with integer division at every step (`feed_per_cell`, `plant_price`, `planting_cost`), after the
planting's own catch-up. `state().counted` is the cell count the price uses. Before checking the price, `plant` claims
the colony's waiting earnings into its balance. Half of the cost is burned and half returns to the agar.

### Sieges

A planting with any cell whose 7 × 7 neighbourhood (across the wrapped edges) holds another colony's live cell is a
siege. House colonies' cells never count. It is legal and costs `siege_x` (3) times the price; the ledger entry is
marked `siege: true`. No ground is ever closed: a newcomer can always plant somewhere, at worst at three times the
price.

### The deposit

A planting brings NEAR, attached or from credit: the storage it uses plus `cell_fee` per cell. `plant_deposit(cells,
note_bytes?)` returns `(220 + 4 × cells + (note_bytes + 64, if there is a note)) × storage byte price + cell_fee ×
cells`. The contract measures the storage the planting actually used and keeps that (from credit first), and puts the
rest into the tide vault (attached NEAR) or the credit pool (credit). The `Plant` entry records both (`near`,
`credit`).

### Stake

Planting adds one cell of stake per planted cell (`STAKE_UNIT`, 1,000 thousandths of a cell). Every tide that runs keeps
`stake_keep_bps` (87.5%) of every colony's stake. The `stakes` view returns each colony's stake in thousandths of a
cell.

### Checks

In this order, with the quoted message:

| Check | Refusal |
| --- | --- |
| The note has no control, bidirectional, zero-width, invisible, variation-selector or tag characters. | "a lab note may not contain control, direction, invisible or tag characters" |
| The note, trimmed, is at most 140 characters and 280 bytes. | "a lab note is at most 140 characters" |
| The caller has joined. | "join the dish first" |
| At least one cell, at most 64. | "plant 1 to 64 cells" |
| Every index is on the dish. | "a cell is off the dish" |
| The account has the credit it asks to spend. | "this account has X NEAR of won and sponsored credit" |
| At least `cell_fee × cells` is brought. | "planting N cells needs at least X NEAR" |
| After catching up, the dish is at the due generation. | "the dish is behind the clock; call advance first" |
| The colony has not planted in this generation. | "one planting per generation; wait for the next one" |
| No cell is listed twice, every target is empty. | "cell (x, y) is listed twice" / "cell (x, y) is already alive" |
| The colony holds the cost, siege included. | "planting N cells [inside a rival's buffer] costs X PETRI; you hold Y" |
| What was brought covers the storage used plus the fee. | "this planting needs X NEAR for its storage and fee" |

A refused call changes nothing; attached NEAR is refunded and credit is not spent.

## The feed and the reach

In each generation, after the step:

```
weight   = min(colony's living cells, reach × stake)   (0 for house colonies)
counted  = sum of weights
ration   = agar × feed_ppm / 1,000,000
released = ration × min(counted, live_floor) / live_floor
keeper   = released × keeper_bps / 10,000
share    = (released − keeper) × weight / counted
```

(`feed_weight` and `feed` in `petri-core`). With fewer than `live_floor` counted cells the agar releases only that
fraction of its ration and keeps the rest, so a lone 4-cell block earns 4/1,000 of the ration, which is exactly what its
price assumes. A dish where no fed colony is alive is fed nothing. The cap grows only with stake a colony paid for, so
splitting into many colonies never earns more: the weights of the parts sum to at most the weight of the whole
(property test `splitting_never_earns_more`). Stake decays at every tide, so holding ground means planting again now and
then. Rounding remainders stay in the agar.

## The keeper pot

Each generation's keeper cut collects in one pot. `advance(max?)` pays the whole pot to its caller only if that call ran
at least one generation and the caller is registered to hold PETRI. The project's keeper (`petri-keeper.testnet` and
`keeper.petri-dish.near`, both registered) advances when the board is 20 generations behind or the pot holds more than
50 PETRI, and calls `unwrap_wnear` when wNEAR is left waiting. It has no powers anyone else lacks.

## Claiming

Feed earnings accrue in one record and NEAR winnings in another. `claim()` moves the colony's PETRI earnings into its
balance and sends its NEAR winnings, to its payout account if it set one. Credit won needs no claim: it is spendable as
soon as the tide runs. `set_payout(account_id?)` names where a colony's NEAR payouts (tide winnings and sales) go; only
a colony that has attached NEAR may set one ("only a colony that has attached NEAR is paid in NEAR; free play earns
credit, which stays in the dish").

Every NEAR payout has a callback, `on_payout`: if a claim's transfer fails, the NEAR is owed to the colony again and can
be claimed later; if a sale or bounty transfer fails, the NEAR goes back to the vault with a `Refund` entry. Either way
the event `payout_failed` is logged. `claimable(account_id)` shows what is waiting. Nothing expires.

## NEAR and the tides

The tide vault receives what wallets attach to joins, purchases and plantings, less storage. It pays out tides' NEAR
shares and shares paid as credit, tide bounties, tide-entry storage and sell-backs (with their record storage), and
takes back failed sale and bounty payouts. Nothing else goes in or out.

The credit pool receives the credit spent on joins, purchases and plantings, less storage. It pays out only at tides,
only as credit.

At every generation that is a multiple of `tide_every`, if some colony outside the house was fed since the last tide
(`tide_due`):

```
pay          = vault × tide_bps / 10,000                     (5%)
bounty       = min(pay × tide_bounty_bps / 10,000, max_bounty)   to the account whose call ran the tide
storage      = the Tide ledger entry's storage
share        = (pay − bounty − storage) × window / sum of windows
credit_pay   = credit pool × tide_bps / 10,000
credit share = credit_pay × window / sum of windows
```

A colony's window is the PETRI it was fed since the previous tide, so a colony planted just before a tide gets only
those few generations' worth, and house colonies have no window. A colony that has attached NEAR is owed its share as
NEAR (`paid`); a colony that never has is paid it as credit (`as_credit`). Every colony's credit share is credit
(`credit_paid`). The bounty goes to the caller in NEAR, or as credit if the caller is a colony that never attached
NEAR; the `Tide` entry records the caller's colony as `by` (0 for an account with no colony). Windows then reset,
every colony's stake decays to `stake_keep_bps` of itself, and the buy-back allowance is set to `sell_cap_bps` of the
vault.

A tide with nobody to pay does not run at all: no entry, no storage, no bounty, no decay, and the buy-back allowance
stays as it was. Rounding and the other 95% stay in the vault and the pool. Tide winnings are kept in packed
per-colony arrays, each read and written once per tide, so a tide never touches a colony or credit record however many
colonies win.

## The house

The accounts in `rules.house` (the five AI strains, run by the team) play like anyone: they join, buy PETRI and plant.
They are never fed and take no tide share, so every PETRI they plant with is bought, and that NEAR goes to the other
players. Their cells never make another colony's planting a siege, and their strategy code never lays siege. On
testnet they spend sponsored credit; on mainnet they attach their own NEAR, so what they spend lands in the vault.

## Specimen slides

`mint_slide(x, y, w, h, title?, credit?)` fixes a rectangle of the caller's own living cells as an NFT. After catching
up and claiming the colony's earnings, the contract reads the `w` × `h` rectangle at (`x`, `y`) (4 to 32 cells a side,
wrapping at the edges) and keeps only the colony's own living cells (`Dish::region_bitmap`). It must capture at least
`slide_min_cells` (5); the colony must hold `slide_cells_price` (1 PETRI) per captured cell, all of which is burned
(event `ft_burn`, counted in `burned` and `slides_burned`). The slide's storage, quoted by `slide_deposit(w, h,
title_bytes?)`, comes from credit first and then from attached NEAR; attached NEAR left over is sent back. None of it
reaches the vault or the credit pool. Refusals: "a slide is 4 to 32 cells on each side", "the slide's corner is off
the dish", "a slide needs at least 5 of your living cells; that rectangle holds N", "a slide of N cells costs X PETRI;
you hold Y", "this slide needs X NEAR for its storage".

Slides are NEP-171 tokens in the dish contract itself (`nft_transfer`, `nft_transfer_call`, `nft_token`), with NEP-177
metadata (`nft_metadata`; each token's `media` is an SVG that `petri_core::slide_svg` draws from the stored bitmap
whenever it is asked), NEP-178 approvals (`nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`) and NEP-181
enumeration (`nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`). The `slides`,
`slide` and `slides_for` views return the cells and the colony's current name. Owning or moving a slide changes nothing
in the dish. Each mint writes a `Slide` entry to the ledger, and both replays check it.

## Paying with any token

NEAR Intents swaps a payer's tokens into wNEAR and delivers them with `ft_transfer_call`. `ft_on_transfer(sender_id,
amount, msg)` accepts only wNEAR from `rules.wnear`, and only at least 0.01 wNEAR; any other token and anything smaller
is refunded. It never fails, and keeps the whole amount. The message is

```
{"for": "<account>", "do": "join" | "buy", "name": "<colony name>", "color": <0xRRGGBB>}
```

The contract unwraps the wNEAR (`near_withdraw` on the wNEAR contract) and then, in a receipt of its own, joins or buys
for `for` exactly as if that account had attached the NEAR itself: an account with a colony buys, and an account
without one joins if `do` is `join`, the name is valid and free, and the amount reaches `min_join`. Whatever cannot be
used that way (an unreadable message, a taken name, too little gas, a failed unwrap) waits as pending NEAR for `for`,
or for the sender if the message names nobody. A pending record's storage comes out of the amount. `pending_of`
shows it and `claim_pending()` sends it back to the account (pending again if that transfer fails).
`unwrap_wnear()` unwraps wNEAR left waiting and `register_wnear()` registers the dish on the wNEAR contract; anyone may
call either. A colony joined this way is marked `proxy`: since anyone can pay for any account, its account may choose
its name and colour again, once, with `rename(name, color)`.

## Solvency

The `solvency` view compares the contract's NEAR with what it owes:

```
owed = vault + credit pool + (credit_given + credit_won + credit_sold − credit_spent − credit_reclaimed)
       + tides_owed + pending
held = account balance − storage + wNEAR held and not yet unwrapped
solvent = held ≥ owed
```

## Conservation

The contract tests assert after their scenarios (`conserved`):

- `total_supply = max_supply − burned`
- `every balance + agar + unclaimed + keeper_pot = total_supply`
- `agar = max_supply − sold − fed + returned + bought_back`
- `vault + every Tide's (bounty + storage + paid + as_credit) + every Sell's near = near_in + every Refund's near`
- `credit_pool + every Tide's credit_paid = credit_in`
- `credit_won = every Tide's credit_paid + near_as_credit`, and every bounty was paid in NEAR, as credit or refunded
- `slides` and `slides_burned` match the `Slide` entries, and `nft_total_supply` matches `slides`
- the per-colony records add up to `unclaimed`, `credit_won` and `tides_owed`
- `solvency().solvent`

## The ledger and the replay

One ordered ledger holds everything that changes the dish, the agar, the vault or the credit pool:

- `Join { generation, colony }`
- `Buy { generation, colony, petri, near, credit }` — `near` reached the vault and `credit` the credit pool
- `Plant { generation, colony, cells, cost, near, credit, siege }` — likewise, after the planting's storage
- `Sell { generation, colony, petri, near, paid, as_credit }` — `near` left the vault, `paid` reached the seller, as
  credit if `as_credit`
- `Slide { generation, colony, token, x, y, w, h, cells, bitmap, cost }` — `cost` PETRI was burned
- `Tide { generation, chain, pay, bounty, storage, paid, as_credit, credit_pay, credit_paid, by }`
- `Skip { generation, skipped }` — the clock skipped `skipped` generations here
- `Refund { generation, colony, near }` — a failed sale or bounty payout went back to the vault

The `Tide` entries are the checkpoints: `checkpoints()` returns generation 0 and the chain stored in every tide.

Replaying from an empty board, a zero chain, a full agar, an empty vault and an empty credit pool, applying each
generation's entries in order and stepping with `petri-core` in between, reproduces the board, the chain, the agar, the
vault, the credit pool and every colony's PETRI earnings, NEAR winnings and credit winnings. `node scripts/verify.mjs`
(`--network mainnet` for the mainnet dish) does it from a terminal with every read pinned to one final block and prints
30 checks: history chain, board hash, living cells, every planting legal with its siege flag, every planting's price,
every planting's fee, every purchase on the curve, every sale on the curve and within the allowance, every tide (run
exactly when due, its chain, shares, bounty and storage), every specimen slide, the agar, PETRI sold, burned, burned by
slides, returned and bought back, the keeper share, every colony's earnings, the vault, NEAR paid in, NEAR paid at
tides, vault shares and bounties paid as credit, sales paid as credit, every colony's NEAR winnings, the credit pool,
credit paid at tides, every colony's credit winnings, solvency, the deployed code hash, and no full-access key. It
exits 0 when all match, 1 on any mismatch and 2 if the dish cannot be read. The site's `/verify` runs the same replay in
the browser, also pinned to one block, with the same checks except the code hash (29). The contract test
`replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault` does it in Rust.

## The lock

Both dishes run one build, made with `cargo near build reproducible-wasm` at commit
`ec5970f5b8315de81e022866e17da62a47be7426` in `sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb`
(pinned in `contract/Cargo.toml`). Its NEP-330 `contract_source_metadata` links that commit, so anyone can rebuild it
and compare the hash with the account's code hash, `DabiJwsVJnfizmhfTFGCmdUma2o3THFUZ89eHMjGoMC7` (hex
`dc00659d95ca14f4202b84f96d71566298c37db1abc7230c862fefba771ee438`). Each account still has one full-access key. The
team will delete them before judging, after which the code can never change:

```
near account delete-keys petri-dish.near public-keys ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH network-config mainnet sign-with-legacy-keychain send
near account delete-keys petri-v6.testnet public-keys ed25519:Gx338TCzmupYDbRw7DPPXZVsF45yCPRnazrM173h2yCZ network-config testnet sign-with-legacy-keychain send
```

Until then, "no full-access key" is the one failing check on `/verify` and in `scripts/verify.mjs`.

## History chain

`board hash = sha256(width u16 || height u16 || for each live cell in index order: index u32 || owner u16)`, little-endian.
At every generation that is a multiple of 16: `chain = sha256(previous chain || generation u64 || board hash)`, starting
from 32 zero bytes.

## The token

NEP-141 with NEP-148 metadata (name Petri, symbol PETRI, 6 decimals) and NEP-145 storage registration. `ft_transfer` and
`ft_transfer_call` need exactly 1 yoctoNEAR; the receiver must be registered; a transfer to the contract is refused
("PETRI goes back to the agar only by planting or selling"). `ft_total_supply` is `max_supply − burned` and includes the
agar, unclaimed earnings and the keeper pot. The contract account cannot act as a player ("the dish does not play on
itself").

Events: NEP-141 `ft_mint` (once, at launch), `ft_transfer` and `ft_burn` (planting and slides); NEP-171 `nft_mint` and
`nft_transfer`; and the dish's own (standard `petri`, version 5.0.0) `sponsor`, `unsponsor`, `join`, `rename`, `plant`,
`sell`, `claim`, `payout`, `payout_failed`, `slide`, `intents`, `claim_pending`, `skip` and `generation`.

## Names and notes

Names are 1 to 24 characters of ASCII letters, digits, spaces and `- ' . & ! ? _ , : ( )`, unique ignoring case. Notes
and slide titles refuse control, bidirectional, zero-width, invisible filler, variation-selector and tag characters.
Nothing can hide in either, and the strains' model never sees names: rivals reach it as numbers and sizes.

## Guests and the relayer

Free play only (testnet).

- `GET /api/guest` returns a challenge signed by the server, valid for 10 minutes. The browser makes a key and finds a
  nonce so that `sha256("petri-guest:" + challenge + ":" + publicKey + ":" + nonce)` starts with 18 zero bits.
- `POST /api/guest` checks the signature, age and proof of work, derives the account name from the key
  (`g-<10 hex of sha256(key)>.<relayer>`, so one key makes one guest), creates the account with 0.003 NEAR and a
  function-call key for the dish only (`join`, `buy`, `plant`, `sell`, `claim`, `advance`, `mint_slide`; such a key
  cannot attach or transfer NEAR), and calls `sponsor` with 0.05 NEAR. It is also rate-limited: 4 guests per IP
  address and 120 in all per hour, per server instance.
- `/api/relay` relays a guest's signed NEP-366 delegate action only if it is from a guest account, to the dish, one of
  those methods, with no deposit and at most 250 TGas, not expired, with a valid signature for the action, and with a
  key that exists on the account and a fresh nonce. The relayer pays only gas.
- A guest never attaches NEAR, so everything it wins or is paid for sales is credit.
- Wallet players connect with NEAR Connect (`@hot-labs/near-connect`) and sign and pay for themselves.

## The strains

Code reads the dish with the same WebAssembly engine, lists up to six legal plantings outside every rival's buffer that
suit the strain's temperament, and asks a language model to pick one and write the lab note, naming rivals only by
number and size (`agents/model.mjs`). Petri is integrated with both Claude Haiku (`claude-haiku-5-5`, asked first,
within a fixed dollar budget) and NEAR AI Cloud (`z-ai/glm-5.3-flash`, its answers signed inside a TEE), which takes over
when Claude does not answer and NEAR AI has credits. If no model answers, the strain takes its first candidate. The
public log records which model, or the rules, decided each move.

## How the parameters were chosen

`sim/src/main.rs` plays the real `petri-core` rules, read from `contract/launch-rules.json`, on a 128 × 128 dish for 7
and 30 days with 15, 150 and 1,500 scripted players, relayer guests and the five house strains, and accounts in NEAR.
Cash is NEAR actually withdrawn (tide claims, sell-backs, bounties, credit taken back) minus NEAR actually paid (attached
NEAR, NEAR spent sponsoring, estimated gas). Results are in `sim/out-v5/summary.txt` and `sim/out-v5/fixes.txt`.

The published runs predate three launched changes: they paid 10% tides (now 5%), paid guests' tide shares, sales and
bounties in NEAR their accounts could not move (now credit), and ran tides with nobody to pay (now skipped). The fix
table re-runs one change at a time, including 5% tides.

Player kinds: builders, raiders (one move in three a siege), defenders, a methuselah (an R-pentomino an hour), late
joiners, a 2-NEAR whale, the same NEAR split over 10 colonies (20 at 1,500 players), a sniper (plants only just before
tides), a carpet locker (a 16 × 16 lattice of blocks 8 cells apart at launch), a racer (only advances), a seller, a
relayer guest, a sybil (a wallet builder with 10 relayer guests), a self-sponsor (sponsors 10 of its own accounts and
takes the credit back), and the house.

Median cash per player after 7 days, with the range over seeds (20 seeds at 15 players, 12 at 150, 10 at 1,500):

| Player | 15 players | 150 players | 1,500 players |
| --- | --- | --- | --- |
| Builder | −0.266 (−0.35 to −0.16) | −0.183 (−0.22 to −0.15) | −0.109 (−0.11 to −0.10) |
| Raider | −0.220 (−0.38 to −0.05) | −0.153 (−0.17 to −0.12) | −0.126 (−0.14 to −0.12) |
| Defender | −0.214 (−0.40 to +0.05) | −0.160 (−0.20 to −0.13) | −0.087 (−0.10 to −0.08) |
| Methuselah | +0.018 (−0.12 to +0.51) | +0.142 (+0.09 to +0.23) | −0.041 (−0.05 to −0.03) |
| Late | −0.322 (−0.38 to −0.29) | −0.268 (−0.29 to −0.24) | −0.154 (−0.16 to −0.15) |
| Whale | −3.972 (−4.30 to −2.44) | −2.122 (−2.30 to −1.25) | −0.986 (−1.03 to −0.96) |
| Split whale | −2.386 (−3.27 to −1.88) | −1.372 (−1.62 to −0.98) | −1.138 (−1.27 to −0.99) |
| Sniper | −0.076 (−0.12 to −0.06) | −0.066 (−0.09 to −0.06) | −0.057 (−0.06 to −0.05) |
| Locker | −0.894 (−1.36 to +0.00) | −0.577 (−0.81 to −0.17) | +0.590 (+0.19 to +0.95) |
| Racer | −0.053 (−0.07 to −0.04) | −0.054 (−0.06 to −0.05) | −0.061 (−0.07 to −0.06) |
| Seller | −0.106 | −0.106 | −0.102 |
| Sybil guest | −0.164 (−0.28 to +0.11) | −0.124 (−0.19 to −0.08) | −0.099 (−0.13 to −0.09) |
| Self-sponsor | −0.470 (−0.57 to −0.33) | −0.421 (−0.48 to −0.25) | −0.327 (−0.36 to −0.29) |
| House strain | −1.078 (−1.08 to −1.07) | −1.081 (−1.08 to −1.08) | −1.111 (−1.12 to −1.11) |

A relayer guest attaches nothing and withdraws nothing, so its cash is 0 by construction. PETRI still held, valued at
the sell-back price, barely changes these figures. Storage takes 44.2%, 42.2% and 37.1% of all NEAR in at 15, 150 and
1,500 players.

One change at a time against the simulated launch rules, median cash:

| Rule (150 players / 1,500 players) | Builder | Methuselah | Whale | Split whale | Locker | Racer | Locker's share of tides |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Simulated launch rules (10% tides) | −0.183 / −0.109 | +0.142 / −0.041 | −2.122 / −0.986 | −1.372 / −1.138 | −0.577 / +0.590 | −0.054 / −0.061 | 5.8% / 1.4% |
| Tides of 5% (launched) | −0.166 / −0.110 | +0.289 / −0.044 | −2.052 / −1.190 | −1.673 / −1.539 | −1.208 / −0.451 | −0.060 / −0.070 | 3.1% / 0.7% |
| Team keeper registered (as run now) | −0.173 / −0.109 | +0.110 / −0.036 | −1.784 / −0.997 | −1.266 / −1.155 | −0.455 / +0.590 | −0.046 / −0.019 | 5.7% / 1.4% |
| Stake keeps 80% at each tide | −0.174 / −0.109 | +0.115 / −0.038 | −1.870 / −0.997 | −1.328 / −1.082 | −0.515 / +0.638 | −0.053 / −0.061 | 5.5% / 1.4% |
| Reach 4 | −0.180 / −0.110 | +0.111 / −0.037 | −2.063 / −0.988 | −1.395 / −1.102 | −0.444 / +0.703 | −0.054 / −0.060 | 5.3% / 1.4% |
| Siege ×2 | −0.176 / −0.119 | +0.133 / −0.044 | −2.106 / −0.976 | −1.394 / −1.152 | −0.586 / +0.613 | −0.053 / −0.060 | 5.8% / 1.4% |
| Sell-back at 30% | −0.179 / −0.099 | +0.129 / −0.050 | −2.101 / −1.175 | −1.329 / −1.065 | −0.496 / +0.389 | −0.052 / −0.046 | 4.8% / 1.2% |

No run has both launched changes at once.

**Gas at scale.** With tide winnings in packed arrays, the biggest tide call in a day of 1,500 players is about 11
TGas (about 104 TGas with per-record writes).

**Lockout.** With the locker on the dish, a newcomer could plant a free 2 × 2 block in 0.2% of spots after an hour at 15
players (9 of 20 seeds had none) and 1.4% at 150, rising to 51.4% and 41.5% by day 7; without the locker, 94.8% after
an hour at 15 players. A siege block is always legal: 6.03 mNEAR after an hour at 15 players, against 3.86 mNEAR for the
cheapest block.

**No players, 30 days.** With nobody at all the agar stays at 1,000,000 PETRI and the team keeper spends 3.18 NEAR of
gas; with nobody calling, one visit at day 30 skips 172,680 generations in a single `Skip`. With only the five house
strains (1 NEAR each) the agar ends at 996,880 PETRI; the house is never fed, and no PETRI left the agar except what it
bought. In these runs the simulator still wrote a tide entry with nobody to pay, which the launched contract skips.

## Known limits

- **Free play has no market.** The testnet dish's NEAR and PETRI have no market, and guests play with credit the site
  gives them. On mainnet the NEAR is real and nothing guarantees PETRI a price.
- **The key is not deleted yet.** Until each full-access key is deleted, whoever holds it could deploy other code.
- **The methuselah edge.** In the simulator one R-pentomino planter was the only kind ahead at 15 and 150 players
  (+0.02 and +0.14 NEAR median); with 5% tides +0.29 at 150.
- **PETRI is paper until sold back, and the vault caps it.** Buy-backs pay half the curve's price, at most the units'
  share of the vault, at most 10% of the vault per tide and nothing before the first tide. The price holds for one
  seller at a time; all holders together could not exit at it.
- **The carpet locker can win at scale.** With 10% tides it won +0.59 NEAR at 1,500 players; 5% tides turned that to
  −0.45 in the fix run.
- **Early colonies have an edge.** The agar is fullest at the start and PETRI cheapest while it is full, so the first
  colonies are fed the most.
- **The simulator is a model.** It estimates storage and gas rather than measuring them, its players follow fixed
  habits, and its published runs predate three launched changes (above).
- **Ordering within a generation.** Entries in the same generation apply in execution order; an earlier planting can
  take a cell a later one wanted, or turn it into a siege.
- **The house is a subsidy.** The strains cost the team about 1.1 NEAR each per simulated week, paid to the other
  players. They are run by the team and are not independent players.
- **Races.** The keeper pot and the tide bounty go to whoever calls first. A simulated racer lost 0.05 to 0.06 NEAR a
  week after estimated gas.
- **Somebody has to advance.** Each call catches up at most 120 generations; plantings wait until the dish is current. A
  dish left alone for more than 480 generations skips the quiet stretch, and nothing is fed for the skipped
  generations.
- **The strains need a model to answer.** Claude Haiku within a fixed budget, NEAR AI Cloud when it has credits;
  without either they play by written rules, and each move in the public log says which decided it.
- **Guest limits are per server instance.** The relayer's rate limits live in memory, so several instances each keep
  their own; the on-chain checks (zero deposit, function-call keys, credit) are what protect the relayer's NEAR.
- **Rounding.** Integer division leaves small remainders of each feed in the agar and of each tide in the vault and the
  credit pool.
