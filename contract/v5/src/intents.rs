//! Paying with any token. NEAR Intents (1Click) swaps a player's tokens into wNEAR and delivers them here with
//! `ft_transfer_call`, so the dish receives wNEAR in `ft_on_transfer` from the wNEAR contract, with the intents contract
//! (not the player) as `sender_id` and the player's order in `msg`:
//!
//! `{"for": "<account>", "do": "join" | "buy", "name": "<colony name>", "color": <0xRRGGBB>}`
//!
//! The dish unwraps the wNEAR and joins or buys for `for` as if that account had attached the NEAR itself. Anyone can
//! send wNEAR this way; it is the payer's money, given to `for`.
//!
//! A withdrawal from the intents contract with a message is not refunded, so `ft_on_transfer` never fails and keeps the
//! whole amount. Whatever cannot be used at once (an unreadable order, a taken name, too little gas, a failed unwrap)
//! waits as pending NEAR for `for` (or for the sender if the order names nobody), which that account claims with
//! `claim_pending`. A pending record's storage comes out of the amount, so nobody can make the dish pay for records.
//! The join or purchase runs in a receipt of its own: if it fails for any reason, it leaves the pending NEAR untouched.

use crate::*;
use near_sdk::{GasWeight, PromiseError};

const GAS_FOR_UNWRAP: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_UNWRAPPED: Gas = Gas::from_tgas(15);
/// Least gas a join or purchase is given; with less the NEAR waits as pending.
const GAS_FOR_SETTLE: Gas = Gas::from_tgas(40);
const GAS_FOR_REGISTER: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_REGISTERED: Gas = Gas::from_tgas(5);
/// What a wNEAR account costs to register (the NEP-145 minimum of the wNEAR contract).
pub(crate) const WNEAR_STORAGE: u128 = 1_250_000_000_000_000_000_000;
/// The least wNEAR one transfer brings: below it the transfer is refunded, since it could not pay for its own record.
pub(crate) const MIN_INTENT: u128 = 10_000_000_000_000_000_000_000;

/// What a wNEAR transfer's message asks for.
struct Order {
    account: AccountId,
    what: &'static str,
    name: Option<String>,
    color: Option<u32>,
}

/// Read a transfer's message, accepting anything: an order that cannot be read is pending NEAR for the sender.
fn read_order(msg: &str, sender: &AccountId) -> Order {
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(msg).unwrap_or_default();
    let field = |k: &str| v.get(k).and_then(|x| x.as_str());
    let to = field("for").and_then(|s| s.parse::<AccountId>().ok()).filter(|a| *a != env::current_account_id());
    match to {
        Some(account) => Order {
            account,
            what: match field("do") {
                Some("join") => "join",
                Some("buy") => "buy",
                _ => "",
            },
            name: field("name").filter(|n| n.len() <= 4 * MAX_NAME_BYTES).map(String::from),
            color: v.get("color").and_then(|c| c.as_u64()).filter(|&c| c <= 0xFF_FF_FF).map(|c| c as u32),
        },
        None => Order { account: sender.clone(), what: "", name: None, color: None },
    }
}

