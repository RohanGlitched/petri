//! Paying with any token. NEAR Intents (1Click) swaps a player's tokens into wNEAR and delivers them here with
//! `ft_transfer_call`, so the dish receives wNEAR in `ft_on_transfer` from the wNEAR contract, with the intents contract
//! (not the player) as `sender_id` and the player's order in `msg`:
//!
//! `{"for": "<account>", "do": "join" | "buy", "name": "<colony name>", "color": <0xRRGGBB>}`
//!
//! The dish unwraps the wNEAR and joins or buys for `for` as if that account had attached the NEAR itself. Anyone can
//! send wNEAR this way; it is the payer's money, given to `for`. Because anyone can, the payer's text never appears
//! under someone else's account: a colony started this way is called "Culture" and a few hex digits of its account's
//! hash, in a colour from the same hash, unless the transfer's `sender_id` is `for` itself (the account paying from
//! its own wNEAR). Its account may then choose its own name and colour once (`rename`). The house's accounts start
//! their own colonies, so a payment for one of them waits as pending NEAR instead.
//!
//! wNEAR that pays for its own records is never refunded, so no 1Click delivery can bounce back to the intents contract
//! and be lost to its payer: `ft_on_transfer` keeps the whole amount as pending NEAR for `for` (or for the sender if the
//! order names nobody), with the order. Its record's storage and its `Pending` entry are paid from it. An amount no
//! larger than what those records cost (1Click never delivers so little) is refunded whole and writes nothing, so dust
//! cannot grow the dish's storage. The join or purchase then runs in a receipt of its own; if it
//! cannot run (an unreadable order, too little gas, a failed unwrap, a purchase for an account with no colony), the
//! NEAR waits with its order, and anyone (the keeper, the account) can complete the order later with `settle_pending`.
//! The account can instead take the NEAR back with `claim_pending`. Every change to pending NEAR is in the ledger.

use crate::*;
use near_sdk::{GasWeight, PromiseError};

/// `near_withdraw` on wrap.near is an assertion, a balance update and one transfer: about 3 TGas.
const GAS_FOR_UNWRAP: Gas = Gas::from_tgas(5);
const GAS_FOR_ON_UNWRAPPED: Gas = Gas::from_tgas(15);
/// Least gas a join or purchase from pending NEAR is given; with less the order waits for `settle_pending`. A join
/// writes about 2 KB (its colony, its cold slot, two ledger entries) and catches up at least one generation, which
/// on a 128 × 128 dish costs a few TGas; 30 TGas leaves room for both.
const GAS_FOR_SETTLE: Gas = Gas::from_tgas(30);
const GAS_FOR_REGISTER: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_REGISTERED: Gas = Gas::from_tgas(5);
/// What a wNEAR account costs to register (the NEP-145 minimum of the wNEAR contract).
pub(crate) const WNEAR_STORAGE: u128 = 1_250_000_000_000_000_000_000;

/// What a wNEAR transfer's message asks for, kept with the pending NEAR until it is done.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Order {
    /// A join (a purchase when the account already has a colony), or a purchase.
    pub join: bool,
    /// The name and colour to join with: only when the account paid for itself.
    pub name: Option<String>,
    pub color: Option<u32>,
}

/// An account's pending NEAR, and how much of it its order may still spend.
#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default)]
pub struct PendingRec {
    pub near: u128,
    /// The part that came with the order (wNEAR payments). NEAR that waits for other reasons (a failed payout) is the
    /// account's to claim and no order spends it.
    pub order_near: u128,
    pub order: Option<Order>,
}

#[near(serializers = [json])]
pub struct PendingView {
    pub near: U128,
    pub order_near: U128,
    pub order: Option<Order>,
}

