//! Sixty days of the mainnet rules under five community scenarios, and a bench of 1,000 short adversarial seasons.
//!
//! ```text
//! cargo run --release -- out-60d days60 [--seeds 5]
//! cargo run --release -- out-60d bench [--seasons 1000]
//! ```
//!
//! Both run the same `World` as `all`: petri-core's Life and economy at every one of the 345,600 generations (15 s
//! each) of sixty days, every planting priced by the contract's formula, every tide split by its rules. Nothing is
//! sampled: the day rows are read off the running world at the end of each day.

use super::*;

pub(crate) const SCENARIOS: [(&str, &str); 5] = [
    ("boom", "600 outside players arrive over the first ten days, then nobody new"),
    ("steady", "5 new outside players a day for sixty days (300 in all)"),
    ("decline", "300 players arrive in the first two days and nobody after; each stops once its budget is spent"),
    ("whale siege", "steady arrivals (150 over 30 days) plus three 2-NEAR whales, a 10-colony split whale and two lattice lockers from day 0"),
    ("strains only", "the five house strains alone, with their mainnet budgets, and no outside player"),
];

pub(crate) fn society_of(name: &str) -> Society {
    use Kind::*;
    match name {
        "boom" => mixed(600, 10.0),
        "steady" => mixed(300, 60.0),
        "decline" => mixed(300, 2.0),
        "whale siege" => {
            let mut s = mixed(150, 30.0);
            s.push(spec(Whale, 3, 1));
            s.push(spec(SplitWhale, 1, 10));
            s.push(spec(Locker, 2, 1));
            s
        }
        _ => vec![house()],
    }
}

/// Headline shares count from this day on.
const SETTLED: u64 = 7;

fn p(u: u128) -> f64 {
    u as f64 / UNIT as f64
}

fn med(mut v: Vec<f64>) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    if v.is_empty() {
        0.0
    } else if v.len() % 2 == 1 {
        v[v.len() / 2]
    } else {
        (v[v.len() / 2 - 1] + v[v.len() / 2]) / 2.0
    }
}

fn lo(v: &[f64]) -> f64 {
    v.iter().cloned().fold(f64::INFINITY, f64::min)
}
fn hi(v: &[f64]) -> f64 {
    v.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
}

/// One scenario's day-by-day medians (and the seeds' spread) for the charts.
struct Series {
    name: String,
    days: Vec<u64>,
    agar: Vec<[f64; 3]>,
    held: Vec<[f64; 3]>,
    burned: Vec<[f64; 3]>,
    vault: Vec<[f64; 3]>,
    vault_out: Vec<[f64; 3]>,
    live: Vec<[f64; 3]>,
    top: Vec<[f64; 3]>,
}

fn series(name: &str, runs: &[RunOut]) -> Series {
    let n = runs.iter().map(|r| r.days.len()).min().unwrap_or(0);
    let mut s = Series { name: name.into(), days: Vec::new(), agar: Vec::new(), held: Vec::new(), burned: Vec::new(), vault: Vec::new(), vault_out: Vec::new(), live: Vec::new(), top: Vec::new() };
    let band = |v: Vec<f64>| [lo(&v), med(v.clone()), hi(&v)];
    for d in 0..n {
        s.days.push(runs[0].days[d].day);
        s.agar.push(band(runs.iter().map(|r| p(r.days[d].agar)).collect()));
        s.held.push(band(runs.iter().map(|r| p(r.days[d].held)).collect()));
        s.burned.push(band(runs.iter().map(|r| p(r.days[d].burned)).collect()));
        s.vault.push(band(runs.iter().map(|r| nf(r.days[d].vault)).collect()));
        s.vault_out.push(band(runs.iter().map(|r| nf(r.days[d].vault_out)).collect()));
        s.live.push(band(runs.iter().map(|r| r.days[d].live as f64).collect()));
        s.top.push(band(runs.iter().map(|r| r.days[d].top_live_share).collect()));
    }
    s
}

