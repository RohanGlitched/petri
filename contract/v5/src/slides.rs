//! Specimen slides: NFTs (NEP-171 core, NEP-177 metadata, NEP-178 approvals, NEP-181 enumeration) that fix a rectangle
//! of one colony's living cells at one generation.
//!
//! A colony mints a slide of its own cells only: rivals' cells inside the rectangle are left out. The PETRI it costs is
//! burned and the capture goes into the ledger, so both replays recompute it from the board. The image is drawn on chain
//! from the stored bitmap every time a wallet asks (`petri_core::slide_svg`), and the name comes from the colony at view
//! time. Owning or moving a slide changes nothing in the dish.
//!
//! Storage: the minter pays for everything the slide stores, plus `SLIDE_RESERVE` for whatever its later owners can add
//! (a longer account and a list of slides for an owner who had none), so no transfer can make the contract's storage
//! outgrow what was paid for it. Approvals are paid by the owner who grants them and refunded when they go.

use crate::*;
use near_sdk::GasWeight;
use std::collections::HashMap;

const MIN_SIDE: u16 = 4;
const MAX_SIDE: u16 = 32;
const MAX_TITLE_CHARS: usize = 40;
const MAX_TITLE_BYTES: usize = 160;
const MAX_APPROVALS: usize = 16;
/// Bytes each slide sets aside for its later owners: an owner of 64 characters (up to 62 bytes more than the shortest)
/// and a new entry in the owners' lists (at most 40 + 69 key bytes + 8 value bytes). Rounded up.
const SLIDE_RESERVE: u64 = 64 + 120;
/// Most slides one enumeration call returns: each carries its image.
const MAX_PAGE: u64 = 50;
const GAS_FOR_NFT_RESOLVE: Gas = Gas::from_tgas(15);
const GAS_FOR_NFT_ON_TRANSFER_MIN: Gas = Gas::from_tgas(10);

const SLIDE_ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='4' fill='%230b0705'/%3E%3Ccircle cx='12' cy='12' r='9.5' fill='%2324130a' stroke='%23f3e9da' stroke-opacity='.3' stroke-width='.6'/%3E%3Cg fill='%23f2b45a'%3E%3Crect x='9' y='6.5' width='2.6' height='2.6' rx='.7'/%3E%3Crect x='12.4' y='9.9' width='2.6' height='2.6' rx='.7'/%3E%3Crect x='5.6' y='13.3' width='2.6' height='2.6' rx='.7'/%3E%3Crect x='9' y='13.3' width='2.6' height='2.6' rx='.7'/%3E%3Crect x='12.4' y='13.3' width='2.6' height='2.6' rx='.7'/%3E%3C/g%3E%3C/svg%3E";

/// One slide as stored. The token id is its index plus one.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Slide {
    pub owner: AccountId,
    pub colony: u16,
    pub generation: u64,
    pub x: u16,
    pub y: u16,
    pub w: u8,
    pub h: u8,
    pub cells: u16,
    /// The colony's colour when the slide was minted.
    pub color: u32,
    pub title: Option<String>,
    /// `Dish::region_bitmap` of the rectangle.
    pub bitmap: Vec<u8>,
    pub minted_ms: u64,
    pub next_approval: u64,
    pub approvals: Vec<(AccountId, u64)>,
}

/// A slide as the `slides` views return it: everything but the image, which the browser draws from the bitmap.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct SlideView {
    pub token_id: String,
    pub owner_id: AccountId,
    pub colony: u16,
    /// The colony's name now.
    pub name: String,
    pub color: u32,
    pub generation: U64,
    pub x: u16,
    pub y: u16,
    pub w: u16,
    pub h: u16,
    pub cells: u32,
    pub title: Option<String>,
    pub bitmap: Base64VecU8,
    pub minted_ms: U64,
}

