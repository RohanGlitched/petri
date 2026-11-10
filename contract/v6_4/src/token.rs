//! PETRI as a NEP-141 token, with NEP-148 metadata and NEP-145 storage registration.
//!
//! An account must be registered (by joining the dish or with `storage_deposit`) before it can receive PETRI, and it
//! pays for its own balance record (a slide's holder is registered by the planting that pays it its first royalty).
//! PETRI earned before a colony's first NEAR stays in the dish: a colony that has never attached NEAR cannot send
//! PETRI, and one holding kept PETRI cannot send any until it has planted it (see `Colony::kept`). Transfers are not in
//! the ledger; the replays check every colony's kept PETRI, which no transfer changes, and these checks are the code's.
//! The contract's own balance is what the dish holds (the agar, unclaimed earnings and the keeper pot): it never sends
//! or receives PETRI through the token methods. The house's accounts move PETRI only among themselves: what they hold
//! they bought with NEAR, and it never reaches a player who could sell it back to the vault.
//!
//! As in near-contract-standards, PETRI refunded to a sender that unregistered meanwhile is burned, and a forced
//! unregistration burns the balance; both are `Burn` entries in the ledger, so the replays' burn count stays exact.

use crate::*;

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_TRANSFER_MIN: Gas = Gas::from_tgas(10);
/// Bytes a balance record can take (the NEP-145 convention for a 64-character account).
pub(crate) const ACCOUNT_STORAGE: u128 = 125;

#[near(serializers = [json])]
pub struct FtMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
pub struct StorageBounds {
    pub min: U128,
    pub max: Option<U128>,
}

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='11.2' fill='%233a1c08' stroke='%23f3e9da' stroke-width='1'/%3E%3Cg fill='%23f2b45a'%3E%3Ccircle cx='12' cy='7.4' r='1.95'/%3E%3Ccircle cx='16.6' cy='12' r='1.95'/%3E%3Ccircle cx='7.4' cy='16.6' r='1.95'/%3E%3Ccircle cx='12' cy='16.6' r='1.95'/%3E%3Ccircle cx='16.6' cy='16.6' r='1.95'/%3E%3C/g%3E%3C/svg%3E";

/// Launch mints the whole supply to the contract, which holds it as the agar.
pub(crate) fn emit_mint(owner: &AccountId, amount: u128, memo: &str) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": [{ "owner_id": owner, "amount": U128(amount), "memo": memo }] }));
}

pub(crate) fn emit_transfer_pub(from: &AccountId, to: &AccountId, amount: u128, memo: &str) {
    emit_transfer(from, to, amount, Some(memo));
}

pub(crate) fn emit_burn(owner: &AccountId, amount: u128, memo: &str) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_burn", "data": [{ "owner_id": owner, "amount": U128(amount), "memo": memo }] }));
}

fn emit_transfer(from: &AccountId, to: &AccountId, amount: u128, memo: Option<&str>) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [{ "old_owner_id": from, "new_owner_id": to, "amount": U128(amount), "memo": memo }] }));
}

fn min_storage() -> u128 {
    ACCOUNT_STORAGE * env::storage_byte_cost().as_yoctonear()
}

