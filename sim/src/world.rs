//! The v6.1 contract mirrored in memory (and v6's layout and rules behind the `v6` switches), and the scripted players.
//!
//! v6.1 (contract/src): the hot table holds only colonies that earned since the last tide or that have living cells and
//! a stake that can still earn (never the house), at most 10,000 rows; rows leave (32 a call) at the end of a catch-up;
//! stake waits in the 69-byte cold slot (pages of 32) and decays lazily; the catch-up reserves the purse part only when
//! a tide falls in it; compact entries (PETRI in u64, a 130-byte tide); licences only for slides of at least
//! `licence_min_cells`; royalties from colonies that never attached NEAR go to the agar; the keeper pot to any outside
//! caller whose call ran a generation; the site prepays 300 TGas.
//!
//! What follows contract/src/lib.rs v6 and stays in v6.1: the vault and the credit pool; storage paid from credit first; per-colony books
//! (`attached`, earnings, NEAR owed, credit won) with the hot table of colonies that have stake; tides of `tide_bps` of
//! the vault every `tide_every` generations, skipped when no colony outside the house earned since the last one (no
//! entry, no decay, the sale allowance unchanged); a colony that never attached NEAR paid its tide shares, sales and
//! bounties as credit; the house (strains and keepers) never fed, no share, no sale, no PETRI to players, no bounty, no
//! keeper pot; one grant per sponsor, won credit spent first, a sponsor reclaims only its own unspent grant a day after
//! the last draw; slides as pattern licences (discount, royalty to the holder from anyone else); the catch-up's gas
//! limit `min(180, prepaid - 40 - hot table write)`; dormancy skips.
//!
//! v6.1 part 2 (`kept_rule`): PETRI a colony earned, bought with credit or was paid in royalties before its first NEAR,
//! and PETRI bought with credit since, is kept: plantings and slides spend it first, and while any is held the colony
//! cannot sell PETRI for NEAR or send it; a guest sends no PETRI at all and takes no keeper pot. Pacts (`pacts`): a
//! payer's PETRI for its promisor's promise not to plant within `pact_radius` of the payer's living cells, which the
//! contract enforces by refusing the planting.

use crate::model::*;
use petri_core::{credit_share, decay_stake, feed_per_cell, feed_sparse, licensed_cost, near_for_petri, patterns, petri_for_near, planting_cost, royalty, sell_back, tide_split_sparse, wide_mul_div, ColonyId, Dish, EMPTY, STAKE_UNIT};
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Kind {
    /// The cheapest outsider: joins with min_join (0.01 NEAR), keeps one block alive (replants it when its pay cap
    /// lapses or it dies), claims daily. 0.05 NEAR in all.
    Penny,
    /// Still lifes near home. 0.05 NEAR at join, 0.25 in all.
    Builder,
    /// Gliders/LWSS at rivals; one move in three a blinker siege. 0.05/0.25.
    Raider,
    /// Eaters and beehives near home. 0.05/0.25.
    Defender,
    /// One R-pentomino an hour within 40 cells of home. 0.1/0.5.
    Methuselah,
    /// A builder joining on day 2 or 3.
    Late,
    /// 2 NEAR in one colony, pulsars and beehives anywhere, every few generations. 2/3.
    Whale,
    /// The same 2/3 NEAR over 10 colonies (20 from 1,500 players), one operator.
    SplitWhale,
    /// Plants only in the 3 generations before each tide, sells after every tide.
    Sniper,
    /// A lattice of blocks 8 apart so every empty cell is in its buffer, repaired every 20 generations, renewed when
    /// its pay cap lapses. 1.5/2 NEAR.
    Locker,
    /// Never plants: races for the keeper pot and the tide bounty when they beat the gas. 0.01 NEAR.
    Racer,
    /// Buys 0.2 NEAR of PETRI at join and sells it back as fast as the allowance lets it.
    Seller,
    /// Royalty farmer: at launch plants and mints a slide of each common pattern (beehive, loaf, eater, glider, LWSS,
    /// R-pentomino, toad, pulsar), then sells the royalties it is paid. 0.3/0.6 NEAR.
    Farmer,
    /// A colony on 0.05 NEAR of credit someone sponsored (a relayer guest on testnet); plays like a builder.
    Guest,
    /// One operator: a wallet builder plus 10 relayer guests near it that plant blocks, sell after every tide.
    SybilGuest,
    /// One operator: a wallet that mints a beehive slide plus 10 relayer guests that plant beehives under its licence
    /// (paying it royalties in PETRI) with their free credit; the wallet sells the royalties for NEAR.
    SybilRoyalty,
    /// One operator sponsoring 10 of its own full-access sub-accounts with 0.05 NEAR each; each attaches 0.001 NEAR
    /// once so it is paid in NEAR, plays on credit, claims; a day before the end it stops and the operator unsponsors.
    SelfSponsor,
    /// Part 2's exit (b): one operator's 10 relayer guests farm blocks on free credit for a day, hoarding what they
    /// earn; then each attaches 0.01 NEAR (a wNEAR purchase the operator pays for) and sells everything after every
    /// tide. It keeps planting blocks, so kept PETRI is spent and later earnings sell.
    SybilAttach,
    /// Part 2's exit (a): one operator's wallet plus 10 relayer guests that farm blocks on free credit and ft_transfer
    /// all their PETRI to the wallet after every tide; the wallet sells it for NEAR.
    SybilTransfer,
    /// The testnet bench: three team wallets that play by the strains' written rules with their own NEAR.
    Bench,
    /// The five house strains (agents/run.mjs + strategies.mjs + council.mjs).
    House,
}

pub const KINDS: [Kind; 21] = [
    Kind::Penny,
    Kind::Builder,
    Kind::Raider,
    Kind::Defender,
    Kind::Methuselah,
    Kind::Late,
    Kind::Whale,
    Kind::SplitWhale,
    Kind::Sniper,
    Kind::Locker,
    Kind::Racer,
    Kind::Seller,
    Kind::Farmer,
    Kind::Guest,
    Kind::SybilGuest,
    Kind::SybilRoyalty,
    Kind::SelfSponsor,
    Kind::SybilAttach,
    Kind::SybilTransfer,
    Kind::Bench,
    Kind::House,
];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    /// Signs and pays for itself.
    Wallet,
    /// A relayer guest: credit only, a function-call key that can attach nothing, so it never attaches NEAR and is paid
    /// only in credit; the relayer pays its gas.
    Guest,
    /// A self-sponsored full-access sub-account: credit from its operator, NEAR it receives is the operator's.
    Sub,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Net {
    /// House strains attach their own NEAR at an eighth of the pace with a 100 PETRI/day cap; the keeper only advances
    /// before a clock skip once outsiders play; no guests, no bench.
    Mainnet,
    /// House strains pay with sponsored credit at full pace; the bench plays; the keeper advances at 20 behind (and,
    /// registered, whenever the pot holds over 50 PETRI); relayer guests.
    Testnet,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Payer {
    Acct(usize),
    Keeper,
}

/// Calls, for the gas table.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Call {
    Join,
    Plant,
    Buy,
    Sell,
    Claim,
    Advance,
    Slide,
    Sponsor,
    Unsponsor,
}
pub const CALLS: [Call; 9] = [Call::Join, Call::Plant, Call::Buy, Call::Sell, Call::Claim, Call::Advance, Call::Slide, Call::Sponsor, Call::Unsponsor];

impl Call {
    pub fn idx(self) -> usize {
        self as usize
    }
    /// Prepaid TGas: the site's wallet.ts (v6.1: join/plant/buy/sell/claim/advance/mint 300; v6: plant/buy/sell/join 200,
    /// claim/advance/mint 250); the agents' plant 200, buy and claim 150, keeper advance 250 (unchanged).
    pub fn prepaid(self, house: bool, site_v6: bool) -> f64 {
        1_000.0
            * match (self, house) {
                (Call::Buy | Call::Claim, true) => 150.0,
                (Call::Slide, true) => 200.0,
                (Call::Join | Call::Plant | Call::Sell, true) => 200.0,
                (Call::Advance, true) => 250.0,
                (Call::Sponsor, _) => 30.0,
                (Call::Unsponsor, _) => 50.0,
                (_, false) if !site_v6 => 300.0,
                (Call::Join | Call::Plant | Call::Buy | Call::Sell, _) => 200.0,
                (Call::Claim | Call::Advance | Call::Slide, _) => 250.0,
            }
    }
}

/// Patterns the players and strains plant.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Pat {
    Block,
    Blinker,
    Beehive,
    Loaf,
    Glider,
    Lwss,
    Eater,
    RPent,
    Toad,
    Pulsar,
    Gun,
    Acorn,
}
pub const PATS: usize = 12;
const ACORN: &[(i32, i32)] = &[(1, 0), (3, 1), (0, 2), (1, 2), (4, 2), (5, 2), (6, 2)];

impl Pat {
    pub fn cells(self) -> &'static [(i32, i32)] {
        match self {
            Pat::Block => patterns::BLOCK,
            Pat::Blinker => patterns::BLINKER,
            Pat::Beehive => patterns::BEEHIVE,
            Pat::Loaf => patterns::LOAF,
            Pat::Glider => patterns::GLIDER,
            Pat::Lwss => patterns::LWSS,
            Pat::Eater => patterns::EATER,
            Pat::RPent => patterns::R_PENTOMINO,
            Pat::Toad => patterns::TOAD,
            Pat::Pulsar => patterns::PULSAR,
            Pat::Gun => patterns::GOSPER_GUN,
            Pat::Acorn => ACORN,
        }
    }
    fn idx(self) -> usize {
        self as usize
    }
    /// The slide rectangle (each side 4 to 32).
    fn bbox(self) -> (u128, u128) {
        let c = self.cells();
        let w = c.iter().map(|p| p.0).max().unwrap() + 1;
        let h = c.iter().map(|p| p.1).max().unwrap() + 1;
        ((w.max(4)) as u128, (h.max(4)) as u128)
    }
}

/// A slide of a standard pattern in one orientation, a licence anyone may plant under.
#[derive(Clone)]
pub struct SlideRec {
    pub pat: Pat,
    pub rot: u8,
    pub holder: usize,
    pub royalties: u128,
    pub plantings: u32,
}

/// One account's books a day (5,760 generations) after it joined, for the economics report (sim/src/econ.rs). Read
/// only: taking it changes nothing in the run.
#[derive(Clone, Copy, Default)]
pub struct Snap {
    /// NEAR attached and gas paid so far (a guest's sponsored credit is not its NEAR and is not counted).
    pub attached: u128,
    pub gas: u128,
    /// PETRI bought (at join and since), fed by the agar, and spent on plantings.
    pub bought: u128,
    pub join_units: u128,
    pub fed: u128,
    pub spent: u128,
    /// Its tide shares (NEAR, or credit for a colony that never attached NEAR), and what it took out: tide NEAR
    /// claimed, PETRI sold back, bounties.
    pub tide: u128,
    pub claimed: u128,
    pub sold: u128,
    pub bounty: u128,
    pub owed: u128,
    /// PETRI it holds at that moment, and what the sell-back would pay for all of it then.
    pub held_units: u128,
    pub held_value: u128,
    pub plants: u32,
    pub live: u32,
}

impl Snap {
    pub fn add(&mut self, o: &Snap) {
        self.attached += o.attached;
        self.gas += o.gas;
        self.bought += o.bought;
        self.join_units += o.join_units;
        self.fed += o.fed;
        self.spent += o.spent;
        self.tide += o.tide;
        self.claimed += o.claimed;
        self.sold += o.sold;
        self.bounty += o.bounty;
        self.owed += o.owed;
        self.held_units += o.held_units;
        self.held_value += o.held_value;
        self.plants += o.plants;
        self.live += o.live;
    }
}

#[derive(Clone, Default)]
pub struct Acct {
    pub kind: Option<Kind>,
    pub role: Option<Role>,
    pub group: usize,
    pub id: ColonyId,
    pub home: (i32, i32),
    pub join_at: u64,
    pub every: u64,
    pub phase: u64,
    pub next_at: u64,
    pub name_len: u128,
    pub bring: u128,
    /// NEAR the player is willing to attach in all (gas included); winnings, sales and bounties go back into it.
    pub wallet: u128,
    /// House: NEAR the strain keeps for gas (agents' MIN_NEAR) and stops buying below.
    pub floor: u128,
    /// The contract's books for this colony.
    pub balance: u128,
    pub unclaimed: u128,
    pub owed: u128,
    pub won: u128,
    pub grant: u128,
    pub grant_at: u64,
    pub grant_mine: bool,
    pub attached_flag: bool,
    pub joined: bool,
    pub planted_once: bool,
    pub top_ups: u32,
    /// A self-sponsored account stops spending credit from this wall generation on.
    pub credit_stop: u64,
    pub temper: u8,
    pub cap: u32,
    pub last_slide: u64,
    pub spend_log: Vec<(u64, u128)>,
    // Totals.
    pub earned: u128,
    pub spent: u128,
    pub pot: u128,
    pub attached: u128,
    pub sponsored_paid: u128,
    pub gas: u128,
    pub relayer_gas: u128,
    pub claimed: u128,
    pub sold: u128,
    pub bounty: u128,
    pub reclaimed: u128,
    pub credit_won: u128,
    pub credit_sold: u128,
    pub royalty_in: u128,
    pub royalty_in_credit: u128,
    pub royalty_out: u128,
    pub royalty_sold_near: u128,
    pub tide_share: u128,
    pub slide_storage: u128,
    pub live_gens: u64,
    pub unpaid_gens: u64,
    pub plants: u32,
    pub licensed: u32,
    pub sieges: u32,
    pub failed_calls: u32,
    // Part 2: kept PETRI (see `Rules::kept_rule`; counted with or without the rule, enforced only with it), sales and
    // transfers it refused, NEAR paid for kept PETRI (only without the rule), PETRI moved by transfer, and pacts.
    pub kept: u128,
    pub farm_sold: u128,
    pub transfer_refused: bool,

    pub kept_refused: u32,
    pub moved_out: u128,
    pub moved_in: u128,
    pub pact_paid: u128,
    pub pact_in: u128,
    pub pact_refused: u32,
    pub pact_diverted: u32,
    // Locker: block spots (lattice first, then renewal) and progress.
    pub spots: Vec<(i32, i32)>,
    pub lattice_len: usize,
    pub spots_done: usize,
    // Economics report (read only): the NEAR it set out with, the NEAR it put into the vault, PETRI bought (and at
    // join), and its books a day after joining.
    pub budget: u128,
    pub vault_in: u128,
    pub bought: u128,
    pub join_units: u128,
    pub day1: Option<Snap>,
}

impl Acct {
    pub fn kind(&self) -> Kind {
        self.kind.unwrap()
    }
    pub fn role(&self) -> Role {
        self.role.unwrap()
    }
    pub fn credit(&self) -> u128 {
        self.won + self.grant
    }
}

#[derive(Clone, Default)]
pub struct Keeper {
    pub gas: u128,
    pub calls: u64,
}

/// The dish at every 240th generation (a tide that ran or was skipped).
#[derive(Clone)]
pub struct TideRow {
    pub gen: u64,
    pub wall: u64,
    pub ran: bool,
    pub live: u32,
    pub counted: u32,
    pub agar: u128,
    pub vault: u128,
    pub credit_pool: u128,
    pub per_cell_feed: u128,
    pub cell_price: u128,
    pub free: f64,
    pub block_free: f64,
    pub newcomer_petri: u128,
    pub newcomer_near: u128,
    pub newcomer_siege: bool,
    pub siege_near: u128,
    pub near_in: u128,
    pub pay: u128,
    pub split: u128,
    pub storage: u128,
    pub bounty: u128,
    pub winners: usize,
    pub hot_rows: usize,
    pub tide_gas: f64,
    /// Share of this tide's split (NEAR + credit) that went to the first outsider, and to the largest winner.
    pub first_share: f64,
    pub top_share: f64,
    pub outsiders: usize,
    /// The largest share of the living cells any one outside player (all its colonies) held, and its kind.
    pub top_live_share: f64,
    pub top_live_kind: Option<Kind>,
}

