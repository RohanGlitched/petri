//! Who wins and who pays: the sixty-day scenarios of `days60` (the same societies, rules and seed streams, so seeds 0-4
//! are the very runs in sim/out-60d), read player by player.
//!
//! ```text
//! cargo run --release -- out-econ econ [--seeds 10]
//! ```
//!
//! For every outside player of every run: what it put in (NEAR attached and gas), what it took out (tide NEAR claimed,
//! PETRI sold back, bounties), what it is still owed and what the PETRI it still holds would sell back for at the end.
//! For every run: where the NEAR the vault paid players came from (the house strains' NEAR or other players'), the vault
//! being one pool whose every payout is drawn pro rata from what is in it; what happens after the house runs out of NEAR;
//! what a 0.05 NEAR round trip through the agar returns at each day's prices; and each player's books a day after it
//! joined. The bookkeeping lives in world.rs (`Snap`, `house_part`, `round_trip`) and only reads the run: the dish, the
//! players and every number in sim/out-60d are unchanged by it.

use super::*;
use serde_json::{json, Value};

const SELL_RECORD: u128 = 97; // sell_bytes(v6.1)
const BUY_RECORD: u128 = 113; // buy_bytes(v6.1)

/// What each kind is, in the site's words.
fn label(k: Kind) -> &'static str {
    match k {
        Kind::Builder => "Builder",
        Kind::Raider => "Raider",
        Kind::Defender => "Defender",
        Kind::Methuselah => "R-pentomino player",
        Kind::Penny => "Penny player",
        Kind::Whale => "Whale",
        Kind::SplitWhale => "Split whale",
        Kind::Locker => "Lattice locker",
        Kind::Sniper => "Tide sniper",
        Kind::Seller => "Buy and sell back",
        Kind::Guest => "Sponsored guest",
        Kind::Late => "Late builder",
        _ => "Other",
    }
}

fn plays(k: Kind) -> &'static str {
    match k {
        Kind::Builder => "joins with 0.05 NEAR (0.25 in all), still lifes near home, tops up twice",
        Kind::Raider => "joins with 0.05 NEAR (0.25 in all), gliders and spaceships at rivals, sieges",
        Kind::Defender => "joins with 0.05 NEAR (0.25 in all), eaters and beehives near home",
        Kind::Methuselah => "joins with 0.1 NEAR (0.5 in all), one R-pentomino an hour",
        Kind::Penny => "joins with the 0.01 NEAR minimum (0.05 in all), keeps one block alive",
        Kind::Whale => "joins with 2 NEAR (3 in all), pulsars and beehives anywhere, every few generations",
        Kind::SplitWhale => "the whale's 2 NEAR (3 in all) over 10 colonies, one operator",
        Kind::Locker => "1.5 NEAR (2 in all) on a lattice of blocks that puts every empty cell under siege",
        Kind::Sniper => "plants blocks only in the 3 generations before each tide, sells after every tide",
        Kind::Seller => "buys 0.2 NEAR of PETRI at join and sells it back as fast as the allowance lets it; never plants",
        Kind::Guest => "plays like a builder on 0.05 NEAR of credit someone else sponsored; attaches no NEAR of its own",
        _ => "",
    }
}

fn r(x: f64, d: i32) -> f64 {
    let m = 10f64.powi(d);
    (x * m).round() / m
}

/// Linear-interpolated quantile of a sorted slice.
fn q(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let h = p * (v.len() - 1) as f64;
    let (i, f) = (h.floor() as usize, h - h.floor());
    if i + 1 < v.len() {
        v[i] + f * (v[i + 1] - v[i])
    } else {
        v[i]
    }
}

fn sorted(mut v: Vec<f64>) -> Vec<f64> {
    v.sort_by(|a, b| a.total_cmp(b));
    v
}

fn med(v: &[f64]) -> f64 {
    q(&sorted(v.to_vec()), 0.5)
}

/// One outside player's sixty days.
struct P {
    seed: usize,
    kind: Kind,
    accounts: usize,
    join_day: f64,
    budget: f64,
    paid: f64,
    attached: f64,
    withdrawn: f64,
    owed: f64,
    held: f64,
    credit_end: f64,
    tide: f64,
    claimed: f64,
    sold: f64,
    bounty: f64,
    fed: f64,
    spent: f64,
    bought: f64,
    vault_in: f64,
    plants: u32,
    day1: Option<D1>,
}

impl P {
    fn net_cash(&self) -> f64 {
        self.withdrawn - self.paid
    }
    fn net_end(&self) -> f64 {
        self.withdrawn + self.owed + self.held - self.paid
    }
    fn back(&self) -> f64 {
        self.withdrawn + self.owed + self.held
    }
    fn guest(&self) -> bool {
        self.kind == Kind::Guest
    }
}

/// A player's first day, in NEAR and PETRI.
#[derive(Clone, Copy)]
struct D1 {
    attached: f64,
    gas: f64,
    join_petri: f64,
    bought: f64,
    fed: f64,
    spent: f64,
    tide: f64,
    claimed: f64,
    sold: f64,
    bounty: f64,
    owed: f64,
    held_petri: f64,
    held_value: f64,
    plants: u32,
    live: u32,
}

impl D1 {
    fn net(&self) -> f64 {
        self.claimed + self.sold + self.bounty + self.owed + self.held_value - self.attached - self.gas
    }
}

