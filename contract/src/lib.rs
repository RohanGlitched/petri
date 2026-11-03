//! The Petri dish on NEAR.
//!
//! One contract holds the dish, the clock, the ledger and the PETRI token. The rules are in `petri-core`; this file
//! stores state, keeps time, moves PETRI and NEAR, and enforces who may plant what. Parameters are fixed in `new` and
//! there is no method that changes them.
//!
//! The economy:
//! - All PETRI is minted once into the agar (the contract's own reserve). The agar sells PETRI for NEAR at a price
//!   that rises as it empties, feeds a share of itself to living cells every generation, and buys PETRI back at half
//!   the curve's price, up to a tenth of the vault each tide.
//! - Planting costs PETRI at a price that tracks what a cell earns (four times that inside a rival's buffer); half is
//!   burned, half goes back to the agar.
//! - A colony is paid for at most `reach` living cells per cell it has planted, so splitting into many colonies never
//!   earns more.
//! - NEAR paid in (purchases and planting fees, minus the storage they use) collects in the tide vault. Every
//!   `tide_every` generations part of the vault is paid out by what each colony earned since the last tide. The
//!   dish's own colonies (the house) take no share, and the caller whose transaction runs the tide gets a bounty.
//! - Every NEAR and PETRI movement that the replay needs is in one ordered ledger.
//! - A sponsor (the site's relayer, for guests) can give an account NEAR credit that can only be spent in the dish.

use near_sdk::json_types::{U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use petri_core::{chain_due, chain_next, feed, feed_per_cell, petri_for_near, planting_cost, sell_back, tide_split, Dish, PlantError};

mod token;

const BOARD_KEY: &[u8] = b"board";
/// Unclaimed earnings by colony (u64 each).
const EARNED_KEY: &[u8] = b"u";
/// NEAR owed from tides by colony (u128 each).
const TIDES_KEY: &[u8] = b"t";
/// Cells each colony has ever planted (u64 each): the base of its pay cap.
const PLANTED_KEY: &[u8] = b"p";
/// Earnings since the last tide by colony (u64 each): the tide's weights.
const WINDOW_KEY: &[u8] = b"w";
const MAX_NAME_BYTES: usize = 24;
const MAX_NAME_CHARS: usize = 24;
const MAX_NOTE_BYTES: usize = 280;
const MAX_NOTE_CHARS: usize = 140;
const NOTE_PREFIX: &[u8] = b"n";
const MAX_HOUSE: usize = 16;
/// Storage a planting is charged for beyond its cells and note: the ledger entry's fixed part and the colony update.
const PLANT_STORAGE_BASE: u64 = 200;
/// A catch-up stops stepping once the call has used this much gas, so no call can be pushed past NEAR's limit.
const CATCHUP_GAS_LIMIT: Gas = Gas::from_tgas(180);
const GAS_FOR_PAYOUT_CHECK: Gas = Gas::from_tgas(5);

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
    /// A colony is paid for at most this many living cells per cell it has ever planted.
    pub reach: u32,
    /// Share of a planting's cost that is burned; the rest goes back into the agar.
    pub burn_bps: u16,
    /// A cell costs what an average cell earns in this many generations at today's feed.
    pub payback: u32,
    /// The lowest price of one cell, in PETRI units.
    pub min_cell_price: U128,
    /// The agar releases its ration for at least this many counted cells, and never more per cell; prices count at
    /// least this many too, so a cell earns what its price assumes even on a nearly empty dish.
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
    /// Share of each tide paid in NEAR to the caller whose transaction runs it, up to `max_bounty`.
    pub tide_bounty_bps: u16,
    pub max_bounty: U128,
    /// The agar buys PETRI back at this share of the curve's price.
    pub sell_bps: u16,
    /// The agar buys back at most this share of the vault between two tides.
    pub sell_cap_bps: u16,
    /// A planting inside a rival's buffer costs this many times the price.
    pub siege_x: u32,
    pub buffer: u16,
    pub max_plant_cells: u32,
    pub max_catchup: u32,
    /// The dish's own players (the keeper's strains). They play like anyone, but they are never fed and take no share
    /// of the tides: every PETRI they plant with, they buy with NEAR, and that NEAR goes to the other players.
    pub house: Vec<AccountId>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Colony {
    pub id: u16,
    pub account: AccountId,
    pub name: String,
    /// 0xRRGGBB
    pub color: u32,
    /// One of the dish's own players: no share of the tides.
    pub house: bool,
    pub joined_generation: U64,
    pub last_plant_generation: Option<U64>,
    pub cells_planted: U64,
    /// Everything paid for plantings (half of it burned, half returned to the agar).
    pub petri_spent: U128,
    pub petri_burned: U128,
    /// PETRI earned and already claimed into the balance. Unclaimed earnings are in `claimable`.
    pub petri_claimed: U128,
    /// PETRI sold back to the agar.
    pub petri_sold: U128,
    /// NEAR brought to the dish (attached or sponsored), storage included.
    pub near_paid: U128,
    /// NEAR won at the tides and claimed.
    pub near_claimed: U128,
    /// NEAR received for PETRI sold back.
    pub near_sold: U128,
}

/// One entry of the ledger: everything that changes the dish, the agar or the vault, in order. Replaying it
/// reproduces all three.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum Entry {
    Join { generation: U64, colony: u16 },
    /// `near` is what reached the vault (after this entry's storage).
    Buy { generation: U64, colony: u16, petri: U128, near: U128 },
    /// `near` is what reached the vault (after the planting's storage). `siege` marks a planting inside a rival's buffer.
    /// Cells are flat indices; a dish has at most 65,536 cells, so each fits in 16 bits.
    Plant { generation: U64, colony: u16, cells: Vec<u16>, cost: U128, near: U128, siege: bool },
    /// `near` left the vault: `paid` to the seller and the rest for this entry's storage.
    Sell { generation: U64, colony: u16, petri: U128, near: U128, paid: U128 },
    /// Every `tide_every` generations: the history chain at that generation, and the tide. `pay` is the vault's share
    /// for this tide; `bounty` went to the caller, `storage` paid for this entry, and `paid` was split between colonies.
    Tide { generation: U64, chain: String, pay: U128, bounty: U128, storage: U128, paid: U128 },
}

