# Petri rules

Petri is Conway's Game of Life on a shared dish run by a NEAR smart contract, with colony ownership and a token,
PETRI. Colonies buy PETRI from the dish with NEAR, spend it to plant cells, and are fed PETRI for every cell that stays
alive. The NEAR they pay in is paid back out, every hour, to whoever holds ground. This file describes what the contract
enforces.

The code is the source of truth. The rules of a generation, the feed, the cap, the planting price and the purchase
curve live in `core/src/lib.rs` (the `petri-core` crate). The clock, the ledger, the vault and the token live in
`contract/src/lib.rs` and `contract/src/token.rs`. The same `petri-core` crate runs in the contract, in the browser
(compiled to WebAssembly) and in the economy simulator (`sim/src/main.rs`), so the three cannot disagree. The contract
has 21 tests (`contract/src/tests.rs`) and the core 19 (`core/src/tests.rs`).

Every parameter is set once, when the contract is initialised, and can be read with the `rules` view. The contract has
no method that changes a parameter, mints PETRI after launch, or edits the board.

## Launch parameters

These are the values the live dish, `petri-v2.testnet`, returns from `rules`. PETRI has 6 decimals, so the contract
stores 1 PETRI as `1000000` units. NEAR amounts are in yoctoNEAR (10^24 per NEAR).

| Field | Value | Meaning |
| --- | --- | --- |
| `width` × `height` | 128 × 128 | Cells on the dish. The edges wrap. |
| `generation_ms` | 15000 | One generation every 15 seconds (5,760 a day). |
| `max_supply` | 1,000,000 PETRI | Every PETRI that will ever exist. All of it is minted at launch into the agar. |
| `feed_ppm` | 10 | Parts per million of the agar fed to the living each generation. |
| `keeper_bps` | 200 | 2% of each generation's feed goes to the keeper pot. |
| `cap_bps` | 1500 | No colony counts for more than 15% of all living cells in the feed and tide split. |
| `cap_min` | 64 | The cap is never below 64 cells. |
| `burn_bps` | 5000 | 50% of a planting's cost is burned; the rest goes back to the agar. |
| `payback` | 480 | A cell costs what an average cell earns in 480 generations at today's feed. |
| `min_cell_price` | 0.5 PETRI | The lowest price of one cell. |
| `live_floor` | 1000 | The price counts at least 1,000 living cells. |
| `petri_price` | 0.0002 NEAR | Launch price of one PETRI. The agar sells at `petri_price × max_supply / agar`. |
| `min_join` | 0.01 NEAR | The least NEAR a colony joins with. |
| `cell_fee` | 0.0001 NEAR | NEAR per planted cell, on top of the planting's storage. |
| `tide_every` | 240 | Generations between tides (one hour). |
| `tide_bps` | 5000 | Half of the tide vault is paid out at each tide. |
| `buffer` | 3 | No planted cell may be within 3 cells of a rival's live cell. |
| `max_plant_cells` | 64 | Most cells in one planting. |
| `max_catchup` | 120 | Most generations one call will advance. |

Fixed in code rather than in `rules`: a colony name is 1 to 24 characters and at most 48 bytes after trimming, a lab
note is at most 140 characters and 280 bytes, the history chain advances every 16 generations (`CHAIN_EVERY`), and a
checkpoint is stored every 240 generations (`CHECKPOINT_EVERY`).

## What changed after review

The first dish (v1) ran on a different contract. A review of it found five problems, and v2 is a new contract that
started again from an empty board at generation 0.

