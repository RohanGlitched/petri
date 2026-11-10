use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use petri_core::{feed, fits_slide, patterns, tide_due, tide_split, STAKE_UNIT};
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

/// Two beehives side by side, five cells apart: a still life of 12 cells, the smallest licence the launch rules allow.
fn two_beehives() -> Vec<(i32, i32)> {
    patterns::BEEHIVE.iter().copied().chain(patterns::BEEHIVE.iter().map(|&(x, y)| (x + 5, y))).collect()
}

/// Five cells that live five generations and are gone at the sixth: a guest's credit planting that has died by the
/// time it brings its own NEAR (v6.5: a colony with living cells it grew on credit cannot attach).
const FADE: &[(i32, i32)] = &[(0, 0), (0, 1), (1, 1), (2, 1), (2, 3)];

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

/// The replay's count of kept PETRI: what a colony earned while it had never attached NEAR is kept, counted when the
/// ledger next touches the colony (the contract counts it when the colony claims, or first attaches).
fn sync(kept: &mut [u128], synced: &mut [u128], earned: &[u128], attached: &[bool], i: usize) {
    if !attached[i] {
        kept[i] += earned[i] - synced[i];
    }
    synced[i] = earned[i];
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
    assert_eq!(bal(c, "petri.testnet"), s.agar.0 + s.unclaimed.0 + s.keeper_pot.0 + s.pact_escrow.0);
    let ids: Vec<u16> = (1..=s.colonies).collect();
    let books: Vec<Books> = c.read_books(&ids).into_iter().map(|(b, _)| b).collect();
    assert_eq!(books.iter().map(|b| b.earned as u128).sum::<u128>(), s.unclaimed.0, "the unclaimed counter matches the books");
    assert_eq!(s.agar.0, MAX - s.sold.0 - s.fed.0 + s.returned.0 + s.bought_back.0, "agar = launch - sold - fed + returned + bought back");
    let (mut out, mut back, mut credit_out, mut as_credit_out, mut bounties, mut bounty_refunds) = (0u128, 0u128, 0u128, 0u128, 0u128, 0u128);
    let (mut slide_burns, mut slides, mut royalties) = (0u128, 0u64, 0u128);
    let (mut given, mut reclaimed, mut spent, mut tides_paid, mut claimed, mut pending_in, mut pending_out) = (0u128, 0u128, 0u128, 0u128, 0u128, 0u128, 0u128);
    let (mut plant_burns, mut other_burns) = (0u128, 0u128);
    // PETRI held for pact offers not yet accepted, and the pacts' states.
    let (mut escrow, mut offers) = (0u128, Vec::<(u128, bool, bool)>::new());
    // A Tide entry keeps only what a replay cannot work out; what each tide paid is in its `tide` event, which the
    // replay test checks against the ledger alone.
    let tide_out: HashMap<u64, TideOut> = TIDE_LOG.with(|t| t.borrow().iter().cloned().collect());
    for (i, e) in all_ledger(c).into_iter().enumerate() {
        match e {
            Entry::Tide { bytes, .. } => {
                let t = tide_out[&(i as u64)];
                assert!(t.storage.0 <= bytes as u128 * byte());
                out += t.bounty.0 + t.storage.0 + t.paid.0 + t.as_credit.0;
                credit_out += t.credit_paid.0;
                as_credit_out += t.as_credit.0;
                bounties += t.bounty.0;
                tides_paid += t.paid.0;
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
                slide_burns += cost.0 as u128;
                spent += s.map(|s| s.0).unwrap_or(0);
            }
            Entry::Buy { spent: s, .. } => spent += s.map(|s| s.0).unwrap_or(0),
            Entry::Plant { cost, spent: s, licence, .. } => {
                spent += s.map(|s| s.0).unwrap_or(0);
                plant_burns += cost.0 as u128 * r.burn_bps as u128 / 10_000;
                // Royalties paid to holders; a guest's goes to the agar.
                royalties += licence.filter(|l| !l.to_agar).map(|l| l.royalty.0 as u128).unwrap_or(0);
            }
            Entry::Sponsor { amount, .. } => given += amount.0,
            Entry::Unsponsor { amount, .. } => reclaimed += amount.0,
            Entry::Claim { near, paid, .. } => {
                assert!(paid.0 <= near.0);
                claimed += near.0;
            }
            Entry::Pending { near, .. } => pending_in += near.0,
            Entry::Unpend { near, .. } => pending_out += near.0,
            Entry::Burn { petri, .. } => other_burns += petri.0 as u128,
            Entry::PactOffer { pact, petri, spent: s, .. } => {
                spent += s.map(|s| s.0).unwrap_or(0);
                assert_eq!(pact as usize, offers.len() + 1, "pacts are numbered in order");
                escrow += petri.0 as u128;
                offers.push((petri.0 as u128, false, false));
            }
            Entry::PactAccept { pact, .. } => {
                let o = &mut offers[pact as usize - 1];
                assert!(!o.1 && !o.2, "only an open offer is accepted");
                escrow -= o.0;
                o.1 = true;
            }
            Entry::PactEnd { pact, .. } => {
                let o = &mut offers[pact as usize - 1];
                assert!(!o.2, "a pact ends once");
                if !o.1 {
                    escrow -= o.0;
                }
                o.2 = true;
            }
            Entry::Join { .. } | Entry::Skip { .. } | Entry::Dust { .. } => {}
        }
    }
    assert_eq!((escrow, offers.len() as u64), (s.pact_escrow.0, s.pacts.0), "the PETRI held for pact offers, from the ledger");
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

/// What the last tide paid (its `tide` event).
fn last_paid() -> TideOut {
    TIDE_LOG.with(|t| t.borrow().last().expect("a tide ran").1)
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
    assert_eq!(p.cost.0 as u128, price);
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
    let storage = TIDE_LOG.with(|t| t.borrow()[0].1.storage.0);
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
    // A sale claims the seller's earnings first.
    let held = bal(&c, "alice.testnet") + c.claimable(acct("alice.testnet")).petri.0;
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
    // One `tide` event per tide (five here), the same size however many colonies are paid.
    let (tides, other): (Vec<&String>, Vec<&String>) = logs.iter().partition(|l| l.contains("\"event\":\"tide\""));
    let bytes: usize = other.iter().map(|l| l.len()).sum();
    assert_eq!(tides.len(), 5);
    assert!(tides.iter().all(|l| l.len() < 500), "a tide event is short");
    assert!(other.len() <= 3, "catch-up logs a summary, not one line per colony: {}", other.len());
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
    plant(&mut c, "bob.testnet", t, cells(18, 18, &two_beehives()), None);
    join(&mut c, "house.testnet", t, "House", 3, NEAR / 20);
    // A guest on sponsored credit alone: its vault shares and its sale are paid as credit.
    let g4 = "g-4.relayer.testnet";
    guest(&mut c, g4, t, "Guest", 4);
    plant_on_credit(&mut c, g4, t, cells(26, 4, patterns::BLOCK));
    // A guest that never plants (v6.5: only a guest without living cells may bring its own NEAR).
    let g5 = "g-5.relayer.testnet";
    guest(&mut c, g5, t, "Guest 5", 6);
    // A wallet colony that will hold Bob's slide.
    let w = "w.testnet";
    join(&mut c, w, t, "Wallet", 5, NEAR / 5);
    plant(&mut c, w, t, cells(10, 24, patterns::BLOCK), None);
    for g in 0..41u64 {
        t += GEN_MS;
        if g == 2 {
            // Alice pays the wallet colony for its promise to keep 8 cells from her colony until generation 20; Bob
            // offers Alice a pact she declines; Bob's offer to the wallet colony is never answered.
            let d = PACT_DEPOSIT;
            ctx("alice.testnet", t, d);
            assert_eq!(c.pact_offer(acct(w), U128(10 * P), U64(20), None), 1);
            ctx("bob.testnet", t, d);
            c.pact_offer(acct("alice.testnet"), U128(5 * P), U64(30), None);
            at("alice.testnet", t);
            c.pact_cancel(2);
            at(w, t);
            c.pact_accept(1);
            // Bob pays this one's storage from credit a friend sponsored.
            ctx("friend.testnet", t, NEAR / 50);
            c.sponsor(acct("bob.testnet"));
            at("bob.testnet", t);
            c.pact_offer(acct(w), U128(3 * P), U64(40), Some(U128(PACT_DEPOSIT)));
        }
        if g == 10 {
            // The wallet colony may not plant near Alice now: the dish refuses it.
            let d = c.plant_deposit(4, None, None).0;
            ctx(w, t, d);
            let broke = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.plant(cells(8, 8, patterns::BLOCK), None, None, None);
            }));
            assert!(broke.is_err(), "a planting that breaks pact 1 is refused");
        }
        if g == 11 {
            // Far enough from Alice's cells, it may.
            plant(&mut c, w, t, cells(2, 17, patterns::BLOCK), None);
        }
        if g == 22 {
            // Pact 1 is over; anyone may end it.
            at("keeper.testnet", t);
            c.pact_cancel(1);
        }
        if g == 34 {
            // v6.5: the guest's credit-grown cells live, so it cannot bring its own NEAR, and the refusal writes nothing.
            assert_eq!(
                refused(&mut c, |c| {
                    ctx(g4, t, NEAR / 50);
                    c.buy(None);
                }),
                GREW_ON_CREDIT
            );
            // The guest without cells attaches NEAR for the first time: what it bought with credit before is kept
            // PETRI. It can sell none of it, but it plants with it.
            ctx(g5, t, NEAR / 50);
            c.buy(None);
            let kept = kept_petri(&c, g5).0;
            assert!(kept > 0);
            at(g5, t);
            assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.sell(U128(P));
            }))
            .is_err());
            plant(&mut c, g5, t, cells(29, 14, patterns::BLOCK), None);
            assert!(kept_petri(&c, g5).0 < kept, "kept PETRI is spent first");
        }
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
            // A slide of Bob's two beehives (12 cells, a licence); Alice plants it under the licence and pays Bob the
            // royalty.
            let d = c.slide_deposit(11, 5, None).0;
            ctx("bob.testnet", t, d);
            c.mint_slide(17, 17, 11, 5, None, None);
            plant_slide(&mut c, "alice.testnet", t, cells(4, 12, &two_beehives()), "2");
        }
        if g == 28 {
            // Bob passes the slide on; its new holder plants it free.
            ctx("bob.testnet", t, 1);
            c.nft_transfer(acct(w), "2".into(), None, None);
            plant_slide(&mut c, w, t, cells(20, 10, &two_beehives()), "2");
        }
        if g == 29 {
            // The guest plants it on credit: it never attached NEAR, so its royalty goes to the agar, not the holder.
            let d = c.plant_deposit(12, None, Some("2".into())).0;
            ctx(g4, t, 0);
            let held = bal(&c, w);
            c.plant(cells(14, 0, &two_beehives()), None, Some(U128(d)), Some("2".into()));
            let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!("the guest's licensed planting") };
            assert!(l.to_agar && l.royalty.0 > 0 && l.holder == Some(acct(w)));
            assert_eq!(bal(&c, w), held, "the holder is paid nothing by a guest");
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
        if g == 31 {
            // The bounty of the tide at generation 32 fails to arrive and goes back to the vault.
            let index = all_ledger(&c).iter().rposition(|e| matches!(e, Entry::Tide { .. })).unwrap() as u64;
            let Entry::Tide { by, generation, .. } = last_tide(&c) else { unreachable!() };
            assert_eq!(generation.0, 32);
            let runner = if by == 0 { acct("keeper.testnet") } else { c.colonies(Some(by as u32 - 1), Some(1))[0].account.clone() };
            let bounty = last_paid().bounty;
            assert!(bounty.0 > 0);
            callback(t, None);
            c.on_payout(U64(index), PAYOUT_BOUNTY, by, runner, bounty);
        }
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
    // Each colony's kept PETRI as the ledger gives it, and its earnings when last counted (a guest's count as kept).
    let (mut kept, mut synced) = (vec![0u128; n], vec![0u128; n]);
    // Every pact: (from, to, petri, until, accepted, ended).
    let mut pacts: Vec<(u16, u16, u128, u64, bool, bool)> = vec![];
    let mut escrow = 0u128;
    let mut breaches_checked = 0;
    let mut house: Vec<u16> = vec![];
    let colonies_view = c.colonies(None, None);
    let account_of = |id: u16| colonies_view[id as usize - 1].account.clone();
    let mut colonies = 0u16;
    let log = all_ledger(&c);
    let (mut tides_seen, mut credit_sales, mut slides_seen, mut guest_bounties, mut licensed, mut refunds, mut guest_royalties) = (0, 0, 0, 0, 0, 0, 0);
    let mut tide_bounty: HashMap<u64, u128> = HashMap::new();
    // The solvency terms, recomputed.
    let (mut given, mut spent, mut reclaimed, mut owed, mut pending) = (0u128, 0u128, 0u128, 0u128, 0u128);
    // Each slide's pattern, and its holder as last seen: (bitmap, w, h, moves, holder, cells).
    let mut slides: Vec<(Vec<u8>, u16, u16, u32, AccountId, u32)> = vec![];
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
                | Entry::Burn { generation, .. }
                | Entry::PactOffer { generation, .. }
                | Entry::PactAccept { generation, .. }
                | Entry::PactEnd { generation, .. } => generation.0,
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
                    assert_eq!(petri_for_near(near.0 + credit.0, agar, k), petri.0 as u128, "purchase on the curve");
                    let i = *colony as usize;
                    sync(&mut kept, &mut synced, &earned, &attached, i);
                    kept[i] += credit_share(petri.0, credit.0, near.0 + credit.0) as u128;
                    agar -= petri.0 as u128;
                    vault += near.0;
                    pool += credit.0;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    // Only min_join of NEAR in one call attaches a colony; the first time, its stake goes (v6.3).
                    if near.0 >= r.min_join.0 && !attached[i] && !house.contains(colony) {
                        planted[i] = 0;
                        window[i] = 0;
                    }
                    attached[*colony as usize] |= near.0 >= r.min_join.0;
                }
                Entry::Plant { colony, cells, cost, near, credit, siege, spent: s, licence, .. } => {
                    let cost = cost.0 as u128;
                    let cells: Vec<u32> = cells.iter().map(|&c| c as u32).collect();
                    let check = dish.check_plant(*colony, &cells, r.buffer, r.max_plant_cells, &house).expect("a legal planting");
                    // No planting breaks a pact that binds its colony.
                    let bound: Vec<u16> = pacts.iter().filter(|p| p.1 == *colony && p.4 && !p.5 && g < p.3).map(|p| p.0).collect();
                    assert_eq!(dish.pact_breach(&cells, &bound, r.pact_radius), None, "colony {} broke a pact", colony);
                    breaches_checked += bound.len();
                    // Kept PETRI is spent first, the royalty included; a royalty to a guest holder is kept.
                    let i = *colony as usize;
                    sync(&mut kept, &mut synced, &earned, &attached, i);
                    let toll = licence.as_ref().map(|l| l.royalty.0 as u128).unwrap_or(0);
                    let kept_before = kept[i];
                    kept[i] = kept[i].saturating_sub(cost + toll);
                    if let Some(h) = licence.as_ref().filter(|l| !l.to_agar).and_then(|l| l.holder.clone()) {
                        if let Some(hc) = colonies_view.iter().find(|v| v.account == h) {
                            if !attached[hc.id as usize] {
                                kept[hc.id as usize] += toll;
                            }
                        }
                    }
                    assert_eq!(check.siege, *siege);
                    let per = feed_per_cell(agar, r.feed_ppm, r.keeper_bps, counted, r.live_floor);
                    let base = planting_cost(per, r.payback, r.min_cell_price.0, cells.len() as u32, *siege, r.siege_x);
                    match licence {
                        None => assert_eq!(base, cost, "price at generation {}", g),
                        Some(l) => {
                            let (bitmap, w, h, moves, holder, cells_in) = &mut slides[l.token.0 as usize - 1];
                            assert!(*cells_in >= r.licence_min_cells, "only a slide of licence_min_cells is a licence");
                            assert!(fits_slide(32, 32, &cells, bitmap, *w, *h), "the slide's own pattern");
                            assert_eq!(licensed_cost(base, r.slide_discount_bps), cost, "the licence's price");
                            let who = l.holder.clone().unwrap_or_else(|| account_of(*colony));
                            // The holder is the minter until the slide first moves, and one account between two moves.
                            assert!(l.moves >= *moves);
                            if l.moves == *moves {
                                assert_eq!(&who, holder, "the slide's holder at that point");
                            }
                            (*moves, *holder) = (l.moves, who);
                            assert_eq!(l.royalty.0 as u128, if l.holder.is_some() { royalty(cost, r.slide_royalty_bps) } else { 0 });
                            assert!(l.holder.as_ref() != Some(&account_of(*colony)), "a holder pays itself no royalty");
                            // A planter that never attached NEAR, or holds kept PETRI beyond the cost, pays its royalty to
                            // the agar.
                            assert_eq!(l.to_agar, l.holder.is_some() && (!attached[*colony as usize] || kept_before > cost));
                            if l.to_agar {
                                agar += l.royalty.0 as u128;
                                guest_royalties += 1;
                            }
                            licensed += 1;
                        }
                    }
                    agar += cost - cost * r.burn_bps as u128 / 10_000;
                    burned += cost * r.burn_bps as u128 / 10_000;
                    // v6.3: a planting's first NEAR clears the guest stake; an attached colony stakes only what its
                    // kept PETRI (spent first) did not pay.
                    if near.0 >= r.min_join.0 && !attached[i] && !house.contains(colony) {
                        planted[i] = 0;
                        window[i] = 0;
                    }
                    attached[i] |= near.0 >= r.min_join.0;
                    planted[i] += petri_core::planting_stake(cells.len() as u32, attached[i] && !house.contains(colony), cost, kept_before);
                    vault += near.0;
                    pool += credit.0;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    dish.plant_unchecked(*colony, &cells);
                }
                Entry::Sell { colony, petri, near, as_credit, .. } => {
                    let i = *colony as usize;
                    sync(&mut kept, &mut synced, &earned, &attached, i);
                    if *as_credit {
                        kept[i] = kept[i].saturating_sub(petri.0 as u128);
                    } else {
                        assert_eq!(kept[i], 0, "a colony holding kept PETRI sold for NEAR");
                    }
                    let outstanding = MAX - burned - agar;
                    assert_eq!(petri_core::sell_back(petri.0 as u128, agar, k, r.sell_bps, vault, outstanding), near.0, "sale on the curve");
                    assert_eq!(*as_credit, !attached[*colony as usize], "a colony that never attached NEAR is paid in credit");
                    credit_sales += *as_credit as u32;
                    agar += petri.0 as u128;
                    vault -= near.0;
                }
                Entry::Tide { .. } => panic!("a tide is recorded while stepping"),
                Entry::Slide { colony, x, y, w, h, cells, bitmap, cost, spent: s, .. } => {
                    let i = *colony as usize;
                    sync(&mut kept, &mut synced, &earned, &attached, i);
                    kept[i] = kept[i].saturating_sub(cost.0 as u128);
                    let (bits, n) = dish.region_bitmap(*colony, *x, *y, *w, *h);
                    assert_eq!((&bits, n), (&bitmap.0, *cells), "the slide is the colony's own cells, as the dish stood");
                    assert!(n >= r.slide_min_cells);
                    assert_eq!(cost.0 as u128, r.slide_cells_price.0 * n as u128);
                    burned += cost.0 as u128;
                    spent += s.map(|s| s.0).unwrap_or(0);
                    slides.push((bits, *w, *h, 0, account_of(*colony), n));
                    slides_seen += 1;
                }
                Entry::Skip { .. } => {}
                Entry::Refund { kind, of, near, storage, .. } => {
                    // Tied to the payout it refunds, and for exactly what that payout sent.
                    let sent = match &log[of.0 as usize] {
                        Entry::Claim { paid, .. } if *kind == PAYOUT_CLAIM => paid.0,
                        Entry::Sell { paid, as_credit: false, .. } if *kind == PAYOUT_SALE => paid.0,
                        Entry::Tide { .. } if *kind == PAYOUT_BOUNTY => tide_bounty[&of.0],
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
                    assert_eq!(kept[*colony as usize], 0, "a colony holding kept PETRI claimed NEAR");
                    owed -= near.0;
                    assert!(near.0 <= won[*colony as usize]);
                }
                Entry::Pending { near, .. } => pending += near.0,
                Entry::Unpend { near, .. } => pending -= near.0,
                Entry::Dust { near, .. } => vault += near.0,
                Entry::Burn { petri, .. } => burned += petri.0 as u128,
                Entry::PactOffer { pact, from, to, petri, until, spent: s, .. } => {
                    spent += s.map(|s| s.0).unwrap_or(0);
                    assert_eq!(*pact as usize, pacts.len() + 1);
                    assert!(from != to && until.0 > g && until.0 <= g + r.pact_max_gens as u64);
                    // Accepted pacts and offers made count towards a colony's MAX_PACTS; offers waiting for it, MAX_OFFERS_IN.
                    let bound = |c: u16| pacts.iter().filter(|p| !p.5 && (p.0 == c || (p.1 == c && p.4))).count();
                    let waiting = |c: u16| pacts.iter().filter(|p| !p.5 && p.1 == c && !p.4).count();
                    assert!(bound(*from) < MAX_PACTS && waiting(*to) < MAX_OFFERS_IN, "pact caps");
                    assert!(petri.0 as u128 >= MIN_PACT_PETRI || (house.contains(from) && house.contains(to)), "a pact carries 1 PETRI");
                    assert!(!pacts.iter().any(|p| p.0 == *from && p.1 == *to && !p.4 && !p.5), "one open offer to a colony at a time");
                    if petri.0 > 0 {
                        // Only PETRI its maker could sell (never a guest's, never kept), or the house's to the house.
                        sync(&mut kept, &mut synced, &earned, &attached, *from as usize);
                        assert!(house.contains(from) || (attached[*from as usize] && kept[*from as usize] == 0));
                        assert!(!house.contains(from) || house.contains(to));
                    }
                    escrow += petri.0 as u128;
                    pacts.push((*from, *to, petri.0 as u128, until.0, false, false));
                }
                Entry::PactAccept { pact, .. } => {
                    let to = pacts[*pact as usize - 1].1;
                    assert!(pacts.iter().filter(|p| !p.5 && (p.0 == to || (p.1 == to && p.4))).count() < MAX_PACTS, "pact caps");
                    let p = &mut pacts[*pact as usize - 1];
                    assert!(!p.4 && !p.5 && g < p.3, "only an open, unexpired offer is accepted");
                    escrow -= p.2;
                    p.4 = true;
                }
                Entry::PactEnd { pact, .. } => {
                    let p = &mut pacts[*pact as usize - 1];
                    assert!(!p.5 && (!p.4 || g >= p.3), "an accepted pact ends only at its until");
                    if !p.4 {
                        escrow -= p.2;
                    }
                    p.5 = true;
                }
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
            // Everything a tide paid follows from the ledger before it: the entry keeps the chain, its bytes and its
            // runner, and the replay works out the rest (checked against the `tide` event's amounts).
            let Entry::Tide { generation, chain: ch, bytes, by } = &log[li] else { panic!("tide entry at {}", g) };
            assert_eq!(generation.0, g);
            assert_eq!(*ch, hex::encode(chain));
            assert!(*bytes >= 126 && *bytes <= 126 + 4 + 45, "a tide stores its entry and four bytes of index: {}", bytes);
            let pay = vault * r.tide_bps as u128 / 10_000;
            let capped = (pay * r.tide_bounty_bps as u128 / 10_000).min(r.max_bounty.0);
            let cost = *bytes as u128 * byte();
            let storage0 = cost.min(pay - capped);
            let (split, total) = tide_split(pay - capped - storage0, &window, &house);
            let storage = if total > 0 { storage0 } else { cost.min(vault) };
            let house_runner = *by == HOUSE_RUNNER || house.contains(by);
            let bounty = if total > 0 && !house_runner { capped } else { 0 };
            let (mut credited, mut paid) = (0u128, 0u128);
            for (i, v) in split {
                // NEAR only to a colony that attached NEAR and holds no kept PETRI.
                if attached[i as usize] && kept[i as usize] == 0 {
                    won[i as usize] += v;
                    owed += v;
                    paid += v;
                } else {
                    credit_won[i as usize] += v;
                    credited += v;
                }
            }
            vault -= paid + credited + bounty + storage;
            let credit_pay = pool * r.tide_bps as u128 / 10_000;
            let (csplit, ctotal) = tide_split(credit_pay, &window, &house);
            for (i, v) in csplit {
                credit_won[i as usize] += v;
            }
            pool -= ctotal;
            let event = TIDE_LOG.with(|t| t.borrow().iter().find(|(i, _)| *i == li as u64).map(|(_, o)| *o)).expect("the tide's event");
            assert_eq!(event, TideOut { pay: U128(pay), bounty: U128(bounty), storage: U128(storage), paid: U128(paid), as_credit: U128(credited), credit_pay: U128(credit_pay), credit_paid: U128(ctotal) }, "the tide's amounts, from the ledger alone, are its event's");
            tide_bounty.insert(li as u64, bounty);
            // A guest that ran the tide was paid its bounty as credit.
            if *by > 0 && *by != HOUSE_RUNNER && (!attached[*by as usize] || kept[*by as usize] > 0) && bounty > 0 {
                credit_won[*by as usize] += bounty;
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
    // Every colony's kept PETRI, from the ledger alone, is what the contract holds back; and the PETRI held for offers.
    for i in 1..n {
        sync(&mut kept, &mut synced, &earned, &attached, i);
        assert_eq!(colonies_view[i - 1].kept.0 as u128, kept[i], "colony {}'s kept PETRI", i);
    }
    assert!(kept[4] > 0 && kept[5] > 0, "the guest, and the guest that attached, still hold kept PETRI");
    assert_eq!((escrow, pacts.len() as u64), (s.pact_escrow.0, s.pacts.0));
    assert_eq!(pacts.iter().map(|p| (p.4, p.5)).collect::<Vec<_>>(), vec![(true, true), (false, true), (false, false)]);
    assert!(breaches_checked >= 1, "a planting under a pact was checked");
    assert_eq!(credit_sales, 1, "the guest's sale");
    assert_eq!(slides_seen, 2, "alice's slide and bob's");
    assert_eq!(licensed, 3, "alice's royalty to bob, the new holder's own planting and the guest's");
    assert_eq!(guest_royalties, 1, "the guest's royalty, to the agar");
    assert_eq!(refunds, 3, "a claim, a sale and a bounty failed");
    assert_eq!(guest_bounties, 1, "the tide the guest ran");
    assert_eq!(li, log.len(), "every entry replayed");
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    assert_eq!((agar, burned, vault, pool), (s.agar.0, s.burned.0, s.vault.0, s.credit_pool.0));
    assert_eq!((given, spent, reclaimed, owed, pending), (s.credit_given.0, s.credit_spent.0, s.credit_reclaimed.0, s.tides_owed.0, s.pending.0), "every solvency term from the ledger alone");
    // Slides end with the holders the replay last saw, unless they moved since.
    for (i, (_, _, _, moves, holder, _)) in slides.iter().enumerate() {
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
    // The guest attached NEAR at generation 35 but still holds kept PETRI, so the tide at 40 paid it credit too.
    assert_eq!(won[4], 0, "no NEAR while it holds kept PETRI");
    assert!(credit_won[4] > colonies_view[0].credit_won.0, "but credit in its place");
    conserved(&c, &["alice.testnet", "bob.testnet", "house.testnet", g4, g5, w, "keeper.testnet"]);
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
    ctx("alice.testnet", T0, NEAR / 1_000);
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
    let TideOut { paid, as_credit, credit_paid, .. } = last_paid();
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
        let Entry::Tide { by, .. } = last_tide(&c) else { unreachable!() };
        let TideOut { pay, bounty, storage, paid, as_credit, .. } = last_paid();
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
            attached: id % 2 == 0,
            kept: U64(0),
        });
        c.colony_of.insert(account.clone(), id);
        c.names.insert(format!("c{}", id));
        c.balances.insert(account, 0);
        books::cold_push(id);
    }
    c.flush();
}

