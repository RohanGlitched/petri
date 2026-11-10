//! A living slide: the keyless account a Petri specimen slide is sealed into.
//!
//! The factory creates `slide-<id>.<factory>` with this code and no access key, sends it slide `<id>` from the dish,
//! and names the account that sealed it as the first holder. From then on:
//!
//! - The purse is the slide's owner on the dish, so the slide's licence royalties are paid into it.
//! - The purse is a colony on the dish (once its holder has it `join`), so its living cells earn feed and tides into it.
//! - The purse is a one-token NEP-171 contract (with NEP-178 approvals and NEP-199 payouts). Its token is the slide's
//!   id; whoever holds that token is the only account that can make the purse act, and moving the token moves
//!   everything at once: the NEAR, the PETRI, the colony and the slide.
//!
//! Control lives in one field of this contract, `holder`, checked and changed in the same receipt as everything it
//! guards, so no check can go stale between a holder and the money. The account has no key and no method that adds
//! one, deploys code or deletes it. See docs/SLIDES-THREAT-MODEL.md for every way a seller could try to keep access,
//! and what stops each one.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::vec::Vec;
use purse_kit::json::{self, Out};
use purse_kit::{self as k, methods, BYTE_COST, TGAS};

const K_DISH: &[u8] = b"d";
const K_HOLDER: &[u8] = b"h";
const K_NONCE: &[u8] = b"n";
const K_PRICE: &[u8] = b"p";
const K_APPROVALS: &[u8] = b"a";
const K_FLIGHT: &[u8] = b"f";
const K_STATS: &[u8] = b"s";
const K_LOG: &[u8] = b"l";

pub const MAX_APPROVALS: usize = 4;
pub const LOG_MAX: usize = 12;
/// Blocks after which a call still marked in flight no longer holds the slide still (about ten minutes).
pub const BUSY_BLOCKS: u64 = 600;
/// Bytes of storage never withdrawn: what the log, a listing and the flight record can still grow to.
pub const HEADROOM: u64 = 1_400;
const GAS_CALLBACK: u64 = 10 * TGAS;
const GAS_DISH_MIN: u64 = 30 * TGAS;
const GAS_FT: u64 = 20 * TGAS;
const GAS_ON_TRANSFER: u64 = 15 * TGAS;
const GAS_RESOLVE: u64 = 15 * TGAS;

/// The dish calls a holder may make as the purse. Everything that could hand the purse's money, its slide or its
/// payouts to another account is left out: `set_payout`, `sponsor`, `pact_offer`, `ft_transfer*`, `nft_transfer*`,
/// `nft_approve`, `storage_withdraw`, `storage_unregister`. The holder takes money out with `withdraw` and
/// `ft_withdraw`, which pay the holder only.
pub const ACTS: &[&str] = &["join", "rename", "plant", "claim", "claim_pending", "buy", "sell", "mint_slide", "pact_accept", "pact_cancel"];

pub const LOG_SEAL: u8 = 1;
pub const LOG_TRANSFER: u8 = 2;
pub const LOG_SALE: u8 = 3;
pub const LOG_NEAR_OUT: u8 = 4;
pub const LOG_PETRI_OUT: u8 = 5;
pub const LOG_RELEASE: u8 = 6;
pub const LOG_RETURNED: u8 = 7;
pub const LOG_FAILED: u8 = 8;

// ---------- state ----------

fn token_id() -> Vec<u8> {
    let me = k::current();
    let label = me.split(|&c| c == b'.').next().unwrap_or(&[]);
    match label.strip_prefix(b"slide-") {
        Some(t) if k::valid_token_id(t) => t.to_vec(),
        _ => k::fail("a purse lives at slide-<token id>.<factory>"),
    }
}

fn factory() -> Vec<u8> {
    let me = k::current();
    match me.iter().position(|&c| c == b'.') {
        Some(i) => me[i + 1..].to_vec(),
        None => k::fail("a purse is a sub-account of its factory"),
    }
}

fn dish() -> Vec<u8> {
    k::read(K_DISH).unwrap_or_else(|| k::fail("this purse has not been set up"))
}

fn holder() -> Vec<u8> {
    k::read(K_HOLDER).unwrap_or_else(|| k::fail("this purse has not been set up"))
}

fn only_holder() -> Vec<u8> {
    let h = holder();
    k::require(k::predecessor() == h, "only the slide's holder can do that");
    h
}

