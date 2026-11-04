//! The Petri dish on NEAR.
//!
//! One contract holds the dish, the clock, the ledger and the PETRI token. The rules are in `petri-core`; this file
//! stores state, keeps time, moves PETRI and NEAR, and enforces who may plant what. Parameters are fixed when the dish
//! starts (`new`, or `relaunch`, which starts it again from generation zero) and no method changes them while it runs.
//! Both are callable only through the contract account's own key (`relaunch` is private: only a transaction the account
//! signs itself can run it); once that key is deleted nobody can start the dish again or change a parameter.
//!
//! The economy:
//! - All PETRI is minted once into the agar (the contract's own reserve). The agar sells PETRI for NEAR at a price
//!   that rises as it empties, feeds a share of itself to living cells every generation (releasing it for at least
//!   `live_floor` counted cells), and buys PETRI back at half the curve's price, never above its share of the vault.
//! - Planting costs PETRI at a price that tracks what a cell earns (`siege_x` times that inside a rival's buffer); half
//!   is burned, half goes back to the agar. Planting also adds stake, which decays every tide.
//! - A colony is paid for at most `reach` living cells per cell of stake, so splitting into many colonies never earns
//!   more and holding ground means planting again now and then.
//! - NEAR players attach collects in the tide vault; NEAR from sponsored credit collects in a separate credit pool.
//!   Every `tide_every` generations part of each is paid out by what each colony earned since the last tide: the vault
//!   in NEAR, the credit pool as credit, so sponsored NEAR never turns into NEAR anyone can withdraw. A colony that has
//!   never put NEAR into the vault itself (a guest on sponsored credit) is paid its vault share, and its sales back to
//!   the agar, as credit too, so free play never yields NEAR. Credit won stays in the dish: it is spent before
//!   sponsored credit and no sponsor can take it back. Each sponsor's credit is kept apart, and a sponsor can take back
//!   only what it gave and the account has not spent.
//! - PETRI earned before a colony's first NEAR stays in the dish. A guest cannot send PETRI and takes no keeper pot;
//!   when it first attaches NEAR, what it earned, bought with credit or was paid in royalties until then is kept PETRI,
//!   and so is PETRI anyone buys with credit. Kept PETRI is spent first by plantings and slides, and while a colony
//!   holds any it cannot sell PETRI for NEAR, send PETRI or pay for a pact (`Colony::kept`, in every colony view). So neither a guest's earnings
//!   nor credit ever reach the vault's NEAR, however many guests one player runs.
//! - Colonies make pacts the dish enforces: one pays another PETRI for its promise not to plant within `pact_radius`
//!   of its living cells until a generation, and the contract refuses every planting that breaks it (`pacts`).
//! - The dish's own players (the house: its strains and its keepers) are never fed, take no share, never sell PETRI
//!   back, never hand PETRI to players and never take a tide bounty or the keeper pot: every PETRI they hold they bought
//!   with NEAR that goes to the other players. Anyone else whose transaction runs a tide gets a bounty. A tide with
//!   nobody to pay does not run at all.
//! - If nobody tends the dish for `max_lag` generations, the clock skips ahead instead of piling up work.
//! - Every NEAR and PETRI movement the replay needs is in one ordered ledger, so every number the solvency check uses
//!   can be recomputed from the ledger alone.
//! - A colony can fix a rectangle of its own living cells as a specimen slide, an NFT (NEP-171) whose image is drawn on
//!   chain from the captured cells. A slide is a pattern licence: planting its exact pattern elsewhere costs
//!   `slide_discount_bps` less, and anyone but its holder pays the holder `slide_royalty_bps` of that cost in PETRI.
//! - NEAR can also arrive as wNEAR (from NEAR Intents, so a player can pay with any token): the dish unwraps it and
//!   joins or buys for the account named in the transfer's message. Whatever cannot be used at once waits as pending
//!   NEAR with its order, which anyone can complete later (`settle_pending`) and its account can claim.
//! - Each colony's numbers live in cold pages and a hot table of the colonies alive or paid at the coming tide
//!   (`books`, at most `MAX_PLAYING` rows), so no call costs more as more colonies join.

use near_sdk::json_types::{Base64VecU8, U128, U64};
use near_sdk::serde_json::json;
use near_sdk::store::{LookupMap, LookupSet, Vector};
use near_sdk::{env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue};
use petri_core::{chain_due, chain_next, credit_share, decay_stake, feed_per_cell, feed_with, licensed_cost, petri_for_near, planting_cost, royalty, sell_back, tide_due_sparse, tide_split_sparse, ColonyId, Dish, PlantError, EMPTY, STAKE_UNIT};

mod books;
mod intents;
mod pacts;
mod relaunch;
mod slides;
mod token;

pub use books::{Books, Cold, Hot, HotTable, MAX_PLAYING};
pub use intents::{Order, PendingRec, PendingView};
pub use pacts::{Pact, PactView, MAX_PACTS, PACT_DEPOSIT};
pub use slides::Slide;

const BOARD_KEY: &[u8] = b"board";
const MAX_NAME_BYTES: usize = 24;
const MAX_NAME_CHARS: usize = 24;
const MAX_NOTE_BYTES: usize = 280;
const MAX_NOTE_CHARS: usize = 140;
/// Lab notes by ledger index (u32). The keys of everything per account (balances, colony ids, names, grants, slides
/// owned, pending NEAR), the cold pages, the hot table and the tide index use prefixes neither v5 nor v6 used, so
/// nothing an earlier version left behind can be read as v6.1 state (see `relaunch`).
const NOTE_PREFIX: &[u8] = b"N";
/// The tide index: ledger positions of Tide entries, packed `TIDE_PAGE` to a key (`V` + page number).
const TIDE_PREFIX: u8 = b'V';
const TIDE_PAGE: u64 = 256;
const MAX_HOUSE: usize = 16;
/// Storage a planting is charged for beyond its cells and note: the ledger entry's fixed part and the colony update.
const PLANT_STORAGE_BASE: u64 = 180;
/// A purchase's ledger entry, charged up front (it is 97 to 113 bytes with its key and record overhead).
const BUY_BYTES: u128 = 113;
/// A catch-up stops stepping once the call has used this much gas less what writing the hot table back and moving idle
/// rows out will cost, so a call stays under about 150 TGas on the real network with `GAS_RESERVE` left for the
/// caller's own work and its payouts; and never beyond its prepaid gas less the same. It always steps one generation.
const CATCHUP_GAS_LIMIT: Gas = Gas::from_tgas(110);
const GAS_RESERVE: Gas = Gas::from_tgas(40);
const GAS_FOR_PAYOUT_CHECK: Gas = Gas::from_tgas(15);
/// A sponsor may take back credit an account has not drawn on for this many generations (a day at 15 s).
const RECLAIM_AFTER: u64 = 5_760;
/// The least a sponsorship brings: it pays for its records and leaves real credit.
const MIN_SPONSOR: u128 = 10_000_000_000_000_000_000_000;
/// Most sponsors one account's credit can come from at once. A sponsor topping up its own credit always can.
const MAX_GRANTS: usize = 8;
/// Bytes each new sponsorship sets aside for the `Unsponsor` entry its sponsor may write later (two 64-character
/// accounts).
const UNSPONSOR_BYTES: u128 = 210;
/// Bytes a failed NEAR payout can need: its `Refund` entry and a new pending record for a 64-character account. A
/// payout that may be refunded is never smaller, so a refund always pays for itself.
const REFUND_BYTES: u128 = 97;
const PENDING_RECORD_BYTES: u128 = 142;
/// `by` of a tide run by a house account that has no colony (a keeper).
pub const HOUSE_RUNNER: u16 = u16::MAX;

/// What a NEAR payout was for, so a failed transfer is put back in the right place (see `on_payout`).
pub const PAYOUT_CLAIM: u8 = 0;
pub const PAYOUT_SALE: u8 = 1;
pub const PAYOUT_BOUNTY: u8 = 2;
pub const PAYOUT_UNSPONSOR: u8 = 3;
pub const PAYOUT_PENDING: u8 = 4;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Rules {
    pub width: u16,
    pub height: u16,
    pub generation_ms: U64,
    /// Every PETRI that will ever exist. All of it starts in the agar.
    pub max_supply: U128,
    /// Share of the agar fed to the living each generation, in parts per million.
    pub feed_ppm: u32,
    /// Share of each generation's feed set aside in the keeper pot, paid to the caller of any call that runs a
    /// generation (never the house, a keeper or a guest).
    pub keeper_bps: u16,
    /// A colony is paid for at most this many living cells per cell of stake.
    pub reach: u32,
    /// Share of a colony's stake that remains after each tide.
    pub stake_keep_bps: u16,
    /// Share of a planting's cost that is burned; the rest goes back into the agar.
    pub burn_bps: u16,
    /// A cell costs what an average cell earns in this many generations at today's feed.
    pub payback: u32,
    /// The lowest price of one cell, in PETRI units.
    pub min_cell_price: U128,
    /// The agar releases its ration for at least this many counted cells, and never more per cell; prices count at
    /// least this many too, so a cell earns what its price assumes even on a nearly empty dish.
    pub live_floor: u32,
    /// Launch price of one PETRI in yoctoNEAR. The agar sells at this × max_supply / agar.
    pub petri_price: U128,
    /// The least NEAR a colony brings when it joins (it buys PETRI and pays for the colony's storage).
    pub min_join: U128,
    /// NEAR per planted cell, on top of the storage the planting uses. It goes to the tide vault or the credit pool.
    pub cell_fee: U128,
    pub tide_every: u32,
    /// Share of the vault and of the credit pool paid out at each tide.
    pub tide_bps: u16,
    /// Share of each tide paid in NEAR to the caller whose transaction runs it, up to `max_bounty`.
    pub tide_bounty_bps: u16,
    pub max_bounty: U128,
    /// The agar buys PETRI back at this share of the curve's price.
    pub sell_bps: u16,
    /// The agar buys back at most this share of the vault between two tides.
    pub sell_cap_bps: u16,
    /// A planting inside a rival's buffer costs this many times the price.
    pub siege_x: u32,
    pub buffer: u16,
    pub max_plant_cells: u32,
    pub max_catchup: u32,
    /// When the stored dish is this many generations behind the clock, the clock skips ahead to `max_catchup` behind.
    pub max_lag: u32,
    /// The dish's own players (the keeper's strains). They play like anyone, but they are never fed, take no share of
    /// the tides and never sell: every PETRI they plant with, they buy with NEAR, and that NEAR goes to the other players.
    pub house: Vec<AccountId>,
    /// The dish's own keepers. Like the house, a keeper never takes a tide bounty or the keeper pot (they stay in the
    /// dish for the players) and never hands PETRI to a player.
    pub keepers: Vec<AccountId>,
    /// A specimen slide costs this many PETRI units per living cell it captures, all of it burned.
    pub slide_cells_price: U128,
    /// A slide must capture at least this many of the colony's own living cells.
    pub slide_min_cells: u32,
    /// A planting of a slide's exact pattern under its licence costs this share less.
    pub slide_discount_bps: u16,
    /// Anyone but the slide's holder pays the holder this share of a licensed planting's cost, in PETRI. A planter that
    /// has never attached NEAR pays it to the agar instead, so free play never hands PETRI to a holder who could sell it.
    pub slide_royalty_bps: u16,
    /// Only a slide that captured at least this many cells is a licence: smaller ones (blocks, blinkers, gliders, the
    /// common small oscillators) are keepsakes, so nobody can collect royalties on patterns everyone plants anyway.
    pub licence_min_cells: u32,
    /// A colony bound by a pact plants nowhere within this many cells (across or down) of the protected colony's cells.
    pub pact_radius: u16,
    /// A pact binds for at most this many generations from the one it is offered at.
    pub pact_max_gens: u32,
    /// The wNEAR contract (wrap.near on mainnet). wNEAR it sends with `ft_transfer_call` is unwrapped and joins or
    /// buys for the account its message names; any other token is refunded.
    pub wnear: Option<AccountId>,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Colony {
    pub id: u16,
    pub account: AccountId,
    pub name: String,
    /// 0xRRGGBB
    pub color: u32,
    /// One of the dish's own players: never fed, no share of the tides, never sells.
    pub house: bool,
    /// Where NEAR payouts go (tide winnings and sales), if not to the colony's own account. Only a colony that has
    /// attached NEAR can set it.
    pub payout: Option<AccountId>,
    pub joined_generation: U64,
    pub last_plant_generation: Option<U64>,
    pub cells_planted: U64,
    /// Everything paid for plantings (half of it burned, half returned to the agar), royalties not included.
    pub petri_spent: U128,
    pub petri_burned: U128,
    /// PETRI earned and already claimed into the balance. Unclaimed earnings are in `claimable`.
    pub petri_claimed: U128,
    /// PETRI sold back to the agar.
    pub petri_sold: U128,
    /// NEAR brought to the dish (attached or sponsored), storage included.
    pub near_paid: U128,
    /// NEAR won at the tides and claimed (with what the claims' records cost).
    pub near_claimed: U128,
    /// NEAR received for PETRI sold back (sales paid as credit are not counted here).
    pub near_sold: U128,
    /// Credit won at the tides: the credit pool's share, and the vault's share when the colony has never attached
    /// NEAR. Kept in the colony's books so a tide writes no colony record; the views fill it in.
    pub credit_won: U128,
    /// Started by a payment someone else made (wNEAR through NEAR Intents), so it has a neutral name and colour; its
    /// account may choose its own once (`rename`).
    pub proxy: bool,
    /// Has ever put NEAR into the vault itself (as its books say, for the tides). A guest has not: it is paid in credit
    /// and cannot send PETRI.
    pub attached: bool,
    /// PETRI that stays in the dish (spent first by plantings and slides): earned, bought with credit or paid to it as
    /// royalties before its first NEAR, and bought with credit since; a guest's unclaimed earnings count in the views.
    /// While it holds any, the colony cannot sell PETRI for NEAR, send PETRI or pay for a pact.
    pub kept: U64,
}

/// One sponsor's credit for an account, which only the account can spend in the dish.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Grant {
    pub sponsor: AccountId,
    pub amount: U128,
    /// When this sponsor last gave or the account last drew on this credit, in generations of the wall clock.
    pub at: U64,
}

