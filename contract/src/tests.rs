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

/// A call with `tgas` of gas, as a real transaction has (the unit-test default is far more than a transaction can buy).
fn ctx_gas(who: &str, ms: u64, deposit: u128, tgas: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who.parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .account_balance(NearToken::from_near(1_000))
        .block_timestamp(ms * MS)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(tgas));
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
    let mut as_credit_out = 0u128;
    let mut bounties = 0u128;
    let mut bounty_refunds = 0u128;
    let mut slide_burns = 0u128;
    let mut slides = 0u64;
    for e in (0..s.ledger.0).step_by(1_000).flat_map(|from| c.ledger(Some(from), Some(1_000))) {
        match e {
            Entry::Tide { bounty, storage, paid, as_credit, credit_paid, .. } => {
                out += bounty.0 + storage.0 + paid.0 + as_credit.0;
                credit_out += credit_paid.0;
                as_credit_out += as_credit.0;
                bounties += bounty.0;
            }
            Entry::Sell { near, .. } => out += near.0,
            Entry::Refund { near, colony, .. } => {
                back += near.0;
                if colony == 0 {
                    bounty_refunds += near.0;
                }
            }
            Entry::Slide { token, cost, .. } => {
                slides += 1;
                assert_eq!(token.0, slides, "slides are numbered in order");
                slide_burns += cost.0;
            }
            _ => {}
        }
    }
    assert_eq!(s.vault.0 + out, s.near_in.0 + back, "vault = NEAR in - everything paid out + refunds");
    assert_eq!(s.credit_pool.0 + credit_out, s.credit_in.0, "credit pool = credit in - credit paid out");
    // Vault shares and guests' bounties paid as credit.
    let bounty_credit = s.near_as_credit.0 - as_credit_out;
    assert_eq!(s.near_bounties.0 + bounty_credit + bounty_refunds, bounties, "every bounty was paid in NEAR, as a guest's credit, or refunded");
    assert_eq!(s.credit_won.0, credit_out + s.near_as_credit.0, "credit won = the credit pool's shares + the vault's shares and bounties paid as credit");
    assert_eq!((s.slides.0, s.slides_burned.0), (slides, slide_burns), "every slide is in the ledger with what it burned");
    assert_eq!(c.nft_total_supply().0, slides as u128);
    let won: u128 = c.load_u128s(CREDIT_WON_KEY).iter().sum();
    assert_eq!(won, s.credit_won.0, "the colonies' credit won adds up to the counter");
    let owed: u128 = c.load_u128s(TIDES_KEY).iter().sum();
    assert_eq!(owed, s.tides_owed.0, "unclaimed NEAR winnings add up to the counter");
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

/// A guest: the relayer sponsors it 0.1 NEAR of credit and it joins on 0.02 of it, attaching nothing.
fn guest(c: &mut Petri, who: &str, ms: u64, name: &str, color: u32) {
    ctx("relayer.testnet", ms, NEAR / 10);
    c.sponsor(acct(who));
    ctx(who, ms, 0);
    c.join(name.into(), color, Some(U128(NEAR / 50)));
}

fn plant_on_credit(c: &mut Petri, who: &str, ms: u64, cs: Vec<u32>) {
    let d = c.plant_deposit(cs.len() as u32, None).0;
    ctx(who, ms, 0);
    c.plant(cs, None, Some(U128(d)));
}

