//! The rules of a Petri dish.
//!
//! A dish is a wrapped grid. Each cell is `0` (empty) or the id of the colony that owns it. One generation applies
//! Conway's Life to every cell at once; a birth joins the colony owning most of its three parents, and a birth whose
//! three parents belong to three different colonies does not happen. The contract, the browser replay and the
//! economy simulator all run this crate, so they cannot disagree.

#![no_std]
extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use sha2::{Digest, Sha256};

pub type ColonyId = u16;
pub const EMPTY: ColonyId = 0;

/// The history chain advances on generations that are multiples of this.
pub const CHAIN_EVERY: u64 = 16;

#[derive(Clone, Debug)]
pub struct Dish {
    pub width: u16,
    pub height: u16,
    /// Owner of every cell, row by row; `EMPTY` where the cell is dead.
    pub cells: Vec<ColonyId>,
    /// Liveness as bit rows (`words` u64 per row), kept in step with `cells`.
    bits: Vec<u64>,
    words: usize,
}

impl PartialEq for Dish {
    fn eq(&self, other: &Self) -> bool {
        self.width == other.width && self.height == other.height && self.cells == other.cells
    }
}
impl Eq for Dish {}

/// What a generation did, per colony. Index `c` holds colony `c`; index 0 is unused.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct StepStats {
    pub live: Vec<u32>,
    pub births: Vec<u32>,
    pub deaths: Vec<u32>,
    pub total_live: u32,
    /// Births that did not happen because three different colonies met.
    pub contested: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PlantError {
    Empty,
    TooMany { max: u32 },
    OutOfRange { index: u32 },
    Duplicate { index: u32 },
    Occupied { index: u32 },
}

/// A legal planting. `siege` is set when a planted cell has another colony's live cell within the buffer: the planting
/// is allowed but costs the siege surcharge (see `planting_cost`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PlantCheck {
    pub siege: bool,
    /// The first rival found inside the buffer, if any.
    pub rival: Option<ColonyId>,
}

impl Dish {
    pub fn new(width: u16, height: u16) -> Self {
        assert!(width >= 8 && height >= 8, "dish too small");
        let words = (width as usize + 63) / 64;
        Dish {
            width,
            height,
            cells: vec![EMPTY; width as usize * height as usize],
            bits: vec![0; words * height as usize],
            words,
        }
    }

    /// Build a dish from an owner array.
    pub fn from_cells(width: u16, height: u16, cells: Vec<ColonyId>) -> Self {
        let mut d = Dish::new(width, height);
        assert_eq!(cells.len(), d.cells.len(), "wrong number of cells");
        d.cells = cells;
        d.rebuild_bits();
        d
    }

    fn rebuild_bits(&mut self) {
        let w = self.width as usize;
        for b in self.bits.iter_mut() {
            *b = 0;
        }
        for (i, &c) in self.cells.iter().enumerate() {
            if c != EMPTY {
                let (x, y) = (i % w, i / w);
                self.bits[y * self.words + x / 64] |= 1u64 << (x % 64);
            }
        }
    }

    fn set_bit(&mut self, i: usize, on: bool) {
        let w = self.width as usize;
        let (x, y) = (i % w, i / w);
        let word = &mut self.bits[y * self.words + x / 64];
        if on {
            *word |= 1u64 << (x % 64);
        } else {
            *word &= !(1u64 << (x % 64));
        }
    }

    pub fn len(&self) -> usize {
        self.cells.len()
    }

    pub fn is_empty(&self) -> bool {
        self.cells.iter().all(|&c| c == EMPTY)
    }

    pub fn index(&self, x: i32, y: i32) -> usize {
        let w = self.width as i32;
        let h = self.height as i32;
        (y.rem_euclid(h) * w + x.rem_euclid(w)) as usize
    }

    pub fn xy(&self, index: usize) -> (i32, i32) {
        ((index % self.width as usize) as i32, (index / self.width as usize) as i32)
    }

    /// Advance one generation. `colonies` is the highest colony id in use (stats vectors are sized `colonies + 1`).
    ///
    /// Liveness is computed 64 cells at a time with a bit-sliced neighbour count; owners are touched only where a
    /// cell is born or dies, which keeps a generation cheap enough to run inside a NEAR transaction.
    pub fn step(&mut self, colonies: u16) -> StepStats {
        self.step_core(colonies as usize + 1, true).0
    }

