use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use petri_core::patterns;

const MS: u64 = 1_000_000; // nanoseconds per millisecond
const GEN_MS: u64 = 15_000;
const P: u128 = 1_000_000;
const MAX: u128 = 1_000_000 * P;

fn rules() -> Rules {
    Rules {
        width: 32,
        height: 32,
        generation_ms: U64(GEN_MS),
        max_supply: U128(MAX),
        feed_ppm: 10,
        keeper_bps: 200,
        burn_bps: 5_000,
        plant_cost: U128(P),
        capacity: u32::MAX,
        starter_grant: U128(64 * P),
        buffer: 3,
        max_plant_cells: 64,
        max_catchup: 40,
    }
}

fn at(who: &str, ms: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who.parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .block_timestamp(ms * MS);
    testing_env!(b.build());
}

fn pay1(who: &str, ms: u64) {
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id(who.parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .block_timestamp(ms * MS)
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
}

fn cells(x: i32, y: i32, shape: &[(i32, i32)]) -> Vec<u32> {
    let d = Dish::new(32, 32);
    shape.iter().map(|&(dx, dy)| d.index(x + dx, y + dy) as u32).collect()
}

fn bal(c: &Petri, who: &str) -> u128 {
    c.ft_balance_of(who.parse().unwrap()).0
}

/// Nothing is created or lost: every PETRI is in the agar, in an account, or burned.
fn conserved(c: &Petri, holders: &[&str]) {
    let s = c.state();
    assert_eq!(s.total_supply.0, MAX - s.burned.0, "supply = launch supply - burned");
    let held: u128 = holders.iter().map(|h| bal(c, h)).sum();
    assert_eq!(held + s.agar.0, s.total_supply.0, "agar + balances = supply");
    assert_eq!(c.ft_total_supply().0, s.total_supply.0);
    assert_eq!(s.agar.0, MAX - s.granted.0 - s.fed.0 + s.returned.0, "agar = launch - grants - feed + returns");
}

fn new_dish() -> Petri {
    at("owner.testnet", 1_000_000);
    Petri::new(rules())
}

#[test]
fn launch_puts_every_petri_in_the_agar() {
    let c = new_dish();
    let s = c.state();
    assert_eq!(s.agar.0, MAX);
    assert_eq!(s.total_supply.0, MAX);
    assert_eq!(c.ft_balance_of("petri.testnet".parse().unwrap()).0, MAX);
    conserved(&c, &[]);
}

#[test]
fn join_grants_from_the_agar_and_planting_burns_half() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    let col = c.join("Alice".into(), 0x7B2D8E);
    assert_eq!(col.id, 1);
    assert_eq!(bal(&c, "alice.testnet"), 64 * P);
    c.plant(cells(4, 4, patterns::BLOCK), None);
    // Four cells at 1 PETRI: 2 burned, 2 back to the agar.
    assert_eq!(bal(&c, "alice.testnet"), 60 * P);
    let s = c.state();
    assert_eq!(s.burned.0, 2 * P);
    assert_eq!(s.returned.0, 2 * P);
    assert_eq!(s.agar.0, MAX - 64 * P + 2 * P);
    assert_eq!(s.total_live, 4);
    assert_eq!(c.plants(None, None).len(), 1);
    conserved(&c, &["alice.testnet"]);
}

#[test]
#[should_panic(expected = "already has a colony")]
fn one_colony_per_account() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.join("Again".into(), 2);
}

#[test]
fn the_agar_feeds_a_still_life_every_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(4, 4, patterns::BLOCK), None);
    let agar0 = c.state().agar.0;
    at("keeper.testnet", 1_000_000 + 10 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.generation.0, 10);
    // Ten feeds of 10 ppm each, compounding on a shrinking agar.
    let mut a = agar0;
    let mut keeper = 0u128;
    for _ in 0..10 {
        let feed = a * 10 / 1_000_000;
        keeper += feed * 200 / 10_000;
        a -= feed;
    }
    assert_eq!(s.agar.0, a);
    assert_eq!(bal(&c, "keeper.testnet"), keeper);
    assert_eq!(bal(&c, "alice.testnet"), 60 * P + (agar0 - a) - keeper);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
fn feed_is_shared_by_live_cells() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), None);
    at("bob.testnet", 1_000_000);
    c.join("Bob".into(), 2);
    c.plant(cells(20, 20, patterns::BEEHIVE), None);
    let agar0 = c.state().agar.0;
    at("keeper.testnet", 1_000_000 + GEN_MS);
    c.advance(None);
    let feed = agar0 * 10 / 1_000_000;
    let share = feed - feed * 200 / 10_000;
    assert_eq!(bal(&c, "alice.testnet") - 60 * P, share * 4 / 10);
    assert_eq!(bal(&c, "bob.testnet") - 58 * P, share * 6 / 10);
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "inside colony 1's buffer")]
fn cannot_plant_next_to_a_rival() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(10, 10, patterns::BLOCK), None);
    at("bob.testnet", 1_000_000);
    c.join("Bob".into(), 2);
    c.plant(cells(13, 10, &[(0, 0)]), None);
}

#[test]
#[should_panic(expected = "one planting per generation")]
fn one_planting_per_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), None);
    c.plant(cells(20, 20, patterns::BLOCK), None);
}

#[test]
fn plant_again_next_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), None);
    at("alice.testnet", 1_000_000 + GEN_MS);
    c.plant(cells(20, 20, patterns::BLOCK), None);
    assert_eq!(c.state().total_live, 8);
}

