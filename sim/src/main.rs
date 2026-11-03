//! Petri economy simulator, v5.
//!
//! Runs the real rules from `petri-core` (the Life step, the capped feed on decaying stake, the planting price with the
//! siege surcharge, the purchase and sell-back curves and the tide split) for days of generations, with scripted
//! players including adversaries, and reports what every kind of player ends up with **in NEAR actually withdrawn**.
//! The parameters are read from `contract/launch-rules.json` (the launched rules); `--set key=value` overrides one for
//! a sweep. The contract's book-keeping is mirrored from `contract/src/lib.rs` v5: the two pools (attached NEAR into the
//! vault, sponsored credit into the credit pool), storage paid from credit first, the tide (bounty capped, the entry's
//! storage, the rest by window earnings; the credit pool paid as credit), the house (never fed, no tide share, never a
//! siege), the sell-back cap, the catch-up cap and gas limit, and dormancy (the clock skips after `max_lag`).
//! Storage sizes are computed from the borsh layout of what each call writes; gas is an estimate from NEAR's fee
//! schedule (see the summary header).
//!
//! ```text
//! cargo run --release -- <out_dir> all [--rules path] [--set k=v ...] [--seeds-1500 n] [--seeds-big n]
//! cargo run --release -- <out_dir> probe <players> <days> [--set k=v ...]
//! cargo run --release -- <out_dir> fixes [--set k=v ...]
//! ```

use petri_core::{decay_stake, feed_per_cell, feed_sparse, patterns, petri_for_near, planting_cost, sell_back, tide_split, ColonyId, Dish, EMPTY, STAKE_UNIT};
use serde::Deserialize;
use std::fmt::Write as _;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// One PETRI in units (6 decimals).
const UNIT: u128 = 1_000_000;
/// One NEAR in yoctoNEAR.
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// NEAR's storage price: 10^19 yoctoNEAR per byte.
const BYTE: u128 = 10_000_000_000_000_000_000;
/// The contract's `RECLAIM_AFTER`: a sponsor may take back credit unused for this many generations.
const RECLAIM_AFTER: u64 = 5_760;

// ---------- storage, from the borsh layout of what each call writes (40 bytes of NEAR overhead per record) ----------

/// Account-name lengths: a wallet ("someone.testnet"), a relayer guest ("g-<10 hex>.petri-relay.testnet"), a
/// self-sponsored sub-account, a house strain, the relayer and the contract; and a colony name.
const L_WALLET: u128 = 16;
const L_GUEST: u128 = 32;
const L_SUB: u128 = 24;
const L_HOUSE: u128 = 22;
const L_RELAYER: u128 = 19;
const L_CONTRACT: u128 = 20;
const NAME_LEN: u128 = 12;
/// `join`: the Colony record (161 + L + N bytes of borsh, key 5, +40), colony_of (47 + L), names (45 + N), the balance
/// record (61 + L), the Join entry (56), the four per-colony arrays (+40) and the 140 bytes charged up front for the
/// purchase entry: 595 + 3L + 2N.
fn join_bytes(l: u128) -> u128 {
    595 + 3 * l + 2 * NAME_LEN
}
/// `buy` charges a fixed 140 bytes.
const BUY_BYTES: u128 = 140;
/// What a planting really stores: the Plant entry (109 + 2c), its plant-index entry (53) and 2 bytes per cell on the
/// board = 162 + 4c; 8 more the first time (last_plant_generation becomes Some); a note adds 49 + its length.
fn plant_stored(cells: u128, first: bool, note: bool) -> u128 {
    162 + 4 * cells + if first { 8 } else { 0 } + if note { 49 + NOTE_LEN } else { 0 }
}
/// The contract's PLANT_STORAGE_BASE: `plant_deposit` = (220 + 4c (+ note + 64)) bytes + cell_fee per cell.
const PLANT_STORAGE_BASE: u128 = 220;
/// The house strains write a lab note of about 120 bytes with every planting.
const NOTE_LEN: u128 = 120;
/// A Sell entry: 104 bytes, from the proceeds.
const SELL_BYTES: u128 = 104;
/// A Tide entry (with its 64-character chain) and its tide-index entry.
const TIDE_BYTES: u128 = 271;
/// A Skip entry, paid by the contract.
const SKIP_BYTES: u128 = 62;
/// A Credit record: key 1 + 4 + L, amount 16, sponsor 4 + Ls, at 8, +40.
fn credit_record(l: u128, ls: u128) -> u128 {
    73 + l + ls
}

// ---------- gas, estimated from NEAR's fee schedule, in Ggas ----------

/// A function call's fixed cost: the transaction, its receipt, loading the contract and its state. Calibrated so a
/// planting that catches up three generations on a small dish burns ~4.4 TGas, as one did on testnet.
const G_CALL: f64 = 2_500.0;
/// One storage read or write (base cost) and per byte read / written (a write also pays the evicted value).
const G_SOP: f64 = 60.0;
const G_RB: f64 = 0.0056;
const G_WB: f64 = 0.063;
/// One wasm instruction.
const G_OP: f64 = 0.000_823;
const G_SHA_BYTE: f64 = 0.024;
/// A NEAR transfer and its `on_payout` callback.
const G_PAYOUT: f64 = 3_000.0;
/// One transaction may burn at most 300 TGas; a catch-up stops once it used min(180, prepaid 200 - 40) TGas.
const G_TX_MAX: f64 = 300_000.0;
const G_CATCHUP_LIMIT: f64 = 160_000.0;
/// The credit half of a tide reads and writes every winner's Colony record and Credit record.
const G_CREDIT_WINNER: f64 = 4.0 * G_SOP + 330.0 * (G_RB + G_WB);
/// yoctoNEAR per Ggas at NEAR's minimum gas price (10^8 yocto per gas): 1 TGas = 0.0001 NEAR.
const YOCTO_PER_GGAS: f64 = 1e17;

// ---------- the rules ----------

#[derive(Deserialize)]
struct LaunchJson {
    width: u16,
    height: u16,
    generation_ms: String,
    max_supply: String,
    feed_ppm: u32,
    keeper_bps: u16,
    reach: u32,
    stake_keep_bps: u16,
    burn_bps: u16,
    payback: u32,
    min_cell_price: String,
    live_floor: u32,
    petri_price: String,
    min_join: String,
    cell_fee: String,
    tide_every: u32,
    tide_bps: u16,
    tide_bounty_bps: u16,
    max_bounty: String,
    sell_bps: u16,
    sell_cap_bps: u16,
    siege_x: u32,
    buffer: u16,
    max_plant_cells: u32,
    max_catchup: u32,
    max_lag: u32,
    house: Vec<String>,
}

#[derive(Clone, Debug)]
struct Rules {
    width: u16,
    height: u16,
    generation_ms: u64,
    max_supply: u128,
    feed_ppm: u32,
    keeper_bps: u16,
    reach: u32,
    stake_keep_bps: u16,
    burn_bps: u16,
    payback: u32,
    min_cell_price: u128,
    live_floor: u32,
    petri_price: u128,
    min_join: u128,
    cell_fee: u128,
    tide_every: u64,
    tide_bps: u16,
    tide_bounty_bps: u16,
    max_bounty: u128,
    sell_bps: u16,
    sell_cap_bps: u16,
    siege_x: u32,
    buffer: u16,
    max_plant_cells: u32,
    max_catchup: u64,
    max_lag: u64,
    house: Vec<String>,
    // Simulator-only switches (not contract rules).
    /// false: the v2 rule, no planting inside a rival's buffer at any price.
    siege_allowed: bool,
    /// Hypothetical: guests could route NEAR to a wallet (if the relayer let them call `set_payout`).
    guest_payout: bool,
    /// Whether the team keeper's account is registered for PETRI (agents/run.mjs: a one-off done by hand).
    keeper_registered: bool,
    /// Fix experiment: the credit half of a tide is kept in a packed per-colony array (like the NEAR half) instead of
    /// a Colony and Credit record write per winner.
    packed_credit: bool,
    /// Fix experiment: the ledger kept as events (an indexer replays them) instead of stored entries, so a planting
    /// stores only its board bytes, and buy, sell, join and tide entries store nothing.
    ledger_events: bool,
    /// Fix experiment: a tide that pays nobody writes no entry (an idle dish then costs the contract no storage).
    quiet_tides: bool,
    /// The overrides applied, for the header.
    overrides: Vec<String>,
}

impl Rules {
    fn load(path: &str, sets: &[(String, String)]) -> Rules {
        let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {}: {}", path, e));
        let mut v: serde_json::Value = serde_json::from_str(&text).expect("launch rules are not JSON");
        let mut sim: Vec<(String, String)> = Vec::new();
        let obj = v.as_object_mut().unwrap();
        for (k, val) in sets {
            match obj.get(k) {
                Some(serde_json::Value::String(_)) => {
                    obj.insert(k.clone(), serde_json::Value::String(val.clone()));
                }
                Some(_) => {
                    let n: u64 = val.parse().unwrap_or_else(|_| panic!("{} needs a number", k));
                    obj.insert(k.clone(), serde_json::Value::from(n));
                }
                None => sim.push((k.clone(), val.clone())),
            }
        }
        let j: LaunchJson = serde_json::from_value(v).expect("launch rules do not match the v5 Rules");
        let p = |s: &str| s.parse::<u128>().expect("a U128 field is not a number");
        let mut r = Rules {
            width: j.width,
            height: j.height,
            generation_ms: p(&j.generation_ms) as u64,
            max_supply: p(&j.max_supply),
            feed_ppm: j.feed_ppm,
            keeper_bps: j.keeper_bps,
            reach: j.reach,
            stake_keep_bps: j.stake_keep_bps,
            burn_bps: j.burn_bps,
            payback: j.payback,
            min_cell_price: p(&j.min_cell_price),
            live_floor: j.live_floor,
            petri_price: p(&j.petri_price),
            min_join: p(&j.min_join),
            cell_fee: p(&j.cell_fee),
            tide_every: j.tide_every as u64,
            tide_bps: j.tide_bps,
            tide_bounty_bps: j.tide_bounty_bps,
            max_bounty: p(&j.max_bounty),
            sell_bps: j.sell_bps,
            sell_cap_bps: j.sell_cap_bps,
            siege_x: j.siege_x,
            buffer: j.buffer,
            max_plant_cells: j.max_plant_cells,
            max_catchup: j.max_catchup as u64,
            max_lag: j.max_lag as u64,
            house: j.house,
            siege_allowed: true,
            guest_payout: false,
            keeper_registered: false,
            packed_credit: false,
            ledger_events: false,
            quiet_tides: false,
            overrides: sets.iter().map(|(k, v)| format!("{}={}", k, v)).collect(),
        };
        for (k, val) in sim {
            let b = matches!(val.as_str(), "1" | "true" | "yes");
            match k.as_str() {
                "siege_allowed" => r.siege_allowed = b,
                "guest_payout" => r.guest_payout = b,
                "keeper_registered" => r.keeper_registered = b,
                "packed_credit" => r.packed_credit = b,
                "ledger_events" => r.ledger_events = b,
                "quiet_tides" => r.quiet_tides = b,
                _ => panic!("unknown rule {}", k),
            }
        }
        r
    }

    fn with(&self, sets: &[(&str, &str)]) -> Rules {
        // Re-applies overrides on a copy (contract fields by name).
        let mut r = self.clone();
        for &(k, v) in sets {
            let n = || v.parse::<u128>().unwrap();
            match k {
                "feed_ppm" => r.feed_ppm = n() as u32,
                "reach" => r.reach = n() as u32,
                "stake_keep_bps" => r.stake_keep_bps = n() as u16,
                "live_floor" => r.live_floor = n() as u32,
                "tide_bps" => r.tide_bps = n() as u16,
                "sell_bps" => r.sell_bps = n() as u16,
                "sell_cap_bps" => r.sell_cap_bps = n() as u16,
                "siege_x" => r.siege_x = n() as u32,
                "cell_fee" => r.cell_fee = n(),
                "min_cell_price" => r.min_cell_price = n(),
                "payback" => r.payback = n() as u32,
                "siege_allowed" => r.siege_allowed = v == "true",
                "guest_payout" => r.guest_payout = v == "true",
                "keeper_registered" => r.keeper_registered = v == "true",
                "packed_credit" => r.packed_credit = v == "true",
                "ledger_events" => r.ledger_events = v == "true",
                "quiet_tides" => r.quiet_tides = v == "true",
                _ => panic!("cannot override {}", k),
            }
            r.overrides.push(format!("{}={}", k, v));
        }
        r
    }

    /// The curve constant, as the contract computes it: launch price per unit x full supply.
    fn k(&self) -> u128 {
        self.petri_price / 1_000_000 * self.max_supply
    }

    fn gens_per_day(&self) -> u64 {
        86_400_000 / self.generation_ms
    }
}

// ---------- players ----------

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    /// Still lifes near home. 0.05 NEAR, 0.25 in all.
    Builder,
    /// Gliders/LWSS at rivals; one move in three a blinker dropped on a rival (a siege). 0.05 NEAR.
    Raider,
    /// Eaters and beehives near home. 0.05 NEAR.
    Defender,
    /// One R-pentomino an hour within 40 cells of home (a growth bet). 0.1 NEAR, 0.5 in all.
    Methuselah,
    /// A builder joining on day 2 or 3.
    Late,
    /// 2 NEAR in one colony, pulsars and beehives anywhere, as often as the split whale's colonies together.
    Whale,
    /// The same 2 NEAR split over 10 colonies (20 from 1,500 players), one operator.
    SplitWhale,
    /// Plants only in the 3 generations before each tide, sells after every tide.
    Sniper,
    /// Blankets the dish with a lattice of blocks 8 apart so every empty cell is in its buffer, repairs it every 20
    /// generations and plants renewal blocks to keep its stake (and so its pay cap) up. 1.5 NEAR, 2 in all.
    Locker,
    /// Never plants: races the team keeper for the keeper pot and the tide bounty when they beat the gas. 0.01 NEAR.
    Racer,
    /// Buys 0.2 NEAR of PETRI at join and sells it back as fast as the allowance lets it.
    Seller,
    /// An ordinary relayer guest: plays like a builder on the 0.05 NEAR of credit the site sponsored.
    Guest,
    /// One operator: a wallet colony (a builder, 0.05 NEAR) plus 10 relayer guests (0.05 NEAR of credit each) that
    /// join, plant blocks near the wallet colony, sell their PETRI after every tide and claim their tide NEAR.
    SybilGuest,
    /// One operator who sponsors 10 of its own full-access sub-accounts with 0.05 NEAR each, plays them on credit,
    /// claims their NEAR tide winnings, stops spending credit a day before the end and then takes back (`unsponsor`)
    /// all credit left, credit won at the tides included.
    SelfSponsor,
    /// The team's five strains: mixed builders with lab notes, never siege, act every 50 to 140 generations
    /// (agents/run.mjs), buy 0.02 NEAR when they cannot afford three blocks, never sell, never fed, no tide share.
    House,
}