/// The last tide's entry.
fn last_tide(c: &Petri) -> Entry {
    let n = c.state().ledger.0;
    (0..n).step_by(1_000).flat_map(|from| c.ledger(Some(from), Some(1_000))).filter(|e| matches!(e, Entry::Tide { .. })).last().expect("a tide ran")
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
    // Enough in the vault that a tide's share covers its own record.
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 2);
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
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR / 2);
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
/// chain, the agar, every colony's earnings, the vault, every tide (and that one ran exactly when someone outside the
/// house had earned), every colony's tide winnings and credit won, and which sales and shares were paid as credit.
#[test]
fn replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault() {
    let mut c = new_dish();
    let mut t = T0;
    join(&mut c, "alice.testnet", t, "Alice", 1, NEAR / 5);
    plant(&mut c, "alice.testnet", t, cells(2, 2, patterns::GLIDER), Some("off we go"));
    join(&mut c, "bob.testnet", t, "Bob", 2, NEAR / 5);
    plant(&mut c, "bob.testnet", t, cells(18, 18, patterns::BEEHIVE), None);
    join(&mut c, "house.testnet", t, "House", 3, NEAR / 20);
    // A guest on sponsored credit alone: its vault shares and its sale are paid as credit.
    let g4 = "g-4.relayer.testnet";
    guest(&mut c, g4, t, "Guest", 4);
    plant_on_credit(&mut c, g4, t, cells(26, 4, patterns::BLOCK));
    for g in 0..37u64 {
        t += GEN_MS;
        if g == 15 {
            // The guest tends the dish at the second tide, so it runs it and is paid the bounty as credit.
            at(g4, t);
            c.advance(None);
        }
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
        if g == 12 {
            ctx(g4, t, 0);
            c.buy(Some(U128(NEAR / 100)));
        }
        if g == 20 {
            at("alice.testnet", t);
            c.sell(U128(30 * P));
        }
        if g == 30 {
            at(g4, t);
            c.sell(U128(30 * P));
        }
        if g == 25 {
            let d = c.slide_deposit(32, 6, Some(5)).0;
            ctx("alice.testnet", t, d);
            c.mint_slide(0, 26, 32, 6, Some("Row 28".into()), None);
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
    let mut earned = vec![0u128; 5];
    let mut window = vec![0u64; 5];
    let mut won = vec![0u128; 5];
    let mut credit_won = vec![0u128; 5];
    let mut planted = vec![0u64; 5];
    let mut attached = vec![false; 5];
    let mut house: Vec<u16> = vec![];
    let colonies_view = c.colonies(None, None);
    assert_eq!(s.burned.0, c.ledger(None, Some(1000)).iter().map(|e| match e { Entry::Plant { cost, .. } => cost.0 * r.burn_bps as u128 / 10_000, Entry::Slide { cost, .. } => cost.0, _ => 0 }).sum::<u128>(), "burned = half of every planting + every slide");
    let mut colonies = 0u16;
    let log = c.ledger(None, Some(1000));
    let mut tides_seen = 0;
    let mut credit_sales = 0;
    let mut slides_seen = 0;
    let mut guest_bounties = 0;
    let mut li = 0;
    let mut g = 0u64;
    loop {
        while li < log.len() {
            let gen = match &log[li] {
                Entry::Join { generation, .. } | Entry::Buy { generation, .. } | Entry::Plant { generation, .. } | Entry::Sell { generation, .. } | Entry::Tide { generation, .. } | Entry::Skip { generation, .. } | Entry::Refund { generation, .. } | Entry::Slide { generation, .. } => generation.0,
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
                Entry::Buy { colony, petri, near, credit, .. } => {
                    assert_eq!(petri_for_near(near.0 + credit.0, agar, r.petri_price.0 / 1_000_000 * MAX), petri.0, "purchase on the curve");
                    agar -= petri.0;
                    vault += near.0;
                    pool += credit.0;
                    attached[*colony as usize] |= near.0 > 0;
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
                    attached[*colony as usize] |= near.0 > 0;
                    dish.plant_unchecked(*colony, cells);
                }
                Entry::Sell { colony, petri, near, as_credit, .. } => {
                    let outstanding = MAX - burned - agar;
                    assert_eq!(petri_core::sell_back(petri.0, agar, r.petri_price.0 / 1_000_000 * MAX, r.sell_bps, vault, outstanding), near.0, "sale on the curve");
                    assert_eq!(*as_credit, !attached[*colony as usize], "a colony that never attached NEAR is paid in credit");
                    credit_sales += *as_credit as u32;
                    agar += petri.0;
                    vault -= near.0;
                }
                Entry::Tide { .. } => panic!("a tide is recorded while stepping"),
                Entry::Slide { colony, x, y, w, h, cells, bitmap, cost, .. } => {
                    let (bits, n) = dish.region_bitmap(*colony, *x, *y, *w, *h);
                    assert_eq!((&bits, n), (&bitmap.0, *cells), "the slide is the colony's own cells, as the dish stood");
                    assert!(n >= r.slide_min_cells);
                    assert_eq!(cost.0, r.slide_cells_price.0 * n as u128);
                    burned += cost.0;
                    slides_seen += 1;
                }
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
        if g % r.tide_every as u64 == 0 && tide_due(&window, &house) {
            let Entry::Tide { generation, chain: ch, pay, bounty, storage, paid, as_credit, credit_pay, credit_paid, by } = &log[li] else { panic!("tide entry at {}", g) };
            assert_eq!(generation.0, g);
            assert_eq!(*ch, hex::encode(chain));
            assert_eq!(pay.0, vault * r.tide_bps as u128 / 10_000);
            let (split, total) = tide_split((pay.0 - (pay.0 * r.tide_bounty_bps as u128 / 10_000).min(r.max_bounty.0)).saturating_sub(storage.0), &window, &house);
            assert_eq!(total, paid.0 + as_credit.0);
            let mut credited = 0u128;
            for (i, v) in split {
                if attached[i as usize] {
                    won[i as usize] += v;
                } else {
                    credit_won[i as usize] += v;
                    credited += v;
                }
            }
            assert_eq!(credited, as_credit.0, "the shares of colonies that never attached NEAR");
            vault -= paid.0 + as_credit.0 + bounty.0 + storage.0;
            assert_eq!(credit_pay.0, pool * r.tide_bps as u128 / 10_000);
            let (csplit, ctotal) = tide_split(credit_pay.0, &window, &house);
            assert_eq!(ctotal, credit_paid.0);
            for (i, v) in csplit {
                credit_won[i as usize] += v;
            }
            pool -= credit_paid.0;
            // A guest that ran the tide was paid its bounty as credit.
            if *by > 0 && !attached[*by as usize] && bounty.0 > 0 {
                credit_won[*by as usize] += bounty.0;
                guest_bounties += 1;
            }
            window.iter_mut().for_each(|w| *w = 0);
            for st in planted.iter_mut() {
                *st = petri_core::decay_stake(*st, r.stake_keep_bps);
            }
            tides_seen += 1;
            li += 1;
        }
    }
    assert!(tides_seen >= 4);
    assert_eq!(credit_sales, 1, "the guest's sale");
    assert_eq!(slides_seen, 1, "alice's slide");
    assert_eq!(guest_bounties, 1, "the tide the guest ran");
    assert_eq!(li, log.len(), "every entry replayed");
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    assert_eq!(agar, s.agar.0);
    assert_eq!(burned, s.burned.0);
    assert_eq!(vault, s.vault.0);
    assert_eq!(pool, s.credit_pool.0);
    let e = c.earnings(None, None);
    let w = c.tide_winnings(None, None);
    for i in 0..4 {
        assert_eq!(e[i].0, earned[i + 1]);
        assert_eq!(w[i].0, won[i + 1]);
        assert_eq!(colonies_view[i].credit_won.0, credit_won[i + 1]);
    }
    assert_eq!(won[3], 0, "the house won nothing");
    assert_eq!(won[4], 0, "the guest won no NEAR");
    assert!(credit_won[4] > colonies_view[0].credit_won.0, "but credit in its place");
    conserved(&c, &["alice.testnet", "bob.testnet", "house.testnet", g4, "keeper.testnet"]);
    // PETRI_DUMP=<file> writes what the views return, so the browser's and the script's replays can be run on it too.
    if let Ok(path) = std::env::var("PETRI_DUMP") {
        let dump = json!({
            "rules": c.rules(),
            "state": c.state(),
            "colonies": c.colonies(None, None),
            "ledger": c.ledger(None, Some(1000)),
            "earnings": c.earnings(None, None),
            "tide_winnings": c.tide_winnings(None, None),
            "account": { "amount": U128(env::account_balance().as_yoctonear()), "storage_usage": env::storage_usage() },
        });
        std::fs::write(path, dump.to_string()).unwrap();
    }
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
fn a_colony_sends_its_winnings_to_a_wallet() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
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

#[test]
fn a_guest_wins_credit_where_a_wallet_wins_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 2);
    plant_on_credit(&mut c, g, T0, cells(20, 20, patterns::BLOCK));
    let credit = c.credit_of(acct(g)).0;
    let vault = c.state().vault.0;
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let Entry::Tide { paid, as_credit, credit_paid, .. } = last_tide(&c) else { unreachable!() };
    assert_eq!(c.claimable(acct(g)).near.0, 0, "no NEAR for a colony that never attached any");
    let alice = c.claimable(acct("alice.testnet")).near.0;
    assert!(alice > 0 && alice == paid.0, "the NEAR went to the wallet colony");
    assert!(as_credit.0.abs_diff(alice) <= 1, "two equal blocks, equal shares: {} as credit, {} in NEAR", as_credit.0, alice);
    let won = c.colony_of(acct(g)).unwrap().credit_won.0;
    assert!(won > as_credit.0, "the guest's vault share and its credit pool share");
    assert_eq!(won + c.colony_of(acct("alice.testnet")).unwrap().credit_won.0, as_credit.0 + credit_paid.0);
    assert_eq!(c.credit_of(acct(g)).0, credit + won, "spendable at once, with no claim");
    assert_eq!(c.credit_record(acct(g)).unwrap().amount.0, credit, "the sponsored part is untouched");
    let s = c.state();
    assert_eq!(s.near_tides.0, paid.0, "near_tides counts only NEAR that can be claimed");
    assert_eq!(s.near_as_credit.0, as_credit.0);
    assert!(s.vault.0 < vault - as_credit.0, "the guest's share left the vault");
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "free play earns credit")]
fn a_guest_cannot_send_winnings_to_a_wallet() {
    let mut c = new_dish();
    guest(&mut c, "g-1.relayer.testnet", T0, "Guest", 2);
    at("g-1.relayer.testnet", T0);
    c.set_payout(Some(acct("mallory.testnet")));
}

#[test]
fn a_guest_sale_pays_credit() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 2);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let before = c.credit_of(acct(g)).0;
    let vault = c.state().vault.0;
    at(g, T0 + 8 * GEN_MS);
    let paid = c.sell(U128(30 * P)).0;
    assert!(paid > 0);
    assert_eq!(c.credit_of(acct(g)).0, before + paid, "paid in credit");
    let s = c.state();
    assert_eq!(s.credit_sold.0, paid);
    assert_eq!(s.near_sold.0, 0, "no NEAR left the dish");
    assert!(s.vault.0 < vault - paid);
    assert_eq!(c.colony_of(acct(g)).unwrap().near_sold.0, 0);
    let n = s.ledger.0;
    assert!(matches!(c.ledger(Some(n - 1), None)[0], Entry::Sell { as_credit: true, .. }));
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
fn won_credit_is_spent_first_and_no_sponsor_can_take_it_back() {
    // A self-sponsor plays on its own credit alone. Its winnings stay credit, and taking its credit back returns only
    // what is left of the sponsorship, never what it won.
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let m = "mallory.testnet";
    ctx(m, T0, NEAR / 10);
    c.sponsor(acct(m));
    ctx(m, T0, 0);
    c.join("Mallory".into(), 2, Some(U128(NEAR / 50)));
    plant_on_credit(&mut c, m, T0, cells(20, 20, patterns::BLOCK));
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let won = c.colony_of(acct(m)).unwrap().credit_won.0;
    let sponsored = c.credit_record(acct(m)).unwrap().amount.0;
    assert!(won / 2 > 140 * env::storage_byte_cost().as_yoctonear(), "enough won to buy with: {}", won);
    assert_eq!(c.credit_of(acct(m)).0, won + sponsored);
    // Half the winnings buy PETRI; the sponsored credit is not touched.
    ctx(m, T0 + 8 * GEN_MS, 0);
    c.buy(Some(U128(won / 2)));
    assert_eq!(c.credit_record(acct(m)).unwrap().amount.0, sponsored);
    assert_eq!(c.credit_of(acct(m)).0, sponsored + won - won / 2);
    // A day later the sponsor (itself) takes back the sponsored credit, and only that. (Its catch-up runs more tides,
    // so the colony has won more by then.)
    ctx(m, T0 + 6_000 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct(m)).0, sponsored);
    let left = c.colony_of(acct(m)).unwrap().credit_won.0 - won / 2;
    assert!(left > won - won / 2);
    assert_eq!(c.credit_of(acct(m)).0, left, "the winnings stay, spendable only in the dish");
    assert_eq!(c.state().credit_reclaimed.0, sponsored);
    assert_eq!(c.claimable(acct(m)).near.0, 0);
    ctx(m, T0 + 6_000 * GEN_MS, 0);
    c.buy(Some(U128(left)));
    assert_eq!(c.credit_of(acct(m)).0, 0);
    conserved(&c, &["alice.testnet", m, "keeper.testnet"]);
}