/// NEP-177 token metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct TokenMetadata {
    pub title: Option<String>,
    pub description: Option<String>,
    pub media: Option<String>,
    pub media_hash: Option<Base64VecU8>,
    pub copies: Option<u64>,
    pub issued_at: Option<String>,
    pub expires_at: Option<String>,
    pub starts_at: Option<String>,
    pub updated_at: Option<String>,
    pub extra: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

/// NEP-171 token.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Token {
    pub token_id: String,
    pub owner_id: AccountId,
    pub metadata: Option<TokenMetadata>,
    pub approved_account_ids: Option<HashMap<AccountId, u64>>,
}

/// NEP-177 contract metadata.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct NftContractMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub base_uri: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<Base64VecU8>,
}

fn nft_event(event: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({ "standard": "nep171", "version": "1.2.0", "event": event, "data": [data] }));
}

/// Borsh bytes one approval takes in a slide record (account length, account, approval id).
fn approval_bytes(account: &AccountId) -> u128 {
    12 + account.as_str().len() as u128
}

fn byte_cost() -> u128 {
    env::storage_byte_cost().as_yoctonear()
}

fn require_one_yocto() {
    require!(env::attached_deposit() == NearToken::from_yoctonear(1), "requires exactly 1 yoctoNEAR");
}

#[near]
impl Petri {
    /// Mint a specimen slide of this colony's own living cells inside the `w` × `h` rectangle at (`x`, `y`) (4 to 32
    /// cells a side, wrapping at the dish's edges), at the stored generation after catching up. It must capture at
    /// least `slide_min_cells` cells and costs `slide_cells_price` PETRI per cell, all burned (unclaimed earnings count
    /// towards it). Bring NEAR for the slide's storage (see `slide_deposit`), as `credit` from the colony's credit first
    /// and then attached; attached NEAR left over is sent back. `title` is up to 40 characters. Returns the token id.
    #[payable]
    pub fn mint_slide(&mut self, x: u16, y: u16, w: u16, h: u16, title: Option<String>, credit: Option<U128>) -> String {
        let account = caller();
        let id = self.colony_id(&account);
        require!((MIN_SIDE..=MAX_SIDE).contains(&w) && (MIN_SIDE..=MAX_SIDE).contains(&h), "a slide is 4 to 32 cells on each side");
        require!(x < self.rules.width && y < self.rules.height, "the slide's corner is off the dish");
        let title = title.map(|t| clean_text(&t, MAX_TITLE_CHARS, MAX_TITLE_BYTES, "a slide's title")).filter(|t| !t.is_empty());
        let attached = env::attached_deposit().as_yoctonear();
        self.catch_up(self.rules.max_catchup as u64);
        self.claim_petri(id, &account);
        let (bitmap, cells) = self.load_dish().region_bitmap(id, x, y, w, h);
        require!(cells >= self.rules.slide_min_cells, format!("a slide needs at least {} of your living cells; that rectangle holds {}", self.rules.slide_min_cells, cells));
        let cost = self.rules.slide_cells_price.0 * cells as u128;
        let balance = self.balance(&account);
        require!(balance >= cost, format!("a slide of {} cells costs {} PETRI; you hold {}", cells, fmt_petri(cost), fmt_petri(balance)));
        let before = env::storage_usage();
        self.burn(&account, cost, "specimen slide");
        self.slides_burned += cost;
        let index = self.slides.len();
        let token = index as u64 + 1;
        let color = self.colony(id).color;
        self.slides.push(Slide {
            owner: account.clone(),
            colony: id,
            generation: self.generation,
            x,
            y,
            w: w as u8,
            h: h as u8,
            cells: cells as u16,
            color,
            title: title.clone(),
            bitmap: bitmap.clone(),
            minted_ms: env::block_timestamp_ms(),
            next_approval: 0,
            approvals: Vec::new(),
        });
        self.add_owned(&account, index);
        self.ledger.push(Entry::Slide { generation: U64(self.generation), colony: id, token: U64(token), x, y, w, h, cells, bitmap: Base64VecU8(bitmap), cost: U128(cost) });
        self.flush();
        let storage = self.storage_cost_since(before) + SLIDE_RESERVE as u128 * byte_cost();
        let from_credit = self.take_credit(&account, Some(id), Some(U128(credit.map(|c| c.0).unwrap_or(0).min(storage))));
        require!(attached + from_credit >= storage, format!("this slide needs {} NEAR for its storage", fmt_near(storage)));
        let (refund, _) = split_after_storage(attached, from_credit, storage);
        if refund > 0 {
            let _ = Promise::new(account.clone()).transfer(NearToken::from_yoctonear(refund));
        }
        let token_id = token.to_string();
        nft_event("nft_mint", json!({ "owner_id": account, "token_ids": [token_id] }));
        emit("slide", json!({ "token": token_id, "colony": id, "generation": U64(self.generation), "x": x, "y": y, "w": w, "h": h, "cells": cells, "cost": U128(cost) }));
        token_id
    }