const KINDS: [Kind; 15] = [
    Kind::Builder,
    Kind::Raider,
    Kind::Defender,
    Kind::Methuselah,
    Kind::Late,
    Kind::Whale,
    Kind::SplitWhale,
    Kind::Sniper,
    Kind::Locker,
    Kind::Racer,
    Kind::Seller,
    Kind::Guest,
    Kind::SybilGuest,
    Kind::SelfSponsor,
    Kind::House,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    /// Signs and pays for itself.
    Wallet,
    /// A relayer guest: credit only, the relayer pays its gas, and its function-call key cannot move the NEAR it
    /// receives (set_payout is not relayed), so that NEAR is stranded in the guest account.
    Guest,
    /// A self-sponsored full-access sub-account: credit from its operator, NEAR it receives is the operator's.
    Sub,
}

#[derive(Clone, Copy)]
enum Payer {
    Acct(usize),
    Keeper,
}

/// A society: (kind, players of that kind, colonies per player).
type Society = Vec<(Kind, usize, usize)>;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Rng((z ^ (z >> 31)) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    fn range(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.range(i as u64 + 1) as usize;
            v.swap(i, j);
        }
    }
}

#[derive(Clone, Default)]
struct Acct {
    kind: Option<Kind>,
    role: Option<Role>,
    group: usize,
    id: ColonyId,
    home: (i32, i32),
    join_at: u64,
    every: u64,
    phase: u64,
    name_len: u128,
    /// NEAR (or credit) brought to `join`.
    bring: u128,
    /// NEAR the player is willing to attach in all; tide winnings, sales and bounties go back into it.
    wallet: u128,
    /// Sponsored credit held in the contract, and its record.
    credit: u128,
    has_record: bool,
    /// The record's sponsor is the operator (self-sponsor), so it can be taken back.
    reclaimable: bool,
    credit_at: u64,
    /// A self-sponsored account stops spending credit from this wall generation on.
    credit_stop: u64,
    owed_near: u128,
    unclaimed: u128,
    balance: u128,
    joined: bool,
    planted_once: bool,
    top_ups: u32,
    // Totals.
    earned: u128,
    spent: u128,
    pot: u128,
    attached: u128,
    sponsored_paid: u128,
    gas: u128,
    relayer_gas: u128,
    tides: u128,
    sold: u128,
    bounty: u128,
    reclaimed: u128,
    stranded: u128,
    credit_won: u128,
    live_gens: u64,
    unpaid_gens: u64,
    plants: u32,
    sieges: u32,
    // Locker: the block spots (lattice first, then renewal spots) and how far it has got.
    spots: Vec<(i32, i32)>,
    lattice_len: usize,
    spots_done: usize,
}

impl Acct {
    fn kind(&self) -> Kind {
        self.kind.unwrap()
    }
    fn role(&self) -> Role {
        self.role.unwrap()
    }
}

#[derive(Clone, Default)]
struct Keeper {
    gas: u128,
    calls: u64,
    bounty: u128,
    pot: u128,
}

/// The dish at a tide.
#[derive(Clone)]
struct TideRow {
    gen: u64,
    wall: u64,
    live: u32,
    counted: u32,
    agar: u128,
    vault: u128,
    credit_pool: u128,
    price: u128,
    /// Share of the dish where a newcomer can plant one cell / a 2x2 block without siege.
    free: f64,
    block_free: f64,
    newcomer_petri: Option<u128>,
    newcomer_near: Option<u128>,
    siege_near: u128,
    near_in: u128,
    storage_total: u128,
    tide_gas: f64,
    credit_winners: usize,
}

#[derive(Clone)]
struct DayRow {
    day: u64,
    gen: u64,
    skipped: u64,
    live: u32,
    agar: u128,
    vault: u128,
    credit_pool: u128,
    keeper_calls: u64,
    keeper_gas: u128,
    house_paid: u128,
    contract_storage: i128,
}

/// One player's totals (summed over its colonies).
#[derive(Clone)]
struct GroupOut {
    kind: Kind,
    accounts: usize,
    attached: u128,
    sponsored: u128,
    gas: u128,
    relayer_gas: u128,
    tides: u128,
    sold: u128,
    bounty: u128,
    reclaimed: u128,
    stranded: u128,
    /// PETRI held (claimed or not) valued at the sell-back floor, min(curve x sell_bps, share of the vault).
    held: u128,
    held_stranded: u128,
    credit_left: u128,
    credit_won: u128,
    earned: u128,
    spent: u128,
    live: u32,
    live_gens: u64,
    unpaid_gens: u64,
}

impl GroupOut {
    fn withdrawn(&self) -> f64 {
        nf(self.tides + self.sold + self.bounty + self.reclaimed)
    }
    fn paid(&self) -> f64 {
        nf(self.attached + self.sponsored + self.gas)
    }
    fn cash(&self) -> f64 {
        self.withdrawn() - self.paid()
    }
    fn paper(&self) -> f64 {
        self.cash() + nf(self.held)
    }
}

#[derive(Clone, Default)]
struct WorldOut {
    live: u32,
    peak: u32,
    agar: u128,
    burned: u128,
    fed: u128,
    vault: u128,
    credit_pool: u128,
    credit_outstanding: u128,
    held_total: u128,
    near_attached: u128,
    near_sponsored: u128,
    vault_in: u128,
    credit_in: u128,
    tides_paid: u128,
    credit_paid: u128,
    bounties: u128,
    sold_total: u128,
    reclaimed_total: u128,
    stranded_total: u128,
    storage_players: u128,
    storage_vault: u128,
    storage_contract: i128,
    keeper: Keeper,
    relayer_near: u128,
    relayer_gas: u128,
    house_paid: u128,
    work_live_avg: f64,
    work_alive_avg: f64,
    work_live_max: u32,
    work_alive_max: usize,
    calls: u64,
    gas_total: f64,
    gas_max_call: f64,
    calls_over_limit: u64,
    tide_gas_max: f64,
    tides_over_limit: u64,
    credit_winners_max: usize,
    partial_catchups: u64,
    plant_fail_behind: u64,
    skips: u64,
    skipped: u64,
    tides: u64,
    gen_end: u64,
    top_tides: f64,
    top_tides_kind: Option<Kind>,
    secs: f64,
}

struct RunOut {
    groups: Vec<GroupOut>,
    world: WorldOut,
    timeline: Vec<TideRow>,
    days: Vec<DayRow>,
}

struct World {
    r: Rules,
    k: u128,
    w: i32,
    h: i32,
    d: Dish,
    rng: Rng,
    accts: Vec<Acct>,
    groups: usize,
    racers: Vec<usize>,
    house: Vec<ColonyId>,
    total: u64,
    keeper_on: bool,
    /// Colonies joined so far: the length of the per-colony arrays.
    n_col: usize,
    stake: Vec<u64>,
    window: Vec<u64>,
    live: Vec<u32>,
    alive: Vec<(ColonyId, u32)>,
    gen: u64,
    skipped: u64,
    t: u64,
    counted: u32,
    total_live: u32,
    agar: u128,
    burned: u128,
    fed: u128,
    vault: u128,
    credit_pool: u128,
    sell_left: u128,
    keeper_pot: u128,
    unbilled_gas: f64,
    unbilled_bounty: u128,
    /// Generations run by catch-ups that no transaction has paid for yet, and the generation of the last one that did.
    unbilled_gens: u64,
    billed_gen: u64,
    near_attached: u128,
    near_sponsored: u128,
    vault_in: u128,
    credit_in: u128,
    tides_paid: u128,
    credit_paid: u128,
    bounties: u128,
    sold_total: u128,
    reclaimed_total: u128,
    storage_players: u128,
    storage_vault: u128,
    storage_contract: i128,
    keeper: Keeper,
    relayer_near: u128,
    tides: u64,
    skips: u64,
    peak_live: u32,
    work_gens: u64,
    work_live: u64,
    work_alive: u64,
    work_live_max: u32,
    work_alive_max: usize,
    calls: u64,
    gas_total: f64,
    gas_max_call: f64,
    calls_over_limit: u64,
    tide_gas_max: f64,
    tides_over_limit: u64,
    credit_winners_max: usize,
    partial_catchups: u64,
    plant_fail_behind: u64,
    timeline: Vec<TideRow>,
    days: Vec<DayRow>,
}

fn nf(y: u128) -> f64 {
    y as f64 / NEAR as f64
}

fn pf(u: u128) -> f64 {
    u as f64 / UNIT as f64
}

/// A pattern's cells at (x, y) on a w x h wrapped dish, turned `rot` quarter turns.
fn shape_cells(w: i32, h: i32, shape: &[(i32, i32)], x: i32, y: i32, rot: u8) -> Vec<u32> {
    shape
        .iter()
        .map(|&(dx, dy)| {
            let (mut a, mut b) = (dx, dy);
            for _ in 0..rot {
                let t = a;
                a = -b;
                b = t;
            }
            (((y + b).rem_euclid(h)) * w + (x + a).rem_euclid(w)) as u32
        })
        .collect()
}

/// Where a newcomer (a colony with no cells) can plant without siege: (share of single cells, share of 2x2 block
/// positions). A cell is open if it is empty and no living cell of a non-house colony is within `b` in both directions.
fn lockout(d: &Dish, b: i32, house: &[ColonyId]) -> (f64, f64) {
    let w = d.width as usize;
    let h = d.height as usize;
    let n = w * h;
    let mut row = vec![false; n];
    for y in 0..h {
        for x in 0..w {
            let c = d.cells[y * w + x];
            if c != EMPTY && !house.contains(&c) {
                for dx in -b..=b {
                    row[y * w + (x as i32 + dx).rem_euclid(w as i32) as usize] = true;
                }
            }
        }
    }
    let mut near = vec![false; n];
    for y in 0..h {
        for x in 0..w {
            if row[y * w + x] {
                for dy in -b..=b {
                    near[(y as i32 + dy).rem_euclid(h as i32) as usize * w + x] = true;
                }
            }
        }
    }
    let open: Vec<bool> = (0..n).map(|i| !near[i] && d.cells[i] == EMPTY).collect();
    let free = open.iter().filter(|&&o| o).count();
    let mut blocks = 0;
    for y in 0..h {
        for x in 0..w {
            let at = |dx: usize, dy: usize| open[((y + dy) % h) * w + (x + dx) % w];
            if at(0, 0) && at(1, 0) && at(0, 1) && at(1, 1) {
                blocks += 1;
            }
        }
    }
    (free as f64 / n as f64, blocks as f64 / n as f64)
}

/// Storage is paid from sponsored credit first, then from attached NEAR; returns what is left of each.
fn split_after_storage(attached: u128, credit: u128, storage: u128) -> (u128, u128) {
    let from_credit = storage.min(credit);
    (attached - (storage - from_credit), credit - from_credit)
}

impl World {
    fn new(r: Rules, society: &Society, seed: u64, house_budget: u128, days: u64, keeper_on: bool) -> Self {
        let mut rng = Rng::new(seed);
        let gpd = r.gens_per_day();
        let total = days * gpd;
        let (w, h) = (r.width as i32, r.height as i32);
        let mut accts: Vec<Acct> = Vec::new();
        let mut group = 0usize;
        let mut relayer_near = 0u128;
        for &(kind, players, per) in society {
            for _ in 0..players {
                let ghome = (rng.range(w as u64) as i32, rng.range(h as u64) as i32);
                let gjoin = match kind {
                    Kind::Locker | Kind::Racer | Kind::House => 0,
                    Kind::Late => 2 * gpd + rng.range(gpd),
                    Kind::Sniper | Kind::Seller => rng.range(240),
                    _ => rng.range(gpd),
                };
                for j in 0..per {
                    let role = match kind {
                        Kind::Guest => Role::Guest,
                        Kind::SybilGuest => {
                            if j == 0 {
                                Role::Wallet
                            } else {
                                Role::Guest
                            }
                        }
                        Kind::SelfSponsor => Role::Sub,
                        _ => Role::Wallet,
                    };
                    let join_at = match kind {
                        Kind::SplitWhale => rng.range(gpd),
                        Kind::SybilGuest | Kind::SelfSponsor => gjoin + 3 * j as u64,
                        _ => gjoin,
                    };
                    let home = match kind {
                        Kind::SybilGuest | Kind::SelfSponsor => (ghome.0 + rng.range(41) as i32 - 20, ghome.1 + rng.range(41) as i32 - 20),
                        _ => (rng.range(w as u64) as i32, rng.range(h as u64) as i32),
                    };
                    let every = match kind {
                        Kind::Methuselah => 240,
                        Kind::House => 50 + rng.range(91),
                        Kind::Whale => 2 + rng.range(5),
                        Kind::SplitWhale => 20 + rng.range(40),
                        _ => 20 + rng.range(100),
                    };
                    let bring = match kind {
                        Kind::Whale => 2 * NEAR,
                        Kind::SplitWhale => (2 * NEAR / per as u128).max(NEAR / 100),
                        Kind::Methuselah => NEAR / 10,
                        Kind::Locker => 3 * NEAR / 2,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        Kind::Guest | Kind::SelfSponsor => NEAR / 50,
                        Kind::SybilGuest => {
                            if j == 0 {
                                NEAR / 20
                            } else {
                                NEAR / 50
                            }
                        }
                        _ => NEAR / 20,
                    };
                    let wallet = match kind {
                        Kind::Whale => 3 * NEAR,
                        Kind::SplitWhale => 3 * NEAR / per as u128,
                        Kind::Methuselah => NEAR / 2,
                        Kind::Locker => 2 * NEAR,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        Kind::House => house_budget,
                        Kind::Guest | Kind::SelfSponsor => 0,
                        Kind::SybilGuest => {
                            if j == 0 {
                                NEAR / 4
                            } else {
                                0
                            }
                        }
                        _ => NEAR / 4,
                    };
                    let name_len = match role {
                        Role::Guest => L_GUEST,
                        Role::Sub => L_SUB,
                        Role::Wallet => {
                            if kind == Kind::House {
                                L_HOUSE
                            } else {
                                L_WALLET
                            }
                        }
                    };
                    let mut a = Acct {
                        kind: Some(kind),
                        role: Some(role),
                        group,
                        home,
                        join_at,
                        every,
                        phase: rng.range(240),
                        name_len,
                        bring,
                        wallet,
                        credit_stop: u64::MAX,
                        ..Default::default()
                    };
                    // Sponsorship: the relayer gives each guest 0.05 NEAR (and 0.003 for its account); a self-sponsor
                    // pays 0.05 NEAR into each of its sub-accounts' credit. The record's storage comes out of it.
                    match role {
                        Role::Guest => {
                            a.credit = NEAR / 20 - credit_record(L_GUEST, L_RELAYER) * BYTE;
                            a.has_record = true;
                            relayer_near += NEAR / 20 + 3 * NEAR / 1_000;
                        }
                        Role::Sub => {
                            a.credit = NEAR / 20 - credit_record(L_SUB, L_WALLET) * BYTE;
                            a.has_record = true;
                            a.reclaimable = true;
                            a.sponsored_paid = NEAR / 20;
                            // Runs shorter than two days never reach the reclaim, so the sub-accounts just play.
                            if total > 2 * RECLAIM_AFTER {
                                a.credit_stop = total - RECLAIM_AFTER - 60;
                            }
                        }
                        Role::Wallet => {}
                    }
                    a.credit_at = join_at;
                    if kind == Kind::Locker {
                        let (ox, oy) = (rng.range(8) as i32, rng.range(8) as i32);
                        for (ax, ay) in [(0, 0), (4, 4), (4, 0), (0, 4)] {
                            for jy in 0..h / 8 {
                                for ix in 0..w / 8 {
                                    a.spots.push((ox + ax + 8 * ix, oy + ay + 8 * jy));
                                }
                            }
                        }
                        a.lattice_len = ((w / 8) * (h / 8)) as usize;
                    }
                    accts.push(a);
                }
                group += 1;
            }
        }
        // Colony ids follow join order, as in the contract.
        accts.sort_by_key(|a| a.join_at);
        for (i, a) in accts.iter_mut().enumerate() {
            a.id = i as ColonyId + 1;
        }
        let house = accts.iter().filter(|a| a.kind() == Kind::House).map(|a| a.id).collect();
        let racers = accts.iter().enumerate().filter(|(_, a)| a.kind() == Kind::Racer).map(|(i, _)| i).collect();
        let n = accts.len();
        let k = r.k();
        let d = Dish::new(r.width, r.height);
        World {
            agar: r.max_supply,
            k,
            w,
            h,
            d,
            rng,
            accts,
            groups: group,
            racers,
            house,
            total,
            keeper_on,
            n_col: 0,
            stake: vec![0; n + 1],
            window: vec![0; n + 1],
            live: vec![0; n + 1],
            alive: Vec::new(),
            gen: 0,
            skipped: 0,
            t: 0,
            counted: 0,
            total_live: 0,
            burned: 0,
            fed: 0,
            vault: 0,
            credit_pool: 0,
            sell_left: 0,
            keeper_pot: 0,
            unbilled_gas: 0.0,
            unbilled_bounty: 0,
            unbilled_gens: 0,
            billed_gen: 0,
            near_attached: 0,
            near_sponsored: 0,
            vault_in: 0,
            credit_in: 0,
            tides_paid: 0,
            credit_paid: 0,
            bounties: 0,
            sold_total: 0,
            reclaimed_total: 0,
            storage_players: 0,
            storage_vault: 0,
            storage_contract: 0,
            keeper: Keeper::default(),
            relayer_near,
            tides: 0,
            skips: 0,
            peak_live: 0,
            work_gens: 0,
            work_live: 0,
            work_alive: 0,
            work_live_max: 0,
            work_alive_max: 0,
            calls: 0,
            gas_total: 0.0,
            gas_max_call: 0.0,
            calls_over_limit: 0,
            tide_gas_max: 0.0,
            tides_over_limit: 0,
            credit_winners_max: 0,
            partial_catchups: 0,
            plant_fail_behind: 0,
            timeline: Vec::new(),
            days: Vec::new(),
            r,
        }
    }

