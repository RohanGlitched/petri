//! The Petri dish on NEAR.
//!
//! One contract holds the dish, the clock, the ledger and the PETRI token. The rules are in `petri-core`; this file
//! stores state, keeps time, moves PETRI and NEAR, and enforces who may plant what. Parameters are fixed in `new` and
//! there is no method that changes them.
//!
//! The economy:
//! - All PETRI is minted once into the agar (the contract's own reserve). The agar sells PETRI for NEAR at a price
//!   that rises as it empties, and feeds a share of itself to living cells every generation.
//! - Planting costs PETRI at a price that tracks what a cell earns; half is burned, half goes back to the agar.
//! - NEAR paid in (purchases and planting fees, minus the storage they use) collects in the tide vault. Every
//!   `tide_every` generations part of the vault is paid out to colonies by territory.
//! - Earnings accrue in one record and are claimed by the colony, so catching up never touches per-account state.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use petri_core::{chain_due, chain_next, feed, feed_per_cell, feed_weights, petri_for_near, plant_price, split_by_weight, Dish, PlantError};

mod token;

const BOARD_KEY: &[u8] = b"board";
const EARNED_KEY: &[u8] = b"u";
const TIDES_KEY: &[u8] = b"t";
const CHECKPOINT_EVERY: u64 = 240;
const MAX_NAME_BYTES: usize = 48;
const MAX_NAME_CHARS: usize = 24;
const MAX_NOTE_BYTES: usize = 280;
const MAX_NOTE_CHARS: usize = 140;
const NOTE_PREFIX: &[u8] = b"n";
/// Storage a planting is charged for beyond its cells and note: the ledger entry's fixed part and the colony update.
const PLANT_STORAGE_BASE: u64 = 260;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Rules {
    pub width: u16,
    pub height: u16,
    pub generation_ms: U64,
    /// Every PETRI that will ever exist. All of it starts in the agar.
    pub max_supply: U128,
    /// Share of the agar fed to the living each generation, in parts per million.
    pub feed_ppm: u32,
    /// Share of each generation's feed set aside in the keeper pot, paid to whoever calls `advance`.
    pub keeper_bps: u16,
    /// No colony counts for more than this share of all living cells when the feed and the tides are split.
    pub cap_bps: u16,
    /// The cap is never below this many cells.
    pub cap_min: u32,
    /// Share of a planting's cost that is burned; the rest goes back into the agar.
    pub burn_bps: u16,
    /// A cell costs what an average cell earns in this many generations at today's feed.
    pub payback: u32,
    /// The lowest price of one cell, in PETRI units.
    pub min_cell_price: U128,
    /// The price counts at least this many living cells, so it stays sane on a nearly empty dish.
    pub live_floor: u32,
    /// Launch price of one PETRI in yoctoNEAR. The agar sells at this × max_supply / agar.
    pub petri_price: U128,
    /// The least NEAR a colony brings when it joins (it buys PETRI and pays for the colony's storage).
    pub min_join: U128,
    /// NEAR per planted cell, on top of the storage the planting uses. It goes to the tide vault.
    pub cell_fee: U128,
    pub tide_every: u32,
    /// Share of the vault paid out at each tide.
    pub tide_bps: u16,
    pub buffer: u16,
    pub max_plant_cells: u32,
    pub max_catchup: u32,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Colony {
    pub id: u16,
    pub account: AccountId,
    pub name: String,
    /// 0xRRGGBB
    pub color: u32,
    pub joined_generation: U64,
    pub last_plant_generation: Option<U64>,
    pub cells_planted: U64,
    /// Everything paid for plantings (half of it burned, half returned to the agar).
    pub petri_spent: U128,
    pub petri_burned: U128,
    /// PETRI earned and already claimed into the balance. Unclaimed earnings are in `claimable`.
    pub petri_claimed: U128,
    pub near_paid: U128,
    pub near_claimed: U128,
}

/// One entry of the ledger: everything that changes the dish or the agar, in order. Replaying it reproduces both.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum Entry {
    Join { generation: U64, colony: u16 },
    Buy { generation: U64, colony: u16, petri: U128, near: U128 },
    Plant { generation: U64, colony: u16, cells: Vec<u32>, cost: U128 },
}