/// A planting made under a specimen slide's licence.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Licence {
    pub token: U64,
    /// How many times the slide had changed hands when it was planted (see `Slide::moves`).
    pub moves: u32,
    /// The slide's holder, who was paid the royalty; none when the planter held it.
    pub holder: Option<AccountId>,
    /// In PETRI units.
    pub royalty: U64,
    /// The planter had never attached NEAR, so its royalty went to the agar, not to the holder.
    pub to_agar: bool,
}

/// One entry of the ledger: everything that changes the dish, the agar, the vault, the credit pool, the credit the
/// accounts hold, the NEAR owed to colonies or the pending NEAR, in order. Replaying it reproduces all of them. PETRI
/// amounts are u64 (all the PETRI there is fits), NEAR amounts u128; a Tide entry keeps only what a replay cannot work
/// out itself.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub enum Entry {
    Join { generation: U64, colony: u16 },
    /// `near` reached the vault and `credit` the credit pool, after this entry's storage (and, for a join, the colony's).
    /// `spent` is the credit the call took from the account in all, storage included.
    Buy { generation: U64, colony: u16, petri: U64, near: U128, credit: U128, spent: Option<U128> },
    /// `near` reached the vault and `credit` the credit pool, after the planting's storage; `spent` is the credit it
    /// took. `siege` marks a planting inside a rival's buffer. Cells are flat indices; a dish has at most 65,536 cells,
    /// so each fits in 16 bits. `licence` marks a planting of a slide's pattern: `cost` is then the discounted price.
    Plant { generation: U64, colony: u16, cells: Vec<u16>, cost: U64, near: U128, credit: U128, siege: bool, spent: Option<U128>, licence: Option<Licence> },
    /// `near` left the vault: `paid` to the seller and the rest for this entry's storage. `as_credit` marks a seller
    /// that has never attached NEAR, paid in credit instead.
    Sell { generation: U64, colony: u16, petri: U64, near: U128, paid: U128, as_credit: bool },
    /// Every `tide_every` generations, when some colony outside the house earned since the last tide: the history
    /// chain at that generation, the storage `bytes` this entry and its place in the tide index took, and `by`, the
    /// colony whose call ran the tide (0 for a caller without one, `HOUSE_RUNNER` for a keeper). Everything else follows
    /// from the ledger before it, and a replay works it out: `pay` = `tide_bps` of the vault; the bounty `tide_bounty_bps`
    /// of that (at most `max_bounty`; none for a house runner, whose bounty stays in the vault; as credit for a colony
    /// that never attached NEAR); the storage `bytes` at NEAR's byte price, at most what is left; and the rest split by
    /// the window between colonies, in NEAR they can claim or, for colonies that never attached NEAR, as credit; and
    /// `tide_bps` of the credit pool split the same way as credit. The `tide` event carries every one of those amounts.
    Tide { generation: U64, chain: String, bytes: u16, by: u16 },
    /// Nobody tended the dish for `max_lag` generations; the clock skipped `skipped` generations at this one.
    Skip { generation: U64, skipped: U64 },
    /// The NEAR payout of entry `of` (a `kind` of `PAYOUT_*`) could not be delivered: `near` came back, `storage` of it
    /// paid for this entry and any record it needed, and the rest went to the vault (a bounty) or became pending NEAR
    /// for the account it was for (everything else).
    Refund { generation: U64, colony: u16, kind: u8, of: U64, near: U128, storage: U128 },
    /// Specimen slide `token` captured `cells` of `colony`'s living cells in the `w` × `h` rectangle at (`x`, `y`) of
    /// the board as it stood here (see `Dish::region_bitmap`), and burned `cost` PETRI. `spent` is the credit that paid
    /// for its storage.
    Slide { generation: U64, colony: u16, token: U64, x: u16, y: u16, w: u16, h: u16, cells: u32, bitmap: Base64VecU8, cost: U64, spent: Option<U128> },
    /// `sponsor` gave `account` `amount` of credit (after the records' storage).
    Sponsor { generation: U64, account: AccountId, sponsor: AccountId, amount: U128 },
    /// `sponsor` took back `amount`, all that was left of what it gave `account`, and was sent it.
    Unsponsor { generation: U64, account: AccountId, sponsor: AccountId, amount: U128 },
    /// `colony` claimed: `petri` of earnings into its balance and `near` of its tide winnings, of which `paid` was sent
    /// and the rest paid for this entry.
    Claim { generation: U64, colony: u16, petri: U64, near: U128, paid: U128 },
    /// wNEAR that arrived for `account` became `near` of pending NEAR (after its records' storage).
    Pending { generation: U64, account: AccountId, near: U128 },
    /// `near` of `account`'s pending NEAR left it: `paid` (with the storage its record freed, less this entry's) was
    /// sent to the account, or spent on the join or purchase its order asked for.
    Unpend { generation: U64, account: AccountId, near: U128, paid: U128 },
    /// wNEAR too small to pay for a pending record went into the vault: `near` of it, after this entry's storage.
    Dust { generation: U64, near: U128 },
    /// `petri` of `account`'s PETRI was burned outside the dish: a forced unregistration, or the refund of a transfer
    /// whose sender had unregistered meanwhile.
    Burn { generation: U64, account: AccountId, petri: U64 },
    /// `from` offered `to` pact `pact`: `petri` PETRI, held until accepted, for not planting within `pact_radius` of
    /// `from`'s living cells before generation `until`.
    /// `spent` is the credit that paid for its storage.
    PactOffer { generation: U64, pact: u32, from: u16, to: u16, petri: U64, until: U64, spent: Option<U128> },
    /// The pact's `to` accepted it and was paid; it binds `to` until its `until`.
    PactAccept { generation: U64, pact: u32 },
    /// The pact ended: an offer withdrawn, declined or expired (its PETRI back to `from`), or an accepted pact past `until`.
    PactEnd { generation: U64, pact: u32 },
}

/// A planting as the `plants` view returns it, with its index in the ledger and its lab note if it has one.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PlantView {
    pub index: U64,
    pub generation: U64,
    pub colony: u16,
    pub cells: Vec<u16>,
    pub cost: U64,
    pub siege: bool,
    pub note: Option<String>,
    /// The slide whose licence it was planted under, if any.
    pub slide: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub generation: U64,
    pub chain: String,
}

#[near(serializers = [json])]
pub struct Claimable {
    pub petri: U128,
    pub near: U128,
}

/// What the contract holds in NEAR against what it owes. `surplus` is never negative while the books are right.
#[near(serializers = [json])]
pub struct Solvency {
    pub balance: U128,
    pub storage: U128,
    pub vault: U128,
    pub credit_pool: U128,
    pub credit_outstanding: U128,
    pub tides_owed: U128,
    /// NEAR waiting for accounts to claim (wNEAR that could not join or buy for them, and payouts that failed).
    pub pending: U128,
    /// wNEAR the contract holds and has not unwrapped yet, counted as NEAR it holds.
    pub wrapped: U128,
    pub surplus: U128,
    pub solvent: bool,
}

#[near(serializers = [json])]
pub struct DishState {
    pub generation: U64,
    pub due_generation: U64,
    pub epoch_ms: U64,
    pub now_ms: U64,
    pub chain: String,
    pub board_hash: String,
    pub total_live: u32,
    /// Cells the last feed counted: living cells of fed colonies, capped by reach. Prices are set against this.
    pub counted: u32,
    pub colonies: u16,
    /// Colonies with stake, whose numbers are in the hot table.
    pub playing: u32,
    pub ledger: U64,
    pub plants: U64,
    pub total_supply: U128,
    pub agar: U128,
    pub sold: U128,
    pub fed: U128,
    pub returned: U128,
    pub burned: U128,
    /// PETRI the agar has bought back.
    pub bought_back: U128,
    /// Earnings waiting to be claimed, across all colonies.
    pub unclaimed: U128,
    pub keeper_pot: U128,
    pub keeper_paid: U128,
    /// NEAR waiting in the tide vault, in yoctoNEAR.
    pub vault: U128,
    /// NEAR that reached the vault: attached by players, and wNEAR too small for a record of its own.
    pub near_in: U128,
    /// NEAR the tides made claimable (shares of colonies that have attached NEAR).
    pub near_tides: U128,
    /// The vault's tide shares paid as credit, to colonies that never attached NEAR. Counted in `credit_won` too.
    pub near_as_credit: U128,
    pub near_bounties: U128,
    pub near_sold: U128,
    /// Failed bounty payouts that went back to the vault.
    pub near_refunded: U128,
    /// NEAR tide winnings not yet claimed.
    pub tides_owed: U128,
    /// NEAR the agar may still pay for PETRI before the next tide.
    pub sell_left: U128,
    /// Sponsored NEAR waiting in the credit pool, and the totals that moved through credit: sponsored (`given`), won
    /// at the tides (from the credit pool and the vault), paid for sales by colonies that never attached NEAR
    /// (`sold`), spent in the dish (won or sponsored) and taken back by sponsors.
    pub credit_pool: U128,
    pub credit_in: U128,
    pub credit_given: U128,
    pub credit_spent: U128,
    pub credit_won: U128,
    pub credit_sold: U128,
    pub credit_reclaimed: U128,
    /// Tides that ran. A tide with nobody to pay is skipped and not counted.
    pub tides: U64,
    pub skipped: U64,
    pub house: Vec<u16>,
    /// Specimen slides minted, the PETRI they burned (counted in `burned` too) and the royalties their holders were
    /// paid.
    pub slides: U64,
    pub slides_burned: U128,
    pub royalties: U128,
    /// NEAR waiting for accounts to claim, wNEAR held and not yet unwrapped, and how much of that is being unwrapped.
    pub pending: U128,
    pub wrapped: U128,
    pub unwrapping: U128,
    /// Whether the dish is registered on the wNEAR contract.
    pub wnear_ready: bool,
    /// Pacts offered so far, and the PETRI held for offers not yet accepted (counted in what the dish holds).
    pub pacts: U64,
    pub pact_escrow: U128,
    /// What one cell costs to plant right now, in PETRI units.
    pub cell_price: U128,
    /// What one PETRI costs from the agar right now, in yoctoNEAR.
    pub petri_price: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Petri {
    rules: Rules,
    epoch_ms: u64,
    generation: u64,
    chain: [u8; 32],
    total_live: u32,
    /// Cells the last feed counted (capped weights of fed colonies). Prices are set against this.
    counted: u32,
    colonies: Vector<Colony>,
    colony_of: LookupMap<AccountId, u16>,
    names: LookupSet<String>,
    ledger: Vector<Entry>,
    plant_count: u64,
    plant_index: Vector<u32>,
    balances: LookupMap<AccountId, u128>,
    /// Each account's sponsored credit, one grant per sponsor, oldest first.
    grants: LookupMap<AccountId, Vec<Grant>>,
    house: Vec<u16>,
    /// PETRI still in the agar (held by the contract itself).
    agar: u128,
    sold: u128,
    fed: u128,
    returned: u128,
    burned: u128,
    bought_back: u128,
    unclaimed: u128,
    keeper_pot: u128,
    keeper_paid: u128,
    vault: u128,
    near_in: u128,
    near_tides: u128,
    near_as_credit: u128,
    near_bounties: u128,
    near_sold: u128,
    near_refunded: u128,
    tides_owed: u128,
    sell_left: u128,
    credit_pool: u128,
    credit_in: u128,
    credit_given: u128,
    credit_spent: u128,
    credit_won: u128,
    credit_sold: u128,
    credit_reclaimed: u128,
    tides: u64,
    skipped: u64,
    slides: Vector<Slide>,
    /// Each owner's slides by index, for the enumeration views.
    owned: LookupMap<AccountId, Vec<u32>>,
    slides_burned: u128,
    royalties: u128,
    /// NEAR an account can claim (and the order it may still be spent on).
    pending: LookupMap<AccountId, PendingRec>,
    pending_owed: u128,
    /// wNEAR held and owed, not yet unwrapped (normally only while an unwrap is under way), and how much of it is
    /// being unwrapped right now.
    wrapped: u128,
    unwrapping: u128,
    wnear_ready: bool,
    /// Pacts offered so far (each under `P` + its number, with each colony's list of the pacts it is party to that have
    /// not ended under `Q` + its id; see `pacts`), and the PETRI held for offers not yet accepted.
    pact_count: u32,
    pact_escrow: u128,
    /// The hot table, loaded at most once per call (see `books`). Never stored with the state.
    #[borsh(skip)]
    hot: Option<HotTable>,
}

#[near]
impl Petri {
    #[init]
    pub fn new(rules: Rules) -> Self {
        Self::launch(rules)
    }

