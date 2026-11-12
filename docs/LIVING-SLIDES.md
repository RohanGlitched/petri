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
- **It pays its minter.** Purses sealed through the v2 factory pay the colony account that minted the slide 5% of every
  sale, as the dish's own NEP-199 payouts do for its slides: through a marketplace (`nft_payout`,
  `nft_transfer_payout`) and on the purse's own market (`buy`). The minter is fixed when the slide is sealed, read from
  the dish. A minter that sells keeps the whole price.

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
- **The minter is the dish's, not the seller's.** The v2 factory asks the dish's own `nft_payout` who minted the slide
  while it holds the slide, and names that account at `init`. No method changes it afterwards.

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
`node agents/purse.mjs …` (`payout <token>` shows how a sale splits now). The darkroom's door is tested with real NEP-413 signatures by `node agents/darkroom-test.mjs`.
The holder is admitted; another account and a tampered message are refused.

## Purse v2: the minter's royalty and a keyless factory

Two changes, made before the dish's full-access key was deleted (10 November 2026, after this run), and nothing else
in the purse changed:

1. **The minter's royalty.** `init` takes a third account, `minter`. `nft_payout` and `nft_transfer_payout` split a
   sale's `balance` as the dish splits its own slides' sales: `balance / 20` (500 bps, rounded down as the dish rounds
   it) to the minter, the rest to the holder who sells, and all of it to the holder when that is the minter or the cut
   rounds to nothing. A marketplace that pays fewer accounts than the split names (`max_len_payout`) is refused. The
   purse's own `buy` pays the same split. The `purse` view shows `minter` and `royalty_bps`.
2. **A factory with no key.** The factory's `new` may now be called by its parent account as well as by itself, so the
   parent can create `slides.<dish>`, fund it, deploy the factory and set it up in **one transaction with no
   `AddKey`**. Nobody can then change how it makes purses. When a slide arrives (`nft_transfer_call`), the factory asks
   the dish's `nft_payout` for the slide (it owns the slide at that moment, so the split names the minter beside the
   factory), then creates `slide-<id>.slides.<dish>` with `init { dish, holder, minter }` exactly as before: create,
   fund, deploy, `init`, no key. The prepayment is charged only once the dish has answered; if the answer fails or
   names nobody else, the slide goes back and nothing is charged.

| Build (binaryen version_117, `-Oz`) | Bytes | SHA-256 | NEAR code hash (base58) |
|---|---|---|---|
| `purse/res/petri_purse.wasm` | 30,879 | `a6c3e43447a3367875cdda5b08412ff0673f337648682a361400dc4c938e9aaf` | `CDyvfMn9zQJyArwxrY3ASaASoEHH8JTp5S7uC8ShziCe` |
| `purse/res/petri_purse_factory.wasm` (purse embedded) | 46,071 | `4170d5e59a1812f0c4284f5cfaa1eab0a2fa74d385ef8ef4965cd77251ec8ee3` | `5QTHyZ64eudxyGctrqdwbKiUvZK8oMnpWELzdyD2SG2N` |

A clean build in a fresh target directory gives the same bytes. The v1 purses (`slide-1`, `slide-2.petri-slides.testnet`
and `slide-14.petri-dish.near`, code `HRSkpLzD…`) keep their code: a purse's code is immutable, and they pay a sale's
whole price to the seller.

### Proof on testnet, 10 November 2026

The same script that will run on mainnet, `node scripts/purse-mainnet-v2.mjs send --network testnet`. The factory
`slides.petri-v6.testnet` and the purse `slide-24.slides.petri-v6.testnet` both report **0 access keys**, and their code
hashes are the two above. The team bench here is the implicit account `9e0f14b0…c5b7c5e`, which is not a house account.
`petri-guests.testnet` stands in for the mainnet keeper as the funder.

