# Sixty days of PETRI, before anyone has to live through them

The memecoins prompt asks for sixty days of community behaviour and supply over time under a few scenarios before the
parameters are picked. This folder is that run, on the mainnet launch rules (`contract/launch-rules-mainnet.json`, the
same economic parameters as testnet).

```text
cd sim
cargo run --release -- out-60d days60 --seeds 5      # 5 scenarios x 5 seeds, about 30 s on 12 threads
cargo run --release -- out-60d bench --seasons 1000  # 1,000 one-day adversarial seasons, about 26 s
```

**Method.** Nothing is sampled or approximated at the dish level: `World` (sim/src/world.rs) steps petri-core's Life
and economy through every one of the 345,600 generations (15 s each) of sixty days, prices every planting with the
contract's formula (siege surcharge and slide licences included), feeds the living from the agar exactly as the contract
does, runs every tide by its split, and mirrors the contract's book-keeping (storage, gas, kept PETRI, the hot table).
Players are scripted kinds with budgets (sim/src/world.rs `Kind`): pennies, builders, raiders, defenders, R-pentomino
players, latecomers, whales, a split whale, snipers, sellers, guests and lattice lockers, joined by the five house
strains as agents/ plays them on mainnet. A day row is read off the running world at the end of each day. A scripted
society is a model, not a forecast: players here never learn, and nobody new arrives unless the scenario says so.

## Files

- `days.csv`: every scenario, seed and day: living cells, PETRI in the agar, held by players, burned and fed, the vault
  and what it paid out, the credit pool, the cell price, tides run and skipped, players joined, and the largest single
  player's share of living cells and of players' PETRI.
- `supply-<scenario>.svg`: PETRI in the agar, held by players and burned, and NEAR the vault paid out, median of the
  five seeds with their range shaded.
- `headline.md`, `web.json`: the numbers below, and the series the site draws on /coin and /rules.
- `bench.csv`, `bench.md`, `bench.json`: the 1,000-season bench.

## Headline numbers (median of 5 seeds, range in brackets)

| Scenario | What happens | Most of the living cells one outside player held (day 7 on) | Most of players' PETRI one player held (day 7 on) | PETRI burned | NEAR the vault paid out | PETRI left in the agar |
|---|---|---|---|---|---|---|
| boom | 600 outside players arrive over the first ten days, then nobody new | 65.2% (45.8–93.5%) | 44.5% (25.5–59.2%) | 151,568 (148,246–156,936) | 133.55 (133.19–135.89) | 829,028 (818,059–835,275) |
| steady | 5 new outside players a day for sixty days (300 in all) | 67.6% (59.3–86.6%) | 62.5% (42.5–71.4%) | 137,127 (135,653–150,664) | 75.94 (69.74–78.37) | 852,116 (839,926–855,489) |
| decline | 300 players arrive in the first two days, nobody after; each stops once its budget is spent | 78.2% (48.2–94.4%) | 39.2% (30.4–65.0%) | 77,866 (74,711–81,112) | 65.28 (64.56–65.93) | 905,040 (899,676–913,050) |
| whale siege | 150 players over 30 days plus three 2-NEAR whales, a 10-colony split whale and two lattice lockers from day 0 | 87.3% (77.1–100%) | 61.8% (53.9–71.1%) | 110,595 (103,233–114,479) | 58.98 (58.01–59.31) | 855,084 (837,911–875,123) |
| strains only | the five house strains alone, on their mainnet budgets | 0% (no outside player) | 0% | 1,385 (1,269–1,465) | 0 (no tide ran: the house is never paid) | 998,547 (998,474–998,670) |

What the runs say, plainly:

- **Supply only falls.** PETRI is never minted beyond the 1,000,000 at launch; the agar hands it to living cells and
  plantings burn half of what they cost. Sixty days of a boom burn about 15% of all PETRI; a dish only the house plays
  burns 0.14%.
- **The agar does not run dry.** Even the boom leaves 83% of PETRI in the agar at day 60, because half of every
  planting's cost goes back to it and the feed is a small share (3 ppm a generation) of what is left.
- **The vault pays out what players bring.** The tides paid 59 to 134 NEAR back to colonies over sixty days; with the
  house alone no tide runs at all, since the house is never fed and never shares a tide.
- **One player can hold most of the living cells, not most of the money.** Late in a quiet dish a single R-pentomino
  player or whale often holds most of the few cells alive (up to 87% median in the whale siege). The bench below shows
  what that is worth.

## The 1,000-season bench: trying to own the dish

One-day seasons on the mainnet rules: the five strains, 20 mixed outside players and one attacker, a 2-NEAR whale, a
10-colony split whale or a lattice locker in turn. "Net NEAR" counts what the attacker withdrew, what it is still owed
and the PETRI it still holds at the sell-back price, against everything it paid (storage and gas included).

| Attacker | Seasons | Most of the living cells it held, median | Seasons it held half the cells | Its share of what tides paid outside players, median | Seasons the attempt paid | Net NEAR, median (best) | 4-cell block, siege vs open ground |
|---|---|---|---|---|---|---|---|
| Whale | 334 | 83.0% (max 99.6%) | 96.4% | 45.9% | 0 | −2.468 (−1.026) | 0.0065 vs 0.0043 NEAR |
| Split whale | 333 | 65.8% (max 90.6%) | 71.8% | 31.0% | 0 | −1.924 (±0.000) | 0.0065 vs 0.0043 NEAR |
| Locker | 333 | 98.3% (max 100%) | 100% | 54.3% | 0 | −1.743 (−0.699) | 0.0064 vs 0.0042 NEAR |
| **All** | 1,000 | 84.4% (max 100%) | 89.4% | | **0 of 1,000** | | 0.0065 vs 0.0043 NEAR |

So: an attacker with up to sixty times a penny player's budget does take most of the dish's cells in nine seasons out of ten,
and takes 45% of the tide pay in 448 of the 1,000 seasons; in none of the 1,000 did it come out ahead. Owning the dish
is allowed, it is visible to everyone, and it costs more than it returns. A newcomer still finds open ground: a 4-cell
block costs about 0.0043 NEAR on open agar and 0.0065 NEAR inside a rival's buffer (the 3x siege price on the PETRI part).

## Limits

- One-day seasons are short: a whale that keeps playing for weeks and finds no rivals could do better than this bench
  shows (the whale siege scenario above is the sixty-day version; `days.csv` does not break its cash down by player).
- Scripted players do not adapt. A real community copies what works.
- The house strains here play by their written rules only; on chain they also ask a model.
