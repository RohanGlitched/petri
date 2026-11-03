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
    let free = PlantCheck { siege: false, rival: None };
    let siege = PlantCheck { siege: true, rival: Some(1) };
    assert_eq!(d.check_plant(2, &[], 3, 64), Err(PlantError::Empty));
    assert_eq!(d.check_plant(2, &[at(&d, 10, 10)], 3, 64), Err(PlantError::Occupied { index: at(&d, 10, 10) }));
    // Within three cells of colony 1's block: allowed, as a siege.
    assert_eq!(d.check_plant(2, &[at(&d, 14, 10)], 3, 64), Ok(siege));
    assert_eq!(d.check_plant(2, &[at(&d, 15, 10)], 3, 64), Ok(free));
    // One cell inside the buffer makes the whole planting a siege.
    assert_eq!(d.check_plant(2, &[at(&d, 20, 20), at(&d, 14, 11)], 3, 64), Ok(siege));
    // The owner may plant next to its own cells.
    assert_eq!(d.check_plant(1, &[at(&d, 12, 10)], 3, 64), Ok(free));
    // The buffer wraps across edges.
    let mut e = Dish::new(32, 32);
    place(&mut e, 1, 0, 0, patterns::BLOCK);
    assert_eq!(e.check_plant(2, &[at(&e, 30, 30)], 3, 64), Ok(siege));
    assert_eq!(d.check_plant(2, &[1000, 1000], 3, 64), Err(PlantError::Duplicate { index: 1000 }));
    assert_eq!(d.check_plant(2, &[5000], 3, 64), Err(PlantError::OutOfRange { index: 5000 }));
    let many: Vec<u32> = (0..65).map(|i| 600 + i).collect();
    assert_eq!(d.check_plant(2, &many, 3, 64), Err(PlantError::TooMany { max: 64 }));
}

#[test]
fn a_siege_costs_the_surcharge() {
    assert_eq!(planting_cost(2_000, 480, 500_000, 4, false, 4), 4 * 960_000);
    assert_eq!(planting_cost(2_000, 480, 500_000, 4, true, 4), 16 * 960_000);
    assert_eq!(planting_cost(0, 480, 500_000, 2, true, 3), 3_000_000);
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
fn the_feed_is_capped_by_what_a_colony_planted() {
    // Colony 1 planted 10 cells and grew to 900: with reach 8 it is paid for at most 80. Colony 2 planted 100 and has 100.
    assert_eq!(feed_weight(900, 10, 8), 80);
    assert_eq!(feed_weight(100, 100, 8), 100);
    let f = feed(1_000_000_000_000, 10, 200, 8, &[0, 900, 100], &[0, 10, 100]);
    assert_eq!(f.keeper, 10_000_000 * 200 / 10_000);
    let s1 = f.shares.iter().find(|s| s.0 == 1).unwrap().1;
    let s2 = f.shares.iter().find(|s| s.0 == 2).unwrap().1;
    assert_eq!(s1 * 100 / (s1 + s2), 44, "{:?}", f.shares);
    assert!(f.paid <= 10_000_000);
    // A colony that never planted (it only received births) is paid nothing.
    let f = feed(1_000_000_000_000, 10, 200, 8, &[0, 50, 50], &[0, 0, 50]);
    assert_eq!(f.shares.len(), 1);
    assert_eq!(f.shares[0].0, 2);
}

proptest! {
    /// Splitting the same cells and the same plantings across any number of colonies never earns more.
    #[test]
    fn splitting_never_earns_more(parts in proptest::collection::vec((1u32..400, 1u64..100), 1..12), rival in 1u32..2000, rival_planted in 1u64..500) {
        let reach = 8;
        let (live_sum, planted_sum) = parts.iter().fold((0u32, 0u64), |a, p| (a.0 + p.0, a.1 + p.1));
        let one = feed(1_000_000_000_000, 10, 200, reach, &[0, live_sum, rival], &[0, planted_sum, rival_planted]);
        let one_share = one.shares.iter().filter(|s| s.0 == 1).map(|s| s.1).sum::<u128>();
        let mut live = alloc::vec![0u32];
        let mut planted = alloc::vec![0u64];
        for p in &parts {
            live.push(p.0);
            planted.push(p.1);
        }
        live.push(rival);
        planted.push(rival_planted);
        let split = feed(1_000_000_000_000, 10, 200, reach, &live, &planted);
        let split_share = split.shares.iter().filter(|s| (s.0 as usize) <= parts.len()).map(|s| s.1).sum::<u128>();
        // Integer rounding may move a few units either way.
        prop_assert!(split_share <= one_share + parts.len() as u128 + 1, "split {} vs one {}", split_share, one_share);
    }
}

#[test]
fn an_empty_dish_is_fed_nothing() {
    let f = feed(1_000_000_000_000, 10, 200, 8, &[0, 0, 0], &[0, 5, 5]);
    assert_eq!(f.paid, 0);
    assert_eq!(f.keeper, 0);
}

#[test]
fn tides_follow_the_window_and_skip_the_house() {
    // Colony 1 earned 300 in the window, colony 2 earned 100, colony 3 is the house.
    let (split, paid) = tide_split(1_000, &[0, 300, 100, 600], &[3]);
    assert_eq!(split, alloc::vec![(1, 750), (2, 250)]);
    assert_eq!(paid, 1_000);
    // A colony that arrived one generation before the tide gets a sliver.
    let (split, _) = tide_split(1_000_000, &[0, 23_999, 1], &[]);
    assert_eq!(split[1], (2, 41));
    assert_eq!(tide_split(1_000, &[0, 0, 0], &[]).1, 0);
    assert_eq!(tide_split(1_000, &[0, 5], &[1]).1, 0);
    // No overflow on large vaults.
    let (_, paid) = tide_split(u128::MAX / 4, &[0, u64::MAX / 2, u64::MAX / 2], &[]);
    assert!(paid <= u128::MAX / 4);
}

#[test]
fn selling_back_always_loses_against_buying() {
    let k = 200_000_000_000_000u128 * 1_000_000_000_000;
    let agar = 900_000_000_000u128;
    let near = 10u128.pow(22);
    let units = petri_for_near(near, agar, k);
    let back = near_for_petri(units, agar - units, k, 5_000);
    assert!(back < near / 2 + near / 1000 && back > near / 2 - near / 100, "{} for {}", back, near);
    assert_eq!(near_for_petri(0, agar, k, 5_000), 0);
    // No overflow for the whole supply.
    assert!(near_for_petri(1_000_000_000_000, 1_000_000_000_000, k, 5_000) > 0);
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