#[test]
#[should_panic(expected = "costs 9 PETRI; you hold 4")]
fn planting_needs_petri() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(1, 1, patterns::PULSAR), None);
    assert_eq!(bal(&c, "alice.testnet"), 16 * P);
    let t = 1_000_000 + GEN_MS;
    at("alice.testnet", t);
    c.advance(None);
    let b = bal(&c, "alice.testnet");
    pay1("alice.testnet", t);
    c.ft_transfer("bob.testnet".parse().unwrap(), U128(b - 4 * P), None);
    at("alice.testnet", t);
    c.plant(cells(20, 20, patterns::LWSS), None);
}

#[test]
fn planting_price_rises_with_the_population() {
    let mut r = rules();
    r.capacity = 4;
    at("owner.testnet", 1_000_000);
    let mut c = Petri::new(r);
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    assert_eq!(c.quote(4).0, 4 * P);
    c.plant(cells(2, 2, patterns::BLOCK), None);
    // Four cells alive with capacity four: twice the base price.
    assert_eq!(c.quote(4).0, 8 * P);
    at("alice.testnet", 1_000_000 + GEN_MS);
    c.plant(cells(20, 20, patterns::BLOCK), None);
    // Alice advanced that generation, so the whole feed (keeper share included) was hers.
    let fed = c.state().fed.0;
    assert_eq!(bal(&c, "alice.testnet"), 64 * P - 4 * P - 8 * P + fed);
    conserved(&c, &["alice.testnet"]);
}

#[test]
fn catch_up_is_capped_and_plant_waits_for_the_clock() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), None);
    at("keeper.testnet", 1_000_000 + 100 * GEN_MS);
    c.advance(None);
    assert_eq!(c.state().generation.0, 40);
    assert_eq!(c.state().due_generation.0, 100);
    c.advance(Some(30));
    assert_eq!(c.state().generation.0, 70);
    c.advance(None);
    assert_eq!(c.state().generation.0, 100);
    conserved(&c, &["alice.testnet", "keeper.testnet"]);
}

#[test]
#[should_panic(expected = "behind the clock")]
fn plant_refuses_when_far_behind() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    at("alice.testnet", 1_000_000 + 100 * GEN_MS);
    c.plant(cells(2, 2, patterns::BLOCK), None);
}

#[test]
fn replaying_the_plant_log_reproduces_the_board_and_chain() {
    let mut c = new_dish();
    let mut t = 1_000_000;
    at("alice.testnet", t);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::GLIDER), None);
    at("bob.testnet", t);
    c.join("Bob".into(), 2);
    c.plant(cells(18, 18, patterns::GOSPER_GUN[..20].as_ref()), None);
    for g in 0..37 {
        t += GEN_MS;
        at(if g % 2 == 0 { "alice.testnet" } else { "bob.testnet" }, t);
        let x = 2 + (g * 5) % 24;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.plant(cells(x, 28, patterns::BLINKER), None);
        }));
        at("keeper.testnet", t);
        c.advance(None);
    }
    let s = c.state();
    let log = c.plants(None, Some(1000));
    let mut dish = Dish::new(32, 32);
    let mut chain = [0u8; 32];
    let mut li = 0;
    for g in 0..=s.generation.0 {
        while li < log.len() && log[li].generation.0 == g {
            dish.plant_unchecked(log[li].colony, &log[li].cells);
            li += 1;
        }
        if g == s.generation.0 {
            break;
        }
        dish.step(s.colonies);
        if petri_core::chain_due(g + 1) {
            chain = chain_next(&chain, g + 1, &dish.hash());
        }
    }
    assert_eq!(hex::encode(chain), s.chain);
    assert_eq!(hex::encode(dish.hash()), s.board_hash);
    conserved(&c, &["alice.testnet", "bob.testnet", "keeper.testnet"]);
}

#[test]
fn a_planting_can_carry_a_lab_note() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), Some("  holding the north rim  ".into()));
    at("alice.testnet", 1_000_000 + GEN_MS);
    c.plant(cells(20, 20, patterns::BLOCK), None);
    let p = c.plants(None, None);
    assert_eq!(p[0].note.as_deref(), Some("holding the north rim"));
    assert_eq!(p[1].note, None);
}

#[test]
#[should_panic(expected = "at most 140 characters")]
fn lab_notes_are_short() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK), Some("x".repeat(141)));
}

#[test]
fn transfers_and_metadata() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    pay1("alice.testnet", 1_000_000);
    c.ft_transfer("carol.testnet".parse().unwrap(), U128(5 * P), None);
    assert_eq!(bal(&c, "carol.testnet"), 5 * P);
    assert_eq!(c.ft_metadata().symbol, "PETRI");
    conserved(&c, &["alice.testnet", "carol.testnet"]);
}

#[test]
#[should_panic(expected = "only by planting")]
fn nobody_can_send_petri_to_the_agar() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    pay1("alice.testnet", 1_000_000);
    c.ft_transfer("petri.testnet".parse().unwrap(), U128(5 * P), None);
}

#[test]
#[should_panic(expected = "at least 1 PETRI")]
fn dust_to_a_new_holder_is_refused() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    pay1("alice.testnet", 1_000_000);
    c.ft_transfer("dust.testnet".parse().unwrap(), U128(1), None);
}

#[test]
fn an_empty_dish_feeds_nobody() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    at("keeper.testnet", 1_000_000 + 30 * GEN_MS);
    c.advance(None);
    let s = c.state();
    assert_eq!(s.fed.0, 0);
    assert_eq!(bal(&c, "keeper.testnet"), 0);
    conserved(&c, &["alice.testnet"]);
}