#[test]
fn an_idle_dish_runs_no_tides_and_keeps_its_vault() {
    // An empty dish writes nothing at all.
    let mut c = new_dish();
    at("keeper.testnet", T0 + 40 * GEN_MS);
    c.advance(None);
    assert_eq!((c.state().generation.0, c.state().tides.0, c.state().ledger.0), (40, 0, 0));
    // The house is never fed and Alice has joined but not planted: five tide periods with nobody to pay.
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 2);
    plant(&mut c, "house.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR / 2);
    let before = c.state();
    let stakes: Vec<u64> = c.stakes(None, None).iter().map(|s| s.0).collect();
    at("keeper.testnet", T0 + 40 * GEN_MS);
    let storage = env::storage_usage();
    c.advance(None);
    assert_eq!(env::storage_usage(), storage, "no storage used");
    let s = c.state();
    assert_eq!(s.generation.0, 40);
    assert_eq!(s.tides.0, 0, "no tide ran");
    assert_eq!(s.ledger.0, before.ledger.0, "and none was recorded");
    assert_eq!((s.vault.0, s.credit_pool.0, s.near_bounties.0), (before.vault.0, before.credit_pool.0, 0), "the vault keeps everything");
    assert_eq!(c.stakes(None, None).iter().map(|s| s.0).collect::<Vec<_>>(), stakes, "no stake decayed");
    assert_eq!(s.sell_left.0, 0, "no tide opened the buy-back allowance");
    assert_eq!(c.checkpoints(None, None).len(), 1);
    // Once Alice earns, the next tide runs as usual.
    plant(&mut c, "alice.testnet", T0 + 40 * GEN_MS, cells(20, 20, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 48 * GEN_MS);
    c.advance(None);
    assert_eq!(c.state().tides.0, 1);
    assert!(c.claimable(acct("alice.testnet")).near.0 > 0);
    assert_eq!(c.stakes(None, None)[0].0, stakes[0] * 8_750 / 10_000, "and decays stakes, the house's too");
    conserved(&c, &["house.testnet", "alice.testnet", "keeper.testnet"]);
}

/// The simulator found that a tide writing every winner's colony and credit records needed about 0.26 TGas per
/// winner and ran out of gas at about 1,100 winners. Winnings now go into packed per-colony arrays, read and written
/// once per tide. The unit-test runtime charges host calls (storage reads and writes, logs, promises) but not wasm
/// execution, so this measures the part that used to grow with every winner. The tide bounty's transfer and its
/// callback (with the gas reserved for it) cost the same however many colonies win, and are measured apart.
#[test]
fn a_tide_with_fifteen_hundred_winners_stays_well_under_the_gas_limit() {
    let mut c = new_dish();
    let n = 1_500u32;
    let mut holders = vec![];
    for i in 0..n {
        let who = if i % 2 == 0 { format!("w{}.testnet", i) } else { format!("g{}.relayer.testnet", i) };
        if i % 2 == 0 {
            join(&mut c, &who, T0, &format!("W{}", i), i, NEAR / 50);
        } else {
            guest(&mut c, &who, T0, &format!("G{}", i), i);
        }
        holders.push(who);
    }
    at("keeper.testnet", T0 + 7 * GEN_MS);
    c.advance(None);
    // Every colony earned the same since the last tide. Set directly: 1,500 colonies do not fit on a 32 x 32 dish.
    let mut window = c.load_u64s(WINDOW_KEY);
    window.iter_mut().skip(1).for_each(|w| *w = 1_000);
    c.store_u64s(WINDOW_KEY, &window);
    at("keeper.testnet", T0);
    c.pay_out(&acct("keeper.testnet"), 0, 1, PAYOUT_BOUNTY);
    let bounty = env::used_gas().as_gas();
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let used = env::used_gas().as_gas();
    let tide = used - bounty;
    eprintln!("a generation and a tide with {} winners: {:.2} TGas of host calls, plus {:.2} TGas for the bounty payout", n, tide as f64 / 1e12, bounty as f64 / 1e12);
    assert!(tide < Gas::from_tgas(10).as_gas(), "{} gas", tide);
    assert!(used < Gas::from_tgas(60).as_gas(), "{} gas", used);
    let Entry::Tide { paid, as_credit, credit_paid, .. } = last_tide(&c) else { unreachable!() };
    assert!(paid.0 > 0 && as_credit.0 > 0 && credit_paid.0 > 0);
    let winnings = c.tide_winnings(Some(0), Some(2_000));
    let views: Vec<Colony> = (0..n).step_by(500).flat_map(|from| c.colonies(Some(from), Some(500))).collect();
    assert_eq!(views.len(), n as usize);
    for (i, col) in views.iter().enumerate() {
        assert!(col.credit_won.0 > 0, "colony {} won credit", col.id);
        assert_eq!(winnings[i].0 > 0, i % 2 == 0, "only wallet colonies win NEAR (colony {})", col.id);
    }
    let refs: Vec<&str> = holders.iter().map(|s| s.as_str()).chain(["keeper.testnet"]).collect();
    conserved(&c, &refs);
}

// ---------- specimen slides ----------

/// Function calls and transfers the last call scheduled: (receiver, method or "transfer", args, deposit).
fn scheduled() -> Vec<(String, String, Vec<u8>, u128)> {
    use near_sdk::mock::MockAction;
    near_sdk::test_utils::get_created_receipts()
        .into_iter()
        .flat_map(|r| {
            let to = r.receiver_id.to_string();
            r.actions.into_iter().filter_map(move |a| match a {
                MockAction::FunctionCallWeight { method_name, args, attached_deposit, .. } => Some((to.clone(), String::from_utf8(method_name).unwrap(), args, attached_deposit.as_yoctonear())),
                MockAction::Transfer { deposit, .. } => Some((to.clone(), "transfer".into(), vec![], deposit.as_yoctonear())),
                _ => None,
            })
        })
        .collect()
}

/// Run a callback as the contract itself, with one mocked promise result.
fn callback(ms: u64, result: Option<Vec<u8>>) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct("petri.testnet")).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(ms * MS);
    let r = match result {
        Some(v) => near_sdk::PromiseResult::Successful(v),
        None => near_sdk::PromiseResult::Failed,
    };
    testing_env!(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), Default::default(), vec![r]);
}