fn players(runs: &[RunOut], gpd: u64) -> Vec<P> {
    let mut v = Vec::new();
    for (seed, run) in runs.iter().enumerate() {
        for g in run.groups.iter().filter(|g| g.kind != Kind::House && g.kind != Kind::Bench) {
            let day1 = if g.day1_n == g.accounts {
                let d = &g.day1;
                Some(D1 {
                    attached: nf(d.attached),
                    gas: nf(d.gas),
                    join_petri: pf(d.join_units),
                    bought: pf(d.bought),
                    fed: pf(d.fed),
                    spent: pf(d.spent),
                    tide: nf(d.tide),
                    claimed: nf(d.claimed),
                    sold: nf(d.sold),
                    bounty: nf(d.bounty),
                    owed: nf(d.owed),
                    held_petri: pf(d.held_units),
                    held_value: nf(d.held_value),
                    plants: d.plants,
                    live: d.live,
                })
            } else {
                None
            };
            v.push(P {
                seed,
                kind: g.kind,
                accounts: g.accounts,
                join_day: g.first_join as f64 / gpd as f64,
                budget: nf(g.budget),
                paid: g.paid(),
                attached: nf(g.attached),
                withdrawn: g.withdrawn(),
                owed: nf(g.owed),
                held: nf(g.held),
                credit_end: nf(g.credit_left + g.held_credit),
                tide: nf(g.tide_share),
                claimed: nf(g.claimed),
                sold: nf(g.sold),
                bounty: nf(g.bounty),
                fed: pf(g.earned),
                spent: pf(g.spent),
                bought: pf(g.bought),
                vault_in: nf(g.vault_in),
                plants: g.plants,
                day1,
            });
        }
    }
    v
}

/// Kinds in the order the tables show them.
const ORDER: [Kind; 11] = [Kind::Penny, Kind::Builder, Kind::Defender, Kind::Raider, Kind::Methuselah, Kind::Sniper, Kind::Seller, Kind::Whale, Kind::SplitWhale, Kind::Locker, Kind::Guest];

/// Per-kind summary.
struct KindSum {
    kind: Kind,
    n: usize,
    budget: f64,
    paid: f64,
    pos_end: f64,
    pos_cash: f64,
    net: [f64; 3],
    back_per_near: [f64; 3],
    tide: f64,
    sold: f64,
    fed: f64,
    held: f64,
    credit_end: f64,
    credit_above_grant: f64,
    total_net: f64,
}

fn kind_sum(ps: &[&P], k: Kind, seeds: usize) -> Option<KindSum> {
    let v: Vec<&&P> = ps.iter().filter(|p| p.kind == k).collect();
    if v.is_empty() {
        return None;
    }
    let n = v.len();
    let nets = sorted(v.iter().map(|p| p.net_end()).collect());
    let backs = sorted(v.iter().filter(|p| p.paid > 0.0).map(|p| p.back() / p.paid).collect());
    let col = |f: &dyn Fn(&P) -> f64| med(&v.iter().map(|p| f(p)).collect::<Vec<_>>());
    // A guest's grant: 0.05 NEAR less the grant record's storage, per colony.
    let grant = 0.05;
    Some(KindSum {
        kind: k,
        n,
        budget: col(&|p| p.budget),
        paid: col(&|p| p.paid),
        pos_end: v.iter().filter(|p| p.net_end() > 0.0).count() as f64 / n as f64,
        pos_cash: v.iter().filter(|p| p.net_cash() > 0.0).count() as f64 / n as f64,
        net: [q(&nets, 0.1), q(&nets, 0.5), q(&nets, 0.9)],
        back_per_near: [q(&backs, 0.1), q(&backs, 0.5), q(&backs, 0.9)],
        tide: col(&|p| p.tide),
        sold: col(&|p| p.sold),
        fed: col(&|p| p.fed),
        held: col(&|p| p.held),
        credit_end: col(&|p| p.credit_end),
        credit_above_grant: v.iter().filter(|p| p.credit_end > grant * p.accounts as f64).count() as f64 / n as f64,
        total_net: v.iter().map(|p| p.net_end()).sum::<f64>() / seeds as f64,
    })
}

/// One run's money: where the vault's NEAR came from and went.
struct Money {
    vault_in: f64,
    vault_in_house: f64,
    out_players: f64,
    out_house: f64,
    house_paid: f64,
    house_left: f64,
    house_out_day: Option<u64>,
    after_out: f64,
    after_house: f64,
    after_tides: u64,
    after_vault_in_house: f64,
    vault_end: f64,
    players_paid: f64,
    players_attached: f64,
    players_vault_in: f64,
    players_back: f64,
    players_net: f64,
    players_net_cash: f64,
    players_gas: f64,
    storage_players: f64,
    burned: f64,
}

