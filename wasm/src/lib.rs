//! The browser's copy of the dish. Same `petri-core` as the contract, compiled to WebAssembly, so the page can
//! run the dish ahead of the stored generation, replay its whole history from the plant log and check the result
//! against the contract's history chain.

use petri_core::{chain_due, chain_next, plant_cost, split_emission, Dish, PlantError};
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
    /// PETRI earned per colony during this engine's run (index = colony id).
    earned: Vec<u128>,
    last_births: Vec<u32>,
    last_deaths: Vec<u32>,
    last_live: Vec<u32>,
    last_contested: u32,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new(width: u16, height: u16, feed_ppm: u32, keeper_bps: u16) -> Engine {
        Engine {
            dish: Dish::new(width, height),
            generation: 0,
            chain: [0; 32],
            colonies: 0,
            agar: 0,
            feed_ppm,
            keeper_bps,
            earned: vec![0],
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
    }

    /// Check a planting the way the contract will. Returns "" when it would be accepted.
    pub fn check_plant(&self, colony: u16, cells: &[u32], buffer: u16, max_cells: u32) -> String {
        match self.dish.check_plant(colony, cells, buffer, max_cells) {
            Ok(()) => String::new(),
            Err(e) => match e {
                PlantError::Empty => "empty".into(),
                PlantError::TooMany { max } => format!("too_many:{}", max),
                PlantError::OutOfRange { index } => format!("out_of_range:{}", index),
                PlantError::Duplicate { index } => format!("duplicate:{}", index),
                PlantError::Occupied { index } => format!("occupied:{}", index),
                PlantError::TooClose { index, rival } => format!("too_close:{}:{}", index, rival),
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
            if s.total_live > 0 {
                let feed = self.agar * self.feed_ppm as u128 / 1_000_000;
                let keeper_cut = feed * self.keeper_bps as u128 / 10_000;
                let mut paid = keeper_cut;
                for (c, v) in split_emission(feed - keeper_cut, &s.live, s.total_live).into_iter().enumerate() {
                    self.earned[c] += v;
                    paid += v;
                }
                self.agar -= paid;
            }
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

    /// PETRI units earned per colony since this engine started (f64 is exact below 2^53 units, ~9 billion PETRI).
    pub fn earned(&self) -> Vec<f64> {
        self.earned.iter().map(|&v| v as f64).collect()
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
            earned: self.earned.clone(),
            last_births: self.last_births.clone(),
            last_deaths: self.last_deaths.clone(),
            last_live: self.last_live.clone(),
            last_contested: self.last_contested,
        }
    }
}

/// What planting `cells` costs (in PETRI units, as a decimal string) with `total_live` cells alive.
#[wasm_bindgen]
pub fn quote(base_units: &str, cells: u32, total_live: u32, capacity: u32) -> String {
    plant_cost(base_units.parse().unwrap_or(0), cells, total_live, capacity).to_string()
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
