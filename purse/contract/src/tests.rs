//! The purse's transfer path, case by case from docs/SLIDES-THREAT-MODEL.md, against the mock chain. Each test names
//! the threat it covers (T1 to T12).

use super::*;
use purse_kit::mock::{call, with, Action};

const DISH: &str = "petri-v6.testnet";
const FACTORY: &str = "slides.petri-v6.testnet";
const ME: &str = "slide-7.slides.petri-v6.testnet";
const ALICE: &str = "alice.testnet";
const BOB: &str = "bob.testnet";
const CAROL: &str = "carol.testnet";
const MARKET: &str = "market.testnet";
/// The colony account that minted slide 7: every sale but its own pays it 5%.
const MINTER: &str = "minter.testnet";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const MILLI: u128 = NEAR / 1000;

fn setup() {
    with(|c| {
        *c = Default::default();
        c.current = ME.into();
        c.balance = 400 * MILLI;
        c.base_usage = 100 + 29_000;
        c.prepaid_gas = 300 * TGAS;
        c.height = 1_000;
        c.ms = 1_700_000_000_000;
    });
    call(init, FACTORY, &format!(r#"{{"dish":"{DISH}","holder":"{ALICE}","minter":"{MINTER}"}}"#), 0).unwrap();
}

/// The NEAR each account was sent by the promises the last call made.
fn paid() -> Vec<(String, u128)> {
    promises().iter().filter_map(|q| match q.actions[0] { Action::Transfer(a) => Some((q.account.clone(), a)), _ => None }).collect()
}

fn view(f: fn(), args: &str) -> String {
    call(f, "anyone.testnet", args, 0).unwrap().unwrap()
}

fn info() -> String {
    view(purse, "{}")
}

fn holder_now() -> String {
    let t = view(nft_token, r#"{"token_id":"7"}"#);
    let i = t.find("\"owner_id\":\"").unwrap() + 12;
    t[i..i + t[i..].find('"').unwrap()].to_string()
}

fn nonce_now() -> u64 {
    let p = info();
    let i = p.find("\"nonce\":").unwrap() + 8;
    p[i..i + p[i..].find(',').unwrap()].parse().unwrap()
}

fn promises() -> Vec<purse_kit::mock::Promise> {
    with(|c| c.promises.clone())
}

fn land_ok(f: fn(), args: &str, result: &[u8]) -> Result<Option<String>, String> {
    with(|c| c.results = vec![Some(result.to_vec())]);
    call(f, ME, args, 0)
}

fn land_failed(f: fn(), args: &str) -> Result<Option<String>, String> {
    with(|c| c.results = vec![None]);
    call(f, ME, args, 0)
}

fn transfer(from: &str, to: &str) -> Result<Option<String>, String> {
    call(nft_transfer, from, &format!(r#"{{"receiver_id":"{to}","token_id":"7"}}"#), 1)
}

fn act_plant(who: &str) -> Result<Option<String>, String> {
    call(act, who, r#"{"method":"plant","args":{"cells":[1,2,3],"slide":"7"}}"#, 5 * MILLI)
}

#[test]
fn setup_once_by_the_factory_only() {
    setup();
    assert!(with(|c| c.logs[0].contains("nft_mint")));
    assert_eq!(holder_now(), ALICE);
    // T7: nobody re-runs init to take the purse over, not even the factory.
    assert!(call(init, FACTORY, &format!(r#"{{"dish":"{DISH}","holder":"{BOB}","minter":"{BOB}"}}"#), 0).unwrap_err().contains("already set up"));
    with(|c| c.storage.clear());
    assert!(call(init, BOB, &format!(r#"{{"dish":"{DISH}","holder":"{BOB}","minter":"{BOB}"}}"#), 0).unwrap_err().contains("only the factory"));
    // The minter is named at setup, as an account id: no purse is made without one.
    assert!(call(init, FACTORY, &format!(r#"{{"dish":"{DISH}","holder":"{BOB}"}}"#), 0).unwrap_err().contains("minter is missing"));
    assert!(call(init, FACTORY, &format!(r#"{{"dish":"{DISH}","holder":"{BOB}","minter":"Bad..id"}}"#), 0).unwrap_err().contains("must be account ids"));
    // The token id comes from the account's own name.
    with(|c| c.current = "evil.slides.petri-v6.testnet".into());
    assert!(call(init, FACTORY, &format!(r#"{{"dish":"{DISH}","holder":"{BOB}","minter":"{BOB}"}}"#), 0).unwrap_err().contains("slide-<token id>"));
}

#[test]
fn views_follow_the_standards() {
    setup();
    assert_eq!(view(nft_total_supply, "{}"), "\"1\"");
    assert_eq!(view(nft_supply_for_owner, &format!(r#"{{"account_id":"{ALICE}"}}"#)), "\"1\"");
    assert_eq!(view(nft_supply_for_owner, &format!(r#"{{"account_id":"{BOB}"}}"#)), "\"0\"");
    assert_eq!(view(nft_token, r#"{"token_id":"8"}"#), "null");
    assert!(view(nft_tokens_for_owner, &format!(r#"{{"account_id":"{ALICE}"}}"#)).contains("Living slide #7"));
    assert_eq!(view(nft_tokens_for_owner, &format!(r#"{{"account_id":"{BOB}"}}"#)), "[]");
    assert!(view(nft_metadata, "{}").contains("nft-2.1.0"));
    assert_eq!(view(nft_payout, r#"{"token_id":"7","balance":"100","max_len_payout":3}"#), format!(r#"{{"payout":{{"{MINTER}":"5","{ALICE}":"95"}}}}"#));
    assert!(info().contains(&format!(r#""minter":"{MINTER}","royalty_bps":500"#)));
    // The token's JSON parses as JSON (a quick structural check: balanced and quoted).
    let t = view(nft_token, r#"{"token_id":"7"}"#);
    assert!(t.starts_with('{') && t.ends_with('}') && t.contains(r#""approved_account_ids":{}"#));
}

#[test]
fn act_forwards_only_whitelisted_dish_calls() {
    setup();
    // T2, T3, T9: the calls that would route the purse's money, payouts or slide elsewhere are not forwardable.
    for m in ["set_payout", "sponsor", "pact_offer", "ft_transfer", "ft_transfer_call", "nft_transfer", "nft_transfer_call", "nft_approve", "storage_withdraw", "storage_unregister", "unsponsor"] {
        let r = call(act, ALICE, &format!(r#"{{"method":"{m}","args":{{}}}}"#), 0);
        assert!(r.unwrap_err().contains("a purse makes only these dish calls"), "{m} must be refused");
    }
    // T1: only the holder.
    assert!(act_plant(BOB).unwrap_err().contains("only the slide's holder"));
    act_plant(ALICE).unwrap();
    let p = promises();
    assert_eq!(p[0].account, DISH);
    assert_eq!(p[0].actions[0], Action::Call { method: "plant".into(), args: r#"{"cells":[1,2,3],"slide":"7"}"#.into(), amount: 5 * MILLI, gas: 30 * TGAS, weight: 1 });
    assert_eq!(p[1].account, ME);
    assert_eq!(p[1].after, Some(0));
    assert!(info().contains("\"in_flight\":1"));
    assert_eq!(land_ok(on_act, "{}", b"\"1234\"").unwrap(), Some("\"1234\"".into()));
    assert!(info().contains("\"in_flight\":0"));
    // Callbacks only from the purse itself.
    assert!(call(on_act, BOB, "{}", 0).unwrap_err().contains("only the purse itself"));
    assert!(call(on_done, BOB, r#"{"kind":4,"to":"bob.testnet","amount":"1"}"#, 0).unwrap_err().contains("only the purse itself"));
    // Too little gas for the dish and the callback is refused up front.
    with(|c| c.prepaid_gas = 40 * TGAS);
    assert!(act_plant(ALICE).unwrap_err().contains("55 TGas"));
}

#[test]
fn withdraw_pays_the_holder_and_keeps_storage_paid() {
    setup();
    let free = available();
    assert!(free > 0 && free < 400 * MILLI);
    assert!(call(withdraw, BOB, "{}", 1).unwrap_err().contains("only the slide's holder"));
    assert!(call(withdraw, ALICE, &format!(r#"{{"amount":"{}"}}"#, free + 2), 1).unwrap_err().contains("cannot spare"));
    call(withdraw, ALICE, "{}", 1).unwrap();
    let p = promises();
    assert_eq!(p[0].account, ALICE);
    assert!(matches!(p[0].actions[0], Action::Transfer(a) if a == free + 1));
    // Storage stays paid for, headroom included.
    assert!(with(|c| c.balance) >= (purse_kit::storage_usage() + HEADROOM) as u128 * BYTE_COST);
    land_ok(on_done, &format!(r#"{{"kind":4,"to":"{ALICE}","amount":"{}"}}"#, free + 1), b"").unwrap();
    assert!(info().contains(&format!("\"near_out\":\"{}\"", free + 1)));
    assert!(view(history, "{}").contains("\"kind\":\"withdraw\""));
}

#[test]
fn a_failed_payout_is_written_down_and_not_counted() {
    setup();
    call(ft_withdraw, ALICE, r#"{"amount":"500"}"#, 1).unwrap();
    let p = promises();
    assert_eq!(p[0].actions[0], Action::Call { method: "ft_transfer".into(), args: format!(r#"{{"receiver_id":"{ALICE}","amount":"500","memo":"from living slide 7"}}"#), amount: 1, gas: 20 * TGAS, weight: 0 });
    land_failed(on_done, &format!(r#"{{"kind":5,"to":"{ALICE}","amount":"500"}}"#)).unwrap();
    assert!(info().contains("\"petri_out\":\"0\""));
    assert!(view(history, "{}").contains("\"kind\":\"failed\""));
}

#[test]
fn the_old_holder_keeps_nothing_after_a_transfer() {
    setup();
    transfer(ALICE, BOB).unwrap();
    assert_eq!(holder_now(), BOB);
    // T1: every privileged path checks the holder in the same receipt.
    assert!(act_plant(ALICE).unwrap_err().contains("only the slide's holder"));
    assert!(call(withdraw, ALICE, "{}", 1).unwrap_err().contains("only the slide's holder"));
    assert!(call(ft_withdraw, ALICE, r#"{"amount":"1"}"#, 1).unwrap_err().contains("only the slide's holder"));
    assert!(call(release, ALICE, r#"{"slide":"9"}"#, 1).unwrap_err().contains("only the slide's holder"));
    assert!(call(list, ALICE, r#"{"price":"1"}"#, 1).unwrap_err().contains("only the slide's holder"));
    assert!(transfer(ALICE, CAROL).unwrap_err().contains("only the slide's holder or an account it approved"));
    assert!(call(nft_approve, ALICE, &format!(r#"{{"token_id":"7","account_id":"{ALICE}"}}"#), MILLI).unwrap_err().contains("only the slide's holder"));
    // The new holder can do all of it.
    act_plant(BOB).unwrap();
    land_ok(on_act, "{}", b"\"1\"").unwrap();
    call(withdraw, BOB, r#"{"amount":"1000"}"#, 1).unwrap();
    assert_eq!(promises()[0].account, BOB);
    // A transfer needs exactly one yoctoNEAR (a full-access key's signature).
    assert!(call(nft_transfer, BOB, &format!(r#"{{"receiver_id":"{CAROL}","token_id":"7"}}"#), 0).unwrap_err().contains("1 yoctoNEAR"));
}

#[test]
fn nobody_can_be_made_holder_who_could_not_use_it() {
    setup();
    // T10: the purse, its factory and the dish can sign nothing; an invalid id could never be a signer.
    for to in [ME, FACTORY, DISH, "Bob.testnet", "a", "bob..testnet", "-bob.testnet"] {
        assert!(transfer(ALICE, to).is_err(), "{to} must be refused");
    }
    assert!(transfer(ALICE, ALICE).unwrap_err().contains("already belongs"));
    assert!(call(nft_transfer, ALICE, &format!(r#"{{"receiver_id":"{BOB}","token_id":"8"}}"#), 1).unwrap_err().contains("one token"));
}

#[test]
fn a_sale_waits_for_calls_in_flight() {
    setup();
    // T4 (a sale in the middle of a payout): the holder asks the dish to pay out; until the answer lands, the slide
    // cannot change hands, so the buyer never buys a purse with a payout half-done.
    call(act, ALICE, r#"{"method":"claim","args":{}}"#, 0).unwrap();
    assert!(transfer(ALICE, BOB).unwrap_err().contains("still in flight"));
    call(list, ALICE, r#"{"price":"1000"}"#, 1).unwrap();
    let n = nonce_now();
    assert!(call(buy, BOB, &format!(r#"{{"nonce":{n}}}"#), 1000).unwrap_err().contains("still in flight"));
    land_ok(on_act, "{}", br#"{"petri":"10","near":"0"}"#).unwrap();
    call(buy, BOB, &format!(r#"{{"nonce":{n}}}"#), 1000).unwrap();
    assert_eq!(holder_now(), BOB);
    // Whatever the dish pays the purse from now on lands in the purse, which is Bob's: nothing is routed to a person.
}

#[test]
fn a_stuck_flight_record_expires() {
    setup();
    call(act, ALICE, r#"{"method":"claim","args":{}}"#, 0).unwrap();
    assert!(transfer(ALICE, BOB).is_err());
    with(|c| c.height += BUSY_BLOCKS);
    transfer(ALICE, BOB).unwrap();
    // The late callback still lands harmlessly.
    land_ok(on_act, "{}", b"null").unwrap();
    assert!(info().contains("\"in_flight\":0"));
}

#[test]
fn a_listed_slide_moves_nothing_out() {
    setup();
    call(list, ALICE, r#"{"price":"2000000000000000000000000"}"#, 1).unwrap();
    // T5 (withdraw during a pending sale): while listed, nothing leaves.
    assert!(call(withdraw, ALICE, "{}", 1).unwrap_err().contains("listed"));
    assert!(call(ft_withdraw, ALICE, r#"{"amount":"1"}"#, 1).unwrap_err().contains("listed"));
    assert!(act_plant(ALICE).unwrap_err().contains("listed"));
    assert!(call(release, ALICE, r#"{"slide":"9"}"#, 1).unwrap_err().contains("listed"));
    // Unlisting to drain changes the nonce, so a buyer's pinned purchase fails.
    let seen = nonce_now();
    call(unlist, ALICE, "{}", 1).unwrap();
    call(withdraw, ALICE, r#"{"amount":"1000"}"#, 1).unwrap();
    land_ok(on_done, &format!(r#"{{"kind":4,"to":"{ALICE}","amount":"1000"}}"#), b"").unwrap();
    call(list, ALICE, r#"{"price":"2000000000000000000000000"}"#, 1).unwrap();
    assert!(call(buy, BOB, &format!(r#"{{"nonce":{seen}}}"#), 2 * NEAR).unwrap_err().contains("changed since you looked"));
    assert_eq!(holder_now(), ALICE);
}

#[test]
fn buying_pays_the_seller_and_hands_over_everything() {
    setup();
    assert!(call(buy, BOB, r#"{"nonce":0}"#, NEAR).unwrap_err().contains("not for sale"));
    call(list, ALICE, r#"{"price":"1000000000000000000000000"}"#, 1).unwrap();
    let n = nonce_now();
    assert!(call(buy, BOB, &format!(r#"{{"nonce":{n}}}"#), NEAR - 1).unwrap_err().contains("attach the price"));
    assert!(call(buy, BOB, r#"{}"#, NEAR).unwrap_err().contains("nonce"));
    call(buy, BOB, &format!(r#"{{"nonce":{n}}}"#), NEAR + 5).unwrap();
    // The minter's 5%, the seller the rest, the buyer its change.
    assert_eq!(paid(), vec![(MINTER.to_string(), NEAR / 20), (ALICE.to_string(), NEAR - NEAR / 20), (BOB.to_string(), 5)]);
    assert_eq!(holder_now(), BOB);
    let i = info();
    assert!(i.contains("\"price\":null") && i.contains("\"sales\":1") && i.contains("\"sales_volume\":\"1000000000000000000000000\""));
    assert!(view(history, "{}").contains("\"kind\":\"sale\",\"account\":\"bob.testnet\""));
    // The seller cannot buy it back at the old listing: there is none.
    assert!(call(buy, ALICE, &format!(r#"{{"nonce":{}}}"#, nonce_now()), NEAR).unwrap_err().contains("not for sale"));
}

#[test]
fn approvals_never_survive_a_transfer() {
    setup();
    // T6: a seller approves an account of its own, then sells; the approval must be gone.
    call(nft_approve, ALICE, &format!(r#"{{"token_id":"7","account_id":"{CAROL}"}}"#), MILLI).unwrap();
    // The approval's storage was paid; the rest came back.
    let back: u128 = promises().iter().filter_map(|q| match q.actions[0] { Action::Transfer(a) => Some(a), _ => None }).sum();
    assert_eq!(back, MILLI - (CAROL.len() as u128 + 9) * BYTE_COST);
    assert_eq!(view(nft_is_approved, &format!(r#"{{"token_id":"7","approved_account_id":"{CAROL}"}}"#)), "true");
    // An approval is a listing: nothing leaves while it stands.
    assert!(call(withdraw, ALICE, "{}", 1).unwrap_err().contains("listed"));
    transfer(ALICE, BOB).unwrap();
    // Alice got the approval's storage back with the transfer.
    assert!(promises().iter().any(|q| q.account == ALICE && q.actions[0] == Action::Transfer((CAROL.len() as u128 + 9) * BYTE_COST)));
    assert_eq!(view(nft_is_approved, &format!(r#"{{"token_id":"7","approved_account_id":"{CAROL}"}}"#)), "false");
    assert!(transfer(CAROL, ALICE).unwrap_err().contains("only the slide's holder or an account it approved"));
}

#[test]
fn a_marketplace_sale_through_nep_199() {
    setup();
    call(nft_approve, ALICE, &format!(r#"{{"token_id":"7","account_id":"{MARKET}"}}"#), MILLI).unwrap();
    assert!(call(nft_transfer_payout, MARKET, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","approval_id":5,"balance":"900"}}"#), 1).unwrap_err().contains("out of date"));
    // A market that pays only one account cannot sell it: the minter would go unpaid.
    assert!(call(nft_transfer_payout, MARKET, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","approval_id":0,"balance":"900","max_len_payout":1}}"#), 1).unwrap_err().contains("max_len_payout"));
    assert_eq!(holder_now(), ALICE);
    let r = call(nft_transfer_payout, MARKET, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","approval_id":0,"balance":"900","max_len_payout":10}}"#), 1).unwrap();
    assert_eq!(r, Some(format!(r#"{{"payout":{{"{MINTER}":"45","{ALICE}":"855"}}}}"#)));
    assert!(with(|c| c.logs.iter().any(|l| l.contains("\"authorized_id\":\"market.testnet\""))));
    assert_eq!(holder_now(), BOB);
    // The market's approval went with the sale.
    assert!(transfer(MARKET, CAROL).is_err());
}

#[test]
fn transfer_call_returns_the_token_when_the_receiver_refuses() {
    setup();
    call(nft_transfer_call, ALICE, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","msg":"hi"}}"#), 1).unwrap();
    let p = promises();
    assert_eq!(holder_now(), BOB);
    assert_eq!(p[0].account, BOB);
    assert!(matches!(&p[0].actions[0], Action::Call { method, .. } if method == "nft_on_transfer"));
    let args = format!(r#"{{"previous_owner_id":"{ALICE}","receiver_id":"{BOB}","token_id":"7"}}"#);
    assert_eq!(land_ok(nft_resolve_transfer, &args, b"true").unwrap(), Some("false".into()));
    assert_eq!(holder_now(), ALICE);
    // Kept: stays.
    call(nft_transfer_call, ALICE, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","msg":""}}"#), 1).unwrap();
    assert_eq!(land_ok(nft_resolve_transfer, &args, b"false").unwrap(), Some("true".into()));
    assert_eq!(holder_now(), BOB);
    // Failed: back. And a receiver that passed it on keeps nothing to give back.
    call(nft_transfer, BOB, &format!(r#"{{"receiver_id":"{ALICE}","token_id":"7"}}"#), 1).unwrap();
    call(nft_transfer_call, ALICE, &format!(r#"{{"receiver_id":"{BOB}","token_id":"7","msg":""}}"#), 1).unwrap();
    transfer(BOB, CAROL).unwrap();
    assert_eq!(land_failed(nft_resolve_transfer, &args).unwrap(), Some("true".into()));
    assert_eq!(holder_now(), CAROL);
    assert!(call(nft_resolve_transfer, BOB, &args, 0).unwrap_err().contains("only the purse itself"));
}

#[test]
fn its_own_slide_stays_sealed() {
    setup();
    assert!(call(release, ALICE, r#"{"slide":"7"}"#, 1).unwrap_err().contains("stays sealed"));
    call(release, ALICE, r#"{"slide":"12"}"#, 1).unwrap();
    assert_eq!(promises()[0].actions[0], Action::Call { method: "nft_transfer".into(), args: format!(r#"{{"receiver_id":"{ALICE}","token_id":"12","memo":"released from living slide 7"}}"#), amount: 1, gas: 20 * TGAS, weight: 0 });
    // Only dish slides are accepted.
    assert_eq!(call(nft_on_transfer, DISH, "{}", 0).unwrap(), Some("false".into()));
    assert_eq!(call(nft_on_transfer, "other-nft.testnet", "{}", 0).unwrap(), Some("true".into()));
}

#[test]
fn storage_stays_bounded() {
    setup();
    let start = purse_kit::storage_usage();
    // T11: approvals are capped and paid for by the holder.
    for (i, a) in ["m1.testnet", "m2.testnet", "m3.testnet", "m4.testnet"].iter().enumerate() {
        assert!(call(nft_approve, ALICE, &format!(r#"{{"token_id":"7","account_id":"{a}"}}"#), 0).unwrap_err().contains("storage"), "{i}");
        call(nft_approve, ALICE, &format!(r#"{{"token_id":"7","account_id":"{a}"}}"#), MILLI).unwrap();
    }
    assert!(call(nft_approve, ALICE, r#"{"token_id":"7","account_id":"m5.testnet"}"#, MILLI).unwrap_err().contains("at most 4"));
    call(nft_revoke_all, ALICE, r#"{"token_id":"7"}"#, 1).unwrap();
    // The log is a ring: a hundred moves leave the state no bigger than its headroom allows.
    let people = ["a1.testnet", "a2.testnet"];
    let mut from = ALICE.to_string();
    for i in 0..100 {
        let to = people[i % 2];
        transfer(&from, to).unwrap();
        from = to.to_string();
    }
    call(list, &from, r#"{"price":"340282366920938463463374607431768211455"}"#, 1).unwrap();
    assert!(purse_kit::storage_usage() <= start + HEADROOM, "state grew by {}", purse_kit::storage_usage() - start);
    assert!(view(history, "{}").contains("\"total\":101"));
}

#[test]
fn every_sale_pays_the_minter_its_royalty() {
    setup();
    let payout = |balance: &str, max: &str| call(nft_payout, "anyone.testnet", &format!(r#"{{"token_id":"7","balance":"{balance}"{max}}}"#), 0);
    // The dish's rule: 5% to the minter, the rest to the holder who sells.
    assert_eq!(payout("1000000000000000000000000", "").unwrap().unwrap(), format!(r#"{{"payout":{{"{MINTER}":"50000000000000000000000","{ALICE}":"950000000000000000000000"}}}}"#));
    assert!(payout("100", r#","max_len_payout":1"#).unwrap_err().contains("max_len_payout"));
    // A cut that rounds to nothing names one account, and any max_len_payout of at least 1 takes it.
    assert_eq!(payout("19", r#","max_len_payout":1"#).unwrap().unwrap(), format!(r#"{{"payout":{{"{ALICE}":"19"}}}}"#));
    // No balance overflows.
    let max = u128::MAX;
    let cut = max / 10_000 * 500 + max % 10_000 * 500 / 10_000;
    assert_eq!(payout(&max.to_string(), "").unwrap().unwrap(), format!(r#"{{"payout":{{"{MINTER}":"{cut}","{ALICE}":"{}"}}}}"#, max - cut));
    assert!(payout("x", "").unwrap_err().contains("balance"));
    // Whoever holds it later pays the same minter.
    transfer(ALICE, BOB).unwrap();
    assert_eq!(payout("100", "").unwrap().unwrap(), format!(r#"{{"payout":{{"{MINTER}":"5","{BOB}":"95"}}}}"#));
    // The purse's own market pays the same split.
    call(list, BOB, r#"{"price":"20000"}"#, 1).unwrap();
    call(buy, CAROL, &format!(r#"{{"nonce":{}}}"#, nonce_now()), 20_000).unwrap();
    assert_eq!(paid(), vec![(MINTER.to_string(), 1_000), (BOB.to_string(), 19_000)]);
    assert_eq!(holder_now(), CAROL);
}

#[test]
fn the_minter_selling_keeps_the_whole_price() {
    setup();
    // Sold to the minter, then sold on by it: no cut to itself, one account in the split.
    transfer(ALICE, MINTER).unwrap();
    assert_eq!(view(nft_payout, r#"{"token_id":"7","balance":"1000","max_len_payout":1}"#), format!(r#"{{"payout":{{"{MINTER}":"1000"}}}}"#));
    call(list, MINTER, r#"{"price":"1000"}"#, 1).unwrap();
    call(buy, BOB, &format!(r#"{{"nonce":{}}}"#, nonce_now()), 1_000).unwrap();
    assert_eq!(paid(), vec![(MINTER.to_string(), 1_000)]);
    // The minter is fixed at setup: a sale by the next holder still pays it.
    assert_eq!(view(nft_payout, r#"{"token_id":"7","balance":"1000"}"#), format!(r#"{{"payout":{{"{MINTER}":"50","{BOB}":"950"}}}}"#));
}