    /// The NEAR to bring to a slide of `w` × `h` with a title of `title_bytes` bytes: its storage, with room for a
    /// 64-character owner. What is not used is sent back.
    pub fn slide_deposit(&self, w: u16, h: u16, title_bytes: Option<u32>) -> U128 {
        let bitmap = (w as u64 * h as u64 + 7) / 8;
        // The slide record and its ledger entry (each with its key and the 40 bytes every record costs), the owner's
        // list, and the reserve.
        let bytes = 240 + 64 + 2 * bitmap + title_bytes.map(|b| b as u64 + 5).unwrap_or(0) + 120 + SLIDE_RESERVE;
        U128(bytes as u128 * byte_cost())
    }

    // ---------- NEP-171 ----------

    #[payable]
    pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>) {
        require_one_yocto();
        let sender = caller();
        let index = self.slide_index(&token_id);
        let (owner, approvals) = self.slide_transfer(&sender, &receiver_id, index, approval_id, memo);
        self.refund_approvals(&owner, &approvals);
    }

    #[payable]
    pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool> {
        require_one_yocto();
        let sender = caller();
        let index = self.slide_index(&token_id);
        let (owner, approvals) = self.slide_transfer(&sender, &receiver_id, index, approval_id, memo);
        // The receiver gets whatever gas is left once the resolve is provided for (the runtime shares it out); every
        // receipt also costs its own fees up front, hence the margin.
        let left = env::prepaid_gas().saturating_sub(env::used_gas());
        require!(left >= GAS_FOR_NFT_ON_TRANSFER_MIN.saturating_add(GAS_FOR_NFT_RESOLVE).saturating_add(Gas::from_tgas(15)), "more gas is required");
        // The approvals are refunded or restored once the receiver has answered.
        let approved: HashMap<AccountId, u64> = approvals.into_iter().collect();
        Promise::new(receiver_id.clone())
            .function_call_weight(
                "nft_on_transfer",
                json!({ "sender_id": sender, "previous_owner_id": owner, "token_id": token_id, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_NFT_ON_TRANSFER_MIN,
                GasWeight(1),
            )
            .then(Promise::new(env::current_account_id()).function_call_weight(
                "nft_resolve_transfer",
                json!({ "previous_owner_id": owner, "receiver_id": receiver_id, "token_id": token_id, "approved_account_ids": approved }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                GAS_FOR_NFT_RESOLVE,
                GasWeight(0),
            ))
            .into()
    }

    /// Returns true when the receiver kept the slide. If it asked to return it (or failed) and still owns it, the slide
    /// goes back to its previous owner with the approvals it had; otherwise those approvals are refunded.
    #[private]
    pub fn nft_resolve_transfer(&mut self, previous_owner_id: AccountId, receiver_id: AccountId, token_id: String, approved_account_ids: Option<HashMap<AccountId, u64>>) -> bool {
        only_self();
        let give_back = match env::promise_result_checked(0, 16) {
            Ok(v) => near_sdk::serde_json::from_slice::<bool>(&v).unwrap_or(true),
            Err(_) => true,
        };
        let old: Vec<(AccountId, u64)> = approved_account_ids.unwrap_or_default().into_iter().collect();
        let index = self.slide_index(&token_id);
        let mut slide = self.slides.get(index).cloned().unwrap();
        if !give_back || slide.owner != receiver_id {
            self.refund_approvals(&previous_owner_id, &old);
            return true;
        }
        let theirs = std::mem::replace(&mut slide.approvals, old);
        slide.owner = previous_owner_id.clone();
        self.slides.set(index, slide);
        self.remove_owned(&receiver_id, index);
        self.add_owned(&previous_owner_id, index);
        self.flush();
        nft_event("nft_transfer", json!({ "old_owner_id": receiver_id, "new_owner_id": previous_owner_id, "token_ids": [token_id], "memo": "returned" }));
        self.refund_approvals(&receiver_id, &theirs);
        false
    }

    pub fn nft_token(&self, token_id: String) -> Option<Token> {
        self.slide_index_of(&token_id).map(|i| self.slide_token(i))
    }

    // ---------- NEP-177 ----------

    pub fn nft_metadata(&self) -> NftContractMetadata {
        NftContractMetadata {
            spec: "nft-2.1.0".into(),
            name: "Petri specimens".into(),
            symbol: "SLIDE".into(),
            icon: Some(SLIDE_ICON.into()),
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }

    // ---------- NEP-178 ----------

    /// Let `account_id` transfer this slide. The deposit pays for the approval's storage (refunded when it goes); the
    /// rest comes back. With `msg`, `account_id` is told through `nft_on_approve`.
    #[payable]
    pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) -> Option<Promise> {
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit > 0, "requires at least 1 yoctoNEAR");
        let owner = env::predecessor_account_id();
        let index = self.slide_index(&token_id);
        let mut slide = self.slides.get(index).cloned().unwrap();
        require!(slide.owner == owner, "only the slide's owner can approve");
        let approval_id = slide.next_approval;
        slide.next_approval += 1;
        let cost = match slide.approvals.iter_mut().find(|(a, _)| *a == account_id) {
            Some(entry) => {
                entry.1 = approval_id;
                0
            }
            None => {
                require!(slide.approvals.len() < MAX_APPROVALS, "a slide has at most 16 approvals");
                slide.approvals.push((account_id.clone(), approval_id));
                approval_bytes(&account_id) * byte_cost()
            }
        };
        require!(deposit >= cost, format!("an approval needs {} NEAR for its storage", fmt_near(cost)));
        self.slides.set(index, slide);
        self.slides.flush();
        if deposit - cost > 1 {
            let _ = Promise::new(owner.clone()).transfer(NearToken::from_yoctonear(deposit - cost));
        }
        msg.map(|msg| {
            Promise::new(account_id).function_call_weight(
                "nft_on_approve",
                json!({ "token_id": token_id, "owner_id": owner, "approval_id": approval_id, "msg": msg }).to_string().into_bytes(),
                NearToken::from_yoctonear(0),
                Gas::from_tgas(0),
                GasWeight(1),
            )
        })
    }

    #[payable]
    pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId) {
        require_one_yocto();
        let owner = env::predecessor_account_id();
        let index = self.slide_index(&token_id);
        let mut slide = self.slides.get(index).cloned().unwrap();
        require!(slide.owner == owner, "only the slide's owner can revoke");
        let gone: Vec<(AccountId, u64)> = slide.approvals.iter().filter(|(a, _)| *a == account_id).cloned().collect();
        slide.approvals.retain(|(a, _)| *a != account_id);
        self.slides.set(index, slide);
        self.slides.flush();
        self.refund_approvals(&owner, &gone);
    }

    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: String) {
        require_one_yocto();
        let owner = env::predecessor_account_id();
        let index = self.slide_index(&token_id);
        let mut slide = self.slides.get(index).cloned().unwrap();
        require!(slide.owner == owner, "only the slide's owner can revoke");
        let gone = std::mem::take(&mut slide.approvals);
        self.slides.set(index, slide);
        self.slides.flush();
        self.refund_approvals(&owner, &gone);
    }

    pub fn nft_is_approved(&self, token_id: String, approved_account_id: AccountId, approval_id: Option<u64>) -> bool {
        let Some(index) = self.slide_index_of(&token_id) else { return false };
        let slide = self.slides.get(index).unwrap();
        slide.approvals.iter().any(|(a, id)| *a == approved_account_id && approval_id.map_or(true, |want| want == *id))
    }

    // ---------- NEP-181 ----------

    pub fn nft_total_supply(&self) -> U128 {
        U128(self.slides.len() as u128)
    }

    /// At most 50 slides a call, each with its image.
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0).unwrap_or(0).min(u32::MAX as u128) as u32;
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as u32;
        (from..self.slides.len().min(from.saturating_add(limit))).map(|i| self.slide_token(i)).collect()
    }

    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        U128(self.owned.get(&account_id).map(|v| v.len()).unwrap_or(0) as u128)
    }

    pub fn nft_tokens_for_owner(&self, account_id: AccountId, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        let from = from_index.map(|f| f.0).unwrap_or(0).min(u32::MAX as u128) as usize;
        let limit = limit.unwrap_or(MAX_PAGE).min(MAX_PAGE) as usize;
        self.owned.get(&account_id).map(|v| v.iter().skip(from).take(limit).map(|&i| self.slide_token(i)).collect()).unwrap_or_default()
    }

    // ---------- slides without their images, for the site ----------

    pub fn slides(&self, from: Option<u32>, limit: Option<u32>) -> Vec<SlideView> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(500);
        (from..self.slides.len().min(from.saturating_add(limit))).map(|i| self.slide_view(i)).collect()
    }

    pub fn slide(&self, token_id: String) -> Option<SlideView> {
        self.slide_index_of(&token_id).map(|i| self.slide_view(i))
    }

    pub fn slides_for(&self, account_id: AccountId, from: Option<u32>, limit: Option<u32>) -> Vec<SlideView> {
        let from = from.unwrap_or(0) as usize;
        let limit = limit.unwrap_or(100).min(500) as usize;
        self.owned.get(&account_id).map(|v| v.iter().skip(from).take(limit).map(|&i| self.slide_view(i)).collect()).unwrap_or_default()
    }
}

