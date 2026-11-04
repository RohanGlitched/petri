//! Petri economy simulator, v6.
//!
//! Runs the real rules from `petri-core` (Life, the capped feed on decaying stake, planting prices with the siege
//! surcharge and slide licences, the purchase and sell-back curves, the tide split) for days of generations, with
//! scripted players including adversaries and the house strains as agents/ plays them, and reports what every kind of
//! player ends up with **in NEAR actually withdrawn**. The contract's book-keeping is mirrored from contract/src v6
//! (see world.rs); parameters are read from the launch-rules files of both dishes.
//!
//! ```text
//! cargo run --release -- <out_dir> all [--testnet path] [--mainnet path] [--seeds n]
//! ```

mod model;
mod world;

use model::*;
use std::fmt::Write as _;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;
use world::*;

// ---------- scenarios ----------

#[derive(Clone)]
struct Scenario {
    name: String,
    rules: Rules,
    setup: Setup,
    society: Society,
    seeds: u64,
    stream: u64,
}

fn mainnet(days: u64) -> Setup {
    Setup { net: Net::Mainnet, days, house_budget: 55 * NEAR / 100, keeper_on: true, keeper_registered: false, licences: true }
}

fn testnet(days: u64) -> Setup {
    Setup { net: Net::Testnet, days, house_budget: 3 * NEAR / 2, keeper_on: true, keeper_registered: true, licences: true }
}

fn house() -> Spec {
    spec(Kind::House, 5, 1)
}

/// The young mainnet dish: the five strains plus `n` outsiders (1: `alone`; 5 and 20: a mix).
fn young(n: usize, alone: Kind) -> Society {
    use Kind::*;
    let mut s = vec![house()];
    match n {
        1 => s.push(Spec { from_day: 0.0, to_day: 0.25, ..spec(alone, 1, if alone == SelfSponsor { 10 } else { 1 }) }),
        5 => {
            for k in [Penny, Builder, Raider, Defender, Methuselah] {
                s.push(spec(k, 1, 1));
            }
        }
        _ => {
            for (k, c) in [(Penny, 3), (Builder, 5), (Raider, 3), (Defender, 3), (Methuselah, 2), (Late, 2), (Whale, 1), (Sniper, 1)] {
                s.push(spec(k, c, 1));
            }
        }
    }
    s
}

/// The v5 societies (15 / 150 / 1,500 players), plus Penny players and the five strains. On mainnet `Guest` is a
/// colony someone else sponsored 0.05 NEAR of credit (there is no relayer there).
fn society(scale: usize, net: Net) -> Society {
    use Kind::*;
    let mut s: Vec<Spec> = match scale {
        15 => vec![spec(Penny, 1, 1), spec(Builder, 2, 1), spec(Raider, 1, 1), spec(Defender, 1, 1), spec(Methuselah, 1, 1), spec(Late, 1, 1), spec(Whale, 1, 1), spec(SplitWhale, 1, 10), spec(Sniper, 1, 1), spec(Racer, 1, 1), spec(Seller, 1, 1), spec(Guest, 1, 1), spec(SelfSponsor, 1, 10), spec(Locker, 1, 1)],
        150 => vec![spec(Penny, 10, 1), spec(Builder, 30, 1), spec(Raider, 15, 1), spec(Defender, 12, 1), spec(Methuselah, 8, 1), spec(Late, 30, 1), spec(Whale, 4, 1), spec(SplitWhale, 2, 10), spec(Sniper, 4, 1), spec(Racer, 2, 1), spec(Seller, 6, 1), spec(Guest, 20, 1), spec(SelfSponsor, 3, 10), spec(Locker, 1, 1)],
        1500 => vec![spec(Penny, 100, 1), spec(Builder, 300, 1), spec(Raider, 150, 1), spec(Defender, 120, 1), spec(Methuselah, 80, 1), spec(Late, 300, 1), spec(Whale, 25, 1), spec(SplitWhale, 5, 20), spec(Sniper, 30, 1), spec(Racer, 3, 1), spec(Seller, 50, 1), spec(Guest, 300, 1), spec(SelfSponsor, 16, 10), spec(Locker, 1, 1)],
        _ => vec![],
    };
    if net == Net::Testnet {
        s.push(spec(Bench, 3, 1));
        let sy = match scale {
            15 => 1,
            150 => 3,
            _ => 20,
        };
        s.push(spec(SybilGuest, sy, 11));
    }
    s.push(house());
    s
}

/// A mixed society of `n` outsiders joining over the first day (for the saturation curve), or over `days` days.
fn mixed(n: usize, days: f64) -> Society {
    use Kind::*;
    let mix = [(Builder, 30), (Raider, 15), (Defender, 12), (Methuselah, 8), (Penny, 10), (Whale, 3), (Sniper, 4), (Seller, 5), (Guest, 13)];
    let mut s = vec![house()];
    let mut left = n;
    for (k, pct) in mix {
        let c = (n * pct / 100).min(left);
        left -= c;
        if c > 0 {
            let mut sp = spec(k, c, 1);
            if !matches!(k, Sniper | Seller) {
                sp.to_day = days;
            }
            s.push(sp);
        }
    }
    if left > 0 {
        s.push(Spec { to_day: days, ..spec(Builder, left, 1) });
    }
    s
}

fn players(s: &Society) -> usize {
    s.iter().filter(|x| x.kind != Kind::House && x.kind != Kind::Bench).map(|x| x.players).sum()
}

fn colonies(s: &Society) -> usize {
    s.iter().map(|x| x.players * x.per).sum()
}

fn run_all(scenarios: &[Scenario]) -> Vec<Vec<RunOut>> {
    let mut jobs: Vec<(usize, u64)> = scenarios.iter().enumerate().flat_map(|(si, s)| (0..s.seeds).map(move |k| (si, k))).collect();
    jobs.sort_by_key(|&(si, _)| std::cmp::Reverse(scenarios[si].setup.days * (colonies(&scenarios[si].society) as u64 + 50)));
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<(usize, u64, RunOut)>> = Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    let done = AtomicUsize::new(0);
    let total = jobs.len();
    std::thread::scope(|sc| {
        for _ in 0..threads {
            sc.spawn(|| loop {
                let j = next.fetch_add(1, Ordering::SeqCst);
                if j >= jobs.len() {
                    break;
                }
                let (si, k) = jobs[j];
                let s = &scenarios[si];
                let w = World::new(s.rules.clone(), s.setup.clone(), &s.society, s.stream * 1_000 + k);
                let out = w.run();
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                eprintln!("  [{}/{}] {} seed {} in {:.1}s", d, total, s.name, k, out.world.secs);
                results.lock().unwrap().push((si, k, out));
            });
        }
    });
    let mut all = results.into_inner().unwrap();
    all.sort_by_key(|&(si, k, _)| (si, k));
    let mut by: Vec<Vec<RunOut>> = (0..scenarios.len()).map(|_| Vec::new()).collect();
    for (si, _, out) in all {
        by[si].push(out);
    }
    by
}

// ---------- statistics ----------

