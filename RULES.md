# Petri rules

Petri is Conway's Game of Life on a shared dish run by a NEAR smart contract, with colony ownership and a token,
PETRI. Colonies buy PETRI from the dish with NEAR, spend it to plant cells, and are fed PETRI for the cells that stay
alive. Every hour a tenth of the NEAR in the tide vault is paid back out, split by what each colony earned that hour.
This file describes what the contract enforces.

The code is the source of truth. The rules of a generation, the feed, the reach cap, the planting price, the purchase
and sell-back curves and the tide split live in `core/src/lib.rs` (the `petri-core` crate). The clock, the ledger, the
vault, sponsored credit and the token live in `contract/src/lib.rs` and `contract/src/token.rs`. The same `petri-core`
crate runs in the contract, in the browser (compiled to WebAssembly) and in the economy simulator (`sim/src/main.rs`),
so the three cannot disagree. The contract has 30 tests (`contract/src/tests.rs`) and the core 24 (`core/src/tests.rs`).

Every parameter is set once, when the contract is initialised, and can be read with the `rules` view. The contract has
no method that changes a parameter, mints PETRI after launch, or edits the board.

## Launch parameters

These are the values the live dish, `petri-v4.testnet`, returns from `rules`. PETRI has 6 decimals, so the contract
stores 1 PETRI as `1000000` units. NEAR amounts are in yoctoNEAR (10^24 per NEAR).

| Field | Value | Meaning |
| --- | --- | --- |
| `width` × `height` | 128 × 128 | Cells on the dish. The edges wrap. |
| `generation_ms` | 15000 | One generation every 15 seconds (5,760 a day). |
| `max_supply` | 1,000,000 PETRI | Every PETRI that will ever exist. All of it is minted at launch into the agar. |
| `feed_ppm` | 10 | The agar's ration each generation: 10 parts per million of itself. |
| `keeper_bps` | 200 | 2% of each generation's feed goes to the keeper pot. |
| `reach` | 4 | A colony is paid for at most 4 living cells per cell it has ever planted. |
| `burn_bps` | 5000 | 50% of a planting's cost is burned; the rest goes back to the agar. |
| `payback` | 480 | A cell costs what an average cell earns in 480 generations (2 hours) at today's feed. |
| `min_cell_price` | 0.5 PETRI | The lowest price of one cell. |
| `live_floor` | 1000 | The agar releases its full ration only for at least 1,000 counted cells, and prices count at least 1,000. |
| `petri_price` | 0.0002 NEAR | Launch price of one PETRI. The agar sells at `petri_price × max_supply / agar`. |
| `min_join` | 0.01 NEAR | The least NEAR a colony joins with. |
| `cell_fee` | 0.0001 NEAR | NEAR per planted cell, on top of the planting's storage, to the tide vault. |
| `tide_every` | 240 | Generations between tides (one hour). |
| `tide_bps` | 1000 | 10% of the tide vault is paid out at each tide. |
| `tide_bounty_bps` | 100 | 1% of each tide goes to the caller whose transaction runs it... |
| `max_bounty` | 0.001 NEAR | ...but never more than 0.001 NEAR. |
| `sell_bps` | 5000 | The agar buys PETRI back at 50% of the curve's price. |
| `sell_cap_bps` | 1000 | Between two tides the agar spends at most 10% of the vault on buy-backs. |
| `siege_x` | 3 | A planting inside a rival's buffer costs 3 times the price. |
| `buffer` | 3 | The buffer: cells within 3 (a 7 × 7 square) of a rival's live cell. |
| `max_plant_cells` | 64 | Most cells in one planting. |
| `max_catchup` | 120 | Most generations one call will advance. |
| `house` | 5 accounts | The dish's own players: `petri-violet`, `petri-safranin`, `petri-methylene`, `petri-malachite`, `petri-congo` (`.testnet`). Never fed, no tide share. |