/// Gas the real network charges per byte a write replaces (storage_write_value_byte 31.02 + storage_write_evicted_byte
/// 32.12 + the memory and register copies 7.6 Mgas), and per wasm instruction (regular_op_cost 822,756). The unit
/// runtime charges host calls but not wasm, and less per byte.
const REAL_WRITE_BYTE: f64 = 70.7e6;
const REAL_OP: f64 = 822_756.0;
/// A function call's fixed cost on the real network that the unit runtime does not charge: the transaction, its
/// receipt and loading the contract (the simulator's calibration against testnet).
const REAL_CALL: f64 = 2.5e12;

/// What the unit runtime charges per byte a write replaces, measured: the multiplier from it to the real network.
fn unit_write_byte() -> f64 {
    at("deployer.testnet", T0);
    let big = vec![7u8; 100_000];
    env::storage_write(b"calibrate", &big);
    let g0 = env::used_gas().as_gas();
    env::storage_write(b"calibrate", &big);
    let g1 = env::used_gas().as_gas();
    env::storage_write(b"calibrate", &[1]);
    let g2 = env::used_gas().as_gas();
    env::storage_write(b"calibrate", &[1]);
    let g3 = env::used_gas().as_gas();
    env::storage_remove(b"calibrate");
    ((g1 - g0) as f64 - (g3 - g2) as f64) / 99_999.0
}

/// One call's gas on the real network, conservatively: its host calls as the unit runtime charged them, scaled by the
/// real price of a rewritten byte over the unit runtime's (no byte costs more than that much more; base costs are the
/// same), less the payouts' fixed allowance (the same on both), plus the call's fixed cost and an estimate of its wasm:
/// Life and the feed for `gens` generations of `live` cells in `alive` colonies (20,000 + 60 a cell + 150 a colony
/// instructions, the simulator's model), `rows` hot rows parsed and written back (1,000 each, + 460 at a tide), and
/// 3 million instructions for everything else (argument parsing, the contract state, the board, borsh).
#[allow(clippy::too_many_arguments)]
fn real_gas(unit: u64, payouts: u64, scale: f64, gens: u64, live: u64, alive: u64, rows: u64, tide: bool) -> f64 {
    // Only payouts the call made: none if it scheduled no transfer.
    let payouts = if scheduled().iter().any(|r| r.1 == "transfer") { payouts.min(unit) } else { 0 };
    let host = (unit - payouts) as f64 * scale + payouts as f64;
    let ops = gens as f64 * (20_000.0 + 60.0 * live as f64 + 150.0 * alive as f64) + rows as f64 * (1_000.0 + if tide { 460.0 } else { 0.0 }) + 3e6;
    host + REAL_CALL + ops * REAL_OP
}

