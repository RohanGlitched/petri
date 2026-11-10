# Living slides: the threat model for a transfer

Written before the code. The question: when a living slide changes hands, **how could the seller try to keep the
money, the cells or the control?** Each answer names the rule that stops it and the test that checks it
(`purse/contract/src/tests.rs`, `purse/factory/src/tests.rs`, and the testnet run in `scripts/purse-testnet.mjs`).

## What a living slide is

A specimen slide is a NEP-171 token in the dish contract. Sealing it moves it into a new account of its own,
`slide-<id>.<factory>`, the **purse**:

- The factory creates the purse in **one receipt**: create the account, fund its storage, deploy the purse code, `init`
  it with the sealer as holder. No action adds an access key, so the account never had one. The purse code has no
  method that adds a key, deploys code or deletes the account.
- The purse **owns the slide** on the dish, so the slide's licence royalties are paid into it.
- The purse can **join the dish as a colony** (its holder has it call `join`, then `plant`), so its living cells earn
  feed and tides, paid into it.
- The purse is **its own one-token NEP-171 contract** (NEP-177 metadata, NEP-178 approvals, NEP-199 payouts, a one-token
  NEP-181). Its token's id is the slide's id. Whoever holds that token is the purse's `holder`.

Control is one field, `holder`, inside the same contract as the money it guards. Every privileged method compares the
caller with `holder` in the same receipt that moves anything. Transferring the token rewrites `holder` in the same
receipt too. There is no gap between the check and the effect, so it cannot go stale.

### Why not leave the NFT with the person and have the purse ask the dish who owns it?

That was design A: the person holds the dish token, and the purse calls `nft_token` on the dish before obeying. It was
rejected for three reasons:

1. **The check is asynchronous.** The purse would read the owner in one receipt and act in a later one. The token can
   move in between, so a seller's withdrawal checked just before a sale lands just after it. Re-checking in the
   callback only moves the gap.
2. **Royalties would miss the purse.** The dish pays a licence royalty to the slide's owner. Under A that is the person,
   so the slide's account would never earn its own royalties.
3. **"Listed means frozen" cannot be enforced.** The purse could not know synchronously that a marketplace holds an
   approval on the dish token.

Design B, where the purse holds the slide and is itself the token, has none of these gaps. What it costs: the dish token
is sealed for good, and the token that trades is the purse's own. That token is a standard NEP-171 token, so
marketplaces can list it through NEP-178 and NEP-199. The purse also has a small market of its own (`list`, `buy`).

## The seller's attacks