    // ---------- gas ----------

    fn arr_rw(&self, bytes_per_colony: f64) -> f64 {
        let b = bytes_per_colony * self.n_col as f64;
        2.0 * G_SOP + b * (G_RB + G_WB)
    }

    fn board_bytes(&self) -> u128 {
        let words = (self.r.width as u128 + 63) / 64;
        8 * words * self.r.height as u128 + 2 * self.total_live as u128
    }

    fn board_rw(&self) -> f64 {
        2.0 * G_SOP + self.board_bytes() as f64 * (G_RB + G_WB)
    }

    fn catchup_fixed(&self) -> f64 {
        self.board_rw() + self.arr_rw(24.0) + 4.0 * G_SOP
    }

    fn gen_gas(&self, live: u32, alive: usize, chain: bool) -> f64 {
        let l = live as f64;
        let mut g = (20_000.0 + 60.0 * l + 50.0 * alive as f64) * G_OP;
        if chain {
            g += 4.5 + 6.0 * l * G_SHA_BYTE + 20.0 * l * G_OP;
        }
        g
    }

    fn tide_gas(&self, credit_winners: usize) -> f64 {
        let per_winner = if self.r.packed_credit { 0.0 } else { G_CREDIT_WINNER };
        let packed = if self.r.packed_credit { self.arr_rw(16.0) } else { 0.0 };
        self.arr_rw(16.0) + packed + 60.0 * self.n_col as f64 * G_OP + 6.0 * G_SOP + credit_winners as f64 * per_winner
    }

    /// Bill a transaction: its own work plus any catch-up its view triggered (and any bounty that catch-up earned).
    fn bill(&mut self, p: Payer, base: f64) {
        let bounty = std::mem::take(&mut self.unbilled_bounty);
        // The generations since the last paid transaction are this one's catch-up: one fixed load/store plus each step.
        let fixed = if self.unbilled_gens > 0 { self.catchup_fixed() } else { 0.0 };
        let g = base + fixed + std::mem::take(&mut self.unbilled_gas) + if bounty > 0 { G_PAYOUT } else { 0.0 };
        self.unbilled_gens = 0;
        self.billed_gen = self.gen;
        self.calls += 1;
        self.gas_total += g;
        if g > self.gas_max_call {
            self.gas_max_call = g;
        }
        if g > G_TX_MAX {
            self.calls_over_limit += 1;
        }
        let y = (g * YOCTO_PER_GGAS) as u128;
        self.bounties += bounty;
        match p {
            Payer::Acct(i) => {
                let gp = self.r.guest_payout;
                let a = &mut self.accts[i];
                if a.role() == Role::Guest {
                    a.relayer_gas += y;
                    if gp {
                        a.bounty += bounty;
                    } else {
                        a.stranded += bounty;
                    }
                } else {
                    a.gas += y;
                    a.bounty += bounty;
                    a.wallet += bounty;
                }
            }
            Payer::Keeper => {
                self.keeper.gas += y;
                self.keeper.calls += 1;
                self.keeper.bounty += bounty;
            }
        }
    }

    // ---------- the contract ----------

    fn due(&self) -> u64 {
        self.t - self.skipped
    }

    fn per_cell(&self) -> u128 {
        feed_per_cell(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.counted, self.r.live_floor)
    }

    fn cost(&self, cells: u32, siege: bool) -> u128 {
        planting_cost(self.per_cell(), self.r.payback, self.r.min_cell_price, cells, siege, self.r.siege_x)
    }

    fn plant_deposit(&self, cells: u32, note: bool) -> u128 {
        if self.r.ledger_events {
            return (20 + 2 * cells as u128 + if note { NOTE_LEN + 64 } else { 0 }) * BYTE + self.r.cell_fee * cells as u128;
        }
        (PLANT_STORAGE_BASE + 4 * cells as u128 + if note { NOTE_LEN + 64 } else { 0 }) * BYTE + self.r.cell_fee * cells as u128
    }

    fn plant_stored(&self, cells: u128, first: bool, note: bool) -> u128 {
        if self.r.ledger_events {
            2 * cells + if first { 8 } else { 0 } + if note { 49 + NOTE_LEN } else { 0 }
        } else {
            plant_stored(cells, first, note)
        }
    }

    fn entry_bytes(&self, bytes: u128) -> u128 {
        if self.r.ledger_events {
            0
        } else {
            bytes
        }
    }

    fn outstanding(&self) -> u128 {
        (self.r.max_supply - self.burned) - self.agar
    }

    fn sell_quote(&self, units: u128) -> u128 {
        sell_back(units, self.agar, self.k, self.r.sell_bps, self.vault, self.outstanding())
    }

    /// `catch_up(max_catchup)`: skip ahead if dormant, then step up to `max_catchup` due generations, stopping after
    /// the generation that crosses the gas limit. The gas is billed to the next transaction. Returns generations run.
    fn catch_up(&mut self) -> u64 {
        let mut due = self.due();
        if due > self.gen + self.r.max_lag {
            let skip = due - self.gen - self.r.max_catchup;
            self.skipped += skip;
            self.skips += 1;
            self.storage_contract += (SKIP_BYTES * BYTE) as i128;
            due = self.due();
        }
        if self.gen >= due {
            return 0;
        }
        let target = due.min(self.gen + self.r.max_catchup);
        let from = self.gen;
        let board_before = self.board_bytes();
        let mut g = 0.0;
        while self.gen < target {
            let (gg, tide) = self.gen_step();
            if tide {
                let whole = G_CALL + self.catchup_fixed() + gg;
                if whole > self.tide_gas_max {
                    self.tide_gas_max = whole;
                }
                if whole > G_TX_MAX {
                    self.tides_over_limit += 1;
                }
            }
            g += gg;
            if self.unbilled_gas + g + self.catchup_fixed() > G_CATCHUP_LIMIT && self.gen < target {
                self.partial_catchups += 1;
                break;
            }
        }
        // Board growth or shrinkage during a catch-up is the contract's own storage.
        self.storage_contract += (self.board_bytes() as i128 - board_before as i128) * BYTE as i128;
        self.unbilled_gas += g;
        self.unbilled_gens += self.gen - from;
        self.gen - from
    }

    /// One generation: Life, the capped feed (never the house) into unclaimed earnings, the window and the keeper pot,
    /// and the tide when due. Returns (gas, whether a tide ran).
    fn gen_step(&mut self) -> (f64, bool) {
        let (live, total) = self.d.step_sparse();
        self.gen += 1;
        for &(c, _) in &self.alive {
            self.live[c as usize] = 0;
        }
        for &(c, n) in &live {
            self.live[c as usize] = n;
            let a = &mut self.accts[c as usize - 1];
            a.live_gens += n as u64;
            if !self.house.contains(&c) {
                let cap = (self.stake[c as usize] as u128 * self.r.reach as u128 / STAKE_UNIT as u128) as u64;
                a.unpaid_gens += (n as u64).saturating_sub(cap);
            }
        }
        self.total_live = total;
        self.peak_live = self.peak_live.max(total);
        let f = feed_sparse(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.r.reach, self.r.live_floor, &live, &self.stake, &self.house);
        self.counted = f.weight;
        if f.paid > 0 {
            for &(c, s) in &f.shares {
                let a = &mut self.accts[c as usize - 1];
                a.unclaimed += s;
                a.earned += s;
                self.window[c as usize] += s as u64;
            }
            self.agar -= f.paid;
            self.keeper_pot += f.keeper;
            self.fed += f.paid;
        }
        let chain = self.gen % 16 == 0;
        let mut g = self.gen_gas(total, live.len(), chain);
        self.work_gens += 1;
        self.work_live += total as u64;
        self.work_alive += live.len() as u64;
        self.work_live_max = self.work_live_max.max(total);
        self.work_alive_max = self.work_alive_max.max(live.len());
        self.alive = live;
        let mut tide = false;
        if self.gen % self.r.tide_every == 0 {
            g += self.tide();
            for s in self.stake.iter_mut() {
                *s = decay_stake(*s, self.r.stake_keep_bps);
            }
            tide = true;
        }
        (g, tide)
    }

    /// One tide, as `Petri::tide`. Returns its gas.
    fn tide(&mut self) -> f64 {
        let quiet = self.r.quiet_tides && self.window.iter().enumerate().skip(1).all(|(c, &w)| w == 0 || self.house.contains(&(c as ColonyId)));
        // With the ledger as events a tide still stores its history checkpoint (~120 B).
        let storage_cost = if quiet { 0 } else if self.r.ledger_events { 120 * BYTE } else { TIDE_BYTES * BYTE };
        let pay = self.vault * self.r.tide_bps as u128 / 10_000;
        let bounty = (pay * self.r.tide_bounty_bps as u128 / 10_000).min(self.r.max_bounty);
        let storage = storage_cost.min(pay - bounty);
        let (split, paid) = tide_split(pay - bounty - storage, &self.window, &self.house);
        for &(c, s) in &split {
            self.accts[c as usize - 1].owed_near += s;
        }
        let bounty = if paid > 0 { bounty } else { 0 };
        let storage = if paid > 0 { storage } else { storage_cost.min(self.vault) };
        self.storage_vault += storage;
        self.storage_contract += (storage_cost - storage) as i128;
        self.vault -= paid + bounty + storage;
        self.tides_paid += paid;
        self.unbilled_bounty += bounty;
        let credit_pay = self.credit_pool * self.r.tide_bps as u128 / 10_000;
        let (csplit, cpaid) = tide_split(credit_pay, &self.window, &self.house);
        for &(c, s) in &csplit {
            let a = &mut self.accts[c as usize - 1];
            a.credit += s;
            a.credit_won += s;
            if !a.has_record {
                a.has_record = true;
                a.credit_at = self.t;
                // A new Credit record (sponsor = the contract) is written inside the tide and paid by no one.
                self.storage_contract += (credit_record(a.name_len, L_CONTRACT) * BYTE) as i128;
            }
        }
        self.credit_pool -= cpaid;
        self.credit_paid += cpaid;
        self.tides += 1;
        self.window.iter_mut().for_each(|w| *w = 0);
        self.sell_left = self.vault * self.r.sell_cap_bps as u128 / 10_000;
        self.credit_winners_max = self.credit_winners_max.max(csplit.len());
        let gas = self.tide_gas(csplit.len());
        // What a newcomer faces now.
        let (free, block_free) = lockout(&self.d, self.r.buffer as i32, &self.house);
        let newcomer_petri = if block_free > 0.0 {
            Some(self.cost(4, false))
        } else if self.r.siege_allowed {
            Some(self.cost(4, true))
        } else {
            None
        };
        let deposit = self.plant_deposit(4, false);
        let newcomer_near = newcomer_petri.map(|p| p * self.k / self.agar + deposit);
        let siege_near = self.cost(4, true) * self.k / self.agar + deposit;
        self.timeline.push(TideRow {
            gen: self.gen,
            wall: self.t,
            live: self.total_live,
            counted: self.counted,
            agar: self.agar,
            vault: self.vault,
            credit_pool: self.credit_pool,
            price: self.k * UNIT / self.agar,
            free,
            block_free,
            newcomer_petri,
            newcomer_near,
            siege_near,
            near_in: self.near_attached + self.near_sponsored,
            storage_total: self.storage_players + self.storage_vault + self.storage_contract.max(0) as u128,
            tide_gas: gas,
            credit_winners: csplit.len(),
        });
        gas
    }

    /// What the caller brings: credit first (unless it stopped spending credit), the rest attached. None if it cannot.
    fn fund(&self, i: usize, need: u128) -> Option<(u128, u128)> {
        let a = &self.accts[i];
        let c = if self.t < a.credit_stop { a.credit.min(need) } else { 0 };
        let att = need - c;
        if att > 0 && (a.role() == Role::Guest || att > a.wallet) {
            return None;
        }
        Some((att, c))
    }

    fn take(&mut self, i: usize, att: u128, cred: u128) {
        let t = self.t;
        let a = &mut self.accts[i];
        a.wallet -= att;
        a.attached += att;
        self.near_attached += att;
        if cred > 0 {
            a.credit -= cred;
            a.credit_at = t;
        }
    }