/// A dish of 30,000 colonies that all played in the last day (each has stake in its cold slot), on a full 128 x 128
/// board: 1,000 colonies alive with a block each, and `playing` hot rows in all (the living colonies, and others that
/// earned since the last tide and will be paid at it; half of them wallets). A new colony joins and plants; the
/// catch-up runs through a tide that pays every playing colony; a playing wallet colony, the newcomer and an idle
/// colony claim. Returns (call, unit-runtime gas, real-network estimate) for each, and the multiplier used.
fn thirty_thousand(playing: usize) -> (Vec<(&'static str, u64, f64)>, f64) {
    let scale = (REAL_WRITE_BYTE / unit_write_byte()).max(1.0);
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
    // Every colony played in the last day: stake in its cold slot.
    for first in (1..=30_000u16).step_by(320) {
        at("deployer.testnet", T0);
        let chunk: Vec<(u16, Cold)> = (first..(first + 320).min(30_001)).map(|id| (id, Cold { books: books::cold_get(id).books, stake: 4_000, stake_tide: 0 })).collect();
        books::cold_set_many(&chunk);
    }
    // 1,000 living blocks, 4 cells apart, owned by colonies 2..=1001.
    let mut dish = Dish::new(128, 128);
    for k in 0..1_000u32 {
        let (x, y) = ((k % 32) as i32 * 4, (k / 32) as i32 * 4);
        let cs: Vec<u32> = patterns::BLOCK.iter().map(|&(dx, dy)| dish.index(x + dx, y + dy) as u32).collect();
        dish.plant_unchecked(k as u16 + 2, &cs);
    }
    c.store_dish(&dish);
    c.total_live = 4_000;
    {
        let hot = c.hot_table();
        let mut ids: Vec<u16> = (2..=1_001u16).collect();
        let more = playing.saturating_sub(1_000);
        let step = (28_999 / more.max(1)).max(1);
        ids.extend((1_002..=30_000u16).step_by(step).take(more));
        for id in ids {
            hot.rows.push(Hot { id, stake: 4_000, window: 1_000, books: Books { attached: id % 2 == 0, ..Default::default() } });
        }
        hot.dirty = true;
        hot.purse_dirty = true;
    }
    c.flush();
    let rows = c.state().playing as u64;
    assert_eq!((c.state().colonies, rows), (30_000, playing.max(1_000) as u64));
    let block = |x: i32, y: i32| -> Vec<u32> { patterns::BLOCK.iter().map(|&(dx, dy)| ((y + dy) * 128 + x + dx) as u32).collect() };
    // What a NEAR payout's transfer and callback cost in the unit runtime: the same on the real network.
    ctx_gas("funder.testnet", T0, 0, 300);
    c.pay_out(&acct("funder.testnet"), PAYOUT_BOUNTY, 0, 0, &acct("funder.testnet"), 1);
    let payout = env::used_gas().as_gas();
    let mut report = vec![];
    // The 30,001st colony joins: one cold page, however many came before.
    ctx_gas("newcomer.testnet", T0, NEAR / 2, 300);
    fresh(&mut c);
    c.join("Newcomer".into(), 7, None);
    let g = env::used_gas().as_gas();
    report.push(("join", g, real_gas(g, 0, scale, 0, 0, 0, 0, false)));
    let d = c.plant_deposit(4, None, None).0;
    ctx_gas("newcomer.testnet", T0, d, 300);
    fresh(&mut c);
    c.plant(block(126, 126), None, None, None);
    let g = env::used_gas().as_gas();
    report.push(("plant", g, real_gas(g, 0, scale, 0, 4_004, 1_001, rows + 1, false)));
    // The catch-up through the tide: eight generations, then every playing colony paid.
    ctx_gas("keeper.testnet", T0 + 8 * GEN_MS, 0, 300);
    fresh(&mut c);
    c.advance(None);
    let g = env::used_gas().as_gas();
    report.push(("advance through a tide", g, real_gas(g, payout, scale, 8, 4_004, 1_001, rows + 1, true)));
    assert_eq!((c.state().generation.0, c.state().tides.0), (8, 1));
    let TideOut { paid, as_credit, .. } = last_paid();
    assert!(paid.0 > 0 && as_credit.0 > 0);
    let left = c.state().playing as u64;
    // A playing wallet colony and the newcomer claim; an idle colony's claim reads one cold page.
    ctx_gas("c2.testnet", T0 + 8 * GEN_MS, 0, 300);
    fresh(&mut c);
    c.claim();
    let g = env::used_gas().as_gas();
    report.push(("claim (a playing colony)", g, real_gas(g, payout, scale, 0, 0, 0, left, false)));
    ctx_gas("newcomer.testnet", T0 + 8 * GEN_MS, 0, 300);
    fresh(&mut c);
    c.claim();
    let g = env::used_gas().as_gas();
    report.push(("claim (the newcomer)", g, real_gas(g, payout, scale, 0, 0, 0, left, false)));
    ctx_gas("c29999.testnet", T0 + 8 * GEN_MS, 0, 300);
    fresh(&mut c);
    c.claim();
    let g = env::used_gas().as_gas();
    report.push(("claim (an idle colony)", g, real_gas(g, 0, scale, 0, 0, 0, left, false)));
    for (what, g, real) in &report {
        eprintln!("30,000 colonies, {} playing: {} {:.2} TGas of host calls in the unit runtime, {:.1} TGas on the real network (x{:.2} a byte)", rows, what, *g as f64 / 1e12, real / 1e12, scale);
    }
    // Every winner was paid: the wallets in NEAR, the others as credit.
    assert!(c.tide_winnings(Some(1), Some(1))[0].0 > 0, "a wallet won NEAR");
    assert!(c.colonies(Some(2), Some(1))[0].credit_won.0 > 0, "a guest won credit");
    (report, scale)
}

/// v5 rewrote seven arrays covering every colony on each join; v6 kept a hot row for every colony with stake, which
/// lingers about a day, so on an active 30,000-colony dish a planting cost over 230 TGas on the real network (the
/// simulator, sim/out-v6). v6.1 keeps rows only for colonies alive or paid at the coming tide. Here 30,000 colonies
/// that all have stake, 1,500 of them playing (the simulator's busiest 30,000-colony dish had 2,409): every call stays
/// under 150 TGas on the real network, with the unit runtime's host calls scaled to the real price per byte and the
/// wasm the unit runtime does not charge estimated.
#[test]
fn thirty_thousand_colonies_with_stake_every_call_under_150_tgas_on_the_real_network() {
    let (report, scale) = thirty_thousand(1_500);
    assert!(scale >= 1.5, "the unit runtime charges {:.1}x less per byte than the network", scale);
    for (what, _, real) in &report {
        assert!(*real < 150e12, "{}: {:.1} TGas", what, real / 1e12);
    }
    assert!(report[0].2 < 10e12, "a join stays small");
}

/// The worst case: the hot table full (`MAX_PLAYING` colonies alive or paid at the coming tide, on a dish of 30,000
/// that all have stake). Every call still stays under 150 TGas on the real network.
#[test]
fn a_full_hot_table_keeps_every_call_under_150_tgas_on_the_real_network() {
    let (report, _) = thirty_thousand(MAX_PLAYING - 1);
    for (what, _, real) in &report {
        assert!(*real < 150e12, "{}: {:.1} TGas", what, real / 1e12);
    }
}

/// The catch-up reserves only what the rest of the call will write: the feed part of the hot table, the purse part
/// only when a tide can run (or a purse already changed), and the idle rows' pages. With the table full and no tide
/// ahead, a 300 TGas call keeps over 80 TGas to step generations in; with a tide ahead, over 50.
#[test]
fn the_catch_up_reserves_only_what_the_rest_of_the_call_needs() {
    let full_no_tide = catchup_limit(MAX_PLAYING, false, Gas::from_tgas(300));
    let full_tide = catchup_limit(MAX_PLAYING, true, Gas::from_tgas(300));
    let small = catchup_limit(100, true, Gas::from_tgas(300));
    assert!(full_no_tide > Gas::from_tgas(80) && full_tide > Gas::from_tgas(40), "{} / {}", full_no_tide, full_tide);
    assert!(full_tide < full_no_tide && small > Gas::from_tgas(95));
    // A generation on a full board is about 0.3 TGas of wasm: 120 of them fit even with a tide ahead.
    assert!(full_tide.as_gas() as f64 > 120.0 * (20_000.0 + 60.0 * 4_000.0 + 150.0 * 1_000.0) * REAL_OP);
    assert!(tide_between(7, 8, 8) && !tide_between(8, 15, 8) && tide_between(15, 17, 8));
    // A call with too little prepaid gas keeps its reserve.
    assert_eq!(catchup_limit(100, false, Gas::from_tgas(30)), Gas::from_gas(0));
}

// The simulator found that a tide writing every winner's colony and credit records needed about 0.26 TGas per
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
            let r = hot.enter(id, 0, 8_750);
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
    let TideOut { paid, as_credit, credit_paid, .. } = last_paid();
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
/// Alice's glider slide (5 cells). The launch rules license only slides of 12 cells or more, so these tests of the
/// licence's mechanics lower `licence_min_cells` to 5; `a_small_slide_is_a_keepsake_not_a_licence` checks the launched
/// rule.
fn glider_slide() -> Petri {
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { licence_min_cells: 5, ..rules() });
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
    assert_eq!((cost.0 as u128, l.token.0, l.moves, l.holder, l.royalty.0, l.to_agar), (full - full / 4, 1, 0, None, 0, false));
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
    assert_eq!((l.holder, l.royalty.0 as u128, l.to_agar), (Some(acct("alice.testnet")), toll, false));
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
    assert_eq!(bal(&c, "carol.testnet"), l.royalty.0 as u128, "the new holder is paid");
    assert_eq!(bal(&c, "alice.testnet"), alice, "the old one is not");
    assert!(c.storage_balance_of(acct("carol.testnet")).is_some());
    // Alice, no longer the holder, pays the royalty too.
    plant_slide(&mut c, "alice.testnet", T0 + GEN_MS, cells(10, 26, patterns::GLIDER), "1");
    let Entry::Plant { licence: Some(l2), .. } = last_entry(&c) else { panic!() };
    assert_eq!(l2.holder, Some(acct("carol.testnet")));
    assert_eq!(bal(&c, "carol.testnet"), (l.royalty.0 + l2.royalty.0) as u128);
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
    assert!(matches!(last_entry(&c), Entry::Burn { petri, .. } if petri.0 as u128 == 2 * P));
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
    assert!(matches!(last_entry(&c), Entry::Burn { petri, .. } if petri.0 as u128 == 5 * P));
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
    ctx("alice.testnet", T0, NEAR / 1_000);
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
    ctx("alice.testnet", T0, NEAR / 1_000);
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
    // v6.5: min_join for the vault, the join's own storage and the payment's records.
    let records = (entry_bytes(&Entry::Pending { generation: U64(0), account: acct("pat.testnet"), near: U128(0) }) + entry_bytes(&Entry::Unpend { generation: U64(0), account: acct("pat.testnet"), near: U128(0), paid: U128(0) })) * byte();
    assert_eq!(min, c.rules().min_join.0 + intents::join_bytes(&acct("pat.testnet")) * byte() + records);
    assert!(min > c.rules().min_join.0 + 500 * byte() && min < c.rules().min_join.0 + NEAR / 100, "{}", min);
    // Exactly that much joins, and the join attaches the colony.
    assert_eq!(pay_wnear(&mut c, T0, min, r#"{"for":"pat.testnet","do":"join"}"#, true, "intents.testnet"), "join");
    assert!(c.colony_of(acct("pat.testnet")).unwrap().attached, "a join from the minimum is not left a guest");
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
    let Entry::Tide { by, .. } = last_tide(&c) else { unreachable!() };
    let bounty = last_paid().bounty;
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
        let Entry::Tide { by, .. } = last_tide(&c) else { unreachable!() };
        let bounty = last_paid().bounty;
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
    let bounty = last_paid().bounty;
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

// ---------- relaunching a v6 dish ----------

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

/// v6.4 starts both dishes again from generation zero. A real v6.3 dish (the frozen
/// v6.3 code, run through joins, plantings with notes, a licensed planting with a royalty that registers its holder,
/// tides, a slide that changed hands, a guest, a registered keeper, credit for an account that never joined, a sale,
/// pending wNEAR, an accepted pact and an open offer, so it has cold pages, a hot table, pacts, pact lists, the tide
/// index and every map) is relaunched, and leaves exactly what a fresh v6.4 launch leaves: the same keys, the same
/// bytes, the same storage.
#[test]
fn relaunch_leaves_nothing_of_v6_3() {
    // A fresh v6.4 dish, as the deploy's `new` leaves it.
    at("deployer.testnet", T0);
    let fresh = Petri::new(rules());
    env::state_write(&fresh);
    drop(fresh);
    let want = trie();
    // Wipe the trie and run v6.3.
    for k in want.keys() {
        env::storage_remove(k);
    }
    assert_eq!(trie_usage(), 0);
    use petri_contract_v6_3 as v63;
    let old_rules: v63::Rules = near_sdk::serde_json::from_value(near_sdk::serde_json::to_value(rules()).unwrap()).unwrap();
    at("deployer.testnet", T0);
    let mut old = v63::Petri::new(old_rules);
    for (who, name, near) in [("alice.testnet", "Alice", NEAR / 5), ("house.testnet", "House", NEAR / 20), ("bob.testnet", "Bob", NEAR / 5)] {
        ctx(who, T0, near);
        old.join(name.into(), 1, None);
    }
    let hives = two_beehives();
    for (who, xy, shape, note) in [("alice.testnet", (2, 2), &hives[..], Some("hello")), ("house.testnet", (20, 20), patterns::BLOCK, None), ("bob.testnet", (16, 12), patterns::BLOCK, Some("bob"))] {
        let d = old.plant_deposit(shape.len() as u32, note.map(|n: &str| n.len() as u32), None).0;
        ctx(who, T0, d);
        old.plant(cells(xy.0, xy.1, shape), note.map(String::from), None, None);
    }
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-1.relayer.testnet"));
    ctx("g-1.relayer.testnet", T0, 0);
    old.join("Guest".into(), 2, Some(U128(NEAR / 50)));
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-2.relayer.testnet"));
    ctx("keeper.testnet", T0, NEAR / 100);
    old.storage_deposit(None, None);
    let d = old.slide_deposit(11, 5, Some(2)).0;
    ctx("alice.testnet", T0, d);
    old.mint_slide(1, 1, 11, 5, Some("Hi".into()), None);
    ctx("alice.testnet", T0, 1);
    old.nft_transfer(acct("collector.testnet"), "1".into(), None, None);
    // Bob plants the slide's beehives under its licence: the royalty registers its new holder.
    at("keeper.testnet", T0 + GEN_MS);
    old.advance(None);
    let d = old.plant_deposit(12, None, Some("1".into())).0;
    ctx("bob.testnet", T0 + GEN_MS, d);
    old.plant(cells(2, 24, &hives), None, None, Some("1".into()));
    // An accepted pact (Bob stays away from Alice) and an open offer (Bob to Alice).
    ctx("alice.testnet", T0 + GEN_MS, v63::PACT_DEPOSIT);
    let p = old.pact_offer(acct("bob.testnet"), U128(P), U64(200), None);
    ctx("bob.testnet", T0 + GEN_MS, 0);
    old.pact_accept(p);
    ctx("bob.testnet", T0 + GEN_MS, v63::PACT_DEPOSIT);
    old.pact_offer(acct("alice.testnet"), U128(P), U64(200), None);
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).prepaid_gas(Gas::from_tgas(20));
    testing_env!(b.build());
    let _ = old.ft_on_transfer(acct("intents.testnet"), U128(NEAR / 10), r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#.into());
    for gen in [8u64, 16] {
        at("keeper.testnet", T0 + gen * GEN_MS);
        old.advance(None);
    }
    at("alice.testnet", T0 + 16 * GEN_MS);
    old.claim();
    old.sell(U128(200 * P));
    env::state_write(&old);
    drop(old);
    let old_usage = trie_usage();
    let has = |k: &[u8]| trie().contains_key(k);
    assert!(old_usage > 6_000 && has(&[b'w', 0, 0]) && !has(b"v") && has(b"h") && has(b"j") && has(&[b'P', 1, 0, 0, 0]) && has(&[b'Q', 1, 0]) && has(&[b'V', 0, 0, 0, 0]), "v6.3 stored {} bytes, its pages, hot table, pacts and tide index", old_usage);
    // Relaunch, as the deploy's batch calls it, with the accounts that held something without a colony or a slide.
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS).account_balance(NearToken::from_near(1_000)).storage_usage(old_usage);
    testing_env!(b.build());
    let fresh = Petri::relaunch(rules(), vec![acct("g-2.relayer.testnet"), acct("keeper.testnet"), acct("pat.testnet")]);
    env::state_write(&fresh);
    let usage = env::storage_usage();
    assert!(get_logs().iter().any(|l| l.contains("pending NEAR to pat.testnet")), "v6.3's pending NEAR is reported");
    drop(fresh);
    let got = trie();
    let mut stale: Vec<String> = got.keys().filter(|k| !want.contains_key(*k)).map(|k| String::from_utf8_lossy(k).to_string()).collect();
    stale.sort();
    assert!(stale.is_empty(), "v6.3 keys left behind: {:?}", stale);
    assert_eq!(got, want, "exactly a fresh launch's state");
    assert_eq!(usage, want.iter().map(|(k, v)| (k.len() + v.len() + 40) as u64).sum::<u64>(), "storage_usage back to a fresh init's");
}

/// Relaunch clears only a v6.3 dish: it refuses an account with no v6.3 colonies, and one that already runs v6.4 (its
/// version marker is there).
#[test]
#[should_panic(expected = "no v6.3 dish here")]
fn relaunch_refuses_an_account_without_a_v6_3_dish() {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS);
    testing_env!(b.build());
    Petri::relaunch(rules(), vec![]);
}

#[test]
#[should_panic(expected = "already runs v6.4")]
fn relaunch_refuses_a_dish_that_runs_v6_4() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS);
    testing_env!(b.build());
    Petri::relaunch(rules(), vec![]);
}

// ---------- v6.1: what the v6 simulator found ----------

/// The launch rules license only slides of at least 12 cells: a glider (5) can be minted as a keepsake but planting it
/// under its licence is refused, so nobody collects royalties on patterns everyone plants anyway. A 12-cell slide is a
/// licence.
#[test]
fn a_small_slide_is_a_keepsake_not_a_licence() {
    let mut c = new_dish();
    assert_eq!(c.rules().licence_min_cells, 12);
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::GLIDER), None);
    mint(&mut c, "alice.testnet", T0, (1, 1, 5, 5), None);
    plant(&mut c, "alice.testnet", T0 + GEN_MS, cells(12, 12, &two_beehives()), None);
    mint(&mut c, "alice.testnet", T0 + GEN_MS, (11, 11, 11, 5), None);
    join(&mut c, "bob.testnet", T0 + GEN_MS, "Bob", 2, NEAR / 5);
    let small = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| plant_slide(&mut c, "bob.testnet", T0 + 2 * GEN_MS, cells(20, 24, patterns::GLIDER), "1")));
    let msg = small.unwrap_err().downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("only a slide of at least 12 cells is a licence"), "{}", msg);
    plant_slide(&mut c, "bob.testnet", T0 + 2 * GEN_MS, cells(2, 24, &two_beehives()), "2");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!("a licensed planting") };
    assert!(l.royalty.0 > 0 && !l.to_agar && l.holder == Some(acct("alice.testnet")));
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

/// A planter that has never attached NEAR (a guest on sponsored credit) pays its royalty to the agar, not to the
/// slide's holder: free play hands no holder PETRI it could sell for vault NEAR.
#[test]
fn a_guest_pays_its_royalty_to_the_agar() {
    let mut c = glider_slide();
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    let (alice, agar) = (bal(&c, "alice.testnet"), c.state().agar.0);
    let full = c.quote(5, None, None).0;
    let cost = full - full / 4;
    let toll = cost / 10;
    let d = c.plant_deposit(5, None, Some("1".into())).0;
    ctx(g, T0, 0);
    let held = bal(&c, g);
    c.plant(cells(20, 20, patterns::GLIDER), None, Some(U128(d)), Some("1".into()));
    assert_eq!(held - bal(&c, g), cost + toll, "the guest pays the discounted price and the royalty");
    assert_eq!(bal(&c, "alice.testnet"), alice, "the holder is paid nothing");
    assert_eq!(c.state().agar.0, agar + (cost - cost / 2) + toll, "the royalty went back into the agar");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!() };
    assert_eq!((l.holder, l.royalty.0 as u128, l.to_agar), (Some(acct("alice.testnet")), toll, true));
    assert_eq!((c.slide_royalties("1".into()).0, c.state().royalties.0), (0, 0), "no royalty reached a holder");
    // Its glider lives on, so it cannot bring its own NEAR (v6.5).
    assert_eq!(
        refused(&mut c, |c| {
            ctx(g, T0 + GEN_MS, NEAR / 50);
            c.buy(None);
        }),
        GREW_ON_CREDIT
    );
    // A guest without living cells attaches NEAR; its royalty still goes to the agar while it holds kept PETRI (what it
    // bought with credit when it joined) beyond the cost.
    let g2 = "g-2.relayer.testnet";
    guest(&mut c, g2, T0 + GEN_MS, "Guest 2", 4);
    ctx(g2, T0 + GEN_MS, NEAR / 50);
    c.buy(None);
    assert!(c.colony_of(acct(g2)).unwrap().attached);
    plant_slide(&mut c, g2, T0 + 2 * GEN_MS, cells(2, 14, patterns::GLIDER), "1");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!() };
    assert!(l.to_agar && bal(&c, "alice.testnet") == alice);
    conserved(&c, &["alice.testnet", "bob.testnet", g, g2]);
}

