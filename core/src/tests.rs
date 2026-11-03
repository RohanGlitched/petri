extern crate std;

use super::*;
use alloc::vec::Vec;
use proptest::prelude::*;

fn place(d: &mut Dish, colony: ColonyId, x: i32, y: i32, shape: &[(i32, i32)]) -> Vec<u32> {
    let cells: Vec<u32> = shape.iter().map(|&(dx, dy)| d.index(x + dx, y + dy) as u32).collect();
    d.plant_unchecked(colony, &cells);
    cells
}

fn live_set(d: &Dish) -> Vec<(i32, i32, ColonyId)> {
    (0..d.len()).filter(|&i| d.cells[i] != EMPTY).map(|i| {
        let (x, y) = d.xy(i);
        (x, y, d.cells[i])
    }).collect()
}

/// A plain reference implementation: Life, then ownership by plurality.
fn reference_step(d: &Dish) -> Dish {
    let mut out = Dish::new(d.width, d.height);
    for i in 0..d.len() {
        let (x, y) = d.xy(i);
        let mut parents = Vec::new();
        for dy in -1..=1 {
            for dx in -1..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let c = d.cells[d.index(x + dx, y + dy)];
                if c != EMPTY {
                    parents.push(c);
                }
            }
        }
        let me = d.cells[i];
        out.cells[i] = if me != EMPTY {
            if parents.len() == 2 || parents.len() == 3 { me } else { EMPTY }
        } else if parents.len() == 3 {
            let (a, b, c) = (parents[0], parents[1], parents[2]);
            if a == b || a == c { a } else if b == c { b } else { EMPTY }
        } else {
            EMPTY
        };
    }
    out
}

#[test]
fn block_is_still() {
    let mut d = Dish::new(16, 16);
    place(&mut d, 1, 5, 5, patterns::BLOCK);
    let before = d.clone();
    let s = d.step(1);
    assert_eq!(d, before);
    assert_eq!(s.live[1], 4);
    assert_eq!(s.births[1], 0);
    assert_eq!(s.deaths[1], 0);
}

#[test]
fn blinker_has_period_two() {
    let mut d = Dish::new(16, 16);
    place(&mut d, 2, 5, 5, patterns::BLINKER);
    let start = d.clone();
    d.step(2);
    assert_ne!(d, start);
    assert_eq!(live_set(&d), vec![(6, 4, 2), (6, 5, 2), (6, 6, 2)]);
    d.step(2);
    assert_eq!(d, start);
}

#[test]
fn glider_moves_one_cell_diagonally_every_four_generations() {
    let mut d = Dish::new(32, 32);
    place(&mut d, 3, 4, 4, patterns::GLIDER);
    let start: Vec<_> = live_set(&d).iter().map(|&(x, y, c)| (x + 1, y + 1, c)).collect();
    for _ in 0..4 {
        d.step(3);
    }
    assert_eq!(live_set(&d), start);
}

#[test]
fn glider_wraps_around_the_edges() {
    let mut d = Dish::new(16, 16);
    place(&mut d, 1, 14, 14, patterns::GLIDER);
    let start = d.clone();
    // 16 cells diagonally at a quarter cell per generation brings it home.
    for _ in 0..64 {
        d.step(1);
    }
    assert_eq!(d, start);
}

#[test]
fn birth_joins_the_majority_of_its_parents() {
    let mut d = Dish::new(16, 16);
    // Cell (5,5) has three parents: two of colony 1, one of colony 2.
    { let i = d.index(4, 4) as u32; d.plant_unchecked(1, &[i]); }
    { let i = d.index(5, 4) as u32; d.plant_unchecked(1, &[i]); }
    { let i = d.index(6, 4) as u32; d.plant_unchecked(2, &[i]); }
    d.step(2);
    assert_eq!(d.cells[d.index(5, 5)], 1);
    assert_eq!(d.cells[d.index(5, 3)], 1);
}

#[test]
fn three_colonies_leave_contested_ground() {
    let mut d = Dish::new(16, 16);
    { let i = d.index(4, 4) as u32; d.plant_unchecked(1, &[i]); }
    { let i = d.index(5, 4) as u32; d.plant_unchecked(2, &[i]); }
    { let i = d.index(6, 4) as u32; d.plant_unchecked(3, &[i]); }
    let s = d.step(3);
    assert_eq!(d.cells[d.index(5, 5)], EMPTY);
    assert_eq!(d.cells[d.index(5, 3)], EMPTY);
    assert_eq!(s.contested, 2);
}