#[derive(Clone)]
pub struct DayRow {
    pub day: u64,
    pub gen: u64,
    pub skipped: u64,
    pub live: u32,
    pub counted: u32,
    pub agar: u128,
    pub burned: u128,
    pub fed: u128,
    pub vault: u128,
    pub credit_pool: u128,
    pub per_cell_feed: u128,
    pub cell_price: u128,
    pub keeper_calls: u64,
    pub keeper_gas: u128,
    pub house_paid: u128,
    pub house_left: u128,
    pub house_plants: u32,
    pub contract_storage: i128,
    pub hot_rows: usize,
    pub tides_run: u64,
    pub tides_skipped: u64,
    pub joined: usize,
    pub claimed: u128,
    /// Cumulative NEAR (and credit) the vault has paid out: tide shares in NEAR and as credit, bounties, sales.
    pub vault_out: u128,
    /// PETRI held by players (balances and unclaimed earnings), outside the agar.
    pub held: u128,
    /// The largest share of the living cells, and of the PETRI players hold, any one outside player held at the day's end.
    pub top_live_share: f64,
    pub top_live_kind: Option<Kind>,
    pub top_held_share: f64,
    /// Economics report: NEAR that entered the vault in all and from the house strains; NEAR the vault paid to players
    /// (tide shares in NEAR or credit, bounties, sell-backs, all cumulative) and the part of it that was the house's
    /// NEAR, the vault being one pool whose every payout is drawn pro rata from what is in it; the house's part of the
    /// vault now.
    pub vault_in: u128,
    pub vault_in_house: u128,
    pub out_players: u128,
    pub out_house: u128,
    pub vault_house: u128,
    /// A 0.05 NEAR round trip at the day's end prices: PETRI it buys (after the purchase record's storage), what the
    /// sell-back curve alone would pay for them (sell_bps of the curve), and what the sell-back pays (the curve capped
    /// by the vault's pro-rata share), before the sale record's storage and gas.
    pub rt_units: u128,
    pub rt_curve: u128,
    pub rt_back: u128,
    /// The sell allowance left until the next tide.
    pub sell_left: u128,
}

/// One player's totals (summed over its colonies).
#[derive(Clone)]
pub struct GroupOut {
    pub kind: Kind,
    pub accounts: usize,
    pub first_join: u64,
    pub attached: u128,
    pub sponsored: u128,
    pub gas: u128,
    pub relayer_gas: u128,
    pub claimed: u128,
    pub sold: u128,
    pub bounty: u128,
    pub reclaimed: u128,
    pub owed: u128,
    /// PETRI held (claimed or not) valued at the sell-back floor; credit-only colonies' PETRI would sell for credit.
    pub held: u128,
    pub held_credit: u128,
    pub credit_left: u128,
    pub credit_won: u128,
    pub credit_sold: u128,
    pub earned: u128,
    pub spent: u128,
    pub royalty_in: u128,
    pub royalty_in_credit: u128,
    pub royalty_out: u128,
    pub tide_share: u128,
    pub slide_storage: u128,
    /// PETRI received from the keeper pot.
    pub pot: u128,
    pub live: u32,
    pub live_gens: u64,
    pub unpaid_gens: u64,
    pub plants: u32,
    pub licensed: u32,
    pub failed: u32,
    /// Part 2: sales and transfers refused by kept PETRI, PETRI moved to another account by transfer, and pacts.
    pub kept_refused: u32,
    pub kept_left: u128,
    /// NEAR the vault paid for PETRI earned before the seller's first NEAR (or bought with credit, or moved to it by a
    /// guest's transfer).
    pub farm_sold: u128,
    pub moved: u128,
    pub pact_paid: u128,
    pub pact_in: u128,
    pub pact_refused: u32,
    pub pact_diverted: u32,
    /// Economics report: the NEAR the player set out with, NEAR it put into the vault, PETRI bought, and its books a day
    /// after it joined (summed over its colonies; `day1_n` colonies had a full first day inside the run).
    pub budget: u128,
    pub vault_in: u128,
    pub bought: u128,
    pub day1: Snap,
    pub day1_n: usize,
}

impl GroupOut {
    pub fn withdrawn(&self) -> f64 {
        nf(self.claimed + self.sold + self.bounty + self.reclaimed)
    }
    pub fn paid(&self) -> f64 {
        nf(self.attached + self.sponsored + self.gas)
    }
    pub fn cash(&self) -> f64 {
        self.withdrawn() - self.paid()
    }
    /// Cash plus NEAR still owed and PETRI held at the sell-back floor.
    pub fn paper(&self) -> f64 {
        self.cash() + nf(self.owed + self.held)
    }
}

#[derive(Clone, Default)]
pub struct WorldOut {
    pub live: u32,
    pub peak: u32,
    pub agar: u128,
    pub burned: u128,
    pub fed: u128,
    pub vault: u128,
    pub credit_pool: u128,
    pub credit_outstanding: u128,
    pub tides_owed: u128,
    pub held_total: u128,
    pub near_attached: u128,
    pub near_sponsored: u128,
    pub vault_in: u128,
    pub credit_in: u128,
    pub tides_paid: u128,
    pub tides_as_credit: u128,
    pub credit_paid: u128,
    pub bounties: u128,
    pub bounties_kept: u128,
    pub bounties_credit: u128,
    pub sold_total: u128,
    pub credit_sold: u128,
    pub reclaimed_total: u128,
    pub claimed_total: u128,
    pub royalties: u128,
    pub storage_players: u128,
    pub storage_vault: u128,
    pub storage_contract: i128,
    pub keeper: Keeper,
    pub keeper_pot: u128,
    pub relayer_near: u128,
    pub relayer_gas: u128,
    pub house_paid: u128,
    pub house_attached: u128,
    pub house_left: u128,
    pub house_out_of_near_day: Option<u64>,
    pub work_live_avg: f64,
    pub work_alive_avg: f64,
    pub calls: u64,
    pub gas_total: f64,
    /// Per call: the largest gas (counting each NEAR payout's 30 TGas reservation), with and without a tide in its
    /// catch-up; calls over their prepaid gas; counts.
    pub gas_max: [[f64; 2]; 9],
    pub gas_rows_at_max: [[usize; 2]; 9],
    pub over_prepaid: [u64; 9],
    pub call_count: [u64; 9],
    pub hot_max: usize,
    pub hot_avg: f64,
    pub partial_catchups: u64,
    pub plant_fail_behind: u64,
    /// v6.1: plantings refused because the hot table held `MAX_PLAYING` rows.
    pub plant_refused_full: u64,
    /// Calls over the 150 TGas target (payout reservations included), per call kind.
    pub over_target: [u64; 9],
    /// Rows that left the hot table.
    pub hot_left: u64,
    /// v6.1: royalties that planters which never attached NEAR paid to the agar.
    pub royalties_to_agar: u128,
    pub skips: u64,
    pub skipped: u64,
    pub tides: u64,
    pub tides_skipped: u64,
    pub gen_end: u64,
    pub first_share: f64,
    pub first_tides90: f64,
    pub tides_paying: u64,
    pub top_share: f64,
    pub top_kind: Option<Kind>,
    pub house_to_players_petri: u128,
    pub secs: f64,
    /// Economics report: NEAR into the vault from the house, NEAR the vault paid players and the house's pro-rata part.
    pub vault_in_house: u128,
    pub out_players: u128,
    pub out_house: u128,
    pub vault_house: u128,
}

pub struct RunOut {
    pub groups: Vec<GroupOut>,
    pub world: WorldOut,
    pub timeline: Vec<TideRow>,
    pub days: Vec<DayRow>,
    pub slides: Vec<SlideRec>,
}

/// One society entry: kind, players, colonies per player, joining between these days.
#[derive(Clone)]
pub struct Spec {
    pub kind: Kind,
    pub players: usize,
    pub per: usize,
    pub from_day: f64,
    pub to_day: f64,
}

pub type Society = Vec<Spec>;

pub fn spec(kind: Kind, players: usize, per: usize) -> Spec {
    let (from_day, to_day) = match kind {
        Kind::Late => (2.0, 3.0),
        Kind::Locker | Kind::Racer | Kind::House | Kind::Bench | Kind::Farmer => (0.0, 0.0),
        Kind::Sniper | Kind::Seller => (0.0, 240.0 / 5760.0),
        _ => (0.0, 1.0),
    };
    Spec { kind, players, per, from_day, to_day }
}

#[derive(Clone)]
pub struct Setup {
    pub net: Net,
    pub days: u64,
    /// NEAR each house strain holds for the dish (mainnet: attached; testnet: sponsored credit).
    pub house_budget: u128,
    pub keeper_on: bool,
    /// Testnet keeper registered for PETRI (it then also advances whenever the pot holds over 50 PETRI).
    pub keeper_registered: bool,
    /// Players plant under a slide's licence whenever one exists for the pattern they plant.
    pub licences: bool,
}

pub struct World {
    pub r: Rules,
    pub s: Setup,
    k: u128,
    w: i32,
    h: i32,
    d: Dish,
    rng: Rng,
    pub accts: Vec<Acct>,
    groups: usize,
    racers: Vec<usize>,
    house: Vec<ColonyId>,
    total: u64,
    n_col: usize,
    stake: Vec<u64>,
    window: Vec<u64>,
    win_list: Vec<ColonyId>,
    live: Vec<u32>,
    hot: Vec<bool>,
    /// 1 + the generation of each colony's last planting (its cells are on the board but not yet stepped).
    planted_at: Vec<u64>,
    hot_rows: usize,
    alive: Vec<(ColonyId, u32)>,
    gen: u64,
    skipped: u64,
    t: u64,
    counted: u32,
    total_live: u32,
    agar: u128,
    burned: u128,
    fed: u128,
    vault: u128,
    credit_pool: u128,
    sell_left: u128,
    keeper_pot: u128,
    // The current transaction.
    caller: Payer,
    prepaid: f64,
    unbilled_gas: f64,
    unbilled_bounty: u128,
    unbilled_gens: u64,
    unbilled_tide: bool,
    unbilled_flushed: usize,
    billed_gen: u64,
    // Totals.
    near_attached: u128,
    near_sponsored: u128,
    vault_in: u128,
    credit_in: u128,
    tides_paid: u128,
    tides_as_credit: u128,
    credit_paid: u128,
    bounties: u128,
    bounties_kept: u128,
    bounties_credit: u128,
    sold_total: u128,
    credit_sold: u128,
    reclaimed_total: u128,
    claimed_total: u128,
    royalties: u128,
    storage_players: u128,
    storage_vault: u128,
    storage_contract: i128,
    keeper: Keeper,
    relayer_near: u128,
    tides: u64,
    tides_skipped: u64,
    tides_today: (u64, u64),
    skips: u64,
    peak_live: u32,
    work_gens: u64,
    work_live: u64,
    work_alive: u64,
    hot_sum: u64,
    hot_samples: u64,
    hot_max: usize,
    calls: u64,
    gas_total: f64,
    gas_max: [[f64; 2]; 9],
    gas_rows_at_max: [[usize; 2]; 9],
    over_prepaid: [u64; 9],
    call_count: [u64; 9],
    partial_catchups: u64,
    plant_fail_behind: u64,
    plant_refused_full: u64,
    over_target: [u64; 9],
    hot_left: u64,
    royalties_to_agar: u128,
    first_outsider: Option<ColonyId>,
    first_share_sum: u128,
    first_tides90: u64,
    tides_paying: u64,
    tide_split_sum: u128,
    house_out_day: Option<u64>,
    house_plants_today: u32,
    slides: Vec<SlideRec>,
    by_pat: Vec<Vec<usize>>,
    /// Accepted pacts: (payer, promisor, until), as account indices.
    pacts: Vec<(usize, usize, u64)>,
    timeline: Vec<TideRow>,
    days: Vec<DayRow>,
    // Economics report (read only): the house's part of the vault, NEAR in from the house, NEAR paid to players and
    // the house's part of it, the house's part of bounties not yet paid.
    vault_h: u128,
    vault_in_h: u128,
    out_players: u128,
    out_h: u128,
    unbilled_bounty_h: u128,
}

pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        Rng((z ^ (z >> 31)) | 1)
    }
    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    pub fn range(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    pub fn shuffle<T>(&mut self, v: &mut [T]) {
        for i in (1..v.len()).rev() {
            let j = self.range(i as u64 + 1) as usize;
            v.swap(i, j);
        }
    }
}

/// A pattern's cells at (x, y) on a w x h wrapped dish, turned `rot` quarter turns.
pub fn shape_cells(w: i32, h: i32, shape: &[(i32, i32)], x: i32, y: i32, rot: u8) -> Vec<u32> {
    shape
        .iter()
        .map(|&(dx, dy)| {
            let (mut a, mut b) = (dx, dy);
            for _ in 0..rot {
                let t = a;
                a = -b;
                b = t;
            }
            (((y + b).rem_euclid(h)) * w + (x + a).rem_euclid(w)) as u32
        })
        .collect()
}

/// Where a newcomer can plant without siege: (share of single cells, share of 2x2 block positions). A cell is open if
/// it is empty and no living cell of a non-house colony is within `b` in both directions.
pub fn lockout(d: &Dish, b: i32, house: &[ColonyId]) -> (f64, f64) {
    let w = d.width as usize;
    let h = d.height as usize;
    let n = w * h;
    let mut row = vec![false; n];
    for y in 0..h {
        for x in 0..w {
            let c = d.cells[y * w + x];
            if c != EMPTY && !house.contains(&c) {
                for dx in -b..=b {
                    row[y * w + (x as i32 + dx).rem_euclid(w as i32) as usize] = true;
                }
            }
        }
    }
    let mut near = vec![false; n];
    for y in 0..h {
        for x in 0..w {
            if row[y * w + x] {
                for dy in -b..=b {
                    near[(y as i32 + dy).rem_euclid(h as i32) as usize * w + x] = true;
                }
            }
        }
    }
    let open: Vec<bool> = (0..n).map(|i| !near[i] && d.cells[i] == EMPTY).collect();
    let free = open.iter().filter(|&&o| o).count();
    let mut blocks = 0;
    for y in 0..h {
        for x in 0..w {
            let at = |dx: usize, dy: usize| open[((y + dy) % h) * w + (x + dx) % w];
            if at(0, 0) && at(1, 0) && at(0, 1) && at(1, 1) {
                blocks += 1;
            }
        }
    }
    (free as f64 / n as f64, blocks as f64 / n as f64)
}

fn split_after_storage(attached: u128, credit: u128, storage: u128) -> (u128, u128) {
    let from_credit = storage.min(credit);
    (attached - (storage - from_credit), credit - from_credit)
}

/// House strains in agents/run.mjs order: temperament, every (generations, before the pace), cap on own cells.
const STRAINS: [(u8, u64, u64, u32); 5] = [(0, 40, 80, 420), (1, 40, 70, 420), (2, 50, 90, 420), (3, 40, 80, 420), (4, 60, 100, 220)];
/// The bench (testnet): gardener, wanderer, raider.
const BENCH: [(u8, u64, u64, u32); 3] = [(0, 30, 60, 420), (3, 30, 60, 420), (1, 40, 70, 420)];
/// agents: MIN_NEAR, TOP_UP_NEAR, JOIN_NEAR, DAILY_PETRI, SMALL_MOVE.
const HOUSE_MIN_NEAR: u128 = 12 * NEAR / 100;
const HOUSE_TOP_UP: u128 = 2 * NEAR / 100;
const HOUSE_JOIN: u128 = 5 * NEAR / 100;
const HOUSE_DAILY_PETRI: u128 = 100 * UNIT;
const HOUSE_SMALL_MOVE: u128 = 10 * UNIT;

