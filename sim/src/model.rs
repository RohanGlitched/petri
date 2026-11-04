//! The rules, the v6 storage layout and the gas model.
//!
//! Every storage size below is the borsh length of what the v6 contract writes (contract/src/lib.rs, books.rs,
//! slides.rs), plus the record's key and NEAR's 40 bytes per record. Every gas figure is NEAR's protocol fee schedule
//! (not the unit runtime, which the contract's own tests use and which charges less per byte written), plus an
//! estimate of the wasm each call executes. The assumptions are printed in the summary header.

use serde::Deserialize;
use std::fs;

/// One PETRI in units (6 decimals).
pub const UNIT: u128 = 1_000_000;
/// One NEAR in yoctoNEAR.
pub const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// NEAR's storage price: 10^19 yoctoNEAR per byte.
pub const BYTE: u128 = 10_000_000_000_000_000_000;
/// `RECLAIM_AFTER`: a sponsor may take back its grant once the account has not drawn on it for this long (wall clock).
pub const RECLAIM_AFTER: u64 = 5_760;
/// `MIN_SPONSOR`.
pub const MIN_SPONSOR: u128 = NEAR / 100;

// ---------- storage, v6 borsh layout (bytes; key + value + 40 per record) ----------

/// Account-name lengths used for storage: a wallet ("someone.testnet" / a named mainnet account), a relayer guest
/// ("g-<10 hex>.petri-guests.testnet"), a self-sponsored sub-account, a house strain ("violet.petri-dish.near"), the
/// relayer ("petri-guests.testnet"); and a colony name.
pub const L_WALLET: u128 = 16;
pub const L_GUEST: u128 = 33;
pub const L_SUB: u128 = 24;
pub const L_HOUSE: u128 = 22;
pub const L_RELAYER: u128 = 20;
pub const NAME_LEN: u128 = 12;
/// A house strain writes a lab note of about this many bytes with every planting (agents/run.mjs cleanNote: <= 120).
pub const NOTE_LEN: u128 = 100;