    // ---------- credit ----------

    /// Give `account_id` the attached NEAR (at least 0.01) as credit it can spend only in the dish (joining, buying,
    /// planting, slides). The account can never withdraw it; this sponsor alone may take back what is left of it once
    /// the account has not drawn on it for a day (`unsponsor`). Each sponsor's credit is kept apart, and an account
    /// spends what it won first, then its sponsors' credit oldest first. The site's relayer sponsors its guests this
    /// way, so it never has to attach deposits to calls it relays. Returns this sponsor's credit for the account.
    #[payable]
    pub fn sponsor(&mut self, account_id: AccountId) -> U128 {
        let deposit = env::attached_deposit().as_yoctonear();
        let sponsor = env::predecessor_account_id();
        require!(account_id != env::current_account_id(), "the dish does not hold credit for itself");
        require!(deposit >= MIN_SPONSOR, format!("sponsoring takes at least {} NEAR", fmt_near(MIN_SPONSOR)));
        let now = U64(self.clock());
        let before = env::storage_usage();
        let mut grants = self.grants.get(&account_id).cloned().unwrap_or_default();
        let i = match grants.iter().position(|g| g.sponsor == sponsor) {
            Some(i) => i,
            None => {
                require!(grants.len() < MAX_GRANTS, format!("this account already has credit from {} sponsors", MAX_GRANTS));
                grants.push(Grant { sponsor: sponsor.clone(), amount: U128(0), at: now });
                grants.len() - 1
            }
        };
        let fresh = grants[i].amount.0 == 0;
        self.grants.insert(account_id.clone(), grants.clone());
        let index = self.ledger.len();
        // Records have the same size whatever the amounts, so the storage is known before they are.
        self.ledger.push(Entry::Sponsor { generation: U64(self.generation), account: account_id.clone(), sponsor: sponsor.clone(), amount: U128(0) });
        self.flush();
        let storage = self.storage_cost_since(before) + if fresh { UNSPONSOR_BYTES * byte_cost() } else { 0 };
        require!(deposit > storage, format!("sponsoring needs more than the {} NEAR its records cost", fmt_near(storage)));
        let amount = deposit - storage;
        grants[i].amount = U128(grants[i].amount.0 + amount);
        grants[i].at = now;
        let total = grants[i].amount;
        self.grants.insert(account_id.clone(), grants);
        self.ledger.set(index, Entry::Sponsor { generation: U64(self.generation), account: account_id.clone(), sponsor: sponsor.clone(), amount: U128(amount) });
        self.flush();
        self.credit_given += amount;
        emit("sponsor", json!({ "account": account_id, "sponsor": sponsor, "near": U128(amount) }));
        total
    }

    /// Take back what is left of the credit the caller gave `account_id`, once the account has not drawn on it for
    /// `RECLAIM_AFTER` generations. Only that: other sponsors' credit and what the account won stay its own.
    pub fn unsponsor(&mut self, account_id: AccountId) -> U128 {
        let sponsor = env::predecessor_account_id();
        let mut grants = self.grants.get(&account_id).cloned().unwrap_or_default();
        let i = grants.iter().position(|g| g.sponsor == sponsor).unwrap_or_else(|| env::panic_str("there is no credit of yours left on that account"));
        require!(self.clock() >= grants[i].at.0 + RECLAIM_AFTER, "that credit was given or used in the last day");
        let g = grants.remove(i);
        if grants.is_empty() {
            self.grants.remove(&account_id);
        } else {
            self.grants.insert(account_id.clone(), grants);
        }
        self.credit_reclaimed += g.amount.0;
        let index = self.ledger.len() as u64;
        // Its storage was set aside when the sponsorship began.
        self.ledger.push(Entry::Unsponsor { generation: U64(self.generation), account: account_id.clone(), sponsor: sponsor.clone(), amount: g.amount });
        self.flush();
        emit("unsponsor", json!({ "account": account_id, "sponsor": sponsor, "near": g.amount }));
        self.pay_out(&sponsor, PAYOUT_UNSPONSOR, index, 0, &sponsor, g.amount.0);
        g.amount
    }

    // ---------- the dish ----------

    /// Join the dish as a colony, once per account. The NEAR it brings (the attached deposit plus `credit` from its
    /// won and sponsored credit) pays for the colony's storage and the rest buys PETRI from the agar; attached NEAR goes
    /// to the tide vault and credit to the credit pool.
    #[payable]
    pub fn join(&mut self, name: String, color: u32, credit: Option<U128>) -> Colony {
        let account = caller();
        let name = chosen_name(&name);
        let attached = env::attached_deposit().as_yoctonear();
        let from_credit = self.take_credit(&account, None, credit);
        self.join_with(account, name, color, attached, from_credit, false)
    }

    /// Choose the name and colour, once, for a colony someone else paid to start (see `Colony::proxy`).
    pub fn rename(&mut self, name: String, color: u32) -> Colony {
        let account = caller();
        let id = self.colony_id(&account);
        let mut c = self.colony(id);
        require!(c.proxy, "only a colony someone else started can be renamed, and only once");
        let name = chosen_name(&name);
        let key = name.to_lowercase();
        let old = c.name.to_lowercase();
        require!(key == old || !self.names.contains(&key), "a colony with that name already exists");
        require!(color <= 0xFF_FF_FF, "color must be 0xRRGGBB");
        self.names.remove(&old);
        self.names.insert(key);
        c.name = name.clone();
        c.color = color;
        c.proxy = false;
        self.colonies.set(id as u32 - 1, c);
        self.flush();
        emit("rename", json!({ "colony": id, "name": name, "color": color }));
        self.colony_view(id)
    }

    /// Join for `account` under `name` (already checked) with `attached` NEAR it brought and `from_credit` already
    /// taken from its credit. Both a call from the account and wNEAR paid for it come here. `proxy` marks a colony
    /// someone else paid for.
    pub(crate) fn join_with(&mut self, account: AccountId, name: String, color: u32, attached: u128, from_credit: u128, proxy: bool) -> Colony {
        require!(self.colony_of.get(&account).is_none(), "this account already has a colony");
        let key = name.to_lowercase();
        require!(!self.names.contains(&key), "a colony with that name already exists");
        require!(color <= 0xFF_FF_FF, "color must be 0xRRGGBB");
        require!(self.colonies.len() < u16::MAX as u32 - 1, "the dish is full of colonies");
        let deposit = attached + from_credit;
        require!(deposit >= self.rules.min_join.0, format!("joining needs at least {} NEAR", fmt_near(self.rules.min_join.0)));
        self.catch_up_by(self.rules.max_catchup as u64, &account);
        let before = env::storage_usage();
        let id = (self.colonies.len() + 1) as u16;
        let house = self.is_house(&account);
        let colony = Colony {
            id,
            account: account.clone(),
            name: name.clone(),
            color,
            house,
            payout: None,
            joined_generation: U64(self.generation),
            last_plant_generation: None,
            cells_planted: U64(0),
            petri_spent: U128(0),
            petri_burned: U128(0),
            petri_claimed: U128(0),
            petri_sold: U128(0),
            near_paid: U128(deposit),
            near_claimed: U128(0),
            near_sold: U128(0),
            credit_won: U128(0),
            proxy,
            attached: false,
            kept: U64(0),
        };
        self.colonies.push(colony);
        self.colony_of.insert(account.clone(), id);
        self.names.insert(key);
        if house {
            self.house.push(id);
        }
        if !self.balances.contains_key(&account) {
            self.balances.insert(account.clone(), 0);
        }
        self.ledger.push(Entry::Join { generation: U64(self.generation), colony: id });
        // One slot at the end of the last page: a join costs the same however many colonies came before.
        books::cold_push(id);
        self.flush();
        // The purchase below adds one more ledger entry; charge for it up front.
        let storage = self.storage_cost_since(before) + BUY_BYTES * byte_cost();
        require!(deposit > storage, format!("joining needs more than the {} NEAR its storage costs", fmt_near(storage)));
        let (near, cred) = split_after_storage(attached, from_credit, storage);
        let bought = self.sell_petri(id, &account, near, cred, from_credit, true);
        self.flush();
        emit("join", json!({ "colony": id, "account": account, "name": name, "color": color, "house": house, "generation": U64(self.generation), "petri": U128(bought), "proxy": proxy }));
        // A new colony has won nothing yet.
        self.colony(id)
    }

    /// Buy PETRI from the agar with the attached NEAR plus `credit` from the colony's credit. The price rises as the agar
    /// empties; the NEAR goes to the tide vault and the credit to the credit pool, less the purchase record's storage.
    #[payable]
    pub fn buy(&mut self, credit: Option<U128>) -> U128 {
        let account = caller();
        let id = self.colony_id(&account);
        let attached = env::attached_deposit().as_yoctonear();
        let from_credit = self.take_credit(&account, Some(id), credit);
        U128(self.buy_with(&account, attached, from_credit))
    }

    /// A purchase for colony account `account` with `attached` NEAR it brought and `from_credit` taken from its credit.
    pub(crate) fn buy_with(&mut self, account: &AccountId, attached: u128, from_credit: u128) -> u128 {
        let id = self.colony_id(account);
        let deposit = attached + from_credit;
        // The purchase's ledger entry is charged to the buyer.
        let storage = BUY_BYTES * byte_cost();
        require!(deposit > storage, format!("a purchase needs more than the {} NEAR its record costs", fmt_near(storage)));
        self.catch_up_by(self.rules.max_catchup as u64, account);
        let mut c = self.colony(id);
        c.near_paid = U128(c.near_paid.0 + deposit);
        self.colonies.set(id as u32 - 1, c);
        let (near, cred) = split_after_storage(attached, from_credit, storage);
        let units = self.sell_petri(id, account, near, cred, from_credit, false);
        self.flush();
        units
    }