/// A planting as the `plants` view returns it, with its index in the ledger and its lab note if it has one.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlantView {
    pub index: U64,
    pub generation: U64,
    pub colony: u16,
    pub cells: Vec<u32>,
    pub cost: U128,
    pub note: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub generation: U64,
    pub chain: String,
}

#[near(serializers = [json])]
pub struct Claimable {
    pub petri: U128,
    pub near: U128,
}

#[near(serializers = [json])]
pub struct DishState {
    pub generation: U64,
    pub due_generation: U64,
    pub epoch_ms: U64,
    pub now_ms: U64,
    pub chain: String,
    pub board_hash: String,
    pub total_live: u32,
    pub colonies: u16,
    pub ledger: U64,
    pub plants: U64,
    pub total_supply: U128,
    pub agar: U128,
    pub sold: U128,
    pub fed: U128,
    pub returned: U128,
    pub burned: U128,
    pub keeper_pot: U128,
    pub keeper_paid: U128,
    /// NEAR waiting in the tide vault, in yoctoNEAR.
    pub vault: U128,
    pub near_in: U128,
    pub near_tides: U128,
    pub tides: U64,
    /// What one cell costs to plant right now, in PETRI units.
    pub cell_price: U128,
    /// What one PETRI costs from the agar right now, in yoctoNEAR.
    pub petri_price: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Petri {
    rules: Rules,
    epoch_ms: u64,
    generation: u64,
    chain: [u8; 32],
    total_live: u32,
    colonies: Vector<Colony>,
    colony_of: LookupMap<AccountId, u16>,
    names: LookupSet<String>,
    ledger: Vector<Entry>,
    plant_count: u64,
    plant_index: Vector<u64>,
    checkpoints: Vector<Checkpoint>,
    balances: LookupMap<AccountId, u128>,
    /// PETRI still in the agar (held by the contract itself).
    agar: u128,
    sold: u128,
    fed: u128,
    returned: u128,
    burned: u128,
    keeper_pot: u128,
    keeper_paid: u128,
    vault: u128,
    near_in: u128,
    near_tides: u128,
    tides: u64,
}

#[near]
impl Petri {
    #[init]
    pub fn new(rules: Rules) -> Self {
        require!(rules.width >= 16 && rules.height >= 16, "dish too small");
        require!((rules.width as u32) * (rules.height as u32) <= 65_536, "dish too large");
        require!(rules.generation_ms.0 >= 1_000, "generations must be at least a second apart");
        require!(rules.keeper_bps <= 10_000 && rules.burn_bps <= 10_000 && rules.cap_bps <= 10_000 && rules.tide_bps <= 10_000, "a share is above 100%");
        require!(rules.feed_ppm <= 1_000_000, "feed above 100% per generation");
        require!(rules.max_catchup >= 1 && rules.tide_every >= 1, "max_catchup and tide_every must be at least 1");
        require!(rules.petri_price.0 > 0, "PETRI needs a price");
        let dish = Dish::new(rules.width, rules.height);
        env::storage_write(BOARD_KEY, &dish.to_compact());
        env::storage_write(EARNED_KEY, &[]);
        env::storage_write(TIDES_KEY, &[]);
        let mut this = Self {
            agar: rules.max_supply.0,
            rules,
            epoch_ms: env::block_timestamp_ms(),
            generation: 0,
            chain: [0; 32],
            total_live: 0,
            colonies: Vector::new(b"c"),
            colony_of: LookupMap::new(b"o"),
            names: LookupSet::new(b"m"),
            ledger: Vector::new(b"l"),
            plant_count: 0,
            plant_index: Vector::new(b"i"),
            checkpoints: Vector::new(b"k"),
            balances: LookupMap::new(b"b"),
            sold: 0,
            fed: 0,
            returned: 0,
            burned: 0,
            keeper_pot: 0,
            keeper_paid: 0,
            vault: 0,
            near_in: 0,
            near_tides: 0,
            tides: 0,
        };
        token::emit_mint(&env::current_account_id(), this.agar, "launch: every PETRI starts in the agar");
        this.checkpoints.push(Checkpoint { generation: U64(0), chain: hex::encode(this.chain) });
        this
    }

