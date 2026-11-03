//! Petri economy simulator, v3.
//!
//! Runs the real rules from `petri-core` (the Life step, the capped feed, the planting price with the siege
//! surcharge, the purchase and sell-back curves and the tide split) for days of 15-second generations, with scripted
//! players including adversaries, and reports what every kind of player ends up with **in NEAR**. The contract's own
//! book-keeping (the join stake, storage, the vault, the sell-back allowance, the tide bounty, the keeper pot and who
//! runs each catch-up) is mirrored from `contract/src/lib.rs`. Storage sizes and gas are estimates; they are listed in
//! the summary header.
//!
//! ```text
//! cargo run --release -p petri-sim -- <out_dir> sweep                    # reach x siege_x sweep -> sweep.txt, sweep.csv
//! cargo run --release -p petri-sim -- <out_dir> main <reach> <siege_x>   # every scenario -> summary.txt and CSVs
//! ```

use petri_core::{feed, feed_per_cell, near_for_petri, patterns, petri_for_near, planting_cost, tide_split, ColonyId, Dish, EMPTY};
use std::fmt::Write as _;
use std::fs;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::Instant;

/// One PETRI in units (6 decimals).
const UNIT: u128 = 1_000_000;
/// One NEAR in yoctoNEAR.
const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
/// NEAR's storage price: 10^19 yoctoNEAR per byte (0.01 NEAR per kB).
const BYTE: u128 = 10_000_000_000_000_000_000;
/// One TGas burnt at NEAR's minimum gas price (10^8 yocto per gas) is 0.0001 NEAR.
const TGAS: u128 = NEAR / 10_000;
const GENS_PER_DAY: u64 = 86_400 / 15;
const SIDE: i32 = 128;
const CELLS: usize = (SIDE * SIDE) as usize;

// Storage the contract measures at run time, estimated from the borsh sizes of what each call writes plus NEAR's
// 40-byte per-record overhead. The sale and planting figures match the contract's own constants.
/// Colony record (~221 B), account index (~67), name (~57), balance record (~81), join entry (~56), the four
/// per-colony vectors (+40) and the 110 bytes `join` charges up front for its purchase entry.
const JOIN_BYTES: u128 = 632;
const BUY_BYTES: u128 = 110;
/// `plant_deposit` asks for (300 + 6 x cells) bytes, (+ note + 64 with a note) plus the cell fee. The contract keeps
/// the storage it measures and sends the rest of the deposit to the vault.
const PLANT_DEPOSIT_BASE_BYTES: u128 = 300;
const PLANT_CELL_BYTES: u128 = 6;
/// What a planting is estimated to really store: the Plant entry (48 + 4 x cells bytes of borsh, key, 40-byte record
/// overhead), its plant-index entry (~53) and 2 bytes per cell on the board: about 146 + 6 x cells.
const PLANT_STORED_BASE_BYTES: u128 = 146;
/// The house strains write a lab note of about 120 bytes with every planting.
const NOTE_LEN: u128 = 120;
/// A sale's ledger entry: about 0.00105 NEAR, paid from the proceeds.
const SELL_BYTES: u128 = 105;
/// A tide's ledger entry (with its 64-character chain) and its tide index: paid from the vault, or by the contract
/// itself when the vault is empty.
const TIDE_BYTES: u128 = 240;

// Gas, estimated from a testnet planting that also caught up three generations and burned 4.43 TGas.
const GAS_TX: u128 = 35 * TGAS / 10;
const GAS_PER_GEN: u128 = 3 * TGAS / 10;
/// A call that sends NEAR (sell, claim) adds a transfer and a callback.
const GAS_PAYOUT: u128 = 2 * TGAS;

/// The launch rules. `reach`, `siege_x` and `siege_allowed` are what the sweep varies.
#[derive(Clone, Debug)]
struct Rules {
    reach: u32,
    siege_x: u32,
    /// false is the v2 rule (no planting inside a rival's buffer at any price), kept to measure the lockout without
    /// siege.
    siege_allowed: bool,
    feed_ppm: u32,
    keeper_bps: u16,
    burn_bps: u128,
    payback: u32,
    min_cell_price: u128,
    live_floor: u32,
    petri_price: u128,
    max_supply: u128,
    min_join: u128,
    cell_fee: u128,
    tide_every: u64,
    tide_bps: u128,
    tide_bounty_bps: u128,
    sell_bps: u16,
    sell_cap_bps: u128,
    buffer: u16,
    max_plant_cells: u32,
    /// Bytes `plant_deposit` asks for per planting and per cell, and bytes a planting is estimated to store
    /// (see the constants above). A fix experiment shrinks them to model a ledger kept as events.
    deposit_base_bytes: u128,
    stored_base_bytes: u128,
    cell_bytes: u128,
    /// Fix experiment: 0 is the contract's rule (reach counts every cell ever planted); n > 0 halves each colony's
    /// planted count every n tides, so the cap follows recent planting.
    planted_halflife_tides: u32,
    /// Fix experiment: false leaves the house colonies out of the feed as well as the tides.
    house_fed: bool,
    /// Fix experiment: the most NEAR a tide bounty pays (the contract pays 1% of the tide, uncapped).
    bounty_cap: u128,
}

impl Rules {
    fn launch(reach: u32, siege_x: u32) -> Self {
        Rules {
            reach,
            siege_x,
            siege_allowed: true,
            feed_ppm: 10,
            keeper_bps: 200,
            burn_bps: 5_000,
            payback: 480,
            min_cell_price: UNIT / 2,
            live_floor: 1_000,
            petri_price: NEAR / 5_000,
            max_supply: 1_000_000 * UNIT,
            min_join: NEAR / 100,
            cell_fee: NEAR / 10_000,
            tide_every: 240,
            tide_bps: 5_000,
            tide_bounty_bps: 100,
            sell_bps: 5_000,
            sell_cap_bps: 1_000,
            buffer: 3,
            max_plant_cells: 64,
            deposit_base_bytes: PLANT_DEPOSIT_BASE_BYTES,
            stored_base_bytes: PLANT_STORED_BASE_BYTES,
            cell_bytes: PLANT_CELL_BYTES,
            planted_halflife_tides: 0,
            house_fed: true,
            bounty_cap: u128::MAX,
        }
    }