/// Alice's beehive at (2, 2) and Bob's block at (7, 2), in her buffer and so a siege.
fn two_colonies() -> Petri {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 0xc8431f, NEAR / 10);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BEEHIVE), None);
    join(&mut c, "bob.testnet", T0, "Bob", 0x1e8c6e, NEAR / 10);
    plant(&mut c, "bob.testnet", T0, cells(7, 2, patterns::BLOCK), None);
    c
}

fn mint(c: &mut Petri, who: &str, ms: u64, rect: (u16, u16, u16, u16), title: Option<&str>) -> String {
    let d = c.slide_deposit(rect.2, rect.3, title.map(|t| t.len() as u32)).0;
    ctx(who, ms, d);
    c.mint_slide(rect.0, rect.1, rect.2, rect.3, title.map(String::from), None)
}

fn transfer(to: &str, amount: u128) -> (String, String, Vec<u8>, u128) {
    (to.to_string(), "transfer".to_string(), vec![], amount)
}

#[test]
fn a_slide_captures_only_the_colonys_own_cells_and_burns_its_price() {
    let mut c = two_colonies();
    let before = c.state();
    let held = bal(&c, "alice.testnet");
    let d = c.slide_deposit(12, 6, Some(9)).0;
    ctx("alice.testnet", T0, d);
    let storage = env::storage_usage();
    let id = c.mint_slide(0, 0, 12, 6, Some("First one".into()), None);
    let used = (env::storage_usage() - storage) as u128 * env::storage_byte_cost().as_yoctonear();
    let refund: u128 = scheduled().iter().filter(|r| r.1 == "transfer").map(|r| r.3).sum();
    let logs = get_logs();
    assert_eq!(id, "1");
    // Six beehive cells are Alice's; Bob's block in the same rectangle is not.
    let v = c.slide(id.clone()).unwrap();
    assert_eq!((v.cells, v.colony, v.owner_id.as_str(), v.title.as_deref()), (6, 1, "alice.testnet", Some("First one")));
    let (bits, n) = c.load_dish().region_bitmap(1, 0, 0, 12, 6);
    assert_eq!((v.bitmap.0, v.cells), (bits, n));
    assert_eq!(c.load_dish().region_bitmap(2, 0, 0, 12, 6).1, 4, "Bob's block was in the rectangle");
    let price = rules().slide_cells_price.0 * 6;
    assert_eq!(held - bal(&c, "alice.testnet"), price, "the price, burned");
    let s = c.state();
    assert_eq!(s.burned.0 - before.burned.0, price);
    assert_eq!((s.slides.0, s.slides_burned.0), (1, price));
    assert_eq!(s.total_supply.0, before.total_supply.0 - price);
    assert_eq!((s.vault.0, s.credit_pool.0), (before.vault.0, before.credit_pool.0), "a slide moves no NEAR into the pools");
    // The storage and its reserve were paid; the rest of the deposit went back.
    let reserve = 184 * env::storage_byte_cost().as_yoctonear();
    assert_eq!(d - refund, used + reserve, "storage {} + reserve, of {}", used, d);
    assert!(refund < d / 4, "the deposit asks little more than it needs: {} back of {}", refund, d);
    assert!(logs.iter().any(|l| l.contains("\"standard\":\"nep171\"") && l.contains("\"nft_mint\"") && l.contains("\"token_ids\":[\"1\"]")));
    assert!(logs.iter().any(|l| l.contains("\"ft_burn\"") && l.contains("specimen slide")));
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
fn a_slide_token_carries_an_svg_drawn_on_chain() {
    use base64::Engine;
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    let t = c.nft_token("1".into()).unwrap();
    let m = t.metadata.unwrap();
    assert_eq!(m.title.as_deref(), Some("Specimen #1 \u{b7} Alice"));
    assert!(m.description.unwrap().contains("6 living cells of Alice, fixed at generation 0"));
    let media = m.media.unwrap();
    let svg = base64::engine::general_purpose::STANDARD.decode(media.strip_prefix("data:image/svg+xml;base64,").expect("an inline SVG")).unwrap();
    let text = String::from_utf8(svg.clone()).unwrap();
    assert!(text.starts_with("<svg") && text.contains("#c8431f") && text.matches("h0").count() == 6, "{}", text);
    // NEP-177: media_hash is the base64 sha256 of what media holds, 32 bytes.
    assert_eq!(m.media_hash.unwrap().0, env::sha256(&svg));
    assert_eq!((m.copies, m.issued_at.is_some()), (Some(1), true));
    let json = near_sdk::serde_json::to_value(c.nft_token("1".into()).unwrap()).unwrap();
    assert!(json["metadata"]["media_hash"].is_string() && json["approved_account_ids"].is_object());
    let meta = c.nft_metadata();
    assert_eq!((meta.spec.as_str(), meta.symbol.as_str(), meta.name.as_str()), ("nft-2.1.0", "SLIDE", "Petri specimens"));
    assert!(c.nft_token("2".into()).is_none() && c.nft_token("01".into()).is_none() && c.nft_token("0".into()).is_none());
    assert_eq!(c.nft_tokens(None, None).len(), 1);
}

#[test]
#[should_panic(expected = "at least 5 of your living cells")]
fn a_slide_needs_enough_of_your_own_cells() {
    let mut c = two_colonies();
    // Bob's block is four cells.
    mint(&mut c, "bob.testnet", T0, (6, 1, 4, 4), None);
}

#[test]
#[should_panic(expected = "that rectangle holds 0")]
fn nobody_can_mint_a_rivals_cells() {
    let mut c = two_colonies();
    // Alice's beehive alone, framed by Bob.
    mint(&mut c, "bob.testnet", T0, (1, 1, 5, 4), None);
}

#[test]
#[should_panic(expected = "you hold")]
fn a_slide_costs_petri_you_have() {
    let mut c = two_colonies();
    ctx("carol.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    let all = bal(&c, "alice.testnet");
    ctx("alice.testnet", T0, 1);
    c.ft_transfer(acct("carol.testnet"), U128(all - 5 * P), None);
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
}

#[test]
#[should_panic(expected = "for its storage")]
fn a_slide_pays_for_its_storage() {
    let mut c = two_colonies();
    ctx("alice.testnet", T0, 0);
    c.mint_slide(0, 0, 12, 6, None, None);
}

#[test]
#[should_panic(expected = "4 to 32 cells")]
fn a_slide_is_at_most_32_cells_a_side() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 33, 6), None);
}

