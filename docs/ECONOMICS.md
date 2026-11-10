# Who wins, and who pays

PETRI pays no yield. Whatever a tide pays a colony is NEAR that other players put into the vault, plus, for the first
week of a dish, a sliver of the house strains' NEAR. Petri is a **redistribution game with a burn**, not a yield
product: a few players win other players' NEAR, every move pays its own storage and gas, and half of every planting's
PETRI is burned. This page says, from the simulator's own runs, who ends up ahead, who pays for it, what the buy and
sell-back spread costs, and what happens once the house's budget is spent.

Every number below comes from one run, committed in [`sim/out-econ`](../sim/out-econ):

```text
cd sim
cargo run --release -- out-econ econ --seeds 10
```

## Method

- **The runs.** The five sixty-day scenarios of [`sim/out-60d`](../sim/out-60d) (boom, steady, decline, whale siege,
  strains only) on the mainnet launch rules, ten seeds each. Scenario *i* uses seeds `(600 + i) * 1000 + k`, k = 0..9;
  k = 0..4 are exactly the runs behind `out-60d` (re-running `days60 --seeds 5` with this code reproduces its CSV,
  JSON and headline byte for byte). Every one of the 345,600 generations is stepped with petri-core, the contract's own
  Rust core; every planting is priced, every tide split and every sale quoted by the same functions.
- **The players.** Scripted kinds with fixed budgets (`sim/src/world.rs`, `Kind`): penny players (0.01 NEAR join, 0.05
  in all), builders, defenders and raiders (0.05 join, 0.25 in all), R-pentomino players (0.1 / 0.5), tide snipers,
  buy-and-sell-back players (0.2 NEAR of PETRI, never plant), whales (2 / 3 NEAR), and in the whale siege a 10-colony
  split whale and lattice lockers; sponsored guests play on 0.05 NEAR of someone else's credit. The five house strains
  play on the budgets the simulator gives them on mainnet (0.55 NEAR each, `sim/src/main.rs`).
- **Net NEAR.** For each player: NEAR it took out (tide NEAR claimed, PETRI sold back, bounties), plus NEAR still owed
  to it, plus the PETRI it still holds at day 60 valued at the sell-back quote then, minus all the NEAR it attached and
  all its gas. "Ahead" means that is above zero. "Back per NEAR" is the first three over the last two.
- **Who paid the vault's payouts.** The vault is one pool. Every NEAR that leaves it (tide shares, bounties,
  sell-backs, a tide's storage) is drawn pro rata from what is in it, so the house's part of each payout is the house's
  part of the vault at that moment. Whatever the convention, the house cannot have paid more than it put in: about 1
  NEAR in every scenario, against 59 to 133 NEAR paid out.
