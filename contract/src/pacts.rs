//! Pacts: one colony pays another PETRI for a promise the dish itself keeps.
//!
//! Colony A offers colony B `petri` of its PETRI (`pact_offer`); the dish holds it. If B accepts (`pact_accept`) the
//! PETRI is B's, and until generation `until` the contract refuses every planting of B's with a cell within
//! `pact_radius` cells (across or down, wrapping) of A's living cells, as the board stands at that planting. An offer
//! nobody accepted goes back to A when A withdraws it, B declines it or it expires (`pact_cancel`).
//!
//! A pact binds one side: B promises, A pays. A truce is two pacts, one each way, so each side prices its own promise
//! and either can be accepted alone; a pact that bound both would need both colonies' consent in one call and buys
//! nothing two pacts cannot.
//!
//! Bounds: a colony is party to at most `MAX_PACTS` accepted pacts and offers it made, and has at most `MAX_OFFERS_IN`
//! open offers from others waiting (so offers nobody asked for can fill only that list, which its colony empties by
//! declining them); at most one open offer goes from one colony to another. A planting checks at most `MAX_PACTS`
//! pacts and scans at most cells × (2 `pact_radius` + 1)² cells once each (`Dish::pact_breach`). An offer pays for its
//! own storage and for the entries its acceptance and its end will write, and carries at least `MIN_PACT_PETRI`.
//!
//! The protected ground is the paying colony's living cells as the board stands at each planting: it moves with the
//! colony, cells it plants after the pact was accepted included. A pact is a promise to stay away from a colony, not
//! from a place.
//!
//! What a pact pays must be PETRI its maker could sell: a colony holding kept PETRI, or one that never attached NEAR,
//! cannot offer one. The house's PETRI stays in the house: a house colony offers pacts only to the house; a player's
//! pact with the house may carry PETRI (the house plants with it and never sells), and house-to-house pacts may be
//! free. Every pact is in the ledger (`PactOffer`, `PactAccept`, `PactEnd`), and both replays rebuild them, check every
//! planting against the pacts binding its colony and count the PETRI held for offers.

use crate::*;

/// Most accepted pacts and offers it made one colony is party to at once, so a planting checks at most this many.
pub const MAX_PACTS: usize = 8;
/// Most open offers from other colonies one colony has waiting.
pub const MAX_OFFERS_IN: usize = 16;
/// The least PETRI a pact carries (1 PETRI), except between two of the house's colonies.
pub const MIN_PACT_PETRI: u128 = 1_000_000;
/// Bytes an offer sets aside for the entries its acceptance and its end write, and for the record growing with them.
const PACT_RESERVE: u128 = 140;
/// NEAR that always covers an offer's storage (0.0042 NEAR: its record, 75 bytes; its entry with the credit it spent,
/// 95; two new pact lists, 47 each; the reserve; rounded up). What it does not use is sent back.
pub const PACT_DEPOSIT: u128 = 420 * 10_000_000_000_000_000_000;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Pact {
    /// The colony that pays and is protected.
    pub from: u16,
    /// The colony that promises not to plant within `pact_radius` of `from`'s living cells.
    pub to: u16,
    pub petri: U64,
    pub offered: U64,
    /// The pact binds plantings at generations before this one.
    pub until: U64,
    pub accepted: Option<U64>,
    pub ended: Option<U64>,
}

/// A pact as the views return it, with its number (`from` and `to` are colony ids).
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PactView {
    pub id: u32,
    pub from: u16,
    pub to: u16,
    pub petri: U64,
    pub until: U64,
    pub accepted: Option<U64>,
    pub ended: Option<U64>,
    /// Whether it binds plantings now: accepted, not ended, and `until` still ahead of the stored generation.
    pub binding: bool,
}

