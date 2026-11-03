//! Petri economy simulator.
//!
//! Runs the real rules (petri-core: the Life step, the feed and the planting price) for days of generations with
//! scripted players, including adversaries, and reports who ends up with what. Used to choose the launch
//! parameters and published with them.
//!
//! cargo run --release -p petri-sim -- <out_dir> [days]

use petri_core::{feed, feed_per_cell, feed_weights, patterns, petri_for_near, plant_price, split_by_weight, Dish};
use std::fmt::Write as _;
use std::fs;

const UNIT: u128 = 1_000_000;
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const GENS_PER_DAY: u64 = 86_400 / 15;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    /// Still lifes near home.
    Builder,
    /// Gliders at the richest colony.
    Raider,
    /// Eaters and beehives.
    Defender,
    /// R-pentominoes whenever it can afford one: the grower that took 45% of the testnet dish.
    Methuselah,
    /// One of many accounts that each buy a small stake, plant it as blocks and never play again.
    Sybil,
    /// Buys 2 NEAR of PETRI at launch and plants big.
    Whale,
    /// Joins on day 2 and plays like a builder.
    Late,
}

struct Player {
    id: u16,
    kind: Kind,
    home: (i32, i32),
    joined: u64,
    credit: u128,
    balance: u128,
    spent: u128,
    earned: u128,
    earned_first_day: u128,
    near_paid: u128,
    near_earned: u128,
    every: u64,
    phase: u64,
}