/// A planting as the `plants` view returns it, with its index in the ledger and its lab note if it has one.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlantView {
    pub index: U64,
    pub generation: U64,
    pub colony: u16,
    pub cells: Vec<u16>,
    pub cost: U128,
    pub siege: bool,
    pub note: Option<String>,
}

#[near(serializers = [json])]
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
    /// Cells the last feed counted: living cells of fed colonies, capped by reach. Prices are set against this.
    pub counted: u32,
    pub colonies: u16,
    pub ledger: U64,
    pub plants: U64,
    pub total_supply: U128,
    pub agar: U128,
    pub sold: U128,
    pub fed: U128,
    pub returned: U128,
    pub burned: U128,
    /// PETRI the agar has bought back.
    pub bought_back: U128,
    /// Earnings waiting to be claimed, across all colonies.
    pub unclaimed: U128,
    pub keeper_pot: U128,
    pub keeper_paid: U128,
    /// NEAR waiting in the tide vault, in yoctoNEAR.
    pub vault: U128,
    pub near_in: U128,
    pub near_tides: U128,
    pub near_bounties: U128,
    pub near_sold: U128,
    /// NEAR the agar may still pay for PETRI before the next tide.
    pub sell_left: U128,
    /// Sponsored NEAR credit given and spent, across all accounts.
    pub credit_given: U128,
    pub credit_spent: U128,
    pub tides: U64,
    pub house: Vec<u16>,
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
    /// Cells the last feed counted (capped weights of fed colonies). Prices are set against this.
    counted: u32,
    colonies: Vector<Colony>,
    colony_of: LookupMap<AccountId, u16>,
    names: LookupSet<String>,
    ledger: Vector<Entry>,
    plant_count: u64,
    plant_index: Vector<u64>,
    tide_index: Vector<u64>,
    balances: LookupMap<AccountId, u128>,
    credits: LookupMap<AccountId, u128>,
    house: Vec<u16>,
    /// PETRI still in the agar (held by the contract itself).
    agar: u128,
    sold: u128,
    fed: u128,
    returned: u128,
    burned: u128,
    bought_back: u128,
    unclaimed: u128,
    keeper_pot: u128,
    keeper_paid: u128,
    vault: u128,
    near_in: u128,
    near_tides: u128,
    near_bounties: u128,
    near_sold: u128,
    sell_left: u128,
    credit_given: u128,
    credit_spent: u128,
    tides: u64,
}