fn only_self() {
    k::require(k::predecessor() == k::current(), "only the purse itself can call this");
}

fn nonce() -> u64 {
    k::read_u64(K_NONCE)
}

/// Anything a buyer would care about changed: a pinned `buy` fails.
fn bump() {
    k::write(K_NONCE, &(nonce() + 1).to_le_bytes());
}

struct Approvals {
    next: u64,
    list: Vec<(Vec<u8>, u64)>,
}

fn approvals() -> Approvals {
    let v = k::read(K_APPROVALS).unwrap_or_default();
    if v.len() < 8 {
        return Approvals { next: 0, list: Vec::new() };
    }
    let next = k::le_u64(&v, 0);
    let mut list = Vec::new();
    let mut i = 8;
    while i < v.len() {
        let n = v[i] as usize;
        list.push((v[i + 1..i + 1 + n].to_vec(), k::le_u64(&v, i + 1 + n)));
        i += 1 + n + 8;
    }
    Approvals { next, list }
}

fn store_approvals(a: &Approvals) {
    let mut v = a.next.to_le_bytes().to_vec();
    for (acc, id) in &a.list {
        v.push(acc.len() as u8);
        v.extend_from_slice(acc);
        v.extend_from_slice(&id.to_le_bytes());
    }
    k::write(K_APPROVALS, &v);
}

/// NEAR one approval's storage costs: its bytes in the approvals record.
fn approval_cost(acc: &[u8]) -> u128 {
    (acc.len() as u128 + 9) * BYTE_COST
}

fn refund(to: &[u8], amount: u128) {
    if amount > 0 {
        let p = k::batch(to);
        k::a_transfer(p, amount);
    }
}

/// Clear the approvals, refunding their storage to `to` (the holder who paid for them).
fn drop_approvals(to: &[u8]) {
    let mut a = approvals();
    let back: u128 = a.list.iter().map(|(acc, _)| approval_cost(acc)).sum();
    a.list.clear();
    store_approvals(&a);
    refund(to, back);
}

fn listed() -> Option<u128> {
    k::read(K_PRICE).map(|v| k::le_u128(&v, 0))
}

/// A listed slide (on its own market or through approvals) moves nothing out: the buyer gets what was listed.
fn require_unlisted() {
    k::require(listed().is_none() && approvals().list.is_empty(), "the slide is listed: unlist it and revoke its approvals before anything leaves it");
}

fn flight() -> (u64, u64) {
    k::read(K_FLIGHT).map(|v| (k::le_u64(&v, 0), k::le_u64(&v, 8))).unwrap_or((0, 0))
}

fn set_flight(n: u64, since: u64) {
    let mut v = n.to_le_bytes().to_vec();
    v.extend_from_slice(&since.to_le_bytes());
    k::write(K_FLIGHT, &v);
}

/// A call this purse made has not come back yet.
fn busy() -> bool {
    let (n, since) = flight();
    n > 0 && k::block_height() < since + BUSY_BLOCKS
}

fn take_off() {
    let (n, _) = flight();
    set_flight(if busy() { n + 1 } else { 1 }, k::block_height());
}

fn land() {
    let (n, since) = flight();
    set_flight(n.saturating_sub(1), since);
}

#[derive(Default)]
struct Stats {
    moves: u32,
    sales: u32,
    volume: u128,
    near_out: u128,
    petri_out: u128,
}

fn stats() -> Stats {
    match k::read(K_STATS) {
        Some(v) if v.len() == 56 => Stats {
            moves: k::le_u32(&v, 0),
            sales: k::le_u32(&v, 4),
            volume: k::le_u128(&v, 8),
            near_out: k::le_u128(&v, 24),
            petri_out: k::le_u128(&v, 40),
        },
        _ => Stats::default(),
    }
}

fn store_stats(s: &Stats) {
    let mut v = Vec::with_capacity(56);
    v.extend_from_slice(&s.moves.to_le_bytes());
    v.extend_from_slice(&s.sales.to_le_bytes());
    v.extend_from_slice(&s.volume.to_le_bytes());
    v.extend_from_slice(&s.near_out.to_le_bytes());
    v.extend_from_slice(&s.petri_out.to_le_bytes());
    k::write(K_STATS, &v);
}

