# Petri rules

Petri is a coin that lives on a dish. These are the rules the contract enforces. Every parameter is fixed when the
dish is created and can be read with the `rules` view; there is no admin key and no method that changes them.

## The dish

- A square grid of `W × H` cells (the launch dish is 128 × 128) whose edges wrap: the right edge touches the left,
  the top touches the bottom.
- Every cell is either empty or alive. A live cell belongs to one colony.
- A colony is one NEAR account. It has a name and a colour, chosen once when it joins.

## A generation

The dish advances one generation every `generation_ms` milliseconds (launch value: 15 000). Every cell looks at its
eight neighbours at once:

1. **Survival.** A live cell with 2 or 3 live neighbours stays alive and keeps its colony. Any other live cell dies.
2. **Birth.** An empty cell with exactly 3 live neighbours comes alive. It joins the colony that owns the most of
   those three parents.
3. **Contested ground.** If the three parents belong to three different colonies, nothing is born.

Rules 1 and 2 are Conway's Game of Life, so every known pattern (blocks, blinkers, gliders, guns) works on the dish.
Ownership is the only addition. Rule 3 is the only place where Petri differs from Life.

Time is part of the state. The board at any moment is a pure function of the plantings and the clock, so the
contract catches up any generations that are due before it accepts a planting. Anyone can also call `advance` to
catch up without planting. A browser replays the whole history from the plant log and checks it against the hash the
contract stores.

## The coin

PETRI is a NEP-141 fungible token with 6 decimals.

- **Emission.** Each generation mints `emission_per_generation` PETRI (launch: 10). The keeper share
  (`keeper_bps`, launch 2%) goes to the account whose transaction advanced that generation. The rest is split
  between colonies in proportion to their live cells after the generation. A dish with no live cells mints nothing.
- **Planting burns.** Bringing a cell to life costs `plant_cost` PETRI (launch: 1), and that PETRI is burned.
- **Starter grant.** Joining gives a new colony `starter_grant` PETRI (launch: 64), once per account.

Supply at any generation therefore equals grants plus emission minus everything burned by planting. It rises while
the dish is alive and falls when colonies spend to grow. All three terms are public counters on the contract.

## Planting

A colony brings cells to life by planting a pattern:

- Every target cell must be empty.
- **Buffer.** No live cell of another colony may be within `buffer` cells (launch: 3, measured as the larger of the
  row and column distance, across the wrapped edges) of any planted cell. You cannot drop cells next to a rival to
  kill it. To reach a rival you must send something that travels, such as a glider.
- At most `max_plant_cells` cells per planting (launch: 64), and at most one planting per colony per generation.
- The colony must hold `plant_cost × cells` PETRI.

## What this means

- **Still lifes earn.** A block (4 cells) never changes. It earns a share of every generation's emission until
  something hits it.
- **Gliders raid.** A glider costs 5 PETRI and crosses the dish forever. When it reaches a rival, births at the
  collision take the colour of the majority of their parents, so territory changes hands.
- **Defences exist.** An eater (7 cells) absorbs gliders and survives.
- **Crowding.** Emission is fixed per generation, so every new live cell dilutes every other one.

## Parameters at launch

| Parameter | Value |
| --- | --- |
| width × height | 128 × 128 |
| generation_ms | 15 000 |
| emission_per_generation | 10 PETRI |
| keeper_bps | 200 (2%) |
| plant_cost | 1 PETRI per cell |
| starter_grant | 64 PETRI |
| buffer | 3 |
| max_plant_cells | 64 |
| max_catchup | 40 generations per call |

## Limits we know about

- **Sybils.** A new account gets 64 PETRI for joining. Creating many accounts creates many grants. The grant is small
  next to emission, and every account still has to plant inside the buffer rules, but this is a demo-grade defence
  and we say so.
- **Ordering.** Two plantings in the same generation are applied in the order the chain executes them.
- **Catch-up.** If nobody calls the contract for a long time, the next caller pays gas to advance up to
  `max_catchup` generations, and the board shown in the browser runs ahead of the stored one until the keeper
  catches up. The browser's board is computed by the same code, so they agree.
