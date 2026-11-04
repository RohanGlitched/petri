//! Each colony's numbers: its unclaimed earnings, the NEAR it has won at the tides and not claimed, the credit it won
//! and has not spent, the credit it won in all, whether it has ever put NEAR into the vault itself, its stake, and,
//! while it plays, what it earned since the last tide.
//!
//! v5 kept each of these in one array covering every colony that ever joined, so a join rewrote seven arrays and every
//! catch-up and tide read and rewrote several. v6 kept them in cold pages plus a hot table of every colony with stake,
//! and stake lingers about a day after a colony's last planting, so on an active 30,000-colony dish the hot table held
//! up to 27,500 rows and a planting cost over 230 TGas on the real network. v6.1 keeps a colony's numbers in exactly one
//! of two places:
//! - cold pages of `PAGE` colonies each (key `X` + page number), with the colony's stake and the tide count it was last
//!   decayed at. A join appends its own slot to the last page, which it pays for; after that a page is rewritten only
//!   by its colonies' own claims, purchases and spending, and when a colony leaves the hot table. A stake read from a
//!   cold slot is decayed once for every tide that ran since (`decay_stake_times`): exactly what tide-by-tide decay
//!   would have left.
//! - one hot table of the colonies that play now: a colony enters it when it plants (the house never does: it is never
//!   fed and takes no share) and leaves it once it has no window (nothing earned since the last tide) and either has no
//!   living cells or a stake too small to earn (`can_earn`). Only colonies with living cells and such a stake are fed,
//!   and a colony's cells come only from its own plantings and their offspring, so every colony the feed pays has a
//!   row, and every colony a tide pays too. The table is as large as the colonies alive or paid at the coming tide,
//!   not as every colony that planted in the last day, and it holds at most `MAX_PLAYING` rows.
//!
//! The hot table is stored in two parts, each row in both, in colony order: the feed part (key `h`: id, stake, window,
//! earnings; 26 bytes a row), which every catch-up rewrites, and the purse part (key `j`: id, NEAR owed, credit won and
//! held, whether it attached NEAR; 51 bytes a row), which only tides and a playing colony's own purchases, claims and
//! spending rewrite.

use near_sdk::env;
use petri_core::{can_earn, decay_stake_times};

/// Colonies per cold page.
pub(crate) const PAGE: u32 = 32;
/// earned (u64), owed (u128), won (u128), credit won (u128), flags (u8), stake (u64), the tide count the stake was last
/// decayed at (u32).
pub(crate) const COLD_BYTES: usize = 8 + 16 + 16 + 16 + 1 + 8 + 4;
const BOOKS_BYTES: usize = 8 + 16 + 16 + 16 + 1;
/// A hot row in storage: the feed part (id, stake, window, earnings) and the purse part (id, owed, won, credit won,
/// flags).
pub(crate) const FEED_BYTES: usize = 2 + 8 + 8 + 8;
pub(crate) const PURSE_BYTES: usize = 2 + 16 + 16 + 16 + 1;
pub(crate) const HOT_BYTES: usize = FEED_BYTES + PURSE_BYTES;
/// Most rows the hot table holds. A colony without a row cannot plant while the table is full and none of its rows
/// can leave (until the next tide pays and frees them). It bounds every call's gas on the real network however many
/// colonies join: loading, paying and writing back 10,000 rows stays well under 150 TGas.
pub const MAX_PLAYING: usize = 10_000;
/// Most rows one call moves back to their cold slots.
pub(crate) const FLUSH_MAX: usize = 32;
/// Gas a byte of the hot table costs to write back on the real network (the write, the value it replaces, and the
/// memory and register copies: about 70.7 Mgas in NEAR's fee schedule), rounded up.
pub(crate) const HOT_WRITE_GAS_PER_BYTE: u64 = 72_000_000;
/// Gas one cold page costs to read and write back on the real network (two storage operations and 32 slots), rounded up.
pub(crate) const COLD_PAGE_GAS: u64 = 350_000_000_000;
const FEED_KEY: &[u8] = b"h";
const PURSE_KEY: &[u8] = b"j";
pub(crate) const COLD_PREFIX: u8 = b'X';
const ATTACHED: u8 = 1;

