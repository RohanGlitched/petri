use super::*;
use petri_core::feed;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use petri_core::patterns;

const MS: u64 = 1_000_000; // nanoseconds per millisecond
const GEN_MS: u64 = 15_000;
const P: u128 = 1_000_000;
const MAX: u128 = 1_000_000 * P;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const T0: u64 = 1_000_000;

/// The launch rules exactly as deployed (contract/launch-rules.json), on a 32 × 32 dish with tides every 8 generations
/// so tests run quickly. Every economic parameter is the launched one.
fn launch() -> Rules {
    near_sdk::serde_json::from_str(include_str!("../launch-rules.json")).unwrap()
}

fn rules() -> Rules {
    Rules {
        width: 32,
        height: 32,
        tide_every: 8,
        max_catchup: 40,
        max_lag: 400,
        house: vec!["house.testnet".parse().unwrap()],
        ..launch()
    }
}

#[test]
fn the_tests_use_the_launched_economics() {
    let l = launch();
    let r = rules();
    assert_eq!((l.feed_ppm, l.reach, l.stake_keep_bps, l.siege_x, l.tide_bps, l.sell_bps, l.sell_cap_bps), (r.feed_ppm, r.reach, r.stake_keep_bps, r.siege_x, r.tide_bps, r.sell_bps, r.sell_cap_bps));
    assert_eq!(l.house.len(), 5);
}

fn ctx(who: &str, ms: u64, deposit: u128) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who.parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(ms * MS)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    testing_env!(b.build());
}

fn at(who: &str, ms: u64) {
    ctx(who, ms, 0);
}

fn cells(x: i32, y: i32, shape: &[(i32, i32)]) -> Vec<u32> {
    let d = Dish::new(32, 32);
    shape.iter().map(|&(dx, dy)| d.index(x + dx, y + dy) as u32).collect()
}

fn acct(who: &str) -> AccountId {
    who.parse().unwrap()
}

fn bal(c: &Petri, who: &str) -> u128 {
    c.ft_balance_of(acct(who)).0
}

/// Nothing is created or lost: every PETRI is in an account or held by the dish (agar, unclaimed earnings, keeper
/// pot), or burned. And the NEAR books close: what came in is in the vault or went out at tides, bounties and sales.
fn conserved(c: &Petri, holders: &[&str]) {
    let s = c.state();
    assert_eq!(s.total_supply.0, MAX - s.burned.0, "supply = launch supply - burned");
    let held: u128 = holders.iter().map(|h| bal(c, h)).sum();
    assert_eq!(held + bal(c, "petri.testnet"), s.total_supply.0, "balances + the dish's own = supply");
    assert_eq!(bal(c, "petri.testnet"), s.agar.0 + s.unclaimed.0 + s.keeper_pot.0);
    let unclaimed: u128 = c.load_u64s(EARNED_KEY).iter().map(|&v| v as u128).sum();
    assert_eq!(unclaimed, s.unclaimed.0, "the unclaimed counter matches the record");
    assert_eq!(s.agar.0, MAX - s.sold.0 - s.fed.0 + s.returned.0 + s.bought_back.0, "agar = launch - sold - fed + returned + bought back");
    let mut out = 0u128;
    let mut back = 0u128;
    let mut credit_out = 0u128;
    for e in c.ledger(None, Some(1_000)) {
        match e {
            Entry::Tide { bounty, storage, paid, credit_paid, .. } => {
                out += bounty.0 + storage.0 + paid.0;
                credit_out += credit_paid.0;
            }
            Entry::Sell { near, .. } => out += near.0,
            Entry::Refund { near, .. } => back += near.0,
            _ => {}
        }
    }
    assert_eq!(s.vault.0 + out, s.near_in.0 + back, "vault = NEAR in - everything paid out + refunds");
    assert_eq!(s.credit_pool.0 + credit_out, s.credit_in.0, "credit pool = credit in - credit paid out");
    assert!(c.solvency().solvent, "the contract covers everything it owes");
}