impl Petri {
    /// The slide index of a token id ("1" is the first slide), if it exists.
    fn slide_index_of(&self, token_id: &str) -> Option<u32> {
        // Only plain decimal ids: "01" or "+1" name no slide.
        if token_id.is_empty() || token_id.len() > 10 || !token_id.bytes().all(|b| b.is_ascii_digit()) || token_id.starts_with('0') {
            return None;
        }
        let n: u64 = token_id.parse().ok()?;
        (n >= 1 && n <= self.slides.len() as u64).then(|| (n - 1) as u32)
    }

    fn slide_index(&self, token_id: &str) -> u32 {
        self.slide_index_of(token_id).unwrap_or_else(|| env::panic_str("there is no slide with that id"))
    }

    /// Move slide `index` to `receiver`, by its owner or an approved account. Clears its approvals and returns them with
    /// the previous owner (the caller refunds or restores them).
    fn slide_transfer(&mut self, sender: &AccountId, receiver: &AccountId, index: u32, approval_id: Option<u64>, memo: Option<String>) -> (AccountId, Vec<(AccountId, u64)>) {
        let mut slide = self.slides.get(index).cloned().unwrap();
        let owner = slide.owner.clone();
        if *sender != owner {
            let approved = slide.approvals.iter().find(|(a, _)| a == sender).map(|(_, id)| *id);
            require!(approved.is_some(), "only the slide's owner or an approved account can transfer it");
            if let Some(want) = approval_id {
                require!(approved == Some(want), "that approval id is out of date");
            }
        }
        require!(*receiver != owner, "the slide already belongs to the receiver");
        require!(*receiver != env::current_account_id(), "the dish does not hold slides");
        let approvals = std::mem::take(&mut slide.approvals);
        slide.owner = receiver.clone();
        self.slides.set(index, slide);
        self.remove_owned(&owner, index);
        self.add_owned(receiver, index);
        self.flush();
        let mut ev = json!({ "old_owner_id": owner, "new_owner_id": receiver, "token_ids": [(index as u64 + 1).to_string()] });
        if *sender != owner {
            ev["authorized_id"] = json!(sender);
        }
        if let Some(m) = memo {
            ev["memo"] = json!(m);
        }
        nft_event("nft_transfer", ev);
        (owner, approvals)
    }

