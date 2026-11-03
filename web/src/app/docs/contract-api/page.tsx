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

const DISH: M[] = [
  {
    name: "join",
    kind: "payable",
    sig: "pub fn join(&mut self, name: String, color: u32, credit: Option<U128>) -> Colony",
    args: `{ "name": "My Colony", "color": 15905882, "credit": null }`,
    what: (
      <p>
        Makes the caller a colony, once per account. The NEAR it brings (attached, plus <C>credit</C> yoctoNEAR taken from its credit) pays the colony&rsquo;s storage and 140 bytes for the purchase entry; the rest buys PETRI from the agar. Attached NEAR goes to the vault, credit to the credit pool. Catches the dish up first. A house account named in the rules joins as a house colony.
      </p>
    ),
    deposit: "At least min_join (0.01 NEAR), attached and credit together. The site attaches 0.02 NEAR.",
    gas: "200 TGas (the site's value; covers a full catch-up).",
    returns: <>The new <a href="#t-colony">Colony</a>.</>,
    errors: [
      "the dish does not play on itself",
      "this account has {n} NEAR of won and sponsored credit",
      "this account already has a colony",
      "name must be 1 to 24 characters",
      "a name may use only letters A to Z, digits, spaces and - ' . & ! ? _ , : ( )",
      "a colony with that name already exists",
      "color must be 0xRRGGBB",
      "the dish is full of colonies",
      "joining needs at least 0.01 NEAR",
      "joining needs more than the {n} NEAR its storage costs",
      "that is not enough NEAR to buy any PETRI",
    ],
    events: EV("join", "nep141 ft_transfer", "generation"),
  },
  {
    name: "plant",
    kind: "payable",
    sig: "pub fn plant(&mut self, cells: Vec<u32>, note: Option<String>, credit: Option<U128>) -> U64",
    args: `{ "cells": [5160, 5161, 5288, 5289], "note": "a block to start", "credit": null }`,
    what: (
      <p>
        Brings <C>cells</C> (flat indices, <C>y * width + x</C>) to life for the caller&rsquo;s colony. Catches up, requires the stored generation to equal the clock&rsquo;s, claims the colony&rsquo;s earnings, checks the cells with <C>Dish::check_plant</C>, charges the price (×3 for a siege), burns half, returns half to the agar, adds <C>cells × 1000</C> to the stake and records a <C>Plant</C> entry. NEAR beyond the record&rsquo;s storage goes to the vault (attached) or the credit pool (credit); nothing is sent back.
      </p>
    ),
    deposit: (
      <>
        <C>plant_deposit(cells.len, note_bytes)</C>: the record&rsquo;s storage allowance plus 0.0001 NEAR per cell. At least the cell fee is checked before any work, and storage + fee after.
      </>
    ),
    gas: "200 TGas.",
    returns: "The generation the cells were planted at (U64).",
    errors: [
      "join the dish first",
      "plant 1 to 64 cells",
      "a cell is off the dish",
      "planting {n} cells needs at least {n} NEAR",
      "the dish is behind the clock; call advance first",
      "one planting per generation; wait for the next one",
      "plant at least one cell",
      "cell ({x}, {y}) is listed twice",
      "cell ({x}, {y}) is already alive",
      "planting {n} cells[ inside a rival's buffer] costs {p} PETRI; you hold {b}",
      "this planting needs {n} NEAR for its storage and fee",
      "a lab note may not contain control, direction, invisible or tag characters",
      "a lab note is at most 140 characters",
    ],
    events: EV("plant", "nep141 ft_burn", "nep141 ft_transfer", "generation"),
  },
  {
    name: "buy",
    kind: "payable",
    sig: "pub fn buy(&mut self, credit: Option<U128>) -> U128",
    args: `{ "credit": null }`,
    what: <p>Buys PETRI from the agar for the caller&rsquo;s colony with the attached NEAR plus <C>credit</C>, at the curve&rsquo;s midpoint price. 140 bytes of storage (0.0014 NEAR) come off the top for the purchase entry.</p>,
    deposit: "More than 0.0014 NEAR. The site uses 0.01 NEAR.",
    gas: "150 TGas.",
    returns: "PETRI units bought.",
    errors: ["join the dish first", "a purchase needs more than the 0.0014 NEAR its record costs", "that is not enough NEAR to buy any PETRI", "this account has {n} NEAR of won and sponsored credit"],
    events: EV("nep141 ft_transfer", "generation"),
  },
  {
    name: "sell",
    kind: "change",
    sig: "pub fn sell(&mut self, petri: U128) -> U128",
    args: `{ "petri": "20000000" }`,
    what: (
      <p>
        Hands <C>petri</C> units back to the agar for NEAR from the vault: <C>sell_quote(petri)</C>, less the storage of the <C>Sell</C> entry. Limited by <C>state().sell_left</C>, which each tide sets to 10% of the vault (zero before the first tide). A colony that never attached NEAR is paid in won credit instead; otherwise the NEAR goes to its payout account or its own.
      </p>
    ),
    deposit: "None.",
    gas: "150 TGas.",
    returns: "yoctoNEAR paid (or credited).",
    errors: [
      "join the dish first",
      "sell at least some PETRI",
      "you hold {n} PETRI",
      "that is too little PETRI to buy back",
      "the agar buys back at most {n} NEAR more before the next tide",
      "that is too little PETRI to cover the sale's record",
    ],
    events: EV("sell", "nep141 ft_transfer", "generation", "payout_failed"),
  },
  {
    name: "advance",
    kind: "change",
    sig: "pub fn advance(&mut self, max: Option<u32>) -> U64",
    args: `{ "max": 120 }`,
    what: (
      <p>
        Steps up to <C>max</C> due generations (default and ceiling 120). Anyone may call it. If it ran at least one generation and the caller can hold PETRI (a colony, or registered with <C>storage_deposit</C>), the keeper pot goes to the caller. Tides it runs pay the caller their bounty: in NEAR, or as credit if the caller is a colony that never attached NEAR.
      </p>
    ),
    deposit: "None.",
    gas: "250 TGas for a full 120-generation catch-up; a catch-up stops early past min(180 TGas, prepaid − 40 TGas).",
    returns: "The stored generation after the call.",
    errors: ["the dish does not play on itself"],
    events: EV("generation", "skip", "nep141 ft_transfer"),
  },
  {
    name: "claim",
    kind: "change",
    sig: "pub fn claim(&mut self) -> Claimable",
    args: `{}`,
    what: <p>Moves the colony&rsquo;s unclaimed PETRI into its balance and sends the NEAR it has won at tides to its payout account or its own. If the transfer fails, <C>on_payout</C> makes it owed again.</p>,
    deposit: "None.",
    gas: "150 TGas.",
    returns: <><a href="#t-claimable">Claimable</a>: what was claimed.</>,
    errors: ["join the dish first"],
    events: EV("claim", "nep141 ft_transfer", "payout_failed"),
  },
  {
    name: "rename",
    kind: "change",
    sig: "pub fn rename(&mut self, name: String, color: u32) -> Colony",
    args: `{ "name": "Better Name", "color": 2364586 }`,
    what: <p>Chooses the name and colour again, once, for a colony someone else paid to start through NEAR Intents (<C>Colony.proxy = true</C>). After it, <C>proxy</C> is false.</p>,
    deposit: "None.",
    gas: "50 TGas.",
    returns: "The updated Colony.",
    errors: ["join the dish first", "only a colony someone else started can be renamed, and only once", "a colony with that name already exists", "color must be 0xRRGGBB"],
    events: EV("rename"),
  },
];

