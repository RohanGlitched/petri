//! The Petri dish on NEAR.
//!
//! One contract holds the dish, the clock, the plant log and the PETRI token. The rules are in `petri-core`; this
//! file only stores state, keeps time, moves PETRI and enforces who may plant what. Parameters are fixed in `new`
//! and there is no method that changes them.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, Vector};
use near_sdk::{
    env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use petri_core::{chain_due, chain_next, plant_cost, split_emission, Dish, PlantError};

mod token;

const BOARD_KEY: &[u8] = b"board";
const CHECKPOINT_EVERY: u64 = 240;
const MAX_NAME: usize = 24;
const MAX_NOTE: usize = 140;
const NOTE_PREFIX: &[u8] = b"n";

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
    /// Share of each generation's feed paid to whoever advanced it.
    pub keeper_bps: u16,
    /// Share of a planting's cost that is burned; the rest goes back into the agar.
    pub burn_bps: u16,
    pub plant_cost: U128,
    /// Live cells at which planting costs twice `plant_cost` (it scales linearly with the living population).
    pub capacity: u32,
    pub starter_grant: U128,
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
    pub petri_burned: U128,
    pub petri_earned: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct PlantRecord {
    pub generation: U64,
    pub colony: u16,
    pub cells: Vec<u32>,
}

/// A planting as the `plants` view returns it, with its lab note if it has one.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlantView {
    pub generation: U64,
    pub colony: u16,
    pub cells: Vec<u32>,
    pub note: Option<String>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub generation: U64,
    pub chain: String,
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
    pub plants: U64,
    pub total_supply: U128,
    pub agar: U128,
    pub granted: U128,
    pub fed: U128,
    pub returned: U128,
    pub burned: U128,
    pub keeper_paid: U128,
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
    plants: Vector<PlantRecord>,
    checkpoints: Vector<Checkpoint>,
    balances: LookupMap<AccountId, u128>,
    /// PETRI still in the agar (held by the contract itself).
    agar: u128,
    granted: u128,
    fed: u128,
    returned: u128,
    burned: u128,
    keeper_paid: u128,
}

#[near]
impl Petri {
    #[init]
    pub fn new(rules: Rules) -> Self {
        require!(rules.width >= 16 && rules.height >= 16, "dish too small");
        require!((rules.width as u32) * (rules.height as u32) <= 65_536, "dish too large");
        require!(rules.generation_ms.0 >= 1_000, "generations must be at least a second apart");
        require!(rules.keeper_bps <= 10_000, "keeper share above 100%");
        require!(rules.burn_bps <= 10_000, "burn share above 100%");
        require!(rules.feed_ppm <= 1_000_000, "feed above 100% per generation");
        require!(rules.max_catchup >= 1, "max_catchup must be at least 1");
        require!(rules.capacity >= 1, "capacity must be at least 1");
        let dish = Dish::new(rules.width, rules.height);
        env::storage_write(BOARD_KEY, &dish.to_compact());
        let epoch_ms = env::block_timestamp_ms();
        let mut this = Self {
            rules,
            epoch_ms,
            generation: 0,
            chain: [0; 32],
            total_live: 0,
            colonies: Vector::new(b"c"),
            colony_of: LookupMap::new(b"o"),
            plants: Vector::new(b"p"),
            checkpoints: Vector::new(b"k"),
            balances: LookupMap::new(b"b"),
            agar: 0,
            granted: 0,
            fed: 0,
            returned: 0,
            burned: 0,
            keeper_paid: 0,
        };
        this.agar = this.rules.max_supply.0;
        token::emit_mint(&env::current_account_id(), this.agar, "launch: every PETRI starts in the agar");
        this.checkpoints.push(Checkpoint { generation: U64(0), chain: hex::encode(this.chain) });
        this
    }

    // ---------- the dish ----------