Fixed in code rather than in `rules`: a colony name is 1 to 24 ASCII characters; a lab note is at most 140 characters
and 280 bytes; the history chain advances every 16 generations (`CHAIN_EVERY`); a catch-up stops once its call has used
180 TGas (`CATCHUP_GAS_LIMIT`).

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

Generation `g` is due once `(block time − epoch) / generation_ms ≥ g`, where `epoch` is the block time of `new`.

The contract stores the board at the last generation someone advanced to. `join`, `buy`, `sell`, `plant`, `claim` and
`advance` each first step the stored board through the due generations, up to `max_catchup` (120) per call, and stop
early once the call has used 180 TGas, so no backlog can push a call past NEAR's gas limit. Each generation runs Life,
folds the history chain when due, adds the feed to unclaimed earnings, the tide window and the keeper pot, and runs a
tide when the generation is a multiple of `tide_every`. A catch-up reads and writes one record of each kind however many
colonies are alive, and logs one `generation` event.

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

- **Joining.** `join(name, color, credit?)` must bring at least `min_join` (0.01 NEAR), attached or from sponsored
  credit. The contract keeps the colony's storage (plus 110 bytes for its purchase entry) and spends the rest on PETRI.
- **Buying.** `buy(credit?)` spends what it brings, less 110 bytes for the purchase record, on PETRI.
- **Selling back.** `sell(petri)` returns PETRI to the agar for NEAR from the vault: half the curve's price, never more
  than the units' pro-rata share of the vault. The sale's record storage comes out of that NEAR and the rest is sent to
  the seller. Between two tides the agar pays out at most `sell_cap_bps` (10%) of the vault as it stood at the last tide,
  first come first served; before the first tide it buys nothing back. A round trip through the agar always loses (core
  test `selling_back_always_loses_against_buying`).
- NEAR spent on PETRI goes to the tide vault. The `buy_quote(near)` and `sell_quote(petri)` views give prices now.

## Sponsored credit

`sponsor(account_id)` is payable and open to anyone. The contract keeps the attached NEAR, less the record's storage, as
credit for that account. Credit can be spent only by passing `credit` to `join`, `buy` or `plant`, and can never be
withdrawn. The site's relayer sponsors each guest with 0.05 NEAR, so it never attaches NEAR to the calls it relays.
`credit_of(account_id)` shows an account's credit; `state` shows `credit_given` and `credit_spent`.

## Planting

`plant(cells, note?, credit?)` brings cells to life for the caller's colony. `cells` are flat indices `y × width + x`.

### The price

```
counted        = sum over fed colonies of min(living cells, reach × cells planted)   (the last feed's weight)
feed per cell  = (agar × feed_ppm / 1,000,000) × (1 − keeper_bps / 10,000) / max(counted, live_floor)
price of a cell = max(feed per cell × payback, min_cell_price)
cost           = price of a cell × cells × (siege_x if any planted cell is inside a rival's buffer, else 1)
```

in PETRI units with integer division at every step (`feed_per_cell`, `plant_price`, `planting_cost`), after the
planting's own catch-up. `state().counted` is the cell count the price uses. Before checking the price, `plant` claims
the colony's waiting earnings into its balance. Half of the cost is burned and half returns to the agar.

### Sieges

A planting with any cell whose 7 × 7 neighbourhood (across the wrapped edges) holds another colony's live cell is a
siege. It is legal and costs `siege_x` (3) times the price; the ledger entry is marked `siege: true`. No ground is ever
closed: a newcomer can always plant somewhere, at worst at three times the price.

### The deposit

A planting brings NEAR, attached or from credit: the storage it uses plus `cell_fee` per cell. `plant_deposit(cells,
note_bytes?)` returns `(200 + 4 × cells + (note_bytes + 64, if there is a note)) × storage byte price + cell_fee × cells`.
The contract measures the storage the planting actually used, keeps that, and puts the rest into the tide vault.

### Checks

In this order, with the quoted message:

