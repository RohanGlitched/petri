//! Petri economy simulator.
//!
//! Runs the real rules (petri-core) for weeks of generations with scripted players, and writes the supply, burn,
//! population and inequality over time. Used to choose the launch parameters and published with them.
//!
//! cargo run --release -p petri-sim -- <out_dir> [days]

use petri_core::{patterns, plant_cost, split_emission, Dish};
use std::fmt::Write as _;
use std::fs;

const UNIT: u128 = 1_000_000;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Builder,
    Raider,
    Defender,
    Chaos,
}

struct Player {
    id: u16,
    kind: Kind,
    home: (i32, i32),
    balance: u128,
    burned: u128,
    earned: u128,
    every: u64,
    phase: u64,
    last_plant: Option<u64>,
}

#[derive(Clone)]
struct Params {
    name: &'static str,
    width: u16,
    /// Total PETRI, all of it in the agar at launch.
    max_supply: u128,
    /// Share of the agar paid to the living each generation, in parts per million.
    feed_ppm: u128,
    /// Share of a planting's cost that is burned; the rest returns to the agar.
    burn_bps: u128,
    keeper_bps: u128,
    base_cost: u128,
    capacity: u32,
    grant: u128,
    buffer: u16,
    max_cells: u32,
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        // xorshift64*
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

fn centroid(d: &Dish, id: u16) -> Option<(i32, i32, u32)> {
    let mut sx = 0i64;
    let mut sy = 0i64;
    let mut n = 0u32;
    for (i, &c) in d.cells.iter().enumerate() {
        if c == id {
            let (x, y) = d.xy(i);
            sx += x as i64;
            sy += y as i64;
            n += 1;
        }
    }
    if n == 0 {
        None
    } else {
        Some(((sx / n as i64) as i32, (sy / n as i64) as i32, n))
    }
}

fn gini(v: &[u128]) -> f64 {
    let mut x: Vec<f64> = v.iter().map(|&a| a as f64).collect();
    x.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = x.len() as f64;
    let sum: f64 = x.iter().sum();
    if sum == 0.0 {
        return 0.0;
    }
    let mut acc = 0.0;
    for (i, v) in x.iter().enumerate() {
        acc += (2.0 * (i as f64 + 1.0) - n - 1.0) * v;
    }
    acc / (n * sum)
}

fn run(p: &Params, society: &[(Kind, usize)], days: u64, seed: u64, out: &mut String) -> String {
    let gens_per_day = 86_400 / 15;
    let total = days * gens_per_day;
    let mut d = Dish::new(p.width, p.width);
    let mut rng = Rng(seed);
    let mut players: Vec<Player> = Vec::new();
    let mut id = 0u16;
    for &(kind, count) in society {
        for _ in 0..count {
            id += 1;
            players.push(Player {
                id,
                kind,
                home: (rng.range(p.width as u64) as i32, rng.range(p.width as u64) as i32),
                balance: p.grant,
                burned: 0,
                earned: 0,
                every: 20 + rng.range(100),
                phase: rng.range(240),
                last_plant: None,
            });
        }
    }
    let n = id;
    let mut agar = p.max_supply - p.grant * n as u128;
    let (mut supply, mut emitted, mut burned) = (p.max_supply, 0u128, 0u128);
    let mut keeper_earned = 0u128;
    let mut summary = String::new();
    let mut peak_live = 0u32;
    for g in 0..total {
        let total_live = d.total_live();
        // Players act on their own schedules.
        for pi in 0..players.len() {
            let pl = &players[pi];
            if (g + pl.phase) % pl.every != 0 {
                continue;
            }
            if pl.last_plant == Some(g) {
                continue;
            }
            let kind = pl.kind;
            let me = pl.id;
            let mine = centroid(&d, me);
            let (shape, label): (&[(i32, i32)], &str) = match kind {
                Kind::Builder => match rng.range(3) {
                    0 => (patterns::BLOCK, "block"),
                    1 => (patterns::BEEHIVE, "beehive"),
                    _ => (patterns::LOAF, "loaf"),
                },
                Kind::Raider => {
                    if rng.range(3) == 0 { (patterns::BLOCK, "block") } else { (patterns::GLIDER, "glider") }
                }
                Kind::Defender => {
                    if rng.range(2) == 0 { (patterns::EATER, "eater") } else { (patterns::BEEHIVE, "beehive") }
                }
                Kind::Chaos => {
                    if rng.range(4) == 0 { (patterns::R_PENTOMINO, "r") } else { (patterns::BLOCK, "block") }
                }
            };
            let _ = label;
            let cost = plant_cost(p.base_cost, shape.len() as u32, total_live, p.capacity);
            // Players keep a reserve: they spend at most half of what they hold on one planting.
            if cost > players[pi].balance / 2 && cost > players[pi].balance.saturating_sub(4 * UNIT) {
                continue;
            }
            let (cx, cy) = match mine {
                Some((x, y, _)) => (x, y),
                None => players[pi].home,
            };
            let radius = match kind {
                Kind::Raider => 24,
                _ => 12,
            };
            let mut placed = None;
            for _ in 0..40 {
                let x = cx + rng.range(2 * radius + 1) as i32 - radius as i32;
                let y = cy + rng.range(2 * radius + 1) as i32 - radius as i32;
                let rot = rng.range(4) as u8;
                let cells = shape_cells(&d, shape, x, y, rot);
                if d.check_plant(me, &cells, p.buffer, p.max_cells).is_ok() {
                    placed = Some(cells);
                    break;
                }
            }
            if let Some(cells) = placed {
                d.plant_unchecked(me, &cells);
                let pl = &mut players[pi];
                pl.balance -= cost;
                pl.burned += cost;
                pl.last_plant = Some(g);
                let burn = cost * p.burn_bps / 10_000;
                supply -= burn;
                burned += burn;
                agar += cost - burn;
            }
        }
        let s = d.step(n);
        if s.total_live > 0 {
            let feed = agar * p.feed_ppm / 1_000_000;
            let keeper_cut = feed * p.keeper_bps / 10_000;
            let mut paid = 0u128;
            for (c, v) in split_emission(feed - keeper_cut, &s.live, s.total_live).into_iter().enumerate().skip(1) {
                players[c - 1].balance += v;
                players[c - 1].earned += v;
                paid += v;
            }
            keeper_earned += keeper_cut;
            paid += keeper_cut;
            agar -= paid;
            emitted += paid;
        }
        peak_live = peak_live.max(s.total_live);
        if g % 240 == 0 || g + 1 == total {
            let alive = (1..=n).filter(|&c| s.live[c as usize] > 0).count();
            let bals: Vec<u128> = players.iter().map(|p| p.balance).collect();
            let price = plant_cost(p.base_cost, 1, s.total_live, p.capacity);
            let _ = writeln!(
                out,
                "{},{},{:.2},{},{:.1},{:.1},{:.1},{:.1},{},{:.3},{:.3}",
                p.name,
                society_name(society),
                g as f64 / gens_per_day as f64,
                s.total_live,
                supply as f64 / UNIT as f64,
                agar as f64 / UNIT as f64,
                emitted as f64 / UNIT as f64,
                burned as f64 / UNIT as f64,
                alive,
                gini(&bals),
                price as f64 / UNIT as f64
            );
        }
    }
    let alive = (1..=n).filter(|&c| d.live_counts(n)[c as usize] > 0).count();
    let _ = writeln!(
        summary,
        "{} / {}: {} days, final live {} (peak {}), supply {:.0}, agar {:.0}, fed {:.0}, burned {:.0} ({:.0}% of fed), colonies alive {}/{}, gini {:.2}, price/cell {:.2}, keeper {:.0}",
        p.name,
        society_name(society),
        days,
        d.total_live(),
        peak_live,
        supply as f64 / UNIT as f64,
        agar as f64 / UNIT as f64,
        emitted as f64 / UNIT as f64,
        burned as f64 / UNIT as f64,
        100.0 * burned as f64 / emitted.max(1) as f64,
        alive,
        n,
        gini(&players.iter().map(|p| p.balance).collect::<Vec<_>>()),
        plant_cost(p.base_cost, 1, d.total_live(), p.capacity) as f64 / UNIT as f64,
        keeper_earned as f64 / UNIT as f64,
    );
    summary
}

fn society_name(s: &[(Kind, usize)]) -> String {
    s.iter().map(|(k, n)| format!("{}{:?}", n, k)).collect::<Vec<_>>().join("+")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out_dir = args.get(1).cloned().unwrap_or_else(|| "sim-out".into());
    let days: u64 = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(14);
    fs::create_dir_all(&out_dir).unwrap();
    let base = Params {
        name: "launch",
        width: 128,
        max_supply: 1_000_000 * UNIT,
        feed_ppm: 20,
        burn_bps: 5_000,
        keeper_bps: 200,
        base_cost: 2 * UNIT,
        capacity: 1_000,
        grant: 64 * UNIT,
        buffer: 3,
        max_cells: 64,
    };
    let variants = vec![
        base.clone(),
        Params { name: "feed-50ppm", feed_ppm: 50, ..base.clone() },
        Params { name: "feed-8ppm", feed_ppm: 8, ..base.clone() },
        Params { name: "flat-price", capacity: u32::MAX, ..base.clone() },
        Params { name: "cost-1", base_cost: UNIT, ..base.clone() },
        Params { name: "no-burn", burn_bps: 0, ..base.clone() },
    ];
    let societies: Vec<Vec<(Kind, usize)>> = vec![
        vec![(Kind::Builder, 8)],
        vec![(Kind::Builder, 4), (Kind::Raider, 4)],
        vec![(Kind::Builder, 6), (Kind::Raider, 3), (Kind::Defender, 2), (Kind::Chaos, 1)],
    ];
    let mut csv = String::from("params,society,day,live,supply,agar,emitted,burned,colonies_alive,gini,price_per_cell\n");
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