/// The keeper pot goes to whoever's call runs a generation, whatever the call (here a planting and a sale), when the
/// caller is registered and is not one of the house's; the house and keepers never take it.
#[test]
fn any_call_that_runs_a_generation_takes_the_keeper_pot() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "house.testnet", T0, "House", 2, NEAR / 20);
    join(&mut c, "bob.testnet", T0, "Bob", 3, NEAR / 5);
    // The house's planting runs three generations: the pot waits.
    plant(&mut c, "house.testnet", T0 + 3 * GEN_MS, cells(20, 20, patterns::BLOCK), None);
    let pot = c.state().keeper_pot.0;
    assert!(pot > 0 && c.state().keeper_paid.0 == 0, "the house takes no pot");
    // Bob's planting runs the next two and takes it all.
    let before = bal(&c, "bob.testnet");
    plant(&mut c, "bob.testnet", T0 + 5 * GEN_MS, cells(12, 26, patterns::BLOCK), None);
    let s = c.state();
    let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
    assert_eq!(s.keeper_pot.0, 0);
    assert!(s.keeper_paid.0 > pot);
    assert_eq!(bal(&c, "bob.testnet"), before + s.keeper_paid.0 - cost.0 as u128, "bob was paid the pot and paid for his block");
    assert!(get_logs().iter().any(|l| l.contains("keeper pot")));
    // A sale that catches up keeps the pot it was paid (its balance is read after the catch-up).
    at("alice.testnet", T0 + 9 * GEN_MS);
    let held = bal(&c, "alice.testnet");
    let claimed0 = c.colony_of(acct("alice.testnet")).unwrap().petri_claimed.0;
    c.sell(U128(50 * P));
    let paid = c.state().keeper_paid.0 - s.keeper_paid.0;
    assert!(paid > 0);
    // The sale also claimed what Alice had earned, through its own catch-up too.
    let claimed = c.colony_of(acct("alice.testnet")).unwrap().petri_claimed.0 - claimed0;
    assert_eq!(c.claimable(acct("alice.testnet")).petri.0, 0, "the sale claimed every earning");
    assert_eq!(bal(&c, "alice.testnet"), held + paid + claimed - 50 * P, "the pot is kept, the sale taken");
    // A keeper never takes it.
    ctx("dish-keeper.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    at("dish-keeper.testnet", T0 + 12 * GEN_MS);
    c.advance(None);
    assert_eq!(bal(&c, "dish-keeper.testnet"), 0);
    conserved(&c, &["alice.testnet", "house.testnet", "bob.testnet", "dish-keeper.testnet"]);
}

/// A colony whose cells have all died leaves the hot table at the next catch-up after its last tide share, and its
/// stake goes to its cold slot with the tide count: read later, it is exactly what tide-by-tide decay leaves, and it
/// comes back with the colony when it plants again. The house never has a row.
#[test]
fn a_colony_without_living_cells_leaves_the_hot_table_and_keeps_its_stake() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 5);
    join(&mut c, "house.testnet", T0, "House", 3, NEAR / 20);
    // A lone pair of cells dies at the first generation.
    plant(&mut c, "alice.testnet", T0, cells(2, 2, &[(0, 0), (1, 0)]), None);
    plant(&mut c, "bob.testnet", T0, cells(20, 20, patterns::BLOCK), None);
    plant(&mut c, "house.testnet", T0, cells(10, 26, patterns::BLOCK), None);
    assert!(HotTable::load().get(3).is_none(), "the house has no hot row");
    assert_eq!(c.stakes(None, None)[2].0, 4 * STAKE_UNIT, "its stake is in its cold slot");
    assert_eq!(c.state().playing, 2);
    at("keeper.testnet", T0 + GEN_MS);
    c.advance(None);
    assert!(HotTable::load().get(1).is_none(), "alice's cells died and she earned nothing: her row left");
    assert_eq!(c.stakes(None, None)[0].0, 2 * STAKE_UNIT, "with her stake");
    // Three tides later her stake is what three decays leave.
    for k in 1..=3u64 {
        at("keeper.testnet", T0 + 8 * k * GEN_MS);
        c.advance(None);
    }
    assert_eq!(c.state().tides.0, 3);
    let three = (0..3).fold(2 * STAKE_UNIT, |s, _| petri_core::decay_stake(s, 8_750));
    assert_eq!(c.stakes(None, None)[0].0, three);
    assert_eq!(c.stakes(None, None)[2].0, (0..3).fold(4 * STAKE_UNIT, |s, _| petri_core::decay_stake(s, 8_750)), "the house's too");
    plant(&mut c, "alice.testnet", T0 + 24 * GEN_MS, cells(2, 2, patterns::BLOCK), None);
    assert_eq!(HotTable::load().get(1).unwrap().stake, three + 4 * STAKE_UNIT, "back in the table with its decayed stake");
    conserved(&c, &["alice.testnet", "bob.testnet", "house.testnet", "keeper.testnet"]);
}

/// A colony that still has living cells but whose stake has decayed below STAKE_UNIT / reach (125) earns nothing, so it
/// leaves the hot table even while it lives; the feed pays exactly what it would have (nothing), and every number
/// still adds up.
#[test]
fn a_colony_whose_stake_cannot_earn_leaves_the_hot_table_while_it_lives() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 2);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 2);
    let mut t = T0;
    let mut i = 0;
    while c.stakes(None, None)[0].0 >= 125 {
        t += 8 * GEN_MS;
        plant(&mut c, "bob.testnet", t, cells(1 + (i % 10) * 3, 12 + (i / 10) * 4, patterns::BLOCK), None);
        i += 1;
        assert!(i < 60, "the stake never fell below 125");
    }
    at("keeper.testnet", t + 8 * GEN_MS);
    c.advance(None);
    assert!(HotTable::load().get(1).is_none(), "alice's block lives on but cannot earn: no row");
    assert!(c.load_dish().cells.contains(&1), "her block is still alive");
    let earned = c.earnings(None, None)[0].0;
    at("keeper.testnet", t + 16 * GEN_MS);
    c.advance(None);
    assert_eq!(c.earnings(None, None)[0].0, earned, "and it earns nothing, row or not");
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

/// The hot table holds at most `MAX_PLAYING` rows. A colony without a row cannot plant while the table is full of rows
/// that cannot leave (all to be paid at the next tide); once rows can leave, its planting makes room first.
#[test]
fn a_full_hot_table_waits_for_the_tide_and_makes_room_when_rows_can_leave() {
    // Contexts on an account as large as this dish really is (the unit runtime starts every one at 300 KB).
    let big = |who: &str, deposit: u128| {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acct(who)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).attached_deposit(NearToken::from_yoctonear(deposit)).storage_usage(100_000_000);
        testing_env!(b.build());
    };
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { width: 128, height: 128, tide_every: 8, ..rules() });
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    crowd(&mut c, MAX_PLAYING as u32);
    {
        let hot = c.hot_table();
        for id in 2..=(MAX_PLAYING as u16 + 1) {
            hot.rows.push(Hot { id, stake: 4_000, window: 1_000, books: Books::default() });
        }
        hot.dirty = true;
        hot.purse_dirty = true;
    }
    big("deployer.testnet", 0);
    c.flush();
    c.hot = None;
    let block = |x: i32, y: i32| -> Vec<u32> { patterns::BLOCK.iter().map(|&(dx, dy)| ((y + dy) * 128 + x + dx) as u32).collect() };
    let d = c.plant_deposit(4, None, None).0;
    big("alice.testnet", d);
    let full = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.plant(block(60, 60), None, None, None)));
    let msg = full.unwrap_err().downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("the most the dish holds"), "{}", msg);
    // Rows with nothing to be paid and no living cell can leave: the planting moves some out and goes in.
    c.hot = None;
    big("deployer.testnet", 0);
    {
        let hot = c.hot_table();
        for r in hot.rows.iter_mut().take(5) {
            r.window = 0;
        }
        hot.dirty = true;
    }
    c.flush();
    c.hot = None;
    big("alice.testnet", d);
    c.plant(block(60, 60), None, None, None);
    let hot = HotTable::load();
    assert!(hot.get(1).is_some() && hot.rows.len() == MAX_PLAYING - 4, "five rows left, alice came in: {}", hot.rows.len());
}

/// What each ledger entry stores, before (v6) and now; the Tide entry most of all, since every tide pays for its own
/// from the vault.
#[test]
fn ledger_entries_are_as_small_as_the_replay_allows() {
    let a = || acct("g-0123456789.petri-guests.testnet");
    let entries = [
        ("Join", Entry::Join { generation: U64(1), colony: 1 }, 0),
        ("Buy (spent)", Entry::Buy { generation: U64(1), colony: 1, petri: U64(1), near: U128(1), credit: U128(1), spent: Some(U128(1)) }, 121),
        ("Plant, 4 cells, spent", Entry::Plant { generation: U64(1), colony: 1, cells: vec![0; 4], cost: U64(1), near: U128(1), credit: U128(1), siege: false, spent: Some(U128(1)), licence: None }, 135),
        ("Sell", Entry::Sell { generation: U64(1), colony: 1, petri: U64(1), near: U128(1), paid: U128(1), as_credit: false }, 105),
        ("Tide", Entry::Tide { generation: U64(1), chain: hex::encode([0u8; 32]), bytes: 130, by: 1 }, 236),
        ("Claim", Entry::Claim { generation: U64(1), colony: 1, petri: U64(1), near: U128(1), paid: U128(1) }, 104),
        ("Burn", Entry::Burn { generation: U64(1), account: a(), petri: U64(1) }, 0),
        ("Slide 4x4", Entry::Slide { generation: U64(1), colony: 1, token: U64(1), x: 0, y: 0, w: 4, h: 4, cells: 5, bitmap: Base64VecU8(vec![0; 2]), cost: U64(1), spent: None }, 99),
    ];
    for (name, e, v6) in entries {
        let now = entry_bytes(&e) as u64;
        eprintln!("{:<22} {:>4} bytes stored (v6: {})", name, now, if v6 > 0 { v6.to_string() } else { "-".into() });
        if v6 > 0 {
            assert!(now <= v6 - 8, "{} did not shrink: {} (v6 {})", name, now, v6);
        }
    }
    let licence = Licence { token: U64(1), moves: 0, holder: Some(acct("alice.testnet")), royalty: U64(1), to_agar: false };
    let with = Entry::Plant { generation: U64(1), colony: 1, cells: vec![0; 4], cost: U64(1), near: U128(1), credit: U128(1), siege: false, spent: None, licence: Some(licence) };
    let without = Entry::Plant { generation: U64(1), colony: 1, cells: vec![0; 4], cost: U64(1), near: U128(1), credit: U128(1), siege: false, spent: None, licence: None };
    assert_eq!(entry_bytes(&with) - entry_bytes(&without), 8 + 4 + 1 + 4 + 13 + 8 + 1, "the licence, as plant_deposit charges it");
    // A tide stores its entry and four bytes of the tide index: 130 bytes (289 in v6).
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    for k in 1..=3u64 {
        at("keeper.testnet", T0 + 8 * k * GEN_MS);
        let before = env::storage_usage();
        c.advance(None);
        let Entry::Tide { bytes, .. } = last_tide(&c) else { unreachable!() };
        assert_eq!(bytes as u64, env::storage_usage() - before, "the entry names the bytes it took");
        assert_eq!(bytes, if k == 1 { 126 + 4 + 45 } else { 126 + 4 }, "a new index page only every 256 tides");
        assert_eq!(last_paid().storage.0, bytes as u128 * byte());
    }
    assert_eq!(c.checkpoints(None, None).len(), 4, "generation zero and three tides");
    assert_eq!(c.checkpoints(Some(2), Some(5)).iter().map(|p| p.generation.0).collect::<Vec<_>>(), vec![16, 24]);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

// ---------- kept PETRI: free play never reaches NEAR ----------

/// The kept PETRI `who`'s colony view shows.
fn kept_petri(c: &Petri, who: &str) -> U64 {
    c.colony_of(acct(who)).map(|v| v.kept).unwrap_or(U64(0))
}

/// What `f` was refused with (it must panic).
fn refusal(f: impl FnOnce()) -> String {
    let e = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).expect_err("the call is refused");
    e.downcast_ref::<String>().cloned().or_else(|| e.downcast_ref::<&str>().map(|s| s.to_string())).unwrap_or_default()
}

/// A guest that farmed: it joined and planted on sponsored credit, and a tide later claimed what its cells earned
/// before they died (at generation 6, so it may bring its own NEAR afterwards).
fn farmed_guest(c: &mut Petri, g: &str, x: i32, y: i32) {
    guest(c, g, T0, &format!("Guest {} {}", x, y), 2 + x as u32);
    plant_on_credit(c, g, T0, cells(x, y, FADE));
    at(g, T0 + 8 * GEN_MS);
    c.claim();
}

#[test]
fn guest_cannot_transfer_free_petri() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    let held = bal(&c, g);
    assert!(held > 0);
    assert_eq!(kept_petri(&c, g).0 as u128, held, "everything a guest holds stays in the dish");
    // It cannot hand its PETRI to a wallet that would sell it, with or without a call.
    ctx(g, T0 + 8 * GEN_MS, 1);
    let why = refusal(|| c.ft_transfer(acct("alice.testnet"), U128(held), None));
    assert!(why.contains("free play's PETRI stays in the dish"), "{}", why);
    ctx_gas(g, T0 + 8 * GEN_MS, 1, 300);
    let why = refusal(|| {
        let _ = c.ft_transfer_call(acct("alice.testnet"), U128(1), None, "".into());
    });
    assert!(why.contains("never attached NEAR cannot send PETRI"), "{}", why);
    assert_eq!(bal(&c, g), held);
    // It still plants with it, and sells it back for credit.
    at(g, T0 + 8 * GEN_MS);
    assert!(c.sell(U128(30 * P)).0 > 0);
    assert!(matches!(last_entry(&c), Entry::Sell { as_credit: true, .. }));
    assert_eq!(kept_petri(&c, g).0 as u128, held - 30 * P);
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
fn guest_that_attaches_cannot_sell_what_it_farmed() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    let t = T0 + 9 * GEN_MS;
    at("keeper.testnet", t);
    c.advance(None);
    // What it farmed: its balance and what it has earned since its claim.
    let farmed = bal(&c, g) + c.claimable(acct(g)).petri.0;
    assert_eq!(kept_petri(&c, g).0 as u128, farmed);
    // It attaches 0.01 NEAR with a purchase: the PETRI that buys is its own to sell, what it farmed is not.
    ctx(g, t, NEAR / 50);
    let bought = c.buy(None).0;
    assert!(c.colony_of(acct(g)).unwrap().attached);
    assert_eq!(kept_petri(&c, g).0 as u128, farmed, "earned before its first NEAR, so kept");
    assert_eq!(bal(&c, g) + c.claimable(acct(g)).petri.0, farmed + bought);
    at(g, t);
    let why = refusal(|| {
        c.sell(U128(P));
    });
    assert!(why.contains("stays in the dish") && why.contains("kept PETRI"), "{}", why);
    ctx(g, t, 1);
    let why = refusal(|| c.ft_transfer(acct("alice.testnet"), U128(P), None));
    assert!(why.contains("kept PETRI"), "{}", why);
    assert_eq!(c.state().near_sold.0, 0, "no NEAR left the vault for farmed PETRI");
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

/// 64 empty cells in two rows: a planting large enough to spend a guest's kept PETRI at once.
fn band(y: i32) -> Vec<u32> {
    (0..32).flat_map(|x| [y as u32 * 32 + x, (y as u32 + 1) * 32 + x]).collect()
}

#[test]
fn attached_player_sells_what_it_earned_after() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    let t = T0 + 9 * GEN_MS;
    ctx(g, t, NEAR / 20);
    c.buy(None);
    let kept = kept_petri(&c, g).0;
    assert!(kept > 0);
    // A planting large enough spends every kept PETRI (it is spent first).
    plant(&mut c, g, t, band(10), None);
    let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
    assert!(cost.0 >= kept, "{} {}", cost.0, kept);
    assert_eq!(kept_petri(&c, g).0, 0);
    // What it earns from now on, and what it bought with NEAR, it sells for NEAR.
    let t = T0 + 17 * GEN_MS;
    at(g, t);
    let paid = c.sell(U128(50 * P)).0;
    assert!(paid > 0);
    assert!(matches!(last_entry(&c), Entry::Sell { as_credit: false, .. }));
    assert_eq!(c.state().near_sold.0, paid);
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
fn kept_petri_can_still_be_planted() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    let t = T0 + 9 * GEN_MS;
    ctx(g, t, NEAR / 50);
    c.buy(None);
    let kept = kept_petri(&c, g).0;
    // A planting spends kept PETRI first.
    plant(&mut c, g, t, cells(10, 10, patterns::BEEHIVE), None);
    let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
    assert_eq!(kept_petri(&c, g).0, kept - cost.0);
    // So does a slide.
    let token = mint(&mut c, g, t, (9, 9, 6, 5), None);
    let s = c.slide(token).unwrap();
    assert_eq!(kept_petri(&c, g).0, kept - cost.0 - s.cells as u64 * P as u64);
    assert!(kept_petri(&c, g).0 > 0, "some is left, so it still cannot sell");
    at(g, t);
    assert!(refusal(|| {
        c.sell(U128(P));
    })
    .contains("kept PETRI"));
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