/// A hand-drawn chart: PETRI in the agar, held by players and burned (left axis, PETRI), and the vault's NEAR
/// paid out (right axis), median over seeds with the seeds' range shaded.
fn svg(s: &Series, max_supply: f64) -> String {
    let (w, h, l, r, t, b) = (720.0, 360.0, 64.0, 64.0, 40.0, 44.0);
    let pw = w - l - r;
    let ph = h - t - b;
    let days = *s.days.last().unwrap_or(&1) as f64;
    let x = |d: f64| l + pw * d / days.max(1.0);
    let y = |v: f64| t + ph * (1.0 - v / max_supply);
    let near_max = s.vault_out.iter().map(|v| v[2]).fold(0.0, f64::max).max(s.vault.iter().map(|v| v[2]).fold(0.0, f64::max)).max(0.01);
    let near_top = nice(near_max);
    let yn = |v: f64| t + ph * (1.0 - v / near_top);
    let mut o = String::new();
    let _ = write!(o, r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="Figtree, system-ui, sans-serif" font-size="12"><rect width="{w}" height="{h}" fill="#120a05"/>"##);
    let _ = write!(o, r##"<text x="{l}" y="22" fill="#f3e9da" font-size="15">{} — PETRI supply over 60 days (median of seeds, range shaded)</text>"##, esc(&s.name));
    for i in 0..=4 {
        let v = max_supply * i as f64 / 4.0;
        let _ = write!(o, r##"<line x1="{l}" x2="{}" y1="{y}" y2="{y}" stroke="#3a2a1c" stroke-width="1"/><text x="{}" y="{}" fill="#b8a48c" text-anchor="end">{}k</text>"##, w - r, l - 8.0, y(v) + 4.0, (v / 1000.0).round(), y = y(v));
        let nv = near_top * i as f64 / 4.0;
        let _ = write!(o, r##"<text x="{}" y="{}" fill="#9fd8a8" text-anchor="start">{:.2}</text>"##, w - r + 8.0, yn(nv) + 4.0, nv);
    }
    for d in (0..=days as u64).step_by(10) {
        let _ = write!(o, r##"<text x="{}" y="{}" fill="#b8a48c" text-anchor="middle">day {d}</text>"##, x(d as f64), h - b + 18.0);
    }
    let band = |o: &mut String, v: &[[f64; 3]], f: &dyn Fn(f64) -> f64, color: &str| {
        let mut d = String::new();
        for (i, p) in v.iter().enumerate() {
            let _ = write!(d, "{}{:.1},{:.1}", if i == 0 { "M" } else { "L" }, x(s.days[i] as f64), f(p[2]));
        }
        for (i, p) in v.iter().enumerate().rev() {
            let _ = write!(d, "L{:.1},{:.1}", x(s.days[i] as f64), f(p[0]));
        }
        let _ = write!(o, r##"<path d="{d}Z" fill="{color}" opacity="0.18"/>"##);
        let mut m = String::new();
        for (i, p) in v.iter().enumerate() {
            let _ = write!(m, "{}{:.1},{:.1}", if i == 0 { "M" } else { "L" }, x(s.days[i] as f64), f(p[1]));
        }
        let _ = write!(o, r##"<path d="{m}" fill="none" stroke="{color}" stroke-width="2"/>"##);
    };
    band(&mut o, &s.agar, &y, "#f2b45a");
    band(&mut o, &s.held, &y, "#e9d8c0");
    band(&mut o, &s.burned, &y, "#ff8f7f");
    band(&mut o, &s.vault_out, &yn, "#9fd8a8");
    let legend = [("#f2b45a", "PETRI in the agar"), ("#e9d8c0", "PETRI held by players"), ("#ff8f7f", "PETRI burned"), ("#9fd8a8", "NEAR the vault paid out (right axis)")];
    for (i, (c, txt)) in legend.iter().enumerate() {
        let lx = l + (i as f64) * 160.0;
        let _ = write!(o, r##"<rect x="{lx}" y="{}" width="10" height="10" fill="{c}"/><text x="{}" y="{}" fill="#e9d8c0">{txt}</text>"##, h - 16.0, lx + 14.0, h - 7.0);
    }
    o.push_str("</svg>\n");
    o
}

fn nice(v: f64) -> f64 {
    let e = 10f64.powf(v.log10().floor());
    for m in [1.0, 2.0, 2.5, 5.0, 10.0] {
        if m * e >= v {
            return m * e;
        }
    }
    10.0 * e
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;")
}

pub fn days60(out_dir: &str, rm: &Rules, seeds: u64) {
    let t0 = Instant::now();
    let scen: Vec<Scenario> = SCENARIOS.iter().enumerate().map(|(i, (name, _))| sc(name, rm, mainnet(60), society_of(name), seeds, 600 + i as u64)).collect();
    let runs = run_all(&scen);
    let max_supply = p(rm.max_supply);
    let mut csv = String::from("scenario,seed,day,generation,live,agar_petri,held_petri,burned_petri,fed_petri,vault_near,vault_out_near,credit_pool_near,cell_price_petri,tides_run,tides_skipped,joined,top_live_share,top_live_kind,top_held_share,house_left_near\n");
    let mut web = String::from("{\n  \"generated\": \"sim/src/sixty.rs, mainnet launch rules, 60 days x ");
    let _ = write!(web, "{} seeds\",\n  \"max_supply\": {},\n  \"scenarios\": [\n", seeds, max_supply);
    let mut head = String::new();
    let _ = writeln!(head, "| Scenario | What happens | Largest share of living cells one outside player held (day 7 on) | Largest share of players' PETRI one player held (day 7 on) | PETRI burned | NEAR the vault paid out | PETRI left in the agar | Living cells, day 60 |");
    let _ = writeln!(head, "|---|---|---|---|---|---|---|---|");
    for (si, s) in scen.iter().enumerate() {
        let rs = &runs[si];
        for (k, r) in rs.iter().enumerate() {
            for d in &r.days {
                let _ = writeln!(
                    csv,
                    "\"{}\",{},{},{},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{},{},{},{:.4},{},{:.4},{:.6}",
                    s.name, k, d.day, d.gen, d.live, p(d.agar), p(d.held), p(d.burned), p(d.fed), nf(d.vault), nf(d.vault_out), nf(d.credit_pool), p(d.cell_price), d.tides_run, d.tides_skipped, d.joined, d.top_live_share, d.top_live_kind.map(|k| format!("{:?}", k)).unwrap_or_default(), d.top_held_share, nf(d.house_left)
                );
            }
        }
        let ser = series(&s.name, rs);
        let file = s.name.replace(' ', "-");
        fs::write(format!("{}/supply-{}.svg", out_dir, file), svg(&ser, max_supply)).unwrap();
        // Headline numbers, over seeds: max over days of the top share, and end-of-run totals.
        // From day 7 on: in the first days a handful of colonies share the dish and any one of them holds most of it.
        let top: Vec<f64> = rs.iter().map(|r| r.days.iter().filter(|d| d.day >= SETTLED).map(|d| d.top_live_share).fold(0.0, f64::max)).collect();
        let held: Vec<f64> = rs.iter().map(|r| r.days.iter().filter(|d| d.day >= SETTLED).map(|d| d.top_held_share).fold(0.0, f64::max)).collect();
        let top_kind = rs
            .iter()
            .filter_map(|r| r.days.iter().filter(|d| d.day >= SETTLED).max_by(|a, b| a.top_live_share.partial_cmp(&b.top_live_share).unwrap()).and_then(|d| d.top_live_kind))
            .map(|k| format!("{:?}", k))
            .collect::<Vec<_>>();
        let last = |f: &dyn Fn(&DayRow) -> f64| -> Vec<f64> { rs.iter().map(|r| r.days.last().map(f).unwrap_or(0.0)).collect() };
        let burned = last(&|d| p(d.burned));
        let out = last(&|d| nf(d.vault_out));
        let agar = last(&|d| p(d.agar));
        let live = last(&|d| d.live as f64);
        let _ = writeln!(
            head,
            "| {} | {} | {:.1}% ({:.1}–{:.1}%; {}) | {:.1}% ({:.1}–{:.1}%) | {:.0} ({:.0}–{:.0}) | {:.3} ({:.3}–{:.3}) | {:.0} ({:.0}–{:.0}) | {:.0} ({:.0}–{:.0}) |",
            s.name,
            SCENARIOS[si].1,
            100.0 * med(top.clone()),
            100.0 * lo(&top),
            100.0 * hi(&top),
            if top_kind.is_empty() { "nobody".into() } else { dedup(top_kind) },
            100.0 * med(held.clone()),
            100.0 * lo(&held),
            100.0 * hi(&held),
            med(burned.clone()),
            lo(&burned),
            hi(&burned),
            med(out.clone()),
            lo(&out),
            hi(&out),
            med(agar.clone()),
            lo(&agar),
            hi(&agar),
            med(live.clone()),
            lo(&live),
            hi(&live)
        );
        let pts = |v: &[[f64; 3]], prec: usize| v.iter().map(|x| format!("[{:.p$},{:.p$},{:.p$}]", x[0], x[1], x[2], p = prec)).collect::<Vec<_>>().join(",");
        let _ = write!(
            web,
            "    {{\"name\": \"{}\", \"what\": \"{}\", \"seeds\": {}, \"top_live_share\": [{:.4},{:.4},{:.4}], \"top_held_share\": [{:.4},{:.4},{:.4}], \"top_kind\": \"{}\", \"burned\": [{:.0},{:.0},{:.0}], \"vault_out\": [{:.4},{:.4},{:.4}], \"agar_end\": [{:.0},{:.0},{:.0}],\n     \"days\": [{}],\n     \"agar\": [{}],\n     \"held\": [{}],\n     \"burned_by_day\": [{}],\n     \"vault\": [{}],\n     \"vault_out_by_day\": [{}],\n     \"live\": [{}],\n     \"top\": [{}]}}{}\n",
            s.name,
            SCENARIOS[si].1,
            rs.len(),
            lo(&top),
            med(top.clone()),
            hi(&top),
            lo(&held),
            med(held.clone()),
            hi(&held),
            if top_kind_med(rs).is_empty() { "nobody".into() } else { top_kind_med(rs) },
            lo(&burned),
            med(burned.clone()),
            hi(&burned),
            lo(&out),
            med(out.clone()),
            hi(&out),
            lo(&agar),
            med(agar.clone()),
            hi(&agar),
            ser.days.iter().map(|d| d.to_string()).collect::<Vec<_>>().join(","),
            pts(&ser.agar, 0),
            pts(&ser.held, 0),
            pts(&ser.burned, 0),
            pts(&ser.vault, 4),
            pts(&ser.vault_out, 4),
            pts(&ser.live, 0),
            pts(&ser.top, 4),
            if si + 1 < scen.len() { "," } else { "" }
        );
    }
    web.push_str("  ]\n}\n");
    fs::write(format!("{}/days.csv", out_dir), csv).unwrap();
    fs::write(format!("{}/web.json", out_dir), web).unwrap();
    fs::write(format!("{}/headline.md", out_dir), head).unwrap();
    eprintln!("60 days x {} scenarios x {} seeds in {:.0} s", scen.len(), seeds, t0.elapsed().as_secs_f64());
}

fn dedup(mut v: Vec<String>) -> String {
    v.sort();
    v.dedup();
    v.join(", ")
}

fn top_kind_med(rs: &[RunOut]) -> String {
    dedup(rs.iter().filter_map(|r| r.days.iter().filter(|d| d.day >= SETTLED).max_by(|a, b| a.top_live_share.partial_cmp(&b.top_live_share).unwrap()).and_then(|d| d.top_live_kind)).map(|k| format!("{:?}", k)).collect())
}

/// 1,000 one-day seasons on the mainnet rules: the five strains, 20 mixed outside players and one attacker that tries
/// to own the dish (a 2-NEAR whale, a 10-colony split whale, or a lattice locker, in turn). For each season: the most
/// of the living cells the attacker held at any tide, its share of everything the tides paid outside players, and the
/// NEAR it got back against the NEAR it put in. An attempt to monopolise "paid" only if the attacker ended ahead in
/// NEAR, counting NEAR still owed to it and the PETRI it still holds at the sell-back price; the siege price is what a newcomer's 4-cell block inside a rival's buffer cost, per tide.
pub fn bench(out_dir: &str, rm: &Rules, seasons: u64) {
    use Kind::*;
    let t0 = Instant::now();
    let attackers = [Whale, SplitWhale, Locker];
    let mut scen = Vec::new();
    for (i, k) in attackers.iter().enumerate() {
        let mut s = mixed(20, 0.5);
        s.push(spec(*k, 1, if *k == SplitWhale { 10 } else { 1 }));
        let n = seasons / 3 + if (i as u64) < seasons % 3 { 1 } else { 0 };
        scen.push(sc(&format!("bench {:?}", k), rm, mainnet(1), s, n, 1000 + i as u64));
    }
    let runs = run_all(&scen);
    let mut csv = String::from("attacker,season,max_attacker_live_share,attacker_tide_share,attacker_paid_near,attacker_got_near,attacker_cash_near,attacker_paper_near,median_siege_block_near,median_block_near\n");
    let mut lines = String::new();
    let mut json = String::from("{
  \"generated\": \"sim/src/sixty.rs bench, mainnet launch rules, one-day seasons\",
  \"attackers\": [
");
    let (mut total, mut half_cells, mut half_tides, mut paid_off) = (0usize, 0usize, 0usize, 0usize);
    let mut all_share = Vec::new();
    let mut all_siege = Vec::new();
    let mut all_block = Vec::new();
    for (si, s) in scen.iter().enumerate() {
        let k = attackers[si];
        let (mut shares, mut tshares, mut cash, mut sieges, mut blocks) = (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for (n, r) in runs[si].iter().enumerate() {
            let share = r.timeline.iter().filter(|t| t.top_live_kind == Some(k)).map(|t| t.top_live_share).fold(0.0, f64::max);
            let outside: u128 = r.groups.iter().filter(|g| g.kind != House).map(|g| g.tide_share).sum();
            let g = r.groups.iter().find(|g| g.kind == k);
            let tshare = g.map(|g| g.tide_share as f64 / outside.max(1) as f64).unwrap_or(0.0);
            let (paid, got) = g.map(|g| (g.paid(), g.withdrawn())).unwrap_or((0.0, 0.0));
            // Counting what it still holds: NEAR owed and PETRI at the sell-back price.
            let paper = g.map(|g| g.paper()).unwrap_or(0.0);
            let siege = med(r.timeline.iter().map(|t| nf(t.siege_near)).collect());
            let block = med(r.timeline.iter().filter(|t| !t.newcomer_siege).map(|t| nf(t.newcomer_near)).collect());
            let _ = writeln!(csv, "{:?},{},{:.4},{:.4},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6}", k, n, share, tshare, paid, got, got - paid, paper, siege, block);
            if share >= 0.5 {
                half_cells += 1;
            }
            if tshare >= 0.5 {
                half_tides += 1;
            }
            if paper > 0.0 {
                paid_off += 1;
            }
            shares.push(share);
            tshares.push(tshare);
            cash.push(paper);
            sieges.push(siege);
            blocks.push(block);
        }
        total += shares.len();
        all_share.extend(shares.iter().cloned());
        all_siege.extend(sieges.iter().cloned());
        all_block.extend(blocks.iter().cloned());
        let n = shares.len().max(1) as f64;
        let _ = writeln!(
            json,
            "    {{\"kind\": \"{:?}\", \"seasons\": {}, \"live_share_median\": {:.4}, \"live_share_max\": {:.4}, \"half_cells\": {}, \"tide_share_median\": {:.4}, \"paid_off\": {}, \"net_near_median\": {:.4}, \"net_near_best\": {:.4}, \"siege_near\": {:.5}, \"block_near\": {:.5}}}{}",
            k,
            shares.len(),
            med(shares.clone()),
            hi(&shares),
            shares.iter().filter(|x| **x >= 0.5).count(),
            med(tshares.clone()),
            cash.iter().filter(|c| **c > 0.0).count(),
            med(cash.clone()),
            hi(&cash),
            med(sieges.clone()),
            med(blocks.clone()),
            if si + 1 < scen.len() { "," } else { "" }
        );
        let _ = writeln!(
            lines,
            "| {:?} | {} | {:.1}% (max {:.1}%) | {:.1}% | {:.1}% | {} of {} ({:.1}%) | {:+.3} NEAR (best {:+.3}) | {:.4} vs {:.4} NEAR |",
            k,
            shares.len(),
            100.0 * med(shares.clone()),
            100.0 * hi(&shares),
            100.0 * shares.iter().filter(|x| **x >= 0.5).count() as f64 / n,
            100.0 * med(tshares.clone()),
            shares.len() - cash.iter().filter(|c| **c > 0.0).count(),
            shares.len(),
            100.0 * (shares.len() - cash.iter().filter(|c| **c > 0.0).count()) as f64 / n,
            med(cash.clone()),
            hi(&cash),
            med(sieges.clone()),
            med(blocks.clone())
        );
    }
    let mut md = String::new();
    let _ = writeln!(md, "| Attacker | Seasons | Most of the living cells it held (median of seasons) | Seasons it held half the cells | Its share of what the tides paid outside players | Attempts that did not pay | Net NEAR, counting what it still holds, median | 4-cell block: siege vs open ground, median |");
    let _ = writeln!(md, "|---|---|---|---|---|---|---|---|");
    md.push_str(&lines);
    let t = total.max(1) as f64;
    let _ = writeln!(
        md,
        "| **All** | {} | {:.1}% (max {:.1}%) | {:.1}% | | {} of {} ({:.1}%) | | {:.4} vs {:.4} NEAR |",
        total,
        100.0 * med(all_share.clone()),
        100.0 * hi(&all_share),
        100.0 * half_cells as f64 / t,
        total - paid_off,
        total,
        100.0 * (total - paid_off) as f64 / t,
        med(all_siege),
        med(all_block)
    );
    let _ = writeln!(md, "\nSeasons where the attacker took at least half of what the tides paid outside players: {} of {} ({:.1}%).", half_tides, total, 100.0 * half_tides as f64 / t);
    json.push_str("  ]
}
");
    fs::write(format!("{}/bench.json", out_dir), json).unwrap();
    fs::write(format!("{}/bench.csv", out_dir), csv).unwrap();
    fs::write(format!("{}/bench.md", out_dir), md).unwrap();
    eprintln!("bench: {} seasons in {:.0} s", total, t0.elapsed().as_secs_f64());
}