fn median(v: &mut Vec<f64>) -> f64 {
    v.retain(|x| !x.is_nan());
    if v.is_empty() {
        return f64::NAN;
    }
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

fn mmm(v: &[f64]) -> (f64, f64, f64) {
    let mut w = v.to_vec();
    let med = median(&mut w);
    (w.first().copied().unwrap_or(f64::NAN), med, w.last().copied().unwrap_or(f64::NAN))
}

fn med_of(v: Vec<f64>) -> f64 {
    let mut v = v;
    median(&mut v)
}

/// Per seed, the mean over a kind's players of `f`.
fn per_seed(runs: &[RunOut], kind: Kind, f: &dyn Fn(&GroupOut) -> f64) -> Vec<f64> {
    runs.iter()
        .filter_map(|r| {
            let v: Vec<f64> = r.groups.iter().filter(|g| g.kind == kind).map(f).filter(|x| !x.is_nan()).collect();
            (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
        })
        .collect()
}

fn cell(v: &[f64], prec: usize) -> String {
    if v.is_empty() {
        return "-".into();
    }
    let (a, b, c) = mmm(v);
    if b.is_nan() {
        return "-".into();
    }
    format!("{:+.p$} ({:+.p$}..{:+.p$})", b, a, c, p = prec)
}

fn ucell(v: &[f64], prec: usize) -> String {
    if v.is_empty() {
        return "-".into();
    }
    let (a, b, c) = mmm(v);
    format!("{:.p$} ({:.p$}..{:.p$})", b, a, c, p = prec)
}

fn wv(runs: &[RunOut], f: &dyn Fn(&WorldOut) -> f64) -> Vec<f64> {
    runs.iter().map(|r| f(&r.world)).collect()
}

fn wmed(runs: &[RunOut], f: &dyn Fn(&WorldOut) -> f64, prec: usize) -> String {
    ucell(&wv(runs, f), prec)
}

fn kind_matrix(out: &mut String, cols: &[(String, &[RunOut])], f: &dyn Fn(&GroupOut) -> f64, prec: usize, width: usize) {
    let _ = write!(out, "  {:<12}", "kind");
    for (label, _) in cols {
        let _ = write!(out, " | {:^w$}", label, w = width);
    }
    let _ = writeln!(out);
    for kind in KINDS {
        if cols.iter().all(|(_, r)| per_seed(r, kind, f).is_empty()) {
            continue;
        }
        let _ = write!(out, "  {:<12}", format!("{:?}", kind));
        for (_, r) in cols {
            let _ = write!(out, " | {:>w$}", cell(&per_seed(r, kind, f), prec), w = width);
        }
        let _ = writeln!(out);
    }
}

fn kind_detail(out: &mut String, runs: &[RunOut]) {
    let _ = writeln!(
        out,
        "  {:<12} {:>5} {:>5} | {:>8} {:>7} {:>7} | {:>8} {:>7} {:>7} {:>7} | {:>8} {:>8} | {:>7} {:>7} {:>8} {:>8} | {:>6} {:>5} {:>5}",
        "kind", "plyrs", "accts", "attached", "spons", "gas", "claimed", "sold", "bounty", "reclaim", "cash med", "paperMed", "crWon", "crLeft", "royIn P", "royOut P", "e/s", "feed%", "tide%"
    );
    for kind in KINDS {
        let cash = per_seed(runs, kind, &|g| g.cash());
        if cash.is_empty() {
            continue;
        }
        let players = runs[0].groups.iter().filter(|g| g.kind == kind).count();
        let accts: usize = runs[0].groups.iter().filter(|g| g.kind == kind).map(|g| g.accounts).sum();
        let m = |f: &dyn Fn(&GroupOut) -> f64| med_of(per_seed(runs, kind, f));
        let es = m(&|g| if g.spent == 0 { f64::NAN } else { g.earned as f64 / g.spent as f64 });
        let share = |f: &dyn Fn(&GroupOut) -> u128| {
            med_of(
                runs.iter()
                    .map(|r| {
                        let all: u128 = r.groups.iter().map(f).sum();
                        let k: u128 = r.groups.iter().filter(|g| g.kind == kind).map(f).sum();
                        100.0 * k as f64 / all.max(1) as f64
                    })
                    .collect(),
            )
        };
        let _ = writeln!(
            out,
            "  {:<12} {:>5} {:>5} | {:>8.4} {:>7.4} {:>7.4} | {:>8.4} {:>7.4} {:>7.4} {:>7.4} | {:>+8.4} {:>+8.4} | {:>7.4} {:>7.4} {:>8.1} {:>8.1} | {:>6} {:>4.1}% {:>4.1}%",
            format!("{:?}", kind),
            players,
            accts,
            m(&|g| nf(g.attached)),
            m(&|g| nf(g.sponsored)),
            m(&|g| nf(g.gas)),
            m(&|g| nf(g.claimed)),
            m(&|g| nf(g.sold)),
            m(&|g| nf(g.bounty)),
            m(&|g| nf(g.reclaimed)),
            med_of(cash),
            m(&|g| g.paper()),
            m(&|g| nf(g.credit_won)),
            m(&|g| nf(g.credit_left)),
            m(&|g| pf(g.royalty_in)),
            m(&|g| pf(g.royalty_out)),
            if es.is_nan() { "-".to_string() } else { format!("{:.2}", es) },
            share(&|g| g.earned),
            share(&|g| g.tide_share)
        );
    }
}

fn world_lines(out: &mut String, runs: &[RunOut], days: u64) {
    let w4 = |f: &dyn Fn(&WorldOut) -> f64| wmed(runs, f, 4);
    let w0 = |f: &dyn Fn(&WorldOut) -> f64| wmed(runs, f, 0);
    let _ = writeln!(out, "  dish at the end  : live {}  peak {}  agar {} PETRI  burned {}  fed {}  tides run {} skipped {}", w0(&|x| x.live as f64), w0(&|x| x.peak as f64), w0(&|x| pf(x.agar)), w0(&|x| pf(x.burned)), w0(&|x| pf(x.fed)), w0(&|x| x.tides as f64), w0(&|x| x.tides_skipped as f64));
    let _ = writeln!(out, "  NEAR in          : attached {} (house {})  sponsored as credit {}  -> vault {}  credit pool {}", w4(&|x| nf(x.near_attached)), w4(&|x| nf(x.house_attached)), w4(&|x| nf(x.near_sponsored)), w4(&|x| nf(x.vault_in)), w4(&|x| nf(x.credit_in)));
    let _ = writeln!(out, "  NEAR out         : claimed {}  bounties {} (kept in vault by house runners {}, as credit {})  sales {} (sales as credit {})  reclaimed {}", w4(&|x| nf(x.claimed_total)), w4(&|x| nf(x.bounties)), w4(&|x| nf(x.bounties_kept)), w4(&|x| nf(x.bounties_credit)), w4(&|x| nf(x.sold_total)), w4(&|x| nf(x.credit_sold)), w4(&|x| nf(x.reclaimed_total)));
    let _ = writeln!(out, "  tides            : NEAR shares {}  vault shares paid as credit {}  credit-pool shares {}  first outsider's share {}  largest winner {}", w4(&|x| nf(x.tides_paid)), w4(&|x| nf(x.tides_as_credit)), w4(&|x| nf(x.credit_paid)), w4(&|x| x.first_share), w4(&|x| x.top_share));
    let _ = writeln!(out, "  left             : vault {}  credit pool {}  credit outstanding {}  tides owed {}  keeper pot {} PETRI", w4(&|x| nf(x.vault)), w4(&|x| nf(x.credit_pool)), w4(&|x| nf(x.credit_outstanding)), w4(&|x| nf(x.tides_owed)), w4(&|x| pf(x.keeper_pot)));
    let _ = writeln!(
        out,
        "  storage          : players {}  vault (tide entries) {}  contract itself {}  = {} % of NEAR in",
        w4(&|x| nf(x.storage_players)),
        w4(&|x| nf(x.storage_vault)),
        w4(&|x| x.storage_contract as f64 / NEAR as f64),
        wmed(runs, &|x| 100.0 * (nf(x.storage_players + x.storage_vault) + x.storage_contract.max(0) as f64 / NEAR as f64) / nf(x.near_attached + x.near_sponsored).max(1e-12), 1)
    );
    let _ = writeln!(out, "  house            : paid {} NEAR (attached + gas)  left {}  out of NEAR on day {}  ;  keeper calls {} gas {} NEAR ({}/day)  royalties {} PETRI", w4(&|x| nf(x.house_paid)), w4(&|x| nf(x.house_left)), w0(&|x| x.house_out_of_near_day.map(|d| d as f64).unwrap_or(f64::NAN)), w0(&|x| x.keeper.calls as f64), w4(&|x| nf(x.keeper.gas)), w4(&|x| nf(x.keeper.gas) / days.max(1) as f64), w0(&|x| pf(x.royalties)));
    let _ = writeln!(out, "  work and gas     : live/gen avg {}  colonies alive/gen {}  hot rows avg {} max {}  calls {}  gas {} NEAR  catch-ups cut by gas {}  plants refused behind {}", w0(&|x| x.work_live_avg), w0(&|x| x.work_alive_avg), w0(&|x| x.hot_avg), w0(&|x| x.hot_max as f64), w0(&|x| x.calls as f64), w4(&|x| x.gas_total * YOCTO_PER_GGAS / NEAR as f64), w0(&|x| x.partial_catchups as f64), w0(&|x| x.plant_fail_behind as f64));
    let mut s = String::from("  max gas (TGas)   :");
    for c in CALLS {
        let v = med_of(runs.iter().map(|r| r.world.gas_max[c.idx()][0].max(r.world.gas_max[c.idx()][1]) / 1000.0).collect());
        if v > 0.0 {
            let _ = write!(s, " {:?} {:.0}", c, v);
        }
    }
    let over: u64 = runs.iter().map(|r| r.world.over_prepaid.iter().sum::<u64>()).sum();
    let _ = writeln!(out, "{}  | calls over their prepaid gas (all seeds): {}", s, over);
}

fn csv_timeline(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for t in &r.timeline {
            let _ = writeln!(
                csv,
                "\"{}\",{},{},{},{},{},{},{:.0},{:.6},{:.6},{:.6},{:.4},{:.3},{:.3},{:.6},{},{:.6},{:.6},{:.6},{:.6},{},{},{:.1},{:.4},{:.4},{}",
                name, k, t.gen, t.wall, t.ran as u8, t.live, t.counted, pf(t.agar), nf(t.vault), nf(t.credit_pool), pf(t.per_cell_feed), pf(t.cell_price), 100.0 * t.free, 100.0 * t.block_free, nf(t.newcomer_near), t.newcomer_siege as u8, nf(t.siege_near), nf(t.pay), nf(t.split), nf(t.storage), t.winners, t.hot_rows, t.tide_gas / 1000.0, t.first_share, t.top_share, t.outsiders
            );
        }
    }
}

fn csv_players(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for (gi, g) in r.groups.iter().enumerate() {
            let _ = writeln!(
                csv,
                "\"{}\",{},{},{:?},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:+.6},{:+.6},{:.6},{:.6},{:.3},{:.3},{:.3},{:.3},{}",
                name, k, gi, g.kind, g.accounts, g.first_join, nf(g.attached), nf(g.sponsored), nf(g.gas), nf(g.claimed), nf(g.sold), nf(g.bounty), nf(g.reclaimed), nf(g.owed), nf(g.held), g.cash(), g.paper(), nf(g.credit_won), nf(g.credit_left), pf(g.earned), pf(g.spent), pf(g.royalty_in), pf(g.royalty_out), g.live
            );
        }
    }
}

