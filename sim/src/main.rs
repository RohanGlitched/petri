//! Petri economy simulator, v6.1 (and v6 behind the `v6` switch).
//!
//! Runs the real rules from `petri-core` (Life, the capped feed on decaying stake, planting prices with the siege
//! surcharge and slide licences, the purchase and sell-back curves, the tide split) for days of generations, with
//! scripted players including adversaries and the house strains as agents/ plays them, and reports what every kind of
//! player ends up with **in NEAR actually withdrawn**. The contract's book-keeping is mirrored from contract/src v6.1
//! (see world.rs); parameters are read from the launch-rules files of both dishes.
//!
//! ```text
//! cargo run --release -- <out_dir> all [--testnet path] [--mainnet path] [--seeds n]
//! ```

mod model;
mod sixty;
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
    let tide = 4.0 * G_SOP + TIDE_BYTES_V6 as f64 * G_WB + p * (W_TIDE_ROW + W_WINNER + 10.0) * G_OP;
    let cold = 2.0 * G_SOP + (page(true) as u128 * cold(true)) as f64 * (G_RB + G_WB);
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

struct GasAt61 {
    join: f64,
    plant: f64,
    tide: f64,
    claim_near: f64,
    claim_idle: f64,
    gens300: u64,
    gens300_tide: u64,
}