    fn join(&mut self, i: usize) {
        let deposit = self.accts[i].bring.max(self.r.min_join);
        let Some((att, cred)) = self.fund(i, deposit) else { return };
        self.catch_up();
        let gas = G_CALL + 12.0 * G_SOP + self.arr_rw(40.0);
        self.n_col += 1;
        let entries = if self.r.ledger_events { 56 + BUY_BYTES } else { 0 };
        let storage = (join_bytes(self.accts[i].name_len) - entries + if self.accts[i].kind() == Kind::House { 2 } else { 0 }) * BYTE;
        if deposit <= storage {
            return;
        }
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        let units = petri_for_near(near + cr, self.agar, self.k);
        self.agar -= units;
        self.vault += near;
        self.vault_in += near;
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        self.accts[i].balance += units;
        self.accts[i].joined = true;
        self.bill(Payer::Acct(i), gas);
    }

    fn buy(&mut self, i: usize, amount: u128) -> bool {
        let Some((att, cred)) = self.fund(i, amount) else { return false };
        self.catch_up();
        let storage = self.entry_bytes(BUY_BYTES) * BYTE;
        if amount <= storage {
            return false;
        }
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        let units = petri_for_near(near + cr, self.agar, self.k);
        self.agar -= units;
        self.vault += near;
        self.vault_in += near;
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        self.accts[i].balance += units;
        self.bill(Payer::Acct(i), G_CALL + 8.0 * G_SOP);
        true
    }

    /// Move earnings into the balance (inside `plant` or `claim`); returns the gas of the array rewrite.
    fn claim_petri(&mut self, i: usize) -> f64 {
        let a = &mut self.accts[i];
        if a.unclaimed == 0 {
            return 0.0;
        }
        a.balance += std::mem::take(&mut a.unclaimed);
        self.arr_rw(8.0) + 2.0 * G_SOP
    }

    /// NEAR paid to account `i`: to its wallet, or stranded in a guest account whose key cannot move NEAR.
    fn receive(&mut self, i: usize, near: u128, sale: bool) {
        let gp = self.r.guest_payout;
        let a = &mut self.accts[i];
        if a.role() == Role::Guest && !gp {
            a.stranded += near;
        } else {
            if sale {
                a.sold += near;
            } else {
                a.tides += near;
            }
            a.wallet += near;
        }
    }

    fn claim(&mut self, i: usize) {
        self.catch_up();
        let mut g = G_CALL + 6.0 * G_SOP + self.claim_petri(i);
        let near = std::mem::take(&mut self.accts[i].owed_near);
        if near > 0 {
            g += self.arr_rw(16.0) + G_PAYOUT;
            self.receive(i, near, false);
        }
        self.bill(Payer::Acct(i), g);
    }

    /// `plant` of cells chosen on the current (caught-up) board.
    fn plant(&mut self, i: usize, cells: Vec<u32>, siege: bool, note: bool) -> bool {
        let n = cells.len() as u32;
        let deposit = self.plant_deposit(n, note);
        let Some((att, cred)) = self.fund(i, deposit) else { return false };
        self.catch_up();
        if self.gen != self.due() {
            // "the dish is behind the clock; call advance first"
            self.plant_fail_behind += 1;
            self.bill(Payer::Acct(i), G_CALL + 4.0 * G_SOP);
            return false;
        }
        let mut g = G_CALL + 14.0 * G_SOP + self.board_rw() + self.arr_rw(8.0) + 1_000.0 * n as f64 * G_OP;
        g += self.claim_petri(i);
        let cost = self.cost(n, siege);
        if self.accts[i].balance < cost {
            self.bill(Payer::Acct(i), g);
            return false;
        }
        let burn = cost * self.r.burn_bps as u128 / 10_000;
        self.burned += burn;
        self.agar += cost - burn;
        let id = self.accts[i].id;
        self.d.plant_unchecked(id, &cells);
        self.total_live += n;
        self.stake[id as usize] += n as u64 * STAKE_UNIT;
        let first = !self.accts[i].planted_once;
        let storage = self.plant_stored(n as u128, first, note) * BYTE;
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        self.vault += near;
        self.vault_in += near;
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        let a = &mut self.accts[i];
        a.balance -= cost;
        a.spent += cost;
        a.planted_once = true;
        a.plants += 1;
        if siege {
            a.sieges += 1;
        }
        self.bill(Payer::Acct(i), g);
        true
    }

