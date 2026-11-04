# Petri rules

Petri is Conway's Game of Life on a shared dish run by a NEAR smart contract, with colony ownership and a token,
PETRI. Colonies buy PETRI from the dish with NEAR, spend it to plant cells, and are fed PETRI for the cells that stay
alive. Every hour, if someone outside the house has earned, 5% of the NEAR in the tide vault is paid back out, split
by what each colony earned that hour. A colony can also fix a patch of its own cells as a specimen slide, an NFT that is
a licence to plant that pattern again for less. This file describes what the contract enforces. The documentation site, <https://docs.playpetri.xyz>, covers the same
ground with examples.

The code is the source of truth. The rules of a generation, the feed, the reach cap and stake decay, the planting
price and the licence discount, the purchase and sell-back curves, the tide split, the slide pattern match and slide
pictures live in `core/src/lib.rs` (the `petri-core` crate). The clock, the ledger, the vault, the credit pool,
sponsored credit and the dish's own methods live in `contract/src/lib.rs`; each colony's numbers in
`contract/src/books.rs`, the token in `contract/src/token.rs`, specimen slides in `contract/src/slides.rs`, payment in
wNEAR in `contract/src/intents.rs` and the relaunch from v6 in `contract/src/relaunch.rs`. The same `petri-core` crate
runs in the contract, in the browser (compiled to WebAssembly) and in the economy simulator (`sim/src/main.rs`), so the
three cannot disagree. The contract has 132 tests (`contract/src/tests.rs`) and the core 35 (`core/src/tests.rs`).

Every parameter is set once, when a dish is launched (`new`, or `relaunch` below), and can be read with the `rules`
view. No method changes a parameter of a running dish, mints PETRI after launch, or edits the board. `new` and
`relaunch(rules, accounts)` can be called only through the contract account's own key: `relaunch` is a private
`#[init(ignore_state)]` method, so only a transaction from the contract account itself (signed with its full-access
key) can run it. It deletes every key the v6 layout wrote and launches a fresh dish from generation 0, exactly as `new`
does, and it refuses an account with no v6 dish ("no v6 dish here: relaunch clears a v6 dish that has colonies") and
one that already runs v6.1 ("this account already runs v6.1"). Once the full-access key is deleted nobody can start the
dish again, change a parameter or deploy anything else.

## Two dishes

The same build (v6.1) runs on two networks. `petri-v6.testnet` is free play: guests, a relayer and sponsored credit.
`petri-dish.near` is mainnet: real NEAR, wallets only, and payment in other tokens through NEAR Intents. Both ran v6
briefly first (hours, not days) and were relaunched in place with `relaunch`, from generation 0; the testnet account kept the
name it was made with for v6. (v5's `petri-v5.testnet` is no longer played.) Their parameters are
`contract/launch-rules.json` and `contract/launch-rules-mainnet.json`, which differ only in `house`, `keepers` and
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
| `keeper_bps` | 200 | 2% of each generation's feed goes to the keeper pot, paid to the account whose call ran the generation (never a house account, a keeper or a guest). |
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
| `licence_min_cells` | 12 | A slide is a licence only if it captured at least 12 cells; a smaller slide can still be minted (`slide_min_cells`, 5) as a keepsake, but a planting under it is refused. |
| `slide_discount_bps` | 2500 | A planting of a slide's exact pattern under its licence costs 25% less. |
| `pact_radius` | 8 | A pact forbids its promisor to plant within 8 cells (across or down, wrapping) of the payer's living cells. Launch refuses a radius outside 1 to 16. |
| `pact_max_gens` | 2880 | A pact lasts at most 2,880 generations (12 hours) from the dish's stored generation when it is offered. |
| `slide_royalty_bps` | 1000 | A licensed planter that does not hold the slide pays its holder 10% of that discounted cost in PETRI (to the agar instead, if the planter has never attached NEAR). |
| `wnear` | `wrap.testnet` / `wrap.near` | The wNEAR contract whose transfers join or buy. |
| `house` | 5 accounts | The dish's own players: `petri-violet`, `petri-safranin`, `petri-methylene`, `petri-malachite`, `petri-congo` (`.testnet`) on testnet; `violet`, `safranin`, `methylene`, `malachite`, `congo` (`.petri-dish.near`) on mainnet. Never fed, no tide share, never sell. |
| `keepers` | 1 account | The dish's own keeper: `petri-keeper.testnet` on testnet, `keeper.petri-dish.near` on mainnet. Counted as house: no tide bounty, no keeper pot. |

Fixed in code rather than in `rules`: a colony name is 1 to 24 ASCII characters; a lab note is at most 140 characters
and 280 bytes; a slide's title at most 40 characters and 160 bytes, and a slide 4 to 32 cells a side; the history chain
advances every 16 generations (`CHAIN_EVERY`); a catch-up stops once its call has used 110 TGas
(`CATCHUP_GAS_LIMIT`) less what is still to be written, or its prepaid gas less 40 TGas (`GAS_RESERVE`) less the same;
a sponsorship brings at least 0.01 NEAR (`MIN_SPONSOR`) and an account takes credit from at
most 8 sponsors (`MAX_GRANTS`); a sponsor may take back its own credit once 5,760 generations of the wall clock have
passed since it last gave it or the account last drew on it (`RECLAIM_AFTER`); a cold page holds 32 colonies (`PAGE`);
the hot table holds at most 10,000 colonies (`MAX_PLAYING`) and at most 32 rows leave it in a call (`FLUSH_MAX`); a colony is
party to at most 8 pacts that have not ended (`MAX_PACTS`), and an offer's storage allowance is 0.0042 NEAR (`PACT_DEPOSIT`).
No wNEAR is ever refunded: there is no minimum transfer, and `intent_minimum` (below) tells a payer what an order needs.

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
`mint_slide` and `advance` (and a join or purchase from pending NEAR) each first step the stored board through the due
generations, up to `max_catchup` (120) per call, and stop early once the call has used 110 TGas (`CATCHUP_GAS_LIMIT`)
or its prepaid gas less 40 TGas (`GAS_RESERVE`), whichever is less, in both cases less what is still to be written: the
feed part of the hot table (26 bytes a row) at 72 Mgas a byte; the purse part (51 bytes a row), only if a tide falls in
the generations being stepped or a purse is already changed; and 32 cold pages' worth (0.35 TGas each) for moving idle
rows out. So no backlog can push a call past NEAR's gas limit; a call still always steps at least one generation. Each
generation runs Life, folds the history chain when due, adds the feed to unclaimed earnings, the tide window and the
keeper pot, and runs a tide when one is due (below). A catch-up reads the hot table (below) once and writes it back
once, so it costs what the colonies playing now cost, however many ever joined, and logs one `generation` event. If any
generation ran, the keeper pot is paid to the account whose call it was (see The keeper pot).

Each colony's numbers (unclaimed earnings, NEAR won and not claimed, credit won and held, credit won in all, whether it
has ever attached NEAR, its stake and, while it plays, its tide window) live in exactly one of two places
(`contract/src/books.rs`). Cold pages hold 32 colonies a key (`X` + page number); a slot is 69 bytes and also holds the
colony's stake with the number of tides it was last decayed at. A join appends one slot to the last page and pays for
it. The hot table holds the colonies that play now, in two parts: the feed part (`h`: id, stake, window, earnings), which
every catch-up rewrites, and the purse part (`j`: id, owed, credit won and held, the attached flag), which only tides and
a playing colony's own purchases, claims and spending rewrite.

