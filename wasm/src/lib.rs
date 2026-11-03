//! The browser's copy of the dish. Same `petri-core` as the contract, compiled to WebAssembly, so the page can
//! run the dish ahead of the stored generation, replay its whole history from the plant log and check the result
//! against the contract's history chain.

use petri_core::{chain_due, chain_next, feed, feed_per_cell, petri_for_near, planting_cost, sell_back, tide_split, Dish, PlantError};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Engine {
    dish: Dish,
    generation: u64,
    chain: [u8; 32],
    colonies: u16,
    /// PETRI units still in the agar, as the contract would hold them at this generation.
    agar: u128,
    feed_ppm: u32,
    keeper_bps: u16,
    reach: u32,
    /// PETRI earned per colony during this engine's run (index = colony id).
    earned: Vec<u128>,
    /// Cells each colony has planted (the base of its pay cap), and its earnings since the last tide.
    planted: Vec<u64>,
    window: Vec<u64>,
    /// The dish's own colonies: never fed, no tide share.
    house: Vec<u16>,
    /// NEAR each colony won at the tides during this engine's run.
    won: Vec<u128>,
    /// PETRI set aside for keepers during this engine's run.
    keeper: u128,
    last_births: Vec<u32>,
    last_deaths: Vec<u32>,
    last_live: Vec<u32>,
    last_contested: u32,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u16, height: u16, feed_ppm: u32, keeper_bps: u16, reach: u32) -> Engine {
        Engine {
            dish: Dish::new(width, height),
            generation: 0,
            chain: [0; 32],
            colonies: 0,
            agar: 0,
            feed_ppm,
            keeper_bps,
            reach,
            earned: vec![0],
            planted: vec![0],
            window: vec![0],
            house: Vec::new(),
            won: vec![0],
            keeper: 0,
            last_births: vec![0],
            last_deaths: vec![0],
            last_live: vec![0],
            last_contested: 0,
        }
    }

    /// Start from a stored board (the contract's `board` view, base64-decoded) at a known generation.
    pub fn set_agar(&mut self, units: &str) {
        self.agar = units.parse().unwrap_or(0);
    }

    pub fn agar(&self) -> String {
        self.agar.to_string()
    }

    pub fn load_compact(&mut self, bytes: &[u8], generation: f64, chain_hex: &str) -> bool {
        match Dish::from_compact(self.dish.width, self.dish.height, bytes) {
            Some(d) => {
                self.dish = d;
                self.generation = generation as u64;
                if let Ok(v) = hex::decode(chain_hex) {
                    if v.len() == 32 {
                        self.chain.copy_from_slice(&v);
                    }
                }
                true
            }
            None => false,
        }
    }

    pub fn set_colonies(&mut self, n: u16) {
        self.colonies = n;
        self.earned.resize(n as usize + 1, 0);
        self.planted.resize(n as usize + 1, 0);
        self.window.resize(n as usize + 1, 0);
        self.won.resize(n as usize + 1, 0);
    }

    /// The dish's house colonies (the contract's `state().house`): they are never fed and win no tides.
    pub fn set_house(&mut self, house: &[u16]) {
        self.house = house.to_vec();
    }

    /// Cells each colony has planted, as the contract counts them (when the engine starts mid-history).
    pub fn set_planted(&mut self, planted: &[u32]) {
        for (i, &p) in planted.iter().enumerate() {
            if i + 1 < self.planted.len() {
                self.planted[i + 1] = p as u64;
            }
        }
    }

    pub fn width(&self) -> u16 {
        self.dish.width
    }

    pub fn height(&self) -> u16 {
        self.dish.height
    }

    pub fn generation(&self) -> f64 {
        self.generation as f64
    }

    pub fn total_live(&self) -> u32 {
        self.dish.total_live()
    }

    /// The owner array (u16 per cell), copied out for rendering.
    pub fn cells(&self) -> Vec<u16> {
        self.dish.cells.clone()
    }

    /// Plant without checks (replaying the contract's log).
    pub fn plant(&mut self, colony: u16, cells: &[u32]) {
        if colony > self.colonies {
            self.set_colonies(colony);
        }
        self.dish.plant_unchecked(colony, cells);
        self.planted[colony as usize] += cells.len() as u64;
    }

    /// Check a planting the way the contract will. Returns "" when it would be accepted, "siege:<rival>" when it is
    /// accepted inside a rival's buffer at the siege price, and an error code otherwise.
    pub fn check_plant(&self, colony: u16, cells: &[u32], buffer: u16, max_cells: u32) -> String {
        match self.dish.check_plant(colony, cells, buffer, max_cells) {
            Ok(c) => match c.rival {
                Some(r) => format!("siege:{}", r),
                None => String::new(),
            },
            Err(e) => match e {
                PlantError::Empty => "empty".into(),
                PlantError::TooMany { max } => format!("too_many:{}", max),
                PlantError::OutOfRange { index } => format!("out_of_range:{}", index),
                PlantError::Duplicate { index } => format!("duplicate:{}", index),
                PlantError::Occupied { index } => format!("occupied:{}", index),
            },
        }
    }

    /// Advance `n` generations, tracking the chain and the agar's feed exactly as the contract does.
    pub fn step(&mut self, n: u32) {
        for _ in 0..n {
            let s = self.dish.step(self.colonies);
            self.generation += 1;
            if chain_due(self.generation) {
                self.chain = chain_next(&self.chain, self.generation, &self.dish.hash());
            }
            let f = feed(self.agar, self.feed_ppm, self.keeper_bps, self.reach, &s.live, &self.planted, &self.house);
            for &(c, v) in &f.shares {
                let c = c as usize;
                if c < self.earned.len() {
                    self.earned[c] += v;
                    self.window[c] += v as u64;
                }
            }
            self.agar -= f.paid;
            self.keeper += f.keeper;
            self.last_births = s.births;
            self.last_deaths = s.deaths;
            self.last_live = s.live;
            self.last_contested = s.contested;
        }
    }

    pub fn chain_hex(&self) -> String {
        hex::encode(self.chain)
    }

    pub fn board_hash_hex(&self) -> String {
        hex::encode(self.dish.hash())
    }

    /// PETRI units earned per colony since this engine started, approximate (f64), for display.
    pub fn earned(&self) -> Vec<f64> {
        self.earned.iter().map(|&v| v as f64).collect()
    }

    /// Exact PETRI units one colony earned since this engine started, as a decimal string.
    pub fn earned_of(&self, colony: u16) -> String {
        self.earned.get(colony as usize).copied().unwrap_or(0).to_string()
    }

    /// Run a tide: split `pay` yoctoNEAR by the window's earnings, skipping the house, add it to each colony's winnings
    /// and reset the window. Returns the total paid to colonies, as a decimal string.
    pub fn tide(&mut self, pay: &str) -> String {
        let (split, paid) = tide_split(pay.parse().unwrap_or(0), &self.window, &self.house);
        for (c, v) in split {
            self.won[c as usize] += v;
        }
        self.window.iter_mut().for_each(|w| *w = 0);
        paid.to_string()
    }

    /// Exact NEAR one colony won at the tides since this engine started (yoctoNEAR, decimal string).
    pub fn won_of(&self, colony: u16) -> String {
        self.won.get(colony as usize).copied().unwrap_or(0).to_string()
    }

    /// One colony's earnings since the last tide (PETRI units), for showing a tide's likely split.
    pub fn window_of(&self, colony: u16) -> String {
        self.window.get(colony as usize).copied().unwrap_or(0).to_string()
    }

    /// Exact PETRI units set aside for keepers since this engine started.
    pub fn keeper_total(&self) -> String {
        self.keeper.to_string()
    }

    /// What one cell costs to plant now, in PETRI units, by the contract's formula.
    pub fn cell_price(&self, payback: u32, min_price: &str, live_floor: u32) -> String {
        let per = feed_per_cell(self.agar, self.feed_ppm, self.keeper_bps, self.dish.total_live(), live_floor);
        planting_cost(per, payback, min_price.parse().unwrap_or(0), 1, false, 1).to_string()
    }

    pub fn live_counts(&self) -> Vec<u32> {
        self.dish.live_counts(self.colonies)
    }

    pub fn last_births(&self) -> Vec<u32> {
        self.last_births.clone()
    }

    pub fn last_deaths(&self) -> Vec<u32> {
        self.last_deaths.clone()
    }

    pub fn last_contested(&self) -> u32 {
        self.last_contested
    }

    pub fn compact(&self) -> Vec<u8> {
        self.dish.to_compact()
    }

    pub fn clone_engine(&self) -> Engine {
        Engine {
            dish: self.dish.clone(),
            generation: self.generation,
            chain: self.chain,
            colonies: self.colonies,
            agar: self.agar,
            feed_ppm: self.feed_ppm,
            keeper_bps: self.keeper_bps,
            reach: self.reach,
            earned: self.earned.clone(),
            planted: self.planted.clone(),
            window: self.window.clone(),
            house: self.house.clone(),
            won: self.won.clone(),
            keeper: self.keeper,
            last_births: self.last_births.clone(),
            last_deaths: self.last_deaths.clone(),
            last_live: self.last_live.clone(),
            last_contested: self.last_contested,
        }
    }
}