- **Round trip.** At the end of every day: buy with 0.05 NEAR (the purchase record's storage comes off first), then
  sell all of it straight back at that state, as `petri_for_near` and `sell_back` price them.
- **A player's first day.** Each player's books 24 hours after it joined; the card on /coin shows the median player
  of each kind by that day's net, a real player from the run.

## The answer, scenario by scenario

Medians over ten seeds; outside players with their own NEAR (guests aside).

| Scenario | Players | Ahead after 60 days | Net NEAR, median | NEAR the vault paid players | Of it, the house's | Players' NEAR went: vault / storage / gas | Came back to players |
|---|---|---|---|---|---|---|---|
| boom | 5,220 | 3.6% | −0.175 | 133.43 | 0.78% | 56% / 32% / 11% | 53.0% |
| steady | 2,610 | 1.2% | −0.247 | 76.42 | 1.33% | 51% / 36% / 13% | 47.7% |
| decline | 2,610 | 2.5% | −0.149 | 65.07 | 1.47% | 57% / 32% / 11% | 53.6% |
| whale siege | 1,370 | 0.1% | −0.248 | 59.04 | 1.71% | 55% / 33% / 12% | 52.1% |
| strains only | 0 | | | 0 (no tide runs) | | | |

### Who wins

Few, and mostly one kind: players whose cells live long and wide at tide time.

| Player | Ahead after 60 days: boom / steady / decline / whale siege | Back per NEAR put in, median (steady) |
|---|---|---|
| R-pentomino player | 34.0% / 11.2% / 13.8% / 1.7% | 0.754 |
| Tide sniper | 3.8% / 4.2% / 0.8% / 0% | 0.550 |
| Defender | 1.1% / 0% / 2.2% / 0% | 0.139 |
| Builder | 0.4% / 0% / 1.7% / 0% | 0.133 |
| Raider | 0.1% / 0% / 1.6% / 0% | 0.095 |
| Penny player | 0% everywhere | 0.044 |
| Buy and sell back | 0% everywhere (−0.105 NEAR of 0.2) | 0.475 |
| Whale, split whale, lattice locker | 0% everywhere (whales −1.6 to −3.0 NEAR) | 0.316 (whale) |

The best R-pentomino players in a boom end about +0.39 NEAR on 0.5 (p90); the median one still loses. Owning the dish
does not pay: no whale, split whale or locker came out ahead in any of the 40 runs, which matches the 1,000-season
bench in `sim/out-60d`. Late joiners do no better than early ones: in the steady scenario 2.9% of players who joined on
days 0 to 1 ended ahead, under 1% of those who joined on days 30 to 59. Sponsored guests risk no NEAR of their own and
win only credit that stays in the dish; under 1% end with more credit and PETRI than their grant.

### Who pays

The players who lose. Of every NEAR outside players paid, about **55% reached the vault, 32 to 36% paid the storage of
their own records and 11 to 13% was gas.** The vault hands back nearly all it takes in: by day 60 it held 0 to 0.31 NEAR
(medians). So the players' collective loss is almost exactly what their moves cost to store and run (in the steady
scenario they put in 156.1 NEAR and ended with 73.9), and the vault moves the rest from the colonies that die to the
colonies alive at each tide. The storage is NEAR's price for the bytes a player's own moves write (its colony record,
every planting and purchase in the permanent ledger); the contract keeps it while the records exist and nobody is paid
it. The burn is in PETRI, not NEAR: about 15% of all PETRI (153,119 of 1,000,000, median) is burned in sixty days of a
boom.

The house is not where the yield comes from. The five strains bring 2.25 to 2.42 NEAR in all, of which about 1.0
reaches the vault, and they are never paid: **0.78% to 1.71% of everything the vault paid players was the house's
NEAR; 98.3% to 99.2% was other players'.**

### The storage share is the price of full replay

The third of players' NEAR that goes to storage is a design choice, not a leak. Every planting, purchase, sale, tide,
claim, slide and pact is written into the contract's own ledger, and each colony's numbers stay in its record, so that
`scripts/verify.mjs` and `/verify` can rebuild every PETRI and every yoctoNEAR from generation 0 with nothing but NEAR
RPC: no indexer, no archive node and no trust in the team. NEAR prices that state at 1 NEAR per 100 KB, and the player
whose move writes the bytes pays for them. A small planting stores about 150 to 400 bytes (its ledger entry of 103 bytes
plus 2 a cell, its index, its cells on the board and its note; `sim/src/model.rs`), 0.0015 to 0.004 NEAR, which is why
the share is large while moves are cheap.

**A cheaper design, for later (not built).** Keep in contract state only what the rules need to run: the board, the
balances, the open pacts and a rolling history hash. Emit every movement as a NEP-297 event instead of storing it, and
chain each event into the history hash, as the board hash is chained today. A public indexer (or anyone's own, reading
receipts from an archive node or a NEAR data lake) collects the events, and a verifier replays them and checks that its
final history hash equals the one the contract holds. Storage per move would drop to a few bytes of counters, roughly
the third that storage takes now would go back into the vault or stay with players, and every move would still be
checkable. The price is the property this version was built around: replay would need an archive of receipts, not just
today's RPC, and the "Everything matches" check would trust whoever serves those receipts until someone cross-checks
them against the chained hash. Mainnet's contract can no longer change (its key was deleted on 10 November 2026), so this
would be a new dish, not an upgrade.