/// Read a transfer's message, accepting anything: an order that cannot be read is pending NEAR for the sender.
fn read_order(msg: &str, sender: &AccountId) -> (AccountId, Option<Order>) {
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(msg).unwrap_or_default();
    let field = |k: &str| v.get(k).and_then(|x| x.as_str());
    let to = field("for").and_then(|s| s.parse::<AccountId>().ok()).filter(|a| *a != env::current_account_id());
    let Some(account) = to else { return (sender.clone(), None) };
    let join = match field("do") {
        Some("join") => true,
        Some("buy") => false,
        _ => return (account, None),
    };
    // Only the account itself chooses what its colony is called.
    let own = *sender == account;
    let name = field("name").filter(|_| own).and_then(|n| checked_name(n).ok()).filter(|n| !is_neutral(n));
    let color = v.get("color").and_then(|c| c.as_u64()).filter(|&c| own && c <= 0xFF_FF_FF).map(|c| c as u32);
    (account, Some(Order { join, name, color }))
}

#[near]
impl Petri {
    /// NEP-141 receiver. wNEAR from `rules.wnear` is kept whole and unwrapped, and joins or buys for the account the
    /// message names (see the module notes); any other token, and wNEAR too little for its records, is refunded. Never
    /// fails.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if self.rules.wnear.as_ref() != Some(&token) || amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }
        let (account, order) = read_order(&msg, &sender_id);
        // Too little to pay for the records it would need: refunded, so nobody else pays for its storage.
        if amount.0 <= intent_bytes(&account, &order) * byte_cost() {
            return PromiseOrValue::Value(amount);
        }
        self.wrapped += amount.0;
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        // Each receipt also pays its own fees up front (about 5 TGas for a function call), hence the margin.
        if left < GAS_FOR_UNWRAP.saturating_add(GAS_FOR_ON_UNWRAPPED).saturating_add(Gas::from_tgas(15)) {
            // Too little gas to unwrap now: the wNEAR waits with its order, and `unwrap_wnear` turns it into NEAR later.
            let credited = self.receive_intent(&account, amount.0, order);
            self.flush();
            emit("intents", json!({ "for": account, "amount": U128(credited), "did": "pending" }));
            return PromiseOrValue::Value(U128(0));
        }
        self.unwrapping += amount.0;
        // Detached from the return value: the whole amount is used whatever the unwrap does, so wNEAR never refunds.
        let _ = Promise::new(token)
            .function_call_weight("near_withdraw", json!({ "amount": amount }).to_string().into_bytes(), NearToken::from_yoctonear(1), GAS_FOR_UNWRAP, GasWeight(0))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_ON_UNWRAPPED).with_unused_gas_weight(1).on_unwrapped(account, order, amount));
        PromiseOrValue::Value(U128(0))
    }

    /// After `near_withdraw`: the NEAR (or, if the unwrap failed, the wNEAR) is now pending for `account` with its
    /// order; the order is then tried in a receipt of its own. Does nothing that can fail.
    #[private]
    pub fn on_unwrapped(&mut self, account: AccountId, order: Option<Order>, amount: U128) {
        only_self();
        let ok = env::promise_results_count() == 1 && !matches!(env::promise_result_checked(0, 1_000), Err(PromiseError::Failed));
        self.unwrapping = self.unwrapping.saturating_sub(amount.0);
        if ok {
            self.wrapped = self.wrapped.saturating_sub(amount.0);
        }
        let has_order = order.is_some();
        let credited = self.receive_intent(&account, amount.0, order);
        self.flush();
        let left = env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(Gas::from_tgas(10));
        if !ok || credited == 0 || !has_order || left < GAS_FOR_SETTLE {
            emit("intents", json!({ "for": account, "amount": U128(credited), "did": "pending" }));
            return;
        }
        let _ = Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_SETTLE).with_unused_gas_weight(1).settle_intent(account);
    }

    /// Run `account`'s waiting order, from the receipt `on_unwrapped` schedules.
    #[private]
    pub fn settle_intent(&mut self, account: AccountId) -> String {
        only_self();
        self.settle(&account).into()
    }

    /// Complete `account_id`'s waiting order with the NEAR that came with it: a join (or, for an account that already
    /// has a colony, a purchase), or a purchase. Anyone may call it, the keeper or the account; it does only what the
    /// order asked, with only the NEAR that came with the order. Fails, changing nothing, when the order cannot run yet.
    pub fn settle_pending(&mut self, account_id: AccountId) -> String {
        self.settle(&account_id).into()
    }

    /// Send this account all its pending NEAR, with the storage its record took. A transfer that fails makes it pending
    /// again.
    pub fn claim_pending(&mut self) -> U128 {
        let account = caller();
        let have = self.pending.get(&account).map(|r| r.near).unwrap_or(0);
        require!(have > 0, "nothing is pending for this account");
        let (near, index) = self.take_pending(&account, have);
        require!(near > 0, "too little is pending to pay for its own record");
        self.flush();
        emit("claim_pending", json!({ "account": account, "near": U128(near) }));
        self.pay_out(&account, PAYOUT_PENDING, index, 0, &account, near);
        U128(near)
    }

    pub fn pending_of(&self, account_id: AccountId) -> U128 {
        U128(self.pending.get(&account_id).map(|r| r.near).unwrap_or(0))
    }

    /// An account's pending NEAR with the order still waiting on it, if any.
    pub fn pending_record(&self, account_id: AccountId) -> Option<PendingView> {
        self.pending.get(&account_id).map(|r| PendingView { near: U128(r.near), order_near: U128(r.order_near), order: r.order.clone() })
    }

    /// The least wNEAR a payment for `account_id` must deliver for its order (`"join"` or `"buy"`) to run: what the
    /// order needs (`min_join`, or a purchase's record) plus the records the payment itself writes on its way (its
    /// `Pending` and `Unpend` entries; the pending record's own storage comes back when it empties). 1Click quotes that
    /// may deliver less are refused before anyone pays. A join also pays for the colony's own storage before `min_join`
    /// of it reaches the vault (v6.5: so a join this minimum pays for attaches the colony, never leaves it a guest).
    pub fn intent_minimum(&self, what: String, account_id: AccountId) -> U128 {
        let zero = U128(0);
        let g = U64(0);
        let pending = entry_bytes(&Entry::Pending { generation: g, account: account_id.clone(), near: zero });
        let unpend = entry_bytes(&Entry::Unpend { generation: g, account: account_id.clone(), near: zero, paid: zero });
        let need = if what == "join" { self.intent_join_minimum(&account_id) } else { (BUY_BYTES + 1) * byte_cost() };
        U128(need + (pending + unpend) * byte_cost())
    }

    /// Unwrap wNEAR the dish holds for pending accounts and is not already unwrapping (after a failed unwrap, or a
    /// transfer that came with too little gas to unwrap). Anyone may call it.
    pub fn unwrap_wnear(&mut self) -> Promise {
        let wnear = self.rules.wnear.clone().unwrap_or_else(|| env::panic_str("this dish takes no wNEAR"));
        let amount = self.wrapped.saturating_sub(self.unwrapping);
        require!(amount > 0, "no wNEAR is waiting to be unwrapped");
        self.unwrapping += amount;
        Promise::new(wnear)
            .function_call("near_withdraw", json!({ "amount": U128(amount) }).to_string().into_bytes(), NearToken::from_yoctonear(1), GAS_FOR_UNWRAP)
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_ON_REGISTERED).on_wnear_unwrapped(U128(amount)))
    }

    #[private]
    pub fn on_wnear_unwrapped(&mut self, amount: U128) {
        only_self();
        self.unwrapping = self.unwrapping.saturating_sub(amount.0);
        if env::promise_results_count() == 1 && !matches!(env::promise_result_checked(0, 1_000), Err(PromiseError::Failed)) {
            self.wrapped = self.wrapped.saturating_sub(amount.0);
        }
    }

    /// Register the dish on the wNEAR contract so it can receive wNEAR. Anyone may call it; the registration is paid
    /// from the attached deposit (at least 0.00125 NEAR, the rest sent back) or, with none attached, from the contract's
    /// surplus.
    #[payable]
    pub fn register_wnear(&mut self) -> Promise {
        let wnear = self.rules.wnear.clone().unwrap_or_else(|| env::panic_str("this dish takes no wNEAR"));
        require!(!self.wnear_ready, "the dish is already registered on wNEAR");
        let attached = env::attached_deposit().as_yoctonear();
        if attached > 0 {
            require!(attached >= WNEAR_STORAGE, "registering on wNEAR costs 0.00125 NEAR");
            if attached > WNEAR_STORAGE {
                let _ = Promise::new(env::predecessor_account_id()).transfer(NearToken::from_yoctonear(attached - WNEAR_STORAGE));
            }
        } else {
            require!(self.solvency().surplus.0 >= WNEAR_STORAGE, "the dish has no surplus for the registration; attach 0.00125 NEAR");
        }
        Promise::new(wnear)
            .function_call(
                "storage_deposit",
                json!({ "account_id": env::current_account_id(), "registration_only": true }).to_string().into_bytes(),
                NearToken::from_yoctonear(WNEAR_STORAGE),
                GAS_FOR_REGISTER,
            )
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_ON_REGISTERED).on_wnear_registered())
    }

    #[private]
    pub fn on_wnear_registered(&mut self) {
        only_self();
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 1_000).is_ok() {
            self.wnear_ready = true;
        }
    }
}