impl World {
    pub fn new(r: Rules, s: Setup, society: &Society, seed: u64) -> Self {
        let mut rng = Rng::new(seed);
        let gpd = r.gens_per_day();
        let total = s.days * gpd;
        let (w, h) = (r.width as i32, r.height as i32);
        let mut accts: Vec<Acct> = Vec::new();
        let mut group = 0usize;
        let mut relayer_near = 0u128;
        let mut house_n = 0usize;
        let mut bench_n = 0usize;
        for sp in society {
            let kind = sp.kind;
            for _ in 0..sp.players {
                let ghome = (rng.range(w as u64) as i32, rng.range(h as u64) as i32);
                let span = ((sp.to_day - sp.from_day) * gpd as f64) as u64;
                let gjoin = (sp.from_day * gpd as f64) as u64 + rng.range(span.max(1));
                for j in 0..sp.per {
                    let role = match kind {
                        Kind::Guest => Role::Guest,
                        Kind::SybilGuest | Kind::SybilRoyalty | Kind::SybilAttach | Kind::SybilTransfer => {
                            if j == 0 {
                                Role::Wallet
                            } else {
                                Role::Guest
                            }
                        }
                        Kind::SelfSponsor => Role::Sub,
                        _ => Role::Wallet,
                    };
                    let join_at = match kind {
                        Kind::SplitWhale => gjoin + rng.range(gpd / 2),
                        Kind::SybilGuest | Kind::SybilRoyalty | Kind::SybilAttach | Kind::SybilTransfer | Kind::SelfSponsor => gjoin + 3 * j as u64,
                        Kind::House => rng.range(6),
                        _ => gjoin,
                    };
                    let home = match kind {
                        Kind::SybilGuest | Kind::SybilRoyalty | Kind::SybilAttach | Kind::SybilTransfer | Kind::SelfSponsor => (ghome.0 + rng.range(41) as i32 - 20, ghome.1 + rng.range(41) as i32 - 20),
                        _ => (rng.range(w as u64) as i32, rng.range(h as u64) as i32),
                    };
                    let every = match kind {
                        Kind::Methuselah => 240,
                        Kind::Whale => 2 + rng.range(5),
                        Kind::SplitWhale => 20 + rng.range(40),
                        Kind::Penny => 30,
                        _ => 20 + rng.range(100),
                    };
                    let bring = match kind {
                        Kind::Penny => r.min_join,
                        Kind::Whale => 2 * NEAR,
                        Kind::SplitWhale => (2 * NEAR / sp.per as u128).max(NEAR / 100),
                        Kind::Methuselah => NEAR / 10,
                        Kind::Locker => 3 * NEAR / 2,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        Kind::Farmer => 3 * NEAR / 10,
                        Kind::House | Kind::Bench => HOUSE_JOIN,
                        Kind::Guest | Kind::SelfSponsor => NEAR / 50,
                        Kind::SybilGuest | Kind::SybilRoyalty | Kind::SybilAttach | Kind::SybilTransfer => {
                            if j == 0 {
                                NEAR / 20
                            } else {
                                NEAR / 50
                            }
                        }
                        _ => NEAR / 20,
                    };
                    let wallet = match kind {
                        Kind::Penny => NEAR / 20,
                        Kind::Whale => 3 * NEAR,
                        Kind::SplitWhale => 3 * NEAR / sp.per as u128,
                        Kind::Methuselah => NEAR / 2,
                        Kind::Locker => 2 * NEAR,
                        Kind::Racer => NEAR / 100,
                        Kind::Seller => NEAR / 5,
                        Kind::Farmer => 6 * NEAR / 10,
                        Kind::House => {
                            if s.net == Net::Mainnet {
                                s.house_budget
                            } else {
                                0
                            }
                        }
                        Kind::Bench => NEAR,
                        Kind::Guest => 0,
                        // A sub-account's wallet is the operator's NEAR for its one-off attach and gas.
                        Kind::SelfSponsor => NEAR / 50,
                        Kind::SybilGuest | Kind::SybilRoyalty | Kind::SybilAttach | Kind::SybilTransfer => {
                            if j == 0 {
                                NEAR / 4
                            } else {
                                0
                            }
                        }
                        _ => NEAR / 4,
                    };
                    let name_len = match role {
                        Role::Guest => L_GUEST,
                        Role::Sub => L_SUB,
                        Role::Wallet => {
                            if kind == Kind::House {
                                L_HOUSE
                            } else {
                                L_WALLET
                            }
                        }
                    };
                    let mut a = Acct {
                        kind: Some(kind),
                        role: Some(role),
                        group,
                        home,
                        join_at,
                        every,
                        phase: rng.range(240),
                        name_len,
                        bring,
                        wallet,
                        budget: wallet,
                        credit_stop: u64::MAX,
                        cap: 420,
                        ..Default::default()
                    };
                    if kind == Kind::House {
                        let (t, lo, hi, cap) = STRAINS[house_n % 5];
                        house_n += 1;
                        a.temper = t;
                        a.cap = cap;
                        a.every = lo * 1000 + hi;
                        a.floor = if s.net == Net::Mainnet { HOUSE_MIN_NEAR } else { 0 };
                        a.next_at = join_at + 1 + rng.range(6);
                    }
                    if kind == Kind::Bench {
                        let (t, lo, hi, cap) = BENCH[bench_n % 3];
                        bench_n += 1;
                        a.temper = t;
                        a.cap = cap;
                        a.every = lo * 1000 + hi;
                        a.next_at = join_at + 1 + rng.range(6);
                    }
                    // Sponsorship: a relayer gives each guest 0.05 NEAR (and 0.003 for its account); a self-sponsor
                    // pays 0.05 NEAR into each sub-account's grant; testnet house strains hold sponsored credit.
                    let ls = match role {
                        Role::Guest => L_RELAYER,
                        _ => L_WALLET,
                    };
                    let fresh = sponsor_bytes(name_len, ls, true, true) * BYTE;
                    match role {
                        Role::Guest => {
                            a.grant = NEAR / 20 - fresh;
                            relayer_near += NEAR / 20 + 3 * NEAR / 1_000;
                        }
                        Role::Sub => {
                            a.grant = NEAR / 20 - fresh;
                            a.grant_mine = true;
                            a.sponsored_paid = NEAR / 20;
                            if total > 2 * RECLAIM_AFTER {
                                a.credit_stop = total - RECLAIM_AFTER - 60;
                            }
                        }
                        Role::Wallet => {
                            if kind == Kind::House && s.net == Net::Testnet {
                                a.grant = s.house_budget - fresh;
                            }
                        }
                    }
                    a.grant_at = join_at;
                    if kind == Kind::Locker {
                        let (ox, oy) = (rng.range(8) as i32, rng.range(8) as i32);
                        for (ax, ay) in [(0, 0), (4, 4), (4, 0), (0, 4)] {
                            for jy in 0..h / 8 {
                                for ix in 0..w / 8 {
                                    a.spots.push((ox + ax + 8 * ix, oy + ay + 8 * jy));
                                }
                            }
                        }
                        a.lattice_len = ((w / 8) * (h / 8)) as usize;
                    }
                    accts.push(a);
                }
                group += 1;
            }
        }
        accts.sort_by_key(|a| (a.join_at, a.kind() != Kind::House));
        for (i, a) in accts.iter_mut().enumerate() {
            a.id = i as ColonyId + 1;
        }
        let house = accts.iter().filter(|a| a.kind() == Kind::House).map(|a| a.id).collect();
        let racers = accts.iter().enumerate().filter(|(_, a)| a.kind() == Kind::Racer).map(|(i, _)| i).collect();
        let n = accts.len();
        let k = r.k();
        let d = Dish::new(r.width, r.height);
        World {
            agar: r.max_supply,
            k,
            w,
            h,
            d,
            rng,
            accts,
            groups: group,
            racers,
            house,
            total,
            n_col: 0,
            stake: vec![0; n + 1],
            window: vec![0; n + 1],
            win_list: Vec::new(),
            live: vec![0; n + 1],
            hot: vec![false; n + 1],
            planted_at: vec![0; n + 1],
            hot_rows: 0,
            alive: Vec::new(),
            gen: 0,
            skipped: 0,
            t: 0,
            counted: 0,
            total_live: 0,
            burned: 0,
            fed: 0,
            vault: 0,
            credit_pool: 0,
            sell_left: 0,
            keeper_pot: 0,
            caller: Payer::Keeper,
            prepaid: 200_000.0,
            unbilled_gas: 0.0,
            unbilled_bounty: 0,
            unbilled_gens: 0,
            unbilled_tide: false,
            unbilled_flushed: 0,
            billed_gen: 0,
            near_attached: 0,
            near_sponsored: 0,
            vault_in: 0,
            credit_in: 0,
            tides_paid: 0,
            tides_as_credit: 0,
            credit_paid: 0,
            bounties: 0,
            bounties_kept: 0,
            bounties_credit: 0,
            sold_total: 0,
            credit_sold: 0,
            reclaimed_total: 0,
            claimed_total: 0,
            royalties: 0,
            storage_players: 0,
            storage_vault: 0,
            storage_contract: 0,
            keeper: Keeper::default(),
            relayer_near,
            tides: 0,
            tides_skipped: 0,
            tides_today: (0, 0),
            skips: 0,
            peak_live: 0,
            work_gens: 0,
            work_live: 0,
            work_alive: 0,
            hot_sum: 0,
            hot_samples: 0,
            hot_max: 0,
            calls: 0,
            gas_total: 0.0,
            gas_max: [[0.0; 2]; 9],
            gas_rows_at_max: [[0; 2]; 9],
            over_prepaid: [0; 9],
            call_count: [0; 9],
            partial_catchups: 0,
            plant_fail_behind: 0,
            plant_refused_full: 0,
            over_target: [0; 9],
            hot_left: 0,
            royalties_to_agar: 0,
            first_outsider: None,
            first_share_sum: 0,
            first_tides90: 0,
            tides_paying: 0,
            tide_split_sum: 0,
            house_out_day: None,
            house_plants_today: 0,
            slides: Vec::new(),
            by_pat: vec![Vec::new(); PATS],
            pacts: Vec::new(),
            timeline: Vec::new(),
            days: Vec::new(),
            vault_h: 0,
            vault_in_h: 0,
            out_players: 0,
            out_h: 0,
            unbilled_bounty_h: 0,
            r,
            s,
        }
    }

    fn is_house_payer(&self, p: Payer) -> bool {
        match p {
            Payer::Keeper => true,
            Payer::Acct(i) => self.accts[i].kind() == Kind::House,
        }
    }

    // ---------- gas ----------

    fn board_bytes(&self) -> u128 {
        let words = (self.r.width as u128 + 63) / 64;
        8 * words * self.r.height as u128 + 2 * self.total_live as u128
    }

    fn board_rw(&self) -> f64 {
        2.0 * G_SOP + self.board_bytes() as f64 * (G_RB + G_WB) + 30.0 * self.total_live as f64 * G_OP
    }

    fn hot_load(&self) -> f64 {
        let p = self.hot_rows as f64;
        2.0 * G_SOP + p * HOT_ROW as f64 * G_RB + p * W_LOAD_ROW * G_OP
    }

    fn hot_store(&self, feed: bool, purse: bool) -> f64 {
        let p = self.hot_rows as f64;
        let mut g = 0.0;
        if feed && p > 0.0 {
            g += G_SOP + p * HOT_FEED as f64 * G_WB + p * W_STORE_FEED_ROW * G_OP;
        }
        if purse && p > 0.0 {
            g += G_SOP + p * HOT_PURSE as f64 * G_WB + p * W_STORE_PURSE_ROW * G_OP;
        }
        g
    }

    fn v6(&self) -> bool {
        self.r.layout_v6
    }

    /// Colony `id`'s cold page, in bytes, as long as it is now.
    fn cold_len(&self, id: ColonyId) -> f64 {
        let (pg, cl) = (page(self.v6()), cold(self.v6()));
        let i = id as usize - 1;
        let len = if i / pg == (self.n_col.max(1) - 1) / pg { (self.n_col - 1) % pg + 1 } else { pg };
        (len as u128 * cl) as f64
    }

    /// A cold page read and written back (colony `id`'s page as long as it is now).
    fn cold_rw(&self, id: ColonyId) -> f64 {
        2.0 * G_SOP + self.cold_len(id) * (G_RB + G_WB)
    }

    /// A cold page read.
    fn cold_read(&self, id: ColonyId) -> f64 {
        G_SOP + self.cold_len(id) * G_RB
    }

    fn gen_gas(&self, live: u32, alive: usize, chain: bool) -> f64 {
        let l = live as f64;
        let mut g = (20_000.0 + 60.0 * l + 150.0 * alive as f64) * G_OP;
        if chain {
            g += 4.5 + self.board_bytes() as f64 * G_SHA_BYTE + 20.0 * l * G_OP;
        }
        g
    }

    /// Bill a transaction: its own work, the catch-up its call ran (one board load and store, the hot table loaded
    /// once and written back once with every change), any tide bounty that catch-up earned, and its NEAR payouts.
    #[allow(clippy::too_many_arguments)]
    fn bill(&mut self, p: Payer, call: Call, base: f64, need_hot: bool, feed_dirty: bool, purse_dirty: bool, payouts: u32) {
        let gens = std::mem::take(&mut self.unbilled_gens);
        let tide = std::mem::take(&mut self.unbilled_tide);
        let flushed = std::mem::take(&mut self.unbilled_flushed);
        let catch = gens > 0;
        let mut g = base + std::mem::take(&mut self.unbilled_gas);
        if catch {
            g += self.board_rw() + 4.0 * G_SOP;
        }
        if catch || need_hot {
            g += self.hot_load();
        }
        g += self.hot_store(feed_dirty || catch, purse_dirty || tide || flushed > 0);
        if flushed > 0 {
            g += flushed as f64 * (2.0 * G_SOP + (page(self.v6()) as u128 * cold(self.v6())) as f64 * (G_RB + G_WB));
        }
        let mut payouts = payouts;
        let bounty = std::mem::take(&mut self.unbilled_bounty);
        let bounty_h = std::mem::take(&mut self.unbilled_bounty_h);
        if bounty > 0 {
            match p {
                // A tide run by a house colony or a keeper pays no bounty: it stays in the vault.
                _ if self.is_house_payer(p) => {
                    self.vault += bounty;
                    self.vault_h += bounty_h;
                    self.bounties_kept += bounty;
                }
                Payer::Acct(i) => {
                    self.out_players += bounty;
                    self.out_h += bounty_h;
                    let a = &mut self.accts[i];
                    if !a.attached_flag {
                        a.won += bounty;
                        a.credit_won += bounty;
                        self.bounties_credit += bounty;
                    } else {
                        a.bounty += bounty;
                        a.wallet += bounty;
                        self.bounties += bounty;
                        payouts += 1;
                    }
                }
                Payer::Keeper => unreachable!(),
            }
        }
        // Fix experiment: the keeper pot goes to whoever's call ran a generation.
        if self.r.pot_any_call && catch && self.keeper_pot > 0 {
            if let Payer::Acct(i) = p {
                // Part 2: free play takes no keeper pot.
                if self.accts[i].kind() != Kind::House && !(self.r.kept_rule && !self.accts[i].attached_flag) {
                    let pot = std::mem::take(&mut self.keeper_pot);
                    self.accts[i].balance += pot;
                    self.accts[i].pot += pot;
                }
            }
        }
        self.billed_gen = self.gen;
        let burn = g + payouts as f64 * G_PAYOUT_BURN;
        let limit = g + payouts as f64 * G_PAYOUT_RESERVE;
        let house = self.is_house_payer(p);
        let c = call.idx();
        let ti = tide as usize;
        self.call_count[c] += 1;
        if limit > self.gas_max[c][ti] {
            self.gas_max[c][ti] = limit;
            self.gas_rows_at_max[c][ti] = self.hot_rows;
        }
        if limit > call.prepaid(house, self.r.site_gas_v6) {
            self.over_prepaid[c] += 1;
        }
        if limit > G_TARGET {
            self.over_target[c] += 1;
        }
        self.calls += 1;
        self.gas_total += burn;
        let y = (burn * YOCTO_PER_GGAS) as u128;
        match p {
            Payer::Acct(i) => {
                let a = &mut self.accts[i];
                if a.role() == Role::Guest {
                    a.relayer_gas += y;
                } else {
                    a.gas += y;
                    a.wallet = a.wallet.saturating_sub(y);
                }
            }
            Payer::Keeper => {
                self.keeper.gas += y;
                self.keeper.calls += 1;
            }
        }
    }

    // ---------- economics report (read only) ----------

    /// The house's pro-rata part of `x` yoctoNEAR leaving the vault now.
    fn house_part(&self, x: u128) -> u128 {
        if self.vault == 0 || self.vault_h == 0 {
            0
        } else {
            wide_mul_div(self.vault_h, x, self.vault).min(self.vault_h)
        }
    }

    /// `near` entered the vault from account `i`.
    fn inflow(&mut self, i: usize, near: u128) {
        self.accts[i].vault_in += near;
        if self.accts[i].kind() == Kind::House {
            self.vault_h += near;
            self.vault_in_h += near;
        }
    }

    /// A 0.05 NEAR round trip now: (PETRI bought, the curve's sell-back for them, the sell-back paid).
    pub fn round_trip(&self) -> (u128, u128, u128) {
        let near = NEAR / 20 - buy_bytes(self.v6()) * BYTE;
        let units = petri_for_near(near, self.agar, self.k);
        let (agar, vault, out) = (self.agar - units, self.vault + near, self.outstanding() + units);
        let curve = near_for_petri(units, agar, self.k, self.r.sell_bps);
        let back = sell_back(units, agar, self.k, self.r.sell_bps, vault, out);
        (units, curve, back)
    }

    /// The account's books now.
    fn snap(&self, i: usize) -> Snap {
        let a = &self.accts[i];
        let units = a.balance + a.unclaimed;
        let held_value = if units > 0 { self.sell_quote(units).saturating_sub(sell_bytes(self.v6()) * BYTE) } else { 0 };
        Snap {
            attached: a.attached,
            gas: a.gas,
            bought: a.bought,
            join_units: a.join_units,
            fed: a.earned,
            spent: a.spent,
            tide: a.tide_share,
            claimed: a.claimed,
            sold: a.sold,
            bounty: a.bounty,
            owed: a.owed,
            held_units: units,
            held_value,
            plants: a.plants,
            live: self.live.get(a.id as usize).copied().unwrap_or(0),
        }
    }