| Found in v1 | In v2 |
| --- | --- |
| Players were paid about 2.8 times the PETRI they spent. The cell price had no link to what a cell earned, and every new colony got PETRI free. | A cell costs `payback` (480) generations of an average cell's feed, the feed is 10 ppm instead of 20, and PETRI must be bought from the agar with NEAR. |
| A methuselah planter took 45% of the dish and 12.8 times its spend. | No colony counts for more than 15% of the living cells in the feed and the tides. In the simulator the same grower held 66% of the cells, took 23% of the earnings and earned 1.40 times its spend. |
| A free 64-PETRI grant per account could be farmed with many accounts. | No grant. Joining takes at least 0.01 NEAR and buys PETRI at the curve's price. In the simulator 30 one-shot accounts each paid 0.0254 NEAR and won back 0.0246. |
| The feed logged one event per recipient. With NEAR's 16 KB log limit per call, a catch-up would stop fitting at about 115 colonies and lock the dish. | Earnings accrue in one record and are claimed by each colony. A catch-up logs one summary event. The test `many_living_colonies_advance_with_one_summary_log` checks 25 colonies log at most 3 lines and under 1,500 bytes. |
| The contract account could mint PETRI by transferring to itself. | The contract refuses itself as the caller of `join`, `buy`, `plant`, `claim`, `advance`, `ft_transfer` and `ft_transfer_call` ("the dish does not play on itself"), refuses transfers to its own account, and `storage_deposit` will not register it. |

## The dish

- A grid of `width × height` cells whose edges wrap: the right edge touches the left and the top touches the bottom,
  so the dish is a torus with no walls.
- Every cell is either empty (`0`) or alive and owned by one colony (a colony id from 1 upwards).
- A colony is one NEAR account. It joins once, with a name and a colour (`0xRRGGBB`), and keeps its id for good. The
  contract allows up to 65,534 colonies.

## A generation

Every cell is updated at once from the board as it was at the end of the previous generation.

1. **Survival.** A live cell with 2 or 3 live neighbours (of the eight around it) stays alive and keeps its owner.
   Any other live cell dies.
2. **Birth.** An empty cell with exactly 3 live neighbours comes alive. Those three neighbours are its parents.
3. **Ownership.** The new cell joins the colony that owns at least two of its three parents.
4. **Contested ground.** If the three parents belong to three different colonies, no cell is born. The cell stays
   empty for that generation, and for as long as the same three-way standoff lasts.

Rules 1 and 2 are exactly Conway's Life (B3/S23), and the liveness of the dish never depends on owners except where
rule 4 removes a birth. When one colony owns everything, or when no birth ever has three distinct parents, the dish
plays exactly like Life; the property tests in `core/src/tests.rs` check this against a plain reference
implementation. Every known pattern works: still lifes, oscillators, gliders and guns.

A simple consequence of rule 4: an L of three cells owned by three different colonies never becomes a block. The
corner birth is contested every generation, and each of the three cells keeps exactly two neighbours, so the L stays
as it is.

## Time and catch-up

The dish is a pure function of its ledger and the clock. Generation `g` is due once
`(block time − epoch) / generation_ms ≥ g`, where `epoch` is the block time when the contract was initialised.

The contract does not run on its own. It stores the board at the last generation someone advanced to, and any
transaction that touches the dish first catches it up to the clock:

- `join`, `buy`, `plant`, `claim` and `advance` each step the stored board forward through every due generation, up
  to `max_catchup` (120) per call. `advance(max)` can ask for fewer.
- Each generation of a catch-up runs Life, folds the history chain when due, adds that generation's feed to the
  colonies' unclaimed earnings and the keeper pot, and pays a tide when the generation is a multiple of `tide_every`.
  It reads and writes one earnings record, however many colonies are alive, and the whole catch-up logs one
  `generation` event.
- `plant` requires the dish to be fully caught up after its own catch-up. If the dish is more than 120 generations
  behind, the planting is refused with "the dish is behind the clock; call advance first", and someone has to call
  `advance` until it is current.
- The keeper process (`agents/run.mjs`, account `petri-keeper.testnet`) registers itself with `storage_deposit` and
  calls `advance` whenever the stored board is 20 or more generations behind or the keeper pot holds more than
  5 PETRI.

Browsers do not wait for the stored board. The site loads it into the same `petri-core` engine compiled to
WebAssembly, steps it forward to the generation the clock says is due, and draws that. It also computes the feed each
colony is owed since the stored generation; the contract adds it to unclaimed earnings when the dish is next
advanced.

## The agar and buying PETRI