impl Petri {
    /// `amount` of wNEAR (or the NEAR it became) arrived for `account` with `order`: pending NEAR, less what its record
    /// and its `Pending` entry cost, with the order (a newer order replaces an older one, but only a join replaces a
    /// waiting join; the NEAR adds up). An amount
    /// that cannot pay for those goes to the vault with a `Dust` entry instead. Returns what became pending.
    pub(crate) fn receive_intent(&mut self, account: &AccountId, amount: u128, order: Option<Order>) -> u128 {
        let before = env::storage_usage();
        let old = self.pending.get(account).cloned();
        let index = self.ledger.len();
        // Every record here has the same size whatever the amounts, so the storage is known before they are.
        self.pending_add(account, amount, order.clone());
        self.ledger.push(Entry::Pending { generation: U64(self.generation), account: account.clone(), near: U128(amount) });
        self.flush();
        let storage = self.storage_cost_since(before);
        if amount > storage {
            let credited = amount - storage;
            let mut rec = self.pending.get(account).cloned().unwrap();
            rec.near -= storage;
            if order.is_some() {
                rec.order_near -= storage;
            }
            self.pending.insert(account.clone(), rec);
            self.ledger.set(index, Entry::Pending { generation: U64(self.generation), account: account.clone(), near: U128(credited) });
            self.pending_owed += credited;
            return credited;
        }
        // Too little for a record of its own: undo it, and the NEAR goes to the vault for the players.
        match old {
            Some(r) => {
                self.pending.insert(account.clone(), r);
            }
            None => {
                self.pending.remove(account);
            }
        }
        self.ledger.pop();
        self.flush();
        let before = env::storage_usage();
        let index = self.ledger.len();
        self.ledger.push(Entry::Dust { generation: U64(self.generation), near: U128(amount) });
        self.flush();
        let kept = amount - self.storage_cost_since(before).min(amount);
        self.ledger.set(index, Entry::Dust { generation: U64(self.generation), near: U128(kept) });
        self.vault += kept;
        self.near_in += kept;
        emit("intents", json!({ "for": account, "amount": U128(amount), "did": "dust" }));
        0
    }