    /// Advance one generation like `step`, but count living cells sparsely: returns `(colony, live cells)` for every
    /// colony that has any, in id order, and the total. The work grows with living cells, not with how many colonies
    /// ever joined, which is what the contract needs to stay inside NEAR's gas limit on a crowded dish.
    pub fn step_sparse(&mut self) -> (Vec<(ColonyId, u32)>, u32) {
        let (stats, mut owners) = self.step_core(0, false);
        owners.sort_unstable();
        let mut out: Vec<(ColonyId, u32)> = Vec::new();
        for c in owners {
            match out.last_mut() {
                Some(last) if last.0 == c => last.1 += 1,
                _ => out.push((c, 1)),
            }
        }
        (out, stats.total_live)
    }

    /// One generation. With `full`, per-colony live, birth and death counts are kept in vectors of length `n`; without
    /// it, only the owners of living cells are returned (unsorted), for `step_sparse`.
    fn step_core(&mut self, n: usize, full: bool) -> (StepStats, Vec<ColonyId>) {
        let w = self.width as usize;
        let h = self.height as usize;
        let words = self.words;
        let mut owners: Vec<ColonyId> = Vec::new();
        let m = if full { n } else { 0 };
        let mut stats = StepStats {
            live: vec![0; m],
            births: vec![0; m],
            deaths: vec![0; m],
            total_live: 0,
            contested: 0,
        };
        let last_mask = if w % 64 == 0 { u64::MAX } else { (1u64 << (w % 64)) - 1 };
        let mut west = vec![0u64; words * h];
        let mut east = vec![0u64; words * h];
        for y in 0..h {
            let row = &self.bits[y * words..(y + 1) * words];
            shift_west(row, &mut west[y * words..(y + 1) * words], w, last_mask);
            shift_east(row, &mut east[y * words..(y + 1) * words], w, last_mask);
        }
        let mut next = vec![0u64; words * h];
        for y in 0..h {
            let up = if y == 0 { h - 1 } else { y - 1 };
            let down = if y + 1 == h { 0 } else { y + 1 };
            for k in 0..words {
                let (iu, im, id) = (up * words + k, y * words + k, down * words + k);
                let inputs = [west[iu], self.bits[iu], east[iu], west[im], east[im], west[id], self.bits[id], east[id]];
                // s0, s1: neighbour count mod 4; s2: count >= 4 (sticky).
                let (mut s0, mut s1, mut s2) = (0u64, 0u64, 0u64);
                for &b in inputs.iter() {
                    let c0 = s0 & b;
                    s0 ^= b;
                    let c1 = s1 & c0;
                    s1 ^= c0;
                    s2 |= c1;
                }
                let three = s0 & s1 & !s2;
                let two = !s0 & s1 & !s2;
                let mut out = three | (self.bits[im] & two);
                if k == words - 1 {
                    out &= last_mask;
                }
                next[im] = out;
            }
        }
        // Owners. Births only land on cells that were empty, so they read their parents from the old owners as long
        // as every birth is decided before any owner changes.
        let mut born_at: Vec<(usize, ColonyId)> = Vec::new();
        for y in 0..h {
            for k in 0..words {
                let i = y * words + k;
                let mut born = next[i] & !self.bits[i];
                while born != 0 {
                    let b = born.trailing_zeros() as usize;
                    born &= born - 1;
                    let x = k * 64 + b;
                    let (xl, xr) = (if x == 0 { w - 1 } else { x - 1 }, if x + 1 == w { 0 } else { x + 1 });
                    let (yu, yd) = (if y == 0 { h - 1 } else { y - 1 }, if y + 1 == h { 0 } else { y + 1 });
                    let c = &self.cells;
                    let around = [
                        c[yu * w + xl], c[yu * w + x], c[yu * w + xr],
                        c[y * w + xl], c[y * w + xr],
                        c[yd * w + xl], c[yd * w + x], c[yd * w + xr],
                    ];
                    let mut parents = [EMPTY; 3];
                    let mut m = 0;
                    for &p in around.iter() {
                        if p != EMPTY && m < 3 {
                            parents[m] = p;
                            m += 1;
                        }
                    }
                    match plurality(parents) {
                        Some(owner) => {
                            if (owner as usize) < stats.births.len() {
                                stats.births[owner as usize] += 1;
                            }
                            born_at.push((y * w + x, owner));
                        }
                        None => {
                            stats.contested += 1;
                            next[i] &= !(1u64 << b);
                        }
                    }
                }
            }
        }
        for y in 0..h {
            for k in 0..words {
                let i = y * words + k;
                let mut died = self.bits[i] & !next[i];
                while died != 0 {
                    let b = died.trailing_zeros() as usize;
                    died &= died - 1;
                    let idx = y * w + k * 64 + b;
                    let c = self.cells[idx] as usize;
                    if c < stats.deaths.len() {
                        stats.deaths[c] += 1;
                    }
                    self.cells[idx] = EMPTY;
                }
            }
        }
        for (idx, owner) in born_at {
            self.cells[idx] = owner;
        }
        self.bits = next;
        for y in 0..h {
            for k in 0..words {
                let mut live = self.bits[y * words + k];
                while live != 0 {
                    let b = live.trailing_zeros() as usize;
                    live &= live - 1;
                    let c = self.cells[y * w + k * 64 + b];
                    if full {
                        if (c as usize) < stats.live.len() {
                            stats.live[c as usize] += 1;
                        }
                    } else {
                        owners.push(c);
                    }
                    stats.total_live += 1;
                }
            }
        }
        (stats, owners)
    }

