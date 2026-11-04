//! Each colony's numbers: its unclaimed earnings, the NEAR it has won at the tides and not claimed, the credit it won
//! and has not spent, the credit it won in all, whether it has ever put NEAR into the vault itself, and, while it plays,
//! its stake and what it earned since the last tide.
//!
//! v5 kept each of these in one array covering every colony that ever joined, so a join rewrote seven arrays and every
//! catch-up and tide read and rewrote several: the gas grew with every colony and would have run out at about 27,000.
//! v6 keeps them in two places, and a colony's numbers are in exactly one of them:
//! - cold pages of `PAGE` colonies each (key `U` + page number). A join appends its own slot to the last page, which
//!   it pays for; after that a page is rewritten only by its colonies' own claims, purchases and spending, and when a
//!   colony leaves the hot table.
//! - one hot table of the colonies that play: a colony enters it when it plants (it pays for its row) and leaves it
//!   once its stake has decayed to nothing (at most `FLUSH_MAX` a call, its numbers written back to its cold slot). The
//!   feed, the tides and the decay read and write only this table, so a catch-up costs what the colonies playing now
//!   cost, however many ever joined. While a colony has a hot row its cold slot is stale and never read.
//!
//! The hot table is stored in two parts, each row in both, in colony order: the feed part (key `H`: id, stake, window,
//! earnings; 26 bytes a row), which every catch-up rewrites, and the purse part (key `J`: id, NEAR owed, credit won and
//! held, whether it attached NEAR; 51 bytes a row), which only tides and a playing colony's own purchases, claims and
//! spending rewrite. Even with every one of the 65,534 colonies a dish can hold playing at once, each part stays under
//! NEAR's 4 MiB limit for one value, and a catch-up writes 1.7 MB.

use near_sdk::env;

/// Colonies per cold page.
pub(crate) const PAGE: u32 = 64;
/// earned (u64), owed (u128), won (u128), credit won (u128), flags (u8).
pub(crate) const COLD_BYTES: usize = 8 + 16 + 16 + 16 + 1;
/// A hot row in storage: the feed part (id, stake, window, earnings) and the purse part (id, owed, won, credit won,
/// flags).
pub(crate) const FEED_BYTES: usize = 2 + 8 + 8 + 8;
pub(crate) const PURSE_BYTES: usize = 2 + 16 + 16 + 16 + 1;
pub(crate) const HOT_BYTES: usize = FEED_BYTES + PURSE_BYTES;
/// Rows a call moves back to their cold slots once their stake is gone.
pub(crate) const FLUSH_MAX: usize = 16;
/// Gas a byte of the hot table costs to write back (a write and the value it replaces), from NEAR's fee schedule.
pub(crate) const HOT_WRITE_GAS_PER_BYTE: u64 = 64_000_000;
const FEED_KEY: &[u8] = b"H";
const PURSE_KEY: &[u8] = b"J";
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
                let mut cold = earned.to_le_bytes().to_vec();
                cold.extend_from_slice(&p[2..]);
                Hot {
                    id: u16::from_le_bytes([f[0], f[1]]),
                    stake: u64::from_le_bytes(f[2..10].try_into().unwrap()),
                    window: u64::from_le_bytes(f[10..18].try_into().unwrap()),
                    books: Books::read(&cold),
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
                let mut cold = Vec::with_capacity(COLD_BYTES);
                r.books.write(&mut cold);
                b.extend_from_slice(&cold[8..]);
            }
            write_or_remove(PURSE_KEY, &b);
        }
        self.dirty = false;
        self.purse_dirty = false;
    }

    /// What writing the table back costs in storage bytes: the feed part, and the purse part if it changed or may.
    pub fn bytes(&self, purse: bool) -> usize {
        self.rows.len() * if purse { HOT_BYTES } else { FEED_BYTES }
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

    pub fn stake_of(&self, id: u16) -> u64 {
        self.get(id).map(|r| r.stake).unwrap_or(0)
    }

    /// The row of colony `id`, made from its cold slot if it has none.
    pub fn enter(&mut self, id: u16) -> &mut Hot {
        let i = match self.rows.binary_search_by_key(&id, |r| r.id) {
            Ok(i) => i,
            Err(i) => {
                self.rows.insert(i, Hot { id, stake: 0, window: 0, books: cold_get(id) });
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

    /// Move up to `FLUSH_MAX` rows whose stake is gone back to their cold slots, lowest ids first. Returns whether any
    /// moved.
    pub fn flush_idle(&mut self) -> bool {
        let idle: Vec<usize> = self.rows.iter().enumerate().filter(|(_, r)| r.stake == 0 && r.window == 0).map(|(i, _)| i).take(FLUSH_MAX).collect();
        if idle.is_empty() {
            return false;
        }
        let out: Vec<(u16, Books)> = idle.iter().map(|&i| (self.rows[i].id, self.rows[i].books)).collect();
        cold_set_many(&out);
        for &i in idle.iter().rev() {
            self.rows.remove(i);
        }
        self.dirty = true;
        self.purse_dirty = true;
        true
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

fn cold_key(page: u32) -> [u8; 3] {
    let p = (page as u16).to_le_bytes();
    [b'U', p[0], p[1]]
}

fn slot(id: u16) -> (u32, usize) {
    let i = id as u32 - 1;
    (i / PAGE, (i % PAGE) as usize * COLD_BYTES)
}

/// Colony `id`'s cold slot (zero for a slot past the page's end, which never happens for a colony that joined).
pub fn cold_get(id: u16) -> Books {
    let (page, at) = slot(id);
    let b = env::storage_read(&cold_key(page)).unwrap_or_default();
    if b.len() < at + COLD_BYTES {
        return Books::default();
    }
    Books::read(&b[at..at + COLD_BYTES])
}

/// Write cold slots, each page once.
pub fn cold_set_many(updates: &[(u16, Books)]) {
    let mut pages: Vec<u32> = updates.iter().map(|&(id, _)| slot(id).0).collect();
    pages.sort_unstable();
    pages.dedup();
    for page in pages {
        let key = cold_key(page);
        let mut b = env::storage_read(&key).unwrap_or_default();
        for &(id, books) in updates.iter().filter(|(id, _)| slot(*id).0 == page) {
            let at = slot(id).1;
            let mut rec = Vec::with_capacity(COLD_BYTES);
            books.write(&mut rec);
            b[at..at + COLD_BYTES].copy_from_slice(&rec);
        }
        env::storage_write(&key, &b);
    }
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
}

impl<'a> Reader<'a> {
    pub fn new(hot: &'a HotTable) -> Self {
        Reader { hot, pages: Default::default() }
    }

    pub fn get(&mut self, id: u16) -> (Books, u64) {
        if let Some(r) = self.hot.get(id) {
            return (r.books, r.stake);
        }
        let (page, at) = slot(id);
        let b = self.pages.entry(page).or_insert_with(|| env::storage_read(&cold_key(page)).unwrap_or_default());
        if b.len() < at + COLD_BYTES {
            return (Books::default(), 0);
        }
        (Books::read(&b[at..at + COLD_BYTES]), 0)
    }
}