#[near]
impl Petri {
    /// NEP-141 receiver. wNEAR from `rules.wnear` is unwrapped and joins or buys for the account the message names (see
    /// the module notes); any other token, and wNEAR below `MIN_INTENT`, is refunded. Never fails.
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128> {
        let token = env::predecessor_account_id();
        if self.rules.wnear.as_ref() != Some(&token) || amount.0 < MIN_INTENT {
            return PromiseOrValue::Value(amount);
        }
        let order = read_order(&msg, &sender_id);
        self.wrapped += amount.0;
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        // Each receipt also pays its own fees up front (about 5 TGas for a function call), hence the margin.
        if left < GAS_FOR_UNWRAP.saturating_add(GAS_FOR_ON_UNWRAPPED).saturating_add(Gas::from_tgas(15)) {
            // Too little gas to unwrap now: the wNEAR waits for its account, and `unwrap_wnear` turns it into NEAR later.
            let credited = self.add_pending(&order.account, amount.0);
            emit("intents", json!({ "for": order.account, "amount": U128(credited), "did": "pending" }));
            return PromiseOrValue::Value(U128(0));
        }
        self.unwrapping += amount.0;
        // Detached from the return value: the whole amount is used whatever the unwrap does, so wNEAR never refunds.
        let _ = Promise::new(token)
            .function_call_weight("near_withdraw", json!({ "amount": amount }).to_string().into_bytes(), NearToken::from_yoctonear(1), GAS_FOR_UNWRAP, GasWeight(0))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_ON_UNWRAPPED).with_unused_gas_weight(1).on_unwrapped(order.account, order.what.to_string(), order.name, order.color, amount));
        PromiseOrValue::Value(U128(0))
    }

    /// After `near_withdraw`: the NEAR (or, if the unwrap failed, the wNEAR) is now pending for `account`; a join or
    /// purchase is then tried in a receipt of its own. Does nothing that can fail.
    #[private]
    pub fn on_unwrapped(&mut self, account: AccountId, what: String, name: Option<String>, color: Option<u32>, amount: U128) {
        only_self();
        let ok = env::promise_results_count() == 1 && !matches!(env::promise_result_checked(0, 1_000), Err(PromiseError::Failed));
        self.unwrapping = self.unwrapping.saturating_sub(amount.0);
        if ok {
            self.wrapped = self.wrapped.saturating_sub(amount.0);
        }
        let credited = self.add_pending(&account, amount.0);
        let left = env::prepaid_gas().saturating_sub(env::used_gas()).saturating_sub(Gas::from_tgas(10));
        if !ok || what.is_empty() || left < GAS_FOR_SETTLE {
            emit("intents", json!({ "for": account, "amount": U128(credited), "did": "pending" }));
            return;
        }
        let _ = Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_SETTLE).with_unused_gas_weight(1).settle_intent(account, what, name, color, U128(credited));
    }

    /// Spend `amount` of `account`'s pending NEAR on what its order asked: a join (or, for an account that already has
    /// a colony, a purchase), as NEAR the account attached itself. What cannot be done leaves the NEAR pending.
    #[private]
    pub fn settle_intent(&mut self, account: AccountId, what: String, name: Option<String>, color: Option<u32>, amount: U128) -> String {
        only_self();
        let have = self.pending.get(&account).copied().unwrap_or(0);
        // Claimed in the meantime: nothing to spend.
        if have < amount.0 {
            return "claimed".into();
        }
        let joined = self.colony_of.get(&account).is_some();
        let name = name.and_then(|n| checked_name(&n).ok()).filter(|n| !self.names.contains(&n.to_lowercase()));
        let deposit = amount.0 + self.pending_entry_bytes(&account, have - amount.0) as u128 * env::storage_byte_cost().as_yoctonear();
        let did = if joined && deposit > 140 * env::storage_byte_cost().as_yoctonear() {
            "buy"
        } else if !joined && what == "join" && name.is_some() && deposit >= self.rules.min_join.0 && self.colonies.len() < u16::MAX as u32 - 1 {
            "join"
        } else {
            emit("intents", json!({ "for": account, "amount": amount, "did": "pending" }));
            return "pending".into();
        };
        let deposit = self.take_pending(&account, amount.0);
        if did == "buy" {
            self.buy_with(&account, deposit, 0);
        } else {
            let color = color.unwrap_or_else(|| default_color(&account));
            self.join_with(account.clone(), name.unwrap(), color, deposit, 0, true);
        }
        emit("intents", json!({ "for": account, "amount": U128(deposit), "did": did }));
        did.into()
    }

    /// Send this account its pending NEAR (with the storage its record took).
    pub fn claim_pending(&mut self) -> U128 {
        let account = caller();
        let have = self.pending.get(&account).copied().unwrap_or(0);
        require!(have > 0, "nothing is pending for this account");
        let near = self.take_pending(&account, have);
        emit("claim_pending", json!({ "account": account, "near": U128(near) }));
        let _ = Promise::new(account.clone())
            .transfer(NearToken::from_yoctonear(near))
            .then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_PAYOUT_CHECK).on_pending_paid(account, U128(near)));
        U128(near)
    }

    /// A pending claim that could not be delivered is pending again.
    #[private]
    pub fn on_pending_paid(&mut self, account: AccountId, near: U128) {
        only_self();
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok() {
            return;
        }
        self.add_pending(&account, near.0);
    }

    pub fn pending_of(&self, account_id: AccountId) -> U128 {
        U128(self.pending.get(&account_id).copied().unwrap_or(0))
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
    /// Add `amount` to `account`'s pending NEAR, less the storage of its record if this makes a new one. Returns what
    /// was added.
    pub(crate) fn add_pending(&mut self, account: &AccountId, amount: u128) -> u128 {
        let before = env::storage_usage();
        let had = self.pending.get(account).copied().unwrap_or(0);
        self.pending.insert(account.clone(), had + amount);
        self.pending.flush();
        let storage = self.storage_cost_since(before).min(amount);
        let credited = amount - storage;
        self.pending.insert(account.clone(), had + credited);
        self.pending_owed += credited;
        credited
    }

    /// Take `amount` (at most all) of `account`'s pending NEAR. A record emptied this way is removed and its storage is
    /// paid out with it. Returns the NEAR released.
    pub(crate) fn take_pending(&mut self, account: &AccountId, amount: u128) -> u128 {
        let had = self.pending.get(account).copied().unwrap_or(0);
        let amount = amount.min(had);
        self.pending_owed -= amount;
        if had > amount {
            self.pending.insert(account.clone(), had - amount);
            return amount;
        }
        let before = env::storage_usage();
        self.pending.remove(account);
        self.pending.flush();
        amount + before.saturating_sub(env::storage_usage()) as u128 * env::storage_byte_cost().as_yoctonear()
    }

    /// Bytes `account`'s pending record frees if `left` is what would remain in it (none unless it empties).
    fn pending_entry_bytes(&self, account: &AccountId, left: u128) -> u64 {
        if left > 0 {
            0
        } else {
            // 40 per record, the prefix and the borsh account, and the u128.
            40 + 1 + 4 + account.as_str().len() as u64 + 16
        }
    }
}

/// A colour for a colony whose order named none: from its account's hash, never too dark to see on the agar.
fn default_color(account: &AccountId) -> u32 {
    let h = env::sha256(account.as_bytes());
    let c = ((h[0] as u32) << 16) | ((h[1] as u32) << 8) | h[2] as u32;
    c | 0x40_40_40
}