const PAYOUTS: M[] = [
  {
    name: "set_payout",
    kind: "change",
    sig: "pub fn set_payout(&mut self, account_id: Option<AccountId>)",
    args: `{ "account_id": "cold-wallet.near" }`,
    what: <p>Sends the colony&rsquo;s NEAR payouts (tide claims and sales) to <C>account_id</C> from now on, or back to the colony&rsquo;s own account with <C>null</C>. Only a colony that has attached NEAR may set one; the relayer never relays it.</p>,
    deposit: "None.",
    gas: "50 TGas.",
    errors: ["join the dish first", "only a colony that has attached NEAR is paid in NEAR; free play earns credit, which stays in the dish"],
    events: EV("payout"),
  },
];

const CREDIT: M[] = [
  {
    name: "sponsor",
    kind: "payable",
    sig: "pub fn sponsor(&mut self, account_id: AccountId) -> U128",
    args: `{ "account_id": "g-0123456789.relayer.testnet" }`,
    what: <p>Gives <C>account_id</C> the attached NEAR, less its credit record&rsquo;s storage, as sponsored credit it can spend only in the dish. The caller becomes its sponsor. Anyone may sponsor anyone.</p>,
    deposit: "More than the record's storage. The site's relayer attaches 0.05 NEAR per guest.",
    gas: "30 TGas (the relayer's value).",
    returns: "The account's sponsored credit after the call.",
    errors: ["sponsoring needs more than the {n} NEAR its record costs"],
    events: EV("sponsor"),
  },
  {
    name: "unsponsor",
    kind: "change",
    sig: "pub fn unsponsor(&mut self, account_id: AccountId) -> U128",
    args: `{ "account_id": "g-0123456789.relayer.testnet" }`,
    what: <p>The sponsor takes back the account&rsquo;s sponsored credit once it has gone unused for 5,760 generations of the clock. Credit the account won is not touched.</p>,
    deposit: "None.",
    returns: "yoctoNEAR sent back to the sponsor.",
    errors: ["that account has no credit", "only the account's sponsor can take its credit back", "the credit was used in the last day"],
    events: EV("unsponsor"),
  },
];