/// `Colony` (id 2, account 4+L, name 4+N, color 4, house 1, payout 1, joined 8, last_plant 1, cells_planted 8,
/// nine U128 counters 144, proxy 1 = 178 + L + N) in a `Vector` (key 5) + 40.
pub fn colony_bytes(l: u128, n: u128) -> u128 {
    223 + l + n
}
/// `join`: Colony record, colony_of (47 + L), names (45 + N), balance (61 + L), the Join entry (56), the cold slot
/// (57; a new page every 64 colonies adds 43), and the 140 bytes `BUY_BYTES` charged up front for the purchase entry.
pub fn join_bytes(l: u128, n: u128, new_page: bool) -> u128 {
    colony_bytes(l, n) + (47 + l) + (45 + n) + (61 + l) + 56 + 57 + if new_page { 43 } else { 0 } + BUY_BYTES
}
/// What join really stores: the Buy entry is 105 bytes (121 with `spent`), not the 140 charged.
pub fn join_stored(l: u128, n: u128, new_page: bool, spent: bool) -> u128 {
    join_bytes(l, n, new_page) - BUY_BYTES + buy_entry(spent)
}
/// `BUY_BYTES`, charged for every purchase.
pub const BUY_BYTES: u128 = 140;
/// Buy entry: tag 1, generation 8, colony 2, petri/near/credit 48, spent Option (1 or 17) + key 5 + 40.
pub fn buy_entry(spent: bool) -> u128 {
    105 + if spent { 16 } else { 0 }
}
/// `PLANT_STORAGE_BASE`.
pub const PLANT_STORAGE_BASE: u128 = 240;
/// A hot row: the feed part (26) and the purse part (51).
pub const HOT_FEED: u128 = 26;
pub const HOT_PURSE: u128 = 51;
pub const HOT_ROW: u128 = HOT_FEED + HOT_PURSE;
/// The hot table's two records when the first row is made (keys "H" and "J", 40 each).
pub const HOT_RECORDS: u128 = 82;
/// A cold slot.
pub const COLD: u128 = 57;
pub const PAGE: usize = 64;
/// NEP-145 registration (`ACCOUNT_STORAGE`).
pub const ACCOUNT_STORAGE: u128 = 125;
/// The licence inside a Plant entry: token 8, moves 4, holder Option (1 + 4 + L, or 1), royalty 16; the entry already
/// counts the Option tag.
pub fn licence_bytes(holder_len: Option<u128>) -> u128 {
    8 + 4 + 16 + match holder_len {
        Some(l) => 5 + l,
        None => 1,
    }
}
/// `plant_deposit(cells, note_bytes, slide)`: 240 + 77 (a first hot row) + 82 if the table is empty + 4c + (note + 64)
/// + the licence, + cell_fee per cell.
pub fn plant_deposit_bytes(cells: u128, note: Option<u128>, licence_holder: Option<u128>, table_empty: bool) -> u128 {
    PLANT_STORAGE_BASE + HOT_ROW + if table_empty { HOT_RECORDS } else { 0 } + 4 * cells + note.map(|n| n + 64).unwrap_or(0) + licence_holder.map(|l| 33 + l).unwrap_or(0)
}
/// What a planting really stores: the Plant entry (tag 1, gen 8, colony 2, cells 4+2c, cost/near/credit 48, siege 1,
/// spent 1/17, licence 1/..; + key 5 + 40 = 111 + 2c), its plant-index entry (53), 2 bytes a cell on the board, 8 the
/// first time (last_plant_generation becomes Some), a note (key 9 + 40 + its bytes), a new hot row (77, + 82 for the
/// table's records if it was empty) and the licence.
pub fn plant_stored(cells: u128, first: bool, spent: bool, note: Option<u128>, licence: Option<Option<u128>>, entering: bool, table_empty: bool) -> u128 {
    111 + 2 * cells + if spent { 16 } else { 0 } + 53 + 2 * cells + if first { 8 } else { 0 } + note.map(|n| 49 + n).unwrap_or(0) + if entering { HOT_ROW } else { 0 } + if entering && table_empty { HOT_RECORDS } else { 0 } + licence.map(licence_bytes).unwrap_or(0)
}
/// Sell entry: tag 1, gen 8, colony 2, petri/near/paid 48, as_credit 1 + 45.
pub const SELL_BYTES: u128 = 105;
/// A NEAR payout must cover a possible refund: `REFUND_BYTES` + `PENDING_RECORD_BYTES`.
pub const PAYOUT_RESERVE: u128 = 97 + 142;
/// Claim entry: tag 1, gen 8, colony 2, petri/near/paid 48 + 45.
pub const CLAIM_BYTES: u128 = 104;
/// Tide entry (tag 1, gen 8, chain 4+64, seven U128 112, by 2 = 191, + 45) and its tide-index entry (53).
pub const TIDE_BYTES: u128 = 236 + 53;
/// Skip entry: tag 1, gen 8, skipped 8 + 45. Paid by the contract.
pub const SKIP_BYTES: u128 = 62;
/// Sponsor and Unsponsor entries: tag 1, gen 8, account 4+La, sponsor 4+Ls, amount 16 + 45.
pub fn sponsor_entry(la: u128, ls: u128) -> u128 {
    78 + la + ls
}
/// A sponsorship: its entry, the grants record (key 1+4+La, Vec 4 + per grant sponsor 4+Ls, amount 16, at 8, + 40)
/// when the account had none, or one more grant in it, and the 210 bytes set aside for the Unsponsor entry.
pub fn sponsor_bytes(la: u128, ls: u128, fresh_record: bool, fresh_grant: bool) -> u128 {
    sponsor_entry(la, ls) + if fresh_record { 77 + la + ls } else if fresh_grant { 28 + ls } else { 0 } + if fresh_grant { UNSPONSOR_BYTES } else { 0 }
}
pub const UNSPONSOR_BYTES: u128 = 210;
/// A grants record (one grant), freed when the grant is spent or taken back.
pub fn grant_record(la: u128, ls: u128) -> u128 {
    77 + la + ls
}
/// `mint_slide`: the Slide record (owner 4+L, colony 2, gen 8, x/y 4, w/h 2, cells 2, color 4, title 1, bitmap 4+B,
/// minted 8, next_approval 8, approvals 4, moves 4, royalties 16 = 71 + L + B; key 5 + 40), the owner's list (53 + L
/// for an owner with none), the Slide entry (52 + B + key 5 + 40) and `SLIDE_RESERVE` (184).
pub fn slide_bytes(l: u128, w: u128, h: u128, title: u128, first_slide: bool) -> u128 {
    let b = (w * h + 7) / 8;
    (116 + l + b + title) + if first_slide { 53 + l } else { 4 } + (97 + b) + 184
}
/// `slide_deposit(w, h, title)`, what the minter attaches (the excess is sent back).
pub fn slide_deposit_bytes(w: u128, h: u128, title: Option<u128>) -> u128 {
    let b = (w * h + 7) / 8;
    240 + 21 + 64 + 2 * b + title.map(|t| t + 5).unwrap_or(0) + 120 + 184
}
/// The release wasm (CHANGES-v6.md): its own storage is staked by the dish account.
pub const WASM_BYTES: u128 = 570_994;

// ---------- gas, NEAR's protocol fee schedule (Ggas) ----------