    // ---------- the contract ----------

    fn due(&self) -> u64 {
        self.t - self.skipped
    }

    fn per_cell(&self) -> u128 {
        feed_per_cell(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.counted, self.r.live_floor)
    }

    pub fn cost(&self, cells: u32, siege: bool) -> u128 {
        planting_cost(self.per_cell(), self.r.payback, self.r.min_cell_price, cells, siege, self.r.siege_x)
    }

    fn outstanding(&self) -> u128 {
        (self.r.max_supply - self.burned) - self.agar
    }

    fn sell_quote(&self, units: u128) -> u128 {
        sell_back(units, self.agar, self.k, self.r.sell_bps, self.vault, self.outstanding())
    }

    /// The deposit `plant_deposit` asks for (the planter's own licence slot included).
    fn plant_deposit(&self, i: usize, cells: u32, note: Option<u128>, slide: Option<usize>) -> u128 {
        let holder = slide.map(|s| self.accts[self.slides[s].holder].name_len);
        let _ = i;
        plant_deposit_bytes(cells as u128, note, holder, self.hot_rows == 0, self.v6()) * BYTE + self.r.cell_fee * cells as u128
    }

    /// Set the current transaction before its catch-up.
    fn begin(&mut self, p: Payer, call: Call) {
        self.caller = p;
        self.prepaid = call.prepaid(self.is_house_payer(p), self.r.site_gas_v6);
    }

    /// `catch_up(max_catchup)`: skip ahead if dormant, then step up to `max_catchup` due generations, stopping after
    /// the generation that crosses the call's gas limit. The gas is billed to the call. Returns generations run.
    fn catch_up(&mut self) -> u64 {
        let mut due = self.due();
        if due > self.gen + self.r.max_lag {
            let skip = due - self.gen - self.r.max_catchup;
            self.skipped += skip;
            self.skips += 1;
            self.storage_contract += (SKIP_BYTES * BYTE) as i128;
            due = self.due();
        }
        // Generations an earlier look already stepped belong to the same (next) transaction: together at most
        // `max_catchup`.
        let room = self.r.max_catchup.saturating_sub(self.unbilled_gens);
        if self.gen >= due || room == 0 {
            return 0;
        }
        let target = due.min(self.gen + room);
        let from = self.gen;
        let board_before = self.board_bytes();
        // v6: limit = min(180, prepaid - 40 - writing the whole hot table back). v6.1: min(110, prepaid - 40 - the feed
        // part, the purse part only when a tide falls in the catch-up, and the cold pages rows may leave to).
        let limit = if self.v6() {
            let store = self.hot_rows as f64 * HOT_ROW as f64 * G_HOT_WRITE_BYTE;
            G_CATCHUP_LIMIT.min(self.prepaid - G_RESERVE - store)
        } else {
            let te = self.r.tide_every;
            let tide_ahead = (self.gen / te + 1) * te <= target;
            let rows = self.hot_rows as f64;
            let store = rows * HOT_FEED as f64 * G_HOT_WRITE_BYTE_V61 + if tide_ahead { rows * HOT_PURSE as f64 * G_HOT_WRITE_BYTE_V61 } else { 0.0 } + FLUSH_MAX as f64 * G_FLUSH_PAGE_RESERVE;
            G_CATCHUP_LIMIT_V61.min(self.prepaid - G_RESERVE - store)
        };
        let used0 = G_CALL + self.unbilled_gas + if self.unbilled_gens == 0 { self.hot_load() + 2.0 * G_SOP + self.board_bytes() as f64 * G_RB } else { 0.0 };
        let mut g = 0.0;
        while self.gen < target {
            g += self.gen_step();
            if used0 + g > limit && self.gen < target {
                self.partial_catchups += 1;
                break;
            }
        }
        // Rows leave the hot table, lowest ids first. v6: once the stake is gone (16 a call). v6.1: once the row has no
        // window and either no living cells or a stake that can no longer earn (32 a call); the stake waits in the cold
        // slot.
        g += self.hot_rows as f64 * W_FLUSH_SCAN_ROW * G_OP;
        let pages = self.flush(if self.v6() { 16 } else { FLUSH_MAX });
        self.unbilled_flushed += pages;
        self.storage_contract += (self.board_bytes() as i128 - board_before as i128) * BYTE as i128;
        self.unbilled_gas += g;
        self.unbilled_gens += self.gen - from;
        self.gen - from
    }

    /// Whether hot row `c` may leave now. Returns the cold pages written.
    fn may_leave(&self, c: usize) -> bool {
        if !self.hot[c] || self.window[c] != 0 {
            return false;
        }
        if self.v6() {
            self.stake[c] == 0 || self.stake[c] < self.r.hot_evict_stake
        } else {
            (self.live[c] == 0 && self.planted_at[c] != self.gen + 1) || petri_core::feed_weight(1, self.stake[c], self.r.reach) == 0
        }
    }

    /// Move up to `max` rows that may leave back to their cold slots. Returns the cold pages written.
    fn flush(&mut self, max: usize) -> usize {
        let pg_of = page(self.v6());
        let mut moved = 0;
        let mut pages: Vec<usize> = Vec::new();
        for c in 1..=self.n_col {
            if moved >= max {
                break;
            }
            if self.may_leave(c) {
                if self.v6() {
                    self.stake[c] = 0;
                }
                self.hot[c] = false;
                self.hot_rows -= 1;
                self.hot_left += 1;
                moved += 1;
                self.storage_contract -= (HOT_ROW * BYTE) as i128;
                if self.hot_rows == 0 {
                    self.storage_contract -= (HOT_RECORDS * BYTE) as i128;
                }
                let pg = (c - 1) / pg_of;
                if !pages.contains(&pg) {
                    pages.push(pg);
                }
            }
        }
        pages.len()
    }

    /// One generation: Life, the capped feed (never the house) into unclaimed earnings, the window and the keeper pot,
    /// and the tide when due and someone outside the house earned. Returns its gas.
    fn gen_step(&mut self) -> f64 {
        let (live, total) = self.d.step_sparse();
        self.gen += 1;
        for &(c, _) in &self.alive {
            self.live[c as usize] = 0;
        }
        for &(c, n) in &live {
            self.live[c as usize] = n;
            let a = &mut self.accts[c as usize - 1];
            a.live_gens += n as u64;
            if a.kind() != Kind::House {
                let cap = (self.stake[c as usize] as u128 * self.r.reach as u128 / STAKE_UNIT as u128) as u64;
                a.unpaid_gens += (n as u64).saturating_sub(cap);
            }
        }
        self.total_live = total;
        self.peak_live = self.peak_live.max(total);
        let f = feed_sparse(self.agar, self.r.feed_ppm, self.r.keeper_bps, self.r.reach, self.r.live_floor, &live, &self.stake, &self.house);
        self.counted = f.weight;
        if f.paid > 0 {
            for &(c, s) in &f.shares {
                let a = &mut self.accts[c as usize - 1];
                a.unclaimed += s;
                a.earned += s;
                if self.window[c as usize] == 0 {
                    self.win_list.push(c);
                }
                self.window[c as usize] += s as u64;
            }
            self.agar -= f.paid;
            self.keeper_pot += f.keeper;
            self.fed += f.paid;
        }
        let chain = self.gen % 16 == 0;
        let mut g = self.gen_gas(total, live.len(), chain);
        self.work_gens += 1;
        self.work_live += total as u64;
        self.work_alive += live.len() as u64;
        self.hot_sum += self.hot_rows as u64;
        self.hot_samples += 1;
        self.hot_max = self.hot_max.max(self.hot_rows);
        self.alive = live;
        if self.gen % self.r.tide_every == 0 {
            g += self.tide();
        }
        g
    }

    /// One tide, as `Petri::tide`, or nothing when no colony outside the house earned since the last one. Returns its
    /// gas.
    fn tide(&mut self) -> f64 {
        let windows: Vec<(ColonyId, u64)> = {
            let mut v: Vec<(ColonyId, u64)> = self.win_list.iter().map(|&c| (c, self.window[c as usize])).collect();
            v.sort_unstable();
            v
        };
        let due = windows.iter().any(|&(c, w)| w > 0 && !self.house.contains(&c));
        let scan = self.hot_rows as f64 * 10.0 * G_OP;
        if !due {
            self.tides_skipped += 1;
            self.tides_today.1 += 1;
            self.tide_row(false, 0, 0, 0, 0, 0, 0.0, 0.0, scan);
            return scan;
        }
        let tide_bytes = self.r.tide_bytes(self.tides);
        let storage_cost = tide_bytes * BYTE;
        let pay = self.vault * self.r.tide_bps as u128 / 10_000;
        let full_bounty = (pay * self.r.tide_bounty_bps as u128 / 10_000).min(self.r.max_bounty);
        let storage = storage_cost.min(pay - full_bounty);
        let (mut split, mut total) = tide_split_sparse(pay - full_bounty - storage, &windows, &self.house);
        if self.r.tide_cap_bps < 10_000 {
            let cap = (pay - full_bounty - storage) * self.r.tide_cap_bps as u128 / 10_000;
            for s in split.iter_mut() {
                s.1 = s.1.min(cap);
            }
            total = split.iter().map(|s| s.1).sum();
        }
        let (mut paid, mut as_credit) = (0u128, 0u128);
        let first = self.first_outsider;
        let mut first_got = 0u128;
        let mut top = 0u128;
        for &(c, s) in &split {
            let a = &mut self.accts[c as usize - 1];
            a.tide_share += s;
            if a.attached_flag {
                a.owed += s;
                paid += s;
            } else {
                a.won += s;
                a.credit_won += s;
                as_credit += s;
            }
            if Some(c) == first {
                first_got = s;
            }
            top = top.max(s);
        }
        let bounty = if total > 0 { full_bounty } else { 0 };
        let storage = if total > 0 { storage } else { storage_cost.min(self.vault) };
        self.storage_vault += storage;
        self.storage_contract += (storage_cost - storage) as i128;
        {
            // Economics report: every NEAR out of the vault carries the house's share of the vault with it.
            let h_total = self.house_part(total);
            let h_bounty = self.house_part(bounty);
            let h_storage = self.house_part(storage);
            self.vault_h -= (h_total + h_bounty + h_storage).min(self.vault_h);
            self.out_players += total;
            self.out_h += h_total;
            self.unbilled_bounty_h += h_bounty;
        }
        self.vault -= total + bounty + storage;
        self.tides_paid += paid;
        self.tides_as_credit += as_credit;
        self.unbilled_bounty += bounty;
        self.tide_split_sum += total;
        self.first_share_sum += first_got;
        if total > 0 {
            self.tides_paying += 1;
            if first_got * 10 >= total * 9 {
                self.first_tides90 += 1;
            }
        }
        let credit_pay = self.credit_pool * self.r.tide_bps as u128 / 10_000;
        let (csplit, cpaid) = tide_split_sparse(credit_pay, &windows, &self.house);
        for &(c, s) in &csplit {
            let a = &mut self.accts[c as usize - 1];
            a.won += s;
            a.credit_won += s;
        }
        self.credit_pool -= cpaid;
        self.credit_paid += cpaid;
        self.tides += 1;
        self.tides_today.0 += 1;
        for &c in &self.win_list {
            self.window[c as usize] = 0;
        }
        self.win_list.clear();
        // Every stake decays: a hot row's at once, a cold slot's when it is next read (v6.1, the same numbers); in v6
        // only hot rows have any.
        for c in 1..=self.n_col {
            if self.stake[c] > 0 {
                self.stake[c] = decay_stake(self.stake[c], self.r.stake_keep_bps);
            }
        }
        self.sell_left = self.vault * self.r.sell_cap_bps as u128 / 10_000;
        self.unbilled_tide = true;
        let winners = split.len().max(csplit.len());
        let gas = 4.0 * G_SOP + tide_bytes as f64 * G_WB + self.hot_rows as f64 * W_TIDE_ROW * G_OP + winners as f64 * W_WINNER * G_OP + scan;
        let fs = if total > 0 { first_got as f64 / total as f64 } else { 0.0 };
        let ts = if total > 0 { top as f64 / total as f64 } else { 0.0 };
        self.tide_row(true, pay, total, storage, bounty, winners, fs, ts, gas);
        gas
    }

    #[allow(clippy::too_many_arguments)]
    fn tide_row(&mut self, ran: bool, pay: u128, split: u128, storage: u128, bounty: u128, winners: usize, first_share: f64, top_share: f64, gas: f64) {
        let (free, block_free) = lockout(&self.d, self.r.buffer as i32, &self.house);
        let siege = block_free == 0.0;
        let newcomer_petri = self.cost(4, siege);
        let deposit = plant_deposit_bytes(4, None, None, self.hot_rows == 0, self.v6()) * BYTE + 4 * self.r.cell_fee;
        let newcomer_near = newcomer_petri * self.k / self.agar + deposit;
        let siege_near = self.cost(4, true) * self.k / self.agar + deposit;
        let outsiders = self.accts.iter().filter(|a| a.joined && a.kind() != Kind::House && a.kind() != Kind::Bench).count();
        let (top_live_share, top_live_kind) = self.top_live();
        self.timeline.push(TideRow {
            gen: self.gen,
            wall: self.t,
            ran,
            live: self.total_live,
            counted: self.counted,
            agar: self.agar,
            vault: self.vault,
            credit_pool: self.credit_pool,
            per_cell_feed: self.per_cell(),
            cell_price: self.cost(1, false),
            free,
            block_free,
            newcomer_petri,
            newcomer_near,
            newcomer_siege: siege,
            siege_near,
            near_in: self.near_attached + self.near_sponsored,
            pay,
            split,
            storage,
            bounty,
            winners,
            hot_rows: self.hot_rows,
            tide_gas: gas,
            first_share,
            top_share,
            outsiders,
            top_live_share,
            top_live_kind,
        });
    }

    /// Credit for a call: won first, then the grant (drawing on it restarts the grant's day). None if it cannot pay.
    fn fund(&self, i: usize, need: u128) -> Option<(u128, u128)> {
        let a = &self.accts[i];
        let c = if self.t < a.credit_stop { a.credit().min(need) } else { 0 };
        let att = need - c;
        if att > 0 && (a.role() == Role::Guest || att > a.wallet) {
            return None;
        }
        Some((att, c))
    }

    fn take(&mut self, i: usize, att: u128, cred: u128) {
        let t = self.t;
        let a = &mut self.accts[i];
        a.wallet -= att;
        a.attached += att;
        self.near_attached += att;
        if cred > 0 {
            let from_won = a.won.min(cred);
            a.won -= from_won;
            let rest = cred - from_won;
            if rest > 0 {
                a.grant -= rest;
                a.grant_at = t;
                if a.grant == 0 {
                    // The grant is spent: its record goes, and the contract keeps the storage it freed.
                    self.storage_contract -= (grant_record(a.name_len, L_RELAYER) * BYTE) as i128;
                }
            }
        }
    }

    fn attach(&mut self, i: usize, near: u128) -> bool {
        if near > 0 && !self.accts[i].attached_flag {
            let a = &mut self.accts[i];
            a.attached_flag = true;
            // Part 2: what it earned before and has not claimed is kept too.
            a.kept += a.unclaimed;
            return true;
        }
        false
    }

    /// Part 2: PETRI bought with credit is kept (for a guest, all of it).
    fn keep_bought(&mut self, i: usize, units: u128, near: u128, credit: u128) {
        self.accts[i].kept += credit_share(units as u64, credit, near + credit) as u128;
    }

    /// Part 2: kept PETRI is spent first.
    fn spend_kept(&mut self, i: usize, units: u128) {
        let a = &mut self.accts[i];
        a.kept = a.kept.saturating_sub(units);
    }