    /// Add `amount` to `account`'s pending record (making one if it has none), and with `order` replace its order and
    /// add `amount` to what the order may spend. The caller pays for the record and counts `pending_owed`.
    pub(crate) fn pending_add(&mut self, account: &AccountId, amount: u128, order: Option<Order>) {
        let mut rec = self.pending.get(account).cloned().unwrap_or_default();
        rec.near += amount;
        if let Some(new) = order {
            // v6.5: a waiting join is replaced only by another join, so nobody can turn an account's join into a
            // purchase with a payment of their own. A purchase's NEAR adds to the join, which buys PETRI with all of it.
            if rec.order.as_ref().map_or(true, |o| !o.join || new.join) {
                rec.order = Some(new);
            }
            rec.order_near += amount;
        }
        self.pending.insert(account.clone(), rec);
    }

    /// What an order's NEAR must come to for a join from it (v6.5): `min_join` for the vault plus the most storage the
    /// join can take for `account` (see `join_bytes`).
    pub(crate) fn intent_join_minimum(&self, account: &AccountId) -> u128 {
        self.rules.min_join.0 + join_bytes(account) * byte_cost()
    }

    /// Take `amount` (at most all) of `account`'s pending NEAR, with an `Unpend` entry. Its order's share shrinks with
    /// it, and goes when the order is spent (`settle`) or the record empties. The storage the record frees, less the
    /// entry's, goes with the NEAR. Returns the NEAR released and the entry's index.
    pub(crate) fn take_pending(&mut self, account: &AccountId, amount: u128) -> (u128, u64) {
        let mut rec = self.pending.get(account).cloned().unwrap_or_default();
        let amount = amount.min(rec.near);
        let before = env::storage_usage();
        self.pending_owed -= amount;
        rec.near -= amount;
        rec.order_near = rec.order_near.saturating_sub(amount).min(rec.near);
        if rec.order_near == 0 {
            rec.order = None;
        }
        if rec.near == 0 {
            self.pending.remove(account);
        } else {
            self.pending.insert(account.clone(), rec);
        }
        let index = self.ledger.len();
        self.ledger.push(Entry::Unpend { generation: U64(self.generation), account: account.clone(), near: U128(amount), paid: U128(0) });
        self.flush();
        let after = env::storage_usage();
        let released = if after <= before { amount + (before - after) as u128 * byte_cost() } else { amount.saturating_sub((after - before) as u128 * byte_cost()) };
        self.ledger.set(index, Entry::Unpend { generation: U64(self.generation), account: account.clone(), near: U128(amount), paid: U128(released) });
        (released, index as u64)
    }

