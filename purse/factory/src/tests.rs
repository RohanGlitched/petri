//! The sealing path against the mock chain. A native build embeds no purse code, so sealing itself is refused here;
//! the callbacks after creation are tested directly, and scripts/purse-testnet.mjs runs the whole path on testnet.

use super::*;
use purse_kit::mock::{call, with, Action};

const DISH: &str = "petri-v6.testnet";
const ME: &str = "slides.petri-v6.testnet";
const ALICE: &str = "alice.testnet";
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
    assert!(call(new, ALICE, &format!(r#"{{"dish":"{DISH}"}}"#), 0).unwrap_err().contains("only the factory account"));
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
    // No code embedded in a native build: refused, credit untouched.
    assert_eq!(on_transfer(DISH, ALICE, ALICE, "7").unwrap(), Some("true".into()));
    assert_eq!(call(credit_of, ALICE, &format!(r#"{{"account_id":"{ALICE}"}}"#), 0).unwrap(), Some(format!("\"{}\"", NEAR / 2)));
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
    assert_eq!(call(create_cost, ALICE, "{}", 0).unwrap(), Some(format!("\"{}\"", PURSE_EXTRA_BYTES as u128 * BYTE_COST)));
}