fn new_dish() -> Petri {
    at("deployer.testnet", T0);
    Petri::new(rules())
}

fn join(c: &mut Petri, who: &str, ms: u64, name: &str, color: u32, near: u128) {
    ctx(who, ms, near);
    c.join(name.into(), color, None);
}

fn plant(c: &mut Petri, who: &str, ms: u64, cs: Vec<u32>, note: Option<&str>) {
    let d = c.plant_deposit(cs.len() as u32, note.map(|n| n.len() as u32)).0;
    ctx(who, ms, d);
    c.plant(cs, note.map(|n| n.into()), None);
}

#[test]
fn launch_puts_every_petri_in_the_agar() {
    let c = new_dish();
    let s = c.state();
    assert_eq!(s.agar.0, MAX);
    assert_eq!(s.total_supply.0, MAX);
    assert_eq!(bal(&c, "petri.testnet"), MAX);
    assert_eq!(c.checkpoints(None, None).len(), 1, "generation zero");
    conserved(&c, &[]);
}

#[test]
fn joining_buys_petri_with_near_into_the_vault() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let s = c.state();
    let held = bal(&c, "alice.testnet");
    assert!(held > 0, "joining bought PETRI");
    assert_eq!(s.sold.0, held);
    assert!(s.vault.0 > 0 && s.vault.0 < NEAR / 50, "the vault holds what joining paid, less storage");
    assert_eq!(s.vault.0, s.near_in.0);
    assert_eq!(held, petri_for_near(s.vault.0, MAX, NEAR / 5_000 / 1_000_000 * MAX), "the purchase follows the curve");
    assert!(held > 60 * P && held < 100 * P, "{}", held);
    assert_eq!(c.ledger(None, None).len(), 2, "a join and a purchase");
    assert_eq!(c.colony_of(acct("alice.testnet")).unwrap().near_paid.0, NEAR / 50);
    conserved(&c, &["alice.testnet"]);
}

#[test]
#[should_panic(expected = "joining needs at least")]
fn joining_needs_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 1_000);
}

#[test]
#[should_panic(expected = "already exists")]
fn names_are_unique() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Safranin", 1, NEAR / 50);
    join(&mut c, "mallory.testnet", T0, "safranin", 2, NEAR / 50);
}

#[test]
#[should_panic(expected = "a name may use only")]
fn names_cannot_hide_characters() {
    let mut c = new_dish();
    join(&mut c, "mallory.testnet", T0, "Safr\u{202e}anin", 2, NEAR / 50);
}

#[test]
#[should_panic(expected = "a name may use only")]
fn names_cannot_use_look_alike_letters() {
    let mut c = new_dish();
    // A Cyrillic "а" in place of the Latin "a".
    join(&mut c, "mallory.testnet", T0, "S\u{0430}franin", 2, NEAR / 50);
}

#[test]
#[should_panic(expected = "invisible or tag")]
fn notes_cannot_carry_invisible_text() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), Some("hello\u{E0041}\u{E0042}"));
}

#[test]
#[should_panic(expected = "does not play on itself")]
fn the_contract_cannot_join() {
    let mut c = new_dish();
    join(&mut c, "petri.testnet", T0, "Agar", 1, NEAR / 50);
}

#[test]
#[should_panic(expected = "does not play on itself")]
fn the_contract_cannot_send_the_agar() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("petri.testnet", T0, 1);
    c.ft_transfer(acct("alice.testnet"), U128(1_000 * P), None);
}

#[test]
fn planting_charges_the_payback_price_and_half_comes_back() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let before = c.state();
    let price = c.quote(4, None).0;
    // A nearly empty dish counts 1,000 cells. The agar pays 10 ppm of itself, 98% of that to cells, for 480 generations.
    let per_cell = before.agar.0 * 3 / 1_000_000 * 9_800 / 10_000 / 1_000;
    assert_eq!(price, 4 * per_cell * 480);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), Some("first block"));
    let s = c.state();
    assert_eq!(s.burned.0, price / 2);
    assert_eq!(s.returned.0, price - price / 2);
    assert_eq!(s.agar.0, before.agar.0 + price - price / 2);
    assert!(s.vault.0 > before.vault.0, "the planting fee went to the vault");
    let p = &c.plants(None, None)[0];
    assert_eq!(p.cost.0, price);
    assert!(!p.siege);
    assert_eq!(p.note.as_deref(), Some("first block"));
    conserved(&c, &["alice.testnet"]);
}