fn money(run: &RunOut, ps: &[&P]) -> Money {
    let w = &run.world;
    let house: Vec<&GroupOut> = run.groups.iter().filter(|g| g.kind == Kind::House).collect();
    let (mut after_out, mut after_house, mut after_tides, mut after_vih) = (0.0, 0.0, 0u64, 0.0);
    if let Some(d0) = w.house_out_of_near_day {
        if let (Some(at), Some(end)) = (run.days.iter().find(|d| d.day == d0), run.days.last()) {
            after_out = nf(w.out_players) - nf(at.out_players);
            after_house = nf(w.out_house) - nf(at.out_house);
            after_vih = nf(w.vault_in_house) - nf(at.vault_in_house);
            after_tides = run.days.iter().filter(|d| d.day > d0 && d.day <= end.day).map(|d| d.tides_run).sum();
        }
    }
    let wallet_players: Vec<&&P> = ps.iter().filter(|p| !p.guest()).collect();
    Money {
        vault_in: nf(w.vault_in),
        vault_in_house: nf(w.vault_in_house),
        out_players: nf(w.out_players),
        out_house: nf(w.out_house),
        house_paid: house.iter().map(|g| g.paid()).sum(),
        house_left: nf(w.house_left),
        house_out_day: w.house_out_of_near_day,
        after_out,
        after_house,
        after_tides,
        after_vault_in_house: after_vih,
        vault_end: nf(w.vault),
        players_paid: wallet_players.iter().map(|p| p.paid).sum(),
        players_attached: wallet_players.iter().map(|p| p.attached).sum(),
        players_vault_in: wallet_players.iter().map(|p| p.vault_in).sum(),
        players_back: wallet_players.iter().map(|p| p.back()).sum(),
        players_net: wallet_players.iter().map(|p| p.net_end()).sum(),
        players_net_cash: wallet_players.iter().map(|p| p.net_cash()).sum(),
        players_gas: run.groups.iter().filter(|g| g.kind != Kind::House).map(|g| nf(g.gas)).sum(),
        storage_players: nf(w.storage_players),
        burned: pf(w.burned),
    }
}

fn band(v: Vec<f64>) -> [f64; 3] {
    let s = sorted(v);
    [s.first().copied().unwrap_or(0.0), q(&s, 0.5), s.last().copied().unwrap_or(0.0)]
}

fn jb(b: [f64; 3], d: i32) -> Value {
    json!([r(b[0], d), r(b[1], d), r(b[2], d)])
}