#[near]
impl Petri {
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        let sender = caller();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo.as_deref());
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        let sender = caller();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo.as_deref());
        // The receiver gets whatever gas is left once the resolve callback is provided for (the runtime shares it out);
        // every receipt also costs its own fees up front, hence the margin.
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        require!(left >= GAS_FOR_ON_TRANSFER_MIN.saturating_add(GAS_FOR_RESOLVE).saturating_add(Gas::from_tgas(15)), "more gas is required");
        Promise::new(receiver_id.clone())
            .function_call_weight(
                "ft_on_transfer",
                json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_ON_TRANSFER_MIN,
                near_sdk::GasWeight(1),
            )
            .then(Promise::new(env::current_account_id()).function_call_weight(
                "ft_resolve_transfer",
                json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_RESOLVE,
                near_sdk::GasWeight(0),
            ))
            .into()
    }

    /// Returns the PETRI the receiver used. What it did not use goes back to the sender, or, if the sender has
    /// unregistered meanwhile, is burned (and counts as used), as near-contract-standards does.
    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        if unused > 0 {
            let held = self.balance(&receiver_id);
            let refund = unused.min(held);
            if refund > 0 {
                self.balances.insert(receiver_id.clone(), held - refund);
                if self.balances.contains_key(&sender_id) {
                    self.credit(&sender_id, refund);
                    emit_transfer(&receiver_id, &sender_id, refund, Some("refund"));
                    return U128(amount.0 - refund);
                }
                // The sender's registration is gone: burn the refund.
                self.burn_outside(&receiver_id, refund, "refund to an unregistered sender");
            }
        }
        amount
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply())
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        if account_id == env::current_account_id() {
            return U128(self.held_by_dish());
        }
        U128(self.balance(&account_id))
    }

    pub fn ft_metadata(&self) -> FtMetadata {
        FtMetadata {
            spec: "ft-1.0.0".into(),
            name: "Petri".into(),
            symbol: "PETRI".into(),
            icon: Some(ICON.into()),
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }

    /// Register an account to hold PETRI. Costs the storage of one balance record; the rest is refunded.
    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = registration_only;
        let payer = env::predecessor_account_id();
        let account = account_id.unwrap_or_else(|| payer.clone());
        require!(account != env::current_account_id(), "the dish does not register itself");
        let deposit = env::attached_deposit().as_yoctonear();
        let min = min_storage();
        if self.balances.contains_key(&account) {
            if deposit > 0 {
                let _ = Promise::new(payer).transfer(NearToken::from_yoctonear(deposit));
            }
        } else {
            require!(deposit >= min, format!("registering costs {} NEAR", fmt_near(min)));
            self.balances.insert(account, 0);
            if deposit > min {
                let _ = Promise::new(payer).transfer(NearToken::from_yoctonear(deposit - min));
            }
        }
        StorageBalance { total: U128(min), available: U128(0) }
    }

    /// Nothing above the minimum is ever held, so there is nothing to withdraw.
    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> StorageBalance {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        let account = env::predecessor_account_id();
        require!(self.balances.contains_key(&account), "this account is not registered");
        require!(amount.map(|a| a.0).unwrap_or(0) == 0, "there is no storage deposit above the minimum to withdraw");
        StorageBalance { total: U128(min_storage()), available: U128(0) }
    }

    /// Remove a registration and refund its storage. With PETRI still in it the call fails, unless `force` is true:
    /// then the PETRI is burned (a `Burn` entry, paid from the refund). A colony's account cannot unregister, forced or
    /// not, for as long as the dish lives: its colony is paid its earnings into this balance.
    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        let account = env::predecessor_account_id();
        if !self.balances.contains_key(&account) {
            return false;
        }
        require!(!self.colony_of.contains_key(&account), "a colony's account stays registered for as long as the dish lives: its colony is paid into it");
        let held = self.balance(&account);
        require!(held == 0 || force == Some(true), "the account still holds PETRI; unregister with force to burn it");
        let before = env::storage_usage();
        self.balances.remove(&account);
        if held > 0 {
            self.burn_outside(&account, held, "forced unregistration");
        }
        self.flush();
        let grown = env::storage_usage().saturating_sub(before) as u128 * env::storage_byte_cost().as_yoctonear();
        let refund = min_storage().saturating_sub(grown);
        if refund > 0 {
            let _ = Promise::new(account).transfer(NearToken::from_yoctonear(refund));
        }
        true
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.balances.contains_key(&account_id).then(|| StorageBalance { total: U128(min_storage()), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBounds {
        StorageBounds { min: U128(min_storage()), max: Some(U128(min_storage())) }
    }
}

impl Petri {
    /// PETRI earned before a colony's first NEAR stays in the dish: a colony that has never attached NEAR (a guest)
    /// cannot send PETRI at all, and one that holds kept PETRI cannot send any until it has planted it (see
    /// `Colony::kept`). Accounts without a colony are not limited, and neither is the house, whose PETRI never leaves
    /// the house anyway (its strains on testnet play on sponsored credit).
    pub(crate) fn require_sendable(&self, account: &AccountId, what: &str) {
        let Some(&id) = self.colony_of.get(account) else { return };
        let c = self.colonies.get(id as u32 - 1).unwrap();
        if c.house {
            return;
        }
        require!(c.attached, "free play's PETRI stays in the dish: a colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)");
        require!(c.kept.0 == 0, kept_text(c.kept.0, what));
    }

    /// Burn `amount` of PETRI already taken from `account`'s balance, with a `Burn` entry.
    fn burn_outside(&mut self, account: &AccountId, amount: u128, memo: &str) {
        self.burned += amount;
        self.ledger.push(Entry::Burn { generation: U64(self.generation), account: account.clone(), petri: U64(amount as u64) });
        self.ledger.flush();
        emit_burn(account, amount, memo);
    }

    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<&str>) {
        require!(amount > 0, "amount must be positive");
        require!(*to != env::current_account_id(), "PETRI goes back to the agar only by planting or selling");
        require!(from != to, "sender and receiver are the same account");
        require!(!self.is_house(from) || self.is_house(to), "the house's PETRI stays in the house: it plants with it and never hands it to players");
        self.require_sendable(from, "send PETRI");
        require!(self.balances.contains_key(to), "the receiver is not registered; it needs storage_deposit first");
        let b = self.balance(from);
        require!(b >= amount, "not enough PETRI");
        self.balances.insert(from.clone(), b - amount);
        self.credit(to, amount);
        emit_transfer(from, to, amount, memo);
    }
}