PETRI is the dish's nutrient. At launch all of `max_supply` (1,000,000 PETRI) is minted once into the contract's own
balance, called the agar. There is no other mint and no free grant. PETRI leaves the agar two ways (sold for NEAR, fed
to the living) and comes back one way (half of every planting).

The agar sells PETRI for NEAR along a curve that rises as it empties. With `k = petri_price × max_supply` (200 NEAR at
the launch values):

```
price of one PETRI = k / agar                         (0.0002 NEAR at launch; twice that with half the agar left)
PETRI bought       = agar × near / (k + near / 2)     (petri_for_near in petri-core)
```

The purchase is priced at the midpoint of the stretch of curve it moves along, and can never take more than the
agar. At launch 0.05 NEAR buys about 249.7 PETRI. Splitting a purchase into smaller ones does not buy more. The
`buy_quote(near)` view returns what an amount of NEAR would buy right now; `state().petri_price` is the current price
of one PETRI in yoctoNEAR.

- **Joining.** `join(name, color)` must attach at least `min_join` (0.01 NEAR). The contract measures the storage the
  new colony uses (plus 128 bytes for the purchase entry), keeps that, and spends the rest on PETRI from the agar.
- **Buying.** `buy()` spends all the attached NEAR on PETRI. Only colonies can buy, so every purchase is in the
  ledger.
- Every yoctoNEAR spent on PETRI goes to the tide vault. There is no sell-back: the agar never buys PETRI.

## Planting

`plant(cells, note)` brings cells to life for the caller's colony. `cells` are flat indices, `y × width + x`. Any set
of cells is allowed within the limits below; the site's stamps (block, glider, eater and so on) are only a
convenience.

### The price

```
feed per cell = (agar × feed_ppm / 1,000,000) × (1 − keeper_bps / 10,000) / max(total_live, live_floor)
price of a cell = max(feed per cell × payback, min_cell_price)
cost = price of a cell × cells
```

in PETRI units with integer division at every step (`feed_per_cell` and `plant_price` in `petri-core`), where `agar`
and `total_live` are taken after the planting's own catch-up. An average cell earns back its price in `payback`
(480) generations, two hours. The price counts at least 1,000 living cells, so it stays sane on a nearly empty dish,
and never falls below 0.5 PETRI a cell. It falls as the agar shrinks and as the dish fills past 1,000 cells.

Worked example from the live dish at generation 42, with 998,786.033441 PETRI in the agar and 142 cells alive:
the feed is 9.98786 PETRI, 9.788103 after the keeper's 2%; the price counts 1,000 cells, so the feed per cell is
0.009788 PETRI; times 480 gives 4.69824 PETRI a cell, which is what `state().cell_price` returned. A six-cell
beehive cost 28.18944 PETRI: 14.09472 burned and 14.09472 returned to the agar.

The `quote(cells)` view returns the price at the stored generation; the price a planting actually pays can differ if
the catch-up it triggers changes the agar or `total_live`. Before checking the price, `plant` claims the colony's
waiting earnings into its balance, so they count towards it.

### The deposit

A planting also attaches NEAR: the storage it uses plus `cell_fee` per cell. The `plant_deposit(cells, note_bytes)`
view returns

```
(260 + 6 × cells + (note_bytes + 64, if there is a note)) × storage byte price + cell_fee × cells
```

The contract measures the storage the planting actually used, keeps that, and puts everything attached above it into
the tide vault.

### Checks

The contract checks, in this order, and refuses with the quoted message:

| Check | Refusal |
| --- | --- |
| The note has no control, bidirectional or zero-width characters. | "a lab note may not contain control, direction or zero-width characters" |
| The note, after trimming, is at most 140 characters and 280 bytes. | "a lab note is at most 140 characters" |
| The caller has joined. | "join the dish first" |
| After catching up, the dish is at the due generation. | "the dish is behind the clock; call advance first" |
| The colony has not planted in this generation. | "one planting per generation; wait for the next one" |
| At least one cell. | "plant at least one cell" |
| At most `max_plant_cells` (64) cells. | "at most 64 cells per planting" |
| Every index is on the dish. | "cell N is off the dish" |
| No index is listed twice. | "cell (x, y) is listed twice" |
| Every target cell is empty. | "cell (x, y) is already alive" |
| No other colony's live cell lies within `buffer` (3) cells of any target cell, measured as the larger of the row and column distance, across the wrapped edges: a 7 × 7 square centred on each planted cell. The colony's own cells do not count. | "cell (x, y) is inside colony N's buffer; plant further away or send a glider" |
| At least `cell_fee × cells` is attached. | "planting N cells needs at least X NEAR attached" |
| The colony holds the price (after claiming its earnings). | "planting N cells costs X PETRI; you hold Y" |
| The attachment covers the storage used plus the fee. | "this planting needs X NEAR attached for its storage and fee" |

The buffer is checked only when planting. Nothing stops colonies from growing, flying or firing into each other
afterwards; that is how territory changes hands. A refused call changes nothing and its attached NEAR is returned.

### What gets stored

Of the cost, `burn_bps` (half) is burned and the rest goes back into the agar. The planted cells come alive at the
current generation, before the next step. The contract appends `Plant { generation, colony, cells, cost }` to the
ledger, stores the note (trimmed; an empty note is stored as none) under the ledger index, and emits a `plant` event.
Entries in the same generation are applied in the order the chain executes them.

## The feed and the cap

In each generation that ends with at least one live cell, the agar pays `feed = agar × feed_ppm / 1,000,000`,
computed on its balance at that moment, so the feed shrinks as the agar does. A dish with no live cells pays nothing.

- **Keeper pot.** `feed × keeper_bps / 10,000` (2%) goes to the keeper pot.
- **Colonies.** The rest is split in proportion to each colony's capped cell count (`feed_weights` and
  `split_by_weight` in `petri-core`):

  ```
  cap     = max(total_live × cap_bps / 10,000, cap_min)
  counted = min(colony's live cells, cap)
  share   = (feed − keeper cut) × counted / sum of counted
  ```

  What a colony over the cap is not paid for goes to everyone else. Small colonies are counted cell for cell, so
  splitting into many accounts gains nothing. Rounding remainders stay in the agar.
- **Example.** With 142 cells alive, 15% is 21 cells, so the cap is the floor of 64. A colony with 90 cells counts as
  64; one with 30 counts as 30.

At 10 ppm the agar pays out about 5.6% of its balance per day while anything is alive, before planting returns
anything (`1 − (1 − 0.00001)^5760`).

## The keeper pot

Every catch-up adds its keeper cut to one pot, whichever call ran it. Only `advance` pays the pot out, all of it, to
its caller, and only if the caller is registered to hold PETRI (a colony, or an account registered with
`storage_deposit`). An unregistered caller still moves the dish forward and leaves the pot.

## Claiming

Feed earnings accrue in one record (8 bytes per colony) and NEAR tide winnings in another (16 bytes per colony).
`claim()` catches the dish up, moves the colony's PETRI earnings into its balance and sends it the NEAR it has won at
the tides, and emits a `claim` event. Planting claims PETRI automatically. `claimable(account_id)` shows what is
waiting; `earnings(from, limit)` shows every colony's lifetime earnings, claimed or not. Nothing expires.

## NEAR and the tides

NEAR paid into the dish collects in the tide vault: every yoctoNEAR spent on PETRI (joins after storage, and every
`buy`) and whatever a planting attaches above its storage. Nothing else goes in and nothing else comes out.

At every generation that is a multiple of `tide_every` (240, one hour), if the vault holds anything:

```
pay   = vault × tide_bps / 10,000      (half the vault)
share = pay × counted / sum of counted  (the same capped counts as the feed, at that generation)
```

A colony with no living cells at the tide gets nothing. Rounding remainders and the other half stay in the vault.
Winnings wait in the colony's tide record until it calls `claim`.

The vault only ever holds what players paid in. The tides move NEAR from those who bought and planted to those who
hold ground at the tide generations. There is no outside yield, and as a group players get back less than they paid,
because the contract keeps the storage their colonies and plantings use and the vault always holds part back.

