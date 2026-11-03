//! PETRI as a NEP-141 token (with NEP-148 metadata and a NEP-145 surface that wallets expect).
//!
//! The contract pays for every account's balance record, so `storage_balance_of` reports every account as
//! registered. To keep that from being abused, a transfer that creates a new balance record must move at least
//! one whole PETRI.

use crate::*;

const GAS_FOR_RESOLVE: Gas = Gas::from_tgas(10);
const GAS_FOR_ON_TRANSFER: Gas = Gas::from_tgas(25);
const ONE_PETRI: u128 = 1_000_000;

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

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='15' fill='%23E9DDB8' stroke='%235B3A1E' stroke-width='2'/%3E%3Crect x='10' y='10' width='5' height='5' fill='%237B2D8E'/%3E%3Crect x='15' y='15' width='5' height='5' fill='%237B2D8E'/%3E%3Crect x='10' y='20' width='5' height='5' fill='%237B2D8E'/%3E%3Crect x='15' y='20' width='5' height='5' fill='%237B2D8E'/%3E%3Crect x='20' y='15' width='5' height='5' fill='%23C8324A'/%3E%3C/svg%3E";

/// Launch mints the whole supply to the contract, which holds it as the agar.
pub(crate) fn emit_mint(owner: &AccountId, amount: u128, memo: &str) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_mint", "data": [{ "owner_id": owner, "amount": U128(amount), "memo": memo }] }));
}

pub(crate) fn emit_transfer_pub(from: &AccountId, to: &AccountId, amount: u128, memo: &str) {
    emit_transfer(from, to, amount, Some(memo));
}

/// One NEP-141 transfer entry per recipient, in events of at most 80 entries so each log stays well under 16 KB.
pub(crate) fn emit_transfers_from(from: &AccountId, to: &[(AccountId, u128)], memo: &str) {
    for chunk in to.chunks(80) {
        let data: Vec<_> = chunk
            .iter()
            .map(|(who, amount)| json!({ "old_owner_id": from, "new_owner_id": who, "amount": U128(*amount), "memo": memo }))
            .collect();
        log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": data }));
    }
}

pub(crate) fn emit_burn(owner: &AccountId, amount: u128, memo: &str) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_burn", "data": [{ "owner_id": owner, "amount": U128(amount), "memo": memo }] }));
}

fn emit_transfer(from: &AccountId, to: &AccountId, amount: u128, memo: Option<&str>) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep141", "version": "1.0.0", "event": "ft_transfer", "data": [{ "old_owner_id": from, "new_owner_id": to, "amount": U128(amount), "memo": memo }] }));
}

#[near]
impl Petri {
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo.as_deref());
    }

    #[payable]
    pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128> {
        require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
        require!(env::prepaid_gas() > GAS_FOR_ON_TRANSFER.saturating_add(GAS_FOR_RESOLVE), "more gas is required");
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo.as_deref());
        Promise::new(receiver_id.clone())
            .function_call(
                "ft_on_transfer",
                json!({ "sender_id": sender, "amount": amount, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_ON_TRANSFER,
            )
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "ft_resolve_transfer",
                    json!({ "sender_id": sender, "receiver_id": receiver_id, "amount": amount }).to_string().into_bytes(),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_RESOLVE,
                ),
            )
            .into()
    }

    #[private]
    pub fn ft_resolve_transfer(&mut self, sender_id: AccountId, receiver_id: AccountId, amount: U128) -> U128 {
        let unused = match env::promise_result_checked(0, 64) {
            Ok(v) => near_sdk::serde_json::from_slice::<U128>(&v).map(|u| u.0.min(amount.0)).unwrap_or(amount.0),
            Err(_) => amount.0,
        };
        if unused > 0 && receiver_id != env::current_account_id() {
            let held = self.balance(&receiver_id);
            let refund = unused.min(held);
            if refund > 0 {
                self.balances.insert(receiver_id.clone(), held - refund);
                self.credit(&sender_id, refund);
                emit_transfer(&receiver_id, &sender_id, refund, Some("refund"));
            }
            return U128(amount.0 - refund);
        }
        amount
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply())
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
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

    #[payable]
    pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance {
        let _ = (account_id, registration_only);
        let d = env::attached_deposit();
        if !d.is_zero() {
            let _ = Promise::new(env::predecessor_account_id()).transfer(d);
        }
        StorageBalance { total: U128(0), available: U128(0) }
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        let _ = account_id;
        Some(StorageBalance { total: U128(0), available: U128(0) })
    }

    pub fn storage_balance_bounds(&self) -> StorageBounds {
        StorageBounds { min: U128(0), max: Some(U128(0)) }
    }
}

impl Petri {
    fn internal_transfer(&mut self, from: &AccountId, to: &AccountId, amount: u128, memo: Option<&str>) {
        require!(amount > 0, "amount must be positive");
        require!(*to != env::current_account_id(), "PETRI goes back to the agar only by planting");
        require!(from != to, "sender and receiver are the same account");
        if self.balances.get(to).is_none() {
            require!(amount >= ONE_PETRI, "a transfer to a new holder must be at least 1 PETRI");
        }
        let b = self.balance(from);
        require!(b >= amount, "not enough PETRI");
        self.balances.insert(from.clone(), b - amount);
        self.credit(to, amount);
        emit_transfer(from, to, amount, memo);
    }
}