    /// The curve constant, as the contract computes it: launch price x full supply (200 NEAR).
    fn k(&self) -> u128 {
        self.petri_price / 1_000_000 * self.max_supply
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Kind {
    /// Still lifes (blocks, beehives, loaves) near home. 0.05 NEAR.
    Builder,
    /// Gliders and spaceships aimed at rivals' cells, and one move in three a blinker dropped right against a rival
    /// (a deliberate siege) to break it. 0.05 NEAR.
    Raider,
    /// Eaters and beehives near home. 0.05 NEAR.
    Defender,
    /// One R-pentomino an hour, anywhere within 40 cells of home, betting on its growth: the grower that took 45% of
    /// the v1 dish. 0.1 NEAR.
    Methuselah,
    /// Plays like a builder but joins on day 2 or 3. 0.05 NEAR.
    Late,
    /// 2 NEAR in one colony, pulsars and beehives anywhere on the dish, acting as often as the sybil whale's colonies
    /// together.
    Whale,
    /// The same 2 NEAR split across many colonies that each play like the whale (one operator; results are per
    /// operator).
    SybilWhale,
    /// Plants only in the last three generations before each tide and sells after every tide. 0.05 NEAR.
    Sniper,
    /// Blankets the dish at launch with a lattice of blocks 8 cells apart, so every empty cell is inside its buffer,
    /// and repairs the lattice every 20 generations. 1.5 NEAR.
    Locker,
    /// Never plants. Calls `advance` just before the team keeper would, and right after every tide for the bounty,
    /// whenever the pot and bounty are worth more than the gas; sells the pot. Joins with the 0.01 NEAR minimum.
    Racer,
    /// Never plants: buys 0.2 NEAR of PETRI at join and sells it back as fast as the allowance lets it.
    Seller,
    /// The team's five AI strains: play like mixed builders with lab notes, buy 0.02 NEAR when they cannot afford
    /// three blocks, never sell, take no tide share.
    House,
}

const KINDS: [Kind; 12] = [
    Kind::Builder,
    Kind::Raider,
    Kind::Defender,
    Kind::Methuselah,
    Kind::Late,
    Kind::Whale,
    Kind::SybilWhale,
    Kind::Sniper,
    Kind::Locker,
    Kind::Racer,
    Kind::Seller,
    Kind::House,
];

/// A society: (kind, players of that kind, colonies per player).
type Society = Vec<(Kind, usize, usize)>;

struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        // splitmix64, so nearby seeds give unrelated streams.
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

/// One NEAR account with one colony.
struct Acct {
    kind: Kind,
    /// The player (operator) this colony belongs to; a sybil whale has many colonies per player.
    group: usize,
    id: ColonyId,
    home: (i32, i32),
    join_at: u64,
    every: u64,
    phase: u64,
    /// NEAR attached to `join`.
    bring: u128,
    /// NEAR the player is willing to attach in all (join, purchases, deposits). Tide winnings (claimed daily),
    /// sales and bounties go back into it, so winners keep playing with what they win.
    wallet: u128,
    unclaimed_near: u128,
    /// Cell-generations alive, and those not paid because of the reach cap.
    live_gens: u64,
    unpaid_gens: u64,
    joined: bool,
    top_ups: u32,
    /// PETRI held, unclaimed earnings included.
    balance: u128,
    /// PETRI fed by the agar.
    earned: u128,
    /// PETRI paid for plantings.
    spent: u128,
    /// PETRI from the keeper pot.
    pot: u128,
    /// All NEAR attached: joins, purchases and planting deposits, storage included.
    near_paid: u128,
    near_tides: u128,
    /// NEAR received for sales, after each sale's storage.
    near_sold: u128,
    near_bounty: u128,
    gas: u128,
    owes_claim: bool,
    /// Locker only: the lattice of block positions and how far the first pass has got.
    lattice: Vec<(i32, i32)>,
    lattice_done: usize,
}

#[derive(Clone, Default)]
struct Keeper {
    pot: u128,
    bounty: u128,
    gas: u128,
    calls: u64,
}

/// The dish at a tide.
#[derive(Clone)]
struct TideRow {
    gen: u64,
    live: u32,
    agar: u128,
    vault: u128,
    sell_left: u128,
    /// Buy price of one PETRI, yoctoNEAR.
    price: u128,
    /// Share of the dish where a newcomer can plant a single cell without siege.
    free: f64,
    /// Share of positions where a newcomer's 2x2 block fits without siege.
    block_free: f64,
    /// The cheapest block a newcomer can plant (PETRI units, and NEAR with the planting deposit), or None if it
    /// cannot plant at all.
    newcomer_petri: Option<u128>,
    newcomer_near: Option<u128>,
    /// What a siege block costs right now (NEAR with the deposit), whether or not a newcomer needs one.
    siege_near: u128,
    contract_storage: u128,
    keeper_gas: u128,
    house_earned: u128,
    tides_paid: u128,
}

/// One player's totals (summed over its colonies).
#[derive(Clone)]
struct GroupOut {
    kind: Kind,
    accounts: usize,
    paid: u128,
    tides: u128,
    sold: u128,
    bounty: u128,
    /// PETRI still held, valued at the sell-back price (less a sale's storage).
    held: u128,
    gas: u128,
    earned: u128,
    spent: u128,
    pot: u128,
    live: u32,
    live_gens: u64,
    unpaid_gens: u64,
}

impl GroupOut {
    fn out(&self) -> f64 {
        nf(self.tides + self.sold + self.bounty + self.held)
    }
    fn net(&self) -> f64 {
        self.out() - nf(self.paid)
    }
    fn cash(&self) -> f64 {
        nf(self.tides + self.sold + self.bounty) - nf(self.paid)
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
    /// Every player's PETRI (house excluded) valued one holder at a time at the sell-back price.
    held_total: u128,
    held_petri: u128,
    keeper: Keeper,
    /// Largest single player's share of the living cells and of all tide NEAR.
    top_live: f64,
    top_tides: f64,
    top_tides_kind: Option<Kind>,
    storage_players: u128,
    storage_vault: u128,
    contract_storage: u128,
    vault_in: u128,
    tides_paid: u128,
    sold_total: u128,
    house_paid: u128,
    secs: f64,
}

struct RunOut {
    groups: Vec<GroupOut>,
    world: WorldOut,
    timeline: Vec<TideRow>,
}

struct World {
    r: Rules,
    k: u128,
    d: Dish,
    rng: Rng,
    accts: Vec<Acct>,
    groups: usize,
    racers: Vec<usize>,
    house: Vec<ColonyId>,
    /// Cells each colony has ever planted, by colony id: the base of its reach cap.
    planted: Vec<u64>,
    /// PETRI earned since the last tide, by colony id: the tide's weights.
    window: Vec<u64>,
    live: Vec<u32>,
    agar: u128,
    vault: u128,
    sell_left: u128,
    keeper_pot: u128,
    /// Tide bounties waiting for the first transaction after the tide.
    pending_bounty: u128,
    /// The generation the stored board is at: a transaction catches up from here and pays the gas.
    stored_gen: u64,
    burned: u128,
    fed: u128,
    peak_live: u32,
    keeper: Keeper,
    storage_players: u128,
    storage_vault: u128,
    contract_storage: u128,
    vault_in: u128,
    tides_paid: u128,
    sold_total: u128,
    timeline: Vec<TideRow>,
}

fn idx(x: i32, y: i32) -> usize {
    (y.rem_euclid(SIDE) * SIDE + x.rem_euclid(SIDE)) as usize
}

/// A pattern's cells at (x, y), turned `rot` quarter turns.
fn shape_cells(shape: &[(i32, i32)], x: i32, y: i32, rot: u8) -> Vec<u32> {
    shape
        .iter()
        .map(|&(dx, dy)| {
            let (mut a, mut b) = (dx, dy);
            for _ in 0..rot {
                let t = a;
                a = -b;
                b = t;
            }
            idx(x + a, y + b) as u32
        })
        .collect()
}

fn nf(y: u128) -> f64 {
    y as f64 / NEAR as f64
}

fn pf(u: u128) -> f64 {
    u as f64 / UNIT as f64
}

/// Where a newcomer (a colony with no cells) can plant without siege: (share of single cells, share of 2x2 block
/// positions). A cell is closed if any living cell is within `b` cells of it in both directions.
fn lockout(d: &Dish, b: i32) -> (f64, f64) {
    let w = SIDE as usize;
    let mut row = vec![false; CELLS];
    for y in 0..w {
        for x in 0..w {
            if d.cells[y * w + x] != EMPTY {
                for dx in -b..=b {
                    row[y * w + (x as i32 + dx).rem_euclid(SIDE) as usize] = true;
                }
            }
        }
    }
    let mut near = vec![false; CELLS];
    for y in 0..w {
        for x in 0..w {
            if row[y * w + x] {
                for dy in -b..=b {
                    near[(y as i32 + dy).rem_euclid(SIDE) as usize * w + x] = true;
                }
            }
        }
    }
    let free = near.iter().filter(|&&n| !n).count();
    let mut blocks = 0;
    for y in 0..SIDE {
        for x in 0..SIDE {
            if !near[idx(x, y)] && !near[idx(x + 1, y)] && !near[idx(x, y + 1)] && !near[idx(x + 1, y + 1)] {
                blocks += 1;
            }
        }
    }
    (free as f64 / CELLS as f64, blocks as f64 / CELLS as f64)
}

impl World {
    fn new(r: Rules, society: &Society, seed: u64, house_budget: u128) -> Self {
        let mut rng = Rng::new(seed);
        let mut accts: Vec<Acct> = Vec::new();
        let mut group = 0usize;
        for &(kind, players, per) in society {
            for _ in 0..players {
                // A sybil whale's colonies share one operator, but each has its own home.
                for _ in 0..per {
                    let join_at = match kind {
                        Kind::Locker | Kind::Racer | Kind::House => 0,
                        Kind::Late => 2 * GENS_PER_DAY + rng.range(GENS_PER_DAY),
                        // Everyone else arrives over the first day; the sniper and the seller in the first hour.
                        Kind::Sniper | Kind::Seller => rng.range(240),
                        _ => rng.range(GENS_PER_DAY),
                    };
                    let every = match kind {
                        Kind::Methuselah => 240,
                        // agents/run.mjs: each strain acts every 8 to 24 generations.
                        Kind::House => 8 + rng.range(17),
                        // The single whale acts as often as its ten sybil colonies together.
                        Kind::Whale => 2 + rng.range(5),
                        Kind::SybilWhale => 20 + rng.range(40),
                        _ => 20 + rng.range(100),
                    };
                    let bring = match kind {
                        Kind::Whale => 2 * NEAR,
                        Kind::SybilWhale => (2 * NEAR / per as u128).max(NEAR / 100),
                        Kind::Methuselah => NEAR / 10,
                        Kind::Locker => 3 * NEAR / 2,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        _ => NEAR / 20,
                    };
                    let wallet = match kind {
                        Kind::Whale => 3 * NEAR,
                        Kind::SybilWhale => 3 * NEAR / per as u128,
                        Kind::Methuselah => NEAR / 2,
                        Kind::Locker => 2 * NEAR,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        Kind::House => 0,
                        _ => NEAR / 4,
                    };
                    let mut lattice = Vec::new();
                    if kind == Kind::Locker {
                        let (ox, oy) = (rng.range(8) as i32, rng.range(8) as i32);
                        for j in 0..SIDE / 8 {
                            for i in 0..SIDE / 8 {
                                lattice.push((ox + 8 * i, oy + 8 * j));
                            }
                        }
                    }
                    accts.push(Acct {
                        kind,
                        group,
                        id: 0,
                        home: (rng.range(SIDE as u64) as i32, rng.range(SIDE as u64) as i32),
                        join_at,
                        every,
                        phase: rng.range(240),
                        bring,
                        wallet: if kind == Kind::House { house_budget } else { wallet },
                        unclaimed_near: 0,
                        live_gens: 0,
                        unpaid_gens: 0,
                        joined: false,
                        top_ups: 0,
                        balance: 0,
                        earned: 0,
                        spent: 0,
                        pot: 0,
                        near_paid: 0,
                        near_tides: 0,
                        near_sold: 0,
                        near_bounty: 0,
                        gas: 0,
                        owes_claim: false,
                        lattice,
                        lattice_done: 0,
                    });
                }
                group += 1;
            }
        }
        // Colony ids follow join order, as in the contract.
        accts.sort_by_key(|a| a.join_at);
        for (i, a) in accts.iter_mut().enumerate() {
            a.id = i as ColonyId + 1;
        }
        let house = accts.iter().filter(|a| a.kind == Kind::House).map(|a| a.id).collect();
        let racers = accts.iter().enumerate().filter(|(_, a)| a.kind == Kind::Racer).map(|(i, _)| i).collect();
        let n = accts.len();
        let k = r.k();
        World {
            agar: r.max_supply,
            r,
            k,
            d: Dish::new(SIDE as u16, SIDE as u16),
            rng,
            accts,
            groups: group,
            racers,
            house,
            planted: vec![0; n + 1],
            window: vec![0; n + 1],
            live: vec![0; n + 1],
            vault: 0,
            sell_left: 0,
            keeper_pot: 0,
            pending_bounty: 0,
            stored_gen: 0,
            burned: 0,
            fed: 0,
            peak_live: 0,
            keeper: Keeper::default(),
            storage_players: 0,
            storage_vault: 0,
            contract_storage: 0,
            vault_in: 0,
            tides_paid: 0,
            sold_total: 0,
            timeline: Vec::new(),
        }
    }

    // ---------- the contract's book-keeping ----------

    /// A transaction at clock generation `g`: it catches the stored board up (its sender pays the gas) and collects any
    /// tide bounty waiting since the last transaction. `who` is an account index, or None for the team keeper.
    /// Returns how many generations it ran.
    fn touch(&mut self, g: u64, who: Option<usize>, payout: bool) -> u64 {
        let gens = g - self.stored_gen;
        self.stored_gen = g;
        let gas = GAS_TX + GAS_PER_GEN * gens as u128 + if payout { GAS_PAYOUT } else { 0 };
        let bounty = std::mem::take(&mut self.pending_bounty);
        match who {
            Some(i) => {
                self.accts[i].gas += gas;
                self.accts[i].near_bounty += bounty;
                self.accts[i].wallet += bounty;
            }
            None => {
                self.keeper.gas += gas;
                self.keeper.bounty += bounty;
                self.keeper.calls += 1;
            }
        }
        gens
    }

    fn per_cell(&self) -> u128 {
        feed_per_cell(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.d.total_live(), self.r.live_floor)
    }

    fn cost(&self, cells: u32, siege: bool) -> u128 {
        planting_cost(self.per_cell(), self.r.payback, self.r.min_cell_price, cells, siege, self.r.siege_x)
    }

    /// `join`: the stake pays the colony's storage first and the rest buys PETRI into the vault.
    fn join(&mut self, i: usize, g: u64) {
        self.touch(g, Some(i), false);
        let deposit = self.accts[i].bring.max(self.r.min_join);
        let storage = JOIN_BYTES * BYTE;
        let net = deposit - storage;
        let units = petri_for_near(net, self.agar, self.k);
        self.agar -= units;
        self.vault += net;
        self.vault_in += net;
        self.storage_players += storage;
        let a = &mut self.accts[i];
        a.near_paid += deposit;
        a.wallet = a.wallet.saturating_sub(deposit);
        a.balance += units;
        a.joined = true;
    }

    fn buy(&mut self, i: usize, g: u64, near: u128) {
        self.touch(g, Some(i), false);
        let storage = BUY_BYTES * BYTE;
        let units = petri_for_near(near - storage, self.agar, self.k);
        self.agar -= units;
        self.vault += near - storage;
        self.vault_in += near - storage;
        self.storage_players += storage;
        let a = &mut self.accts[i];
        a.near_paid += near;
        a.wallet -= near;
        a.balance += units;
    }

    /// The NEAR a planting of `n` cells attaches: its storage plus the cell fee.
    fn deposit(&self, n: u32, note: bool) -> u128 {
        (self.r.deposit_base_bytes + self.r.cell_bytes * n as u128 + if note { NOTE_LEN + 64 } else { 0 }) * BYTE + self.r.cell_fee * n as u128
    }

    fn can_attach(&self, i: usize, n: u32, note: bool) -> bool {
        self.accts[i].wallet >= self.deposit(n, note)
    }

    /// `plant`: half the PETRI is burned and half returns to the agar; the deposit pays the storage and `cell_fee`
    /// per cell goes to the vault.
    fn plant(&mut self, i: usize, g: u64, cells: Vec<u32>, siege: bool, note: bool) {
        self.touch(g, Some(i), false);
        let n = cells.len() as u32;
        let cost = self.cost(n, siege);
        let burn = cost * self.r.burn_bps / 10_000;
        self.burned += burn;
        self.agar += cost - burn;
        let id = self.accts[i].id;
        self.d.plant_unchecked(id, &cells);
        self.planted[id as usize] += n as u64;
        let deposit = self.deposit(n, note);
        let stored = (self.r.stored_base_bytes + self.r.cell_bytes * n as u128 + if note { NOTE_LEN + 49 } else { 0 }) * BYTE;
        self.storage_players += stored;
        self.vault += deposit - stored;
        self.vault_in += deposit - stored;
        let a = &mut self.accts[i];
        a.balance -= cost;
        a.spent += cost;
        a.near_paid += deposit;
        a.wallet -= deposit;
    }

    /// `sell`: the agar buys back at `sell_bps` of the curve, within what is left of the allowance; the sale's record
    /// is paid from the proceeds. Sells less than asked if the allowance is short; skips a sale not worth its record.
    fn sell(&mut self, i: usize, g: u64, want: u128) {
        let storage = SELL_BYTES * BYTE;
        let mut units = want.min(self.accts[i].balance);
        if units == 0 || self.sell_left <= 2 * storage {
            return;
        }
        let mut near = near_for_petri(units, self.agar, self.k, self.r.sell_bps);
        if near > self.sell_left {
            units = units * (self.sell_left / 1_000_000_000) / (near / 1_000_000_000).max(1);
            loop {
                near = near_for_petri(units, self.agar, self.k, self.r.sell_bps);
                if near <= self.sell_left || units == 0 {
                    break;
                }
                units -= units / 100 + 1;
            }
        }
        if near <= 2 * storage {
            return;
        }
        self.touch(g, Some(i), true);
        self.agar += units;
        self.vault -= near;
        self.sell_left -= near;
        self.storage_players += storage;
        self.sold_total += near - storage;
        let a = &mut self.accts[i];
        a.balance -= units;
        a.near_sold += near - storage;
        a.wallet += near - storage;
    }

    /// `advance`: catch up, and the keeper pot goes to the caller if the call ran at least one generation.
    fn advance(&mut self, who: Option<usize>, g: u64) {
        let gens = self.touch(g, who, false);
        if gens > 0 && self.keeper_pot > 0 {
            let pot = std::mem::take(&mut self.keeper_pot);
            match who {
                Some(i) => {
                    self.accts[i].balance += pot;
                    self.accts[i].pot += pot;
                }
                None => self.keeper.pot += pot,
            }
        }
    }

    /// One generation: Life, the capped feed into balances, the window and the keeper pot, and the tide when due.
    fn step(&mut self, g: u64) {
        let n = self.accts.len() as u16;
        let s = self.d.step(n);
        let f = if self.r.house_fed {
            feed(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.r.reach, self.r.live_floor, &s.live, &self.planted, &[])
        } else {
            let mut live = s.live.clone();
            for &h in &self.house {
                live[h as usize] = 0;
            }
            feed(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.r.reach, self.r.live_floor, &live, &self.planted, &[])
        };
        for &(c, amount) in &f.shares {
            let a = &mut self.accts[c as usize - 1];
            a.balance += amount;
            a.earned += amount;
            self.window[c as usize] += amount as u64;
        }
        self.agar -= f.paid;
        self.keeper_pot += f.keeper;
        self.fed += f.paid;
        for c in 1..s.live.len() {
            let l = s.live[c] as u64;
            if l > 0 {
                let cap = self.planted[c] * self.r.reach as u64;
                let a = &mut self.accts[c - 1];
                a.live_gens += l;
                a.unpaid_gens += l.saturating_sub(cap);
            }
        }
        self.peak_live = self.peak_live.max(s.total_live);
        self.live = s.live;
        let gen = g + 1;
        if gen % self.r.tide_every == 0 {
            self.tide(gen);
        }
    }

    /// One tide, as `Petri::tide`: `tide_bps` of the vault, 1% of it to whoever runs the tide, the entry's storage,
    /// and the rest split by the window's earnings with the house left out. Then the sell-back allowance reopens.
    fn tide(&mut self, gen: u64) {
        let tide_cost = TIDE_BYTES * BYTE;
        let pay = self.vault * self.r.tide_bps / 10_000;
        let bounty = (pay * self.r.tide_bounty_bps / 10_000).min(self.r.bounty_cap);
        let storage = tide_cost.min(pay - bounty);
        let (split, paid) = tide_split(pay - bounty - storage, &self.window, &self.house);
        for &(c, s) in &split {
            let a = &mut self.accts[c as usize - 1];
            a.near_tides += s;
            a.unclaimed_near += s;
            a.owes_claim = true;
        }
        let (bounty, storage) = if paid > 0 { (bounty, storage) } else { (0, tide_cost.min(self.vault)) };
        self.contract_storage += tide_cost - storage;
        self.storage_vault += storage;
        self.vault -= paid + bounty + storage;
        self.pending_bounty += bounty;
        self.tides_paid += paid;
        self.window.iter_mut().for_each(|w| *w = 0);
        self.sell_left = self.vault * self.r.sell_cap_bps / 10_000;
        if self.r.planted_halflife_tides > 0 {
            let f = 0.5f64.powf(1.0 / self.r.planted_halflife_tides as f64);
            for p in self.planted.iter_mut() {
                *p = (*p as f64 * f) as u64;
            }
        }
        // Record the dish and what a newcomer faces.
        let (free, block_free) = lockout(&self.d, self.r.buffer as i32);
        let newcomer_petri = if block_free > 0.0 {
            Some(self.cost(4, false))
        } else if self.r.siege_allowed {
            Some(self.cost(4, true))
        } else {
            None
        };
        let deposit = self.deposit(4, false);
        let newcomer_near = newcomer_petri.map(|p| p * self.k / self.agar + deposit);
        let siege_near = self.cost(4, true) * self.k / self.agar + deposit;
        let house_earned = self.accts.iter().filter(|a| a.kind == Kind::House).map(|a| a.earned).sum();
        self.timeline.push(TideRow {
            gen,
            live: self.d.total_live(),
            agar: self.agar,
            vault: self.vault,
            sell_left: self.sell_left,
            price: self.k * UNIT / self.agar,
            free,
            block_free,
            newcomer_petri,
            newcomer_near,
            siege_near,
            contract_storage: self.contract_storage,
            keeper_gas: self.keeper.gas,
            house_earned,
            tides_paid: self.tides_paid,
        });
    }

    // ---------- the players ----------

    /// Up to `tries` candidate plantings; the first that needs no siege, else the first legal siege.
    fn try_place(&mut self, me: ColonyId, tries: usize, mut gen: impl FnMut(&mut Rng) -> Vec<u32>) -> (Option<Vec<u32>>, Option<Vec<u32>>) {
        let mut sieged = None;
        for _ in 0..tries {
            let cells = gen(&mut self.rng);
            match self.d.check_plant(me, &cells, self.r.buffer, self.r.max_plant_cells) {
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

    /// Plant `shape` somewhere within `radius` of `center`: out of every rival's buffer if it can, else as a siege if
    /// that is allowed and affordable. Careful players spend at most half their PETRI on one planting.
    fn plant_near(&mut self, i: usize, g: u64, shape: &'static [(i32, i32)], center: (i32, i32), radius: i32, reckless: bool, note: bool) -> bool {
        let n = shape.len() as u32;
        let (base, siege) = (self.cost(n, false), self.cost(n, true));
        let bal = self.accts[i].balance;
        let limit = if reckless { bal } else { bal / 2 };
        if base > limit || !self.can_attach(i, n, note) {
            return false;
        }
        let me = self.accts[i].id;
        let span = 2 * radius as u64 + 1;
        let (free, sieged) = self.try_place(me, 30, |rng| {
            let x = center.0 + rng.range(span) as i32 - radius;
            let y = center.1 + rng.range(span) as i32 - radius;
            shape_cells(shape, x, y, rng.range(4) as u8)
        });
        if let Some(c) = free {
            self.plant(i, g, c, false, note);
            return true;
        }
        if self.r.siege_allowed && siege <= limit {
            if let Some(c) = sieged {
                self.plant(i, g, c, true, note);
                return true;
            }
        }
        false
    }

    /// A random living cell of some other colony (so richer colonies are hit more often).
    fn rival_cell(&mut self, me: ColonyId) -> Option<(i32, i32)> {
        for _ in 0..64 {
            let i = self.rng.range(CELLS as u64) as usize;
            let c = self.d.cells[i];
            if c != EMPTY && c != me {
                return Some(((i % SIDE as usize) as i32, (i / SIDE as usize) as i32));
            }
        }
        None
    }

    fn raid(&mut self, i: usize, g: u64) {
        let me = self.accts[i].id;
        let home = self.accts[i].home;
        let target = self.rival_cell(me).unwrap_or(home);
        let bal = self.accts[i].balance;
        if self.r.siege_allowed && self.rng.range(3) == 0 {
            // A blinker dropped against the rival: a deliberate siege that breaks still lifes.
            let cost = self.cost(3, true);
            if cost > bal / 2 || !self.can_attach(i, 3, false) {
                return;
            }
            let (free, sieged) = self.try_place(me, 20, |rng| {
                shape_cells(patterns::BLINKER, target.0 + rng.range(5) as i32 - 2, target.1 + rng.range(5) as i32 - 2, rng.range(2) as u8)
            });
            if let Some(c) = sieged {
                self.plant(i, g, c, true, false);
            } else if let Some(c) = free {
                self.plant(i, g, c, false, false);
            }
            return;
        }
        // A glider (or now and then a spaceship) launched at the target from 6 to 15 cells away.
        let shape = if self.rng.range(4) == 0 { patterns::LWSS } else { patterns::GLIDER };
        let n = shape.len() as u32;
        let (base, siege) = (self.cost(n, false), self.cost(n, true));
        if base > bal / 2 || !self.can_attach(i, n, false) {
            return;
        }
        let (free, sieged) = self.try_place(me, 20, |rng| {
            let rot = rng.range(4) as u8;
            let dir = [(1, 1), (-1, 1), (-1, -1), (1, -1)][rot as usize];
            let dist = 6 + rng.range(10) as i32;
            let jx = rng.range(5) as i32 - 2;
            let jy = rng.range(5) as i32 - 2;
            shape_cells(shape, target.0 - dir.0 * dist + jx, target.1 - dir.1 * dist + jy, rot)
        });
        if let Some(c) = free {
            self.plant(i, g, c, false, false);
        } else if self.r.siege_allowed && siege <= bal / 2 {
            if let Some(c) = sieged {
                self.plant(i, g, c, true, false);
            }
        }
    }

    /// The carpet locker: 16 lattice blocks per planting until the lattice is down, then repairs every 20 generations.
    fn locker(&mut self, i: usize, g: u64) {
        let first_pass = self.accts[i].lattice_done < self.accts[i].lattice.len();
        if !first_pass && (g + self.accts[i].phase) % 20 != 0 {
            return;
        }
        let per_block = self.cost(4, false).max(1);
        let mut max_blocks = ((self.accts[i].balance / per_block) as usize).min(16);
        while max_blocks > 0 && !self.can_attach(i, 4 * max_blocks as u32, false) {
            max_blocks -= 1;
        }
        if max_blocks == 0 {
            return;
        }
        let me = self.accts[i].id;
        let start = if first_pass { self.accts[i].lattice_done } else { 0 };
        let mut cells: Vec<u32> = Vec::new();
        let (mut blocks, mut examined) = (0usize, 0usize);
        for p in start..self.accts[i].lattice.len() {
            if blocks == max_blocks {
                break;
            }
            examined += 1;
            let (x, y) = self.accts[i].lattice[p];
            let b = shape_cells(patterns::BLOCK, x, y, 0);
            if !first_pass && b.iter().all(|&c| self.d.cells[c as usize] == me) {
                continue;
            }
            if let Ok(c) = self.d.check_plant(me, &b, self.r.buffer, self.r.max_plant_cells) {
                if !c.siege {
                    cells.extend(b);
                    blocks += 1;
                }
            }
        }
        if first_pass {
            self.accts[i].lattice_done += examined;
        }
        if !cells.is_empty() {
            if let Ok(c) = self.d.check_plant(me, &cells, self.r.buffer, self.r.max_plant_cells) {
                if !c.siege {
                    self.plant(i, g, cells, false, false);
                }
            }
        }
    }

    /// The keeper-pot racer: preempts the team keeper (which calls at 20 generations behind or a 5-PETRI pot) and
    /// grabs each tide bounty, but only when what it collects is worth more than the gas.
    fn racer(&mut self, i: usize, g: u64) {
        if !self.accts[i].joined {
            return;
        }
        let behind = g - self.stored_gen;
        if behind == 0 {
            return;
        }
        let due = self.pending_bounty > 0 || behind >= 19 || self.keeper_pot >= 49 * UNIT / 10;
        let value = self.pending_bounty + near_for_petri(self.keeper_pot, self.agar, self.k, self.r.sell_bps);
        let gas = GAS_TX + GAS_PER_GEN * behind as u128;
        if due && value > gas {
            self.advance(Some(i), g);
        }
    }

    /// Right after a tide the allowance reopens and sellers race for it: bots first, then about a quarter of the
    /// human players, who sell what they hold above a reserve of 16 cells' price.
    fn sell_round(&mut self, g: u64) {
        let mut bots = Vec::new();
        let mut humans = Vec::new();
        for i in 0..self.accts.len() {
            if !self.accts[i].joined {
                continue;
            }
            match self.accts[i].kind {
                Kind::Seller | Kind::Racer | Kind::Sniper => bots.push(i),
                Kind::House => {}
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
            let reserve = match self.accts[i].kind {
                Kind::Seller | Kind::Racer => 0,
                _ => self.cost(16, false),
            };
            let bal = self.accts[i].balance;
            if bal > reserve {
                self.sell(i, g, bal - reserve);
            }
        }
    }

    /// Players who run low buy a little more: the strains by their rule, ordinary players at most twice, a day in.
    fn top_up(&mut self, i: usize, g: u64) {
        let a = &self.accts[i];
        match a.kind {
            Kind::House => {
                if a.balance < 3 * self.cost(4, false) && a.wallet >= NEAR / 50 {
                    self.buy(i, g, NEAR / 50);
                }
            }
            Kind::Builder | Kind::Late | Kind::Raider | Kind::Defender => {
                if a.top_ups < 2 && a.wallet >= NEAR / 50 && g >= a.join_at + GENS_PER_DAY && a.balance < 2 * self.cost(6, false) {
                    self.accts[i].top_ups += 1;
                    self.buy(i, g, NEAR / 50);
                }
            }
            _ => {}
        }
    }

    fn act(&mut self, i: usize, g: u64) {
        let (kind, home, every, phase) = {
            let a = &self.accts[i];
            (a.kind, a.home, a.every, a.phase)
        };
        match kind {
            Kind::Racer | Kind::Seller => {}
            Kind::Locker => self.locker(i, g),
            Kind::Sniper => {
                let to_tide = self.r.tide_every - g % self.r.tide_every;
                if to_tide <= 3 {
                    self.plant_near(i, g, patterns::BLOCK, home, 20, false, false);
                }
            }
            _ => {
                if (g + phase) % every != 0 {
                    return;
                }
                self.top_up(i, g);
                let pick = self.rng.range(6) as usize;
                match kind {
                    Kind::Raider => self.raid(i, g),
                    Kind::Builder | Kind::Late => {
                        let s = [patterns::BLOCK, patterns::BEEHIVE, patterns::LOAF][pick % 3];
                        self.plant_near(i, g, s, home, 12, false, false);
                    }
                    Kind::Defender => {
                        let s = if pick % 2 == 0 { patterns::EATER } else { patterns::BEEHIVE };
                        self.plant_near(i, g, s, home, 12, false, false);
                    }
                    Kind::Methuselah => {
                        self.plant_near(i, g, patterns::R_PENTOMINO, home, 40, true, false);
                    }
                    Kind::Whale | Kind::SybilWhale => {
                        // One colony may plant anywhere, so the whale spreads over the whole dish like its sybil twin.
                        let s = if pick % 2 == 0 { patterns::PULSAR } else { patterns::BEEHIVE };
                        let (center, radius) = if kind == Kind::Whale { ((self.rng.range(128) as i32, self.rng.range(128) as i32), 30) } else { (home, 30) };
                        self.plant_near(i, g, s, center, radius, true, false);
                    }
                    Kind::House => {
                        let s = [patterns::BLOCK, patterns::BEEHIVE, patterns::GLIDER, patterns::EATER, patterns::LOAF][((g / every) % 5) as usize];
                        self.plant_near(i, g, s, home, 20, false, true);
                    }
                    _ => {}
                }
            }
        }
    }

    fn run(mut self, days: u64) -> RunOut {
        let t0 = Instant::now();
        let total = days * GENS_PER_DAY;
        let n = self.accts.len();
        let mut next_join = 0usize;
        for g in 0..total {
            // Joins, in id order.
            while next_join < n && self.accts[next_join].join_at == g {
                self.join(next_join, g);
                next_join += 1;
            }
            // Bots watch the chain and get in first.
            for r in 0..self.racers.len() {
                let i = self.racers[r];
                self.racer(i, g);
            }
            if g > 0 && g % self.r.tide_every == 0 {
                self.sell_round(g);
            }
            if n > 0 {
                let start = (g as usize).wrapping_mul(7919) % n;
                for j in 0..n {
                    let i = (start + j) % n;
                    if self.accts[i].joined {
                        self.act(i, g);
                    }
                }
            }
            // Players claim their tide winnings once a day.
            if g % GENS_PER_DAY == 0 {
                for i in 0..n {
                    if self.accts[i].owes_claim {
                        let a = &mut self.accts[i];
                        a.owes_claim = false;
                        a.wallet += std::mem::take(&mut a.unclaimed_near);
                        self.touch(g, Some(i), true);
                    }
                }
            }
            // The team keeper: advance when 20 behind or the pot holds more than 5 PETRI.
            if g - self.stored_gen >= 20 || self.keeper_pot > 5 * UNIT {
                self.advance(None, g);
            }
            self.step(g);
        }
        self.finish(t0.elapsed().as_secs_f64())
    }

    fn finish(self, secs: f64) -> RunOut {
        let storage = SELL_BYTES * BYTE;
        let mut groups: Vec<Option<GroupOut>> = vec![None; self.groups];
        let mut held_total = 0u128;
        let mut held_petri = 0u128;
        let mut house_paid = 0u128;
        for a in &self.accts {
            let held = near_for_petri(a.balance, self.agar, self.k, self.r.sell_bps).saturating_sub(storage);
            if a.kind != Kind::House {
                held_total += held;
                held_petri += a.balance;
            } else {
                house_paid += a.near_paid;
            }
            let e = groups[a.group].get_or_insert(GroupOut {
                kind: a.kind,
                accounts: 0,
                paid: 0,
                tides: 0,
                sold: 0,
                bounty: 0,
                held: 0,
                gas: 0,
                earned: 0,
                spent: 0,
                pot: 0,
                live: 0,
                live_gens: 0,
                unpaid_gens: 0,
            });
            e.accounts += 1;
            e.paid += a.near_paid;
            e.tides += a.near_tides;
            e.sold += a.near_sold;
            e.bounty += a.near_bounty;
            e.held += held;
            e.gas += a.gas;
            e.earned += a.earned;
            e.spent += a.spent;
            e.pot += a.pot;
            e.live_gens += a.live_gens;
            e.unpaid_gens += a.unpaid_gens;
            e.live += self.live.get(a.id as usize).copied().unwrap_or(0);
        }
        let groups: Vec<GroupOut> = groups.into_iter().flatten().collect();
        let total_live: u32 = self.live.iter().skip(1).sum();
        let top_live = groups.iter().map(|g| g.live).max().unwrap_or(0) as f64 / total_live.max(1) as f64;
        let top = groups.iter().max_by_key(|g| g.tides);
        let top_tides = top.map(|g| g.tides as f64 / self.tides_paid.max(1) as f64).unwrap_or(0.0);
        let top_tides_kind = top.filter(|g| g.tides > 0).map(|g| g.kind);
        RunOut {
            world: WorldOut {
                live: self.d.total_live(),
                peak: self.peak_live,
                agar: self.agar,
                burned: self.burned,
                fed: self.fed,
                vault: self.vault,
                held_total,
                held_petri,
                keeper: self.keeper.clone(),
                top_live,
                top_tides,
                top_tides_kind,
                storage_players: self.storage_players,
                storage_vault: self.storage_vault,
                contract_storage: self.contract_storage,
                vault_in: self.vault_in,
                tides_paid: self.tides_paid,
                sold_total: self.sold_total,
                house_paid,
                secs,
            },
            groups,
            timeline: self.timeline,
        }
    }
}

// ---------- societies and scenarios ----------

/// The mixed society at about 15, 150 or 1,500 players, plus the five house strains. `locker` false swaps the carpet
/// locker for one more builder (the control for the lockout).
fn society(scale: usize, locker: bool) -> Society {
    let l = if locker { 1 } else { 0 };
    let mut s: Society = match scale {
        15 => vec![
            (Kind::Builder, 3 + 1 - l, 1),
            (Kind::Raider, 2, 1),
            (Kind::Defender, 1, 1),
            (Kind::Methuselah, 1, 1),
            (Kind::Late, 2, 1),
            (Kind::Whale, 1, 1),
            (Kind::SybilWhale, 1, 10),
            (Kind::Sniper, 1, 1),
            (Kind::Racer, 1, 1),
            (Kind::Seller, 1, 1),
        ],
        150 => vec![
            (Kind::Builder, 40 + 1 - l, 1),
            (Kind::Raider, 20, 1),
            (Kind::Defender, 15, 1),
            (Kind::Methuselah, 10, 1),
            (Kind::Late, 40, 1),
            (Kind::Whale, 5, 1),
            (Kind::SybilWhale, 2, 10),
            (Kind::Sniper, 5, 1),
            (Kind::Racer, 2, 1),
            (Kind::Seller, 10, 1),
        ],
        1500 => vec![
            (Kind::Builder, 451 + 1 - l, 1),
            (Kind::Raider, 200, 1),
            (Kind::Defender, 150, 1),
            (Kind::Methuselah, 100, 1),
            (Kind::Late, 450, 1),
            (Kind::Whale, 30, 1),
            (Kind::SybilWhale, 5, 20),
            (Kind::Sniper, 40, 1),
            (Kind::Racer, 3, 1),
            (Kind::Seller, 70, 1),
        ],
        _ => vec![],
    };
    if locker {
        s.push((Kind::Locker, 1, 1));
    }
    if scale > 0 {
        s.push((Kind::House, 5, 1));
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
    /// Seed stream: paired across parameter sets so they face the same players.
    stream: u64,
    /// NEAR each house strain may spend (the team's budget).
    house_budget: u128,
}

/// Run every (scenario, seed) on all cores. Returns runs grouped by scenario.
fn run_all(scenarios: &[Scenario]) -> Vec<Vec<RunOut>> {
    let jobs: Vec<(usize, u64)> = scenarios.iter().enumerate().flat_map(|(si, s)| (0..s.seeds).map(move |k| (si, k))).collect();
    // Longest jobs first so the pool drains evenly.
    let mut jobs = jobs;
    jobs.sort_by_key(|&(si, _)| std::cmp::Reverse(scenarios[si].days * colonies(&scenarios[si].society).max(1) as u64));
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
                let w = World::new(s.rules.clone(), &s.society, s.stream * 1_000 + k, s.house_budget);
                let out = w.run(s.days);
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

/// Median of the finite values (sorts `v` and drops NaNs).
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

/// Per seed, the mean over a kind's players of `f`.
fn per_seed(runs: &[RunOut], kind: Kind, f: impl Fn(&GroupOut) -> f64) -> Vec<f64> {
    runs.iter()
        .filter_map(|r| {
            let g: Vec<&GroupOut> = r.groups.iter().filter(|g| g.kind == kind).collect();
            (!g.is_empty()).then(|| g.iter().map(|x| f(x)).sum::<f64>() / g.len() as f64)
        })
        .collect()
}

/// A kind's share of everything the agar fed, per seed.
fn feed_share(runs: &[RunOut], kind: Kind) -> Vec<f64> {
    runs.iter()
        .map(|r| {
            let all: u128 = r.groups.iter().map(|g| g.earned).sum();
            let k: u128 = r.groups.iter().filter(|g| g.kind == kind).map(|g| g.earned).sum();
            k as f64 / all.max(1) as f64
        })
        .collect()
}

fn med_of(v: Vec<f64>) -> f64 {
    let mut v = v;
    median(&mut v)
}

fn kind_table(out: &mut String, runs: &[RunOut]) {
    let _ = writeln!(
        out,
        "  {:<11} {:>5} {:>5} | {:>8} {:>8} {:>8} {:>9} | {:>8} {:>8} {:>8} | {:>8} {:>7} {:>8} | {:>6} {:>9} {:>6} {:>7}",
        "kind", "plyrs", "accts", "paid", "tides", "sold", "held@sell", "net min", "net med", "net max", "cash med", "gas", "net-gas", "back/1", "PETRI e/s", "feed%", "capped%"
    );
    for kind in KINDS {
        let net = per_seed(runs, kind, |g| g.net());
        if net.is_empty() {
            continue;
        }
        let players = runs[0].groups.iter().filter(|g| g.kind == kind).count();
        let accts: usize = runs[0].groups.iter().filter(|g| g.kind == kind).map(|g| g.accounts).sum();
        let (lo, med, hi) = mmm(&net);
        let paid = med_of(per_seed(runs, kind, |g| nf(g.paid)));
        let tides = med_of(per_seed(runs, kind, |g| nf(g.tides + g.bounty)));
        let sold = med_of(per_seed(runs, kind, |g| nf(g.sold)));
        let held = med_of(per_seed(runs, kind, |g| nf(g.held)));
        let cash = med_of(per_seed(runs, kind, |g| g.cash()));
        let gas = med_of(per_seed(runs, kind, |g| nf(g.gas)));
        let net_gas = med_of(per_seed(runs, kind, |g| g.net() - nf(g.gas)));
        let back = med_of(per_seed(runs, kind, |g| g.out() / nf(g.paid).max(1e-12)));
        let es = med_of(per_seed(runs, kind, |g| if g.spent == 0 { f64::NAN } else { g.earned as f64 / g.spent as f64 }));
        let share = med_of(feed_share(runs, kind));
        let capped = med_of(per_seed(runs, kind, |g| if g.live_gens == 0 { f64::NAN } else { g.unpaid_gens as f64 / g.live_gens as f64 }));
        let es_s = if es.is_nan() { "-".to_string() } else { format!("{:.2}", es) };
        let _ = writeln!(
            out,
            "  {:<11} {:>5} {:>5} | {:>8.4} {:>8.4} {:>8.4} {:>9.4} | {:>+8.4} {:>+8.4} {:>+8.4} | {:>+8.4} {:>7.4} {:>+8.4} | {:>6.2} {:>9} {:>5.1}% {:>6.1}%",
            format!("{:?}", kind),
            players,
            accts,
            paid,
            tides,
            sold,
            held,
            lo,
            med,
            hi,
            cash,
            gas,
            net_gas,
            back,
            es_s,
            100.0 * share,
            if capped.is_nan() { 0.0 } else { 100.0 * capped }
        );
    }
}

fn world_lines(out: &mut String, runs: &[RunOut]) {
    let w = |f: &dyn Fn(&WorldOut) -> f64| -> String {
        let v: Vec<f64> = runs.iter().map(|r| f(&r.world)).collect();
        let (a, b, c) = mmm(&v);
        format!("{:.4} ({:.4}..{:.4})", b, a, c)
    };
    let wi = |f: &dyn Fn(&WorldOut) -> f64| -> String {
        let v: Vec<f64> = runs.iter().map(|r| f(&r.world)).collect();
        let (a, b, c) = mmm(&v);
        format!("{:.0} ({:.0}..{:.0})", b, a, c)
    };
    let _ = writeln!(out, "  dish at the end  : live {}  peak {}  agar {} PETRI  burned {}  fed {}", wi(&|x| x.live as f64), wi(&|x| x.peak as f64), wi(&|x| pf(x.agar)), wi(&|x| pf(x.burned)), wi(&|x| pf(x.fed)));
    let _ = writeln!(out, "  NEAR flows       : into vault {}  paid at tides {}  paid for sales {}  left in vault {}", w(&|x| nf(x.vault_in)), w(&|x| nf(x.tides_paid)), w(&|x| nf(x.sold_total)), w(&|x| nf(x.vault)));
    let _ = writeln!(out, "  storage          : players paid {}  from the vault (tide entries) {}  by the contract itself {}", w(&|x| nf(x.storage_players)), w(&|x| nf(x.storage_vault)), w(&|x| nf(x.contract_storage)));
    let _ = writeln!(
        out,
        "  exit liquidity   : players hold {} PETRI = {} NEAR at the sell-back price, vs {} NEAR in the vault (sell allowance is 10% of it per tide)",
        wi(&|x| pf(x.held_petri)),
        w(&|x| nf(x.held_total)),
        w(&|x| nf(x.vault))
    );
    let _ = writeln!(
        out,
        "  team keeper      : pot {} PETRI  bounties {} NEAR  gas {} NEAR  calls {}",
        wi(&|x| pf(x.keeper.pot)),
        w(&|x| nf(x.keeper.bounty)),
        w(&|x| nf(x.keeper.gas)),
        wi(&|x| x.keeper.calls as f64)
    );
    let _ = writeln!(out, "  house strains    : NEAR paid in (team cost) {}", w(&|x| nf(x.house_paid)));
    let mut kinds: Vec<String> = runs.iter().filter_map(|r| r.world.top_tides_kind.map(|k| format!("{:?}", k))).collect();
    kinds.sort();
    kinds.dedup();
    let _ = writeln!(
        out,
        "  concentration    : largest player holds {} of living cells; largest tide winner took {} of tide NEAR (kinds: {})",
        w(&|x| x.top_live),
        w(&|x| x.top_tides),
        kinds.join(", ")
    );
}

/// The newcomer's view at chosen tides: median (min..max) over seeds.
fn lockout_table(out: &mut String, label: &str, runs: &[RunOut], days: u64) {
    let mut marks: Vec<(String, usize)> = vec![("1 h".into(), 1), ("6 h".into(), 6)];
    for d in [1u64, 2, 3, 5, 7, 14, 21, 30] {
        if d <= days {
            marks.push((format!("day {}", d), (d * 24) as usize));
        }
    }
    let _ = writeln!(out, "  {}", label);
    let _ = writeln!(out, "    {:<7} | {:>26} | {:>26} | {:>22} | {:>22} | {:>13}", "time", "free cells % med(min..max)", "free block spots %", "newcomer block PETRI", "newcomer block mNEAR", "siege blk mN");
    for (name, t) in marks {
        let rows: Vec<&TideRow> = runs.iter().filter_map(|r| r.timeline.get(t - 1)).collect();
        if rows.is_empty() {
            continue;
        }
        let free: Vec<f64> = rows.iter().map(|r| 100.0 * r.free).collect();
        let blk: Vec<f64> = rows.iter().map(|r| 100.0 * r.block_free).collect();
        let locked = rows.iter().filter(|r| r.newcomer_petri.is_none()).count();
        let petri: Vec<f64> = rows.iter().filter_map(|r| r.newcomer_petri.map(pf)).collect();
        let mn: Vec<f64> = rows.iter().filter_map(|r| r.newcomer_near.map(|y| 1000.0 * nf(y))).collect();
        let siege: Vec<f64> = rows.iter().map(|r| 1000.0 * nf(r.siege_near)).collect();
        let (fa, fb, fc) = mmm(&free);
        let (ba, bb, bc) = mmm(&blk);
        let cost = |v: &[f64]| {
            if v.is_empty() {
                "cannot plant".to_string()
            } else {
                let (a, b, c) = mmm(v);
                format!("{:.2} ({:.2}..{:.2})", b, a, c)
            }
        };
        let lockednote = if locked > 0 { format!("  [{} of {} seeds: no legal planting]", locked, rows.len()) } else { String::new() };
        let _ = writeln!(
            out,
            "    {:<7} | {:>9.1} ({:>5.1}..{:>5.1}) | {:>9.1} ({:>5.1}..{:>5.1}) | {:>22} | {:>22} | {:>13.2}{}",
            name,
            fb,
            fa,
            fc,
            bb,
            ba,
            bc,
            cost(&petri),
            cost(&mn),
            med_of(siege),
            lockednote
        );
    }
}

fn timeline_csv(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for t in &r.timeline {
            let _ = writeln!(
                csv,
                "{},{},{},{:.3},{},{:.0},{:.6},{:.6},{:.8},{:.4},{:.4},{},{},{:.6},{:.6},{:.6}",
                name,
                k,
                t.gen,
                t.gen as f64 / GENS_PER_DAY as f64,
                t.live,
                pf(t.agar),
                nf(t.vault),
                nf(t.sell_left),
                nf(t.price),
                100.0 * t.free,
                100.0 * t.block_free,
                t.newcomer_petri.map(|p| format!("{:.4}", pf(p))).unwrap_or_default(),
                t.newcomer_near.map(|p| format!("{:.6}", nf(p))).unwrap_or_default(),
                nf(t.contract_storage),
                nf(t.keeper_gas),
                nf(t.tides_paid),
            );
        }
    }
}

fn kinds_csv(csv: &mut String, name: &str, runs: &[RunOut]) {
    for (k, r) in runs.iter().enumerate() {
        for (gi, g) in r.groups.iter().enumerate() {
            let _ = writeln!(
                csv,
                "{},{},{},{:?},{},{:.6},{:.6},{:.6},{:.6},{:.6},{:.6},{:+.6},{:+.6},{:.3},{:.3},{:.3},{}",
                name,
                k,
                gi,
                g.kind,
                g.accounts,
                nf(g.paid),
                nf(g.tides),
                nf(g.bounty),
                nf(g.sold),
                nf(g.held),
                nf(g.gas),
                g.net(),
                g.cash(),
                pf(g.earned),
                pf(g.spent),
                pf(g.pot),
                g.live
            );
        }
    }
}

/// One line per scenario: the median net NEAR of each kind's mean player, and what a newcomer and the market face.
fn compact_table(out: &mut String, rows: &[(String, &[RunOut])]) {
    let kinds = [Kind::Builder, Kind::Raider, Kind::Defender, Kind::Methuselah, Kind::Late, Kind::Whale, Kind::SybilWhale, Kind::Sniper, Kind::Locker, Kind::Racer];
    let _ = write!(out, "  {:<34} |", "");
    for k in kinds {
        let _ = write!(out, " {:>8}", &format!("{:?}", k)[..format!("{:?}", k).len().min(8)]);
    }
    let _ = writeln!(out, " | {:>7} {:>7} {:>7} {:>7} {:>7} {:>6}", "newc d7", "siege7", "lockTd%", "methTd%", "vault/h", "live7");
    for (label, r) in rows {
        let _ = write!(out, "  {:<34} |", label);
        for k in kinds {
            let v = med_of(per_seed(r, k, |g| g.net()));
            if v.is_nan() {
                let _ = write!(out, " {:>8}", "-");
            } else {
                let _ = write!(out, " {:>+8.3}", v);
            }
        }
        let at7 = |f: &dyn Fn(&TideRow) -> Option<f64>| med_of(r.iter().filter_map(|x| x.timeline.get(7 * 24 - 1).and_then(|t| f(t))).collect());
        let tide_share = |k: Kind| med_of(r.iter().map(|x| x.groups.iter().filter(|g| g.kind == k).map(|g| g.tides).sum::<u128>() as f64 / x.world.tides_paid.max(1) as f64).collect());
        let coverage = med_of(r.iter().map(|x| nf(x.world.vault) / nf(x.world.held_total).max(1e-9)).collect());
        let _ = writeln!(
            out,
            " | {:>7.2} {:>7.2} {:>6.1}% {:>6.1}% {:>7.3} {:>6.0}",
            at7(&|t| t.newcomer_near.map(|y| 1000.0 * nf(y))),
            at7(&|t| Some(1000.0 * nf(t.siege_near))),
            100.0 * tide_share(Kind::Locker),
            100.0 * tide_share(Kind::Methuselah),
            coverage,
            at7(&|t| Some(t.live as f64)),
        );
    }
}

fn header(out: &mut String, r: &Rules) {
    let _ = writeln!(out, "Petri economy simulator v3 (sim/src/main.rs), petri-core rules, 128x128 wrapped dish, 15 s generations (5,760 a day).");
    let _ = writeln!(out, "Launch rules: feed_ppm {}, keeper_bps {}, burn_bps {}, payback {}, min_cell_price 0.5 PETRI, live_floor {}, petri_price 0.0002 NEAR, max_supply 1,000,000 PETRI,", r.feed_ppm, r.keeper_bps, r.burn_bps, r.payback, r.live_floor);
    let _ = writeln!(out, "  min_join 0.01 NEAR, cell_fee 0.0001 NEAR, tide_every {}, tide_bps {}, tide_bounty_bps {}, sell_bps {}, sell_cap_bps {}, buffer {}, max_plant_cells {}.", r.tide_every, r.tide_bps, r.tide_bounty_bps, r.sell_bps, r.sell_cap_bps, r.buffer, r.max_plant_cells);
    let _ = writeln!(out, "Estimates (not measured on chain): join storage {} B = {:.5} NEAR of every join stake; purchase record {} B; a planting attaches", JOIN_BYTES, nf(JOIN_BYTES * BYTE), BUY_BYTES);
    let _ = writeln!(out, "  plant_deposit = ({} + 6/cell) B + 0.0001 NEAR/cell (+ note + 64 B), the contract keeps what it stores, est. ({} + 6/cell) B (+ note + 49 B),", PLANT_DEPOSIT_BASE_BYTES, PLANT_STORED_BASE_BYTES);
    let _ = writeln!(out, "  and the rest goes to the vault; sale record {} B from the proceeds; tide entry {} B from the vault (from the contract when the vault is empty);", SELL_BYTES, TIDE_BYTES);
    let _ = writeln!(out, "  gas 3.5 TGas per call + 0.3 TGas per generation it catches up + 2 TGas when it sends NEAR, at 0.0001 NEAR per TGas.");
    let _ = writeln!(out);
    let _ = writeln!(out, "Columns, per player of each kind (a sybil whale is one player with many colonies), NEAR unless marked:");
    let _ = writeln!(out, "  paid      = everything attached: join stakes, purchases and planting deposits, storage included");
    let _ = writeln!(out, "  tides     = NEAR won at tides plus tide bounties; sold = NEAR received for sell-backs (after each sale's record)");
    let _ = writeln!(out, "  held@sell = PETRI still held at the end, valued at the sell-back price (paper: see exit liquidity)");
    let _ = writeln!(out, "  net       = tides + sold + held@sell - paid, as min / median / max over seeds of the kind's mean player");
    let _ = writeln!(out, "  cash med  = tides + sold - paid (what actually came back in NEAR), median");
    let _ = writeln!(out, "  gas       = estimated gas the player burned (not in net); net-gas = net minus it");
    let _ = writeln!(out, "  back/1    = (tides + sold + held@sell) / paid; PETRI e/s = PETRI earned from the feed / PETRI spent planting (PETRI, not NEAR)");
    let _ = writeln!(out, "  feed%     = the kind's share of all PETRI the agar fed (all players of the kind together)");
    let _ = writeln!(out, "  capped%   = share of the kind's living cell-generations not paid because of the reach cap");
    let _ = writeln!(out);
    let _ = writeln!(out, "Player kinds:");
    let _ = writeln!(out, "  Builder 0.05 NEAR, still lifes near home | Raider 0.05, gliders/LWSS aimed at rivals, 1 in 3 moves a blinker dropped on a rival (siege)");
    let _ = writeln!(out, "  Defender 0.05, eaters/beehives | Methuselah 0.1, one R-pentomino an hour (growth bet) | Late 0.05, builder joining day 2-3");
    let _ = writeln!(out, "  Whale 2 NEAR in one colony, pulsars/beehives anywhere, as often as the sybil's colonies together | SybilWhale the same 2 NEAR split over 10 colonies (20 at 1,500 players)");
    let _ = writeln!(out, "  Sniper 0.05, plants only in the 3 generations before each tide, sells after each | Locker 1.5 NEAR, lays a lattice of 256 blocks");
    let _ = writeln!(out, "    8 cells apart at launch so every empty cell is in its buffer, repairs it every 20 gens | Racer 0.01, never plants, calls advance");
    let _ = writeln!(out, "    just before the team keeper would and right after each tide when pot + bounty beat the gas, sells the pot | Seller 0.2, buys");
    let _ = writeln!(out, "    and sells back as fast as the allowance allows | House: the 5 team strains, 0.05 NEAR + 0.02 top-ups, notes, no tide share.");
    let _ = writeln!(out, "  NEAR wallets: builders/raiders/defenders/late/sniper 0.25 NEAR in all, methuselah 0.5, whale 3, sybil whale 3 split, locker 2;");
    let _ = writeln!(out, "  tide winnings (claimed daily), sales and bounties go back into the wallet. Most players join over day 1 (sniper, seller in hour 1;");
    let _ = writeln!(out, "  locker, racer and the strains at launch). The strains act every 8-24 generations (agents/run.mjs) on a team budget of 1 NEAR");
    let _ = writeln!(out, "  each unless the scenario says otherwise.");
    let _ = writeln!(out, "  Careful players spend at most half their PETRI per planting and try 30 spots out of every buffer before paying for a siege;");
    let _ = writeln!(out, "  builders/raiders/defenders/late buy 0.02 NEAR more at most twice when low. After each tide the sell allowance reopens: bots");
    let _ = writeln!(out, "  (seller, sniper, racer) sell first, then a random quarter of the others sell what they hold above 16 cells' price.");
    let _ = writeln!(out, "  The team keeper calls advance when the board is 20 generations behind or the pot holds 5 PETRI.");
    let _ = writeln!(out);
}

// ---------- modes ----------

fn sweep(out_dir: &str) {
    let mut scenarios = Vec::new();
    for reach in [4u32, 8, 16] {
        for sx in [3u32, 4, 6] {
            for scale in [15usize, 150] {
                scenarios.push(Scenario {
                    name: format!("reach {} siege_x {} / {} players", reach, sx, scale),
                    rules: Rules::launch(reach, sx),
                    society: society(scale, true),
                    days: 7,
                    seeds: 10,
                    stream: scale as u64,
                    house_budget: NEAR,
                });
            }
        }
    }
    let t0 = Instant::now();
    let runs = run_all(&scenarios);
    let mut out = String::new();
    let mut csv = String::from("reach,siege_x,players,kind,net_min,net_med,net_max,cash_med,back_med,feed_share_med,capped_med
");
    let _ = writeln!(out, "Parameter sweep: reach x siege_x, 7 days, 10 seeds each (the same seeds for every pair), mixed society with the carpet locker.");
    let _ = writeln!(out, "Cells: median over seeds of the net NEAR of each kind's mean player (tides + sold + held@sell - paid). 'newc d7' = cheapest block");
    let _ = writeln!(out, "for a newcomer on day 7, 'siege7' = a siege block on day 7 (mNEAR, deposit included); 'lockTd%'/'methTd%' = the locker's and the");
    let _ = writeln!(out, "methuselahs' share of all tide NEAR; 'vault/h' = vault / players' PETRI at the sell-back price at the end; 'live7' = live cells, day 7.");
    for scale in [15usize, 150] {
        let _ = writeln!(out);
        let _ = writeln!(out, "{} players:", scale);
        let rows: Vec<(String, &[RunOut])> = scenarios.iter().enumerate().filter(|(_, s)| players(&s.society) == scale).map(|(si, s)| (format!("reach {:>2}, siege_x {}", s.rules.reach, s.rules.siege_x), &runs[si][..])).collect();
        compact_table(&mut out, &rows);
        let _ = writeln!(out, "  capped% (cell-generations unpaid because of reach), median, methuselah / builder / raider:");
        for (si, s) in scenarios.iter().enumerate() {
            if players(&s.society) != scale {
                continue;
            }
            let r = &runs[si];
            let cap = |k: Kind| 100.0 * med_of(per_seed(r, k, |g| if g.live_gens == 0 { 0.0 } else { g.unpaid_gens as f64 / g.live_gens as f64 }));
            let _ = writeln!(out, "    reach {:>2}, siege_x {}: {:.2}% / {:.2}% / {:.2}%", s.rules.reach, s.rules.siege_x, cap(Kind::Methuselah), cap(Kind::Builder), cap(Kind::Raider));
            for kind in KINDS {
                let net = per_seed(r, kind, |g| g.net());
                if net.is_empty() {
                    continue;
                }
                let (a, b, c) = mmm(&net);
                let _ = writeln!(
                    csv,
                    "{},{},{},{:?},{:.6},{:.6},{:.6},{:.6},{:.4},{:.4},{:.5}",
                    s.rules.reach,
                    s.rules.siege_x,
                    scale,
                    kind,
                    a,
                    b,
                    c,
                    med_of(per_seed(r, kind, |g| g.cash())),
                    med_of(per_seed(r, kind, |g| g.out() / nf(g.paid).max(1e-12))),
                    med_of(feed_share(r, kind)),
                    med_of(per_seed(r, kind, |g| if g.live_gens == 0 { 0.0 } else { g.unpaid_gens as f64 / g.live_gens as f64 }))
                );
            }
        }
    }
    let _ = writeln!(out);
    let _ = writeln!(out, "Sweep wall time {:.0} s.", t0.elapsed().as_secs_f64());
    print!("{}", out);
    fs::write(format!("{}/sweep.txt", out_dir), &out).unwrap();
    fs::write(format!("{}/sweep.csv", out_dir), csv).unwrap();
}

fn main_runs(out_dir: &str, reach: u32, sx: u32, big_seeds: u64, big30_seeds: u64) {
    let r = Rules::launch(reach, sx);
    let no_siege = Rules { siege_allowed: false, ..r.clone() };
    let sc = |name: &str, rules: &Rules, soc: Society, days: u64, seeds: u64, stream: u64, house: u128| Scenario { name: name.to_string(), rules: rules.clone(), society: soc, days, seeds, stream, house_budget: house };
    let unlimited = 1_000 * NEAR;
    let scenarios = vec![
        sc("15 players, 7 days", &r, society(15, true), 7, 20, 15, NEAR),
        sc("150 players, 7 days", &r, society(150, true), 7, 10, 150, NEAR),
        sc("1,500 players, 7 days", &r, society(1500, true), 7, big_seeds, 1500, NEAR),
        sc("15 players, 30 days", &r, society(15, true), 30, 10, 15, NEAR),
        sc("150 players, 30 days", &r, society(150, true), 30, 5, 150, NEAR),
        sc("1,500 players, 30 days", &r, society(1500, true), 30, big30_seeds, 1500, NEAR),
        sc("15 players, no locker (control), 7 days", &r, society(15, false), 7, 20, 15, NEAR),
        sc("150 players, no locker (control), 7 days", &r, society(150, false), 7, 10, 150, NEAR),
        sc("15 players, locker, siege forbidden (v2 buffer rule), 7 days", &no_siege, society(15, true), 7, 20, 15, NEAR),
        sc("150 players, locker, siege forbidden (v2 buffer rule), 7 days", &no_siege, society(150, true), 7, 10, 150, NEAR),
        sc("150 players, house strains with no budget limit (agents/run.mjs cadence), 7 days", &r, society(150, true), 7, 10, 150, unlimited),
        sc("zero players: only the 5 house strains, no budget limit, 30 days", &r, vec![(Kind::House, 5, 1)], 30, 3, 7, unlimited),
        sc("zero players: only the 5 house strains, 1 NEAR each, 30 days", &r, vec![(Kind::House, 5, 1)], 30, 3, 7, NEAR),
        sc("zero players: only the 5 house strains, 1 NEAR each, house takes no feed (fix), 30 days", &Rules { house_fed: false, ..r.clone() }, vec![(Kind::House, 5, 1)], 30, 3, 7, NEAR),
        sc("zero players: empty dish, 30 days", &r, vec![], 30, 1, 8, NEAR),
    ];
    let scenarios: Vec<Scenario> = scenarios.into_iter().filter(|s| s.seeds > 0).collect();
    // Fix experiments: one rule changed at a time against the chosen rules, same seeds.
    let events = Rules { deposit_base_bytes: 20, stored_base_bytes: 20, cell_bytes: 2, ..r.clone() };
    let fixes: Vec<(&str, Rules)> = vec![
        ("chosen rules (baseline)", r.clone()),
        ("tide_bps 1000 (10% a tide)", Rules { tide_bps: 1_000, ..r.clone() }),
        ("tide_bps 500 (5% a tide)", Rules { tide_bps: 500, ..r.clone() }),
        ("ledger as events (~20 B a planting)", events.clone()),
        ("live_floor 250 (launch price x4)", Rules { live_floor: 250, ..r.clone() }),
        ("planted halves daily (reach on recent)", Rules { planted_halflife_tides: 24, ..r.clone() }),
        ("tide_bps 1000 + events ledger", Rules { tide_bps: 1_000, ..events.clone() }),
        ("tide 1000 + events + live_floor 250", Rules { tide_bps: 1_000, live_floor: 250, ..events.clone() }),
        ("house colonies take no feed", Rules { house_fed: false, ..r.clone() }),
        ("tide bounty capped at 0.001 NEAR", Rules { bounty_cap: NEAR / 1_000, ..r.clone() }),
        ("tide 1000 + events + no house feed + cap", Rules { tide_bps: 1_000, house_fed: false, bounty_cap: NEAR / 1_000, ..events.clone() }),
    ];
    let mut fix_scen = Vec::new();
    for scale in [15usize, 150] {
        for (name, rules) in &fixes {
            fix_scen.push(sc(name, rules, society(scale, true), 7, if scale == 15 { 20 } else { 10 }, scale as u64, NEAR));
        }
    }
    let t0 = Instant::now();
    let fix_runs = run_all(&fix_scen);
    let runs = run_all(&scenarios);
    let mut out = String::new();
    header(&mut out, &r);
    let _ = writeln!(out, "Chosen: reach {}, siege_x {}. Every scenario below uses them (the siege-forbidden runs swap in the v2 buffer rule).", reach, sx);
    let _ = writeln!(out);
    let mut tl = String::from("scenario,seed,generation,day,live,agar_petri,vault_near,sell_left_near,petri_price_near,free_cells_pct,free_block_spots_pct,newcomer_block_petri,newcomer_block_near,contract_storage_near,keeper_gas_near,tides_paid_near\n");
    let mut kc = String::from("scenario,seed,player,kind,accounts,near_paid,near_tides,near_bounty,near_sold,held_at_sell_near,gas_near,net_near,cash_net_near,petri_earned,petri_spent,petri_pot,live_cells_end\n");
    for (si, s) in scenarios.iter().enumerate() {
        let rs = &runs[si];
        let secs: f64 = rs.iter().map(|x| x.world.secs).sum::<f64>() / rs.len().max(1) as f64;
        let _ = writeln!(out, "== {} == ({} players + {} house strains, {} colonies, {} seeds, {:.1} s per run)", s.name, players(&s.society), s.society.iter().filter(|x| x.0 == Kind::House).map(|x| x.1).sum::<usize>(), colonies(&s.society), rs.len(), secs);
        if colonies(&s.society) > 5 {
            kind_table(&mut out, rs);
        }
        world_lines(&mut out, rs);
        if s.name.starts_with("zero") {
            let _ = writeln!(out, "    {:>4} | {:>6} | {:>10} | {:>12} | {:>9} | {:>13} | {:>12} | {:>12}", "day", "live", "agar PETRI", "price mNEAR", "vault", "contract stor.", "keeper gas", "house earned");
            for d in [1u64, 2, 3, 5, 7, 10, 14, 21, 30] {
                if let Some(t) = rs[0].timeline.get((d * 24) as usize - 1) {
                    let _ = writeln!(out, "    {:>4} | {:>6} | {:>10.0} | {:>12.5} | {:>9.5} | {:>13.5} | {:>12.5} | {:>12.0}", d, t.live, pf(t.agar), 1000.0 * nf(t.price), nf(t.vault), nf(t.contract_storage), nf(t.keeper_gas), pf(t.house_earned));
                }
            }
        } else {
            lockout_table(&mut out, "newcomer lockout (a colony with no cells; 'free' = no living cell within 3; cost = cheapest 2x2 block, siege if no free spot):", rs, s.days);
        }
        let _ = writeln!(out);
        timeline_csv(&mut tl, &s.name, rs);
        kinds_csv(&mut kc, &s.name, rs);
    }
    let _ = writeln!(out, "== Fix experiments: one rule changed at a time (7 days, mixed society with the locker; 20 seeds at 15 players, 10 at 150) ==");
    let _ = writeln!(out, "  Same columns as the sweep: median net NEAR per player of each kind; newc d7 / siege7 in mNEAR; lockTd%/methTd% = share of all tide NEAR;");
    let _ = writeln!(out, "  vault/h = vault / players' PETRI at the sell-back price at the end.");
    for scale in [15usize, 150] {
        let _ = writeln!(out, "{} players:", scale);
        let rows: Vec<(String, &[RunOut])> = fix_scen.iter().enumerate().filter(|(_, s)| players(&s.society) == scale).map(|(si, s)| (s.name.clone(), &fix_runs[si][..])).collect();
        compact_table(&mut out, &rows);
        let _ = writeln!(out, "  storage kept by the contract (players), NEAR into the vault, sold back, median:");
        for (si, s) in fix_scen.iter().enumerate() {
            if players(&s.society) != scale {
                continue;
            }
            let rr = &fix_runs[si];
            let m = |f: &dyn Fn(&WorldOut) -> f64| med_of(rr.iter().map(|x| f(&x.world)).collect());
            let _ = writeln!(out, "    {:<40} storage {:>7.3}  into vault {:>7.3}  tides {:>7.3}  sold {:>6.3}  live day 7 {:>5.0}", s.name, m(&|w| nf(w.storage_players)), m(&|w| nf(w.vault_in)), m(&|w| nf(w.tides_paid)), m(&|w| nf(w.sold_total)), m(&|w| w.live as f64));
        }
        let _ = writeln!(out);
    }
    let _ = writeln!(out, "Wall time {:.0} s on {} threads.", t0.elapsed().as_secs_f64(), std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1));
    if let Ok(sw) = fs::read_to_string(format!("{}/sweep.txt", out_dir)) {
        let _ = writeln!(out);
        let _ = writeln!(out, "==================================================================================================");
        out.push_str(&sw);
    }
    print!("{}", out);
    fs::write(format!("{}/summary.txt", out_dir), &out).unwrap();
    fs::write(format!("{}/timeline.csv", out_dir), tl).unwrap();
    fs::write(format!("{}/players.csv", out_dir), kc).unwrap();
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let out_dir = args.get(1).cloned().unwrap_or_else(|| "out-v3".into());
    fs::create_dir_all(&out_dir).unwrap();
    match args.get(2).map(|s| s.as_str()) {
        Some("sweep") => sweep(&out_dir),
        Some("main") => {
            let reach = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(8);
            let sx = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(4);
            let big = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(10);
            let big30 = args.get(6).and_then(|s| s.parse().ok()).unwrap_or(2);
            main_runs(&out_dir, reach, sx, big, big30);
        }
        Some("probe") => {
            // One quick scenario, for timing and sanity checks: probe <players> <days> <reach> <siege_x>.
            let scale = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(15);
            let days = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(1);
            let reach = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(8);
            let sx = args.get(6).and_then(|s| s.parse().ok()).unwrap_or(4);
            let s = Scenario { name: "probe".into(), rules: Rules::launch(reach, sx), society: society(scale, true), days, seeds: 1, stream: scale as u64, house_budget: NEAR };
            let runs = run_all(&[s.clone()]);
            let mut out = String::new();
            kind_table(&mut out, &runs[0]);
            world_lines(&mut out, &runs[0]);
            lockout_table(&mut out, "lockout", &runs[0], days);
            print!("{}", out);
        }
        _ => eprintln!("usage: petri-sim <out_dir> sweep | main <reach> <siege_x> [seeds_1500_7d] [seeds_1500_30d] | probe <players> <days> <reach> <siege_x>"),
    }
}