    /// `sell`: the agar buys back at most what the allowance has left; the record comes out of the proceeds.
    fn sell(&mut self, i: usize, want: u128) {
        let storage = self.entry_bytes(SELL_BYTES) * BYTE;
        if self.sell_left <= 2 * storage {
            return;
        }
        self.catch_up();
        if self.accts[i].unclaimed > 0 {
            self.claim(i);
        }
        let mut units = want.min(self.accts[i].balance);
        if units == 0 {
            return;
        }
        if self.sell_quote(units) > self.sell_left {
            let (mut lo, mut hi) = (0u128, units);
            while lo < hi {
                let mid = lo + (hi - lo + 1) / 2;
                if self.sell_quote(mid) <= self.sell_left {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            units = lo;
        }
        let near = self.sell_quote(units);
        if units == 0 || near <= 2 * storage.max(BYTE * 50) {
            return;
        }
        self.accts[i].balance -= units;
        self.agar += units;
        self.vault -= near;
        self.sell_left -= near;
        self.storage_players += storage;
        let paid = near - storage;
        self.sold_total += paid;
        self.receive(i, paid, true);
        self.bill(Payer::Acct(i), G_CALL + 8.0 * G_SOP + G_PAYOUT);
    }

    fn advance(&mut self, p: Payer) {
        self.catch_up();
        let ran = self.gen - self.billed_gen;
        let mut g = G_CALL + 3.0 * G_SOP;
        let registered = match p {
            Payer::Acct(_) => true,
            Payer::Keeper => self.r.keeper_registered,
        };
        if ran > 0 && self.keeper_pot > 0 && registered {
            let pot = std::mem::take(&mut self.keeper_pot);
            g += 2.0 * G_SOP;
            match p {
                Payer::Acct(i) => {
                    self.accts[i].balance += pot;
                    self.accts[i].pot += pot;
                }
                Payer::Keeper => self.keeper.pot += pot,
            }
        }
        self.bill(p, g);
    }

    // ---------- the players ----------

    /// Up to `tries` candidate plantings; the first that needs no siege, else the first legal siege.
    fn try_place(&mut self, me: ColonyId, tries: usize, mut gen: impl FnMut(&mut Rng) -> Vec<u32>) -> (Option<Vec<u32>>, Option<Vec<u32>>) {
        let mut sieged = None;
        for _ in 0..tries {
            let cells = gen(&mut self.rng);
            match self.d.check_plant(me, &cells, self.r.buffer, self.r.max_plant_cells, &self.house) {
                Ok(c) if !c.siege => return (Some(cells), None),
                Ok(_) => {
                    if sieged.is_none() {
                        sieged = Some(cells);
                    }
                }
                Err(_) => {}
            }
        }
        (None, sieged)
    }

    /// Plant `shape` within `radius` of `center`: outside every rival's buffer if it can, else as a siege if allowed
    /// and affordable. `frac` is the most of its PETRI (in tenths) it spends on one planting.
    fn plant_near(&mut self, i: usize, shape: &'static [(i32, i32)], center: (i32, i32), radius: i32, frac: u128, may_siege: bool, note: bool) -> bool {
        let n = shape.len() as u32;
        let (base, siege) = (self.cost(n, false), self.cost(n, true));
        let a = &self.accts[i];
        let limit = (a.balance + a.unclaimed) * frac / 10;
        if base > limit || self.fund(i, self.plant_deposit(n, note)).is_none() {
            return false;
        }
        let me = a.id;
        let span = 2 * radius as u64 + 1;
        let (w, h) = (self.w, self.h);
        let (free, sieged) = self.try_place(me, 30, |rng| {
            let x = center.0 + rng.range(span) as i32 - radius;
            let y = center.1 + rng.range(span) as i32 - radius;
            shape_cells(w, h, shape, x, y, rng.range(4) as u8)
        });
        if let Some(c) = free {
            return self.plant(i, c, false, note);
        }
        if may_siege && self.r.siege_allowed && siege <= limit {
            if let Some(c) = sieged {
                return self.plant(i, c, true, note);
            }
        }
        false
    }

    /// A random living cell of another non-house colony.
    fn rival_cell(&mut self, me: ColonyId) -> Option<(i32, i32)> {
        let n = self.d.cells.len() as u64;
        for _ in 0..64 {
            let i = self.rng.range(n) as usize;
            let c = self.d.cells[i];
            if c != EMPTY && c != me && !self.house.contains(&c) {
                return Some(((i % self.w as usize) as i32, (i / self.w as usize) as i32));
            }
        }
        None
    }

    fn raid(&mut self, i: usize) {
        let me = self.accts[i].id;
        let home = self.accts[i].home;
        let target = self.rival_cell(me).unwrap_or(home);
        let (w, h) = (self.w, self.h);
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        if self.r.siege_allowed && self.rng.range(3) == 0 {
            let cost = self.cost(3, true);
            if cost > bal / 2 || self.fund(i, self.plant_deposit(3, false)).is_none() {
                return;
            }
            let (free, sieged) = self.try_place(me, 20, |rng| shape_cells(w, h, patterns::BLINKER, target.0 + rng.range(5) as i32 - 2, target.1 + rng.range(5) as i32 - 2, rng.range(2) as u8));
            if let Some(c) = sieged {
                self.plant(i, c, true, false);
            } else if let Some(c) = free {
                self.plant(i, c, false, false);
            }
            return;
        }
        let shape = if self.rng.range(4) == 0 { patterns::LWSS } else { patterns::GLIDER };
        let n = shape.len() as u32;
        let (base, siege) = (self.cost(n, false), self.cost(n, true));
        if base > bal / 2 || self.fund(i, self.plant_deposit(n, false)).is_none() {
            return;
        }
        let (free, sieged) = self.try_place(me, 20, |rng| {
            let rot = rng.range(4) as u8;
            let dir = [(1, 1), (-1, 1), (-1, -1), (1, -1)][rot as usize];
            let dist = 6 + rng.range(10) as i32;
            let jx = rng.range(5) as i32 - 2;
            let jy = rng.range(5) as i32 - 2;
            shape_cells(w, h, shape, target.0 - dir.0 * dist + jx, target.1 - dir.1 * dist + jy, rot)
        });
        if let Some(c) = free {
            self.plant(i, c, false, false);
        } else if self.r.siege_allowed && siege <= bal / 2 {
            if let Some(c) = sieged {
                self.plant(i, c, true, false);
            }
        }
    }

    /// The carpet locker: 16 lattice blocks per planting until the lattice is down; then every 20 generations it
    /// repairs broken blocks (their missing cells) and, when its pay cap falls below its living cells, plants renewal
    /// blocks between the lattice blocks so its stake keeps up with the decay.
    fn locker(&mut self, i: usize) {
        let first_pass = self.accts[i].spots_done < self.accts[i].lattice_len;
        if !first_pass && (self.t + self.accts[i].phase) % 20 != 0 {
            return;
        }
        if !self.may_act(i) {
            return;
        }
        self.catch_up();
        let me = self.accts[i].id;
        let per_cell = self.cost(1, false).max(1);
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        let mut max_cells = ((bal / per_cell) as u32).min(self.r.max_plant_cells);
        while max_cells > 0 && self.fund(i, self.plant_deposit(max_cells, false)).is_none() {
            max_cells -= 4;
            if max_cells < 4 {
                max_cells = 0;
            }
        }
        if max_cells < 4 {
            return;
        }
        let (w, h) = (self.w, self.h);
        let mut cells: Vec<u32> = Vec::new();
        let ok = |d: &Dish, house: &[ColonyId], b: &[u32], buffer: u16, max: u32| matches!(d.check_plant(me, b, buffer, max, house), Ok(c) if !c.siege);
        if first_pass {
            let start = self.accts[i].spots_done;
            let lat = self.accts[i].lattice_len;
            let mut p = start;
            while p < lat && cells.len() + 4 <= max_cells as usize {
                let (x, y) = self.accts[i].spots[p];
                let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                if ok(&self.d, &self.house, &b, self.r.buffer, self.r.max_plant_cells) {
                    cells.extend(b);
                }
                p += 1;
            }
            self.accts[i].spots_done = p;
        } else {
            // Repairs: the missing cells of lattice blocks that still have some of ours, or whole blocks that vanished.
            for p in 0..self.accts[i].lattice_len.min(self.accts[i].spots.len()) {
                if cells.len() + 4 > max_cells as usize {
                    break;
                }
                let (x, y) = self.accts[i].spots[p];
                let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                let missing: Vec<u32> = b.iter().copied().filter(|&c| self.d.cells[c as usize] == EMPTY).collect();
                if missing.is_empty() || missing.len() < 4 && b.iter().any(|&c| self.d.cells[c as usize] != EMPTY && self.d.cells[c as usize] != me) {
                    continue;
                }
                if ok(&self.d, &self.house, &missing, self.r.buffer, self.r.max_plant_cells) {
                    cells.extend(missing);
                }
            }
            // Renewal: plant fresh blocks when the cap (stake x reach) no longer covers the living cells.
            let cap = self.stake[me as usize] as u128 * self.r.reach as u128 / STAKE_UNIT as u128;
            if (cap as u64) < self.live[me as usize] as u64 * 11 / 10 {
                let mut p = self.accts[i].spots_done.max(self.accts[i].lattice_len);
                while p < self.accts[i].spots.len() && cells.len() + 4 <= max_cells as usize {
                    let (x, y) = self.accts[i].spots[p];
                    let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                    if ok(&self.d, &self.house, &b, self.r.buffer, self.r.max_plant_cells) {
                        cells.extend(b);
                    }
                    p += 1;
                    if cells.len() >= 16 {
                        break;
                    }
                }
                self.accts[i].spots_done = p;
            }
        }
        cells.sort_unstable();
        cells.dedup();
        cells.truncate(self.r.max_plant_cells as usize);
        if cells.is_empty() {
            return;
        }
        let n = cells.len() as u32;
        if self.cost(n, false) > bal {
            return;
        }
        if ok(&self.d, &self.house, &cells, self.r.buffer, self.r.max_plant_cells) {
            self.plant(i, cells, false, false);
        }
    }

    /// The racer: advances just before the team keeper would, and as soon as a tide is due, when the keeper pot (at
    /// the sell-back price) plus the capped bounty beat the gas.
    fn racer(&mut self, i: usize) {
        if !self.accts[i].joined {
            return;
        }
        let due = self.due();
        if due <= self.billed_gen {
            return;
        }
        let behind = due - self.billed_gen;
        let te = self.r.tide_every;
        let next_tide = (self.gen / te + 1) * te;
        let tide_pending = next_tide <= due.min(self.gen + self.r.max_catchup) || self.unbilled_bounty > 0;
        let bounty = if self.unbilled_bounty > 0 { self.unbilled_bounty } else if tide_pending { (self.vault * self.r.tide_bps as u128 / 10_000 * self.r.tide_bounty_bps as u128 / 10_000).min(self.r.max_bounty) } else { 0 };
        let pot = self.sell_quote(self.keeper_pot);
        let want = tide_pending || behind >= 19 || self.keeper_pot >= 49 * UNIT / 10;
        let gas = G_CALL + 5.0 * G_SOP + self.catchup_fixed() + behind as f64 * self.gen_gas(self.total_live, self.alive.len(), false) + if tide_pending { self.tide_gas(self.n_col) + G_PAYOUT } else { 0.0 };
        if want && (bounty + pot) as f64 > gas * YOCTO_PER_GGAS {
            self.advance(Payer::Acct(i));
        }
    }

    /// Right after a tide the allowance reopens and sellers race for it: bots first (sellers, racers, snipers, sybil
    /// guests), then a random quarter of the others, who sell what they hold above 16 cells' price.
    fn sell_round(&mut self) {
        let mut bots = Vec::new();
        let mut humans = Vec::new();
        for i in 0..self.accts.len() {
            let a = &self.accts[i];
            if !a.joined {
                continue;
            }
            match (a.kind(), a.role()) {
                (Kind::Seller, _) | (Kind::Racer, _) | (Kind::Sniper, _) | (Kind::SybilGuest, Role::Guest) => bots.push(i),
                (Kind::House, _) => {}
                _ => {
                    if self.rng.range(4) == 0 {
                        humans.push(i);
                    }
                }
            }
        }
        self.rng.shuffle(&mut bots);
        self.rng.shuffle(&mut humans);
        for i in bots.into_iter().chain(humans) {
            if self.sell_left <= 2 * SELL_BYTES * BYTE {
                break;
            }
            let reserve = match self.accts[i].kind() {
                Kind::Seller | Kind::Racer | Kind::SybilGuest => 0,
                _ => self.cost(16, false),
            };
            let bal = self.accts[i].balance + self.accts[i].unclaimed;
            if bal > reserve {
                self.sell(i, bal - reserve);
            }
        }
    }

    fn top_up(&mut self, i: usize) {
        let a = &self.accts[i];
        let t = self.t;
        let bal = a.balance + a.unclaimed;
        match (a.kind(), a.role()) {
            (Kind::House, _) => {
                if bal < 3 * self.cost(4, false) && a.wallet >= NEAR / 50 {
                    self.buy(i, NEAR / 50);
                }
            }
            (Kind::Builder | Kind::Late | Kind::Raider | Kind::Defender, _) | (Kind::SybilGuest, Role::Wallet) => {
                if a.top_ups < 2 && a.wallet >= NEAR / 50 && t >= a.join_at + self.r.gens_per_day() && bal < 2 * self.cost(6, false) {
                    self.accts[i].top_ups += 1;
                    self.buy(i, NEAR / 50);
                }
            }
            (Kind::Guest | Kind::SelfSponsor, _) => {
                if a.top_ups < 1 && a.credit >= NEAR / 50 && t >= a.join_at + self.r.gens_per_day() && bal < 2 * self.cost(6, false) {
                    self.accts[i].top_ups += 1;
                    self.buy(i, NEAR / 100);
                }
            }
            _ => {}
        }
    }

    /// Whether the player could send anything now (a small planting or a top-up). A player who cannot does not look.
    fn may_act(&self, i: usize) -> bool {
        let a = &self.accts[i];
        let bal = a.balance + a.unclaimed;
        let note = a.kind() == Kind::House;
        if self.fund(i, self.plant_deposit(3, note)).is_some() && bal >= self.cost(3, false) {
            return true;
        }
        match (a.kind(), a.role()) {
            (Kind::House, _) => a.wallet >= NEAR / 50,
            (Kind::Builder | Kind::Late | Kind::Raider | Kind::Defender, _) | (Kind::SybilGuest, Role::Wallet) => a.top_ups < 2 && a.wallet >= NEAR / 50,
            (Kind::Guest | Kind::SelfSponsor, _) => a.top_ups < 1 && a.credit >= NEAR / 50,
            _ => false,
        }
    }

    fn act(&mut self, i: usize) {
        let t = self.t;
        let (kind, role, home, every, phase, stop) = {
            let a = &self.accts[i];
            (a.kind(), a.role(), a.home, a.every, a.phase, a.credit_stop)
        };
        if role == Role::Sub && t >= stop {
            return;
        }
        match kind {
            Kind::Racer | Kind::Seller => {}
            Kind::Locker => self.locker(i),
            Kind::Sniper => {
                let te = self.r.tide_every;
                if te - (t % te) <= 3 && self.may_act(i) {
                    self.catch_up();
                    self.plant_near(i, patterns::BLOCK, home, 20, 5, true, false);
                }
            }
            _ => {
                if (t + phase) % every != 0 || !self.may_act(i) {
                    return;
                }
                self.catch_up();
                self.top_up(i);
                let pick = self.rng.range(6) as usize;
                match (kind, role) {
                    (Kind::Raider, _) => self.raid(i),
                    (Kind::Defender, _) => {
                        let s = if pick % 2 == 0 { patterns::EATER } else { patterns::BEEHIVE };
                        self.plant_near(i, s, home, 12, 5, true, false);
                    }
                    (Kind::Methuselah, _) => {
                        self.plant_near(i, patterns::R_PENTOMINO, home, 40, 10, true, false);
                    }
                    (Kind::Whale | Kind::SplitWhale, _) => {
                        let s = if pick % 2 == 0 { patterns::PULSAR } else { patterns::BEEHIVE };
                        let center = if kind == Kind::Whale { (self.rng.range(self.w as u64) as i32, self.rng.range(self.h as u64) as i32) } else { home };
                        self.plant_near(i, s, center, 30, 10, true, false);
                    }
                    (Kind::House, _) => {
                        let s = [patterns::BLOCK, patterns::BEEHIVE, patterns::GLIDER, patterns::EATER, patterns::LOAF][((t / every) % 5) as usize];
                        self.plant_near(i, s, home, 20, 6, false, true);
                    }
                    (Kind::SybilGuest, Role::Guest) => {
                        self.plant_near(i, patterns::BLOCK, home, 12, 5, true, false);
                    }
                    _ => {
                        let s = [patterns::BLOCK, patterns::BEEHIVE, patterns::LOAF][pick % 3];
                        self.plant_near(i, s, home, 12, 5, true, false);
                    }
                }
            }
        }
    }

    fn day_row(&mut self) {
        let gpd = self.r.gens_per_day();
        let house_paid = self.accts.iter().filter(|a| a.kind() == Kind::House).map(|a| a.attached + a.gas).sum();
        self.days.push(DayRow {
            day: (self.t + 1) / gpd,
            gen: self.gen,
            skipped: self.skipped,
            live: self.total_live,
            agar: self.agar,
            vault: self.vault,
            credit_pool: self.credit_pool,
            keeper_calls: self.keeper.calls,
            keeper_gas: self.keeper.gas,
            house_paid,
            contract_storage: self.storage_contract,
        });
    }

    fn run(mut self) -> RunOut {
        let t0 = Instant::now();
        let n = self.accts.len();
        let gpd = self.r.gens_per_day();
        let te = self.r.tide_every;
        let mut next_join = 0usize;
        for t in 0..self.total {
            self.t = t;
            while next_join < n && self.accts[next_join].join_at == t {
                self.join(next_join);
                next_join += 1;
            }
            for r in 0..self.racers.len() {
                let i = self.racers[r];
                self.racer(i);
            }
            if t > 1 && t % te == 1 {
                self.sell_round();
            }
            if n > 0 {
                let start = (t as usize).wrapping_mul(7919) % n;
                for j in 0..n {
                    let i = (start + j) % n;
                    if self.accts[i].joined {
                        self.act(i);
                    }
                }
            }
            // Players claim their tide NEAR once a day.
            if t % gpd == gpd / 2 {
                for i in 0..n {
                    if self.accts[i].joined && self.accts[i].owed_near > 0 {
                        self.claim(i);
                    }
                }
            }
            // The team keeper (agents/run.mjs): advance when 20 behind or the pot holds more than 5 PETRI.
            if self.keeper_on {
                let behind = self.due().saturating_sub(self.billed_gen);
                if behind >= 20 || self.keeper_pot > 5 * UNIT {
                    self.advance(Payer::Keeper);
                }
            }
            if t % gpd == gpd - 1 {
                self.day_row();
            }
        }
        // The end: one advance (a visitor if the keeper is off), everyone claims, self-sponsors take credit back.
        self.t = self.total;
        self.advance(Payer::Keeper);
        for i in 0..n {
            if self.accts[i].joined && self.accts[i].owed_near > 0 {
                self.claim(i);
            }
        }
        for i in 0..n {
            let a = &self.accts[i];
            if a.joined && a.reclaimable && a.credit > 0 && self.t >= a.credit_at + RECLAIM_AFTER {
                let c = std::mem::take(&mut self.accts[i].credit);
                self.accts[i].reclaimed += c;
                self.accts[i].reclaimable = false;
                self.reclaimed_total += c;
                self.catch_up();
                self.bill(Payer::Acct(i), G_CALL + 4.0 * G_SOP + G_PAYOUT);
            }
        }
        self.finish(t0.elapsed().as_secs_f64())
    }

    fn finish(self, secs: f64) -> RunOut {
        let storage = SELL_BYTES * BYTE;
        let mut groups: Vec<Option<GroupOut>> = vec![None; self.groups];
        let mut held_total = 0u128;
        let mut house_paid = 0u128;
        let mut relayer_gas = 0u128;
        let mut stranded_total = 0u128;
        let mut credit_outstanding = 0u128;
        for a in self.accts.iter().filter(|a| a.joined) {
            let units = a.balance + a.unclaimed;
            let held = if units > 0 { self.sell_quote(units).saturating_sub(storage) } else { 0 };
            if a.kind() == Kind::House {
                house_paid += a.attached + a.gas;
            } else {
                held_total += held;
            }
            relayer_gas += a.relayer_gas;
            stranded_total += a.stranded;
            credit_outstanding += a.credit;
            let guest_held = a.role() == Role::Guest && !self.r.guest_payout;
            let e = groups[a.group].get_or_insert(GroupOut {
                kind: a.kind(),
                accounts: 0,
                attached: 0,
                sponsored: 0,
                gas: 0,
                relayer_gas: 0,
                tides: 0,
                sold: 0,
                bounty: 0,
                reclaimed: 0,
                stranded: 0,
                held: 0,
                held_stranded: 0,
                credit_left: 0,
                credit_won: 0,
                earned: 0,
                spent: 0,
                live: 0,
                live_gens: 0,
                unpaid_gens: 0,
            });
            e.accounts += 1;
            e.attached += a.attached;
            e.sponsored += a.sponsored_paid;
            e.gas += a.gas;
            e.relayer_gas += a.relayer_gas;
            e.tides += a.tides;
            e.sold += a.sold;
            e.bounty += a.bounty;
            e.reclaimed += a.reclaimed;
            e.stranded += a.stranded;
            if guest_held {
                e.held_stranded += held;
            } else {
                e.held += held;
            }
            e.credit_left += a.credit;
            e.credit_won += a.credit_won;
            e.earned += a.earned;
            e.spent += a.spent;
            e.live += self.live.get(a.id as usize).copied().unwrap_or(0);
            e.live_gens += a.live_gens;
            e.unpaid_gens += a.unpaid_gens;
        }
        let groups: Vec<GroupOut> = groups.into_iter().flatten().collect();
        let top = groups.iter().filter(|g| g.kind != Kind::House).max_by_key(|g| g.tides + g.stranded);
        let all_tides = self.tides_paid.max(1);
        let wg = self.work_gens.max(1) as f64;
        RunOut {
            world: WorldOut {
                live: self.total_live,
                peak: self.peak_live,
                agar: self.agar,
                burned: self.burned,
                fed: self.fed,
                vault: self.vault,
                credit_pool: self.credit_pool,
                credit_outstanding,
                held_total,
                near_attached: self.near_attached,
                near_sponsored: self.near_sponsored + self.accts.iter().filter(|a| a.role() != Role::Wallet && a.join_at < self.total).count() as u128 * NEAR / 20,
                vault_in: self.vault_in,
                credit_in: self.credit_in,
                tides_paid: self.tides_paid,
                credit_paid: self.credit_paid,
                bounties: self.bounties,
                sold_total: self.sold_total,
                reclaimed_total: self.reclaimed_total,
                stranded_total,
                storage_players: self.storage_players
                    + self.accts.iter().filter(|a| a.join_at < self.total).map(|a| match a.role() {
                        Role::Guest => credit_record(L_GUEST, L_RELAYER) * BYTE,
                        Role::Sub => credit_record(L_SUB, L_WALLET) * BYTE,
                        Role::Wallet => 0,
                    }).sum::<u128>(),
                storage_vault: self.storage_vault,
                storage_contract: self.storage_contract,
                keeper: self.keeper.clone(),
                relayer_near: self.relayer_near,
                relayer_gas,
                house_paid,
                work_live_avg: self.work_live as f64 / wg,
                work_alive_avg: self.work_alive as f64 / wg,
                work_live_max: self.work_live_max,
                work_alive_max: self.work_alive_max,
                calls: self.calls,
                gas_total: self.gas_total,
                gas_max_call: self.gas_max_call,
                calls_over_limit: self.calls_over_limit,
                tide_gas_max: self.tide_gas_max,
                tides_over_limit: self.tides_over_limit,
                credit_winners_max: self.credit_winners_max,
                partial_catchups: self.partial_catchups,
                plant_fail_behind: self.plant_fail_behind,
                skips: self.skips,
                skipped: self.skipped,
                tides: self.tides,
                gen_end: self.gen,
                top_tides: top.map(|g| (g.tides + g.stranded) as f64 / all_tides as f64).unwrap_or(0.0),
                top_tides_kind: top.filter(|g| g.tides + g.stranded > 0).map(|g| g.kind),
                secs,
            },
            groups,
            timeline: self.timeline,
            days: self.days,
        }
    }
}

// ---------- societies and scenarios ----------

/// The mixed society at about 15, 150, 1,500 or 15,000 players, plus the five house strains. `locker` false swaps the
/// carpet locker for one more builder (the control for the lockout).
fn society(scale: usize, locker: bool) -> Society {
    use Kind::*;
    let l = if locker { 0 } else { 1 };
    let mut s: Society = match scale {
        15 => vec![(Builder, 2 + l, 1), (Raider, 1, 1), (Defender, 1, 1), (Methuselah, 1, 1), (Late, 1, 1), (Whale, 1, 1), (SplitWhale, 1, 10), (Sniper, 1, 1), (Racer, 1, 1), (Seller, 1, 1), (Guest, 1, 1), (SybilGuest, 1, 11), (SelfSponsor, 1, 10)],
        150 => vec![(Builder, 30 + l, 1), (Raider, 15, 1), (Defender, 12, 1), (Methuselah, 8, 1), (Late, 30, 1), (Whale, 4, 1), (SplitWhale, 2, 10), (Sniper, 4, 1), (Racer, 2, 1), (Seller, 6, 1), (Guest, 30, 1), (SybilGuest, 3, 11), (SelfSponsor, 3, 10)],
        1500 => vec![(Builder, 300 + l, 1), (Raider, 150, 1), (Defender, 120, 1), (Methuselah, 80, 1), (Late, 300, 1), (Whale, 25, 1), (SplitWhale, 5, 20), (Sniper, 30, 1), (Racer, 3, 1), (Seller, 50, 1), (Guest, 400, 1), (SybilGuest, 20, 11), (SelfSponsor, 16, 10)],
        15000 => vec![(Builder, 3000 + l, 1), (Raider, 1500, 1), (Defender, 1200, 1), (Methuselah, 800, 1), (Late, 3000, 1), (Whale, 250, 1), (SplitWhale, 50, 20), (Sniper, 300, 1), (Racer, 10, 1), (Seller, 500, 1), (Guest, 4000, 1), (SybilGuest, 200, 11), (SelfSponsor, 189, 10)],
        _ => vec![],
    };
    if locker && scale > 0 {
        s.push((Locker, 1, 1));
    }
    if scale > 0 {
        s.push((House, 5, 1));
    }
    s
}

fn players(s: &Society) -> usize {
    s.iter().filter(|(k, _, _)| *k != Kind::House).map(|(_, n, _)| n).sum()
}

fn colonies(s: &Society) -> usize {
    s.iter().map(|(_, n, per)| n * per).sum()
}

#[derive(Clone)]
struct Scenario {
    name: String,
    rules: Rules,
    society: Society,
    days: u64,
    seeds: u64,
    stream: u64,
    house_budget: u128,
    keeper_on: bool,
}

fn run_all(scenarios: &[Scenario]) -> Vec<Vec<RunOut>> {
    let mut jobs: Vec<(usize, u64)> = scenarios.iter().enumerate().flat_map(|(si, s)| (0..s.seeds).map(move |k| (si, k))).collect();
    jobs.sort_by_key(|&(si, _)| std::cmp::Reverse(scenarios[si].days * (colonies(&scenarios[si].society) as u64 + 50)));
    let next = AtomicUsize::new(0);
    let results: Mutex<Vec<(usize, u64, RunOut)>> = Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4);
    std::thread::scope(|sc| {
        for _ in 0..threads {
            sc.spawn(|| loop {
                let j = next.fetch_add(1, Ordering::SeqCst);
                if j >= jobs.len() {
                    break;
                }
                let (si, k) = jobs[j];
                let s = &scenarios[si];
                let w = World::new(s.rules.clone(), &s.society, s.stream * 1_000 + k, s.house_budget, s.days, s.keeper_on);
                let out = w.run();
                eprintln!("  done {} seed {} in {:.1}s", s.name, k, out.world.secs);
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

// ---------- statistics and tables ----------

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
            let g: Vec<&GroupOut> = r.groups.iter().filter(|g| g.kind == kind).collect();
            let v: Vec<f64> = g.iter().map(|x| f(x)).filter(|x| !x.is_nan()).collect();
            (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
        })
        .collect()
}

fn feed_share(runs: &[RunOut], kind: Kind) -> Vec<f64> {
    runs.iter()
        .map(|r| {
            let all: u128 = r.groups.iter().map(|g| g.earned).sum();
            let k: u128 = r.groups.iter().filter(|g| g.kind == kind).map(|g| g.earned).sum();
            k as f64 / all.max(1) as f64
        })
        .collect()
}

fn range_cell(v: &[f64], prec: usize) -> String {
    if v.is_empty() {
        return "-".into();
    }
    let (a, b, c) = mmm(v);
    if b.is_nan() {
        return "-".into();
    }
    format!("{:+.p$} ({:+.p$}..{:+.p$})", b, a, c, p = prec)
}

/// Kinds down, scenarios across: median (min..max) over seeds of `f` for each kind's mean player.
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
            let _ = write!(out, " | {:>w$}", range_cell(&per_seed(r, kind, f), prec), w = width);
        }
        let _ = writeln!(out);
    }
}

fn kind_detail(out: &mut String, runs: &[RunOut]) {
    let _ = writeln!(
        out,
        "  {:<11} {:>5} {:>5} | {:>8} {:>7} {:>7} | {:>8} {:>7} {:>7} {:>7} | {:>8} {:>8} | {:>7} {:>7} {:>8} | {:>6} {:>6} {:>6}",
        "kind", "plyrs", "accts", "attached", "spons", "gas", "tides", "sold", "bounty", "reclaim", "cash med", "paperMed", "crWon", "crLeft", "stranded", "e/s", "feed%", "capd%"
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
        let capped = m(&|g| if g.live_gens == 0 { f64::NAN } else { g.unpaid_gens as f64 / g.live_gens as f64 });
        let _ = writeln!(
            out,
            "  {:<11} {:>5} {:>5} | {:>8.4} {:>7.4} {:>7.4} | {:>8.4} {:>7.4} {:>7.4} {:>7.4} | {:>+8.4} {:>+8.4} | {:>7.4} {:>7.4} {:>8.4} | {:>6} {:>5.1}% {:>5.1}%",
            format!("{:?}", kind),
            players,
            accts,
            m(&|g| nf(g.attached)),
            m(&|g| nf(g.sponsored)),
            m(&|g| nf(g.gas)),
            m(&|g| nf(g.tides)),
            m(&|g| nf(g.sold)),
            m(&|g| nf(g.bounty)),
            m(&|g| nf(g.reclaimed)),
            med_of(cash),
            m(&|g| g.paper()),
            m(&|g| nf(g.credit_won)),
            m(&|g| nf(g.credit_left)),
            m(&|g| nf(g.stranded + g.held_stranded)),
            if es.is_nan() { "-".to_string() } else { format!("{:.2}", es) },
            100.0 * med_of(feed_share(runs, kind)),
            if capped.is_nan() { 0.0 } else { 100.0 * capped }
        );
    }
}

fn wmed(runs: &[RunOut], f: &dyn Fn(&WorldOut) -> f64, prec: usize) -> String {
    let v: Vec<f64> = runs.iter().map(|r| f(&r.world)).collect();
    let (a, b, c) = mmm(&v);
    format!("{:.p$} ({:.p$}..{:.p$})", b, a, c, p = prec)
}

fn world_lines(out: &mut String, runs: &[RunOut], days: u64) {
    let w4 = |f: &dyn Fn(&WorldOut) -> f64| wmed(runs, f, 4);
    let w0 = |f: &dyn Fn(&WorldOut) -> f64| wmed(runs, f, 0);
    let _ = writeln!(out, "  dish at the end  : live {}  peak {}  agar {} PETRI  burned {}  fed {}  tides {}", w0(&|x| x.live as f64), w0(&|x| x.peak as f64), w0(&|x| pf(x.agar)), w0(&|x| pf(x.burned)), w0(&|x| pf(x.fed)), w0(&|x| x.tides as f64));
    let _ = writeln!(out, "  NEAR in          : attached {}  sponsored as credit {}  -> vault {}  credit pool {}", w4(&|x| nf(x.near_attached)), w4(&|x| nf(x.near_sponsored)), w4(&|x| nf(x.vault_in)), w4(&|x| nf(x.credit_in)));
    let _ = writeln!(out, "  NEAR out         : tides {}  bounties {}  sell-backs {}  reclaimed credit {}  (of which stranded in guest accounts {})", w4(&|x| nf(x.tides_paid)), w4(&|x| nf(x.bounties)), w4(&|x| nf(x.sold_total)), w4(&|x| nf(x.reclaimed_total)), w4(&|x| nf(x.stranded_total)));
    let _ = writeln!(out, "  left             : vault {}  credit pool {}  credit outstanding {}  credit paid at tides {}", w4(&|x| nf(x.vault)), w4(&|x| nf(x.credit_pool)), w4(&|x| nf(x.credit_outstanding)), w4(&|x| nf(x.credit_paid)));
    let _ = writeln!(
        out,
        "  storage          : players {}  vault (tide entries) {}  contract itself {}  = {} of NEAR in (attached + sponsored)",
        w4(&|x| nf(x.storage_players)),
        w4(&|x| nf(x.storage_vault)),
        w4(&|x| x.storage_contract as f64 / NEAR as f64),
        wmed(runs, &|x| 100.0 * (nf(x.storage_players + x.storage_vault) + x.storage_contract.max(0) as f64 / NEAR as f64) / nf(x.near_attached + x.near_sponsored).max(1e-12), 1) + " %"
    );
    let _ = writeln!(out, "  exit liquidity   : players' PETRI at the sell-back floor {} NEAR (one holder at a time) vs vault {} NEAR", w4(&|x| nf(x.held_total)), w4(&|x| nf(x.vault)));
    let _ = writeln!(
        out,
        "  team keeper      : calls {}  gas {} NEAR ({} per day)  bounties {}  (unregistered: it never takes the pot, so it calls every generation the pot holds > 5 PETRI)",
        w0(&|x| x.keeper.calls as f64),
        w4(&|x| nf(x.keeper.gas)),
        w4(&|x| nf(x.keeper.gas) / days.max(1) as f64),
        w4(&|x| nf(x.keeper.bounty))
    );
    let _ = writeln!(out, "  relayer          : sponsored + guest accounts {} NEAR  gas for guests {} NEAR;  house strains paid {} NEAR (NEAR + gas)", w4(&|x| nf(x.relayer_near)), w4(&|x| nf(x.relayer_gas)), w4(&|x| nf(x.house_paid)));
    let _ = writeln!(
        out,
        "  work per gen     : live cells avg {} max {}  colonies alive avg {} max {}",
        w0(&|x| x.work_live_avg),
        w0(&|x| x.work_live_max as f64),
        w0(&|x| x.work_alive_avg),
        w0(&|x| x.work_alive_max as f64)
    );
    let _ = writeln!(
        out,
        "  gas              : calls {}  total {} NEAR  biggest call {} TGas  calls > 300 TGas {}  biggest tide call {} TGas  tides > 300 TGas {}  credit winners max {}",
        w0(&|x| x.calls as f64),
        w4(&|x| x.gas_total * YOCTO_PER_GGAS / NEAR as f64),
        w0(&|x| x.gas_max_call / 1000.0),
        w0(&|x| x.calls_over_limit as f64),
        w0(&|x| x.tide_gas_max / 1000.0),
        w0(&|x| x.tides_over_limit as f64),
        w0(&|x| x.credit_winners_max as f64)
    );
    let _ = writeln!(out, "  clock            : catch-ups stopped by the gas limit {}  plantings refused as behind {}  skips {} ({} generations)", w0(&|x| x.partial_catchups as f64), w0(&|x| x.plant_fail_behind as f64), w0(&|x| x.skips as f64), w0(&|x| x.skipped as f64));
    let mut kinds: Vec<String> = runs.iter().filter_map(|r| r.world.top_tides_kind.map(|k| format!("{:?}", k))).collect();
    kinds.sort();
    kinds.dedup();
    let _ = writeln!(out, "  concentration    : the largest tide winner took {} of tide NEAR (kinds: {})", w4(&|x| x.top_tides), kinds.join(", "));
}

fn lockout_table(out: &mut String, label: &str, runs: &[RunOut], days: u64) {
    let mut marks: Vec<(String, u64)> = vec![("1 h".into(), 1), ("6 h".into(), 6)];
    for d in [1u64, 2, 3, 5, 7, 14, 21, 30] {
        if d <= days {
            marks.push((format!("day {}", d), d * 24));
        }
    }
    let _ = writeln!(out, "  {}", label);
    let _ = writeln!(out, "    {:<7} | {:>22} | {:>22} | {:>20} | {:>20} | {:>11}", "time", "free cells %", "free 2x2 spots %", "newcomer blk PETRI", "newcomer blk mNEAR", "siege mNEAR");
    for (name, t) in marks {
        let rows: Vec<&TideRow> = runs.iter().filter_map(|r| r.timeline.get(t as usize - 1)).collect();
        if rows.is_empty() {
            continue;
        }
        let free: Vec<f64> = rows.iter().map(|r| 100.0 * r.free).collect();
        let blk: Vec<f64> = rows.iter().map(|r| 100.0 * r.block_free).collect();
        let petri: Vec<f64> = rows.iter().filter_map(|r| r.newcomer_petri.map(pf)).collect();
        let mn: Vec<f64> = rows.iter().filter_map(|r| r.newcomer_near.map(|y| 1000.0 * nf(y))).collect();
        let siege: Vec<f64> = rows.iter().map(|r| 1000.0 * nf(r.siege_near)).collect();
        let f = |v: &[f64], p: usize| {
            if v.is_empty() {
                "cannot plant".to_string()
            } else {
                let (a, b, c) = mmm(v);
                format!("{:.p$} ({:.p$}..{:.p$})", b, a, c, p = p)
            }
        };
        let need_siege = rows.iter().filter(|r| r.block_free == 0.0).count();
        let note = if need_siege > 0 { format!("  [{} of {} seeds: no free 2x2 spot]", need_siege, rows.len()) } else { String::new() };
        let _ = writeln!(out, "    {:<7} | {:>22} | {:>22} | {:>20} | {:>20} | {:>11.2}{}", name, f(&free, 1), f(&blk, 1), f(&petri, 2), f(&mn, 2), med_of(siege), note);
    }
}

fn timeline_csv(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for t in &r.timeline {
            let _ = writeln!(
                csv,
                "\"{}\",{},{},{},{},{},{:.0},{:.6},{:.6},{:.8},{:.3},{:.3},{},{},{:.6},{:.6},{:.6},{:.1},{}",
                name,
                k,
                t.gen,
                t.wall,
                t.live,
                t.counted,
                pf(t.agar),
                nf(t.vault),
                nf(t.credit_pool),
                nf(t.price),
                100.0 * t.free,
                100.0 * t.block_free,
                t.newcomer_petri.map(|p| format!("{:.4}", pf(p))).unwrap_or_default(),
                t.newcomer_near.map(|p| format!("{:.6}", nf(p))).unwrap_or_default(),
                nf(t.siege_near),
                nf(t.near_in),
                nf(t.storage_total),
                t.tide_gas / 1000.0,
                t.credit_winners
            );
        }
    }
}

fn players_csv(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for (gi, g) in r.groups.iter().enumerate() {
            let _ = writeln!(
                csv,
                "\"{}\",{},{},{:?},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:+.6},{:+.6},{:.6},{:.6},{:.3},{:.3},{}",
                name,
                k,
                gi,
                g.kind,
                g.accounts,
                nf(g.attached),
                nf(g.sponsored),
                nf(g.gas),
                nf(g.tides),
                nf(g.sold),
                nf(g.bounty),
                nf(g.reclaimed),
                nf(g.stranded + g.held_stranded),
                nf(g.held),
                g.cash(),
                g.paper(),
                nf(g.credit_won),
                nf(g.credit_left),
                pf(g.earned),
                pf(g.spent),
                g.live
            );
        }
    }
}