#[derive(Clone)]
struct Params {
    name: &'static str,
    feed_ppm: u32,
    keeper_bps: u16,
    burn_bps: u128,
    payback: u32,
    floor: u128,
    live_floor: u32,
    /// Starter PETRI given free at join (the testnet launch rule); 0 in v2, where players buy in.
    grant: u128,
    /// Launch price of one PETRI in yoctoNEAR; the agar sells at launch price × full supply / agar.
    p0_per_petri: u128,
    cap_bps: u16,
    cap_min: u32,
    join_fee: u128,
    cell_fee: u128,
    tide_every: u64,
    tide_bps: u128,
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn range(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
}

fn shape_cells(d: &Dish, shape: &[(i32, i32)], x: i32, y: i32, rot: u8) -> Vec<u32> {
    shape
        .iter()
        .map(|&(dx, dy)| {
            let (mut a, mut b) = (dx, dy);
            for _ in 0..rot {
                let t = a;
                a = -b;
                b = t;
            }
            d.index(x + a, y + b) as u32
        })
        .collect()
}

fn centroid(d: &Dish, id: u16) -> Option<(i32, i32)> {
    let (mut sx, mut sy, mut n) = (0i64, 0i64, 0i64);
    for (i, &c) in d.cells.iter().enumerate() {
        if c == id {
            let (x, y) = d.xy(i);
            sx += x as i64;
            sy += y as i64;
            n += 1;
        }
    }
    (n > 0).then(|| ((sx / n) as i32, (sy / n) as i32))
}

fn gini(v: &[u128]) -> f64 {
    let mut x: Vec<f64> = v.iter().map(|&a| a as f64).collect();
    x.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = x.len() as f64;
    let sum: f64 = x.iter().sum();
    if sum == 0.0 {
        return 0.0;
    }
    x.iter().enumerate().map(|(i, v)| (2.0 * (i as f64 + 1.0) - n - 1.0) * v).sum::<f64>() / (n * sum)
}

fn shares(p: &Params, agar: u128, live: &[u32]) -> (Vec<u128>, u128, u128) {
    let f = feed(agar, p.feed_ppm, p.keeper_bps, p.cap_bps, p.cap_min, live);
    (f.shares, f.keeper, f.paid)
}

/// NEAR each kind brings to the dish at join, to buy its starting PETRI.
fn budget(kind: Kind) -> u128 {
    match kind {
        Kind::Whale => 2 * NEAR,
        Kind::Methuselah => NEAR / 10,
        Kind::Sybil => NEAR / 50,
        _ => NEAR / 20,
    }
}

fn f(u: u128) -> f64 {
    u as f64 / UNIT as f64
}

fn run(p: &Params, society: &[(Kind, usize)], days: u64, seed: u64, csv: &mut String) -> String {
    let total = days * GENS_PER_DAY;
    let mut d = Dish::new(128, 128);
    let mut rng = Rng(seed);
    let mut players: Vec<Player> = Vec::new();
    let mut id = 0u16;
    for &(kind, count) in society {
        for _ in 0..count {
            id += 1;
            players.push(Player {
                id,
                kind,
                home: (rng.range(128) as i32, rng.range(128) as i32),
                joined: if kind == Kind::Late { 2 * GENS_PER_DAY + rng.range(GENS_PER_DAY) } else { rng.range(120) },
                credit: 0,
                balance: 0,
                spent: 0,
                earned: 0,
                earned_first_day: 0,
                near_paid: 0,
                near_earned: 0,
                every: if kind == Kind::Methuselah { 12 } else { 20 + rng.range(100) },
                phase: rng.range(240),
            });
        }
    }
    let n = id;
    let mut agar = 1_000_000 * UNIT;
    let (mut burned, mut fed, mut keeper_pot, mut vault) = (0u128, 0u128, 0u128, 0u128);
    let mut peak = 0u32;
    let mut last_live = vec![0u32; n as usize + 1];
    for g in 0..total {
        let total_live = d.total_live();
        let per_cell = feed_per_cell(agar, p.feed_ppm, p.keeper_bps, total_live, p.live_floor);
        for pi in 0..players.len() {
            let pl = &mut players[pi];
            if g < pl.joined {
                continue;
            }
            if g == pl.joined {
                let grant = p.grant.min(agar);
                agar -= grant;
                pl.credit = grant;
                pl.near_paid += p.join_fee;
                vault += p.join_fee;
                if p.p0_per_petri > 0 {
                    let spend = budget(pl.kind);
                    let bought = petri_for_near(spend, agar, p.p0_per_petri * 1_000_000);
                    agar -= bought;
                    pl.balance += bought;
                    pl.near_paid += spend;
                    vault += spend;
                }
            }
            // Sybils plant their credit once, as blocks, and stop.
            if pl.kind == Kind::Sybil && pl.spent > 0 {
                continue;
            }
            if (g + pl.phase) % pl.every != 0 && !(pl.kind == Kind::Sybil && g == pl.joined) {
                continue;
            }
            let (shape, radius): (&[(i32, i32)], i32) = match pl.kind {
                Kind::Builder | Kind::Late | Kind::Sybil => match rng.range(3) {
                    0 => (patterns::BLOCK, 12),
                    1 => (patterns::BEEHIVE, 12),
                    _ => (patterns::LOAF, 12),
                },
                Kind::Raider => (if rng.range(3) == 0 { patterns::BLOCK } else { patterns::GLIDER }, 24),
                Kind::Defender => (if rng.range(2) == 0 { patterns::EATER } else { patterns::BEEHIVE }, 12),
                Kind::Methuselah => (patterns::R_PENTOMINO, 40),
                Kind::Whale => (if rng.range(2) == 0 { patterns::PULSAR } else { patterns::BEEHIVE }, 30),
            };
            let shape = if pl.kind == Kind::Sybil { patterns::BLOCK } else { shape };
            let cost = plant_price(per_cell, p.payback, p.floor, shape.len() as u32);
            let can = pl.credit + pl.balance;
            // Ordinary players keep a reserve; methuselah and sybils spend everything they can.
            let reckless = matches!(pl.kind, Kind::Methuselah | Kind::Sybil | Kind::Whale);
            if cost > can || (!reckless && cost > can / 2) {
                continue;
            }
            let (cx, cy) = centroid(&d, pl.id).unwrap_or(pl.home);
            let me = pl.id;
            let mut placed = None;
            for _ in 0..40 {
                let x = cx + rng.range(2 * radius as u64 + 1) as i32 - radius;
                let y = cy + rng.range(2 * radius as u64 + 1) as i32 - radius;
                let cells = shape_cells(&d, shape, x, y, rng.range(4) as u8);
                if d.check_plant(me, &cells, 3, 64).is_ok() {
                    placed = Some(cells);
                    break;
                }
            }
            if let Some(cells) = placed {
                d.plant_unchecked(me, &cells);
                let pl = &mut players[pi];
                let from_credit = cost.min(pl.credit);
                pl.credit -= from_credit;
                pl.balance -= cost - from_credit;
                pl.spent += cost;
                let fee = p.cell_fee * cells.len() as u128;
                pl.near_paid += fee;
                vault += fee;
                let burn = cost * p.burn_bps / 10_000;
                burned += burn;
                agar += cost - burn;
            }
        }
        let s = d.step(n);
        let (sh, keeper, paid) = shares(p, agar, &s.live);
        agar -= paid;
        fed += paid;
        keeper_pot += keeper;
        for c in 1..=n as usize {
            let pl = &mut players[c - 1];
            pl.balance += sh[c];
            pl.earned += sh[c];
            if g < pl.joined + GENS_PER_DAY {
                pl.earned_first_day += sh[c];
            }
        }
        if p.tide_every > 0 && (g + 1) % p.tide_every == 0 {
            let pay = vault * p.tide_bps / 10_000;
            let split = split_by_weight(pay, &feed_weights(&s.live, p.cap_bps, p.cap_min));
            for c in 1..=n as usize {
                players[c - 1].near_earned += split[c];
            }
            vault -= split.iter().sum::<u128>();
        }
        peak = peak.max(s.total_live);
        last_live = s.live.clone();
        if g % 240 == 0 {
            let _ = writeln!(csv, "{},{},{:.2},{},{:.0},{:.0},{:.0}", p.name, society_name(society), g as f64 / GENS_PER_DAY as f64, s.total_live, f(1_000_000 * UNIT - burned), f(agar), f(burned));
        }
    }
    // Who did best, per kind.
    let mut out = String::new();
    let total_live: u32 = last_live.iter().skip(1).sum();
    let top = players.iter().map(|pl| last_live[pl.id as usize]).max().unwrap_or(0);
    let earned: Vec<u128> = players.iter().map(|pl| pl.earned).collect();
    let total_earned: u128 = earned.iter().sum();
    let _ = writeln!(
        out,
        "{} / {}: day {}: live {} (peak {}), supply {:.0}, agar {:.0}, fed {:.0}, burned {:.0}, keeper pot {:.0}, largest colony {:.0}% of cells, gini of earnings {:.2}",
        p.name,
        society_name(society),
        days,
        total_live,
        peak,
        f(1_000_000 * UNIT - burned),
        f(agar),
        f(fed),
        f(burned),
        f(keeper_pot),
        100.0 * top as f64 / total_live.max(1) as f64,
        gini(&earned),
    );
    for kind in [Kind::Builder, Kind::Raider, Kind::Defender, Kind::Methuselah, Kind::Whale, Kind::Sybil, Kind::Late] {
        let k: Vec<&Player> = players.iter().filter(|pl| pl.kind == kind).collect();
        if k.is_empty() {
            continue;
        }
        let m = k.len() as f64;
        let e: u128 = k.iter().map(|pl| pl.earned).sum();
        let sp: u128 = k.iter().map(|pl| pl.spent).sum();
        let fd: u128 = k.iter().map(|pl| pl.earned_first_day).sum();
        let np: u128 = k.iter().map(|pl| pl.near_paid).sum();
        let ne: u128 = k.iter().map(|pl| pl.near_earned).sum();
        let _ = writeln!(
            out,
            "    {:?} x{}: earned {:.0} each ({:.0}% of all), spent {:.0} each, earned/spent {:.2}, first day {:.1} each, NEAR paid {:.4} each, NEAR won {:.4} each",
            kind,
            k.len(),
            f(e) / m,
            100.0 * e as f64 / total_earned.max(1) as f64,
            f(sp) / m,
            e as f64 / sp.max(1) as f64,
            f(fd) / m,
            np as f64 / NEAR as f64 / m,
            ne as f64 / NEAR as f64 / m,
        );
    }
    out
}

fn society_name(s: &[(Kind, usize)]) -> String {
    s.iter().map(|(k, n)| format!("{}{:?}", n, k)).collect::<Vec<_>>().join("+")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out_dir = args.get(1).cloned().unwrap_or_else(|| "sim-out".into());
    let days: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(7);
    fs::create_dir_all(&out_dir).unwrap();
    let v2 = Params {
        name: "v2",
        feed_ppm: 10,
        keeper_bps: 200,
        burn_bps: 5_000,
        payback: 480,
        floor: UNIT / 2,
        live_floor: 1_000,
        grant: 0,
        p0_per_petri: NEAR / 5_000,
        cap_bps: 1_500,
        cap_min: 64,
        join_fee: NEAR / 200,
        cell_fee: NEAR / 10_000,
        tide_every: 240,
        tide_bps: 5_000,
    };
    let variants = vec![
        // Close to what testnet launched with: free 64-PETRI grants, flat cheap price, 20 ppm, no cap, no buy-in.
        Params { name: "launch-like", feed_ppm: 20, payback: 0, floor: 2 * UNIT, grant: 64 * UNIT, p0_per_petri: 0, cap_bps: 10_000, ..v2.clone() },
        v2.clone(),
        Params { name: "v2-uncapped", cap_bps: 10_000, ..v2.clone() },
        Params { name: "v2-cap-10", cap_bps: 1_000, ..v2.clone() },
        Params { name: "v2-payback-240", payback: 240, ..v2.clone() },
        Params { name: "v2-payback-960", payback: 960, ..v2.clone() },
        Params { name: "v2-20ppm", feed_ppm: 20, ..v2.clone() },
    ];
    let societies: Vec<Vec<(Kind, usize)>> = vec![
        vec![(Kind::Builder, 6), (Kind::Raider, 3), (Kind::Defender, 2), (Kind::Late, 4)],
        vec![(Kind::Builder, 6), (Kind::Raider, 3), (Kind::Defender, 2), (Kind::Methuselah, 1), (Kind::Late, 4)],
        vec![(Kind::Builder, 6), (Kind::Raider, 3), (Kind::Defender, 2), (Kind::Whale, 1), (Kind::Sybil, 30), (Kind::Late, 4)],
    ];
    let mut csv = String::from("params,society,day,live,supply,agar,burned\n");
    let mut summary = String::new();
    for p in &variants {
        for (si, s) in societies.iter().enumerate() {
            let line = run(p, s, days, 0x9E3779B97F4A7C15 ^ (si as u64 + 1) * 7919, &mut csv);
            print!("{}", line);
            summary.push_str(&line);
        }
    }
    fs::write(format!("{}/timeline.csv", out_dir), csv).unwrap();
    fs::write(format!("{}/summary.txt", out_dir), summary).unwrap();
}
