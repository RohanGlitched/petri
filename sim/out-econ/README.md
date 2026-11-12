# Who wins and who pays, player by player

The sixty-day scenarios of [`../out-60d`](../out-60d) read one player at a time: what every outside player put in, took
out, is still owed and still holds; where the NEAR the vault paid out came from; and every player's books a day after it
joined. The write-up, with its method, is
[`docs/ECONOMICS.md`](../../docs/ECONOMICS.md).

```text
cd sim
cargo run --release -- out-econ econ --seeds 10    # 5 scenarios x 10 seeds, about 60 s on 12 threads
```

Same societies, rules (`contract/launch-rules-mainnet.json`) and seed streams as `days60`: scenario *i* runs seeds
`(600 + i) * 1000 + k` for k = 0..9, so k = 0..4 are the very runs in `out-60d`. The bookkeeping this adds to
`sim/src/world.rs` only reads the run; re-running `days60 --seeds 5` with it reproduces `out-60d/days.csv`, `web.json`
and `headline.md` byte for byte. The run also writes `web.json` to `web/src/data/whowins.json`, which /coin draws.

## Files

- `players.csv`: one row per outside player per run (a split whale's ten colonies are one player): kind, join day,
  budget, NEAR paid (attached and gas), taken out (tide NEAR claimed, sold back, bounties), owed, PETRI held valued at
  the sell-back, net in cash and at the end, tide shares, PETRI bought, fed and planted, NEAR it put into the vault.
- `day1.csv`: the same player's books 24 hours after it joined.
- `kinds.csv`: per scenario and kind: share net positive, p10 / median / p90 net NEAR and NEAR back per NEAR put in.
- `sources.csv`: per run: NEAR into the vault (all, the house's), NEAR paid to players and the house's pro-rata part of
  it, the day the house reached its floor and what was paid after, players' NEAR split into vault, storage and gas.
- `days.csv`: per run and day: the vault, those cumulative flows, and a 0.05 NEAR round trip at the day's prices.
- `who-wins-<scenario>.svg`, `where-near-went.svg`, `payout-sources.svg`: the charts.
- `web.json`: what the site draws.