    /// Join the dish as a colony. Once per account. Grants `starter_grant` PETRI.
    pub fn join(&mut self, name: String, color: u32) -> Colony {
        let account = env::predecessor_account_id();
        require!(self.colony_of.get(&account).is_none(), "this account already has a colony");
        let name = name.trim().to_string();
        require!(!name.is_empty() && name.chars().count() <= MAX_NAME, "name must be 1 to 24 characters");
        require!(color <= 0xFF_FF_FF, "color must be 0xRRGGBB");
        require!(self.colonies.len() < u16::MAX as u32, "the dish is full of colonies");
        self.catch_up(self.rules.max_catchup as u64, &account);
        let id = (self.colonies.len() + 1) as u16;
        let colony = Colony {
            id,
            account: account.clone(),
            name: name.clone(),
            color,
            joined_generation: U64(self.generation),
            last_plant_generation: None,
            cells_planted: U64(0),
            petri_burned: U128(0),
            petri_earned: U128(0),
        };
        self.colonies.push(colony.clone());
        self.colony_of.insert(account.clone(), id);
        let grant = self.rules.starter_grant.0.min(self.agar);
        self.agar -= grant;
        self.credit(&account, grant);
        self.granted += grant;
        token::emit_transfer_pub(&env::current_account_id(), &account, grant, "starter grant from the agar");
        emit("join", json!({ "colony": id, "account": account, "name": name, "color": color, "generation": U64(self.generation) }));
        colony
    }