#[near]
impl Petri {
    /// Offer `to`'s colony `petri` PETRI (held until it accepts) for its promise not to plant within `pact_radius` of
    /// this colony's living cells before generation `until`. Pay its storage (`PACT_DEPOSIT` covers it) from `credit`
    /// first, then attached NEAR; attached NEAR left over comes back. Returns its number.
    #[payable]
    pub fn pact_offer(&mut self, to: AccountId, petri: U128, until: U64, credit: Option<U128>) -> u32 {
        let account = caller();
        let a = self.colony_id(&account);
        let b = self.colony_of.get(&to).copied().unwrap_or_else(|| env::panic_str("that account has no colony to make a pact with"));
        require!(a != b, "a colony makes no pact with itself");
        let units = petri.0;
        let (house_a, house_b) = (self.colonies.get(a as u32 - 1).unwrap().house, self.colonies.get(b as u32 - 1).unwrap().house);
        require!(units >= MIN_PACT_PETRI || (house_a && house_b), "a pact carries at least 1 PETRI (only pacts between the house's colonies may carry less)");
        if units > 0 {
            require!(!house_a || house_b, "the house's PETRI stays in the house: a house colony's pact with a player carries no PETRI");
            self.require_sendable(&account, "pay for a pact");
        }
        self.catch_up(self.rules.max_catchup as u64);
        let g = self.generation;
        require!(until.0 > g && until.0 <= g + self.rules.pact_max_gens as u64, "a pact lasts until a later generation, at most pact_max_gens ahead of the dish");
        // Pacts past their end make room first.
        self.end_expired(a);
        self.end_expired(b);
        self.flush();
        let (la, lb) = (self.pact_list(a), self.pact_list(b));
        let mut bound = 0;
        for &i in &la {
            let p = read_pact(i);
            require!(!(p.to == b && p.accepted.is_none()), "your offer to that colony is still open: one open offer to a colony at a time");
            bound += pact_counts(a, &p);
        }
        require!(bound < MAX_PACTS, "your colony is party to 8 pacts (accepted, or offers it made) at once; one must end first");
        let waiting = lb.iter().filter(|&&i| pact_counts(b, &read_pact(i)) == 0).count();
        require!(waiting < MAX_OFFERS_IN, "that colony has 16 offers waiting; it must accept or decline one first");
        let held = self.balance(&account);
        require!(held >= units, format!("you hold {} PETRI", fmt_petri(held)));
        let before = env::storage_usage();
        let id = self.pact_count + 1;
        if units > 0 {
            self.balances.insert(account.clone(), held - units);
            self.pact_escrow += units;
            token::emit_transfer_pub(&account, &env::current_account_id(), units, "pact offer: held until accepted");
        }
        self.pact_count = id;
        let pact = Pact { from: a, to: b, petri: U64(units as u64), offered: U64(g), until, accepted: None, ended: None };
        write_pact(id, &pact);
        write_list(a, &[la, vec![id]].concat());
        write_list(b, &[lb, vec![id]].concat());
        let want = credit.map(|c| c.0).unwrap_or(0);
        let entry = |spent: Option<U128>| Entry::PactOffer { generation: U64(g), pact: id, from: a, to: b, petri: U64(units as u64), until, spent };
        // The entry has the same size whatever credit it records.
        let index = self.ledger.len();
        self.ledger.push(entry((want > 0).then_some(U128(0))));
        self.flush();
        let storage = self.storage_cost_since(before) + PACT_RESERVE * byte_cost();
        let from_credit = self.pay_storage(&account, a, want, env::attached_deposit().as_yoctonear(), storage);
        if want > 0 {
            self.ledger.set(index, entry(Some(U128(from_credit))));
        }
        self.flush();
        pact_event(id, "offer", &pact, 0);
        id
    }

