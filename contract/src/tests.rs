use super::*;
use near_sdk::test_utils::{get_logs, VMContextBuilder};
use near_sdk::testing_env;
use petri_core::patterns;

const MS: u64 = 1_000_000; // nanoseconds per millisecond
const GEN_MS: u64 = 15_000;
const P: u128 = 1_000_000;
const MAX: u128 = 1_000_000 * P;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const T0: u64 = 1_000_000;

fn rules() -> Rules {
    Rules {
        width: 32,
        height: 32,
        generation_ms: U64(GEN_MS),
        max_supply: U128(MAX),
        feed_ppm: 10,
        keeper_bps: 200,
        cap_bps: 1_500,
        cap_min: 8,
        burn_bps: 5_000,
        payback: 480,
        min_cell_price: U128(P / 2),
        live_floor: 1_000,
        petri_price: U128(NEAR / 5_000),
        min_join: U128(NEAR / 100),
        cell_fee: U128(NEAR / 10_000),
        tide_every: 8,
        tide_bps: 5_000,
        buffer: 3,
        max_plant_cells: 64,
        max_catchup: 40,
    }
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

fn bal(c: &Petri, who: &str) -> u128 {
    c.ft_balance_of(who.parse().unwrap()).0
}

fn unclaimed(c: &Petri) -> u128 {
    c.load_u64s(EARNED_KEY).iter().map(|&v| v as u128).sum()
}

/// Nothing is created or lost: every PETRI is in the agar, in an account, waiting to be claimed, in the keeper pot,
/// or burned.
fn conserved(c: &Petri, holders: &[&str]) {
    let s = c.state();
    assert_eq!(s.total_supply.0, MAX - s.burned.0, "supply = launch supply - burned");
    let held: u128 = holders.iter().map(|h| bal(c, h)).sum();
    assert_eq!(held + s.agar.0 + unclaimed(c) + s.keeper_pot.0, s.total_supply.0, "balances + agar + unclaimed + pot = supply");
    assert_eq!(s.agar.0, MAX - s.sold.0 - s.fed.0 + s.returned.0, "agar = launch - sold - fed + returned");
}

fn new_dish() -> Petri {
    at("deployer.testnet", T0);
    Petri::new(rules())
}

fn join(c: &mut Petri, who: &str, ms: u64, name: &str, color: u32, near: u128) {
    ctx(who, ms, near);
    c.join(name.into(), color);
}

fn plant(c: &mut Petri, who: &str, ms: u64, cs: Vec<u32>, note: Option<&str>) {
    let d = c.plant_deposit(cs.len() as u32, note.map(|n| n.len() as u32)).0;
    ctx(who, ms, d);
    c.plant(cs, note.map(|n| n.into()));
}

#[test]
fn launch_puts_every_petri_in_the_agar() {
    let c = new_dish();
    let s = c.state();
    assert_eq!(s.agar.0, MAX);
    assert_eq!(s.total_supply.0, MAX);
    assert_eq!(bal(&c, "petri.testnet"), MAX);
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
    // At the launch price 0.02 NEAR buys about 100 PETRI, less what storage took.
    assert!(held > 60 * P && held < 100 * P, "{}", held);
    assert_eq!(c.ledger(None, None).len(), 2, "a join and a purchase");
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
#[should_panic(expected = "may not contain")]
fn names_cannot_hide_characters() {
    let mut c = new_dish();
    join(&mut c, "mallory.testnet", T0, "Safr\u{202e}anin", 2, NEAR / 50);
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
    c.ft_transfer("alice.testnet".parse().unwrap(), U128(1_000 * P), None);
}

#[test]
fn planting_charges_the_payback_price_and_half_comes_back() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    let before = c.state();
    let price = c.quote(4).0;
    // A nearly empty dish counts 1,000 cells. The agar pays 10 ppm of itself, 98% of that to cells, for 480 generations.
    let per_cell = before.agar.0 * 10 / 1_000_000 * 9_800 / 10_000 / 1_000;
    assert_eq!(price, 4 * per_cell * 480);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), Some("first block"));
    let s = c.state();
    assert_eq!(s.burned.0, price / 2);
    assert_eq!(s.returned.0, price - price / 2);
    assert_eq!(s.agar.0, before.agar.0 + price - price / 2);
    assert!(s.vault.0 > before.vault.0, "the planting fee went to the vault");
    let p = &c.plants(None, None)[0];
    assert_eq!(p.cost.0, price);
    assert_eq!(p.note.as_deref(), Some("first block"));
    conserved(&c, &["alice.testnet"]);
}

#[test]
#[should_panic(expected = "NEAR attached")]
fn planting_needs_its_fee() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("alice.testnet", T0, 0);
    c.plant(cells(2, 2, patterns::BLOCK), None);
}

#[test]
#[should_panic(expected = "buffer")]
fn cannot_plant_next_to_a_rival() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 50);
    plant(&mut c, "bob.testnet", T0, cells(6, 2, patterns::BLOCK), None);
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
    let waiting = c.claimable("alice.testnet".parse().unwrap()).petri.0;
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
fn no_colony_takes_more_than_its_cap() {
    let mut c = new_dish();
    join(&mut c, "big.testnet", T0, "Big", 1, NEAR);
    plant(&mut c, "big.testnet", T0, cells(2, 2, patterns::PULSAR), None);
    join(&mut c, "small.testnet", T0, "Small", 2, NEAR / 50);
    plant(&mut c, "small.testnet", T0, cells(24, 26, patterns::BLOCK), None);
    at("keeper.testnet", T0 + GEN_MS);
    c.advance(Some(1));
    let big = c.claimable("big.testnet".parse().unwrap()).petri.0;
    let small = c.claimable("small.testnet".parse().unwrap()).petri.0;
    // The cap is max(15% of living cells, 8 cells), about 9 cells here: a pulsar of 48 or more cells counts as 9, the
    // block as 4, so the pulsar earns barely more than twice the block instead of twelve times.
    assert!(big > small && big * 4 <= small * 10, "big {} small {}", big, small);
    conserved(&c, &["big.testnet", "small.testnet"]);
}