/// What planting `cells` costs in PETRI units (decimal string), given the agar and the living population; a siege
/// (a planting inside a rival's buffer) costs `siege_x` times as much.
#[wasm_bindgen]
pub fn quote(agar: &str, feed_ppm: u32, keeper_bps: u16, total_live: u32, live_floor: u32, payback: u32, min_price: &str, cells: u32, siege: bool, siege_x: u32) -> String {
    let per = feed_per_cell(agar.parse().unwrap_or(0), feed_ppm, keeper_bps, total_live, live_floor);
    planting_cost(per, payback, min_price.parse().unwrap_or(0), cells, siege, siege_x).to_string()
}

/// yoctoNEAR the agar pays for `petri` units handed back (before the sale's record): `sell_bps` of the curve, but never
/// more than their share of `vault` among `outstanding` PETRI (all PETRI outside the agar).
#[wasm_bindgen]
pub fn sell_quote(petri: &str, agar: &str, petri_price: &str, max_supply: &str, sell_bps: u16, vault: &str, outstanding: &str) -> String {
    let k = petri_price.parse::<u128>().unwrap_or(0) / 1_000_000 * max_supply.parse::<u128>().unwrap_or(0);
    sell_back(petri.parse().unwrap_or(0), agar.parse().unwrap_or(0), k, sell_bps, vault.parse().unwrap_or(0), outstanding.parse().unwrap_or(0)).to_string()
}