    /// Send `to` the storage `approvals` took, now that they are gone.
    fn refund_approvals(&self, to: &AccountId, approvals: &[(AccountId, u64)]) {
        let bytes: u128 = approvals.iter().map(|(a, _)| approval_bytes(a)).sum();
        if bytes > 0 {
            let _ = Promise::new(to.clone()).transfer(NearToken::from_yoctonear(bytes * byte_cost()));
        }
    }

    fn add_owned(&mut self, owner: &AccountId, index: u32) {
        let mut v = self.owned.get(owner).cloned().unwrap_or_default();
        v.push(index);
        self.owned.insert(owner.clone(), v);
    }

    fn remove_owned(&mut self, owner: &AccountId, index: u32) {
        let mut v = self.owned.get(owner).cloned().unwrap_or_default();
        v.retain(|&i| i != index);
        if v.is_empty() {
            self.owned.remove(owner);
        } else {
            self.owned.insert(owner.clone(), v);
        }
    }

    fn slide_view(&self, index: u32) -> SlideView {
        let s = self.slides.get(index).unwrap();
        SlideView {
            token_id: (index as u64 + 1).to_string(),
            owner_id: s.owner.clone(),
            colony: s.colony,
            name: self.colony(s.colony).name,
            color: s.color,
            generation: U64(s.generation),
            x: s.x,
            y: s.y,
            w: s.w as u16,
            h: s.h as u16,
            cells: s.cells as u32,
            title: s.title.clone(),
            bitmap: Base64VecU8(s.bitmap.clone()),
            minted_ms: U64(s.minted_ms),
        }
    }