/// Sybils: ten guests farm for free and each attaches 0.01 NEAR, then tries to sell what it farmed or send it to one
/// wallet that would sell it. None of it reaches the vault's NEAR, and the guests took no keeper pot.
#[test]
fn sybil_guests_that_attach_reach_no_vault_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let guests: Vec<String> = (0..10).map(|i| format!("g-{}.relayer.testnet", i)).collect();
    for (i, g) in guests.iter().enumerate() {
        guest(&mut c, g, T0, &format!("Guest {}", i), 2 + i as u32);
        plant_on_credit(&mut c, g, T0, cells((i as i32 % 5) * 6 + 1, 10 + (i as i32 / 5) * 8, FADE));
    }
    for g in &guests {
        at(g, T0 + 8 * GEN_MS);
        c.claim();
    }
    assert_eq!(c.state().keeper_paid.0, 0, "guests take no keeper pot");
    let t = T0 + 17 * GEN_MS;
    let mut farmed = 0u128;
    for g in &guests {
        ctx(g, t, NEAR / 50);
        c.buy(None);
        let kept = kept_petri(&c, g).0 as u128;
        farmed += kept;
        at(g, t);
        assert!(refusal(|| {
            c.sell(U128(kept));
        })
        .contains("kept PETRI"));
        ctx(g, t, 1);
        assert!(refusal(|| c.ft_transfer(acct("alice.testnet"), U128(kept), None)).contains("kept PETRI"));
    }
    assert!(farmed > 10 * P);
    let s = c.state();
    assert_eq!(s.near_sold.0, 0, "no vault NEAR paid for farmed PETRI");
    assert!(!all_ledger(&c).iter().any(|e| matches!(e, Entry::Sell { as_credit: false, .. })));
    // v6.3: attaching cleared each ex-guest's stake, so the cells it planted on credit stop earning.
    let id_of = |c: &Petri, g: &str| c.colony_of(acct(g)).unwrap().id;
    for g in &guests {
        let id = id_of(&c, g) as u32;
        assert_eq!(c.stakes(Some(id - 1), Some(1))[0].0, 0, "{} attached: its guest stake is gone", g);
    }
    // Each plants with kept PETRI (spent first, so it adds no stake), then two tides run.
    for (i, g) in guests.iter().enumerate() {
        let before = kept_petri(&c, g).0;
        plant(&mut c, g, t + GEN_MS, cells((i as i32 % 5) * 6 + 1, 26 + (i as i32 / 5) * 3, patterns::BLINKER), None);
        let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
        assert!(before >= cost.0, "paid entirely with kept PETRI");
        let id = id_of(&c, g) as u32;
        assert_eq!(c.stakes(Some(id - 1), Some(1))[0].0, 0, "kept PETRI buys no stake");
    }
    let held: Vec<u128> = guests.iter().map(|g| bal(&c, g) + c.claimable(acct(g)).petri.0).collect();
    let tides = all_ledger(&c).iter().filter(|e| matches!(e, Entry::Tide { .. })).count();
    for gen in [24u64, 32] {
        at("keeper.testnet", T0 + gen * GEN_MS);
        c.advance(None);
    }
    assert_eq!(all_ledger(&c).iter().filter(|e| matches!(e, Entry::Tide { .. })).count(), tides + 2, "two tides ran (Alice still earns)");
    for (g, h) in guests.iter().zip(held) {
        let col = c.colony_of(acct(g)).unwrap();
        let claim = c.claimable(acct(g));
        assert_eq!(claim.near.0, 0, "{} won no NEAR at the tides", g);
        assert_eq!(col.near_claimed.0 + col.near_sold.0, 0, "{} took no NEAR", g);
        assert_eq!(bal(&c, g) + claim.petri.0, h, "{}'s credit-paid cells earned nothing after it attached", g);
    }
    assert_eq!(c.state().near_sold.0, 0);
    let refs: Vec<&str> = guests.iter().map(|s| s.as_str()).chain(["alice.testnet", "keeper.testnet"]).collect();
    conserved(&c, &refs);
}

/// v6.3: an attached colony's planting stakes only the part of its cost paid with PETRI that is not kept.
#[test]
fn attached_planting_stakes_only_petri_that_is_not_kept() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    assert_eq!(c.stakes(None, None)[0].0, 4 * petri_core::STAKE_UNIT, "no kept PETRI: full stake");
    // Credit buys Alice some kept PETRI, less than her next planting costs.
    ctx("friend.testnet", T0, NEAR / 10);
    c.sponsor(acct("alice.testnet"));
    at("alice.testnet", T0 + GEN_MS);
    c.buy(Some(U128(NEAR / 200)));
    let kept = kept_petri(&c, "alice.testnet").0 as u128;
    assert!(kept > 0);
    let before = c.stakes(None, None)[0].0;
    let band = band(20);
    plant(&mut c, "alice.testnet", T0 + GEN_MS, band.clone(), None);
    let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
    let added = c.stakes(None, None)[0].0 - before;
    let full = band.len() as u64 * petri_core::STAKE_UNIT;
    assert!(cost.0 as u128 > kept, "the planting costs more than her kept PETRI ({} vs {})", cost.0, kept);
    assert_eq!(added, (full as u128 * (cost.0 as u128 - kept) / cost.0 as u128) as u64, "stake for the part not paid with kept PETRI");
    assert!(added > 0 && added < full, "{} of {}", added, full);
    assert_eq!(kept_petri(&c, "alice.testnet").0, 0);
    // A guest still stakes in full.
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0 + GEN_MS, "Guest", 3);
    plant_on_credit(&mut c, g, T0 + GEN_MS, cells(20, 2, patterns::BLOCK));
    assert_eq!(c.stakes(Some(1), Some(1))[0].0, 4 * petri_core::STAKE_UNIT);
    conserved(&c, &["alice.testnet", g, "friend.testnet"]);
}

/// v6.3: a guest whose planting brings its first NEAR stakes that planting as an attached colony, from zero.
#[test]
fn a_planting_that_attaches_clears_the_guest_stake() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    assert!(c.stakes(Some(1), Some(1))[0].0 > 0, "a guest's credit planting stakes");
    let kept = kept_petri(&c, g).0;
    // It plants with its kept PETRI and attaches min_join of NEAR in the same call.
    let cs = cells(10, 10, patterns::BEEHIVE);
    let d = c.plant_deposit(cs.len() as u32, None, None).0;
    ctx(g, T0 + 9 * GEN_MS, d + NEAR / 50);
    c.plant(cs, None, None, None);
    assert!(c.colony_of(acct(g)).unwrap().attached);
    let Entry::Plant { cost, .. } = last_entry(&c) else { panic!() };
    assert!(kept >= cost.0);
    assert_eq!(c.stakes(Some(1), Some(1))[0].0, 0, "its guest stake is gone and kept PETRI staked nothing");
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

/// Credit never turns into NEAR: PETRI bought with credit is kept, even by a colony that attached NEAR long before.
#[test]
fn petri_bought_with_credit_is_kept() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    assert_eq!(kept_petri(&c, "alice.testnet").0, 0);
    ctx("friend.testnet", T0, NEAR / 10);
    c.sponsor(acct("alice.testnet"));
    at("alice.testnet", T0);
    let units = c.buy(Some(U128(NEAR / 40))).0;
    assert_eq!(kept_petri(&c, "alice.testnet").0 as u128, units);
    // Half NEAR, half credit (its record paid from the credit first): about half of it is kept.
    ctx("alice.testnet", T0, NEAR / 40);
    let more = c.buy(Some(U128(NEAR / 40))).0;
    let kept = kept_petri(&c, "alice.testnet").0 as u128 - units;
    let Entry::Buy { near, credit, .. } = last_entry(&c) else { panic!() };
    assert_eq!(kept, credit_share(more as u64, credit.0, near.0 + credit.0) as u128);
    assert!(kept < more / 2 && kept > more / 3, "{} of {}", kept, more);
    conserved(&c, &["alice.testnet"]);
}

// ---------- pacts ----------

#[test]
fn pact_refuses_breaking_planting() {
    let mut c = two_colonies();
    // Alice pays Bob 10 PETRI to keep 8 cells from her colony until generation 100.
    let d = PACT_DEPOSIT;
    ctx("alice.testnet", T0, d);
    let id = c.pact_offer(acct("bob.testnet"), U128(10 * P), U64(100), None);
    assert!(matches!(last_entry(&c), Entry::PactOffer { pact: 1, from: 1, to: 2, .. }));
    let bob = bal(&c, "bob.testnet");
    at("bob.testnet", T0);
    c.pact_accept(id);
    let v = c.pact(id).unwrap();
    assert!(v.binding && v.accepted == Some(U64(0)));
    assert_eq!(bal(&c, "bob.testnet"), bob + 10 * P, "accepting pays");
    assert_eq!(c.pacts_of(acct("alice.testnet")).len(), 1);
    // Her beehive spans (2..5, 2..4): a block at (12, 2) is 7 cells from it, and the dish refuses it.
    let d = c.plant_deposit(4, None, None).0;
    ctx("bob.testnet", T0 + GEN_MS, d);
    let why = refusal(|| {
        c.plant(cells(12, 2, patterns::BLOCK), None, None, None);
    });
    assert!(why.contains("pact 1 with Alice") && why.contains("until generation 100"), "{}", why);
    // Elsewhere Bob plants as before, and Alice is bound by nothing.
    plant(&mut c, "bob.testnet", T0 + GEN_MS, cells(20, 20, patterns::BLOCK), None);
    plant(&mut c, "alice.testnet", T0 + GEN_MS, cells(10, 6, patterns::BLOCK), None);
    // Nobody can end an accepted pact early.
    at("alice.testnet", T0 + GEN_MS);
    assert!(refusal(|| {
        c.pact_cancel(1);
    })
    .contains("an accepted pact binds"));
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
fn pact_expires_and_planting_is_allowed() {
    let mut c = two_colonies();
    let d = PACT_DEPOSIT;
    ctx("alice.testnet", T0, d);
    c.pact_offer(acct("bob.testnet"), U128(P), U64(5), None);
    at("bob.testnet", T0);
    c.pact_accept(1);
    let d = c.plant_deposit(4, None, None).0;
    ctx("bob.testnet", T0 + 4 * GEN_MS, d);
    assert!(refusal(|| {
        c.plant(cells(12, 2, patterns::BLOCK), None, None, None);
    })
    .contains("pact 1"));
    // From generation 5 the pact binds no longer.
    plant(&mut c, "bob.testnet", T0 + 5 * GEN_MS, cells(12, 2, patterns::BLOCK), None);
    assert!(!c.pact(1).unwrap().binding);
    // Anyone may end it now; it leaves both colonies' lists.
    at("keeper.testnet", T0 + 5 * GEN_MS);
    c.pact_cancel(1);
    assert_eq!(c.pact(1).unwrap().ended, Some(U64(5)));
    assert!(c.pacts_of(acct("bob.testnet")).is_empty() && c.pacts_of(acct("alice.testnet")).is_empty());
    assert!(matches!(last_entry(&c), Entry::PactEnd { pact: 1, .. }));
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
fn unaccepted_offer_refunds() {
    let mut c = two_colonies();
    let d = PACT_DEPOSIT;
    let alice = bal(&c, "alice.testnet");
    ctx("alice.testnet", T0, d);
    c.pact_offer(acct("bob.testnet"), U128(10 * P), U64(50), None);
    assert_eq!(bal(&c, "alice.testnet"), alice - 10 * P);
    assert_eq!(c.state().pact_escrow.0, 10 * P);
    conserved(&c, &["alice.testnet", "bob.testnet"]);
    // One open offer to a colony at a time; a stranger cannot end it early.
    ctx("alice.testnet", T0, d);
    assert!(refusal(|| {
        c.pact_offer(acct("bob.testnet"), U128(P), U64(50), None);
    })
    .contains("still open"));
    at("mallory.testnet", T0);
    assert!(refusal(|| {
        c.pact_cancel(1);
    })
    .contains("only the two colonies"));
    // Withdrawn: the PETRI goes back.
    at("alice.testnet", T0);
    c.pact_cancel(1);
    assert_eq!((bal(&c, "alice.testnet"), c.state().pact_escrow.0), (alice, 0));
    // Declined by Bob: back too.
    ctx("alice.testnet", T0, d);
    c.pact_offer(acct("bob.testnet"), U128(4 * P), U64(50), None);
    at("bob.testnet", T0);
    c.pact_cancel(2);
    assert_eq!(bal(&c, "alice.testnet"), alice);
    // Expired: it can no longer be accepted, and anyone ends it and sends the PETRI back.
    ctx("alice.testnet", T0, d);
    c.pact_offer(acct("bob.testnet"), U128(3 * P), U64(3), None);
    // (Accepting and ending read the stored generation, so the dish is tended first.)
    at("keeper.testnet", T0 + 3 * GEN_MS);
    c.advance(None);
    at("bob.testnet", T0 + 3 * GEN_MS);
    assert!(refusal(|| {
        c.pact_accept(3);
    })
    .contains("no longer open"));
    at("mallory.testnet", T0 + 3 * GEN_MS);
    c.pact_cancel(3);
    assert_eq!(c.state().pact_escrow.0, 0);
    assert!(bal(&c, "alice.testnet") >= alice, "every offer came back (and the keeper pot may have come too)");
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet", "mallory.testnet"]);
}

#[test]
fn kept_petri_cannot_pay_a_pact() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    farmed_guest(&mut c, g, 20, 20);
    let t = T0 + 9 * GEN_MS;
    let d = PACT_DEPOSIT;
    // A guest's PETRI pays for no pact.
    ctx(g, t, d);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(P), U64(100), None);
    })
    .contains("never attached NEAR"));
    // Nor does kept PETRI, once it has attached NEAR.
    ctx(g, t, NEAR / 50);
    c.buy(None);
    ctx(g, t, d);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(P), U64(100), None);
    })
    .contains("kept PETRI"));
    // Nor can it offer a pact without PETRI: every pact carries at least 1 PETRI.
    at(g, t);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(0), U64(100), Some(U128(PACT_DEPOSIT)));
    })
    .contains("at least 1 PETRI"));
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

#[test]
fn house_pact_stays_in_house() {
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { house: vec![acct("house.testnet"), acct("house2.testnet")], ..rules() });
    join(&mut c, "house.testnet", T0, "House", 1, NEAR / 20);
    plant(&mut c, "house.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // The second house strain plays on sponsored credit, as the testnet strains do: the house is not held by kept PETRI,
    // since its PETRI cannot leave the house anyway.
    guest(&mut c, "house2.testnet", T0, "House Two", 2);
    assert!(!c.colony_of(acct("house2.testnet")).unwrap().attached);
    join(&mut c, "alice.testnet", T0, "Alice", 3, NEAR / 5);
    plant(&mut c, "alice.testnet", T0, cells(20, 2, patterns::BLOCK), None);
    let d = PACT_DEPOSIT;
    // The house pays no player PETRI for a pact.
    ctx("house.testnet", T0, d);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(P), U64(100), None);
    })
    .contains("the house's PETRI stays in the house"));
    // Nor a pact without PETRI: a pact carries at least 1 PETRI, so the house offers players none.
    ctx("house.testnet", T0, d);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(0), U64(100), None);
    })
    .contains("at least 1 PETRI"));
    // A player may pay the house; house strains pay each other.
    ctx("alice.testnet", T0, d);
    c.pact_offer(acct("house.testnet"), U128(2 * P), U64(100), None);
    let held = bal(&c, "house.testnet");
    at("house.testnet", T0);
    c.pact_accept(1);
    let p = c.plant_deposit(4, None, None).0;
    ctx("house.testnet", T0 + GEN_MS, p);
    assert!(refusal(|| {
        c.plant(cells(26, 2, patterns::BLOCK), None, None, None);
    })
    .contains("pact 1 with Alice"));
    assert_eq!(bal(&c, "house.testnet"), held + 2 * P);
    ctx("house.testnet", T0, d);
    c.pact_offer(acct("house2.testnet"), U128(P), U64(100), None);
    let held2 = bal(&c, "house2.testnet");
    at("house2.testnet", T0);
    c.pact_accept(2);
    assert_eq!(bal(&c, "house2.testnet"), held2 + P);
    at("house2.testnet", T0);
    c.pact_offer(acct("house.testnet"), U128(P), U64(100), Some(U128(PACT_DEPOSIT)));
    // But never to a player.
    at("house2.testnet", T0);
    assert!(refusal(|| {
        c.pact_offer(acct("alice.testnet"), U128(P), U64(100), Some(U128(PACT_DEPOSIT)));
    })
    .contains("the house's PETRI stays in the house"));
    conserved(&c, &["house.testnet", "house2.testnet", "alice.testnet"]);
}

#[test]
fn a_colony_is_party_to_at_most_eight_pacts() {
    let mut c = new_dish();
    join(&mut c, "bob.testnet", T0, "Bob", 1, NEAR);
    let d = PACT_DEPOSIT;
    for i in 0..MAX_PACTS {
        let who = format!("p{}.testnet", i);
        join(&mut c, &who, T0, &format!("P{}", i), 2 + i as u32, NEAR / 50);
        ctx("bob.testnet", T0, d);
        c.pact_offer(acct(&who), U128(P), U64(10), None);
    }
    join(&mut c, "late.testnet", T0, "Late", 99, NEAR / 50);
    ctx("bob.testnet", T0, d);
    assert!(refusal(|| {
        c.pact_offer(acct("late.testnet"), U128(P), U64(10), None);
    })
    .contains("party to 8 pacts"));
    // Once they expire they make room by themselves.
    ctx("bob.testnet", T0 + 10 * GEN_MS, d);
    c.pact_offer(acct("late.testnet"), U128(P), U64(20), None);
    assert_eq!(c.pacts_of(acct("bob.testnet")).len(), 1);
    let refs: Vec<String> = (0..MAX_PACTS).map(|i| format!("p{}.testnet", i)).collect();
    let refs: Vec<&str> = refs.iter().map(|s| s.as_str()).chain(["bob.testnet", "late.testnet"]).collect();
    conserved(&c, &refs);
}

