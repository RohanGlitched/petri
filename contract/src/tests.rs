use super::*;
use near_sdk::test_utils::VMContextBuilder;
use near_sdk::testing_env;
use petri_core::patterns;

const MS: u64 = 1_000_000; // nanoseconds per millisecond
const GEN_MS: u64 = 15_000;
const P: u128 = 1_000_000;

fn rules() -> Rules {
    Rules {
        width: 32,
        height: 32,
        generation_ms: U64(GEN_MS),
        emission_per_generation: U128(10 * P),
        keeper_bps: 200,
        plant_cost: U128(P),
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

fn cells(x: i32, y: i32, shape: &[(i32, i32)]) -> Vec<u32> {
    let d = Dish::new(32, 32);
    shape.iter().map(|&(dx, dy)| d.index(x + dx, y + dy) as u32).collect()
}

fn supply_holds(c: &Petri) {
    let s = c.state();
    assert_eq!(s.total_supply.0, s.granted.0 + s.emitted.0 - s.burned.0, "supply = grants + emission - burns");
}

fn new_dish() -> Petri {
    at("owner.testnet", 1_000_000);
    Petri::new(rules())
}

#[test]
fn join_grants_and_plant_burns() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    let col = c.join("Alice".into(), 0x7B2D8E);
    assert_eq!(col.id, 1);
    assert_eq!(c.ft_balance_of("alice.testnet".parse().unwrap()).0, 64 * P);
    c.plant(cells(4, 4, patterns::BLOCK));
    assert_eq!(c.ft_balance_of("alice.testnet".parse().unwrap()).0, 60 * P);
    assert_eq!(c.state().total_live, 4);
    assert_eq!(c.plants(None, None).len(), 1);
    supply_holds(&c);
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
fn a_still_life_earns_emission_every_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(4, 4, patterns::BLOCK));
    at("keeper.testnet", 1_000_000 + 10 * GEN_MS);
    c.advance(None);
    assert_eq!(c.state().generation.0, 10);
    // 98% of 10 PETRI per generation to the only colony, 2% to the keeper.
    assert_eq!(c.ft_balance_of("alice.testnet".parse().unwrap()).0, 60 * P + 10 * 98 * P / 10);
    assert_eq!(c.ft_balance_of("keeper.testnet".parse().unwrap()).0, 10 * 2 * P / 10);
    supply_holds(&c);
}

#[test]
fn emission_is_shared_by_live_cells() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK));
    at("bob.testnet", 1_000_000);
    c.join("Bob".into(), 2);
    c.plant(cells(20, 20, patterns::BEEHIVE));
    at("keeper.testnet", 1_000_000 + GEN_MS);
    c.advance(None);
    let a = c.ft_balance_of("alice.testnet".parse().unwrap()).0 - 60 * P;
    let b = c.ft_balance_of("bob.testnet".parse().unwrap()).0 - 58 * P;
    // 4 cells against 6 cells of the 9.8 PETRI.
    assert_eq!(a, 98 * P / 10 * 4 / 10);
    assert_eq!(b, 98 * P / 10 * 6 / 10);
    supply_holds(&c);
}

#[test]
#[should_panic(expected = "inside colony 1's buffer")]
fn cannot_plant_next_to_a_rival() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(10, 10, patterns::BLOCK));
    at("bob.testnet", 1_000_000);
    c.join("Bob".into(), 2);
    c.plant(cells(13, 10, &[(0, 0)]));
}

#[test]
#[should_panic(expected = "one planting per generation")]
fn one_planting_per_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK));
    c.plant(cells(20, 20, patterns::BLOCK));
}

#[test]
fn plant_again_next_generation() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK));
    at("alice.testnet", 1_000_000 + GEN_MS);
    c.plant(cells(20, 20, patterns::BLOCK));
    assert_eq!(c.state().total_live, 8);
}

#[test]
#[should_panic(expected = "costs 9 PETRI; you hold 4")]
fn planting_needs_petri() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(1, 1, patterns::PULSAR));
    assert_eq!(c.ft_balance_of("alice.testnet".parse().unwrap()).0, 64 * P - 48 * P);
    let t = 1_000_000 + GEN_MS;
    at("alice.testnet", t);
    c.advance(None);
    let bal = c.ft_balance_of("alice.testnet".parse().unwrap()).0;
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id("alice.testnet".parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .block_timestamp(t * MS)
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    c.ft_transfer("bob.testnet".parse().unwrap(), U128(bal - 4 * P), None);
    at("alice.testnet", t);
    c.plant(cells(20, 20, patterns::LWSS));
}

#[test]
fn catch_up_is_capped_and_plant_waits_for_the_clock() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::BLOCK));
    at("keeper.testnet", 1_000_000 + 100 * GEN_MS);
    c.advance(None);
    assert_eq!(c.state().generation.0, 40);
    assert_eq!(c.state().due_generation.0, 100);
    c.advance(Some(30));
    assert_eq!(c.state().generation.0, 70);
    c.advance(None);
    assert_eq!(c.state().generation.0, 100);
    supply_holds(&c);
}

#[test]
#[should_panic(expected = "behind the clock")]
fn plant_refuses_when_far_behind() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    at("alice.testnet", 1_000_000 + 100 * GEN_MS);
    c.plant(cells(2, 2, patterns::BLOCK));
}

#[test]
fn replaying_the_plant_log_reproduces_the_board_and_chain() {
    let mut c = new_dish();
    let mut t = 1_000_000;
    at("alice.testnet", t);
    c.join("Alice".into(), 1);
    c.plant(cells(2, 2, patterns::GLIDER));
    at("bob.testnet", t);
    c.join("Bob".into(), 2);
    c.plant(cells(18, 18, patterns::GOSPER_GUN[..20].as_ref()));
    for g in 0..37 {
        t += GEN_MS;
        at(if g % 2 == 0 { "alice.testnet" } else { "bob.testnet" }, t);
        let x = 2 + (g * 5) % 24;
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.plant(cells(x, 28, patterns::BLINKER));
        }));
        at("keeper.testnet", t);
        c.advance(None);
    }
    // Replay.
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
}

#[test]
fn transfers_and_metadata() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id("alice.testnet".parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    c.ft_transfer("carol.testnet".parse().unwrap(), U128(5 * P), None);
    assert_eq!(c.ft_balance_of("carol.testnet".parse().unwrap()).0, 5 * P);
    assert_eq!(c.ft_metadata().symbol, "PETRI");
    supply_holds(&c);
}

#[test]
#[should_panic(expected = "at least 1 PETRI")]
fn dust_to_a_new_holder_is_refused() {
    let mut c = new_dish();
    at("alice.testnet", 1_000_000);
    c.join("Alice".into(), 1);
    let mut b = VMContextBuilder::new();
    b.predecessor_account_id("alice.testnet".parse().unwrap())
        .current_account_id("petri.testnet".parse().unwrap())
        .attached_deposit(NearToken::from_yoctonear(1));
    testing_env!(b.build());
    c.ft_transfer("dust.testnet".parse().unwrap(), U128(1), None);
}