#[test]
fn a_guest_pays_for_a_slide_from_credit() {
    let mut c = new_dish();
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    plant_on_credit(&mut c, g, T0, cells(2, 2, patterns::BEEHIVE));
    let credit = c.credit_of(acct(g)).0;
    let d = c.slide_deposit(8, 8, None).0;
    ctx(g, T0, 0);
    c.mint_slide(0, 0, 8, 8, None, Some(U128(d)));
    let spent = credit - c.credit_of(acct(g)).0;
    assert!(spent > 0 && spent < d, "only the storage is taken from credit: {} of {}", spent, d);
    assert!(scheduled().is_empty(), "nothing to send back");
    assert_eq!(c.nft_supply_for_owner(acct(g)).0, 1);
    conserved(&c, &[g]);
}

#[test]
fn slides_move_between_owners_and_enumerate() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    mint(&mut c, "alice.testnet", T0, (0, 0, 6, 6), Some("Close up"));
    assert_eq!(c.nft_supply_for_owner(acct("alice.testnet")).0, 2);
    let long = format!("{}.testnet", "c".repeat(56));
    ctx("alice.testnet", T0, 1);
    c.nft_transfer(acct(&long), "2".into(), None, Some("for you".into()));
    assert!(get_logs().iter().any(|l| l.contains("\"nft_transfer\"") && l.contains("\"memo\":\"for you\"") && !l.contains("authorized_id")));
    assert_eq!(c.nft_token("2".into()).unwrap().owner_id.as_str(), long);
    assert_eq!(c.nft_supply_for_owner(acct("alice.testnet")).0, 1);
    assert_eq!(c.nft_tokens_for_owner(acct(&long), None, None)[0].token_id, "2");
    assert_eq!(c.slides_for(acct("alice.testnet"), None, None)[0].token_id, "1");
    assert_eq!(c.slides(None, None).len(), 2);
    assert_eq!(c.nft_total_supply().0, 2);
    // Moving a slide changes nothing in the dish.
    assert_eq!(c.ledger(None, Some(100)).iter().filter(|e| matches!(e, Entry::Slide { .. })).count(), 2);
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "already belongs to the receiver")]
fn a_slide_cannot_be_sent_to_its_owner() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx("alice.testnet", T0, 1);
    c.nft_transfer(acct("alice.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "only the slide's owner or an approved account")]
fn a_stranger_cannot_move_a_slide() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx("bob.testnet", T0, 1);
    c.nft_transfer(acct("bob.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "does not hold slides")]
fn a_slide_cannot_be_stranded_in_the_dish() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx("alice.testnet", T0, 1);
    c.nft_transfer(acct("petri.testnet"), "1".into(), None, None);
}

#[test]
#[should_panic(expected = "exactly 1 yoctoNEAR")]
fn moving_a_slide_needs_one_yocto() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    at("alice.testnet", T0);
    c.nft_transfer(acct("carol.testnet"), "1".into(), None, None);
}

#[test]
fn an_approved_market_moves_a_slide_once_and_approvals_are_refunded() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    let byte = env::storage_byte_cost().as_yoctonear();
    let cost = (12 + "market.testnet".len() as u128) * byte;
    ctx("alice.testnet", T0, cost + 5);
    let storage = env::storage_usage();
    c.nft_approve("1".into(), acct("market.testnet"), None);
    assert_eq!((env::storage_usage() - storage) as u128 * byte, cost, "the approval pays exactly its storage");
    assert_eq!(scheduled(), vec![transfer("alice.testnet", 5)], "the rest goes back");
    let other = (12 + "other.testnet".len() as u128) * byte;
    ctx("alice.testnet", T0, other);
    c.nft_approve("1".into(), acct("other.testnet"), None);
    assert!(c.nft_is_approved("1".into(), acct("market.testnet"), Some(0)));
    assert!(!c.nft_is_approved("1".into(), acct("market.testnet"), Some(1)));
    assert!(c.nft_is_approved("1".into(), acct("other.testnet"), None));
    // A stale approval id is refused.
    ctx("market.testnet", T0, 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.nft_transfer(acct("dave.testnet"), "1".into(), Some(7), None)));
    assert!(r.is_err());
    ctx("market.testnet", T0, 1);
    c.nft_transfer(acct("dave.testnet"), "1".into(), Some(0), None);
    assert!(get_logs().iter().any(|l| l.contains("\"authorized_id\":\"market.testnet\"")));
    // Both approvals went with the sale, and their storage back to Alice.
    assert_eq!(scheduled(), vec![transfer("alice.testnet", cost + other)]);
    assert!(!c.nft_is_approved("1".into(), acct("market.testnet"), None));
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id.as_str(), "dave.testnet");
    ctx("market.testnet", T0, 1);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.nft_transfer(acct("market.testnet"), "1".into(), Some(0), None)));
    assert!(r.is_err(), "an approval does not survive a transfer");
    // Revoking refunds too.
    ctx("dave.testnet", T0, cost);
    c.nft_approve("1".into(), acct("market.testnet"), None);
    ctx("dave.testnet", T0, 1);
    c.nft_revoke_all("1".into());
    assert_eq!(scheduled(), vec![transfer("dave.testnet", cost)]);
}

