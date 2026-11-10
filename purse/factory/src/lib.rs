//! The factory that seals specimen slides into living slides.
//!
//! 1. `prepay` the creation cost (`create_cost`, about the purse's code size in storage) once.
//! 2. Send your slide to the factory with the dish's `nft_transfer_call`. The factory creates `slide-<id>.<factory>`
//!    in one receipt (create the account, fund its storage, deploy the purse, `init` it with you as holder) and no
//!    access key is ever added; then it moves the slide on into the new account. If anything fails, the dish gives the
//!    slide back to you and your prepayment stays yours (`refund` takes it back).
//!
//! The factory has no power over a purse once it exists: NEAR gives a parent account none over its sub-accounts, and
//! the purse's code has no method that obeys the factory after `init`.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::vec::Vec;
use purse_kit::json::{self, Out};
use purse_kit::{self as k, methods, BYTE_COST, TGAS};

/// The purse's wasm, built before the factory (see build.rs).
pub static PURSE: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/purse.wasm"));

const K_DISH: &[u8] = b"d";
/// Bytes a new purse needs besides its code: the account record (100), its starting state (about 500) and the
/// headroom its log and a listing can grow into (1,400), rounded up.
pub const PURSE_EXTRA_BYTES: u64 = 2_200;
/// The least a prepayment can be, so a stranger's prepayments cost them more than the record costs the factory.
pub const MIN_PREPAY: u128 = 10_000_000_000_000_000_000_000;
const GAS_INIT: u64 = 10 * TGAS;
const GAS_DISH_TRANSFER: u64 = 20 * TGAS;
const GAS_CALLBACK: u64 = 10 * TGAS;

fn dish() -> Vec<u8> {
    k::read(K_DISH).unwrap_or_else(|| k::fail("the factory has not been set up"))
}

fn credit_key(acc: &[u8]) -> Vec<u8> {
    let mut key = b"c".to_vec();
    key.extend_from_slice(acc);
    key
}

fn credit(acc: &[u8]) -> u128 {
    k::read(&credit_key(acc)).map(|v| k::le_u128(&v, 0)).unwrap_or(0)
}

fn set_credit(acc: &[u8], amount: u128) {
    if amount == 0 {
        k::remove(&credit_key(acc));
    } else {
        k::write(&credit_key(acc), &amount.to_le_bytes());
    }
}

pub fn cost() -> u128 {
    (PURSE.len() as u128 + PURSE_EXTRA_BYTES as u128) * BYTE_COST
}

fn purse_account(token: &[u8]) -> Vec<u8> {
    let mut a = b"slide-".to_vec();
    a.extend_from_slice(token);
    a.push(b'.');
    a.extend_from_slice(&k::current());
    a
}

fn only_self() {
    k::require(k::predecessor() == k::current(), "only the factory itself can call this");
}

