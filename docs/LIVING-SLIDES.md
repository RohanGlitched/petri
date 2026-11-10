# Living slides: NFTs that are accounts

A Petri specimen slide is a NEP-171 token in the dish contract: a patch of a colony's living cells, fixed at one
generation. **Sealing** a slide moves it into a keyless NEAR account of its own, `slide-<id>.<factory>`, called its
**purse**. From then on:

- **It owns money.** NEAR and PETRI sit in the purse. Every payout from the dish lands there, never with a person.
- **It earns.** The purse owns the slide, so the slide's licence royalties are paid into it. The purse is also a colony
  on the dish: it plants the slide's own pattern back onto the board, and its cells earn feed and tides into it.
- **It holds inventory.** It holds the sealed slide for good, plus any slides its colony mints. The holder can release
  those extra slides, but never the sealed one.
- **It carries access.** The holder alone opens the slide's darkroom on the site. Entry takes a fresh NEP-413
  signature, which the server checks.
- **It is the NFT.** Each purse is itself a one-token NEP-171 contract (NEP-177 metadata, NEP-178 approvals, NEP-199
  payouts, one-token NEP-181). Its token's id is the slide's id. Whoever holds that token is the only account that can
  make the purse act. Sell it and the account, its NEAR, its PETRI, its colony and its slide all go to the buyer at
  once.

The dish contract is untouched: the purse and its factory are separate contracts in `purse/`.

## How control passes, and what stops the old owner

Control is one field in the purse, `holder`. Every privileged method (`act`, `withdraw`, `ft_withdraw`, `release`,
`list`, `nft_approve`, `nft_transfer*`) compares the caller with `holder` in the same receipt that moves anything.
Moving the token rewrites `holder` in the same receipt too. There is no gap between the check and the effect, so it
cannot go stale. On top of that:

- **No keys.** The factory creates the account, funds its storage, deploys the purse and calls `init` with the holder,
  all in one receipt with no `AddKey`. The code cannot add a key, deploy code or delete the account.
- **Fixed payout routing.** `act` forwards only `join, rename, plant, claim, claim_pending, buy, sell, mint_slide,
  pact_accept, pact_cancel`. It cannot forward `set_payout`, `sponsor`, `pact_offer`, `ft_transfer`, `nft_approve` or
  `nft_transfer`, so the colony is always paid into the purse.
- **Listed means frozen.** While the purse is listed (on its own market or through any NEP-178 approval), nothing
  leaves it. Every change bumps its `nonce`, and `buy(nonce)` fails if the purse changed since the buyer looked.
- **Nothing in flight.** While a call the purse made is still on its way, the token cannot move.
- **Approvals do not survive a transfer.** Every transfer clears them and refunds their storage to the old holder.

The full threat model, written before the code, is in [SLIDES-THREAT-MODEL.md](SLIDES-THREAT-MODEL.md). It lists every
way a seller could try to keep the money, the rule that stops it and the test that checks it.

### Design choice

The obvious design leaves the token with the person and has the purse ask the dish who owns it before obeying. It has
three problems:

1. That check is asynchronous, so the token can move between the check and the effect.
2. Royalties would be paid to the person, not the slide's account.
3. "Listed means frozen" cannot be enforced.

Putting the slide inside the purse, and making the purse the token, removes all three.

## Proof on testnet

Factory `petri-slides.testnet` (dish `petri-v6.testnet`). Purse code hash `HRSkpLzDjnevFrwEV8B9TadHyTiYr6NoXbUyFufxXF44`,
which is sha256 `f3fe0d51…a9389` of `purse/res/petri_purse.wasm` (29,404 bytes). Both purses report **0 access keys**
(`view_access_key_list`).