/// One colony's numbers (see the module notes).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Books {
    /// PETRI earned from the feed and not yet claimed.
    pub earned: u64,
    /// NEAR won at the tides and not yet claimed.
    pub owed: u128,
    /// Credit won (at tides, and for sales by a colony that never attached NEAR) and not yet spent.
    pub won: u128,
    /// Credit won at the tides in all.
    pub credit_won: u128,
    /// Whether the colony has ever put NEAR into the vault itself. One that has not is paid in credit.
    pub attached: bool,
}

impl Books {
    fn write(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&self.earned.to_le_bytes());
        out.extend_from_slice(&self.owed.to_le_bytes());
        out.extend_from_slice(&self.won.to_le_bytes());
        out.extend_from_slice(&self.credit_won.to_le_bytes());
        out.push(if self.attached { ATTACHED } else { 0 });
    }

    fn read(b: &[u8]) -> Books {
        Books {
            earned: u64::from_le_bytes(b[0..8].try_into().unwrap()),
            owed: u128::from_le_bytes(b[8..24].try_into().unwrap()),
            won: u128::from_le_bytes(b[24..40].try_into().unwrap()),
            credit_won: u128::from_le_bytes(b[40..56].try_into().unwrap()),
            attached: b[56] & ATTACHED != 0,
        }
    }
}

/// A cold slot: the books, and the stake as it stood after tide number `stake_tide`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Cold {
    pub books: Books,
    pub stake: u64,
    pub stake_tide: u32,
}

impl Cold {
    fn write(&self, out: &mut Vec<u8>) {
        self.books.write(out);
        out.extend_from_slice(&self.stake.to_le_bytes());
        out.extend_from_slice(&self.stake_tide.to_le_bytes());
    }

    fn read(b: &[u8]) -> Cold {
        Cold {
            books: Books::read(&b[..BOOKS_BYTES]),
            stake: u64::from_le_bytes(b[BOOKS_BYTES..BOOKS_BYTES + 8].try_into().unwrap()),
            stake_tide: u32::from_le_bytes(b[BOOKS_BYTES + 8..COLD_BYTES].try_into().unwrap()),
        }
    }

    /// The stake after `tides` tides have run in all.
    pub fn stake_at(&self, tides: u64, keep_bps: u16) -> u64 {
        decay_stake_times(self.stake, keep_bps, tides.saturating_sub(self.stake_tide as u64))
    }
}

/// A playing colony's row.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Hot {
    pub id: u16,
    /// Stake in thousandths of a planted cell: the base of the colony's pay cap, decayed at every tide.
    pub stake: u64,
    /// PETRI earned since the last tide: the tide's weight.
    pub window: u64,
    pub books: Books,
}

/// The hot table, loaded once per call; each part is written back only if it changed.
#[derive(Default)]
pub struct HotTable {
    /// Sorted by colony id.
    pub rows: Vec<Hot>,
    /// The feed part (stake, window, earnings, or which rows there are) changed.
    pub dirty: bool,
    /// The purse part changed.
    pub purse_dirty: bool,
}

impl HotTable {
    pub fn load() -> HotTable {
        let feed = env::storage_read(FEED_KEY).unwrap_or_default();
        let purse = env::storage_read(PURSE_KEY).unwrap_or_default();
        let rows = feed
            .chunks_exact(FEED_BYTES)
            .zip(purse.chunks_exact(PURSE_BYTES))
            .map(|(f, p)| {
                let earned = u64::from_le_bytes(f[18..26].try_into().unwrap());
                let mut b = earned.to_le_bytes().to_vec();
                b.extend_from_slice(&p[2..]);
                Hot {
                    id: u16::from_le_bytes([f[0], f[1]]),
                    stake: u64::from_le_bytes(f[2..10].try_into().unwrap()),
                    window: u64::from_le_bytes(f[10..18].try_into().unwrap()),
                    books: Books::read(&b),
                }
            })
            .collect();
        HotTable { rows, dirty: false, purse_dirty: false }
    }

