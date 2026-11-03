use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use petri_core::{feed, fits_slide, patterns, tide_due, tide_split};
use std::collections::HashMap;

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
        keepers: vec!["dish-keeper.testnet".parse().unwrap()],
        ..launch()
    }
}

#[test]
fn the_tests_use_the_launched_economics() {
    let l = launch();
    let r = rules();
    assert_eq!((l.feed_ppm, l.reach, l.stake_keep_bps, l.siege_x, l.tide_bps, l.sell_bps, l.sell_cap_bps), (r.feed_ppm, r.reach, r.stake_keep_bps, r.siege_x, r.tide_bps, r.sell_bps, r.sell_cap_bps));
    assert_eq!((l.slide_discount_bps, l.slide_royalty_bps), (r.slide_discount_bps, r.slide_royalty_bps));
    assert_eq!(l.house.len(), 5);
    assert_eq!(l.keepers, vec![acct("petri-keeper.testnet")]);
    let m: Rules = near_sdk::serde_json::from_str(include_str!("../launch-rules-mainnet.json")).unwrap();
    assert_eq!(m.keepers, vec![acct("keeper.petri-dish.near")]);
    assert_eq!((m.slide_discount_bps, m.slide_royalty_bps, m.feed_ppm, m.tide_bps), (l.slide_discount_bps, l.slide_royalty_bps, l.feed_ppm, l.tide_bps));
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

fn byte() -> u128 {
    env::storage_byte_cost().as_yoctonear()
}

fn all_ledger(c: &Petri) -> Vec<Entry> {
    (0..c.state().ledger.0).step_by(1_000).flat_map(|from| c.ledger(Some(from), Some(1_000))).collect()
}

/// Nothing is created or lost: every PETRI is in an account or held by the dish (agar, unclaimed earnings, keeper
/// pot), or burned. The NEAR books close: what came in is in the vault or went out at tides, bounties and sales. And
/// every term of the solvency check (credit given, spent, reclaimed and outstanding, NEAR owed, pending NEAR) comes out
/// of the ledger alone exactly as the contract counts it. `holders` must name every account with PETRI or credit.
fn conserved(c: &Petri, holders: &[&str]) {
    let s = c.state();
    let r = c.rules();
    assert_eq!(s.total_supply.0, MAX - s.burned.0, "supply = launch supply - burned");
    let held: u128 = holders.iter().map(|h| bal(c, h)).sum();
    assert_eq!(held + bal(c, "petri.testnet"), s.total_supply.0, "balances + the dish's own = supply");
    assert_eq!(bal(c, "petri.testnet"), s.agar.0 + s.unclaimed.0 + s.keeper_pot.0);
    let ids: Vec<u16> = (1..=s.colonies).collect();
    let books: Vec<Books> = c.read_books(&ids).into_iter().map(|(b, _)| b).collect();
    assert_eq!(books.iter().map(|b| b.earned as u128).sum::<u128>(), s.unclaimed.0, "the unclaimed counter matches the books");
    assert_eq!(s.agar.0, MAX - s.sold.0 - s.fed.0 + s.returned.0 + s.bought_back.0, "agar = launch - sold - fed + returned + bought back");
    let (mut out, mut back, mut credit_out, mut as_credit_out, mut bounties, mut bounty_refunds) = (0u128, 0u128, 0u128, 0u128, 0u128, 0u128);
    let (mut slide_burns, mut slides, mut royalties) = (0u128, 0u64, 0u128);
    let (mut given, mut reclaimed, mut spent, mut tides_paid, mut claimed, mut pending_in, mut pending_out) = (0u128, 0u128, 0u128, 0u128, 0u128, 0u128, 0u128);
    let (mut plant_burns, mut other_burns) = (0u128, 0u128);
    for e in all_ledger(c) {
        match e {
            Entry::Tide { bounty, storage, paid, as_credit, credit_paid, .. } => {
                out += bounty.0 + storage.0 + paid.0 + as_credit.0;
                credit_out += credit_paid.0;
                as_credit_out += as_credit.0;
                bounties += bounty.0;
                tides_paid += paid.0;
            }
            Entry::Sell { near, .. } => out += near.0,
            Entry::Refund { kind, near, storage, .. } => {
                assert!(storage.0 <= near.0);
                if kind == PAYOUT_BOUNTY {
                    back += near.0 - storage.0;
                    bounty_refunds += near.0;
                } else {
                    pending_in += near.0 - storage.0;
                }
            }
            Entry::Slide { token, cost, spent: s, .. } => {
                slides += 1;
                assert_eq!(token.0, slides, "slides are numbered in order");
                slide_burns += cost.0;
                spent += s.map(|s| s.0).unwrap_or(0);
            }
            Entry::Buy { spent: s, .. } => spent += s.map(|s| s.0).unwrap_or(0),
            Entry::Plant { cost, spent: s, licence, .. } => {
                spent += s.map(|s| s.0).unwrap_or(0);
                plant_burns += cost.0 * r.burn_bps as u128 / 10_000;
                royalties += licence.map(|l| l.royalty.0).unwrap_or(0);
            }
            Entry::Sponsor { amount, .. } => given += amount.0,
            Entry::Unsponsor { amount, .. } => reclaimed += amount.0,
            Entry::Claim { near, paid, .. } => {
                assert!(paid.0 <= near.0);
                claimed += near.0;
            }
            Entry::Pending { near, .. } => pending_in += near.0,
            Entry::Unpend { near, .. } => pending_out += near.0,
            Entry::Burn { petri, .. } => other_burns += petri.0,
            Entry::Join { .. } | Entry::Skip { .. } | Entry::Dust { .. } => {}
        }
    }
    assert_eq!(s.vault.0 + out, s.near_in.0 + back, "vault = NEAR in - everything paid out + bounty refunds");
    assert_eq!(s.credit_pool.0 + credit_out, s.credit_in.0, "credit pool = credit in - credit paid out");
    // Vault shares and guests' bounties paid as credit.
    let bounty_credit = s.near_as_credit.0 - as_credit_out;
    assert_eq!(s.near_bounties.0 + bounty_credit + bounty_refunds, bounties, "every bounty was paid in NEAR, as a guest's credit, or refunded");
    assert_eq!(s.credit_won.0, credit_out + s.near_as_credit.0, "credit won = the credit pool's shares + the vault's shares and bounties paid as credit");
    assert_eq!((s.slides.0, s.slides_burned.0, s.royalties.0), (slides, slide_burns, royalties), "every slide and royalty is in the ledger");
    assert_eq!(s.burned.0, plant_burns + slide_burns + other_burns, "every burn is in the ledger");
    assert_eq!(c.nft_total_supply().0, slides as u128);
    assert_eq!(books.iter().map(|b| b.credit_won).sum::<u128>(), s.credit_won.0, "the colonies' credit won adds up to the counter");
    assert_eq!(books.iter().map(|b| b.owed).sum::<u128>(), s.tides_owed.0, "unclaimed NEAR winnings add up to the counter");
    // The solvency terms, from the ledger alone.
    assert_eq!((given, reclaimed, spent), (s.credit_given.0, s.credit_reclaimed.0, s.credit_spent.0), "credit given, reclaimed and spent, from the ledger");
    assert_eq!(tides_paid - claimed, s.tides_owed.0, "NEAR owed = tides paid - claims, from the ledger");
    assert_eq!(pending_in - pending_out, s.pending.0, "pending NEAR, from the ledger");
    let grants: u128 = holders.iter().map(|h| c.credit_grants(acct(h)).iter().map(|g| g.amount.0).sum::<u128>()).sum();
    let won: u128 = books.iter().map(|b| b.won).sum();
    assert_eq!(won + grants, s.credit_given.0 + s.credit_won.0 + s.credit_sold.0 - s.credit_spent.0 - s.credit_reclaimed.0, "credit held = given + won + sold - spent - reclaimed");
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
    let d = c.plant_deposit(cs.len() as u32, note.map(|n| n.len() as u32), None).0;
    ctx(who, ms, d);
    c.plant(cs, note.map(|n| n.into()), None, None);
}

/// A planting under slide `token`'s licence.
fn plant_slide(c: &mut Petri, who: &str, ms: u64, cs: Vec<u32>, token: &str) {
    let d = c.plant_deposit(cs.len() as u32, None, Some(token.into())).0;
    ctx(who, ms, d);
    c.plant(cs, None, None, Some(token.into()));
}

/// A guest: the relayer sponsors it 0.1 NEAR of credit and it joins on 0.02 of it, attaching nothing.
fn guest(c: &mut Petri, who: &str, ms: u64, name: &str, color: u32) {
    ctx("relayer.testnet", ms, NEAR / 10);
    c.sponsor(acct(who));
    ctx(who, ms, 0);
    c.join(name.into(), color, Some(U128(NEAR / 50)));
}

fn plant_on_credit(c: &mut Petri, who: &str, ms: u64, cs: Vec<u32>) {
    let d = c.plant_deposit(cs.len() as u32, None, None).0;
    ctx(who, ms, 0);
    c.plant(cs, None, Some(U128(d)), None);
}

/// The last tide's entry.
fn last_tide(c: &Petri) -> Entry {
    all_ledger(c).into_iter().filter(|e| matches!(e, Entry::Tide { .. })).last().expect("a tide ran")
}

fn last_entry(c: &Petri) -> Entry {
    let n = c.state().ledger.0;
    c.ledger(Some(n - 1), None).remove(0)
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
    let price = c.quote(4, None, None).0;
    // A nearly empty dish counts 1,000 cells. The agar pays 3 ppm of itself, 98% of that to cells, for 480 generations.
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
    assert!(!p.siege && p.slide.is_none());
    assert_eq!(p.note.as_deref(), Some("first block"));
    conserved(&c, &["alice.testnet"]);
}

#[test]
#[should_panic(expected = "needs at least")]
fn planting_needs_its_fee() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("alice.testnet", T0, 0);
    c.plant(cells(2, 2, patterns::BLOCK), None, None, None);
}