    /// Bring cells to life. `cells` are flat indices (`y * width + x`). `note` is an optional lab note (up to 140
    /// characters) stored with the planting; the AI strains use it to say why they planted.
    pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>) -> U64 {
        let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
        if let Some(n) = &note {
            require!(n.chars().count() <= MAX_NOTE, "a lab note is at most 140 characters");
        }
        let account = env::predecessor_account_id();
        let id = self.colony_of.get(&account).copied().unwrap_or_else(|| env::panic_str("join the dish first"));
        self.catch_up(self.rules.max_catchup as u64, &account);
        require!(
            self.generation == self.due_generation(),
            "the dish is behind the clock; call advance first"
        );
        let mut colony = self.colonies.get(id as u32 - 1).cloned().unwrap();
        if let Some(last) = colony.last_plant_generation {
            require!(last.0 < self.generation, "one planting per generation; wait for the next one");
        }
        let mut dish = self.load_dish();
        if let Err(e) = dish.check_plant(id, &cells, self.rules.buffer, self.rules.max_plant_cells) {
            env::panic_str(&plant_error_text(&dish, e));
        }
        let cost = plant_cost(self.rules.plant_cost.0, cells.len() as u32, self.total_live, self.rules.capacity);
        let balance = self.balance(&account);
        require!(balance >= cost, format!("planting {} cells costs {} PETRI; you hold {}", cells.len(), fmt_petri(cost), fmt_petri(balance)));
        let burn = cost * self.rules.burn_bps as u128 / 10_000;
        self.burn(&account, burn, "planting");
        if cost > burn {
            let back = cost - burn;
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
        colony.petri_burned = U128(colony.petri_burned.0 + cost);
        self.colonies.set(id as u32 - 1, colony);
        if let Some(n) = &note {
            env::storage_write(&note_key(self.plants.len() as u64), n.as_bytes());
        }
        self.plants.push(PlantRecord { generation: U64(self.generation), colony: id, cells: cells.clone() });
        emit("plant", json!({ "colony": id, "generation": U64(self.generation), "cells": cells.len(), "cost": U128(cost), "note": note }));
        U64(self.generation)
    }

    /// Catch up to `max` due generations (capped at `max_catchup`). The caller earns the keeper share.
    pub fn advance(&mut self, max: Option<u32>) -> U64 {
        let cap = max.unwrap_or(self.rules.max_catchup).min(self.rules.max_catchup) as u64;
        let caller = env::predecessor_account_id();
        let done = self.catch_up(cap, &caller);
        log!("advanced {} generation(s), now at {}", done, self.generation);
        U64(self.generation)
    }

    // ---------- views ----------

    /// What planting `cells` cells would cost right now (before any catch-up the planting itself triggers).
    pub fn quote(&self, cells: u32) -> U128 {
        U128(plant_cost(self.rules.plant_cost.0, cells, self.total_live, self.rules.capacity))
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
            plants: U64(self.plants.len() as u64),
            total_supply: U128(self.total_supply()),
            agar: U128(self.agar),
            granted: U128(self.granted),
            fed: U128(self.fed),
            returned: U128(self.returned),
            burned: U128(self.burned),
            keeper_paid: U128(self.keeper_paid),
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

    /// The plant log. Replaying it from an empty dish with `petri-core` reproduces every generation.
    pub fn plants(&self, from: Option<u64>, limit: Option<u32>) -> Vec<PlantView> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.plants.len().min(from.saturating_add(limit)))
            .filter_map(|i| {
                self.plants.get(i).map(|p| PlantView {
                    generation: p.generation,
                    colony: p.colony,
                    cells: p.cells.clone(),
                    note: env::storage_read(&note_key(i as u64)).and_then(|b| String::from_utf8(b).ok()),
                })
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

    fn load_dish(&self) -> Dish {
        let bytes = env::storage_read(BOARD_KEY).unwrap();
        Dish::from_compact(self.rules.width, self.rules.height, &bytes).unwrap()
    }

    fn store_dish(&self, dish: &Dish) {
        env::storage_write(BOARD_KEY, &dish.to_compact());
    }

    /// Step up to `cap` due generations, paying emission. Returns how many ran.
    fn catch_up(&mut self, cap: u64, keeper: &AccountId) -> u64 {
        let due = self.due_generation();
        if self.generation >= due || cap == 0 {
            return 0;
        }
        let target = due.min(self.generation + cap);
        let mut dish = self.load_dish();
        let n = self.colonies.len() as u16;
        let mut earned = vec![0u128; n as usize + 1];
        let mut keeper_total = 0u128;
        let mut ran = 0u64;
        let mut agar = self.agar;
        while self.generation < target {
            let stats = dish.step(n);
            self.generation += 1;
            if chain_due(self.generation) {
                self.chain = chain_next(&self.chain, self.generation, &dish.hash());
            }
            self.total_live = stats.total_live;
            if stats.total_live > 0 {
                let feed = agar * self.rules.feed_ppm as u128 / 1_000_000;
                let keeper_cut = feed * self.rules.keeper_bps as u128 / 10_000;
                let mut paid = keeper_cut;
                for (c, s) in split_emission(feed - keeper_cut, &stats.live, stats.total_live).into_iter().enumerate() {
                    earned[c] += s;
                    paid += s;
                }
                keeper_total += keeper_cut;
                agar -= paid;
            }
            if self.generation % CHECKPOINT_EVERY == 0 {
                self.checkpoints.push(Checkpoint { generation: U64(self.generation), chain: hex::encode(self.chain) });
            }
            ran += 1;
        }
        self.store_dish(&dish);
        let mut total = 0u128;
        for (c, amount) in earned.into_iter().enumerate().skip(1) {
            if amount == 0 {
                continue;
            }
            let mut colony = self.colonies.get(c as u32 - 1).cloned().unwrap();
            colony.petri_earned = U128(colony.petri_earned.0 + amount);
            let account = colony.account.clone();
            self.colonies.set(c as u32 - 1, colony);
            self.credit(&account, amount);
            total += amount;
        }
        if keeper_total > 0 {
            self.credit(keeper, keeper_total);
            self.keeper_paid += keeper_total;
            total += keeper_total;
        }
        self.agar -= total;
        self.fed += total;
        if total > 0 {
            token::emit_transfer_pub(&env::current_account_id(), keeper, total, "the agar feeds the living");
        }
        emit("generation", json!({ "from": U64(self.generation - ran), "to": U64(self.generation), "live": self.total_live, "minted": U128(total), "keeper": keeper }));
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
        if *account == env::current_account_id() {
            return self.agar;
        }
        self.balances.get(account).copied().unwrap_or(0)
    }

    /// Every PETRI minted at launch minus everything burned since. Includes the agar.
    pub(crate) fn total_supply(&self) -> u128 {
        self.rules.max_supply.0 - self.burned
    }
}

fn note_key(index: u64) -> Vec<u8> {
    let mut k = NOTE_PREFIX.to_vec();
    k.extend_from_slice(&index.to_le_bytes());
    k
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({ "standard": "petri", "version": "1.0.0", "event": event, "data": [data] }));
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