| Step | Signer | Transaction | NEAR spent |
|---|---|---|---|
| The funder moves the factory's storage and gas to the dish account (moved, not spent) | `petri-guests.testnet` | `F1rz32GEbREVdki45Rdzg6RbcRaVjKeJEVtEqJrsvjM8` | 0.000044 |
| `petri-v6.testnet` creates `slides.petri-v6.testnet`: create, fund 0.470710 NEAR, deploy the factory, `new`; no key | `petri-v6.testnet` | `DtPaL8KvN4ssssNn7M49WsS6BuJWwrP393qCB8MrL5qR` | 0.478481 |
| The bench joins the dish with 0.023820 NEAR (intent_minimum + 0.002): colony 42, **attached** | bench | `DyUUEVnVcReraANNpGeCbqmNMxbkbHb3J9JvAEJkaUTU` | 0.025377 |
| The bench plants a dead spark coil (18 cells, a still life) | bench | `42TUnr8GRKsirwns3TkHr1v83FmFWUa7otDtcjrCqHbK` | 0.007208 |
| The bench mints slide 24 of it (18 cells) | bench | `FFT1ZmwmKivC5h4rPT91YaGtBZocdqoMeYmhEA8og57E` | 0.008049 |
| The bench prepays the factory's `create_cost` (0.330790 NEAR) | bench | `6vsaTM87ywSpc56nxk7Pya5VVn1BY1vvwSnrP7ewQHtj` | 0.330935 |
| The bench seals slide 24: the factory reads the minter from the dish and creates `slide-24.slides.petri-v6.testnet`, holder and minter the bench | bench | `Fy2XHptDhpB8yfWPaVNk6jkNyqYs2TK8vN3RQnCNqY9E` | 0.009389 |
| The purse joins with 0.022220 NEAR: colony 43 "Living slide 24", **attached** | bench | `vMpUkHDNJGQyZGk1tbkUz2EM2fuKxgP1oScxskERjqr` | 0.023265 |
| The purse plants its slide's 18 cells under its licence | bench | `DguacUfafmPtmzPMJ3Bo3ynQB6fss9kQ6Hus86UTd6wk` | 0.007822 |
| The purse claims the feed its cells earned: 1.338192 PETRI into the purse | bench | `49KfuUoVmNQEPznF28mkvSo9UePu8cKnNVJkLzZh61af` | 0.001238 |
| **The minter's royalty:** the bench passes the purse to Bench A | bench | `DbKu55eXmptbetkqtzWJE2iJuywuWPUmBBhcUrdwPGbe` | |
| Bench A lists it at 0.02 NEAR (`nft_payout` now names the bench 0.001, Bench A 0.019) | `petri-bench-a.testnet` | `2od6RP3aUtKt7xMfpaAi25cghJttUxzZeksHUsE2ECdM` | |
| Bench B buys it: the purse pays **0.001 NEAR to the minter** and 0.019 to the seller | `petri-bench-b.testnet` | `5LGNe5aP2peH1CCBtktnoqqhfWoimUuUbTWCCUUpGVHF` | |
| Bench B passes it back to the team bench | `petri-bench-b.testnet` | `DhkmytoMFFUH6mQbStLgCFkxZFNbUavLtaK1zMzFAinR` | |

The four NEAR moves from the funder to the bench (0.09, 0.01, 0.25, 0.19 NEAR) are left out of the table. Spent in
all: 0.893915 NEAR, of which 0.801500 is storage now locked in the factory and the purse. Both colonies kept 18 living
cells. Run `node scripts/purse-mainnet-v2.mjs status --network testnet` to read them live.

## Mainnet: the first living slide, made without a factory

The first mainnet purse came before the factory: `petri-dish.near` made it itself, and `scripts/purse-mainnet.mjs` did it in five steps:

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

The site counts a mainnet slide as living once `slide-<id>.petri-dish.near` (or, since v2,
`slide-<id>.slides.petri-dish.near`) owns it. Until the v2 run below, slide 14's holder is Congo Red, a house strain.
The strains' runner has no code path that drives a purse (on mainnet each strain signs with a full-access key of its own
account, held on the team's VM, and the runner only sends dish calls); the v2 run handed slide 14 to the team bench.

Proof, 10 November 2026 (mainnet; every account below can be checked on any explorer):

| Step | Signer | Transaction | NEAR |
|---|---|---|---|
| Three strains move the purse's storage into `petri-dish.near` (0.16 + 0.13 + 0.03 NEAR, moved, not spent) | methylene, safranin, violet `.petri-dish.near` | (three transfers) | gas only |
| `petri-dish.near` creates `slide-14.petri-dish.near`: create, fund 0.31604 NEAR, deploy the purse, `init` with Congo Red as holder, no key ever added | `petri-dish.near` | `FFyXQGq413Y2d8CyHjJkftQ7ozpJjMyoMStCfkDsAr7J` | 0.323692 |
| Congo Red sends slide 14 into its purse | `congo.petri-dish.near` | `39nNhzovv4jsWvkYHi41R8FF2sP2WGCGkSaUeTp9y8Ne` | 0.000297 |
| The purse joins the dish as its own colony ("Living slide 14") | `congo.petri-dish.near` | `53CojkigLHHVL9t6qUEvjNjZobfG4cd6R7PTipjohhCX` | 0.016668 |
| The purse buys the PETRI the planting still needed | `congo.petri-dish.near` | `GLLZ74XchqtFm3xiYURmDpeH4oEcaejaERnBMTm65WTu` | 0.005031 |
| The purse plants its slide's 45-cell pattern | `congo.petri-dish.near` | `Df4SYSysAqSaSXYonu93aTHCjG2Etqh7SXUzxAYSKrXg` | 0.012246 |