    /// Check a planting without changing the dish. `cells` are flat indices. A planting inside a rival's buffer is
    /// legal; the result says so, because it costs more.
    /// Cells of `house` colonies (the dish's own players) never make a planting a siege.
    pub fn check_plant(&self, colony: ColonyId, cells: &[u32], buffer: u16, max_cells: u32, house: &[ColonyId]) -> Result<PlantCheck, PlantError> {
        if cells.is_empty() {
            return Err(PlantError::Empty);
        }
        if cells.len() as u32 > max_cells {
            return Err(PlantError::TooMany { max: max_cells });
        }
        let len = self.len() as u32;
        let mut rival: Option<ColonyId> = None;
        let mut seen: Vec<u32> = Vec::with_capacity(cells.len());
        for &i in cells {
            if i >= len {
                return Err(PlantError::OutOfRange { index: i });
            }
            if seen.contains(&i) {
                return Err(PlantError::Duplicate { index: i });
            }
            seen.push(i);
            if self.cells[i as usize] != EMPTY {
                return Err(PlantError::Occupied { index: i });
            }
            if rival.is_some() {
                continue;
            }
            let (x, y) = self.xy(i as usize);
            let b = buffer as i32;
            'scan: for dy in -b..=b {
                for dx in -b..=b {
                    let c = self.cells[self.index(x + dx, y + dy)];
                    if c != EMPTY && c != colony && !house.contains(&c) {
                        rival = Some(c);
                        break 'scan;
                    }
                }
            }
        }
        Ok(PlantCheck { siege: rival.is_some(), rival })
    }

    /// Plant without checks. Call `check_plant` first.
    pub fn plant_unchecked(&mut self, colony: ColonyId, cells: &[u32]) {
        for &i in cells {
            self.cells[i as usize] = colony;
            self.set_bit(i as usize, true);
        }
    }

    pub fn live_counts(&self, colonies: u16) -> Vec<u32> {
        let mut v = vec![0u32; colonies as usize + 1];
        for &c in &self.cells {
            if c != EMPTY && (c as usize) < v.len() {
                v[c as usize] += 1;
            }
        }
        v
    }

    /// Little-endian u16 per cell, row by row.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.cells.len() * 2);
        for &c in &self.cells {
            out.extend_from_slice(&c.to_le_bytes());
        }
        out
    }

    pub fn from_bytes(width: u16, height: u16, bytes: &[u8]) -> Option<Self> {
        let n = width as usize * height as usize;
        if bytes.len() != n * 2 {
            return None;
        }
        let cells = bytes.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
        Some(Dish::from_cells(width, height, cells))
    }

    /// Compact form for storage: the liveness bit rows (u64 little-endian, `words` per row), then one u16 owner for
    /// each live cell in index order. A dish with L live cells takes `8 * words * height + 2 * L` bytes.
    pub fn to_compact(&self) -> Vec<u8> {
        let w = self.width as usize;
        let mut out = Vec::with_capacity(self.bits.len() * 8 + 2 * 1024);
        for b in &self.bits {
            out.extend_from_slice(&b.to_le_bytes());
        }
        for y in 0..self.height as usize {
            for k in 0..self.words {
                let mut live = self.bits[y * self.words + k];
                while live != 0 {
                    let b = live.trailing_zeros() as usize;
                    live &= live - 1;
                    out.extend_from_slice(&self.cells[y * w + k * 64 + b].to_le_bytes());
                }
            }
        }
        out
    }

    pub fn from_compact(width: u16, height: u16, bytes: &[u8]) -> Option<Self> {
        let mut d = Dish::new(width, height);
        let w = width as usize;
        let nb = d.bits.len() * 8;
        if bytes.len() < nb {
            return None;
        }
        for (i, chunk) in bytes[..nb].chunks_exact(8).enumerate() {
            let mut a = [0u8; 8];
            a.copy_from_slice(chunk);
            d.bits[i] = u64::from_le_bytes(a);
        }
        let mut owners = bytes[nb..].chunks_exact(2);
        if bytes[nb..].len() % 2 != 0 {
            return None;
        }
        for y in 0..height as usize {
            for k in 0..d.words {
                let mut live = d.bits[y * d.words + k];
                if k == d.words - 1 && w % 64 != 0 && live >> (w % 64) != 0 {
                    return None;
                }
                while live != 0 {
                    let b = live.trailing_zeros() as usize;
                    live &= live - 1;
                    let o = owners.next()?;
                    let c = u16::from_le_bytes([o[0], o[1]]);
                    if c == EMPTY {
                        return None;
                    }
                    d.cells[y * w + k * 64 + b] = c;
                }
            }
        }
        if owners.next().is_some() {
            return None;
        }
        Some(d)
    }

    /// `sha256(width || height || (index u32, owner u16) for every live cell in index order)`, all little-endian.
    pub fn hash(&self) -> [u8; 32] {
        let w = self.width as usize;
        let mut h = Sha256::new();
        h.update(self.width.to_le_bytes());
        h.update(self.height.to_le_bytes());
        let mut buf: Vec<u8> = Vec::with_capacity(1024);
        for y in 0..self.height as usize {
            for k in 0..self.words {
                let mut live = self.bits[y * self.words + k];
                while live != 0 {
                    let b = live.trailing_zeros() as usize;
                    live &= live - 1;
                    let idx = y * w + k * 64 + b;
                    buf.extend_from_slice(&(idx as u32).to_le_bytes());
                    buf.extend_from_slice(&self.cells[idx].to_le_bytes());
                    if buf.len() >= 960 {
                        h.update(&buf);
                        buf.clear();
                    }
                }
            }
        }
        h.update(&buf);
        h.finalize().into()
    }

    pub fn total_live(&self) -> u32 {
        self.bits.iter().map(|b| b.count_ones()).sum()
    }
}

