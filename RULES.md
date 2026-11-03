# Petri rules

Petri is Conway's Game of Life on a shared dish run by a NEAR smart contract, with colony ownership and a token,
PETRI, that the dish pays to whatever is alive. This file describes what the contract enforces. The code is the
source of truth: the rules of a generation live in `core/src/lib.rs` (the `petri-core` crate), and the clock, the
economy and the token live in `contract/src/lib.rs` and `contract/src/token.rs`. The same `petri-core` crate runs in
the contract, in the browser (compiled to WebAssembly) and in the economy simulator, so the three cannot disagree.

Every parameter is set once, when the contract is initialised, and can be read with the `rules` view. The contract
has no method that changes a parameter, mints PETRI, or edits the board.

## Launch parameters

These are the values the live dish (`petri-dish.testnet`) returns from `rules`. PETRI has 6 decimals, so the
contract stores 1 PETRI as `1000000` units.

| Field | Value | Meaning |
| --- | --- | --- |
| `width` × `height` | 128 × 128 | Cells on the dish. The edges wrap. |
| `generation_ms` | 15000 | One generation every 15 seconds (5,760 a day). |
| `max_supply` | 1,000,000 PETRI | Every PETRI that will ever exist. All of it is minted at launch into the agar. |
| `feed_ppm` | 20 | Parts per million of the agar paid out each generation. |
| `keeper_bps` | 200 | 2% of each generation's feed goes to the account that advanced it. |
| `burn_bps` | 5000 | 50% of a planting's cost is burned; the rest goes back to the agar. |
| `plant_cost` | 2 PETRI | Base price of one planted cell on an empty dish. |
| `capacity` | 1000 | Live cells at which the price of a cell has doubled. |
| `starter_grant` | 64 PETRI | Paid from the agar to each new colony. |
| `buffer` | 3 | No planted cell may be within 3 cells of a rival's live cell. |
| `max_plant_cells` | 64 | Most cells in one planting. |
| `max_catchup` | 120 | Most generations one call will advance. |

Fixed in code rather than in `rules`: a colony name is 1 to 24 characters after trimming, a lab note is at most 140
characters, the history chain advances every 16 generations (`CHAIN_EVERY`), and a checkpoint is stored every 240
generations (`CHECKPOINT_EVERY`).

## The dish

- A grid of `width × height` cells whose edges wrap: the right edge touches the left and the top touches the bottom,
  so the dish is a torus with no walls.
- Every cell is either empty (`0`) or alive and owned by one colony (a colony id from 1 upwards).
- A colony is one NEAR account. It joins once, with a name and a colour (`0xRRGGBB`), and keeps its id for good.
  The contract allows up to 65,535 colonies.

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

The dish is a pure function of its plantings and the clock. Generation `g` is due once
`(block time − epoch) / generation_ms ≥ g`, where `epoch` is the block time when the contract was initialised.

The contract does not run on its own. It stores the board at the last generation someone advanced to, and any
transaction that touches the dish first catches it up to the clock:

- `join`, `plant` and `advance` each step the stored board forward through every due generation, up to
  `max_catchup` (120) per call. `advance(max)` can ask for fewer.
- The account whose call runs a generation is that generation's keeper and receives the keeper share of its feed.
- `plant` requires the dish to be fully caught up after its own catch-up. If the dish is more than 120 generations
  behind, the planting is refused with "the dish is behind the clock; call advance first", and someone has to call
  `advance` until it is current.
- A keeper process (`agents/run.mjs`, account `petri-keeper.testnet`) calls `advance` whenever the stored board is
  20 or more generations behind, so the stored board is normally within about five minutes of the clock.

Browsers do not wait for the stored board. The site loads it into the same `petri-core` engine compiled to
WebAssembly, steps it forward to the generation the clock says is due, and draws that. It also computes the feed
each colony has earned since the stored generation; that PETRI is paid when the dish is next advanced.

## Joining

`join(name, color)`:

- Refused if the account already has a colony, if the trimmed name is empty or longer than 24 characters, or if the
  colour is above `0xFFFFFF`.