    // ---------- the dish ----------

    /// Join the dish as a colony, once per account. The attached NEAR pays for the colony's storage and the rest buys
    /// PETRI from the agar; that NEAR goes to the tide vault.
    #[payable]
    pub fn join(&mut self, name: String, color: u32) -> Colony {
        let account = caller();
        require!(self.colony_of.get(&account).is_none(), "this account already has a colony");
        let name = clean_text(&name, MAX_NAME_CHARS, MAX_NAME_BYTES, "name");
        require!(!name.is_empty(), "name must be 1 to 24 characters");
        let key = name.to_lowercase();
        require!(!self.names.contains(&key), "a colony with that name already exists");
        require!(color <= 0xFF_FF_FF, "color must be 0xRRGGBB");
        require!(self.colonies.len() < u16::MAX as u32 - 1, "the dish is full of colonies");
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= self.rules.min_join.0, format!("joining needs at least {} NEAR", fmt_near(self.rules.min_join.0)));
        self.catch_up(self.rules.max_catchup as u64);
        let before = env::storage_usage();
        let id = (self.colonies.len() + 1) as u16;
        let colony = Colony {
            id,
            account: account.clone(),
            name: name.clone(),
            color,
            joined_generation: U64(self.generation),
            last_plant_generation: None,
            cells_planted: U64(0),
            petri_spent: U128(0),
            petri_burned: U128(0),
            petri_claimed: U128(0),
            near_paid: U128(0),
            near_claimed: U128(0),
        };
        self.colonies.push(colony);
        self.colony_of.insert(account.clone(), id);
        self.names.insert(key);
        if !self.balances.contains_key(&account) {
            self.balances.insert(account.clone(), 0);
        }
        self.ledger.push(Entry::Join { generation: U64(self.generation), colony: id });
        let mut earned = self.load_u64s(EARNED_KEY);
        earned.push(0);
        self.store_u64s(EARNED_KEY, &earned);
        let mut tides = self.load_u128s(TIDES_KEY);
        tides.push(0);
        self.store_u128s(TIDES_KEY, &tides);
        self.colonies.flush();
        self.ledger.flush();
        self.colony_of.flush();
        self.balances.flush();
        // The purchase below adds one more ledger entry; charge for it up front.
        let storage = self.storage_cost_since(before) + 128 * env::storage_byte_cost().as_yoctonear();
        require!(deposit > storage, format!("joining needs more than the {} NEAR its storage costs", fmt_near(storage)));
        let bought = self.sell_petri(id, &account, deposit - storage);
        emit("join", json!({ "colony": id, "account": account, "name": name, "color": color, "generation": U64(self.generation), "petri": U128(bought) }));
        self.colony(id)
    }