    /// Sell `petri` units back to the agar for NEAR from the vault, at `sell_bps` of the curve's price and never more
    /// than those units' share of the vault. Between two tides the agar buys back at most `sell_cap_bps` of the vault.
    /// A colony that has never attached NEAR is paid in credit it can spend only in the dish. The house never sells.
    pub fn sell(&mut self, petri: U128) -> U128 {
        let account = caller();
        let id = self.colony_id(&account);
        let c = self.colonies.get(id as u32 - 1).unwrap();
        require!(!c.house, "the dish's own colonies never sell PETRI back: the vault is the players'");
        let units = petri.0;
        require!(units > 0, "sell at least some PETRI");
        // A colony that has attached NEAR sells for NEAR, and only once it holds no kept PETRI.
        if c.attached {
            require!(c.kept.0 == 0, kept_text(c.kept.0, "sell PETRI for NEAR"));
        }
        self.catch_up(self.rules.max_catchup as u64);
        // Its earnings count towards the sale (a guest's become kept PETRI, as everything it earns does).
        self.claim_petri(id, &account);
        // Read after the catch-up, which may have paid the keeper pot into it.
        let held = self.balance(&account);
        require!(held >= units, format!("you hold {} PETRI", fmt_petri(held)));
        let near = self.sell_quote(petri).0;
        require!(near > 0, "that is too little PETRI to buy back");
        require!(near <= self.sell_left, format!("the agar buys back at most {} NEAR more before the next tide", fmt_near(self.sell_left)));
        let as_credit = !self.books(id).attached;
        let before = env::storage_usage();
        self.balances.insert(account.clone(), held - units);
        self.agar += units;
        self.bought_back += units;
        token::emit_transfer_pub(&account, &env::current_account_id(), units, "sold back to the agar");
        let index = self.ledger.len();
        self.ledger.push(Entry::Sell { generation: U64(self.generation), colony: id, petri: U64(units as u64), near: U128(near), paid: U128(0), as_credit });
        self.flush();
        let storage = self.storage_cost_since(before);
        // A NEAR payout must also be able to pay for its refund, should the transfer fail.
        let reserve = if as_credit { 0 } else { (REFUND_BYTES + PENDING_RECORD_BYTES) * byte_cost() };
        require!(near > storage + reserve, "that is too little PETRI to cover the sale's record");
        let paid = near - storage;
        self.ledger.set(index, Entry::Sell { generation: U64(self.generation), colony: id, petri: U64(units as u64), near: U128(near), paid: U128(paid), as_credit });
        self.vault -= near;
        self.sell_left -= near;
        let mut c = self.colony(id);
        c.petri_sold = U128(c.petri_sold.0 + units);
        if as_credit {
            // The NEAR stays in the dish as credit only this colony can spend; the PETRI sold leaves its kept PETRI.
            c.kept = U64(c.kept.0.saturating_sub(units as u64));
            self.update_books(id, |b| b.won += paid);
            self.credit_sold += paid;
            self.colonies.set(id as u32 - 1, c);
            self.flush();
            emit("sell", json!({ "colony": id, "petri": petri, "credit": U128(paid) }));
            return U128(paid);
        }
        self.near_sold += paid;
        c.near_sold = U128(c.near_sold.0 + paid);
        let to = c.payout.clone().unwrap_or(account.clone());
        self.colonies.set(id as u32 - 1, c);
        self.flush();
        emit("sell", json!({ "colony": id, "petri": petri, "near": U128(paid) }));
        self.pay_out(&to, PAYOUT_SALE, index as u64, id, &account, paid);
        U128(paid)
    }

    /// Bring cells to life. `cells` are flat indices (`y * width + x`). `note` is an optional lab note (up to 140
    /// characters) stored with the planting. Bring NEAR for the storage the planting uses plus `cell_fee` per cell
    /// (see `plant_deposit`), attached or as `credit` from the colony's credit; what is left after storage goes to the
    /// vault or the credit pool. A planting with a cell inside a rival's buffer is a siege and costs `siege_x` times the
    /// price.
    ///
    /// With `slide` (a token id), the cells must be exactly that specimen slide's pattern moved to a new place, and the
    /// slide must have captured at least `licence_min_cells` cells: the planting is made under the slide's licence and
    /// costs `slide_discount_bps` less. A planter that does not hold the slide also pays `slide_royalty_bps` of that cost
    /// in PETRI: to the holder, or to the agar if the planter has never attached NEAR (free play hands no holder PETRI it
    /// could sell). The discount is the licence's whole perk, and it is the same for everyone: it rewards planting a
    /// proven pattern on any ground, while the siege surcharge (the only defence ground has) still applies in full, so a
    /// licence never makes a rival's ground cheap to take.
    ///
    /// A colony that is not playing yet (no row in the hot table) cannot plant while `MAX_PLAYING` colonies play and
    /// none of them can leave the table: it waits for the next tide.
    #[payable]
    pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>, credit: Option<U128>, slide: Option<String>) -> U64 {
        let account = caller();
        let note = note.map(|n| clean_note(&n)).filter(|n| !n.is_empty());
        let id = self.colony_id(&account);
        // Cheap checks first, so a planting that cannot succeed fails before it pays for any catch-up.
        require!(!cells.is_empty() && cells.len() as u32 <= self.rules.max_plant_cells, format!("plant 1 to {} cells", self.rules.max_plant_cells));
        let size = self.rules.width as u32 * self.rules.height as u32;
        require!(cells.iter().all(|&c| c < size), "a cell is off the dish");
        let licensed = slide.as_ref().map(|t| self.slide_index(t));
        if let Some(i) = licensed {
            let s = self.slides.get(i).unwrap();
            require!(s.cells as u32 >= self.rules.licence_min_cells, format!("slide {} captured {} cells; only a slide of at least {} cells is a licence", i + 1, s.cells, self.rules.licence_min_cells));
            require!(petri_core::fits_slide(self.rules.width, self.rules.height, &cells, &s.bitmap, s.w as u16, s.h as u16), "those cells are not the slide's pattern: plant exactly its cells, moved anywhere but not turned");
        }
        let fee = self.rules.cell_fee.0 * cells.len() as u128;
        let attached = env::attached_deposit().as_yoctonear();
        let from_credit = self.take_credit(&account, Some(id), credit);
        let deposit = attached + from_credit;
        require!(deposit >= fee, format!("planting {} cells needs at least {} NEAR", cells.len(), fmt_near(self.plant_deposit(cells.len() as u32, note.as_ref().map(|n| n.len() as u32), slide.clone()).0)));
        self.catch_up(self.rules.max_catchup as u64);
        require!(self.generation == self.due_generation(), "the dish is behind the clock; call advance first");
        // Earnings waiting for this colony count towards the price.
        self.claim_petri(id, &account);
        let mut colony = self.colony(id);
        if let Some(last) = colony.last_plant_generation {
            require!(last.0 < self.generation, "one planting per generation; wait for the next one");
        }
        let mut dish = self.load_dish();
        let check = match dish.check_plant(id, &cells, self.rules.buffer, self.rules.max_plant_cells, &self.house) {
            Ok(c) => c,
            Err(e) => env::panic_str(&plant_error_text(&dish, e)),
        };
        // A colony bound by pacts plants nowhere near the colonies they protect.
        self.check_pacts(id, &dish, &cells);
        // A colony that is not playing yet needs room in the hot table: rows that may leave make it first.
        if !colony.house && self.hot_table().get(id).is_none() && self.hot_table().rows.len() >= MAX_PLAYING {
            let alive = alive_colonies(&dish);
            let (reach, tides) = (self.rules.reach, self.tides);
            let hot = self.hot_table();
            if hot.flush_idle(&alive, reach, tides, books::FLUSH_MAX) > 0 {
                hot.store();
            }
            require!(self.hot_table().rows.len() < MAX_PLAYING, format!("{} colonies are playing at once, the most the dish holds; plant again after the next tide", MAX_PLAYING));
        }
        // Whether this colony had attached NEAR before this planting: if it never had, its royalty goes to the agar.
        let guest = !self.books(id).attached;
        let base = self.cell_cost(cells.len() as u32, check.siege);
        let (cost, holder, toll) = match licensed {
            None => (base, None, 0),
            Some(i) => {
                let s = self.slides.get(i).unwrap();
                let cost = licensed_cost(base, self.rules.slide_discount_bps);
                if s.owner == account {
                    (cost, None, 0)
                } else {
                    require!(!colony.house, "the house plants only slides it holds: its PETRI never goes to players");
                    (cost, Some(s.owner.clone()), royalty(cost, self.rules.slide_royalty_bps))
                }
            }
        };
        let balance = self.balance(&account);
        require!(
            balance >= cost + toll,
            format!("planting {} cells{} costs {} PETRI{}; you hold {}", cells.len(), if check.siege { " inside a rival's buffer" } else { "" }, fmt_petri(cost), if toll > 0 { format!(" and a {} PETRI royalty", fmt_petri(toll)) } else { String::new() }, fmt_petri(balance))
        );
        let before = env::storage_usage();
        let burn = cost * self.rules.burn_bps as u128 / 10_000;
        self.burn(&account, burn, "planting");
        let back = cost - burn;
        if back > 0 {
            let held = self.balance(&account);
            self.balances.insert(account.clone(), held - back);
            self.agar += back;
            self.returned += back;
            token::emit_transfer_pub(&account, &env::current_account_id(), back, "planting feeds the agar");
        }
        // A royalty to a holder with no PETRI registration registers it at the planter's expense, at the full NEP-145
        // price its unregistering would refund.
        let mut registration = 0u128;
        let licence = match (licensed, holder) {
            (None, _) => None,
            (Some(i), holder) => {
                let mut s = self.slides.get(i).cloned().unwrap();
                let to_agar = holder.is_some() && guest;
                if let Some(h) = &holder {
                    if toll > 0 {
                        let held = self.balance(&account);
                        self.balances.insert(account.clone(), held - toll);
                        if to_agar {
                            // Free play pays its royalty back into the agar: no holder can sell PETRI a guest earned.
                            self.agar += toll;
                            self.returned += toll;
                            token::emit_transfer_pub(&account, &env::current_account_id(), toll, "slide royalty, to the agar: the planter never attached NEAR");
                        } else {
                            // A royalty paid to a guest is PETRI it earned before its first NEAR: kept.
                            if let Some(&hid) = self.colony_of.get(h) {
                                let mut hc = self.colony(hid);
                                if !hc.attached {
                                    hc.kept = U64(hc.kept.0 + toll as u64);
                                    self.colonies.set(hid as u32 - 1, hc);
                                }
                            }
                            let fresh = !self.balances.contains_key(h);
                            let reg_before = env::storage_usage();
                            self.credit(h, toll);
                            self.balances.flush();
                            if fresh {
                                registration = (token::ACCOUNT_STORAGE as u64).saturating_sub(env::storage_usage() - reg_before) as u128 * byte_cost();
                            }
                            token::emit_transfer_pub(&account, h, toll, "slide royalty");
                            s.royalties += toll;
                            self.royalties += toll;
                        }
                    }
                }
                let moves = s.moves;
                self.slides.set(i, s);
                Some(Licence { token: U64(i as u64 + 1), moves, holder, royalty: U64(toll as u64), to_agar })
            }
        };
        dish.plant_unchecked(id, &cells);
        self.store_dish(&dish);
        self.total_live += cells.len() as u32;
        // A colony that plants plays: its numbers move into the hot table if they are not there yet. The house is never
        // fed and takes no share, so its stake stays in its cold slot.
        let added = cells.len() as u64 * STAKE_UNIT;
        let (tides, keep) = (self.tides, self.rules.stake_keep_bps);
        if colony.house {
            let mut c = books::cold_get(id);
            c.stake = c.stake_at(tides, keep) + added;
            c.stake_tide = tides as u32;
            books::cold_set_many(&[(id, c)]);
        } else {
            self.hot_table().enter(id, tides, keep).stake += added;
        }
        colony.last_plant_generation = Some(U64(self.generation));
        colony.cells_planted = U64(colony.cells_planted.0 + cells.len() as u64);
        colony.petri_spent = U128(colony.petri_spent.0 + cost);
        colony.petri_burned = U128(colony.petri_burned.0 + burn);
        // Kept PETRI is spent first, royalty included.
        colony.kept = U64(colony.kept.0.saturating_sub((cost + toll) as u64));
        colony.near_paid = U128(colony.near_paid.0 + deposit);
        let index = self.ledger.len() as u64;
        if let Some(n) = &note {
            env::storage_write(&note_key(index), n.as_bytes());
        }
        let short: Vec<u16> = cells.iter().map(|&c| c as u16).collect();
        let spent = (from_credit > 0).then_some(U128(from_credit));
        let zero = U128(0);
        // The pools' shares are fixed once the storage is known; the entry has the same size either way.
        self.ledger.push(Entry::Plant { generation: U64(self.generation), colony: id, cells: short.clone(), cost: U64(cost as u64), near: zero, credit: zero, siege: check.siege, spent, licence: licence.clone() });
        self.plant_index.push(index as u32);
        self.plant_count += 1;
        self.colonies.set(id as u32 - 1, colony);
        self.flush();
        let storage = self.storage_cost_since(before) + registration;
        require!(deposit >= storage + fee, format!("this planting needs {} NEAR for its storage and fee", fmt_near(storage + fee)));
        let (near, cred) = split_after_storage(attached, from_credit, storage);
        self.ledger.set(index as u32, Entry::Plant { generation: U64(self.generation), colony: id, cells: short, cost: U64(cost as u64), near: U128(near), credit: U128(cred), siege: check.siege, spent, licence: licence.clone() });
        self.attach(id, near);
        self.vault += near;
        self.near_in += near;
        self.credit_pool += cred;
        self.credit_in += cred;
        self.flush();
        emit("plant", json!({ "colony": id, "generation": U64(self.generation), "cells": cells.len(), "cost": U128(cost), "siege": check.siege, "near": U128(deposit), "note": note, "slide": slide, "royalty": U128(toll) }));
        U64(self.generation)
    }