    pub fn store(&mut self) {
        if self.dirty {
            let mut b = Vec::with_capacity(self.rows.len() * FEED_BYTES);
            for r in &self.rows {
                b.extend_from_slice(&r.id.to_le_bytes());
                b.extend_from_slice(&r.stake.to_le_bytes());
                b.extend_from_slice(&r.window.to_le_bytes());
                b.extend_from_slice(&r.books.earned.to_le_bytes());
            }
            write_or_remove(FEED_KEY, &b);
        }
        if self.purse_dirty {
            let mut b = Vec::with_capacity(self.rows.len() * PURSE_BYTES);
            for r in &self.rows {
                b.extend_from_slice(&r.id.to_le_bytes());
                let mut books = Vec::with_capacity(BOOKS_BYTES);
                r.books.write(&mut books);
                b.extend_from_slice(&books[8..]);
            }
            write_or_remove(PURSE_KEY, &b);
        }
        self.dirty = false;
        self.purse_dirty = false;
    }

    pub fn get(&self, id: u16) -> Option<&Hot> {
        self.rows.binary_search_by_key(&id, |r| r.id).ok().map(|i| &self.rows[i])
    }

    /// A row to change anything in.
    pub fn get_mut(&mut self, id: u16) -> Option<&mut Hot> {
        let i = self.rows.binary_search_by_key(&id, |r| r.id).ok()?;
        self.dirty = true;
        self.purse_dirty = true;
        Some(&mut self.rows[i])
    }

    /// Change colony `id`'s numbers if it has a hot row, marking only the part that changed. Returns whether it had.
    pub fn update(&mut self, id: u16, f: impl FnOnce(&mut Books)) -> bool {
        let Ok(i) = self.rows.binary_search_by_key(&id, |r| r.id) else { return false };
        let before = self.rows[i].books;
        f(&mut self.rows[i].books);
        let after = self.rows[i].books;
        self.dirty |= after.earned != before.earned;
        self.purse_dirty |= Books { earned: before.earned, ..after } != before;
        true
    }

    /// A row to change only its stake, window or earnings in.
    pub fn get_feed_mut(&mut self, id: u16) -> Option<&mut Hot> {
        let i = self.rows.binary_search_by_key(&id, |r| r.id).ok()?;
        self.dirty = true;
        Some(&mut self.rows[i])
    }

    /// The stake the feed counts: a colony without a row either has no living cells or a stake too small to earn, so
    /// counting it as none pays exactly what its real stake would.
    pub fn stake_of(&self, id: u16) -> u64 {
        self.get(id).map(|r| r.stake).unwrap_or(0)
    }

    /// The row of colony `id`, made from its cold slot (its stake decayed to `tides`) if it has none.
    pub fn enter(&mut self, id: u16, tides: u64, keep_bps: u16) -> &mut Hot {
        let i = match self.rows.binary_search_by_key(&id, |r| r.id) {
            Ok(i) => i,
            Err(i) => {
                let c = cold_get(id);
                self.rows.insert(i, Hot { id, stake: c.stake_at(tides, keep_bps), window: 0, books: c.books });
                self.purse_dirty = true;
                i
            }
        };
        self.dirty = true;
        &mut self.rows[i]
    }

    /// `(colony, window)` for every row that earned since the last tide, in colony order.
    pub fn windows(&self) -> Vec<(u16, u64)> {
        self.rows.iter().filter(|r| r.window > 0).map(|r| (r.id, r.window)).collect()
    }

    /// Move up to `max` rows that may leave back to their cold slots, lowest ids first: rows with no window whose
    /// colony has no living cell (`alive`, colony ids in increasing order, from the board as stored) or a stake too
    /// small to earn. Their stake goes with them, as it stood after tide number `tides`. Returns how many moved.
    pub fn flush_idle(&mut self, alive: &[u16], reach: u32, tides: u64, max: usize) -> usize {
        let idle: Vec<usize> = self
            .rows
            .iter()
            .enumerate()
            .filter(|(_, r)| r.window == 0 && (!can_earn(r.stake, reach) || alive.binary_search(&r.id).is_err()))
            .map(|(i, _)| i)
            .take(max)
            .collect();
        if idle.is_empty() {
            return 0;
        }
        let out: Vec<(u16, Cold)> = idle.iter().map(|&i| (self.rows[i].id, Cold { books: self.rows[i].books, stake: self.rows[i].stake, stake_tide: tides as u32 })).collect();
        cold_set_many(&out);
        for &i in idle.iter().rev() {
            self.rows.remove(i);
        }
        self.dirty = true;
        self.purse_dirty = true;
        out.len()
    }
}