/// PETRI units that `near` yoctoNEAR buys from an agar of `agar` units, with `petri_price` yoctoNEAR per PETRI at
/// launch and `max_supply` units in all.
#[wasm_bindgen]
pub fn buy_quote(near: &str, agar: &str, petri_price: &str, max_supply: &str) -> String {
    let k = petri_price.parse::<u128>().unwrap_or(0) / 1_000_000 * max_supply.parse::<u128>().unwrap_or(0);
    petri_for_near(near.parse().unwrap_or(0), agar.parse().unwrap_or(0), k).to_string()
}

/// Flat indices for a named pattern placed at (x, y), wrapped onto the dish. Empty if the name is unknown.
#[wasm_bindgen]
pub fn pattern_cells(name: &str, x: i32, y: i32, width: u16, height: u16, rotate: u8, flip: bool) -> Vec<u32> {
    use petri_core::patterns::*;
    let shape: &[(i32, i32)] = match name {
        "block" => BLOCK,
        "blinker" => BLINKER,
        "beehive" => BEEHIVE,
        "loaf" => LOAF,
        "glider" => GLIDER,
        "lwss" => LWSS,
        "eater" => EATER,
        "r-pentomino" => R_PENTOMINO,
        "toad" => TOAD,
        "pulsar" => PULSAR,
        "gosper-gun" => GOSPER_GUN,
        _ => &[],
    };
    let d = Dish::new(width, height);
    shape
        .iter()
        .map(|&(dx, dy)| {
            let (mut a, mut b) = if flip { (-dx, dy) } else { (dx, dy) };
            for _ in 0..(rotate % 4) {
                let t = a;
                a = -b;
                b = t;
            }
            d.index(x + a, y + b) as u32
        })
        .collect()
}