| Check | Refusal |
| --- | --- |
| The note has no control, bidirectional, zero-width, invisible, variation-selector or tag characters. | "a lab note may not contain control, direction, invisible or tag characters" |
| The note, trimmed, is at most 140 characters and 280 bytes. | "a lab note is at most 140 characters" |
| The caller has joined. | "join the dish first" |
| The account has the credit it asks to spend. | "this account has X NEAR of sponsored credit" |
| After catching up, the dish is at the due generation. | "the dish is behind the clock; call advance first" |
| The colony has not planted in this generation. | "one planting per generation; wait for the next one" |
| At least one cell, at most 64. | "plant at least one cell" / "at most 64 cells per planting" |
| Every index is on the dish, none twice, every target empty. | "cell N is off the dish" / "cell (x, y) is listed twice" / "cell (x, y) is already alive" |
| At least `cell_fee × cells` is brought. | "planting N cells needs at least X NEAR" |
| The colony holds the cost, siege included. | "planting N cells [inside a rival's buffer] costs X PETRI; you hold Y" |
| What was brought covers the storage used plus the fee. | "this planting needs X NEAR for its storage and fee" |

A refused call changes nothing; attached NEAR is refunded and credit is not spent.

## The feed and the reach

In each generation, after the step:

```
weight   = min(colony's living cells, reach × cells it ever planted)   (0 for house colonies)
counted  = sum of weights
ration   = agar × feed_ppm / 1,000,000
released = ration × min(counted, live_floor) / live_floor
keeper   = released × keeper_bps / 10,000
share    = (released − keeper) × weight / counted
```

(`feed_weight` and `feed` in `petri-core`). With fewer than `live_floor` counted cells the agar releases only that
fraction of its ration and keeps the rest, so a lone 4-cell block earns 4/1,000 of the ration, which is exactly what its
price assumes. A dish where no fed colony is alive is fed nothing. The cap grows only with cells a colony paid for, so
splitting into many colonies never earns more: the weights of the parts sum to at most the weight of the whole (property
test `splitting_never_earns_more`). Rounding remainders stay in the agar.

## The keeper pot

Each generation's keeper cut collects in one pot. `advance(max?)` pays the whole pot to its caller only if that call ran
at least one generation and the caller is registered to hold PETRI. The project's keeper (`petri-keeper.testnet`, with
a function-call key for the dish) advances when the board is 20 generations behind or the pot holds more than 5 PETRI.

## Claiming

Feed earnings accrue in one record and NEAR winnings in another. `claim()` moves the colony's PETRI earnings into its
balance and sends its NEAR winnings. Every NEAR payout (claims and sales) has a callback, `on_payout`: if the transfer
fails, the NEAR is owed to the colony again and can be claimed later (event `payout_failed`). `claimable(account_id)`
shows what is waiting. Nothing expires.

## NEAR and the tides

The tide vault receives what joins and purchases spend on PETRI and what plantings bring above their storage. It pays
out tides, tide bounties, tide-entry storage and sell-backs (with their record storage). Nothing else goes in or out.

At every generation that is a multiple of `tide_every`:

```
pay     = vault × tide_bps / 10,000                     (10%)
bounty  = min(pay × tide_bounty_bps / 10,000, max_bounty)   to the account whose call ran the tide
storage = the Tide ledger entry's storage
share   = (pay − bounty − storage) × window / sum of windows
```

A colony's window is the PETRI it was fed since the previous tide, so a colony planted just before a tide gets only
those few generations' worth, and house colonies have no window. Windows reset at every tide, and the buy-back
allowance is set to `sell_cap_bps` of the vault. If no colony earned anything, no bounty is paid and only the entry's
storage leaves the vault (the contract pays it when the vault is empty). Rounding and the other 90% stay in the vault.

## The house

The accounts in `rules.house` (the five AI strains, run by the team) play like anyone: they join, buy PETRI with NEAR
and plant. They are never fed and take no tide share, so every PETRI they plant with is bought, and that NEAR goes to
the other players. Their strategy code never lays siege.

## Conservation

The contract tests assert after every scenario (`conserved`):