    fn join(&mut self, i: usize) {
        let mut deposit = self.accts[i].bring.max(self.r.min_join);
        // A self-sponsored sub-account attaches 0.001 NEAR of its own once, so it is paid in NEAR.
        let sub_attach = if self.accts[i].role() == Role::Sub { NEAR / 1_000 } else { 0 };
        let (att, cred) = if sub_attach > 0 {
            let c = self.accts[i].credit().min(deposit);
            deposit = c + sub_attach;
            if sub_attach > self.accts[i].wallet {
                return;
            }
            (sub_attach, c)
        } else {
            match self.fund(i, deposit) {
                Some(x) => x,
                None => return,
            }
        };
        let p = Payer::Acct(i);
        self.begin(p, Call::Join);
        self.catch_up();
        let id = self.accts[i].id as usize;
        self.n_col = self.n_col.max(id);
        let new_page = (id - 1) % page(self.v6()) == 0;
        let house_extra = if self.accts[i].kind() == Kind::House { 2 } else { 0 };
        let name = if self.accts[i].kind() == Kind::House { 14 } else { NAME_LEN };
        let storage = (join_bytes(self.accts[i].name_len, name, new_page, self.v6()) + house_extra) * BYTE;
        if deposit <= storage {
            return;
        }
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        let units = petri_for_near(near + cr, self.agar, self.k);
        self.agar -= units;
        self.vault += near;
        self.vault_in += near;
        self.inflow(i, near);
        self.accts[i].bought += units;
        self.accts[i].join_units += units;
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        // The purchase entry is smaller than the bytes charged for it: the contract keeps the rest.
        self.storage_contract -= ((buy_bytes(self.v6()) - buy_entry(cred > 0, self.v6())) * BYTE) as i128;
        self.keep_bought(i, units, near, cr);
        let a = &mut self.accts[i];
        a.balance += units;
        a.joined = true;
        a.attached_flag = near > 0;
        if a.kind() != Kind::House && a.kind() != Kind::Bench && self.first_outsider.is_none() {
            self.first_outsider = Some(a.id);
        }
        let base = G_CALL + 12.0 * G_SOP + self.cold_rw(id as ColonyId) + 400.0 * G_WB;
        self.bill(p, Call::Join, base, false, false, false, 0);
    }

    fn buy(&mut self, i: usize, amount: u128) -> bool {
        let Some((att, cred)) = self.fund(i, amount) else { return false };
        let p = Payer::Acct(i);
        self.begin(p, Call::Buy);
        self.catch_up();
        let storage = buy_bytes(self.v6()) * BYTE;
        if amount <= storage {
            return false;
        }
        let won_used = cred.min(self.accts[i].won) > 0;
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        let units = petri_for_near(near + cr, self.agar, self.k);
        self.agar -= units;
        self.vault += near;
        self.vault_in += near;
        self.inflow(i, near);
        self.accts[i].bought += units;
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        self.storage_contract -= ((buy_bytes(self.v6()) - buy_entry(cred > 0, self.v6())) * BYTE) as i128;
        self.accts[i].balance += units;
        let changed = self.attach(i, near);
        self.keep_bought(i, units, near, cr);
        let id = self.accts[i].id as usize;
        let hot = self.hot[id];
        let mut base = G_CALL + 8.0 * G_SOP + 300.0 * G_WB;
        if !hot && (changed || won_used) {
            base += self.cold_rw(id as ColonyId);
        }
        self.bill(p, Call::Buy, base, true, false, hot && (changed || won_used), 0);
        true
    }

    /// A purchase of `near` attached NEAR for a guest that cannot attach NEAR itself: wNEAR its operator sends through
    /// NEAR Intents for it (the operator's NEAR, counted as the guest's attached deposit).
    fn intent_buy(&mut self, i: usize, near: u128) {
        let p = Payer::Acct(i);
        self.begin(p, Call::Buy);
        self.catch_up();
        let storage = buy_bytes(self.v6()) * BYTE;
        let paid = near - storage;
        let units = petri_for_near(paid, self.agar, self.k);
        self.agar -= units;
        self.vault += paid;
        self.vault_in += paid;
        self.inflow(i, paid);
        self.accts[i].bought += units;
        self.storage_players += storage;
        self.near_attached += near;
        self.accts[i].attached += near;
        self.accts[i].balance += units;
        self.attach(i, paid);
        let id = self.accts[i].id;
        let base = G_CALL + 10.0 * G_SOP + 300.0 * G_WB + self.cold_rw(id);
        self.bill(p, Call::Buy, base, true, false, true, 0);
    }

    /// Move earnings into the balance (inside plant, claim, sell, mint). Returns whether the books changed.
    fn claim_petri(&mut self, i: usize) -> bool {
        let a = &mut self.accts[i];
        if a.unclaimed == 0 {
            return false;
        }
        // Part 2: what a guest earns stays in the dish.
        if !a.attached_flag {
            a.kept += a.unclaimed;
        }
        a.balance += std::mem::take(&mut a.unclaimed);
        true
    }

    fn claim(&mut self, i: usize) {
        let p = Payer::Acct(i);
        self.begin(p, Call::Claim);
        self.catch_up();
        let id = self.accts[i].id as usize;
        let earned = self.claim_petri(i);
        let owed = self.accts[i].owed;
        let mut payouts = 0;
        let mut purse = false;
        let cb = claim_bytes(self.v6());
        if owed > (cb + PAYOUT_RESERVE) * BYTE {
            let near = owed - cb * BYTE;
            self.storage_players += cb * BYTE;
            let a = &mut self.accts[i];
            a.owed = 0;
            a.claimed += near;
            a.wallet += near;
            self.claimed_total += near;
            payouts = 1;
            purse = true;
        }
        let hot = self.hot[id];
        let mut base = G_CALL + 6.0 * G_SOP + if payouts > 0 { 300.0 * G_WB } else { 0.0 };
        if !hot && (earned || purse) {
            base += self.cold_rw(id as ColonyId);
        }
        self.bill(p, Call::Claim, base, true, hot && earned, hot && purse, payouts);
    }

    /// `plant` of cells chosen on the current (caught-up) board, optionally under slide `slide`'s licence.
    fn plant(&mut self, i: usize, cells: Vec<u32>, siege: bool, note: Option<u128>, slide: Option<usize>) -> bool {
        let n = cells.len() as u32;
        let deposit = self.plant_deposit(i, n, note, slide);
        let Some((att, cred)) = self.fund(i, deposit) else { return false };
        let p = Payer::Acct(i);
        self.begin(p, Call::Plant);
        self.catch_up();
        if self.gen != self.due() {
            // "the dish is behind the clock; call advance first"
            self.plant_fail_behind += 1;
            self.accts[i].failed_calls += 1;
            self.bill(p, Call::Plant, G_CALL + 4.0 * G_SOP, false, false, false, 0);
            return false;
        }
        let id = self.accts[i].id as usize;
        let earned = self.claim_petri(i);
        let mut base = G_CALL + 14.0 * G_SOP + self.board_rw() + 1_000.0 * n as f64 * G_OP + 500.0 * G_WB;
        // Pacts binding this colony: the contract refuses a planting within pact_radius of a protected colony's cells.
        let bound = self.protected(i);
        if !bound.is_empty() {
            base += bound.len() as f64 * 2.0 * G_SOP + (n as f64 * ((2 * self.r.pact_radius as u32 + 1).pow(2)) as f64 * 50.0) * G_OP;
            if self.d.pact_breach(&cells, &bound, self.r.pact_radius).is_some() {
                self.accts[i].pact_refused += 1;
                self.accts[i].failed_calls += 1;
                self.bill(p, Call::Plant, base, true, earned && self.hot[id], false, 0);
                return false;
            }
        }
        let base_cost = self.cost(n, siege);
        let house = self.accts[i].kind() == Kind::House;
        let (cost, holder, toll) = match slide {
            None => (base_cost, None, 0),
            Some(s) => {
                let cost = licensed_cost(base_cost, self.r.slide_discount_bps);
                let h = self.slides[s].holder;
                if h == i {
                    (cost, None, 0)
                } else {
                    // "the house plants only slides it holds"
                    assert!(!house, "the house plants only slides it holds");
                    (cost, Some(h), royalty(cost, self.r.slide_royalty_bps))
                }
            }
        };
        if self.accts[i].balance < cost + toll {
            self.bill(p, Call::Plant, base, true, earned && self.hot[id], false, 0);
            return false;
        }
        // v6.1: the house never has a hot row; anyone else's first planting since it last played makes one, unless the
        // table is full even after the rows that may leave have left.
        let wants_row = !self.hot[id] && (self.v6() || !house);
        if wants_row && !self.v6() && self.hot_rows >= MAX_PLAYING {
            let pages = self.flush(FLUSH_MAX);
            base += pages as f64 * (2.0 * G_SOP + (page(false) as u128 * cold(false)) as f64 * (G_RB + G_WB)) + self.hot_rows as f64 * W_FLUSH_SCAN_ROW * G_OP + 30.0 * self.total_live as f64 * G_OP;
            if self.hot_rows >= MAX_PLAYING {
                // "the dish has 10,000 colonies playing at once, its most"
                self.plant_refused_full += 1;
                self.accts[i].failed_calls += 1;
                self.bill(p, Call::Plant, base, true, earned && self.hot[id], pages > 0, 0);
                return false;
            }
            // The rows that left change the table's size; the planting writes both parts back anyway (it enters).
        }
        let burn = cost * self.r.burn_bps as u128 / 10_000;
        self.burned += burn;
        self.agar += cost - burn;
        if let Some(h) = holder {
            self.accts[i].balance -= toll;
            self.accts[i].royalty_out += toll;
            if self.r.royalty_guest_to_agar && !self.accts[i].attached_flag {
                // v6.1: a planter that never attached NEAR pays its royalty to the agar.
                self.agar += toll;
                self.royalties_to_agar += toll;
            } else {
                self.accts[h].balance += toll;
                self.accts[h].royalty_in += toll;
                if !self.accts[i].attached_flag {
                    self.accts[h].royalty_in_credit += toll;
                }
                self.royalties += toll;
            }
            base += 3.0 * G_SOP + 200.0 * (G_RB + G_WB);
        }
        if let Some(s) = slide {
            if !(self.r.royalty_guest_to_agar && !self.accts[i].attached_flag) {
                self.slides[s].royalties += toll;
            }
            self.slides[s].plantings += 1;
            self.accts[i].licensed += 1;
            base += 2.0 * G_SOP + 150.0 * (G_RB + G_WB);
        }
        self.d.plant_unchecked(id as ColonyId, &cells);
        self.total_live += n;
        let entering = wants_row;
        let table_empty = self.hot_rows == 0;
        if entering {
            // Inserting the row moves the rows after it; v6.1 reads its stake from the cold slot.
            base += self.hot_rows as f64 * 80.0 * 0.125 * G_OP;
            if !self.v6() {
                base += self.cold_read(id as ColonyId);
            }
            self.hot[id] = true;
            self.hot_rows += 1;
        } else if !self.hot[id] {
            // v6.1, the house: its stake is kept in its cold slot.
            base += self.cold_rw(id as ColonyId);
        }
        self.stake[id] += n as u64 * STAKE_UNIT;
        self.planted_at[id] = self.gen + 1;
        let first = !self.accts[i].planted_once;
        let lic = slide.map(|_| holder.map(|h| self.accts[h].name_len));
        let storage = plant_stored(n as u128, first, cred > 0, note, lic, entering, table_empty, self.v6()) * BYTE;
        let won_used = cred.min(self.accts[i].won) > 0;
        self.take(i, att, cred);
        let (near, cr) = split_after_storage(att, cred, storage);
        self.vault += near;
        self.vault_in += near;
        self.inflow(i, near);
        self.credit_pool += cr;
        self.credit_in += cr;
        self.storage_players += storage;
        let changed = self.attach(i, near);
        self.spend_kept(i, cost + toll);
        let a = &mut self.accts[i];
        a.balance -= cost;
        a.spent += cost;
        a.planted_once = true;
        a.plants += 1;
        if siege {
            a.sieges += 1;
        }
        if house {
            a.spend_log.push((self.t, cost));
            self.house_plants_today += 1;
        }
        self.bill(p, Call::Plant, base, true, true, entering || changed || won_used, 0);
        true
    }

    /// `sell`: the agar buys back at most what the allowance has left; the record comes out of the proceeds. A colony
    /// that never attached NEAR is paid in credit. The house never sells.
    fn sell(&mut self, i: usize, want: u128) {
        if self.accts[i].kind() == Kind::House {
            return;
        }
        let storage = sell_bytes(self.v6()) * BYTE;
        let as_credit = !self.accts[i].attached_flag;
        // Part 2: a colony that has attached NEAR sells only once it holds no kept PETRI (refused before any work).
        if self.r.kept_rule && !as_credit && self.accts[i].kept > 0 {
            self.accts[i].kept_refused += 1;
            self.accts[i].failed_calls += 1;
            let p = Payer::Acct(i);
            self.begin(p, Call::Sell);
            self.bill(p, Call::Sell, G_CALL + 4.0 * G_SOP, false, false, false, 0);
            return;
        }
        let reserve = if as_credit { 0 } else { PAYOUT_RESERVE * BYTE };
        if self.sell_left <= storage + reserve {
            return;
        }
        if self.accts[i].unclaimed > 0 {
            self.claim(i);
        }
        let p = Payer::Acct(i);
        self.begin(p, Call::Sell);
        self.catch_up();
        let mut units = want.min(self.accts[i].balance);
        if units == 0 {
            return;
        }
        if self.sell_quote(units) > self.sell_left {
            let (mut lo, mut hi) = (0u128, units);
            while lo < hi {
                let mid = lo + (hi - lo + 1) / 2;
                if self.sell_quote(mid) <= self.sell_left {
                    lo = mid;
                } else {
                    hi = mid - 1;
                }
            }
            units = lo;
        }
        let near = self.sell_quote(units);
        if units == 0 || near <= storage + reserve + BYTE * 50 {
            return;
        }
        // Kept PETRI sold: for credit by a guest (allowed), or for NEAR only without the kept rule (then counted).
        let farmed = units.min(self.accts[i].kept);
        self.accts[i].kept -= farmed;
        if !as_credit {
            self.accts[i].farm_sold += (near - storage) * farmed / units;
        }
        self.accts[i].balance -= units;
        self.agar += units;
        {
            let h = self.house_part(near);
            self.vault_h -= h;
            self.out_players += near - storage;
            self.out_h += wide_mul_div(h, near - storage, near);
        }
        self.vault -= near;
        self.sell_left -= near;
        self.storage_players += storage;
        let paid = near - storage;
        let id = self.accts[i].id as usize;
        let hot = self.hot[id];
        let mut base = G_CALL + 8.0 * G_SOP + 300.0 * G_WB;
        let a = &mut self.accts[i];
        let royalty_share = if a.royalty_in > 0 { paid } else { 0 };
        if as_credit {
            a.won += paid;
            a.credit_sold += paid;
            self.credit_sold += paid;
            if !hot {
                base += self.cold_rw(id as ColonyId);
            }
            self.bill(p, Call::Sell, base, true, false, hot, 0);
        } else {
            a.sold += paid;
            a.wallet += paid;
            a.royalty_sold_near += royalty_share;
            self.sold_total += paid;
            self.bill(p, Call::Sell, base, true, false, false, 1);
        }
    }

    fn advance(&mut self, p: Payer) {
        self.begin(p, Call::Advance);
        self.catch_up();
        let ran = self.unbilled_gens;
        let mut g = G_CALL + 3.0 * G_SOP;
        let registered = match p {
            Payer::Acct(_) => true,
            Payer::Keeper => self.s.keeper_registered,
        };
        // The pot goes to a registered caller outside the house, if this call ran a generation.
        let guest = matches!(p, Payer::Acct(i) if self.r.kept_rule && !self.accts[i].attached_flag);
        if ran > 0 && self.keeper_pot > 0 && registered && !self.is_house_payer(p) && !guest {
            let pot = std::mem::take(&mut self.keeper_pot);
            g += 2.0 * G_SOP;
            if let Payer::Acct(i) = p {
                self.accts[i].balance += pot;
                self.accts[i].pot += pot;
            }
        }
        self.bill(p, Call::Advance, g, false, false, false, 0);
    }

    /// `unsponsor` by the operator: only its own grant, a day after the last top-up or draw.
    fn unsponsor(&mut self, i: usize) {
        let t = self.t;
        let a = &self.accts[i];
        if !a.joined || !a.grant_mine || a.grant == 0 || t < a.grant_at + RECLAIM_AFTER {
            return;
        }
        let c = std::mem::take(&mut self.accts[i].grant);
        self.accts[i].reclaimed += c;
        self.reclaimed_total += c;
        self.storage_contract -= (grant_record(self.accts[i].name_len, L_WALLET) * BYTE) as i128;
        let p = Payer::Acct(i);
        self.begin(p, Call::Unsponsor);
        self.bill(p, Call::Unsponsor, G_CALL + 6.0 * G_SOP, false, false, false, 1);
    }