### After the house runs out

The strains reach the NEAR floor they keep for gas on day 6 or 7 (median) and stop buying. Nothing else changes: the
dish keeps stepping, plantings keep being priced from the agar, and tides keep running whenever a colony outside the
house has earned. After that day the vault paid 4.7 (decline) to 63.3 (steady) NEAR more, of which **0.07% to 0.17%
was the house's leftover share**: from then on a tide only moves players' NEAR between players. With the house alone
(strains only) no tide runs at all, because nobody outside the house is alive to be paid, and the house's 1.09 NEAR
stays in the vault.

### What the spread costs

The agar sells on a curve and buys back at `sell_bps` = 50% of the curve's price, never paying more than the vault's
pro-rata share for the PETRI outside the agar, and at most 10% of the vault between two tides. A 0.05 NEAR round trip:

| | boom | steady | decline | whale siege |
|---|---|---|---|---|
| PETRI bought, median day | 205 | 222 | 222 | 217 |
| The curve alone pays back | 48.9% | 48.9% | 48.9% | 48.9% |
| Back after both records' storage, day 1 | 46.9% | 46.9% | 46.9% | 46.9% |
| ... on the median day | 1.1% | 16.4% | 0.0% | 7.2% |
| ... on day 60 | 0.0% | 13.9% | 0.0% | 0.0% |

So the 50% spread is the best case. Tides pay 5% of the vault every hour to living colonies, so once a dish is busy
the vault's share, not the curve, sets the sell-back price, and PETRI held is worth little in NEAR. Gas is not counted
in these round trips. With no tide yet (and in a dish only the house plays) the allowance is zero and nothing can be
sold back at all.

### A player's first day

The median builder of the steady scenario (seed 6, joined on day 5.8): attached 0.230 NEAR (its join, 54 plantings and
top-ups) and paid 0.033 in gas; bought 210 PETRI at join; the agar fed its cells 340 PETRI; it spent 397 PETRI on
plantings; its tide shares came to 0.0177 NEAR; it sold back 0.0174 NEAR; 24 hours in it held 5 PETRI and no living
cells: **−0.227 NEAR after one day.** 0.2% of the steady scenario's builders ended their first day ahead; the card
on /coin shows the same for every kind and scenario.

## Limits

- **Scripted players are a model, not a forecast.** They never learn, and most spend their budget within a day or two
  of joining. Real players who copy the R-pentomino players, or stop playing sooner, would change the shares.
- **The simulator mirrors the contract's v6.1 book-keeping**; the live dishes run v6.5. The formulas for price, feed,
  burn, tides and the sell-back are petri-core's and unchanged since, but v6.2 to v6.5 tightened when a colony counts
  as having attached NEAR (at least `min_join` net of storage in one call) and paid credit-grown play in credit. A
  0.01 NEAR penny join would be a guest on the live dish and win no NEAR at all, so the penny player's result here is
  if anything optimistic. Players who join with 0.05 NEAR or more are not affected.
- **Gas is modelled** from NEAR's fee schedule plus an estimate of the wasm each call runs (`sim/src/model.rs`), not
  measured on chain; storage is the exact byte count of the v6.1 layout.
- **PETRI held at the end is valued at the full sell-back quote**, ignoring the 10% allowance per tide period, which
  flatters large holders.
- **The pro-rata split of payouts** is a convention for a fungible pool; the bound above (the house put about 1 NEAR
  into the vault) holds whatever the convention.
- **No sybil or idle-holder kinds** are in these five scenarios; the sybil exits are tested separately in the full
  simulator run (`sim/out-v6.1`, `cargo run --release -- out-v6.1 all --seeds 8`).