// ---------- the analytic gas table ----------

struct GasAt {
    join: f64,
    plant: f64,
    tide: f64,
    claim_near: f64,
    claim_idle: f64,
    gens200: u64,
    gens250: u64,
    gens200_fix: u64,
}

/// Gas at `p` hot rows on a full dish (`live` cells, `alive` colonies alive), each of the p rows a tide winner.
fn gas_at(p: f64, live: f64, alive: f64) -> GasAt {
    let board = 2048.0 + 2.0 * live;
    let board_rw = 2.0 * G_SOP + board * (G_RB + G_WB) + 30.0 * live * G_OP;
    let load = 2.0 * G_SOP + p * HOT_ROW as f64 * G_RB + p * W_LOAD_ROW * G_OP;
    let store_feed = G_SOP + p * HOT_FEED as f64 * G_WB + p * W_STORE_FEED_ROW * G_OP;
    let store_purse = G_SOP + p * HOT_PURSE as f64 * G_WB + p * W_STORE_PURSE_ROW * G_OP;
    let gen = (20_000.0 + 60.0 * live + 150.0 * alive) * G_OP;
    let tide = 4.0 * G_SOP + TIDE_BYTES as f64 * G_WB + p * (W_TIDE_ROW + W_WINNER + 10.0) * G_OP;
    let cold = 2.0 * G_SOP + (PAGE as u128 * COLD) as f64 * (G_RB + G_WB);
    let gens = |prepaid: f64, store: f64| -> u64 {
        let limit = G_CATCHUP_LIMIT.min(prepaid - G_RESERVE - store);
        let used0 = G_CALL + load + 2.0 * G_SOP + board * G_RB;
        let room = limit - used0;
        if room <= gen {
            1
        } else {
            ((room / gen) as u64 + 1).min(120)
        }
    };
    let store_all = p * HOT_ROW as f64 * G_HOT_WRITE_BYTE;
    let store_feed_only = p * HOT_FEED as f64 * G_HOT_WRITE_BYTE;
    GasAt {
        join: G_CALL + 12.0 * G_SOP + cold + 400.0 * G_WB,
        plant: G_CALL + 14.0 * G_SOP + board_rw + 4_000.0 * G_OP + 500.0 * G_WB + load + store_feed + store_purse + p * 10.0 * G_OP,
        tide: G_CALL + 3.0 * G_SOP + board_rw + load + store_feed + store_purse + gen + tide + p * W_FLUSH_SCAN_ROW * G_OP + G_PAYOUT_RESERVE,
        claim_near: G_CALL + 6.0 * G_SOP + load + store_feed + store_purse + 300.0 * G_WB + G_PAYOUT_RESERVE,
        claim_idle: G_CALL + 6.0 * G_SOP + load + cold,
        gens200: gens(200_000.0, store_all),
        gens250: gens(250_000.0, store_all),
        gens200_fix: gens(200_000.0, store_feed_only),
    }
}

// ---------- the report ----------

fn header(out: &mut String, r: &Rules, paths: (&str, &str), same: bool) {
    let _ = writeln!(out, "Rules: {} (testnet) and {} (mainnet), read with serde (unknown fields refused).", paths.0, paths.1);
    let _ = writeln!(out, "  Economic parameters identical in both files: {} (they differ only in house, keepers and wnear).", if same { "YES" } else { "NO" });
    let _ = writeln!(
        out,
        "  {}x{} dish, {} ms generations ({} a day); feed_ppm {}, keeper_bps {}, reach {}, stake_keep_bps {}, burn_bps {}, payback {}, min_cell_price {} PETRI, live_floor {},",
        r.width, r.height, r.generation_ms, r.gens_per_day(), r.feed_ppm, r.keeper_bps, r.reach, r.stake_keep_bps, r.burn_bps, r.payback, pf(r.min_cell_price), r.live_floor
    );
    let _ = writeln!(
        out,
        "  petri_price {} NEAR, max_supply {} PETRI, min_join {} NEAR, cell_fee {} NEAR, tide_every {}, tide_bps {} ({}% of the vault), tide_bounty_bps {} (max {} NEAR),",
        nf(r.petri_price), pf(r.max_supply), nf(r.min_join), nf(r.cell_fee), r.tide_every, r.tide_bps, r.tide_bps / 100, r.tide_bounty_bps, nf(r.max_bounty)
    );
    let _ = writeln!(
        out,
        "  sell_bps {}, sell_cap_bps {}, siege_x {}, buffer {}, max_plant_cells {}, max_catchup {}, max_lag {}, slide_cells_price {} PETRI, slide_min_cells {},",
        r.sell_bps, r.sell_cap_bps, r.siege_x, r.buffer, r.max_plant_cells, r.max_catchup, r.max_lag, pf(r.slide_cells_price), r.slide_min_cells
    );
    let _ = writeln!(out, "  slide_discount_bps {}, slide_royalty_bps {}, house {} strains, keepers {:?}.", r.slide_discount_bps, r.slide_royalty_bps, r.house.len(), r.keepers);
    let _ = writeln!(out, "Storage, from the v6 borsh layout (key + value + 40 B per record; 1e19 yocto a byte):");
    let _ = writeln!(out, "  join {} B for a 16-char wallet (Colony {} + colony_of 63 + name 57 + balance 77 + Join entry 56 + cold slot 57 + 140 charged for the Buy entry,", join_bytes(16, 12, false), colony_bytes(16, 12));
    let _ = writeln!(out, "    which is 105 B, 121 with `spent`); buy 140 B charged; plant_deposit = (240 + 77 [first hot row] + 82 [empty table] + 4c + note+64 + licence 33+L) B + 0.0001/cell;");
    let _ = writeln!(out, "  stored by a planting: Plant entry 111+2c (+16 spent, +{} licence with a 16-char holder) + index 53 + board 2c + 8 first time + note 49+n + hot row 77;", licence_bytes(Some(16)));
    let _ = writeln!(out, "    the rest of the deposit (fee included) goes to the vault or credit pool; a row leaving the hot table frees 77 B to the contract.");
    let _ = writeln!(out, "  sell entry {} B from the proceeds (a NEAR sale must also cover {} B for a possible refund); claim entry {} B from the NEAR (claims need > {} B = {:.5} NEAR owed);", SELL_BYTES, PAYOUT_RESERVE, CLAIM_BYTES, CLAIM_BYTES + PAYOUT_RESERVE, nf((CLAIM_BYTES + PAYOUT_RESERVE) * BYTE));
    let _ = writeln!(out, "  tide entry 236 + tide index 53 = {} B = {:.5} NEAR from the vault per tide that runs; skip entry {} B (contract);", TIDE_BYTES, nf(TIDE_BYTES * BYTE), SKIP_BYTES);
    let _ = writeln!(out, "  sponsor (first grant) {} B for a guest (entry 78+La+Ls, grants record 77+La+Ls, Unsponsor reserve 210); slide 4x4 {} B, 16x16 {} B (record, owner list, entry, 184 reserve).", sponsor_bytes(L_GUEST, L_RELAYER, true, true), slide_bytes(16, 4, 4, 0, true), slide_bytes(22, 16, 16, 30, false));
    let _ = writeln!(out, "  The contract's own code: {} B of wasm = {:.2} NEAR staked by the dish account.", WASM_BYTES, nf(WASM_BYTES * BYTE));
    let _ = writeln!(out, "Gas (NEAR protocol fee schedule; 1 TGas = 0.0001 NEAR at the minimum gas price): call {} TGas + {} Ggas per storage op + {:.1} Mgas per byte read / {:.1} Mgas", G_CALL / 1000.0, G_SOP, G_RB * 1000.0, G_WB * 1000.0);
    let _ = writeln!(out, "  per byte rewritten (value + evicted value + memory/registers) + 0.82 Mgas per wasm op. Hot table: loaded once per call that needs a colony's books (77 B a row");
    let _ = writeln!(out, "  read, ~{} ops a row to parse), the feed part (26 B) rewritten by every catch-up, the purse part (51 B) by tides and purse changes (~{} / {} ops a row to write);", W_LOAD_ROW, W_STORE_FEED_ROW, W_STORE_PURSE_ROW);
    let _ = writeln!(out, "  a generation ~20k + 60 x live + 150 x colonies alive ops; a tide 4 writes + its 289 B + {} ops a row + {} per winner. A NEAR payout burns ~{} TGas and reserves", W_TIDE_ROW, W_WINNER, G_PAYOUT_BURN / 1000.0);
    let _ = writeln!(out, "  {} TGas of the call's prepaid gas (counted in 'max gas'). Catch-up limit min(180, prepaid - 40 - rows x 77 B x 64 Mgas) TGas, as the contract.", G_PAYOUT_RESERVE / 1000.0);
    let _ = writeln!(out, "  The contract's unit-runtime measurements (CHANGES-v6, host calls only) charge ~39 Mgas a rewritten byte, not ~71, so they read lower than this model.");
    let _ = writeln!(out, "The house (agents/run.mjs, strategies.mjs, council.mjs), approximated:");
    let _ = writeln!(out, "  mainnet: 5 strains attach their own NEAR (0.55 NEAR each, kept above 0.12 for gas: they stop buying there), join with 0.05, buy 0.02 when they cannot afford");
    let _ = writeln!(out, "  12 cells, act every [40..100] x 8 generations (temperament ranges), at most 60% of their PETRI and 100 PETRI a day per planting budget (10 always allowed),");
    let _ = writeln!(out, "  lab notes, never a siege, never a licence; candidates per temperament (gardener: blocks/beehives/loaves, eater walls, pulsars; raider: gliders, glider guns, LWSS;");
    let _ = writeln!(out, "  engineer: eaters, gliders, guns; wanderer: outposts in the emptiest agar, acorns, pulsars; chaos: blinkers, toads, acorn/R-pentomino). The model's pick is");
    let _ = writeln!(out, "  approximated as an ambitious candidate with probability 1/3 when affordable, else the first ordinary one. Every 12 h a strain fossilizes its densest 16x16");
    let _ = writeln!(out, "  window (>= 12 cells). Council pacts move <= 3 PETRI house-to-house and change nothing outside the house: not simulated. The keeper (a house account) advances");
    let _ = writeln!(out, "  only once an outsider has joined and the dish is >= 400 generations behind; its tides and the strains' tides pay no bounty (it stays in the vault).");
    let _ = writeln!(out, "  testnet: strains pay with 1.5 NEAR of sponsored credit each at full pace; the 3-wallet bench plays by the written rules; the keeper (registered) advances");
    let _ = writeln!(out, "  at 20 behind or whenever the pot holds over 50 PETRI; relayer guests (0.05 NEAR credit each).");
    let _ = writeln!(out, "Players: winnings, sales and bounties go back into the wallet; claims once a day; after each tide sellers race for the allowance (bots first, then a random");
    let _ = writeln!(out, "  quarter of the rest selling above 16 cells' price). Every non-house player plants under a slide's licence when one exists for its pattern (25% off, a 10%");
    let _ = writeln!(out, "  royalty to the holder), in the slide's orientation. Kinds: see sim/src/world.rs `Kind` (Penny = min_join 0.01 NEAR, one block kept alive and paid).");
    let _ = writeln!(out);
}