    /// Catch up to `max` due generations (capped at `max_catchup`). Like every call that catches up, if it ran at least
    /// one generation the keeper pot goes to the caller when it is registered for PETRI and is not one of the house's,
    /// and tides it runs pay the caller a NEAR bounty.
    pub fn advance(&mut self, max: Option<u32>) -> U64 {
        let _ = caller();
        let cap = max.unwrap_or(self.rules.max_catchup).clamp(1, self.rules.max_catchup) as u64;
        let done = self.catch_up(cap);
        self.flush();
        log!("advanced {} generation(s), now at {}", done, self.generation);
        U64(self.generation)
    }

    /// Move this colony's earnings into its balance and send it the NEAR it has won at the tides (to its payout
    /// account if it set one). Credit won needs no claim: it is spendable as soon as the tide runs. The claim's record
    /// is paid from the NEAR, so NEAR winnings too small to cover it (and a refund, should the transfer fail) stay owed
    /// until they are larger.
    pub fn claim(&mut self) -> Claimable {
        let account = caller();
        let id = self.colony_id(&account);
        self.catch_up(self.rules.max_catchup as u64);
        let petri = self.claim_petri(id, &account);
        let owed = self.books(id).owed;
        let mut near = 0u128;
        if owed > 0 {
            let entry = Entry::Claim { generation: U64(self.generation), colony: id, petri: U64(petri as u64), near: U128(owed), paid: U128(0) };
            let storage = entry_bytes(&entry) * byte_cost();
            if owed > storage + (REFUND_BYTES + PENDING_RECORD_BYTES) * byte_cost() {
                near = owed - storage;
                let index = self.ledger.len() as u64;
                self.ledger.push(Entry::Claim { generation: U64(self.generation), colony: id, petri: U64(petri as u64), near: U128(owed), paid: U128(near) });
                self.update_books(id, |b| b.owed = 0);
                self.tides_owed -= owed;
                let mut c = self.colony(id);
                c.near_claimed = U128(c.near_claimed.0 + owed);
                let to = c.payout.clone().unwrap_or(account.clone());
                self.colonies.set(id as u32 - 1, c);
                self.flush();
                self.pay_out(&to, PAYOUT_CLAIM, index, id, &account, near);
            }
        }
        self.flush();
        emit("claim", json!({ "colony": id, "petri": U128(petri), "near": U128(near) }));
        Claimable { petri: U128(petri), near: U128(near) }
    }

    /// Send this colony's NEAR payouts (tide winnings and sales) to `account_id` from now on, or back to the colony's
    /// own account with `None`. Only a colony that has attached NEAR is paid in NEAR, so only such a colony may set
    /// one; a colony playing on sponsored credit alone is paid in credit, which stays in the dish. A payout that cannot
    /// be delivered there becomes pending NEAR for the colony's own account.
    pub fn set_payout(&mut self, account_id: Option<AccountId>) {
        let account = caller();
        let id = self.colony_id(&account);
        require!(self.books(id).attached, "only a colony that has attached NEAR is paid in NEAR; free play earns credit, which stays in the dish");
        require!(account_id.as_ref() != Some(&env::current_account_id()), "payouts cannot go to the dish itself");
        let mut c = self.colony(id);
        c.payout = account_id.clone();
        self.colonies.set(id as u32 - 1, c);
        self.flush();
        emit("payout", json!({ "colony": id, "to": account_id }));
    }

    /// Resolves a NEAR payout of entry `of`. One that failed is written down with a `Refund` entry, which (and any
    /// record it needs) is paid from the NEAR that came back: a bounty goes back to the vault, and everything else (a
    /// claim, a sale, a sponsor's reclaimed credit, a pending claim) becomes pending NEAR for `account`, which it can
    /// claim again. Nothing here can grow with the number of colonies, so the callback always has the gas it needs.
    #[private]
    pub fn on_payout(&mut self, of: U64, kind: u8, colony: u16, account: AccountId, near: U128) {
        if env::promise_results_count() == 1 && env::promise_result_checked(0, 64).is_ok() {
            return;
        }
        let before = env::storage_usage();
        let index = self.ledger.len();
        self.ledger.push(Entry::Refund { generation: U64(self.generation), colony, kind, of, near, storage: U128(0) });
        let to_pending = kind != PAYOUT_BOUNTY;
        if to_pending {
            // Make the record first, so its storage is counted with the entry's.
            self.pending_add(&account, 0, None);
        }
        self.flush();
        let storage = self.storage_cost_since(before).min(near.0);
        let back = near.0 - storage;
        if to_pending {
            self.pending_add(&account, back, None);
            self.pending_owed += back;
        } else {
            self.vault += back;
            self.near_refunded += back;
            self.near_bounties -= near.0;
        }
        if kind == PAYOUT_SALE {
            self.near_sold -= near.0;
            let mut c = self.colony(colony);
            c.near_sold = U128(c.near_sold.0.saturating_sub(near.0));
            self.colonies.set(colony as u32 - 1, c);
        }
        self.ledger.set(index, Entry::Refund { generation: U64(self.generation), colony, kind, of, near, storage: U128(storage) });
        self.flush();
        emit("payout_failed", json!({ "of": of, "colony": colony, "account": account, "near": near, "kind": kind }));
    }

    // ---------- views ----------

    /// What planting `cells` cells costs right now, in PETRI units (before any catch-up the planting triggers).
    /// Inside a rival's buffer it costs `siege_x` times as much; under a slide's licence `slide_discount_bps` less.
    pub fn quote(&self, cells: u32, siege: Option<bool>, licensed: Option<bool>) -> U128 {
        let cost = self.cell_cost(cells, siege.unwrap_or(false));
        U128(if licensed.unwrap_or(false) { licensed_cost(cost, self.rules.slide_discount_bps) } else { cost })
    }

    /// The NEAR to bring to a planting of `cells` cells with a note of `note_bytes` bytes, under the licence of `slide`
    /// if given: its storage (enough for one paid from credit, for a colony that has no hot row yet, and for
    /// registering the slide's holder for PETRI when it has no registration) plus the fee. What storage does not use
    /// goes to the vault or the credit pool with the fee.
    pub fn plant_deposit(&self, cells: u32, note_bytes: Option<u32>, slide: Option<String>) -> U128 {
        // A colony's first planting since it last played also makes its hot row.
        let mut bytes = PLANT_STORAGE_BASE + books::HOT_BYTES as u64 + books::hot_records_bytes() + 4 * cells as u64 + note_bytes.map(|b| b as u64 + 64).unwrap_or(0);
        if let Some(i) = slide.and_then(|t| self.slide_index_of(&t)) {
            let owner = self.slides.get(i).unwrap().owner.clone();
            // The licence in the entry: token, moves, the holder, the royalty and where it went.
            bytes += 8 + 4 + 1 + 4 + owner.as_str().len() as u64 + 8 + 1;
            if !self.balances.contains_key(&owner) {
                bytes += token::ACCOUNT_STORAGE as u64;
            }
        }
        U128(bytes as u128 * byte_cost() + self.rules.cell_fee.0 * cells as u128)
    }

    /// PETRI that `near` yoctoNEAR would buy from the agar right now.
    pub fn buy_quote(&self, near: U128) -> U128 {
        U128(petri_for_near(near.0, self.agar, self.price_k()))
    }

    /// NEAR the agar would pay for `petri` units right now (before the sale's record is paid for): half the curve's
    /// price, but never more than those units' share of the vault.
    pub fn sell_quote(&self, petri: U128) -> U128 {
        let outstanding = self.total_supply() - self.agar;
        U128(sell_back(petri.0, self.agar, self.price_k(), self.rules.sell_bps, self.vault, outstanding))
    }

    /// Credit `account_id` can spend in the dish: what its colony won and has not spent, plus its sponsors' credit.
    pub fn credit_of(&self, account_id: AccountId) -> U128 {
        let won = self.colony_of.get(&account_id).map(|&id| self.read_books(&[id])[0].0.won).unwrap_or(0);
        U128(won + self.grants.get(&account_id).map(|g| g.iter().map(|g| g.amount.0).sum::<u128>()).unwrap_or(0))
    }

    /// The sponsored part of an account's credit: one grant per sponsor, in the order it is spent (oldest first).
    pub fn credit_grants(&self, account_id: AccountId) -> Vec<Grant> {
        self.grants.get(&account_id).cloned().unwrap_or_default()
    }

    /// The contract's NEAR against what it owes: the vault, the credit pool, unspent credit (won or sponsored),
    /// unclaimed tide winnings and pending NEAR must all be covered by the balance left after storage (plus any wNEAR
    /// held and not yet unwrapped). Every term here can be recomputed from the ledger alone (see /verify).
    pub fn solvency(&self) -> Solvency {
        let balance = env::account_balance().as_yoctonear();
        let storage = env::storage_usage() as u128 * byte_cost();
        let outstanding = self.credit_given + self.credit_won + self.credit_sold - self.credit_spent - self.credit_reclaimed;
        let owed = self.vault + self.credit_pool + outstanding + self.tides_owed + self.pending_owed;
        let free = balance.saturating_sub(storage) + self.wrapped;
        Solvency {
            balance: U128(balance),
            storage: U128(storage),
            vault: U128(self.vault),
            credit_pool: U128(self.credit_pool),
            credit_outstanding: U128(outstanding),
            tides_owed: U128(self.tides_owed),
            pending: U128(self.pending_owed),
            wrapped: U128(self.wrapped),
            surplus: U128(free.saturating_sub(owed)),
            solvent: free >= owed,
        }
    }

    pub fn claimable(&self, account_id: AccountId) -> Claimable {
        match self.colony_of.get(&account_id) {
            Some(&id) => {
                let (b, _) = self.read_books(&[id])[0];
                Claimable { petri: U128(b.earned as u128), near: U128(b.owed) }
            }
            None => Claimable { petri: U128(0), near: U128(0) },
        }
    }

    pub fn rules(&self) -> Rules {
        self.rules.clone()
    }

    pub fn state(&self) -> DishState {
        let dish = self.load_dish();
        let playing = match &self.hot {
            Some(h) => h.rows.len(),
            None => HotTable::load().rows.len(),
        };
        DishState {
            generation: U64(self.generation),
            due_generation: U64(self.due_generation()),
            epoch_ms: U64(self.epoch_ms),
            now_ms: U64(env::block_timestamp_ms()),
            chain: hex::encode(self.chain),
            board_hash: hex::encode(dish.hash()),
            total_live: self.total_live,
            counted: self.counted,
            colonies: self.colonies.len() as u16,
            playing: playing as u32,
            ledger: U64(self.ledger.len() as u64),
            plants: U64(self.plant_count),
            total_supply: U128(self.total_supply()),
            agar: U128(self.agar),
            sold: U128(self.sold),
            fed: U128(self.fed),
            returned: U128(self.returned),
            burned: U128(self.burned),
            bought_back: U128(self.bought_back),
            unclaimed: U128(self.unclaimed),
            keeper_pot: U128(self.keeper_pot),
            keeper_paid: U128(self.keeper_paid),
            vault: U128(self.vault),
            near_in: U128(self.near_in),
            near_tides: U128(self.near_tides),
            near_as_credit: U128(self.near_as_credit),
            near_bounties: U128(self.near_bounties),
            near_sold: U128(self.near_sold),
            near_refunded: U128(self.near_refunded),
            tides_owed: U128(self.tides_owed),
            sell_left: U128(self.sell_left),
            credit_pool: U128(self.credit_pool),
            credit_in: U128(self.credit_in),
            credit_given: U128(self.credit_given),
            credit_spent: U128(self.credit_spent),
            credit_won: U128(self.credit_won),
            credit_sold: U128(self.credit_sold),
            credit_reclaimed: U128(self.credit_reclaimed),
            tides: U64(self.tides),
            skipped: U64(self.skipped),
            house: self.house.clone(),
            slides: U64(self.slides.len() as u64),
            slides_burned: U128(self.slides_burned),
            royalties: U128(self.royalties),
            pending: U128(self.pending_owed),
            wrapped: U128(self.wrapped),
            unwrapping: U128(self.unwrapping),
            wnear_ready: self.wnear_ready,
            pacts: U64(self.pact_count as u64),
            pact_escrow: U128(self.pact_escrow),
            cell_price: U128(self.cell_cost(1, false)),
            petri_price: U128(self.price_k() / self.agar.max(1) * 1_000_000),
        }
    }

    /// The board at the stored generation in compact form (see `Dish::to_compact`), base64.
    pub fn board(&self) -> String {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.encode(env::storage_read(BOARD_KEY).unwrap())
    }

    pub fn colonies(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Colony> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(100).min(500);
        let ids: Vec<u16> = (from..self.colonies.len().min(from.saturating_add(limit))).map(|i| i as u16 + 1).collect();
        let books = self.read_books(&ids);
        ids.iter().zip(books).filter_map(|(&id, (b, _))| self.colonies.get(id as u32 - 1).cloned().map(|c| with_books(c, &b))).collect()
    }