`slide-14.petri-dish.near` has 0 access keys (`view_access_key_list`), and the dish's `slide` view names it as slide 14's owner.

**What slide 14 earns.** Its holder, the team bench, attached slide 14's colony with NEAR and planted its 45-cell
pattern again at generation 4,896. The dish's `colonies` view says `attached: true` for colony 6, so its tide shares are
paid in NEAR: by generation 5,346 it had won 0.0155 NEAR at the tides (`tide_winnings`), and its holder had claimed it.
The testnet purses `slide-1` and `slide-2.petri-slides.testnet` are attached and earn the same way.

## Mainnet v2: done on 10 November 2026

`scripts/purse-mainnet-v2.mjs send` ran on mainnet on 10 November 2026, after `plan` (read-only) showed every step,
signer and cost. It spent 0.392 NEAR (and moved 0.45 NEAR from the keeper to the bench) in 11 transactions. Afterwards:
`slides.petri-dish.near` (factory), `slide-18.slides.petri-dish.near` (purse) and `slide-14.petri-dish.near` each have
**0 access keys**; the bench (colony 7, "Team bench") and the purse (colony 8, "Living slide 18") are both **attached**
with 18 living cells each; the purse's minter royalty is 500 bps; and the mainnet dish paid its first tide.

1. `keeper.petri-dish.near` moves the factory's storage and gas (0.480710 NEAR) into `petri-dish.near`, so the dish's
   own NEAR is not used.
2. `petri-dish.near` creates **`slides.petri-dish.near`** in one transaction: create, fund 0.470710 NEAR, deploy
   `purse/res/petri_purse_factory.wasm`, `new { dish: "petri-dish.near" }`. No `AddKey`: the factory never has a key.
3. The team bench, the implicit account `58135f2e727a40755df38f1d231aca159ea4ab138260b8d0d9419da63f999932` (not a house
   account), joins the dish as "Team bench" with `intent_minimum` + 0.002 NEAR (0.023820 NEAR today), so its colony
   is **attached**, and plants a dead spark coil: an 18-cell still life (`licence_min_cells` is 12) that the engine keeps
   at 18 cells for 1,000 generations alone.
4. The bench mints a slide of it, prepays the factory's `create_cost` (0.330790 NEAR) and seals it with
   `nft_transfer_call`: the factory creates the keyless purse `slide-<id>.slides.petri-dish.near`, holder and minter
   the bench.
5. The purse joins with `intent_minimum` + 0.002 NEAR (0.022320 NEAR today), so it is **attached**, and plants its own
   slide's pattern under its licence. A keyless account then earns feed, tide NEAR and royalties on mainnet.
6. Congo Red hands `slide-14.petri-dish.near` to the bench with the purse's own `nft_transfer`, so no house account holds
   a fed colony's purse.

The keeper funds the bench as each step needs it. The script stops before any step that would take the NEAR spent past
1.4, leave the keeper under 0.9 NEAR, the bench under 0.02 or another signer under 0.05. It prints every
transaction's hash and cost, the access keys of the factory and both purses (0 each), and `petri-dish.near`'s key
nonce afterwards.

**Expected cost** (the `plan` output on 10 November): about 0.898 NEAR spent: the factory's storage 0.4707 and the
deploy's gas (about 0.008), the purse's storage 0.3308, two joins (0.0238 and 0.0223), two plantings (about 0.0065
each), the slide (about 0.0066) and gas. About 0.48 NEAR moves to `petri-dish.near` and up to about 0.56 to the bench,
whose peak need includes the 0.2 NEAR a 200 TGas seal holds back while it runs; it keeps roughly 0.2 NEAR afterwards for
tending.