/// Storage the first row of an empty hot table needs beyond the row: its two records (key and NEAR's 40 bytes each).
pub fn hot_records_bytes() -> u64 {
    if env::storage_has_key(FEED_KEY) {
        0
    } else {
        (FEED_KEY.len() + PURSE_KEY.len() + 80) as u64
    }
}

fn write_or_remove(key: &[u8], b: &[u8]) {
    if b.is_empty() {
        env::storage_remove(key);
    } else {
        env::storage_write(key, b);
    }
}

pub(crate) fn cold_key(page: u32) -> [u8; 3] {
    let p = (page as u16).to_le_bytes();
    [COLD_PREFIX, p[0], p[1]]
}

fn slot(id: u16) -> (u32, usize) {
    let i = id as u32 - 1;
    (i / PAGE, (i % PAGE) as usize * COLD_BYTES)
}

/// Colony `id`'s cold slot (zero for a slot past the page's end, which never happens for a colony that joined).
pub fn cold_get(id: u16) -> Cold {
    let (page, at) = slot(id);
    let b = env::storage_read(&cold_key(page)).unwrap_or_default();
    if b.len() < at + COLD_BYTES {
        return Cold::default();
    }
    Cold::read(&b[at..at + COLD_BYTES])
}

/// Write cold slots, each page once.
pub fn cold_set_many(updates: &[(u16, Cold)]) {
    let mut pages: Vec<u32> = updates.iter().map(|&(id, _)| slot(id).0).collect();
    pages.sort_unstable();
    pages.dedup();
    for page in pages {
        let key = cold_key(page);
        let mut b = env::storage_read(&key).unwrap_or_default();
        for &(id, c) in updates.iter().filter(|(id, _)| slot(*id).0 == page) {
            let at = slot(id).1;
            let mut rec = Vec::with_capacity(COLD_BYTES);
            c.write(&mut rec);
            b[at..at + COLD_BYTES].copy_from_slice(&rec);
        }
        env::storage_write(&key, &b);
    }
}

/// Change only the books in colony `id`'s cold slot.
pub fn cold_update(id: u16, f: impl FnOnce(&mut Books)) {
    let mut c = cold_get(id);
    f(&mut c.books);
    cold_set_many(&[(id, c)]);
}

/// A new colony's empty cold slot, at the end of the last page: a join touches one page however many colonies exist.
pub fn cold_push(id: u16) {
    let (page, at) = slot(id);
    let key = cold_key(page);
    let mut b = env::storage_read(&key).unwrap_or_default();
    near_sdk::require!(b.len() == at, "colony slots are added in order");
    b.resize(at + COLD_BYTES, 0);
    env::storage_write(&key, &b);
}

/// Read many colonies' numbers for a view: the hot table once and each cold page once.
pub struct Reader<'a> {
    hot: &'a HotTable,
    pages: std::collections::BTreeMap<u32, Vec<u8>>,
    tides: u64,
    keep_bps: u16,
}

impl<'a> Reader<'a> {
    pub fn new(hot: &'a HotTable, tides: u64, keep_bps: u16) -> Self {
        Reader { hot, pages: Default::default(), tides, keep_bps }
    }

    /// A colony's books and its stake now.
    pub fn get(&mut self, id: u16) -> (Books, u64) {
        if let Some(r) = self.hot.get(id) {
            return (r.books, r.stake);
        }
        let (page, at) = slot(id);
        let b = self.pages.entry(page).or_insert_with(|| env::storage_read(&cold_key(page)).unwrap_or_default());
        if b.len() < at + COLD_BYTES {
            return (Books::default(), 0);
        }
        let c = Cold::read(&b[at..at + COLD_BYTES]);
        (c.books, c.stake_at(self.tides, self.keep_bps))
    }
}