    /// Accept pact `id`, made to this colony: its PETRI is paid in, and until `until` the dish refuses this colony's
    /// plantings within `pact_radius` of the offering colony's living cells.
    pub fn pact_accept(&mut self, id: u32) {
        let account = caller();
        let me = self.colony_id(&account);
        let mut p = self.pact_record(id);
        require!(p.to == me, "that pact was not offered to your colony");
        require!(p.accepted.is_none() && p.ended.is_none() && self.generation < p.until.0, "that pact is no longer open: it was accepted, ended or expired");
        // Pacts past their end make room first; an accepted pact counts towards this colony's eight.
        self.end_expired(me);
        let bound: usize = pact_list(me).iter().map(|&i| pact_counts(me, &read_pact(i))).sum();
        require!(bound < MAX_PACTS, "your colony is party to 8 pacts (accepted, or offers it made) at once; one must end first");
        let units = p.petri.0 as u128;
        if units > 0 {
            self.pact_escrow -= units;
            self.credit(&account, units);
            token::emit_transfer_pub(&env::current_account_id(), &account, units, "pact accepted");
        }
        p.accepted = Some(U64(self.generation));
        write_pact(id, &p);
        self.ledger.push(Entry::PactAccept { generation: U64(self.generation), pact: id });
        self.flush();
        pact_event(id, "accept", &p, 0);
    }

    /// End pact `id`: an open offer by either colony, or by anyone once expired (its PETRI goes back to its maker); an
    /// accepted pact by anyone once `until` has come.
    pub fn pact_cancel(&mut self, id: u32) {
        let who = caller();
        let p = self.pact_record(id);
        require!(p.ended.is_none(), "that pact has already ended");
        let over = self.generation >= p.until.0;
        if p.accepted.is_some() {
            require!(over, "an accepted pact binds until its generation `until`; then anyone may end it");
        } else {
            let party = [p.from, p.to].iter().any(|&c| self.colonies.get(c as u32 - 1).unwrap().account == who);
            require!(party || over, "only the two colonies can end an open offer before it expires");
        }
        self.end_pact(id);
        self.flush();
    }

    pub fn pact(&self, id: u32) -> Option<PactView> {
        (id >= 1 && id <= self.pact_count).then(|| self.pact_view(id))
    }

    /// The pacts `account_id`'s colony is party to that have not ended, oldest first.
    pub fn pacts_of(&self, account_id: AccountId) -> Vec<PactView> {
        let Some(&c) = self.colony_of.get(&account_id) else { return vec![] };
        pact_list(c).into_iter().map(|i| self.pact_view(i)).collect()
    }
}

impl Petri {
    fn pact_record(&self, id: u32) -> Pact {
        require!(id >= 1 && id <= self.pact_count, "there is no such pact");
        read_pact(id)
    }

    fn pact_list(&self, colony: u16) -> Vec<u32> {
        pact_list(colony)
    }

    fn pact_view(&self, id: u32) -> PactView {
        let p = read_pact(id);
        PactView {
            id,
            from: p.from,
            to: p.to,
            petri: p.petri,
            until: p.until,
            accepted: p.accepted,
            ended: p.ended,
            binding: p.accepted.is_some() && p.ended.is_none() && self.generation < p.until.0,
        }
    }

    /// End pact `id`: an open offer's PETRI goes back to its maker; both colonies' lists drop it.
    fn end_pact(&mut self, id: u32) {
        let mut p = read_pact(id);
        let refund = if p.accepted.is_none() { p.petri.0 as u128 } else { 0 };
        if refund > 0 {
            let to = self.colony(p.from).account;
            self.pact_escrow -= refund;
            self.credit(&to, refund);
            token::emit_transfer_pub(&env::current_account_id(), &to, refund, "pact offer: back, never accepted");
        }
        p.ended = Some(U64(self.generation));
        for c in [p.from, p.to] {
            let mut l = pact_list(c);
            l.retain(|&i| i != id);
            write_list(c, &l);
        }
        write_pact(id, &p);
        self.ledger.push(Entry::PactEnd { generation: U64(self.generation), pact: id });
        pact_event(id, "end", &p, refund);
    }