## Conservation

The `state` view exposes `total_supply`, `agar`, `sold`, `fed` (everything the agar has paid out, keeper cut
included), `returned`, `burned`, `keeper_pot`, `keeper_paid`, `vault`, `near_in`, `near_tides` and `tides`. The
contract tests assert after every scenario (`conserved` in `contract/src/tests.rs`) that:

- `total_supply = max_supply − burned`
- `every balance + agar + unclaimed earnings + keeper_pot = total_supply`
- `agar = max_supply − sold − fed + returned`

and the tide test asserts `vault + near_tides = near_in`. Total supply only falls, by exactly what planting burns.

## The ledger and the replay

The contract keeps one ordered ledger of everything that changes the dish or the agar:

- `Join { generation, colony }`
- `Buy { generation, colony, petri, near }`
- `Plant { generation, colony, cells, cost }`

Anyone can rebuild the dish from it. Start from an empty board at generation 0, a chain of 32 zero bytes, an agar of
`max_supply` and no colonies. For each generation `g`, apply the entries recorded at `g` in ledger order: a join adds
a colony; a purchase subtracts its `petri` from the agar; a planting must cost exactly the price formula at that
moment, puts `cost − cost × burn_bps / 10,000` back into the agar, and plants its cells. Then step once with
`petri-core`, fold the chain when `g + 1` is a multiple of 16, and take that generation's `feed` out of the agar into
each colony's earnings and the keeper total. The replayed board hash, chain, agar and every colony's lifetime
earnings must equal the contract's, and every checkpoint must match along the way.

The contract test `replaying_the_ledger_reproduces_the_dish_the_agar_and_the_earnings` does exactly this. The site's
verify page does it in the browser (`web/src/lib/replay.ts`) and shows eleven checks: the chain, the board hash, the
checkpoints, every planting's price, the agar, sold, burned, returned, the keeper total, every colony's lifetime
earnings and the living cells. Each `Buy` also records the NEAR paid, so its PETRI can be checked against
`petri_for_near`; the browser replay takes the recorded figure as given.

## History chain and checkpoints

The board hash is
`sha256(width u16 || height u16 || for each live cell in index order: index u32 || owner u16)`, all little-endian.

The history chain starts as 32 zero bytes at generation 0. At every generation that is a multiple of 16, after that
generation's step:

```
chain = sha256(previous chain || generation u64 little-endian || board hash)
```

Every 240 generations (one hour of dish time) the contract also stores a checkpoint `{ generation, chain }`; the
first checkpoint is generation 0 with the zero chain.

## The token

PETRI follows NEP-141 (fungible tokens) with NEP-148 metadata and NEP-145 storage management.

- **Metadata.** `ft_metadata` returns spec `ft-1.0.0`, name `Petri`, symbol `PETRI`, decimals 6 and an inline SVG
  icon.
- **Supply and balances.** `ft_total_supply` is `max_supply − burned`. It includes the agar, unclaimed earnings and
  the keeper pot, so the balances of all accounts add up to less than it until those are claimed.
  `ft_balance_of(<contract account>)` returns the agar.
- **Transfers.** `ft_transfer` and `ft_transfer_call` require exactly 1 yoctoNEAR attached. `ft_transfer_call` must
  leave at least 10 TGas for the receiver after reserving the resolve callback, calls the receiver's
  `ft_on_transfer`, and `ft_resolve_transfer` refunds any amount the receiver returns as unused (if the sender is
  still registered).
- **Restrictions.** A transfer must be positive, cannot go to the contract account ("PETRI goes back to the agar only
  by planting"), cannot go from an account to itself, and the receiver must be registered ("the receiver is not
  registered; it needs storage_deposit first"). There is no minimum amount.
- **Storage (NEP-145).** An account is registered by joining or by `storage_deposit`, which costs one 125-byte
  balance record at NEAR's storage price and refunds anything above that (and refunds the whole deposit if the account
  is already registered). `storage_balance_bounds` returns that cost as both min and max; `storage_withdraw` has
  nothing to withdraw; `storage_unregister` removes an empty registration that is not a colony and refunds its
  storage. The contract never registers itself.