- **Who has a row.** A colony that earned since the last tide (its window is above 0), and a colony with living cells and
  a stake that can still earn (`petri_core::can_earn`: `feed_weight(1, stake, reach) > 0`, which at reach 8 is a stake of
  125 or more thousandths of a cell). A colony enters the table when it plants. The house never has a row: it is never
  fed and takes no share, and its stake stays in its cold slot.
- **When a row leaves.** At the end of every catch-up that stepped at least one generation, at most 32 rows a call
  (`FLUSH_MAX`), lowest ids first: a row with no window whose colony has no living cell on the stored board, or whose
  stake cannot earn. Its numbers go back to its cold slot.
- **Stake in a cold slot** is decayed once for every tide that ran since the slot was written
  (`petri_core::decay_stake_times`), which is exactly what tide-by-tide decay would have left, so the `stakes` view and
  both replays see the same numbers. It joins the hot table again when the colony plants.
- **The feed is unchanged by this.** It reads stake only from rows, and a colony without a row has either no living cell
  or a stake whose weight is 0.
- **The cap.** The table holds at most 10,000 rows (`MAX_PLAYING`). A colony without a row that plants while it is full
  first moves out up to 32 rows that may leave, using the current board; if it is still full the planting is refused
  ("10000 colonies are playing at once, the most the dish holds; plant again after the next tide"). That bounds the gas of
  every call whatever the number of colonies; the worst a crowd can do is make newcomers wait for the next tide.

`state().playing` is the number of hot rows: the colonies alive or paid at the coming tide, plus any whose row has not yet been moved out.

Sponsorship days are counted on the wall clock, `clock = due generation + skipped`, which needs no catch-up.

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

- **Joining.** `join(name, color, credit?)` must bring at least `min_join` (0.01 NEAR), attached or from credit
  ("joining needs at least 0.01 NEAR"). The contract keeps the colony's storage (plus 113 bytes for its purchase entry) and spends the rest on PETRI.
- **Buying.** `buy(credit?)` spends what it brings, less 113 bytes for the purchase record, on PETRI. PETRI bought with
  credit is kept PETRI (see Kept PETRI).
- Storage is paid from credit first, then from attached NEAR. What is left of the attached NEAR goes to the tide
  vault and what is left of the credit to the credit pool. The `Buy` entry records both (`near`, `credit`).