fn opt(opts: &[(String, String)], k: &str) -> Option<String> {
    opts.iter().find(|(a, _)| a == k).map(|(_, v)| v.clone())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out_dir = args.get(1).cloned().unwrap_or_else(|| "out-v6".into());
    fs::create_dir_all(&out_dir).unwrap();
    let mut opts = Vec::new();
    let mut i = 3;
    while i < args.len() && !args[i].starts_with("--") {
        i += 1;
    }
    while i + 1 < args.len() {
        if let Some(k) = args[i].strip_prefix("--") {
            opts.push((k.to_string(), args[i + 1].clone()));
        }
        i += 2;
    }
    let tpath = opt(&opts, "testnet").unwrap_or_else(|| "../contract/launch-rules.json".into());
    let mpath = opt(&opts, "mainnet").unwrap_or_else(|| "../contract/launch-rules-mainnet.json".into());
    let seeds: u64 = opt(&opts, "seeds").and_then(|s| s.parse().ok()).unwrap_or(8);
    let rt = Rules::load(&tpath, &[]);
    let rm = Rules::load(&mpath, &[]);
    match args.get(2).map(|s| s.as_str()) {
        Some("all") => all(&out_dir, &rt, &rm, (&tpath, &mpath), seeds),
        Some("probe") => {
            let pat = args.get(3).cloned().unwrap_or_default();
            let (scen, _) = build(&rt, &rm, seeds);
            let pick: Vec<Scenario> = scen.into_iter().filter(|s| s.name.contains(&pat)).map(|mut s| { s.seeds = 1; s }).collect();
            let runs = run_all(&pick);
            for (s, r) in pick.iter().zip(&runs) {
                let mut out = String::new();
                let _ = writeln!(out, "== {} ==", s.name);
                kind_detail(&mut out, r);
                world_lines(&mut out, r, s.setup.days);
                print!("{}", out);
            }
        }
        _ => eprintln!("usage: petri-sim <out_dir> all [--testnet path] [--mainnet path] [--seeds n]"),
    }
}

fn sc(name: &str, rules: &Rules, setup: Setup, society: Society, seeds: u64, stream: u64) -> Scenario {
    Scenario { name: name.into(), rules: rules.clone(), setup, society, seeds, stream }
}

fn build(rt: &Rules, rm: &Rules, seeds: u64) -> (Vec<Scenario>, [usize; 8]) {
    use Kind::*;
    let mut scen: Vec<Scenario> = Vec::new();
    // (a) young mainnet.
    let alone = [Penny, Builder, Methuselah, Whale, Sniper, Locker, SelfSponsor, Racer];
    for days in [7u64, 14] {
        for k in alone {
            scen.push(sc(&format!("young {:?} alone {}d", k, days), rm, mainnet(days), young(1, k), seeds, 11));
        }
        scen.push(sc(&format!("young 5 {}d", days), rm, mainnet(days), young(5, Penny), seeds, 12));
        scen.push(sc(&format!("young 20 {}d", days), rm, mainnet(days), young(20, Penny), seeds, 13));
    }
    // (b) societies on the mainnet rules.
    scen.push(sc("mainnet 15p 7d", rm, mainnet(7), society(15, Net::Mainnet), 12, 15));
    scen.push(sc("mainnet 150p 7d", rm, mainnet(7), society(150, Net::Mainnet), 8, 150));
    scen.push(sc("mainnet 1500p 7d", rm, mainnet(7), society(1500, Net::Mainnet), 5, 1500));
    scen.push(sc("mainnet 150p 30d", rm, mainnet(30), society(150, Net::Mainnet), 4, 150));
    // (c) 90 days.
    scen.push(sc("90d 150p", rm, mainnet(90), society(150, Net::Mainnet), 3, 150));
    scen.push(sc("90d inflow 10/day", rm, mainnet(90), mixed(900, 90.0), 3, 90));
    // (d) saturation: n outsiders joining over the first day, 2 days.
    let sat = [5usize, 20, 50, 150, 500, 1500, 5000, 15000];
    for &n in &sat {
        scen.push(sc(&format!("sat {}", n), rm, mainnet(2), mixed(n, 1.0), if n >= 5000 { 2 } else { 3 }, 300 + n as u64));
    }
    // (e) 30,000 colonies.
    scen.push(sc("scale 30000", rm, mainnet(2), mixed(30_000, 1.5), 2, 30_000));
    scen.push(sc("FIX scale 30000 | hot rows leave below one paid cell (stake < 125)", &rm.with(&[("hot_evict_stake", "125")]), mainnet(2), mixed(30_000, 1.5), 2, 30_000));
    scen.push(sc("FIX mainnet 150p 7d | hot rows leave below one paid cell (stake < 125)", &rm.with(&[("hot_evict_stake", "125")]), mainnet(7), society(150, Net::Mainnet), 8, 150));
    // (f) attacks.
    let mut sybil = society(150, Net::Testnet);
    sybil.push(spec(SybilRoyalty, 3, 11));
    scen.push(sc("testnet 150p + sybil royalty 7d", rt, testnet(7), sybil.clone(), 6, 151));
    scen.push(sc("FIX testnet sybil royalty: royalty from credit-only planters to the agar", &rt.with(&[("royalty_guest_to_agar", "true")]), testnet(7), sybil, 6, 151));
    let mut farm = society(150, Net::Mainnet);
    farm.push(spec(Farmer, 1, 1));
    scen.push(sc("mainnet 150p + royalty farmer 7d", rm, mainnet(7), farm.clone(), 8, 150));
    scen.push(sc("FIX farmer: slide_royalty_bps 0", &rm.with(&[("slide_royalty_bps", "0")]), mainnet(7), farm.clone(), 8, 150));
    let mut farm_young = young(20, Penny);
    farm_young.push(spec(Farmer, 1, 1));
    scen.push(sc("young 20 + royalty farmer 7d", rm, mainnet(7), farm_young, seeds, 13));
    // Fix experiments on the young mainnet.
    for (label, set) in [("tide_cap_bps 2500", vec![("tide_cap_bps", "2500")]), ("small tide entry (120 B)", vec![("small_tide_entry", "true")]), ("tide_bps 200", vec![("tide_bps", "200")]), ("tide_every 960", vec![("tide_every", "960")])] {
        let r = rm.with(&set);
        scen.push(sc(&format!("FIX young Penny alone 7d | {}", label), &r, mainnet(7), young(1, Penny), seeds, 11));
        scen.push(sc(&format!("FIX young 5 7d | {}", label), &r, mainnet(7), young(5, Penny), seeds, 12));
        scen.push(sc(&format!("FIX young 20 7d | {}", label), &r, mainnet(7), young(20, Penny), seeds, 13));
    }
    scen.push(sc("FIX mainnet 150p 7d | keeper pot to any call that runs a generation", &rm.with(&[("pot_any_call", "true")]), mainnet(7), society(150, Net::Mainnet), 8, 150));
    let mut tk = testnet(3);
    tk.keeper_registered = false;
    let quiet = vec![house(), spec(Bench, 3, 1), spec(Guest, 5, 1)];
    scen.push(sc("testnet house + bench + 5 guests 3d (keeper registered)", rt, testnet(3), quiet.clone(), 4, 152));
    scen.push(sc("testnet house + bench + 5 guests 3d (keeper not registered)", rt, tk, quiet, 4, 152));

    (scen, sat)
}