| # | The seller tries to | What stops it | Test |
|---|---|---|---|
| T1 | Keep using the purse after selling (plant, claim, withdraw NEAR or PETRI, list, transfer) | Every privileged method requires `predecessor == holder`, checked and changed in the same receipt. After the sale the seller is not the holder. | `the_old_holder_keeps_nothing_after_a_transfer` |
| T2 | Keep an access key on the purse | No key was ever added. Creation is one receipt with no `AddKey`, and the code cannot add one. Anyone can check with `view_access_key_list`, which must return an empty list. The site and `scripts/purse-testnet.mjs` check it live. | testnet run: `keys = 0` for each purse |
| T3 | Redirect the colony's payouts to themselves (`set_payout`) before selling | `act` forwards only `join, rename, plant, claim, claim_pending, buy, sell, mint_slide, pact_accept, pact_cancel`. `set_payout` is not on the list, so the colony is always paid into the purse. | `act_forwards_only_whitelisted_dish_calls` |
| T4 | Sell in the middle of a payout and pocket the payout | Money is paid to the **account**, never to a person. A dish claim lands NEAR in the purse, and that belongs to whoever holds the purse when it lands. While a call the purse made is in flight (`act`, `withdraw`, `ft_withdraw`, `release`), the token cannot be transferred or bought, so a buyer never takes over half a payout. A flight record whose callback never came back stops blocking after 600 blocks. | `a_sale_waits_for_calls_in_flight`, `a_stuck_flight_record_expires`; testnet: claim then sale |
| T5 | Drain the purse while a sale is pending | A listed slide (on its own market, or with any NEP-178 approval) refuses `withdraw`, `ft_withdraw`, `act` and `release`. To drain it the seller must unlist, and every change bumps the purse's `nonce`. `buy(nonce)` fails if the purse changed since the buyer looked, so the buyer pays only for what they saw. | `a_listed_slide_moves_nothing_out` |
| T6 | Keep a NEP-178 approval for an account of their own, then take the token back after the sale | Every transfer clears every approval and refunds their storage to the old holder. A cleared approval id can never match again: ids only increase. | `approvals_never_survive_a_transfer` |
| T7 | Re-run `init`, or have the factory re-make the purse with themselves as holder | `init` runs once, and only from the parent account (the factory). The factory creates an account only if none exists. If the account already exists, creation fails, the slide goes back and the prepayment is refunded. | `setup_once_by_the_factory_only`, `a_failed_creation_gives_the_slide_and_the_credit_back` |
| T8 | Approve themselves on the **dish** token from inside the purse, then lift the slide out later | `act` cannot call `nft_approve` or `nft_transfer` on the dish. `release` refuses the purse's own slide: it stays sealed. | `act_forwards_only_whitelisted_dish_calls`, `its_own_slide_stays_sealed` |
| T9 | Move value out through the dish under cover of play: sponsor their own account, offer a pact that pays their colony, `ft_transfer` PETRI | Not forwardable (`sponsor`, `pact_offer`, `ft_transfer`, `ft_transfer_call`, `storage_withdraw`, `storage_unregister`). PETRI leaves only through `ft_withdraw`, which pays the holder only. A holder may still play badly (plant on a rival's ground, burn PETRI on slides), but only while it is the holder. While the slide is listed it cannot act at all. | same |
| T10 | Strand the purse so nobody can use it (send its token to the purse itself, the factory, the dish, or an invalid id) | Transfers to those are refused. | `nobody_can_be_made_holder_who_could_not_use_it` |
| T11 | Grief its storage, so the purse cannot pay for its state, or a later holder pays for the seller's records | Approvals are capped at 4, and each is paid by the holder who grants it. The history is a 12-entry ring, so state stays within the headroom paid at creation. `withdraw` never takes the storage and that headroom. Only the dish's own slides are accepted by `nft_on_transfer`. Factory prepayments start at 0.01 NEAR, more than their record costs. | `storage_stays_bounded`, `withdraw_pays_the_holder_and_keeps_storage_paid`, `prepay_and_refund` |
| T12 | Race the callbacks (reentrancy) | NEAR has no synchronous reentrancy. Each callback (`on_act`, `on_done`, `nft_resolve_transfer`) checks `predecessor == current account`. None of them trusts what it is passed beyond writing the history and freeing the flight record. A returned `nft_transfer_call` gives the token back only if the receiver still holds it. | `transfer_call_returns_the_token_when_the_receiver_refuses` |
| T13 | Sell without paying the slide's minter its royalty (v2 purses), or name themselves the minter when sealing | Every sale route pays the split: `nft_payout` and `nft_transfer_payout` name the minter's 5% beside the seller, a marketplace that pays fewer accounts than the split names is refused (`max_len_payout`), and the purse's own `buy` pays the minter itself. The minter is not the sealer's to choose: the factory reads it from the dish's own `nft_payout` while it holds the slide and passes it to `init`, which runs once. A plain `nft_transfer` with the price paid elsewhere skips it, as it skips any NEP-199 royalty, the dish's included. | `every_sale_pays_the_minter_its_royalty`, `the_minter_selling_keeps_the_whole_price`, `a_marketplace_sale_through_nep_199`, `the_purse_is_made_with_the_minter_the_dish_names`; testnet: slide 24's sale paid its minter 0.001 of 0.02 NEAR |

## What the buyer should still check (encumbrances that are visible, not hidden)

- **Sponsored credit is not the purse's.** A sponsor (possibly the seller) can reclaim dish credit it gave the purse
  after a day unused (`unsponsor`). Credit the colony *won* is its own. The slide page shows the two apart.
- **Pacts the purse accepted bind it** not to plant near the offering colony until their `until` generation. That is at
  most `pact_max_gens`, and they paid PETRI into the purse. `pacts_of(<purse>)` shows them before you buy.
- **Kept PETRI.** A colony that played only on credit holds kept PETRI, which the dish will not sell for NEAR.
- **The holder decides the play.** The house strains plant through their purses. A new holder can stop or change that.

## What is not covered

- A slide sent by **plain** `nft_transfer` to a purse address that does not exist yet ends up owned by an account
  nobody controls. Sealing always goes through `nft_transfer_call` to the factory. The site does that, and the docs
  say so.
- If creating the purse succeeds but moving the slide into it fails (it should not, since the factory owns the slide
  at that moment), the slide goes back to its owner and the empty purse stays theirs. They can send the slide to it by
  plain transfer.
- The purse's code is immutable. A bug in it cannot be patched in place, and new purses get new code only from a new
  factory.
- The factory account itself: the v1 testnet factory `petri-slides.testnet` keeps its key. The v2 factories,
  `slides.petri-v6.testnet` and (once created) `slides.petri-dish.near`, never had one: their parent created, funded,
  deployed and set them up in one transaction with no `AddKey`, so nobody can change how they make purses. Existing
  purses never depend on the factory.
- v1 purses (slide 14 on mainnet, slides 1 and 2 on testnet) have no minter's royalty: their code is immutable, and a
  sale pays the seller the whole price.