pub fn econ(out_dir: &str, rm: &Rules, seeds: u64) {
    let t0 = Instant::now();
    let gpd = rm.gens_per_day();
    let names = sixty::SCENARIOS;
    let scen: Vec<Scenario> = names.iter().enumerate().map(|(i, (name, _))| sc(name, rm, mainnet(60), sixty::society_of(name), seeds, 600 + i as u64)).collect();
    let runs = run_all(&scen);

    let mut players_csv = String::from("scenario,seed,kind,colonies,join_day,budget_near,paid_near,withdrawn_near,claimed_near,sold_near,bounty_near,owed_near,held_value_near,net_cash_near,net_end_near,tide_share_near,credit_end_near,petri_bought,petri_fed,petri_planted,plantings,vault_in_near\n");
    let mut day1_csv = String::from("scenario,seed,kind,join_day,attached_near,gas_near,petri_at_join,petri_bought,petri_fed,petri_planted,plantings,live_cells,tide_share_near,claimed_near,sold_near,bounty_near,owed_near,petri_held,held_value_near,net_near\n");
    let mut kinds_csv = String::from("scenario,kind,players,budget_near_median,paid_near_median,share_net_positive_end,share_net_positive_cash,net_end_p10,net_end_median,net_end_p90,back_per_near_p10,back_per_near_median,back_per_near_p90,tide_share_median,sold_median,petri_fed_median,held_value_median,credit_end_median,net_end_total_per_run\n");
    let mut sources_csv = String::from("scenario,seed,vault_in_near,vault_in_house_near,paid_to_players_near,of_which_house_near,house_share,house_attached_and_gas_near,house_left_near,house_out_day,paid_after_house_out_near,of_which_house_after_near,tides_after_house_out,house_into_vault_after_out_near,vault_end_near,players_paid_near,players_back_near,players_net_end_near,players_net_cash_near,players_gas_near,storage_near,petri_burned\n");
    let mut days_csv = String::from("scenario,seed,day,vault_near,vault_in_near,vault_in_house_near,paid_to_players_near,of_which_house_near,vault_house_near,house_left_near,tides_run,rt_deposit_near,rt_petri,rt_curve_near,rt_back_near,rt_net_near,sell_allowance_near\n");
    let mut head = String::new();
    let mut web_sc = Vec::new();
    let sell_rec = nf(SELL_RECORD * BYTE);
    let buy_rec = nf(BUY_RECORD * BYTE);

    for (si, s) in scen.iter().enumerate() {
        let rs = &runs[si];
        let ps = players(rs, gpd);
        for p in &ps {
            let _ = writeln!(
                players_csv,
                "\"{}\",{},{:?},{},{:.3},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.3},{:.3},{:.3},{},{:.6}",
                s.name, p.seed, p.kind, p.accounts, p.join_day, p.budget, p.paid, p.withdrawn, p.claimed, p.sold, p.bounty, p.owed, p.held, p.net_cash(), p.net_end(), p.tide, p.credit_end, p.bought, p.fed, p.spent, p.plants, p.vault_in
            );
            if let Some(d) = &p.day1 {
                let _ = writeln!(
                    day1_csv,
                    "\"{}\",{},{:?},{:.3},{:.6},{:.6},{:.3},{:.3},{:.3},{:.3},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.3},{:.6},{:.6}",
                    s.name, p.seed, p.kind, p.join_day, d.attached, d.gas, d.join_petri, d.bought, d.fed, d.spent, d.plants, d.live, d.tide, d.claimed, d.sold, d.bounty, d.owed, d.held_petri, d.held_value, d.net()
                );
            }
        }
        for (k, run) in rs.iter().enumerate() {
            for d in &run.days {
                let dep = 0.05;
                let _ = writeln!(
                    days_csv,
                    "\"{}\",{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{},{:.2},{:.3},{:.6},{:.6},{:.6},{:.6}",
                    s.name, k, d.day, nf(d.vault), nf(d.vault_in), nf(d.vault_in_house), nf(d.out_players), nf(d.out_house), nf(d.vault_house), nf(d.house_left), d.tides_run, dep, pf(d.rt_units), nf(d.rt_curve), nf(d.rt_back), (nf(d.rt_back) - sell_rec).max(0.0), nf(d.sell_left)
                );
            }
        }
        let refs: Vec<&P> = ps.iter().collect();
        let monies: Vec<Money> = rs.iter().enumerate().map(|(k, run)| money(run, &refs.iter().filter(|p| p.seed == k).copied().collect::<Vec<_>>())).collect();
        for (k, m) in monies.iter().enumerate() {
            let _ = writeln!(
                sources_csv,
                "\"{}\",{},{:.6},{:.6},{:.6},{:.6},{:.4},{:.6},{:.6},{},{:.6},{:.6},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.0}",
                s.name,
                k,
                m.vault_in,
                m.vault_in_house,
                m.out_players,
                m.out_house,
                if m.out_players > 0.0 { m.out_house / m.out_players } else { 0.0 },
                m.house_paid,
                m.house_left,
                m.house_out_day.map(|d| d.to_string()).unwrap_or_default(),
                m.after_out,
                m.after_house,
                m.after_tides,
                m.after_vault_in_house,
                m.vault_end,
                m.players_paid,
                m.players_back,
                m.players_net,
                m.players_net_cash,
                m.players_gas,
                m.storage_players,
                m.burned
            );
        }
        let sums: Vec<KindSum> = ORDER.iter().filter_map(|&k| kind_sum(&refs, k, rs.len())).collect();
        for k in &sums {
            let _ = writeln!(
                kinds_csv,
                "\"{}\",{:?},{},{:.4},{:.6},{:.4},{:.4},{:.6},{:.6},{:.6},{:.4},{:.4},{:.4},{:.6},{:.6},{:.1},{:.6},{:.6},{:.6}",
                s.name, k.kind, k.n, k.budget, k.paid, k.pos_end, k.pos_cash, k.net[0], k.net[1], k.net[2], k.back_per_near[0], k.back_per_near[1], k.back_per_near[2], k.tide, k.sold, k.fed, k.held, k.credit_end, k.total_net
            );
        }
        // Round trips: every day of every seed.
        let rt: Vec<(f64, f64, f64, f64)> = rs.iter().flat_map(|run| run.days.iter().map(|d| (pf(d.rt_units), nf(d.rt_curve), nf(d.rt_back), nf(d.sell_left)))).collect();
        let curve_frac = band(rt.iter().map(|x| x.1 / 0.05).collect());
        let back_frac = band(rt.iter().map(|x| x.2 / 0.05).collect());
        let net_frac = band(rt.iter().map(|x| (x.2 - sell_rec).max(0.0) / 0.05).collect());
        let petri = band(rt.iter().map(|x| x.0).collect());
        let day1_rt: Vec<f64> = rs.iter().filter_map(|run| run.days.first().map(|d| (nf(d.rt_back) - sell_rec).max(0.0) / 0.05)).collect();
        let day60_rt: Vec<f64> = rs.iter().filter_map(|run| run.days.last().map(|d| (nf(d.rt_back) - sell_rec).max(0.0) / 0.05)).collect();
        let allowance_short = rt.iter().filter(|x| x.3 < x.2).count() as f64 / rt.len().max(1) as f64;
        // The first day of each kind's median player (by its first day's net).
        let mut day1_cards = Vec::new();
        for &k in ORDER.iter() {
            let mut v: Vec<&P> = ps.iter().filter(|p| p.kind == k && p.day1.is_some()).collect();
            if v.is_empty() {
                continue;
            }
            v.sort_by(|a, b| a.day1.unwrap().net().total_cmp(&b.day1.unwrap().net()));
            let p = v[(v.len() - 1) / 2];
            let d = p.day1.unwrap();
            let pos = v.iter().filter(|p| p.day1.unwrap().net() > 0.0).count() as f64 / v.len() as f64;
            day1_cards.push(json!({
                "kind": format!("{:?}", k), "label": label(k), "players": v.len(), "share_positive": r(pos, 4),
                "seed": p.seed, "join_day": r(p.join_day, 2),
                "attached": r(d.attached, 4), "gas": r(d.gas, 5), "join_petri": r(d.join_petri, 1), "bought": r(d.bought, 1),
                "fed": r(d.fed, 1), "planted": r(d.spent, 1), "plantings": d.plants, "live": d.live,
                "tide": r(d.tide, 5), "claimed": r(d.claimed, 5), "sold": r(d.sold, 5), "bounty": r(d.bounty, 5), "owed": r(d.owed, 5),
                "held_petri": r(d.held_petri, 1), "held_value": r(d.held_value, 5), "net": r(d.net(), 5),
                "net_median": r(d.net(), 5),
                "net_p10": r(q(&sorted(v.iter().map(|p| p.day1.unwrap().net()).collect()), 0.1), 5),
                "net_p90": r(q(&sorted(v.iter().map(|p| p.day1.unwrap().net()).collect()), 0.9), 5),
                "credit": k == Kind::Guest,
            }));
        }
        // Late joiners: wallet players by the day they joined.
        let buckets: [(f64, f64, &str); 4] = [(0.0, 2.0, "days 0-1"), (2.0, 10.0, "days 2-9"), (10.0, 30.0, "days 10-29"), (30.0, 61.0, "days 30-59")];
        let mut cohorts = Vec::new();
        for (lo, hi, name) in buckets {
            let v: Vec<&P> = ps.iter().filter(|p| !p.guest() && p.join_day >= lo && p.join_day < hi).collect();
            if v.is_empty() {
                continue;
            }
            let nets = sorted(v.iter().map(|p| p.net_end()).collect());
            cohorts.push(json!({
                "joined": name, "players": v.len(),
                "share_positive": r(v.iter().filter(|p| p.net_end() > 0.0).count() as f64 / v.len() as f64, 4),
                "net": [r(q(&nets, 0.1), 5), r(q(&nets, 0.5), 5), r(q(&nets, 0.9), 5)],
                "tide_median": r(med(&v.iter().map(|p| p.tide).collect::<Vec<_>>()), 5),
            }));
        }
        let mb = |f: &dyn Fn(&Money) -> f64| band(monies.iter().map(f).collect());
        let share = mb(&|m| if m.out_players > 0.0 { m.out_house / m.out_players } else { 0.0 });
        let in_share = mb(&|m| if m.vault_in > 0.0 { m.vault_in_house / m.vault_in } else { 0.0 });
        let after_share = mb(&|m| if m.after_out > 0.0 { m.after_house / m.after_out } else { 0.0 });
        let out_days: Vec<f64> = monies.iter().filter_map(|m| m.house_out_day.map(|d| d as f64)).collect();
        let wallet: Vec<&P> = refs.iter().filter(|p| !p.guest()).copied().collect();
        let all_pos = if wallet.is_empty() { 0.0 } else { wallet.iter().filter(|p| p.net_end() > 0.0).count() as f64 / wallet.len() as f64 };
        let all_nets = sorted(wallet.iter().map(|p| p.net_end()).collect());

        // Headline lines.
        let _ = writeln!(head, "\n## {} ({})\n", s.name, names[si].1);
        if wallet.is_empty() {
            let _ = writeln!(head, "No outside player. The house strains put in {:.3} NEAR (median of {} seeds) and are never paid; no tide runs.", mb(&|m| m.house_paid)[1], rs.len());
        } else {
            let _ = writeln!(
                head,
                "Outside players with their own NEAR: {} over {} seeds. Net positive at day 60 (cash out, NEAR owed and PETRI at the sell-back): {:.1}%. Net NEAR p10 / median / p90: {:+.4} / {:+.4} / {:+.4}.",
                wallet.len(),
                rs.len(),
                100.0 * all_pos,
                q(&all_nets, 0.1),
                q(&all_nets, 0.5),
                q(&all_nets, 0.9)
            );
            let _ = writeln!(
                head,
                "\nNEAR the vault paid players: {:.3} (seed range {:.3}-{:.3}); the house's part of it {:.2}% ({:.2}-{:.2}%), other players' {:.2}%. The house put {:.3} NEAR into the vault ({:.2}% of all that entered) and {:.3} NEAR in all (gas included). It reached its floor on day {} (median); after that day the vault paid {:.3} NEAR more, {:.2}% of it the house's leftover share, over {} tides.",
                mb(&|m| m.out_players)[1],
                mb(&|m| m.out_players)[0],
                mb(&|m| m.out_players)[2],
                100.0 * share[1],
                100.0 * share[0],
                100.0 * share[2],
                100.0 * (1.0 - share[1]),
                mb(&|m| m.vault_in_house)[1],
                100.0 * in_share[1],
                mb(&|m| m.house_paid)[1],
                if out_days.is_empty() { "never".into() } else { format!("{:.0}", med(&out_days)) },
                mb(&|m| m.after_out)[1],
                100.0 * after_share[1],
                med(&monies.iter().map(|m| m.after_tides as f64).collect::<Vec<_>>())
            );
            let _ = writeln!(
                head,
                "\nOutside players together (median run): put in {:.3} NEAR, ended with {:.3} (taken out, owed, and PETRI at the sell-back): {:+.3} NEAR. Players' gas {:.3}; storage the dish's records hold {:.3}; NEAR left in the vault at day 60 {:.3}.",
                mb(&|m| m.players_paid)[1],
                mb(&|m| m.players_back)[1],
                mb(&|m| m.players_net)[1],
                mb(&|m| m.players_gas)[1],
                mb(&|m| m.storage_players)[1],
                mb(&|m| m.vault_end)[1]
            );
            let _ = writeln!(
                head,
                "\nOf every NEAR those players paid (attached and gas): {:.1}% reached the vault, {:.1}% paid the storage of their own records (the contract keeps it while the records exist; nobody is paid it), {:.1}% was gas. They ended with {:.1}% of it back (taken out, owed, PETRI at the sell-back).",
                100.0 * mb(&|m| m.players_vault_in / m.players_paid.max(1e-12))[1],
                100.0 * mb(&|m| (m.players_attached - m.players_vault_in) / m.players_paid.max(1e-12))[1],
                100.0 * mb(&|m| m.players_gas / m.players_paid.max(1e-12))[1],
                100.0 * mb(&|m| m.players_back / m.players_paid.max(1e-12))[1]
            );
            let _ = writeln!(head, "\n| Player | Players | Put in, median | Net positive at day 60 | Net NEAR p10 / median / p90 | Back per NEAR put in, median | Tide NEAR, median | Sold back, median |");
            let _ = writeln!(head, "|---|---|---|---|---|---|---|---|");
            for k in &sums {
                if k.kind == Kind::Guest {
                    let _ = writeln!(head, "| {} | {} | 0 (sponsor's 0.05 credit) | n/a: no NEAR of its own; {:.1}% end with more credit and PETRI than the grant | 0 | n/a | {:.4} (credit) | {:.4} (credit) |", label(k.kind), k.n, 100.0 * k.credit_above_grant, k.tide, k.sold);
                } else {
                    let _ = writeln!(
                        head,
                        "| {} | {} | {:.4} | {:.1}% | {:+.4} / {:+.4} / {:+.4} | {:.3} | {:.4} | {:.4} |",
                        label(k.kind),
                        k.n,
                        k.paid,
                        100.0 * k.pos_end,
                        k.net[0],
                        k.net[1],
                        k.net[2],
                        k.back_per_near[1],
                        k.tide,
                        k.sold
                    );
                }
            }
        }
        let _ = writeln!(
            head,
            "\nA 0.05 NEAR round trip at each day's prices (every day of every seed): {:.1} PETRI bought (median); the curve alone would pay back {:.1}% (median), the sell-back pays {:.1}% ({:.1}-{:.1}%), {:.1}% after the sale record's storage; day 1 {:.1}%, day 60 {:.1}% (medians). The allowance left until the next tide was smaller than the sale on {:.1}% of days.",
            petri[1],
            100.0 * curve_frac[1],
            100.0 * back_frac[1],
            100.0 * back_frac[0],
            100.0 * back_frac[2],
            100.0 * net_frac[1],
            100.0 * med(&day1_rt),
            100.0 * med(&day60_rt),
            100.0 * allowance_short
        );

        web_sc.push(json!({
            "name": s.name,
            "what": names[si].1,
            "seeds": rs.len(),
            "players": wallet.len(),
            "guests": refs.iter().filter(|p| p.guest()).count(),
            "share_positive": r(all_pos, 4),
            "net": [r(q(&all_nets, 0.1), 5), r(q(&all_nets, 0.5), 5), r(q(&all_nets, 0.9), 5)],
            "kinds": sums.iter().map(|k| json!({
                "kind": format!("{:?}", k.kind), "label": label(k.kind), "plays": plays(k.kind), "players": k.n,
                "budget": r(k.budget, 4), "paid": r(k.paid, 5),
                "share_positive": r(k.pos_end, 4), "share_positive_cash": r(k.pos_cash, 4),
                "net": [r(k.net[0], 5), r(k.net[1], 5), r(k.net[2], 5)],
                "back_per_near": [r(k.back_per_near[0], 4), r(k.back_per_near[1], 4), r(k.back_per_near[2], 4)],
                "tide": r(k.tide, 5), "sold": r(k.sold, 5), "fed": r(k.fed, 1), "held": r(k.held, 5),
                "credit": k.kind == Kind::Guest, "credit_end": r(k.credit_end, 5), "credit_above_grant": r(k.credit_above_grant, 4),
                "total_net_per_run": r(k.total_net, 4),
            })).collect::<Vec<_>>(),
            "money": {
                "vault_in": jb(mb(&|m| m.vault_in), 4),
                "vault_in_house": jb(mb(&|m| m.vault_in_house), 4),
                "paid_to_players": jb(mb(&|m| m.out_players), 4),
                "paid_from_house": jb(mb(&|m| m.out_house), 4),
                "house_share": jb(share, 5),
                "house_share_of_inflow": jb(in_share, 5),
                "house_paid": jb(mb(&|m| m.house_paid), 4),
                "house_out_day": if out_days.is_empty() { Value::Null } else { json!(med(&out_days)) },
                "house_out_runs": out_days.len(),
                "after_house_out": {
                    "paid_to_players": jb(mb(&|m| m.after_out), 4),
                    "house_share": jb(after_share, 5),
                    "house_into_vault": jb(mb(&|m| m.after_vault_in_house), 5),
                    "tides": med(&monies.iter().map(|m| m.after_tides as f64).collect::<Vec<_>>()),
                },
                "vault_end": jb(mb(&|m| m.vault_end), 4),
                "players_paid": jb(mb(&|m| m.players_paid), 4),
                // Where wallet players' NEAR went, as shares of what they paid (attached and gas): into the vault, the
                // storage of their own records (what they attached that did not reach the vault), gas.
                "players_to_vault": jb(mb(&|m| m.players_vault_in / m.players_paid.max(1e-12)), 4),
                "players_to_storage": jb(mb(&|m| (m.players_attached - m.players_vault_in) / m.players_paid.max(1e-12)), 4),
                "players_to_gas": jb(mb(&|m| m.players_gas / m.players_paid.max(1e-12)), 4),
                "players_back_share": jb(mb(&|m| m.players_back / m.players_paid.max(1e-12)), 4),
                "players_back": jb(mb(&|m| m.players_back), 4),
                "players_net": jb(mb(&|m| m.players_net), 4),
                "players_gas": jb(mb(&|m| m.players_gas), 4),
                "storage": jb(mb(&|m| m.storage_players), 4),
                "burned": jb(mb(&|m| m.burned), 0),
            },
            "round_trip": {
                "deposit": 0.05, "buy_record": r(buy_rec, 5), "sell_record": r(sell_rec, 5),
                "petri": jb(petri, 1), "curve": jb(curve_frac, 4), "back": jb(back_frac, 4), "net": jb(net_frac, 4),
                "day1_net": r(med(&day1_rt), 4), "day60_net": r(med(&day60_rt), 4), "allowance_short_days": r(allowance_short, 4),
            },
            "cohorts": cohorts,
            "day1": day1_cards,
        }));
        if !wallet.is_empty() {
            fs::write(format!("{}/who-wins-{}.svg", out_dir, s.name.replace(' ', "-")), svg_kinds(&s.name, &sums)).unwrap();
        }
    }
    fs::write(format!("{}/payout-sources.svg", out_dir), svg_sources(&web_sc)).unwrap();
    fs::write(format!("{}/where-near-went.svg", out_dir), svg_flow(&web_sc)).unwrap();
    let web = json!({
        "generated": format!("sim/src/econ.rs: cargo run --release -- out-econ econ --seeds {} (mainnet launch rules, 60 days, seeds 0-{} of each days60 scenario stream)", seeds, seeds - 1),
        "seeds": seeds,
        "scenarios": web_sc,
    });
    let text = serde_json::to_string_pretty(&web).unwrap() + "\n";
    fs::write(format!("{}/web.json", out_dir), &text).unwrap();
    // The site draws the same file (web/src/data/whowins.json), when run from sim/ inside the repository.
    if fs::metadata("../web/src/data").is_ok() && out_dir == "out-econ" {
        fs::write("../web/src/data/whowins.json", &text).unwrap();
    }
    fs::write(format!("{}/players.csv", out_dir), players_csv).unwrap();
    fs::write(format!("{}/day1.csv", out_dir), day1_csv).unwrap();
    fs::write(format!("{}/kinds.csv", out_dir), kinds_csv).unwrap();
    fs::write(format!("{}/sources.csv", out_dir), sources_csv).unwrap();
    fs::write(format!("{}/days.csv", out_dir), days_csv).unwrap();
    fs::write(format!("{}/headline.md", out_dir), format!("# Who wins and who pays: the run's own numbers\n\nGenerated by `cargo run --release -- out-econ econ --seeds {}` from sim/. Medians over seeds unless a range is given. Net NEAR counts what a player took out (tide NEAR claimed, PETRI sold back, bounties), the NEAR still owed to it and the PETRI it still holds at the end valued at the sell-back, against everything it attached and its gas.\n{}", seeds, head)).unwrap();
    eprintln!("econ: {} scenarios x {} seeds in {:.0} s", scen.len(), seeds, t0.elapsed().as_secs_f64());
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;")
}