fn header(out: &mut String, r: &Rules, rules_path: &str) {
    let _ = writeln!(out, "Petri economy simulator v5 (sim/src/main.rs) on petri-core; parameters loaded from {}", rules_path);
    let _ = writeln!(
        out,
        "  {}x{} dish, {} ms generations ({} a day); feed_ppm {}, keeper_bps {}, reach {} on stake decaying to {} bps each tide, burn_bps {}, payback {},",
        r.width, r.height, r.generation_ms, r.gens_per_day(), r.feed_ppm, r.keeper_bps, r.reach, r.stake_keep_bps, r.burn_bps, r.payback
    );
    let _ = writeln!(
        out,
        "  min_cell_price {} PETRI, live_floor {}, petri_price {} NEAR, max_supply {} PETRI, min_join {} NEAR, cell_fee {} NEAR, tide_every {}, tide_bps {},",
        pf(r.min_cell_price), r.live_floor, nf(r.petri_price), pf(r.max_supply), nf(r.min_join), nf(r.cell_fee), r.tide_every, r.tide_bps
    );
    let _ = writeln!(
        out,
        "  tide_bounty_bps {} (max {} NEAR), sell_bps {}, sell_cap_bps {}, siege_x {}, buffer {}, max_plant_cells {}, max_catchup {}, max_lag {}, house {} strains.",
        r.tide_bounty_bps, nf(r.max_bounty), r.sell_bps, r.sell_cap_bps, r.siege_x, r.buffer, r.max_plant_cells, r.max_catchup, r.max_lag, r.house.len()
    );
    if !r.overrides.is_empty() {
        let _ = writeln!(out, "  OVERRIDES: {}", r.overrides.join(", "));
    }
    let _ = writeln!(out, "Storage (borsh layout of what each call writes, +40 B per record; 1e19 yocto per byte):");
    let _ = writeln!(out, "  join 595 + 3L + 2N bytes incl. the 140 B prepaid purchase entry (wallet L=16: {} B = {:.5} NEAR; guest L=32: {} B); buy 140 B;", join_bytes(L_WALLET), nf(join_bytes(L_WALLET) * BYTE), join_bytes(L_GUEST));
    let _ = writeln!(out, "  plant_deposit = (220 + 4c (+ note + 64)) B + 0.0001 NEAR per cell; stored 162 + 4c B (+8 the first time, + 49 + note), the rest of the deposit");
    let _ = writeln!(out, "  goes to the vault (or credit pool); sell 104 B from the proceeds; tide entry + index 271 B from the vault; credit record 73 + L + Ls B (guest {} B,", credit_record(L_GUEST, L_RELAYER));
    let _ = writeln!(out, "  from the sponsorship); a Credit record a tide creates for a winner without one, Skip entries and board growth in catch-ups are paid by the contract.");
    let _ = writeln!(out, "Gas (estimate from NEAR's fee schedule; 1 TGas = 0.0001 NEAR): call 2.5 TGas + 60 Ggas per storage op + 5.6/63 Mgas per byte read/written");
    let _ = writeln!(out, "  (the per-colony arrays are rewritten whole: 24 B per colony per catch-up, 16 B per colony per tide, 40 B per colony per join) + 0.82 Mgas per");
    let _ = writeln!(out, "  wasm op (a generation ~20k + 60 x live + 50 x colonies alive ops) + 3 TGas per NEAR payout; each credit-pool winner at a tide costs");
    let _ = writeln!(out, "  {:.0} Ggas (its Colony and Credit records are read and rewritten). A transaction may burn 300 TGas; a catch-up stops after the", G_CREDIT_WINNER);
    let _ = writeln!(out, "  generation that crosses 160 TGas. Wallet players pay their gas (it counts in cash); the relayer pays the guests'.");
    let _ = writeln!(out);
    let _ = writeln!(out, "Player kinds (NEAR brought at join / NEAR willing to attach in all; winnings, sales and bounties go back into the wallet):");
    let _ = writeln!(out, "  Builder 0.05/0.25 still lifes near home | Raider 0.05/0.25 gliders/LWSS at rivals, 1 move in 3 a blinker siege | Defender 0.05/0.25");
    let _ = writeln!(out, "  eaters/beehives | Methuselah 0.1/0.5 an R-pentomino an hour within 40 cells | Late 0.05/0.25 builder joining day 2-3 | Whale 2/3 one");
    let _ = writeln!(out, "  colony, pulsars/beehives anywhere | SplitWhale the same 2/3 over 10 colonies (20 from 1,500 players) | Sniper 0.05/0.25 plants in the 3");
    let _ = writeln!(out, "  generations before each tide, sells after each | Locker 1.5/2 a 16x16 lattice of blocks 8 apart (every empty cell in its buffer),");
    let _ = writeln!(out, "  repairs every 20 gens, plants renewal blocks when its cap < its live cells | Racer 0.01 never plants, advances for pot + bounty |");
    let _ = writeln!(out, "  Seller 0.2 buys and sells back | Guest: an ordinary relayer guest, 0.05 NEAR of sponsored credit, plays like a builder |");
    let _ = writeln!(out, "  SybilGuest: one operator = a wallet builder (0.05/0.25) + 10 relayer guests near it (0.05 credit each) that plant blocks, sell");
    let _ = writeln!(out, "  every tide and claim | SelfSponsor: one operator sponsors 10 own full-access sub-accounts with 0.05 NEAR each, plays them on credit,");
    let _ = writeln!(out, "  claims their NEAR, stops spending credit a day before the end and unsponsors them (credit won included) | House: the 5 strains,");
    let _ = writeln!(out, "  0.05 + 0.02 top-ups, 1 NEAR budget each, notes, no siege, every 50-140 gens. The team keeper (unregistered) advances when 20");
    let _ = writeln!(out, "  behind or the pot holds 5 PETRI (agents/run.mjs). Careful players spend at most half their PETRI per planting, try 30 spots before");
    let _ = writeln!(out, "  paying for a siege. After each tide sellers race for the allowance: bots first, then a random quarter of the rest.");
    let _ = writeln!(out, "  A relayer guest's key is a function-call key for join/buy/plant/sell/claim/advance only: the NEAR it is paid (tide claims, sales,");
    let _ = writeln!(out, "  bounties) lands in the guest account and cannot be moved, so it is not cash for anyone ('stranded').");
    let _ = writeln!(out);
}