    /// Buy PETRI from the agar with the attached NEAR. The price rises as the agar empties; the NEAR goes to the tide
    /// vault. Only colonies buy, so every purchase is in the ledger.
    #[payable]
    pub fn buy(&mut self) -> U128 {
        let account = caller();
        let id = self.colony_id(&account);
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > 0, "attach NEAR to buy PETRI");
        self.catch_up(self.rules.max_catchup as u64);
        U128(self.sell_petri(id, &account, deposit))
    }

    /// Bring cells to life. `cells` are flat indices (`y * width + x`). `note` is an optional lab note (up to 140
    /// characters) stored with the planting. Attach NEAR for the storage the planting uses plus `cell_fee` per cell
    /// (see `plant_deposit`); anything above the storage goes to the tide vault.
    #[payable]
    pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>) -> U64 {
        let account = caller();
        let note = note.map(|n| clean_text(&n, MAX_NOTE_CHARS, MAX_NOTE_BYTES, "a lab note")).filter(|n| !n.is_empty());
        let id = self.colony_id(&account);
        self.catch_up(self.rules.max_catchup as u64);
        require!(self.generation == self.due_generation(), "the dish is behind the clock; call advance first");
        // Earnings waiting for this colony count towards the price.
        self.claim_petri(id, &account);
        let mut colony = self.colony(id);
        if let Some(last) = colony.last_plant_generation {
            require!(last.0 < self.generation, "one planting per generation; wait for the next one");
        }
        let mut dish = self.load_dish();
        if let Err(e) = dish.check_plant(id, &cells, self.rules.buffer, self.rules.max_plant_cells) {
            env::panic_str(&plant_error_text(&dish, e));
        }
        let deposit = env::attached_deposit().as_yoctonear();
        let fee = self.rules.cell_fee.0 * cells.len() as u128;
        require!(deposit >= fee, format!("planting {} cells needs at least {} NEAR attached", cells.len(), fmt_near(self.plant_deposit(cells.len() as u32, note.as_ref().map(|n| n.len() as u32)).0)));
        let cost = self.cell_price_now() * cells.len() as u128;
        let balance = self.balance(&account);
        require!(balance >= cost, format!("planting {} cells costs {} PETRI; you hold {}", cells.len(), fmt_petri(cost), fmt_petri(balance)));
        let before = env::storage_usage();
        let burn = cost * self.rules.burn_bps as u128 / 10_000;
        self.burn(&account, burn, "planting");
        let back = cost - burn;
        if back > 0 {
            let held = self.balance(&account);
            self.balances.insert(account.clone(), held - back);
            self.agar += back;
            self.returned += back;
            token::emit_transfer_pub(&account, &env::current_account_id(), back, "planting feeds the agar");
        }
        dish.plant_unchecked(id, &cells);
        self.store_dish(&dish);
        self.total_live += cells.len() as u32;
        colony.last_plant_generation = Some(U64(self.generation));
        colony.cells_planted = U64(colony.cells_planted.0 + cells.len() as u64);
        colony.petri_spent = U128(colony.petri_spent.0 + cost);
        colony.petri_burned = U128(colony.petri_burned.0 + burn);
        colony.near_paid = U128(colony.near_paid.0 + deposit);
        let index = self.ledger.len() as u64;
        if let Some(n) = &note {
            env::storage_write(&note_key(index), n.as_bytes());
        }
        self.ledger.push(Entry::Plant { generation: U64(self.generation), colony: id, cells: cells.clone(), cost: U128(cost) });
        self.plant_index.push(index);
        self.plant_count += 1;
        self.colonies.set(id as u32 - 1, colony);
        self.colonies.flush();
        self.ledger.flush();
        self.plant_index.flush();
        let storage = self.storage_cost_since(before);
        require!(deposit >= storage + fee, format!("this planting needs {} NEAR attached for its storage and fee", fmt_near(storage + fee)));
        self.vault += deposit - storage;
        self.near_in += deposit - storage;
        emit("plant", json!({ "colony": id, "generation": U64(self.generation), "cells": cells.len(), "cost": U128(cost), "near": U128(deposit), "note": note }));
        U64(self.generation)
    }

    /// Catch up to `max` due generations (capped at `max_catchup`), then pay the keeper pot to the caller.
    pub fn advance(&mut self, max: Option<u32>) -> U64 {
        let caller = caller();
        let cap = max.unwrap_or(self.rules.max_catchup).min(self.rules.max_catchup) as u64;
        let done = self.catch_up(cap);
        let pot = self.keeper_pot;
        // The pot goes to a registered caller; anyone else still moves the dish forward and leaves the pot.
        if pot > 0 && self.balances.contains_key(&caller) {
            self.keeper_pot = 0;
            self.keeper_paid += pot;
            self.credit(&caller, pot);
            token::emit_transfer_pub(&env::current_account_id(), &caller, pot, "keeper pot");
        }
        log!("advanced {} generation(s), now at {}", done, self.generation);
        U64(self.generation)
    }

    /// Move this colony's earnings into its balance and send it the NEAR it has won at the tides.
    pub fn claim(&mut self) -> Claimable {
        let account = caller();
        let id = self.colony_id(&account);
        self.catch_up(self.rules.max_catchup as u64);
        let petri = self.claim_petri(id, &account);
        let mut tides = self.load_u128s(TIDES_KEY);
        let near = tides.get(id as usize).copied().unwrap_or(0);
        if near > 0 {
            tides[id as usize] = 0;
            self.store_u128s(TIDES_KEY, &tides);
            let mut c = self.colony(id);
            c.near_claimed = U128(c.near_claimed.0 + near);
            self.colonies.set(id as u32 - 1, c);
            let _ = Promise::new(account.clone()).transfer(NearToken::from_yoctonear(near));
        }
        emit("claim", json!({ "colony": id, "petri": U128(petri), "near": U128(near) }));
        Claimable { petri: U128(petri), near: U128(near) }
    }

    // ---------- views ----------

    /// What planting `cells` cells costs right now, in PETRI units (before any catch-up the planting triggers).
    pub fn quote(&self, cells: u32) -> U128 {
        U128(self.cell_price_now() * cells as u128)
    }

    /// The NEAR to attach to a planting of `cells` cells with a note of `note_bytes` bytes: its storage plus the fee.
    pub fn plant_deposit(&self, cells: u32, note_bytes: Option<u32>) -> U128 {
        let bytes = PLANT_STORAGE_BASE + 6 * cells as u64 + note_bytes.map(|b| b as u64 + 64).unwrap_or(0);
        U128(bytes as u128 * env::storage_byte_cost().as_yoctonear() + self.rules.cell_fee.0 * cells as u128)
    }

    /// PETRI that `near` yoctoNEAR would buy from the agar right now.
    pub fn buy_quote(&self, near: U128) -> U128 {
        U128(petri_for_near(near.0, self.agar, self.price_k()))
    }

    pub fn claimable(&self, account_id: AccountId) -> Claimable {
        match self.colony_of.get(&account_id) {
            Some(&id) => Claimable {
                petri: U128(self.load_u64s(EARNED_KEY).get(id as usize).copied().unwrap_or(0) as u128),
                near: U128(self.load_u128s(TIDES_KEY).get(id as usize).copied().unwrap_or(0)),
            },
            None => Claimable { petri: U128(0), near: U128(0) },
        }
    }

    pub fn rules(&self) -> Rules {
        self.rules.clone()
    }

    pub fn state(&self) -> DishState {
        let dish = self.load_dish();
        DishState {
            generation: U64(self.generation),
            due_generation: U64(self.due_generation()),
            epoch_ms: U64(self.epoch_ms),
            now_ms: U64(env::block_timestamp_ms()),
            chain: hex::encode(self.chain),
            board_hash: hex::encode(dish.hash()),
            total_live: self.total_live,
            colonies: self.colonies.len() as u16,
            ledger: U64(self.ledger.len() as u64),
            plants: U64(self.plant_count),
            total_supply: U128(self.total_supply()),
            agar: U128(self.agar),
            sold: U128(self.sold),
            fed: U128(self.fed),
            returned: U128(self.returned),
            burned: U128(self.burned),
            keeper_pot: U128(self.keeper_pot),
            keeper_paid: U128(self.keeper_paid),
            vault: U128(self.vault),
            near_in: U128(self.near_in),
            near_tides: U128(self.near_tides),
            tides: U64(self.tides),
            cell_price: U128(self.cell_price_now()),
            petri_price: U128(self.price_k() / self.agar.max(1) * 1_000_000),
        }
    }

    /// The board at the stored generation in compact form (see `Dish::to_compact`), base64.
    pub fn board(&self) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(env::storage_read(BOARD_KEY).unwrap())
    }

    pub fn colonies(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Colony> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(500);
        (from..self.colonies.len().min(from.saturating_add(limit))).filter_map(|i| self.colonies.get(i).cloned()).collect()
    }

    pub fn colony_of(&self, account_id: AccountId) -> Option<Colony> {
        self.colony_of.get(&account_id).and_then(|&id| self.colonies.get(id as u32 - 1).cloned())
    }

    /// Each colony's earnings so far, claimed or not, in PETRI units (index = colony id - 1).
    pub fn earnings(&self, from: Option<u32>, limit: Option<u32>) -> Vec<U128> {
        let earned = self.load_u64s(EARNED_KEY);
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(2_000);
        (from..self.colonies.len().min(from.saturating_add(limit)))
            .map(|i| {
                let c = self.colonies.get(i).unwrap();
                U128(c.petri_claimed.0 + earned.get(i as usize + 1).copied().unwrap_or(0) as u128)
            })
            .collect()
    }

    /// The ledger: every join, purchase and planting in order. Replaying it from an empty dish with `petri-core`
    /// reproduces every generation, the agar and every colony's earnings.
    pub fn ledger(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Entry> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.ledger.len().min(from.saturating_add(limit))).filter_map(|i| self.ledger.get(i).cloned()).collect()
    }

    /// Plantings only, newest-friendly paging by planting number, with lab notes.
    pub fn plants(&self, from: Option<u64>, limit: Option<u32>) -> Vec<PlantView> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.plant_index.len().min(from.saturating_add(limit)))
            .filter_map(|i| {
                let index = *self.plant_index.get(i)?;
                match self.ledger.get(index as u32)? {
                    Entry::Plant { generation, colony, cells, cost } => Some(PlantView {
                        index: U64(index),
                        generation: *generation,
                        colony: *colony,
                        cells: cells.clone(),
                        cost: *cost,
                        note: env::storage_read(&note_key(index)).and_then(|b| String::from_utf8(b).ok()),
                    }),
                    _ => None,
                }
            })
            .collect()
    }

    /// The history chain every `CHECKPOINT_EVERY` generations.
    pub fn checkpoints(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Checkpoint> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(2_000);
        (from..self.checkpoints.len().min(from.saturating_add(limit))).filter_map(|i| self.checkpoints.get(i).cloned()).collect()
    }

    // ---------- internals ----------

    fn due_generation(&self) -> u64 {
        (env::block_timestamp_ms().saturating_sub(self.epoch_ms)) / self.rules.generation_ms.0
    }

    fn price_k(&self) -> u128 {
        self.rules.petri_price.0 / 1_000_000 * self.rules.max_supply.0
    }

    fn cell_price_now(&self) -> u128 {
        let per_cell = feed_per_cell(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.total_live, self.rules.live_floor);
        plant_price(per_cell, self.rules.payback, self.rules.min_cell_price.0, 1)
    }

    fn sell_petri(&mut self, id: u16, account: &AccountId, near: u128) -> u128 {
        let units = petri_for_near(near, self.agar, self.price_k());
        require!(units > 0, "that is not enough NEAR to buy any PETRI");
        self.agar -= units;
        self.sold += units;
        self.credit(account, units);
        self.vault += near;
        self.near_in += near;
        let mut c = self.colony(id);
        c.near_paid = U128(c.near_paid.0 + near);
        self.colonies.set(id as u32 - 1, c);
        self.ledger.push(Entry::Buy { generation: U64(self.generation), colony: id, petri: U128(units), near: U128(near) });
        token::emit_transfer_pub(&env::current_account_id(), account, units, "bought from the agar");
        units
    }

    fn claim_petri(&mut self, id: u16, account: &AccountId) -> u128 {
        let mut earned = self.load_u64s(EARNED_KEY);
        let amount = earned.get(id as usize).copied().unwrap_or(0) as u128;
        if amount == 0 {
            return 0;
        }
        earned[id as usize] = 0;
        self.store_u64s(EARNED_KEY, &earned);
        let mut c = self.colony(id);
        c.petri_claimed = U128(c.petri_claimed.0 + amount);
        self.colonies.set(id as u32 - 1, c);
        self.credit(account, amount);
        token::emit_transfer_pub(&env::current_account_id(), account, amount, "earnings from the agar");
        amount
    }

    fn colony_id(&self, account: &AccountId) -> u16 {
        self.colony_of.get(account).copied().unwrap_or_else(|| env::panic_str("join the dish first"))
    }

    fn colony(&self, id: u16) -> Colony {
        self.colonies.get(id as u32 - 1).cloned().unwrap()
    }

    fn storage_cost_since(&self, before: u64) -> u128 {
        env::storage_usage().saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear()
    }

    fn load_dish(&self) -> Dish {
        let bytes = env::storage_read(BOARD_KEY).unwrap();
        Dish::from_compact(self.rules.width, self.rules.height, &bytes).unwrap()
    }

    fn store_dish(&self, dish: &Dish) {
        env::storage_write(BOARD_KEY, &dish.to_compact());
    }

    /// Unclaimed earnings by colony id (index 0 unused), in PETRI units.
    fn load_u64s(&self, key: &[u8]) -> Vec<u64> {
        let b = env::storage_read(key).unwrap_or_default();
        let mut v = vec![0u64];
        v.extend(b.chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())));
        v
    }

    fn store_u64s(&self, key: &[u8], v: &[u64]) {
        let mut b = Vec::with_capacity(8 * v.len());
        for x in v.iter().skip(1) {
            b.extend_from_slice(&x.to_le_bytes());
        }
        env::storage_write(key, &b);
    }

    fn load_u128s(&self, key: &[u8]) -> Vec<u128> {
        let b = env::storage_read(key).unwrap_or_default();
        let mut v = vec![0u128];
        v.extend(b.chunks_exact(16).map(|c| u128::from_le_bytes(c.try_into().unwrap())));
        v
    }

    fn store_u128s(&self, key: &[u8], v: &[u128]) {
        let mut b = Vec::with_capacity(16 * v.len());
        for x in v.iter().skip(1) {
            b.extend_from_slice(&x.to_le_bytes());
        }
        env::storage_write(key, &b);
    }

    /// Step up to `cap` due generations: Life, the history chain, the feed (into unclaimed earnings and the keeper
    /// pot) and the tides. Reads and writes one earnings record however many colonies are alive. Returns how many
    /// generations ran.
    fn catch_up(&mut self, cap: u64) -> u64 {
        let due = self.due_generation();
        if self.generation >= due || cap == 0 {
            return 0;
        }
        let target = due.min(self.generation + cap);
        let mut dish = self.load_dish();
        let n = self.colonies.len() as u16;
        let mut earned = self.load_u64s(EARNED_KEY);
        earned.resize(n as usize + 1, 0);
        let mut tides: Option<Vec<u128>> = None;
        let mut fed = 0u128;
        let from = self.generation;
        while self.generation < target {
            let stats = dish.step(n);
            self.generation += 1;
            if chain_due(self.generation) {
                self.chain = chain_next(&self.chain, self.generation, &dish.hash());
            }
            self.total_live = stats.total_live;
            let f = feed(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.rules.cap_bps, self.rules.cap_min, &stats.live);
            if f.paid > 0 {
                for (c, s) in f.shares.iter().enumerate().skip(1) {
                    if *s > 0 {
                        earned[c] += *s as u64;
                    }
                }
                self.agar -= f.paid;
                self.keeper_pot += f.keeper;
                fed += f.paid;
            }
            if self.generation % self.rules.tide_every as u64 == 0 && self.vault > 0 {
                let pay = self.vault * self.rules.tide_bps as u128 / 10_000;
                let split = split_by_weight(pay, &feed_weights(&stats.live, self.rules.cap_bps, self.rules.cap_min));
                let paid: u128 = split.iter().sum();
                if paid > 0 {
                    let t = tides.get_or_insert_with(|| {
                        let mut v = self.load_u128s(TIDES_KEY);
                        v.resize(n as usize + 1, 0);
                        v
                    });
                    for (c, s) in split.iter().enumerate().skip(1) {
                        t[c] += *s;
                    }
                    self.vault -= paid;
                    self.near_tides += paid;
                    self.tides += 1;
                }
            }
            if self.generation % CHECKPOINT_EVERY == 0 {
                self.checkpoints.push(Checkpoint { generation: U64(self.generation), chain: hex::encode(self.chain) });
            }
        }
        self.store_dish(&dish);
        self.store_u64s(EARNED_KEY, &earned);
        if let Some(t) = tides {
            self.store_u128s(TIDES_KEY, &t);
        }
        self.fed += fed;
        let ran = self.generation - from;
        emit("generation", json!({ "from": U64(from), "to": U64(self.generation), "live": self.total_live, "fed": U128(fed), "keeper_pot": U128(self.keeper_pot) }));
        ran
    }

    fn credit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balance(account);
        self.balances.insert(account.clone(), b + amount);
    }

    fn burn(&mut self, account: &AccountId, amount: u128, memo: &str) {
        let b = self.balance(account);
        require!(b >= amount, "not enough PETRI");
        self.balances.insert(account.clone(), b - amount);
        self.burned += amount;
        token::emit_burn(account, amount, memo);
    }

    fn balance(&self, account: &AccountId) -> u128 {
        self.balances.get(account).copied().unwrap_or(0)
    }

    /// Every PETRI minted at launch minus everything burned since. Includes the agar and unclaimed earnings.
    pub(crate) fn total_supply(&self) -> u128 {
        self.rules.max_supply.0 - self.burned
    }
}