#[test]
#[should_panic(expected = "needs at least")]
fn planting_needs_its_fee() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("alice.testnet", T0, 0);
    c.plant(cells(2, 2, patterns::BLOCK), None, None);
}

#[test]
fn planting_inside_a_rival_buffer_is_a_siege_at_siege_x_the_price() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 20);
    let normal = c.quote(4, None).0;
    let siege = c.quote(4, Some(true)).0;
    assert_eq!(siege, rules().siege_x as u128 * normal);
    let held = bal(&c, "bob.testnet");
    plant(&mut c, "bob.testnet", T0, cells(6, 2, patterns::BLOCK), None);
    assert_eq!(held - bal(&c, "bob.testnet"), siege);
    assert!(c.plants(None, None)[1].siege);
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "one planting per generation")]
fn one_planting_per_generation() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    plant(&mut c, "alice.testnet", T0, cells(20, 20, patterns::BLOCK), None);
}

#[test]
fn the_feed_accrues_and_is_claimed() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let held = bal(&c, "alice.testnet");
    at("keeper.testnet", T0 + 5 * GEN_MS);
    c.advance(None);
    let waiting = c.claimable(acct("alice.testnet")).petri.0;
    assert!(waiting > 0, "a living block earns");
    assert_eq!(bal(&c, "alice.testnet"), held, "earnings wait until claimed");
    at("alice.testnet", T0 + 5 * GEN_MS);
    let got = c.claim().petri.0;
    assert_eq!(got, waiting);
    assert_eq!(bal(&c, "alice.testnet"), held + waiting);
    assert_eq!(c.earnings(None, None)[0].0, waiting, "lifetime earnings count the claim");
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn pay_is_capped_by_cells_planted_and_splitting_does_not_help() {
    // A five-cell R-pentomino grows wild; with reach 2 it is paid for at most 10 cells (before any tide decays it).
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { reach: 2, ..rules() });
    join(&mut c, "wild.testnet", T0, "Wild", 1, NEAR / 20);
    plant(&mut c, "wild.testnet", T0, cells(4, 4, patterns::R_PENTOMINO), None);
    join(&mut c, "steady.testnet", T0, "Steady", 2, NEAR / 20);
    plant(&mut c, "steady.testnet", T0, cells(24, 24, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 30 * GEN_MS);
    c.advance(None);
    let d = c.load_dish();
    let live = d.live_counts(2);
    assert!(live[1] > 10, "the pentomino grew past its cap: {}", live[1]);
    // Every generation the wild colony counted as at most 10 cells and the block as 4 (its cap is 8).
    let wild = c.earnings(None, None)[0].0;
    let steady = c.earnings(None, None)[1].0;
    assert!(wild * 4 <= steady * 10 + 30, "wild {} steady {}", wild, steady);
    conserved(&c, &["wild.testnet", "steady.testnet", "keeper.testnet"]);
}