// ---------- modes ----------

fn parse_args(args: &[String]) -> (String, Vec<(String, String)>, Vec<(String, String)>) {
    let mut rules_path = "../contract/launch-rules.json".to_string();
    let mut sets = Vec::new();
    let mut opts = Vec::new();
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--rules" => {
                rules_path = args[i + 1].clone();
                i += 1;
            }
            "--set" => {
                let (k, v) = args[i + 1].split_once('=').expect("--set key=value");
                sets.push((k.to_string(), v.to_string()));
                i += 1;
            }
            s if s.starts_with("--") => {
                opts.push((s[2..].to_string(), args[i + 1].clone()));
                i += 1;
            }
            _ => {}
        }
        i += 1;
    }
    (rules_path, sets, opts)
}

fn opt(opts: &[(String, String)], k: &str, d: u64) -> u64 {
    opts.iter().find(|(a, _)| a == k).and_then(|(_, v)| v.parse().ok()).unwrap_or(d)
}

fn sc(name: &str, rules: &Rules, soc: Society, days: u64, seeds: u64, stream: u64) -> Scenario {
    Scenario { name: name.into(), rules: rules.clone(), society: soc, days, seeds, stream, house_budget: NEAR, keeper_on: true }
}

fn all(out_dir: &str, r: &Rules, rules_path: &str, opts: &[(String, String)]) {
    let s15 = opt(opts, "seeds-15", 20);
    let s150 = opt(opts, "seeds-150", 12);
    let s1500 = opt(opts, "seeds-1500", 10);
    let s30 = opt(opts, "seeds-30", 5);
    let sbig = opt(opts, "seeds-big", 3);
    let big_days = opt(opts, "big-days", 1);
    let gp = r.with(&[("guest_payout", "true")]);
    let mut scen = vec![
        sc("15 players, 7 days", r, society(15, true), 7, s15, 15),
        sc("150 players, 7 days", r, society(150, true), 7, s150, 150),
        sc("1,500 players, 7 days", r, society(1500, true), 7, s1500, 1500),
        sc("150 players, 30 days", r, society(150, true), 30, s30, 150),
        sc("15 players, no locker (control), 7 days", r, society(15, false), 7, s15, 15),
        sc("150 players, no locker (control), 7 days", r, society(150, false), 7, s150, 150),
        sc("150 players, HYPOTHETICAL guests can route NEAR to a wallet (set_payout relayed), 7 days", &gp, society(150, true), 7, s150, 150),
        sc("15 players, 1 day", r, society(15, true), 1, sbig, 15),
        sc("150 players, 1 day", r, society(150, true), 1, sbig, 150),
        sc("1,500 players, 1 day", r, society(1500, true), 1, sbig, 1500),
        sc(&format!("15,000 players (100x), {} day(s)", big_days), r, society(15000, true), big_days, sbig, 15000),
    ];
    let zero = |name: &str, soc: Society, keeper: bool, budget: u128, seeds: u64| Scenario { name: name.into(), rules: r.clone(), society: soc, days: 30, seeds, stream: 7, house_budget: budget, keeper_on: keeper };
    scen.push(zero("zero players: empty dish, team keeper on, 30 days", vec![], true, NEAR, 1));
    scen.push(zero("zero players: empty dish, nobody calls (dormant), one visitor at day 30", vec![], false, NEAR, 1));
    scen.push(zero("zero players: house only (1 NEAR each), team keeper on, 30 days", vec![(Kind::House, 5, 1)], true, NEAR, 3));
    scen.push(zero("zero players: house only (1 NEAR each), keeper off (only the strains call), 30 days", vec![(Kind::House, 5, 1)], false, NEAR, 3));
    scen.push(zero("zero players: house only, unlimited budget, team keeper on, 30 days", vec![(Kind::House, 5, 1)], true, 1_000 * NEAR, 3));
    let t0 = Instant::now();
    let runs = run_all(&scen);
    let get = |name_start: &str| -> usize { scen.iter().position(|s| s.name.starts_with(name_start)).unwrap() };
    let mut out = String::new();
    let _ = writeln!(out, "Petri v5 economy simulation: launched rules from {} (sim/src/main.rs; assumptions and player kinds in section 0 below).", rules_path);
    let _ = writeln!(out);
    let (i15, i150, i1500, i30) = (get("15 players, 7"), get("150 players, 7"), get("1,500 players, 7"), get("150 players, 30"));
    let label = |i: usize| format!("{} p, {} d, {} seeds", players(&scen[i].society), scen[i].days, runs[i].len());
    let cols: Vec<(String, &[RunOut])> = [i15, i150, i1500, i30].iter().map(|&i| (label(i), &runs[i][..])).collect();
    let _ = writeln!(out, "=== 1. CASH ONLY: NEAR actually withdrawn minus NEAR actually paid, per player (operator), median (min..max) over seeds ===");
    let _ = writeln!(out, "  withdrawn = tide claims + sell-backs + tide bounties + credit taken back (unsponsor); paid = NEAR attached (join, buy, planting");
    let _ = writeln!(out, "  deposits, storage included) + NEAR spent sponsoring + estimated gas. Each cell is the kind's mean player; min..max over seeds.");
    let _ = writeln!(out, "  Relayer guests attach nothing and can withdraw nothing, so Guest is 0 by construction (see 'stranded' in the details).");
    let _ = writeln!(out, "  The 30-day column has fewer seeds ({}).", runs[i30].len());
    kind_matrix(&mut out, &cols, &|g| g.cash(), 4, 30);
    let _ = writeln!(out);
    let _ = writeln!(out, "=== 2. PAPER VALUE: cash + PETRI still held (claimed or not) valued at the sell-back floor min(curve x 50%, the units' share of the vault) ===");
    let _ = writeln!(out, "  Valued one holder at a time; all holders together could not exit at this price (see exit liquidity). Guest PETRI is excluded (stranded).");
    kind_matrix(&mut out, &cols, &|g| g.paper(), 4, 30);
    let _ = writeln!(out);
    let _ = writeln!(out, "=== 3. PETRI earned from the feed / PETRI spent planting (a PETRI ratio, not NEAR), median (min..max) ===");
    kind_matrix(&mut out, &cols, &|g| if g.spent == 0 { f64::NAN } else { g.earned as f64 / g.spent as f64 }, 2, 30);
    let _ = writeln!(out);
    let _ = writeln!(out, "=== 4. Sybil and credit checks (NEAR, median (min..max)) ===");
    let hyp = get("150 players, HYPOTHETICAL");
    let cols2: Vec<(String, &[RunOut])> = vec![(label(i15), &runs[i15][..]), (label(i150), &runs[i150][..]), (label(i1500), &runs[i1500][..]), ("150 p, 7 d, IF set_payout relayed".into(), &runs[hyp][..])];
    let _ = writeln!(out, "  NEAR paid to guest accounts that cannot move it (tide claims + sales + bounties + PETRI left at the floor), per player:");
    kind_matrix(&mut out, &cols2, &|g| nf(g.stranded + g.held_stranded), 4, 30);
    let _ = writeln!(out, "  credit won at the tides (non-withdrawable; spendable on join/buy/plant), per player:");
    kind_matrix(&mut out, &cols2, &|g| nf(g.credit_won), 4, 30);
    let _ = writeln!(out, "  cash, with the hypothetical rule in the last column:");
    kind_matrix(&mut out, &cols2, &|g| g.cash(), 4, 30);
    let _ = writeln!(out, "  SelfSponsor: credit taken back by unsponsor, per operator (its own unspent sponsorship + credit won from the credit pool):");
    kind_matrix(&mut out, &cols2, &|g| nf(g.reclaimed), 4, 30);
    let _ = writeln!(out);
    // 5. Storage and lockout.
    let _ = writeln!(out, "=== 0. Rules, storage and gas model, player kinds ===");
    header(&mut out, r, rules_path);
    let _ = writeln!(out, "=== 5. Storage as a share of NEAR in, and the newcomer lockout ===");
    let ctl15 = get("15 players, no locker");
    let ctl150 = get("150 players, no locker");
    for &i in &[i15, ctl15, i150, ctl150, i1500, i30] {
        let rs = &runs[i];
        let _ = writeln!(
            out,
            "  {:<44} storage {} % of NEAR in   (players {} NEAR, vault {} NEAR, contract {} NEAR; NEAR in {})",
            scen[i].name,
            wmed(rs, &|x| 100.0 * (nf(x.storage_players + x.storage_vault) + x.storage_contract.max(0) as f64 / NEAR as f64) / nf(x.near_attached + x.near_sponsored).max(1e-12), 1),
            wmed(rs, &|x| nf(x.storage_players), 4),
            wmed(rs, &|x| nf(x.storage_vault), 4),
            wmed(rs, &|x| x.storage_contract as f64 / NEAR as f64, 4),
            wmed(rs, &|x| nf(x.near_attached + x.near_sponsored), 4)
        );
    }
    let _ = writeln!(out, "  Newcomer: a colony with no cells. 'free' = empty with no non-house living cell within 3 (house cells never make a siege).");
    let _ = writeln!(out, "  Cost = the cheapest 2x2 block it can plant (a siege, x{}, if no free spot), PETRI and mNEAR (PETRI at the buy price + the deposit).", r.siege_x);
    for &i in &[i15, ctl15, i150, ctl150, i1500, i30] {
        lockout_table(&mut out, &format!("{} ({} seeds):", scen[i].name, runs[i].len()), &runs[i], scen[i].days);
    }
    let _ = writeln!(out);
    // 6. Scale.
    let _ = writeln!(out, "=== 6. Scale: 15 / 150 / 1,500 / 15,000 players, day 1 (median (min..max) over seeds) ===");
    let _ = writeln!(out, "  {:<36} | {:>14} | {:>16} | {:>16} | {:>12} | {:>16} | {:>16} | {:>9} | {:>9} | {:>10} | {:>10} | {:>8}", "scenario", "live end", "free cells %", "free 2x2 %", "agar PETRI", "live/gen avg", "col alive/gen", "max call", "max tide", "tides>300T", "calls>300T", "behind");
    for name in ["15 players, 1", "150 players, 1", "1,500 players, 1", "15,000"] {
        let i = get(name);
        let rs = &runs[i];
        let last = |f: &dyn Fn(&TideRow) -> f64| {
            let v: Vec<f64> = rs.iter().filter_map(|x| x.timeline.last().map(|t| f(t))).collect();
            let (a, b, c) = mmm(&v);
            format!("{:.1} ({:.1}..{:.1})", b, a, c)
        };
        let _ = writeln!(
            out,
            "  {:<36} | {:>14} | {:>16} | {:>16} | {:>12} | {:>16} | {:>16} | {:>7} T | {:>7} T | {:>10} | {:>10} | {:>8}",
            format!("{} ({} col.)", scen[i].name, colonies(&scen[i].society)),
            wmed(rs, &|x| x.live as f64, 0),
            last(&|t| 100.0 * t.free),
            last(&|t| 100.0 * t.block_free),
            wmed(rs, &|x| pf(x.agar), 0),
            wmed(rs, &|x| x.work_live_avg, 0),
            wmed(rs, &|x| x.work_alive_avg, 0),
            med_of(rs.iter().map(|x| x.world.gas_max_call / 1000.0).collect()).round(),
            med_of(rs.iter().map(|x| x.world.tide_gas_max / 1000.0).collect()).round(),
            wmed(rs, &|x| x.tides_over_limit as f64, 0),
            wmed(rs, &|x| x.calls_over_limit as f64, 0),
            wmed(rs, &|x| x.plant_fail_behind as f64, 0)
        );
    }
    let big = get("15,000");
    let _ = writeln!(out, "  15,000-player detail:");
    world_lines(&mut out, &runs[big], scen[big].days);
    lockout_table(&mut out, "newcomer over the day (15,000 players):", &runs[big], scen[big].days);
    kind_detail(&mut out, &runs[big]);
    let _ = writeln!(out);
    // 7. Zero players.
    let _ = writeln!(out, "=== 7. Zero players: 30 days ===");
    for (i, s) in scen.iter().enumerate() {
        if !s.name.starts_with("zero") {
            continue;
        }
        let rs = &runs[i];
        let _ = writeln!(out, "  {} ({} seed(s)):", s.name, rs.len());
        let _ = writeln!(out, "    {:>4} | {:>8} | {:>9} | {:>6} | {:>10} | {:>9} | {:>9} | {:>8} | {:>9} | {:>10} | {:>10}", "day", "gen", "skipped", "live", "agar PETRI", "vault", "cr. pool", "k.calls", "keeper gas", "house paid", "contract st");
        for d in [1u64, 2, 3, 7, 14, 21, 30] {
            if let Some(t) = rs[0].days.get(d as usize - 1) {
                let _ = writeln!(out, "    {:>4} | {:>8} | {:>9} | {:>6} | {:>10.0} | {:>9.5} | {:>9.5} | {:>8} | {:>10.5} | {:>10.5} | {:>10.5}", t.day, t.gen, t.skipped, t.live, pf(t.agar), nf(t.vault), nf(t.credit_pool), t.keeper_calls, nf(t.keeper_gas), nf(t.house_paid), t.contract_storage as f64 / NEAR as f64);
            }
        }
        let wo = &rs[0].world;
        let _ = writeln!(out, "    end (after the final call): gen {}  skipped {} in {} skip(s)  agar {:.0}  vault {:.5}  keeper gas {:.5} NEAR in {} calls  tides {}  house paid {:.4} NEAR", wo.gen_end, wo.skipped, wo.skips, pf(wo.agar), nf(wo.vault), nf(wo.keeper.gas), wo.keeper.calls, wo.tides, nf(wo.house_paid));
    }
    let _ = writeln!(out);
    // 8. Per-scenario detail.
    let _ = writeln!(out, "=== 8. Per-scenario detail ===");
    let _ = writeln!(out, "  Columns per player (median over seeds of the kind's mean player), NEAR unless marked: attached / sponsored / gas paid; tides / sold /");
    let _ = writeln!(out, "  bounty / reclaimed withdrawn; cash and paper as above; crWon = credit won at tides, crLeft = credit left; stranded = NEAR (and PETRI at");
    let _ = writeln!(out, "  the floor) in guest accounts; e/s = PETRI earned / spent; feed% = the kind's share of the feed; capd% = live cell-gens unpaid by the cap.");
    let mut tl = String::from("scenario,seed,generation,wall,live,counted,agar_petri,vault_near,credit_pool_near,petri_price_near,free_cells_pct,free_block_spots_pct,newcomer_block_petri,newcomer_block_near,siege_block_near,near_in,storage_total_near,tide_gas_tgas,credit_winners\n");
    let mut pc = String::from("scenario,seed,player,kind,accounts,attached,sponsored,gas,tides,sold,bounty,reclaimed,stranded,held_floor,cash,paper,credit_won,credit_left,petri_earned,petri_spent,live_end\n");
    for (i, s) in scen.iter().enumerate() {
        let rs = &runs[i];
        let secs: f64 = rs.iter().map(|x| x.world.secs).sum::<f64>() / rs.len().max(1) as f64;
        let _ = writeln!(out, "== {} == ({} players + house, {} colonies, {} seeds, {:.1} s per run)", s.name, players(&s.society), colonies(&s.society), rs.len(), secs);
        if colonies(&s.society) > 5 {
            kind_detail(&mut out, rs);
        }
        world_lines(&mut out, rs, s.days);
        let _ = writeln!(out);
        if !s.name.starts_with("zero") {
            timeline_csv(&mut tl, &s.name, rs);
        }
        if s.days >= 7 || s.name.starts_with("15,000") {
            players_csv(&mut pc, &s.name, rs);
        }
    }
    let _ = writeln!(out, "Wall time {:.0} s on {} threads.", t0.elapsed().as_secs_f64(), std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1));
    if let Ok(fx) = fs::read_to_string(format!("{}/fixes.txt", out_dir)) {
        let _ = writeln!(out);
        let _ = writeln!(out, "==================================================================================================");
        out.push_str(&fx);
    }
    print!("{}", out);
    fs::write(format!("{}/summary.txt", out_dir), &out).unwrap();
    write_capped(&format!("{}/timeline", out_dir), &tl);
    write_capped(&format!("{}/players", out_dir), &pc);
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