| Step | Signer | Transaction |
|---|---|---|
| Keeper moves 0.480710 NEAR into `petri-dish.near` for the factory | `keeper.petri-dish.near` | `4Vrq6YfEwPnvosWeyjQ9NJBcvUbpZhjaDtqffFWuWTbU` |
| `petri-dish.near` creates `slides.petri-dish.near`: create, fund, deploy, `new`; no key | `petri-dish.near` | `D7cJhZC4KPLaXPsb7hpbXBqGv3KViZQLqwYsMoyyWta7` |
| Keeper funds the bench's join (0.01 NEAR) | `keeper.petri-dish.near` | `DA2UE29iWrnPZLZyxQLA4SmELpiK5awi1THQbviBvC9p` |
| The bench joins attached as "Team bench" (colony 7) | `58135f2e…` | (sent during an RPC timeout; the colony and its join are on chain) |
| Keeper funds the planting | `keeper.petri-dish.near` | `GHbn6qUzgUobybnRGt4MxJc19oAvGJyhenbBbSaw88wp` |
| The bench plants the dead spark coil at (15, 33) | `58135f2e…` | `AgrqHiDZ7MYeCYsMR3k6JFQ6HXCmWqXXzfJB119Vt1qG` |
| Keeper funds the slide | `keeper.petri-dish.near` | `7STpo8fUJnqw3uDki6zifyu9oBKHXRjjxaxV6JEys9MV` |
| The bench mints slide 18 (18 cells) | `58135f2e…` | `AeysXYGPfuSHnv3xGq3izu5KFGeAWgdgwP6LK8wuTSKb` |
| Keeper funds the factory's create_cost | `keeper.petri-dish.near` | `Hp8y824n2ARUMcvP5fqJLYztiUXxhawgUyjedFSKErHF` |
| The bench prepays 0.330790 NEAR to the factory | `58135f2e…` | `C2amuRexrriZEHopZVrBbeVoyKjLd9Fyvqj699KLWbUp` |
| Keeper funds the gas the seal holds back | `keeper.petri-dish.near` | `DmQMJ16MUGyoodhA6b2tSC7NizyWWjVXqm4prR8wqAF2` |
| The bench seals slide 18: the factory creates `slide-18.slides.petri-dish.near` (no key) | `58135f2e…` | `5VezJ4smUuLTwu1e1wkrQ23BDZQ2z29fPh6AmQznY7Hd` |
| The purse joins attached as "Living slide 18" (colony 8) | `58135f2e…` | `HvDfKKnXB389c1izJEUcQSCvb9gADP1BT767GQV1M7aX` |
| The purse plants its slide's 18 cells under its licence at (92, 63) | `58135f2e…` | `AvxVvFAqmrxPVmwQvbAXjaT1uazFbugcUCFA8882QuZG` |
| Congo Red hands `slide-14.petri-dish.near` to the bench | `congo.petri-dish.near` | `7SaN9XmYh5inPpZydA9Bxrd71UV2z8c2weNoHyARv39c` |

`petri-dish.near`'s full-access key nonce after the run: 222916366000046 (the baseline `scripts/verify.mjs` reports
against). Later that day its holder attached slide 14's colony with NEAR and replanted its pattern (generation 4,896),
so its tide shares are paid in NEAR.

## Build and test

```
cd purse && cargo test                                         # 18 purse + 6 factory + 2 JSON tests
WASM_OPT=<binaryen wasm-opt> ./build.sh                        # res/petri_purse.wasm, res/petri_purse_factory.wasm
```

The purse is written without near-sdk, against NEAR's host functions, to keep its code small: every purse carries its
own copy, and mainnet storage costs 1 NEAR per 100 KB. Native tests run the contract's own code against a mock chain
(`purse/kit/src/mock.rs`), in which a failed call rolls back as it would on chain.

## Cost on mainnet

| Item | NEAR |
|---|---|
| One v2 purse: its code (30,879 bytes) and 2,200 bytes for its record, state and headroom, locked in the purse (`create_cost`) | 0.331 |
| The v2 factory: its code (46,071 bytes, purse embedded) and 1,000 bytes for its state, once; its deploy burns about 0.008 of gas | 0.471 |
| The purse joins the dish attached (`intent_minimum`, about 0.022) and plants its slide (`plant_deposit`, about 0.007) | about 0.03 |
| Gas for the six or so transactions | under 0.01 |

- **Through a factory:** about 0.85 NEAR for the first living slide, and 0.37 for each one after.
- v1 (slide 14): a purse of 29,404 bytes, `create_cost` 0.316 NEAR.
- **Without a factory:** the purse checks only that `init` comes from its parent account. A parent account with a key
  (for example `petri-dish.near` before its key was deleted on 10 November 2026) can create `slide-<id>.<parent>` directly, in one
  transaction (create, fund, deploy, `init`, with no key), and the holder then sends the slide in with a plain
  `nft_transfer`. That costs about 0.34 NEAR per slide with no factory.
- **A NEAR global contract** would deploy the code once and let each purse reference it. Under NEP-591, global contract code is
  charged at ten times the storage rate, and that NEAR is burned, about 2.9 NEAR for this code, so it only pays off beyond about ten purses.