#[test]
fn the_keeper_pot_goes_to_whoever_advances_the_clock() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // An unregistered caller moves the dish but leaves the pot.
    at("stranger.testnet", T0 + 3 * GEN_MS);
    c.advance(None);
    let pot = c.state().keeper_pot.0;
    assert!(pot > 0);
    assert_eq!(bal(&c, "stranger.testnet"), 0);
    ctx("keeper.testnet", T0 + 3 * GEN_MS, NEAR / 100);
    c.storage_deposit(None, None);
    // Advancing nothing collects nothing.
    at("keeper.testnet", T0 + 3 * GEN_MS);
    c.advance(Some(0));
    assert_eq!(bal(&c, "keeper.testnet"), 0, "no generation run, no pot");
    at("keeper.testnet", T0 + 4 * GEN_MS);
    c.advance(None);
    assert!(bal(&c, "keeper.testnet") > pot);
    assert_eq!(c.state().keeper_pot.0, 0);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn tides_pay_by_what_was_earned_since_the_last_tide() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 50);
    // Bob plants a block one generation before the tide: he earns one generation's worth of the window, not half.
    at("keeper.testnet", T0 + 7 * GEN_MS);
    c.advance(None);
    plant(&mut c, "bob.testnet", T0 + 7 * GEN_MS, cells(20, 20, patterns::BLOCK), None);
    let vault = c.state().vault.0;
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.tides.0, 1);
    let alice = c.claimable(acct("alice.testnet")).near.0;
    let bob = c.claimable(acct("bob.testnet")).near.0;
    assert!(bob > 0 && alice > 6 * bob, "alice {} bob {}", alice, bob);
    let r = rules();
    let pay = vault * r.tide_bps as u128 / 10_000;
    let bounty = (pay * r.tide_bounty_bps as u128 / 10_000).min(r.max_bounty.0);
    assert_eq!(s.near_bounties.0, bounty, "the caller who ran the tide got its capped bounty");
    let storage = c.ledger(None, None).iter().find_map(|e| if let Entry::Tide { storage, .. } = e { Some(storage.0) } else { None }).unwrap();
    assert!(alice + bob <= pay - bounty - storage && alice + bob + 10 > pay - bounty - storage, "the rest went to colonies, less the tide's storage");
    at("alice.testnet", T0 + 8 * GEN_MS);
    assert_eq!(c.claim().near.0, alice);
    assert_eq!(c.claimable(acct("alice.testnet")).near.0, 0);
    assert_eq!(c.tide_winnings(None, None)[0].0, alice);
    assert_eq!(c.checkpoints(None, None).len(), 2, "generation zero and the tide");
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
fn the_house_plays_but_takes_no_tide() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "Congo Red", 1, NEAR / 50);
    plant(&mut c, "house.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(20, 20, patterns::BLOCK), None);
    assert!(c.colony_of(acct("house.testnet")).unwrap().house);
    assert_eq!(c.state().house, vec![1]);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    assert_eq!(c.claimable(acct("house.testnet")).petri.0, 0, "the house is never fed");
    assert_eq!(c.claimable(acct("house.testnet")).near.0, 0, "and wins no NEAR");
    assert!(c.claimable(acct("alice.testnet")).petri.0 > 0);
    assert!(c.claimable(acct("alice.testnet")).near.0 > 0);
    conserved(&c, &["house.testnet", "alice.testnet", "keeper.testnet"]);
}

#[test]
fn sponsored_credit_pays_for_joining_and_planting_and_cannot_leave() {
    let mut c = new_dish();
    ctx("relayer.testnet", T0, NEAR / 20);
    let credit = c.sponsor(acct("g-1.relayer.testnet")).0;
    assert!(credit > NEAR / 21 && credit < NEAR / 20, "the record's storage is taken from the sponsorship");
    ctx("g-1.relayer.testnet", T0, 0);
    c.join("Guest".into(), 3, Some(U128(NEAR / 50)));
    assert_eq!(c.credit_of(acct("g-1.relayer.testnet")).0, credit - NEAR / 50);
    let d = c.plant_deposit(4, None).0;
    ctx("g-1.relayer.testnet", T0, 0);
    c.plant(cells(2, 2, patterns::BLOCK), None, Some(U128(d)));
    let s = c.state();
    assert_eq!(s.credit_spent.0, NEAR / 50 + d);
    assert_eq!(s.credit_given.0, credit);
    assert_eq!(s.vault.0, 0, "sponsored NEAR never reaches the NEAR vault");
    assert!(s.credit_pool.0 > 0);
    assert_eq!(c.colony_of(acct("g-1.relayer.testnet")).unwrap().near_paid.0, NEAR / 50 + d);
    conserved(&c, &["g-1.relayer.testnet"]);
}