methods! {
    /// Set up once, by the factory account itself: which dish's slides it seals.
    fn new() {
        k::require(k::read(K_DISH).is_none(), "the factory is already set up");
        k::require(k::predecessor() == k::current(), "only the factory account sets it up");
        let input = k::input();
        let d = json::str_arg(&input, "dish");
        k::require(k::valid_account(d), "dish must be an account id");
        k::write(K_DISH, d);
    }

    /// Pay ahead for sealing slides, for yourself or for `account_id` (at least 0.01 NEAR). Returns the credit.
    fn prepay() {
        let input = k::input();
        let me = k::predecessor();
        let who = json::get(&input, "account_id").and_then(json::plain_str).unwrap_or(&me);
        k::require(k::valid_account(who), "account_id is not a valid account id");
        let amount = k::attached();
        k::require(amount >= MIN_PREPAY, "prepay at least 0.01 NEAR");
        let total = credit(who) + amount;
        set_credit(who, total);
        let mut o = Out::new();
        o.qn(total);
        k::ret(&o.done());
    }

    /// Take back your unused prepayment.
    fn refund() {
        k::require_one_yocto();
        let me = k::predecessor();
        let c = credit(&me);
        k::require(c > 0, "you have no prepayment here");
        set_credit(&me, 0);
        let p = k::batch(&me);
        k::a_transfer(p, c + 1);
    }

    /// The dish sends a slide with `nft_transfer_call`: create its purse and move the slide into it. Returns false
    /// (keep it) once the slide is in its purse, true (give it back) otherwise.
    fn nft_on_transfer() {
        let input = k::input();
        if k::predecessor() != dish() {
            k::ret(b"true");
            return;
        }
        let sender = json::str_arg(&input, "sender_id");
        let owner = json::str_arg(&input, "previous_owner_id");
        let token = json::str_arg(&input, "token_id");
        if !k::valid_token_id(token) || sender != owner {
            k::log(b"only a slide's owner can seal it, by sending it here itself");
            k::ret(b"true");
            return;
        }
        let cost = cost();
        let have = credit(owner);
        if PURSE.is_empty() || have < cost {
            k::log(b"prepay the creation cost first (create_cost), then send the slide again");
            k::ret(b"true");
            return;
        }
        set_credit(owner, have - cost);
        let purse = purse_account(token);
        let mut init = Out::new();
        init.s("{\"dish\":").q(&dish()).s(",\"holder\":").q(owner).s("}");
        // One receipt: if any action fails, none happened, and the account never had a key.
        let p = k::batch(&purse);
        k::a_create(p);
        k::a_transfer(p, cost);
        k::a_deploy(p, PURSE);
        k::a_call(p, "init", &init.done(), 0, GAS_INIT, 0);
        let mut a = Out::new();
        a.s("{\"token_id\":").q(token).s(",\"owner\":").q(owner).s(",\"cost\":").qn(cost).s("}");
        let cb = k::batch_then(p, &k::current());
        k::a_call(cb, "on_created", &a.done(), 0, GAS_DISH_TRANSFER + GAS_CALLBACK + 5 * TGAS, 1);
        k::promise_return(cb);
    }

    fn on_created() {
        only_self();
        let input = k::input();
        let token = json::str_arg(&input, "token_id");
        let owner = json::str_arg(&input, "owner");
        if k::result(0).is_none() {
            // The purse exists already, or its creation failed: the NEAR came back here, so the credit does too.
            let cost = json::get(&input, "cost").and_then(json::uint).unwrap_or(0);
            set_credit(owner, credit(owner) + cost);
            k::log(b"the purse could not be created (it may exist already); the slide goes back");
            k::ret(b"true");
            return;
        }
        let mut a = Out::new();
        a.s("{\"receiver_id\":").q(&purse_account(token)).s(",\"token_id\":").q(token).s(",\"memo\":\"sealed into its living slide\"}");
        let p = k::batch(&dish());
        k::a_call(p, "nft_transfer", &a.done(), 1, GAS_DISH_TRANSFER, 0);
        let cb = k::batch_then(p, &k::current());
        k::a_call(cb, "on_sealed", b"{}", 0, GAS_CALLBACK, 0);
        k::promise_return(cb);
    }

    fn on_sealed() {
        only_self();
        k::ret(if k::result(0).is_some() { b"false" } else { b"true" });
    }

    // ---------- views ----------

    /// The account a slide's purse lives at.
    fn purse_of() {
        let input = k::input();
        let token = json::str_arg(&input, "token_id");
        k::require(k::valid_token_id(token), "token_id is a plain decimal id");
        let mut o = Out::new();
        o.q(&purse_account(token));
        k::ret(&o.done());
    }

    /// NEAR one sealing costs: the purse's code and state in storage, paid into the purse itself.
    fn create_cost() {
        let mut o = Out::new();
        o.qn(cost());
        k::ret(&o.done());
    }

    fn credit_of() {
        let input = k::input();
        let mut o = Out::new();
        o.qn(credit(json::str_arg(&input, "account_id")));
        k::ret(&o.done());
    }

    fn factory() {
        let mut o = Out::new();
        o.s("{\"dish\":").q(&dish()).s(",\"purse_code_bytes\":").n(PURSE.len() as u128).s(",\"create_cost\":").qn(cost()).s("}");
        k::ret(&o.done());
    }
}

#[cfg(test)]
mod tests;
