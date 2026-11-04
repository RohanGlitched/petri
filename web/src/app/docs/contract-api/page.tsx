import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, H2, Table } from "@/components/docs/ui";

export const metadata = docMetadata("contract-api");

type Kind = "change" | "payable" | "view" | "private";
type M = {
  name: string;
  kind: Kind;
  sig: string;
  args?: string;
  what: React.ReactNode;
  deposit?: React.ReactNode;
  gas?: React.ReactNode;
  returns?: React.ReactNode;
  errors?: string[];
  events?: React.ReactNode;
};

const KIND_LABEL: Record<Kind, string> = { change: "call", payable: "payable call", view: "view", private: "callback" };

function Method({ m }: { m: M }) {
  const rows: [string, React.ReactNode][] = [];
  if (m.deposit) rows.push(["Deposit", m.deposit]);
  if (m.gas) rows.push(["Gas", m.gas]);
  if (m.returns) rows.push(["Returns", m.returns]);
  if (m.events) rows.push(["Events", m.events]);
  return (
    <section className="d-method" aria-labelledby={`m-${m.name}`}>
      <h3 id={`m-${m.name}`} className="d-h3">
        <a href={`#m-${m.name}`} className="d-anchor" aria-hidden="true" tabIndex={-1}>
          #
        </a>
        {m.name}
        <span className={`d-kind d-kind-${m.kind}`}>{KIND_LABEL[m.kind]}</span>
      </h3>
      <Code lang="rust" copy={false} title="Signature">{m.sig}</Code>
      <div>{m.what}</div>
      {m.args && <Code lang="json" title="Arguments (JSON)">{m.args}</Code>}
      {rows.length > 0 && (
        <dl className="d-facts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {m.errors && m.errors.length > 0 && (
        <>
          <p style={{ marginBottom: 6, color: "var(--dim)", fontSize: 15 }}>Panics with</p>
          <ul>
            {m.errors.map((e) => (
              <li key={e}>
                <C>{e}</C>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const EV = (...names: string[]) => (
  <>
    {names.map((n, i) => (
      <span key={n}>
        {i > 0 && ", "}
        <a href={`#ev-${n.replace(/^nep\d+ /, "")}`}>
          <C>{n}</C>
        </a>
      </span>
    ))}
  </>
);

// Messages several methods share.
const CALLER = "the dish does not play on itself";
const JOIN_FIRST = "join the dish first";
const CREDIT = "this account has {n} NEAR of won and sponsored credit";
const NAME_ERRORS = [
  "name must be 1 to 24 characters",
  "a name may use only letters A to Z, digits, spaces and - ' . & ! ? _ , : ( )",
  'names of the form "Culture <hex digits>" are kept for colonies someone else paid to start',
];
const ONE_YOCTO = "requires exactly 1 yoctoNEAR";
const NO_SLIDE = "there is no slide with that id";

const KEPT_MSG = "PETRI earned before a colony's first NEAR stays in the dish: you hold {n} kept PETRI; plant it first (kept PETRI is spent first), then you can pay for a pact";
const DISH: M[] = [
  {
    name: "join",
    kind: "payable",
    sig: "pub fn join(&mut self, name: String, color: u32, credit: Option<U128>) -> Colony",
    args: `{ "name": "My Colony", "color": 15905882, "credit": null }`,
    what: (
      <p>
        Makes the caller a colony, once per account. The NEAR it brings (attached, plus <C>credit</C> yoctoNEAR taken from its sponsored credit; an account with no colony has no won credit yet) pays the colony&rsquo;s storage and 113 bytes for the purchase entry; the rest buys PETRI from the agar. Attached NEAR goes to the vault, credit to the credit pool. Catches the dish up first; tides that catch-up runs pay their bounty to the joining account. An account named in <C>rules.house</C> or <C>rules.keepers</C> joins as a house colony (<C>house: true</C>). A player cannot choose a name of the form <C>Culture &lt;hex digits&gt;</C>: those are kept for colonies someone else paid to start.
      </p>
    ),
    deposit: "At least min_join (0.01 NEAR), attached and credit together, and more than the colony's storage plus 113 bytes. The site attaches 0.02 NEAR.",
    gas: "300 TGas (the site's value; unused gas is refunded).",
    returns: <>The new <a href="#t-colony">Colony</a>.</>,
    errors: [
      CALLER,
      ...NAME_ERRORS,
      CREDIT,
      "this account already has a colony",
      "a colony with that name already exists",
      "color must be 0xRRGGBB",
      "the dish is full of colonies",
      "joining needs at least 0.01 NEAR",
      "joining needs more than the {n} NEAR its storage costs",
      "that is not enough NEAR to buy any PETRI",
    ],
    events: EV("join", "nep141 ft_transfer", "generation", "skip"),
  },
  {
    name: "plant",
    kind: "payable",
    sig: "pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>, credit: Option<U128>, slide: Option<String>) -> U64",
    args: `{ "cells": [5160, 5161, 5288, 5289], "note": "a block to start", "credit": null, "slide": null }`,
    what: (
      <>
        <p>
          Brings <C>cells</C> (flat indices, <C>y * width + x</C>) to life for the caller&rsquo;s colony. Catches up, requires the stored generation to equal the clock&rsquo;s, claims the colony&rsquo;s earnings into its balance, checks the cells with <C>Dish::check_plant</C> (house cells never make a siege), charges the price (×<C>siege_x</C> = 3 for a siege), burns half, returns half to the agar, adds <C>cells × 1000</C> to the stake (a colony with no row enters the hot table, which holds at most 10,000 rows: while it is full, up to 32 rows that may leave move out first, and if it is still full the planting is refused) and records a <C>Plant</C> entry. NEAR beyond the planting&rsquo;s storage goes to the vault (attached) or the credit pool (credit); nothing is sent back.
        </p>
        <p>
          With <C>slide</C> (a token id), the planting is made under that specimen slide&rsquo;s licence, if the slide captured at least <C>licence_min_cells</C> (12) cells; a smaller slide is a keepsake and the planting is refused. The cells must be exactly the slide&rsquo;s pattern moved to any place on the wrapped dish, every cell once, not turned or flipped (<C>petri_core::fits_slide</C>). The price is <C>slide_discount_bps</C> (2500, 25%) less, the siege surcharge still applies in full, and a planter that does not hold the slide also pays the holder <C>slide_royalty_bps</C> (1000, 10%) of that discounted cost in PETRI, a transfer, not a burn. A holder with no PETRI registration is registered at the planter&rsquo;s expense (125 bytes). A planter that has never attached NEAR before this planting pays the royalty to the agar instead (counted in <C>returned</C>; the holder and the slide&rsquo;s <C>royalties</C> get nothing). The house may plant only slides it holds. The entry&rsquo;s <C>licence</C> records the token, the slide&rsquo;s move count, the holder, the royalty and <C>to_agar</C>.
        </p>
      </>
    ),
    deposit: (
      <>
        <C>plant_deposit(cells.len, note_bytes, slide)</C>: the planting&rsquo;s storage allowance plus 0.0001 NEAR per cell. At least the cell fee is checked before any work, and storage + fee after.
      </>
    ),
    gas: "300 TGas (the site's value; unused gas is refunded).",
    returns: "The generation the cells were planted at (U64).",
    errors: [
      CALLER,
      "a lab note may not contain control, direction, invisible or tag characters",
      "a lab note is at most 140 characters",
      JOIN_FIRST,
      "plant 1 to 64 cells",
      "a cell is off the dish",
      NO_SLIDE,
      "slide {n} captured {c} cells; only a slide of at least {m} cells is a licence",
      "those cells are not the slide's pattern: plant exactly its cells, moved anywhere but not turned",
      CREDIT,
      "planting {n} cells needs at least {n} NEAR",
      "the dish is behind the clock; call advance first",
      "one planting per generation; wait for the next one",
      "cell ({x}, {y}) is listed twice",
      "cell ({x}, {y}) is already alive",
      "10000 colonies are playing at once, the most the dish holds; plant again after the next tide",
      "the house plants only slides it holds: its PETRI never goes to players",
      "planting {n} cells[ inside a rival's buffer] costs {p} PETRI[ and a {r} PETRI royalty]; you hold {b}",
      "this planting needs {n} NEAR for its storage and fee",
    ],
    events: EV("plant", "nep141 ft_burn", "nep141 ft_transfer", "generation", "skip"),
  },
  {
    name: "buy",
    kind: "payable",
    sig: "pub fn buy(&mut self, credit: Option<U128>) -> U128",
    args: `{ "credit": null }`,
    what: <p>Buys PETRI from the agar for the caller&rsquo;s colony with the attached NEAR plus <C>credit</C>, at the curve&rsquo;s midpoint price. 113 bytes of storage (0.00113 NEAR) come off the top for the purchase entry, from credit first.</p>,
    deposit: "More than 0.00113 NEAR, attached and credit together. The site uses 0.01 NEAR.",
    gas: "300 TGas (the site's value; unused gas is refunded).",
    returns: "PETRI units bought.",
    errors: [CALLER, JOIN_FIRST, CREDIT, "a purchase needs more than the 0.00113 NEAR its record costs", "that is not enough NEAR to buy any PETRI"],
    events: EV("nep141 ft_transfer", "generation", "skip"),
  },
  {
    name: "sell",
    kind: "change",
    sig: "pub fn sell(&mut self, petri: U128) -> U128",
    args: `{ "petri": "20000000" }`,
    what: (
      <p>
        Catches up and claims the colony&rsquo;s earnings first, so its balance counts them. Then hands <C>petri</C> units back to the agar for NEAR from the vault: <C>sell_quote(petri)</C>, less the storage of the <C>Sell</C> entry. A colony holding kept PETRI (what it earned before its first NEAR, or bought with credit) cannot sell for NEAR until its plantings have spent it; a colony that never attached NEAR may still sell for credit, which spends its kept PETRI. Limited by <C>state().sell_left</C>, which each tide sets to 10% of the vault (zero before the first tide). The house never sells: a house colony is refused. A colony that never attached NEAR is paid in won credit instead; otherwise the NEAR goes to its payout account or its own. A NEAR sale must also be large enough to pay for a refund&rsquo;s records (239 bytes) should the transfer fail; a failed transfer becomes pending NEAR for the colony&rsquo;s own account (see <a href="#callbacks">on_payout</a>).
      </p>
    ),
    deposit: "None.",
    gas: "300 TGas (the site's value; unused gas is refunded).",
    returns: "yoctoNEAR paid (or credited).",
    errors: [
      CALLER,
      JOIN_FIRST,
      "the dish's own colonies never sell PETRI back: the vault is the players'",
      "sell at least some PETRI",
      "you hold {n} PETRI",
      "that is too little PETRI to buy back",
      "the agar buys back at most {n} NEAR more before the next tide",
      "that is too little PETRI to cover the sale's record",
      "PETRI earned before a colony's first NEAR stays in the dish: you hold {n} kept PETRI; plant it first (kept PETRI is spent first), then you can sell PETRI for NEAR",
    ],
    events: EV("sell", "nep141 ft_transfer", "generation", "skip", "payout_failed"),
  },
  {
    name: "advance",
    kind: "change",
    sig: "pub fn advance(&mut self, max: Option<u32>) -> U64",
    args: `{ "max": 120 }`,
    what: (
      <p>
        Steps up to <C>max</C> due generations (default and ceiling 120, at least 1). Anyone may call it. Like every call that catches the dish up, if it ran at least one generation and the caller can hold PETRI (a colony, or registered with <C>storage_deposit</C>) and is not one of the house&rsquo;s accounts (a house strain or a keeper) or a guest (a colony that has never attached NEAR), it takes the keeper pot: the catch-up pays it, not <C>advance</C> separately. Tides it runs pay the caller their bounty: in NEAR, or as credit if the caller is a colony that never attached NEAR. A tide run by a house colony or a keeper pays no bounty: it stays in the vault, and a keeper with no colony is recorded as <C>by: 65535</C>.
      </p>
    ),
    deposit: "None.",
    gas: "300 TGas (the site's value; unused gas is refunded). A catch-up stops early past min(110 TGas, prepaid − 40 TGas), less what is still to be written, but always steps at least one generation.",
    returns: "The stored generation after the call.",
    errors: [CALLER],
    events: EV("generation", "skip", "nep141 ft_transfer", "payout_failed"),
  },
  {
    name: "claim",
    kind: "change",
    sig: "pub fn claim(&mut self) -> Claimable",
    args: `{}`,
    what: (
      <p>
        Moves the colony&rsquo;s unclaimed PETRI into its balance and sends the NEAR it has won at tides to its payout account or its own, with a <C>Claim</C> entry paid from that NEAR. NEAR winnings too small for the entry plus a refund&rsquo;s records (about 0.0034 NEAR) stay owed until they are larger. Credit won needs no claim. If the transfer fails, <C>on_payout</C> makes the NEAR pending for the colony&rsquo;s own account.
      </p>
    ),
    deposit: "None.",
    gas: "300 TGas (the site's value; unused gas is refunded).",
    returns: <><a href="#t-claimable">Claimable</a>: the PETRI claimed and the NEAR sent (after the entry&rsquo;s storage).</>,
    errors: [CALLER, JOIN_FIRST],
    events: EV("claim", "nep141 ft_transfer", "generation", "skip", "payout_failed"),
  },
  {
    name: "rename",
    kind: "change",
    sig: "pub fn rename(&mut self, name: String, color: u32) -> Colony",
    args: `{ "name": "Better Name", "color": 2364586 }`,
    what: (
      <p>
        Chooses the name and colour, once, for a colony someone else paid to start (<C>Colony.proxy = true</C>): one that a wNEAR payment from another sender started under a neutral name, <C>Culture</C> and 4 (then 6 to 16) hex digits of <C>sha256(account)</C>. After it, <C>proxy</C> is false. The new name follows the same rules as <C>join</C>&rsquo;s.
      </p>
    ),
    deposit: "None.",
    gas: "50 TGas (the site's value).",
    returns: "The updated Colony.",
    errors: [CALLER, JOIN_FIRST, "only a colony someone else started can be renamed, and only once", ...NAME_ERRORS, "a colony with that name already exists", "color must be 0xRRGGBB"],
    events: EV("rename"),
  },
];

const PAYOUTS: M[] = [
  {
    name: "set_payout",
    kind: "change",
    sig: "pub fn set_payout(&mut self, account_id: Option<AccountId>)",
    args: `{ "account_id": "cold-wallet.near" }`,
    what: <p>Sends the colony&rsquo;s NEAR payouts (tide claims and sales) to <C>account_id</C> from now on, or back to the colony&rsquo;s own account with <C>null</C>. Only a colony that has attached NEAR may set one, never to the dish itself; the relayer never relays it. A payout that cannot be delivered there becomes pending NEAR for the colony&rsquo;s own account.</p>,
    deposit: "None.",
    gas: "50 TGas (the site's value).",
    errors: [CALLER, JOIN_FIRST, "only a colony that has attached NEAR is paid in NEAR; free play earns credit, which stays in the dish", "payouts cannot go to the dish itself"],
    events: EV("payout"),
  },
];

const CREDIT_METHODS: M[] = [
  {
    name: "sponsor",
    kind: "payable",
    sig: "pub fn sponsor(&mut self, account_id: AccountId) -> U128",
    args: `{ "account_id": "g-0123456789.relayer.testnet" }`,
    what: (
      <p>
        Gives <C>account_id</C> the attached NEAR, less its records&rsquo; storage, as credit it can spend only in the dish. Each sponsor&rsquo;s credit is a separate <a href="#t-grant">Grant</a>: an account holds grants from at most 8 sponsors at once (a sponsor topping up its own grant always can), and a new grant also sets aside 210 bytes for the <C>Unsponsor</C> entry its sponsor may write later. Topping up restarts that grant&rsquo;s day. Records a <C>Sponsor</C> entry.
      </p>
    ),
    deposit: "At least 0.01 NEAR, and more than the records' storage. The site's relayer attaches 0.05 NEAR per guest.",
    gas: "30 TGas (the relayer's value).",
    returns: "This sponsor's credit for the account after the call.",
    errors: ["the dish does not hold credit for itself", "sponsoring takes at least 0.01 NEAR", "this account already has credit from 8 sponsors", "sponsoring needs more than the {n} NEAR its records cost"],
    events: EV("sponsor"),
  },
  {
    name: "unsponsor",
    kind: "change",
    sig: "pub fn unsponsor(&mut self, account_id: AccountId) -> U128",
    args: `{ "account_id": "g-0123456789.relayer.testnet" }`,
    what: (
      <p>
        The caller takes back what is left of its own grant to <C>account_id</C>, once 5,760 generations (a day at 15 s) of the wall clock (<C>due_generation + skipped</C>, so no catch-up is needed) have passed since it last topped the grant up or the account last drew on it. Other sponsors&rsquo; credit and what the account won stay the account&rsquo;s. Records an <C>Unsponsor</C> entry and sends the NEAR with a callback: a failed transfer becomes pending NEAR for the sponsor.
      </p>
    ),
    deposit: "None.",
    returns: "yoctoNEAR sent back to the sponsor.",
    errors: ["there is no credit of yours left on that account", "that credit was given or used in the last day"],
    events: EV("unsponsor", "payout_failed"),
  },
];

const TOKEN: M[] = [
  {
    name: "ft_transfer",
    kind: "payable",
    sig: "pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>)",
    args: `{ "receiver_id": "friend.near", "amount": "1000000", "memo": null }`,
    what: (
      <p>
        NEP-141 transfer. The receiver must be registered (a colony, or <C>storage_deposit</C>). PETRI cannot be sent to the contract itself. The house&rsquo;s accounts (house strains and keepers) can send PETRI only to other house accounts, so PETRI the house bought never reaches a player who could sell it into the vault; the strains&rsquo; pacts use <a href="#m-pact_offer">pact_offer</a> instead. A colony that has never attached NEAR (a guest) cannot send PETRI at all, and neither can a colony holding kept PETRI (see <a href="#m-sell">sell</a>); both can plant it.
      </p>
    ),
    deposit: "Exactly 1 yoctoNEAR.",
    errors: [
      ONE_YOCTO,
      CALLER,
      "amount must be positive",
      "PETRI goes back to the agar only by planting or selling",
      "sender and receiver are the same account",
      "the house's PETRI stays in the house: it plants with it and never hands it to players",
      "free play's PETRI stays in the dish: a colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)",
      "PETRI earned before a colony's first NEAR stays in the dish: you hold {n} kept PETRI; plant it first (kept PETRI is spent first), then you can send PETRI",
      "the receiver is not registered; it needs storage_deposit first",
      "not enough PETRI",
    ],
    events: EV("nep141 ft_transfer"),
  },
  {
    name: "ft_transfer_call",
    kind: "payable",
    sig: "pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128>",
    args: `{ "receiver_id": "some-contract.near", "amount": "1000000", "memo": null, "msg": "" }`,
    what: (
      <p>
        NEP-141 transfer and call, with the same rules as <C>ft_transfer</C>: the receiver&rsquo;s <C>ft_on_transfer</C> gets the gas left after the resolve callback (10 TGas) is set aside; <C>ft_resolve_transfer</C> refunds what it returns unused. If the sender unregistered meanwhile, the refund is burned instead, with a <C>Burn</C> entry, and counts as used. The same refusals as <C>ft_transfer</C> apply to a guest and to a colony holding kept PETRI.
      </p>
    ),
    deposit: "Exactly 1 yoctoNEAR.",
    gas: "At least 35 TGas must remain after the transfer (10 for the receiver, 10 for the resolve, 15 of margin).",
    errors: [ONE_YOCTO, CALLER, "amount must be positive", "PETRI goes back to the agar only by planting or selling", "sender and receiver are the same account", "the house's PETRI stays in the house: it plants with it and never hands it to players", "free play's PETRI stays in the dish: a colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)", "PETRI earned before a colony's first NEAR stays in the dish: you hold {n} kept PETRI; plant it first (kept PETRI is spent first), then you can send PETRI", "the receiver is not registered; it needs storage_deposit first", "not enough PETRI", "more gas is required"],
    events: EV("nep141 ft_transfer", "nep141 ft_burn"),
  },
  {
    name: "storage_deposit",
    kind: "payable",
    sig: "pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance",
    args: `{ "account_id": null, "registration_only": true }`,
    what: <p>NEP-145: registers an account to hold PETRI. It costs exactly 125 bytes (0.00125 NEAR); anything more is sent back, and a deposit for an account already registered is sent back whole. <C>registration_only</C> is accepted and ignored: nothing above the minimum is ever held.</p>,
    deposit: "0.00125 NEAR.",
    returns: <>StorageBalance <C>{`{ "total": "1250000000000000000000", "available": "0" }`}</C></>,
    errors: ["the dish does not register itself", "registering costs 0.00125 NEAR"],
  },
  {
    name: "storage_withdraw",
    kind: "payable",
    sig: "pub fn storage_withdraw(&mut self, amount: Option<U128>) -> StorageBalance",
    what: <p>NEP-145. Nothing above the minimum is ever held, so only an amount of zero (or none) succeeds.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: [ONE_YOCTO, "this account is not registered", "there is no storage deposit above the minimum to withdraw"],
  },
  {
    name: "storage_unregister",
    kind: "payable",
    sig: "pub fn storage_unregister(&mut self, force: Option<bool>) -> bool",
    what: (
      <p>
        NEP-145. Removes a registration and refunds 0.00125 NEAR. With PETRI still in it the call fails, unless <C>force</C> is true: then the PETRI is burned with a <C>Burn</C> entry, whose storage comes out of the refund. A colony&rsquo;s account cannot unregister, forced or not, for as long as the dish lives: its colony is paid into that balance.
      </p>
    ),
    deposit: "Exactly 1 yoctoNEAR.",
    returns: "false if the account was not registered, true once it is unregistered.",
    errors: [ONE_YOCTO, "a colony's account stays registered for as long as the dish lives: its colony is paid into it", "the account still holds PETRI; unregister with force to burn it"],
    events: EV("nep141 ft_burn"),
  },
];

const SLIDES: M[] = [
  {
    name: "mint_slide",
    kind: "payable",
    sig: "pub fn mint_slide(&mut self, x: u16, y: u16, w: u16, h: u16, title: Option<String>, credit: Option<U128>) -> String",
    args: `{ "x": 32, "y": 40, "w": 16, "h": 16, "title": "First garden", "credit": null }`,
    what: (
      <p>
        Mints a specimen slide of the caller colony&rsquo;s own living cells in the <C>w × h</C> rectangle at <C>(x, y)</C>, wrapping, at the stored generation after catching up. Burns <C>slide_cells_price</C> per captured cell (earnings are claimed first). Storage, with a 184-byte reserve for later owners, comes from <C>credit</C> first (up to the storage needed), then the attached NEAR; attached NEAR left over is sent back. Records a <C>Slide</C> ledger entry. A slide that captured at least <C>licence_min_cells</C> (12) cells is then a pattern licence; a smaller one (at least <C>slide_min_cells</C>, 5) is a keepsake: see <a href="#m-plant">plant</a>.
      </p>
    ),
    deposit: <><C>slide_deposit(w, h, title_bytes)</C>, attached or as credit.</>,
    gas: "300 TGas (the site's value; unused gas is refunded). Calls relayed for guests are capped at 300 TGas.",
    returns: "The token id, a decimal string (\"1\" is the first slide).",
    errors: [
      CALLER,
      JOIN_FIRST,
      "a slide is 4 to 32 cells on each side",
      "the slide's corner is off the dish",
      "a slide's title may not contain control, direction, invisible or tag characters",
      "a slide's title is at most 40 characters",
      "a slide needs at least 5 of your living cells; that rectangle holds {n}",
      "a slide of {n} cells costs {p} PETRI; you hold {b}",
      CREDIT,
      "this slide needs {n} NEAR for its storage",
    ],
    events: EV("nep171 nft_mint", "slide", "nep141 ft_burn", "generation", "skip"),
  },
  {
    name: "nft_transfer",
    kind: "payable",
    sig: "pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>)",
    args: `{ "receiver_id": "friend.near", "token_id": "1", "approval_id": null, "memo": null }`,
    what: <p>NEP-171 transfer by the owner or an approved account. Adds one to the slide&rsquo;s <C>moves</C>, clears its approvals and refunds their storage to the previous owner. Moves are not ledger entries (a 1-yoctoNEAR call cannot pay for one); each licensed planting records the move count it saw instead.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: [ONE_YOCTO, CALLER, NO_SLIDE, "only the slide's owner or an approved account can transfer it", "that approval id is out of date", "the slide already belongs to the receiver", "the dish does not hold slides"],
    events: EV("nep171 nft_transfer"),
  },
  {
    name: "nft_transfer_call",
    kind: "payable",
    sig: "pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool>",
    what: <p>NEP-171 transfer and call. If the receiver&rsquo;s <C>nft_on_transfer</C> returns true (or fails) and it still owns the slide, <C>nft_resolve_transfer</C> gives it back with its old approvals; the return counts as another move.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    gas: "At least 40 TGas must remain after the transfer (10 for the receiver, 15 for the resolve, 15 of margin).",
    errors: [ONE_YOCTO, CALLER, NO_SLIDE, "only the slide's owner or an approved account can transfer it", "that approval id is out of date", "the slide already belongs to the receiver", "the dish does not hold slides", "more gas is required"],
    events: EV("nep171 nft_transfer"),
  },
  {
    name: "nft_approve",
    kind: "payable",
    sig: "pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) -> Option<Promise>",
    what: <p>NEP-178: lets <C>account_id</C> transfer the slide. The deposit pays a new approval&rsquo;s storage (12 bytes + the account&rsquo;s length), refunded when the approval goes; the rest is sent back. Approving an account again only renews its approval id. With <C>msg</C>, calls <C>account_id.nft_on_approve</C>.</p>,
    deposit: "At least 1 yoctoNEAR, and the approval's storage for a new one.",
    errors: ["requires at least 1 yoctoNEAR", NO_SLIDE, "only the slide's owner can approve", "a slide has at most 16 approvals", "an approval needs {n} NEAR for its storage"],
  },
  {
    name: "nft_revoke",
    kind: "payable",
    sig: "pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId)",
    what: <p>NEP-178: removes one approval and refunds its storage to the owner.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: [ONE_YOCTO, NO_SLIDE, "only the slide's owner can revoke"],
  },
  {
    name: "nft_revoke_all",
    kind: "payable",
    sig: "pub fn nft_revoke_all(&mut self, token_id: String)",
    what: <p>NEP-178: removes every approval of the slide and refunds their storage to the owner.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: [ONE_YOCTO, NO_SLIDE, "only the slide's owner can revoke"],
  },
];

const PACTS: M[] = [
  {
    name: "pact_offer",
    kind: "payable",
    sig: "pub fn pact_offer(&mut self, to: AccountId, petri: U128, until: U64, credit: Option<U128>) -> u32",
    args: `{ "to": "violet.petri-dish.near", "petri": "2000000", "until": "1800", "credit": null }`,
    what: (
      <>
        <p>
          Colony A (the caller) offers the colony of account <C>to</C> (B) <C>petri</C> units of PETRI for B&rsquo;s promise not to plant within <C>pact_radius</C> (8) cells, across or down and wrapping, of A&rsquo;s living cells before generation <C>until</C>. The dish holds the PETRI in escrow (<C>state().pact_escrow</C>) until B accepts. It catches the dish up first; <C>until</C> must be after the stored generation and at most <C>pact_max_gens</C> (2,880, twelve hours) ahead. Returns the pact&rsquo;s number.
        </p>
        <p>
          Rules: one open offer from A to B at a time; each colony is party to at most 8 pacts that have not ended (expired pacts of both colonies are ended first, so slots free themselves). Only PETRI its maker could sell pays for a pact: a guest or a colony holding kept PETRI may offer <C>petri</C> 0 only. A house colony&rsquo;s pact with a player carries no PETRI; a player may pay the house; house-to-house pacts are free with or without PETRI. Writes a <C>PactOffer</C> ledger entry.
        </p>
      </>
    ),
    deposit: "The offer's storage, PACT_DEPOSIT = 0.0042 NEAR, from credit first, then attached NEAR; attached NEAR left over comes back.",
    gas: "300 TGas.",
    returns: "The pact's number (u32), from 1.",
    errors: [
      CALLER,
      JOIN_FIRST,
      "that account has no colony to make a pact with",
      "a colony makes no pact with itself",
      "the house's PETRI stays in the house: a house colony's pact with a player carries no PETRI",
      "a pact lasts until a later generation, at most pact_max_gens ahead of the dish",
      "each colony is party to at most 8 pacts at once, and one of these already is",
      "your offer to that colony is still open: one open offer to a colony at a time",
      "you hold {n} PETRI",
      "free play's PETRI stays in the dish: a colony that has never attached NEAR cannot send PETRI (it can plant it, or sell it back for credit)",
      KEPT_MSG,
      CREDIT,
    ],
    events: EV("pact", "nep141 ft_transfer", "generation", "skip"),
  },
  {
    name: "pact_accept",
    kind: "change",
    sig: "pub fn pact_accept(&mut self, id: u32)",
    args: `{ "id": 1 }`,
    what: (
      <p>
        The promisor (B) accepts the pact offered to it: the escrowed PETRI is paid to B, and from then until <C>until</C> the contract refuses every planting by B that breaks it. It uses the stored generation (no catch-up); the planting itself catches up and checks the board at its generation. The refusal reads <C>pact N with &lt;A&apos;s name&gt;: your colony promised not to plant within 8 cells of its living cells until generation U; (x, y) is that close to its cell at (x&apos;, y&apos;)</C>. Writes a <C>PactAccept</C> entry.
      </p>
    ),
    deposit: "None.",
    gas: "300 TGas.",
    errors: [CALLER, JOIN_FIRST, "there is no such pact", "that pact was not offered to your colony", "that pact is no longer open: it was accepted, ended or expired"],
    events: EV("pact", "nep141 ft_transfer"),
  },
  {
    name: "pact_cancel",
    kind: "change",
    sig: "pub fn pact_cancel(&mut self, id: u32)",
    args: `{ "id": 1 }`,
    what: (
      <p>
        Ends an open offer: its payer withdraws it or its promisor declines it at any time, and anyone may end it once it has expired; the escrowed PETRI goes back to the payer. An accepted pact can be ended by anyone only once <C>until</C> has come; nobody can end one early. Writes a <C>PactEnd</C> entry.
      </p>
    ),
    deposit: "None.",
    gas: "300 TGas.",
    errors: ["there is no such pact", "that pact has already ended", "an accepted pact binds until its generation `until`; then anyone may end it", "only the two colonies can end an open offer before it expires"],
    events: EV("pact", "nep141 ft_transfer"),
  },
];

const INTENTS: M[] = [
  {
    name: "ft_on_transfer",
    kind: "change",
    sig: "pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> PromiseOrValue<U128>",
    args: `{ "sender_id": "intents.near", "amount": "20000000000000000000000",
  "msg": "{\\"for\\":\\"alice.near\\",\\"do\\":\\"join\\",\\"name\\":\\"Alice\\",\\"color\\":15905882}" }`,
    what: (
      <>
        <p>
          NEP-141 receiver, called by a token contract. wNEAR from <C>rules.wnear</C> is never refunded, whatever the amount: it is kept whole (returns <C>&quot;0&quot;</C>) and becomes pending NEAR for <C>msg.for</C> (or for <C>sender_id</C> when the message names no valid account), with its order, less its pending record&rsquo;s and <C>Pending</C> entry&rsquo;s storage. An amount too small even for those goes to the vault with a <C>Dust</C> entry. With at least 35 TGas left it is unwrapped with <C>near_withdraw</C> (5 TGas), and <C>on_unwrapped</C> then schedules <C>settle_intent</C> to run the order; with less, the wNEAR waits for <C>unwrap_wnear</C>. Any other token, or an amount of zero, is returned whole. It never panics.
        </p>
        <p>
          The message&rsquo;s <C>name</C> and <C>color</C> are used only when <C>sender_id</C> is <C>for</C> itself. A colony started by anyone else&rsquo;s payment gets a neutral name (<C>Culture</C> and hex digits of its account&rsquo;s hash), a colour from the same hash and <C>proxy: true</C>. A self-paid join whose name is taken gets the neutral name too. The house&rsquo;s accounts start their own colonies, so a join paid for one of them waits as pending NEAR. See <Doc to="intents" hash="contract">NEAR Intents</Doc> for every branch.
        </p>
      </>
    ),
    returns: "The unused amount: all of it for another token, otherwise \"0\".",
    events: EV("intents"),
  },
  {
    name: "settle_pending",
    kind: "change",
    sig: "pub fn settle_pending(&mut self, account_id: AccountId) -> String",
    args: `{ "account_id": "alice.near" }`,
    what: (
      <p>
        Runs the order waiting with <C>account_id</C>&rsquo;s pending NEAR, with only the NEAR that came with that order (<C>order_near</C>): a join (or, for an account that already has a colony, a purchase), or a purchase, exactly as if the account had attached the NEAR itself. Anyone may call it, the keeper or the account; guests can relay it. It checks first and changes nothing when the order cannot run. NEAR pending for other reasons (a failed payout) is never spent by an order.
      </p>
    ),
    gas: "100 TGas (the site's value).",
    returns: "\"join\" or \"buy\".",
    errors: [
      "nothing is pending for that account",
      "no order waits on that account's pending NEAR",
      "the order buys PETRI, but that account has no colony yet",
      "the house starts its own colonies; that NEAR waits for its account to claim",
      "too little NEAR waits with that order to buy any PETRI",
      "a join needs {n} NEAR; {m} waits with that order",
      "the dish is full of colonies",
      "pending storage was miscounted",
      "a purchase needs more than the 0.00113 NEAR its record costs",
      "joining needs more than the {n} NEAR its storage costs",
      "that is not enough NEAR to buy any PETRI",
    ],
    events: EV("intents", "join", "nep141 ft_transfer", "generation", "skip"),
  },
  {
    name: "claim_pending",
    kind: "change",
    sig: "pub fn claim_pending(&mut self) -> U128",
    args: `{}`,
    what: <p>Sends the caller all its pending NEAR, with the storage its pending record freed, and clears any order waiting on it. Records an <C>Unpend</C> entry. A failed transfer is pending again.</p>,
    gas: "30 TGas (the site's value).",
    returns: "yoctoNEAR sent.",
    errors: [CALLER, "nothing is pending for this account", "too little is pending to pay for its own record"],
    events: EV("claim_pending", "payout_failed"),
  },
  {
    name: "unwrap_wnear",
    kind: "change",
    sig: "pub fn unwrap_wnear(&mut self) -> Promise",
    args: `{}`,
    what: <p>Unwraps wNEAR the dish holds for pending accounts that is not already being unwrapped (after a failed unwrap, or a transfer that came with too little gas to unwrap). Anyone may call it; the keeper does.</p>,
    gas: "100 TGas (the keeper's value): near_withdraw gets 5 TGas and on_wnear_unwrapped 5 TGas.",
    errors: ["this dish takes no wNEAR", "no wNEAR is waiting to be unwrapped"],
  },
  {
    name: "register_wnear",
    kind: "payable",
    sig: "pub fn register_wnear(&mut self) -> Promise",
    what: <p>Registers the dish on the wNEAR contract so it can receive wNEAR. Paid from the attached deposit (0.00125 NEAR; extra sent back) or, with none attached, from the contract&rsquo;s surplus. Once it has run, <C>state().wnear_ready</C> is true.</p>,
    deposit: "0.00125 NEAR, or none if the surplus covers it.",
    errors: ["this dish takes no wNEAR", "the dish is already registered on wNEAR", "registering on wNEAR costs 0.00125 NEAR", "the dish has no surplus for the registration; attach 0.00125 NEAR"],
  },
];

const LAUNCH: M[] = [
  {
    name: "new",
    kind: "change",
    sig: "#[init]\npub fn new(rules: Rules) -> Self",
    what: <p>Launches a fresh dish: checks the rules, writes an empty board at generation 0 and mints every PETRI into the agar. NEAR refuses it on an account that already has state. The testnet dish, <C>petri-v6.testnet</C>, was first launched this way with <C>contract/launch-rules.json</C>.</p>,
    errors: [
      "dish too small",
      "dish too large",
      "generations must be at least a second apart",
      "a share is above 100%",
      "feed above 100% per generation",
      "max_catchup, tide_every, reach and siege_x must be at least 1",
      "max_lag must exceed max_catchup",
      "PETRI needs a price",
      "too many house accounts",
      "a slide must capture at least one cell",
    ],
    events: EV("nep141 ft_mint"),
  },
  {
    name: "relaunch",
    kind: "change",
    sig: "#[private]\n#[init(ignore_state)]\npub fn relaunch(rules: Rules, accounts: Vec<AccountId>) -> Self",
    what: (
      <p>
        Deletes every key the v6 layout wrote (the vectors of colonies, the ledger, the plant and tide indexes, slides and lab notes; the balance, colony, name, grant, owned-slide and pending maps for colony accounts, slide owners and <C>accounts</C>; the cold pages, the hot table and the board) and launches a fresh dish with <C>rules</C>, as <C>new</C> does. <C>accounts</C> are the accounts that held a v6 PETRI registration, sponsored credit or pending NEAR without a colony or a slide; colony accounts, names and slide owners are read from the v6 records. It logs any pending NEAR v6 still owed (<C>v6 owed {"{n}"} pending NEAR to {"{account}"}</C>). Being private, only a transaction from the contract account itself can run it (each dish account holds one key, a full-access key, at the time of writing); it refuses an account with no v6 dish and one that already runs v6.1, and panics with any message of <C>new</C> on bad rules. v6.1 keeps everything per account, the cold pages, the hot table and the tide index under prefixes v6 never used, so a key a wrong <C>accounts</C> list leaves behind can never be read as v6.1 state; it only keeps its storage. The mainnet dish, <C>petri-dish.near</C>, was relaunched in place this way with <C>contract/launch-rules-mainnet.json</C>, and so was the testnet dish, <C>petri-v6.testnet</C>, with <C>contract/launch-rules.json</C>. Once the full-access key is deleted, nobody can run it.
      </p>
    ),
    errors: ["no v6 dish here: relaunch clears a v6 dish that has colonies", "this account already runs v6.1"],
    events: EV("relaunch", "nep141 ft_mint"),
  },
];

const CALLBACKS: [string, string][] = [
  ["on_payout(of, kind, colony, account, near)", "After every NEAR payout (claim 0, sale 1, bounty 2, unsponsor 3, pending claim 4). A failed transfer writes a Refund entry tied to entry of, paid from the NEAR that came back: a bounty goes back to the vault, everything else becomes pending NEAR for account (the colony's own account, or the sponsor, or the pending account). Emits payout_failed."],
  ["on_unwrapped(account, order, amount)", "After near_withdraw. Makes the amount pending NEAR for the account with its order (as wNEAR still held if the unwrap failed) and, if the unwrap worked, an order exists and at least 30 TGas remain after a 10 TGas margin, schedules settle_intent with 30 TGas."],
  ["settle_intent(account)", "Runs the account's waiting order, as settle_pending does. If it cannot run, the receipt fails and the NEAR waits with its order. Returns \"join\" or \"buy\"."],
  ["on_wnear_unwrapped(amount)", "After unwrap_wnear: the wNEAR it unwrapped is no longer counted as held."],
  ["on_wnear_registered()", "After register_wnear; sets wnear_ready."],
  ["ft_resolve_transfer(sender_id, receiver_id, amount)", "NEP-141 resolve: refunds what the receiver returned unused, or burns it (a Burn entry) if the sender has unregistered meanwhile."],
  ["nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)", "NEP-171 resolve: returns the slide if the receiver asked (one more move), restoring its approvals."],
];

const VIEWS: [string, string, string][] = [
  ["rules()", "Rules", "Every parameter, fixed for the dish's life."],
  ["state()", "DishState", "The clock, hashes, counts, every PETRI, NEAR and credit counter, current prices."],
  ["board()", "String", "The stored board in compact form, base64 (see Verification)."],
  ["colonies(from?, limit?)", "Vec<Colony>", "Colonies by id order from index from (0-based); limit default 100, at most 500."],
  ["colony_of(account_id)", "Option<Colony>", "One account's colony."],
  ["stakes(from?, limit?)", "Vec<U64>", "Each colony's stake in thousandths of a planted cell (index = id − 1), decayed to now for a colony without a hot row; default 500, at most 2,000."],
  ["earnings(from?, limit?)", "Vec<U128>", "Each colony's lifetime PETRI earnings, claimed or not; default and at most 500."],
  ["tide_winnings(from?, limit?)", "Vec<U128>", "Each colony's NEAR won at tides, claimed or not; default and at most 500."],
  ["ledger(from?, limit?)", "Vec<Entry>", "Ledger entries in order; default 200, at most 1,000."],
  ["plants(from?, limit?)", "Vec<PlantView>", "Plantings only, by planting number, with lab notes and the licensing slide; default 200, at most 1,000."],
  ["checkpoints(from?, limit?)", "Vec<Checkpoint>", "The history chain at generation 0 and at every tide, found through the packed tide index; default 500, at most 2,000."],
  ["claimable(account_id)", "Claimable", "Unclaimed PETRI and NEAR won but not claimed."],
  ["quote(cells, siege?, licensed?)", "U128", "PETRI units to plant cells cells now (before the catch-up the planting triggers): ×3 with siege, 25% less with licensed. The royalty is not included."],
  ["plant_deposit(cells, note_bytes?, slide?)", "U128", "yoctoNEAR to bring to a planting: storage (a first hot row included; with slide, the licence bytes and the holder's registration if it has none) plus the cell fee."],
  ["buy_quote(near)", "U128", "PETRI units near yoctoNEAR buys now."],
  ["sell_quote(petri)", "U128", "yoctoNEAR the agar pays for petri units now, before the sale record's storage."],
  ["credit_of(account_id)", "U128", "Spendable credit: won and not spent, plus every sponsor's grant."],
  ["credit_grants(account_id)", "Vec<Grant>", "The sponsored part, one grant per sponsor, in the order it is spent (oldest first)."],
  ["solvency()", "Solvency", "NEAR held against NEAR owed."],
  ["pact(id)", "Option<PactView>", "One pact by its number: from and to (colony ids), petri, until, accepted and ended (the generation, or null), and binding (accepted, not ended, until ahead of the stored generation)."],
  ["pacts_of(account_id)", "Vec<PactView>", "The pacts that account's colony is party to and that have not ended (open offers made or received, accepted pacts on either side)."],
  ["pending_of(account_id)", "U128", "Pending NEAR: wNEAR payments not yet used, and payouts that failed."],
  ["pending_record(account_id)", "Option<PendingView>", "Pending NEAR, how much of it the waiting order may spend, and the order."],
  ["intent_minimum(what, account_id)", "U128", "The least wNEAR a payment for account_id must deliver for its order (\"join\", or anything else for a purchase) to run: min_join or a purchase's 114 bytes, plus the payment's Pending and Unpend entries."],
  ["slide_deposit(w, h, title_bytes?)", "U128", "yoctoNEAR to bring to a slide."],
  ["slides(from?, limit?)", "Vec<SlideView>", "Slides in mint order, without images; default 100, at most 500."],
  ["slide(token_id)", "Option<SlideView>", "One slide without its image."],
  ["slide_royalties(token_id)", "U128", "PETRI the slide's holders have been paid in royalties, in all. Panics with there is no slide with that id."],
  ["slides_for(account_id, from?, limit?)", "Vec<SlideView>", "An owner's slides; default 100, at most 500."],
  ["ft_balance_of(account_id)", "U128", "NEP-141. For the contract itself: agar + unclaimed + keeper pot."],
  ["ft_total_supply()", "U128", "max_supply − burned."],
  ["ft_metadata()", "FtMetadata", "spec ft-1.0.0, name Petri, symbol PETRI, decimals 6, an SVG icon."],
  ["storage_balance_of(account_id)", "Option<StorageBalance>", "NEP-145."],
  ["storage_balance_bounds()", "StorageBounds", "min = max = 0.00125 NEAR."],
  ["nft_token(token_id)", "Option<Token>", "NEP-171 token with metadata, image drawn now."],
  ["nft_metadata()", "NftContractMetadata", "spec nft-2.1.0, name Petri specimens, symbol SLIDE."],
  ["nft_is_approved(token_id, approved_account_id, approval_id?)", "bool", "NEP-178."],
  ["nft_total_supply()", "U128", "NEP-181: slides minted."],
  ["nft_tokens(from_index?, limit?)", "Vec<Token>", "NEP-181: default and at most 10 a call (each carries its image)."],
  ["nft_supply_for_owner(account_id)", "U128", "NEP-181."],
  ["nft_tokens_for_owner(account_id, from_index?, limit?)", "Vec<Token>", "NEP-181: default and at most 10 a call."],
  ["contract_source_metadata()", "ContractSourceMetadata", "NEP-330 (generated by near-sdk and cargo near): version 0.3.0, a link to the commit, standards [nep330 1.3.0], the build image, command and source snapshot."],
];

export default function Page() {
  return (
    <DocPage
      slug="contract-api"
      source={[
        { label: "contract/src/lib.rs", path: "contract/src/lib.rs" },
        { label: "token.rs", path: "contract/src/token.rs" },
        { label: "slides.rs", path: "contract/src/slides.rs" },
        { label: "intents.rs", path: "contract/src/intents.rs" },
        { label: "relaunch.rs", path: "contract/src/relaunch.rs" },
      ]}
    >
      <H2 id="conventions">Conventions</H2>
      <ul>
        <li>
          Arguments and results are JSON. <C>U128</C> and <C>U64</C> are decimal strings (<C>&quot;1000000&quot;</C>); <C>u8</C>, <C>u16</C>, <C>u32</C> and <C>u64</C> are numbers; <C>Option</C> is <C>null</C> or the value, and optional arguments may be left out.
        </li>
        <li>PETRI amounts are in units (10<sup>−6</sup> PETRI); NEAR and credit in yoctoNEAR.</li>
        <li>
          <C>credit</C> on <C>join</C>, <C>buy</C>, <C>plant</C> and <C>mint_slide</C> spends that many yoctoNEAR of the caller&rsquo;s credit: what its colony won first, then its sponsors&rsquo; grants, oldest first. Drawing on a grant restarts that grant&rsquo;s day. It is how a function-call key pays: such keys cannot attach NEAR.
        </li>
        <li>
          <C>join</C>, <C>buy</C>, <C>sell</C>, <C>plant</C>, <C>advance</C>, <C>claim</C>, <C>mint_slide</C>, <C>pact_offer</C> and <C>settle_pending</C> catch the dish up first (up to 120 generations), so they pay for the generations they run, and whichever of them steps at least one generation takes the keeper pot if its caller is eligible (see <a href="#m-advance">advance</a>). A catch-up stops at the lesser of 110 TGas and the prepaid gas less 40, less what is still to be written, so a call with more gas steps more generations. The gas values below are what the site attaches (300 TGas for the heavier calls); gas left unused is refunded.
        </li>
        <li>
          Panic messages are the contract&rsquo;s own words; near-sdk prefixes them with <C>Smart contract panicked:</C>. <C>{"{n}"}</C>, <C>{"{p}"}</C> and the like mark a number filled in at run time, and <C>[ … ]</C> a part that appears only in some cases. The contract itself can never be the caller of a player method (<C>{CALLER}</C>).
        </li>
      </ul>
      <Table caption="Gas the site attaches">
        <thead>
          <tr>
            <th>Call</th>
            <th className="n">TGas</th>
            <th>Deposit</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["join", "300", "0.02 NEAR (site default; at least 0.01)"],
            ["plant", "300", "plant_deposit(cells, note_bytes, slide)"],
            ["buy", "300", "0.01 NEAR (site default)"],
            ["sell", "300", "none"],
            ["claim", "300", "none"],
            ["advance", "300", "none"],
            ["mint_slide", "300", "slide_deposit(w, h, title_bytes)"],
            ["rename", "50", "none"],
            ["set_payout", "50", "none"],
            ["settle_pending", "100", "none"],
            ["claim_pending", "30", "none"],
            ["sponsor", "30", "the credit to give (at least 0.01 NEAR)"],
            ["unwrap_wnear", "100", "none"],
          ].map(([m, g, d]) => (
            <tr key={m}>
              <td>
                <a href={`#m-${m}`}>
                  <C>{m}</C>
                </a>
              </td>
              <td className="n">{g}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="dish-methods">Dish</H2>
      {DISH.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="payouts">Payouts</H2>
      {PAYOUTS.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="credit-methods">Credit</H2>
      <p>
        Spending credit is not a method of its own: pass <C>credit</C> to <C>join</C>, <C>buy</C>, <C>plant</C> or <C>mint_slide</C>. Read it with <C>credit_of</C> (the total) and <C>credit_grants</C> (the sponsored part, per sponsor). Credit won at the tides belongs to the colony: no sponsor can take it back.
      </p>
      {CREDIT_METHODS.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="token">Token: NEP-141, NEP-145, NEP-148</H2>
      <p>
        PETRI follows NEP-141 with NEP-148 metadata and NEP-145 storage registration. An account must be registered before it can receive PETRI; joining registers it, and a slide&rsquo;s holder is registered by the planting that pays it its first royalty. The contract never sends or receives PETRI through these methods: its own holding is the agar. As in near-contract-standards, a refund to a sender that unregistered meanwhile is burned, and a forced unregistration burns the balance; both are <C>Burn</C> entries.
      </p>
      {TOKEN.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="slides-methods">Slides: NEP-171, 177, 178, 181</H2>
      <p>
        Token ids are <C>&quot;1&quot;</C>, <C>&quot;2&quot;</C>, … in mint order; only plain decimal ids name a slide (<C>&quot;01&quot;</C> does not). A slide of at least 12 cells is a pattern licence: its pattern can be planted anywhere under it with <a href="#m-plant">plant</a>. A smaller slide is a keepsake. The views are listed under <a href="#views">Views</a>.
      </p>
      {SLIDES.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="pact-methods">Pacts</H2>
      <p>
        A pact is a one-way promise the contract enforces: colony A pays colony B for B&rsquo;s promise not to plant near A for a while. The PETRI waits in escrow until B accepts, and the contract then refuses B&rsquo;s plantings that break the promise. A truce is two pacts, one each way. The views are <C>pact</C> and <C>pacts_of</C> (see <a href="#views">Views</a>); the strains&rsquo; council makes its deals this way (<Doc to="ai-strains" hash="pacts">Pacts and the council</Doc>).
      </p>
      {PACTS.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="intents-methods">Intents</H2>
      {INTENTS.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="launch-methods">Launch: new and relaunch</H2>
      <p>
        Neither changes a running dish: both start one from generation 0. Every rule they check is listed under <C>new</C>.
      </p>
      {LAUNCH.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="callbacks">Callbacks</H2>
      <p>
        These are <C>#[private]</C> (near-sdk rejects any caller but the contract itself), and the intents and slide callbacks also check the caller again (<C>only the dish itself can call this</C>). Nobody else can run them; the tests <C>nobody_else_can_call_the_unwrap_callback</C>, <C>nobody_else_can_settle_an_order_from_the_callback</C> and <C>nobody_else_can_resolve_a_slide_transfer</C> try.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Callback</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          {CALLBACKS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <C>{k}</C>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="views">Views</H2>
      <p>Free to call with any RPC (see <Doc to="quickstart" hash="cli">Quickstart</Doc>). <C>from</C> and <C>limit</C> page through lists; ids are 1-based but list indexes start at 0.</p>
      <Table>
        <thead>
          <tr>
            <th>View</th>
            <th>Returns</th>
            <th>What</th>
          </tr>
        </thead>
        <tbody>
          {VIEWS.map(([k, r, w]) => (
            <tr key={k} id={`v-${k.split("(")[0]}`}>
              <td>
                <C>{k}</C>
              </td>
              <td>
                <C>{r}</C>
              </td>
              <td>{w}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="types">Types</H2>
      <p id="t-colony">The JSON shapes, as the Rust structs define them. Field comments are the contract&rsquo;s own, shortened.</p>
      <Code lang="rust" title="Colony">{`pub struct Colony {
    pub id: u16,
    pub account: AccountId,
    pub name: String,
    pub color: u32,                       // 0xRRGGBB
    pub house: bool,                      // one of the dish's own players (a house strain or a keeper):
                                          // never fed, no share of the tides, never sells
    pub payout: Option<AccountId>,        // where NEAR payouts go, if not the colony's own account
    pub joined_generation: U64,
    pub last_plant_generation: Option<U64>,
    pub cells_planted: U64,
    pub petri_spent: U128,                // everything paid for plantings (half burned, half returned),
                                          // royalties not included
    pub petri_burned: U128,
    pub petri_claimed: U128,              // earned and already claimed; unclaimed earnings are in claimable
    pub petri_sold: U128,                 // PETRI sold back to the agar
    pub near_paid: U128,                  // NEAR brought to the dish (attached or sponsored), storage included
    pub near_claimed: U128,               // NEAR won at the tides and claimed (with what the claims' records cost)
    pub near_sold: U128,                  // NEAR received for PETRI sold back (sales paid as credit are not counted)
    pub credit_won: U128,                 // credit won at the tides (kept in the colony's books; the views fill it in)
    pub proxy: bool,                      // started by someone else's payment, under a neutral name; may rename once
    pub attached: bool,                   // has ever put NEAR into the vault itself; a guest has not, and cannot send PETRI
    pub kept: U64,                        // PETRI that stays in the dish until planted (includes a guest's unclaimed earnings)
}`}</Code>
      <p id="t-rules" />
      <Code lang="rust" title="Rules (rules())">{`pub struct Rules {
    pub width: u16, pub height: u16, pub generation_ms: U64,
    pub max_supply: U128,                 // every PETRI that will ever exist; all of it starts in the agar
    pub feed_ppm: u32,                    // share of the agar fed to the living each generation, per million
    pub keeper_bps: u16,                  // share of each generation's feed set aside in the keeper pot
    pub reach: u32,                       // a colony is paid for at most this many living cells per cell of stake
    pub stake_keep_bps: u16,              // share of a colony's stake that remains after each tide
    pub burn_bps: u16,                    // share of a planting's cost that is burned; the rest goes back to the agar
    pub payback: u32,                     // a cell costs what an average cell earns in this many generations
    pub min_cell_price: U128,
    pub live_floor: u32,
    pub petri_price: U128,                // launch price of one PETRI in yoctoNEAR
    pub min_join: U128,
    pub cell_fee: U128,                   // NEAR per planted cell, to the vault or the credit pool
    pub tide_every: u32,
    pub tide_bps: u16,                    // share of the vault and of the credit pool paid out at each tide
    pub tide_bounty_bps: u16, pub max_bounty: U128,
    pub sell_bps: u16,                    // the agar buys PETRI back at this share of the curve's price
    pub sell_cap_bps: u16,                // and at most this share of the vault between two tides
    pub siege_x: u32, pub buffer: u16,
    pub max_plant_cells: u32, pub max_catchup: u32, pub max_lag: u32,
    pub house: Vec<AccountId>,            // the dish's own players (the house strains)
    pub keepers: Vec<AccountId>,          // the dish's own keepers: no tide bounty, no keeper pot, PETRI only to the house
    pub slide_cells_price: U128,          // PETRI units per living cell a slide captures, all burned
    pub slide_min_cells: u32,
    pub licence_min_cells: u32,           // a slide is a licence only if it captured at least this many cells (12)
    pub slide_discount_bps: u16,          // a planting under a slide's licence costs this share less
    pub slide_royalty_bps: u16,           // anyone but the holder pays the holder this share of that cost in PETRI
    pub pact_radius: u16,                 // a pact forbids planting within this many cells of the payer's living cells (8)
    pub pact_max_gens: u32,               // a pact lasts at most this many generations from the stored one (2,880)
    pub wnear: Option<AccountId>,         // the wNEAR contract (wrap.near on mainnet, wrap.testnet on testnet)
}`}</Code>
      <p>
        The launch values are in <C>contract/launch-rules.json</C> (testnet) and <C>contract/launch-rules-mainnet.json</C> (mainnet), which differ only in <C>house</C>, <C>keepers</C> and <C>wnear</C>; each is explained in the <Doc to="rules" hash="parameters">Rules reference</Doc>.
      </p>
      <Code lang="rust" title="DishState (state())">{`pub struct DishState {
    pub generation: U64, pub due_generation: U64, pub epoch_ms: U64, pub now_ms: U64,
    pub chain: String,                    // hex history chain at the stored generation
    pub board_hash: String,               // hex sha256 of the live cells (see Verification)
    pub total_live: u32,
    pub counted: u32,                     // cells the last feed counted; prices are set against this
    pub colonies: u16,
    pub playing: u32,                     // hot rows: colonies alive or paid at the coming tide (at most 10,000)
    pub ledger: U64, pub plants: U64,
    pub total_supply: U128, pub agar: U128, pub sold: U128, pub fed: U128, pub returned: U128,
    pub burned: U128,
    pub bought_back: U128,                // PETRI the agar has bought back
    pub unclaimed: U128,                  // earnings waiting to be claimed, across all colonies
    pub keeper_pot: U128, pub keeper_paid: U128,
    pub vault: U128,                      // NEAR waiting in the tide vault
    pub near_in: U128,                    // NEAR that reached the vault: attached, and wNEAR dust
    pub near_tides: U128,                 // NEAR the tides made claimable
    pub near_as_credit: U128,             // vault shares paid as credit, to colonies that never attached NEAR
    pub near_bounties: U128, pub near_sold: U128,
    pub near_refunded: U128,              // failed bounty payouts that went back to the vault
    pub tides_owed: U128,                 // NEAR tide winnings not yet claimed
    pub sell_left: U128,                  // NEAR the agar may still pay for PETRI before the next tide
    pub credit_pool: U128, pub credit_in: U128, pub credit_given: U128, pub credit_spent: U128,
    pub credit_won: U128, pub credit_sold: U128, pub credit_reclaimed: U128,
    pub tides: U64,                       // tides that ran; idle tides are not counted
    pub skipped: U64,
    pub house: Vec<u16>,                  // colony ids of the house's colonies
    pub slides: U64, pub slides_burned: U128,
    pub royalties: U128,                  // PETRI paid to slide holders
    pub pending: U128,                    // NEAR waiting for accounts to claim
    pub wrapped: U128,                    // wNEAR held and not yet unwrapped
    pub unwrapping: U128,                 // of which this much is being unwrapped right now
    pub pacts: U64,                       // pacts offered so far
    pub pact_escrow: U128,                // PETRI the dish holds for offers not yet accepted (part of ft_balance_of the dish)
    pub wnear_ready: bool,
    pub cell_price: U128,                 // PETRI units per cell right now
    pub petri_price: U128,                // yoctoNEAR per PETRI right now
}`}</Code>
      <p id="t-claimable" />
      <p id="t-grant" />
      <Code lang="rust" title="Smaller types">{`pub struct Claimable { pub petri: U128, pub near: U128 }
/// One sponsor's credit for an account. at: when this sponsor last gave or the account last drew on it,
/// in generations of the wall clock.
pub struct Grant { pub sponsor: AccountId, pub amount: U128, pub at: U64 }
pub struct Solvency {
    pub balance: U128, pub storage: U128, pub vault: U128, pub credit_pool: U128,
    pub credit_outstanding: U128, pub tides_owed: U128, pub pending: U128, pub wrapped: U128,
    pub surplus: U128, pub solvent: bool,
}
pub struct PlantView { pub index: U64, pub generation: U64, pub colony: u16, pub cells: Vec<u16>,
                       pub cost: U64, pub siege: bool, pub note: Option<String>,
                       pub slide: Option<String> }          // the slide whose licence it was planted under
pub struct Checkpoint { pub generation: U64, pub chain: String }
pub struct SlideView { pub token_id: String, pub owner_id: AccountId, pub colony: u16, pub name: String,
                       pub color: u32, pub generation: U64, pub x: u16, pub y: u16, pub w: u16, pub h: u16,
                       pub cells: u32, pub title: Option<String>, pub bitmap: Base64VecU8, pub minted_ms: U64,
                       pub moves: u32,                      // times it changed hands (a transfer and a return each count)
                       pub royalties: U128 }                // PETRI its holders have been paid in royalties
/// A pact (the pact and pacts_of views). from pays, to promises not to plant near from's living cells.
pub struct PactView { pub id: u32, pub from: u16, pub to: u16,
                      pub petri: U64, pub until: U64,
                      pub accepted: Option<U64>, pub ended: Option<U64>,   // the generation, or null
                      pub binding: bool }                                 // accepted, not ended, until still ahead
/// A planting made under a slide's licence (in Entry::Plant).
pub struct Licence { pub token: U64,
                     pub moves: u32,                        // the slide's moves when it was planted
                     pub holder: Option<AccountId>,         // who was paid the royalty; none when the planter held it
                     pub royalty: U64,                      // PETRI units
                     pub to_agar: bool }                    // the planter had never attached NEAR: the royalty went to the agar
/// What a wNEAR transfer's message asks for, kept with the pending NEAR until it is done.
pub struct Order { pub join: bool,                          // a join (a purchase when the account has a colony), or a purchase
                   pub name: Option<String>,                // only when the account paid for itself
                   pub color: Option<u32> }
pub struct PendingView { pub near: U128,
                         pub order_near: U128,              // the part the order may spend
                         pub order: Option<Order> }`}</Code>
      <p>
        NEP-171 <C>Token</C> and NEP-177 <C>TokenMetadata</C> follow the standards; how Petri fills them is in <Doc to="specimens" hash="standards">Specimens</Doc>.
      </p>

      <H2 id="ledger">The ledger: Entry</H2>
      <p>
        The ledger is one ordered list of everything that changes the dish, the agar, the vault, the credit pool, the credit accounts hold, the NEAR owed to colonies and the pending NEAR. Replaying it from an empty dish with petri-core reproduces all of them, so every term of the solvency check can be recomputed from the ledger alone. Each entry is a JSON object with one key, the variant&rsquo;s name.
      </p>
      <Code lang="rust" title="contract/src/lib.rs">{`/// PETRI amounts in entries are u64 (all the PETRI there is fits); NEAR amounts are u128. JSON writes both as strings.
pub enum Entry {
    Join { generation: U64, colony: u16 },
    /// near reached the vault and credit the credit pool, after this entry's storage (and, for a join, the
    /// colony's). spent is the credit the call took from the account in all, storage included.
    Buy { generation: U64, colony: u16, petri: U64, near: U128, credit: U128, spent: Option<U128> },
    /// near reached the vault and credit the credit pool, after the planting's storage; spent is the credit it
    /// took. siege marks a planting inside a rival's buffer. Cells are flat indices; each fits in 16 bits.
    /// licence marks a planting of a slide's pattern: cost is then the discounted price.
    Plant { generation: U64, colony: u16, cells: Vec<u16>, cost: U64, near: U128, credit: U128, siege: bool,
            spent: Option<U128>, licence: Option<Licence> },
    /// near left the vault: paid to the seller and the rest for this entry's storage. as_credit marks a seller
    /// that has never attached NEAR, paid in credit instead.
    Sell { generation: U64, colony: u16, petri: U64, near: U128, paid: U128, as_credit: bool },
    /// Every tide_every generations, when some colony outside the house earned since the last tide: the history
    /// chain at that generation, the storage bytes this entry and its place in the tide index took (130, or 175 on
    /// the tide that starts a new index page), and by, the colony whose call ran the tide (0 for a caller without
    /// one, 65535 = HOUSE_RUNNER for a keeper). Nothing else is stored: a replay works out the vault's share (pay),
    /// the bounty (none for a house runner, whose bounty stays in the vault), the storage, the NEAR colonies can
    /// claim (paid), the part paid as credit (as_credit) and the credit pool's share (credit_pay, credit_paid) from
    /// the ledger before it. The tide event logs all of them.
    Tide { generation: U64, chain: String, bytes: u16, by: u16 },
    /// Nobody tended the dish for max_lag generations; the clock skipped skipped generations at this one.
    Skip { generation: U64, skipped: U64 },
    /// The NEAR payout of entry of (kind: 0 claim, 1 sale, 2 bounty, 3 unsponsor, 4 pending claim) could not be
    /// delivered: near came back, storage of it paid for this entry and any record it needed, and the rest went
    /// to the vault (a bounty) or became pending NEAR for the account it was for (everything else).
    Refund { generation: U64, colony: u16, kind: u8, of: U64, near: U128, storage: U128 },
    /// Slide token captured cells of colony's living cells in the w × h rectangle at (x, y) of the board as it
    /// stood here, and burned cost PETRI. spent is the credit that paid for its storage.
    Slide { generation: U64, colony: u16, token: U64, x: u16, y: u16, w: u16, h: u16, cells: u32,
            bitmap: Base64VecU8, cost: U64, spent: Option<U128> },
    /// sponsor gave account amount of credit (after the records' storage).
    Sponsor { generation: U64, account: AccountId, sponsor: AccountId, amount: U128 },
    /// sponsor took back amount, all that was left of what it gave account, and was sent it.
    Unsponsor { generation: U64, account: AccountId, sponsor: AccountId, amount: U128 },
    /// colony claimed: petri of earnings into its balance and near of its tide winnings, of which paid was sent
    /// and the rest paid for this entry.
    Claim { generation: U64, colony: u16, petri: U64, near: U128, paid: U128 },
    /// wNEAR that arrived for account became near of pending NEAR (after its records' storage).
    Pending { generation: U64, account: AccountId, near: U128 },
    /// near of account's pending NEAR left it: paid (with the storage its record freed, less this entry's) was
    /// sent to the account, or spent on the join or purchase its order asked for.
    Unpend { generation: U64, account: AccountId, near: U128, paid: U128 },
    /// wNEAR too small to pay for a pending record went into the vault: near of it, after this entry's storage.
    Dust { generation: U64, near: U128 },
    /// petri of account's PETRI was burned outside the dish: a forced unregistration, or the refund of a
    /// transfer whose sender had unregistered meanwhile.
    Burn { generation: U64, account: AccountId, petri: U64 },
    /// from offered to petri PETRI (held by the dish) for to's promise not to plant within pact_radius of from's living
    /// cells before generation until. spent is the credit that paid for the entries' storage.
    PactOffer { generation: U64, pact: u32, from: u16, to: u16, petri: U64, until: U64, spent: Option<U128> },
    /// to accepted: the PETRI was paid to it, and its plantings are bound until the pact's until.
    PactAccept { generation: U64, pact: u32 },
    /// The pact ended: an offer withdrawn, declined or expired (the PETRI back to from), or an accepted pact whose until came.
    PactEnd { generation: U64, pact: u32 },
}`}</Code>
      <Code lang="json" title="The first three entries of the v6 petri-dish.near (read from the chain; v6.1 writes the same shapes)">{`[
  { "Join": { "generation": "16", "colony": 1 } },
  { "Buy": { "generation": "16", "colony": 1, "petri": "212027519", "near": "42410000000000000000000",
             "credit": "0", "spent": null } },
  { "Plant": { "generation": "16", "colony": 1, "cells": [10294, 10295, 10421, 10424, 10550, 10552, 10679],
               "cost": "9875040", "near": "1530000000000000000000", "credit": "0", "siege": false,
               "spent": null, "licence": null } }
]`}</Code>
      <Code lang="json" title="On petri-v6.testnet the house plays on the keeper's sponsored credit (entries 0 and 6)">{`[
  { "Sponsor": { "generation": "0", "account": "petri-violet.testnet", "sponsor": "petri-keeper.testnet",
                 "amount": "2995550000000000000000000" } },
  { "Buy": { "generation": "16", "colony": 1, "petri": "212777360", "near": "0",
             "credit": "42560000000000000000000", "spent": "50000000000000000000000" } }
]`}</Code>
      <p>
        Entries are applied at the start of their generation, before it steps. A planting&rsquo;s lab note is not in the entry; read it with <C>plants</C>. A tide&rsquo;s amounts are not in its entry either; the replays work them out, and the <C>tide</C> event carries them. A join&rsquo;s name and colour are in the <C>Colony</C> record. Slide transfers are not entries: each licensed planting carries the slide&rsquo;s move count and its holder, and the replays check them against the <C>slides</C> view.
      </p>

      <H2 id="events">Events</H2>
      <p>
        Every event is a log line <C>EVENT_JSON:{"{...}"}</C> per NEP-297. Petri&rsquo;s own use <C>{`"standard": "petri", "version": "6.1.0"`}</C>; the token&rsquo;s use NEP-141 1.0.0 and the slides&rsquo; NEP-171 1.2.0. Each has <C>event</C> and a one-element <C>data</C> array.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Event</th>
            <th>data</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["join", "colony, account, name, color, house, generation, petri, proxy"],
            ["plant", "colony, generation, cells (count), cost, siege, near (the deposit), note, slide (token id or null), royalty"],
            ["sell", "colony, petri, and near (paid in NEAR) or credit (paid as credit)"],
            ["claim", "colony, petri, near"],
            ["generation", "from, to, live, fed, keeper_pot, bounty (once per catch-up that ran)"],
            ["pact", "pact (its number), did (\"offer\", \"accept\" or \"end\"), from, to (colony ids), petri, until, refund (the PETRI sent back to the payer when an offer ended unaccepted)"],
            ["tide", "generation, index (the Tide entry's place in the ledger), chain, by, pay, bounty, storage, paid, as_credit, credit_pay, credit_paid, winners: every amount the Tide entry no longer stores"],
            ["skip", "generation, skipped"],
            ["sponsor", "account, sponsor, near"],
            ["unsponsor", "account, sponsor, near"],
            ["rename", "colony, name, color"],
            ["payout", "colony, to"],
            ["payout_failed", "of, colony, account, near, kind (0 claim, 1 sale, 2 bounty, 3 unsponsor, 4 pending claim)"],
            ["slide", "token, colony, generation, x, y, w, h, cells, cost"],
            ["intents", "for, amount, did (\"pending\", \"dust\", \"join\" or \"buy\")"],
            ["claim_pending", "account, near"],
            ["relaunch", "colonies, entries, slides, accounts (what v6 left and was deleted)"],
            ["ft_mint", "NEP-141: owner_id, amount, memo (once, at launch: launch: every PETRI starts in the agar)"],
            ["ft_transfer", "NEP-141: old_owner_id, new_owner_id, amount, memo: bought from the agar, earnings from the agar, planting feeds the agar, sold back to the agar, keeper pot, slide royalty, refund, or the sender's memo"],
            ["ft_burn", "NEP-141: owner_id, amount, memo: planting, specimen slide, forced unregistration, or refund to an unregistered sender"],
            ["nft_mint", "NEP-171: owner_id, token_ids"],
            ["nft_transfer", "NEP-171: old_owner_id, new_owner_id, token_ids, authorized_id when an approved account moved it, memo (the sender's, or returned)"],
          ].map(([e, d]) => (
            <tr key={e} id={`ev-${e}`}>
              <td>
                <C>{e}</C>
              </td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Code lang="json" title="A plant event">{`EVENT_JSON:{"standard":"petri","version":"6.1.0","event":"plant","data":[{"colony":1,"generation":"16","cells":7,"cost":"9875040","siege":false,"near":"…","note":"…","slide":null,"royalty":"0"}]}`}</Code>

      <H2 id="errors">Errors</H2>
      <p>
        Each method above lists the messages it can panic with. A failed call changes nothing: NEAR rolls back the whole receipt and refunds the attached deposit. Three cases are worth knowing:
      </p>
      <ul>
        <li>
          <C>the dish is behind the clock; call advance first</C>: the dish was more than 120 generations behind, so the planting&rsquo;s own catch-up did not reach the clock. Call <C>advance</C> and plant again.
        </li>
        <li>
          <C>the agar buys back at most 0 NEAR more before the next tide</C>: no tide has run yet, or this tide&rsquo;s allowance is spent.
        </li>
        <li>
          <C>those cells are not the slide&rsquo;s pattern: plant exactly its cells, moved anywhere but not turned</C>: the cells under a licence must be the slide&rsquo;s set cells shifted by one offset, in the same orientation, each once.
        </li>
        <li>
          <C>slide N captured C cells; only a slide of at least 12 cells is a licence</C>: the slide is a keepsake. Plant its pattern at the full price without <C>slide</C>.
        </li>
        <li>
          <C>10000 colonies are playing at once, the most the dish holds; plant again after the next tide</C>: the hot table is full of rows that cannot leave yet, and the colony has no row. It can plant once a tide has paid them.
        </li>
      </ul>
      <Callout kind="note">
        <p>
          <C>ft_on_transfer</C> and <C>on_unwrapped</C> never panic on bad input: an unusable payment becomes pending NEAR instead, because a withdrawal from the intents contract is not refunded when the receiver fails. An order that cannot run yet makes <C>settle_intent</C> or <C>settle_pending</C> fail and leaves the NEAR waiting with its order.
        </p>
      </Callout>
    </DocPage>
  );
}