/// Whether the history chain advances at this generation.
pub fn chain_due(generation: u64) -> bool {
    generation % CHAIN_EVERY == 0
}

/// The history chain at a chain generation: `sha256(previous || generation || board hash)`.
pub fn chain_next(previous: &[u8; 32], generation: u64, board_hash: &[u8; 32]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(previous);
    h.update(generation.to_le_bytes());
    h.update(board_hash);
    h.finalize().into()
}

/// out[x] = row[x - 1], wrapping at the dish edge.
fn shift_west(row: &[u64], out: &mut [u64], w: usize, last_mask: u64) {
    let n = row.len();
    let mut carry = (row[(w - 1) / 64] >> ((w - 1) % 64)) & 1;
    for k in 0..n {
        let v = row[k];
        out[k] = (v << 1) | carry;
        carry = v >> 63;
    }
    out[n - 1] &= last_mask;
}

/// out[x] = row[x + 1], wrapping at the dish edge.
fn shift_east(row: &[u64], out: &mut [u64], w: usize, last_mask: u64) {
    let n = row.len();
    let bottom = row[0] & 1;
    for k in 0..n {
        let hi = if k + 1 < n { row[k + 1] << 63 } else { 0 };
        out[k] = (row[k] >> 1) | hi;
    }
    out[n - 1] &= last_mask;
    let top = w - 1;
    out[top / 64] |= bottom << (top % 64);
}

