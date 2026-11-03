import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, H2, H3 } from "@/components/docs/ui";

export const metadata = docMetadata("security");

type Threat = { id: string; title: string; threat: React.ReactNode; defense: React.ReactNode; tests: string[]; limit?: React.ReactNode };

const T = ({ names }: { names: string[] }) =>
  names.length === 0 ? (
    <span>No automated test: this is server code, checked by reading it.</span>
  ) : (
    <>
      {names.map((n, i) => (
        <span key={n}>
          {i > 0 && ", "}
          <C>{n}</C>
        </span>
      ))}
    </>
  );

const THREATS: Threat[] = [
  {
    id: "t-relayer",
    title: "Draining the relayer",
    threat: "The testnet relayer pays gas for guests. An attacker sends it calls that make it pay deposits, gas for failing calls, or the same action twice.",
    defense: (
      <>
        <C>/api/relay</C> checks, before paying anything, what NEAR would check: the sender matches <C>g-[0-9a-f]{"{10}"}.&lt;relayer&gt;</C>; the receiver is the dish; exactly one function call, in the allow-list <C>join buy plant sell claim advance mint_slide</C>; zero deposit; at most 250 TGas; a valid ed25519 signature over the delegate action; not expired; the key exists on the account with a fresh nonce. A nonce relayed in the last five minutes is refused. A guest may relay 6 calls a minute and the relayer 120 a minute. Guests pay every deposit from credit the contract holds, so the relayer never attaches NEAR to a relayed call.
      </>
    ),
    tests: ["sponsored_credit_pays_for_joining_and_planting_and_cannot_leave", "credit_cannot_be_overspent"],
    limit: "The relay checks are server code with no automated test; the tests named cover the contract side (credit pays, and cannot be overspent). The rate limits are per server instance and in memory. A call that passes the checks and still fails inside the contract costs the relayer its gas, bounded by the rate limit.",
  },
  {
    id: "t-pow",
    title: "Farming guest accounts",
    threat: "Each guest costs the relayer an account, 0.003 NEAR for its storage and 0.05 NEAR of credit. A script could make thousands.",
    defense: (
      <>
        <C>/api/guest</C> hands out a challenge signed with a key derived from the relayer&rsquo;s, valid for ten minutes. The browser must find a nonce such that <C>sha256(&quot;petri-guest:&quot; + challenge + &quot;:&quot; + publicKey + &quot;:&quot; + nonce)</C> starts with 18 zero bits, binding the work to its own key. The account name comes from the key&rsquo;s hash, so one key makes one guest. At most 4 guests per IP address per hour and 120 per hour in all. And what a guest gets is credit, which never leaves the dish, while the sponsor can take back credit left unused for a day.
      </>
    ),
    tests: ["a_sponsor_takes_back_credit_left_unused", "won_credit_is_spent_first_and_no_sponsor_can_take_it_back"],
    limit: "Proof of work slows a farm, it does not stop one. The cost of a successful farm is the relayer's testnet NEAR; it cannot turn into anyone's mainnet NEAR.",
  },
  {
    id: "t-sybil",
    title: "Sybils splitting one stake",
    threat: "Split one player into many colonies to collect more of the feed or the tides.",
    defense: (
      <>
        A colony is paid for at most <C>stake × reach ÷ 1000</C> living cells, and stake comes only from cells paid for. The cap is linear, so the parts of a split never weigh more than the whole. The feed and tides follow those capped weights.
      </>
    ),
    tests: ["splitting_never_earns_more (core, property test)", "pay_is_capped_by_cells_planted_and_splitting_does_not_help", "the_feed_is_capped_by_what_a_colony_planted (core)"],
    limit: (
      <>
        In the simulator a SplitWhale (one whale over 10 or 20 colonies) lost 1.14 to 2.39 NEAR in a week, more than the same whale in one colony at 1,500 players. See <Doc to="simulations" hash="cash">Cash per player</Doc>.
      </>
    ),
  },
  {
    id: "t-lock",
    title: "Carpet-locking the dish",
    threat: "Cover the agar with a lattice of cheap blocks so every empty cell is inside someone's buffer, and newcomers either cannot plant or pay a fortune.",
    defense: (
      <>
        A planting inside a rival&rsquo;s buffer is never refused, only priced at 3 times. Stake decays to 87.5% at every tide, so a lattice earns only while its owner keeps paying to plant. House cells never make a siege, so the strains cannot lock anyone out.
      </>
    ),
    tests: ["planting_inside_a_rival_buffer_is_a_siege_at_siege_x_the_price", "stake_decays_so_ground_is_rent", "house_cells_never_make_a_siege_for_newcomers", "house_cells_never_make_a_siege (core)"],
    limit: (
      <>
        This was the one adversary the simulator found profitable: a Locker at 1,500 players made +0.59 NEAR (median) a week under the rules before v5&rsquo;s last change. Halving the tide to 5% turned that into &minus;0.45 NEAR, and that change shipped. A locker still makes the first hour on a small dish hard for newcomers: at 15 players almost no free 2 × 2 spot is left after an hour.
      </>
    ),
  },
  {
    id: "t-keeper",
    title: "Gaming the keeper pot",
    threat: "Collect the 2% keeper share without doing useful work, or keep others from collecting it.",
    defense: (
      <>
        The pot goes only to a caller whose <C>advance</C> ran at least one generation, which is exactly the work it pays for, and only if the caller can hold PETRI. Anyone may advance, so the pot is a race, and racing costs gas.
      </>
    ),
    tests: ["the_keeper_pot_goes_to_whoever_advances_the_clock"],
    limit: "In the simulator a Racer that only advances for the pot and bounties lost 0.05 to 0.06 NEAR a week.",
  },
  {
    id: "t-snipe",
    title: "Sniping tides",
    threat: "Plant just before a tide and take a share of the vault that others paid in all hour.",
    defense: (
      <>
        A tide splits by what each colony earned from the feed since the last tide, so arriving late earns a late share. The caller&rsquo;s bounty is 1% of the vault&rsquo;s share, at most 0.001 NEAR. A tide with nobody to pay does not run at all.
      </>
    ),
    tests: ["tides_pay_by_what_was_earned_since_the_last_tide", "tides_follow_the_window_and_skip_the_house (core)", "an_idle_dish_runs_no_tides_and_keeps_its_vault"],
    limit: "In the simulator a Sniper that plants in the three generations before each tide and sells after lost 0.06 to 0.08 NEAR a week.",
  },
  {
    id: "t-storage",
    title: "Storage griefing",
    threat: "Make the contract pay for data: long notes, many records, tides with no winners, empty pending records, slides passed around to long account names.",
    defense: (
      <>
        Every move pays the storage of what it writes, measured after the write: plantings by <C>plant_deposit</C>, slides by <C>slide_deposit</C> with a reserve for later owners, approvals by their granter, pending records from the amount they hold, sale records from the proceeds, tide records from the vault. Idle tides write nothing. A dish nobody touches for two hours writes one Skip entry instead of hours of catch-up.
      </>
    ),
    tests: ["the_planting_deposit_covers_its_storage_without_overcharging", "a_slide_pays_for_its_storage", "an_approval_pays_for_its_storage", "transfers_never_outgrow_the_storage_a_slide_paid_for", "an_idle_dish_runs_no_tides_and_keeps_its_vault", "an_untended_dish_skips_ahead_instead_of_piling_up_work"],
    limit: "Skip entries and the board's growth during a catch-up are paid by the contract's own surplus. In the simulator's empty 30-day dish, skipping idle tides took the contract's own storage bill from 1.95 NEAR to zero.",
  },
  {
    id: "t-injection",
    title: "Prompt injection into the AI strains",
    threat: "A player writes a colony name or a lab note that reads as an instruction to the model playing a house strain.",
    defense: (
      <>
        No player-written text reaches a model. The prompt names rivals only as <C>colony 7 with 72 cells</C>. Names are plain ASCII from a short list of characters, and notes and titles refuse control, direction, invisible and tag characters, so nothing can hide in them. The model only chooses a number from a list of plantings the rules already accept (checked with petri-core), and its answer is rejected if the number is out of range. Its own note is cleaned of links, account names and anything outside plain Latin text before it is stored. The house never lays siege.
      </>
    ),
    tests: ["names_cannot_hide_characters", "names_cannot_use_look_alike_letters", "notes_cannot_carry_invisible_text"],
    limit: "The agents are JavaScript with no automated tests; the tests named cover the contract's text rules. A model can still choose badly; it can never choose an illegal move.",
  },
  {
    id: "t-guest",
    title: "Guests leaking NEAR",
    threat: "Turn free testnet play, or self-sponsored accounts on any network, into NEAR someone can withdraw.",
    defense: (
      <>
        A colony that never attached NEAR is paid every tide share, sale and bounty as won credit, which is spendable only in the dish and which no sponsor can take back. Only a colony that attached NEAR may set a payout account. A guest&rsquo;s function-call key cannot attach or transfer NEAR or PETRI. Sponsored credit goes to the credit pool, which pays only credit.
      </>
    ),
    tests: ["a_guest_wins_credit_where_a_wallet_wins_near", "a_guest_cannot_send_winnings_to_a_wallet", "a_guest_sale_pays_credit", "a_guest_that_runs_a_tide_is_paid_its_bounty_as_credit", "sponsored_credit_pays_for_joining_and_planting_and_cannot_leave"],
    limit: "A SelfSponsor (one operator sponsoring 10 of its own full-access accounts) lost 0.33 to 0.47 NEAR a week in the simulator: the only NEAR it gets back is its own unused sponsorship.",
  },
  {
    id: "t-gas",
    title: "Tide gas at scale",
    threat: "With enough winners, a tide could need more gas than one transaction can buy, and every later call would fail: the dish would halt.",
    defense: (
      <>
        Winnings live in packed per-colony arrays, each read and written once per tide however many colonies win; a tide touches no colony or credit record. Living cells are counted sparsely, so a generation costs what the living cost, not what every colony that ever joined would. A catch-up stops before the gas limit and the next call carries on.
      </>
    ),
    tests: ["a_tide_with_fifteen_hundred_winners_stays_well_under_the_gas_limit", "many_living_colonies_advance_with_one_summary_log", "sparse_stepping_matches_full_stepping (core)", "catch_up_is_capped_and_plant_waits_for_the_clock"],
    limit: "The 1,500-winner test asserts under 10 TGas of host calls for the tide. In the simulator at 15,000 players the biggest tide fell from 595 TGas (23 tides over 300 TGas in a day) to 70 TGas once winnings were packed; the biggest call was 115 TGas.",
  },
  {
    id: "t-intents",
    title: "Wrong tokens and forged intents",
    threat: "Call ft_on_transfer directly claiming wNEAR that never arrived, send another token, forge a callback, or get one payment spent twice.",
    defense: (
      <>
        <C>ft_on_transfer</C> acts only when its caller is <C>rules.wnear</C> and the amount is at least 0.01 NEAR; anything else is returned whole and recorded nowhere. The unwrap and settle callbacks are private and check their caller again. A settle that finds less pending than it was sent (claimed meanwhile) does nothing. On the site, no deposit address is shown unless 1Click echoed <C>petri-dish.near</C> as recipient and <C>nep141:wrap.near</C> as the asset.
      </>
    ),
    tests: ["other_tokens_and_dust_are_refunded_and_forged_calls_do_nothing", "nobody_else_can_call_the_unwrap_callback", "nobody_else_can_settle_an_order", "an_order_claimed_before_it_settles_is_not_spent_twice", "a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped", "wnear_with_too_little_gas_to_unwrap_is_kept_for_its_account"],
    limit: (
      <>
        Anyone can pay to start a colony for any account and choose its name; the account may rename it once (<C>a_colony_renames_once_and_only_if_someone_else_started_it</C>). A message that names no valid account leaves the NEAR pending for the transfer&rsquo;s sender, which for 1Click is the intents contract; the site always names one.
      </>
    ),
  },
  {
    id: "t-slides",
    title: "Minting slides of rivals' cells",
    threat: "Mint a specimen of someone else's colony, or of cells that were never there.",
    defense: (
      <>
        The contract captures only the caller colony&rsquo;s own living cells (<C>Dish::region_bitmap</C> for its id) from the stored board, and both replays recompute the bitmap from their own board and compare it byte for byte.
      </>
    ),
    tests: ["nobody_can_mint_a_rivals_cells", "a_slide_captures_only_the_colonys_own_cells_and_burns_its_price", "a_slide_needs_enough_of_your_own_cells", "a_slide_captures_only_its_colony_and_wraps (core)"],
  },
  {
    id: "t-agar",
    title: "Taking the agar or overpromising the vault",
    threat: "Make the contract play as a colony, send its PETRI, or pay more NEAR for sales than the vault holds.",
    defense: (
      <>
        The contract can never be the caller of a player method, PETRI cannot be transferred to or from it through the token, and there is no mint. A sale pays the lesser of half the curve and the units&rsquo; pro-rata share of the vault, at most 10% of the vault between tides. Every test that ends with the conservation check also asserts the contract is solvent.
      </>
    ),
    tests: ["the_contract_cannot_join", "the_contract_cannot_send_the_agar", "the_sell_back_never_promises_more_than_the_vault (core)", "the_agar_buys_back_at_half_price_up_to_a_tenth_of_the_vault", "the_buy_back_allowance_runs_out", "replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault"],
  },
];