#[test]
#[should_panic(expected = "sponsored credit")]
fn credit_cannot_be_overspent() {
    let mut c = new_dish();
    ctx("relayer.testnet", T0, NEAR / 100);
    c.sponsor(acct("g-1.relayer.testnet"));
    ctx("g-1.relayer.testnet", T0, 0);
    c.join("Guest".into(), 3, Some(U128(NEAR / 50)));
}

#[test]
fn the_agar_buys_back_at_half_price_up_to_a_tenth_of_the_vault() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // Nothing can be sold before the first tide opens the allowance.
    assert_eq!(c.state().sell_left.0, 0);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.sell_left.0, s.vault.0 / 10);
    let units = 100 * P;
    let quote = c.sell_quote(U128(units)).0;
    // Half of what 100 PETRI would cost on the curve, unless their share of the vault is less.
    let k = NEAR / 5_000 / 1_000_000 * MAX;
    let full = k / (s.agar.0 + units / 2) * units;
    let share = s.vault.0 / (s.total_supply.0 - s.agar.0) * units;
    let want = (full / 2).min(share);
    assert!(quote.abs_diff(want) < NEAR / 1_000_000, "{} vs {}", quote, want);
    let held = bal(&c, "alice.testnet");
    at("alice.testnet", T0 + 8 * GEN_MS);
    let paid = c.sell(U128(units)).0;
    assert!(paid < quote && paid > quote - NEAR / 500, "the sale's record is paid from it");
    assert_eq!(bal(&c, "alice.testnet"), held - units);
    let after = c.state();
    assert_eq!(after.bought_back.0, units);
    assert_eq!(after.sell_left.0, s.sell_left.0 - quote);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "buys back at most")]
fn the_buy_back_allowance_runs_out() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 20);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    at("alice.testnet", T0 + 8 * GEN_MS);
    let all = bal(&c, "alice.testnet");
    c.sell(U128(all));
}

#[test]
fn transfers_need_a_registered_receiver() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    assert!(c.storage_balance_of(acct("bob.testnet")).is_none());
    ctx("bob.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    assert!(c.storage_balance_of(acct("bob.testnet")).is_some());
    ctx("alice.testnet", T0, 1);
    c.ft_transfer(acct("bob.testnet"), U128(1), None);
    assert_eq!(bal(&c, "bob.testnet"), 1, "small amounts move fine once registered");
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "not registered")]
fn transfers_to_strangers_fail() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("alice.testnet", T0, 1);
    c.ft_transfer(acct("bob.testnet"), U128(P), None);
}

#[test]
#[should_panic(expected = "a lab note is at most")]
fn lab_notes_are_short() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let long = "x".repeat(141);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), Some(&long));
}

#[test]
fn catch_up_is_capped_and_plant_waits_for_the_clock() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    at("keeper.testnet", T0 + 100 * GEN_MS);
    c.advance(None);
    assert_eq!(c.state().generation.0, 40);
    c.advance(None);
    c.advance(None);
    assert_eq!(c.state().generation.0, 100);
    conserved(&c, &["alice.testnet"]);
}

#[test]
fn many_living_colonies_advance_with_one_summary_log() {
    let mut c = new_dish();
    let mut holders = vec![];
    // 25 colonies, each with a block on a 5 × 5 grid of the 32 × 32 dish (6 cells apart clears the 3-cell buffer).
    for i in 0..25u32 {
        let who = format!("c{}.testnet", i);
        join(&mut c, &who, T0, &format!("C{}", i), i, NEAR / 50);
        let (x, y) = (1 + 6 * (i % 5) as i32, 1 + 6 * (i / 5) as i32);
        plant(&mut c, &who, T0, cells(x, y, patterns::BLOCK), None);
        holders.push(who);
    }
    let _ = get_logs();
    at("keeper.testnet", T0 + 40 * GEN_MS);
    c.advance(None);
    let logs = get_logs();
    let bytes: usize = logs.iter().map(|l| l.len()).sum();
    assert!(logs.len() <= 3, "catch-up logs a summary, not one line per colony: {}", logs.len());
    assert!(bytes < 1_500, "{} bytes of logs", bytes);
    assert!(c.earnings(None, None).iter().all(|e| e.0 > 0), "every colony earned");
    let refs: Vec<&str> = holders.iter().map(|s| s.as_str()).collect();
    conserved(&c, &refs);
}