/// The colony owning most of three parents, or `None` when all three differ.
fn plurality(p: [ColonyId; 3]) -> Option<ColonyId> {
    if p[0] == p[1] || p[0] == p[2] {
        Some(p[0])
    } else if p[1] == p[2] {
        Some(p[1])
    } else {
        None
    }
}

/// Stake is counted in thousandths of a planted cell: planting adds `STAKE_UNIT` per cell, and every tide keeps only
/// `stake_keep_bps` of it, so a colony's pay cap is rent it renews by planting.
pub const STAKE_UNIT: u64 = 1_000;

/// A colony's claim on the feed: its living cells, but never more than `reach` cells per cell of stake (cells it
/// planted, decayed tide by tide). The cap grows only with what a colony has paid for, so splitting into many colonies
/// never raises it: the sum of capped weights is at most the capped weight of the sum.
pub fn feed_weight(live: u32, stake: u64, reach: u32) -> u128 {
    (live as u128).min(stake as u128 * reach as u128 / STAKE_UNIT as u128)
}

/// Stake after a tide: `stake_keep_bps` of it remains.
pub fn decay_stake(stake: u64, stake_keep_bps: u16) -> u64 {
    (stake as u128 * stake_keep_bps as u128 / 10_000) as u64
}

/// One generation's feed from the agar.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Feed {
    /// What each paid colony earns, as `(colony id, PETRI units)`, only for colonies that earn something.
    pub shares: Vec<(ColonyId, u128)>,
    /// The keeper's cut, which goes to the keeper pot.
    pub keeper: u128,
    /// Everything that leaves the agar this generation: the shares plus the keeper's cut.
    pub paid: u128,
    /// The cells the feed counted: every paid colony's capped weight, summed. Prices are set against this.
    pub weight: u32,
}

/// The agar pays `feed_ppm` parts per million of itself; `keeper_bps` of that goes to the keeper pot and the rest is
/// split across living colonies by `feed_weight`. `live` and `planted` are indexed by colony id (index 0 unused).
/// Colonies in `house` (the dish's own players) are never fed: on a quiet dish the house cannot eat the agar. The
/// agar releases its ration for at least `live_floor` counted cells, and never more per cell: with fewer counted cells
/// the rest of the ration stays in the agar, so a cell never earns more than its price assumes. Only living colonies
/// are visited for the arithmetic. An unpaid dish is fed nothing. The contract, the browser and the simulator all call
/// this, so their books cannot drift apart.
pub fn feed(agar: u128, feed_ppm: u32, keeper_bps: u16, reach: u32, live_floor: u32, live: &[u32], stake: &[u64], house: &[ColonyId]) -> Feed {
    let sparse: Vec<(ColonyId, u32)> = live.iter().enumerate().skip(1).filter(|(_, &n)| n > 0).map(|(c, &n)| (c as ColonyId, n)).collect();
    feed_sparse(agar, feed_ppm, keeper_bps, reach, live_floor, &sparse, stake, house)
}

/// `feed` with living cells given as `(colony, cells)` pairs, as `Dish::step_sparse` returns them. `stake` is indexed by
/// colony id. Both forms give identical results.
pub fn feed_sparse(agar: u128, feed_ppm: u32, keeper_bps: u16, reach: u32, live_floor: u32, live: &[(ColonyId, u32)], stake: &[u64], house: &[ColonyId]) -> Feed {
    let mut weights: Vec<(ColonyId, u128)> = Vec::new();
    let mut total_w = 0u128;
    for &(c, n) in live {
        if n == 0 || c == EMPTY || house.contains(&c) {
            continue;
        }
        let w = feed_weight(n, stake.get(c as usize).copied().unwrap_or(0), reach);
        if w > 0 {
            weights.push((c as ColonyId, w));
            total_w += w;
        }
    }
    if total_w == 0 {
        return Feed::default();
    }
    let ration = agar * feed_ppm as u128 / 1_000_000;
    let floor = (live_floor as u128).max(1);
    let total = if total_w < floor { ration * total_w / floor } else { ration };
    let keeper = total * keeper_bps as u128 / 10_000;
    let pool = total - keeper;
    let shares: Vec<(ColonyId, u128)> = weights.iter().map(|&(c, w)| (c, pool * w / total_w)).filter(|&(_, s)| s > 0).collect();
    let paid = keeper + shares.iter().map(|&(_, s)| s).sum::<u128>();
    Feed { shares, keeper, paid, weight: total_w.min(u32::MAX as u128) as u32 }
}