/// Fix experiments: one change at a time against the launched rules, same seeds.
fn fixes(out_dir: &str, r: &Rules, opts: &[(String, String)]) {
    let s150 = opt(opts, "seeds-150", 12);
    let s1500 = opt(opts, "seeds-1500", 10);
    let sets: Vec<(&str, Vec<(&str, &str)>)> = vec![
        ("launched rules", vec![]),
        ("team keeper registered (collects the pot)", vec![("keeper_registered", "true")]),
        ("ledger kept as events (sim: no stored entries)", vec![("ledger_events", "true")]),
        ("tide_bps 500", vec![("tide_bps", "500")]),
        ("stake_keep_bps 8000", vec![("stake_keep_bps", "8000")]),
        ("reach 4", vec![("reach", "4")]),
        ("reach 2", vec![("reach", "2")]),
        ("siege_x 2", vec![("siege_x", "2")]),
        ("sell_bps 3000", vec![("sell_bps", "3000")]),
    ];
    let mut scen = Vec::new();
    for scale in [150usize, 1500] {
        for (name, set) in &sets {
            scen.push(sc(&format!("{} p | {}", scale, name), &r.with(set), society(scale, true), 7, if scale == 150 { s150 } else { s1500 }, scale as u64));
        }
    }
    let gas_sets: Vec<(&str, Vec<(&str, &str)>)> = vec![("launched rules", vec![]), ("credit tide kept in a packed array", vec![("packed_credit", "true")])];
    for scale in [1500usize, 15000] {
        for (name, set) in &gas_sets {
            scen.push(sc(&format!("{} p, 1 day | {}", scale, name), &r.with(set), society(scale, true), 1, 3, scale as u64));
        }
    }
    let zero = |name: &str, set: &[(&str, &str)], soc: Society| Scenario { name: name.into(), rules: r.with(set), society: soc, days: 30, seeds: 1, stream: 7, house_budget: NEAR, keeper_on: true };
    scen.push(zero("zero, empty dish, keeper on | launched rules", &[], vec![]));
    scen.push(zero("zero, empty dish, keeper on | no entry for a tide that pays nobody", &[("quiet_tides", "true")], vec![]));
    scen.push(zero("zero, house only, keeper on | launched rules", &[], vec![(Kind::House, 5, 1)]));
    scen.push(zero("zero, house only, keeper on | no entry for a tide that pays nobody", &[("quiet_tides", "true")], vec![(Kind::House, 5, 1)]));
    let runs = run_all(&scen);
    let mut out = String::new();
    let _ = writeln!(out, "=== 9. Fix experiments: one change at a time against the launched rules (same seeds; 7 days; {} seeds at 150 players, {} at 1,500) ===", s150, s1500);
    let _ = writeln!(out, "  Cells: median cash (NEAR withdrawn - NEAR paid incl. gas) per player of each kind. stor% = storage / NEAR in; keepGas/d = team keeper");
    let _ = writeln!(out, "  gas per day; lockTd% = the locker's share of all tide NEAR; free7% = free cells for a newcomer at the end.");
    let kinds = [Kind::Builder, Kind::Raider, Kind::Methuselah, Kind::Late, Kind::Whale, Kind::SplitWhale, Kind::Locker, Kind::Racer, Kind::Seller, Kind::SybilGuest, Kind::SelfSponsor, Kind::House];
    let _ = write!(out, "  {:<56} |", "");
    for k in kinds {
        let s = format!("{:?}", k);
        let _ = write!(out, " {:>8}", &s[..s.len().min(8)]);
    }
    let _ = writeln!(out, " | {:>6} {:>9} {:>7} {:>7}", "stor%", "keepGas/d", "lockTd%", "free7%");
    for (i, s) in scen.iter().enumerate() {
        if s.days != 7 {
            continue;
        }
        let rs = &runs[i];
        let _ = write!(out, "  {:<56} |", s.name);
        for k in kinds {
            let v = med_of(per_seed(rs, k, &|g| g.cash()));
            if v.is_nan() {
                let _ = write!(out, " {:>8}", "-");
            } else {
                let _ = write!(out, " {:>+8.4}", v);
            }
        }
        let lock = med_of(rs.iter().map(|x| x.groups.iter().filter(|g| g.kind == Kind::Locker).map(|g| g.tides).sum::<u128>() as f64 / x.world.tides_paid.max(1) as f64).collect());
        let free = med_of(rs.iter().filter_map(|x| x.timeline.last().map(|t| 100.0 * t.free)).collect());
        let stor = med_of(rs.iter().map(|x| 100.0 * (nf(x.world.storage_players + x.world.storage_vault) + x.world.storage_contract.max(0) as f64 / NEAR as f64) / nf(x.world.near_attached + x.world.near_sponsored).max(1e-12)).collect());
        let kg = med_of(rs.iter().map(|x| nf(x.world.keeper.gas) / s.days as f64).collect());
        let _ = writeln!(out, " | {:>5.1}% {:>9.4} {:>6.1}% {:>6.1}%", stor, kg, 100.0 * lock, free);
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "  Gas at scale (1 day, 3 seeds): biggest tide call, tides over 300 TGas (each one would fail and halt the dish), credit winners per tide");
    for (i, s) in scen.iter().enumerate() {
        if s.days != 1 {
            continue;
        }
        let rs = &runs[i];
        let _ = writeln!(out, "    {:<58} biggest tide {} TGas  tides > 300 TGas {}  biggest call {} TGas  winners max {}", s.name, wmed(rs, &|x| x.tide_gas_max / 1000.0, 0), wmed(rs, &|x| x.tides_over_limit as f64, 0), wmed(rs, &|x| x.gas_max_call / 1000.0, 0), wmed(rs, &|x| x.credit_winners_max as f64, 0));
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "  Zero players, 30 days: storage the contract pays itself, keeper gas, NEAR left in the vault");
    for (i, s) in scen.iter().enumerate() {
        if s.days != 30 {
            continue;
        }
        let w = &runs[i][0].world;
        let _ = writeln!(out, "    {:<66} contract storage {:+.4} NEAR  keeper gas {:.4} NEAR  vault {:.4} NEAR  house paid {:.4} NEAR", s.name, w.storage_contract as f64 / NEAR as f64, nf(w.keeper.gas), nf(w.vault), nf(w.house_paid));
    }
    print!("{}", out);
    fs::write(format!("{}/fixes.txt", out_dir), &out).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out_dir = args.get(1).cloned().unwrap_or_else(|| "out-v5".into());
    fs::create_dir_all(&out_dir).unwrap();
    let mode = args.get(2).cloned().unwrap_or_default();
    let (rules_path, sets, opts) = parse_args(&args[3.min(args.len())..]);
    let r = Rules::load(&rules_path, &sets);
    match mode.as_str() {
        "all" => all(&out_dir, &r, &rules_path, &opts),
        "fixes" => fixes(&out_dir, &r, &opts),
        "probe" => {
            let rest: Vec<&String> = args[3..].iter().filter(|a| !a.starts_with("--") && !a.contains('=')).collect();
            let scale = rest.first().and_then(|s| s.parse().ok()).unwrap_or(15);
            let days = rest.get(1).and_then(|s| s.parse().ok()).unwrap_or(1);
            let s = sc("probe", &r, society(scale, true), days, opt(&opts, "seeds", 1), scale as u64);
            let runs = run_all(&[s.clone()]);
            let mut out = String::new();
            header(&mut out, &r, &rules_path);
            kind_detail(&mut out, &runs[0]);
            world_lines(&mut out, &runs[0], days);
            lockout_table(&mut out, "lockout", &runs[0], days);
            print!("{}", out);
        }
        _ => eprintln!("usage: petri-sim <out_dir> all|fixes|probe [<players> <days>] [--rules path] [--set k=v]... [--seeds-1500 n] [--seeds-big n]"),
    }
}