/// v6.1 at `p` hot rows (every one a tide winner), the same full board: the catch-up reserves the feed part, the purse
/// part only when a tide falls in it, and 32 cold pages; a planting also reads its cold slot and a tide call flushes up
/// to 32 rows into pages of 32 x 69 B.
fn gas_at_61(p: f64, live: f64, alive: f64) -> GasAt61 {
    let board = 2048.0 + 2.0 * live;
    let board_rw = 2.0 * G_SOP + board * (G_RB + G_WB) + 30.0 * live * G_OP;
    let load = 2.0 * G_SOP + p * HOT_ROW as f64 * G_RB + p * W_LOAD_ROW * G_OP;
    let store_feed = G_SOP + p * HOT_FEED as f64 * G_WB + p * W_STORE_FEED_ROW * G_OP;
    let store_purse = G_SOP + p * HOT_PURSE as f64 * G_WB + p * W_STORE_PURSE_ROW * G_OP;
    let gen = (20_000.0 + 60.0 * live + 150.0 * alive) * G_OP;
    let tide = 4.0 * G_SOP + (TIDE_ENTRY_V61 + 4) as f64 * G_WB + p * (W_TIDE_ROW + W_WINNER + 10.0) * G_OP;
    let page_rw = 2.0 * G_SOP + (page(false) as u128 * cold(false)) as f64 * (G_RB + G_WB);
    let flush = FLUSH_MAX as f64 * page_rw + p * W_FLUSH_SCAN_ROW * G_OP;
    let gens = |prepaid: f64, tide_ahead: bool| -> u64 {
        let store = p * HOT_FEED as f64 * G_HOT_WRITE_BYTE_V61 + if tide_ahead { p * HOT_PURSE as f64 * G_HOT_WRITE_BYTE_V61 } else { 0.0 } + FLUSH_MAX as f64 * G_FLUSH_PAGE_RESERVE;
        let limit = G_CATCHUP_LIMIT_V61.min(prepaid - G_RESERVE - store);
        let used0 = G_CALL + load + 2.0 * G_SOP + board * G_RB;
        let room = limit - used0;
        if room <= gen {
            1
        } else {
            ((room / gen) as u64 + 1).min(120)
        }
    };
    GasAt61 {
        join: G_CALL + 12.0 * G_SOP + page_rw + 400.0 * G_WB,
        plant: G_CALL + 15.0 * G_SOP + board_rw + 4_000.0 * G_OP + 500.0 * G_WB + load + store_feed + store_purse + p * 10.0 * G_OP + page_rw / 2.0,
        tide: G_CALL + 3.0 * G_SOP + board_rw + load + store_feed + store_purse + gen + tide + flush + G_PAYOUT_RESERVE,
        claim_near: G_CALL + 6.0 * G_SOP + load + store_feed + store_purse + 300.0 * G_WB + G_PAYOUT_RESERVE,
        claim_idle: G_CALL + 6.0 * G_SOP + load + page_rw,
        gens300: gens(300_000.0, false),
        gens300_tide: gens(300_000.0, true),
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
    let _ = writeln!(out, "  slide_discount_bps {}, slide_royalty_bps {}, licence_min_cells {}, house {} strains, keepers {:?}.", r.slide_discount_bps, r.slide_royalty_bps, r.licence_min_cells, r.house.len(), r.keepers);
    let _ = writeln!(out, "Storage, from the v6.1 borsh layout (key + value + 40 B per record; 1e19 yocto a byte; v6's in brackets where it differs):");
    let _ = writeln!(out, "  join {} B [{}] for a 16-char wallet (Colony {} + colony_of 63 + name 57 + balance 77 + Join entry 56 + cold slot 69 [57] + 113 [140] charged for the", join_bytes(16, 12, false, false), join_bytes(16, 12, false, true), colony_bytes(16, 12));
    let _ = writeln!(out, "    Buy entry, which is 97 B, 113 with `spent` [105/121]; a new cold page of 32 [64] adds 43); buy 113 B [140] charged;");
    let _ = writeln!(out, "  plant_deposit = (180 [240] + 77 [first hot row] + 82 [empty table] + 4c + note+64 + licence 26+L [33+L]) B + 0.0001/cell;");
    let _ = writeln!(out, "  stored by a planting: Plant entry 103+2c [111+2c] (+16 spent, +{} [{}] licence with a 16-char holder) + index 49 [53] + board 2c + 8 first time", licence_bytes(Some(16), false), licence_bytes(Some(16), true));
    let _ = writeln!(out, "    + note 45+n [49+n] + hot row 77 (house colonies never have one in v6.1); the rest of the deposit (fee included) goes to the vault or credit pool; a row");
    let _ = writeln!(out, "    leaving the hot table frees 77 B to the contract.");
    let _ = writeln!(out, "  sell entry {} B [{}] from the proceeds (a NEAR sale must also cover {} B for a possible refund); claim entry {} B [{}] from the NEAR (claims need > {} B);", sell_bytes(false), sell_bytes(true), PAYOUT_RESERVE, claim_bytes(false), claim_bytes(true), claim_bytes(false) + PAYOUT_RESERVE);
    let _ = writeln!(out, "  tide entry {} B + 4 B in the packed tide index (+45 on the tide that starts a 256-position page) = {} B = {:.5} NEAR from the vault per tide that runs [289 B];", TIDE_ENTRY_V61, TIDE_ENTRY_V61 + 4, nf((TIDE_ENTRY_V61 + 4) * BYTE));
    let _ = writeln!(out, "  skip entry {} B (contract); sponsor (first grant) {} B for a guest (entry 78+La+Ls, grants record 77+La+Ls, Unsponsor reserve 210); slide 4x4 {} B, 16x16 {} B", SKIP_BYTES, sponsor_bytes(L_GUEST, L_RELAYER, true, true), slide_bytes(16, 4, 4, 0, true, false), slide_bytes(22, 16, 16, 30, false, false));
    let _ = writeln!(out, "    (record, owner list, entry, 184 reserve). The contract's own code: ~{} B of wasm (v6.1 estimate; v6 {}) = {:.2} NEAR staked by the dish account.", WASM_BYTES, WASM_BYTES_V6, nf(WASM_BYTES * BYTE));
    let _ = writeln!(out, "Gas (NEAR protocol fee schedule; 1 TGas = 0.0001 NEAR at the minimum gas price): call {} TGas + {} Ggas per storage op + {:.1} Mgas per byte read / {:.1} Mgas", G_CALL / 1000.0, G_SOP, G_RB * 1000.0, G_WB * 1000.0);
    let _ = writeln!(out, "  per byte rewritten (value + evicted value + memory/registers) + 0.82 Mgas per wasm op. Hot table: loaded once per call that needs a colony's books (77 B a row");
    let _ = writeln!(out, "  read, ~{} ops a row to parse), the feed part (26 B) rewritten by every catch-up, the purse part (51 B) by tides and purse changes (~{} / {} ops a row to write);", W_LOAD_ROW, W_STORE_FEED_ROW, W_STORE_PURSE_ROW);
    let _ = writeln!(out, "  a generation ~20k + 60 x live + 150 x colonies alive ops; a tide 4 writes + its 130 B + {} ops a row + {} per winner. A NEAR payout burns ~{} TGas and reserves", W_TIDE_ROW, W_WINNER, G_PAYOUT_BURN / 1000.0);
    let _ = writeln!(out, "  {} TGas of the call's prepaid gas (counted in 'max gas'). v6.1 hot table: colonies that earned since the last tide, or that have living cells and a stake", G_PAYOUT_RESERVE / 1000.0);
    let _ = writeln!(out, "  of at least STAKE_UNIT / reach = 125 (never the house), at most {} rows; at most {} rows leave a call, each into its cold page (32 x 69 B). Catch-up limit", MAX_PLAYING, FLUSH_MAX);
    let _ = writeln!(out, "  min(110, prepaid - 40 - rows x 26 B x 72 Mgas - [rows x 51 B x 72 Mgas if a tide falls in the catch-up] - 32 x 0.35) TGas [v6: min(180, prepaid - 40 - rows x 77 x 64 M)].");
    let _ = writeln!(out, "  Prepaid on the site: 300 TGas for join, plant, buy, sell, claim, advance and mint_slide [v6: 200 / 250]; the house's agents unchanged (plant 200, buy/claim 150).");
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
    let _ = writeln!(out, "  royalty to the holder; v6.1: only slides of >= licence_min_cells cells, and a planter that never attached NEAR pays the royalty to the agar), in the slide's");
    let _ = writeln!(out, "  orientation. Kinds: see sim/src/world.rs `Kind` (Penny = min_join 0.01 NEAR, one block kept alive and paid). The Farmer mints only patterns that license.");
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
        Some("days60") => sixty::days60(&out_dir, &rm, opt(&opts, "seeds").and_then(|s| s.parse().ok()).unwrap_or(5)),
        Some("bench") => sixty::bench(&out_dir, &rm, opt(&opts, "seasons").and_then(|s| s.parse().ok()).unwrap_or(1000)),
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
        _ => eprintln!("usage: petri-sim <out_dir> all|days60|bench [--testnet path] [--mainnet path] [--seeds n] [--seasons n]"),
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
    // (e) 30,000 colonies, v6.1 and v6 on the same seeds.
    let v6m = rm.with(&[("v6", "1")]);
    let v6t = rt.with(&[("v6", "1")]);
    scen.push(sc("scale 30000", rm, mainnet(2), mixed(30_000, 1.5), 2, 30_000));
    scen.push(sc("V6 scale 30000", &v6m, mainnet(2), mixed(30_000, 1.5), 2, 30_000));
    scen.push(sc("V6 mainnet 150p 7d", &v6m, mainnet(7), society(150, Net::Mainnet), 8, 150));
    // (f) attacks.
    let mut sybil = society(150, Net::Testnet);
    sybil.push(spec(SybilRoyalty, 3, 11));
    scen.push(sc("testnet 150p + sybil royalty 7d", rt, testnet(7), sybil.clone(), 6, 151));
    scen.push(sc("V6 testnet 150p + sybil royalty 7d", &v6t, testnet(7), sybil.clone(), 6, 151));
    scen.push(sc("FIX testnet sybil royalty 7d | licence_min_cells 0 (only the royalty-to-agar fix)", &rt.with(&[("licence_min_cells", "0")]), testnet(7), sybil, 6, 151));
    let mut farm = society(150, Net::Mainnet);
    farm.push(spec(Farmer, 1, 1));
    scen.push(sc("mainnet 150p + royalty farmer 7d", rm, mainnet(7), farm.clone(), 8, 150));
    scen.push(sc("V6 mainnet 150p + royalty farmer 7d", &v6m, mainnet(7), farm.clone(), 8, 150));
    scen.push(sc("FIX farmer 150p 7d | licence_min_cells 0", &rm.with(&[("licence_min_cells", "0")]), mainnet(7), farm.clone(), 8, 150));
    scen.push(sc("FIX farmer 150p 7d | slide_royalty_bps 0", &rm.with(&[("slide_royalty_bps", "0")]), mainnet(7), farm.clone(), 8, 150));
    scen.push(sc("FIX farmer 150p 7d | licence_min_cells 49", &rm.with(&[("licence_min_cells", "49")]), mainnet(7), farm.clone(), 8, 150));
    let mut farm_young = young(20, Penny);
    farm_young.push(spec(Farmer, 1, 1));
    scen.push(sc("young 20 + royalty farmer 7d", rm, mainnet(7), farm_young.clone(), seeds, 13));
    scen.push(sc("FIX farmer young 20 7d | slide_royalty_bps 0", &rm.with(&[("slide_royalty_bps", "0")]), mainnet(7), farm_young.clone(), seeds, 13));
    scen.push(sc("FIX farmer young 20 7d | licence_min_cells 49", &rm.with(&[("licence_min_cells", "49")]), mainnet(7), farm_young.clone(), seeds, 13));
    scen.push(sc("V6 young 20 + royalty farmer 7d", &v6m, mainnet(7), farm_young, seeds, 13));
    // v6 on the young mainnet, and the tide experiments on v6.1.
    scen.push(sc("V6 young Penny alone 7d", &v6m, mainnet(7), young(1, Penny), seeds, 11));
    scen.push(sc("V6 young 5 7d", &v6m, mainnet(7), young(5, Penny), seeds, 12));
    scen.push(sc("V6 young 20 7d", &v6m, mainnet(7), young(20, Penny), seeds, 13));
    for (label, set) in [("tide_cap_bps 2500", vec![("tide_cap_bps", "2500")]), ("tide_bps 200", vec![("tide_bps", "200")]), ("tide_every 960", vec![("tide_every", "960")])] {
        let r = rm.with(&set);
        scen.push(sc(&format!("FIX young Penny alone 7d | {}", label), &r, mainnet(7), young(1, Penny), seeds, 11));
        scen.push(sc(&format!("FIX young 5 7d | {}", label), &r, mainnet(7), young(5, Penny), seeds, 12));
        scen.push(sc(&format!("FIX young 20 7d | {}", label), &r, mainnet(7), young(20, Penny), seeds, 13));
    }
    // (g) part 2: free play reaching NEAR (kept PETRI), and pacts.
    let mut exits = society(150, Net::Testnet);
    exits.push(spec(SybilAttach, 3, 11));
    exits.push(spec(SybilTransfer, 3, 11));
    let nokept_t = rt.with(&[("kept", "0")]);
    scen.push(sc("testnet 150p + sybil exits 7d", rt, testnet(7), exits.clone(), 6, 153));
    scen.push(sc("NOKEPT testnet 150p + sybil exits 7d", &nokept_t, testnet(7), exits, 6, 153));
    scen.push(sc("NOKEPT mainnet 150p 7d", &rm.with(&[("kept", "0")]), mainnet(7), society(150, Net::Mainnet), 8, 150));
    let pacts_m = rm.with(&[("pacts", "1")]);
    scen.push(sc("PACTS young 5 7d", &pacts_m, mainnet(7), young(5, Penny), seeds, 12));
    scen.push(sc("PACTS young 20 7d", &pacts_m, mainnet(7), young(20, Penny), seeds, 13));
    scen.push(sc("PACTS mainnet 150p 7d", &pacts_m, mainnet(7), society(150, Net::Mainnet), 8, 150));
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
    let _ = writeln!(out, "Petri v6.1 economy simulation (sim/src: main.rs, world.rs, model.rs) on the launch rules of both dishes (contract v6.1; v6 runs marked V6).");
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
    let _ = writeln!(out, "  Where the tides went on the young dish, 7 days (medians): pay = 5% of the vault per tide; storage = the tide's 130 B (v6: 289 B) paid from it.");
    for name in ["young Penny alone 7d", "V6 young Penny alone 7d", "young 5 7d", "V6 young 5 7d", "young 20 7d", "V6 young 20 7d"] {
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
    let _ = writeln!(out, "=== 5. Scale and gas: the v6.1 layout, and v6's on the same seeds ===");
    let cols30 = colonies(&scen.iter().find(|s| s.name == "scale 30000").unwrap().society);
    for (label, name, prepaid) in [("v6.1", "scale 30000", "site: 300 for every call"), ("v6", "V6 scale 30000", "site: join/plant/buy/sell 200, claim/advance 250")] {
        let r30 = get(name);
        let _ = writeln!(out, "  {}: {} colonies (mixed outsiders joining over 1.5 days + house), 2 days, {} seeds. Largest gas per call (TGas, payouts' 30 TGas reservation", label, cols30, r30.len());
        let _ = writeln!(out, "  included), the hot rows when it happened, calls over the 150 TGas target and calls over their prepaid gas ({}):", prepaid);
        let _ = writeln!(out, "    {:<10} | {:>22} | {:>22} | {:>12} | {:>12} | {:>14}", "call", "no tide in catch-up", "with a tide", "calls", "over 150", "over prepaid");
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
            let over150: u64 = r30.iter().map(|x| x.world.over_target[c.idx()]).sum();
            let _ = writeln!(out, "    {:<10} | {:>22} | {:>22} | {:>12} | {:>12} | {:>14}", format!("{:?}", c), m(0), m(1), n / r30.len() as u64, over150, over);
        }
        let _ = writeln!(
            out,
            "    hot rows avg {} max {}; rows that left {}; catch-ups cut short by the gas limit {}; plantings refused as behind the clock {}; refused as the table was full {}",
            wmed(r30, &|x| x.hot_avg, 0),
            wmed(r30, &|x| x.hot_max as f64, 0),
            wmed(r30, &|x| x.hot_left as f64, 0),
            wmed(r30, &|x| x.partial_catchups as f64, 0),
            wmed(r30, &|x| x.plant_fail_behind as f64, 0),
            wmed(r30, &|x| x.plant_refused_full as f64, 0)
        );
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "  Analytic, v6.1, at p hot rows on a full board (4,000 live cells, 400 colonies alive), every row a tide winner (TGas; NEAR payouts reserve 30 TGas;");
    let _ = writeln!(out, "  the tide call also moves 32 rows to their cold pages). The table holds at most 10,000 rows.");
    let _ = writeln!(out, "    {:>7} | {:>6} | {:>7} | {:>19} | {:>15} | {:>13} | {:>26}", "rows p", "join", "plant", "advance through tide", "claim with NEAR", "claim, idle", "gens/catch-up @300 (tide in)");
    for p in [100.0, 1_500.0, 3_000.0, 5_000.0, 7_500.0, 10_000.0] {
        let g = gas_at_61(p, 4_000.0, 400.0);
        let _ = writeln!(out, "    {:>7.0} | {:>6.1} | {:>7.1} | {:>19.1} | {:>15.1} | {:>13.1} | {:>14} ({:>3})", p, g.join / 1e3, g.plant / 1e3, g.tide / 1e3, g.claim_near / 1e3, g.claim_idle / 1e3, g.gens300, g.gens300_tide);
    }
    let _ = writeln!(out, "  Analytic, v6 (every colony with stake has a row), same board:");
    let _ = writeln!(out, "    {:>7} | {:>6} | {:>7} | {:>19} | {:>15} | {:>13} | {:>22} | {:>22}", "rows p", "join", "plant", "advance through tide", "claim with NEAR", "claim, idle", "gens/catch-up @200|250", "@200, reserve feed only");
    for p in [100.0, 1_500.0, 5_000.0, 10_000.0, 15_000.0, 20_000.0, 25_000.0, 30_000.0] {
        let g = gas_at(p, 4_000.0, 400.0);
        let _ = writeln!(out, "    {:>7.0} | {:>6.1} | {:>7.1} | {:>19.1} | {:>15.1} | {:>13.1} | {:>14} | {:>5} | {:>22}", p, g.join / 1e3, g.plant / 1e3, g.tide / 1e3, g.claim_near / 1e3, g.claim_idle / 1e3, g.gens200, g.gens250, g.gens200_fix);
    }
    let _ = writeln!(out, "    'gens/catch-up' = generations one call can step: the catch-up limit less the hot-table load; a plant needs the dish current, so once a call steps");
    let _ = writeln!(out, "    fewer generations than are due, plantings fail until someone advances.");
    let _ = writeln!(out);
    // ===== 6. Attacks =====
    let _ = writeln!(out, "=== 6. Attacks ===");
    let r = get("testnet 150p + sybil royalty 7d");
    let rv6 = get("V6 testnet 150p + sybil royalty 7d");
    let rl0 = get("FIX testnet sybil royalty 7d | licence_min_cells 0 (only the royalty-to-agar fix)");
    let _ = writeln!(out, "  (f1) Sybil guests on the testnet rules (150 players + bench + 3 SybilGuest + 3 SybilRoyalty operators, each 1 wallet + 10 free relayer guests; 6 seeds).");
    let _ = writeln!(out, "  The royalty operator mints a beehive slide (6 cells: no licence in v6.1); 'v6.1, licence_min 0' keeps its licence to isolate the royalty-to-agar rule:");
    let _ = writeln!(out, "    {:<14} | {:>26} | {:>26} | {:>26} | {:>16} | {:>16} | {:>22}", "operator", "cash v6.1", "cash v6", "cash v6.1, licence_min 0", "royalty in v6", "royalty in l0", "guests' credit won");
    for k in [SybilGuest, SybilRoyalty, Guest, Builder] {
        let _ = writeln!(
            out,
            "    {:<14} | {:>26} | {:>26} | {:>26} | {:>16} | {:>16} | {:>22}",
            format!("{:?}", k),
            cell(&per_seed(r, k, &|g| g.cash()), 4),
            cell(&per_seed(rv6, k, &|g| g.cash()), 4),
            cell(&per_seed(rl0, k, &|g| g.cash()), 4),
            ucell(&per_seed(rv6, k, &|g| pf(g.royalty_in)), 1),
            ucell(&per_seed(rl0, k, &|g| pf(g.royalty_in)), 1),
            ucell(&per_seed(r, k, &|g| nf(g.credit_won)), 4)
        );
    }
    let _ = writeln!(
        out,
        "    SybilRoyalty wallet: of its royalties, PETRI paid by colonies that never attached NEAR: v6 {}, v6.1 licence_min 0 {}, v6.1 {}; royalties sent to the agar instead (v6.1 licence_min 0) {} PETRI.",
        ucell(&per_seed(rv6, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1),
        ucell(&per_seed(rl0, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1),
        ucell(&per_seed(r, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1),
        wmed(rl0, &|x| pf(x.royalties_to_agar), 1)
    );
    let _ = writeln!(out, "    NEAR from selling PETRI, SybilRoyalty wallet: v6 {}, v6.1 {}. (One PETRI sells back for at most ~0.0001 NEAR.)", ucell(&per_seed(rv6, SybilRoyalty, &|g| nf(g.sold)), 4), ucell(&per_seed(r, SybilRoyalty, &|g| nf(g.sold)), 4));
    let _ = writeln!(out, "  (f2) Self-sponsor (10 own sub-accounts, 0.05 NEAR each, 0.001 attached once so they are paid NEAR; grants taken back at the end):");
    let _ = writeln!(out, "    alone on the young dish 7 d {}; 14 d {}; in the 150-player society {}; 1,500 {}; reclaimed per operator (150 p) {}", cell(&per_seed(get("young SelfSponsor alone 7d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("young SelfSponsor alone 14d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), SelfSponsor, &|g| g.cash()), 4), ucell(&per_seed(get("mainnet 150p 7d"), SelfSponsor, &|g| nf(g.reclaimed)), 4));
    let _ = writeln!(out, "  (f3) Carpet locker (1.5 NEAR lattice): alone on the young dish 7 d {}; 14 d {}; 15 p {}; 150 p {}; 1,500 p {}; 150 p 30 d {}", cell(&per_seed(get("young Locker alone 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("young Locker alone 14d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 15p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), Locker, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 30d"), Locker, &|g| g.cash()), 4));
    let _ = writeln!(out, "  (f4) Methuselah (an R-pentomino an hour): alone 7 d {}; 14 d {}; 15 p {}; 150 p {}; 1,500 p {}; 150 p 30 d {}", cell(&per_seed(get("young Methuselah alone 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("young Methuselah alone 14d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 15p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 1500p 7d"), Methuselah, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 30d"), Methuselah, &|g| g.cash()), 4));
    let rfa = get("mainnet 150p + royalty farmer 7d");
    let rfv6 = get("V6 mainnet 150p + royalty farmer 7d");
    let rfl0 = get("FIX farmer 150p 7d | licence_min_cells 0");
    let ryf = get("young 20 + royalty farmer 7d");
    let ryfv6 = get("V6 young 20 + royalty farmer 7d");
    let _ = writeln!(out, "  (f5) Slide-royalty farming: one farmer mints slides of common patterns at launch (v6: beehive, loaf, eater, glider, LWSS, R-pentomino, toad, pulsar;");
    let _ = writeln!(out, "  v6.1: only those of >= licence_min_cells 12 cells, i.e. the pulsar); every other player plants those patterns under its licences.");
    let _ = writeln!(out, "    {:<34} | {:>26} | {:>16} | {:>16} | {:>16} | {:>18}", "", "farmer cash", "royalties PETRI", "licensed plants", "slide storage", "farmer paper");
    for (l, rr) in [("150 p, 7 d, v6.1", rfa), ("150 p, 7 d, v6", rfv6), ("150 p, 7 d, v6.1 licence_min 0", rfl0), ("young 20, 7 d, v6.1", ryf), ("young 20, 7 d, v6", ryfv6)] {
        let _ = writeln!(out, "    {:<34} | {:>26} | {:>16} | {:>16} | {:>16} | {:>18}", l, cell(&per_seed(rr, Farmer, &|g| g.cash()), 4), ucell(&per_seed(rr, Farmer, &|g| pf(g.royalty_in)), 1), ucell(&rr.iter().map(|x| x.slides.iter().map(|s| s.plantings as f64).sum::<f64>()).collect::<Vec<_>>(), 0), ucell(&per_seed(rr, Farmer, &|g| nf(g.slide_storage)), 4), cell(&per_seed(rr, Farmer, &|g| g.paper()), 4));
    }
    let _ = writeln!(out, "    Other players with the farmer's licences vs without the farmer (150 p, 7 d, cash; v6.1 and v6):");
    for k in [Builder, Defender, Raider, Methuselah, Whale] {
        let _ = writeln!(out, "      {:<12} v6.1 with farmer {:>26}  without {:>26}  |  v6 with farmer {:>26}  without {:>26}", format!("{:?}", k), cell(&per_seed(rfa, k, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), k, &|g| g.cash()), 4), cell(&per_seed(rfv6, k, &|g| g.cash()), 4), cell(&per_seed(get("V6 mainnet 150p 7d"), k, &|g| g.cash()), 4));
    }
    let _ = writeln!(out, "  (f6) House-transfer laundering (house PETRI or NEAR reaching a player other than through the agar and the vault) — every path, as the v6.1 code has it (unchanged from v6 except the keeper pot):");
    for line in [
        "ft_transfer / ft_transfer_call house -> player      refused: token.rs:231 require!(!is_house(from) || is_house(to)); keepers are house (lib.rs is_house)",
        "house sells PETRI back for vault NEAR              refused: lib.rs sell() require!(!colony.house)",
        "house plants a player's slide (royalty to player)  refused: lib.rs plant() require!(!colony.house) when the holder is not the planter",
        "house or keeper takes the keeper pot               refused: lib.rs catch_up_by pays it only to a registered caller that !is_house",
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
    part2(&mut out, &get);
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
    let _ = writeln!(fx, "=== Measured: v6.1 against v6 (same seeds; 'V6' runs set every v6 rule and layout back) ===");
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
    for (who, base, v6n) in [("Penny alone", "young Penny alone 7d", "V6 young Penny alone 7d"), ("5 outsiders", "young 5 7d", "V6 young 5 7d"), ("20 outsiders", "young 20 7d", "V6 young 20 7d")] {
        rowfx(&mut fx, &format!("{} | v6", who), v6n);
        rowfx(&mut fx, &format!("{} | v6.1", who), base);
        for label in ["tide_cap_bps 2500", "tide_bps 200", "tide_every 960"] {
            let n = match who {
                "Penny alone" => format!("FIX young Penny alone 7d | {}", label),
                "5 outsiders" => format!("FIX young 5 7d | {}", label),
                _ => format!("FIX young 20 7d | {}", label),
            };
            rowfx(&mut fx, &format!("{} | v6.1 + {}", who, label), &n);
        }
    }
    let _ = writeln!(fx);
    let a = get("mainnet 150p 7d");
    let b = get("V6 mainnet 150p 7d");
    let y = get("young 20 7d");
    let yv = get("V6 young 20 7d");
    let _ = writeln!(fx, "  Keeper pot left at the end: mainnet 150 p 7 d {} PETRI (v6.1) vs {} (v6); young 20 7 d {} vs {}; Racer cash (150 p) {} vs {}; Builder {} vs {}", wmed(a, &|x| pf(x.keeper_pot), 1), wmed(b, &|x| pf(x.keeper_pot), 1), wmed(y, &|x| pf(x.keeper_pot), 1), wmed(yv, &|x| pf(x.keeper_pot), 1), cell(&per_seed(a, Racer, &|g| g.cash()), 4), cell(&per_seed(b, Racer, &|g| g.cash()), 4), cell(&per_seed(a, Builder, &|g| g.cash()), 4), cell(&per_seed(b, Builder, &|g| g.cash()), 4));
    let pot_by = |r: &[RunOut]| -> String {
        let mut by: Vec<(Kind, f64)> = Vec::new();
        for k in [Penny, Builder, Raider, Defender, Methuselah, Late, Whale, Sniper, Racer, Guest, Locker] {
            let v = med_of(per_seed(r, k, &|g| pf(g.pot)));
            if v > 0.0 {
                by.push((k, v));
            }
        }
        by.iter().map(|(k, v)| format!("{:?} {:.1}", k, v)).collect::<Vec<_>>().join(", ")
    };
    let _ = writeln!(fx, "    pot received per player (median PETRI), 150 p v6.1: {}; v6: {}", pot_by(a), pot_by(b));
    let kr = get("testnet house + bench + 5 guests 3d (keeper registered)");
    let kn = get("testnet house + bench + 5 guests 3d (keeper not registered)");
    let _ = writeln!(fx, "  Testnet keeper (agents/run.mjs, unchanged: advances whenever the pot > 50 PETRI if registered; keepers never take the pot): calls/day {} vs {} unregistered; gas/day {} vs {} NEAR at mainnet gas price (testnet's is 10x); pot left {} PETRI", wmed(kr, &|x| x.keeper.calls as f64 / 3.0, 0), wmed(kn, &|x| x.keeper.calls as f64 / 3.0, 0), wmed(kr, &|x| nf(x.keeper.gas) / 3.0, 4), wmed(kn, &|x| nf(x.keeper.gas) / 3.0, 4), wmed(kr, &|x| pf(x.keeper_pot), 1));
    let sy = get("testnet 150p + sybil royalty 7d");
    let syv = get("V6 testnet 150p + sybil royalty 7d");
    let syl = get("FIX testnet sybil royalty 7d | licence_min_cells 0 (only the royalty-to-agar fix)");
    let _ = writeln!(fx, "  Testnet sybil royalty: SybilRoyalty operator cash {} (v6) vs {} (v6.1, licence_min 0) vs {} (v6.1); royalties in {} vs {} vs {} PETRI, of them paid by credit-only planters {} vs {} vs {}", cell(&per_seed(syv, SybilRoyalty, &|g| g.cash()), 4), cell(&per_seed(syl, SybilRoyalty, &|g| g.cash()), 4), cell(&per_seed(sy, SybilRoyalty, &|g| g.cash()), 4), ucell(&per_seed(syv, SybilRoyalty, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(syl, SybilRoyalty, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(sy, SybilRoyalty, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(syv, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1), ucell(&per_seed(syl, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1), ucell(&per_seed(sy, SybilRoyalty, &|g| pf(g.royalty_in_credit)), 1));
    let _ = writeln!(fx, "  Royalty farmer: 150 p 7 d cash {} (v6) vs {} (v6.1, licence_min 0) vs {} (v6.1); royalties {} vs {} vs {} PETRI; young 20 7 d cash {} (v6) vs {} (v6.1), royalties {} vs {}", cell(&per_seed(rfv6, Farmer, &|g| g.cash()), 4), cell(&per_seed(rfl0, Farmer, &|g| g.cash()), 4), cell(&per_seed(rfa, Farmer, &|g| g.cash()), 4), ucell(&per_seed(rfv6, Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(rfl0, Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(rfa, Farmer, &|g| pf(g.royalty_in)), 1), cell(&per_seed(ryfv6, Farmer, &|g| g.cash()), 4), cell(&per_seed(ryf, Farmer, &|g| g.cash()), 4), ucell(&per_seed(ryfv6, Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(ryf, Farmer, &|g| pf(g.royalty_in)), 1));
    let _ = writeln!(fx, "  Royalty farmer, further options on v6.1 (150 p 7 d / young 20 7 d): farmer cash with slide_royalty_bps 0 {} / {}; with licence_min_cells 49 {} / {}; royalties {} / {} and {} / {} PETRI", cell(&per_seed(get("FIX farmer 150p 7d | slide_royalty_bps 0"), Farmer, &|g| g.cash()), 4), cell(&per_seed(get("FIX farmer young 20 7d | slide_royalty_bps 0"), Farmer, &|g| g.cash()), 4), cell(&per_seed(get("FIX farmer 150p 7d | licence_min_cells 49"), Farmer, &|g| g.cash()), 4), cell(&per_seed(get("FIX farmer young 20 7d | licence_min_cells 49"), Farmer, &|g| g.cash()), 4), ucell(&per_seed(get("FIX farmer 150p 7d | slide_royalty_bps 0"), Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(get("FIX farmer young 20 7d | slide_royalty_bps 0"), Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(get("FIX farmer 150p 7d | licence_min_cells 49"), Farmer, &|g| pf(g.royalty_in)), 1), ucell(&per_seed(get("FIX farmer young 20 7d | licence_min_cells 49"), Farmer, &|g| pf(g.royalty_in)), 1));
    let _ = writeln!(fx, "    Whale cash (150 p, the pulsar planters) v6.1 {}, no farmer {}, royalty 0 {}; licensed plantings v6.1 {} (all pulsars), slide storage paid by the farmer {} NEAR", cell(&per_seed(rfa, Whale, &|g| g.cash()), 4), cell(&per_seed(get("mainnet 150p 7d"), Whale, &|g| g.cash()), 4), cell(&per_seed(get("FIX farmer 150p 7d | slide_royalty_bps 0"), Whale, &|g| g.cash()), 4), ucell(&rfa.iter().map(|x| x.slides.iter().map(|s| s.plantings as f64).sum::<f64>()).collect::<Vec<_>>(), 0), ucell(&per_seed(rfa, Farmer, &|g| nf(g.slide_storage)), 4));
    let _ = writeln!(fx, "  Gas, analytic: v6.1 at p hot rows (the table holds at most 10,000), 300 TGas prepaid: generations per catch-up without / with a tide in it; plant, tide:");
    for p in [1_500.0, 5_000.0, 10_000.0] {
        let g = gas_at_61(p, 4_000.0, 400.0);
        let _ = writeln!(fx, "    p {:>6.0}: {:>3} / {:>3} generations; plant {:.0} TGas, advance through a tide {:.0} TGas, claim with NEAR {:.0}", p, g.gens300, g.gens300_tide, g.plant / 1e3, g.tide / 1e3, g.claim_near / 1e3);
    }
    for (label, name) in [("v6", "V6 scale 30000"), ("v6.1", "scale 30000")] {
        let r = get(name);
        let mx = |c: Call| med_of(r.iter().map(|x| x.world.gas_max[c.idx()][0].max(x.world.gas_max[c.idx()][1]) / 1000.0).collect());
        let over: u64 = r.iter().map(|x| x.world.over_prepaid.iter().sum::<u64>()).sum();
        let over150: u64 = r.iter().map(|x| x.world.over_target.iter().sum::<u64>()).sum();
        let plants: u64 = r.iter().map(|x| x.world.call_count[Call::Plant.idx()]).sum();
        let _ = writeln!(fx, "  30,000 colonies, 2 days | {:<5}: hot rows avg {} max {}; max gas plant {:.0}, join {:.0}, claim {:.0}, buy {:.0}, sell {:.0}, advance {:.0}, slide {:.0} TGas; calls over 150 TGas {}, over prepaid {}; refused full {} ({} plants in all)", label, wmed(r, &|x| x.hot_avg, 0), wmed(r, &|x| x.hot_max as f64, 0), mx(Call::Plant), mx(Call::Join), mx(Call::Claim), mx(Call::Buy), mx(Call::Sell), mx(Call::Advance), mx(Call::Slide), over150, over, r.iter().map(|x| x.world.plant_refused_full).sum::<u64>(), plants);
    }
    let _ = writeln!(fx, "  Economics, mainnet 150 p 7 d, v6 vs v6.1: Builder {} vs {}; Methuselah {} vs {}; Whale {} vs {}; Penny {} vs {}; hot rows avg {} vs {}", cell(&per_seed(b, Builder, &|g| g.cash()), 4), cell(&per_seed(a, Builder, &|g| g.cash()), 4), cell(&per_seed(b, Methuselah, &|g| g.cash()), 4), cell(&per_seed(a, Methuselah, &|g| g.cash()), 4), cell(&per_seed(b, Whale, &|g| g.cash()), 4), cell(&per_seed(a, Whale, &|g| g.cash()), 4), cell(&per_seed(b, Penny, &|g| g.cash()), 4), cell(&per_seed(a, Penny, &|g| g.cash()), 4), wmed(b, &|x| x.hot_avg, 0), wmed(a, &|x| x.hot_avg, 0));
    let _ = writeln!(fx, "  Max gas per call, mainnet 150 p 7 d, v6 vs v6.1 (TGas): {}", CALLS.iter().filter(|c| a.iter().any(|x| x.world.call_count[c.idx()] > 0)).map(|c| format!("{:?} {:.0} / {:.0}", c, med_of(b.iter().map(|x| x.world.gas_max[c.idx()][0].max(x.world.gas_max[c.idx()][1]) / 1000.0).collect()), med_of(a.iter().map(|x| x.world.gas_max[c.idx()][0].max(x.world.gas_max[c.idx()][1]) / 1000.0).collect()))).collect::<Vec<_>>().join(", "));
    let ke = get("testnet 150p + sybil exits 7d");
    let kn = get("NOKEPT testnet 150p + sybil exits 7d");
    let _ = writeln!(fx, "  Part 2, free play reaching NEAR (testnet 150 p + 3 SybilAttach + 3 SybilTransfer operators, 7 d): NEAR paid for farmed PETRI per operator, kept rule vs none: SybilAttach {} vs {}, SybilTransfer {} vs {}; all its sales SybilAttach {} vs {}, SybilTransfer {} vs {}; cash {} vs {} and {} vs {}; PETRI moved by guests' transfers {} vs {}; sales and transfers refused {} / {}", cell(&per_seed(ke, SybilAttach, &|g| nf(g.farm_sold)), 4), cell(&per_seed(kn, SybilAttach, &|g| nf(g.farm_sold)), 4), cell(&per_seed(ke, SybilTransfer, &|g| nf(g.farm_sold)), 4), cell(&per_seed(kn, SybilTransfer, &|g| nf(g.farm_sold)), 4), cell(&per_seed(ke, SybilAttach, &|g| nf(g.sold)), 4), cell(&per_seed(kn, SybilAttach, &|g| nf(g.sold)), 4), cell(&per_seed(ke, SybilTransfer, &|g| nf(g.sold)), 4), cell(&per_seed(kn, SybilTransfer, &|g| nf(g.sold)), 4), cell(&per_seed(ke, SybilAttach, &|g| g.cash()), 4), cell(&per_seed(kn, SybilAttach, &|g| g.cash()), 4), cell(&per_seed(ke, SybilTransfer, &|g| g.cash()), 4), cell(&per_seed(kn, SybilTransfer, &|g| g.cash()), 4), ucell(&per_seed(ke, SybilTransfer, &|g| pf(g.moved)), 1), ucell(&per_seed(kn, SybilTransfer, &|g| pf(g.moved)), 1), ucell(&per_seed(ke, SybilAttach, &|g| g.kept_refused as f64), 0), ucell(&per_seed(ke, SybilTransfer, &|g| g.kept_refused as f64), 0));
    let mk = get("NOKEPT mainnet 150p 7d");
    let _ = writeln!(fx, "  Part 2, the kept rule on mainnet 150 p 7 d (cash with vs without): Builder {} vs {}; Methuselah {} vs {}; Guest {} vs {}; SelfSponsor {} vs {}; Seller {} vs {}", cell(&per_seed(a, Builder, &|g| g.cash()), 4), cell(&per_seed(mk, Builder, &|g| g.cash()), 4), cell(&per_seed(a, Methuselah, &|g| g.cash()), 4), cell(&per_seed(mk, Methuselah, &|g| g.cash()), 4), cell(&per_seed(a, Guest, &|g| g.cash()), 4), cell(&per_seed(mk, Guest, &|g| g.cash()), 4), cell(&per_seed(a, SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(mk, SelfSponsor, &|g| g.cash()), 4), cell(&per_seed(a, Seller, &|g| g.cash()), 4), cell(&per_seed(mk, Seller, &|g| g.cash()), 4));
    for (label, with, base) in [("young 5", "PACTS young 5 7d", "young 5 7d"), ("young 20", "PACTS young 20 7d", "young 20 7d"), ("150 p", "PACTS mainnet 150p 7d", "mainnet 150p 7d")] {
        let (w, o) = (get(with), get(base));
        let _ = writeln!(fx, "  Pacts, {} 7 d (with vs without): Builder cash {} vs {}, cell-generations (k) {} vs {}; Raider cash {} vs {}; PETRI paid per builder {}; raids aimed elsewhere {}, plantings refused {}", label, cell(&per_seed(w, Builder, &|g| g.cash()), 4), cell(&per_seed(o, Builder, &|g| g.cash()), 4), ucell(&per_seed(w, Builder, &|g| g.live_gens as f64 / 1000.0), 1), ucell(&per_seed(o, Builder, &|g| g.live_gens as f64 / 1000.0), 1), cell(&per_seed(w, Raider, &|g| g.cash()), 4), cell(&per_seed(o, Raider, &|g| g.cash()), 4), ucell(&per_seed(w, Builder, &|g| pf(g.pact_paid)), 1), ucell(&per_seed(w, Raider, &|g| g.pact_diverted as f64), 1), ucell(&per_seed(w, Raider, &|g| g.pact_refused as f64), 1));
    }
    fs::write(format!("{}/fixes-measured.txt", out_dir), &fx).unwrap();
    print!("{}", fx);
    eprintln!("wall {:.0} s", t0.elapsed().as_secs_f64());
}

/// Part 2: the two exits from free play to vault NEAR with and without the kept rule, the kept rule's cost to everyone
/// else, and pacts.
fn part2<'a>(out: &mut String, get: &dyn Fn(&str) -> &'a [RunOut]) {
    use Kind::*;
    let k = get("testnet 150p + sybil exits 7d");
    let n = get("NOKEPT testnet 150p + sybil exits 7d");
    let _ = writeln!(out, "  (f7) Part 2, free play reaching NEAR: 150 players + bench + 3 SybilAttach and 3 SybilTransfer operators (each 1 wallet + 10 relayer guests that");
    let _ = writeln!(out, "  farm blocks on free credit; testnet rules, 7 days, 6 seeds). SybilAttach guests hoard a day, attach 0.01 NEAR each (a purchase the operator pays");
    let _ = writeln!(out, "  for) and then sell everything after every tide while still planting; SybilTransfer guests ft_transfer all their PETRI to the wallet, which sells.");
    let _ = writeln!(out, "  'kept' = v6.1 part 2; 'no rule' = the same seeds without the kept rule (v6.1 part 1). Per operator (median (min..max)):");
    let _ = writeln!(out, "  'farmed sold' = NEAR the vault paid for PETRI earned before the seller's first NEAR, bought with credit, or moved to it by a guest's transfer.");
    let _ = writeln!(out, "    {:<14} | {:>26} | {:>26} | {:>26} | {:>26} | {:>26} | {:>26} | {:>14} | {:>16} | {:>16}", "operator", "farmed sold, kept", "farmed sold, no rule", "all sales, kept", "all sales, no rule", "cash, kept", "cash, no rule", "refused, kept", "PETRI moved, nr", "kept PETRI left");
    for kd in [SybilAttach, SybilTransfer, SybilGuest, Guest, Builder] {
        let _ = writeln!(
            out,
            "    {:<14} | {:>26} | {:>26} | {:>26} | {:>26} | {:>26} | {:>26} | {:>14} | {:>16} | {:>16}",
            format!("{:?}", kd),
            cell(&per_seed(k, kd, &|g| nf(g.farm_sold)), 4),
            cell(&per_seed(n, kd, &|g| nf(g.farm_sold)), 4),
            cell(&per_seed(k, kd, &|g| nf(g.sold)), 4),
            cell(&per_seed(n, kd, &|g| nf(g.sold)), 4),
            cell(&per_seed(k, kd, &|g| g.cash()), 4),
            cell(&per_seed(n, kd, &|g| g.cash()), 4),
            ucell(&per_seed(k, kd, &|g| g.kept_refused as f64), 0),
            ucell(&per_seed(n, kd, &|g| pf(g.moved)), 1),
            ucell(&per_seed(k, kd, &|g| pf(g.kept_left)), 1)
        );
    }
    let _ = writeln!(out, "    Under the kept rule no sale for NEAR happens while a colony holds kept PETRI and no guest transfer happens at all, so NEAR paid for PETRI earned");
    let _ = writeln!(out, "    before a colony's first NEAR is 0 by construction; a SybilAttach guest's sales are of PETRI it earned after attaching, once its plantings had spent");
    let _ = writeln!(out, "    what it farmed. Vault left at the end: kept {}, no rule {}; NEAR paid out for sales in all: kept {}, no rule {}.", wmed(k, &|x| nf(x.vault), 4), wmed(n, &|x| nf(x.vault), 4), wmed(k, &|x| nf(x.sold_total), 4), wmed(n, &|x| nf(x.sold_total), 4));
    let all_farm = |r: &[RunOut]| med_of(r.iter().map(|x| x.groups.iter().map(|g| nf(g.farm_sold)).sum::<f64>()).collect());
    let _ = writeln!(out, "    Farmed PETRI sold for vault NEAR by every colony in the run (all kinds): kept {:.4}, no rule {:.4} NEAR.", all_farm(k), all_farm(n));
    let m = get("mainnet 150p 7d");
    let mn = get("NOKEPT mainnet 150p 7d");
    let _ = writeln!(out, "    The rule's cost to everyone else, mainnet 150 p 7 d (cash, kept vs no rule): {}", [Penny, Builder, Raider, Defender, Methuselah, Late, Whale, Sniper, Seller, Guest, SelfSponsor, Locker].iter().map(|&kd| format!("{:?} {:+.4} / {:+.4}", kd, med_of(per_seed(m, kd, &|g| g.cash())), med_of(per_seed(mn, kd, &|g| g.cash())))).collect::<Vec<_>>().join(", "));
    let _ = writeln!(out, "    Keeper pot left at the end (no guest takes it now): testnet 150 p kept {} PETRI, no rule {}.", wmed(k, &|x| pf(x.keeper_pot), 1), wmed(n, &|x| pf(x.keeper_pot), 1));
    let _ = writeln!(out, "  (f8) Pacts: after every tide each Builder pays the Raider nearest its home, if that raider lives within 40 cells, 2 PETRI for a pact (the raider");
    let _ = writeln!(out, "  may not plant within pact_radius 8 of the builder's living cells for a tide window; the builder pays the offer's storage, 0.0038 NEAR, and both calls'");
    let _ = writeln!(out, "  gas); the raider accepts, aims elsewhere when its pick is a protected colony, and the contract refuses the rest. 'cell-gens' = the builder's living");
    let _ = writeln!(out, "  cells summed over every generation (thousands).");
    let _ = writeln!(out, "    {:<22} | {:>26} | {:>26} | {:>26} | {:>26} | {:>12} | {:>12} | {:>12} | {:>12}", "", "Builder cash", "Builder cell-gens (k)", "Raider cash", "Defender cash", "pact PETRI", "raids aimed", "refused", "pacts");
    for (label, with, base) in [("young 5, 7 d", "PACTS young 5 7d", "young 5 7d"), ("young 20, 7 d", "PACTS young 20 7d", "young 20 7d"), ("mainnet 150 p, 7 d", "PACTS mainnet 150p 7d", "mainnet 150p 7d")] {
        for (tag, r) in [("pacts", get(with)), ("none", get(base))] {
            let _ = writeln!(
                out,
                "    {:<22} | {:>26} | {:>26} | {:>26} | {:>26} | {:>12} | {:>12} | {:>12} | {:>12}",
                format!("{} {}", label, tag),
                cell(&per_seed(r, Builder, &|g| g.cash()), 4),
                ucell(&per_seed(r, Builder, &|g| g.live_gens as f64 / 1000.0), 1),
                cell(&per_seed(r, Raider, &|g| g.cash()), 4),
                cell(&per_seed(r, Defender, &|g| g.cash()), 4),
                ucell(&per_seed(r, Builder, &|g| pf(g.pact_paid)), 1),
                ucell(&per_seed(r, Raider, &|g| g.pact_diverted as f64), 1),
                ucell(&per_seed(r, Raider, &|g| g.pact_refused as f64), 1),
                ucell(&per_seed(r, Builder, &|g| pf(g.pact_paid) / 2.0), 0)
            );
        }
    }
    let _ = writeln!(out, "    'raids aimed' = raids whose first pick was a protected colony and that the raider aimed elsewhere; 'refused' = plantings the contract refused");
    let _ = writeln!(out, "    (a glider or blinker that would have landed within 8 cells of a protected colony's cells). 'pacts' = pacts each builder paid for.");
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