- Catches the dish up (the joiner is keeper for those generations).
- Creates the colony with the next id and pays `starter_grant` (64 PETRI) from the agar to the account. If the agar
  held less than that, it pays what is left.

## Planting

`plant(cells, note)` brings cells to life for the caller's colony. `cells` are flat indices, `y × width + x`. Any set
of cells is allowed within the limits below; the site's stamps (block, glider, eater and so on) are only a
convenience.

The contract checks, in this order, and refuses with the quoted message:

| Check | Refusal |
| --- | --- |
| The note, after trimming, is at most 140 characters. | "a lab note is at most 140 characters" |
| The caller has joined. | "join the dish first" |
| After catching up, the dish is at the due generation. | "the dish is behind the clock; call advance first" |
| The colony has not planted in this generation. | "one planting per generation; wait for the next one" |
| At least one cell. | "plant at least one cell" |
| At most `max_plant_cells` (64) cells. | "at most 64 cells per planting" |
| Every index is on the dish. | "cell N is off the dish" |
| No index is listed twice. | "cell (x, y) is listed twice" |
| Every target cell is empty. | "cell (x, y) is already alive" |
| No other colony's live cell lies within `buffer` (3) cells of any target cell, measured as the larger of the row and column distance, across the wrapped edges. That is a 7 × 7 square centred on each planted cell. The colony's own cells do not count. | "cell (x, y) is inside colony N's buffer; plant further away or send a glider" |
| The colony holds the price. | "planting N cells costs X PETRI; you hold Y" |

The buffer is checked only when planting. Nothing stops colonies from growing, flying or firing into each other
afterwards; that is how territory changes hands.

### The price

```
cost = plant_cost × cells × (capacity + total_live) / capacity
```

in PETRI units with integer division, where `total_live` is the number of live cells on the dish after the
planting's own catch-up. With the launch values, one cell costs 2 PETRI on an empty dish, 4 PETRI with 1,000 cells
alive and 6 PETRI with 2,000 alive. The `quote(cells)` view returns the price at the stored generation; the price a
planting actually pays can differ if the catch-up it triggers changes `total_live`.

Of the cost, `burn_bps` (half) is burned and the rest goes back into the agar.

### What gets stored

The planted cells come alive at the current generation, before the next step. The contract appends
`{ generation, colony, cells }` to the plant log, stores the note (trimmed; an empty note is stored as none) under
the planting's index, and emits a `plant` event with the cost and the note. Plantings in the same generation are
applied in the order the chain executes them.

## The coin

PETRI is the dish's nutrient. The contract account itself holds the undistributed supply; this balance is called the
agar.

- **Launch.** All of `max_supply` (1,000,000 PETRI) is minted once, into the agar. There is no other mint.
- **Feed.** In each generation that ends with at least one live cell, the agar pays
  `feed = agar × feed_ppm / 1,000,000`, computed on the agar's balance at that moment, so the feed shrinks as the agar
  does. A dish with no live cells pays nothing.
- **Keeper share.** `feed × keeper_bps / 10,000` (2%) goes to the account whose transaction ran that generation.
- **Colonies' share.** The rest is split between colonies in proportion to their live cells after the generation
  (`share × live_c / total_live`, integer division). Rounding remainders are never paid out; they stay in the agar.
- **Planting.** Half of the cost is burned; the other half returns to the agar.
- **Starter grant.** 64 PETRI moves from the agar to each new colony, once per account.

At the launch rate the agar pays out about 10.9% of its balance per day while anything is alive, before planting
returns anything (`1 − (1 − 0.00002)^5760`). Left alone, it would halve in about 34,657 generations, a little over
six days.

### Conservation

The contract tracks `granted`, `fed` (everything paid out, keeper share included), `returned`, `burned` and
`keeper_paid`, all readable from the `state` view. The contract tests assert after every scenario that:

- `total_supply = max_supply − burned`
- `agar + every account's balance = total_supply`
- `agar = max_supply − granted − fed + returned`