/// The cost of pacts on a crowded dish: 30,000 colonies, 1,000 of them alive with a block each and 1,500 playing, and
/// a newcomer bound by `MAX_PACTS` pacts that plants 64 cells, so the scan looks at all 64 x 17 x 17 cells. The unit
/// runtime charges the host calls (reading the pacts); the scan's wasm is estimated at 50 instructions a cell.
#[test]
fn pacts_gas_at_scale() {
    let scale = (REAL_WRITE_BYTE / unit_write_byte()).max(1.0);
    let ctx_gas = |who: &str, ms: u64, deposit: u128, tgas: u64| {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acct(who)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(ms * MS).attached_deposit(NearToken::from_yoctonear(deposit)).prepaid_gas(Gas::from_tgas(tgas)).storage_usage(100_000_000);
        testing_env!(b.build());
    };
    at("deployer.testnet", T0);
    let mut c = Petri::new(Rules { tide_every: 8, house: vec![], ..launch() });
    join(&mut c, "funder.testnet", T0, "Funder", 1, 200 * NEAR);
    crowd(&mut c, 29_999);
    let mut dish = Dish::new(128, 128);
    for k in 0..1_000u32 {
        let (x, y) = ((k % 32) as i32 * 4, (k / 32) as i32 * 4);
        let cs: Vec<u32> = patterns::BLOCK.iter().map(|&(dx, dy)| dish.index(x + dx, y + dy) as u32).collect();
        dish.plant_unchecked(k as u16 + 2, &cs);
    }
    c.store_dish(&dish);
    c.total_live = 4_000;
    {
        let hot = c.hot_table();
        let ids: Vec<u16> = (2..=1_001u16).chain((1_002..=30_000u16).step_by(58).take(500)).collect();
        for id in ids {
            hot.rows.push(Hot { id, stake: 4_000, window: 1_000, books: Books { attached: id % 2 == 0, ..Default::default() } });
        }
        hot.dirty = true;
        hot.purse_dirty = true;
    }
    c.flush();
    let rows = c.state().playing as u64;
    for (who, name) in [("bound.testnet", "Bound"), ("free.testnet", "Free")] {
        ctx_gas(who, T0, NEAR / 2, 300);
        c.hot = None;
        c.join(name.into(), 7, None);
    }
    // Colonies 2..=9 (blocks on rows 0 and 1) each hold an accepted pact binding the first newcomer.
    let me = 30_001u16;
    at("deployer.testnet", T0);
    for (k, from) in (2..=9u16).enumerate() {
        pacts::write_pact(k as u32 + 1, &Pact { from, to: me, petri: U64(0), offered: U64(0), until: U64(1_000), accepted: Some(U64(0)), ended: None });
        pacts::write_list(from, &[k as u32 + 1]);
    }
    pacts::write_list(me, &(1..=MAX_PACTS as u32).collect::<Vec<_>>());
    c.pact_count = MAX_PACTS as u32;
    // 64 empty cells on two rows far from the blocks the pacts protect: legal, so the whole scan runs.
    let row = |y: u32| -> Vec<u32> { (0..32).flat_map(|i| [y * 128 + 4 * i + 2, (y + 4) * 128 + 4 * i + 2]).collect() };
    let mut report = vec![];
    for (who, y) in [("bound.testnet", 66u32), ("free.testnet", 82)] {
        let d = c.plant_deposit(64, None, None).0;
        ctx_gas(who, T0, d, 300);
        c.hot = None;
        c.plant(row(y), None, None, None);
        let g = env::used_gas().as_gas();
        let scan = if who == "bound.testnet" { 64.0 * 17.0 * 17.0 * 50.0 * REAL_OP } else { 0.0 };
        report.push((who, g, real_gas(g, 0, scale, 0, 4_128, 1_003, rows + 2, false) + scan));
    }
    // A planting that breaks a pact is refused.
    let d = c.plant_deposit(4, None, None).0;
    ctx_gas("bound.testnet", T0 + GEN_MS, d, 300);
    c.hot = None;
    assert!(refusal(|| {
        c.plant(patterns::BLOCK.iter().map(|&(dx, dy)| ((6 + dy) * 128 + 10 + dx) as u32).collect(), None, None, None);
    })
    .contains("pact"));
    for (who, g, real) in &report {
        eprintln!("30,000 colonies, {} playing: 64-cell planting by {} {:.2} TGas of host calls, {:.1} TGas on the real network", rows, who, *g as f64 / 1e12, real / 1e12);
    }
    let (bound, free) = (report[0].2, report[1].2);
    eprintln!("8 pacts add {:.2} TGas to a 64-cell planting", (bound - free) / 1e12);
    assert!(bound < 150e12 && bound - free < 5e12, "{} / {}", bound, free);
}

// ---------- v6.2: what the round-5 adversary found ----------

/// A guest on sponsored credit that attaches one yoctoNEAR to a credit-paid planting stays a guest: less than
/// `min_join` of NEAR in one call feeds the vault but attaches nothing, so its credit-funded cells win credit at the
/// tides, never NEAR it could claim. Bringing `min_join` of its own NEAR (net of storage) in one call attaches it.
#[test]
fn one_yocto_does_not_turn_credit_into_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 2);
    let d = c.plant_deposit(4, None, None).0;
    ctx(g, T0, 1);
    c.plant(cells(20, 20, patterns::BLOCK), None, Some(U128(d)), None);
    assert!(!c.colony_of(acct(g)).unwrap().attached, "one yocto attaches nothing");
    for k in 1..40u64 {
        at("keeper.testnet", T0 + 8 * k * GEN_MS);
        c.advance(None);
    }
    assert_eq!(c.claimable(acct(g)).near.0, 0, "credit-funded cells win no NEAR");
    assert!(c.colony_of(acct(g)).unwrap().credit_won.0 > 0, "they win credit");
    at(g, T0 + 8 * 40 * GEN_MS);
    assert_eq!(c.claim().near.0, 0);
    // v6.5: its credit-funded block still lives, so a purchase that brings min_join of its own NEAR is refused; less
    // than min_join still only feeds the vault.
    let t = T0 + 8 * 40 * GEN_MS;
    assert_eq!(
        refused(&mut c, |c| {
            ctx(g, t, NEAR / 50);
            c.buy(None);
        }),
        GREW_ON_CREDIT
    );
    ctx(g, T0 + 8 * 40 * GEN_MS, NEAR / 200);
    c.buy(None);
    assert!(!c.colony_of(acct(g)).unwrap().attached);
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

/// A colony holding kept PETRI is paid its tide shares as credit and claims no NEAR, even once attached.
#[test]
fn kept_petri_is_paid_in_credit_and_claims_no_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    // Bob joins with NEAR and plants with it (a full stake, v6.3), then buys with credit: that PETRI is kept.
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 5);
    plant(&mut c, "bob.testnet", T0, cells(20, 20, patterns::BLOCK), None);
    ctx("relayer.testnet", T0, NEAR / 10);
    c.sponsor(acct("bob.testnet"));
    at("bob.testnet", T0);
    c.buy(Some(U128(NEAR / 20)));
    let bob = c.colony_of(acct("bob.testnet")).unwrap();
    assert!(bob.attached && bob.kept.0 > 0);
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    assert!(last_paid().as_credit.0 > 0, "bob's share went as credit");
    assert_eq!(c.claimable(acct("bob.testnet")).near.0, 0);
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

/// Kept PETRI pays no licence royalty to a holder (who could send or sell it): an attached planter holding kept PETRI
/// beyond the planting's cost pays its royalty to the agar.
#[test]
fn kept_petri_pays_its_royalty_to_the_agar() {
    let mut c = new_dish();
    join(&mut c, "mallory.testnet", T0, "Mallory", 1, NEAR);
    plant(&mut c, "mallory.testnet", T0, cells(4, 4, &two_beehives()), None);
    mint(&mut c, "mallory.testnet", T0 + GEN_MS, (3, 3, 12, 6), None);
    ctx("mallory.testnet", T0 + GEN_MS, 1);
    c.nft_transfer(acct("alt.testnet"), "1".into(), None, None);
    // A colony that attached NEAR but bought most of its PETRI with credit.
    ctx("relayer.testnet", T0 + GEN_MS, NEAR / 10);
    c.sponsor(acct("bob.testnet"));
    ctx("bob.testnet", T0 + GEN_MS, NEAR / 50);
    c.join("Bob".into(), 2, Some(U128(NEAR / 20)));
    let bob = c.colony_of(acct("bob.testnet")).unwrap();
    assert!(bob.attached && bob.kept.0 > 0);
    plant_slide(&mut c, "bob.testnet", T0 + 2 * GEN_MS, cells(20, 20, &two_beehives()), "1");
    let Entry::Plant { licence: Some(l), .. } = last_entry(&c) else { panic!("a licensed planting") };
    assert!(l.to_agar && l.royalty.0 > 0, "the royalty went to the agar");
    assert_eq!(bal(&c, "alt.testnet"), 0, "the holder is paid nothing from kept PETRI");
    conserved(&c, &["mallory.testnet", "bob.testnet", "keeper.testnet"]);
}

/// Offers nobody asked for cannot jam a colony's pacts: an offer carries at least 1 PETRI, offers waiting for a colony
/// have their own list of 16, and the colony still makes and accepts pacts while they wait.
#[test]
fn offers_cannot_jam_a_colonys_pacts() {
    let mut c = new_dish();
    join(&mut c, "victim.testnet", T0, "Victim", 1, NEAR / 10);
    join(&mut c, "spam0.testnet", T0, "Spam 0", 2, NEAR / 10);
    ctx("spam0.testnet", T0, PACT_DEPOSIT);
    let free = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.pact_offer(acct("victim.testnet"), U128(0), U64(2880), None)));
    let msg = free.unwrap_err().downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("at least 1 PETRI"), "{}", msg);
    for i in 0..9 {
        let a = format!("spam{}.testnet", i);
        if i > 0 {
            join(&mut c, &a, T0, &format!("Spam {}", i), 2, NEAR / 10);
        }
        ctx(&a, T0, PACT_DEPOSIT);
        c.pact_offer(acct("victim.testnet"), U128(P), U64(2880), None);
    }
    // Nine offers wait; the victim still makes and accepts pacts of its own.
    join(&mut c, "friend.testnet", T0, "Friend", 3, NEAR / 10);
    ctx("friend.testnet", T0, PACT_DEPOSIT);
    let id = c.pact_offer(acct("victim.testnet"), U128(P), U64(100), None);
    at("victim.testnet", T0);
    c.pact_accept(id);
    ctx("victim.testnet", T0, PACT_DEPOSIT);
    c.pact_offer(acct("friend.testnet"), U128(P), U64(100), None);
    assert_eq!(c.pacts_of(acct("victim.testnet")).len(), 11);
    // Sixteen waiting is the most.
    for i in 9..16 {
        let a = format!("spam{}.testnet", i);
        join(&mut c, &a, T0, &format!("Spam {}", i), 2, NEAR / 10);
        ctx(&a, T0, PACT_DEPOSIT);
        c.pact_offer(acct("victim.testnet"), U128(P), U64(2880), None);
    }
    join(&mut c, "spam16.testnet", T0, "Spam 16", 2, NEAR / 10);
    ctx("spam16.testnet", T0, PACT_DEPOSIT);
    let full = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.pact_offer(acct("victim.testnet"), U128(P), U64(2880), None)));
    let msg = full.unwrap_err().downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.contains("16 offers waiting"), "{}", msg);
}

/// wNEAR too small to pay for the records it would need is refunded whole and writes nothing, so dust cannot grow the
/// dish's storage at the players' expense; an amount that covers its records is kept, never refunded.
#[test]
fn dust_wnear_is_refunded() {
    let mut c = new_dish();
    let ledger = c.state().ledger.0;
    let mut grown = 0u64;
    for i in 0..10u128 {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).prepaid_gas(Gas::from_tgas(20));
        testing_env!(b.build());
        let b0 = env::storage_usage();
        let amount = 1 + i * 20 * byte();
        let back = c.ft_on_transfer(acct("spammer.testnet"), U128(amount), "x".into());
        assert!(matches!(back, PromiseOrValue::Value(U128(v)) if v == amount), "refunded whole");
        grown += env::storage_usage() - b0;
    }
    assert_eq!((grown, c.state().ledger.0, c.state().vault.0), (0, ledger, 0), "nothing written, nothing kept");
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).prepaid_gas(Gas::from_tgas(20));
    testing_env!(b.build());
    let back = c.ft_on_transfer(acct("spammer.testnet"), U128(NEAR / 100), "x".into());
    assert!(matches!(back, PromiseOrValue::Value(U128(0))), "a payment that covers its records is kept");
    assert!(c.pending_of(acct("spammer.testnet")).0 > 0);
}

/// A join on credit runs no generation, so it takes neither a tide bounty nor the keeper pot; a join with min_join of
/// its own NEAR runs the clock as before.
#[test]
fn a_join_on_credit_does_not_run_the_clock() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    guest(&mut c, "g-1.relayer.testnet", T0 + 8 * GEN_MS, "Guest", 2);
    assert_eq!(c.state().generation.0, 0, "the guest's join ran nothing");
    join(&mut c, "bob.testnet", T0 + 8 * GEN_MS, "Bob", 3, NEAR / 10);
    assert_eq!(c.state().generation.0, 8);
}

/// set_payout pays for the storage it adds, from attached NEAR; the rest comes back.
#[test]
fn set_payout_pays_for_its_storage() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 10);
    ctx("alice.testnet", T0, NEAR / 1_000);
    let before = env::storage_usage();
    c.set_payout(Some(acct("a-much-longer-payout-account.testnet")));
    assert!(env::storage_usage() > before);
}

#[test]
#[should_panic(expected = "for its storage")]
fn set_payout_without_a_deposit_is_refused() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 10);
    at("alice.testnet", T0);
    c.set_payout(Some(acct("a-much-longer-payout-account.testnet")));
}

// ---------- v6.4: what the security judge found in v6.3 ----------

/// A guest plays a whole window on credit, attaches just before the tide and plants until its kept PETRI is spent:
/// its first NEAR cleared its window as well as its stake, so the tide pays it NEAR only for what its new planting
/// earned in the one generation since, nothing for the window it played as a guest.
#[test]
fn a_guest_window_wins_no_near_after_it_attaches() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    // Its cells are gone at generation 6 (v6.5: a colony attaches only once its credit-grown cells are dead).
    plant_on_credit(&mut c, g, T0, cells(20, 20, FADE));
    let id = c.colony_of(acct(g)).unwrap().id;
    let t = T0 + 7 * GEN_MS;
    at("keeper.testnet", t);
    c.advance(None);
    let guest_window = books::HotTable::load().get(id).unwrap().window;
    assert!(guest_window > 0, "it earned through the window as a guest");
    ctx(g, t, NEAR / 50);
    c.buy(None);
    assert!(c.colony_of(acct(g)).unwrap().attached && kept_petri(&c, g).0 > 0);
    let row = books::HotTable::load().get(id).cloned().unwrap();
    assert_eq!((row.window, row.stake), (0, 0), "its guest window and stake are gone");
    // A planting large enough spends every kept PETRI.
    plant(&mut c, g, t, band(10), None);
    assert_eq!(kept_petri(&c, g).0, 0);
    assert_eq!(c.claimable(acct(g)).petri.0, 0, "the planting claimed what it had earned");
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    assert!(matches!(last_tide(&c), Entry::Tide { generation, .. } if generation.0 == 8), "the tide ran");
    // Its weight at the tide is only what it earned in generation 8 (all it has not claimed); Alice's is all she earned.
    let (wg, wa) = (c.claimable(acct(g)).petri.0, c.claimable(acct("alice.testnet")).petri.0);
    let paid = last_paid().paid.0;
    let owed = c.claimable(acct(g)).near.0;
    assert!(owed <= (paid + 2) * wg / (wa + wg) + 1, "owed {} for weight {} of {} (paid {})", owed, wg, wa + wg, paid);
    conserved(&c, &["alice.testnet", g, "keeper.testnet"]);
}

/// A royalty buys no stake: Bob, holding a little kept PETRI, plants a slide held by Alice (who could be his own second
/// account) and stakes only the part of the cost (not cost and royalty) his kept PETRI did not pay.
#[test]
fn a_royalty_to_a_sybil_holder_buys_no_stake() {
    let mut c = glider_slide();
    ctx("friend.testnet", T0, NEAR / 10);
    c.sponsor(acct("bob.testnet"));
    at("bob.testnet", T0);
    c.buy(Some(U128(NEAR / 700)));
    let kept = kept_petri(&c, "bob.testnet").0 as u128;
    assert!(kept > 0);
    let bob = c.colony_of(acct("bob.testnet")).unwrap().id as usize;
    let before = c.stakes(None, None)[bob - 1].0;
    plant_slide(&mut c, "bob.testnet", T0, cells(20, 20, patterns::GLIDER), "1");
    let Entry::Plant { cost, licence: Some(l), .. } = last_entry(&c) else { panic!() };
    let (cost, toll) = (cost.0 as u128, l.royalty.0 as u128);
    assert!(!l.to_agar && toll > 0 && cost > kept, "the holder is paid: kept {} cost {}", kept, cost);
    let full = 5 * STAKE_UNIT as u128;
    let added = (c.stakes(None, None)[bob - 1].0 - before) as u128;
    assert_eq!(added, full * (cost - kept) / cost, "stake for the cost only");
    assert!(added < full * (cost + toll - kept) / (cost + toll), "less than counting the royalty would give");
    conserved(&c, &["alice.testnet", "bob.testnet", "friend.testnet"]);
}