#[test]
fn the_keeper_pot_goes_to_whoever_advances() {
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
    at("keeper.testnet", T0 + 4 * GEN_MS);
    c.advance(None);
    assert!(bal(&c, "keeper.testnet") > pot);
    assert_eq!(c.state().keeper_pot.0, 0);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn tides_pay_the_vault_out_by_territory() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    plant(&mut c, "alice.testnet", T0, cells(2, 2, patterns::BLOCK), None);
    join(&mut c, "bob.testnet", T0, "Bob", 2, NEAR / 50);
    let vault = c.state().vault.0;
    at("keeper.testnet", T0 + 8 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.tides.0, 1);
    let alice = c.claimable("alice.testnet".parse().unwrap()).near.0;
    assert_eq!(c.claimable("bob.testnet".parse().unwrap()).near.0, 0, "no cells, no share");
    assert_eq!(alice, vault / 2, "half the vault, all to the only living colony");
    assert_eq!(s.vault.0 + s.near_tides.0, s.near_in.0);
    at("alice.testnet", T0 + 8 * GEN_MS);
    assert_eq!(c.claim().near.0, alice);
    assert_eq!(c.claimable("alice.testnet".parse().unwrap()).near.0, 0);
}

#[test]
fn transfers_need_a_registered_receiver() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    assert!(c.storage_balance_of("bob.testnet".parse().unwrap()).is_none());
    ctx("bob.testnet", T0, NEAR / 100);
    c.storage_deposit(None, None);
    assert!(c.storage_balance_of("bob.testnet".parse().unwrap()).is_some());
    ctx("alice.testnet", T0, 1);
    c.ft_transfer("bob.testnet".parse().unwrap(), U128(1), None);
    assert_eq!(bal(&c, "bob.testnet"), 1, "small amounts move fine once registered");
    conserved(&c, &["alice.testnet", "bob.testnet"]);
}

#[test]
#[should_panic(expected = "not registered")]
fn transfers_to_strangers_fail() {
    let mut c = new_dish();
    join(&mut c, "alice.testnet", T0, "Alice", 1, NEAR / 50);
    ctx("alice.testnet", T0, 1);
    c.ft_transfer("bob.testnet".parse().unwrap(), U128(P), None);
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

#[test]
fn replaying_the_ledger_reproduces_the_dish_the_agar_and_the_earnings() {
    let mut c = new_dish();
    let mut t = T0;
    join(&mut c, "alice.testnet", t, "Alice", 1, NEAR / 20);
    plant(&mut c, "alice.testnet", t, cells(2, 2, patterns::GLIDER), Some("off we go"));
    join(&mut c, "bob.testnet", t, "Bob", 2, NEAR / 20);
    plant(&mut c, "bob.testnet", t, cells(18, 18, patterns::BEEHIVE), None);
    for g in 0..37u64 {
        t += GEN_MS;
        let who = if g % 2 == 0 { "alice.testnet" } else { "bob.testnet" };
        let x = 2 + ((g * 5) % 24) as i32;
        let d = c.plant_deposit(3, None).0;
        ctx(who, t, d);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.plant(cells(x, 28, patterns::BLINKER), None);
        }));
        if g % 9 == 0 {
            ctx(who, t, NEAR / 100);
            c.buy();
        }
        at("keeper.testnet", t);
        c.advance(None);
    }
    let s = c.state();
    let r = c.rules();
    // Replay the ledger with petri-core alone.
    let mut dish = Dish::new(32, 32);
    let mut chain = [0u8; 32];
    let mut agar = MAX;
    let mut earned = vec![0u128; 3];
    let mut colonies = 0u16;
    let log = c.ledger(None, Some(1000));
    let mut li = 0;
    let mut g = 0u64;
    loop {
        while li < log.len() {
            let gen = match &log[li] {
                Entry::Join { generation, .. } | Entry::Buy { generation, .. } | Entry::Plant { generation, .. } => generation.0,
            };
            if gen != g {
                break;
            }
            match &log[li] {
                Entry::Join { .. } => colonies += 1,
                Entry::Buy { petri, .. } => agar -= petri.0,
                Entry::Plant { colony, cells, cost, .. } => {
                    let per = feed_per_cell(agar, r.feed_ppm, r.keeper_bps, dish.total_live(), r.live_floor);
                    assert_eq!(plant_price(per, r.payback, r.min_cell_price.0, cells.len() as u32), cost.0, "price at generation {}", g);
                    agar += cost.0 - cost.0 * r.burn_bps as u128 / 10_000;
                    dish.plant_unchecked(*colony, cells);
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
        let f = feed(agar, r.feed_ppm, r.keeper_bps, r.cap_bps, r.cap_min, &stats.live);
        agar -= f.paid;
        for (i, v) in f.shares.iter().enumerate().skip(1) {
            earned[i] += v;
        }
    }
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    assert_eq!(agar, s.agar.0);
    let e = c.earnings(None, None);
    assert_eq!(e[0].0, earned[1]);
    assert_eq!(e[1].0, earned[2]);
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}