/// Replays the ledger with petri-core alone, the way /verify and scripts/verify.mjs do, and checks the board, the
/// chain, the agar, every colony's earnings, the vault, every tide and every colony's tide winnings.
#[test]
fn replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault() {
    let mut c = new_dish();
    let mut t = T0;
    join(&mut c, "alice.testnet", t, "Alice", 1, NEAR / 5);
    plant(&mut c, "alice.testnet", t, cells(2, 2, patterns::GLIDER), Some("off we go"));
    join(&mut c, "bob.testnet", t, "Bob", 2, NEAR / 5);
    plant(&mut c, "bob.testnet", t, cells(18, 18, patterns::BEEHIVE), None);
    join(&mut c, "house.testnet", t, "House", 3, NEAR / 20);
    for g in 0..37u64 {
        t += GEN_MS;
        let who = ["alice.testnet", "bob.testnet", "house.testnet"][(g % 3) as usize];
        let x = 2 + ((g * 5) % 24) as i32;
        let d = c.plant_deposit(3, None).0;
        ctx(who, t, d);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.plant(cells(x, 28, patterns::BLINKER), None, None);
        }));
        if g % 9 == 0 {
            ctx(who, t, NEAR / 100);
            c.buy(None);
        }
        if g == 20 {
            at("alice.testnet", t);
            c.sell(U128(30 * P));
        }
        at("keeper.testnet", t);
        c.advance(None);
    }
    let s = c.state();
    let r = c.rules();
    let mut dish = Dish::new(32, 32);
    let mut chain = [0u8; 32];
    let mut agar = MAX;
    let mut vault = 0u128;
    let mut pool = 0u128;
    let mut burned = 0u128;
    let mut counted = 0u32;
    let mut earned = vec![0u128; 4];
    let mut window = vec![0u64; 4];
    let mut won = vec![0u128; 4];
    let mut planted = vec![0u64; 4];
    let mut house: Vec<u16> = vec![];
    let colonies_view = c.colonies(None, None);
    let mut colonies = 0u16;
    let log = c.ledger(None, Some(1000));
    let mut tides_seen = 0;
    let mut li = 0;
    let mut g = 0u64;
    loop {
        while li < log.len() {
            let gen = match &log[li] {
                Entry::Join { generation, .. } | Entry::Buy { generation, .. } | Entry::Plant { generation, .. } | Entry::Sell { generation, .. } | Entry::Tide { generation, .. } | Entry::Skip { generation, .. } | Entry::Refund { generation, .. } => generation.0,
            };
            if gen != g {
                break;
            }
            match &log[li] {
                Entry::Join { colony, .. } => {
                    colonies += 1;
                    if colonies_view[*colony as usize - 1].house {
                        house.push(*colony);
                    }
                }
                Entry::Buy { petri, near, credit, .. } => {
                    assert_eq!(petri_for_near(near.0 + credit.0, agar, r.petri_price.0 / 1_000_000 * MAX), petri.0, "purchase on the curve");
                    agar -= petri.0;
                    vault += near.0;
                    pool += credit.0;
                }
                Entry::Plant { colony, cells, cost, near, credit, siege, .. } => {
                    let cells: Vec<u32> = cells.iter().map(|&c| c as u32).collect();
                    let cells = &cells;
                    let check = dish.check_plant(*colony, cells, r.buffer, r.max_plant_cells, &house).expect("a legal planting");
                    assert_eq!(check.siege, *siege);
                    let per = feed_per_cell(agar, r.feed_ppm, r.keeper_bps, counted, r.live_floor);
                    assert_eq!(planting_cost(per, r.payback, r.min_cell_price.0, cells.len() as u32, *siege, r.siege_x), cost.0, "price at generation {}", g);
                    agar += cost.0 - cost.0 * r.burn_bps as u128 / 10_000;
                    burned += cost.0 * r.burn_bps as u128 / 10_000;
                    planted[*colony as usize] += cells.len() as u64 * petri_core::STAKE_UNIT;
                    vault += near.0;
                    pool += credit.0;
                    dish.plant_unchecked(*colony, cells);
                }
                Entry::Sell { petri, near, .. } => {
                    let outstanding = MAX - burned - agar;
                    assert_eq!(petri_core::sell_back(petri.0, agar, r.petri_price.0 / 1_000_000 * MAX, r.sell_bps, vault, outstanding), near.0, "sale on the curve");
                    agar += petri.0;
                    vault -= near.0;
                }
                Entry::Tide { .. } => panic!("a tide is recorded while stepping"),
                Entry::Skip { .. } => {}
                Entry::Refund { near, .. } => vault += near.0,
            }
            li += 1;
        }
        if g == s.generation.0 {
            break;
        }
        let stats = dish.step(colonies);
        g += 1;
        if chain_due(g) {
            chain = chain_next(&chain, g, &dish.hash());
        }
        let f = feed(agar, r.feed_ppm, r.keeper_bps, r.reach, r.live_floor, &stats.live, &planted, &house);
        counted = f.weight;
        agar -= f.paid;
        for &(i, v) in &f.shares {
            earned[i as usize] += v;
            window[i as usize] += v as u64;
        }
        if g % r.tide_every as u64 == 0 {
            let Entry::Tide { generation, chain: ch, pay, bounty, storage, paid, credit_pay, credit_paid } = &log[li] else { panic!("tide entry at {}", g) };
            assert_eq!(generation.0, g);
            assert_eq!(*ch, hex::encode(chain));
            assert_eq!(pay.0, vault * r.tide_bps as u128 / 10_000);
            let (split, total) = tide_split((pay.0 - (pay.0 * r.tide_bounty_bps as u128 / 10_000).min(r.max_bounty.0)).saturating_sub(storage.0), &window, &house);
            assert_eq!(total, paid.0);
            for (i, v) in split {
                won[i as usize] += v;
            }
            vault -= paid.0 + bounty.0 + storage.0;
            assert_eq!(credit_pay.0, pool * r.tide_bps as u128 / 10_000);
            let (_, ctotal) = tide_split(credit_pay.0, &window, &house);
            assert_eq!(ctotal, credit_paid.0);
            pool -= credit_paid.0;
            window.iter_mut().for_each(|w| *w = 0);
            for st in planted.iter_mut() {
                *st = petri_core::decay_stake(*st, r.stake_keep_bps);
            }
            tides_seen += 1;
            li += 1;
        }
    }
    assert!(tides_seen >= 4);
    assert_eq!(li, log.len(), "every entry replayed");
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    assert_eq!(agar, s.agar.0);
    assert_eq!(vault, s.vault.0);
    assert_eq!(pool, s.credit_pool.0);
    let e = c.earnings(None, None);
    let w = c.tide_winnings(None, None);
    for i in 0..3 {
        assert_eq!(e[i].0, earned[i + 1]);
        assert_eq!(w[i].0, won[i + 1]);
    }
    assert_eq!(won[3], 0, "the house won nothing");
    conserved(&c, &["alice.testnet", "bob.testnet", "house.testnet", "keeper.testnet"]);
}