/// Per kind: the p10-p90 range of net NEAR at day 60, the median marked, and the share that ended net positive.
fn svg_kinds(name: &str, sums: &[KindSum]) -> String {
    let rows: Vec<&KindSum> = sums.iter().filter(|k| k.kind != Kind::Guest).collect();
    let (w, l, rpad, t, row) = (760.0, 170.0, 150.0, 64.0, 34.0);
    let h = t + row * rows.len() as f64 + 48.0;
    // Back per NEAR put in: 1 is breaking even. Budgets differ a hundredfold, so the ratio puts pennies and whales on
    // one scale.
    let hi = rows.iter().map(|k| k.back_per_near[2]).fold(1.2f64, f64::max).min(3.0);
    let pw = w - l - rpad;
    let x = |v: f64| l + pw * v.clamp(0.0, hi) / hi;
    let mut o = String::new();
    let _ = write!(o, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Figtree, system-ui, sans-serif" font-size="12"><rect width="{w}" height="{h}" fill="#120a05"/>"##);
    let _ = write!(o, r##"<text x="24" y="28" fill="#f3e9da" font-family="Gloock, Georgia, serif" font-size="18">{}: what each player got back per NEAR it put in</text>"##, esc(name));
    let _ = write!(o, r##"<text x="24" y="48" fill="#bba78f">60 days: taken out + owed + PETRI at the sell-back, over NEAR attached and gas. p10 to p90 of players, median marked; 1.0 breaks even.</text>"##);
    let mut tv = 0.0;
    while tv <= hi + 1e-9 {
        let tx = x(tv);
        let even = (tv - 1.0f64).abs() < 1e-9;
        let _ = write!(o, r##"<line x1="{tx:.1}" x2="{tx:.1}" y1="{t}" y2="{}" stroke="{}" stroke-width="{}"/><text x="{tx:.1}" y="{}" fill="{}" text-anchor="middle">{:.2}</text>"##, h - 40.0, if even { "#f3e9da" } else { "#3a2a1c" }, if even { 1.5 } else { 1.0 }, h - 24.0, if even { "#f3e9da" } else { "#bba78f" }, tv);
        tv += if hi > 1.6 { 0.5 } else { 0.25 };
    }
    for (i, k) in rows.iter().enumerate() {
        let cy = t + row * i as f64 + row / 2.0;
        let _ = write!(o, r##"<text x="{}" y="{:.1}" fill="#e2d5c3" text-anchor="end">{} <tspan fill="#bba78f">({})</tspan></text>"##, l - 12.0, cy + 4.0, label(k.kind), k.n);
        let (a, b) = (x(k.back_per_near[0]), x(k.back_per_near[2]));
        let color = if k.back_per_near[1] > 1.0 { "#9fd8a8" } else { "#ff8f7f" };
        let _ = write!(o, r##"<rect x="{a:.1}" y="{:.1}" width="{:.1}" height="10" rx="5" fill="{color}" opacity="0.35"/>"##, cy - 5.0, (b - a).max(2.0));
        let _ = write!(o, r##"<circle cx="{:.1}" cy="{cy:.1}" r="5" fill="{color}"/>"##, x(k.back_per_near[1]));
        let _ = write!(o, r##"<text x="{}" y="{:.1}" fill="#f2b45a" font-weight="600">{:.1}% ahead</text>"##, w - rpad + 16.0, cy + 4.0, 100.0 * k.pos_end);
    }
    let _ = write!(o, r##"<text x="24" y="{}" fill="#bba78f">Right: share of players that ended net positive in NEAR. Ratios above {:.1} are drawn at the edge.</text>"##, h - 6.0, hi);
    o.push_str("</svg>\n");
    o
}

/// Per scenario: where outside players' NEAR went (the vault, their records' storage, gas) and how much came back.
fn svg_flow(sc: &[Value]) -> String {
    let rows: Vec<&Value> = sc.iter().filter(|s| s["players"].as_u64().unwrap_or(0) > 0).collect();
    let (w, l, rpad, t, row) = (760.0, 120.0, 40.0, 70.0, 52.0);
    let h = t + row * rows.len() as f64 + 30.0;
    let pw = w - l - rpad;
    let mut o = String::new();
    let _ = write!(o, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Figtree, system-ui, sans-serif" font-size="12"><rect width="{w}" height="{h}" fill="#120a05"/>"##);
    let _ = write!(o, r##"<text x="24" y="28" fill="#f3e9da" font-family="Gloock, Georgia, serif" font-size="18">Where outside players' NEAR went, and how much came back</text>"##);
    let _ = write!(o, r##"<text x="24" y="48" fill="#bba78f">Share of all they paid. Cream: into the vault. Coral: storage of their own records. Grey: gas. Green tick: what they ended with.</text>"##);
    for (i, s) in rows.iter().enumerate() {
        let y = t + row * i as f64;
        let m = &s["money"];
        let v = m["players_to_vault"][1].as_f64().unwrap();
        let st = m["players_to_storage"][1].as_f64().unwrap();
        let g = m["players_to_gas"][1].as_f64().unwrap();
        let back = m["players_back_share"][1].as_f64().unwrap();
        let _ = write!(o, r##"<text x="{}" y="{:.1}" fill="#e2d5c3" text-anchor="end">{}</text>"##, l - 12.0, y + 16.0, esc(s["name"].as_str().unwrap()));
        let mut x0 = l;
        for (part, color) in [(v, "#e2d5c3"), (st, "#ff8f7f"), (g, "#7d6a58")] {
            let bw = pw * part;
            let _ = write!(o, r##"<rect x="{x0:.1}" y="{y:.1}" width="{bw:.1}" height="22" fill="{color}"/>"##);
            x0 += bw;
        }
        let bx = l + pw * back;
        let _ = write!(o, r##"<line x1="{bx:.1}" x2="{bx:.1}" y1="{:.1}" y2="{:.1}" stroke="#9fd8a8" stroke-width="3"/>"##, y - 4.0, y + 26.0);
        let _ = write!(o, r##"<text x="{l}" y="{:.1}" fill="#bba78f">vault {:.0}% · storage {:.0}% · gas {:.0}% · back {:.0}%</text>"##, y + 40.0, 100.0 * v, 100.0 * st, 100.0 * g, 100.0 * back);
    }
    o.push_str("</svg>\n");
    o
}

/// Per scenario: NEAR the vault paid players, split into the house's pro-rata part and other players'.
fn svg_sources(sc: &[Value]) -> String {
    let rows: Vec<&Value> = sc.iter().filter(|s| s["money"]["paid_to_players"][1].as_f64().unwrap_or(0.0) > 0.0).collect();
    let (w, l, rpad, t, row) = (760.0, 120.0, 40.0, 70.0, 44.0);
    let h = t + row * rows.len() as f64 + 40.0;
    let max = rows.iter().map(|s| s["money"]["paid_to_players"][1].as_f64().unwrap()).fold(0.0, f64::max).max(1.0);
    let pw = w - l - rpad;
    let mut o = String::new();
    let _ = write!(o, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Figtree, system-ui, sans-serif" font-size="12"><rect width="{w}" height="{h}" fill="#120a05"/>"##);
    let _ = write!(o, r##"<text x="24" y="28" fill="#f3e9da" font-family="Gloock, Georgia, serif" font-size="18">Where the NEAR the vault paid players came from</text>"##);
    let _ = write!(o, r##"<text x="24" y="48" fill="#bba78f">Median of seeds over 60 days. Gold: the house strains' NEAR. Cream: other players' NEAR.</text>"##);
    for (i, s) in rows.iter().enumerate() {
        let y = t + row * i as f64;
        let total = s["money"]["paid_to_players"][1].as_f64().unwrap();
        let house = total * s["money"]["house_share"][1].as_f64().unwrap();
        let bw = pw * total / max;
        let hw = pw * house / max;
        let _ = write!(o, r##"<text x="{}" y="{:.1}" fill="#e2d5c3" text-anchor="end">{}</text>"##, l - 12.0, y + 16.0, esc(s["name"].as_str().unwrap()));
        let _ = write!(o, r##"<rect x="{l}" y="{y:.1}" width="{bw:.1}" height="22" rx="4" fill="#e2d5c3" opacity="0.85"/><rect x="{l}" y="{y:.1}" width="{:.1}" height="22" rx="2" fill="#f2b45a"/>"##, hw.max(1.5));
        let _ = write!(o, r##"<text x="{l}" y="{:.1}" fill="#bba78f">{:.2} NEAR paid out; house {:.2} ({:.1}%), players {:.2} ({:.1}%)</text>"##, y + 36.0, total, house, 100.0 * house / total, total - house, 100.0 * (1.0 - house / total));
    }
    o.push_str("</svg>\n");
    o
}