/// One tide. `pay` (NEAR) is split by what each colony earned from the feed since the last tide (`window`, indexed by
/// colony id), so a colony that appears just before a tide gets only its few generations' worth. Colonies in `house`
/// (the dish's own players) take no share. Returns `(colony id, NEAR)` pairs and the total paid; rounding dust stays
/// in the vault.
pub fn tide_split(pay: u128, window: &[u64], house: &[ColonyId]) -> (Vec<(ColonyId, u128)>, u128) {
    let mut total = 0u128;
    for (c, &w) in window.iter().enumerate().skip(1) {
        if w > 0 && !house.contains(&(c as ColonyId)) {
            total += w as u128;
        }
    }
    if total == 0 || pay == 0 {
        return (Vec::new(), 0);
    }
    let mut out = Vec::new();
    let mut paid = 0u128;
    for (c, &w) in window.iter().enumerate().skip(1) {
        if w == 0 || house.contains(&(c as ColonyId)) {
            continue;
        }
        let s = mul_div(pay, w as u128, total);
        if s > 0 {
            out.push((c as ColonyId, s));
            paid += s;
        }
    }
    (out, paid)
}

/// `a * b / d` without overflowing when `a` is large and `b < d`.
fn mul_div(a: u128, b: u128, d: u128) -> u128 {
    a / d * b + (a % d) * b / d
}

/// What one counted cell earns per generation at today's feed: the ration shared by `counted` cells (the last feed's
/// `weight`), or by `live_floor` cells while fewer are counted, which is exactly what `feed` pays then.
pub fn feed_per_cell(agar: u128, feed_ppm: u32, keeper_bps: u16, counted: u32, live_floor: u32) -> u128 {
    let total = agar * feed_ppm as u128 / 1_000_000;
    let to_cells = total - total * keeper_bps as u128 / 10_000;
    to_cells / counted.max(live_floor).max(1) as u128
}

/// The price of planting `cells` cells: what that many average cells would earn in `payback` generations at today's
/// feed, and never less than `floor` per cell. The price follows the feed: it falls as the agar shrinks or the dish
/// fills, and a planting only pays for itself if its cells survive about `payback` generations.
pub fn plant_price(per_cell_feed: u128, payback: u32, floor: u128, cells: u32) -> u128 {
    (per_cell_feed * payback as u128).max(floor) * cells as u128
}

/// The price of a planting, with the siege surcharge: a planting that reaches into a rival's buffer costs `siege_x`
/// times as much. Ground near a rival is never closed, only dearer.
pub fn planting_cost(per_cell_feed: u128, payback: u32, floor: u128, cells: u32, siege: bool, siege_x: u32) -> u128 {
    let base = plant_price(per_cell_feed, payback, floor, cells);
    if siege {
        base * siege_x.max(1) as u128
    } else {
        base
    }
}

/// PETRI bought from the agar for `deposit` yoctoNEAR. The price per PETRI is `k / agar` (where `k` is the launch
/// price times the full supply), so it rises as the agar empties; the purchase is priced at the midpoint of the
/// curve it moves along. Returns PETRI units.
pub fn petri_for_near(deposit: u128, agar: u128, k: u128) -> u128 {
    if agar == 0 || k == 0 {
        return 0;
    }
    // units = agar * deposit / (k + deposit / 2), computed without overflow for deposits up to a few hundred NEAR.
    let denom = k + deposit / 2;
    let whole = agar / denom * deposit;
    let rest = (agar % denom) * deposit / denom;
    (whole + rest).min(agar)
}