- **The dish does not play on itself.** The contract never sends or receives PETRI through the token methods. Its
  own balance is the agar, and it moves only through `buy`, the feed, claims, the keeper pot and plantings.
- **Events.** The contract logs NEP-141 `ft_mint` (launch), `ft_transfer` (purchases, claims, keeper pots, planting
  returns, transfers, refunds) and `ft_burn` (planting) events, plus its own `petri` 2.0.0 events: `join`, `plant`,
  `claim` and one `generation` summary per catch-up.

## Methods and views

Change methods:

| Method | What it does |
| --- | --- |
| `join(name, color)` payable | Create the caller's colony. At least `min_join` NEAR; storage is kept, the rest buys PETRI into the vault. |
| `buy()` payable | Spend the attached NEAR on PETRI from the agar. Colonies only. Returns the PETRI bought. |
| `plant(cells, note?)` payable | Plant up to 64 cells for the caller's colony, with an optional lab note. Attach `plant_deposit`. Returns the generation. |
| `claim()` | Move the colony's PETRI earnings into its balance and send its NEAR tide winnings. Returns `{ petri, near }`. |
| `advance(max?)` | Catch the dish up by up to `min(max, 120)` generations and pay the keeper pot to a registered caller. |
| `ft_transfer`, `ft_transfer_call` | NEP-141 transfers, 1 yoctoNEAR attached. |
| `storage_deposit`, `storage_withdraw`, `storage_unregister` | NEP-145 storage management. |

Views:

| View | Returns |
| --- | --- |
| `quote(cells)` | The PETRI price of planting that many cells at the stored generation. |
| `plant_deposit(cells, note_bytes?)` | The NEAR to attach to such a planting: its storage plus the fee. |
| `buy_quote(near)` | The PETRI that much NEAR would buy from the agar right now. |
| `claimable(account_id)` | `{ petri, near }` waiting for that account's colony. |
| `rules()` | The parameters above. |
| `state()` | Stored and due generation, epoch, block time, history chain, board hash, live cells, colony, ledger and planting counts, the PETRI counters (`total_supply`, `agar`, `sold`, `fed`, `returned`, `burned`, `keeper_pot`, `keeper_paid`), the NEAR counters (`vault`, `near_in`, `near_tides`, `tides`), and the current `cell_price` and `petri_price`. |
| `board()` | The stored board in compact form, base64: the liveness bit rows (u64 little-endian, 2 words per row on a 128-wide dish), then one u16 owner per live cell in index order. |
| `colonies(from?, limit?)` | Colonies in id order, up to 500 per call (default 100). Each has its account, name, colour, join generation, last planting generation, cells planted, `petri_spent` (full planting costs), `petri_burned`, `petri_claimed`, `near_paid` and `near_claimed`. |
| `colony_of(account_id)` | One account's colony, or null. |
| `earnings(from?, limit?)` | Each colony's lifetime PETRI earnings, claimed or not, up to 2,000 per call (default 500). |
| `ledger(from?, limit?)` | The ledger, up to 1,000 entries per call (default 200). |
| `plants(from?, limit?)` | Plantings only, with their ledger index and lab note, up to 1,000 per call (default 200). |
| `checkpoints(from?, limit?)` | Stored checkpoints, up to 2,000 per call (default 500). |
| `ft_total_supply`, `ft_balance_of`, `ft_metadata` | The NEP-141 and NEP-148 views. |
| `storage_balance_of`, `storage_balance_bounds` | The NEP-145 views. |

## Names and notes