// ---------- v6.5: a code-only upgrade of the v6.4 dishes ----------

type Snapshot = (Vec<u8>, HashMap<Vec<u8>, Vec<u8>>);

/// The dish as it stands: its state and the trie. Leaves a plain context, as `trie` does.
fn snapshot(c: &mut Petri) -> Snapshot {
    c.flush();
    (near_sdk::borsh::to_vec(&*c).unwrap(), trie())
}

/// The trie `t` under a plain context.
fn put_trie(t: &HashMap<Vec<u8>, Vec<u8>>) {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("petri.testnet")).predecessor_account_id(acct("petri.testnet")).block_timestamp(T0 * MS).account_balance(NearToken::from_near(1_000));
    env::set_blockchain_interface(near_sdk::MockedBlockchain::new(b.build(), near_sdk::test_vm_config(), near_sdk::RuntimeFeesConfig::test(), vec![], t.clone(), Default::default(), None));
}

/// Runs `f` (which sets its own context), which the dish must refuse, and puts the dish back as it was: a refused call
/// changes nothing on chain, but the unit runtime keeps whatever it changed before the panic. Returns the refusal.
fn refused(c: &mut Petri, f: impl FnOnce(&mut Petri)) -> String {
    let s = snapshot(c);
    let why = refusal(|| f(c));
    put_trie(&s.1);
    // The refused call's leftovers must not be flushed into the trie put back.
    std::mem::forget(std::mem::replace(c, near_sdk::borsh::from_slice(&s.0).unwrap()));
    why
}

fn alive_cells(c: &Petri, id: u16) -> usize {
    c.load_dish().cells.iter().filter(|&&x| x == id).count()
}