    /// `mint_slide` of a w x h rectangle holding exactly `cells` of the colony's own living cells.
    fn mint_slide(&mut self, i: usize, cells: u32, w: u128, h: u128, title: Option<u128>) -> bool {
        let p = Payer::Acct(i);
        self.begin(p, Call::Slide);
        self.catch_up();
        self.claim_petri(i);
        let cost = self.r.slide_cells_price * cells as u128;
        if cells < self.r.slide_min_cells || self.accts[i].balance < cost {
            return false;
        }
        let first = self.accts[i].last_slide == 0;
        let storage = slide_bytes(self.accts[i].name_len, w, h, title.map(|t| t + 5).unwrap_or(1) - 1, first, self.v6()) * BYTE;
        let deposit = slide_deposit_bytes(w, h, title) * BYTE;
        // Credit pays the storage first, then the attached deposit; the excess is sent back.
        let c = self.accts[i].credit().min(storage);
        let att = storage - c;
        if att > 0 && (self.accts[i].role() == Role::Guest || deposit > self.accts[i].wallet) {
            return false;
        }
        self.take(i, att, c);
        self.storage_players += storage;
        self.burned += cost;
        self.spend_kept(i, cost);
        let a = &mut self.accts[i];
        a.balance -= cost;
        a.slide_storage += storage;
        a.last_slide = self.t.max(1);
        let base = G_CALL + 10.0 * G_SOP + 600.0 * G_WB + 64.0 * 1024.0 * G_OP;
        self.bill(p, Call::Slide, base, true, false, false, 0);
        true
    }

    // ---------- the players ----------

    /// Up to `tries` candidate plantings; the first that needs no siege, else the first legal siege.
    fn try_place(&mut self, me: ColonyId, tries: usize, mut gen: impl FnMut(&mut Rng) -> Vec<u32>) -> (Option<Vec<u32>>, Option<Vec<u32>>) {
        let mut sieged = None;
        for _ in 0..tries {
            let cells = gen(&mut self.rng);
            match self.d.check_plant(me, &cells, self.r.buffer, self.r.max_plant_cells, &self.house) {
                Ok(c) if !c.siege => return (Some(cells), None),
                Ok(_) => {
                    if sieged.is_none() {
                        sieged = Some(cells);
                    }
                }
                Err(_) => {}
            }
        }
        (None, sieged)
    }

    /// The licence a player would plant `pat` under: its own slide of it, else anyone's (the first minted).
    fn licence_for(&self, i: usize, pat: Pat) -> Option<usize> {
        if !self.s.licences || self.accts[i].kind() == Kind::House {
            return None;
        }
        // v6.1: only a slide of at least `licence_min_cells` cells is a licence.
        if (pat.cells().len() as u32) < self.r.licence_min_cells {
            return None;
        }
        let v = &self.by_pat[pat.idx()];
        v.iter().copied().find(|&s| self.slides[s].holder == i).or_else(|| v.first().copied())
    }

    /// Plant `pat` within `radius` of `center`: outside every rival's buffer if it can, else as a siege if allowed and
    /// affordable. Under a licence if one exists (25% off, a 10% royalty to its holder), in the slide's orientation.
    #[allow(clippy::too_many_arguments)]
    fn plant_near(&mut self, i: usize, pat: Pat, center: (i32, i32), radius: i32, frac: u128, may_siege: bool, note: Option<u128>) -> bool {
        let shape = pat.cells();
        let n = shape.len() as u32;
        let slide = self.licence_for(i, pat);
        let factor = |c: u128, w: &World| match slide {
            Some(s) => {
                let l = licensed_cost(c, w.r.slide_discount_bps);
                l + if w.slides[s].holder == i { 0 } else { royalty(l, w.r.slide_royalty_bps) }
            }
            None => c,
        };
        let (base, siege) = (factor(self.cost(n, false), self), factor(self.cost(n, true), self));
        let a = &self.accts[i];
        let limit = (a.balance + a.unclaimed) * frac / 10;
        if base > limit || self.fund(i, self.plant_deposit(i, n, note, slide)).is_none() {
            return false;
        }
        let me = a.id;
        let span = 2 * radius as u64 + 1;
        let (w, h) = (self.w, self.h);
        let fixed = slide.map(|s| self.slides[s].rot);
        let (free, sieged) = self.try_place(me, 30, |rng| {
            let x = center.0 + rng.range(span) as i32 - radius;
            let y = center.1 + rng.range(span) as i32 - radius;
            let rot = fixed.unwrap_or(rng.range(4) as u8);
            shape_cells(w, h, shape, x, y, rot)
        });
        if let Some(c) = free {
            return self.plant(i, c, false, note, slide);
        }
        if may_siege && siege <= limit {
            if let Some(c) = sieged {
                return self.plant(i, c, true, note, slide);
            }
        }
        false
    }

    /// A random living cell of another non-house colony.
    fn rival_cell(&mut self, me: ColonyId) -> Option<(i32, i32)> {
        let n = self.d.cells.len() as u64;
        for _ in 0..64 {
            let i = self.rng.range(n) as usize;
            let c = self.d.cells[i];
            if c != EMPTY && c != me && !self.house.contains(&c) {
                return Some(((i % self.w as usize) as i32, (i / self.w as usize) as i32));
            }
        }
        None
    }

    /// A random living cell of any other colony (the strains aim at the house too).
    fn any_rival_cell(&mut self, me: ColonyId) -> Option<(i32, i32)> {
        let n = self.d.cells.len() as u64;
        for _ in 0..64 {
            let i = self.rng.range(n) as usize;
            let c = self.d.cells[i];
            if c != EMPTY && c != me {
                return Some(((i % self.w as usize) as i32, (i / self.w as usize) as i32));
            }
        }
        None
    }

    /// The emptiest of 20 random spots (fewest living cells within 9), as strategies.mjs freshSpots.
    fn fresh_spot(&mut self) -> (i32, i32) {
        let (w, h) = (self.w, self.h);
        let mut best = (0, 0, usize::MAX);
        for _ in 0..20 {
            let x = self.rng.range(w as u64) as i32;
            let y = self.rng.range(h as u64) as i32;
            let mut c = 0;
            for dy in -9..=9 {
                let row = (y + dy).rem_euclid(h) * w;
                for dx in -9..=9 {
                    if self.d.cells[(row + (x + dx).rem_euclid(w)) as usize] != EMPTY {
                        c += 1;
                    }
                }
            }
            if c < best.2 {
                best = (x, y, c);
            }
        }
        (best.0, best.1)
    }

    fn raid(&mut self, i: usize) {
        let me = self.accts[i].id;
        let home = self.accts[i].home;
        // A raider bound by pacts aims elsewhere (as the agents drop such candidates); the contract refuses the rest.
        let bound = self.protected(i);
        let mut target = self.rival_cell(me).unwrap_or(home);
        if !bound.is_empty() {
            let owner = |w: &World, t: (i32, i32)| w.d.cells[w.d.index(t.0, t.1)];
            if bound.contains(&owner(self, target)) {
                self.accts[i].pact_diverted += 1;
                for _ in 0..8 {
                    target = self.rival_cell(me).unwrap_or(home);
                    if !bound.contains(&owner(self, target)) {
                        break;
                    }
                }
            }
        }
        let (w, h) = (self.w, self.h);
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        if self.rng.range(3) == 0 {
            let cost = self.cost(3, true);
            if cost > bal / 2 || self.fund(i, self.plant_deposit(i, 3, None, None)).is_none() {
                return;
            }
            let (free, sieged) = self.try_place(me, 20, |rng| shape_cells(w, h, patterns::BLINKER, target.0 + rng.range(5) as i32 - 2, target.1 + rng.range(5) as i32 - 2, rng.range(2) as u8));
            if let Some(c) = sieged {
                self.plant(i, c, true, None, None);
            } else if let Some(c) = free {
                self.plant(i, c, false, None, None);
            }
            return;
        }
        let pat = if self.rng.range(4) == 0 { Pat::Lwss } else { Pat::Glider };
        let shape = pat.cells();
        let n = shape.len() as u32;
        let slide = self.licence_for(i, pat);
        let (base, siege) = (self.cost(n, false), self.cost(n, true));
        if base > bal / 2 || self.fund(i, self.plant_deposit(i, n, None, slide)).is_none() {
            return;
        }
        let dir_rot = self.rng.range(4) as u8;
        // A licence fixes the orientation; a raider uses it only when its aim allows (one direction in four).
        let use_slide = slide.filter(|&s| self.slides[s].rot == dir_rot);
        let (free, sieged) = self.try_place(me, 20, |rng| {
            let rot = dir_rot;
            let dir = [(1, 1), (-1, 1), (-1, -1), (1, -1)][rot as usize];
            let dist = 6 + rng.range(10) as i32;
            let jx = rng.range(5) as i32 - 2;
            let jy = rng.range(5) as i32 - 2;
            shape_cells(w, h, shape, target.0 - dir.0 * dist + jx, target.1 - dir.1 * dist + jy, rot)
        });
        if let Some(c) = free {
            self.plant(i, c, false, None, use_slide);
        } else if siege <= bal / 2 {
            if let Some(c) = sieged {
                self.plant(i, c, true, None, use_slide);
            }
        }
    }

    /// The carpet locker (see `Kind::Locker`).
    fn locker(&mut self, i: usize) {
        let first_pass = self.accts[i].spots_done < self.accts[i].lattice_len;
        if !first_pass && (self.t + self.accts[i].phase) % 20 != 0 {
            return;
        }
        if !self.may_act(i) {
            return;
        }
        self.begin(Payer::Acct(i), Call::Plant);
        self.catch_up();
        let me = self.accts[i].id;
        let per_cell = self.cost(1, false).max(1);
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        let mut max_cells = ((bal / per_cell) as u32).min(self.r.max_plant_cells);
        while max_cells >= 4 && self.fund(i, self.plant_deposit(i, max_cells, None, None)).is_none() {
            max_cells -= 4;
        }
        if max_cells < 4 {
            return;
        }
        let (w, h) = (self.w, self.h);
        let mut cells: Vec<u32> = Vec::new();
        let ok = |d: &Dish, house: &[ColonyId], b: &[u32], buffer: u16, max: u32| matches!(d.check_plant(me, b, buffer, max, house), Ok(c) if !c.siege);
        if first_pass {
            let lat = self.accts[i].lattice_len;
            let mut p = self.accts[i].spots_done;
            while p < lat && cells.len() + 4 <= max_cells as usize {
                let (x, y) = self.accts[i].spots[p];
                let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                if ok(&self.d, &self.house, &b, self.r.buffer, self.r.max_plant_cells) {
                    cells.extend(b);
                }
                p += 1;
            }
            self.accts[i].spots_done = p;
        } else {
            for p in 0..self.accts[i].lattice_len.min(self.accts[i].spots.len()) {
                if cells.len() + 4 > max_cells as usize {
                    break;
                }
                let (x, y) = self.accts[i].spots[p];
                let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                let missing: Vec<u32> = b.iter().copied().filter(|&c| self.d.cells[c as usize] == EMPTY).collect();
                if missing.is_empty() || missing.len() < 4 && b.iter().any(|&c| self.d.cells[c as usize] != EMPTY && self.d.cells[c as usize] != me) {
                    continue;
                }
                if ok(&self.d, &self.house, &missing, self.r.buffer, self.r.max_plant_cells) {
                    cells.extend(missing);
                }
            }
            let cap = self.stake[me as usize] as u128 * self.r.reach as u128 / STAKE_UNIT as u128;
            if (cap as u64) < self.live[me as usize] as u64 * 11 / 10 {
                let mut p = self.accts[i].spots_done.max(self.accts[i].lattice_len);
                while p < self.accts[i].spots.len() && cells.len() + 4 <= max_cells as usize {
                    let (x, y) = self.accts[i].spots[p];
                    let b = shape_cells(w, h, patterns::BLOCK, x, y, 0);
                    if ok(&self.d, &self.house, &b, self.r.buffer, self.r.max_plant_cells) {
                        cells.extend(b);
                    }
                    p += 1;
                    if cells.len() >= 16 {
                        break;
                    }
                }
                self.accts[i].spots_done = p;
            }
        }
        cells.sort_unstable();
        cells.dedup();
        cells.truncate(self.r.max_plant_cells as usize);
        if cells.is_empty() {
            return;
        }
        let n = cells.len() as u32;
        if self.cost(n, false) > bal {
            return;
        }
        if ok(&self.d, &self.house, &cells, self.r.buffer, self.r.max_plant_cells) {
            self.plant(i, cells, false, None, None);
        }
    }

    /// Penny: keep one block alive and paid; replant when it died or its pay cap has lapsed below its cells.
    fn penny(&mut self, i: usize) {
        let me = self.accts[i].id as usize;
        let cap = self.stake[me] as u128 * self.r.reach as u128 / STAKE_UNIT as u128;
        let live = self.live[me] as u128;
        if live > 0 && cap >= live.min(4) {
            return;
        }
        if !self.may_act(i) {
            return;
        }
        self.begin(Payer::Acct(i), Call::Plant);
        self.catch_up();
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        if bal < self.cost(4, false) && self.accts[i].wallet >= NEAR / 100 + NEAR / 200 {
            self.buy(i, NEAR / 100);
        }
        let home = self.accts[i].home;
        self.plant_near(i, Pat::Block, home, 12, 10, false, None);
    }

    /// The racer: advances when the keeper pot (at the sell-back price) plus a pending bounty beat the gas.
    fn racer(&mut self, i: usize) {
        if !self.accts[i].joined {
            return;
        }
        let due = self.due();
        if due <= self.billed_gen {
            return;
        }
        let behind = due - self.billed_gen;
        let te = self.r.tide_every;
        let next_tide = (self.gen / te + 1) * te;
        let tide_pending = next_tide <= due.min(self.gen + self.r.max_catchup);
        let bounty = if tide_pending { (self.vault * self.r.tide_bps as u128 / 10_000 * self.r.tide_bounty_bps as u128 / 10_000).min(self.r.max_bounty) } else { 0 };
        let pot = self.sell_quote(self.keeper_pot);
        let want = tide_pending || behind >= 19 || self.keeper_pot >= 49 * UNIT / 10;
        let gas = G_CALL + 5.0 * G_SOP + self.board_rw() + self.hot_load() + self.hot_store(true, tide_pending) + behind as f64 * self.gen_gas(self.total_live, self.alive.len(), false) + if tide_pending { G_PAYOUT_BURN } else { 0.0 };
        if want && (bounty + pot) as f64 > gas * YOCTO_PER_GGAS {
            self.advance(Payer::Acct(i));
        }
    }

    /// After a tide the allowance reopens and sellers race for it: bots first (sellers, racers, snipers, farmers,
    /// sybil guests and wallets), then a random quarter of the others, who sell what they hold above 16 cells' price.
    fn sell_round(&mut self) {
        let mut bots = Vec::new();
        let mut humans = Vec::new();
        for i in 0..self.accts.len() {
            let a = &self.accts[i];
            if !a.joined {
                continue;
            }
            match (a.kind(), a.role()) {
                (Kind::House, _) | (Kind::Bench, _) => {}
                (Kind::Seller, _) | (Kind::Racer, _) | (Kind::Sniper, _) | (Kind::Farmer, _) | (Kind::SybilGuest, _) | (Kind::SybilRoyalty, _) | (Kind::SybilTransfer, _) => bots.push(i),
                // Its guests hoard until they have attached NEAR, then sell everything.
                (Kind::SybilAttach, Role::Wallet) => bots.push(i),
                (Kind::SybilAttach, Role::Guest) => {
                    if a.attached_flag {
                        bots.push(i);
                    }
                }
                _ => {
                    if self.rng.range(4) == 0 {
                        humans.push(i);
                    }
                }
            }
        }
        self.transfer_round();
        self.pact_round();
        self.rng.shuffle(&mut bots);
        self.rng.shuffle(&mut humans);
        for i in bots.into_iter().chain(humans) {
            if self.sell_left <= sell_bytes(self.v6()) * BYTE {
                break;
            }
            let reserve = match (self.accts[i].kind(), self.accts[i].role()) {
                (Kind::Seller | Kind::Racer | Kind::Farmer, _) | (Kind::SybilGuest, Role::Guest) | (Kind::SybilRoyalty, Role::Wallet) | (Kind::SybilTransfer, Role::Wallet) | (Kind::SybilAttach, _) => 0,
                (Kind::SybilRoyalty, Role::Guest) => self.cost(24, false),
                _ => self.cost(16, false),
            };
            let bal = self.accts[i].balance + self.accts[i].unclaimed;
            if bal > reserve {
                self.sell(i, bal - reserve);
            }
        }
    }