#[test]
#[should_panic(expected = "for its storage")]
fn an_approval_pays_for_its_storage() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx("alice.testnet", T0, 1);
    c.nft_approve("1".into(), acct("market.testnet"), None);
}

#[test]
fn a_slide_sent_with_a_call_comes_back_if_the_receiver_returns_it() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    let cost = (12 + "market.testnet".len() as u128) * env::storage_byte_cost().as_yoctonear();
    ctx("alice.testnet", T0, cost);
    c.nft_approve("1".into(), acct("market.testnet"), None);
    ctx_gas("alice.testnet", T0, 1, 300);
    let _ = c.nft_transfer_call(acct("vault.testnet"), "1".into(), None, None, "keep?".into());
    let calls = scheduled();
    assert_eq!((calls[0].0.as_str(), calls[0].1.as_str()), ("vault.testnet", "nft_on_transfer"));
    assert_eq!(calls[1].1, "nft_resolve_transfer");
    let args: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&calls[1].2).unwrap();
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id.as_str(), "vault.testnet");
    // The receiver answers true: give it back. The slide returns to Alice with her approval.
    callback(T0, Some(b"true".to_vec()));
    let kept = c.nft_resolve_transfer(acct("alice.testnet"), acct("vault.testnet"), "1".into(), near_sdk::serde_json::from_value(args["approved_account_ids"].clone()).unwrap());
    assert!(!kept);
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id.as_str(), "alice.testnet");
    assert!(c.nft_is_approved("1".into(), acct("market.testnet"), Some(0)));
    assert_eq!(c.nft_supply_for_owner(acct("vault.testnet")).0, 0);
    // Sent again, and this time the receiver keeps it: the approvals it had are refunded.
    ctx_gas("alice.testnet", T0, 1, 300);
    let _ = c.nft_transfer_call(acct("vault.testnet"), "1".into(), None, None, "keep".into());
    callback(T0, Some(b"false".to_vec()));
    let approvals: std::collections::HashMap<AccountId, u64> = [(acct("market.testnet"), 0)].into_iter().collect();
    assert!(c.nft_resolve_transfer(acct("alice.testnet"), acct("vault.testnet"), "1".into(), Some(approvals)));
    assert_eq!(scheduled(), vec![transfer("alice.testnet", cost)]);
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id.as_str(), "vault.testnet");
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "only the dish itself")]
fn nobody_else_can_resolve_a_slide_transfer() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    at("mallory.testnet", T0);
    c.nft_resolve_transfer(acct("mallory.testnet"), acct("alice.testnet"), "1".into(), None);
}

/// A slide pays for any owner it can have: sent along a chain of the longest accounts, each a new owner, the
/// contract's storage never grows past what the minter paid.
#[test]
fn transfers_never_outgrow_the_storage_a_slide_paid_for() {
    let mut c = new_dish();
    join(&mut c, "al.testnet", T0, "Al", 1, NEAR / 10);
    plant(&mut c, "al.testnet", T0, cells(2, 2, patterns::BEEHIVE), None);
    let d = c.slide_deposit(8, 8, None).0;
    ctx("al.testnet", T0, d);
    let before = env::storage_usage();
    c.mint_slide(0, 0, 8, 8, None, None);
    let refund: u128 = scheduled().iter().map(|r| r.3).sum();
    let paid = (d - refund) / env::storage_byte_cost().as_yoctonear();
    let mut owner = "al.testnet".to_string();
    for i in 0..5 {
        let next = format!("{}{}.testnet", "x".repeat(55), i);
        assert_eq!(next.len(), 64);
        ctx(&owner, T0, 1);
        c.nft_transfer(acct(&next), "1".into(), None, None);
        let grown = env::storage_usage() - before;
        assert!(grown as u128 <= paid, "storage {} past the {} paid", grown, paid);
        owner = next;
    }
}

// ---------- paying with wNEAR ----------

const WNEAR: &str = "wrap.testnet";

/// wNEAR's `ft_transfer_call` landing in the dish, from the intents contract, with `gas` TGas left.
fn wnear_in(c: &mut Petri, ms: u64, amount: u128, msg: &str, gas: u64) -> U128 {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(ms * MS).prepaid_gas(Gas::from_tgas(gas));
    testing_env!(b.build());
    match c.ft_on_transfer(acct("intents.testnet"), U128(amount), msg.into()) {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("ft_on_transfer returns a value"),
    }
}

fn order_args(v: &near_sdk::serde_json::Value) -> (AccountId, String, Option<String>, Option<u32>) {
    (v["account"].as_str().unwrap().parse().unwrap(), v["what"].as_str().unwrap().into(), v["name"].as_str().map(String::from), v["color"].as_u64().map(|c| c as u32))
}

fn u128_arg(v: &near_sdk::serde_json::Value) -> U128 {
    U128(v.as_str().unwrap().parse().unwrap())
}

/// The whole path, as the chain runs it: wNEAR arrives, the unwrap succeeds (or not), then the join or purchase.
fn pay_wnear(c: &mut Petri, ms: u64, amount: u128, msg: &str, unwrap_ok: bool) -> String {
    assert_eq!(wnear_in(c, ms, amount, msg, 300).0, 0, "the whole amount is kept");
    let calls = scheduled();
    assert_eq!((calls[0].0.as_str(), calls[0].1.as_str(), calls[0].3), (WNEAR, "near_withdraw", 1));
    assert_eq!(calls[1].1, "on_unwrapped");
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&calls[1].2).unwrap();
    assert_eq!(u128_arg(&a["amount"]).0, amount);
    let (account, what, name, color) = order_args(&a);
    callback(ms, if unwrap_ok { Some(vec![]) } else { None });
    c.on_unwrapped(account, what, name, color, U128(amount));
    let calls = scheduled();
    let Some(settle) = calls.iter().find(|c| c.1 == "settle_intent") else { return "pending".into() };
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&settle.2).unwrap();
    let (account, what, name, color) = order_args(&a);
    callback(ms, None);
    c.settle_intent(account, what, name, color, u128_arg(&a["amount"]))
}