/// R8 finding: cells a guest grew on sponsored credit must not live on into its attached life, where the stake its
/// NEAR plantings add would pay for them in NEAR. So a guest brings its own NEAR (`min_join` in one call) only while it
/// has no living cells, by every path: a purchase, a planting that attaches, a purchase through NEAR Intents. Each is
/// refused and changes nothing; NEAR below `min_join` still only feeds the vault; and once its cells are gone (or if it
/// never had any) it attaches as in v6.4.
#[test]
fn a_guest_with_living_cells_cannot_bring_its_own_near() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    plant_on_credit(&mut c, g, T0, cells(20, 20, patterns::BLOCK));
    let id = c.colony_of(acct(g)).unwrap().id;
    let t = T0 + GEN_MS;
    at("keeper.testnet", t);
    c.advance(None);
    assert_eq!(alive_cells(&c, id), 4);
    // A purchase with min_join of its own NEAR.
    assert_eq!(
        refused(&mut c, |c| {
            ctx(g, t, NEAR / 50);
            c.buy(None);
        }),
        GREW_ON_CREDIT
    );
    // A planting that brings it, even with no living cell near the new ones.
    let cs = cells(10, 24, patterns::BEEHIVE);
    let d = c.plant_deposit(6, None, None).0;
    assert_eq!(
        refused(&mut c, |c| {
            ctx(g, t, d + NEAR / 50);
            c.plant(cs.clone(), None, None, None);
        }),
        GREW_ON_CREDIT
    );
    // A purchase paid with wNEAR through NEAR Intents: the order cannot run, so the NEAR waits for the account.
    assert_eq!(wnear_in(&mut c, t, NEAR / 20, &format!(r#"{{"for":"{}","do":"buy"}}"#, g), 20, "intents.testnet").0, 0);
    let waiting = c.pending_record(acct(g)).unwrap();
    assert!(waiting.order_near.0 > NEAR / 50);
    let why = refused(&mut c, |c| {
        at("keeper.testnet", t);
        c.settle_pending(acct(g));
    });
    assert_eq!(why, GREW_ON_CREDIT);
    assert_eq!(c.pending_record(acct(g)).unwrap().order_near, waiting.order_near, "the order still waits");
    // NEAR below min_join, and credit, still go in: it stays a guest.
    ctx(g, t, NEAR / 200);
    c.buy(Some(U128(NEAR / 100)));
    assert!(!c.colony_of(acct(g)).unwrap().attached);
    // A guest whose cells are gone attaches.
    let g2 = "g-2.relayer.testnet";
    guest(&mut c, g2, T0 + GEN_MS, "Guest 2", 4);
    plant_on_credit(&mut c, g2, T0 + GEN_MS, cells(26, 8, FADE));
    let id2 = c.colony_of(acct(g2)).unwrap().id;
    at("keeper.testnet", T0 + 7 * GEN_MS);
    c.advance(None);
    assert_eq!(alive_cells(&c, id2), 0);
    ctx(g2, T0 + 7 * GEN_MS, NEAR / 50);
    c.buy(None);
    assert!(c.colony_of(acct(g2)).unwrap().attached);
    // So does a guest whose only living cells are the ones its attaching planting brings.
    let g3 = "g-3.relayer.testnet";
    guest(&mut c, g3, T0 + 7 * GEN_MS, "Guest 3", 5);
    let cs = cells(26, 26, patterns::BLOCK);
    let d = c.plant_deposit(4, None, None).0;
    ctx(g3, T0 + 7 * GEN_MS, d + NEAR / 50);
    c.plant(cs, None, None, None);
    assert!(c.colony_of(acct(g3)).unwrap().attached);
    conserved(&c, &["alice.testnet", g, g2, g3, "keeper.testnet"]);
}

/// A refused attach changes nothing: the trie after it is the trie before it, byte for byte.
#[test]
fn a_refused_attach_writes_nothing() {
    let mut c = new_dish();
    let g = "g-1.relayer.testnet";
    guest(&mut c, g, T0, "Guest", 3);
    plant_on_credit(&mut c, g, T0, cells(20, 20, patterns::BLOCK));
    let before = snapshot(&mut c);
    for attach in [0, 1] {
        let why = refused(&mut c, |c| {
            let t = T0 + GEN_MS;
            if attach == 0 {
                ctx(g, t, NEAR / 50);
                c.buy(None);
            } else {
                let d = c.plant_deposit(4, None, None).0;
                ctx(g, t, d + NEAR / 50);
                c.plant(cells(2, 2, patterns::BLOCK), None, None, None);
            }
        });
        assert_eq!(why, GREW_ON_CREDIT);
        assert_eq!(snapshot(&mut c), before);
    }
}

/// R8 finding: anyone could overwrite an account's waiting Intents join with a purchase for dust, so the join never
/// ran. v6.5 replaces a waiting join only with another join; a purchase's NEAR adds to the join, which spends it all.
#[test]
fn nobody_can_turn_a_waiting_join_into_a_purchase() {
    let mut c = new_dish();
    // Pat pays for its own join, with its name, and the order waits (too little gas to unwrap now).
    assert_eq!(wnear_in(&mut c, T0, NEAR / 20, r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#, 20, "pat.testnet").0, 0);
    let first = c.pending_record(acct("pat.testnet")).unwrap();
    assert_eq!(first.order.clone().map(|o| (o.join, o.name)), Some((true, Some("Pat".to_string()))));
    // Mallory sends a little wNEAR with a purchase for Pat.
    assert_eq!(wnear_in(&mut c, T0, NEAR / 500, r#"{"for":"pat.testnet","do":"buy"}"#, 20, "mallory.testnet").0, 0);
    let rec = c.pending_record(acct("pat.testnet")).unwrap();
    assert_eq!(rec.order, first.order, "the join still waits");
    assert!(rec.order_near.0 > first.order_near.0, "with Mallory's NEAR added to it");
    at("keeper.testnet", T0);
    assert_eq!(c.settle_pending(acct("pat.testnet")), "join");
    let col = c.colony_of(acct("pat.testnet")).unwrap();
    assert_eq!((col.name.as_str(), col.attached), ("Pat", true));
    assert!(c.pending_record(acct("pat.testnet")).is_none(), "the join spent all of it");
    // A purchase waiting for an account is still replaced by a join.
    assert_eq!(wnear_in(&mut c, T0, NEAR / 500, r#"{"for":"sam.testnet","do":"buy"}"#, 20, "intents.testnet").0, 0);
    assert_eq!(wnear_in(&mut c, T0, NEAR / 20, r#"{"for":"sam.testnet","do":"join"}"#, 20, "intents.testnet").0, 0);
    assert!(c.pending_record(acct("sam.testnet")).unwrap().order.unwrap().join);
    at("keeper.testnet", T0);
    assert_eq!(c.settle_pending(acct("sam.testnet")), "join");
    conserved(&c, &["pat.testnet", "sam.testnet"]);
}

/// R8 finding: a 1Click join of a little more than min_join made a guest, because the colony's storage came out of it
/// before min_join reached the vault. v6.5 quotes and requires min_join plus the join's storage; less waits as pending
/// NEAR exactly as a join below min_join always did (the account can add to it, or claim it).
#[test]
fn an_intents_join_below_its_minimum_waits_instead_of_making_a_guest() {
    let mut c = new_dish();
    let min = c.intent_minimum("join".into(), acct("pat.testnet")).0;
    // Enough for v6.4's check (min_join after the payment's records), short of the join's storage.
    let short = min - 200 * byte();
    assert_eq!(wnear_in(&mut c, T0, short, r#"{"for":"pat.testnet","do":"join"}"#, 20, "intents.testnet").0, 0);
    let owed = c.pending_of(acct("pat.testnet")).0;
    at("keeper.testnet", T0);
    let why = refusal(|| {
        c.settle_pending(acct("pat.testnet"));
    });
    assert!(why.starts_with("a join needs"), "{}", why);
    assert!(c.colony_of(acct("pat.testnet")).is_none() && c.pending_of(acct("pat.testnet")).0 == owed, "nothing changed");
    // From the callback too: the order waits.
    callback(T0, None);
    assert!(refusal(|| {
        c.settle_intent(acct("pat.testnet"));
    })
    .starts_with("a join needs"));
    // More NEAR for the same order, and it joins, attached.
    assert_eq!(wnear_in(&mut c, T0, NEAR / 100, r#"{"for":"pat.testnet","do":"join"}"#, 20, "intents.testnet").0, 0);
    at("keeper.testnet", T0);
    assert_eq!(c.settle_pending(acct("pat.testnet")), "join");
    assert!(c.colony_of(acct("pat.testnet")).unwrap().attached);
    conserved(&c, &["pat.testnet"]);
}

/// `join_bytes` covers the largest join there is (a 64-character account, a 24-character name, a new cold page, no
/// PETRI registration yet) and is not loose: a join of `min_join` plus it, attached, always attaches the colony.
#[test]
fn join_bytes_covers_the_largest_join() {
    let mut c = new_dish();
    let who = "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    assert_eq!(who.len(), 64);
    let name = "Twenty four letters long";
    assert_eq!(name.len(), MAX_NAME_BYTES);
    let bound = intents::join_bytes(&acct(who));
    ctx(who, T0, c.rules().min_join.0 + bound * byte());
    let before = env::storage_usage();
    c.join(name.into(), 1, None);
    let used = (env::storage_usage() - before) as u128;
    assert!(c.colony_of(acct(who)).unwrap().attached, "min_join plus the bound attaches");
    // The bound charges the purchase record at BUY_BYTES; the record itself may be smaller.
    assert!(used <= bound && bound - used <= 20, "used {} of {}", used, bound);
    let col = c.colony(1);
    assert_eq!(near_sdk::borsh::to_vec(&col).unwrap().len() as u128, COLONY_FIXED_BYTES + 64 + 24);
}

/// NEP-199: a slide sells on a marketplace with 5% to the colony that minted it, the rest to the seller.
#[test]
fn a_slide_sale_pays_its_minter_a_royalty() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    let one = |c: &Petri, owner: &str| c.nft_payout("1".into(), U128(NEAR), Some(10)).payout.get(&acct(owner)).copied();
    // Alice sells the slide she minted: all of it is hers.
    let p = c.nft_payout("1".into(), U128(NEAR), Some(1));
    assert_eq!(p.payout.len(), 1);
    assert_eq!(one(&c, "alice.testnet"), Some(U128(NEAR)));
    ctx("alice.testnet", T0, 1);
    c.nft_transfer(acct("carol.testnet"), "1".into(), None, None);
    // Carol sells it: 5% to Alice.
    let p = c.nft_payout("1".into(), U128(NEAR), None);
    assert_eq!(p.payout.len(), 2);
    assert_eq!(one(&c, "alice.testnet"), Some(U128(NEAR / 20)));
    assert_eq!(one(&c, "carol.testnet"), Some(U128(NEAR - NEAR / 20)));
    // Every yocto is paid, and no balance overflows.
    for balance in [0u128, 1, 19, 9_999, 10_001, u128::MAX] {
        let p = c.nft_payout("1".into(), U128(balance), None);
        assert_eq!(p.payout.values().map(|v| v.0).sum::<u128>(), balance);
        let r = p.payout.get(&acct("alice.testnet")).map(|v| v.0).unwrap_or(0);
        assert!(r <= balance / 20 && balance / 20 - r <= 1, "{} of {}", r, balance);
    }
    assert!(refusal(|| {
        c.nft_payout("1".into(), U128(NEAR), Some(1));
    })
    .contains("max_len_payout"));
    // Alice sends her NEAR payouts to a wallet: so do her royalties (and a slide she still held would pay her whole).
    ctx("alice.testnet", T0, NEAR / 1_000);
    c.set_payout(Some(acct("alice-wallet.testnet")));
    assert_eq!(c.nft_payout("1".into(), U128(NEAR), None).payout.get(&acct("alice-wallet.testnet")), Some(&U128(NEAR / 20)));
    let d = c.slide_deposit(4, 4, None).0;
    ctx("alice.testnet", T0, d);
    let mine = c.mint_slide(2, 2, 4, 4, None, None);
    assert_eq!(c.nft_payout(mine, U128(NEAR), Some(1)).payout.get(&acct("alice.testnet")), Some(&U128(NEAR)));
    // A market Carol approved sells it with nft_transfer_payout: the split for Carol, then the move.
    ctx("carol.testnet", T0, NEAR / 100);
    c.nft_approve("1".into(), acct("market.testnet"), None);
    ctx("market.testnet", T0, 1);
    let p = c.nft_transfer_payout(acct("dave.testnet"), "1".into(), Some(0), Some("sold".into()), U128(NEAR), Some(10));
    assert_eq!(p.payout.get(&acct("carol.testnet")), Some(&U128(NEAR - NEAR / 20)));
    assert_eq!(c.nft_token("1".into()).unwrap().owner_id.as_str(), "dave.testnet");
    assert!(get_logs().iter().any(|l| l.contains("\"nft_transfer\"") && l.contains("\"authorized_id\":\"market.testnet\"")));
    ctx("market.testnet", T0, 0);
    assert!(refusal(|| {
        c.nft_transfer_payout(acct("erin.testnet"), "1".into(), None, None, U128(NEAR), None);
    })
    .contains("1 yoctoNEAR"));
}

/// `nft_transfer_payout` moves a slide exactly as `nft_transfer` does: the same trie, the same logs and promises.
#[test]
fn a_transfer_with_payout_is_exactly_a_transfer() {
    let mut c = two_colonies();
    mint(&mut c, "alice.testnet", T0, (0, 0, 12, 6), None);
    ctx("alice.testnet", T0, NEAR / 100);
    c.nft_approve("1".into(), acct("market.testnet"), None);
    let start = snapshot(&mut c);
    let mut runs = Vec::new();
    for payout in [false, true] {
        put_trie(&start.1);
        let mut c: Petri = near_sdk::borsh::from_slice(&start.0).unwrap();
        ctx("market.testnet", T0, 1);
        if payout {
            c.nft_transfer_payout(acct("dave.testnet"), "1".into(), Some(0), Some("memo".into()), U128(NEAR), Some(2));
        } else {
            c.nft_transfer(acct("dave.testnet"), "1".into(), Some(0), Some("memo".into()));
        }
        let (logs, calls) = (get_logs(), scheduled());
        runs.push((snapshot(&mut c), logs, calls));
    }
    assert_eq!(runs[0], runs[1]);
}

#[test]
fn v6_5_names_its_version_and_standards() {
    let meta: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(CONTRACT_SOURCE_METADATA).unwrap();
    assert_eq!(meta["version"], "6.5.0");
    let standards: Vec<String> = meta["standards"].as_array().unwrap().iter().map(|s| format!("{}:{}", s["standard"].as_str().unwrap(), s["version"].as_str().unwrap())).collect();
    assert!(standards.contains(&"nep199:2.0.0".to_string()) && standards.contains(&"nep171:1.2.0".to_string()) && standards.contains(&"nep330:1.3.0".to_string()), "{:?}", standards);
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 5);
    assert!(get_logs().iter().any(|l| l.contains(r#""standard":"petri","version":"6.5.0","event":"join""#)));
    // The version marker names the state layout, which v6.5 keeps.
    assert_eq!(env::storage_read(VERSION_KEY).unwrap(), b"6.4");
}

/// One call on a dish of either version: `$ctx` sets the context, `$call` runs; its result (or refusal) and its logs
/// are recorded in `$out`, with the `petri` events' version normalised (v6.5 says "6.5.0", v6.4 "6.4.0").
macro_rules! upgrade_step {
    ($out:ident, $ctx:expr, $call:expr) => {{
        $ctx;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| format!("{:?}", $call)));
        let r = r.unwrap_or_else(|e| format!("REFUSED {:?}", e.downcast_ref::<String>()));
        $out.push((r, get_logs().iter().map(|l| l.replace(r#""standard":"petri","version":"6.4.0""#, r#""standard":"petri","version":"6.5.0""#)).collect::<Vec<String>>()));
    }};
}

/// wNEAR's `ft_transfer_call` landing in a dish of either version with 20 TGas, too little to unwrap at once, so the
/// order waits as pending NEAR.
macro_rules! upgrade_wnear {
    ($out:ident, $c:ident, $ms:expr, $amount:expr, $msg:expr) => {{
        upgrade_step!(
            $out,
            {
                let mut b = VMContextBuilder::new();
                b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp($ms * MS).prepaid_gas(Gas::from_tgas(20));
                testing_env!(b.build());
            },
            match $c.ft_on_transfer(acct("intents.testnet"), U128($amount), String::from($msg)) {
                PromiseOrValue::Value(v) => v.0,
                PromiseOrValue::Promise(_) => u128::MAX,
            }
        )
    }};
}

/// What happens to a dish that ran v6.4 next: joins (one on credit, one through NEAR Intents), purchases, plantings
/// (one under a slide's licence that pays its holder a royalty), a slide minted and one moved, a pact offered,
/// orders from Intents settled (one written by v6.4), a guest planting on credit, a guest without cells bringing its
/// own NEAR, tides, claims, a sale and a PETRI transfer. Nothing v6.5 refuses that v6.4 ran.
macro_rules! after_the_upgrade {
    ($c:ident, $pact_deposit:expr) => {{
        let mut out: Vec<(String, Vec<String>)> = Vec::new();
        let g = |n: u64| T0 + n * GEN_MS;
        upgrade_step!(out, ctx("carol.testnet", g(17), NEAR / 5), $c.join("Carol".into(), 0x123456, None));
        let d = $c.plant_deposit(6, Some(5), None).0;
        upgrade_step!(out, ctx("carol.testnet", g(17), d), $c.plant(cells(26, 14, patterns::BEEHIVE), Some("after".into()), None, None));
        upgrade_step!(out, ctx("alice.testnet", g(17), NEAR / 10), $c.buy(None));
        let d = $c.plant_deposit(12, None, Some("1".into())).0;
        upgrade_step!(out, ctx("carol.testnet", g(18), d), $c.plant(cells(14, 28, &two_beehives()), None, None, Some("1".into())));
        upgrade_step!(out, ctx("collector.testnet", g(18), 1), $c.nft_transfer(acct("dave.testnet"), "1".into(), None, Some("gift".into())));
        let d = $c.slide_deposit(4, 4, Some(4)).0;
        upgrade_step!(out, ctx("carol.testnet", g(19), d), $c.mint_slide(26, 14, 4, 4, Some("Hive".into()), None));
        upgrade_step!(out, ctx("carol.testnet", g(19), $pact_deposit), $c.pact_offer(acct("alice.testnet"), U128(P), U64(119), None));
        upgrade_wnear!(out, $c, g(19), NEAR / 20, r#"{"for":"alice.testnet","do":"buy"}"#);
        upgrade_step!(out, at("keeper.testnet", g(19)), $c.settle_pending(acct("alice.testnet")));
        upgrade_step!(out, at("keeper.testnet", g(19)), $c.settle_pending(acct("pat.testnet")));
        upgrade_wnear!(out, $c, g(20), NEAR / 10, r#"{"for":"quinn.testnet","do":"join"}"#);
        upgrade_step!(out, at("quinn.testnet", g(20)), $c.settle_pending(acct("quinn.testnet")));
        upgrade_step!(out, ctx("relayer.testnet", g(20), NEAR / 10), $c.sponsor(acct("g-3.relayer.testnet")));
        upgrade_step!(out, at("g-3.relayer.testnet", g(20)), $c.join("Guest 3".into(), 3, Some(U128(NEAR / 50))));
        let d = $c.plant_deposit(5, None, None).0;
        upgrade_step!(out, at("g-3.relayer.testnet", g(20)), $c.plant(cells(26, 22, FADE), None, Some(U128(d)), None));
        upgrade_step!(out, at("g-2.relayer.testnet", g(21)), $c.join("Guest 2".into(), 4, Some(U128(NEAR / 50))));
        upgrade_step!(out, ctx("g-2.relayer.testnet", g(21), NEAR / 50), $c.buy(None));
        upgrade_step!(out, ctx("house.testnet", g(21), NEAR / 20), $c.buy(None));
        upgrade_step!(out, at("keeper.testnet", g(24)), $c.advance(None));
        upgrade_step!(out, at("carol.testnet", g(25)), { let r = $c.claim(); (r.petri, r.near) });
        upgrade_step!(out, at("carol.testnet", g(25)), $c.sell(U128(300 * P)));
        upgrade_step!(out, ctx("alice.testnet", g(25), 1), $c.ft_transfer(acct("carol.testnet"), U128(P), Some("thanks".into())));
        upgrade_step!(out, at("keeper.testnet", g(32)), $c.advance(None));
        upgrade_step!(out, at("alice.testnet", g(33)), { let r = $c.claim(); (r.petri, r.near) });
        upgrade_step!(out, at("bob.testnet", g(33)), { let r = $c.claim(); (r.petri, r.near) });
        out
    }};
}

/// v6.5 is deployed over the live v6.4 dishes (petri-dish.near, petri-v6.testnet) as code only: no relaunch, no
/// migration. A real v6.4 dish (the frozen v6.4 code, 749f246, run through joins, plantings with notes, a guest on
/// credit whose living cells were still there when it attached NEAR, a slide that changed hands and was planted under
/// its licence, a registered keeper, credit for an account that never joined, pacts, tides, a claim, a sale, a payout
/// account and a waiting Intents join) is read by v6.5:
/// - the state v6.5 reads back serialises to exactly the bytes v6.4 wrote, and every stored record (colonies, ledger
///   entries, slides, pacts, pending NEAR, grants) decodes with v6.5's types to the same values v6.4's types read and
///   encodes back to the same bytes;
/// - every view returns the same JSON from both;
/// - then the same calls run on both from that state, and leave the same trie, byte for byte, with the same results
///   and the same logs (but the `petri` events' version string).
#[test]
fn v6_5_runs_a_v6_4_dish_exactly_as_v6_4_does() {
    use near_sdk::borsh::{from_slice, to_vec};
    use petri_contract_v6_4 as v64;
    let old_rules: v64::Rules = near_sdk::serde_json::from_value(near_sdk::serde_json::to_value(rules()).unwrap()).unwrap();
    at("deployer.testnet", T0);
    let mut old = v64::Petri::new(old_rules);
    for (who, name, near) in [("alice.testnet", "Alice", NEAR / 5), ("house.testnet", "House", NEAR / 20), ("bob.testnet", "Bob", NEAR / 5)] {
        ctx(who, T0, near);
        old.join(name.into(), 1, None);
    }
    let hives = two_beehives();
    for (who, xy, shape, note) in [("alice.testnet", (2, 2), &hives[..], Some("hello")), ("house.testnet", (20, 20), patterns::BLOCK, None), ("bob.testnet", (16, 12), patterns::BLOCK, Some("bob"))] {
        let d = old.plant_deposit(shape.len() as u32, note.map(|n: &str| n.len() as u32), None).0;
        ctx(who, T0, d);
        old.plant(cells(xy.0, xy.1, shape), note.map(String::from), None, None);
    }
    // A guest on credit, with a block it planted on credit.
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-1.relayer.testnet"));
    ctx("g-1.relayer.testnet", T0, 0);
    old.join("Guest".into(), 2, Some(U128(NEAR / 50)));
    let d = old.plant_deposit(4, None, None).0;
    at("g-1.relayer.testnet", T0);
    old.plant(cells(26, 6, patterns::BLOCK), None, Some(U128(d)), None);
    ctx("relayer.testnet", T0, NEAR / 10);
    old.sponsor(acct("g-2.relayer.testnet"));
    ctx("keeper.testnet", T0, NEAR / 100);
    old.storage_deposit(None, None);
    let d = old.slide_deposit(11, 5, Some(2)).0;
    ctx("alice.testnet", T0, d);
    old.mint_slide(1, 1, 11, 5, Some("Hi".into()), None);
    ctx("alice.testnet", T0, 1);
    old.nft_transfer(acct("collector.testnet"), "1".into(), None, None);
    at("keeper.testnet", T0 + GEN_MS);
    old.advance(None);
    let d = old.plant_deposit(12, None, Some("1".into())).0;
    ctx("bob.testnet", T0 + GEN_MS, d);
    old.plant(cells(2, 24, &hives), None, None, Some("1".into()));
    ctx("alice.testnet", T0 + GEN_MS, v64::PACT_DEPOSIT);
    let p = old.pact_offer(acct("bob.testnet"), U128(P), U64(200), None);
    ctx("bob.testnet", T0 + GEN_MS, 0);
    old.pact_accept(p);
    ctx("bob.testnet", T0 + GEN_MS, v64::PACT_DEPOSIT);
    old.pact_offer(acct("alice.testnet"), U128(P), U64(200), None);
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(acct(WNEAR)).current_account_id(acct("petri.testnet")).account_balance(NearToken::from_near(1_000)).block_timestamp(T0 * MS).prepaid_gas(Gas::from_tgas(20));
    testing_env!(b.build());
    let _ = old.ft_on_transfer(acct("intents.testnet"), U128(NEAR / 10), r#"{"for":"pat.testnet","do":"join","name":"Pat"}"#.into());
    for gen in [8u64, 16] {
        at("keeper.testnet", T0 + gen * GEN_MS);
        old.advance(None);
    }
    at("alice.testnet", T0 + 16 * GEN_MS);
    old.claim();
    old.sell(U128(200 * P));
    ctx("alice.testnet", T0 + 16 * GEN_MS, NEAR / 1_000);
    old.set_payout(Some(acct("alice-wallet.testnet")));
    // v6.4 let the guest attach NEAR while its block lived (v6.5 refuses that; the dish keeps what v6.4 did).
    ctx("g-1.relayer.testnet", T0 + 16 * GEN_MS, NEAR / 50);
    old.buy(None);
    assert!(old.colony_of(acct("g-1.relayer.testnet")).unwrap().attached);
    env::state_write(&old);
    drop(old);
    let v64_trie = trie();
    let has = |k: &[u8]| v64_trie.contains_key(k);
    assert!(has(b"STATE") && has(b"v") && has(b"h") && has(b"j") && has(&[b'P', 1, 0, 0, 0]) && has(&[b'Q', 1, 0]) && has(&[b'V', 0, 0, 0, 0]) && has(&[b'w', 0, 0]), "a v6.4 dish with every kind of record");

    // 1. The layout: v6.5 reads the state and every record v6.4 wrote, to the same values and back to the same bytes.
    let new: Petri = env::state_read().unwrap();
    assert_eq!(&to_vec(&new).unwrap(), &v64_trie[&b"STATE".to_vec()], "the contract state is the same bytes");
    drop(new);
    let mut kinds: HashMap<u8, usize> = HashMap::new();
    for (k, v) in &v64_trie {
        let (a, b) = match (k[0], k.len()) {
            (b'C', 5) => (format!("{:?}", from_slice::<v64::Colony>(v).unwrap()), {
                let x: Colony = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            (b'L', 5) => (format!("{:?}", from_slice::<v64::Entry>(v).unwrap()), {
                let x: Entry = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            (b'D', 5) => (format!("{:?}", from_slice::<v64::Slide>(v).unwrap()), {
                let x: Slide = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            (b'P', 5) => (format!("{:?}", from_slice::<v64::Pact>(v).unwrap()), {
                let x: Pact = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            (b'y', _) => (format!("{:?}", from_slice::<v64::PendingRec>(v).unwrap()), {
                let x: PendingRec = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            (b'g', _) => (format!("{:?}", from_slice::<Vec<v64::Grant>>(v).unwrap()), {
                let x: Vec<Grant> = from_slice(v).unwrap();
                assert_eq!(&to_vec(&x).unwrap(), v);
                format!("{:?}", x)
            }),
            _ => continue,
        };
        assert_eq!(a, b, "record {:?}", k);
        *kinds.entry(k[0]).or_default() += 1;
    }
    for (kind, least) in [(b'C', 4), (b'L', 20), (b'D', 1), (b'P', 2), (b'y', 1), (b'g', 1)] {
        assert!(kinds.get(&kind).copied().unwrap_or(0) >= least, "records {}: {:?}", kind as char, kinds);
    }

    // 2. Every view returns the same.
    let old: v64::Petri = env::state_read().unwrap();
    let new: Petri = env::state_read().unwrap();
    let j = |v: near_sdk::serde_json::Value| v.to_string();
    use near_sdk::serde_json::to_value as tv;
    let accounts = ["alice.testnet", "bob.testnet", "house.testnet", "g-1.relayer.testnet", "g-2.relayer.testnet", "keeper.testnet", "collector.testnet", "pat.testnet", "relayer.testnet", "nobody.testnet"];
    let mut views = vec![
        (j(tv(old.state()).unwrap()), j(tv(new.state()).unwrap())),
        (j(tv(old.rules()).unwrap()), j(tv(new.rules()).unwrap())),
        (j(tv(old.colonies(None, Some(500))).unwrap()), j(tv(new.colonies(None, Some(500))).unwrap())),
        (j(tv(old.ledger(None, Some(1_000))).unwrap()), j(tv(new.ledger(None, Some(1_000))).unwrap())),
        (j(tv(old.plants(None, None)).unwrap()), j(tv(new.plants(None, None)).unwrap())),
        (j(tv(old.checkpoints(None, None)).unwrap()), j(tv(new.checkpoints(None, None)).unwrap())),
        (j(tv(old.stakes(None, None)).unwrap()), j(tv(new.stakes(None, None)).unwrap())),
        (j(tv(old.earnings(None, None)).unwrap()), j(tv(new.earnings(None, None)).unwrap())),
        (j(tv(old.tide_winnings(None, None)).unwrap()), j(tv(new.tide_winnings(None, None)).unwrap())),
        (j(tv(old.slides(None, None)).unwrap()), j(tv(new.slides(None, None)).unwrap())),
        (j(tv(old.nft_tokens(None, None)).unwrap()), j(tv(new.nft_tokens(None, None)).unwrap())),
        (j(tv(old.nft_metadata()).unwrap()), j(tv(new.nft_metadata()).unwrap())),
        (j(tv(old.solvency()).unwrap()), j(tv(new.solvency()).unwrap())),
        (j(tv(old.ft_total_supply()).unwrap()), j(tv(new.ft_total_supply()).unwrap())),
        (j(tv(old.pact(1)).unwrap()), j(tv(new.pact(1)).unwrap())),
        (j(tv(old.pact(2)).unwrap()), j(tv(new.pact(2)).unwrap())),
        (old.board(), new.board()),
    ];
    for a in accounts {
        let a = acct(a);
        views.push((j(tv(old.colony_of(a.clone())).unwrap()), j(tv(new.colony_of(a.clone())).unwrap())));
        views.push((j(tv(old.ft_balance_of(a.clone())).unwrap()), j(tv(new.ft_balance_of(a.clone())).unwrap())));
        views.push((j(tv(old.storage_balance_of(a.clone())).unwrap()), j(tv(new.storage_balance_of(a.clone())).unwrap())));
        views.push((j(tv(old.claimable(a.clone())).unwrap()), j(tv(new.claimable(a.clone())).unwrap())));
        views.push((j(tv(old.credit_of(a.clone())).unwrap()), j(tv(new.credit_of(a.clone())).unwrap())));
        views.push((j(tv(old.credit_grants(a.clone())).unwrap()), j(tv(new.credit_grants(a.clone())).unwrap())));
        views.push((j(tv(old.pending_record(a.clone())).unwrap()), j(tv(new.pending_record(a.clone())).unwrap())));
        views.push((j(tv(old.pacts_of(a.clone())).unwrap()), j(tv(new.pacts_of(a.clone())).unwrap())));
        views.push((j(tv(old.nft_tokens_for_owner(a.clone(), None, None)).unwrap()), j(tv(new.nft_tokens_for_owner(a.clone(), None, None)).unwrap())));
    }
    for (i, (a, b)) in views.iter().enumerate() {
        assert_eq!(a, b, "view {}", i);
    }
    drop(old);
    drop(new);

    // 3. The same calls on both, from that state.
    let mut c: v64::Petri = env::state_read().unwrap();
    let ran_v64 = after_the_upgrade!(c, v64::PACT_DEPOSIT);
    env::state_write(&c);
    drop(c);
    let after_v64 = trie();
    put_trie(&v64_trie);
    let mut c: Petri = env::state_read().unwrap();
    let ran_v65 = after_the_upgrade!(c, PACT_DEPOSIT);
    env::state_write(&c);
    let s = c.state();
    drop(c);
    let after_v65 = trie();
    let refused: Vec<&String> = ran_v65.iter().map(|r| &r.0).filter(|r| r.starts_with("REFUSED")).collect();
    assert!(refused.is_empty(), "every call ran: {:?}", refused);
    assert_eq!(ran_v64.len(), ran_v65.len());
    for (i, (a, b)) in ran_v64.iter().zip(&ran_v65).enumerate() {
        assert_eq!(a, b, "call {}", i);
    }
    let mut changed: Vec<String> = after_v65.keys().filter(|k| after_v64.get(*k) != after_v65.get(*k)).map(|k| String::from_utf8_lossy(k).to_string()).collect();
    changed.extend(after_v64.keys().filter(|k| !after_v65.contains_key(*k)).map(|k| String::from_utf8_lossy(k).to_string()));
    assert!(changed.is_empty(), "keys that differ: {:?}", changed);
    assert_eq!(after_v64, after_v65, "the same trie, byte for byte");
    assert!(after_v65 != v64_trie && s.tides.0 >= 4 && s.colonies >= 8, "the calls did something: {} tides, {} colonies", s.tides.0, s.colonies);
}