    pub fn colony_of(&self, account_id: AccountId) -> Option<Colony> {
        let id = *self.colony_of.get(&account_id)?;
        Some(self.colony_view(id))
    }

    /// Each colony's stake in thousandths of a planted cell (index = colony id - 1), for starting a replay mid-history.
    pub fn stakes(&self, from: Option<u32>, limit: Option<u32>) -> Vec<U64> {
        let ids = self.id_range(from, limit, 2_000);
        self.read_books(&ids).into_iter().map(|(_, s)| U64(s)).collect()
    }

    /// Each colony's earnings so far, claimed or not, in PETRI units (index = colony id - 1).
    pub fn earnings(&self, from: Option<u32>, limit: Option<u32>) -> Vec<U128> {
        let ids = self.id_range(from, limit, 500);
        let books = self.read_books(&ids);
        ids.iter().zip(books).map(|(&id, (b, _))| U128(self.colonies.get(id as u32 - 1).unwrap().petri_claimed.0 + b.earned as u128)).collect()
    }

    /// NEAR each colony has won at the tides so far, claimed or not (index = colony id - 1).
    pub fn tide_winnings(&self, from: Option<u32>, limit: Option<u32>) -> Vec<U128> {
        let ids = self.id_range(from, limit, 500);
        let books = self.read_books(&ids);
        ids.iter().zip(books).map(|(&id, (b, _))| U128(self.colonies.get(id as u32 - 1).unwrap().near_claimed.0 + b.owed)).collect()
    }

    /// The ledger: every join, purchase, sale, planting, tide, skip, refund, slide, sponsorship, claim and pending
    /// movement in order. Replaying it from an empty dish with `petri-core` reproduces every generation, the agar, the
    /// vault, the credit pool, the credit outstanding, the NEAR owed and pending, and every colony's earnings and
    /// winnings.
    pub fn ledger(&self, from: Option<u64>, limit: Option<u32>) -> Vec<Entry> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.ledger.len().min(from.saturating_add(limit))).filter_map(|i| self.ledger.get(i).cloned()).collect()
    }

    /// Plantings only, paged by planting number, with lab notes.
    pub fn plants(&self, from: Option<u64>, limit: Option<u32>) -> Vec<PlantView> {
        let from = from.unwrap_or(0) as u32;
        let limit = limit.unwrap_or(200).min(1_000);
        (from..self.plant_index.len().min(from.saturating_add(limit)))
            .filter_map(|i| {
                let index = *self.plant_index.get(i)? as u64;
                match self.ledger.get(index as u32)? {
                    Entry::Plant { generation, colony, cells, cost, siege, licence, .. } => Some(PlantView {
                        index: U64(index),
                        generation: *generation,
                        colony: *colony,
                        cells: cells.clone(),
                        cost: *cost,
                        siege: *siege,
                        note: env::storage_read(&note_key(index)).and_then(|b| String::from_utf8(b).ok()),
                        slide: licence.as_ref().map(|l| l.token.0.to_string()),
                    }),
                    _ => None,
                }
            })
            .collect()
    }

    /// The history chain at generation 0 and at every tide.
    pub fn checkpoints(&self, from: Option<u32>, limit: Option<u32>) -> Vec<Checkpoint> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(2_000);
        let mut out = Vec::new();
        if from == 0 {
            out.push(Checkpoint { generation: U64(0), chain: hex::encode([0u8; 32]) });
        }
        let start = from.saturating_sub(1) as u64;
        let end = self.tides.min(start.saturating_add(limit as u64));
        let mut page: Option<(u64, Vec<u8>)> = None;
        for i in start..end {
            let p = i / TIDE_PAGE;
            if page.as_ref().map(|(n, _)| *n) != Some(p) {
                page = Some((p, env::storage_read(&tide_key(p)).unwrap_or_default()));
            }
            let b = &page.as_ref().unwrap().1;
            let at = (i % TIDE_PAGE) as usize * 4;
            let Some(pos) = b.get(at..at + 4) else { break };
            if let Some(Entry::Tide { generation, chain, .. }) = self.ledger.get(u32::from_le_bytes(pos.try_into().unwrap())) {
                out.push(Checkpoint { generation: *generation, chain: chain.clone() });
            }
        }
        out
    }
}

impl Petri {
    /// A fresh dish: the checks on the rules, generation zero, every PETRI in the agar.
    pub(crate) fn launch(rules: Rules) -> Self {
        require!(rules.width >= 16 && rules.height >= 16, "dish too small");
        require!((rules.width as u32) * (rules.height as u32) <= 65_536, "dish too large");
        require!(rules.generation_ms.0 >= 1_000, "generations must be at least a second apart");
        for bps in [rules.keeper_bps, rules.burn_bps, rules.tide_bps, rules.tide_bounty_bps, rules.sell_bps, rules.sell_cap_bps, rules.stake_keep_bps, rules.slide_discount_bps, rules.slide_royalty_bps] {
            require!(bps <= 10_000, "a share is above 100%");
        }
        require!(rules.feed_ppm <= 1_000_000, "feed above 100% per generation");
        require!(rules.max_catchup >= 1 && rules.tide_every >= 1 && rules.reach >= 1 && rules.siege_x >= 1, "max_catchup, tide_every, reach and siege_x must be at least 1");
        require!(rules.max_lag > rules.max_catchup, "max_lag must exceed max_catchup");
        require!(rules.petri_price.0 > 0, "PETRI needs a price");
        require!(rules.house.len() <= MAX_HOUSE && rules.keepers.len() <= MAX_HOUSE, "too many house accounts");
        require!(rules.slide_min_cells >= 1, "a slide must capture at least one cell");
        require!(rules.pact_radius >= 1 && rules.pact_radius <= 16 && rules.pact_max_gens >= 1, "a pact covers 1 to 16 cells and lasts at least a generation");
        let dish = Dish::new(rules.width, rules.height);
        env::storage_write(BOARD_KEY, &dish.to_compact());
        let this = Self {
            agar: rules.max_supply.0,
            rules,
            epoch_ms: env::block_timestamp_ms(),
            generation: 0,
            chain: [0; 32],
            total_live: 0,
            counted: 0,
            colonies: Vector::new(b"C"),
            colony_of: LookupMap::new(b"F"),
            names: LookupSet::new(b"A"),
            ledger: Vector::new(b"L"),
            plant_count: 0,
            plant_index: Vector::new(b"I"),
            balances: LookupMap::new(b"R"),
            grants: LookupMap::new(b"E"),
            house: Vec::new(),
            sold: 0,
            fed: 0,
            returned: 0,
            burned: 0,
            bought_back: 0,
            unclaimed: 0,
            keeper_pot: 0,
            keeper_paid: 0,
            vault: 0,
            near_in: 0,
            near_tides: 0,
            near_as_credit: 0,
            near_bounties: 0,
            near_sold: 0,
            near_refunded: 0,
            tides_owed: 0,
            sell_left: 0,
            credit_pool: 0,
            credit_in: 0,
            credit_given: 0,
            credit_spent: 0,
            credit_won: 0,
            credit_sold: 0,
            credit_reclaimed: 0,
            tides: 0,
            skipped: 0,
            slides: Vector::new(b"D"),
            owned: LookupMap::new(b"T"),
            slides_burned: 0,
            royalties: 0,
            pending: LookupMap::new(b"Z"),
            pending_owed: 0,
            wrapped: 0,
            unwrapping: 0,
            wnear_ready: false,
            pact_count: 0,
            pact_escrow: 0,
            hot: None,
        };
        token::emit_mint(&env::current_account_id(), this.agar, "launch: every PETRI starts in the agar");
        this
    }

    /// Generations of wall-clock time since launch: the due generation plus every generation the clock skipped. It
    /// needs no catch-up, so a sponsorship's day is a day whether or not the dish was tended.
    pub(crate) fn clock(&self) -> u64 {
        self.due_generation() + self.skipped
    }

    pub(crate) fn due_generation(&self) -> u64 {
        (env::block_timestamp_ms().saturating_sub(self.epoch_ms)) / self.rules.generation_ms.0
    }

    /// One of the dish's own accounts: a house strain or a keeper.
    pub(crate) fn is_house(&self, account: &AccountId) -> bool {
        self.rules.house.contains(account) || self.rules.keepers.contains(account)
    }

    fn price_k(&self) -> u128 {
        self.rules.petri_price.0 / 1_000_000 * self.rules.max_supply.0
    }

    fn cell_cost(&self, cells: u32, siege: bool) -> u128 {
        let per_cell = feed_per_cell(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.counted, self.rules.live_floor);
        planting_cost(per_cell, self.rules.payback, self.rules.min_cell_price.0, cells, siege, self.rules.siege_x)
    }

    /// Take `credit` from the caller's credit: first what colony `id` won (no sponsor can take that back, so it should
    /// not sit idle), then its sponsors' credit, oldest grant first. Drawing on a grant restarts its sponsor's day.
    /// Returns the amount taken.
    pub(crate) fn take_credit(&mut self, account: &AccountId, id: Option<u16>, credit: Option<U128>) -> u128 {
        let want = credit.map(|c| c.0).unwrap_or(0);
        if want == 0 {
            return 0;
        }
        let from_won = id.map(|i| self.books(i).won).unwrap_or(0).min(want);
        let mut grants = self.grants.get(account).cloned().unwrap_or_default();
        let sponsored: u128 = grants.iter().map(|g| g.amount.0).sum();
        require!(sponsored >= want - from_won, format!("this account has {} NEAR of won and sponsored credit", fmt_near(from_won + sponsored)));
        if from_won > 0 {
            self.update_books(id.unwrap(), |b| b.won -= from_won);
        }
        let mut rest = want - from_won;
        if rest > 0 {
            let now = U64(self.clock());
            for g in grants.iter_mut() {
                let t = g.amount.0.min(rest);
                if t > 0 {
                    g.amount = U128(g.amount.0 - t);
                    g.at = now;
                    rest -= t;
                }
                if rest == 0 {
                    break;
                }
            }
            grants.retain(|g| g.amount.0 > 0);
            if grants.is_empty() {
                self.grants.remove(account);
            } else {
                self.grants.insert(account.clone(), grants);
            }
        }
        self.credit_spent += want;
        want
    }

    /// Pay `storage` for colony `id`'s `account`: from up to `want` of its credit first, then from the `attached` NEAR,
    /// whose rest is sent back. Returns the credit taken.
    pub(crate) fn pay_storage(&mut self, account: &AccountId, id: u16, want: u128, attached: u128, storage: u128) -> u128 {
        let from_credit = self.take_credit(account, Some(id), Some(U128(want.min(storage))));
        require!(attached + from_credit >= storage, format!("this needs {} NEAR for its storage (attached or as credit); what is not used comes back", fmt_near(storage)));
        let (refund, _) = split_after_storage(attached, from_credit, storage);
        if refund > 0 {
            let _ = Promise::new(account.clone()).transfer(NearToken::from_yoctonear(refund));
        }
        from_credit
    }

    /// Note that colony `id` attached `near` that reached the vault. The first time, what it earned before and has not
    /// claimed becomes kept PETRI (what it claimed as a guest already is).
    fn attach(&mut self, id: u16, near: u128) {
        let b = self.books(id);
        if near > 0 && !b.attached {
            self.update_books(id, |b| b.attached = true);
            let mut c = self.colony(id);
            c.attached = true;
            c.kept = U64(c.kept.0 + b.earned);
            self.colonies.set(id as u32 - 1, c);
        }
    }

    /// A purchase for colony `id`. A colony that has just joined has no hot row, so its first purchase reads and
    /// writes only its own cold slot, never the hot table: a join costs the same however many colonies play.
    fn sell_petri(&mut self, id: u16, account: &AccountId, near: u128, credit: u128, spent: u128, joining: bool) -> u128 {
        let units = petri_for_near(near + credit, self.agar, self.price_k());
        require!(units > 0, "that is not enough NEAR to buy any PETRI");
        self.agar -= units;
        self.sold += units;
        self.credit(account, units);
        // PETRI bought with credit stays in the dish (kept), so credit never turns into NEAR by a sale.
        let from_credit = credit_share(units as u64, credit, near + credit);
        if joining {
            if near > 0 {
                books::cold_update(id, |b| b.attached = true);
            }
            if near > 0 || from_credit > 0 {
                let mut c = self.colony(id);
                c.attached = near > 0;
                c.kept = U64(from_credit);
                self.colonies.set(id as u32 - 1, c);
            }
        } else {
            self.attach(id, near);
            if from_credit > 0 {
                let mut c = self.colony(id);
                c.kept = U64(c.kept.0 + from_credit);
                self.colonies.set(id as u32 - 1, c);
            }
        }
        self.vault += near;
        self.near_in += near;
        self.credit_pool += credit;
        self.credit_in += credit;
        self.ledger.push(Entry::Buy { generation: U64(self.generation), colony: id, petri: U64(units as u64), near: U128(near), credit: U128(credit), spent: (spent > 0).then_some(U128(spent)) });
        token::emit_transfer_pub(&env::current_account_id(), account, units, "bought from the agar");
        units
    }