#[test]
fn the_planting_deposit_covers_its_storage_without_overcharging() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 10);
    for (n, shape) in [(4usize, patterns::BLOCK), (36, patterns::GOSPER_GUN)] {
        let cs = cells(if n == 4 { 2 } else { 4 }, if n == 4 { 2 } else { 14 }, shape);
        let d = c.plant_deposit(cs.len() as u32, None).0;
        let fee = c.rules().cell_fee.0 * cs.len() as u128;
        let t = T0 + if n == 4 { 0 } else { GEN_MS };
        at("keeper.testnet", t);
        c.advance(None);
        let before = env::storage_usage();
        ctx("alice.testnet", t, d);
        let vault = c.state().vault.0;
        c.plant(cs, None, None);
        let used = (env::storage_usage() - before) as u128 * env::storage_byte_cost().as_yoctonear();
        eprintln!("{} cells: {} bytes", n, env::storage_usage() - before);
        assert!(d >= used + fee, "{} cells: deposit {} < storage {} + fee", n, d, used);
        assert!(d - fee <= used * 3 / 2, "{} cells: deposit {} asks much more than the storage {}", n, d - fee, used);
        assert_eq!(c.state().vault.0 - vault, d - used.min(d), "the rest goes to the vault");
    }
}

#[test]
fn a_lone_block_earns_what_its_price_assumes() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let price = c.quote(4, None).0;
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 10 * GEN_MS);
    c.advance(None);
    let earned = c.claimable(acct("alice.testnet")).petri.0;
    // Ten generations of a 480-generation payback: about a 48th of the price, not the whole ration.
    let want = price * 10 / 480;
    assert!(earned.abs_diff(want) * 100 <= want, "earned {} vs {}", earned, want);
    assert_eq!(c.state().counted, 4);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn an_untended_dish_skips_ahead_instead_of_piling_up_work() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // A thousand generations pass with nobody calling.
    at("alice.testnet", T0 + 1_000 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.skipped.0, 1_000 - 40, "the clock skipped to max_catchup behind");
    assert_eq!(s.generation.0, 40);
    assert_eq!(s.due_generation.0, 40, "and caught up in one call");
    plant(&mut c, "alice.testnet", T0 + 1_000 * GEN_MS, cells(20, 20, patterns::BLOCK), None);
    conserved(&c, &["alice.testnet"]);
}