| Step | Transaction |
|---|---|
| Methylene Blue seals slide 1 (prepay, then `nft_transfer_call` to the factory) | `76jyiJveYBnVcM8yeUzBkAtV96MqQcYXgXux1dVvQZsN`, `13SdLwZrERz7HkzWiCWq1z6RZoTacrnTc7JVDSdku9yG` |
| Congo Red seals slide 2 | `Kkr13mVLNBR3WymrPH7a5AMeTVCyDEQjwLhuYMVoRxr`, `6ZC59vKyTgBUGtpAKxKyN1RKzkDnioJ6xfbD5Fr5yfiw` |
| Purses 1 and 2 join the dish (colonies 23, 24) | `Brcsqs2gXuUYvi933yEhoD1JzgVZwLYgKy3AFoGpziSN`, `FvTqY2nY2xgc5dLNGkZLdmcyJkGJqeBhCpVfnTRJqgS2` |
| Each plants its own slide's pattern under its licence | `5haEKhQc4ns7Ec2ZcnsPNRjGmxwDhWKfvta12FXDUyCw`, `2PKYrmjc12G8UJ9cRmyFR1Giu4fkZxEU4itdLunJH3Gv` |
| Bench A plants slide 1's pattern; 5.653152 PETRI royalty paid **into the purse** | `EJxAxjWwALfvF3aB3cAVhKyspi7EN958SAwkLJJmc6rb` |
| Purse 1 claims its feed (and the keeper pot) | `4NaAeegmN4xLAavoQytby4FFpyh8AKhAXaP9nTfmYrEk` |
| Purse 1 passes from Methylene Blue to `petri-lab.testnet` | `DJDkq7tmKyLpiPiscDUhqpX9b43s4PqWw7iU2WSdVVJL` |
| Old holder refused: act, withdraw NEAR, withdraw PETRI, transfer back | `Dq6v1JuY2MgruuybY6cEbuYqFkk6BLErQayn1tDZF2uJ`, `DXByfnDUgUoeaSpCmsQDsPvoKCW4wfxkBj3J9GjF9q6H`, `8SojUvgkc9FQf9ubii4e1NxroUSaMNJFZFHLrnz9Qg7g`, `6ir8wZ6v8uLxQd4ue5tb5oBnHPouokXuKyCssU37W3Mj` |
| New holder withdraws 0.001 NEAR | `2MTuyYt4LkvPF12SQbPF4zT5on9uNHALhFJiaTDdNYg7` |
| New holder withdraws 6.737696 PETRI (the first try failed because the holder was not registered for PETRI; the PETRI stayed in the purse and the failure is in its log) | `4jYmr2PFRh3P8ee1tqMqp42jSJwwE7BmNJM8kecnxobk`, then `D1ru2qQdXT7wbGqtJuuvwrjaMd1GkNxFsMUm41yg9H32` |
| **Sale in the middle of a payout:** a claim and a transfer signed together; the transfer is refused while the claim is in flight, then goes through once it lands | claim `9wDjrhVudeQuJZ7PigygWVgXvH9EHMDJYPLUYzxvqGYT`, refused `DNwXbDJXwP2Rm1CEC8JwQuPXhwFFTTMwFoSiefniAHp8`, then `H91TGE69nuNb7RwSBoo6eWYDXTU75gNgKihuQjPc5sz4` |
| Purse refuses `set_payout`, `sponsor`, `nft_approve`, `ft_transfer`, `pact_offer` | `HMW6nhfVkoWfiBqnDUPzbVvKnih5UjuVrLDXBrDYfQ9y`, `9nGwMqhr6aRdqKoToTMhUReD45zavcRpBuRuxpUFtKXk`, `Dvqhp5eupn3Fz1wtcAeYXbHJ7MZoS5Wwn8fxxYU3yqud`, `EZ6oQLCa9T2Jg8RjuPZ6hHjNEhCoKyHbKsqiMxrDtoTN`, `Hyfsaoek6QB3cjoR7B9utBoNcUcCNXp3pDSf5Ykvirva` |
| Slide 2 listed at 0.01 NEAR; the seller's withdrawal and act refused while listed | `3mS2bnGpQXSSmUBZues1FdpsrRKXNcA7Trv6qTh32HRn`, `FaFBrSt2ZSe547N1rBc3ELhmxK1JNmEdtx3cBoFqLLPQ`, `8T5u3ViGBFa4sDu8pE8TdVWk3gXEmnV8FKgpVdYVNxwt` |
| Seller unlists and relists; a purchase pinned to the old nonce is refused | `EVqp7aYZjEz6BDp8yDz3nsgo56vpGKSRs3RwRBkMSH9L`, `3NCouKtYiqYqJPzYmUrMA1e6yCEKLxuam9fMLFA4edU3`, `2F8ABHd1syvEwcwtGRM9merWxnycM39diumu5DUnErdv` |
| Bench B buys at the current nonce (the price goes to the seller); the seller is refused afterwards | `BtyT5YwBabgaUrnLzALNYiwv8Jq5eUhrLYLqZC1kNwRG`, `6mT2UDMbBWsas6ufEufv32A3AopQGcn65SDipWzRrP2A` |
| The new holder claims through the purse, then passes it back to Congo Red | `BUpfpqudfbpmcvyq8iBxXFXAQAFG6mE7bhWKnbyx2Yt2`, `95Kwsbo7sUHtnqzKS5oUUsmyhDytQ2VSkeDxH5z2uWA7` |