    /// Send `near` to `to` for entry `of`; if the transfer fails, `on_payout` puts it back where `kind` says, as
    /// pending NEAR for `account` unless it is a bounty.
    pub(crate) fn pay_out(&self, to: &AccountId, kind: u8, of: u64, colony: u16, account: &AccountId, near: u128) {
        let _ = Promise::new(to.clone()).transfer(NearToken::from_yoctonear(near)).then(Self::ext(env::current_account_id()).with_static_gas(GAS_FOR_PAYOUT_CHECK).on_payout(U64(of), kind, colony, account.clone(), U128(near)));
    }

    pub(crate) fn claim_petri(&mut self, id: u16, account: &AccountId) -> u128 {
        let b = self.books(id);
        let amount = b.earned as u128;
        if amount == 0 {
            return 0;
        }
        self.update_books(id, |b| b.earned = 0);
        self.unclaimed -= amount;
        let mut c = self.colony(id);
        c.petri_claimed = U128(c.petri_claimed.0 + amount);
        // What a guest earns stays in the dish.
        if !b.attached {
            c.kept = U64(c.kept.0 + b.earned);
        }
        self.colonies.set(id as u32 - 1, c);
        self.credit(account, amount);
        token::emit_transfer_pub(&env::current_account_id(), account, amount, "earnings from the agar");
        amount
    }

    pub(crate) fn colony_id(&self, account: &AccountId) -> u16 {
        self.colony_of.get(account).copied().unwrap_or_else(|| env::panic_str("join the dish first"))
    }

    pub(crate) fn colony(&self, id: u16) -> Colony {
        self.colonies.get(id as u32 - 1).cloned().unwrap()
    }

    /// A colony as the views return it, with the credit it won and its kept PETRI.
    pub(crate) fn colony_view(&self, id: u16) -> Colony {
        with_books(self.colony(id), &self.read_books(&[id])[0].0)
    }

    /// Write everything this call changed: the collections and the hot table.
    pub(crate) fn flush(&mut self) {
        self.slides.flush();
        self.owned.flush();
        self.pending.flush();
        self.colonies.flush();
        self.ledger.flush();
        self.colony_of.flush();
        self.balances.flush();
        self.plant_index.flush();
        self.grants.flush();
        if let Some(h) = self.hot.as_mut() {
            h.store();
        }
    }

    pub(crate) fn storage_cost_since(&self, before: u64) -> u128 {
        env::storage_usage().saturating_sub(before) as u128 * byte_cost()
    }

    pub(crate) fn load_dish(&self) -> Dish {
        let bytes = env::storage_read(BOARD_KEY).unwrap();
        Dish::from_compact(self.rules.width, self.rules.height, &bytes).unwrap()
    }

    fn store_dish(&self, dish: &Dish) {
        env::storage_write(BOARD_KEY, &dish.to_compact());
    }

    /// The hot table, read from storage the first time a call needs it.
    pub(crate) fn hot_table(&mut self) -> &mut HotTable {
        self.hot.get_or_insert_with(HotTable::load)
    }

    /// Colony `id`'s numbers: its hot row if it plays, else its cold slot.
    pub(crate) fn books(&mut self, id: u16) -> Books {
        match self.hot_table().get(id) {
            Some(r) => r.books,
            None => books::cold_get(id).books,
        }
    }

    /// Change colony `id`'s numbers where they live.
    pub(crate) fn update_books(&mut self, id: u16, f: impl FnOnce(&mut Books)) {
        if self.hot_table().get(id).is_some() {
            self.hot_table().update(id, f);
            return;
        }
        books::cold_update(id, f);
    }

    /// Many colonies' numbers and stakes for a view, reading the hot table and each cold page once.
    fn read_books(&self, ids: &[u16]) -> Vec<(Books, u64)> {
        let loaded;
        let hot = match &self.hot {
            Some(h) => h,
            None => {
                loaded = HotTable::load();
                &loaded
            }
        };
        let mut r = books::Reader::new(hot, self.tides, self.rules.stake_keep_bps);
        ids.iter().map(|&id| r.get(id)).collect()
    }

    fn id_range(&self, from: Option<u32>, limit: Option<u32>, max: u32) -> Vec<u16> {
        let from = from.unwrap_or(0);
        let limit = limit.unwrap_or(500).min(max);
        (from..self.colonies.len().min(from.saturating_add(limit))).map(|i| i as u16 + 1).collect()
    }

    /// Step up to `cap` due generations: Life, the history chain, the feed (into unclaimed earnings, the tide window
    /// and the keeper pot) and the tides that have someone to pay. Living cells are counted sparsely and only colonies
    /// in the hot table are fed, so a generation costs what the living cost; the hot table is read and written once, so
    /// a call costs what the colonies playing now cost, never what every colony that ever joined would. Stops early near
    /// the gas limit. If the dish is `max_lag` behind, the clock first skips ahead. Tide bounties and the keeper pot go
    /// to the caller. Returns how many generations ran.
    fn catch_up(&mut self, cap: u64) -> u64 {
        self.catch_up_by(cap, &env::predecessor_account_id())
    }

    /// `catch_up` with the tide bounties going to `runner`: in NEAR, unless `runner` is a colony that has never attached
    /// NEAR (a guest), which is paid them as credit so no NEAR is stranded in an account that cannot withdraw it, or one
    /// of the house's, which is paid none. If at least one generation ran, the keeper pot goes to `runner` too, when it
    /// is registered for PETRI and is not one of the house's (a strain or a keeper): whoever's call keeps the dish
    /// current is paid for it, whatever the call.
    pub(crate) fn catch_up_by(&mut self, cap: u64, runner: &AccountId) -> u64 {
        let mut due = self.due_generation();
        if due > self.generation + self.rules.max_lag as u64 {
            let skip = due - self.generation - self.rules.max_catchup as u64;
            self.epoch_ms += skip * self.rules.generation_ms.0;
            self.skipped += skip;
            self.ledger.push(Entry::Skip { generation: U64(self.generation), skipped: U64(skip) });
            self.ledger.flush();
            emit("skip", json!({ "generation": U64(self.generation), "skipped": U64(skip) }));
            due = self.due_generation();
        }
        if self.generation >= due || cap == 0 {
            return 0;
        }
        let mut hot = self.hot.take().unwrap_or_else(HotTable::load);
        let target = due.min(self.generation + cap);
        let limit = catchup_limit(hot.rows.len(), hot.purse_dirty || tide_between(self.generation, target, self.rules.tide_every as u64), env::prepaid_gas());
        let mut dish = self.load_dish();
        let mut fed = 0u128;
        let from = self.generation;
        let house_runner = self.is_house(runner);
        let by = match self.colony_of.get(runner).copied() {
            Some(id) => id,
            None if house_runner => HOUSE_RUNNER,
            None => 0,
        };
        // Whether the runner is a guest, read once, at the first tide.
        let mut guest: Option<bool> = None;
        let mut bounties: Vec<(u128, u64)> = Vec::new();
        let mut alive: Vec<ColonyId> = Vec::new();
        while self.generation < target {
            let (live, total) = dish.step_sparse();
            self.generation += 1;
            if chain_due(self.generation) {
                self.chain = chain_next(&self.chain, self.generation, &dish.hash());
            }
            self.total_live = total;
            let f = feed_with(self.agar, self.rules.feed_ppm, self.rules.keeper_bps, self.rules.reach, self.rules.live_floor, &live, |c| hot.stake_of(c), &self.house);
            self.counted = f.weight;
            if f.paid > 0 {
                for &(c, s) in &f.shares {
                    // Only colonies with stake are fed, and every colony with stake has a hot row.
                    let r = hot.get_feed_mut(c).unwrap();
                    r.books.earned += s as u64;
                    r.window += s as u64;
                    self.unclaimed += s;
                }
                self.agar -= f.paid;
                self.keeper_pot += f.keeper;
                fed += f.paid;
            }
            // A tide with nobody to pay does not run: no entry, no storage, no decay, and the allowance stays open.
            if self.generation % self.rules.tide_every as u64 == 0 && tide_due_sparse(&hot.windows(), &self.house) {
                let g = match guest {
                    Some(g) => g,
                    None => by != 0 && by != HOUSE_RUNNER && !house_runner && !self.attached_in(&hot, by),
                };
                guest = Some(g);
                let (bounty, index) = self.tide(&mut hot, by, house_runner, g);
                if bounty > 0 {
                    bounties.push((bounty, index));
                }
            }
            alive = live.iter().map(|&(c, _)| c).collect();
            if env::used_gas() > limit {
                break;
            }
        }
        // Rows that may leave do (their colonies have no living cell, or too little stake to earn, and nothing to be
        // paid at the next tide). That changes the table's size, so it is written now and no caller's storage count sees
        // it; the rest of the catch-up's changes are written once, by the caller's own `flush`.
        if hot.flush_idle(&alive, self.rules.reach, self.tides, books::FLUSH_MAX) > 0 {
            hot.store();
        }
        let ran = self.generation - from;
        let pot = self.keeper_pot;
        // Free play takes no keeper pot: it waits for the next caller who is not a guest.
        let guest_runner = ran > 0 && pot > 0 && by != 0 && by != HOUSE_RUNNER && !self.attached_in(&hot, by);
        self.hot = Some(hot);
        self.store_dish(&dish);
        self.fed += fed;
        self.ledger.flush();
        if ran > 0 && pot > 0 && !house_runner && !guest_runner && self.balances.contains_key(runner) {
            self.keeper_pot = 0;
            self.keeper_paid += pot;
            self.credit(runner, pot);
            self.balances.flush();
            token::emit_transfer_pub(&env::current_account_id(), runner, pot, "keeper pot");
        }
        let bounty: u128 = bounties.iter().map(|b| b.0).sum();
        emit("generation", json!({ "from": U64(from), "to": U64(self.generation), "live": self.total_live, "fed": U128(fed), "keeper_pot": U128(self.keeper_pot), "bounty": U128(bounty) }));
        for (b, index) in bounties {
            self.pay_out(runner, PAYOUT_BOUNTY, index, if by == HOUSE_RUNNER { 0 } else { by }, runner, b);
        }
        ran
    }

    fn attached_in(&self, hot: &HotTable, id: u16) -> bool {
        match hot.get(id) {
            Some(r) => r.books.attached,
            None => books::cold_get(id).books.attached,
        }
    }

    /// Append ledger position `index` to the tide index (four bytes; a new page every `TIDE_PAGE` tides).
    fn index_tide(&self, index: u64) {
        let n = self.tides;
        let key = tide_key(n / TIDE_PAGE);
        let mut b = env::storage_read(&key).unwrap_or_default();
        b.extend_from_slice(&(index as u32).to_le_bytes());
        env::storage_write(&key, &b);
    }