/// The account making the call. The contract itself never acts as a player: its own balance is the agar.
fn caller() -> AccountId {
    let a = env::predecessor_account_id();
    require!(a != env::current_account_id(), "the dish does not play on itself");
    a
}

/// Trim, limit, and refuse text that could disguise itself: control characters, bidirectional overrides and
/// zero-width characters.
fn clean_text(s: &str, max_chars: usize, max_bytes: usize, what: &str) -> String {
    let t = s.trim().to_string();
    for ch in t.chars() {
        let c = ch as u32;
        let hidden = ch.is_control() || (0x200B..=0x200F).contains(&c) || (0x202A..=0x202E).contains(&c) || (0x2066..=0x2069).contains(&c) || c == 0xFEFF || c == 0x061C;
        require!(!hidden, format!("{} may not contain control, direction or zero-width characters", what));
    }
    require!(t.chars().count() <= max_chars && t.len() <= max_bytes, format!("{} is at most {} characters", what, max_chars));
    t
}

fn note_key(index: u64) -> Vec<u8> {
    let mut k = NOTE_PREFIX.to_vec();
    k.extend_from_slice(&index.to_le_bytes());
    k
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({ "standard": "petri", "version": "2.0.0", "event": event, "data": [data] }));
}

pub(crate) fn fmt_petri(units: u128) -> String {
    let whole = units / 1_000_000;
    let frac = units % 1_000_000;
    if frac == 0 {
        format!("{}", whole)
    } else {
        let s = format!("{:06}", frac);
        format!("{}.{}", whole, s.trim_end_matches('0'))
    }
}

pub(crate) fn fmt_near(yocto: u128) -> String {
    let milli = yocto / 1_000_000_000_000_000_000_000;
    format!("{}.{:03}", milli / 1000, milli % 1000)
}

fn plant_error_text(dish: &Dish, e: PlantError) -> String {
    let at = |i: u32| {
        let (x, y) = dish.xy(i as usize);
        format!("({}, {})", x, y)
    };
    match e {
        PlantError::Empty => "plant at least one cell".into(),
        PlantError::TooMany { max } => format!("at most {} cells per planting", max),
        PlantError::OutOfRange { index } => format!("cell {} is off the dish", index),
        PlantError::Duplicate { index } => format!("cell {} is listed twice", at(index)),
        PlantError::Occupied { index } => format!("cell {} is already alive", at(index)),
        PlantError::TooClose { index, rival } => {
            format!("cell {} is inside colony {}'s buffer; plant further away or send a glider", at(index), rival)
        }
    }
}

#[cfg(test)]
mod tests;