On testnet, the house strains Methylene Blue and Congo Red hold the two living slides. A purse is not one of the
house's colonies: it is fed and shares the tides like any player's colony.

Reproduce these with `node scripts/purse-testnet.mjs keys|midpayout|handover|sale|whitelist …` and
`node agents/purse.mjs …`. The darkroom's door is tested with real NEP-413 signatures by `node agents/darkroom-test.mjs`.
The holder is admitted; another account and a tampered message are refused.

## Mainnet: one living slide, made without a factory

Mainnet has no factory. `petri-dish.near` makes the purse itself, and `scripts/purse-mainnet.mjs` does it in five steps:

1. Three house strains move 0.32 NEAR into `petri-dish.near`, so the dish's own NEAR is never used.
2. `petri-dish.near` sends **one transaction** to `slide-14.petri-dish.near`: create the account, fund its storage
   (0.316 NEAR), deploy `purse/res/petri_purse.wasm`, and call `init` with the dish and the holder. There is no
   `AddKey` action.
3. The holder, Congo Red, sends slide 14 in with a plain `nft_transfer`.
4. The purse joins the dish with 0.015 NEAR that Congo Red attaches.
5. The purse plants the slide's own pattern under its licence.

The script stops before any step that would take the spend past 0.40 NEAR, or leave a strain under 0.30 NEAR. It prints
each transaction's hash and cost, the purse's access keys, and `petri-dish.near`'s key nonces afterwards.

**The slide.** Slide 14 is Congo Red's 45-cell specimen from generation 3,817. Alone on an empty dish, the engine keeps
it at 45 living cells through generations 250, 500, 750 and 1,000: the pattern lives on its own. Malachite Green's
43-cell slide 13, by contrast, falls to 3 cells within 50 generations.

**Expected cost:** storage 0.316 + join 0.015 + planting 0.011 + gas under 0.01, about 0.35 NEAR in all.

On mainnet the site uses `petri-dish.near` as the parent account, so a mainnet slide counts as living once
`slide-<id>.petri-dish.near` owns it. The mainnet house strains tend it (`tendPurses`, with `PETRI_LIVING_SLIDES=1`):
they replant its pattern if its colony dies, and claim its tides.

Proof: pending. The transactions are listed here once the script has run.

## Build and test

```
cd purse && cargo test                                         # 16 purse + 5 factory + 2 JSON tests
WASM_OPT=<binaryen wasm-opt> ./build.sh                        # res/petri_purse.wasm, res/petri_purse_factory.wasm
```

The purse is written without near-sdk, against NEAR's host functions, to keep its code small: every purse carries its
own copy, and mainnet storage costs 1 NEAR per 100 KB. Native tests run the contract's own code against a mock chain
(`purse/kit/src/mock.rs`), in which a failed call rolls back as it would on chain.

## Cost on mainnet

| Item | NEAR |
|---|---|
| One purse: its code (29,404 bytes) and state, locked in the purse as storage (`create_cost`) | 0.316 |
| The factory: its code (42,459 bytes, purse embedded) and state, once | about 0.43 |
| The purse joins the dish (`min_join`) and plants its slide (`plant_deposit`, about 0.01) | about 0.02 |
| Gas for the six or so transactions | under 0.01 |

- **Through a factory:** about 0.78 NEAR for the first living slide, and 0.34 for each one after.
- **Without a factory:** the purse checks only that `init` comes from its parent account. A parent account with a key
  (for example `petri-dish.near` before its key is deleted) can create `slide-<id>.<parent>` directly, in one
  transaction (create, fund, deploy, `init`, with no key), and the holder then sends the slide in with a plain
  `nft_transfer`. That costs about 0.34 NEAR per slide with no factory: one slide fits the ~0.55 NEAR budget, two do
  not.
- **A NEAR global contract** would deploy the code once and let each purse reference it. Under NEP-591, global contract code is
  charged at ten times the storage rate, and that NEAR is burned, about 2.9 NEAR for this code, so it only pays off beyond about ten purses.