#[near]
impl Petri {
    #[init]
    pub fn new(rules: Rules) -> Self {
        require!(rules.width >= 16 && rules.height >= 16, "dish too small");
        require!((rules.width as u32) * (rules.height as u32) <= 65_536, "dish too large");
        require!(rules.generation_ms.0 >= 1_000, "generations must be at least a second apart");
        for bps in [rules.keeper_bps, rules.burn_bps, rules.tide_bps, rules.tide_bounty_bps, rules.sell_bps, rules.sell_cap_bps] {
            require!(bps <= 10_000, "a share is above 100%");
        }
        require!(rules.feed_ppm <= 1_000_000, "feed above 100% per generation");
        require!(rules.max_catchup >= 1 && rules.tide_every >= 1 && rules.reach >= 1 && rules.siege_x >= 1, "max_catchup, tide_every, reach and siege_x must be at least 1");
        require!(rules.petri_price.0 > 0, "PETRI needs a price");
        require!(rules.house.len() <= MAX_HOUSE, "too many house accounts");
        let dish = Dish::new(rules.width, rules.height);
        env::storage_write(BOARD_KEY, &dish.to_compact());
        for key in [EARNED_KEY, TIDES_KEY, PLANTED_KEY, WINDOW_KEY] {
            env::storage_write(key, &[]);
        }
        let this = Self {
            agar: rules.max_supply.0,
            rules,
            epoch_ms: env::block_timestamp_ms(),
            generation: 0,
            chain: [0; 32],
            total_live: 0,
            counted: 0,
            colonies: Vector::new(b"c"),
            colony_of: LookupMap::new(b"o"),
            names: LookupSet::new(b"m"),
            ledger: Vector::new(b"l"),
            plant_count: 0,
            plant_index: Vector::new(b"i"),
            tide_index: Vector::new(b"k"),
            balances: LookupMap::new(b"b"),
            credits: LookupMap::new(b"s"),
            house: Vec::new(),
            sold: 0,
            fed: 0,
            returned: 0,
            burned: 0,
            bought_back: 0,
            unclaimed: 0,
            keeper_pot: 0,
            keeper_paid: 0,
            vault: 0,
            near_in: 0,
            near_tides: 0,
            near_bounties: 0,
            near_sold: 0,
            sell_left: 0,
            credit_given: 0,
            credit_spent: 0,
            tides: 0,
        };
        token::emit_mint(&env::current_account_id(), this.agar, "launch: every PETRI starts in the agar");
        this
    }

    // ---------- the dish ----------

    /// Give `account_id` the attached NEAR as credit it can spend only in the dish (joining, buying, planting). It can
    /// never be withdrawn. The site's relayer sponsors its guests this way, so it never has to attach deposits to
    /// calls it relays.
    #[payable]
    pub fn sponsor(&mut self, account_id: AccountId) -> U128 {
        let deposit = env::attached_deposit().as_yoctonear();
        let before = env::storage_usage();
        let had = self.credits.get(&account_id).copied();
        self.credits.insert(account_id.clone(), had.unwrap_or(0));
        self.credits.flush();
        let storage = self.storage_cost_since(before);
        require!(deposit > storage, format!("sponsoring needs more than the {} NEAR its record costs", fmt_near(storage)));
        let credit = had.unwrap_or(0) + deposit - storage;
        self.credits.insert(account_id.clone(), credit);
        self.credit_given += deposit - storage;
        emit("sponsor", json!({ "account": account_id, "sponsor": env::predecessor_account_id(), "near": U128(deposit - storage) }));
        U128(credit)
    }

    /// Join the dish as a colony, once per account. The NEAR it brings (the attached deposit plus `credit` from its
    /// sponsored credit) pays for the colony's storage and the rest buys PETRI from the agar; that NEAR goes to the
    /// tide vault.
    #[payable]
    pub fn join(&mut self, name: String, color: u32, credit: Option<U128>) -> Colony {
        let account = caller();
        require!(self.colony_of.get(&account).is_none(), "this account already has a colony");
        let name = clean_name(&name);
        let key = name.to_lowercase();
        require!(!self.names.contains(&key), "a colony with that name already exists");
        require!(color <= 0xFF_FF_FF, "color must be 0xRRGGBB");
        require!(self.colonies.len() < u16::MAX as u32 - 1, "the dish is full of colonies");
        let deposit = self.take_near(&account, credit);
        require!(deposit >= self.rules.min_join.0, format!("joining needs at least {} NEAR", fmt_near(self.rules.min_join.0)));
        self.catch_up(self.rules.max_catchup as u64);
        let before = env::storage_usage();
        let id = (self.colonies.len() + 1) as u16;
        let house = self.rules.house.contains(&account);
        let colony = Colony {
            id,
            account: account.clone(),
            name: name.clone(),
            color,
            house,
            joined_generation: U64(self.generation),
            last_plant_generation: None,
            cells_planted: U64(0),
            petri_spent: U128(0),
            petri_burned: U128(0),
            petri_claimed: U128(0),
            petri_sold: U128(0),
            near_paid: U128(deposit),
            near_claimed: U128(0),
            near_sold: U128(0),
        };
        self.colonies.push(colony);
        self.colony_of.insert(account.clone(), id);
        self.names.insert(key);
        if house {
            self.house.push(id);
        }
        if !self.balances.contains_key(&account) {
            self.balances.insert(account.clone(), 0);
        }
        self.ledger.push(Entry::Join { generation: U64(self.generation), colony: id });
        for key in [EARNED_KEY, PLANTED_KEY, WINDOW_KEY] {
            let mut v = self.load_u64s(key);
            v.push(0);
            self.store_u64s(key, &v);
        }
        let mut tides = self.load_u128s(TIDES_KEY);
        tides.push(0);
        self.store_u128s(TIDES_KEY, &tides);
        self.flush();
        // The purchase below adds one more ledger entry; charge for it up front.
        let storage = self.storage_cost_since(before) + 110 * env::storage_byte_cost().as_yoctonear();
        require!(deposit > storage, format!("joining needs more than the {} NEAR its storage costs", fmt_near(storage)));
        let bought = self.sell_petri(id, &account, deposit - storage);
        emit("join", json!({ "colony": id, "account": account, "name": name, "color": color, "house": house, "generation": U64(self.generation), "petri": U128(bought) }));
        self.colony(id)
    }