const TOKEN: M[] = [
  {
    name: "ft_transfer",
    kind: "payable",
    sig: "pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>)",
    args: `{ "receiver_id": "friend.near", "amount": "1000000", "memo": null }`,
    what: <p>NEP-141 transfer. The receiver must be registered (a colony, or <C>storage_deposit</C>). PETRI cannot be sent to the contract itself.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: ["requires exactly 1 yoctoNEAR", "amount must be positive", "PETRI goes back to the agar only by planting or selling", "sender and receiver are the same account", "the receiver is not registered; it needs storage_deposit first", "not enough PETRI"],
    events: EV("nep141 ft_transfer"),
  },
  {
    name: "ft_transfer_call",
    kind: "payable",
    sig: "pub fn ft_transfer_call(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>, msg: String) -> PromiseOrValue<U128>",
    args: `{ "receiver_id": "some-contract.near", "amount": "1000000", "memo": null, "msg": "" }`,
    what: <p>NEP-141 transfer and call: the receiver&rsquo;s <C>ft_on_transfer</C> gets the gas left after the resolve callback (10 TGas) is set aside; <C>ft_resolve_transfer</C> refunds what it returns unused.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    gas: "At least 35 TGas must remain after the transfer (10 for the receiver, 10 for the resolve, 15 of margin).",
    errors: ["requires exactly 1 yoctoNEAR", "more gas is required"],
    events: EV("nep141 ft_transfer"),
  },
  {
    name: "storage_deposit",
    kind: "payable",
    sig: "pub fn storage_deposit(&mut self, account_id: Option<AccountId>, registration_only: Option<bool>) -> StorageBalance",
    args: `{ "account_id": null, "registration_only": true }`,
    what: <p>NEP-145: registers an account to hold PETRI. It costs exactly 125 bytes (0.00125 NEAR); anything more is sent back, and a deposit for an account already registered is sent back whole. A keeper that wants the keeper pot registers this way.</p>,
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
    errors: ["requires exactly 1 yoctoNEAR", "this account is not registered", "there is no storage deposit above the minimum to withdraw"],
  },
  {
    name: "storage_unregister",
    kind: "payable",
    sig: "pub fn storage_unregister(&mut self, force: Option<bool>) -> bool",
    what: <p>NEP-145. Removes an empty registration and refunds 0.00125 NEAR. Colonies stay registered for as long as the dish lives; <C>force</C> is ignored.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    returns: "false if the account was not registered.",
    errors: ["requires exactly 1 yoctoNEAR", "the account still holds PETRI", "colonies cannot unregister"],
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
        Mints a specimen slide of the caller colony&rsquo;s own living cells in the <C>w × h</C> rectangle at <C>(x, y)</C>, wrapping, at the stored generation after catching up. Burns <C>slide_cells_price</C> per captured cell (earnings are claimed first). Storage comes from <C>credit</C> first (up to the storage needed), then the attached NEAR; attached NEAR left over is sent back. Records a <C>Slide</C> ledger entry.
      </p>
    ),
    deposit: <><C>slide_deposit(w, h, title_bytes)</C>, attached or as credit.</>,
    gas: "300 TGas from a wallet (the site's value). Calls relayed for guests are capped at 250 TGas.",
    returns: "The token id, a decimal string (\"1\" is the first slide).",
    errors: [
      "join the dish first",
      "a slide is 4 to 32 cells on each side",
      "the slide's corner is off the dish",
      "a slide's title may not contain control, direction, invisible or tag characters",
      "a slide's title is at most 40 characters",
      "a slide needs at least 5 of your living cells; that rectangle holds {n}",
      "a slide of {n} cells costs {p} PETRI; you hold {b}",
      "this slide needs {n} NEAR for its storage",
    ],
    events: EV("nep171 nft_mint", "slide", "nep141 ft_burn"),
  },
  {
    name: "nft_transfer",
    kind: "payable",
    sig: "pub fn nft_transfer(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>)",
    args: `{ "receiver_id": "friend.near", "token_id": "1", "approval_id": null, "memo": null }`,
    what: <p>NEP-171 transfer by the owner or an approved account. Clears the slide&rsquo;s approvals and refunds their storage to the previous owner.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: ["requires exactly 1 yoctoNEAR", "there is no slide with that id", "only the slide's owner or an approved account can transfer it", "that approval id is out of date", "the slide already belongs to the receiver", "the dish does not hold slides"],
    events: EV("nep171 nft_transfer"),
  },
  {
    name: "nft_transfer_call",
    kind: "payable",
    sig: "pub fn nft_transfer_call(&mut self, receiver_id: AccountId, token_id: String, approval_id: Option<u64>, memo: Option<String>, msg: String) -> PromiseOrValue<bool>",
    what: <p>NEP-171 transfer and call. If the receiver&rsquo;s <C>nft_on_transfer</C> returns true (or fails) and it still owns the slide, <C>nft_resolve_transfer</C> gives it back with its old approvals.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    gas: "At least 40 TGas must remain after the transfer (10 for the receiver, 15 for the resolve, 15 of margin).",
    errors: ["requires exactly 1 yoctoNEAR", "more gas is required"],
    events: EV("nep171 nft_transfer"),
  },
  {
    name: "nft_approve",
    kind: "payable",
    sig: "pub fn nft_approve(&mut self, token_id: String, account_id: AccountId, msg: Option<String>) -> Option<Promise>",
    what: <p>NEP-178: lets <C>account_id</C> transfer the slide. The deposit pays the approval&rsquo;s storage (12 bytes + the account&rsquo;s length), refunded when the approval goes; the rest is sent back. With <C>msg</C>, calls <C>account_id.nft_on_approve</C>.</p>,
    deposit: "At least 1 yoctoNEAR, and the approval's storage for a new one.",
    errors: ["requires at least 1 yoctoNEAR", "only the slide's owner can approve", "a slide has at most 16 approvals", "an approval needs {n} NEAR for its storage"],
  },
  {
    name: "nft_revoke",
    kind: "payable",
    sig: "pub fn nft_revoke(&mut self, token_id: String, account_id: AccountId)",
    what: <p>NEP-178: removes one approval and refunds its storage. <C>nft_revoke_all(token_id)</C> removes them all.</p>,
    deposit: "Exactly 1 yoctoNEAR.",
    errors: ["requires exactly 1 yoctoNEAR", "only the slide's owner can revoke"],
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
      <p>
        NEP-141 receiver, called by a token contract. wNEAR from <C>rules.wnear</C> of at least 0.01 NEAR is kept whole (returns 0) and unwrapped with <C>near_withdraw</C>; then <C>on_unwrapped</C> and <C>settle_intent</C> join or buy for <C>msg.for</C>. Any other token, or less than 0.01 NEAR, is returned whole. It never panics. See <Doc to="intents" hash="contract">NEAR Intents</Doc> for every branch.
      </p>
    ),
    returns: "The unused amount: all of it for another token or dust, otherwise \"0\".",
    events: EV("intents"),
  },
  {
    name: "claim_pending",
    kind: "change",
    sig: "pub fn claim_pending(&mut self) -> U128",
    args: `{}`,
    what: <p>Sends the caller its pending NEAR (from wNEAR that could not join or buy), with the storage its pending record freed. A failed transfer is pending again.</p>,
    gas: "30 TGas.",
    returns: "yoctoNEAR sent.",
    errors: ["the dish does not play on itself", "nothing is pending for this account"],
    events: EV("claim_pending"),
  },
  {
    name: "unwrap_wnear",
    kind: "change",
    sig: "pub fn unwrap_wnear(&mut self) -> Promise",
    args: `{}`,
    what: <p>Unwraps wNEAR the dish holds for pending accounts that is not already being unwrapped (after a failed unwrap, or a transfer that came with too little gas to unwrap). Anyone may call it; the keeper does.</p>,
    gas: "100 TGas (the keeper's value).",
    errors: ["this dish takes no wNEAR", "no wNEAR is waiting to be unwrapped"],
  },
  {
    name: "register_wnear",
    kind: "payable",
    sig: "pub fn register_wnear(&mut self) -> Promise",
    what: <p>Registers the dish on the wNEAR contract so it can receive wNEAR. Paid from the attached deposit (0.00125 NEAR; extra sent back) or, with none attached, from the contract&rsquo;s surplus. Both dishes are registered: <C>state().wnear_ready</C> is true.</p>,
    deposit: "0.00125 NEAR, or none if the surplus covers it.",
    errors: ["this dish takes no wNEAR", "the dish is already registered on wNEAR", "registering on wNEAR costs 0.00125 NEAR", "the dish has no surplus for the registration; attach 0.00125 NEAR"],
  },
];

