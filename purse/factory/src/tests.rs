//! The sealing path against the mock chain. A native build embeds no purse code, so a few bytes stand in for it; the
//! callbacks are tested directly, and scripts/purse-testnet.mjs and scripts/purse-mainnet-v2.mjs run the whole path on
//! chain.

use super::*;
use purse_kit::mock::{call, with, Action};

const DISH: &str = "petri-v6.testnet";
const ME: &str = "slides.petri-v6.testnet";
const ALICE: &str = "alice.testnet";
const MINTER: &str = "minter.testnet";
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

fn setup() {
    with(|c| {
        *c = Default::default();
        c.current = ME.into();
        c.balance = NEAR;
        c.prepaid_gas = 300 * TGAS;
    });
    call(new, ME, &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap();
}

fn on_transfer(from: &str, sender: &str, owner: &str, token: &str) -> Result<Option<String>, String> {
    call(nft_on_transfer, from, &format!(r#"{{"sender_id":"{sender}","previous_owner_id":"{owner}","token_id":"{token}","msg":""}}"#), 0)
}

#[test]
fn set_up_once_by_itself() {
    setup();
    assert!(call(new, ME, &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("already"));
    with(|c| c.storage.clear());
    assert!(call(new, ALICE, &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("only the factory account or its parent"));
    // The parent account that creates it may set it up in the same transaction, so the factory never needs a key.
    call(new, "petri-v6.testnet", &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap();
    assert!(call(new, "petri-v6.testnet", &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("already"));
    with(|c| c.storage.clear());
    // Not the parent's parent, nor a look-alike.
    assert!(call(new, "testnet", &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("only the factory account or its parent"));
    assert!(call(new, "v6.testnet", &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("only the factory account or its parent"));
}

#[test]
fn prepay_and_refund() {
    setup();
    assert!(call(prepay, ALICE, "{}", 1).unwrap_err().contains("at least 0.01"));
    assert_eq!(call(prepay, ALICE, "{}", NEAR / 10).unwrap(), Some(format!("\"{}\"", NEAR / 10)));
    assert_eq!(call(prepay, "bob.testnet", &format!(r#"{{"account_id":"{ALICE}"}}"#), NEAR / 10).unwrap(), Some(format!("\"{}\"", NEAR / 5)));
    assert_eq!(call(credit_of, ALICE, &format!(r#"{{"account_id":"{ALICE}"}}"#), 0).unwrap(), Some(format!("\"{}\"", NEAR / 5)));
    call(refund, ALICE, "{}", 1).unwrap();
    assert!(with(|c| c.promises[0].account == ALICE && c.promises[0].actions[0] == Action::Transfer(NEAR / 5 + 1)));
    assert!(call(refund, ALICE, "{}", 1).unwrap_err().contains("no prepayment"));
}

#[test]
fn only_the_dish_and_only_the_owner_seal() {
    setup();
    call(prepay, ALICE, "{}", NEAR / 2).unwrap();
    // Some other NFT contract: given back.
    assert_eq!(on_transfer("other-nft.testnet", ALICE, ALICE, "7").unwrap(), Some("true".into()));
    // An approved account moving someone else's slide here: given back, the owner must do it.
    assert_eq!(on_transfer(DISH, "market.testnet", ALICE, "7").unwrap(), Some("true".into()));
    // Not a plain token id: given back.
    assert_eq!(on_transfer(DISH, ALICE, ALICE, "07").unwrap(), Some("true".into()));
    // Without enough credit: given back.
    assert_eq!(on_transfer(DISH, "bob.testnet", "bob.testnet", "7").unwrap(), Some("true".into()));
    // The owner's own slide, credit enough: the factory asks the dish who minted it, and charges nothing yet.
    on_transfer(DISH, ALICE, ALICE, "7").unwrap();
    let p = with(|c| c.promises.clone());
    assert_eq!(p[0].account, DISH);
    assert_eq!(p[0].actions[0], Action::Call { method: "nft_payout".into(), args: r#"{"token_id":"7","balance":"10000","max_len_payout":2}"#.into(), amount: 0, gas: 10 * TGAS, weight: 0 });
    assert_eq!((p[1].account.as_str(), p[1].after), (ME, Some(0)));
    assert!(matches!(&p[1].actions[0], Action::Call { method, args, .. } if method == "on_minter" && args == &format!(r#"{{"token_id":"7","owner":"{ALICE}"}}"#)));
    assert_eq!(call(credit_of, ALICE, &format!(r#"{{"account_id":"{ALICE}"}}"#), 0).unwrap(), Some(format!("\"{}\"", NEAR / 2)));
}

fn on_minter_with(result: Option<&str>) -> Result<Option<String>, String> {
    with(|c| c.results = vec![result.map(|r| r.as_bytes().to_vec())]);
    call(on_minter, ME, &format!(r#"{{"token_id":"7","owner":"{ALICE}"}}"#), 0)
}

#[test]
fn the_purse_is_made_with_the_minter_the_dish_names() {
    setup();
    call(prepay, ALICE, "{}", NEAR / 2).unwrap();
    let credit = || call(credit_of, ALICE, &format!(r#"{{"account_id":"{ALICE}"}}"#), 0).unwrap().unwrap();
    // The dish's split names the minter beside the factory (the slide's owner while it is sealed).
    let split = format!(r#"{{"payout":{{"{ME}":"9500","{MINTER}":"500"}}}}"#);
    on_minter_with(Some(&split)).unwrap();
    let p = with(|c| c.promises.clone());
    assert_eq!(p[0].account, format!("slide-7.{ME}"));
    assert_eq!(p[0].actions[0], Action::CreateAccount);
    assert_eq!(p[0].actions[1], Action::Transfer(cost()));
    assert!(matches!(p[0].actions[2], Action::Deploy(n) if n > 0));
    assert_eq!(p[0].actions[3], Action::Call { method: "init".into(), args: format!(r#"{{"dish":"{DISH}","holder":"{ALICE}","minter":"{MINTER}"}}"#), amount: 0, gas: 10 * TGAS, weight: 0 });
    // No key is added: create, fund, deploy, init and nothing else.
    assert_eq!(p[0].actions.len(), 4);
    assert_eq!(credit(), format!("\"{}\"", NEAR / 2 - cost()));
    // The minter sealing its own slide: it is the minter and the holder.
    let own = format!(r#"{{"payout":{{"{ALICE}":"500","{ME}":"9500"}}}}"#);
    on_minter_with(Some(&own)).unwrap();
    assert!(with(|c| c.promises[0].actions[3] == Action::Call { method: "init".into(), args: format!(r#"{{"dish":"{DISH}","holder":"{ALICE}","minter":"{ALICE}"}}"#), amount: 0, gas: 10 * TGAS, weight: 0 }));
    let before = credit();
    // The dish's answer failed, or named nobody but the factory: the slide goes back and nothing is charged.
    for bad in [None, Some(format!(r#"{{"payout":{{"{ME}":"10000"}}}}"#)), Some("null".to_string()), Some(r#"{"payout":{"Not An Account":"500"}}"#.to_string())] {
        assert_eq!(on_minter_with(bad.as_deref()).unwrap(), Some("true".into()));
        assert!(with(|c| c.promises.is_empty()));
        assert_eq!(credit(), before);
    }
    // Credit spent by another sealing in the meantime: given back, not created.
    call(refund, ALICE, "{}", 1).unwrap();
    assert_eq!(on_minter_with(Some(&split)).unwrap(), Some("true".into()));
    assert!(with(|c| c.promises.is_empty()));
    assert!(call(on_minter, ALICE, &format!(r#"{{"token_id":"7","owner":"{ALICE}"}}"#), 0).unwrap_err().contains("only the factory itself"));
}

#[test]
fn a_failed_creation_gives_the_slide_and_the_credit_back() {
    setup();
    let args = format!(r#"{{"token_id":"7","owner":"{ALICE}","cost":"{}"}}"#, NEAR / 10);
    with(|c| c.results = vec![None]);
    assert_eq!(call(on_created, ME, &args, 0).unwrap(), Some("true".into()));
    assert_eq!(call(credit_of, ALICE, &format!(r#"{{"account_id":"{ALICE}"}}"#), 0).unwrap(), Some(format!("\"{}\"", NEAR / 10)));
    // Created: the slide moves on into the purse, with one yoctoNEAR, and on_sealed decides.
    with(|c| c.results = vec![Some(vec![])]);
    call(on_created, ME, &args, 0).unwrap();
    let p = with(|c| c.promises.clone());
    assert_eq!(p[0].account, DISH);
    assert_eq!(p[0].actions[0], Action::Call { method: "nft_transfer".into(), args: format!(r#"{{"receiver_id":"slide-7.{ME}","token_id":"7","memo":"sealed into its living slide"}}"#), amount: 1, gas: 20 * TGAS, weight: 0 });
    with(|c| c.results = vec![Some(vec![])]);
    assert_eq!(call(on_sealed, ME, "{}", 0).unwrap(), Some("false".into()));
    with(|c| c.results = vec![None]);
    assert_eq!(call(on_sealed, ME, "{}", 0).unwrap(), Some("true".into()));
    assert!(call(on_created, ALICE, &args, 0).unwrap_err().contains("only the factory itself"));
}

#[test]
fn views() {
    setup();
    assert_eq!(call(purse_of, ALICE, r#"{"token_id":"12"}"#, 0).unwrap(), Some(format!("\"slide-12.{ME}\"")));
    assert!(call(purse_of, ALICE, r#"{"token_id":"x"}"#, 0).is_err());
    assert_eq!(call(create_cost, ALICE, "{}", 0).unwrap(), Some(format!("\"{}\"", (code().len() as u128 + PURSE_EXTRA_BYTES as u128) * BYTE_COST)));
}