#[test]
fn a_glider_converts_cells_it_hits() {
    // A glider of colony 2 flies into a block of colony 1. Some of the debris is born from colony 2 parents.
    let mut d = Dish::new(48, 48);
    place(&mut d, 1, 20, 20, patterns::BLOCK);
    place(&mut d, 2, 10, 10, patterns::GLIDER);
    let mut touched_one = false;
    for _ in 0..80 {
        let s = d.step(2);
        if s.births[2] > 0 && d.cells.iter().any(|&c| c == 1) {
            touched_one = true;
        }
    }
    assert!(touched_one);
    // Life's own outcome for this collision is deterministic; ownership just rides along.
    let mut plain = Dish::new(48, 48);
    place(&mut plain, 1, 20, 20, patterns::BLOCK);
    place(&mut plain, 1, 10, 10, patterns::GLIDER);
    for _ in 0..80 {
        plain.step(1);
    }
    let alive = |x: &Dish| x.cells.iter().map(|&c| c != EMPTY).collect::<Vec<_>>();
    assert_eq!(alive(&d), alive(&plain));
}

#[test]
fn gosper_gun_fires_a_glider_every_thirty_generations() {
    let mut d = Dish::new(96, 96);
    place(&mut d, 1, 2, 2, patterns::GOSPER_GUN);
    let n0 = d.cells.iter().filter(|&&c| c != EMPTY).count();
    for _ in 0..120 {
        d.step(1);
    }
    let n = d.cells.iter().filter(|&&c| c != EMPTY).count();
    // The gun is 36 cells at phase 0 and each glider adds 5.
    assert_eq!(n0, 36);
    assert_eq!(n, 36 + 4 * 5);
}

#[test]
fn plant_rules() {
    let mut d = Dish::new(32, 32);
    place(&mut d, 1, 10, 10, patterns::BLOCK);
    let at = |d: &Dish, x, y| d.index(x, y) as u32;
    assert_eq!(d.check_plant(2, &[], 3, 64), Err(PlantError::Empty));
    assert_eq!(d.check_plant(2, &[at(&d, 10, 10)], 3, 64), Err(PlantError::Occupied { index: at(&d, 10, 10) }));
    // Within three cells of colony 1's block.
    assert_eq!(d.check_plant(2, &[at(&d, 14, 10)], 3, 64), Err(PlantError::TooClose { index: at(&d, 14, 10), rival: 1 }));
    assert_eq!(d.check_plant(2, &[at(&d, 15, 10)], 3, 64), Ok(()));
    // The owner may plant next to its own cells.
    assert_eq!(d.check_plant(1, &[at(&d, 12, 10)], 3, 64), Ok(()));
    // The buffer wraps across edges.
    let mut e = Dish::new(32, 32);
    place(&mut e, 1, 0, 0, patterns::BLOCK);
    assert!(matches!(e.check_plant(2, &[at(&e, 30, 30)], 3, 64), Err(PlantError::TooClose { .. })));
    assert_eq!(d.check_plant(2, &[1000, 1000], 3, 64), Err(PlantError::Duplicate { index: 1000 }));
    assert_eq!(d.check_plant(2, &[5000], 3, 64), Err(PlantError::OutOfRange { index: 5000 }));
    let many: Vec<u32> = (0..65).map(|i| 600 + i).collect();
    assert_eq!(d.check_plant(2, &many, 3, 64), Err(PlantError::TooMany { max: 64 }));
}

#[test]
fn planting_gets_dearer_as_the_dish_fills() {
    assert_eq!(plant_cost(1_000_000, 4, 0, 1000), 4_000_000);
    assert_eq!(plant_cost(1_000_000, 4, 1000, 1000), 8_000_000);
    assert_eq!(plant_cost(1_000_000, 5, 3000, 1000), 20_000_000);
    assert_eq!(plant_cost(1_000_000, 1, 500, 0), 501_000_000);
}

#[test]
fn emission_split_is_proportional_and_never_overpays() {
    let s = split_emission(10_000_000, &[0, 3, 1, 0], 4);
    assert_eq!(s, vec![0, 7_500_000, 2_500_000, 0]);
    let s = split_emission(10, &[0, 1, 1, 1], 3);
    assert_eq!(s.iter().sum::<u128>(), 9);
    assert_eq!(split_emission(10, &[0, 0], 0), vec![0, 0]);
}