/// A function call's fixed cost: the transaction, its receipt, loading the contract and its state (calibrated in v3
/// against testnet: a planting that caught up three generations on a small dish burned ~4.4 TGas).
pub const G_CALL: f64 = 2_500.0;
/// One storage operation's base cost (storage_read_base 56.4 / storage_write_base 64.2 Ggas, with key bytes).
pub const G_SOP: f64 = 60.0;
/// Per byte read: storage_read_value_byte 5.61 + write_register_byte 3.80 + read_register_byte 0.10 + write_memory 2.72
/// Mgas.
pub const G_RB: f64 = 0.01223;
/// Per byte rewritten: read_memory_byte 3.80 + storage_write_value_byte 31.02 + storage_write_evicted_byte 32.12 +
/// the evicted value into a register 3.80 Mgas. (The contract's unit-runtime figures imply ~39 Mgas a byte.)
pub const G_WB: f64 = 0.0707;
/// One wasm instruction (regular_op_cost 822,756 gas).
pub const G_OP: f64 = 0.000_823;
pub const G_SHA_BYTE: f64 = 0.024;
/// Wasm per hot row: parsing it when the table loads (two chunk iterators, four integers, one Vec allocated and
/// copied), writing each part back, a tide's window reset and decay, and each tide winner's split and binary search.
pub const W_LOAD_ROW: f64 = 600.0;
pub const W_STORE_FEED_ROW: f64 = 150.0;
pub const W_STORE_PURSE_ROW: f64 = 250.0;
pub const W_TIDE_ROW: f64 = 60.0;
pub const W_WINNER: f64 = 400.0;
pub const W_FLUSH_SCAN_ROW: f64 = 15.0;
/// A NEAR payout: the gas it burns (a transfer receipt and the on_payout callback, ~3.5 TGas) and what it reserves
/// against the call's prepaid gas (~30 TGas: the transfer and the callback's 15 TGas allowance, CHANGES-v6.md).
pub const G_PAYOUT_BURN: f64 = 3_500.0;
pub const G_PAYOUT_RESERVE: f64 = 30_000.0;
/// One transaction may prepay at most 300 TGas.
pub const G_TX_MAX: f64 = 300_000.0;
/// `CATCHUP_GAS_LIMIT` 180 TGas, `GAS_RESERVE` 40 TGas, `HOT_WRITE_GAS_PER_BYTE` 64 Mgas.
pub const G_CATCHUP_LIMIT: f64 = 180_000.0;
pub const G_RESERVE: f64 = 40_000.0;
pub const G_HOT_WRITE_BYTE: f64 = 0.064;
/// yoctoNEAR per Ggas at NEAR's minimum gas price (10^8 yocto per gas): 1 TGas = 0.0001 NEAR.
pub const YOCTO_PER_GGAS: f64 = 1e17;

// ---------- the rules ----------

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
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
    keepers: Vec<String>,
    slide_cells_price: String,
    slide_min_cells: u32,
    slide_discount_bps: u16,
    slide_royalty_bps: u16,
    wnear: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Rules {
    pub width: u16,
    pub height: u16,
    pub generation_ms: u64,
    pub max_supply: u128,
    pub feed_ppm: u32,
    pub keeper_bps: u16,
    pub reach: u32,
    pub stake_keep_bps: u16,
    pub burn_bps: u16,
    pub payback: u32,
    pub min_cell_price: u128,
    pub live_floor: u32,
    pub petri_price: u128,
    pub min_join: u128,
    pub cell_fee: u128,
    pub tide_every: u64,
    pub tide_bps: u16,
    pub tide_bounty_bps: u16,
    pub max_bounty: u128,
    pub sell_bps: u16,
    pub sell_cap_bps: u16,
    pub siege_x: u32,
    pub buffer: u16,
    pub max_plant_cells: u32,
    pub max_catchup: u64,
    pub max_lag: u64,
    pub house: Vec<String>,
    pub keepers: Vec<String>,
    pub slide_cells_price: u128,
    pub slide_min_cells: u32,
    pub slide_discount_bps: u16,
    pub slide_royalty_bps: u16,
    pub wnear: Option<String>,
    // Simulator-only switches for fix experiments (not contract rules).
    /// A royalty owed by a colony that never attached NEAR goes back to the agar instead of to the slide's holder.
    pub royalty_guest_to_agar: bool,
    /// A tide entry stores nothing beyond its history checkpoint (~120 B): the shares go in an event.
    pub small_tide_entry: bool,
    /// The keeper pot also goes to whoever's call (plant, join, ...) runs a generation, not only `advance`.
    pub pot_any_call: bool,
    /// A hot row leaves the table once its stake is below this (0 = the launched rule: only at 0). Below
    /// STAKE_UNIT / reach (125 at reach 8) its pay cap is under one cell, so it earns nothing either way.
    pub hot_evict_stake: u64,
    /// A tide pays no colony more than this share (bps) of the tide; the rest stays in the vault (10000 = off).
    pub tide_cap_bps: u16,
    pub overrides: Vec<String>,
}