#[test]
fn planting_inside_a_rival_buffer_is_a_siege_at_siege_x_the_price() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 20);
    let normal = c.quote(4, None, None).0;
    let siege = c.quote(4, Some(true), None).0;
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
    let got = c.claim().near.0;
    let Entry::Claim { near, paid, colony, .. } = last_entry(&c) else { panic!("a claim entry") };
    assert_eq!((near.0, paid.0, colony), (alice, got, 1), "the claim is in the ledger");
    assert_eq!(alice - got, entry_bytes(&last_entry(&c)) * byte(), "and its record was paid from the NEAR");
    assert_eq!(c.claimable(acct("alice.testnet")).near.0, 0);
    assert_eq!(c.tide_winnings(None, None)[0].0, alice, "lifetime winnings count the whole claim");
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
    assert!(credit > NEAR / 20 - NEAR / 100 && credit < NEAR / 20, "the records' storage is taken from the sponsorship: {}", credit);
    ctx("g-1.relayer.testnet", T0, 0);
    c.join("Guest".into(), 3, Some(U128(NEAR / 50)));
    assert_eq!(c.credit_of(acct("g-1.relayer.testnet")).0, credit - NEAR / 50);
    let d = c.plant_deposit(4, None, None).0;
    ctx("g-1.relayer.testnet", T0, 0);
    c.plant(cells(2, 2, patterns::BLOCK), None, Some(U128(d)), None);
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
    assert_eq!(c.state().playing, 25, "every planter has a hot row");
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
/// house had earned), every colony's tide winnings and credit won, which sales and shares were paid as credit, every
/// licensed planting (its shape, price, royalty and holder), every refund against the payout it refunds, and every
/// solvency term.
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
    // A wallet colony that will hold Bob's slide.
    let w = "w.testnet";
    join(&mut c, w, t, "Wallet", 5, NEAR / 5);
    plant(&mut c, w, t, cells(10, 24, patterns::BLOCK), None);
    for g in 0..41u64 {
        t += GEN_MS;
        if g == 15 {
            // The guest tends the dish at the second tide, so it runs it and is paid the bounty as credit.
            at(g4, t);
            c.advance(None);
        }
        let who = ["alice.testnet", "bob.testnet", "house.testnet"][(g % 3) as usize];
        let x = 2 + ((g * 5) % 24) as i32;
        let d = c.plant_deposit(3, None, None).0;
        ctx(who, t, d);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.plant(cells(x, 28, patterns::BLINKER), None, None, None);
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
            c.sell(U128(100 * P));
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
        if g == 26 {
            // A slide of Bob's beehive; Alice plants it under the licence and pays Bob the royalty.
            let d = c.slide_deposit(6, 5, None).0;
            ctx("bob.testnet", t, d);
            c.mint_slide(17, 17, 6, 5, None, None);
            plant_slide(&mut c, "alice.testnet", t, cells(4, 12, patterns::BEEHIVE), "2");
        }
        if g == 28 {
            // Bob passes the slide on; its new holder plants it free.
            ctx("bob.testnet", t, 1);
            c.nft_transfer(acct(w), "2".into(), None, None);
            plant_slide(&mut c, w, t, cells(22, 10, patterns::BEEHIVE), "2");
        }
        if g == 33 {
            // Winnings claimed, one payout that fails (and is pending for the colony), and a sale that fails too.
            at(w, t);
            c.claim();
            at("alice.testnet", t);
            c.claim();
            let Entry::Claim { paid, .. } = last_entry(&c) else { panic!("alice claimed NEAR") };
            let index = c.state().ledger.0 - 1;
            callback(t, None);
            c.on_payout(U64(index), PAYOUT_CLAIM, 1, acct("alice.testnet"), paid);
            at("alice.testnet", t);
            c.sell(U128(100 * P));
            let Entry::Sell { paid, .. } = last_entry(&c) else { panic!() };
            let index = c.state().ledger.0 - 1;
            callback(t, None);
            c.on_payout(U64(index), PAYOUT_SALE, 1, acct("alice.testnet"), paid);
            // wNEAR for a buy that arrives with too little gas: it waits, and the keeper settles it.
            wnear_in(&mut c, t, NEAR / 20, r#"{"for":"bob.testnet","do":"buy"}"#, 20, "intents.testnet");
            at("keeper.testnet", t);
            c.settle_pending(acct("bob.testnet"));
            // Alice takes her pending NEAR back.
            at("alice.testnet", t);
            c.claim_pending();
        }
        at("keeper.testnet", t);
        c.advance(None);
    }
    let s = c.state();
    let r = c.rules();
    let k = r.petri_price.0 / 1_000_000 * MAX;
    let n = s.colonies as usize + 1;
    let mut dish = Dish::new(32, 32);
    let mut chain = [0u8; 32];
    let (mut agar, mut vault, mut pool, mut burned, mut counted) = (MAX, 0u128, 0u128, 0u128, 0u32);
    let (mut earned, mut won, mut credit_won) = (vec![0u128; n], vec![0u128; n], vec![0u128; n]);
    let mut window = vec![0u64; n];
    let mut planted = vec![0u64; n];
    let mut attached = vec![false; n];
    let mut house: Vec<u16> = vec![];
    let colonies_view = c.colonies(None, None);
    let account_of = |id: u16| colonies_view[id as usize - 1].account.clone();
    let mut colonies = 0u16;
    let log = all_ledger(&c);
    let (mut tides_seen, mut credit_sales, mut slides_seen, mut guest_bounties, mut licensed, mut refunds) = (0, 0, 0, 0, 0, 0);
    // The solvency terms, recomputed.
    let (mut given, mut spent, mut reclaimed, mut owed, mut pending) = (0u128, 0u128, 0u128, 0u128, 0u128);
    // Each slide's pattern, and its holder as last seen: (bitmap, w, h, moves, holder).
    let mut slides: Vec<(Vec<u8>, u16, u16, u32, AccountId)> = vec![];
    let mut li = 0;
    let mut g = 0u64;
    loop {
        while li < log.len() {
            let gen = match &log[li] {
                Entry::Join { generation, .. }
                | Entry::Buy { generation, .. }
                | Entry::Plant { generation, .. }
                | Entry::Sell { generation, .. }
                | Entry::Tide { generation, .. }
                | Entry::Skip { generation, .. }
                | Entry::Refund { generation, .. }
                | Entry::Slide { generation, .. }
                | Entry::Sponsor { generation, .. }
                | Entry::Unsponsor { generation, .. }
                | Entry::Claim { generation, .. }
                | Entry::Pending { generation, .. }
                | Entry::Unpend { generation, .. }
                | Entry::Dust { generation, .. }
                | Entry::Burn { generation, .. } => generation.0,
            };
            if gen != g {
                break;
            }
            match &log[li] {
                Entry::Join { colony, .. } => {
                    colonies += 1;
                    assert_eq!(*colony, colonies);
                    if colonies_view[*colony as usize - 1].house {
                        house.push(*colony);
                    }
                }
                Entry::Buy { colony, petri, near, credit, spent: s, .. } => {
                    assert_eq!(petri_for_near(near.0 + credit.0, agar, k), petri.0, "purchase on the curve");
                    agar -= petri.0;
                    vault += near.0;
                    pool += credit.0;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    attached[*colony as usize] |= near.0 > 0;
                }
                Entry::Plant { colony, cells, cost, near, credit, siege, spent: s, licence, .. } => {
                    let cells: Vec<u32> = cells.iter().map(|&c| c as u32).collect();
                    let check = dish.check_plant(*colony, &cells, r.buffer, r.max_plant_cells, &house).expect("a legal planting");
                    assert_eq!(check.siege, *siege);
                    let per = feed_per_cell(agar, r.feed_ppm, r.keeper_bps, counted, r.live_floor);
                    let base = planting_cost(per, r.payback, r.min_cell_price.0, cells.len() as u32, *siege, r.siege_x);
                    match licence {
                        None => assert_eq!(base, cost.0, "price at generation {}", g),
                        Some(l) => {
                            let (bitmap, w, h, moves, holder) = &mut slides[l.token.0 as usize - 1];
                            assert!(fits_slide(32, 32, &cells, bitmap, *w, *h), "the slide's own pattern");
                            assert_eq!(licensed_cost(base, r.slide_discount_bps), cost.0, "the licence's price");
                            let who = l.holder.clone().unwrap_or_else(|| account_of(*colony));
                            // The holder is the minter until the slide first moves, and one account between two moves.
                            assert!(l.moves >= *moves);
                            if l.moves == *moves {
                                assert_eq!(&who, holder, "the slide's holder at that point");
                            }
                            (*moves, *holder) = (l.moves, who);
                            assert_eq!(l.royalty.0, if l.holder.is_some() { royalty(cost.0, r.slide_royalty_bps) } else { 0 });
                            assert!(l.holder.as_ref() != Some(&account_of(*colony)), "a holder pays itself no royalty");
                            licensed += 1;
                        }
                    }
                    agar += cost.0 - cost.0 * r.burn_bps as u128 / 10_000;
                    burned += cost.0 * r.burn_bps as u128 / 10_000;
                    planted[*colony as usize] += cells.len() as u64 * petri_core::STAKE_UNIT;
                    vault += near.0;
                    pool += credit.0;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    attached[*colony as usize] |= near.0 > 0;
                    dish.plant_unchecked(*colony, &cells);
                }
                Entry::Sell { colony, petri, near, as_credit, .. } => {
                    let outstanding = MAX - burned - agar;
                    assert_eq!(petri_core::sell_back(petri.0, agar, k, r.sell_bps, vault, outstanding), near.0, "sale on the curve");
                    assert_eq!(*as_credit, !attached[*colony as usize], "a colony that never attached NEAR is paid in credit");
                    credit_sales += *as_credit as u32;
                    agar += petri.0;
                    vault -= near.0;
                }
                Entry::Tide { .. } => panic!("a tide is recorded while stepping"),
                Entry::Slide { colony, x, y, w, h, cells, bitmap, cost, spent: s, .. } => {
                    let (bits, n) = dish.region_bitmap(*colony, *x, *y, *w, *h);
                    assert_eq!((&bits, n), (&bitmap.0, *cells), "the slide is the colony's own cells, as the dish stood");
                    assert!(n >= r.slide_min_cells);
                    assert_eq!(cost.0, r.slide_cells_price.0 * n as u128);
                    burned += cost.0;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    slides.push((bits, *w, *h, 0, account_of(*colony)));
                    slides_seen += 1;
                }
                Entry::Skip { .. } => {}
                Entry::Refund { kind, of, near, storage, .. } => {
                    // Tied to the payout it refunds, and for exactly what that payout sent.
                    let sent = match &log[of.0 as usize] {
                        Entry::Claim { paid, .. } if *kind == PAYOUT_CLAIM => paid.0,
                        Entry::Sell { paid, as_credit: false, .. } if *kind == PAYOUT_SALE => paid.0,
                        Entry::Tide { bounty, .. } if *kind == PAYOUT_BOUNTY => bounty.0,
                        Entry::Unsponsor { amount, .. } if *kind == PAYOUT_UNSPONSOR => amount.0,
                        Entry::Unpend { paid, .. } if *kind == PAYOUT_PENDING => paid.0,
                        e => panic!("a refund of {:?}", e),
                    };
                    assert_eq!(near.0, sent);
                    if *kind == PAYOUT_BOUNTY {
                        vault += near.0 - storage.0;
                    } else {
                        pending += near.0 - storage.0;
                    }
                    refunds += 1;
                }
                Entry::Sponsor { amount, .. } => given += amount.0,
                Entry::Unsponsor { amount, .. } => reclaimed += amount.0,
                Entry::Claim { colony, near, .. } => {
                    owed -= near.0;
                    assert!(near.0 <= won[*colony as usize]);
                }
                Entry::Pending { near, .. } => pending += near.0,
                Entry::Unpend { near, .. } => pending -= near.0,
                Entry::Dust { near, .. } => vault += near.0,
                Entry::Burn { petri, .. } => burned += petri.0,
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
            let capped = (pay.0 * r.tide_bounty_bps as u128 / 10_000).min(r.max_bounty.0);
            let (split, total) = tide_split((pay.0 - capped).saturating_sub(storage.0), &window, &house);
            assert_eq!(total, paid.0 + as_credit.0);
            let house_runner = *by == HOUSE_RUNNER || house.contains(by);
            assert_eq!(bounty.0, if total > 0 && !house_runner { capped } else { 0 }, "a house runner's bounty stays in the vault");
            let mut credited = 0u128;
            for (i, v) in split {
                if attached[i as usize] {
                    won[i as usize] += v;
                    owed += v;
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
            if *by > 0 && *by != HOUSE_RUNNER && !attached[*by as usize] && bounty.0 > 0 {
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
    assert_eq!(slides_seen, 2, "alice's slide and bob's");
    assert_eq!(licensed, 2, "alice's royalty to bob and the new holder's own planting");
    assert_eq!(refunds, 2, "a claim and a sale failed");
    assert_eq!(guest_bounties, 1, "the tide the guest ran");
    assert_eq!(li, log.len(), "every entry replayed");
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    assert_eq!((agar, burned, vault, pool), (s.agar.0, s.burned.0, s.vault.0, s.credit_pool.0));
    assert_eq!((given, spent, reclaimed, owed, pending), (s.credit_given.0, s.credit_spent.0, s.credit_reclaimed.0, s.tides_owed.0, s.pending.0), "every solvency term from the ledger alone");
    // Slides end with the holders the replay last saw, unless they moved since.
    for (i, (_, _, _, moves, holder)) in slides.iter().enumerate() {
        let v = c.slide((i + 1).to_string()).unwrap();
        assert!(v.moves >= *moves);
        if v.moves == *moves {
            assert_eq!(&v.owner_id, holder);
        }
    }
    let e = c.earnings(None, None);
    let wins = c.tide_winnings(None, None);
    for i in 0..s.colonies as usize {
        assert_eq!(e[i].0, earned[i + 1]);
        assert_eq!(wins[i].0, won[i + 1]);
        assert_eq!(colonies_view[i].credit_won.0, credit_won[i + 1]);
    }
    assert_eq!(won[3], 0, "the house won nothing");
    assert_eq!(won[4], 0, "the guest won no NEAR");
    assert!(credit_won[4] > colonies_view[0].credit_won.0, "but credit in its place");
    conserved(&c, &["alice.testnet", "bob.testnet", "house.testnet", g4, w, "keeper.testnet"]);
    // PETRI_DUMP=<file> writes what the views return, so the browser's and the script's replays can be run on it too
    // (`node scripts/verify.mjs --dump <file>`).
    if let Ok(path) = std::env::var("PETRI_DUMP") {
        let dump = json!({
            "rules": c.rules(),
            "state": c.state(),
            "colonies": c.colonies(None, None),
            "ledger": all_ledger(&c),
            "earnings": c.earnings(None, None),
            "tide_winnings": c.tide_winnings(None, None),
            "slides": c.slides(None, None),
            "account": { "amount": U128(env::account_balance().as_yoctonear()), "storage_usage": trie_usage(), "code_hash": "dump" },
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
        let d = c.plant_deposit(cs.len() as u32, None, None).0;
        let fee = c.rules().cell_fee.0 * cs.len() as u128;
        let t = T0 + if n == 4 { 0 } else { GEN_MS };
        at("keeper.testnet", t);
        c.advance(None);
        ctx("alice.testnet", t, d);
        let before = env::storage_usage();
        let vault = c.state().vault.0;
        c.plant(cs, None, None, None);
        let used = (env::storage_usage() - before) as u128 * byte();
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
    let price = c.quote(4, None, None).0;
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

/// A colony whose stake has decayed away leaves the hot table, its numbers written back to its cold slot, and comes
/// back with them when it plants again.
#[test]
fn a_colony_whose_stake_is_gone_leaves_the_hot_table_with_its_numbers() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 2);
    // About sixty tides decay a 4-cell stake to nothing. Bob keeps planting, so the tides keep running.
    let mut t = T0;
    let mut i = 0;
    while c.stakes(None, None)[0].0 > 0 {
        t += 40 * GEN_MS;
        at("keeper.testnet", t);
        c.advance(None);
        plant(&mut c, "bob.testnet", t, cells(1 + (i % 10) * 3, 12 + (i / 10) * 4, patterns::BLOCK), None);
        i += 1;
        assert!(i < 40, "the stake never ran out");
    }
    assert!(HotTable::load().get(1).is_none(), "alice has no hot row");
    assert!(HotTable::load().get(2).is_some(), "bob, who plays, has");
    let (b, stake) = c.read_books(&[1])[0];
    assert_eq!(stake, 0);
    assert!(b.earned > 0 && b.owed > 0 && b.attached, "her numbers are in her cold slot: {:?}", b);
    assert_eq!(c.claimable(acct("alice.testnet")).near.0, b.owed);
    plant(&mut c, "alice.testnet", t, cells(20, 20, patterns::BLOCK), None);
    assert!(HotTable::load().get(1).is_some());
    let (back, _) = c.read_books(&[1])[0];
    assert_eq!((back.owed, back.earned, back.attached), (b.owed, 0, true), "and come back with her (her earnings claimed into the planting)");
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
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
    let near = c.claim().near.0;
    assert!(near > 0);
    assert!(scheduled().contains(&transfer("alice-wallet.testnet", near)));
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "cannot go to the dish itself")]
fn payouts_cannot_be_sent_into_the_dish() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    at("alice.testnet", T0);
    c.set_payout(Some(acct("petri.testnet")));
}

#[test]
fn house_cells_never_make_a_siege_for_newcomers() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 50);
    plant(&mut c, "house.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 50);
    let price = c.quote(4, None, None).0;
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
    assert_eq!(c.credit_grants(acct(g))[0].amount.0, credit, "the sponsored part is untouched");
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
    assert!(matches!(last_entry(&c), Entry::Sell { as_credit: true, .. }));
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
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

// ---------- sponsored credit, per sponsor (finding 1) ----------

#[test]
fn a_sponsor_takes_back_credit_left_unused() {
    let mut c = new_dish();
    ctx("relayer.testnet", T0, NEAR / 20);
    let credit = c.sponsor(acct("g-1.relayer.testnet")).0;
    ctx("mallory.testnet", T0 + 6_000 * GEN_MS, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.unsponsor(acct("g-1.relayer.testnet"));
    }));
    assert!(r.is_err(), "only a sponsor, and only its own");
    ctx("relayer.testnet", T0 + 6_000 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct("g-1.relayer.testnet")).0, credit);
    let calls = scheduled();
    assert_eq!((calls[0].0.as_str(), calls[0].3), ("relayer.testnet", credit), "sent back");
    assert_eq!(calls[1].1, "on_payout", "with a callback");
    assert_eq!(c.credit_of(acct("g-1.relayer.testnet")).0, 0);
    assert_eq!(c.state().credit_reclaimed.0, credit);
    assert!(matches!(last_entry(&c), Entry::Unsponsor { amount, .. } if amount.0 == credit));
    conserved(&c, &[]);
}

/// The v5 attack: for one yoctoNEAR anyone became an account's sponsor, and a day later took the whole credit as NEAR,
/// the relayer's included; and every such deposit pushed the reclaim day back for the real sponsor.
#[test]
fn sponsor_hijack_takes_nothing_but_its_own_and_the_real_sponsor_still_reclaims() {
    let mut c = new_dish();
    let g = "g-1.relayer.testnet";
    ctx("relayer.testnet", T0, NEAR / 10);
    let relayer = c.sponsor(acct(g)).0;
    // The old attack's deposit is refused outright.
    ctx("mallory.testnet", T0 + GEN_MS, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.sponsor(acct(g)))).is_err(), "a yoctoNEAR is no sponsorship");
    // A real deposit buys Mallory only her own grant, and the account's credit is the sum.
    ctx("mallory.testnet", T0 + GEN_MS, NEAR / 100);
    let mallory = c.sponsor(acct(g)).0;
    assert_eq!(c.credit_of(acct(g)).0, relayer + mallory);
    let grants = c.credit_grants(acct(g));
    assert_eq!((grants[0].sponsor.as_str(), grants[1].sponsor.as_str()), ("relayer.testnet", "mallory.testnet"));
    // Mallory keeps topping up to push the day back: it moves only her own grant's day.
    for i in 2..6 {
        ctx("mallory.testnet", T0 + i * 1_000 * GEN_MS, NEAR / 100);
        c.sponsor(acct(g));
    }
    let mallory = c.credit_grants(acct(g))[1].amount.0;
    // A day after the relayer's sponsorship it takes back exactly what it gave.
    ctx("relayer.testnet", T0 + 5_760 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct(g)).0, relayer, "the real sponsor reclaims its own, the griefing notwithstanding");
    // Mallory takes back only her own, and only a day after her last deposit.
    ctx("mallory.testnet", T0 + 5_760 * GEN_MS, 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.unsponsor(acct(g)))).is_err(), "not before her day");
    ctx("mallory.testnet", T0 + 5_000 * GEN_MS + 5_760 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct(g)).0, mallory, "her own and nothing more");
    assert_eq!(c.credit_of(acct(g)).0, 0);
    let s = c.state();
    assert_eq!(s.credit_reclaimed.0, relayer + mallory);
    conserved(&c, &[g]);
}