#[test]
fn wnear_joins_for_the_account_it_names_as_if_it_had_attached_near() {
    let mut c = new_dish();
    let did = pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"pat.testnet","do":"join","name":"Gram Stain","color":7012000}"#, true);
    assert_eq!(did, "join");
    let col = c.colony_of(acct("pat.testnet")).unwrap();
    assert_eq!((col.name.as_str(), col.color, col.proxy, col.near_paid.0), ("Gram Stain", 7012000, true, NEAR / 50));
    assert!(bal(&c, "pat.testnet") > 0, "it bought PETRI");
    let s = c.state();
    assert_eq!(s.vault.0, s.near_in.0);
    assert!(s.vault.0 > 0 && s.credit_pool.0 == 0, "the NEAR went to the vault as the player's own");
    assert!(c.attached_of(col.id) > 0, "a NEAR colony: paid its tides in NEAR");
    assert_eq!((s.pending.0, s.wrapped.0, c.pending_of(acct("pat.testnet")).0), (0, 0, 0));
    assert!(matches!(c.ledger(None, None)[1], Entry::Buy { near, credit, .. } if near.0 > 0 && credit.0 == 0));
    assert!(get_logs().iter().any(|l| l.contains("\"intents\"") && l.contains("\"did\":\"join\"")));
    // Anyone could have paid for pat, so pat may choose its own name and colour, once.
    at("pat.testnet", T0);
    c.rename("Pat".into(), 0x2364aa);
    let col = c.colony_of(acct("pat.testnet")).unwrap();
    assert_eq!((col.name.as_str(), col.proxy), ("Pat", false));
    // The old name is free again.
    join(&mut c, "gram.testnet", T0, "Gram Stain", 1, NEAR / 50);
    conserved(&c, &["pat.testnet", "gram.testnet"]);
}

#[test]
#[should_panic(expected = "only a colony someone else started")]
fn a_colony_renames_once_and_only_if_someone_else_started_it() {
    let mut c = new_dish();
    pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"pat.testnet","do":"join","name":"Gram Stain"}"#, true);
    at("pat.testnet", T0);
    c.rename("Pat".into(), 1);
    at("pat.testnet", T0);
    c.rename("Pat Again".into(), 1);
}

#[test]
#[should_panic(expected = "only a colony someone else started")]
fn a_colony_that_joined_itself_cannot_rename() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    at("alice.testnet", T0);
    c.rename("Not Alice".into(), 1);
}

#[test]
fn wnear_buys_for_a_colony_and_a_join_for_one_that_exists_buys() {
    let mut c = new_dish();
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    let held = bal(&c, g);
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 20, &format!(r#"{{"for":"{}","do":"buy"}}"#, g), true), "buy");
    let after = bal(&c, g);
    assert!(after > held);
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 20, &format!(r#"{{"for":"{}","do":"join","name":"Other"}}"#, g), true), "buy", "already joined: a purchase");
    assert!(bal(&c, g) > after);
    assert_eq!(c.colony_of(acct(g)).unwrap().name, "Guest", "and no second colony");
    assert!(c.attached_of(1) > 0, "the guest now has NEAR of its own in the vault");
    assert_eq!(c.state().pending.0, 0);
    conserved(&c, &[g]);
}

#[test]
fn an_unusable_order_waits_as_pending_near_and_is_claimed() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Taken", 1, NEAR / 50);
    let vault = c.state().vault.0;
    // Unreadable: pending for the sender.
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, "not json", true), "pending");
    // A name already taken, no name, no order, an account that is not valid, and the dish itself: pending for whoever
    // the order names, or else the sender.
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"bo.testnet","do":"join","name":"taken"}"#, true), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"bo.testnet","do":"join"}"#, true), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"bo.testnet"}"#, true), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"NOT VALID","do":"join","name":"X"}"#, true), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"petri.testnet","do":"buy"}"#, true), "pending");
    // A purchase for an account with no colony.
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"cy.testnet","do":"buy"}"#, true), "pending");
    let sender = c.pending_of(acct("intents.testnet")).0;
    let bo = c.pending_of(acct("bo.testnet")).0;
    let cy = c.pending_of(acct("cy.testnet")).0;
    let record = |a: &str| (61 + a.len() as u128) * env::storage_byte_cost().as_yoctonear();
    assert_eq!(sender, 3 * NEAR / 50 - record("intents.testnet"), "three payments, one record");
    assert_eq!(bo, 3 * NEAR / 50 - record("bo.testnet"));
    assert_eq!(cy, NEAR / 50 - record("cy.testnet"));
    let s = c.state();
    assert_eq!(s.pending.0, sender + bo + cy);
    assert_eq!((s.vault.0, s.wrapped.0), (vault, 0), "nothing reached the vault");
    assert_eq!(c.colonies(None, None).len(), 1, "nobody joined");
    // Claiming sends the NEAR and the record's storage, and only to the account itself.
    at("bo.testnet", T0);
    assert_eq!(c.claim_pending().0, 3 * NEAR / 50);
    assert_eq!(scheduled()[0], transfer("bo.testnet", 3 * NEAR / 50));
    assert_eq!(c.pending_of(acct("bo.testnet")).0, 0);
    assert_eq!(c.state().pending.0, sender + cy);
    at("bo.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim_pending())).is_err(), "nothing twice");
    // A claim that cannot be delivered is pending again.
    callback(T0, None);
    c.on_pending_paid(acct("bo.testnet"), U128(3 * NEAR / 50));
    assert_eq!(c.pending_of(acct("bo.testnet")).0, bo);
    conserved(&c, &["alice.testnet"]);
}