const CALLBACKS: [string, string][] = [
  ["on_payout(colony, near, kind)", "After a NEAR payout. A failed claim (kind 0) is owed again; a failed sale (1) or bounty (2) goes back to the vault with a Refund entry. Emits payout_failed."],
  ["on_unwrapped(account, what, name, color, amount)", "After near_withdraw. Credits the amount as pending NEAR for the account (or keeps it as wNEAR if the unwrap failed) and, with at least 40 TGas left, schedules settle_intent."],
  ["settle_intent(account, what, name, color, amount)", "Spends the pending NEAR on a join or purchase as attached NEAR. Anything it cannot do leaves the NEAR pending. Returns \"join\", \"buy\", \"pending\" or \"claimed\"."],
  ["on_pending_paid(account, near)", "After claim_pending. A failed transfer is pending again."],
  ["on_wnear_unwrapped(amount)", "After unwrap_wnear."],
  ["on_wnear_registered()", "After register_wnear; sets wnear_ready."],
  ["ft_resolve_transfer(sender_id, receiver_id, amount)", "NEP-141 resolve: refunds what the receiver returned unused."],
  ["nft_resolve_transfer(previous_owner_id, receiver_id, token_id, approved_account_ids)", "NEP-171 resolve: returns the slide if the receiver asked, restoring its approvals."],
];

