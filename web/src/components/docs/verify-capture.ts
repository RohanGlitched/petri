// One captured run of `node scripts/verify.mjs --network mainnet`, after the mainnet key was deleted (10 November 2026,
// block 223,923,613). The docs quote it whole; README.md quotes the same run.

export const MAINNET_CAPTURE_BLOCK = 223_923_613;

export const MAINNET_CAPTURE = `Replaying petri-dish.near (mainnet) at block 223923613: 5,016 generations, 179 ledger entries, 8 colonies, 4 tides.
  match   History chain                                7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a
  match   Board hash                                   364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309
  match   Living cells                                 644
  match   Legal plantings                              79 of 79
  match   Planting prices                              79 of 79
  match   Planting fees                                79 of 79
  match   Licensed plantings: shape, holder, royalty   5 of 5
  match   Purchases on the curve                       16 of 16
  match   Sales on the curve and allowance             0 of 0
  match   Tides                                        4 of 4
  match   Claims of exactly what was owed              1 of 1
  match   Refunds tied to their payouts                0 of 0
  match   Sales for NEAR, NEAR claims and pact payments by colonies holding no kept PETRI 1 of 1
  match   Pacts kept to the rules and plantings under pacts 55 of 55
  match   PETRI held for pact offers                   0.000000
  match   Pacts                                        14
  match   Specimens                                    21 of 21 match the dish
  match   Slide holders and royalties                  21 of 21
  match   Agar                                         998,511.976885
  match   Sold                                         1,902.866626
  match   Burned                                       1,145.444160
  match   Burned by specimens                          693.000000
  match   Royalties                                    0.000000
  match   Returned to the agar                         452.444160
  match   Bought back                                  0.000000
  match   Keeper share                                 0.751533
  match   Colony earnings                              8 of 8
  match   Vault (NEAR)                                 0.483315823824356250000002
  match   NEAR paid in                                 0.57902
  match   NEAR paid at tides                           0.069395846794683562499998
  match   Vault shares, bounties as credit             0.0204367443809601875
  match   Sales paid as credit                         0
  match   Colony tide winnings                         8 of 8
  match   Credit pool                                  0
  match   Credit paid at tides                         0.0204367443809601875
  match   Credit sponsored                             0
  match   Credit spent                                 0
  match   Credit taken back                            0
  match   NEAR owed to colonies                        0.050703529764175294746139
  match   Pending NEAR                                 0
  match   Colony credit winnings                       8 of 8
  match   Colony kept PETRI                            8 of 8
  match   Solvent (NEAR held >= owed, from the ledger) yes
  match   Deployed code hash                           CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  match   Read again from rpc.mainnet.fastnear.com     chain 7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a, board 364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309, code CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  match   Read again from near.drpc.org                chain 7445e93a8bb66fdf22135f64d7da7d127fb1503719afef3c8b43bbac993a0a6a, board 364f1c5c8ec536189b1e34c05fffcb2cadea0c676304ec58db612bbb7ced5309, code CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD
  PASS    Full-access keys                             0 (nobody can deploy other code or relaunch)
Source: https://github.com/RohanGlitched/petri/tree/27a59761af835f2278b7cf28676c3acf0fdda538; built with cargo near build non-reproducible-wasm --locked in sourcescan/cargo-near:0.22.0-rust-1.99.1@sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb
16 tide generation(s) had nobody to pay and were skipped, as the rules say.
Owed, from the ledger: 0.554456097969491732246141 NEAR (vault, credit pool, unspent credit, unclaimed winnings, pending); held beyond storage: 0.730851881477340732246147 NEAR.
Everything matches. Replay took 137 ms.`;