/// The last `LOG_MAX` holder changes and payouts, oldest first, after a count of all there have been.
fn log_entries() -> (u32, Vec<(u8, u64, u128, Vec<u8>)>) {
    let v = k::read(K_LOG).unwrap_or_default();
    if v.len() < 4 {
        return (0, Vec::new());
    }
    let total = k::le_u32(&v, 0);
    let mut out = Vec::new();
    let mut i = 4;
    while i < v.len() {
        let kind = v[i];
        let at = k::le_u64(&v, i + 1);
        let amount = k::le_u128(&v, i + 9);
        let n = v[i + 25] as usize;
        out.push((kind, at, amount, v[i + 26..i + 26 + n].to_vec()));
        i += 26 + n;
    }
    (total, out)
}

fn log_push(kind: u8, account: &[u8], amount: u128) {
    let (total, mut list) = log_entries();
    list.push((kind, k::block_ms(), amount, account.to_vec()));
    if list.len() > LOG_MAX {
        list.remove(0);
    }
    let mut v = (total + 1).to_le_bytes().to_vec();
    for (kind, at, amount, acc) in &list {
        v.push(*kind);
        v.extend_from_slice(&at.to_le_bytes());
        v.extend_from_slice(&amount.to_le_bytes());
        v.push(acc.len() as u8);
        v.extend_from_slice(acc);
    }
    k::write(K_LOG, &v);
}

fn nft_event(event: &str, body: &[u8]) {
    let mut o = Out::new();
    o.s("EVENT_JSON:{\"standard\":\"nep171\",\"version\":\"1.2.0\",\"event\":\"").s(event).s("\",\"data\":[").raw(body).s("]}");
    k::log(&o.done());
}

fn purse_event(event: &str, body: &[u8]) {
    let mut o = Out::new();
    o.s("EVENT_JSON:{\"standard\":\"petri_purse\",\"version\":\"1.0.0\",\"event\":\"").s(event).s("\",\"data\":[").raw(body).s("]}");
    k::log(&o.done());
}

/// NEAR the holder can take out: the balance less the storage the purse uses and may still use.
fn available() -> u128 {
    k::balance().saturating_sub((k::storage_usage() + HEADROOM) as u128 * BYTE_COST)
}

fn check_token(input: &[u8]) {
    k::require(json::str_arg(input, "token_id") == &token_id()[..], "this purse holds one token, its slide's id");
}

/// The sender may move the token: the holder, or an account it approved (with the approval id, if one is given).
fn authorize(sender: &[u8], holder: &[u8], approval_id: Option<u128>) {
    if sender == holder {
        return;
    }
    let found = approvals().list.iter().find(|(a, _)| a == sender).map(|(_, id)| *id as u128);
    k::require(found.is_some(), "only the slide's holder or an account it approved can transfer it");
    if let Some(want) = approval_id {
        k::require(found == Some(want), "that approval id is out of date");
    }
}

/// Give the token, and with it the purse, to `to`. Approvals and any listing go; the old holder gets back what the
/// approvals' storage cost.
fn move_to(from: &[u8], to: &[u8], kind: u8, amount: u128, authorized: Option<&[u8]>, memo: Option<&[u8]>) {
    k::require(k::valid_account(to), "receiver_id is not a valid account id");
    k::require(to != from, "the slide already belongs to the receiver");
    k::require(to != &k::current()[..] && to != &factory()[..] && to != &dish()[..], "a purse cannot be held by itself, its factory or the dish: nobody could use it");
    k::require(!busy(), "a call this slide made is still in flight; try again in a few seconds");
    drop_approvals(from);
    k::remove(K_PRICE);
    k::write(K_HOLDER, to);
    bump();
    let mut s = stats();
    s.moves += 1;
    if kind == LOG_SALE {
        s.sales += 1;
        s.volume += amount;
    }
    store_stats(&s);
    log_push(kind, to, amount);
    let mut o = Out::new();
    o.s("{\"old_owner_id\":").q(from).s(",\"new_owner_id\":").q(to).s(",\"token_ids\":[").q(&token_id()).s("]");
    if let Some(a) = authorized {
        o.s(",\"authorized_id\":").q(a);
    }
    if let Some(m) = memo {
        o.s(",\"memo\":").q(m);
    }
    o.s("}");
    nft_event("nft_transfer", &o.done());
}