#[test]
fn other_tokens_and_dust_are_refunded_and_forged_calls_do_nothing() {
    let mut c = new_dish();
    // A different token, even with a perfect order.
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct("fake-wrap.testnet")).current_account_id(acct("petri.testnet"));
    testing_env!(b.build());
    let r = c.ft_on_transfer(acct("pat.testnet"), U128(NEAR), r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#.into());
    assert!(matches!(r, PromiseOrValue::Value(v) if v.0 == NEAR), "refunded in full");
    // A player calling ft_on_transfer itself claims wNEAR it never sent: refunded, nothing recorded.
    at("pat.testnet", T0);
    let r = c.ft_on_transfer(acct("pat.testnet"), U128(NEAR), r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#.into());
    assert!(matches!(r, PromiseOrValue::Value(v) if v.0 == NEAR));
    assert!(scheduled().is_empty());
    // wNEAR below the least a payment brings: refunded rather than kept in a record it cannot pay for.
    assert_eq!(wnear_in(&mut c, T0, NEAR / 1_000, r#"{"for":"pat.testnet","do":"buy"}"#, 300).0, NEAR / 1_000);
    let s = c.state();
    assert_eq!((s.wrapped.0, s.pending.0, s.colonies), (0, 0, 0));
    assert!(c.colony_of(acct("pat.testnet")).is_none());
}

#[test]
#[should_panic(expected = "only the dish itself")]
fn nobody_else_can_call_the_unwrap_callback() {
    let mut c = new_dish();
    ctx("mallory.testnet", T0, 0);
    c.on_unwrapped(acct("mallory.testnet"), "join".into(), Some("Free".into()), None, U128(NEAR));
}

#[test]
#[should_panic(expected = "only the dish itself")]
fn nobody_else_can_settle_an_order() {
    let mut c = new_dish();
    ctx("mallory.testnet", T0, 0);
    c.settle_intent(acct("mallory.testnet"), "join".into(), Some("Free".into()), None, U128(NEAR));
}

#[test]
fn a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped() {
    let mut c = new_dish();
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, false), "pending");
    let owed = c.pending_of(acct("pat.testnet")).0;
    assert!(owed > 0 && owed < NEAR / 10);
    let s = c.state();
    assert_eq!((s.wrapped.0, s.pending.0), (NEAR / 10, owed), "still wNEAR, and counted as held");
    assert!(c.colony_of(acct("pat.testnet")).is_none());
    // Anyone can unwrap it; then the NEAR is held as NEAR.
    at("keeper.testnet", T0);
    let _ = c.unwrap_wnear();
    let calls = scheduled();
    assert_eq!((calls[0].0.as_str(), calls[0].1.as_str()), (WNEAR, "near_withdraw"));
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&calls[0].2).unwrap();
    assert_eq!(u128_arg(&a["amount"]).0, NEAR / 10);
    // While it is under way nobody can unwrap it twice.
    at("keeper.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.unwrap_wnear())).is_err());
    callback(T0, Some(vec![]));
    c.on_wnear_unwrapped(U128(NEAR / 10));
    assert_eq!(c.state().wrapped.0, 0);
    assert_eq!(c.pending_of(acct("pat.testnet")).0, owed, "and pat can claim it");
    conserved(&c, &[]);
}

#[test]
fn wnear_with_too_little_gas_to_unwrap_is_kept_for_its_account() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, 20).0, 0, "kept");
    assert!(scheduled().is_empty(), "nothing scheduled that could run out of gas");
    let s = c.state();
    assert_eq!(s.wrapped.0, NEAR / 10);
    assert_eq!(s.pending.0, c.pending_of(acct("pat.testnet")).0);
    assert!(s.pending.0 > 0);
    conserved(&c, &[]);
}

#[test]
fn an_order_claimed_before_it_settles_is_not_spent_twice() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, 300).0, 0);
    callback(T0, Some(vec![]));
    c.on_unwrapped(acct("pat.testnet"), "join".into(), Some("Pat".into()), None, U128(NEAR / 10));
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&scheduled().iter().find(|c| c.1 == "settle_intent").unwrap().2).unwrap();
    // Pat claims the NEAR in the block between.
    at("pat.testnet", T0);
    assert_eq!(c.claim_pending().0, NEAR / 10);
    callback(T0, None);
    assert_eq!(c.settle_intent(acct("pat.testnet"), "join".into(), Some("Pat".into()), None, u128_arg(&a["amount"])), "claimed");
    assert!(c.colony_of(acct("pat.testnet")).is_none());
    // A settle that runs twice finds nothing the second time.
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, true), "join");
    callback(T0, None);
    assert_eq!(c.settle_intent(acct("pat.testnet"), "join".into(), Some("Pat".into()), None, U128(NEAR / 10)), "claimed");
    assert_eq!(c.colony_of(acct("pat.testnet")).unwrap().near_paid.0, NEAR / 10);
    conserved(&c, &["pat.testnet"]);
}

#[test]
fn registering_on_wnear_is_paid_by_the_caller_or_the_surplus() {
    let mut c = new_dish();
    ctx("anyone.testnet", T0, intents::WNEAR_STORAGE + 7);
    let _ = c.register_wnear();
    let calls = scheduled();
    assert!(calls.iter().any(|r| r.0 == WNEAR && r.1 == "storage_deposit" && r.3 == intents::WNEAR_STORAGE));
    assert!(calls.contains(&transfer("anyone.testnet", 7)));
    callback(T0, Some(br#"{"total":"1250000000000000000000","available":"0"}"#.to_vec()));
    c.on_wnear_registered();
    assert!(c.state().wnear_ready);
    at("anyone.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.register_wnear())).is_err(), "once");
}

// ---------- the bounty of a tide a guest runs ----------

#[test]
fn a_guest_that_runs_a_tide_is_paid_its_bounty_as_credit() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 2);
    let credit = c.credit_of(acct(g)).0;
    at(g, T0 + 8 * GEN_MS);
    c.advance(None);
    let Entry::Tide { bounty, by, .. } = last_tide(&c) else { unreachable!() };
    assert!(bounty.0 > 0);
    assert_eq!(by, 2, "the guest ran it");
    assert!(scheduled().iter().all(|r| r.1 != "transfer"), "no NEAR left the dish");
    let won = c.colony_of(acct(g)).unwrap().credit_won.0;
    assert_eq!(won, bounty.0, "the guest earned nothing, so its credit won is the bounty");
    assert_eq!(c.credit_of(acct(g)).0, credit + bounty.0, "spendable in the dish at once");
    let s = c.state();
    assert_eq!(s.near_bounties.0, 0, "no NEAR bounty");
    assert!(s.near_as_credit.0 >= bounty.0, "counted with the vault's shares paid as credit");
    // The keeper, with no colony, is paid in NEAR; so is a colony that has attached NEAR.
    for (who, gen) in [("keeper.testnet", 16), ("alice.testnet", 24)] {
        at(who, T0 + gen * GEN_MS);
        c.advance(None);
        let Entry::Tide { bounty, by, .. } = last_tide(&c) else { unreachable!() };
        assert_eq!(by, if who == "keeper.testnet" { 0 } else { 1 });
        assert!(scheduled().contains(&transfer(who, bounty.0)), "{} paid in NEAR", who);
    }
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
fn transfer_calls_fit_in_a_transaction() {
    let mut c = two_colonies();
    ctx("vault.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    ctx_gas("alice.testnet", T0, 1, 300);
    let _ = c.ft_transfer_call(acct("vault.testnet"), U128(P), None, "hi".into());
    let calls = scheduled();
    assert_eq!((calls[0].1.as_str(), calls[1].1.as_str()), ("ft_on_transfer", "ft_resolve_transfer"));
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx_gas("alice.testnet", T0, 1, 60);
    let _ = c.nft_transfer_call(acct("vault.testnet"), "1".into(), None, None, "hi".into());
    assert_eq!(scheduled()[0].1, "nft_on_transfer");
}