    /// The NEP-171 token, with metadata built now: the image drawn from the bitmap, its hash, and the colony's name.
    fn slide_token(&self, index: u32) -> Token {
        use base64::Engine;
        let s = self.slides.get(index).unwrap();
        let id = index as u64 + 1;
        let name = self.colony(s.colony).name;
        let svg = petri_core::slide_svg(&s.bitmap, s.w as u16, s.h as u16, s.color, s.generation);
        let hash = env::sha256(svg.as_bytes());
        let media = format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg.as_bytes()));
        let titled = s.title.as_ref().map(|t| format!("\u{201c}{}\u{201d}. ", t)).unwrap_or_default();
        let description = format!(
            "{}{} living cells of {}, fixed at generation {} of the Petri dish: a {} \u{d7} {} slide at ({}, {}).",
            titled, s.cells, name, s.generation, s.w, s.h, s.x, s.y
        );
        let extra = json!({ "colony": s.colony, "generation": U64(s.generation), "x": s.x, "y": s.y, "w": s.w, "h": s.h, "cells": s.cells, "bitmap": Base64VecU8(s.bitmap.clone()) });
        Token {
            token_id: id.to_string(),
            owner_id: s.owner.clone(),
            metadata: Some(TokenMetadata {
                title: Some(format!("Specimen #{} \u{b7} {}", id, name)),
                description: Some(description),
                media: Some(media),
                media_hash: Some(Base64VecU8(hash)),
                copies: Some(1),
                issued_at: Some(s.minted_ms.to_string()),
                expires_at: None,
                starts_at: None,
                updated_at: None,
                extra: Some(extra.to_string()),
                reference: None,
                reference_hash: None,
            }),
            approved_account_ids: Some(s.approvals.iter().cloned().collect()),
        }
    }
}