fn token_json(o: &mut Out) {
    let id = token_id();
    let me = k::current();
    let h = holder();
    o.s("{\"token_id\":").q(&id).s(",\"owner_id\":").q(&h).s(",\"metadata\":{\"title\":\"Living slide #").raw(&id);
    o.s("\",\"description\":\"Specimen slide #").raw(&id).s(" of ").raw(&dish());
    o.s(", sealed in its own keyless account. Whoever holds this token is the only account that can make the purse act: its NEAR, its PETRI, its colony and the slide move with the token.\"");
    o.s(",\"media\":\"https://www.playpetri.xyz/api/living/").raw(&me).s("\",\"media_hash\":null,\"copies\":1,\"issued_at\":null,\"expires_at\":null,\"starts_at\":null,\"updated_at\":null,\"extra\":null");
    o.s(",\"reference\":\"https://www.playpetri.xyz/specimens/").raw(&id).s("\",\"reference_hash\":null},\"approved_account_ids\":{");
    for (i, (acc, aid)) in approvals().list.iter().enumerate() {
        if i > 0 {
            o.s(",");
        }
        o.q(acc).s(":").n(*aid as u128);
    }
    o.s("}}");
}

fn payout_json(to: &[u8], balance: u128) -> Vec<u8> {
    let mut o = Out::new();
    o.s("{\"payout\":{").q(to).s(":").qn(balance).s("}}");
    o.done()
}

fn check_payout_len(input: &[u8]) {
    if let Some(m) = json::get(input, "max_len_payout").and_then(json::uint) {
        k::require(m >= 1, "the payout has one account");
    }
}

/// Send `f` to the dish (or anyone) and have `on_done` land it: returns the callback's promise.
fn with_landing(p: u64, kind: u8, to: &[u8], amount: u128) -> u64 {
    take_off();
    let cb = k::batch_then(p, &k::current());
    let mut a = Out::new();
    a.s("{\"kind\":").n(kind as u128).s(",\"to\":").q(to).s(",\"amount\":").qn(amount).s("}");
    k::a_call(cb, "on_done", &a.done(), 0, GAS_CALLBACK, 0);
    cb
}