export default function Page() {
  return (
    <DocPage slug="security" source={[{ label: "contract/src/tests.rs", path: "contract/src/tests.rs" }, { label: "core/src/tests.rs", path: "core/src/tests.rs" }, { label: "web/src/app/api/", path: "web/src/app/api/relay/route.ts" }]}>
      <H2 id="model">Threat model</H2>
      <p>
        The contract holds real NEAR on mainnet and is played by strangers, scripts and AI agents. The design assumes every player is adversarial and every input is hostile, and asks of each threat: can it take NEAR it did not earn, can it lock others out, can it stop the dish, can it make the contract pay for it?
      </p>
      <ul>
        <li>The rules are fixed at launch; there is no admin method, no parameter setter, no mint, no code-deploy method.</li>
        <li>Every NEAR and PETRI movement is in the ledger, and the replay checks it against the rules.</li>
        <li>Every record is paid for by whoever writes it.</li>
        <li>The house is never paid, so the operators cannot profit from their own players.</li>
      </ul>
      <Callout kind="warn">
        <p>
          The one thing not in place yet: both contract accounts still hold a full-access key, so the code could be replaced. It is to be deleted with the owner&rsquo;s approval before judging. <Doc to="verification" hash="keys">Check it</Doc>.
        </p>
      </Callout>

      <H2 id="threats">Threats and defenses</H2>
      <p>Test names are the functions in <C>contract/src/tests.rs</C>, or <C>core/src/tests.rs</C> where marked core. Simulator figures are from <C>sim/out-v5</C>.</p>
      {THREATS.map((t) => (
        <section key={t.id}>
          <H3 id={t.id}>{t.title}</H3>
          <p>
            <strong>Threat.</strong> {t.threat}
          </p>
          <p>
            <strong>Defense.</strong> {t.defense}
          </p>
          <p>
            <strong>Tests.</strong> <T names={t.tests} />
          </p>
          {t.limit && (
            <p>
              <strong>Limit.</strong> {t.limit}
            </p>
          )}
        </section>
      ))}

      <H2 id="limits">Known limits</H2>
      <ul>
        <li>
          <strong>The code is not locked yet.</strong> Each contract account has one full-access key. Until it is deleted, the owner could deploy different code; after it is deleted, nobody can fix a bug.
        </li>
        <li>
          <strong>Most players lose NEAR.</strong> In the simulator nearly every kind of player ends a week with less NEAR than it brought, mostly because storage takes 37% to 47% of the NEAR that comes in and the rest is shared. Petri is a game with a live economy, not an investment. See <Doc to="simulations" hash="losses">What loses money</Doc>.
        </li>
        <li>
          <strong>No external audit.</strong> The defenses above are tested and simulated by the team, not reviewed by an outside auditor.
        </li>
        <li>
          <strong>Off-chain parts are trusted for liveness, not for money.</strong> The relayer, the guest faucet, the site and the agents can go down or misbehave; none of them can move a player&rsquo;s NEAR or PETRI, but a down relayer stops guests from playing, and a down keeper only means the next player&rsquo;s call does the catch-up.
        </li>
        <li>
          <strong>Server limits are per instance.</strong> The relay and guest rate limits are kept in each server instance&rsquo;s memory.
        </li>
        <li>
          <strong>Relayed gas is capped at 250 TGas.</strong> A guest call that needs more is refused by the relay.
        </li>
        <li>
          <strong>Replays trust their RPC.</strong> See <Doc to="verification" hash="limits">What verification does not prove</Doc>.
        </li>
        <li>
          <strong>Model choices are not on chain.</strong> Which model chose a strain&rsquo;s move, and the NEAR AI Cloud signature when there is one, are in the agents&rsquo; log, not the ledger.
        </li>
      </ul>

      <H2 id="tests">Running the tests that cover these</H2>
      <Code lang="sh" title="Shell, from the repository root">{`# everything: 74 contract tests and 30 core tests
cargo test -p petri-core -p petri-contract

# one threat at a time
cargo test -p petri-contract guest
cargo test -p petri-contract slide
cargo test -p petri-contract wnear
cargo test -p petri-contract a_tide_with_fifteen_hundred_winners -- --nocapture
cargo test -p petri-core splitting_never_earns_more`}</Code>
      <p>
        The 1,500-winner test prints the gas it measured with <C>--nocapture</C>. Most contract tests end with a conservation check: every PETRI and every yoctoNEAR is accounted for, every bounty was paid or refunded, and the contract is solvent.
      </p>
    </DocPage>
  );
}