#[test]
fn credit_is_spent_won_first_then_the_oldest_sponsorship() {
    let mut c = new_dish();
    let g = "g-1.relayer.testnet";
    ctx("relayer.testnet", T0, NEAR / 20);
    let first = c.sponsor(acct(g)).0;
    ctx("friend.testnet", T0, NEAR / 20);
    let second = c.sponsor(acct(g)).0;
    // The join draws on the relayer's grant only, and restarts only its day.
    ctx(g, T0 + 100 * GEN_MS, 0);
    c.join("Guest".into(), 3, Some(U128(NEAR / 50)));
    let grants = c.credit_grants(acct(g));
    assert_eq!((grants[0].amount.0, grants[0].at.0), (first - NEAR / 50, 100));
    assert_eq!((grants[1].amount.0, grants[1].at.0), (second, 0), "the second sponsor's grant is untouched");
    // Spending past the first grant empties and removes it, then draws on the second.
    ctx(g, T0 + 100 * GEN_MS, 0);
    c.buy(Some(U128(first - NEAR / 50 + NEAR / 100)));
    let grants = c.credit_grants(acct(g));
    assert_eq!(grants.len(), 1);
    assert_eq!((grants[0].sponsor.as_str(), grants[0].amount.0), ("friend.testnet", second - NEAR / 100));
    // The relayer has nothing left to take back.
    ctx("relayer.testnet", T0 + 9_000 * GEN_MS, 0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.unsponsor(acct(g)))).is_err());
    conserved(&c, &[g]);
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
    let sponsored = c.credit_grants(acct(m))[0].amount.0;
    assert!(won / 2 > 140 * byte(), "enough won to buy with: {}", won);
    assert_eq!(c.credit_of(acct(m)).0, won + sponsored);
    // Half the winnings buy PETRI; the sponsored credit is not touched.
    ctx(m, T0 + 8 * GEN_MS, 0);
    c.buy(Some(U128(won / 2)));
    assert_eq!(c.credit_grants(acct(m))[0].amount.0, sponsored);
    assert_eq!(c.credit_of(acct(m)).0, sponsored + won - won / 2);
    // A day later the sponsor (itself) takes back the sponsored credit, and only that. (The dish is tended first, so
    // the colony has won more by then.)
    at("keeper.testnet", T0 + 6_000 * GEN_MS);
    c.advance(None);
    ctx(m, T0 + 6_000 * GEN_MS, 0);
    assert_eq!(c.unsponsor(acct(m)).0, sponsored);
    let left = c.colony_of(acct(m)).unwrap().credit_won.0 - won / 2;
    assert_eq!(c.credit_of(acct(m)).0, left, "the winnings stay, spendable only in the dish");
    assert_eq!(c.state().credit_reclaimed.0, sponsored);
    assert_eq!(c.claimable(acct(m)).near.0, 0);
    ctx(m, T0 + 6_000 * GEN_MS, 0);
    c.buy(Some(U128(left)));
    assert_eq!(c.credit_of(acct(m)).0, 0);
    conserved(&c, &["alice.testnet", m, "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "from 8 sponsors")]
fn an_account_takes_credit_from_at_most_eight_sponsors() {
    let mut c = new_dish();
    for i in 0..9 {
        ctx(&format!("s{}.testnet", i), T0, NEAR / 100);
        c.sponsor(acct("g-1.relayer.testnet"));
    }
}

#[test]
fn a_failed_reclaim_is_pending_for_the_sponsor() {
    let mut c = new_dish();
    ctx("relayer.testnet", T0, NEAR / 20);
    let credit = c.sponsor(acct("g-1.relayer.testnet")).0;
    ctx("relayer.testnet", T0 + 6_000 * GEN_MS, 0);
    c.unsponsor(acct("g-1.relayer.testnet"));
    let index = c.state().ledger.0 - 1;
    callback(T0 + 6_000 * GEN_MS, None);
    c.on_payout(U64(index), PAYOUT_UNSPONSOR, 0, acct("relayer.testnet"), U128(credit));
    let Entry::Refund { kind, of, near, storage, .. } = last_entry(&c) else { panic!("a refund") };
    assert_eq!((kind, of.0, near.0), (PAYOUT_UNSPONSOR, index, credit));
    assert_eq!(c.pending_of(acct("relayer.testnet")).0, credit - storage.0, "pending for the sponsor, less the refund's records");
    conserved(&c, &[]);
}

// ---------- the house (finding 2) ----------

/// The v5 attack: the house holds almost all the PETRI outside the agar, so its sales could take most of the vault.
#[test]
#[should_panic(expected = "never sell PETRI back")]
fn house_sell_drain_is_refused() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR);
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    at("house.testnet", T0 + 8 * GEN_MS);
    c.sell(U128(10 * P));
}