#[test]
fn bytes_and_hash_round_trip() {
    let mut d = Dish::new(16, 8);
    place(&mut d, 513, 3, 3, patterns::GLIDER);
    let b = d.to_bytes();
    let e = Dish::from_bytes(16, 8, &b).unwrap();
    assert_eq!(d, e);
    assert_eq!(d.hash(), e.hash());
    assert!(Dish::from_bytes(16, 8, &b[1..]).is_none());
    let c = d.to_compact();
    assert_eq!(c.len(), 8 * 8 + 2 * 5);
    assert_eq!(Dish::from_compact(16, 8, &c).unwrap(), d);
    assert!(Dish::from_compact(16, 8, &c[..c.len() - 2]).is_none());
    let mut extra = c.clone();
    extra.extend_from_slice(&[1, 0]);
    assert!(Dish::from_compact(16, 8, &extra).is_none());
    let h1 = chain_next(&[0; 32], 1, &d.hash());
    let h2 = chain_next(&[0; 32], 2, &d.hash());
    assert_ne!(h1, h2);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(200))]
    /// The fast step matches the plain reference on random dishes with up to five colonies.
    #[test]
    fn step_matches_reference(seed in proptest::collection::vec(0u16..6, 24 * 20), gens in 1usize..6) {
        let mut d = Dish::from_cells(24, 20, seed.iter().map(|&v| if v > 0 && v % 2 == 0 { v } else if v == 5 { 5 } else { 0 }).collect());
        for _ in 0..gens {
            let expected = reference_step(&d);
            let stats = d.step(5);
            prop_assert_eq!(&d, &expected);
            let counts = d.live_counts(5);
            prop_assert_eq!(&stats.live, &counts);
            prop_assert_eq!(stats.total_live, counts.iter().sum::<u32>());
        }
    }

    /// Ownership never changes how Life itself plays out, except where three colonies meet.
    #[test]
    fn two_colonies_play_exactly_like_life(seed in proptest::collection::vec(0u16..3, 20 * 20), gens in 1usize..12) {
        let mut d = Dish::from_cells(20, 20, seed.clone());
        let mut life = Dish::from_cells(20, 20, seed.iter().map(|&v| if v == 0 { 0 } else { 1 }).collect());
        for _ in 0..gens {
            let s = d.step(2);
            life.step(1);
            prop_assert_eq!(s.contested, 0);
            let a: Vec<bool> = d.cells.iter().map(|&c| c != 0).collect();
            let b: Vec<bool> = life.cells.iter().map(|&c| c != 0).collect();
            prop_assert_eq!(a, b);
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(60))]
    /// Rows that span several 64-bit words, including partial last words, wrap correctly.
    #[test]
    fn wide_dishes_match_reference(wi in 0usize..4, seed in proptest::collection::vec(0u16..9, 130 * 12), gens in 1usize..4) {
        let width = [64u16, 70, 128, 130][wi];
        let cells: Vec<u16> = seed[..width as usize * 12].iter().map(|&v| if v >= 3 && v <= 5 { v - 2 } else { 0 }).collect();
        let mut d = Dish::from_cells(width, 12, cells);
        for _ in 0..gens {
            let expected = reference_step(&d);
            let stats = d.step(3);
            prop_assert_eq!(&d, &expected);
            prop_assert_eq!(stats.total_live, d.total_live());
        }
    }
}

#[test]
fn the_feed_cap_bounds_one_colony_and_splitting_gains_nothing() {
    // One colony with 900 of 1,000 living cells counts as the cap (15% = 150 cells).
    let w = feed_weights(&[0, 900, 100], 1_500, 64);
    assert_eq!(w, vec![0, 150, 100]);
    let f = feed(1_000_000_000_000, 10, 200, 1_500, 64, &[0, 900, 100]);
    assert_eq!(f.keeper, 10_000_000 * 200 / 10_000);
    assert!(f.shares[1] * 100 / (f.shares[1] + f.shares[2]) == 60, "{:?}", f.shares);
    assert!(f.paid <= 10_000_000);
    // Ten small colonies of 10 earn exactly what one colony of 100 earns: weights are linear below the cap.
    let one = feed(1_000_000_000_000, 10, 200, 1_500, 64, &[0, 100, 900]);
    let mut many = vec![0u32];
    many.extend(std::iter::repeat(10).take(10));
    many.push(900);
    let ten = feed(1_000_000_000_000, 10, 200, 1_500, 64, &many);
    let ten_total: u128 = ten.shares[1..11].iter().sum();
    assert!(ten_total.abs_diff(one.shares[1]) <= 10, "{} vs {}", ten_total, one.shares[1]);
}

#[test]
fn an_empty_dish_is_fed_nothing() {
    let f = feed(1_000_000_000_000, 10, 200, 1_500, 64, &[0, 0, 0]);
    assert_eq!(f.paid, 0);
    assert_eq!(f.keeper, 0);
}

#[test]
fn the_agar_gets_dearer_as_it_empties() {
    let k = 200_000_000_000_000u128 * 1_000_000_000_000; // 0.0002 NEAR per PETRI × a million PETRI
    let near = 10u128.pow(22); // 0.01 NEAR
    let full = petri_for_near(near, 1_000_000_000_000, k);
    let half = petri_for_near(near, 500_000_000_000, k);
    assert!(full > 49_000_000 && full <= 50_000_000, "{}", full); // about 50 PETRI at launch
    assert!(half * 2 <= full + 1 && half * 2 >= full - 2, "half the agar, half the PETRI: {} vs {}", half, full);
    assert_eq!(petri_for_near(near, 0, k), 0);
    // A purchase can never take more than the agar holds.
    assert!(petri_for_near(10u128.pow(30), 1_000, k) <= 1_000);
}

#[test]
fn the_plant_price_follows_the_feed_with_a_floor() {
    let per = feed_per_cell(1_000_000_000_000, 10, 200, 100, 1_000);
    assert_eq!(per, 10_000_000 * 98 / 100 / 1_000);
    assert_eq!(plant_price(per, 480, 500_000, 4), 4 * per * 480);
    assert_eq!(plant_price(0, 480, 500_000, 4), 2_000_000);
}