Total supply only falls. It falls by exactly what planting burns.

## The token

PETRI follows NEP-141 (fungible tokens) with NEP-148 metadata and the NEP-145 storage views that wallets call.

- **Metadata.** `ft_metadata` returns spec `ft-1.0.0`, name `Petri`, symbol `PETRI`, decimals 6 and an inline SVG
  icon.
- **Supply and balances.** `ft_total_supply` is `max_supply − burned`, which includes the agar.
  `ft_balance_of(<contract account>)` returns the agar.
- **Transfers.** `ft_transfer` and `ft_transfer_call` require exactly 1 yoctoNEAR attached, as NEP-141 specifies.
  `ft_transfer_call` needs more than 35 TGas, calls the receiver's `ft_on_transfer`, and `ft_resolve_transfer`
  refunds any amount the receiver returns as unused.
- **Restrictions.** A transfer must be positive, cannot go to the contract account ("PETRI goes back to the agar only
  by planting"), cannot go from an account to itself, and must move at least 1 PETRI if the receiver has never held
  PETRI ("a transfer to a new holder must be at least 1 PETRI").
- **Storage.** The contract pays for every balance record, so there is nothing to register. `storage_balance_of`
  reports every account as registered with a zero balance, `storage_balance_bounds` is zero to zero, and
  `storage_deposit` refunds any deposit attached. `storage_withdraw` and `storage_unregister` are not implemented.
  The 1 PETRI minimum for new holders is what stops anyone from filling the contract's storage with dust accounts.
- **Events.** The contract logs NEP-141 `ft_mint` (launch), `ft_transfer` (grants, feed, planting returns, transfers,
  refunds) and `ft_burn` (planting) events, plus its own `petri` events: `join`, `plant` and `generation`.

## Methods and views

Change methods:

| Method | What it does |
| --- | --- |
| `join(name, color)` | Create the caller's colony and pay the starter grant. |
| `plant(cells, note?)` | Plant up to 64 cells for the caller's colony, with an optional lab note. Returns the generation. |
| `advance(max?)` | Catch the dish up by up to `min(max, 120)` generations. The caller earns the keeper share. |
| `ft_transfer`, `ft_transfer_call`, `storage_deposit` | The token surface described above. |

Views:

| View | Returns |
| --- | --- |
| `rules()` | The parameters above. |
| `state()` | Stored and due generation, epoch, block time, history chain, board hash, live cells, colony and planting counts, and the economy counters (`total_supply`, `agar`, `granted`, `fed`, `returned`, `burned`, `keeper_paid`). |
| `board()` | The stored board in compact form, base64: the liveness bit rows (u64 little-endian, 2 words per row on a 128-wide dish), then one u16 owner per live cell in index order. |
| `quote(cells)` | The price of planting that many cells at the stored generation. |
| `colonies(from?, limit?)` | Colonies in id order, up to 500 per call (default 100). Each has its account, name, colour, join generation, last planting generation, cells planted, PETRI spent on planting (`petri_burned`, the full cost including the half returned to the agar) and PETRI earned from the feed. |
| `colony_of(account_id)` | One account's colony, or null. |
| `plants(from?, limit?)` | The plant log with lab notes, up to 1,000 per call (default 200). |
| `checkpoints(from?, limit?)` | Stored checkpoints, up to 2,000 per call (default 500). |
| `ft_total_supply`, `ft_balance_of`, `ft_metadata`, `storage_balance_of`, `storage_balance_bounds` | The token views. |

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

Anyone can check the dish from scratch. Start from an empty board at generation 0. For each generation `g`, apply
the plantings logged at `g` in log order, then step once with the `petri-core` rules, and fold the chain whenever
`g + 1` is a multiple of 16. The replayed board hash and chain must equal the contract's `board_hash` and `chain`, and
every checkpoint must match along the way. The contract test `replaying_the_plant_log_reproduces_the_board_and_chain`
does exactly this; the site's verify page does it in the browser.

## How the parameters were chosen

`sim/src/main.rs` runs the real `petri-core` rules on a 128 × 128 dish for 14 days of generations (80,640) with
scripted players, under six parameter sets and three societies each. Players plant on their own schedules (every 20
to 119 generations), keep a reserve, and choose patterns by type: builders plant blocks, beehives and loaves;
raiders mostly gliders; defenders eaters and beehives; a chaos player R-pentominoes and blocks. Results are in
`sim/out/summary.txt` and `sim/out/timeline.csv`.

With the launch parameters (feed 20 ppm, base price 2 PETRI, capacity 1,000, half burned):

| Society | Supply after 14 days | Agar left | Burned, as a share of feed | Colonies alive | Gini of balances |
| --- | --- | --- | --- | --- | --- |
| 8 builders | 888,186 | 254,918 | 13% | 8 of 8 | 0.19 |
| 4 builders, 4 raiders | 909,646 | 244,259 | 11% | 8 of 8 | 0.14 |
| 6 builders, 3 raiders, 2 defenders, 1 chaos | 819,443 | 288,897 | 20% | 12 of 12 | 0.18 |

What the variants showed:

- **Feed 50 ppm** drained the agar to between 39,916 and 61,755 PETRI in 14 days.
- **Feed 8 ppm** left most of the agar unpaid (591,031 to 616,474 PETRI) and, in the mixed society, only 8 of 12
  colonies survived, with a Gini of 0.43.
- **Flat price** (no crowding term) and **1 PETRI base price** burned less: 5% to 11% of the feed.
- **No burn** left supply at exactly 1,000,000.

The scripted players do not react to prices or feed beyond keeping a reserve, which is why the final live-cell
counts are identical across most variants. The simulator measures how money moves under the rules, not how people
would change their play.

## The keeper and the AI strains

`agents/run.mjs` runs the keeper and five AI strains, ordinary accounts that play by the same rules as everyone:
Crystal Violet (gardener), Safranin (raider), Methylene Blue (engineer), Malachite Green (wanderer) and Congo Red
(chaos). For each turn, code in `agents/strategies.mjs` proposes up to six plantings that `petri-core` already
accepts and the strain can afford. A model on NEAR AI Cloud (`z-ai/glm-5.3-flash`, served from a TEE) picks one and
writes a lab note of up to 120 characters; the agent fetches the enclave's signature for each answer and logs it.
Without a model key, or when the model fails, the strain takes the first candidate and uses its description as the
note. The model never decides what is legal.

## Limits and known trade-offs

- **Testnet.** The dish runs on NEAR testnet. Testnet PETRI has no market.
- **Fixed parameters, not fixed code.** No contract method changes a parameter, but whoever controls the contract
  account's keys could deploy new code. Check the account's access keys on an explorer before trusting that.
- **Someone has to advance.** The stored board only moves when a transaction touches it. If nobody calls for a long
  time, each call catches up at most 120 generations (30 minutes of dish time), planting is refused until the dish is
  current, and the caller pays the gas. Feed for those generations is paid late but not lost.
- **Early colonies earn more.** The feed is a fixed share of a shrinking agar, and the price of a cell rises with the
  population, so cells planted early earn more per PETRI spent.
- **Sybils.** Every new account gets 64 PETRI. The site's guest accounts are rate-limited (4 per IP address per hour,
  120 per hour overall), but anyone can create NEAR accounts and call `join` directly. Each colony still has to obey
  the buffer and pay rising prices.
- **Ordering.** Plantings in the same generation apply in execution order, so an earlier planting can make a later
  one fail its buffer or occupancy check.
- **Storage.** The contract pays storage for balances, the plant log and lab notes from its own NEAR balance. The
  1 PETRI minimum for new holders and the 64-cell planting limit bound the growth, but the log grows with play.
- **Rounding.** Integer division leaves small remainders of each feed in the agar.
- **The strains depend on credits.** If the NEAR AI key runs out, the strains keep playing but their moves and notes
  come from code, and the log records `decided_by: "rules"`.
