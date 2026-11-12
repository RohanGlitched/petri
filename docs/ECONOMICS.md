# Who wins, and who pays

Petri is an arcade game with a burn: **nobody extracts, and the house only pays in.** Every tide pays the vault's NEAR
to the colonies that earned that hour, so skill moves NEAR between players, and half of every planting's PETRI is
burned. This page shows, from the simulator's own runs, where players' NEAR goes, who pays the tides, and why owning
the dish does not pay.

- **The house only pays in.** The five house strains are never fed and never paid. 98.3% to 99.2% of everything the
  vault paid players was other players' NEAR; the rest was the house's own.
- **Owning the dish does not pay.** No whale, split whale or lattice locker came out ahead in any of the 40 runs, which
  matches the 1,000-season bench in [`sim/out-60d`](../sim/out-60d/README.md) (0 of 1,000 attacker seasons ahead).
- **The vault pays back what reaches it.** About 55% of every NEAR players put in reaches the vault, and the tides pay
  it back out to the colonies alive and earning: by day 60 the vault held 0 to 0.31 NEAR (medians).
- **Skill wins.** The players who come out ahead are the ones whose cells live long and wide at tide time, mostly
  R-pentomino players.

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
  all its gas. "Ahead" means that is above zero.
- **Who paid the vault's payouts.** The vault is one pool. Every NEAR that leaves it (tide shares, bounties,
  sell-backs, a tide's storage) is drawn pro rata from what is in it, so the house's part of each payout is the house's
  part of the vault at that moment. Whatever the convention, the house cannot have paid more than it put in: about 1
  NEAR in every scenario, against 59 to 133 NEAR paid out.

## Scenario by scenario

Medians over ten seeds; outside players with their own NEAR (guests aside).

| Scenario | Players | NEAR the vault paid players | Of it, the house's | Players' NEAR went: vault / storage / gas |
|---|---|---|---|---|
| boom | 5,220 | 133.43 | 0.78% | 56% / 32% / 11% |
| steady | 2,610 | 76.42 | 1.33% | 51% / 36% / 13% |
| decline | 2,610 | 65.07 | 1.47% | 57% / 32% / 11% |
| whale siege | 1,370 | 59.04 | 1.71% | 55% / 33% / 12% |

In the fifth scenario, strains only, the house plays alone and is never paid: no tide pays a house strain, and its NEAR
stays in the vault.

### Who wins

Players whose cells live long and wide at tide time, mostly R-pentomino players; tide snipers, defenders, builders and
raiders come out ahead in some runs too. The top tenth of R-pentomino players in a boom ended about +0.39 NEAR or
better on 0.5 (p90).

Owning the dish does not pay: no whale, split whale or locker came out ahead in any of the 40 runs (whales ended 1.6 to
3.0 NEAR down, median), which matches the 1,000-season bench in `sim/out-60d`. Sponsored guests risk no NEAR of their
own and win credit that stays in the dish.

### Where players' NEAR goes

Of every NEAR outside players paid, about **55% reached the vault (51 to 57%), 32 to 36% paid the storage of their own
records and 11 to 13% was gas.** The vault hands back nearly all it takes in: by day 60 it held 0 to 0.31 NEAR
(medians), having paid 59 to 133 NEAR to the colonies alive at each tide. The storage is NEAR's price for the bytes a
player's own moves write (its colony record, every planting and purchase in the permanent ledger). The burn is in PETRI,
not NEAR: about 15% of all PETRI (153,119 of 1,000,000, median) is burned in sixty days of a boom.

### The house only pays in

The five strains bring 2.25 to 2.42 NEAR in all, of which about 1.0 reaches the vault, and they are never paid: **0.78%
to 1.71% of everything the vault paid players was the house's NEAR; 98.3% to 99.2% was other players'.** The tides do
not depend on the house either: once the strains stopped buying (day 6 or 7, median), the vault paid players 4.7
(decline) to 63.3 (steady) NEAR more, at least 99.8% of it players' NEAR.

### The storage share is the price of full replay

Every planting, purchase, sale, tide, claim, slide and pact is written into the contract's own ledger, and each colony's
numbers stay in its record, so that `scripts/verify.mjs` and `/verify` can rebuild every PETRI and every yoctoNEAR from
generation 0 with nothing but NEAR RPC: no indexer, no archive node and no trust in the team. NEAR prices that state at
1 NEAR per 100 KB, and the player whose move writes the bytes pays for them. A small planting stores about 150 to 400
bytes (its ledger entry of 103 bytes plus 2 a cell, its index, its cells on the board and its note;
`sim/src/model.rs`), 0.0015 to 0.004 NEAR.

### A run on the vault

The agar sells on a curve and buys back at `sell_bps` = 50% of the curve's price, never paying more than the vault's
pro-rata share for the PETRI outside the agar, and at most 10% of the vault between two tides. One exit cannot drain the
others, and the vault's NEAR keeps going to the colonies that earn it at the tides.

## Method notes

- **The simulator steps petri-core**, whose formulas for price, feed, burn, tides and the sell-back are the ones the
  live v6.5 contract uses. It mirrors the contract's v6.1 book-keeping; v6.2 to v6.5 changed when a colony counts as
  having attached NEAR (at least `min_join` net of storage in one call), which players who join with 0.05 NEAR or more
  already meet.
- **Gas is modelled** from NEAR's fee schedule plus an estimate of the wasm each call runs (`sim/src/model.rs`);
  storage is the exact byte count of the v6.1 layout.
- **PETRI held at the end is valued at the full sell-back quote**, without the 10% allowance per tide period. That can
  only flatter large holders, and still no whale, split whale or locker came out ahead.
- **The pro-rata split of payouts** is a convention for a fungible pool; the bound above (the house put about 1 NEAR
  into the vault) holds whatever the convention.
- **Sybil attacks are measured in their own run** (`sim/out-v6.1`, `cargo run --release -- out-v6.1 all --seeds 8`):
  with the kept-PETRI rule the vault paid 0.0000 NEAR for PETRI farmed before a first NEAR (see RULES.md, Kept PETRI).