impl Rules {
    pub fn load(path: &str, sets: &[(String, String)]) -> Rules {
        let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("cannot read {}: {}", path, e));
        let j: LaunchJson = serde_json::from_str(&text).expect("launch rules do not match the v6 Rules");
        let p = |s: &str| s.parse::<u128>().expect("a U128 field is not a number");
        let r = Rules {
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
            keepers: j.keepers,
            slide_cells_price: p(&j.slide_cells_price),
            slide_min_cells: j.slide_min_cells,
            slide_discount_bps: j.slide_discount_bps,
            slide_royalty_bps: j.slide_royalty_bps,
            wnear: j.wnear,
            royalty_guest_to_agar: false,
            small_tide_entry: false,
            pot_any_call: false,
            hot_evict_stake: 0,
            tide_cap_bps: 10_000,
            overrides: vec![],
        };
        let refs: Vec<(&str, &str)> = sets.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        r.with(&refs)
    }

    /// A copy with overrides (contract fields by name, and the simulator's fix switches).
    pub fn with(&self, sets: &[(&str, &str)]) -> Rules {
        let mut r = self.clone();
        for &(k, v) in sets {
            let n = || v.parse::<u128>().unwrap_or_else(|_| panic!("{} needs a number", k));
            let b = matches!(v, "1" | "true" | "yes");
            match k {
                "feed_ppm" => r.feed_ppm = n() as u32,
                "reach" => r.reach = n() as u32,
                "stake_keep_bps" => r.stake_keep_bps = n() as u16,
                "live_floor" => r.live_floor = n() as u32,
                "tide_bps" => r.tide_bps = n() as u16,
                "tide_every" => r.tide_every = n() as u64,
                "tide_bounty_bps" => r.tide_bounty_bps = n() as u16,
                "sell_bps" => r.sell_bps = n() as u16,
                "sell_cap_bps" => r.sell_cap_bps = n() as u16,
                "siege_x" => r.siege_x = n() as u32,
                "cell_fee" => r.cell_fee = n(),
                "min_cell_price" => r.min_cell_price = n(),
                "min_join" => r.min_join = n(),
                "payback" => r.payback = n() as u32,
                "slide_discount_bps" => r.slide_discount_bps = n() as u16,
                "slide_royalty_bps" => r.slide_royalty_bps = n() as u16,
                "slide_cells_price" => r.slide_cells_price = n(),
                "royalty_guest_to_agar" => r.royalty_guest_to_agar = b,
                "small_tide_entry" => r.small_tide_entry = b,
                "pot_any_call" => r.pot_any_call = b,
                "hot_evict_stake" => r.hot_evict_stake = n() as u64,
                "tide_cap_bps" => r.tide_cap_bps = n() as u16,
                _ => panic!("cannot override {}", k),
            }
            r.overrides.push(format!("{}={}", k, v));
        }
        r
    }

    /// The curve constant, as the contract computes it: launch price per unit x full supply.
    pub fn k(&self) -> u128 {
        self.petri_price / 1_000_000 * self.max_supply
    }

    pub fn gens_per_day(&self) -> u64 {
        86_400_000 / self.generation_ms
    }

    pub fn tide_bytes(&self) -> u128 {
        if self.small_tide_entry {
            120
        } else {
            TIDE_BYTES
        }
    }

    /// The economic parameters (everything but account names), to show the two rule files agree.
    pub fn economics(&self) -> String {
        format!(
            "{}x{} {}ms supply {} feed {} keeper {} reach {} keep {} burn {} payback {} floor {} live_floor {} price {} min_join {} fee {} tide {}/{} bounty {}/{} sell {}/{} siege {} buffer {} max {} catchup {} lag {} slide {}/{}/{}/{}",
            self.width, self.height, self.generation_ms, self.max_supply, self.feed_ppm, self.keeper_bps, self.reach, self.stake_keep_bps, self.burn_bps, self.payback, self.min_cell_price, self.live_floor, self.petri_price, self.min_join, self.cell_fee, self.tide_every, self.tide_bps, self.tide_bounty_bps, self.max_bounty, self.sell_bps, self.sell_cap_bps, self.siege_x, self.buffer, self.max_plant_cells, self.max_catchup, self.max_lag, self.slide_cells_price, self.slide_min_cells, self.slide_discount_bps, self.slide_royalty_bps
        )
    }
}

pub fn nf(y: u128) -> f64 {
    y as f64 / NEAR as f64
}

pub fn pf(u: u128) -> f64 {
    u as f64 / UNIT as f64
}