/// The same drain one step removed: the house hands its PETRI to a player who sells it.
#[test]
#[should_panic(expected = "stays in the house")]
fn house_petri_cannot_reach_a_player_to_sell() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR);
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR / 50);
    ctx("house.testnet", T0, 1);
    c.ft_transfer(acct("alice.testnet"), U128(10 * P), None);
}

#[test]
fn house_strains_still_pay_each_other() {
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { house: vec![acct("house.testnet"), acct("house2.testnet")], ..rules() });
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 20);
    join(&mut c, "house2.testnet", T0, "House Two", 2, NEAR / 50);
    ctx("house.testnet", T0, 1);
    c.ft_transfer(acct("house2.testnet"), U128(P), None);
    conserved(&c, &["house.testnet", "house2.testnet"]);
}

#[test]
fn house_bounties_stay_in_the_vault() {
    let mut c = new_dish();
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 20);
    join(&mut c, "alice.testnet", T0, "Alice", 2, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // A tide run by a house colony, then one by a keeper with no colony, then one by a stranger.
    let mut paid_bounties = 0u128;
    for (who, gen) in [("house.testnet", 8), ("dish-keeper.testnet", 16), ("stranger.testnet", 24)] {
        let vault = c.state().vault.0;
        at(who, T0 + gen * GEN_MS);
        c.advance(None);
        let Entry::Tide { pay, bounty, storage, paid, as_credit, by, .. } = last_tide(&c) else { unreachable!() };
        let house = who != "stranger.testnet";
        assert_eq!(by, match who { "house.testnet" => 1, "dish-keeper.testnet" => HOUSE_RUNNER, _ => 0 });
        let capped = (pay.0 * 100 / 10_000).min(rules().max_bounty.0);
        assert_eq!(bounty.0, if house { 0 } else { capped }, "{}", who);
        assert_eq!(scheduled().iter().any(|r| r.1 == "transfer"), !house, "{} is paid no NEAR", who);
        assert_eq!(c.state().vault.0, vault - paid.0 - as_credit.0 - storage.0 - bounty.0, "the house's bounty stayed in the vault");
        paid_bounties += bounty.0;
    }
    assert_eq!(c.state().near_bounties.0, paid_bounties, "only the stranger was paid a bounty");
    conserved(&c, &["house.testnet", "alice.testnet"]);
}

#[test]
fn a_keeper_takes_no_keeper_pot() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    ctx("dish-keeper.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    at("dish-keeper.testnet", T0 + 3 * GEN_MS);
    c.advance(None);
    assert_eq!(bal(&c, "dish-keeper.testnet"), 0, "the pot waits for a player");
    assert!(c.state().keeper_pot.0 > 0);
    conserved(&c, &["alice.testnet", "dish-keeper.testnet"]);
}

// ---------- gas with 30,000 colonies (finding 3) ----------

/// `n` more colonies, written the way `join` writes them: 30,000 real joins would take minutes in the unit runtime.
fn crowd(c: &mut Petri, n: u32) {
    for i in 0..n {
        // A fresh context now and then: one call could never write this much.
        if i % 500 == 0 {
            c.flush();
            at("deployer.testnet", T0);
        }
        let id = (c.colonies.len() + 1) as u16;
        let account: AccountId = format!("c{}.testnet", id).parse().unwrap();
        c.colonies.push(Colony {
            id,
            account: account.clone(),
            name: format!("C{}", id),
            color: 1,
            house: false,
            payout: None,
            joined_generation: U64(0),
            last_plant_generation: None,
            cells_planted: U64(0),
            petri_spent: U128(0),
            petri_burned: U128(0),
            petri_claimed: U128(0),
            petri_sold: U128(0),
            near_paid: U128(0),
            near_claimed: U128(0),
            near_sold: U128(0),
            credit_won: U128(0),
            proxy: false,
        });
        c.colony_of.insert(account.clone(), id);
        c.names.insert(format!("c{}", id));
        c.balances.insert(account, 0);
        books::cold_push(id);
    }
    c.flush();
}