    /// Part 2's exit (a): each SybilTransfer guest sends all its PETRI to its operator's wallet (ft_transfer), which
    /// the contract refuses under the kept rule (a guest cannot send PETRI).
    fn transfer_round(&mut self) {
        for i in 0..self.accts.len() {
            let a = &self.accts[i];
            if !a.joined || a.kind() != Kind::SybilTransfer || a.role() != Role::Guest {
                continue;
            }
            let group = a.group;
            let Some(op) = self.accts.iter().position(|b| b.group == group && b.role() == Role::Wallet && b.joined) else { continue };
            // One refusal teaches it: it stops trying.
            if self.accts[i].transfer_refused {
                continue;
            }
            if self.accts[i].unclaimed > 0 {
                self.claim(i);
            }
            // Everything but what its next block costs.
            let amount = self.accts[i].balance.saturating_sub(self.cost(8, false));
            if amount == 0 {
                continue;
            }
            // An ft_transfer: 1 yoctoNEAR and about 3 TGas, which the guest's own key could not attach; the operator
            // pays it from a full-access key on the guest account.
            self.accts[op].gas += (3.0 * YOCTO_PER_GGAS * 1000.0) as u128;
            if self.r.kept_rule && !self.accts[i].attached_flag {
                self.accts[i].kept_refused += 1;
                self.accts[i].transfer_refused = true;
                continue;
            }
            let farmed = amount.min(self.accts[i].kept);
            self.accts[i].kept -= farmed;
            self.accts[i].balance -= amount;
            self.accts[i].moved_out += amount;
            self.accts[op].balance += amount;
            self.accts[op].moved_in += amount;
            self.accts[op].kept += farmed;
        }
    }

    /// The colonies whose living cells colony account `i` may not plant near: accepted pacts it promised, still in force.
    fn protected(&self, i: usize) -> Vec<ColonyId> {
        let g = self.gen;
        self.pacts.iter().filter(|&&(_, to, until)| to == i && g < until).map(|&(from, _, _)| self.accts[from].id).collect()
    }

    /// Pacts (`Rules::pacts`): after every tide each Builder pays the Raider nearest its home 2 PETRI for a pact that
    /// keeps the raider `pact_radius` cells from the builder's living cells for a tide window. The raider accepts. The
    /// builder pays the offer's storage (0.0042 NEAR, about 0.0038 used) and both calls' gas.
    fn pact_round(&mut self) {
        if !self.r.pacts {
            return;
        }
        let g = self.gen;
        self.pacts.retain(|&(_, _, until)| until > g);
        let raiders: Vec<usize> = (0..self.accts.len()).filter(|&j| self.accts[j].joined && self.accts[j].kind() == Kind::Raider).collect();
        if raiders.is_empty() {
            return;
        }
        let price = 2 * UNIT;
        let (w, h) = (self.w, self.h);
        let storage = 380 * BYTE;
        let gas = (20.0 * YOCTO_PER_GGAS * 1000.0) as u128;
        for i in 0..self.accts.len() {
            let a = &self.accts[i];
            if !a.joined || a.kind() != Kind::Builder || a.balance < price + self.cost(8, false) || a.wallet < storage + gas {
                continue;
            }
            let home = a.home;
            let d = |j: usize| {
                let o = self.accts[j].home;
                let dx = (o.0 - home.0).rem_euclid(w).min((home.0 - o.0).rem_euclid(w));
                let dy = (o.1 - home.1).rem_euclid(h).min((home.1 - o.1).rem_euclid(h));
                dx * dx + dy * dy
            };
            let j = *raiders.iter().min_by_key(|&&j| d(j)).unwrap();
            // Only a raider close enough to be a threat is worth paying.
            if d(j) > 40 * 40 {
                continue;
            }
            let a = &mut self.accts[i];
            a.balance -= price;
            a.pact_paid += price;
            a.wallet -= storage + gas;
            a.gas += storage + gas;
            self.storage_players += storage;
            self.accts[j].balance += price;
            self.accts[j].pact_in += price;
            self.pacts.push((i, j, g + self.r.tide_every.min(self.r.pact_max_gens as u64)));
        }
    }

    fn top_up(&mut self, i: usize) {
        let a = &self.accts[i];
        let t = self.t;
        let bal = a.balance + a.unclaimed;
        match (a.kind(), a.role()) {
            (Kind::Builder | Kind::Late | Kind::Raider | Kind::Defender, _) | (Kind::SybilGuest | Kind::SybilRoyalty, Role::Wallet) => {
                if a.top_ups < 2 && a.wallet >= NEAR / 50 && t >= a.join_at + self.r.gens_per_day() && bal < 2 * self.cost(6, false) {
                    self.accts[i].top_ups += 1;
                    self.buy(i, NEAR / 50);
                }
            }
            (Kind::Guest | Kind::SelfSponsor | Kind::SybilRoyalty, _) => {
                if a.top_ups < 3 && a.credit() >= NEAR / 100 + buy_bytes(self.v6()) * BYTE && t >= a.join_at + self.r.gens_per_day() / 4 && bal < 2 * self.cost(6, false) {
                    let amt = a.credit().min(NEAR / 50);
                    self.accts[i].top_ups += 1;
                    self.buy(i, amt);
                }
            }
            _ => {}
        }
    }

    /// Whether the player could send anything now (a small planting or a top-up).
    fn may_act(&self, i: usize) -> bool {
        let a = &self.accts[i];
        let bal = a.balance + a.unclaimed;
        if self.fund(i, self.plant_deposit(i, 3, None, None)).is_some() && bal >= self.cost(3, false) {
            return true;
        }
        match (a.kind(), a.role()) {
            (Kind::Builder | Kind::Late | Kind::Raider | Kind::Defender, _) | (Kind::SybilGuest | Kind::SybilRoyalty, Role::Wallet) => a.top_ups < 2 && a.wallet >= NEAR / 50,
            (Kind::Guest | Kind::SelfSponsor | Kind::SybilRoyalty, _) => a.top_ups < 3 && a.credit() >= NEAR / 100 + buy_bytes(self.v6()) * BYTE,
            (Kind::Penny, _) => a.wallet >= NEAR / 50,
            _ => false,
        }
    }

    // ---------- the house (agents/run.mjs, strategies.mjs) ----------

    fn spent_today(&self, i: usize) -> u128 {
        let gpd = self.r.gens_per_day();
        self.accts[i].spend_log.iter().filter(|(t, _)| self.t < t + gpd).map(|x| x.1).sum()
    }

    /// One strain's turn: buy 0.02 NEAR when it cannot afford 12 cells (on mainnet only while its NEAR stays above
    /// 0.12), fossilize its densest 16x16 window every 12 h (6 h on testnet), then plant one of up to six candidates
    /// for its temperament, at most 60% of its PETRI and (mainnet) its daily 100 PETRI. Approximation of the model's
    /// choice: an ambitious candidate (pulsar, glider gun, acorn or R-pentomino, LWSS, eater wall) when one is
    /// affordable with probability 1/3, else the first ordinary one. The bench (testnet) always takes the first.
    fn house_act(&mut self, i: usize) {
        let bench = self.accts[i].kind() == Kind::Bench;
        let net = self.s.net;
        let p = Payer::Acct(i);
        self.begin(p, Call::Plant);
        self.catch_up();
        let cell = self.cost(1, false);
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        let attaches = bench || net == Net::Mainnet;
        if bal < 12 * cell {
            let a = &self.accts[i];
            if attaches {
                if a.wallet < a.floor + HOUSE_TOP_UP {
                    return;
                }
            } else if a.credit() < HOUSE_TOP_UP {
                return;
            }
            self.buy(i, HOUSE_TOP_UP);
        }
        // Claims (the bench wins tides; the house never does).
        if bench && self.accts[i].owed > (claim_bytes(self.v6()) + PAYOUT_RESERVE) * BYTE && self.t % 240 < 120 {
            self.claim(i);
        }
        if !bench {
            self.fossilize(i);
        }
        let bal = self.accts[i].balance + self.accts[i].unclaimed;
        let max_cost = if net == Net::Mainnet && !bench { HOUSE_SMALL_MOVE.max(HOUSE_DAILY_PETRI.saturating_sub(self.spent_today(i))) } else { u128::MAX };
        let limit = (bal * 6 / 10).min(max_cost);
        let me = self.accts[i].id;
        let my_cells = self.live[me as usize];
        let small = my_cells < self.accts[i].cap;
        let home = self.home_of(i);
        let temper = self.accts[i].temper;
        // Ordinary and ambitious candidates for the temperament: (pattern, where, radius).
        let target = self.any_rival_cell(me);
        let ordinary: Vec<(Pat, (i32, i32), i32)> = match temper {
            0 => vec![(Pat::Block, home, 14), (Pat::Beehive, home, 14), (Pat::Loaf, home, 14), (Pat::Eater, target.unwrap_or(home), 10)],
            1 => vec![(Pat::Glider, target.unwrap_or(home), 16), (Pat::Block, home, 10), (Pat::Beehive, home, 10)],
            2 => vec![(Pat::Eater, target.unwrap_or(home), 12), (Pat::Glider, target.unwrap_or(home), 16), (Pat::Beehive, home, 12), (Pat::Loaf, home, 12)],
            3 => {
                let f = self.fresh_spot();
                vec![(Pat::Beehive, f, 2), (Pat::Loaf, f, 2), (Pat::Block, home, 9)]
            }
            _ => {
                let f = self.fresh_spot();
                vec![(Pat::Blinker, f, 2), (Pat::Glider, target.unwrap_or(home), 16), (Pat::Block, home, 10), (Pat::Toad, home, 10)]
            }
        };
        let mut ambitious: Vec<(Pat, (i32, i32), i32)> = Vec::new();
        if !bench {
            let f = self.fresh_spot();
            let t = target.unwrap_or(f);
            match temper {
                0 => {
                    if small {
                        ambitious.push((Pat::Pulsar, home, 18));
                    }
                    ambitious.push((Pat::Eater, t, 12));
                }
                1 => {
                    if small {
                        ambitious.push((Pat::Gun, t, 16));
                    }
                    ambitious.push((Pat::Lwss, t, 15));
                }
                2 => {
                    if small {
                        ambitious.push((Pat::Gun, t, 16));
                    }
                    ambitious.push((Pat::Lwss, t, 15));
                }
                3 => {
                    if small {
                        ambitious.push((Pat::Acorn, f, 2));
                        ambitious.push((Pat::Pulsar, f, 3));
                    }
                    ambitious.push((Pat::Lwss, t, 15));
                }
                _ => {
                    if small {
                        ambitious.push((if self.rng.range(2) == 0 { Pat::Acorn } else { Pat::RPent }, f, 2));
                    }
                    ambitious.push((Pat::Lwss, t, 15));
                }
            }
        }
        let grows = |p: Pat| !matches!(p, Pat::Pulsar | Pat::Gun | Pat::Acorn | Pat::RPent) || small;
        let note = Some(if bench { 40 } else { NOTE_LEN });
        let mut order: Vec<(Pat, (i32, i32), i32)> = Vec::new();
        if !ambitious.is_empty() && self.rng.range(3) == 0 {
            order.extend(ambitious.iter().copied());
        }
        order.extend(ordinary.into_iter().filter(|o| grows(o.0)));
        if my_cells == 0 {
            let f = self.fresh_spot();
            order.insert(0, (Pat::Beehive, f, 3));
        }
        for (pat, at, radius) in order {
            let n = pat.cells().len() as u32;
            let cost = self.cost(n, false);
            if cost > limit {
                continue;
            }
            let deposit = self.plant_deposit(i, n, note, None);
            if attaches && deposit > self.accts[i].wallet {
                continue;
            }
            let (w, h) = (self.w, self.h);
            let shape = pat.cells();
            let (free, _) = self.try_place(me, 10, |rng| shape_cells(w, h, shape, at.0 + rng.range(2 * radius as u64 + 1) as i32 - radius, at.1 + rng.range(2 * radius as u64 + 1) as i32 - radius, rng.range(4) as u8));
            if let Some(c) = free {
                if self.plant(i, c, false, note, None) {
                    return;
                }
            }
        }
    }

    /// Where a strain's cells are (a random one of its living cells), else its home.
    fn home_of(&mut self, i: usize) -> (i32, i32) {
        let me = self.accts[i].id;
        if self.live[me as usize] == 0 {
            return self.accts[i].home;
        }
        let n = self.d.cells.len() as u64;
        for _ in 0..200 {
            let k = self.rng.range(n) as usize;
            if self.d.cells[k] == me {
                return ((k % self.w as usize) as i32, (k / self.w as usize) as i32);
            }
        }
        self.accts[i].home
    }

    /// maybeFossilize: every 12 h on mainnet (6 h testnet), the densest 16x16 window on an 8-cell grid holding at least
    /// 12 of the strain's cells, if it keeps 24 cells' price after the cost.
    fn fossilize(&mut self, i: usize) {
        let every = if self.s.net == Net::Mainnet { 12 } else { 6 } * self.r.gens_per_day() / 24;
        if self.accts[i].last_slide != 0 && self.t < self.accts[i].last_slide + every {
            return;
        }
        if self.accts[i].last_slide == 0 && self.t < every / 4 {
            return;
        }
        let me = self.accts[i].id;
        let (w, h) = (self.w, self.h);
        let mut best = 0u32;
        for y in (0..h).step_by(8) {
            for x in (0..w).step_by(8) {
                let mut n = 0;
                for dy in 0..16 {
                    for dx in 0..16 {
                        if self.d.cells[(((y + dy) % h) * w + (x + dx) % w) as usize] == me {
                            n += 1;
                        }
                    }
                }
                best = best.max(n);
            }
        }
        self.accts[i].last_slide = self.t.max(1);
        if best < 12 {
            return;
        }
        let cost = self.r.slide_cells_price * best as u128;
        if self.accts[i].balance < cost + self.cost(24, false) {
            return;
        }
        self.mint_slide(i, best, 16, 16, Some(30));
    }

    /// The royalty farmer's launch: plant each common pattern on free ground and mint a slide of it in the same
    /// generation (planting and minting in one 15-second generation capture it as planted).
    fn farm(&mut self, i: usize) {
        let pats = [Pat::Beehive, Pat::Loaf, Pat::Eater, Pat::Glider, Pat::Lwss, Pat::RPent, Pat::Toad, Pat::Pulsar];
        let me = self.accts[i].id;
        for pat in pats {
            // v6.1: a slide under `licence_min_cells` licenses nothing, so the farmer mints only those that do.
            if !self.by_pat[pat.idx()].is_empty() || (pat.cells().len() as u32) < self.r.licence_min_cells {
                continue;
            }
            let (w, h) = (self.w, self.h);
            let shape = pat.cells();
            let n = shape.len() as u32;
            self.begin(Payer::Acct(i), Call::Plant);
            self.catch_up();
            let f = self.fresh_spot();
            let (free, _) = self.try_place(me, 30, |rng| shape_cells(w, h, shape, f.0 + rng.range(9) as i32 - 4, f.1 + rng.range(9) as i32 - 4, 0));
            let Some(c) = free else { continue };
            if !self.plant(i, c, false, None, None) {
                continue;
            }
            let (bw, bh) = pat.bbox();
            if self.mint_slide(i, n, bw, bh, None) {
                let s = self.slides.len();
                self.slides.push(SlideRec { pat, rot: 0, holder: i, royalties: 0, plantings: 0 });
                self.by_pat[pat.idx()].push(s);
            }
        }
    }