#[test]
fn stake_decays_so_ground_is_rent() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    assert_eq!(c.stakes(None, None)[0].0, 4 * petri_core::STAKE_UNIT);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    assert_eq!(c.stakes(None, None)[0].0, 4 * petri_core::STAKE_UNIT * 8_750 / 10_000);
}

#[test]
fn a_guest_collects_winnings_in_a_wallet() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 20);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("alice.testnet", T0);
    c.set_payout(Some(acct("alice-wallet.testnet")));
    assert_eq!(c.colony_of(acct("alice.testnet")).unwrap().payout, Some(acct("alice-wallet.testnet")));
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    at("alice.testnet", T0 + 8 * GEN_MS);
    assert!(c.claim().near.0 > 0);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn a_sponsor_takes_back_credit_left_unused() {
    let mut c = new_dish();
    ctx("relayer.testnet", T0, NEAR / 20);
    let credit = c.sponsor(acct("g-1.relayer.testnet")).0;
    ctx("mallory.testnet", T0 + 6_000 * GEN_MS, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.unsponsor(acct("g-1.relayer.testnet"));
    }));
    assert!(r.is_err(), "only the sponsor");
    ctx("relayer.testnet", T0 + 6_000 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct("g-1.relayer.testnet")).0, credit);
    assert_eq!(c.credit_of(acct("g-1.relayer.testnet")).0, 0);
    assert_eq!(c.state().credit_reclaimed.0, credit);
}

#[test]
fn house_cells_never_make_a_siege_for_newcomers() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 50);
    plant(&mut c, "house.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 50);
    let price = c.quote(4, None).0;
    let held = bal(&c, "bob.testnet");
    plant(&mut c, "bob.testnet", T0, cells(6, 2, patterns::BLOCK), None);
    assert_eq!(held - bal(&c, "bob.testnet"), price, "next to the house is ordinary ground");
    assert!(!c.plants(None, None)[1].siege);
}