/// A dish of 30,000 colonies, every `every`-th of them playing (stake, and a share of the coming tide to collect,
/// half of them wallets, spread across every cold page), takes a new colony's join, its planting, the catch-up through
/// a tide that pays every playing colony, and claims by a playing colony, the newcomer and an idle colony. Returns the
/// gas each call used.
fn thirty_thousand(every: u16) -> Vec<(&'static str, u64)> {
    // A call with `tgas`, on an account whose storage is as large as this dish's really is (the unit runtime starts
    // every context at 300 KB, and a write subtracts the value it replaces first).
    let ctx_gas = |who: &str, ms: u64, deposit: u128, tgas: u64| {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acct(who)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(ms * MS).attached_deposit(NearToken::from_yoctonear(deposit)).prepaid_gas(Gas::from_tgas(tgas)).storage_usage(100_000_000);
        testing_env!(b.build());
    };
    // Each call loads the hot table afresh on chain; the unit runtime keeps the contract between calls, so drop the
    // copy the last call left.
    let fresh = |c: &mut Petri| c.hot = None;
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { tide_every: 8, house: vec![], ..launch() });
    join(&mut c, "funder.testnet", T0, "Funder", 1, 200 * NEAR);
    crowd(&mut c, 29_999);
    {
        let hot = c.hot_table();
        for id in (every.max(2)..=30_000u16).step_by(every as usize) {
            hot.rows.push(Hot { id, stake: 4_000, window: 1_000, books: Books { attached: id % (2 * every) == 0, ..Default::default() } });
        }
        hot.dirty = true;
        hot.purse_dirty = true;
    }
    c.flush();
    let playing = c.state().playing;
    assert_eq!((c.state().colonies, playing), (30_000, (30_000 / every as u32) - (every == 1) as u32));
    let block = |x: i32, y: i32| -> Vec<u32> { patterns::BLOCK.iter().map(|&(dx, dy)| ((y + dy) * 128 + x + dx) as u32).collect() };
    let mut report = vec![];
    // The 30,001st colony joins: one cold page, however many came before.
    ctx_gas("newcomer.testnet", T0, NEAR / 2, 300);
    fresh(&mut c);
    c.join("Newcomer".into(), 7, None);
    report.push(("join", env::used_gas().as_gas()));
    let d = c.plant_deposit(4, None, None).0;
    ctx_gas("newcomer.testnet", T0, d, 200);
    fresh(&mut c);
    c.plant(block(60, 60), None, None, None);
    report.push(("plant", env::used_gas().as_gas()));
    // The catch-up through the tide: eight generations, then every playing colony paid.
    ctx_gas("keeper.testnet", T0 + 8 * GEN_MS, 0, 250);
    fresh(&mut c);
    c.advance(None);
    report.push(("advance through a tide", env::used_gas().as_gas()));
    assert_eq!((c.state().generation.0, c.state().tides.0), (8, 1));
    let Entry::Tide { paid, as_credit, .. } = last_tide(&c) else { unreachable!() };
    assert!(paid.0 > 0 && as_credit.0 > 0);
    // A playing wallet colony and the newcomer claim; an idle colony's claim reads one cold page.
    let wallet = format!("c{}.testnet", 2 * every);
    ctx_gas(&wallet, T0 + 8 * GEN_MS, 0, 150);
    fresh(&mut c);
    c.claim();
    report.push(("claim (a playing colony)", env::used_gas().as_gas()));
    ctx_gas("newcomer.testnet", T0 + 8 * GEN_MS, 0, 150);
    fresh(&mut c);
    c.claim();
    report.push(("claim (the newcomer)", env::used_gas().as_gas()));
    if every > 1 {
        ctx_gas(&format!("c{}.testnet", every + 1), T0 + 8 * GEN_MS, 0, 150);
        fresh(&mut c);
        c.claim();
        report.push(("claim (an idle colony)", env::used_gas().as_gas()));
    }
    for (what, g) in &report {
        eprintln!("30,000 colonies, {} playing: {} {:.2} TGas of host calls", playing + 1, what, *g as f64 / 1e12);
    }
    // Every winner was paid: the wallets in NEAR, the others as credit.
    assert!(c.tide_winnings(Some(2 * every as u32 - 1), Some(1))[0].0 > 0, "a wallet won NEAR");
    let guest = if every == 1 { 3 } else { every as u32 };
    assert!(c.colonies(Some(guest - 1), Some(1))[0].credit_won.0 > 0, "a guest won credit");
    report
}

/// v5 rewrote seven arrays covering every colony on each join, three on each catch-up and four at each tide, and
/// looped over every colony at every tide: it would have halted at about 27,000 colonies. Here 30,000 colonies, 1,500
/// of them playing. The unit runtime charges host calls (storage reads and writes, logs, promises) but not wasm
/// execution, so this measures what used to grow with every colony; the wasm left over (Life on the board, and loops
/// over the playing colonies only) is the same as on a dish of 1,500. The transfers of the bounty and the claims, with
/// the 15 TGas each callback is given, are about 30 TGas of every figure.
#[test]
fn thirty_thousand_colonies_join_plant_tide_and_claim_well_under_the_gas_limit() {
    let report = thirty_thousand(20);
    for (what, g) in &report {
        assert!(*g < Gas::from_tgas(60).as_gas(), "{}: {:.1} TGas", what, *g as f64 / 1e12);
    }
    assert!(report[0].1 < Gas::from_tgas(5).as_gas(), "a join stays small");
}

/// The worst case: all 30,000 colonies playing at once (each paid to plant in the last few days) and every one of
/// them paid at the tide. Every call still fits, with room to spare.
#[test]
fn thirty_thousand_colonies_all_playing_still_fit() {
    for (what, g) in thirty_thousand(1) {
        assert!(g < Gas::from_tgas(200).as_gas(), "{}: {:.1} TGas", what, g as f64 / 1e12);
    }
}

/// The simulator found that a tide writing every winner's colony and credit records needed about 0.26 TGas per
/// winner and ran out of gas at about 1,100 winners. Winnings now go into the hot table, read and written once per
/// call. The bounty's transfer and its callback cost the same however many colonies win, and are measured apart.
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
    {
        let hot = c.hot_table();
        for id in 1..=n as u16 {
            let r = hot.enter(id);
            r.stake = 1_000;
            r.window = 1_000;
        }
    }
    c.flush();
    at("keeper.testnet", T0);
    c.pay_out(&acct("keeper.testnet"), PAYOUT_BOUNTY, 0, 0, &acct("keeper.testnet"), 1);
    let bounty = env::used_gas().as_gas();
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.hot = None;
    c.advance(None);
    let used = env::used_gas().as_gas();
    let tide = used - bounty;
    eprintln!("a generation and a tide with {} winners: {:.2} TGas of host calls, plus {:.2} TGas for the bounty payout", n, tide as f64 / 1e12, bounty as f64 / 1e12);
    assert!(tide < Gas::from_tgas(20).as_gas(), "{} gas", tide);
    assert!(used < Gas::from_tgas(60).as_gas(), "{} gas", used);
    let Entry::Tide { paid, as_credit, credit_paid, .. } = last_tide(&c) else { unreachable!() };
    assert!(paid.0 > 0 && as_credit.0 > 0 && credit_paid.0 > 0);
    let winnings: Vec<U128> = (0..n).step_by(500).flat_map(|from| c.tide_winnings(Some(from), Some(500))).collect();
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
    let used = (env::storage_usage() - storage) as u128 * byte();
    let refund: u128 = scheduled().iter().filter(|r| r.1 == "transfer").map(|r| r.3).sum();
    let logs = get_logs();
    assert_eq!(id, "1");
    // Six beehive cells are Alice's; Bob's block in the same rectangle is not.
    let v = c.slide(id.clone()).unwrap();
    assert_eq!((v.cells, v.colony, v.owner_id.as_str(), v.title.as_deref(), v.moves, v.royalties.0), (6, 1, "alice.testnet", Some("First one"), 0, 0));
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
    let reserve = 184 * byte();
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

/// Each NEP-171 token draws its SVG on chain, so an enumeration of fifty could run a view out of gas.
#[test]
fn nft_enumeration_draws_at_most_ten_images_a_call() {
    let mut c = two_colonies();
    for _ in 0..12 {
        mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    }
    assert_eq!(c.nft_tokens(None, Some(50)).len(), 10);
    assert_eq!(c.nft_tokens(Some(U128(10)), Some(50)).len(), 2);
    assert_eq!(c.nft_tokens_for_owner(acct("alice.testnet"), None, Some(50)).len(), 10);
    assert_eq!(c.slides(None, Some(50)).len(), 12, "the image-free view still pages by hundreds");
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
    assert!(matches!(last_entry(&c), Entry::Slide { spent: Some(s), .. } if s.0 == spent), "the credit is in the ledger");
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
    assert_eq!(c.slide("2".into()).unwrap().moves, 1);
    assert_eq!(c.nft_supply_for_owner(acct("alice.testnet")).0, 1);
    assert_eq!(c.nft_tokens_for_owner(acct(&long), None, None)[0].token_id, "2");
    assert_eq!(c.slides_for(acct("alice.testnet"), None, None)[0].token_id, "1");
    assert_eq!(c.slides(None, None).len(), 2);
    assert_eq!(c.nft_total_supply().0, 2);
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
    let cost = (12 + "market.testnet".len() as u128) * byte();
    ctx("alice.testnet", T0, cost + 5);
    let storage = env::storage_usage();
    c.nft_approve("1".into(), acct("market.testnet"), None);
    assert_eq!((env::storage_usage() - storage) as u128 * byte(), cost, "the approval pays exactly its storage");
    assert_eq!(scheduled(), vec![transfer("alice.testnet", 5)], "the rest goes back");
    let other = (12 + "other.testnet".len() as u128) * byte();
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
    let cost = (12 + "market.testnet".len() as u128) * byte();
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
    assert_eq!(c.slide("1".into()).unwrap().moves, 2, "out and back are two moves");
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
    let before = trie_usage();
    ctx("al.testnet", T0, d);
    c.mint_slide(0, 0, 8, 8, None, None);
    c.flush();
    let refund: u128 = scheduled().iter().map(|r| r.3).sum();
    let paid = (d - refund) / byte();
    let mut owner = "al.testnet".to_string();
    for i in 0..5 {
        let next = format!("{}{}.testnet", "x".repeat(55), i);
        assert_eq!(next.len(), 64);
        ctx(&owner, T0, 1);
        c.nft_transfer(acct(&next), "1".into(), None, None);
        c.flush();
        let grown = trie_usage() - before;
        assert!(grown as u128 <= paid, "storage {} past the {} paid", grown, paid);
        owner = next;
    }
}

// ---------- slides as pattern licences (finding 9) ----------

/// Alice's glider slide (5 cells, token 1), and Bob, a second colony with PETRI to plant with.
fn glider_slide() -> Petri {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 0xc8431f, NEAR / 5);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::GLIDER), None);
    mint(&mut c, "alice.testnet", T0, (1, 1, 5, 5), None);
    join(&mut c, "bob.testnet", T0, "Bob", 0x1e8c6e, NEAR / 5);
    c
}