- `total_supply = max_supply − burned`
- `every balance + agar + unclaimed + keeper_pot = total_supply`
- `agar = max_supply − sold − fed + returned + bought_back`
- `vault + every Tide's (bounty + storage + paid) + every Sell's near = near_in`

## The ledger and the replay

One ordered ledger holds everything that changes the dish, the agar or the vault:

- `Join { generation, colony }`
- `Buy { generation, colony, petri, near }` — `near` is what reached the vault
- `Plant { generation, colony, cells, cost, near, siege }` — `near` is what reached the vault
- `Sell { generation, colony, petri, near, paid }` — `near` left the vault, `paid` reached the seller
- `Tide { generation, chain, pay, bounty, storage, paid }`

The `Tide` entries are the checkpoints: `checkpoints()` returns generation 0 and the chain stored in every tide.

Replaying from an empty board, a zero chain, a full agar and an empty vault, applying each generation's entries in
order and stepping with `petri-core` in between, reproduces the board, the chain, the agar, the vault and every
colony's PETRI earnings and NEAR winnings. `node scripts/verify.mjs` does it from a terminal with every read pinned to
one final block and prints 21 checks: history chain, board hash, living cells, every planting legal with its siege
flag, every planting's price, every purchase and every sale on the curve, every tide, the agar, PETRI sold, burned,
returned and bought back, the keeper share, every colony's earnings, the vault, NEAR paid in, NEAR paid at tides, every
colony's winnings, the deployed code hash, and no full-access key. The site's `/verify` runs the same replay in the
browser, also pinned to one block, with the same checks except the code hash (20). The contract test
`replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault` does it in Rust.

## The lock

The contract is built with `cargo near build reproducible-wasm` (image and digest in `contract/Cargo.toml`); its NEP-330
`contract_source_metadata` links the GitHub commit, so anyone can rebuild it and compare the hash with the account's
code hash (`7GNyLTrzbFSmSxVp92Ne7bVXaKpUtxPsMYGqtx9ULuaS`). The account still has one full-access key. The team will delete it before judging, after
which the code can never change:

```
near account delete-keys petri-v4.testnet public-keys ed25519:CDu2wUQhzNN3JKwHcduXqjS5TLSM78WVhowgPByum4LE network-config testnet sign-with-legacy-keychain send
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
itself"). Events: NEP-141 `ft_mint`, `ft_transfer`, `ft_burn`, and the dish's own `sponsor`, `join`, `plant`, `sell`,
`claim`, `payout_failed` and `generation`.

## Names and notes

Names are 1 to 24 characters of ASCII letters, digits, spaces and `- ' . & ! ? _ , : ( )`, unique ignoring case. Notes
refuse control, bidirectional, zero-width, invisible filler, variation-selector and tag characters. Nothing can hide in
either, and the strains' model never sees names: rivals reach it as numbers and sizes.

## Guests and the relayer

- `GET /api/guest` returns a challenge signed by the server, valid for 10 minutes. The browser makes a key and finds a
  nonce so that `sha256("petri-guest:" + challenge + ":" + publicKey + ":" + nonce)` starts with 18 zero bits.
- `POST /api/guest` checks the signature, age and proof of work, derives the account name from the key
  (`g-<10 hex of sha256(key)>.<relayer>`, so one key makes one guest), creates the account with 0.003 NEAR and a
  function-call key for the dish only (`join`, `buy`, `plant`, `sell`, `claim`, `advance`; such a key cannot attach or
  transfer NEAR), and calls `sponsor` with 0.05 NEAR. It is also rate-limited: 4 guests per IP address and 120 in all
  per hour, per server instance.
- `/api/relay` relays a guest's signed NEP-366 delegate action only if it is from a guest account, to the dish, one of
  those methods, with no deposit and at most 250 TGas, not expired, with a valid signature for the action, and with a
  key that exists on the account and a fresh nonce. The relayer pays only gas.
- Wallet players connect with NEAR Connect (`@hot-labs/near-connect`) and sign and pay for themselves.