const VIEWS: [string, string, string][] = [
  ["rules()", "Rules", "Every parameter, fixed at launch."],
  ["state()", "DishState", "The clock, hashes, counts, every PETRI, NEAR and credit counter, current prices."],
  ["board()", "String", "The stored board in compact form, base64 (see Verification)."],
  ["colonies(from?, limit?)", "Vec<Colony>", "Colonies by id order from index from (0-based); limit default 100, at most 500."],
  ["colony_of(account_id)", "Option<Colony>", "One account's colony."],
  ["stakes(from?, limit?)", "Vec<U64>", "Each colony's stake in thousandths (index = id − 1); default 500, at most 2,000."],
  ["earnings(from?, limit?)", "Vec<U128>", "Each colony's lifetime PETRI earnings, claimed or not; default 500, at most 2,000."],
  ["tide_winnings(from?, limit?)", "Vec<U128>", "Each colony's NEAR won at tides, claimed or not; default 500, at most 2,000."],
  ["ledger(from?, limit?)", "Vec<Entry>", "Ledger entries in order; default 200, at most 1,000."],
  ["plants(from?, limit?)", "Vec<PlantView>", "Plantings only, by planting number, with lab notes; default 200, at most 1,000."],
  ["checkpoints(from?, limit?)", "Vec<Checkpoint>", "The history chain at generation 0 and at every tide; default 500, at most 2,000."],
  ["claimable(account_id)", "Claimable", "Unclaimed PETRI and NEAR won but not claimed."],
  ["quote(cells, siege?)", "U128", "PETRI units to plant cells cells now (before the catch-up the planting triggers)."],
  ["plant_deposit(cells, note_bytes?)", "U128", "yoctoNEAR to attach to a planting."],
  ["buy_quote(near)", "U128", "PETRI units near yoctoNEAR buys now."],
  ["sell_quote(petri)", "U128", "yoctoNEAR the agar pays for petri units now, before the sale record's storage."],
  ["credit_of(account_id)", "U128", "Spendable credit: won plus sponsored."],
  ["credit_record(account_id)", "Option<Credit>", "The sponsored part, its sponsor and when it was last used."],
  ["solvency()", "Solvency", "NEAR held against NEAR owed."],
  ["pending_of(account_id)", "U128", "Pending NEAR from intents payments."],
  ["slide_deposit(w, h, title_bytes?)", "U128", "yoctoNEAR to bring to a slide."],
  ["slides(from?, limit?)", "Vec<SlideView>", "Slides in mint order, without images; default 100, at most 500."],
  ["slide(token_id)", "Option<SlideView>", "One slide without its image."],
  ["slides_for(account_id, from?, limit?)", "Vec<SlideView>", "An owner's slides."],
  ["ft_balance_of(account_id)", "U128", "NEP-141. For the contract itself: agar + unclaimed + keeper pot."],
  ["ft_total_supply()", "U128", "max_supply − burned."],
  ["ft_metadata()", "FtMetadata", "spec ft-1.0.0, name Petri, symbol PETRI, decimals 6, an SVG icon."],
  ["storage_balance_of(account_id)", "Option<StorageBalance>", "NEP-145."],
  ["storage_balance_bounds()", "StorageBounds", "min = max = 0.00125 NEAR."],
  ["nft_token(token_id)", "Option<Token>", "NEP-171 token with metadata, image drawn now."],
  ["nft_metadata()", "NftContractMetadata", "spec nft-2.1.0, name Petri specimens, symbol SLIDE."],
  ["nft_is_approved(token_id, approved_account_id, approval_id?)", "bool", "NEP-178."],
  ["nft_total_supply()", "U128", "NEP-181: slides minted."],
  ["nft_tokens(from_index?, limit?)", "Vec<Token>", "NEP-181: at most 50 a call (each carries its image)."],
  ["nft_supply_for_owner(account_id)", "U128", "NEP-181."],
  ["nft_tokens_for_owner(account_id, from_index?, limit?)", "Vec<Token>", "NEP-181: at most 50 a call."],
  ["contract_source_metadata()", "ContractSourceMetadata", "NEP-330: version 0.3.0, the commit, the build image and command (generated by cargo near)."],
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
      ]}
    >
      <H2 id="conventions">Conventions</H2>
      <ul>
        <li>
          Arguments and results are JSON. <C>U128</C> and <C>U64</C> are decimal strings (<C>&quot;1000000&quot;</C>); <C>u16</C>, <C>u32</C> and <C>u64</C> are numbers; <C>Option</C> is <C>null</C> or the value, and optional arguments may be left out.
        </li>
        <li>PETRI amounts are in units (10<sup>−6</sup> PETRI); NEAR and credit in yoctoNEAR.</li>
        <li>
          <C>credit</C> on <C>join</C>, <C>buy</C>, <C>plant</C> and <C>mint_slide</C> spends that many yoctoNEAR of the caller&rsquo;s credit, won credit first. It is how a function-call key pays: such keys cannot attach NEAR.
        </li>
        <li>
          Every state-changing dish method catches the dish up first (up to 120 generations), so it pays for the generations it runs. The gas values below are what the site, the strains and the keeper use; they cover a full catch-up.
        </li>
        <li>
          Panic messages are the contract&rsquo;s own words; near-sdk prefixes them with <C>Smart contract panicked:</C>. <C>{"{n}"}</C> marks a number filled in at run time. The contract itself can never be the caller of a player method (<C>the dish does not play on itself</C>).
        </li>
      </ul>
      <Table caption="Gas the site and agents attach">
        <thead>
          <tr>
            <th>Call</th>
            <th className="n">TGas</th>
            <th>Deposit</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["join", "200", "0.02 NEAR (site default; at least 0.01)"],
            ["plant", "200", "plant_deposit(cells, note_bytes)"],
            ["buy", "150", "0.01 NEAR (site default)"],
            ["sell", "150", "none"],
            ["claim", "150", "none"],
            ["advance", "250", "none"],
            ["mint_slide", "300 (wallet)", "slide_deposit(w, h, title_bytes)"],
            ["rename", "50", "none"],
            ["set_payout", "50", "none"],
            ["claim_pending", "30", "none"],
            ["sponsor", "30", "the credit to give"],
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
        Spending credit is not a method of its own: pass <C>credit</C> to <C>join</C>, <C>buy</C>, <C>plant</C> or <C>mint_slide</C>. Read it with <C>credit_of</C> and <C>credit_record</C>.
      </p>
      {CREDIT.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="token">Token: NEP-141, NEP-145, NEP-148</H2>
      <p>
        PETRI follows NEP-141 with NEP-148 metadata and NEP-145 storage registration. An account must be registered before it can receive PETRI; joining registers it. The contract never sends or receives PETRI through these methods: its own holding is the agar.
      </p>
      {TOKEN.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="slides-methods">Slides: NEP-171, 177, 178, 181</H2>
      <p>
        Token ids are <C>&quot;1&quot;</C>, <C>&quot;2&quot;</C>, … in mint order; only plain decimal ids name a slide (<C>&quot;01&quot;</C> does not). The views are listed under <a href="#views">Views</a>.
      </p>
      {SLIDES.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="intents-methods">Intents</H2>
      {INTENTS.map((m) => (
        <Method key={m.name} m={m} />
      ))}

      <H2 id="callbacks">Callbacks</H2>
      <p>
        These are <C>#[private]</C> (near-sdk rejects any caller but the contract itself), and the intents and slide callbacks also check the caller again. Nobody else can run them; the tests <C>nobody_else_can_call_the_unwrap_callback</C>, <C>nobody_else_can_settle_an_order</C> and <C>nobody_else_can_resolve_a_slide_transfer</C> try.
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
      <p id="t-colony">The JSON shapes, as the Rust structs define them. Field comments are the contract&rsquo;s own.</p>
      <Code lang="rust" title="Colony">{`pub struct Colony {
    pub id: u16,
    pub account: AccountId,
    pub name: String,
    pub color: u32,                       // 0xRRGGBB
    pub house: bool,                      // one of the dish's own players: never fed, no share of the tides
    pub payout: Option<AccountId>,        // where NEAR payouts go, if not the colony's own account
    pub joined_generation: U64,
    pub last_plant_generation: Option<U64>,
    pub cells_planted: U64,
    pub petri_spent: U128,                // everything paid for plantings (half burned, half returned)
    pub petri_burned: U128,
    pub petri_claimed: U128,              // earned and already claimed; unclaimed earnings are in claimable
    pub petri_sold: U128,                 // PETRI sold back to the agar
    pub near_paid: U128,                  // NEAR brought to the dish (attached or sponsored), storage included
    pub near_claimed: U128,               // NEAR won at the tides and claimed
    pub near_sold: U128,                  // NEAR received for PETRI sold back (sales paid as credit are not counted)
    pub credit_won: U128,                 // credit won at the tides (filled in by the views)
    pub proxy: bool,                      // started by someone else's payment; may rename once
}`}</Code>
      <Code lang="rust" title="DishState (state())">{`pub struct DishState {
    pub generation: U64, pub due_generation: U64, pub epoch_ms: U64, pub now_ms: U64,
    pub chain: String,                    // hex history chain at the stored generation
    pub board_hash: String,               // hex sha256 of the live cells (see Verification)
    pub total_live: u32,
    pub counted: u32,                     // cells the last feed counted; prices are set against this
    pub colonies: u16, pub ledger: U64, pub plants: U64,
    pub total_supply: U128, pub agar: U128, pub sold: U128, pub fed: U128, pub returned: U128,
    pub burned: U128, pub bought_back: U128, pub unclaimed: U128, pub keeper_pot: U128, pub keeper_paid: U128,
    pub vault: U128, pub near_in: U128, pub near_tides: U128, pub near_as_credit: U128,
    pub near_bounties: U128, pub near_sold: U128, pub near_refunded: U128,
    pub tides_owed: U128,                 // NEAR tide winnings not yet claimed
    pub sell_left: U128,                  // NEAR the agar may still pay for PETRI before the next tide
    pub credit_pool: U128, pub credit_in: U128, pub credit_given: U128, pub credit_spent: U128,
    pub credit_won: U128, pub credit_sold: U128, pub credit_reclaimed: U128,
    pub tides: U64,                       // tides that ran; idle tides are not counted
    pub skipped: U64,
    pub house: Vec<u16>,
    pub slides: U64, pub slides_burned: U128,
    pub pending: U128, pub wrapped: U128, pub wnear_ready: bool,
    pub cell_price: U128,                 // PETRI units per cell right now
    pub petri_price: U128,                // yoctoNEAR per PETRI right now
}`}</Code>
      <p id="t-claimable" />
      <Code lang="rust" title="Smaller types">{`pub struct Claimable { pub petri: U128, pub near: U128 }
pub struct Credit { pub amount: U128, pub sponsor: AccountId, pub at: U64 }   // at: clock generation last given or used
pub struct Solvency {
    pub balance: U128, pub storage: U128, pub vault: U128, pub credit_pool: U128,
    pub credit_outstanding: U128, pub tides_owed: U128, pub pending: U128, pub wrapped: U128,
    pub surplus: U128, pub solvent: bool,
}
pub struct PlantView { pub index: U64, pub generation: U64, pub colony: u16, pub cells: Vec<u16>,
                       pub cost: U128, pub siege: bool, pub note: Option<String> }
pub struct Checkpoint { pub generation: U64, pub chain: String }
pub struct SlideView { pub token_id: String, pub owner_id: AccountId, pub colony: u16, pub name: String,
                       pub color: u32, pub generation: U64, pub x: u16, pub y: u16, pub w: u16, pub h: u16,
                       pub cells: u32, pub title: Option<String>, pub bitmap: Base64VecU8, pub minted_ms: U64 }`}</Code>
      <p>
        <C>Rules</C> is listed field by field in the <Doc to="rules" hash="parameters">Rules reference</Doc>. NEP-171 <C>Token</C> and NEP-177 <C>TokenMetadata</C> follow the standards; how Petri fills them is in <Doc to="specimens" hash="standards">Specimens</Doc>.
      </p>

      <H2 id="ledger">The ledger: Entry</H2>
      <p>
        The ledger is one ordered list of everything that changes the dish, the agar, the vault or the credit pool. Replaying it from an empty dish with petri-core reproduces all four. Each entry is a JSON object with one key, the variant&rsquo;s name.
      </p>
      <Code lang="rust" title="contract/src/lib.rs">{`pub enum Entry {
    Join { generation: U64, colony: u16 },
    /// near reached the vault and credit the credit pool, after this entry's storage.
    Buy { generation: U64, colony: u16, petri: U128, near: U128, credit: U128 },
    /// near reached the vault and credit the credit pool, after the planting's storage. siege marks a planting
    /// inside a rival's buffer. Cells are flat indices; each fits in 16 bits.
    Plant { generation: U64, colony: u16, cells: Vec<u16>, cost: U128, near: U128, credit: U128, siege: bool },
    /// near left the vault: paid to the seller and the rest for this entry's storage. as_credit marks a seller
    /// that has never attached NEAR, paid in credit instead.
    Sell { generation: U64, colony: u16, petri: U128, near: U128, paid: U128, as_credit: bool },
    /// The history chain at that generation, and the tide. pay is the vault's share; bounty went to the caller,
    /// storage paid for this entry, paid became NEAR colonies can claim, as_credit became credit. credit_pay is the
    /// credit pool's share and credit_paid what colonies received of it. by is the colony whose call ran the tide
    /// (0 for a caller without one).
    Tide { generation: U64, chain: String, pay: U128, bounty: U128, storage: U128, paid: U128, as_credit: U128,
           credit_pay: U128, credit_paid: U128, by: u16 },
    /// Nobody tended the dish for max_lag generations; the clock skipped skipped generations at this one.
    Skip { generation: U64, skipped: U64 },
    /// A sale or bounty payout could not be delivered; its NEAR went back to the vault.
    Refund { generation: U64, colony: u16, near: U128 },
    /// Slide token captured cells of colony's living cells in the w × h rectangle at (x, y), and burned cost PETRI.
    Slide { generation: U64, colony: u16, token: U64, x: u16, y: u16, w: u16, h: u16, cells: u32,
            bitmap: Base64VecU8, cost: U128 },
}`}</Code>
      <Code lang="json" title="The first three entries of petri-dish.near">{`[
  { "Join": { "generation": "21", "colony": 1 } },
  { "Buy": { "generation": "21", "colony": 1, "petri": "212527413", "near": "42510000000000000000000", "credit": "0" } },
  { "Plant": { "generation": "21", "colony": 1, "cells": [15912, 15913, 16039, 16042, 16168, 16169],
               "cost": "8464320", "near": "1250000000000000000000", "credit": "0", "siege": false } }
]`}</Code>
      <p>
        Entries are applied at the start of their generation, before it steps. A planting&rsquo;s lab note is not in the entry; read it with <C>plants</C>. A join&rsquo;s name and colour are in the <C>Colony</C> record.
      </p>

      <H2 id="events">Events</H2>
      <p>
        Every event is a log line <C>EVENT_JSON:{"{...}"}</C> per NEP-297. Petri&rsquo;s own use <C>{`"standard": "petri", "version": "5.0.0"`}</C>; the token&rsquo;s use NEP-141 1.0.0 and the slides&rsquo; NEP-171 1.2.0. Each has <C>event</C> and a one-element <C>data</C> array.
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
            ["plant", "colony, generation, cells (count), cost, siege, near (the deposit), note"],
            ["sell", "colony, petri, and near (paid in NEAR) or credit (paid as credit)"],
            ["claim", "colony, petri, near"],
            ["generation", "from, to, live, fed, keeper_pot, bounty (once per catch-up that ran)"],
            ["skip", "generation, skipped"],
            ["sponsor", "account, sponsor, near"],
            ["unsponsor", "account, sponsor, near"],
            ["rename", "colony, name, color"],
            ["payout", "colony, to"],
            ["payout_failed", "colony, near, kind (0 claim, 1 sale, 2 bounty)"],
            ["slide", "token, colony, generation, x, y, w, h, cells, cost"],
            ["intents", "for, amount, did (\"pending\", \"join\" or \"buy\")"],
            ["claim_pending", "account, near"],
            ["ft_mint", "NEP-141: owner_id, amount, memo (once, at launch)"],
            ["ft_transfer", "NEP-141: old_owner_id, new_owner_id, amount, memo: bought from the agar, earnings from the agar, planting feeds the agar, sold back to the agar, keeper pot, refund, or the sender's memo"],
            ["ft_burn", "NEP-141: owner_id, amount, memo (planting or specimen slide)"],
            ["nft_mint", "NEP-171: owner_id, token_ids"],
            ["nft_transfer", "NEP-171: old_owner_id, new_owner_id, token_ids, authorized_id when an approved account moved it, memo"],
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
      <Code lang="json" title="A plant event">{`EVENT_JSON:{"standard":"petri","version":"5.0.0","event":"plant","data":[{"colony":1,"generation":"21","cells":6,"cost":"8464320","siege":false,"near":"…","note":"…"}]}`}</Code>

      <H2 id="errors">Errors</H2>
      <p>
        Each method above lists the messages it can panic with. A failed call changes nothing: NEAR rolls back the whole receipt and refunds the attached deposit. Two cases are worth knowing:
      </p>
      <ul>
        <li>
          <C>the dish is behind the clock; call advance first</C>: the dish was more than 120 generations behind, so the planting&rsquo;s own catch-up did not reach the clock. Call <C>advance</C> and plant again.
        </li>
        <li>
          <C>the agar buys back at most 0 NEAR more before the next tide</C>: no tide has run yet, or this tide&rsquo;s allowance is spent.
        </li>
      </ul>
      <Callout kind="note">
        <p>
          <C>ft_on_transfer</C> and the intents callbacks never panic on bad input: an unusable payment becomes pending NEAR instead, because a withdrawal from the intents contract is not refunded when the receiver fails.
        </p>
      </Callout>
    </DocPage>
  );
}