fn all(out_dir: &str, rt: &Rules, rm: &Rules, paths: (&str, &str), seeds: u64) {
    use Kind::*;
    let t0 = Instant::now();
    let (scen, sat) = build(rt, rm, seeds);
    let runs = run_all(&scen);
    let get = |name: &str| -> &[RunOut] { &runs[scen.iter().position(|s| s.name == name).unwrap_or_else(|| panic!("no scenario {}", name))][..] };
    let mut out = String::new();
    let _ = writeln!(out, "Petri v6 economy simulation (sim/src: main.rs, world.rs, model.rs) on the launched rules of both dishes.");
    let _ = writeln!(out, "All amounts NEAR unless marked. 'Cash' = NEAR actually received (tide claims, sales, bounties, sponsorship taken back) minus NEAR actually paid");
    let _ = writeln!(out, "(attached deposits with their storage, NEAR spent sponsoring, gas at 0.0001 NEAR/TGas). Each cell: median over seeds of the kind's mean player, (min..max).");
    let _ = writeln!(out, "Assumptions and the storage/gas model are in section 7. The house is modelled as agents/ plays it on mainnet (section 7).");
    let _ = writeln!(out);
    // ===== 1. Young mainnet cash =====
    let _ = writeln!(out, "=== 1. CASH: the young mainnet dish (the 5 house strains + 1, 5 or 20 outside players), 7 and 14 days, {} seeds ===", seeds);
    let _ = writeln!(out, "  '1 alone' = that kind is the only outsider (each kind a separate run). 5 = Penny, Builder, Raider, Defender, Methuselah. 20 = 3 Penny, 5 Builder,");
    let _ = writeln!(out, "  3 Raider, 3 Defender, 2 Methuselah, 2 Late, 1 Whale (2 NEAR), 1 Sniper.");
    let _ = writeln!(out, "  {:<12} | {:^28} | {:^28} | {:^28} | {:^28} | {:^28} | {:^28}", "outsider", "1 alone, 7 d", "1 alone, 14 d", "5 players, 7 d", "5 players, 14 d", "20 players, 7 d", "20 players, 14 d");
    for k in [Penny, Builder, Raider, Defender, Methuselah, Late, Whale, Sniper, Locker, SelfSponsor, Racer] {
        let a7 = scen.iter().position(|s| s.name == format!("young {:?} alone 7d", k));
        let a14 = scen.iter().position(|s| s.name == format!("young {:?} alone 14d", k));
        let f = |i: Option<usize>| i.map(|i| cell(&per_seed(&runs[i], k, &|g| g.cash()), 4)).unwrap_or("-".into());
        let g = |n: &str| cell(&per_seed(get(n), k, &|g| g.cash()), 4);
        let _ = writeln!(out, "  {:<12} | {:>28} | {:>28} | {:>28} | {:>28} | {:>28} | {:>28}", format!("{:?}", k), f(a7), f(a14), g("young 5 7d"), g("young 5 14d"), g("young 20 7d"), g("young 20 14d"));
    }
    let _ = writeln!(out, "  Paper value (cash + NEAR still owed + PETRI held at the sell-back floor), same layout:");
    for k in [Penny, Builder, Methuselah, Whale, Locker] {
        let a7 = scen.iter().position(|s| s.name == format!("young {:?} alone 7d", k));
        let a14 = scen.iter().position(|s| s.name == format!("young {:?} alone 14d", k));
        let f = |i: Option<usize>| i.map(|i| cell(&per_seed(&runs[i], k, &|g| g.paper()), 4)).unwrap_or("-".into());
        let g = |n: &str| cell(&per_seed(get(n), k, &|g| g.paper()), 4);
        let _ = writeln!(out, "  {:<12} | {:>28} | {:>28} | {:>28} | {:>28} | {:>28} | {:>28}", format!("{:?}", k), f(a7), f(a14), g("young 5 7d"), g("young 5 14d"), g("young 20 7d"), g("young 20 14d"));
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "  Does the first outsider collect nearly every tide? (share of all tide shares, NEAR + credit, that went to the first outside colony to join;");
    let _ = writeln!(out, "  'tides >= 90%' = share of the tides that ran in which it took at least 90%; vault and house figures at the end)");
    let _ = writeln!(out, "  {:<34} | {:>22} | {:>22} | {:>11} | {:>11} | {:>20} | {:>20} | {:>16}", "scenario", "first outsider share", "tides >= 90%", "tides run", "skipped", "house paid NEAR", "vault left NEAR", "house NEAR left");
    for name in ["young Penny alone 7d", "young Builder alone 7d", "young Penny alone 14d", "young 5 7d", "young 5 14d", "young 20 7d", "young 20 14d"] {
        let r = get(name);
        let _ = writeln!(out, "  {:<34} | {:>22} | {:>22} | {:>11} | {:>11} | {:>20} | {:>20} | {:>16}", name, wmed(r, &|x| x.first_share, 3), wmed(r, &|x| x.first_tides90, 3), wmed(r, &|x| x.tides as f64, 0), wmed(r, &|x| x.tides_skipped as f64, 0), wmed(r, &|x| nf(x.house_paid), 4), wmed(r, &|x| nf(x.vault), 4), wmed(r, &|x| nf(x.house_left), 4));
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "  Where the tides went on the young dish, 7 days (medians): pay = 5% of the vault per tide; storage = the tide entry's 289 B paid from it.");
    for name in ["young Penny alone 7d", "young 5 7d", "young 20 7d"] {
        let r = get(name);
        let tot = |f: &dyn Fn(&TideRow) -> u128| med_of(r.iter().map(|x| nf(x.timeline.iter().filter(|t| t.ran).map(f).sum())).collect());
        let pay = tot(&|t| t.pay);
        let st = tot(&|t| t.storage);
        let _ = writeln!(out, "    {:<22} pay {:.4}  to colonies {:.4}  tide-entry storage {:.4} ({:.0}% of pay)  bounties {:.4}", name, pay, tot(&|t| t.split), st, 100.0 * st / pay.max(1e-12), tot(&|t| t.bounty));
    }
    let _ = writeln!(out);
    // ===== 2. Societies =====
    let _ = writeln!(out, "=== 2. CASH: the previous societies on the exact mainnet rules (house as on mainnet; 'Guest' = a colony someone sponsored 0.05 NEAR of credit) ===");
    let cols: Vec<(String, &[RunOut])> = [("15 p, 7 d", "mainnet 15p 7d"), ("150 p, 7 d", "mainnet 150p 7d"), ("1,500 p, 7 d", "mainnet 1500p 7d"), ("150 p, 30 d", "mainnet 150p 30d")]
        .iter()
        .map(|(l, n)| (format!("{} ({} seeds)", l, get(n).len()), get(n)))
        .collect();
    kind_matrix(&mut out, &cols, &|g| g.cash(), 4, 30);
    let _ = writeln!(out, "  Paper value (cash + owed + PETRI at the sell-back floor):");
    kind_matrix(&mut out, &cols, &|g| g.paper(), 4, 30);
    let _ = writeln!(out, "  Credit won (tide credit-pool shares, plus vault shares, sales and bounties of colonies that never attached NEAR), spendable only in the dish:");
    kind_matrix(&mut out, &cols, &|g| nf(g.credit_won), 4, 30);
    let _ = writeln!(out);
    // ===== 3. 90 days =====
    let _ = writeln!(out, "=== 3. 90 days: agar depletion and feed per cell (median over 3 seeds) ===");
    for name in ["90d 150p", "90d inflow 10/day"] {
        let r = get(name);
        let what = if name == "90d 150p" { "the 150-player society, all joining in the first days (budgets run out)" } else { "10 new mixed outsiders a day for 90 days (900 in all)" };
        let _ = writeln!(out, "  {} ({}):", name, what);
        let _ = writeln!(out, "    {:>4} | {:>10} | {:>9} | {:>13} | {:>12} | {:>6} | {:>7} | {:>9} | {:>9} | {:>10} | {:>8} | {:>9}", "day", "agar PETRI", "burned", "feed/cell/gen", "cell price P", "live", "counted", "vault", "house left", "newcomer m", "tides/d", "hot rows");
        for d in [1u64, 2, 3, 7, 14, 21, 30, 45, 60, 75, 90] {
            let rows: Vec<&DayRow> = r.iter().filter_map(|x| x.days.get(d as usize - 1)).collect();
            if rows.is_empty() {
                continue;
            }
            let m = |f: &dyn Fn(&DayRow) -> f64| med_of(rows.iter().map(|x| f(x)).collect());
            let nc = med_of(r.iter().filter_map(|x| x.timeline.get((d * 24 - 1) as usize).map(|t| 1000.0 * nf(t.newcomer_near))).collect());
            let _ = writeln!(
                out,
                "    {:>4} | {:>10.0} | {:>9.0} | {:>13.5} | {:>12.3} | {:>6.0} | {:>7.0} | {:>9.4} | {:>9.4} | {:>10.2} | {:>8.0} | {:>9.0}",
                d,
                m(&|x| pf(x.agar)),
                m(&|x| pf(x.burned)),
                m(&|x| pf(x.per_cell_feed)),
                m(&|x| pf(x.cell_price)),
                m(&|x| x.live as f64),
                m(&|x| x.counted as f64),
                m(&|x| nf(x.vault)),
                m(&|x| nf(x.house_left)),
                nc,
                m(&|x| x.tides_run as f64),
                m(&|x| x.hot_rows as f64)
            );
        }
        let _ = writeln!(out, "    house out of NEAR (all 5 below the 0.12 floor + a top-up) on day: {}", wmed(r, &|x| x.house_out_of_near_day.map(|d| d as f64).unwrap_or(f64::NAN), 0));
    }
    let _ = writeln!(out, "  feed/cell/gen = PETRI one counted cell earns per generation (agar x 3 ppm x 98% / max(counted, 1,000)); cell price = 480 generations of it (floor 0.5);");
    let _ = writeln!(out, "  newcomer m = mNEAR for a newcomer's cheapest 2x2 block (PETRI at the buy price + the planting deposit; a siege if no free spot).");
    let _ = writeln!(out);
    // ===== 4. Saturation =====
    let _ = writeln!(out, "=== 4. Board saturation: free cells and the cheapest legal planting vs player count (mixed outsiders joining over day 1, + house; end of day 1 / day 2) ===");
    let _ = writeln!(out, "  free = empty and no non-house living cell within 3 (planting there is not a siege); block = a 2x2 block; siege block = the same at 3x inside a buffer.");
    let _ = writeln!(out, "  {:>7} {:>6} | {:>10} | {:>16} | {:>16} | {:>16} | {:>16} | {:>14} | {:>12}", "players", "seeds", "live d1", "free cells % d1", "free 2x2 % d1", "free 2x2 % d2", "block mNEAR d1", "siege mNEAR d1", "alive/gen");
    for &n in &sat {
        let r = get(&format!("sat {}", n));
        let at = |t: usize, f: &dyn Fn(&TideRow) -> f64| ucell(&r.iter().filter_map(|x| x.timeline.get(t).map(f)).collect::<Vec<f64>>(), 1);
        let _ = writeln!(out, "  {:>7} {:>6} | {:>10} | {:>16} | {:>16} | {:>16} | {:>16} | {:>14} | {:>12}", n, r.len(), at(23, &|t| t.live as f64), at(23, &|t| 100.0 * t.free), at(23, &|t| 100.0 * t.block_free), at(47, &|t| 100.0 * t.block_free), at(23, &|t| 1000.0 * nf(t.newcomer_near)), at(23, &|t| 1000.0 * nf(t.siege_near)), wmed(r, &|x| x.work_alive_avg, 0));
    }
    let _ = writeln!(out);
    // ===== 5. Scale and gas =====
    let _ = writeln!(out, "=== 5. Scale and gas under the v6 layout ===");
    let r30 = get("scale 30000");
    let cols30 = colonies(&scen.iter().find(|s| s.name == "scale 30000").unwrap().society);
    let _ = writeln!(out, "  Simulated: {} colonies (mixed outsiders joining over 1.5 days + house), 2 days, {} seeds. Largest gas per call (TGas, payouts' 30 TGas reservation", cols30, r30.len());
    let _ = writeln!(out, "  included), the hot rows when it happened, and calls whose gas would pass their prepaid gas (site: join/plant/buy/sell 200, claim/advance 250):");
    let _ = writeln!(out, "    {:<10} | {:>22} | {:>22} | {:>12} | {:>14}", "call", "no tide in catch-up", "with a tide", "calls", "over prepaid");
    for c in CALLS {
        let n: u64 = r30.iter().map(|x| x.world.call_count[c.idx()]).sum();
        if n == 0 {
            continue;
        }
        let m = |ti: usize| {
            let g = med_of(r30.iter().map(|x| x.world.gas_max[c.idx()][ti] / 1000.0).collect());
            let rows = med_of(r30.iter().map(|x| x.world.gas_rows_at_max[c.idx()][ti] as f64).collect());
            if g > 0.0 {
                format!("{:.1} @ {:.0} rows", g, rows)
            } else {
                "-".into()
            }
        };
        let over: u64 = r30.iter().map(|x| x.world.over_prepaid[c.idx()]).sum();
        let _ = writeln!(out, "    {:<10} | {:>22} | {:>22} | {:>12} | {:>14}", format!("{:?}", c), m(0), m(1), n / r30.len() as u64, over);
    }
    let _ = writeln!(out, "    hot rows (colonies with stake) avg {} max {}; catch-ups cut short by the gas limit {}; plantings refused as behind the clock {}", wmed(r30, &|x| x.hot_avg, 0), wmed(r30, &|x| x.hot_max as f64, 0), wmed(r30, &|x| x.partial_catchups as f64, 0), wmed(r30, &|x| x.plant_fail_behind as f64, 0));
    let _ = writeln!(out);
    let _ = writeln!(out, "  Analytic, at p hot rows on a full board (4,000 live cells, 400 colonies alive), every row a tide winner (TGas; NEAR payouts reserve 30 TGas):");
    let _ = writeln!(out, "    {:>7} | {:>6} | {:>7} | {:>19} | {:>15} | {:>13} | {:>22} | {:>22}", "rows p", "join", "plant", "advance through tide", "claim with NEAR", "claim, idle", "gens/catch-up @200|250", "@200, reserve feed only");
    for p in [100.0, 1_500.0, 5_000.0, 10_000.0, 15_000.0, 20_000.0, 25_000.0, 30_000.0] {
        let g = gas_at(p, 4_000.0, 400.0);
        let _ = writeln!(out, "    {:>7.0} | {:>6.1} | {:>7.1} | {:>19.1} | {:>15.1} | {:>13.1} | {:>14} | {:>5} | {:>22}", p, g.join / 1e3, g.plant / 1e3, g.tide / 1e3, g.claim_near / 1e3, g.claim_idle / 1e3, g.gens200, g.gens250, g.gens200_fix);
    }
    let _ = writeln!(out, "    Contract unit runtime (CHANGES-v6, host calls only): 1,501 playing: join 1.53, plant 7.23, advance through a tide 36.6, claim with NEAR 36.3;");
    let _ = writeln!(out, "    30,000 playing: plant 118.8, advance through a tide 148.2, claim with NEAR 147.9. The model above adds wasm and charges the evicted bytes NEAR charges.");
    let _ = writeln!(out, "    'gens/catch-up' = generations one call can step: the limit min(180, prepaid - 40 - p x 77 x 64 Mgas) less the hot-table load; a plant needs the dish");
    let _ = writeln!(out, "    current, so once a call steps fewer generations than are due, plantings fail until someone advances.");
    let _ = writeln!(out);
    // ===== 6. Attacks =====
    let _ = writeln!(out, "=== 6. Attacks ===");
    let r = get("testnet 150p + sybil royalty 7d");
    let rf = get("FIX testnet sybil royalty: royalty from credit-only planters to the agar");
    let _ = writeln!(out, "  (f1) Sybil guests on the testnet rules (150 players + bench + 3 SybilGuest + 3 SybilRoyalty operators, each 1 wallet + 10 free relayer guests; 6 seeds):");
    let _ = writeln!(out, "    {:<14} | {:>26} | {:>26} | {:>22} | {:>22} | {:>26}", "operator", "cash (NEAR)", "with the fix", "royalty in (PETRI)", "guests' credit won", "relayer NEAR per operator");
    for k in [SybilGuest, SybilRoyalty, Guest, Builder] {
        let _ = writeln!(
            out,
            "    {:<14} | {:>26} | {:>26} | {:>22} | {:>22} | {:>26}",
            format!("{:?}", k),
            cell(&per_seed(r, k, &|g| g.cash()), 4),
            cell(&per_seed(rf, k, &|g| g.cash()), 4),
            ucell(&per_seed(r, k, &|g| pf(g.royalty_in)), 1),
            ucell(&per_seed(r, k, &|g| nf(g.credit_won)), 4),
            ucell(&per_seed(r, k, &|g| if g.accounts > 1 { (g.accounts as f64 - 1.0) * 0.053 } else if g.kind == Guest { 0.053 } else { 0.0 }), 3)
        );
    }
    let _ = writeln!(out, "    SybilRoyalty wallet: NEAR from selling PETRI {}; of its royalties, PETRI paid by colonies that never attached NEAR (its own and other free guests) {} (with the fix {}).", ucell(&per_seed(r, SybilRoyalty, &|g| nf(g.sold)), 4), ucell(&per_seed(r, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1), ucell(&per_seed(rf, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1));
    let _ = writeln!(out, "    (One PETRI sells back for at most ~0.0001 NEAR: half the 0.0002 curve price.) Its NEAR from free guests' royalties ~ {} NEAR.", ucell(&per_seed(r, SybilRoyalty, &|g| pf(g.royalty_in_credit) * 0.0001), 4));
    let _ = writeln!(out, "  (f2) Self-sponsor (10 own sub-accounts, 0.05 NEAR each, 0.001 attached once so they are paid NEAR; grants taken back at the end):");
    let _ = writeln!(out, "    alone on the young dish 7 d {}; 14 d {}; in the 150-player society {}; 1,500 {}; reclaimed per operator (150 p) {}", cell(&per_seed(get("young SelfSponsor alone 7d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("young SelfSponsor alone 14d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), SelfSponsor, &|g| g.cash()), 4), ucell(&per_seed(get("mainnet 150p 7d"), SelfSponsor, &|g| nf(g.reclaimed)), 4));
    let _ = writeln!(out, "  (f3) Carpet locker (1.5 NEAR lattice): alone on the young dish 7 d {}; 14 d {}; 15 p {}; 150 p {}; 1,500 p {}; 150 p 30 d {}", cell(&per_seed(get("young Locker alone 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("young Locker alone 14d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 15p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 30d"), Locker, &|g| g.cash()), 4));
    let _ = writeln!(out, "  (f4) Methuselah (an R-pentomino an hour): alone 7 d {}; 14 d {}; 15 p {}; 150 p {}; 1,500 p {}; 150 p 30 d {}", cell(&per_seed(get("young Methuselah alone 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("young Methuselah alone 14d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 15p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 30d"), Methuselah, &|g| g.cash()), 4));
    let rfa = get("mainnet 150p + royalty farmer 7d");
    let rfz = get("FIX farmer: slide_royalty_bps 0");
    let ryf = get("young 20 + royalty farmer 7d");
    let _ = writeln!(out, "  (f5) Slide-royalty farming: one farmer mints slides of 8 common patterns at launch; every other player plants those patterns under its licences.");
    let _ = writeln!(out, "    {:<34} | {:>26} | {:>16} | {:>16} | {:>16} | {:>18}", "", "farmer cash", "royalties PETRI", "licensed plants", "slide storage", "farmer paper");
    for (l, rr) in [("150 p, 7 d", rfa), ("150 p, 7 d, royalty 0 (fix)", rfz), ("young 20, 7 d", ryf)] {
        let _ = writeln!(out, "    {:<34} | {:>26} | {:>16} | {:>16} | {:>16} | {:>18}", l, cell(&per_seed(rr, Farmer, &|g| g.cash()), 4), ucell(&per_seed(rr, Farmer, &|g| pf(g.royalty_in)), 1), wmed(rr, &|_| 0.0, 0).replace("0 (0..0)", &ucell(&rr.iter().map(|x| x.slides.iter().map(|s| s.plantings as f64).sum::<f64>()).collect::<Vec<_>>(), 0)), ucell(&per_seed(rr, Farmer, &|g| nf(g.slide_storage)), 4), cell(&per_seed(rr, Farmer, &|g| g.paper()), 4));
    }
    let _ = writeln!(out, "    Other players with the farmer's licences vs without any slides (150 p, 7 d, cash):");
    for k in [Builder, Defender, Raider, Methuselah, Whale] {
        let _ = writeln!(out, "      {:<12} with licences {:>26}   no slides {:>26}", format!("{:?}", k), cell(&per_seed(rfa, k, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), k, &|g| g.cash()), 4));
    }
    let _ = writeln!(out, "  (f6) House-transfer laundering (house PETRI or NEAR reaching a player other than through the agar and the vault) — every path, as the v6 code has it:");
    for line in [
        "ft_transfer / ft_transfer_call house -> player      refused: token.rs:231 require!(!is_house(from) || is_house(to)); keepers are house (lib.rs is_house)",
        "house sells PETRI back for vault NEAR              refused: lib.rs sell() require!(!colony.house)",
        "house plants a player's slide (royalty to player)  refused: lib.rs plant() require!(!colony.house) when the holder is not the planter",
        "house or keeper takes the keeper pot               refused: lib.rs advance() !is_house(caller)",
        "tide bounty to a house runner (colony or keeper)   none: catch_up_by house_runner -> bounty 0, stays in the vault",
        "tide share / feed to house colonies                none: feed_with and tide_split_sparse skip `house` ids",
        "council pact house -> house, then house -> player  the second hop is the ft_transfer refusal above",
        "house slide NFT given to a player                  allowed (nft_transfer is not restricted), but the house never plants it again and its 16x16",
        "                                                   fossil patterns are not what anyone plants: no royalty flow. The agents never transfer slides.",
        "house NEAR -> vault -> tides                       by design: the house's NEAR is the players' subsidy (section 1 measures who gets it)",
    ] {
        let _ = writeln!(out, "    {}", line);
    }
    let lp: Vec<f64> = runs.iter().flatten().map(|x| pf(x.world.house_to_players_petri)).collect();
    let _ = writeln!(out, "    In every simulated run (the sim mirrors these checks; a house licence plant asserts): house PETRI moved to non-house accounts = {} PETRI (max over {} runs).", lp.iter().cloned().fold(0.0, f64::max), lp.len());
    let _ = writeln!(out);
    // ===== 7. Model =====
    let _ = writeln!(out, "=== 7. Rules, storage and gas model, house model ===");
    let same = {
        let strip = |s: String| s;
        strip(rt.economics()) == strip(rm.economics())
    };
    header(&mut out, rm, paths, same);
    // ===== 8. Details =====
    let _ = writeln!(out, "=== 8. Per-scenario detail ===");
    let _ = writeln!(out, "  Columns per player (median over seeds of the kind's mean player): attached / sponsored / gas paid; claimed / sold / bounty / reclaimed received; cash and");
    let _ = writeln!(out, "  paper; credit won and left; royalties received and paid (PETRI); e/s = PETRI earned / spent; feed% and tide% = the kind's share of the feed and of tide shares.");
    let mut tl = String::from("scenario,seed,generation,wall,ran,live,counted,agar_petri,vault_near,credit_pool_near,feed_per_cell_petri,cell_price_petri,free_cells_pct,free_block_pct,newcomer_block_near,newcomer_siege,siege_block_near,pay_near,split_near,storage_near,winners,hot_rows,tide_gas_tgas,first_share,top_share,outsiders\n");
    let mut pc = String::from("scenario,seed,player,kind,accounts,join_gen,attached,sponsored,gas,claimed,sold,bounty,reclaimed,owed,held_floor,cash,paper,credit_won,credit_left,petri_earned,petri_spent,royalty_in,royalty_out,live_end\n");
    for (i, s) in scen.iter().enumerate() {
        let rs = &runs[i];
        let secs: f64 = rs.iter().map(|x| x.world.secs).sum::<f64>() / rs.len().max(1) as f64;
        let _ = writeln!(out, "== {} == ({} outsiders + house, {} colonies, {} days, {:?}, {} seeds, {:.1} s per run){}", s.name, players(&s.society), colonies(&s.society), s.setup.days, s.setup.net, rs.len(), secs, if s.rules.overrides.is_empty() { String::new() } else { format!(" OVERRIDES {}", s.rules.overrides.join(", ")) });
        kind_detail(&mut out, rs);
        world_lines(&mut out, rs, s.setup.days);
        let _ = writeln!(out);
        let big = s.name.starts_with("sat") || s.name.starts_with("scale");
        if !big && !s.name.starts_with("FIX") {
            csv_timeline(&mut tl, &s.name, rs);
        }
        if !big && colonies(&s.society) <= 2_500 {
            csv_players(&mut pc, &s.name, rs);
        }
    }
    let _ = writeln!(out, "Wall time {:.0} s on {} threads.", t0.elapsed().as_secs_f64(), std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1));
    fs::write(format!("{}/summary-body.txt", out_dir), &out).unwrap();
    write_capped(&format!("{}/timeline", out_dir), &tl);
    write_capped(&format!("{}/players", out_dir), &pc);
    // Fix experiments table.
    let mut fx = String::new();
    let _ = writeln!(fx, "=== Measured fix experiments (same seeds as the launched-rules runs) ===");
    let _ = writeln!(fx, "  Young mainnet, 7 days: median cash per player; vault left; house NEAR paid; tide-entry storage as % of tide pay.");
    let _ = writeln!(fx, "  {:<52} | {:>9} {:>9} {:>9} {:>9} {:>9} | {:>9} | {:>9} | {:>8}", "", "Penny", "Builder", "Raider", "Methus.", "Whale", "vault", "house pd", "stor%");
    let rowfx = |fx: &mut String, label: &str, name: &str| {
        let r = get(name);
        let _ = write!(fx, "  {:<52} |", label);
        for k in [Penny, Builder, Raider, Methuselah, Whale] {
            let v = med_of(per_seed(r, k, &|g| g.cash()));
            if v.is_nan() {
                let _ = write!(fx, " {:>9}", "-");
            } else {
                let _ = write!(fx, " {:>+9.4}", v);
            }
        }
        let pay = med_of(r.iter().map(|x| nf(x.timeline.iter().filter(|t| t.ran).map(|t| t.pay).sum())).collect());
        let st = med_of(r.iter().map(|x| nf(x.timeline.iter().filter(|t| t.ran).map(|t| t.storage).sum())).collect());
        let _ = writeln!(fx, " | {:>9.4} | {:>9.4} | {:>7.0}%", med_of(wv(r, &|x| nf(x.vault))), med_of(wv(r, &|x| nf(x.house_paid))), 100.0 * st / pay.max(1e-12));
    };
    for (who, base) in [("Penny alone", "young Penny alone 7d"), ("5 outsiders", "young 5 7d"), ("20 outsiders", "young 20 7d")] {
        rowfx(&mut fx, &format!("{} | launched rules", who), base);
        for label in ["tide_cap_bps 2500", "small tide entry (120 B)", "tide_bps 200", "tide_every 960"] {
            let n = match who {
                "Penny alone" => format!("FIX young Penny alone 7d | {}", label),
                "5 outsiders" => format!("FIX young 5 7d | {}", label),
                _ => format!("FIX young 20 7d | {}", label),
            };
            rowfx(&mut fx, &format!("{} | {}", who, label), &n);
        }
    }
    let _ = writeln!(fx);
    let a = get("mainnet 150p 7d");
    let b = get("FIX mainnet 150p 7d | keeper pot to any call that runs a generation");
    let _ = writeln!(fx, "  Keeper pot, mainnet 150 p 7 d: pot left at the end {} PETRI (launched) vs {} (pot to any call); Racer cash {} vs {}; Builder {} vs {}", wmed(a, &|x| pf(x.keeper_pot), 1), wmed(b, &|x| pf(x.keeper_pot), 1), cell(&per_seed(a, Racer, &|g| g.cash()), 4), cell(&per_seed(b, Racer, &|g| g.cash()), 4), cell(&per_seed(a, Builder, &|g| g.cash()), 4), cell(&per_seed(b, Builder, &|g| g.cash()), 4));
    let kr = get("testnet house + bench + 5 guests 3d (keeper registered)");
    let kn = get("testnet house + bench + 5 guests 3d (keeper not registered)");
    let _ = writeln!(fx, "  Testnet keeper (agents/run.mjs advances whenever the pot > 50 PETRI if registered; v6 never pays it the pot): calls/day {} vs {} unregistered; gas/day {} vs {} NEAR at mainnet gas price (testnet's is 10x); pot left {} PETRI", wmed(kr, &|x| x.keeper.calls as f64 / 3.0, 0), wmed(kn, &|x| x.keeper.calls as f64 / 3.0, 0), wmed(kr, &|x| nf(x.keeper.gas) / 3.0, 4), wmed(kn, &|x| nf(x.keeper.gas) / 3.0, 4), wmed(kr, &|x| pf(x.keeper_pot), 1));
    let _ = writeln!(fx, "  Testnet sybil royalty: SybilRoyalty operator cash {} (launched) vs {} (royalty from credit-only planters to the agar); royalties {} vs {} PETRI", cell(&per_seed(get("testnet 150p + sybil royalty 7d"), SybilRoyalty, &|g| g.cash()), 4), cell(&per_seed(get("FIX testnet sybil royalty: royalty from credit-only planters to the agar"), SybilRoyalty, &|g| g.cash()), 4), ucell(&per_seed(get("testnet 150p + sybil royalty 7d"), SybilRoyalty, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(get("FIX testnet sybil royalty: royalty from credit-only planters to the agar"), SybilRoyalty, &|g| pf(g.royalty_in)), 1));
    let _ = writeln!(fx, "  Royalty farmer, 150 p 7 d: farmer cash {} (launched) vs {} (slide_royalty_bps 0)", cell(&per_seed(rfa, Farmer, &|g| g.cash()), 4), cell(&per_seed(rfz, Farmer, &|g| g.cash()), 4));
    let _ = writeln!(fx, "  Gas: generations one call can step at p hot rows with 200 TGas prepaid, launched (reserve both parts of the hot table) vs reserving only the feed part:");
    for p in [10_000.0, 15_000.0, 20_000.0, 25_000.0, 30_000.0] {
        let g = gas_at(p, 4_000.0, 400.0);
        let _ = writeln!(fx, "    p {:>6.0}: {:>3} vs {:>3} generations; plant {:.0} TGas, advance through a tide {:.0} TGas", p, g.gens200, g.gens200_fix, g.plant / 1e3, g.tide / 1e3);
    }
    for (label, name) in [("launched", "scale 30000"), ("rows leave below stake 125", "FIX scale 30000 | hot rows leave below one paid cell (stake < 125)")] {
        let r = get(name);
        let mx = |c: Call| med_of(r.iter().map(|x| x.world.gas_max[c.idx()][0].max(x.world.gas_max[c.idx()][1]) / 1000.0).collect());
        let over: u64 = r.iter().map(|x| x.world.over_prepaid.iter().sum::<u64>()).sum();
        let plants: u64 = r.iter().map(|x| x.world.call_count[Call::Plant.idx()]).sum();
        let _ = writeln!(fx, "  30,000 colonies, 2 days | {:<28}: hot rows avg {} max {}; max gas plant {:.0}, join {:.0}, claim {:.0}, buy {:.0} TGas; calls over prepaid {} ({} plants in all)", label, wmed(r, &|x| x.hot_avg, 0), wmed(r, &|x| x.hot_max as f64, 0), mx(Call::Plant), mx(Call::Join), mx(Call::Claim), mx(Call::Buy), over, plants);
    }
    let a = get("mainnet 150p 7d");
    let b = get("FIX mainnet 150p 7d | hot rows leave below one paid cell (stake < 125)");
    let _ = writeln!(fx, "  Same rule, mainnet 150 p 7 d (economics should not move): Builder {} vs {}; Methuselah {} vs {}; hot rows avg {} vs {}", cell(&per_seed(a, Builder, &|g| g.cash()), 4), cell(&per_seed(b, Builder, &|g| g.cash()), 4), cell(&per_seed(a, Methuselah, &|g| g.cash()), 4), cell(&per_seed(b, Methuselah, &|g| g.cash()), 4), wmed(a, &|x| x.hot_avg, 0), wmed(b, &|x| x.hot_avg, 0));
    fs::write(format!("{}/fixes-measured.txt", out_dir), &fx).unwrap();
    print!("{}", fx);
    eprintln!("wall {:.0} s", t0.elapsed().as_secs_f64());
}

/// Write `<base>.csv`, split into numbered parts if it would pass 5 MB.
fn write_capped(base: &str, csv: &str) {
    const MAX: usize = 4_900_000;
    if csv.len() <= MAX {
        fs::write(format!("{}.csv", base), csv).unwrap();
        return;
    }
    let (head, body) = csv.split_once('\n').unwrap();
    let mut part = 1;
    let mut cur = String::from(head);
    cur.push('\n');
    for line in body.lines() {
        if cur.len() + line.len() + 1 > MAX {
            fs::write(format!("{}-{}.csv", base, part), &cur).unwrap();
            part += 1;
            cur = String::from(head);
            cur.push('\n');
        }
        cur.push_str(line);
        cur.push('\n');
    }
    fs::write(format!("{}-{}.csv", base, part), &cur).unwrap();
}