## How the parameters were chosen

`sim/src/main.rs` plays the real `petri-core` rules on a 128 × 128 dish for 7 and 30 days with 15, 150 and 1,500
scripted players and the five house strains, and accounts in NEAR: net = tides + sales + PETRI still held valued at the
sell-back price − everything paid, gas excluded. Results are in `sim/out-v3/summary.txt` and `sim/out-v3/sweep.txt`.

Player kinds: builders, raiders (one move in three a siege), defenders, a methuselah (an R-pentomino an hour), late
joiners, a 2-NEAR whale, the same 2 NEAR split over 10 colonies (20 at 1,500 players), a sniper (plants only just before
tides), a carpet locker (256 blocks 8 cells apart at launch), a racer (only advances), a seller, and the house.

A sweep over reach 4/8/16 × siege 3/4/6 chose reach 4 and siege ×3: net results barely moved, reach 4 left at most 0.76%
of any kind's cell-generations unpaid, and a newcomer's siege block on day 7 costs 14.9 mNEAR at ×3, 18.7 at ×4 and 26.2
at ×6, against 7.4 mNEAR for a free block.

The main runs use reach 4 and siege ×3 but tides of 50%, a fed house and an uncapped bounty. Median net NEAR per player
after 7 days, with the range over seeds:

| Player | 15 players | 150 players | 1,500 players |
| --- | --- | --- | --- |
| Builder | −0.017 (−0.23 to +1.71) | −0.128 (−0.15 to −0.09) | −0.056 (−0.06 to −0.05) |
| Raider | −0.140 (−0.22 to +0.14) | −0.105 (−0.14 to −0.08) | −0.082 (−0.09 to −0.08) |
| Defender | −0.109 (−0.25 to +2.89) | −0.098 (−0.12 to −0.05) | −0.025 (−0.04 to −0.02) |
| Methuselah | +9.513 (+3.36 to +13.76) | +1.818 (+1.27 to +2.06) | +0.085 (+0.03 to +0.12) |
| Late | +0.280 (−0.19 to +1.97) | −0.166 (−0.20 to −0.13) | −0.072 (−0.08 to −0.06) |
| Whale | −1.112 (−2.74 to +3.68) | −1.148 (−1.47 to −0.87) | −0.610 (−0.73 to −0.52) |
| Split whale | +3.044 (−1.04 to +8.14) | −0.890 (−1.47 to −0.59) | −0.682 (−0.78 to −0.50) |
| Sniper | −0.058 (−0.21 to +0.06) | −0.022 (−0.06 to +0.12) | −0.018 (−0.04 to +0.01) |
| Locker | +1.665 (−0.73 to +2.36) | +3.563 (+2.86 to +4.28) | +11.123 (+8.88 to +12.71) |
| Racer | +0.341 (+0.31 to +0.54) | +0.459 (+0.44 to +0.50) | +1.030 (+0.96 to +1.07) |
| Seller | −0.104 | −0.104 | −0.096 |
| House strain | −0.820 (−0.92 to −0.69) | −0.965 (−0.98 to −0.94) | −0.991 (−0.99 to −0.99) |

The methuselah's gain is almost all PETRI at the sell-back price: its cash (NEAR actually back) is −0.010 at 15 players
and +0.302 at 150. Players end holding PETRI worth 22.0, 18.5 and 12.7 NEAR at the sell-back price against at most
0.06 NEAR in the vault.

The launched contract changed three of those rules. One at a time, median net NEAR:

| Rule (15 players / 150 players) | Builder | Methuselah | Whale | Split whale | Locker | Racer | Locker's share of tides |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline | −0.017 / −0.128 | +9.513 / +1.818 | −1.112 / −1.148 | +3.044 / −0.890 | +1.665 / +3.563 | +0.341 / +0.459 | 34.0% / 11.8% |
| Tides of 10% | −0.077 / −0.107 | +9.578 / +1.828 | −0.223 / −1.197 | +3.208 / −0.825 | +0.130 / −0.152 | +0.312 / +0.408 | 19.9% / 4.5% |
| House never fed | +0.103 / −0.127 | +7.825 / +1.736 | −0.427 / −1.225 | +3.090 / −0.785 | +1.441 / +3.672 | +0.356 / +0.463 | 34.6% / 12.3% |
| Bounty capped at 0.001 NEAR | +0.061 / −0.123 | +9.192 / +1.780 | +0.340 / −1.283 | +3.341 / −0.861 | +1.522 / +3.619 | +0.254 / +0.273 | 32.8% / 11.7% |
| All three, smaller ledger estimate | +0.078 / −0.006 | +2.976 / +1.023 | +0.890 / −0.728 | +0.580 / −0.206 | +0.856 / +0.137 | +0.475 / +0.345 | 20.0% / 6.2% |

No run has exactly the launched rules: the combined row also assumes plantings store about 20 bytes, where the contract
stores up to 200 + 4 per cell.

**Lockout.** With the locker and sieges allowed, a newcomer could plant a free 2 × 2 block in 1.7% of spots after an hour
(15 players; 3.4% at 150) and could always plant a siege block, for 12.6 mNEAR. With sieges forbidden (the v2 rule), 5
of 20 seeds at 15 players and 2 of 10 at 150 had no legal spot at all after an hour, and 2 of 20 still had none on day 7.

**No players, 30 days.** With only the five house strains and the house fed (the rule before the fix), the agar fell from
1,000,000 to 179,035 PETRI, 828,726 of it fed to the house. With the house never fed it stays at 994,026 PETRI and no
tide pays anyone. With nobody at all the contract pays 1.728 NEAR for 720 tide entries.

## Known limits

- **Testnet only.** The dish runs on NEAR testnet; its NEAR and PETRI have no market, and guests play with NEAR the site
  gives them.
- **The key is not deleted yet.** Until the full-access key is deleted, whoever holds it could deploy other code.
- **The methuselah edge.** The simulator's single R-pentomino planter ended +9.51 NEAR (median) at 15 players and +1.82
  at 150, far ahead of every other kind, mostly in PETRI held.
- **PETRI is paper until sold back, and the vault caps it.** Buy-backs pay half the curve's price, at most the units'
  share of the vault, at most 10% of the vault per tide. Simulated players ended holding PETRI worth 13 to 22 NEAR at
  that price against under 0.06 NEAR in the vault.
- **The carpet locker still earns.** Sieges keep the dish open, but the locker won NEAR at the tides in every society;
  with the three launched changes, +0.86 NEAR at 15 players and +0.14 at 150.
- **Early colonies have an edge.** The agar is fullest at the start and PETRI cheapest while it is full, so the first
  colonies are fed the most.
- **The simulator predates the floor-release rule.** The contract now releases only (counted / 1,000) of the ration on a
  sparse dish; the simulator released all of it, so it shows early colonies on a sparse dish earning more than they now
  would. It also estimates storage and gas rather than measuring them, and its players follow fixed habits.
- **Ordering within a generation.** Entries in the same generation apply in execution order; an earlier planting can
  take a cell a later one wanted, or turn it into a siege.
- **The house is a subsidy.** The strains cost the team 0.82 to 0.99 NEAR each per simulated week, paid to the other
  players. They are run by the team and are not independent players.
- **Races.** The keeper pot and the tide bounty go to whoever calls first. A simulated racer made +0.07 to +0.87 NEAR
  after estimated gas.
- **Somebody has to advance.** Each call catches up at most 120 generations; plantings wait until the dish is current.
- **The strains play by written rules for now.** The NEAR AI model currently answers 402 (credits pending); each move
  in the public log says whether the model or the rules decided it.
- **Guest limits are per server instance.** The relayer's rate limits live in memory, so several instances each keep
  their own; the on-chain checks (zero deposit, function-call keys, credit) are what protect the relayer's NEAR.
- **Rounding.** Integer division leaves small remainders of each feed in the agar and of each tide in the vault.