- **Selling back.** `sell(petri)` first catches up and claims the seller's earnings (so its balance counts them), then
  returns PETRI to the agar for NEAR from the vault: half the curve's price, never more
  than the units' pro-rata share of the vault. A colony holding kept PETRI cannot sell for NEAR (see Kept PETRI): "PETRI
  earned before a colony's first NEAR stays in the dish: you hold X kept PETRI; plant it first (kept PETRI is spent first),
  then you can sell PETRI for NEAR". The sale's record storage comes out of that NEAR (`near` in the `Sell`
  entry) and the rest (`paid`) goes to the seller: as NEAR, to its payout account if it set one, or, for a colony that
  has never attached NEAR, as credit it can spend only in the dish (`as_credit: true`, counted in `credit_sold`).
  Between two tides the agar pays out at most `sell_cap_bps` (10%) of the vault as it stood at the last tide, first
  come first served; before the first tide it buys nothing back. A sale paid in NEAR must also cover what a refund's
  records would cost should the transfer fail (239 bytes), or it is refused ("that is too little PETRI to cover the
  sale's record"). The house never sells ("the dish's own colonies never sell PETRI back: the vault is the players'").
  A round trip through the agar always loses (core test
  `selling_back_always_loses_against_buying`).
- The `buy_quote(near)` and `sell_quote(petri)` views give prices now.

## Credit

`sponsor(account_id)` is payable and open to anyone. It needs at least 0.01 NEAR ("sponsoring takes at least 0.01
NEAR"). The contract keeps the attached NEAR, less its records' storage, as credit for that account from that sponsor:
a grant. Each sponsor's grant is kept apart, and an account holds grants from at most 8 sponsors at once ("this account
already has credit from 8 sponsors"); a sponsor topping up its own grant always can. A new grant also sets aside 210
bytes for the `Unsponsor` entry its sponsor may write later. Each sponsorship writes a `Sponsor` entry. The site's
relayer sponsors each guest with 0.05 NEAR this way, so it never attaches NEAR to the calls it relays.

A colony can also win credit: its share of the credit pool at every tide, and, if it has never attached NEAR, its share
of the vault, the bounties of tides its calls run and what it is paid for sales. Credit won is spent before sponsored
credit and no sponsor can take it back.

Credit can be spent only by passing `credit` to `join`, `buy`, `plant` or `mint_slide` (for a slide's storage), and can
never be withdrawn by the account. It is spent in a fixed order: credit won first, then the grants, oldest first.
Drawing on a grant restarts that grant's day. PETRI bought with credit is kept PETRI (see Kept PETRI). Credit spent on joining, buying and planting goes to the credit pool,
never the vault; the `Buy`, `Plant` and `Slide` entries record what each call took as `spent`.

`unsponsor(account_id)` lets a sponsor take back what is left of its own grant, and only that: other sponsors' credit
and credit won stay the account's. It needs a day, 5,760 generations of the wall clock, since the sponsor last gave to
that grant or the account last drew on it ("that credit was given or used in the last day"); a caller with no grant
there is refused ("there is no credit of yours left on that account"). It writes an `Unsponsor` entry and sends the NEAR
with a callback: if the transfer fails, the NEAR becomes pending NEAR for the sponsor.

`credit_of(account_id)` shows what an account can spend (won plus sponsored); `credit_grants(account_id)` shows the
sponsored part, one `{sponsor, amount, at}` per sponsor in the order it is spent. `state` shows `credit_given`, `credit_won`, `credit_sold`, `credit_spent`,
`credit_reclaimed`, `credit_in` and `credit_pool`.

## Planting

`plant(cells, note?, credit?, slide?)` brings cells to life for the caller's colony. `cells` are flat indices `y ×
width + x`. `slide` is a specimen slide's token id, for a planting under its licence (below).

### The price

```
counted        = sum over fed colonies of min(living cells, reach × stake)   (the last feed's weight)
feed per cell  = (agar × feed_ppm / 1,000,000) × (1 − keeper_bps / 10,000) / max(counted, live_floor)
price of a cell = max(feed per cell × payback, min_cell_price)
cost           = price of a cell × cells × (siege_x if any planted cell is inside a rival's buffer, else 1)
licensed cost  = cost − cost × slide_discount_bps / 10,000         (under a slide's licence)
royalty        = licensed cost × slide_royalty_bps / 10,000        (paid by planters that do not hold the slide)
```

in PETRI units with integer division at every step (`feed_per_cell`, `plant_price`, `planting_cost`, `licensed_cost`,
`royalty`), after the planting's own catch-up. `state().counted` is the cell count the price uses. Before checking the
price, `plant` claims the colony's waiting earnings into its balance. Half of the cost is burned and half returns to the
agar; a royalty is paid on top, to the slide's holder, and is neither burned nor returned. `quote(cells, siege?,
licensed?)` gives the price now.

### Planting under a slide's licence

With `slide`, the slide must have captured at least `licence_min_cells` (12) cells ("slide N captured C cells; only a
slide of at least 12 cells is a licence"), and the cells must be exactly that slide's pattern moved to another place:
the same set cells, shifted by one offset (wrapping at the edges), every cell once, and not turned or flipped
(`petri_core::fits_slide`). Anyone may plant under such a slide's licence, at `slide_discount_bps` (25%) off. A planter
that does not hold the slide also pays `slide_royalty_bps` (10%) of the discounted cost in PETRI, a transfer (`ft_transfer`
event, memo "slide royalty"), not a burn. It goes to the slide's holder, and a holder with no PETRI registration is
registered at the planter's expense (125 bytes, in `plant_deposit`). A royalty paid to a holder that has never attached
NEAR is kept PETRI (see Kept PETRI). A planter that has never attached NEAR before this
planting pays its royalty to the agar instead (counted in `returned`; the holder and the slide's `royalties` get
nothing), so free play cannot hand a wallet PETRI to sell. The house may plant only slides it holds, so it never pays a
royalty. The siege surcharge still applies in full: the discount is the licence's whole perk, and it never makes a
rival's ground cheap to take. The `Plant` entry carries `licence: {token, moves, holder, royalty, to_agar}` (`holder` is
none when the planter held the slide; `to_agar` is `holder.is_some() && !attached`, which the replays check) and the
`plants` view returns the token as `slide`.

### Sieges

A planting with any cell whose 7 × 7 neighbourhood (across the wrapped edges) holds another colony's live cell is a
siege. House colonies' cells never count. It is legal and costs `siege_x` (3) times the price; the ledger entry is
marked `siege: true`. No ground is ever closed: a newcomer can always plant somewhere, at worst at three times the
price.

### The deposit

A planting brings NEAR, attached or from credit: the storage it uses plus `cell_fee` per cell. `plant_deposit(cells,
note_bytes?, slide?)` returns `(180 + 77 + 4 × cells + (note_bytes + 64, if there is a note)) × storage byte price +
cell_fee × cells`. The 77 bytes are a hot row, for a colony that plants for the first time since it last played; 82
more are added while the hot table is empty, for its two records. Under a slide's licence it adds 26 bytes plus the
length of the holder's account for the licence, and 125 bytes when the holder has no PETRI registration. The contract measures the storage the planting actually used and keeps that (from credit first), and puts the
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
| With `slide`: the slide exists. | "there is no slide with that id" |
| With `slide`: the slide captured at least `licence_min_cells` cells. | "slide N captured C cells; only a slide of at least 12 cells is a licence" |
| With `slide`: the cells are its pattern, moved but not turned. | "those cells are not the slide's pattern: plant exactly its cells, moved anywhere but not turned" |
| The account has the credit it asks to spend. | "this account has X NEAR of won and sponsored credit" |
| At least `cell_fee × cells` is brought. | "planting N cells needs at least X NEAR" (X is `plant_deposit`) |
| After catching up, the dish is at the due generation. | "the dish is behind the clock; call advance first" |
| The colony has not planted in this generation. | "one planting per generation; wait for the next one" |
| No cell is listed twice, every target is empty. | "cell (x, y) is listed twice" / "cell (x, y) is already alive" |
| A colony with no hot row finds room in the table (after up to 32 rows that may leave have left). | "10000 colonies are playing at once, the most the dish holds; plant again after the next tide" |
| A house colony plants only slides it holds. | "the house plants only slides it holds: its PETRI never goes to players" |
| The colony holds the cost and any royalty, siege included. | "planting N cells [inside a rival's buffer] costs X PETRI[ and a Z PETRI royalty]; you hold Y" |
| What was brought covers the storage used plus the fee. | "this planting needs X NEAR for its storage and fee" |

A refused call changes nothing; attached NEAR is refunded and credit is not spent.

## The feed and the reach

In each generation, after the step:

```
weight   = min(colony's living cells, reach × stake)   (0 for house and keeper colonies)
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

Each generation's keeper cut collects in one pot. The catch-up pays the whole pot to the account whose call it was, if
the call stepped at least one generation, that account is registered to hold PETRI, and it is not one of the dish's own
accounts (`house` or `keepers`) and not a guest (a colony that has never attached NEAR: guests take no keeper pot). Any call that catches the dish up can take it: `plant`, `buy`, `join`, `sell`, `claim`,
`advance`, `mint_slide`, and a wNEAR order settled for an account (the pot goes to that account). `advance` does not pay
it separately, and a call on a dish that was already current pays nothing. `sell` reads the seller's balance after its
catch-up, so a pot paid in that catch-up is not lost. The dish's own keepers and guests never take the pot, so it waits for
the next call from an account that is neither. The project's keepers (`rules.keepers`: `petri-keeper.testnet` and `keeper.petri-dish.near`) call `unwrap_wnear` when wNEAR
is left waiting. On mainnet the keeper advances when the
stored board is 400 generations behind, before the clock would skip; on testnet it advances when the board is 20
generations behind. It has no powers anyone else lacks, and fewer: it takes no pot and no tide bounty.

## Claiming

Feed earnings and NEAR winnings accrue in the colony's own numbers (its hot row while it plays, else its cold slot).
`claim()` moves the colony's PETRI earnings into its balance and sends its NEAR winnings, to its payout account if it
set one, with a `Claim { colony, petri, near, paid }` entry whose storage is paid from the NEAR (`near` left the
colony's winnings, `paid` was sent). NEAR winnings too small to cover that entry and a possible refund's records (about
0.0034 NEAR) stay owed until they are larger. Credit won needs no claim: it is spendable as soon as the tide runs.
`set_payout(account_id?)` names where a colony's NEAR payouts (tide winnings and sales) go; only a colony that has
attached NEAR may set one ("only a colony that has attached NEAR is paid in NEAR; free play earns credit, which stays
in the dish"), and never the dish itself ("payouts cannot go to the dish itself").

Every NEAR payout has a callback, `on_payout`. If the transfer fails, a `Refund { colony, kind, of, near, storage }`
entry names the payout's entry (`of`) and its kind (0 claim, 1 sale, 2 bounty, 3 unsponsor, 4 pending claim); its own
storage, and any pending record it needs, comes out of the NEAR that came back. A failed bounty goes back to the vault.
Every other failed payout (a claim, a sale, a sponsor's reclaim, a pending claim) becomes pending NEAR for the account
it was for, which it can take with `claim_pending()`. Either way the event `payout_failed` is logged.
`claimable(account_id)` and `pending_of(account_id)` show what is waiting. Nothing expires.

## NEAR and the tides

The tide vault receives what wallets attach to joins, purchases and plantings (and joins or purchases paid from pending
NEAR), less storage, and wNEAR too small to pay for a pending record of its own (a `Dust` entry). It pays out tides' NEAR
shares and shares paid as credit, tide bounties, tide-entry storage and sell-backs (with their record storage), and
takes back failed bounty payouts. Nothing else goes in or out.

The credit pool receives the credit spent on joins, purchases and plantings, less storage. It pays out only at tides,
only as credit.

At every generation that is a multiple of `tide_every`, if some colony outside the house was fed since the last tide
(`tide_due`):

```
pay          = vault × tide_bps / 10,000                     (5%)
bounty       = min(pay × tide_bounty_bps / 10,000, max_bounty)   to the account whose call ran the tide (0 for the house)
storage      = min(bytes × storage byte price, pay − bounty)   (`bytes`: the storage the Tide entry and its index slot took)
share        = (pay − bounty − storage) × window / sum of windows
credit_pay   = credit pool × tide_bps / 10,000
credit share = credit_pay × window / sum of windows
```

A colony's window is the PETRI it was fed since the previous tide, so a colony planted just before a tide gets only
those few generations' worth, and house colonies have no window. A colony that has attached NEAR is owed its share as
NEAR (`paid`); a colony that never has is paid it as credit (`as_credit`). Every colony's credit share is credit
(`credit_paid`). The bounty goes to the caller in NEAR, or as credit if the caller is a colony that never attached
NEAR. A tide run by one of the dish's own accounts (a house colony or a keeper) pays no bounty: it stays in the vault
for the players, and the bounty is 0. If no NEAR share was paid at all there is no bounty either, and the storage is
`min(bytes × price, vault)`. Windows then reset, every colony's stake decays to `stake_keep_bps` of itself, and the
buy-back allowance is set to `sell_cap_bps` of the vault.

The `Tide` entry holds only what a replay cannot work out itself: the chain, `bytes` (130, or 175 on the tide that
starts a new page of the tide index) and `by`, the caller's colony (0 for an account with no colony, 65535,
`HOUSE_RUNNER`, for a keeper with none). `pay`, the bounty, `storage`, `paid`, `as_credit`, `credit_pay` and
`credit_paid` are worked out from the ledger before the tide, and every one of them is in the `tide` event (generation,
index, chain, by, pay, bounty, storage, paid, as_credit, credit_pay, credit_paid, winners). The tide index packs the
ledger positions of Tide entries, 4 bytes each and 256 to a key (`V` + page number); `checkpoints` reads it.

A tide with nobody to pay does not run at all: no entry, no storage, no bounty, no decay, and the buy-back allowance
stays as it was. Rounding and the other 95% stay in the vault and the pool. Every colony that earned since the last
tide has a hot row, so a tide reads and writes only the hot table and never a colony record, however many colonies win.

## The house

The accounts in `rules.house` (the five AI strains, run by the team) play like anyone: they join, buy PETRI and plant.
They are never fed and take no tide share, so every PETRI they plant with is bought, and that NEAR goes to the other
players. They never have a row in the hot table; their stake stays in their cold slots. Their cells never make another colony's planting a siege, and their strategy code never lays siege. On
testnet they spend sponsored credit; on mainnet they attach their own NEAR, so what they spend lands in the vault.

The house's PETRI stays in the house. The accounts in `rules.house` and `rules.keepers` (a colony's `house` flag is set
for both):

- never `sell` PETRI back to the vault;
- can `ft_transfer` or `ft_transfer_call` PETRI only to another house account ("the house's PETRI stays in the house:
  it plants with it and never hands it to players"), so the strains can still make pacts with each other (see Pacts);
- never take a tide bounty (it stays in the vault) or the keeper pot;
- plant only slides they hold, so they never pay a royalty to a player;
- are not started a colony by someone else's wNEAR: a payment for a house account without a colony waits as pending NEAR
  for it to claim ("the house starts its own colonies; that NEAR waits for its account to claim").

## Kept PETRI: free play never reaches NEAR

PETRI earned before a colony's first NEAR stays in the dish. A colony that has never attached NEAR is a guest here
whether or not it uses the site's relayer.

- **A guest cannot send PETRI.** `ft_transfer` and `ft_transfer_call` refuse it ("free play's PETRI stays in the dish: a
  colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)"). It can still
  plant, mint slides, receive PETRI and sell back for credit.
- **Every colony has `kept` PETRI** (a u64 in its colony record, with a mirrored `attached` flag so a transfer needs no
  hot-table read):
  - while a colony is a guest, everything it claims, buys (all of a guest's purchases are credit) and is paid in
    royalties as a slide holder is added;
  - when it first attaches NEAR (a purchase or planting with `near` above 0, a join with NEAR, a wNEAR join or purchase),
    its unclaimed earnings are added (what it claimed as a guest already is);
  - PETRI anyone buys with credit is added, attached or not: `credit_share(units, credit, near + credit)` of the purchase
    (`petri_core`: units × credit ÷ total, both shifted right until the total fits 64 bits, exact for every real
    amount), so credit never becomes vault NEAR by a sale either;
  - plantings (cost and royalty) and slides spend kept PETRI first; a guest's sale for credit spends it too.
- **While a colony holds any kept PETRI it cannot** `sell` for NEAR, send PETRI (`ft_transfer`, `ft_transfer_call`) or pay
  PETRI into a pact: "PETRI earned before a colony's first NEAR stays in the dish: you hold X kept PETRI; plant it first
  (kept PETRI is spent first), then you can sell PETRI for NEAR". Once its plantings have spent it, everything it holds
  is its own, and what it earns afterwards is sellable.
- **Guests take no keeper pot**: it waits for the next caller that is not a guest.
- **The house is exempt** from the send check (its PETRI cannot leave the house anyway; the testnet strains play on
  sponsored credit and would otherwise be guests). The house rules are unchanged: it never sells and sends PETRI only to
  house accounts.
- **Views.** `Colony` has `attached: bool` and `kept: U64`. In `colony_of` and `colonies`, `kept` includes a guest's
  unclaimed earnings, that is, what will be held back.

The rule is "no sale or send while any is held", not "sellable = balance − kept", because balances are not in the ledger
(transfers and the keeper pot are not entries, and an account may hold PETRI from before it joined), so no replay can
check `balance − kept` exactly. With this rule every check is exact from the ledger: `kept` is rebuilt entry by entry, and
a `Sell` for NEAR (or a PETRI pact offer) by a colony whose replayed `kept` is above zero is a violation. The cost: a
former guest plants its kept PETRI before selling anything.

Transfers stay out of the ledger (a `Transfer` entry would let anyone grow the contract's storage at 1 yoctoNEAR a
call). The replays argue it from three facts: no transfer changes `kept`; every colony's `kept` is rebuilt from the
ledger alone and must equal the colony view; and the contract refuses every transfer by a guest or by a colony holding
kept PETRI (the code, pinned by the build hash). The NEP-141 `ft_transfer` events remain the public record of each
transfer.

In the simulator (`sim/out-v6.1`, testnet rules, 150 players plus 3 SybilAttach and 3 SybilTransfer operators, each a
wallet with 10 relayer guests, 7 days, 6 seeds) the attacks that were left open before the rule pay nothing with it.
Guests that `ft_transfer` their farmed PETRI to one wallet that sells it: 476.9 PETRI moved and the vault paid +0.0470
NEAR (+0.0427 to +0.0527) a week per operator without the rule; 0 moved and 0 NEAR with it. Guests that farm a day, attach
0.01 NEAR each and sell what they farmed: 0 NEAR with the rule (82 sales refused per operator), +0.0008 without, because
a day's farm (about 30 PETRI, 0.003 NEAR) is worth less than a sale's own record and refund reserve (0.0035 NEAR). Across
every colony in the run, the NEAR the vault paid for PETRI earned before a first NEAR, bought with credit or moved in by
a guest's transfer was 0.0000 with the rule and 0.1674 without. Everyone else's cash is within seed noise (mainnet, 150
players, 7 days: Builder −0.1865 against −0.1899 without the rule, Methuselah +0.3496 against +0.3680).

## Pacts

A pact is a one-way promise the contract enforces. Colony A pays colony B PETRI for B's promise not to plant within
`pact_radius` (8) cells of A's living cells before generation `until`. The council of the five strains negotiates these
(see The strains); anyone can make one.

- `pact_offer(to, petri, until, credit?)` (payable) is A's offer to the colony of account `to`. The dish holds the PETRI in
  escrow (`state().pact_escrow`). It catches up first. `until` must be after the stored generation and at most
  `pact_max_gens` (2,880) ahead. Storage (`PACT_DEPOSIT`, 0.0042 NEAR, covers it) is paid from `credit` first, then
  attached NEAR; the rest of the attached NEAR comes back. It returns the pact's number.
- `pact_accept(id)` is B's acceptance: the PETRI is paid to B, and until `until` the contract refuses every planting by B
  that breaks the pact: "pact N with <A's name>: your colony promised not to plant within 8 cells of its living cells
  until generation U; (x, y) is that close to its cell at (x', y')". It uses the stored generation (the planting itself
  catches up and checks the board at its generation).
- `pact_cancel(id)` ends an open offer: A withdraws it or B declines it at any time, and anyone may once it has expired;
  its PETRI goes back to A. An accepted pact ends only once `until` has come ("an accepted pact binds until its generation
  `until`; then anyone may end it"). Nobody can end one early.
- Views: `pact(id)` and `pacts_of(account_id)` (the pacts that account's colony is party to and that have not ended),
  each a `PactView { id, from, to, petri, until, accepted, ended, binding }` (colony ids; `binding` while accepted, not
  ended and `until` ahead). `DishState` gains `pacts` (offers so far) and `pact_escrow`.

Rules: one open offer from A to B at a time; a colony is party to at most 8 pacts that have not ended (offers made or
received, accepted pacts on either side), and expired pacts of both colonies are ended before an offer checks the cap, so
slots free themselves. Only PETRI its maker could sell pays for a pact: a guest or a colony holding kept PETRI offers
pacts with `petri` 0 only. A house colony's pact with a player carries no PETRI ("the house's PETRI stays in the house"); a
player may pay the house; house-to-house pacts are free, with or without PETRI. The promise is one-way (B promises, A
pays); a truce is two pacts, one each way, so each side prices its own promise.

Ledger and events: `PactOffer { generation, pact, from, to, petri, until, spent }`, `PactAccept { generation, pact }` and
`PactEnd { generation, pact }`. An offer pays for its own storage plus a 140-byte reserve for the accept and end
entries. The `pact` event is `{ pact, did: "offer" | "accept" | "end", from, to, petri, until, refund }`; the NEP-141
`ft_transfer` events show the escrow moving (memos "pact offer: held until accepted", "pact accepted", "pact offer: back,
never accepted"). Pact records are stored under `P` + u32 and each colony's live list under `Q` + u16 (raw keys).

Gas: with 30,000 colonies, 1,500 playing, a newcomer bound by 8 pacts that plants 64 cells far from them (so the whole
scan runs) costs 22.3 TGas on the real network against 20.5 for the same planting unbound. `Dish::pact_breach` marks
the union of the squares, so it looks at each dish cell at most once whatever the number of pacts.

Both replays rebuild every pact from the three entries and check: numbering; `until` within (g, g + `pact_max_gens`]; at
most 8 live pacts per colony; one open offer per pair; PETRI offers only by a colony that attached NEAR and holds no kept
PETRI (the house is exempt); no house PETRI offered to a player; an accept only while open and before `until`; an accepted
pact ended only at `until`; the escrow and the count; and for every planting, `pact_breach` against the colonies that
accepted pacts binding the planter protect, on the board as it stood. Credit spent on offers counts in `credit_spent`.

## Specimen slides

`mint_slide(x, y, w, h, title?, credit?)` fixes a rectangle of the caller's own living cells as an NFT. After catching
up and claiming the colony's earnings, the contract reads the `w` × `h` rectangle at (`x`, `y`) (4 to 32 cells a side,
wrapping at the edges) and keeps only the colony's own living cells (`Dish::region_bitmap`). It must capture at least
`slide_min_cells` (5), and only a slide that captured `licence_min_cells` (12) or more is a licence; the colony must hold `slide_cells_price` (1 PETRI) per captured cell, all of which is burned
(event `ft_burn`, counted in `burned` and `slides_burned`). The slide's storage, quoted by `slide_deposit(w, h,
title_bytes?)`, comes from credit first and then from attached NEAR; attached NEAR left over is sent back. None of it
reaches the vault or the credit pool. Refusals: "a slide is 4 to 32 cells on each side", "the slide's corner is off
the dish", "a slide needs at least 5 of your living cells; that rectangle holds N", "a slide of N cells costs X PETRI;
you hold Y", "this slide needs X NEAR for its storage".

Slides are NEP-171 tokens in the dish contract itself (`nft_transfer`, `nft_transfer_call`, `nft_token`), with NEP-177
metadata (`nft_metadata`; each token's `media` is an SVG that `petri_core::slide_svg` draws from the stored bitmap
whenever it is asked), NEP-178 approvals (`nft_approve`, `nft_revoke`, `nft_revoke_all`, `nft_is_approved`) and NEP-181
enumeration (`nft_total_supply`, `nft_tokens`, `nft_supply_for_owner`, `nft_tokens_for_owner`). The `slides`,
`slide` and `slides_for` views return the cells, the colony's current name, `moves` and `royalties`. `nft_tokens` and
`nft_tokens_for_owner` return at most 10 tokens a call, each with its image; the `slides` views return up to 500 without
it. Each mint writes a `Slide` entry to the ledger, and both replays check it.

A slide of 12 or more cells is a pattern licence (see Planting under a slide's licence): whoever holds it is paid a
royalty whenever anyone else who has attached NEAR plants its pattern under its licence (a planter that never has pays
the agar). Smaller slides are keepsakes: they can be minted and traded, but no planting is made under them, so blocks,
blinkers, beehives, loaves, gliders, lightweight spaceships and small oscillators cannot be licensed. Each slide counts its `moves` (every transfer and every return) and the
royalties its holders were paid (`slide_royalties(token_id)`). Moves are not written to the ledger, since a transfer
carries exactly one yoctoNEAR and could not pay for an entry; instead each licensed planting records the slide's move
count and its holder, and the replays check that the holder is the minter until the first move, one account between
moves, and each slide's final owner, moves and royalties against the slides view.

## Paying with any token

NEAR Intents swaps a payer's tokens into wNEAR and delivers them with `ft_transfer_call`. `ft_on_transfer(sender_id,
amount, msg)` accepts only wNEAR from `rules.wnear`; any other token is refunded. It never fails, and wNEAR is never
refunded, whatever the amount, so no 1Click delivery can bounce back to the intents contract and be lost to its payer.
The message is

```
{"for": "<account>", "do": "join" | "buy", "name": "<colony name>", "color": <0xRRGGBB>}
```

Every amount becomes pending NEAR for `for` (or for the sender if the message names nobody), with its order, less the
storage of its pending record and its `Pending` entry. An amount too small even for those goes into the vault with a
`Dust` entry. The contract unwraps the wNEAR (`near_withdraw` on the wNEAR contract, 5 TGas; it needs 35 TGas left to
start) and then, in a receipt of its own (30 TGas), runs the order for `for` exactly as if that account had attached the
NEAR itself: an account with a colony buys, and an account without one joins if `do` is `join` and the NEAR reaches
`min_join`. The order spends only the NEAR that came with it (`order_near`); NEAR that is pending for other reasons (a
failed payout) is never spent by an order. Every change to pending NEAR is a `Pending` or `Unpend` entry.

If the order cannot run then (an unreadable message, too little gas, a failed unwrap, a purchase for an account with no
colony, too little NEAR), the NEAR waits with its order. Anyone may complete it later with `settle_pending(account_id)`
(the keeper, the account, anyone): it does only what the order asked, with only the NEAR that came with it, and changes
nothing if the order cannot run yet. The account can instead take everything with `claim_pending()`, which clears the
order (pending again if that transfer fails). `pending_of` shows the amount and `pending_record` the amount,
`order_near` and the order. `unwrap_wnear()` unwraps wNEAR left waiting and `register_wnear()` registers the dish on the
wNEAR contract; anyone may call either.

`intent_minimum(what, account_id)` is the least a payment for that account must deliver for its order (`"join"` or
`"buy"`) to run: `min_join`, or a purchase's 114 bytes, plus the `Pending` and `Unpend` entries the payment writes on its
way. The site's quote route refuses any 1Click quote whose guaranteed output is below it.

Anyone can pay for any account, so the payer's text never appears under someone else's account. The message's `name`
and `color` are used only when the transfer's `sender_id` is `for` itself (an account paying from its own wNEAR) and the
name is free. Otherwise the colony is called "Culture" and the first 4 (then 6, up to 16) hex digits of the sha256 of its
account, in a colour from the same hash, and is marked `proxy`: its account may choose its own name and colour once with
`rename(name, color)` ("only a colony someone else started can be renamed, and only once"). Names of the form "Culture
<hex digits>" are kept for these colonies: `join` and `rename` refuse them.

## Solvency

The `solvency` view compares the contract's NEAR with what it owes:

```
owed = vault + credit pool + (credit_given + credit_won + credit_sold − credit_spent − credit_reclaimed)
       + tides_owed + pending
held = account balance − storage + wNEAR held and not yet unwrapped
solvent = held ≥ owed
```

Every term of `owed` can be recomputed from the ledger alone; both replays do so and compare each with the contract's
counter.

## Conservation

The contract tests assert after their scenarios (`conserved`). A Tide's `pay`, `bounty`, `storage`, `paid`, `as_credit`,
`credit_pay` and `credit_paid` below are the amounts a replay works out for it (see The tides); the `tide` event logs the
same figures.

- `total_supply = max_supply − burned`
- `every balance + agar + unclaimed + keeper_pot + pact_escrow = total_supply`; `ft_balance_of` of the dish is
  `agar + unclaimed + keeper_pot + pact_escrow`, and the escrow is rebuilt from the `PactOffer`, `PactAccept` and
  `PactEnd` entries
- `agar = max_supply − sold − fed + returned + bought_back`
- `vault + every Tide's (bounty + storage + paid + as_credit) + every Sell's near = near_in + every bounty Refund's
  (near − storage)`
- `credit_pool + every Tide's credit_paid = credit_in`
- `credit_won = every Tide's credit_paid + near_as_credit`, and every bounty was paid in NEAR, as credit or refunded
- `slides`, `slides_burned` and `royalties` match the `Slide` entries and the licences, `nft_total_supply` matches
  `slides`, and `burned` is every planting's burn plus every slide plus every `Burn` entry
- the colonies' numbers add up to `unclaimed`, `credit_won` and `tides_owed`
- from the ledger alone: `credit_given` is every `Sponsor`'s amount, `credit_reclaimed` every `Unsponsor`'s,
  `credit_spent` every `spent`; `tides_owed` is every Tide's `paid` less every Claim's `near`; `pending` is every
  `Pending` and every non-bounty Refund's (near − storage), less every `Unpend`
- the credit the accounts hold (won plus grants) is `credit_given + credit_won + credit_sold − credit_spent −
  credit_reclaimed`
- `solvency().solvent`

## The ledger and the replay

One ordered ledger holds everything that changes the dish, the agar, the vault, the credit pool, the credit the
accounts hold, the NEAR owed to colonies or the pending NEAR:

- `Join { generation, colony }`
- `Buy { generation, colony, petri, near, credit, spent }` — `near` reached the vault and `credit` the credit pool;
  `spent` is the credit the call took (PETRI amounts in entries are `u64`: `petri` and `cost` of Buy, Plant, Sell,
  Slide and Claim, Burn's `petri` and Licence's `royalty`; JSON still writes them as strings)
- `Plant { generation, colony, cells, cost, near, credit, siege, spent, licence }` — likewise, after the planting's
  storage; `licence` is `{token, moves, holder, royalty, to_agar}` for a planting under a slide's licence (`to_agar`: the
  royalty went to the agar, because the planter had never attached NEAR), and `cost` is then the discounted price
- `Sell { generation, colony, petri, near, paid, as_credit }` — `near` left the vault, `paid` reached the seller, as
  credit if `as_credit`
- `Slide { generation, colony, token, x, y, w, h, cells, bitmap, cost, spent }` — `cost` PETRI was burned
- `Tide { generation, chain, bytes, by }` — everything else about the tide is worked out by the replay
- `Skip { generation, skipped }` — the clock skipped `skipped` generations here
- `Refund { generation, colony, kind, of, near, storage }` — the payout of entry `of` failed: a bounty went back to
  the vault, anything else became pending NEAR; the replays check that `near` is what that entry sent, once
- `Sponsor { generation, account, sponsor, amount }` and `Unsponsor { generation, account, sponsor, amount }`
- `Claim { generation, colony, petri, near, paid }`
- `Pending { generation, account, near }` and `Unpend { generation, account, near, paid }` — NEAR became pending, or
  left it (sent to the account, or spent on its order)
- `Dust { generation, near }` — wNEAR too small for a pending record went into the vault
- `Burn { generation, account, petri }` — PETRI burned outside the dish (a forced unregistration, or a transfer's
  refund to a sender that had unregistered)
- `PactOffer { generation, pact, from, to, petri, until, spent }`, `PactAccept { generation, pact }` and
  `PactEnd { generation, pact }` — a pact was offered (its PETRI held by the dish; `spent` is the credit the offer took),
  accepted (the PETRI paid to the promisor) or ended (an unaccepted offer's PETRI back to the payer, or a pact whose
  `until` came)

The `Tide` entries are the checkpoints: `checkpoints()` returns generation 0 and the chain stored in every tide. They no
longer carry the tide's amounts; those are worked out by the replay and logged in the `tide` event.

Replaying from an empty board, a zero chain, a full agar, an empty vault and an empty credit pool, applying each
generation's entries in order and stepping with `petri-core` in between, reproduces the board, the chain, the agar, the
vault, the credit pool, every solvency term and every colony's PETRI earnings, NEAR winnings and credit winnings. The
replay works out every tide's amounts itself. `node scripts/verify.mjs` (`--network mainnet` for the mainnet dish) does it from a terminal with every read pinned to
one final block and prints 45 checks: history chain, board hash, living cells, every planting legal with its siege
flag, every planting's price, every planting's fee, every licensed planting (the slide's shape and its 12-cell minimum, its price, and the
royalty to the holder of the day, or to the agar for a planter that had never attached NEAR), every purchase on the curve, every sale on the curve and within the allowance,
every tide (run exactly when due, its chain, its `bytes` (130 or 175), and the shares, bounty, storage and credit it works out
itself, no bounty for a tide the house ran), every claim
taking exactly what was owed, every refund tied to its payout, every specimen slide, every slide's holder, moves and
royalties, the agar, PETRI sold, burned, burned by slides, royalties, returned and bought back, the keeper share, every
colony's earnings, the vault, NEAR paid in, NEAR paid at tides, vault shares and bounties paid as credit, sales paid as
credit, every colony's NEAR winnings, the credit pool, credit paid at tides, credit sponsored, spent and taken back, NEAR
owed to colonies, pending NEAR, every colony's credit winnings, every colony's kept PETRI, the sales for NEAR and pact payments by colonies holding
none, the pacts kept to the rules and the plantings under them, the PETRI held for pact offers and the number of pacts,
solvency from the ledger, the deployed code hash, and no full-access key. It exits 0 when all match, 1 on any mismatch and 2 if the dish cannot be read. The site's `/verify`
runs the same replay in the browser, also pinned to one block, and lists 37 checks (the code hash is not among them).
`node scripts/verify.mjs --dump <file>` replays a snapshot the contract's replay test writes with `PETRI_DUMP`. The
contract test
`replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault` does it in Rust.

## The lock

Both dishes run one build of v6.1 (603,052 bytes, near-sdk 5.29.1), made with `cargo near build reproducible-wasm` at
commit `4858ca09b809be6a8af9254a2c9260c48fd60bf8` in `sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb`
(pinned in `contract/Cargo.toml`). Its NEP-330 `contract_source_metadata` links that commit, so anyone can rebuild it
and compare the hash with the account's code hash, `8QAsfDHePT3TdZ6LvJRV9pcNHfHJemgFbiBBaZK6ZPwR` (hex
`6df154bd52b56999299185743e7011e0cec690dacdba1d3e8be2a15c49a2bd7c`). At the time of writing each account still has one
full-access key, so whoever holds it could deploy different code. The team intends to delete them before judging, after
which the code can never change and `relaunch` can never run:

```
near account delete-keys petri-dish.near public-keys ed25519:FKXWETuBdQcWASjXGsVPHMpug6L9b7ES3LDagVYoNPMH network-config mainnet sign-with-legacy-keychain send
near account delete-keys petri-v6.testnet public-keys ed25519:8kGYoPJ6jVEZRrjjYKGVLfXD7LCyTDDqu41Cxx9UjHUu network-config testnet sign-with-legacy-keychain send
```

Until then, "no full-access key" is the one failing check on `/verify`, and `scripts/verify.mjs` prints 44 matches and
"Full-access keys 1 (expected: 0)" and exits 1. Anyone can list the keys:

```
curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"petri-dish.near"}}'
```

## History chain

`board hash = sha256(width u16 || height u16 || for each live cell in index order: index u32 || owner u16)`, little-endian.
At every generation that is a multiple of 16: `chain = sha256(previous chain || generation u64 || board hash)`, starting
from 32 zero bytes.

## The token

NEP-141 with NEP-148 metadata (name Petri, symbol PETRI, 6 decimals) and NEP-145 storage registration (125 bytes,
0.00125 NEAR). `ft_transfer` and `ft_transfer_call` need exactly 1 yoctoNEAR; the receiver must be registered; a
transfer to the contract is refused ("PETRI goes back to the agar only by planting or selling"); a house or keeper
account may send only to another house account (see The house); a colony that has never attached NEAR, or that holds
kept PETRI, cannot send PETRI at all (see Kept PETRI). If an `ft_transfer_call` refund comes back after its
sender unregistered, the refund is burned, as near-contract-standards does (a `Burn` entry). `storage_unregister(force:
true)` burns the balance and closes the registration, the `Burn` entry's storage coming out of the refund; without
`force` an account holding PETRI cannot unregister, and a colony's account cannot unregister at all, forced or not ("a
colony's account stays registered for as long as the dish lives: its colony is paid into it"). `ft_total_supply` is
`max_supply − burned` and includes the agar, unclaimed earnings, the keeper pot and the PETRI held for pact offers. The contract account cannot act as
a player ("the dish does not play on itself").

Events: NEP-141 `ft_mint` (once, at launch), `ft_transfer` and `ft_burn` (planting, slides, forced unregistration and a
refund to an unregistered sender); NEP-171 `nft_mint` and `nft_transfer`; and the dish's own (standard `petri`, version
6.1.0) `sponsor`, `unsponsor`, `join`, `rename`, `plant`, `sell`, `claim`, `payout`, `payout_failed`, `slide`, `tide`,
`pact`, `intents`, `claim_pending`, `skip`, `generation` and `relaunch`.

## Names and notes

Names are 1 to 24 characters of ASCII letters, digits, spaces and `- ' . & ! ? _ , : ( )`, unique ignoring case.
Names of the form "Culture <hex digits>" are kept for colonies someone else paid to start, and `join` and `rename`
refuse them (`names of the form "Culture <hex digits>" are kept for colonies someone else paid to start`). Notes
and slide titles refuse control, bidirectional, zero-width, invisible filler, variation-selector and tag characters.
Nothing can hide in either, and the strains' model never sees names: rivals reach it as numbers and sizes.

## Guests and the relayer

Free play only (testnet).

- `GET /api/guest` returns a challenge signed by the server, valid for 10 minutes. The browser makes a key and finds a
  nonce so that `sha256("petri-guest:" + challenge + ":" + publicKey + ":" + nonce)` starts with 18 zero bits.
- `POST /api/guest` checks the signature, age and proof of work, derives the account name from the key
  (`g-<10 hex of sha256(key)>.<relayer>`, so one key makes one guest), creates the account with 0.003 NEAR and a
  function-call key for the dish only (`join`, `buy`, `plant`, `sell`, `claim`, `advance`, `mint_slide`,
  `settle_pending`, `pact_offer`, `pact_accept`, `pact_cancel`; such a key
  cannot attach or transfer NEAR; guests made before the pact methods existed hold keys without the last three), and calls `sponsor` with 0.05 NEAR. It is also rate-limited: 4 guests per IP
  address and 120 in all per hour, per server instance.
- `/api/relay` relays a guest's signed NEP-366 delegate action only if it is from a guest account, to the dish, one of
  those methods, with no deposit and at most 300 TGas, not expired, with a valid signature for the action, and with a
  key that exists on the account and a fresh nonce. The relayer pays only gas.
- A guest never attaches NEAR, so everything it wins or is paid for sales is credit, and it cannot send PETRI.
- Wallet players connect with NEAR Connect (`@hot-labs/near-connect`) and sign and pay for themselves.

## The strains

Code reads the dish with the same WebAssembly engine, lists up to six legal plantings outside every rival's buffer that
suit the strain's temperament (at least one of them an ambitious play when one is affordable), runs each 240
generations ahead on a copy of the dish (`agents/forecast.mjs`), and asks a language model to pick one and write the
lab note, naming rivals only by number and size (`agents/model.mjs`). Each strain remembers its last moves, what it
expected of them and what the dish later showed (`agents/memory.mjs`). Once per tide window the five strains meet at a
council (`agents/council.mjs`): each strain may offer one pact (to another strain, 1 to 30 PETRI), and the other strain's
model accepts or declines. An accepted deal is made on chain: the payer calls `pact_offer` (300 TGas; the offer's storage
as credit on testnet, attached NEAR on mainnet) and the promisor `pact_accept` with the number the contract returned; if
the accept fails the offer is withdrawn with `pact_cancel`. From then until `until` the contract itself refuses the
promisor's plantings within `pact_radius` of the payer's living cells (see Pacts), and the agents drop such candidates
before the model sees them (`Engine.pact_breach`, from `pacts_of`). A pact lasts a tide window, or the slowest strain's
planting gap on mainnet, capped at `pact_max_gens`. Raids aimed at the payer from beyond the radius are not forbidden
by the contract; the agents still score each pair's faith kept or broken and show it to the next council. Petri is integrated with both Claude Haiku (`claude-haiku-5-5`, asked first,
within a fixed dollar budget) and NEAR AI Cloud (`z-ai/glm-5.3-flash`, its answers signed inside a TEE), which takes over
when Claude does not answer and NEAR AI has credits. If no model answers, the strain takes its first candidate. The
public log records which model, or the rules, decided each move.

## How the parameters were chosen

`sim/src/main.rs` plays the real `petri-core` rules, read from `contract/launch-rules.json`, on a 128 × 128 dish for 7
and 30 days with 15, 150 and 1,500 scripted players, relayer guests and the five house strains, and accounts in NEAR.
Cash is NEAR actually withdrawn (tide claims, sell-backs, bounties, credit taken back) minus NEAR actually paid (attached
NEAR, NEAR spent sponsoring, estimated gas). The tables below are from `sim/out-v5/summary.txt` and
`sim/out-v5/fixes.txt`; `sim/out-v6.1/summary.txt` and `sim/out-v6.1/fixes.txt` re-run v6.1's rules and measure
v6.1 against v6 on the same seeds, and attack the kept rule and the pacts (see Gas at scale, Kept PETRI, Pacts and
Known limits).

The published runs are of v5's rules and predate three changes launched with v5: they paid 10% tides (now 5%), paid
guests' tide shares, sales and bounties in NEAR their accounts could not move (now credit), and ran tides with nobody to
pay (now skipped). They also predate v6 and v6.1: in them the keeper could take the pot, slides were not licences, a
licence needed no minimum size, and a guest's royalty reached the holder. The fix table re-runs one change at a time,
including 5% tides.

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
| Team keeper registered (v5; a v6 keeper takes no pot) | −0.173 / −0.109 | +0.110 / −0.036 | −1.784 / −0.997 | −1.266 / −1.155 | −0.455 / +0.590 | −0.046 / −0.019 | 5.7% / 1.4% |
| Stake keeps 80% at each tide | −0.174 / −0.109 | +0.115 / −0.038 | −1.870 / −0.997 | −1.328 / −1.082 | −0.515 / +0.638 | −0.053 / −0.061 | 5.5% / 1.4% |
| Reach 4 | −0.180 / −0.110 | +0.111 / −0.037 | −2.063 / −0.988 | −1.395 / −1.102 | −0.444 / +0.703 | −0.054 / −0.060 | 5.3% / 1.4% |
| Siege ×2 | −0.176 / −0.119 | +0.133 / −0.044 | −2.106 / −0.976 | −1.394 / −1.152 | −0.586 / +0.613 | −0.053 / −0.060 | 5.8% / 1.4% |
| Sell-back at 30% | −0.179 / −0.099 | +0.129 / −0.050 | −2.101 / −1.175 | −1.329 / −1.065 | −0.496 / +0.389 | −0.052 / −0.046 | 4.8% / 1.2% |

No run has both launched changes at once.

**Gas at scale.** In v5's simulator, with tide winnings in packed arrays, the biggest tide call in a day of 1,500
players was about 11 TGas (about 104 TGas with per-record writes); but those arrays covered every colony that ever
joined, so every join rewrote them all. v6 split the books into cold pages and a hot table, but the table held every
colony with stake, and stake lingers about a day after a colony's last planting: on a busy dish of 30,000 colonies it
held up to 27,500 rows and the simulator's largest call (a plant) cost 237 TGas. v6.1 keeps in it only the colonies that
play now (see Time and catch-up). In the simulator, with 30,000 colonies for 2 days, hot rows averaged 1,336 (was
17,102) and peaked at 2,390 (was 27,538), and the largest call per kind, 30 TGas payout reservations included, was
join 61, plant 60, buy 55, claim 52, sell 54 and advance 23 TGas (v6: plant 237, join 222, buy 234, claim 233, sell
147, advance 206); no call passed 150 TGas or its prepaid gas (v6: 116,731 and 16,102 calls did). The analytic worst
case, 10,000 rows (the cap) all paid at a tide, is 120 TGas for the tide call, 105 for a claim with NEAR and 77 for a
plant, and a catch-up still steps all 120 generations.

The contract's own tests run 30,000 colonies that all have stake:
`thirty_thousand_colonies_with_stake_every_call_under_150_tgas_on_the_real_network` (1,500 playing) and
`a_full_hot_table_keeps_every_call_under_150_tgas_on_the_real_network` (9,999 playing, a full table). They scale the unit
runtime's host calls by the real price per rewritten byte (×1.83, measured in the test) and add an estimate of the wasm,
which the unit runtime does not charge, and assert that every call stays under 150 TGas. With 1,500 playing the largest
call is 67.5 TGas (an advance through a paying tide; a plant is 20.4, a claim with NEAR 47.7); with 9,999 playing, 125.7
(advance through a tide; claim with NEAR 115.6, plant 88.3). The test
`a_tide_with_fifteen_hundred_winners_stays_well_under_the_gas_limit` asserts that a generation and a tide with 1,500
winners cost under 20 TGas of host calls, and under 60 with the bounty payout.

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
- **Large licensed patterns earn royalties, by design.** `licence_min_cells` 12 stops the small common patterns, but
  whoever mints the first slide of a large pattern others plant (the pulsar, 48 cells; the Gosper gun, 36) collects
  10% of every licensed planting of it: in the v6.1 simulator a pulsar farmer nets +0.11 NEAR (+0.08 to +0.15) a week
  at 150 players, from 3,171 PETRI of royalties on 466 whale plantings (v6 +0.29). Only planters that choose the
  licence pay it (`slide` is optional, and the royalty is PETRI from their own balance), and they still come out
  ahead: whales −1.97 with the farmer, −2.01 with no farmer, −2.05 with no licence at all, −1.82 with royalty 0. The
  house never pays and a guest's royalty goes to the agar. The vault pays the farmer only through capped half-price
  sell-backs, like any holder, and its totals hardly move with the royalty (sales 10.23 NEAR with the farmer against
  10.16 with royalty 0; tide shares 29.30 against 29.09). `licence_min_cells` stays 12; 49, or `slide_royalty_bps` 0,
  would make the farmer lose about 0.16 NEAR.
- **A full hot table makes newcomers wait.** At most 10,000 colonies can play at once; past that, a colony with no row
  cannot plant until the next tide. The simulator's busiest dish (30,000 colonies) never passed 2,390 rows. Filling
  the table would take about 10,000 earning plantings an hour, roughly 50 NEAR an hour; before the cap, about 35,000 of
  them would have halted the dish for good.
- **The house is a subsidy.** The strains cost the team about 1.1 NEAR each per simulated week, paid to the other
  players. They are run by the team and are not independent players.
- **Former guests plant before they sell.** PETRI earned before a colony's first NEAR, and PETRI bought with credit, must
  be planted (kept PETRI is spent first) before the colony can sell any PETRI for NEAR or send any. That is the price of
  free play never reaching NEAR.
- **A pact covers a radius, not a promise of peace.** The contract refuses plantings within 8 cells of the payer's living
  cells; it cannot stop a raid aimed from farther away, and it cannot make anyone pay for a pact. In the simulator a
  builder paying 2 PETRI a tide window for one lost 0.035 NEAR a week (−0.2223 against −0.1865 at 150 players): pacts pay
  only against a real threat.
- **Races.** The keeper pot goes to the account whose call runs a generation, and the tide bounty to the account whose
  call runs the tide, unless that is one of the dish's own accounts. In v5's simulator a racer (which only advances)
  lost 0.05 to 0.06 NEAR a week after estimated gas; in v6.1's, with the pot spread over every call that runs a
  generation, 0.0055.
- **Somebody has to advance.** Each call catches up at most 120 generations; plantings wait until the dish is current. A
  dish left alone for more than 480 generations skips the quiet stretch, and nothing is fed for the skipped
  generations.
- **The strains need a model to answer.** Claude Haiku within a fixed budget, NEAR AI Cloud when it has credits;
  without either they play by written rules, and each move in the public log says which decided it.
- **Guest limits are per server instance.** The relayer's rate limits live in memory, so several instances each keep
  their own; the on-chain checks (zero deposit, function-call keys, credit) are what protect the relayer's NEAR.
- **Rounding.** Integer division leaves small remainders of each feed in the agar and of each tide in the vault and the
  credit pool.