#[test]
fn the_holder_plants_its_slide_at_the_licence_discount() {
    let mut c = glider_slide();
    let held = bal(&c, "alice.testnet");
    let t = T0 + GEN_MS;
    at("keeper.testnet", t);
    c.advance(None);
    let earned = c.claimable(acct("alice.testnet")).petri.0;
    let full = c.quote(5, None, None).0;
    assert_eq!(c.quote(5, None, Some(true)).0, full - full * 2_500 / 10_000);
    plant_slide(&mut c, "alice.testnet", t, cells(20, 20, patterns::GLIDER), "1");
    assert_eq!(held + earned - bal(&c, "alice.testnet"), full - full / 4, "a quarter off, and no royalty to herself");
    let Entry::Plant { cost, licence: Some(l), .. } = last_entry(&c) else { panic!("a licensed planting") };
    assert_eq!((cost.0, l.token.0, l.moves, l.holder, l.royalty.0), (full - full / 4, 1, 0, None, 0));
    assert_eq!(c.plants(None, None)[1].slide.as_deref(), Some("1"));
    assert_eq!(c.slide_royalties("1".into()).0, 0);
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
fn a_stranger_plants_a_slide_and_pays_its_holder_a_royalty() {
    let mut c = glider_slide();
    let (alice, bob) = (bal(&c, "alice.testnet"), bal(&c, "bob.testnet"));
    let full = c.quote(5, None, None).0;
    let cost = full - full / 4;
    let toll = cost * 1_000 / 10_000;
    plant_slide(&mut c, "bob.testnet", T0, cells(20, 20, patterns::GLIDER), "1");
    assert_eq!(bob - bal(&c, "bob.testnet"), cost + toll, "the discounted price and a tenth of it to the holder");
    assert_eq!(bal(&c, "alice.testnet") - alice, toll, "transferred to the holder, not burned");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!() };
    assert_eq!((l.holder, l.royalty.0), (Some(acct("alice.testnet")), toll));
    assert_eq!((c.slide_royalties("1".into()).0, c.state().royalties.0), (toll, toll));
    assert!(get_logs().iter().any(|l| l.contains("slide royalty")));
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "not the slide's pattern")]
fn a_planting_of_another_shape_is_not_licensed() {
    let mut c = glider_slide();
    plant_slide(&mut c, "bob.testnet", T0, cells(20, 20, patterns::R_PENTOMINO), "1");
}

#[test]
#[should_panic(expected = "not the slide's pattern")]
fn a_turned_slide_is_not_licensed() {
    let mut c = glider_slide();
    let turned: Vec<(i32, i32)> = patterns::GLIDER.iter().map(|&(x, y)| (y, x)).collect();
    plant_slide(&mut c, "bob.testnet", T0, cells(20, 20, &turned), "1");
}

#[test]
fn after_a_transfer_royalties_go_to_the_new_holder() {
    let mut c = glider_slide();
    // Carol has no PETRI registration; the first royalty registers her at the planter's expense.
    ctx("alice.testnet", T0, 1);
    c.nft_transfer(acct("carol.testnet"), "1".into(), None, None);
    let alice = bal(&c, "alice.testnet");
    let d = c.plant_deposit(5, None, Some("1".into())).0;
    assert!(d >= c.plant_deposit(5, None, None).0 + 125 * byte(), "the deposit covers registering the holder");
    plant_slide(&mut c, "bob.testnet", T0, cells(20, 20, patterns::GLIDER), "1");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!() };
    assert_eq!((l.moves, l.holder.clone()), (1, Some(acct("carol.testnet"))));
    assert_eq!(bal(&c, "carol.testnet"), l.royalty.0, "the new holder is paid");
    assert_eq!(bal(&c, "alice.testnet"), alice, "the old one is not");
    assert!(c.storage_balance_of(acct("carol.testnet")).is_some());
    // Alice, no longer the holder, pays the royalty too.
    plant_slide(&mut c, "alice.testnet", T0 + GEN_MS, cells(10, 26, patterns::GLIDER), "1");
    let Entry::Plant { licence: Some(l2), .. } = last_entry(&c) else { panic!() };
    assert_eq!(l2.holder, Some(acct("carol.testnet")));
    assert_eq!(bal(&c, "carol.testnet"), l.royalty.0 + l2.royalty.0);
    conserved(&c, &["alice.testnet", "bob.testnet", "carol.testnet"]);
}

#[test]
#[should_panic(expected = "the house plants only slides it holds")]
fn the_house_pays_no_royalty_to_players() {
    let mut c = glider_slide();
    join(&mut c, "house.testnet", T0, "House", 3, NEAR / 5);
    plant_slide(&mut c, "house.testnet", T0, cells(20, 20, patterns::GLIDER), "1");
}

// ---------- the token standards (finding 8) ----------

#[test]
fn a_refund_to_an_unregistered_sender_is_burned() {
    let mut c = two_colonies();
    ctx("dan.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    ctx("vault.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    ctx("alice.testnet", T0, 1);
    c.ft_transfer(acct("dan.testnet"), U128(5 * P), None);
    ctx_gas("dan.testnet", T0, 1, 300);
    let _ = c.ft_transfer_call(acct("vault.testnet"), U128(5 * P), None, "refund me".into());
    // Dan unregisters while the receiver decides, and the receiver hands back two PETRI.
    ctx("dan.testnet", T0, 1);
    assert!(c.storage_unregister(None));
    let burned = c.state().burned.0;
    callback(T0, Some(br#""2000000""#.to_vec()));
    let used = c.ft_resolve_transfer(acct("dan.testnet"), acct("vault.testnet"), U128(5 * P)).0;
    assert_eq!(used, 5 * P, "burned counts as used");
    assert_eq!(bal(&c, "vault.testnet"), 3 * P);
    assert_eq!(c.state().burned.0, burned + 2 * P);
    assert_eq!(c.ft_total_supply().0, MAX - c.state().burned.0);
    assert!(get_logs().iter().any(|l| l.contains("\"ft_burn\"")));
    assert!(matches!(last_entry(&c), Entry::Burn { petri, .. } if petri.0 == 2 * P));
    conserved(&c, &["alice.testnet", "bob.testnet", "vault.testnet"]);
}

#[test]
fn a_forced_unregistration_burns_the_balance() {
    let mut c = two_colonies();
    ctx("dan.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    ctx("alice.testnet", T0, 1);
    c.ft_transfer(acct("dan.testnet"), U128(5 * P), None);
    ctx("dan.testnet", T0, 1);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.storage_unregister(None))).is_err(), "not without force");
    ctx("dan.testnet", T0, 1);
    assert!(c.storage_unregister(Some(true)));
    assert!(c.storage_balance_of(acct("dan.testnet")).is_none(), "the registration is closed");
    let refund: u128 = scheduled().iter().filter(|r| r.0 == "dan.testnet").map(|r| r.3).sum();
    assert!(refund > 0 && refund < 125 * byte(), "the storage back, less the Burn entry");
    assert!(matches!(last_entry(&c), Entry::Burn { petri, .. } if petri.0 == 5 * P));
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "stays registered")]
fn a_colony_cannot_force_unregister() {
    let mut c = two_colonies();
    ctx("alice.testnet", T0, 1);
    c.storage_unregister(Some(true));
}

#[test]
fn a_failed_sale_payout_is_pending_for_the_seller() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("alice.testnet", T0);
    c.set_payout(Some(acct("gone.testnet")));
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    at("alice.testnet", T0 + 8 * GEN_MS);
    let paid = c.sell(U128(100 * P)).0;
    let index = c.state().ledger.0 - 1;
    let vault = c.state().vault.0;
    callback(T0 + 8 * GEN_MS, None);
    c.on_payout(U64(index), PAYOUT_SALE, 1, acct("alice.testnet"), U128(paid));
    let Entry::Refund { kind, of, near, storage, colony, .. } = last_entry(&c) else { panic!("a refund") };
    assert_eq!((kind, of.0, near.0, colony), (PAYOUT_SALE, index, paid, 1), "tied to the sale it refunds");
    assert_eq!(c.pending_of(acct("alice.testnet")).0, paid - storage.0, "the seller's, as pending NEAR");
    assert_eq!(c.state().vault.0, vault, "not the vault's");
    assert_eq!(c.colony_of(acct("alice.testnet")).unwrap().near_sold.0, 0);
    at("alice.testnet", T0 + 8 * GEN_MS);
    assert!(c.claim_pending().0 > paid - storage.0 - NEAR / 1_000, "claimed by the seller");
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn a_failed_claim_is_pending_for_the_colony() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let owed = c.claimable(acct("alice.testnet")).near.0;
    at("alice.testnet", T0 + 8 * GEN_MS);
    let near = c.claim().near.0;
    let index = c.state().ledger.0 - 1;
    callback(T0 + 8 * GEN_MS, None);
    c.on_payout(U64(index), PAYOUT_CLAIM, 1, acct("alice.testnet"), U128(near));
    let Entry::Refund { storage, .. } = last_entry(&c) else { panic!() };
    assert_eq!(c.pending_of(acct("alice.testnet")).0, near - storage.0);
    assert_eq!(c.tide_winnings(None, None)[0].0, owed, "lifetime winnings unchanged");
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn winnings_too_small_for_a_claims_records_wait() {
    // Winnings smaller than a claim's records stay owed; the PETRI is still claimed.
    let mut c = new_dish();
    join(&mut c, "alicia.testnet", T0, "Alicia", 1, NEAR / 10);
    plant(&mut c, "alicia.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("keeper2.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let owed = c.claimable(acct("alicia.testnet")).near.0;
    assert!(owed > 0 && owed < 300 * byte(), "{}", owed);
    at("alicia.testnet", T0 + 8 * GEN_MS);
    let got = c.claim();
    assert_eq!(got.near.0, 0);
    assert!(got.petri.0 > 0);
    assert_eq!(c.claimable(acct("alicia.testnet")).near.0, owed, "it waits");
    conserved(&c, &["alicia.testnet", "keeper2.testnet"]);
}

// ---------- paying with wNEAR (findings 4, 5, 6) ----------

const WNEAR: &str = "wrap.testnet";

/// wNEAR's `ft_transfer_call` landing in the dish from `sender`, with `gas` TGas left.
fn wnear_in(c: &mut Petri, ms: u64, amount: u128, msg: &str, gas: u64, sender: &str) -> U128 {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(ms * MS).prepaid_gas(Gas::from_tgas(gas));
    testing_env!(b.build());
    match c.ft_on_transfer(acct(sender), U128(amount), msg.into()) {
        PromiseOrValue::Value(v) => v,
        PromiseOrValue::Promise(_) => panic!("ft_on_transfer returns a value"),
    }
}

/// The whole path, as the chain runs it: wNEAR arrives, the unwrap succeeds (or not), then the order. Returns what the
/// settle did, or "pending" when no settle was scheduled.
fn pay_wnear(c: &mut Petri, ms: u64, amount: u128, msg: &str, unwrap_ok: bool, sender: &str) -> String {
    assert_eq!(wnear_in(c, ms, amount, msg, 300, sender).0, 0, "the whole amount is kept");
    let calls = scheduled();
    assert_eq!((calls[0].0.as_str(), calls[0].1.as_str(), calls[0].3), (WNEAR, "near_withdraw", 1));
    assert_eq!(calls[1].1, "on_unwrapped");
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&calls[1].2).unwrap();
    let account: AccountId = a["account"].as_str().unwrap().parse().unwrap();
    let order: Option<Order> = near_sdk::serde_json::from_value(a["order"].clone()).unwrap();
    assert_eq!(a["amount"].as_str().unwrap().parse::<u128>().unwrap(), amount);
    callback(ms, if unwrap_ok { Some(vec![]) } else { None });
    c.on_unwrapped(account, order, U128(amount));
    let calls = scheduled();
    let Some(settle) = calls.iter().find(|c| c.1 == "settle_intent") else { return "pending".into() };
    let a: near_sdk::serde_json::Value = near_sdk::serde_json::from_slice(&settle.2).unwrap();
    callback(ms, None);
    c.settle_intent(a["account"].as_str().unwrap().parse().unwrap())
}