    /// One tide: record the history chain; pay `tide_bps` of the vault by the window's earnings (the bounty to the
    /// caller, this entry's storage, the rest to colonies: in NEAR to those that have attached NEAR, as credit to those
    /// that never have) and `tide_bps` of the credit pool the same way as credit; reset the window, decay every stake and
    /// reopen the buy-back allowance. Every colony that earned is in the hot table, so a tide touches nothing else.
    /// Returns the bounty to pay in NEAR (none when the runner, colony `by`, is a `guest` and is paid it as credit, or is
    /// one of the house's) and the entry's index.
    fn tide(&mut self, hot: &mut HotTable, by: u16, house_runner: bool, guest: bool) -> (u128, u64) {
        let before = env::storage_usage();
        let generation = U64(self.generation);
        let chain = hex::encode(self.chain);
        let index = self.ledger.len() as u64;
        self.ledger.push(Entry::Tide { generation, chain: chain.clone(), bytes: 0, by });
        self.ledger.flush();
        self.index_tide(index);
        let bytes = env::storage_usage().saturating_sub(before);
        // The entry has the same size whatever `bytes` is.
        self.ledger.set(index as u32, Entry::Tide { generation, chain: chain.clone(), bytes: bytes as u16, by });
        self.ledger.flush();
        let storage_cost = bytes as u128 * byte_cost();
        let pay = self.vault * self.rules.tide_bps as u128 / 10_000;
        let full_bounty = (pay * self.rules.tide_bounty_bps as u128 / 10_000).min(self.rules.max_bounty.0);
        let storage = storage_cost.min(pay - full_bounty);
        let windows = hot.windows();
        let (split, total) = tide_split_sparse(pay - full_bounty - storage, &windows, &self.house);
        let credit_pay = self.credit_pool * self.rules.tide_bps as u128 / 10_000;
        let (csplit, credit_paid) = tide_split_sparse(credit_pay, &windows, &self.house);
        let (mut paid, mut as_credit) = (0u128, 0u128);
        for &(c, s) in &split {
            let r = hot.get_mut(c).unwrap();
            // NEAR only reaches a colony that brought NEAR; a guest's share stays in the dish as its credit.
            if r.books.attached {
                r.books.owed += s;
                paid += s;
            } else {
                r.books.won += s;
                r.books.credit_won += s;
                as_credit += s;
            }
        }
        self.tides_owed += paid;
        // Without winners nothing but the storage leaves the vault; a house runner's bounty stays in it.
        let bounty = if total > 0 && !house_runner { full_bounty } else { 0 };
        let storage = if total > 0 { storage } else { storage_cost.min(self.vault) };
        self.vault -= total + bounty + storage;
        self.near_tides += paid;
        self.near_as_credit += as_credit;
        // A guest's bounty stays in the dish as its credit, like its shares.
        let bounty_credit = if guest { bounty } else { 0 };
        if bounty_credit > 0 {
            let credit = |b: &mut Books| {
                b.won += bounty_credit;
                b.credit_won += bounty_credit;
            };
            match hot.get_mut(by) {
                Some(r) => credit(&mut r.books),
                None => books::cold_update(by, credit),
            }
            self.near_as_credit += bounty_credit;
        } else {
            self.near_bounties += bounty;
        }
        // The credit pool pays out as credit, by the same weights.
        for &(c, s) in &csplit {
            let r = hot.get_mut(c).unwrap();
            r.books.won += s;
            r.books.credit_won += s;
        }
        self.credit_pool -= credit_paid;
        self.credit_won += credit_paid + as_credit + bounty_credit;
        self.tides += 1;
        emit("tide", json!({ "generation": generation, "index": U64(index), "chain": chain, "by": by, "pay": U128(pay), "bounty": U128(bounty), "storage": U128(storage), "paid": U128(paid), "as_credit": U128(as_credit), "credit_pay": U128(credit_pay), "credit_paid": U128(credit_paid), "winners": split.len().max(csplit.len()) }));
        #[cfg(test)]
        TIDE_LOG.with(|t| t.borrow_mut().push((index, TideOut { pay: U128(pay), bounty: U128(bounty), storage: U128(storage), paid: U128(paid), as_credit: U128(as_credit), credit_pay: U128(credit_pay), credit_paid: U128(credit_paid) })));
        for r in hot.rows.iter_mut() {
            r.window = 0;
            r.stake = decay_stake(r.stake, self.rules.stake_keep_bps);
        }
        hot.dirty = true;
        self.sell_left = self.vault * self.rules.sell_cap_bps as u128 / 10_000;
        (bounty - bounty_credit, index)
    }

    pub(crate) fn credit(&mut self, account: &AccountId, amount: u128) {
        let b = self.balance(account);
        self.balances.insert(account.clone(), b + amount);
    }

    pub(crate) fn burn(&mut self, account: &AccountId, amount: u128, memo: &str) {
        let b = self.balance(account);
        require!(b >= amount, "not enough PETRI");
        self.balances.insert(account.clone(), b - amount);
        self.burned += amount;
        token::emit_burn(account, amount, memo);
    }

    pub(crate) fn balance(&self, account: &AccountId) -> u128 {
        self.balances.get(account).copied().unwrap_or(0)
    }

    /// Every PETRI minted at launch minus everything burned since. Includes the agar and unclaimed earnings.
    pub(crate) fn total_supply(&self) -> u128 {
        self.rules.max_supply.0 - self.burned
    }

    /// What the contract itself holds in PETRI: the agar, unclaimed earnings, the keeper pot and pact offers' PETRI.
    pub(crate) fn held_by_dish(&self) -> u128 {
        self.agar + self.unclaimed + self.keeper_pot + self.pact_escrow
    }
}

/// Storage is paid from sponsored credit first, then from attached NEAR; returns what is left of each.
pub(crate) fn split_after_storage(attached: u128, credit: u128, storage: u128) -> (u128, u128) {
    let from_credit = storage.min(credit);
    (attached - (storage - from_credit), credit - from_credit)
}

/// A colony record as the views return it: with the credit it won, which tides keep in its books, and, for a guest,
/// its unclaimed earnings counted as kept PETRI (they become kept when claimed or when it first attaches NEAR).
fn with_books(mut c: Colony, books: &Books) -> Colony {
    c.credit_won = U128(books.credit_won);
    if !c.attached {
        c.kept = U64(c.kept.0 + books.earned);
    }
    c
}

/// Why a colony holding kept PETRI cannot do `what`.
pub(crate) fn kept_text(kept: u64, what: &str) -> String {
    format!("PETRI earned before a colony's first NEAR stays in the dish: you hold {} kept PETRI; plant it first (kept PETRI is spent first), then you can {}", fmt_petri(kept as u128), what)
}

/// What each tide paid, as its `tide` event says, kept for the tests' book-keeping checks (never in the contract).
#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TideOut {
    pub pay: U128,
    pub bounty: U128,
    pub storage: U128,
    pub paid: U128,
    pub as_credit: U128,
    pub credit_pay: U128,
    pub credit_paid: U128,
}

#[cfg(test)]
thread_local! {
    /// (ledger index of the Tide entry, what it paid), for every tide this test thread ran.
    pub(crate) static TIDE_LOG: std::cell::RefCell<Vec<(u64, TideOut)>> = Default::default();
}

pub(crate) fn byte_cost() -> u128 {
    env::storage_byte_cost().as_yoctonear()
}

/// Storage bytes a new ledger entry takes: its key, its value and NEAR's 40 bytes per record.
pub(crate) fn entry_bytes(e: &Entry) -> u128 {
    (near_sdk::borsh::to_vec(e).unwrap().len() + 5 + 40) as u128
}

/// Callbacks check this as well as `#[private]`: only the contract's own receipts may run them.
pub(crate) fn only_self() {
    require!(env::predecessor_account_id() == env::current_account_id(), "only the dish itself can call this");
}

/// The account making the call. The contract itself never acts as a player: its own balance is the agar.
fn caller() -> AccountId {
    let a = env::predecessor_account_id();
    require!(a != env::current_account_id(), "the dish does not play on itself");
    a
}

/// A colony name: 1 to 24 characters of plain ASCII letters, digits, spaces and a little punctuation, so no name can
/// hide characters, impersonate another or carry an instruction in a script the reader cannot see.
pub(crate) fn clean_name(s: &str) -> String {
    checked_name(s).unwrap_or_else(|e| env::panic_str(e))
}

/// A name a player chooses: `clean_name`, and never one of the neutral names reserved for colonies someone else paid
/// to start (see `neutral_name`), so nobody can claim another account's neutral name first.
pub(crate) fn chosen_name(s: &str) -> String {
    let t = clean_name(s);
    require!(!is_neutral(&t), "names of the form \"Culture <hex digits>\" are kept for colonies someone else paid to start");
    t
}

/// `clean_name` without panicking, for wNEAR joins that must never fail.
pub(crate) fn checked_name(s: &str) -> Result<String, &'static str> {
    let t = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if t.is_empty() || t.len() > MAX_NAME_BYTES || t.chars().count() > MAX_NAME_CHARS {
        return Err("name must be 1 to 24 characters");
    }
    if !t.chars().all(|c| c.is_ascii_alphanumeric() || " -'.&!?_,:()".contains(c)) {
        return Err("a name may use only letters A to Z, digits, spaces and - ' . & ! ? _ , : ( )");
    }
    Ok(t)
}

/// "Culture " and hex digits, in any case.
pub(crate) fn is_neutral(name: &str) -> bool {
    let l = name.to_ascii_lowercase();
    l.strip_prefix("culture ").map_or(false, |rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_hexdigit()))
}

/// A lab note: trimmed, at most 140 characters, and free of characters that hide or reorder text.
fn clean_note(s: &str) -> String {
    clean_text(s, MAX_NOTE_CHARS, MAX_NOTE_BYTES, "a lab note")
}

/// Free text (a lab note, a slide's title): trimmed, at most `chars` characters and `bytes` bytes, and free of
/// characters that hide or reorder text.
pub(crate) fn clean_text(s: &str, chars: usize, bytes: usize, what: &str) -> String {
    let t = s.trim().to_string();
    for ch in t.chars() {
        require!(!hidden_char(ch), format!("{} may not contain control, direction, invisible or tag characters", what));
    }
    require!(t.chars().count() <= chars && t.len() <= bytes, format!("{} is at most {} characters", what, chars));
    t
}

/// Control, bidirectional, zero-width, invisible filler, variation-selector and tag characters.
pub(crate) fn hidden_char(ch: char) -> bool {
    let c = ch as u32;
    ch.is_control()
        || [0x00AD, 0x034F, 0x061C, 0x115F, 0x1160, 0x17B4, 0x17B5, 0x3164, 0xFEFF, 0xFFA0].contains(&c)
        || (0x180B..=0x180F).contains(&c)
        || (0x200B..=0x200F).contains(&c)
        || (0x2028..=0x202E).contains(&c)
        || (0x2060..=0x206F).contains(&c)
        || (0xFE00..=0xFE0E).contains(&c)
        || (0xFFF0..=0xFFFB).contains(&c)
        || (0x1D173..=0x1D17A).contains(&c)
        || (0xE0000..=0xE0FFF).contains(&c)
}

fn note_key(index: u64) -> Vec<u8> {
    let mut k = NOTE_PREFIX.to_vec();
    k.extend_from_slice(&(index as u32).to_le_bytes());
    k
}

fn tide_key(page: u64) -> [u8; 5] {
    let p = (page as u32).to_le_bytes();
    [TIDE_PREFIX, p[0], p[1], p[2], p[3]]
}

/// Whether a tide generation falls in `(from, to]`.
fn tide_between(from: u64, to: u64, every: u64) -> bool {
    to / every > from / every
}

/// The gas a catch-up may use before it stops stepping: `CATCHUP_GAS_LIMIT` (and the prepaid gas less `GAS_RESERVE`)
/// less what the call will still spend on the hot table, at the real network's price per byte: writing the feed part
/// of `rows` rows back (every catch-up does), the purse part too when `purse` (a tide may run, or the call already
/// changed a purse), and moving up to `FLUSH_MAX` idle rows out to their cold pages.
pub(crate) fn catchup_limit(rows: usize, purse: bool, prepaid: Gas) -> Gas {
    let bytes = rows * if purse { books::HOT_BYTES } else { books::FEED_BYTES };
    let store = Gas::from_gas(bytes as u64 * books::HOT_WRITE_GAS_PER_BYTE + books::FLUSH_MAX as u64 * books::COLD_PAGE_GAS);
    CATCHUP_GAS_LIMIT.saturating_sub(store).min(prepaid.saturating_sub(GAS_RESERVE).saturating_sub(store))
}

/// The colonies with a living cell on `dish`, in increasing order.
fn alive_colonies(dish: &Dish) -> Vec<ColonyId> {
    let mut v: Vec<ColonyId> = dish.cells.iter().copied().filter(|&c| c != EMPTY).collect();
    v.sort_unstable();
    v.dedup();
    v
}

pub(crate) fn emit(event: &str, data: near_sdk::serde_json::Value) {
    log!("EVENT_JSON:{}", json!({ "standard": "petri", "version": "6.1.0", "event": event, "data": [data] }));
}

pub(crate) fn fmt_petri(units: u128) -> String {
    let whole = units / 1_000_000;
    let frac = units % 1_000_000;
    if frac == 0 {
        format!("{}", whole)
    } else {
        let s = format!("{:06}", frac);
        format!("{}.{}", whole, s.trim_end_matches('0'))
    }
}

pub(crate) fn fmt_near(yocto: u128) -> String {
    let micro = yocto / 1_000_000_000_000_000_000;
    format!("{}.{:06}", micro / 1_000_000, micro % 1_000_000).trim_end_matches('0').trim_end_matches('.').to_string()
}

fn plant_error_text(dish: &Dish, e: PlantError) -> String {
    let at = |i: u32| {
        let (x, y) = dish.xy(i as usize);
        format!("({}, {})", x, y)
    };
    match e {
        PlantError::Empty => "plant at least one cell".into(),
        PlantError::TooMany { max } => format!("at most {} cells per planting", max),
        PlantError::OutOfRange { index } => format!("cell {} is off the dish", index),
        PlantError::Duplicate { index } => format!("cell {} is listed twice", at(index)),
        PlantError::Occupied { index } => format!("cell {} is already alive", at(index)),
    }
}

#[cfg(test)]
mod tests;