    /// Buy PETRI from the agar with the attached NEAR plus `credit` from sponsored credit. The price rises as the agar
    /// empties; the NEAR goes to the tide vault, less the storage of the purchase's ledger entry.
    #[payable]
    pub fn buy(&mut self, credit: Option<U128>) -> U128 {
        let account = caller();
        let id = self.colony_id(&account);
        let deposit = self.take_near(&account, credit);
        require!(deposit > 0, "attach NEAR to buy PETRI");
        self.catch_up(self.rules.max_catchup as u64);
        let mut c = self.colony(id);
        c.near_paid = U128(c.near_paid.0 + deposit);
        self.colonies.set(id as u32 - 1, c);
        // The purchase's ledger entry is charged to the buyer: about 100 bytes.
        let storage = 110 * env::storage_byte_cost().as_yoctonear();
        require!(deposit > storage, format!("a purchase needs more than the {} NEAR its record costs", fmt_near(storage)));
        U128(self.sell_petri(id, &account, deposit - storage))
    }

    /// Sell `petri` units back to the agar for NEAR from the vault, at `sell_bps` of the curve's price. Between two
    /// tides the agar buys back at most `sell_cap_bps` of the vault, first come first served.
    pub fn sell(&mut self, petri: U128) -> U128 {
        let account = caller();
        let id = self.colony_id(&account);
        self.catch_up(self.rules.max_catchup as u64);
        let units = petri.0;
        require!(units > 0, "sell at least some PETRI");
        let held = self.balance(&account);
        require!(held >= units, format!("you hold {} PETRI", fmt_petri(held)));
        let near = self.sell_quote(petri).0;
        require!(near > 0, "that is too little PETRI to buy back");
        require!(near <= self.sell_left, format!("the agar buys back at most {} NEAR more before the next tide", fmt_near(self.sell_left)));
        let before = env::storage_usage();
        self.balances.insert(account.clone(), held - units);
        self.agar += units;
        self.bought_back += units;
        token::emit_transfer_pub(&account, &env::current_account_id(), units, "sold back to the agar");
        let index = self.ledger.len() as u32;
        self.ledger.push(Entry::Sell { generation: U64(self.generation), colony: id, petri: petri, near: U128(near), paid: U128(0) });
        self.flush();
        let storage = self.storage_cost_since(before);
        require!(near > storage, "that is too little PETRI to cover the sale's record");
        let paid = near - storage;
        self.ledger.set(index, Entry::Sell { generation: U64(self.generation), colony: id, petri: petri, near: U128(near), paid: U128(paid) });
        self.ledger.flush();
        self.vault -= near;
        self.sell_left -= near;
        self.near_sold += paid;
        let mut c = self.colony(id);
        c.petri_sold = U128(c.petri_sold.0 + units);
        c.near_sold = U128(c.near_sold.0 + paid);
        self.colonies.set(id as u32 - 1, c);
        emit("sell", json!({ "colony": id, "petri": petri, "near": U128(paid) }));
        self.pay_out(&account, id, paid);
        U128(paid)
    }