    /// End the pacts of `colony` whose `until` has come (at most `MAX_PACTS`).
    fn end_expired(&mut self, colony: u16) {
        for id in self.pact_list(colony) {
            if read_pact(id).until.0 <= self.generation {
                self.end_pact(id);
            }
        }
    }

    /// Refuse a planting of `cells` by colony `id` that breaks a pact binding it: a cell within `pact_radius` of a
    /// living cell, on `dish` as it stands now, of a colony an accepted pact protects until a later generation.
    pub(crate) fn check_pacts(&self, id: u16, dish: &Dish, cells: &[u32]) {
        let list = pact_list(id);
        if list.is_empty() {
            return;
        }
        let binding: Vec<(u32, Pact)> = list.iter().map(|&i| (i, read_pact(i))).filter(|(_, p)| p.to == id && p.accepted.is_some() && p.ended.is_none() && self.generation < p.until.0).collect();
        if binding.is_empty() {
            return;
        }
        let protected: Vec<u16> = binding.iter().map(|(_, p)| p.from).collect();
        if let Some((mine, theirs, who)) = dish.pact_breach(cells, &protected, self.rules.pact_radius) {
            let (i, p) = binding.iter().find(|(_, p)| p.from == who).unwrap();
            let (mx, my) = dish.xy(mine as usize);
            let (tx, ty) = dish.xy(theirs as usize);
            env::panic_str(&format!(
                "pact {} with {}: your colony promised not to plant within {} cells of its living cells until generation {}; ({}, {}) is that close to its cell at ({}, {})",
                i,
                self.colonies.get(p.from as u32 - 1).unwrap().name,
                self.rules.pact_radius,
                p.until.0,
                mx,
                my,
                tx,
                ty
            ));
        }
    }
}

/// Whether pact `p` counts towards colony `c`'s `MAX_PACTS`: accepted, or an offer `c` made (1), or an offer waiting
/// for `c` (0).
fn pact_counts(c: u16, p: &Pact) -> usize {
    (p.accepted.is_some() || p.from == c) as usize
}

/// The `pact` event: what happened to pact `id` (`offer`, `accept` or `end`), and, for an end, the PETRI sent back.
fn pact_event(id: u32, did: &str, p: &Pact, refund: u128) {
    emit("pact", json!({ "pact": id, "did": did, "from": p.from, "to": p.to, "petri": p.petri, "until": p.until, "refund": U128(refund) }));
}

/// Pact `id`'s record: key `P` + the id (u32), borsh.
fn pact_key(id: u32) -> [u8; 5] {
    let b = id.to_le_bytes();
    [b'P', b[0], b[1], b[2], b[3]]
}

pub(crate) fn read_pact(id: u32) -> Pact {
    near_sdk::borsh::from_slice(&env::storage_read(&pact_key(id)).unwrap()).unwrap()
}

pub(crate) fn write_pact(id: u32, p: &Pact) {
    env::storage_write(&pact_key(id), &near_sdk::borsh::to_vec(p).unwrap());
}

/// The pacts a colony is party to that have not ended: key `Q` + the colony id (u16), four bytes a pact.
fn list_key(colony: u16) -> [u8; 3] {
    let b = colony.to_le_bytes();
    [b'Q', b[0], b[1]]
}

pub(crate) fn pact_list(colony: u16) -> Vec<u32> {
    env::storage_read(&list_key(colony)).unwrap_or_default().chunks_exact(4).map(|c| u32::from_le_bytes(c.try_into().unwrap())).collect()
}

pub(crate) fn write_list(colony: u16, list: &[u32]) {
    if list.is_empty() {
        env::storage_remove(&list_key(colony));
    } else {
        env::storage_write(&list_key(colony), &list.iter().flat_map(|i| i.to_le_bytes()).collect::<Vec<u8>>());
    }
}