methods! {
    /// Set up by the factory in the transaction that creates the account: the dish and the first holder.
    fn init() {
        k::require(k::read(K_DISH).is_none(), "this purse is already set up");
        k::require(k::predecessor() == factory(), "only the factory sets a purse up");
        let input = k::input();
        let d = json::str_arg(&input, "dish");
        let h = json::str_arg(&input, "holder");
        k::require(k::valid_account(d) && k::valid_account(h), "dish and holder must be account ids");
        let id = token_id();
        k::write(K_DISH, d);
        k::write(K_HOLDER, h);
        k::write(K_NONCE, &0u64.to_le_bytes());
        store_approvals(&Approvals { next: 0, list: Vec::new() });
        set_flight(0, 0);
        store_stats(&Stats::default());
        log_push(LOG_SEAL, h, 0);
        let mut o = Out::new();
        o.s("{\"owner_id\":").q(h).s(",\"token_ids\":[").q(&id).s("],\"memo\":\"sealed\"}");
        nft_event("nft_mint", &o.done());
    }

    // ---------- the holder makes the purse act ----------

    /// Call the dish as the purse: `method` (one of `ACTS`) with `args`, forwarding the attached NEAR. The purse's own
    /// NEAR never goes with it. A refused call's deposit comes back to the purse.
    fn act() {
        let _ = only_holder();
        require_unlisted();
        let input = k::input();
        let method = json::str_arg(&input, "method");
        let m = ACTS.iter().find(|a| a.as_bytes() == method).unwrap_or_else(|| k::fail("a purse makes only these dish calls: join, rename, plant, claim, claim_pending, buy, sell, mint_slide, pact_accept, pact_cancel"));
        let args = json::get(&input, "args").unwrap_or(b"{}");
        k::require(args.first() == Some(&b'{'), "args must be an object");
        k::require(k::prepaid_gas().saturating_sub(k::used_gas()) >= GAS_DISH_MIN + GAS_CALLBACK + 10 * TGAS, "attach at least 55 TGas");
        bump();
        take_off();
        let p = k::batch(&dish());
        k::a_call(p, m, args, k::attached(), GAS_DISH_MIN, 1);
        let cb = k::batch_then(p, &k::current());
        k::a_call(cb, "on_act", b"{}", 0, GAS_CALLBACK, 0);
        k::promise_return(cb);
    }

    /// Send the holder NEAR from the purse (all it can spare if `amount` is left out).
    fn withdraw() {
        k::require_one_yocto();
        let h = only_holder();
        require_unlisted();
        let input = k::input();
        let free = available();
        let amount = json::get(&input, "amount").map(|a| json::uint(a).unwrap_or_else(|| k::fail("amount is not a number"))).unwrap_or(free);
        k::require(amount > 0 && amount <= free, "the purse cannot spare that much: its storage stays paid for");
        bump();
        let p = k::batch(&h);
        k::a_transfer(p, amount);
        let cb = with_landing(p, LOG_NEAR_OUT, &h, amount);
        k::promise_return(cb);
    }

    /// Send the holder `amount` PETRI from the purse's balance on the dish.
    fn ft_withdraw() {
        k::require_one_yocto();
        let h = only_holder();
        require_unlisted();
        let input = k::input();
        let amount = json::get(&input, "amount").and_then(json::uint).unwrap_or(0);
        k::require(amount > 0, "say how much PETRI: amount");
        bump();
        let mut a = Out::new();
        a.s("{\"receiver_id\":").q(&h).s(",\"amount\":").qn(amount).s(",\"memo\":\"from living slide ").raw(&token_id()).s("\"}");
        let p = k::batch(&dish());
        k::a_call(p, "ft_transfer", &a.done(), 1, GAS_FT, 0);
        let cb = with_landing(p, LOG_PETRI_OUT, &h, amount);
        k::promise_return(cb);
    }

    /// Send the holder another dish slide the purse holds (one it minted, or was given). Its own slide stays sealed.
    fn release() {
        k::require_one_yocto();
        let h = only_holder();
        require_unlisted();
        let input = k::input();
        let slide = json::str_arg(&input, "slide");
        k::require(k::valid_token_id(slide), "slide is a token id");
        k::require(slide != &token_id()[..], "a living slide's own slide stays sealed in it");
        let n = json::uint(slide).unwrap();
        bump();
        let mut a = Out::new();
        a.s("{\"receiver_id\":").q(&h).s(",\"token_id\":").q(slide).s(",\"memo\":\"released from living slide ").raw(&token_id()).s("\"}");
        let p = k::batch(&dish());
        k::a_call(p, "nft_transfer", &a.done(), 1, GAS_FT, 0);
        let cb = with_landing(p, LOG_RELEASE, &h, n);
        k::promise_return(cb);
    }

    // ---------- its own market ----------

    /// Offer the slide for `price` yoctoNEAR. While listed, nothing leaves it.
    fn list() {
        k::require_one_yocto();
        let _ = only_holder();
        let input = k::input();
        let price = json::get(&input, "price").and_then(json::uint).unwrap_or(0);
        k::require(price > 0, "price is in yoctoNEAR and above 0");
        k::write(K_PRICE, &price.to_le_bytes());
        bump();
        let mut o = Out::new();
        o.s("{\"price\":").qn(price).s(",\"nonce\":").n(nonce() as u128).s("}");
        purse_event("list", &o.done());
    }

    fn unlist() {
        k::require_one_yocto();
        let _ = only_holder();
        k::remove(K_PRICE);
        bump();
        purse_event("unlist", b"{}");
    }

    /// Buy the listed slide, attaching at least its price. `nonce` is the purse's nonce when you looked: if anything
    /// changed since (a withdrawal, a call, a new price), the purchase fails and nothing is paid.
    fn buy() {
        let input = k::input();
        let price = listed().unwrap_or_else(|| k::fail("the slide is not for sale"));
        let want = json::get(&input, "nonce").and_then(json::uint).unwrap_or_else(|| k::fail("pass the nonce you saw: nonce"));
        k::require(want == nonce() as u128, "the slide changed since you looked at it; look again");
        let paid = k::attached();
        k::require(paid >= price, "attach the price");
        let buyer = k::predecessor();
        let seller = holder();
        move_to(&seller, &buyer, LOG_SALE, price, None, Some(b"sale"));
        refund(&seller, price);
        refund(&buyer, paid - price);
    }

    // ---------- NEP-171 ----------

    fn nft_transfer() {
        k::require_one_yocto();
        let input = k::input();
        check_token(&input);
        let to = json::str_arg(&input, "receiver_id");
        let sender = k::predecessor();
        let h = holder();
        authorize(&sender, &h, json::get(&input, "approval_id").and_then(json::uint));
        let memo = json::get(&input, "memo").and_then(json::plain_str);
        move_to(&h, to, LOG_TRANSFER, 0, (sender != h).then_some(&sender[..]), memo);
    }

    fn nft_transfer_call() {
        k::require_one_yocto();
        let input = k::input();
        check_token(&input);
        let to = json::str_arg(&input, "receiver_id").to_vec();
        let msg = json::get(&input, "msg").filter(|m| m.first() == Some(&b'"')).unwrap_or_else(|| k::fail("msg must be a string"));
        k::require(k::prepaid_gas().saturating_sub(k::used_gas()) >= GAS_ON_TRANSFER + GAS_RESOLVE + 15 * TGAS, "more gas is required");
        let sender = k::predecessor();
        let h = holder();
        authorize(&sender, &h, json::get(&input, "approval_id").and_then(json::uint));
        let memo = json::get(&input, "memo").and_then(json::plain_str);
        move_to(&h, &to, LOG_TRANSFER, 0, (sender != h).then_some(&sender[..]), memo);
        let id = token_id();
        let mut a = Out::new();
        a.s("{\"sender_id\":").q(&sender).s(",\"previous_owner_id\":").q(&h).s(",\"token_id\":").q(&id).s(",\"msg\":").raw(msg).s("}");
        let p = k::batch(&to);
        k::a_call(p, "nft_on_transfer", &a.done(), 0, GAS_ON_TRANSFER, 1);
        let mut r = Out::new();
        r.s("{\"previous_owner_id\":").q(&h).s(",\"receiver_id\":").q(&to).s(",\"token_id\":").q(&id).s("}");
        let cb = k::batch_then(p, &k::current());
        k::a_call(cb, "nft_resolve_transfer", &r.done(), 0, GAS_RESOLVE, 0);
        k::promise_return(cb);
    }

    /// True when the receiver kept the token. If it asked to give it back (or failed) and still holds it, the token
    /// returns to the previous holder; the approvals it had were refunded when it moved and stay gone.
    fn nft_resolve_transfer() {
        only_self();
        let input = k::input();
        let prev = json::str_arg(&input, "previous_owner_id");
        let to = json::str_arg(&input, "receiver_id");
        let give_back = match k::result(0) {
            Some(v) => v != b"false",
            None => true,
        };
        if !give_back || holder() != to {
            k::ret(b"true");
            return;
        }
        k::remove(K_PRICE);
        drop_approvals(to);
        k::write(K_HOLDER, prev);
        bump();
        let mut s = stats();
        s.moves += 1;
        store_stats(&s);
        log_push(LOG_RETURNED, prev, 0);
        let mut o = Out::new();
        o.s("{\"old_owner_id\":").q(to).s(",\"new_owner_id\":").q(prev).s(",\"token_ids\":[").q(&token_id()).s("],\"memo\":\"returned\"}");
        nft_event("nft_transfer", &o.done());
        k::ret(b"false");
    }

    fn nft_token() {
        let input = k::input();
        let t = json::get(&input, "token_id").and_then(json::plain_str);
        if t != Some(&token_id()[..]) {
            k::ret(b"null");
            return;
        }
        let mut o = Out::new();
        token_json(&mut o);
        k::ret(&o.done());
    }

    // ---------- NEP-177 ----------

    fn nft_metadata() {
        let mut o = Out::new();
        o.s("{\"spec\":\"nft-2.1.0\",\"name\":\"Petri living slide #").raw(&token_id()).s("\",\"symbol\":\"LIVE\",\"icon\":null,\"base_uri\":null,\"reference\":null,\"reference_hash\":null}");
        k::ret(&o.done());
    }

    // ---------- NEP-181 (one token) ----------

    fn nft_total_supply() {
        k::ret(b"\"1\"");
    }

    fn nft_tokens() {
        let input = k::input();
        let from = json::get(&input, "from_index").and_then(json::uint).unwrap_or(0);
        let mut o = Out::new();
        o.s("[");
        if from == 0 {
            token_json(&mut o);
        }
        o.s("]");
        k::ret(&o.done());
    }

    fn nft_supply_for_owner() {
        let input = k::input();
        k::ret(if json::str_arg(&input, "account_id") == &holder()[..] { b"\"1\"" } else { b"\"0\"" });
    }

    fn nft_tokens_for_owner() {
        let input = k::input();
        let mine = json::str_arg(&input, "account_id") == &holder()[..];
        let from = json::get(&input, "from_index").and_then(json::uint).unwrap_or(0);
        let mut o = Out::new();
        o.s("[");
        if mine && from == 0 {
            token_json(&mut o);
        }
        o.s("]");
        k::ret(&o.done());
    }

    // ---------- NEP-178 ----------

    /// Let `account_id` transfer the token (a marketplace, say). The deposit pays for the approval's storage, refunded
    /// when it goes; the rest comes back. While any approval stands, nothing leaves the purse.
    fn nft_approve() {
        let input = k::input();
        check_token(&input);
        let h = only_holder();
        let acc = json::str_arg(&input, "account_id");
        k::require(k::valid_account(acc), "account_id is not a valid account id");
        let deposit = k::attached();
        let mut a = approvals();
        let id = a.next;
        a.next += 1;
        let cost = match a.list.iter_mut().find(|(x, _)| x == acc) {
            Some(e) => {
                e.1 = id;
                0
            }
            None => {
                k::require(a.list.len() < MAX_APPROVALS, "a living slide has at most 4 approvals");
                a.list.push((acc.to_vec(), id));
                approval_cost(acc)
            }
        };
        k::require(deposit >= cost && deposit > 0, "attach the approval's storage: 0.00073 NEAR covers any account");
        store_approvals(&a);
        bump();
        if deposit - cost > 1 {
            refund(&h, deposit - cost);
        }
        if let Some(msg) = json::get(&input, "msg").filter(|m| m.first() == Some(&b'"')) {
            let mut o = Out::new();
            o.s("{\"token_id\":").q(&token_id()).s(",\"owner_id\":").q(&h).s(",\"approval_id\":").n(id as u128).s(",\"msg\":").raw(msg).s("}");
            let p = k::batch(acc);
            k::a_call(p, "nft_on_approve", &o.done(), 0, 0, 1);
            k::promise_return(p);
        }
    }

    fn nft_revoke() {
        k::require_one_yocto();
        let input = k::input();
        check_token(&input);
        let h = only_holder();
        let acc = json::str_arg(&input, "account_id");
        let mut a = approvals();
        let before = a.list.len();
        a.list.retain(|(x, _)| x != acc);
        if a.list.len() < before {
            store_approvals(&a);
            bump();
            refund(&h, approval_cost(acc));
        }
    }

    fn nft_revoke_all() {
        k::require_one_yocto();
        let input = k::input();
        check_token(&input);
        let h = only_holder();
        drop_approvals(&h);
        bump();
    }

    fn nft_is_approved() {
        let input = k::input();
        check_token(&input);
        let acc = json::str_arg(&input, "approved_account_id");
        let want = json::get(&input, "approval_id").and_then(json::uint);
        let ok = approvals().list.iter().any(|(x, id)| x == acc && want.map_or(true, |w| w == *id as u128));
        k::ret(if ok { b"true" } else { b"false" });
    }

    // ---------- NEP-199 ----------

    /// All of a sale's price goes to the holder: the slide keeps no cut.
    fn nft_payout() {
        let input = k::input();
        check_token(&input);
        check_payout_len(&input);
        let balance = json::get(&input, "balance").and_then(json::uint).unwrap_or_else(|| k::fail("balance is missing"));
        k::ret(&payout_json(&holder(), balance));
    }

    fn nft_transfer_payout() {
        k::require_one_yocto();
        let input = k::input();
        check_token(&input);
        check_payout_len(&input);
        let balance = json::get(&input, "balance").and_then(json::uint).unwrap_or_else(|| k::fail("balance is missing"));
        let to = json::str_arg(&input, "receiver_id");
        let sender = k::predecessor();
        let h = holder();
        authorize(&sender, &h, json::get(&input, "approval_id").and_then(json::uint));
        let memo = json::get(&input, "memo").and_then(json::plain_str);
        move_to(&h, to, LOG_SALE, balance, (sender != h).then_some(&sender[..]), memo);
        k::ret(&payout_json(&h, balance));
    }

    // ---------- receiving ----------

    /// Dish slides sent here with `nft_transfer_call` stay (the holder can `release` them); anything else goes back.
    fn nft_on_transfer() {
        k::ret(if k::predecessor() == dish() { b"false" } else { b"true" });
    }

    // ---------- callbacks ----------

    fn on_act() {
        only_self();
        land();
        match k::result(0) {
            Some(v) if !v.is_empty() => k::ret(&v),
            Some(_) => k::ret(b"null"),
            None => {
                k::log(b"the dish refused the call; any NEAR it carried came back to the purse");
                k::ret(b"null");
            }
        }
    }

    fn on_done() {
        only_self();
        land();
        let input = k::input();
        let kind = json::get(&input, "kind").and_then(json::uint).unwrap_or(0) as u8;
        let to = json::str_arg(&input, "to");
        let amount = json::get(&input, "amount").and_then(json::uint).unwrap_or(0);
        if k::result(0).is_none() {
            log_push(LOG_FAILED, to, amount);
            k::ret(b"null");
            return;
        }
        log_push(kind, to, amount);
        let mut s = stats();
        match kind {
            LOG_NEAR_OUT => s.near_out += amount,
            LOG_PETRI_OUT => s.petri_out += amount,
            _ => {}
        }
        store_stats(&s);
        let name = match kind {
            LOG_NEAR_OUT => "withdraw",
            LOG_PETRI_OUT => "ft_withdraw",
            _ => "release",
        };
        let mut o = Out::new();
        o.s("{\"to\":").q(to).s(",\"amount\":").qn(amount).s("}");
        purse_event(name, &o.done());
        let mut r = Out::new();
        r.qn(amount);
        k::ret(&r.done());
    }

    // ---------- views ----------

    /// Everything about the purse in one call.
    fn purse() {
        let s = stats();
        let (n, since) = flight();
        let locked = (k::storage_usage() + HEADROOM) as u128 * BYTE_COST;
        let mut o = Out::new();
        o.s("{\"token_id\":").q(&token_id()).s(",\"dish\":").q(&dish()).s(",\"factory\":").q(&factory()).s(",\"holder\":").q(&holder());
        o.s(",\"nonce\":").n(nonce() as u128).s(",\"price\":");
        match listed() {
            Some(p) => {
                o.qn(p);
            }
            None => {
                o.s("null");
            }
        }
        o.s(",\"approvals\":").n(approvals().list.len() as u128);
        o.s(",\"in_flight\":").n(if busy() { n as u128 } else { 0 }).s(",\"in_flight_since\":").n(since as u128);
        o.s(",\"balance\":").qn(k::balance()).s(",\"locked\":").qn(locked).s(",\"available\":").qn(available());
        o.s(",\"storage_bytes\":").n(k::storage_usage() as u128);
        o.s(",\"moves\":").n(s.moves as u128).s(",\"sales\":").n(s.sales as u128).s(",\"sales_volume\":").qn(s.volume);
        o.s(",\"near_out\":").qn(s.near_out).s(",\"petri_out\":").qn(s.petri_out).s(",\"acts\":[");
        for (i, a) in ACTS.iter().enumerate() {
            if i > 0 {
                o.s(",");
            }
            o.q(a.as_bytes());
        }
        o.s("]}");
        k::ret(&o.done());
    }

    /// The last 12 holder changes and payouts, oldest first.
    fn history() {
        let (total, list) = log_entries();
        let mut o = Out::new();
        o.s("{\"total\":").n(total as u128).s(",\"entries\":[");
        for (i, (kind, at, amount, acc)) in list.iter().enumerate() {
            if i > 0 {
                o.s(",");
            }
            let name = match *kind {
                LOG_SEAL => "seal",
                LOG_TRANSFER => "transfer",
                LOG_SALE => "sale",
                LOG_NEAR_OUT => "withdraw",
                LOG_PETRI_OUT => "ft_withdraw",
                LOG_RELEASE => "release",
                LOG_RETURNED => "returned",
                _ => "failed",
            };
            o.s("{\"kind\":\"").s(name).s("\",\"account\":").q(acc).s(",\"amount\":").qn(*amount).s(",\"at_ms\":").n(*at as u128).s("}");
        }
        o.s("]}");
        k::ret(&o.done());
    }
}

#[cfg(test)]
mod tests;