/// NEAR the agar pays for `units` PETRI handed back: `sell_bps` of the curve's price, but never more than those units'
/// pro-rata share of the vault (`vault × units / outstanding`, where `outstanding` is all PETRI outside the agar), so
/// the vault can never be promised more than it holds.
pub fn sell_back(units: u128, agar: u128, k: u128, sell_bps: u16, vault: u128, outstanding: u128) -> u128 {
    let curve = near_for_petri(units, agar, k, sell_bps);
    if outstanding == 0 {
        return 0;
    }
    curve.min(mul_div(vault, units.min(outstanding), outstanding))
}

/// NEAR the agar pays for `units` PETRI handed back to it: `sell_bps` of the curve's price at the midpoint of the move
/// (the agar grows by `units`), so a round trip through the agar always loses. In yoctoNEAR.
pub fn near_for_petri(units: u128, agar: u128, k: u128, sell_bps: u16) -> u128 {
    if units == 0 {
        return 0;
    }
    let mid = agar + units / 2;
    if mid == 0 {
        return 0;
    }
    // k * units / mid, without overflow.
    let gross = k / mid * units + (k % mid) * units / mid;
    gross * sell_bps as u128 / 10_000
}

/// Named patterns, as (dx, dy) offsets. Used by the browser's stamp tool, the strains and the tests.
pub mod patterns {
    pub const BLOCK: &[(i32, i32)] = &[(0, 0), (1, 0), (0, 1), (1, 1)];
    pub const BLINKER: &[(i32, i32)] = &[(0, 0), (1, 0), (2, 0)];
    pub const BEEHIVE: &[(i32, i32)] = &[(1, 0), (2, 0), (0, 1), (3, 1), (1, 2), (2, 2)];
    pub const LOAF: &[(i32, i32)] = &[(1, 0), (2, 0), (0, 1), (3, 1), (1, 2), (3, 2), (2, 3)];
    /// Travels down and right, one cell every four generations.
    pub const GLIDER: &[(i32, i32)] = &[(1, 0), (2, 1), (0, 2), (1, 2), (2, 2)];
    pub const LWSS: &[(i32, i32)] = &[(1, 0), (4, 0), (0, 1), (0, 2), (4, 2), (0, 3), (1, 3), (2, 3), (3, 3)];
    pub const EATER: &[(i32, i32)] = &[(0, 0), (1, 0), (0, 1), (2, 1), (2, 2), (2, 3), (3, 3)];
    pub const R_PENTOMINO: &[(i32, i32)] = &[(1, 0), (2, 0), (0, 1), (1, 1), (1, 2)];
    pub const TOAD: &[(i32, i32)] = &[(1, 0), (2, 0), (3, 0), (0, 1), (1, 1), (2, 1)];
    pub const PULSAR: &[(i32, i32)] = &[
        (2, 0), (3, 0), (4, 0), (8, 0), (9, 0), (10, 0),
        (0, 2), (5, 2), (7, 2), (12, 2), (0, 3), (5, 3), (7, 3), (12, 3), (0, 4), (5, 4), (7, 4), (12, 4),
        (2, 5), (3, 5), (4, 5), (8, 5), (9, 5), (10, 5),
        (2, 7), (3, 7), (4, 7), (8, 7), (9, 7), (10, 7),
        (0, 8), (5, 8), (7, 8), (12, 8), (0, 9), (5, 9), (7, 9), (12, 9), (0, 10), (5, 10), (7, 10), (12, 10),
        (2, 12), (3, 12), (4, 12), (8, 12), (9, 12), (10, 12),
    ];
    /// Gosper glider gun: emits a glider every 30 generations.
    pub const GOSPER_GUN: &[(i32, i32)] = &[
        (24, 0), (22, 1), (24, 1), (12, 2), (13, 2), (20, 2), (21, 2), (34, 2), (35, 2),
        (11, 3), (15, 3), (20, 3), (21, 3), (34, 3), (35, 3), (0, 4), (1, 4), (10, 4), (16, 4), (20, 4), (21, 4),
        (0, 5), (1, 5), (10, 5), (14, 5), (16, 5), (17, 5), (22, 5), (24, 5), (10, 6), (16, 6), (24, 6),
        (11, 7), (15, 7), (12, 8), (13, 8),
    ];
}

#[cfg(test)]
mod tests;