Names are trimmed, 1 to 24 characters and at most 48 bytes, and unique ignoring case ("a colony with that name
already exists"). Names and notes refuse control characters, bidirectional overrides and isolates, zero-width
characters, the byte-order mark and the Arabic letter mark ("may not contain control, direction or zero-width
characters"), so nothing can disguise itself in the log. A colour must be at most `0xFFFFFF`.

## How the parameters were chosen

`sim/src/main.rs` runs the real `petri-core` Life step, feed, cap, price and purchase curve on a 128 × 128 dish for
7 days of generations (40,320) with scripted players, under seven parameter sets and three societies each. Results are
in `sim/out-v2/summary.txt` and `sim/out-v2/timeline.csv` (`sim/out/` holds the earlier v1 runs).

Players buy their PETRI at join (0.05 NEAR for most, 0.1 for the methuselah, 2 for the whale, 0.02 for each sybil)
and never buy again. Builders plant still lifes near home, raiders mostly gliders, defenders eaters and beehives,
every 20 to 119 generations, skipping a planting that costs more than half their balance. The methuselah plants an
R-pentomino every 12 generations whenever it can pay; the whale plants pulsars and beehives; each of 30 sybils plants
its stake once as blocks; late players join on day two. The simulator charges a flat 0.005 NEAR join fee into the
vault in place of storage. "Earned over spent" is PETRI fed to a player divided by PETRI it spent planting; it leaves
out the NEAR paid, which is reported separately.

At the launch values (`v2`), per player of each kind:

| Society | Player | Earned | Share of earnings | Spent | Earned over spent | NEAR paid | NEAR won |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 6 builders, 3 raiders, 2 defenders, 4 late | Builder | 29,494 | 52% | 16,785 | 1.76 | 0.4952 | 0.4911 |
| | Raider | 29,568 | 26% | 13,436 | 2.20 | 0.4072 | 0.5048 |
| | Defender | 32,820 | 19% | 20,258 | 1.62 | 0.5859 | 0.5602 |
| | Late | 2,401 | 3% | 1,704 | 1.41 | 0.1017 | 0.0398 |
| The same plus 1 methuselah | Builder | 21,946 | 39% | 11,666 | 1.88 | 0.4011 | 0.4363 |
| | Raider | 22,096 | 19% | 10,705 | 2.06 | 0.3731 | 0.4281 |
| | Defender | 17,382 | 10% | 10,386 | 1.67 | 0.3634 | 0.3439 |
| | Methuselah | 78,602 | 23% | 56,313 | 1.40 | 1.7810 | 1.5998 |
| | Late | 7,488 | 9% | 4,368 | 1.71 | 0.1930 | 0.1448 |
| The first plus 1 whale and 30 sybils | Builder | 20,422 | 36% | 13,581 | 1.50 | 0.4185 | 0.5824 |
| | Raider | 23,208 | 21% | 9,879 | 2.35 | 0.3198 | 0.5105 |
| | Defender | 22,699 | 13% | 10,888 | 2.08 | 0.3462 | 0.5925 |
| | Whale | 51,097 | 15% | 50,780 | 1.01 | 3.3574 | 1.4486 |
| | Sybil | 215 | 2% (all 30) | 19 | 11.50 | 0.0254 | 0.0246 |
| | Late | 10,832 | 13% | 6,832 | 1.59 | 0.2476 | 0.2092 |

Across the variants:

| Parameters | Largest colony (methuselah society) | Methuselah earned over spent | Whale earned over spent | Late joiners earned over spent | Agar left after 7 days |
| --- | --- | --- | --- | --- | --- |
| Close to v1 (`launch-like`: free 64-PETRI grants, flat 2 PETRI price, 20 ppm, no cap, no buy-in) | 35% | 8.20 (49% of earnings) | 3.32 | 3.05 to 3.69 | 484,869 to 493,447 |
| Launch values (`v2`) | 66% | 1.40 (23%) | 1.01 | 1.41 to 1.71 | 742,662 to 745,951 |
| No cap | 83% | 3.57 (63%) | 1.48 | 1.54 to 2.33 | 717,620 to 739,852 |
| Cap at 10% | 53% | 1.09 (18%) | 0.82 | 1.59 to 2.27 | 738,943 to 750,133 |
| Payback 240 | 32% | 2.85 (23%) | 1.96 | 2.78 to 3.69 | 705,210 to 706,798 |
| Payback 960 | 58% | 1.00 (28%) | 0.88 | 0.65 to 1.44 | 763,428 to 773,241 |
| Feed 20 ppm | 56% | 1.48 (25%) | 0.99 | 0.72 to 1.89 | 538,806 to 565,377 |

What the runs showed: the cap is what keeps a runaway grower from being paid for the dish (it still covers most of
it); a payback of 240 pays players other than the sybils 1.96 to 4.67 times their spend, close to v1; a payback of 960 or a feed of 20 ppm
leaves late joiners below 1 in some societies; a 10% cap pushes the whale below break-even. The scripted players do
not react to prices beyond keeping a reserve, so the simulator measures how PETRI and NEAR move under each rule set,
not how people would change their play.

## The keeper and the AI strains

`agents/run.mjs` runs the keeper and five AI strains, ordinary accounts that play by the same rules as everyone:
Crystal Violet, Safranin, Methylene Blue, Malachite Green and Congo Red. Each strain joined with 0.05 NEAR, buys
0.02 NEAR of PETRI when it cannot afford three blocks (counting waiting earnings), claims its tide winnings every few
hours, and attaches the `plant_deposit` for each planting. For each turn, code in `agents/strategies.mjs` proposes up
to six plantings that `petri-core` accepts and the strain can afford. A model on NEAR AI Cloud
(`z-ai/glm-5.3-flash`, served from a TEE) picks one and writes a lab note; the agent fetches the enclave's signature
for each answer and logs it. Without a model key, or when the model fails, the strain takes the first candidate and
uses its description as the note. The model never decides what is legal.

## Limits and known trade-offs

- **Testnet.** The dish runs on NEAR testnet. Testnet PETRI and NEAR have no market.
- **Fixed parameters, not fixed code.** No contract method changes a parameter, but whoever controls the contract
  account's keys could deploy new code. Check the account's access keys on an explorer before trusting that.
- **Someone has to advance.** The stored board only moves when a transaction touches it. If nobody calls for a long
  time, each call catches up at most 120 generations (30 minutes of dish time), planting is refused until the dish is
  current, and the caller pays the gas. Feed and tides for those generations are worked out late but not lost.
- **The keeper pot is a race.** Every catch-up adds to the pot, but only `advance` pays it, to whoever calls it, so an
  account that calls `advance` right after someone else's catch-up collects a pot it did no work for.
- **Early colonies have an edge.** Below 1,000 living cells the price still counts 1,000, so cells pay back faster
  than 480 generations; the agar is fullest at the start; and PETRI is cheapest in NEAR while the agar is full.
- **The cap limits pay, not territory.** A colony can still cover most of the dish (66% in the simulator); it is just
  not paid for more than 15% of the living.
- **Sybils.** Splitting into many colonies gains nothing from the cap, and each colony must bring at least 0.01 NEAR.
  But the site's guest accounts are funded by its relayer with 0.04 testnet NEAR each (4 per IP address per hour,
  120 per hour overall, about a second of proof of work each), so a farmer of guests plays with the relayer's NEAR.
- **The tides are players' own NEAR.** They redistribute what players paid; there is no outside yield.
- **No sell-back.** The agar sells PETRI but never buys it. The rising price is what the next buyer pays the agar.
- **Ordering.** Entries in the same generation apply in execution order, so an earlier planting can make a later one
  fail its buffer or occupancy check.
- **Storage.** Players pay storage for colonies, plantings and notes, and registrations pay for their balance record.
  Checkpoints are stored at the contract's expense. The earnings and tide records grow with the number of colonies and
  are read and written whole on every catch-up.
- **Wallet balances do not add up to the supply** until unclaimed earnings and the keeper pot are claimed.
- **The browser replay trusts purchase figures.** It subtracts each `Buy`'s recorded PETRI from the agar without
  recomputing it from the NEAR paid.
- **Rounding.** Integer division leaves small remainders of each feed in the agar and of each tide in the vault.
- **The strains depend on credits.** If the NEAR AI key runs out, the strains keep playing but their moves and notes
  come from code, and the log records `decided_by: "rules"`.