#[test]
fn a_proxy_join_gets_a_neutral_name_and_never_the_payers_text() {
    let mut c = new_dish();
    let did = pay_wnear(&mut c, T0, NEAR / 20, r#"{"for":"illia.testnet","do":"join","name":"Illia rugs","color":7012000}"#, true, "intents.testnet");
    assert_eq!(did, "join");
    let col = c.colony_of(acct("illia.testnet")).unwrap();
    let hash = hex::encode(env::sha256(b"illia.testnet"));
    assert_eq!(col.name, format!("Culture {}", &hash[..4]), "a neutral name from the account's hash");
    assert_ne!(col.color, 7012000, "and a colour from it too");
    assert!(col.proxy);
    assert!(bal(&c, "illia.testnet") > 0, "it bought PETRI");
    let s = c.state();
    assert!(s.vault.0 > 0 && s.credit_pool.0 == 0, "the NEAR went to the vault as the player's own");
    assert!(c.read_books(&[col.id])[0].0.attached, "a NEAR colony: paid its tides in NEAR");
    assert_eq!((s.pending.0, s.wrapped.0, c.pending_of(acct("illia.testnet")).0), (0, 0, 0));
    assert!(get_logs().iter().any(|l| l.contains("\"intents\"") && l.contains("\"did\":\"join\"")));
    // The account itself chooses its name and colour, once.
    at("illia.testnet", T0);
    c.rename("Illia".into(), 0x2364aa);
    let col = c.colony_of(acct("illia.testnet")).unwrap();
    assert_eq!((col.name.as_str(), col.proxy), ("Illia", false));
    conserved(&c, &["illia.testnet"]);
}

#[test]
fn an_account_paying_for_itself_keeps_its_name() {
    let mut c = new_dish();
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 20, r#"{"for":"pat.testnet","do":"join","name":"Gram Stain","color":7012000}"#, true, "pat.testnet"), "join");
    let col = c.colony_of(acct("pat.testnet")).unwrap();
    assert_eq!((col.name.as_str(), col.color, col.proxy), ("Gram Stain", 7012000, false));
    conserved(&c, &["pat.testnet"]);
}

#[test]
#[should_panic(expected = "kept for colonies someone else paid to start")]
fn neutral_names_cannot_be_taken_first() {
    let mut c = new_dish();
    join(&mut c, "mallory.testnet", T0, "Culture 3f2a", 1, NEAR / 50);
}

#[test]
#[should_panic(expected = "only a colony someone else started")]
fn a_colony_renames_once_and_only_if_someone_else_started_it() {
    let mut c = new_dish();
    pay_wnear(&mut c, T0, NEAR / 20, r#"{"for":"pat.testnet","do":"join"}"#, true, "intents.testnet");
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
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 20, &format!(r#"{{"for":"{}","do":"buy"}}"#, g), true, "intents.testnet"), "buy");
    let after = bal(&c, g);
    assert!(after > held);
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 20, &format!(r#"{{"for":"{}","do":"join","name":"Other"}}"#, g), true, "intents.testnet"), "buy", "already joined: a purchase");
    assert!(bal(&c, g) > after);
    assert_eq!(c.colony_of(acct(g)).unwrap().name, "Guest", "and no second colony");
    assert!(c.read_books(&[1])[0].0.attached, "the guest now has NEAR of its own in the vault");
    assert_eq!(c.state().pending.0, 0);
    conserved(&c, &[g]);
}

/// v5 refunded wNEAR below 0.01 to its sender, which for a 1Click delivery is the intents contract: the player lost
/// it. Now nothing from wNEAR is refunded.
#[test]
fn an_intent_below_the_minimum_is_kept_for_its_account_not_refunded() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 1_000 * 5, r#"{"for":"pat.testnet","do":"join"}"#, 20, "intents.testnet").0, 0, "kept, not refunded");
    let owed = c.pending_of(acct("pat.testnet")).0;
    assert!(owed > 0 && owed < NEAR / 200, "pending for pat, less its records: {}", owed);
    assert!(matches!(last_entry(&c), Entry::Pending { near, .. } if near.0 == owed));
    let r = c.pending_record(acct("pat.testnet")).unwrap();
    assert_eq!((r.order_near.0, r.order.map(|o| o.join)), (owed, Some(true)), "with its order");
    // Too little to join: the order waits, unchanged, and pat can claim it.
    at("keeper.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_pending(acct("pat.testnet")))).is_err(), "a join needs min_join");
    assert_eq!(c.pending_of(acct("pat.testnet")).0, owed);
    conserved(&c, &[]);
}

#[test]
fn dust_too_small_for_a_record_goes_to_the_vault() {
    let mut c = new_dish();
    let vault = c.state().vault.0;
    assert_eq!(wnear_in(&mut c, T0, NEAR / 1_000, r#"{"for":"pat.testnet","do":"buy"}"#, 20, "intents.testnet").0, 0, "kept");
    assert_eq!(c.pending_of(acct("pat.testnet")).0, 0, "no record it could not pay for");
    let Entry::Dust { near, .. } = last_entry(&c) else { panic!("a dust entry") };
    assert_eq!(c.state().vault.0, vault + near.0);
    assert!(near.0 > 0 && near.0 < NEAR / 1_000, "less the dust entry's own storage");
    conserved(&c, &[]);
}

#[test]
fn other_tokens_are_refunded_and_forged_calls_do_nothing() {
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
    let s = c.state();
    assert_eq!((s.wrapped.0, s.pending.0, s.colonies), (0, 0, 0));
    assert!(c.colony_of(acct("pat.testnet")).is_none());
}

#[test]
fn an_unusable_order_waits_as_pending_near_and_is_claimed() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Taken", 1, NEAR / 50);
    let vault = c.state().vault.0;
    // Unreadable, no order, an account that is not valid, the dish itself: pending for whoever the order names, or
    // else the sender, with no order to run.
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, "not json", true, "intents.testnet"), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"bo.testnet"}"#, true, "intents.testnet"), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"NOT VALID","do":"join","name":"X"}"#, true, "intents.testnet"), "pending");
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 50, r#"{"for":"petri.testnet","do":"buy"}"#, true, "intents.testnet"), "pending");
    let sender = c.pending_of(acct("intents.testnet")).0;
    let bo = c.pending_of(acct("bo.testnet")).0;
    assert!(c.pending_record(acct("bo.testnet")).unwrap().order.is_none());
    let s = c.state();
    assert_eq!(s.pending.0, sender + bo);
    assert_eq!((s.vault.0, s.wrapped.0), (vault, 0), "nothing reached the vault");
    assert_eq!(c.colonies(None, None).len(), 1, "nobody joined");
    // Claiming sends the NEAR (and its record's storage, less the claim's entry), only to the account itself.
    at("bo.testnet", T0);
    let got = c.claim_pending().0;
    assert!(got > bo - NEAR / 1_000 && got < NEAR / 50, "{} of {}", got, bo);
    assert_eq!(scheduled()[0], transfer("bo.testnet", got));
    assert_eq!(c.pending_of(acct("bo.testnet")).0, 0);
    at("bo.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.claim_pending())).is_err(), "nothing twice");
    // A claim that cannot be delivered is pending again, less its refund's records.
    let index = c.state().ledger.0 - 1;
    callback(T0, None);
    c.on_payout(U64(index), PAYOUT_PENDING, 0, acct("bo.testnet"), U128(got));
    assert!(c.pending_of(acct("bo.testnet")).0 > 0);
    conserved(&c, &["alice.testnet"]);
}

/// v5 left an order that ran short of gas as pending NEAR with nothing anyone could do but claim it.
#[test]
fn an_order_without_gas_waits_and_anyone_can_settle_it() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join"}"#, 20, "intents.testnet").0, 0, "kept");
    assert!(scheduled().is_empty(), "nothing scheduled that could run out of gas");
    assert!(c.colony_of(acct("pat.testnet")).is_none());
    assert_eq!(c.state().wrapped.0, NEAR / 10, "still wNEAR, and counted as held");
    // The keeper (or anyone) completes the order.
    ctx_gas("keeper.testnet", T0, 0, 100);
    assert_eq!(c.settle_pending(acct("pat.testnet")), "join");
    let col = c.colony_of(acct("pat.testnet")).unwrap();
    assert!(col.proxy && col.name.starts_with("Culture "));
    assert_eq!(c.pending_of(acct("pat.testnet")).0, 0);
    // And a settled order is gone.
    at("keeper.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_pending(acct("pat.testnet")))).is_err());
    // The wNEAR is unwrapped later.
    at("keeper.testnet", T0);
    let _ = c.unwrap_wnear();
    callback(T0, Some(vec![]));
    c.on_wnear_unwrapped(U128(NEAR / 10));
    assert_eq!(c.state().wrapped.0, 0);
    conserved(&c, &["pat.testnet"]);
}

#[test]
fn a_settle_spends_only_the_orders_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("alice.testnet", T0);
    c.set_payout(Some(acct("gone.testnet")));
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    // A failed sale leaves Alice pending NEAR that no order may spend.
    at("alice.testnet", T0 + 8 * GEN_MS);
    let paid = c.sell(U128(100 * P)).0;
    let index = c.state().ledger.0 - 1;
    callback(T0 + 8 * GEN_MS, None);
    c.on_payout(U64(index), PAYOUT_SALE, 1, acct("alice.testnet"), U128(paid));
    let refund = c.pending_of(acct("alice.testnet")).0;
    // Then wNEAR arrives for a purchase, with too little gas; anyone settles it, and only it.
    wnear_in(&mut c, T0 + 8 * GEN_MS, NEAR / 20, r#"{"for":"alice.testnet","do":"buy"}"#, 20, "intents.testnet");
    at("mallory.testnet", T0 + 8 * GEN_MS);
    assert_eq!(c.settle_pending(acct("alice.testnet")), "buy");
    assert_eq!(c.pending_of(acct("alice.testnet")).0, refund, "the refund is still hers to claim");
    at("mallory.testnet", T0 + 8 * GEN_MS);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_pending(acct("alice.testnet")))).is_err(), "and no order spends it");
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn the_dish_tells_1click_the_least_a_payment_needs() {
    let mut c = new_dish();
    let min = c.intent_minimum("join".into(), acct("pat.testnet")).0;
    assert!(min > c.rules().min_join.0 && min < c.rules().min_join.0 + NEAR / 200, "{}", min);
    // Exactly that much joins.
    assert_eq!(pay_wnear(&mut c, T0, min, r#"{"for":"pat.testnet","do":"join"}"#, true, "intents.testnet"), "join");
    // And a purchase for a colony.
    let buy = c.intent_minimum("buy".into(), acct("pat.testnet")).0;
    assert_eq!(pay_wnear(&mut c, T0, buy, r#"{"for":"pat.testnet","do":"buy"}"#, true, "intents.testnet"), "buy");
    conserved(&c, &["pat.testnet"]);
}

#[test]
fn a_payment_for_the_house_waits_for_the_house() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 20, r#"{"for":"house.testnet","do":"join"}"#, 20, "intents.testnet").0, 0);
    at("keeper.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_pending(acct("house.testnet")))).is_err());
    assert!(c.colony_of(acct("house.testnet")).is_none(), "nobody starts a colony for the house");
    assert!(c.pending_of(acct("house.testnet")).0 > 0);
}

#[test]
#[should_panic(expected = "only the dish itself")]
fn nobody_else_can_call_the_unwrap_callback() {
    let mut c = new_dish();
    ctx("mallory.testnet", T0, 0);
    c.on_unwrapped(acct("mallory.testnet"), Some(Order { join: true, name: Some("Free".into()), color: None }), U128(NEAR));
}

#[test]
#[should_panic(expected = "only the dish itself")]
fn nobody_else_can_settle_an_order_from_the_callback() {
    let mut c = new_dish();
    ctx("mallory.testnet", T0, 0);
    c.settle_intent(acct("mallory.testnet"));
}

#[test]
fn a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped() {
    let mut c = new_dish();
    assert_eq!(pay_wnear(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, false, "intents.testnet"), "pending");
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
    // While it is under way nobody can unwrap it twice.
    at("keeper.testnet", T0);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.unwrap_wnear())).is_err());
    assert_eq!(c.state().unwrapping.0, NEAR / 10);
    callback(T0, Some(vec![]));
    c.on_wnear_unwrapped(U128(NEAR / 10));
    assert_eq!(c.state().wrapped.0, 0);
    assert_eq!(c.pending_of(acct("pat.testnet")).0, owed, "and pat can claim it");
    conserved(&c, &[]);
}

#[test]
fn an_order_claimed_before_it_settles_is_not_spent_twice() {
    let mut c = new_dish();
    assert_eq!(wnear_in(&mut c, T0, NEAR / 10, r#"{"for":"pat.testnet","do":"join"}"#, 300, "intents.testnet").0, 0);
    callback(T0, Some(vec![]));
    c.on_unwrapped(acct("pat.testnet"), Some(Order { join: true, name: None, color: None }), U128(NEAR / 10));
    // Pat claims the NEAR in the block between.
    at("pat.testnet", T0);
    assert!(c.claim_pending().0 > NEAR / 10 - NEAR / 200);
    callback(T0, None);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.settle_intent(acct("pat.testnet")))).is_err(), "nothing left to settle");
    assert!(c.colony_of(acct("pat.testnet")).is_none());
    conserved(&c, &[]);
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
fn a_failed_bounty_goes_back_to_the_vault() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    at("stranger.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let Entry::Tide { bounty, .. } = last_tide(&c) else { unreachable!() };
    let index = all_ledger(&c).iter().rposition(|e| matches!(e, Entry::Tide { .. })).unwrap() as u64;
    let vault = c.state().vault.0;
    callback(T0 + 8 * GEN_MS, None);
    c.on_payout(U64(index), PAYOUT_BOUNTY, 0, acct("stranger.testnet"), bounty);
    let Entry::Refund { storage, .. } = last_entry(&c) else { panic!() };
    assert_eq!(c.state().vault.0, vault + bounty.0 - storage.0);
    conserved(&c, &["alice.testnet"]);
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

// ---------- relaunching a v5 dish ----------

/// The trie as it stands (the unit runtime keeps it across contexts, but restarts `storage_usage` with each one).
fn trie() -> HashMap<Vec<u8>, Vec<u8>> {
    let t = near_sdk::mock::with_mocked_blockchain(|b| b.take_storage());
    // Put it back under a plain context.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS).account_balance(NearToken::from_near(1_000));
    env::set_blockchain_interface(near_sdk::MockedBlockchain::new(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), vec![], t.clone(), Default::default(), None));
    t
}

/// What NEAR charges storage for: every key and value, and 40 bytes a record.
fn trie_usage() -> u64 {
    trie().iter().map(|(k, v)| (k.len() + v.len() + 40) as u64).sum()
}

/// Both dishes are hours old, so v6 starts them again from generation zero. A real v5 dish (the frozen v5 code, run
/// through joins, plantings with notes, a tide, a slide that changed hands, a guest, a registered keeper, credit for an
/// account that never joined and pending wNEAR) is relaunched, and leaves exactly what a fresh v6 launch leaves: the
/// same keys, the same bytes, the same storage.
#[test]
fn relaunch_leaves_nothing_of_v5() {
    // A fresh v6 dish, as the deploy's `new` leaves it.
    at("deployer.testnet", T0);
    let fresh = Petri::new(rules());
    env::state_write(&fresh);
    drop(fresh);
    let want = trie();
    // Wipe the trie and run v5.
    for k in want.keys() {
        env::storage_remove(k);
    }
    assert_eq!(trie_usage(), 0);
    use petri_contract_v5 as v5;
    let v5_rules: v5::Rules = near_sdk::serde_json::from_value(near_sdk::serde_json::to_value(rules()).unwrap()).unwrap();
    at("deployer.testnet", T0);
    let mut old = v5::Petri::new(v5_rules);
    for (who, name, near) in [("alice.testnet", "Alice", NEAR / 5), ("house.testnet", "House", NEAR / 20)] {
        ctx(who, T0, near);
        old.join(name.into(), 1, None);
    }
    for (who, xy, shape, note) in [("alice.testnet", (2, 2), patterns::BEEHIVE, Some("hello")), ("house.testnet", (20, 20), patterns::BLOCK, None)] {
        let d = old.plant_deposit(shape.len() as u32, note.map(|n: &str| n.len() as u32)).0;
        ctx(who, T0, d);
        old.plant(cells(xy.0, xy.1, shape), note.map(String::from), None);
    }
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-1.relayer.testnet"));
    ctx("g-1.relayer.testnet", T0, 0);
    old.join("Guest".into(), 2, Some(U128(NEAR / 50)));
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-2.relayer.testnet"));
    ctx("keeper.testnet", T0, NEAR / 100);
    old.storage_deposit(None, None);
    let d = old.slide_deposit(6, 5, Some(2)).0;
    ctx("alice.testnet", T0, d);
    old.mint_slide(1, 1, 6, 5, Some("Hi".into()), None);
    ctx("alice.testnet", T0, 1);
    old.nft_transfer(acct("collector.testnet"), "1".into(), None, None);
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).prepaid_gas(Gas::from_tgas(20));
    testing_env!(b.build());
    let _ = old.ft_on_transfer(acct("intents.testnet"), U128(NEAR / 10), r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#.into());
    at("keeper.testnet", T0 + 8 * GEN_MS);
    old.advance(None);
    env::state_write(&old);
    drop(old);
    let v5_usage = trie_usage();
    assert!(v5_usage > 4_000, "v5 stored {} bytes", v5_usage);
    // Relaunch, as the deploy's batch calls it, with the accounts that held something without a colony.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS).account_balance(NearToken::from_near(1_000)).storage_usage(v5_usage);
    testing_env!(b.build());
    let fresh = Petri::relaunch(rules(), vec![acct("g-2.relayer.testnet"), acct("keeper.testnet"), acct("pat.testnet")]);
    env::state_write(&fresh);
    let usage = env::storage_usage();
    assert!(get_logs().iter().any(|l| l.contains("pending NEAR to pat.testnet")), "v5's pending NEAR is reported");
    drop(fresh);
    let got = trie();
    let mut stale: Vec<String> = got.keys().filter(|k| !want.contains_key(*k)).map(|k| String::from_utf8_lossy(k).to_string()).collect();
    stale.sort();
    assert!(stale.is_empty(), "v5 keys left behind: {:?}", stale);
    assert_eq!(got, want, "exactly a fresh launch's state");
    assert_eq!(usage, want.iter().map(|(k, v)| (k.len() + v.len() + 40) as u64).sum::<u64>(), "storage_usage back to a fresh init's");
}