    /// Bring cells to life. `cells` are flat indices (`y * width + x`). `note` is an optional lab note (up to 140
    /// characters) stored with the planting. Bring NEAR for the storage the planting uses plus `cell_fee` per cell
    /// (see `plant_deposit`), attached or from sponsored `credit`; anything above the storage goes to the tide vault.
    /// A planting with a cell inside a rival's buffer is a siege and costs `siege_x` times the price.
    #[payable]
    pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>, credit: Option<U128>) -> U64 {
        let account = caller();
        let note = note.map(|n| clean_note(&n)).filter(|n| !n.is_empty());
        let id = self.colony_id(&account);
        let deposit = self.take_near(&account, credit);
        self.catch_up(self.rules.max_catchup as u64);
        require!(self.generation == self.due_generation(), "the dish is behind the clock; call advance first");
        // Earnings waiting for this colony count towards the price.
        self.claim_petri(id, &account);
        let mut colony = self.colony(id);
        if let Some(last) = colony.last_plant_generation {
            require!(last.0 < self.generation, "one planting per generation; wait for the next one");
        }
        let mut dish = self.load_dish();
        let check = match dish.check_plant(id, &cells, self.rules.buffer, self.rules.max_plant_cells) {
            Ok(c) => c,
            Err(e) => env::panic_str(&plant_error_text(&dish, e)),
        };
        let fee = self.rules.cell_fee.0 * cells.len() as u128;
        require!(deposit >= fee, format!("planting {} cells needs at least {} NEAR", cells.len(), fmt_near(self.plant_deposit(cells.len() as u32, note.as_ref().map(|n| n.len() as u32)).0)));
        let cost = self.cell_cost(cells.len() as u32, check.siege);
        let balance = self.balance(&account);
        require!(balance >= cost, format!("planting {} cells{} costs {} PETRI; you hold {}", cells.len(), if check.siege { " inside a rival's buffer" } else { "" }, fmt_petri(cost), fmt_petri(balance)));
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
        let mut planted = self.load_u64s(PLANTED_KEY);
        planted[id as usize] += cells.len() as u64;
        self.store_u64s(PLANTED_KEY, &planted);
        colony.last_plant_generation = Some(U64(self.generation));
        colony.cells_planted = U64(colony.cells_planted.0 + cells.len() as u64);
        colony.petri_spent = U128(colony.petri_spent.0 + cost);
        colony.petri_burned = U128(colony.petri_burned.0 + burn);
        colony.near_paid = U128(colony.near_paid.0 + deposit);
        let index = self.ledger.len() as u64;
        if let Some(n) = &note {
            env::storage_write(&note_key(index), n.as_bytes());
        }
        let short: Vec<u16> = cells.iter().map(|&c| c as u16).collect();
        // The vault's share is fixed once the storage is known; the entry has the same size either way.
        self.ledger.push(Entry::Plant { generation: U64(self.generation), colony: id, cells: short.clone(), cost: U128(cost), near: U128(0), siege: check.siege });
        self.plant_index.push(index);
        self.plant_count += 1;
        self.colonies.set(id as u32 - 1, colony);
        self.flush();
        let storage = self.storage_cost_since(before);
        require!(deposit >= storage + fee, format!("this planting needs {} NEAR for its storage and fee", fmt_near(storage + fee)));
        let to_vault = deposit - storage;
        self.ledger.set(index as u32, Entry::Plant { generation: U64(self.generation), colony: id, cells: short, cost: U128(cost), near: U128(to_vault), siege: check.siege });
        self.ledger.flush();
        self.vault += to_vault;
        self.near_in += to_vault;
        emit("plant", json!({ "colony": id, "generation": U64(self.generation), "cells": cells.len(), "cost": U128(cost), "siege": check.siege, "near": U128(deposit), "note": note }));
        U64(self.generation)
    }

    /// Catch up to `max` due generations (capped at `max_catchup`). If this call ran at least one generation, the
    /// keeper pot goes to the caller when it is registered for PETRI. Tides this call runs pay it a NEAR bounty.
    pub fn advance(&mut self, max: Option<u32>) -> U64 {
        let caller = caller();
        let cap = max.unwrap_or(self.rules.max_catchup).clamp(1, self.rules.max_catchup) as u64;
        let done = self.catch_up(cap);
        let pot = self.keeper_pot;
        if done > 0 && pot > 0 && self.balances.contains_key(&caller) {
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
            self.pay_out(&account, id, near);
        }
        emit("claim", json!({ "colony": id, "petri": U128(petri), "near": U128(near) }));
        Claimable { petri: U128(petri), near: U128(near) }
    }

    /// Resolves a NEAR payout. If the transfer failed, the NEAR is owed to the colony again and can be claimed.
    #[private]
    pub fn on_payout(&mut self, colony: u16, near: U128) {
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok() {
            return;
        }
        let mut tides = self.load_u128s(TIDES_KEY);
        tides[colony as usize] += near.0;
        self.store_u128s(TIDES_KEY, &tides);
        let mut c = self.colony(colony);
        // Counted as unclaimed again; whatever it was for, the colony can claim it.
        c.near_claimed = U128(c.near_claimed.0.saturating_sub(near.0));
        self.colonies.set(colony as u32 - 1, c);
        emit("payout_failed", json!({ "colony": colony, "near": near }));
    }

    // ---------- views ----------

    /// What planting `cells` cells costs right now, in PETRI units (before any catch-up the planting triggers).
    /// Inside a rival's buffer it costs `siege_x` times as much.
    pub fn quote(&self, cells: u32, siege: Option<bool>) -> U128 {
        U128(self.cell_cost(cells, siege.unwrap_or(false)))
    }

    /// The NEAR to bring to a planting of `cells` cells with a note of `note_bytes` bytes: its storage plus the fee.
    pub fn plant_deposit(&self, cells: u32, note_bytes: Option<u32>) -> U128 {
        let bytes = PLANT_STORAGE_BASE + 4 * cells as u64 + note_bytes.map(|b| b as u64 + 64).unwrap_or(0);
        U128(bytes as u128 * env::storage_byte_cost().as_yoctonear() + self.rules.cell_fee.0 * cells as u128)
    }

    /// PETRI that `near` yoctoNEAR would buy from the agar right now.
    pub fn buy_quote(&self, near: U128) -> U128 {
        U128(petri_for_near(near.0, self.agar, self.price_k()))
    }

    /// NEAR the agar would pay for `petri` units right now (before the sale's record is paid for): half the curve's
    /// price, but never more than those units' share of the vault.
    pub fn sell_quote(&self, petri: U128) -> U128 {
        let outstanding = self.total_supply() - self.agar;
        U128(sell_back(petri.0, self.agar, self.price_k(), self.rules.sell_bps, self.vault, outstanding))
    }

    pub fn credit_of(&self, account_id: AccountId) -> U128 {
        U128(self.credits.get(&account_id).copied().unwrap_or(0))
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
            counted: self.counted,
            colonies: self.colonies.len() as u16,
            ledger: U64(self.ledger.len() as u64),
            plants: U64(self.plant_count),
            total_supply: U128(self.total_supply()),
            agar: U128(self.agar),
            sold: U128(self.sold),
            fed: U128(self.fed),
            returned: U128(self.returned),
            burned: U128(self.burned),
            bought_back: U128(self.bought_back),
            unclaimed: U128(self.unclaimed),
            keeper_pot: U128(self.keeper_pot),
            keeper_paid: U128(self.keeper_paid),
            vault: U128(self.vault),
            near_in: U128(self.near_in),
            near_tides: U128(self.near_tides),
            near_bounties: U128(self.near_bounties),
            near_sold: U128(self.near_sold),
            sell_left: U128(self.sell_left),
            credit_given: U128(self.credit_given),
            credit_spent: U128(self.credit_spent),
            tides: U64(self.tides),
            house: self.house.clone(),
            cell_price: U128(self.cell_cost(1, false)),
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

    /// NEAR each colony has won at the tides so far, claimed or not (index = colony id - 1).
    pub fn tide_winnings(&self, from: Option<u32>, limit: Option<u32>) -> Vec<U128> {
        let owed = self.load_u128s(TIDES_KEY);
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(2_000);
        (from..self.colonies.len().min(from.saturating_add(limit)))
            .map(|i| {
                let c = self.colonies.get(i).unwrap();
                U128(c.near_claimed.0 + owed.get(i as usize + 1).copied().unwrap_or(0))
            })
            .collect()
    }

    /// The ledger: every join, purchase, sale, planting and tide in order. Replaying it from an empty dish with
    /// `petri-core` reproduces every generation, the agar, the vault and every colony's earnings.
    pub fn ledger(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Entry> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.ledger.len().min(from.saturating_add(limit))).filter_map(|i| self.ledger.get(i).cloned()).collect()
    }

    /// Plantings only, paged by planting number, with lab notes.
    pub fn plants(&self, from: Option<u64>, limit: Option<u32>) -> Vec<PlantView> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.plant_index.len().min(from.saturating_add(limit)))
            .filter_map(|i| {
                let index = *self.plant_index.get(i)?;
                match self.ledger.get(index as u32)? {
                    Entry::Plant { generation, colony, cells, cost, siege, .. } => Some(PlantView {
                        index: U64(index),
                        generation: *generation,
                        colony: *colony,
                        cells: cells.clone(),
                        cost: *cost,
                        siege: *siege,
                        note: env::storage_read(&note_key(index)).and_then(|b| String::from_utf8(b).ok()),
                    }),
                    _ => None,
                }
            })
            .collect()
    }

    /// The history chain at generation 0 and at every tide.
    pub fn checkpoints(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Checkpoint> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(2_000);
        let mut out = Vec::new();
        if from == 0 {
            out.push(Checkpoint { generation: U64(0), chain: hex::encode([0u8; 32]) });
        }
        let start = from.saturating_sub(1);
        let end = self.tide_index.len().min(start.saturating_add(limit));
        for i in start..end {
            if let Some(&index) = self.tide_index.get(i) {
                if let Some(Entry::Tide { generation, chain, .. }) = self.ledger.get(index as u32) {
                    out.push(Checkpoint { generation: *generation, chain: chain.clone() });
                }
            }
        }
        out
    }

    // ---------- internals ----------

    fn due_generation(&self) -> u64 {
        (env::block_timestamp_ms().saturating_sub(self.epoch_ms)) / self.rules.generation_ms.0
    }

    fn price_k(&self) -> u128 {
        self.rules.petri_price.0 / 1_000_000 * self.rules.max_supply.0
    }

    fn cell_cost(&self, cells: u32, siege: bool) -> u128 {
        let per_cell = feed_per_cell(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.counted, self.rules.live_floor);
        planting_cost(per_cell, self.rules.payback, self.rules.min_cell_price.0, cells, siege, self.rules.siege_x)
    }

    /// The attached deposit plus `credit` taken from the caller's sponsored credit.
    fn take_near(&mut self, account: &AccountId, credit: Option<U128>) -> u128 {
        let attached = env::attached_deposit().as_yoctonear();
        let want = credit.map(|c| c.0).unwrap_or(0);
        if want > 0 {
            let have = self.credits.get(account).copied().unwrap_or(0);
            require!(have >= want, format!("this account has {} NEAR of sponsored credit", fmt_near(have)));
            self.credits.insert(account.clone(), have - want);
            self.credit_spent += want;
        }
        attached + want
    }

    fn sell_petri(&mut self, id: u16, account: &AccountId, near: u128) -> u128 {
        let units = petri_for_near(near, self.agar, self.price_k());
        require!(units > 0, "that is not enough NEAR to buy any PETRI");
        self.agar -= units;
        self.sold += units;
        self.credit(account, units);
        self.vault += near;
        self.near_in += near;
        self.ledger.push(Entry::Buy { generation: U64(self.generation), colony: id, petri: U128(units), near: U128(near) });
        self.ledger.flush();
        token::emit_transfer_pub(&env::current_account_id(), account, units, "bought from the agar");
        units
    }

    /// Send NEAR to a player; if the transfer fails, `on_payout` owes it to the colony again.
    fn pay_out(&self, account: &AccountId, id: u16, near: u128) {
        let _ = Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(near))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_PAYOUT_CHECK).on_payout(id, U128(near)));
    }

    fn claim_petri(&mut self, id: u16, account: &AccountId) -> u128 {
        let mut earned = self.load_u64s(EARNED_KEY);
        let amount = earned.get(id as usize).copied().unwrap_or(0) as u128;
        if amount == 0 {
            return 0;
        }
        earned[id as usize] = 0;
        self.store_u64s(EARNED_KEY, &earned);
        self.unclaimed -= amount;
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

    fn flush(&mut self) {
        self.colonies.flush();
        self.ledger.flush();
        self.colony_of.flush();
        self.balances.flush();
        self.plant_index.flush();
        self.tide_index.flush();
        self.credits.flush();
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

    /// A per-colony record by colony id (index 0 unused).
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

    /// Step up to `cap` due generations: Life, the history chain, the feed (into unclaimed earnings, the tide window
    /// and the keeper pot) and the tides. Reads and writes one record of each kind however many colonies are alive,
    /// and stops early if the call has used `CATCHUP_GAS_LIMIT`. Tide bounties go to the caller. Returns how many
    /// generations ran.
    fn catch_up(&mut self, cap: u64) -> u64 {
        let due = self.due_generation();
        if self.generation >= due || cap == 0 {
            return 0;
        }
        let target = due.min(self.generation + cap);
        let mut dish = self.load_dish();
        let n = self.colonies.len() as u16;
        let planted = self.load_u64s(PLANTED_KEY);
        let mut earned = self.load_u64s(EARNED_KEY);
        let mut window = self.load_u64s(WINDOW_KEY);
        earned.resize(n as usize + 1, 0);
        window.resize(n as usize + 1, 0);
        let mut fed = 0u128;
        let mut bounty = 0u128;
        let from = self.generation;
        while self.generation < target {
            let stats = dish.step(n);
            self.generation += 1;
            if chain_due(self.generation) {
                self.chain = chain_next(&self.chain, self.generation, &dish.hash());
            }
            self.total_live = stats.total_live;
            let f = feed(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.rules.reach, self.rules.live_floor, &stats.live, &planted, &self.house);
            self.counted = f.weight;
            if f.paid > 0 {
                for &(c, s) in &f.shares {
                    earned[c as usize] += s as u64;
                    window[c as usize] += s as u64;
                    self.unclaimed += s;
                }
                self.agar -= f.paid;
                self.keeper_pot += f.keeper;
                fed += f.paid;
            }
            if self.generation % self.rules.tide_every as u64 == 0 {
                bounty += self.tide(&mut window);
            }
            if env::used_gas() > CATCHUP_GAS_LIMIT {
                break;
            }
        }
        self.store_dish(&dish);
        self.store_u64s(EARNED_KEY, &earned);
        self.store_u64s(WINDOW_KEY, &window);
        self.fed += fed;
        let ran = self.generation - from;
        emit("generation", json!({ "from": U64(from), "to": U64(self.generation), "live": self.total_live, "fed": U128(fed), "keeper_pot": U128(self.keeper_pot), "bounty": U128(bounty) }));
        if bounty > 0 {
            let _ = Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(bounty));
        }
        ran
    }

    /// One tide: record the history chain, pay `tide_bps` of the vault by the window's earnings (the bounty to the
    /// caller, this entry's storage, the rest to colonies), reset the window and reopen the buy-back allowance.
    /// Returns the bounty.
    fn tide(&mut self, window: &mut [u64]) -> u128 {
        let before = env::storage_usage();
        let generation = U64(self.generation);
        let chain = hex::encode(self.chain);
        let index = self.ledger.len() as u64;
        let zero = U128(0);
        self.ledger.push(Entry::Tide { generation, chain: chain.clone(), pay: zero, bounty: zero, storage: zero, paid: zero });
        self.tide_index.push(index);
        self.ledger.flush();
        self.tide_index.flush();
        let storage_cost = self.storage_cost_since(before);
        let pay = self.vault * self.rules.tide_bps as u128 / 10_000;
        let bounty = (pay * self.rules.tide_bounty_bps as u128 / 10_000).min(self.rules.max_bounty.0);
        let storage = storage_cost.min(pay - bounty);
        let (split, paid) = tide_split(pay - bounty - storage, window, &self.house);
        if paid > 0 {
            let mut owed = self.load_u128s(TIDES_KEY);
            owed.resize(self.colonies.len() as usize + 1, 0);
            for &(c, s) in &split {
                owed[c as usize] += s;
            }
            self.store_u128s(TIDES_KEY, &owed);
        }
        // Without winners nothing but the bounty and the storage leaves the vault.
        let bounty = if paid > 0 { bounty } else { 0 };
        let storage = if paid > 0 { storage } else { storage_cost.min(self.vault) };
        self.vault -= paid + bounty + storage;
        self.near_tides += paid;
        self.near_bounties += bounty;
        self.tides += 1;
        self.ledger.set(index as u32, Entry::Tide { generation, chain, pay: U128(pay), bounty: U128(bounty), storage: U128(storage), paid: U128(paid) });
        self.ledger.flush();
        window.iter_mut().for_each(|w| *w = 0);
        self.sell_left = self.vault * self.rules.sell_cap_bps as u128 / 10_000;
        bounty
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

    /// What the contract itself holds in PETRI: the agar, unclaimed earnings and the keeper pot.
    pub(crate) fn held_by_dish(&self) -> u128 {
        self.agar + self.unclaimed + self.keeper_pot
    }
}

/// The account making the call. The contract itself never acts as a player: its own balance is the agar.
fn caller() -> AccountId {
    let a = env::predecessor_account_id();
    require!(a != env::current_account_id(), "the dish does not play on itself");
    a
}

/// A colony name: 1 to 24 characters of plain ASCII letters, digits, spaces and a little punctuation, so no name can
/// hide characters, impersonate another or carry an instruction in a script the reader cannot see.
fn clean_name(s: &str) -> String {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    require!(!t.is_empty() && t.len() <= MAX_NAME_BYTES && t.chars().count() <= MAX_NAME_CHARS, "name must be 1 to 24 characters");
    require!(
        t.chars().all(|c| c.is_ascii_alphanumeric() || " -'.&!?_,:()".contains(c)),
        "a name may use only letters A to Z, digits, spaces and - ' . & ! ? _ , : ( )"
    );
    t
}

/// A lab note: trimmed, at most 140 characters, and free of characters that hide or reorder text.
fn clean_note(s: &str) -> String {
    let t = s.trim().to_string();
    for ch in t.chars() {
        require!(!hidden_char(ch), "a lab note may not contain control, direction, invisible or tag characters");
    }
    require!(t.chars().count() <= MAX_NOTE_CHARS && t.len() <= MAX_NOTE_BYTES, format!("a lab note is at most {} characters", MAX_NOTE_CHARS));
    t
}

/// Control, bidirectional, zero-width, invisible filler, variation-selector and tag characters.
fn hidden_char(ch: char) -> bool {
    let c = ch as u32;
    ch.is_control()
        || [0x00AD, 0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x3164, 0xFEFF, 0xFFA0].contains(&c)
        || (0x180B..=0x180F).contains(&c)
        || (0x200B..=0x200F).contains(&c)
        || (0x2028..=0x202E).contains(&c)
        || (0x2060..=0x206F).contains(&c)
        || (0xFE00..=0xFE0E).contains(&c)
        || (0xFFF0..=0xFFFB).contains(&c)
        || (0x1D173..=0x1D17A).contains(&c)
        || (0xE0000..=0xE0FFF).contains(&c)
}

fn note_key(index: u64) -> Vec<u8> {
    let mut k = NOTE_PREFIX.to_vec();
    k.extend_from_slice(&index.to_le_bytes());
    k
}

fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({ "standard": "petri", "version": "3.0.0", "event": event, "data": [data] }));
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
    let micro = yocto / 1_000_000_000_000_000_000;
    format!("{}.{:06}", micro / 1_000_000, micro % 1_000_000).trim_end_matches('0').trim_end_matches('.').to_string()
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
    }
}

#[cfg(test)]
mod tests;