    /// What `take_pending(account, amount)` would release, without taking it: the NEAR, plus the storage the record
    /// frees (all of it when it empties, the order's when only the order goes), less the `Unpend` entry's.
    fn release_estimate(&self, account: &AccountId, rec: &PendingRec, amount: u128) -> u128 {
        let amount = amount.min(rec.near);
        let unpend = entry_bytes(&Entry::Unpend { generation: U64(self.generation), account: account.clone(), near: U128(0), paid: U128(0) });
        let rest = rec.near - amount;
        let freed = if rest == 0 {
            // The record: its key (prefix and borsh account), its value and NEAR's 40 bytes.
            (40 + 1 + 4 + account.as_str().len() + near_sdk::borsh::to_vec(rec).unwrap().len()) as u128
        } else if rec.order.is_some() && rec.order_near.saturating_sub(amount).min(rest) == 0 {
            (near_sdk::borsh::to_vec(&rec.order).unwrap().len() - 1) as u128
        } else {
            0
        };
        (amount + freed * byte_cost()).saturating_sub(unpend * byte_cost())
    }

    /// Spend `account`'s order on what it asked, with the NEAR that came with it, as NEAR the account attached itself:
    /// a join under its own name if it paid for itself and the name is free, else under its neutral name; a purchase
    /// for an account that has a colony. Panics, changing nothing, if the order cannot run now.
    pub(crate) fn settle(&mut self, account: &AccountId) -> &'static str {
        let rec = self.pending.get(account).cloned().unwrap_or_else(|| env::panic_str("nothing is pending for that account"));
        let order = rec.order.clone().unwrap_or_else(|| env::panic_str("no order waits on that account's pending NEAR"));
        require!(rec.order_near > 0, "no order waits on that account's pending NEAR");
        let joined = self.colony_of.get(account).is_some();
        require!(joined || order.join, "the order buys PETRI, but that account has no colony yet");
        require!(joined || !self.is_house(account), "the house starts its own colonies; that NEAR waits for its account to claim");
        // Checked before anything changes, so an order that cannot run leaves everything as it was.
        let est = self.release_estimate(account, &rec, rec.order_near);
        if joined {
            require!(est > BUY_BYTES * byte_cost(), "too little NEAR waits with that order to buy any PETRI");
        } else {
            // v6.5: enough for the colony's storage and `min_join` for the vault, so the join attaches the colony. Less
            // waits as pending NEAR, as a join below `min_join` always did.
            let need = self.intent_join_minimum(account);
            require!(est >= need, format!("a join needs {} NEAR; {} waits with that order", fmt_near(need), fmt_near(est)));
            require!(self.colonies.len() < u16::MAX as u32 - 1, "the dish is full of colonies");
        }
        let (deposit, _) = self.take_pending(account, rec.order_near);
        require!(deposit == est, "pending storage was miscounted");
        let did = if joined {
            self.buy_with(account, deposit, 0);
            "buy"
        } else {
            let own = order.name.filter(|n| !self.names.contains(&n.to_lowercase()));
            let (name, color, proxy) = match own {
                Some(n) => (n, order.color.unwrap_or_else(|| default_color(account)), false),
                None => (self.neutral_name(account), default_color(account), true),
            };
            self.join_with(account.clone(), name, color, deposit, 0, proxy);
            "join"
        };
        self.flush();
        emit("intents", json!({ "for": account, "amount": U128(deposit), "did": did }));
        did
    }

    /// A free neutral name for a colony someone else paid to start: "Culture" and the first 4 (then 6, ... 16) hex
    /// digits of its account's hash. Players cannot choose names of this form (see `chosen_name`), so only another such
    /// colony whose hash begins the same way can hold the shorter ones.
    fn neutral_name(&self, account: &AccountId) -> String {
        let h = hex::encode(env::sha256(account.as_bytes()));
        for n in (4..=16).step_by(2) {
            let name = format!("Culture {}", &h[..n]);
            if !self.names.contains(&name.to_lowercase()) {
                return name;
            }
        }
        env::panic_str("every neutral name for that account is taken")
    }
}