    fn act(&mut self, i: usize) {
        let t = self.t;
        let (kind, role, home, every, phase, stop) = {
            let a = &self.accts[i];
            (a.kind(), a.role(), a.home, a.every, a.phase, a.credit_stop)
        };
        if role == Role::Sub && t >= stop {
            return;
        }
        match kind {
            Kind::Racer | Kind::Seller => {}
            Kind::Locker => self.locker(i),
            Kind::Penny => {
                if (t + phase) % every == 0 {
                    self.penny(i);
                }
            }
            Kind::House | Kind::Bench => {
                if t >= self.accts[i].next_at {
                    self.house_act(i);
                    let (lo, hi) = (every / 1000, every % 1000);
                    let pace = if kind == Kind::House && self.s.net == Net::Mainnet { 8 } else { 1 };
                    let gap = lo * pace + self.rng.range((hi - lo) * pace + 1);
                    self.accts[i].next_at = self.due().max(t) + gap.max(1);
                }
            }
            Kind::Farmer => {
                if self.accts[i].plants == 0 {
                    self.farm(i);
                }
            }
            Kind::Sniper => {
                let te = self.r.tide_every;
                if te - (t % te) <= 3 && self.may_act(i) {
                    self.begin(Payer::Acct(i), Call::Plant);
                    self.catch_up();
                    self.plant_near(i, Pat::Block, home, 20, 5, true, None);
                }
            }
            _ => {
                if (t + phase) % every != 0 || !self.may_act(i) {
                    return;
                }
                self.begin(Payer::Acct(i), Call::Plant);
                self.catch_up();
                self.top_up(i);
                let pick = self.rng.range(6) as usize;
                match (kind, role) {
                    (Kind::Raider, _) => self.raid(i),
                    (Kind::Defender, _) => {
                        let s = if pick % 2 == 0 { Pat::Eater } else { Pat::Beehive };
                        self.plant_near(i, s, home, 12, 5, true, None);
                    }
                    (Kind::Methuselah, _) => {
                        self.plant_near(i, Pat::RPent, home, 40, 10, true, None);
                    }
                    (Kind::Whale | Kind::SplitWhale, _) => {
                        let s = if pick % 2 == 0 { Pat::Pulsar } else { Pat::Beehive };
                        let center = if kind == Kind::Whale { (self.rng.range(self.w as u64) as i32, self.rng.range(self.h as u64) as i32) } else { home };
                        self.plant_near(i, s, center, 30, 10, true, None);
                    }
                    (Kind::SybilGuest | Kind::SybilTransfer, Role::Guest) => {
                        self.plant_near(i, Pat::Block, home, 12, 5, true, None);
                    }
                    (Kind::SybilAttach, Role::Guest) => {
                        // A day of free farming, then 0.01 NEAR attached through a purchase the operator pays for; it
                        // plants nothing more until it has sold what it farmed (planting would spend it), or the
                        // contract has refused the sale.
                        if !self.accts[i].attached_flag && t >= self.accts[i].join_at + self.r.gens_per_day() {
                            self.intent_buy(i, NEAR / 100);
                        }
                        let a = &self.accts[i];
                        if !a.attached_flag || a.kept == 0 || a.kept_refused > 0 {
                            self.plant_near(i, Pat::Block, home, 12, 5, true, None);
                        }
                    }
                    (Kind::SybilRoyalty, Role::Wallet) => {
                        // Its own slide first; then a builder.
                        if self.by_pat[Pat::Beehive.idx()].iter().all(|&s| self.slides[s].holder != i) {
                            self.own_slide(i, Pat::Beehive);
                        } else {
                            self.plant_near(i, Pat::Block, home, 12, 5, false, None);
                        }
                    }
                    (Kind::SybilRoyalty, Role::Guest) => {
                        // Beehives under the operator's licence, as much as its PETRI allows.
                        self.plant_near(i, Pat::Beehive, home, 14, 10, true, None);
                    }
                    _ => {
                        let s = [Pat::Block, Pat::Beehive, Pat::Loaf][pick % 3];
                        self.plant_near(i, s, home, 12, 5, true, None);
                    }
                }
            }
        }
    }

    /// Plant `pat` on free ground and mint a slide of it in the same generation.
    fn own_slide(&mut self, i: usize, pat: Pat) {
        let me = self.accts[i].id;
        let (w, h) = (self.w, self.h);
        let shape = pat.cells();
        let n = shape.len() as u32;
        let home = self.accts[i].home;
        let (free, _) = self.try_place(me, 30, |rng| shape_cells(w, h, shape, home.0 + rng.range(21) as i32 - 10, home.1 + rng.range(21) as i32 - 10, 0));
        let Some(c) = free else { return };
        if !self.plant(i, c, false, None, None) {
            return;
        }
        let (bw, bh) = pat.bbox();
        if self.mint_slide(i, n, bw, bh, None) {
            let s = self.slides.len();
            self.slides.push(SlideRec { pat, rot: 0, holder: i, royalties: 0, plantings: 0 });
            self.by_pat[pat.idx()].push(s);
        }
    }

    /// The outside player (summed over its colonies) holding the most living cells: its share of all living cells.
    fn top_live(&self) -> (f64, Option<Kind>) {
        if self.total_live == 0 {
            return (0.0, None);
        }
        let mut by = vec![(0u64, None); self.groups];
        for a in self.accts.iter().filter(|a| a.joined && a.kind() != Kind::House) {
            let e = &mut by[a.group];
            e.0 += self.live.get(a.id as usize).copied().unwrap_or(0) as u64;
            e.1 = Some(a.kind());
        }
        let (n, k) = by.into_iter().max_by_key(|e| e.0).unwrap_or((0, None));
        (n as f64 / self.total_live as f64, if n > 0 { k } else { None })
    }

    /// PETRI players hold (balances and unclaimed earnings), and the largest share of it one outside player holds.
    fn top_held(&self) -> (u128, f64) {
        let mut by = vec![0u128; self.groups];
        let mut all = 0u128;
        for a in self.accts.iter().filter(|a| a.joined) {
            let u = a.balance + a.unclaimed;
            all += u;
            if a.kind() != Kind::House {
                by[a.group] += u;
            }
        }
        let top = by.into_iter().max().unwrap_or(0);
        (all, if all > 0 { top as f64 / all as f64 } else { 0.0 })
    }

    fn day_row(&mut self) {
        let gpd = self.r.gens_per_day();
        let house: Vec<&Acct> = self.accts.iter().filter(|a| a.kind() == Kind::House).collect();
        let house_paid = house.iter().map(|a| a.attached + a.gas).sum();
        let house_left = house.iter().map(|a| if self.s.net == Net::Mainnet { a.wallet } else { a.credit() }).sum();
        let day = (self.t + 1) / gpd;
        let (top_live_share, top_live_kind) = self.top_live();
        let (held, top_held_share) = self.top_held();
        let rt = self.round_trip();
        if self.house_out_day.is_none() && !house.is_empty() && house.iter().all(|a| if self.s.net == Net::Mainnet { a.wallet < a.floor + HOUSE_TOP_UP } else { a.credit() < HOUSE_TOP_UP }) {
            self.house_out_day = Some(day);
        }
        let row = DayRow {
            day,
            gen: self.gen,
            skipped: self.skipped,
            live: self.total_live,
            counted: self.counted,
            agar: self.agar,
            burned: self.burned,
            fed: self.fed,
            vault: self.vault,
            credit_pool: self.credit_pool,
            per_cell_feed: self.per_cell(),
            cell_price: self.cost(1, false),
            keeper_calls: self.keeper.calls,
            keeper_gas: self.keeper.gas,
            house_paid,
            house_left,
            house_plants: std::mem::take(&mut self.house_plants_today),
            contract_storage: self.storage_contract,
            hot_rows: self.hot_rows,
            tides_run: self.tides_today.0,
            tides_skipped: self.tides_today.1,
            joined: self.accts.iter().filter(|a| a.joined).count(),
            claimed: self.claimed_total,
            vault_out: self.tides_paid + self.tides_as_credit + self.bounties + self.sold_total + self.credit_sold,
            held,
            top_live_share,
            top_live_kind,
            top_held_share,
            vault_in: self.vault_in,
            vault_in_house: self.vault_in_h,
            out_players: self.out_players,
            out_house: self.out_h,
            vault_house: self.vault_h,
            rt_units: rt.0,
            rt_curve: rt.1,
            rt_back: rt.2,
            sell_left: self.sell_left,
        };
        self.tides_today = (0, 0);
        self.days.push(row);
    }

    pub fn run(mut self) -> RunOut {
        let t0 = Instant::now();
        let n = self.accts.len();
        let gpd = self.r.gens_per_day();
        let te = self.r.tide_every;
        let mut next_join = 0usize;
        let mut next_snap = 0usize;
        let mut last_tides = 0u64;
        for t in 0..self.total {
            self.t = t;
            while next_join < n && self.accts[next_join].join_at <= t {
                self.join(next_join);
                next_join += 1;
            }
            for r in 0..self.racers.len() {
                let i = self.racers[r];
                self.racer(i);
            }
            if self.tides > last_tides && t % te == 1 {
                last_tides = self.tides;
                self.sell_round();
            }
            if n > 0 {
                let start = (t as usize).wrapping_mul(7919) % n;
                for j in 0..n {
                    let i = (start + j) % n;
                    if self.accts[i].joined {
                        self.act(i);
                    }
                }
            }
            // Players claim their tide NEAR once a day.
            if t % gpd == gpd / 2 {
                for i in 0..n {
                    let a = &self.accts[i];
                    if a.joined && a.kind() != Kind::House && a.kind() != Kind::Bench && a.owed > (claim_bytes(self.v6()) + PAYOUT_RESERVE) * BYTE {
                        self.claim(i);
                    }
                }
            }
            if self.s.keeper_on {
                let behind = self.due().saturating_sub(self.gen);
                let due = match self.s.net {
                    Net::Mainnet => self.first_outsider.is_some() && behind >= 400,
                    Net::Testnet => behind >= 20 || (self.s.keeper_registered && self.keeper_pot > 50 * UNIT),
                };
                if due {
                    self.advance(Payer::Keeper);
                }
            }
            // Economics report: each account's books a day after it joined (accounts are in joining order).
            while next_snap < n && self.accts[next_snap].join_at + gpd <= t {
                if self.accts[next_snap].joined {
                    let sn = self.snap(next_snap);
                    self.accts[next_snap].day1 = Some(sn);
                }
                next_snap += 1;
            }
            if t % gpd == gpd - 1 {
                self.day_row();
            }
        }
        // The end: one advance (the keeper), everyone claims, self-sponsors take their grants back.
        self.t = self.total;
        self.advance(Payer::Keeper);
        for i in 0..n {
            let a = &self.accts[i];
            if a.joined && a.kind() != Kind::House && a.owed > (claim_bytes(self.v6()) + PAYOUT_RESERVE) * BYTE {
                self.claim(i);
            }
        }
        for i in 0..n {
            self.unsponsor(i);
        }
        self.finish(t0.elapsed().as_secs_f64())
    }

    fn finish(self, secs: f64) -> RunOut {
        let storage = sell_bytes(self.v6()) * BYTE;
        let mut groups: Vec<Option<GroupOut>> = vec![None; self.groups];
        let mut held_total = 0u128;
        let mut house_paid = 0u128;
        let mut house_attached = 0u128;
        let mut house_left = 0u128;
        let mut relayer_gas = 0u128;
        let mut credit_outstanding = 0u128;
        let mut tides_owed = 0u128;
        for a in self.accts.iter().filter(|a| a.joined) {
            let units = a.balance + a.unclaimed;
            let held = if units > 0 { self.sell_quote(units).saturating_sub(storage) } else { 0 };
            if a.kind() == Kind::House {
                house_paid += a.attached + a.gas;
                house_attached += a.attached;
                house_left += if self.s.net == Net::Mainnet { a.wallet } else { a.credit() };
            } else {
                held_total += held;
            }
            relayer_gas += a.relayer_gas;
            credit_outstanding += a.credit();
            tides_owed += a.owed;
            let e = groups[a.group].get_or_insert(GroupOut {
                kind: a.kind(),
                accounts: 0,
                first_join: a.join_at,
                attached: 0,
                sponsored: 0,
                gas: 0,
                relayer_gas: 0,
                claimed: 0,
                sold: 0,
                bounty: 0,
                reclaimed: 0,
                owed: 0,
                held: 0,
                held_credit: 0,
                credit_left: 0,
                credit_won: 0,
                credit_sold: 0,
                earned: 0,
                spent: 0,
                royalty_in: 0,
                royalty_in_credit: 0,
                royalty_out: 0,
                tide_share: 0,
                slide_storage: 0,
                pot: 0,
                live: 0,
                live_gens: 0,
                unpaid_gens: 0,
                plants: 0,
                licensed: 0,
                failed: 0,
                kept_refused: 0,
                kept_left: 0,
                farm_sold: 0,
                moved: 0,
                pact_paid: 0,
                pact_in: 0,
                pact_refused: 0,
                pact_diverted: 0,
                budget: 0,
                vault_in: 0,
                bought: 0,
                day1: Snap::default(),
                day1_n: 0,
            });
            e.budget += a.budget;
            e.vault_in += a.vault_in;
            e.bought += a.bought;
            if let Some(d) = &a.day1 {
                e.day1.add(d);
                e.day1_n += 1;
            }
            e.kept_refused += a.kept_refused;
            e.kept_left += a.kept;
            e.farm_sold += a.farm_sold;
            e.moved += a.moved_out;
            e.pact_paid += a.pact_paid;
            e.pact_in += a.pact_in;
            e.pact_refused += a.pact_refused;
            e.pact_diverted += a.pact_diverted;
            e.accounts += 1;
            e.first_join = e.first_join.min(a.join_at);
            e.attached += a.attached;
            e.sponsored += a.sponsored_paid;
            e.gas += a.gas;
            e.relayer_gas += a.relayer_gas;
            e.claimed += a.claimed;
            e.sold += a.sold;
            e.bounty += a.bounty;
            e.reclaimed += a.reclaimed;
            e.owed += a.owed;
            if a.attached_flag {
                e.held += held;
            } else {
                e.held_credit += held;
            }
            e.credit_left += a.credit();
            e.credit_won += a.credit_won;
            e.credit_sold += a.credit_sold;
            e.earned += a.earned;
            e.spent += a.spent;
            e.royalty_in += a.royalty_in;
            e.royalty_in_credit += a.royalty_in_credit;
            e.royalty_out += a.royalty_out;
            e.tide_share += a.tide_share;
            e.slide_storage += a.slide_storage;
            e.pot += a.pot;
            e.live += self.live.get(a.id as usize).copied().unwrap_or(0);
            e.live_gens += a.live_gens;
            e.unpaid_gens += a.unpaid_gens;
            e.plants += a.plants;
            e.licensed += a.licensed;
            e.failed += a.failed_calls;
        }
        let groups: Vec<GroupOut> = groups.into_iter().flatten().collect();
        let top = groups.iter().filter(|g| g.kind != Kind::House).max_by_key(|g| g.tide_share);
        let all = self.tide_split_sum.max(1);
        let wg = self.work_gens.max(1) as f64;
        RunOut {
            world: WorldOut {
                live: self.total_live,
                peak: self.peak_live,
                agar: self.agar,
                burned: self.burned,
                fed: self.fed,
                vault: self.vault,
                credit_pool: self.credit_pool,
                credit_outstanding,
                tides_owed,
                held_total,
                near_attached: self.near_attached,
                near_sponsored: self.near_sponsored + self.accts.iter().filter(|a| a.role() != Role::Wallet && a.join_at < self.total).count() as u128 * NEAR / 20,
                vault_in: self.vault_in,
                credit_in: self.credit_in,
                tides_paid: self.tides_paid,
                tides_as_credit: self.tides_as_credit,
                credit_paid: self.credit_paid,
                bounties: self.bounties,
                bounties_kept: self.bounties_kept,
                bounties_credit: self.bounties_credit,
                sold_total: self.sold_total,
                credit_sold: self.credit_sold,
                reclaimed_total: self.reclaimed_total,
                claimed_total: self.claimed_total,
                royalties: self.royalties,
                storage_players: self.storage_players,
                storage_vault: self.storage_vault,
                storage_contract: self.storage_contract,
                keeper: self.keeper.clone(),
                keeper_pot: self.keeper_pot,
                relayer_near: self.relayer_near,
                relayer_gas,
                house_paid,
                house_attached,
                house_left,
                house_out_of_near_day: self.house_out_day,
                work_live_avg: self.work_live as f64 / wg,
                work_alive_avg: self.work_alive as f64 / wg,
                calls: self.calls,
                gas_total: self.gas_total,
                gas_max: self.gas_max,
                gas_rows_at_max: self.gas_rows_at_max,
                over_prepaid: self.over_prepaid,
                call_count: self.call_count,
                hot_max: self.hot_max,
                hot_avg: self.hot_sum as f64 / self.hot_samples.max(1) as f64,
                partial_catchups: self.partial_catchups,
                plant_fail_behind: self.plant_fail_behind,
                plant_refused_full: self.plant_refused_full,
                over_target: self.over_target,
                hot_left: self.hot_left,
                royalties_to_agar: self.royalties_to_agar,
                skips: self.skips,
                skipped: self.skipped,
                tides: self.tides,
                tides_skipped: self.tides_skipped,
                gen_end: self.gen,
                first_share: self.first_share_sum as f64 / all as f64,
                first_tides90: self.first_tides90 as f64 / self.tides_paying.max(1) as f64,
                tides_paying: self.tides_paying,
                top_share: top.map(|g| g.tide_share as f64 / all as f64).unwrap_or(0.0),
                top_kind: top.filter(|g| g.tide_share > 0).map(|g| g.kind),
                house_to_players_petri: 0,
                secs,
                vault_in_house: self.vault_in_h,
                out_players: self.out_players,
                out_house: self.out_h,
                vault_house: self.vault_h,
            },
            groups,
            timeline: self.timeline,
            days: self.days,
            slides: self.slides,
        }
    }
}