/// The most storage a wNEAR payment for `account` with `order` can write on arrival: a new pending record (key and
/// record overhead included) and its `Pending` entry. An existing record only grows by less.
fn intent_bytes(account: &AccountId, order: &Option<Order>) -> u128 {
    let rec = PendingRec { near: 0, order_near: 0, order: order.clone() };
    (40 + 1 + 4 + account.as_str().len() + near_sdk::borsh::to_vec(&rec).unwrap().len()) as u128 + entry_bytes(&Entry::Pending { generation: U64(0), account: account.clone(), near: U128(0) })
}

/// The most storage a join for `account` takes, as `join_with` charges it: the colony record (its vector slot), the
/// account's colony id, the name, a PETRI registration, the `Join` entry, a cold slot on a new page, and the purchase
/// record it charges up front, with a name of the longest length a colony may have. A join takes no more, whatever it
/// is called, so a join from an order of at least `min_join` plus this always attaches its colony.
pub(crate) fn join_bytes(account: &AccountId) -> u128 {
    let a = account.as_str().len() as u128;
    let n = MAX_NAME_BYTES as u128;
    let colony = 5 + COLONY_FIXED_BYTES + a + n + 40;
    let colony_of = 1 + 4 + a + 2 + 40;
    let name = 1 + 4 + n + 40;
    let balance = 1 + 4 + a + 16 + 40;
    let entry = entry_bytes(&Entry::Join { generation: U64(0), colony: 0 });
    let cold = (books::COLD_BYTES + 3 + 40) as u128;
    colony + colony_of + name + balance + entry + cold + BUY_BYTES
}

/// A colour for a colony whose order named none: from its account's hash, never too dark to see on the agar.
fn default_color(account: &AccountId) -> u32 {
    let h = env::sha256(account.as_bytes());
    let c = ((h[0] as u32) << 16) | ((h[1] as u32) << 8) | h[2] as u32;
    c | 0x40_40_40
}
