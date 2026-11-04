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
        <C>/api/relay</C> checks, before paying anything, what NEAR would check: the sender matches <C>g-[0-9a-f]{"{10}"}.&lt;relayer&gt;</C>; the receiver is the dish; one function call in the allow-list <C>join buy plant sell claim advance mint_slide settle_pending pact_offer pact_accept pact_cancel</C>, which may be preceded by up to three <C>advance</C> calls (the site&rsquo;s way of catching a lagging dish up in the same transaction); zero deposit; at most 300 TGas in all; a valid ed25519 signature over the delegate action; not expired; the key exists on the account with a fresh nonce. A nonce relayed in the last five minutes is refused. A guest may relay 6 calls a minute and the relayer 120 a minute. Guests pay every deposit from credit the contract holds, so the relayer never attaches NEAR to a relayed call.
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
        <C>/api/guest</C> hands out a challenge signed with a key derived from the relayer&rsquo;s, valid for ten minutes. The browser must find a nonce such that <C>sha256(&quot;petri-guest:&quot; + challenge + &quot;:&quot; + publicKey + &quot;:&quot; + nonce)</C> starts with 18 zero bits, binding the work to its own key. The account name comes from the key&rsquo;s hash, so one key makes one guest. At most 4 guests per IP address per hour and 120 per hour in all. And what a guest gets is credit, which never leaves the dish, while the relayer, as its sponsor, can take back what is left of its own grant once the guest has not drawn on it for a day.
      </>
    ),
    tests: ["a_sponsor_takes_back_credit_left_unused", "won_credit_is_spent_first_and_no_sponsor_can_take_it_back"],
    limit: "Proof of work slows a farm, it does not stop one. The cost of a successful farm is the relayer's testnet NEAR; it cannot turn into anyone's mainnet NEAR.",
  },
  {
    id: "t-sponsor",
    title: "Hijacking someone else's sponsorship",
    threat: (
      <>
        Found in review before v6. v5 kept one sponsor per account: sponsoring an account for 1 yoctoNEAR made the caller its sponsor, and a day later <C>unsponsor</C> sent the caller the whole credit, the relayer&rsquo;s included, as NEAR. Each tiny top-up also restarted the day, so the real sponsor could be kept from ever reclaiming.
      </>
    ),
    defense: (
      <>
        Credit is kept per sponsor: each account holds at most 8 grants (<C>credit_grants</C>), one per sponsor. <C>sponsor</C> takes at least 0.01 NEAR, and a new grant also sets aside the storage of the <C>Unsponsor</C> entry its sponsor may write later. <C>unsponsor</C> returns only the caller&rsquo;s own unspent grant, once 5,760 generations (a day) of wall-clock time have passed since that sponsor last gave or the account last drew on that grant; nobody else&rsquo;s deposit restarts it. An account spends the credit it won first, then its grants oldest first, and a grant spent to nothing frees its place. The reclaim transfer has a callback: if it fails, the NEAR becomes pending for the sponsor. Every sponsorship and reclaim is a ledger entry.
      </>
    ),
    tests: ["sponsor_hijack_takes_nothing_but_its_own_and_the_real_sponsor_still_reclaims", "credit_is_spent_won_first_then_the_oldest_sponsorship", "an_account_takes_credit_from_at_most_eight_sponsors", "a_failed_reclaim_is_pending_for_the_sponsor", "a_sponsor_takes_back_credit_left_unused"],
    limit: "Someone could fill an account's free grant places with 0.01 NEAR sponsorships so that a ninth sponsor is refused; it costs them that NEAR, which becomes the account's credit, the sponsors already there can still top up, and a place frees once its grant is spent or reclaimed.",
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
        In the simulator (v5 rules) a SplitWhale (one whale over 10 or 20 colonies) lost 1.14 to 2.39 NEAR in a week, more than the same whale in one colony at 1,500 players. See <Doc to="simulations" hash="cash">Cash per player</Doc>.
      </>
    ),
  },
  {
    id: "t-lock",
    title: "Carpet-locking the dish",
    threat: "Cover the agar with a lattice of cheap blocks so every empty cell is inside someone's buffer, and newcomers either cannot plant or pay a fortune.",
    defense: (
      <>
        A planting inside a rival&rsquo;s buffer is never refused, only priced at 3 times, and a slide&rsquo;s licence does not waive that surcharge. Stake decays to 87.5% at every tide, so a lattice earns only while its owner keeps paying to plant. House cells never make a siege, so the strains cannot lock anyone out.
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
        The pot goes only to the account whose call stepped at least one generation, which is exactly the work it pays for (any of <C>plant</C>, <C>buy</C>, <C>join</C> (only one that attaches at least 0.01 NEAR itself runs the clock), <C>sell</C>, <C>claim</C>, <C>advance</C>, <C>mint_slide</C>, or a wNEAR order settled for an account), only if that account can hold PETRI, and never to one of the dish&rsquo;s own accounts (a house strain or a keeper). Anyone may make such a call, so the pot is a race, and racing costs gas. Before v6.1 only <C>advance</C> paid it, and it could pile up for days when nobody advanced: 1,480 PETRI stood in it after a week on a young simulated dish.
      </>
    ),
    tests: ["the_keeper_pot_goes_to_whoever_advances_the_clock", "any_call_that_runs_a_generation_takes_the_keeper_pot", "a_keeper_takes_no_keeper_pot"],
    limit: "In the v5 simulator a Racer that only advances for the pot and bounties lost 0.05 to 0.06 NEAR a week; in the v6.1 simulator, where players' calls take the pot too, it loses 0.0055 and the pot left after a week is 1.3 PETRI (1.1 on a young dish).",
  },
  {
    id: "t-house",
    title: "The house draining the vault",
    threat: (
      <>
        Found in review before v6. The house strains buy almost all the PETRI held outside the agar on a young dish, with NEAR that goes to the players. In v5 a house colony could sell that PETRI back into the vault, hand it to an outside account to sell, or keep the tide bounties and keeper pot its keeper earned: the operators could take back the players&rsquo; NEAR.
      </>
    ),
    defense: (
      <>
        The dish&rsquo;s own accounts are named in the rules: <C>house</C> (the strains) and <C>keepers</C> (<C>keeper.petri-dish.near</C>, <C>petri-keeper.testnet</C>). A house colony cannot <C>sell</C> (&ldquo;the dish&rsquo;s own colonies never sell PETRI back: the vault is the players&rsquo;&rdquo;). House accounts can <C>ft_transfer</C> or <C>ft_transfer_call</C> PETRI only to other house accounts, so nothing reaches a player who could sell it; the strains&rsquo; pacts with each other are the one way house PETRI moves, and a house colony&rsquo;s pact with a player carries no PETRI. A tide run by a house colony or a keeper pays no bounty: it stays in the vault (a keeper with no colony is <C>by</C> 65535 in the Tide entry). House accounts never take the keeper pot, plant only slides they hold (so they never pay a player a royalty), and a wNEAR payment cannot start a colony for one of them.
      </>
    ),
    tests: ["house_sell_drain_is_refused", "house_petri_cannot_reach_a_player_to_sell", "house_strains_still_pay_each_other", "house_bounties_stay_in_the_vault", "a_keeper_takes_no_keeper_pot", "the_house_pays_no_royalty_to_players", "a_payment_for_the_house_waits_for_the_house", "the_house_plays_but_takes_no_tide"],
    limit: "The lists are fixed at launch. An account the operators control that is not on them is an ordinary player: it pays and earns like anyone, and could sell what it earned.",
  },
  {
    id: "t-snipe",
    title: "Sniping tides",
    threat: "Plant just before a tide and take a share of the vault that others paid in all hour.",
    defense: (
      <>
        A tide splits by what each colony earned from the feed since the last tide, so arriving late earns a late share. The caller&rsquo;s bounty is 1% of the vault&rsquo;s share, at most 0.001 NEAR, and none when the caller is a house colony or a keeper. A tide with nobody to pay does not run at all.
      </>
    ),
    tests: ["tides_pay_by_what_was_earned_since_the_last_tide", "tides_follow_the_window_and_skip_the_house (core)", "a_tide_is_due_only_when_someone_outside_the_house_earned (core)", "an_idle_dish_runs_no_tides_and_keeps_its_vault"],
    limit: "In the simulator a Sniper that plants in the three generations before each tide and sells after lost 0.06 to 0.08 NEAR a week.",
  },
  {
    id: "t-storage",
    title: "Storage griefing",
    threat: "Make the contract pay for data: long notes, many records, tides with no winners, empty pending records, slides passed around to long account names, failed payouts.",
    defense: (
      <>
        Every move pays the storage of what it writes, measured after the write: plantings by <C>plant_deposit</C> (with room for a first hot-table row and, under a licence, the holder&rsquo;s PETRI registration), slides by <C>slide_deposit</C> with a reserve for later owners, approvals by their granter, sponsorships by their sponsor (with the later <C>Unsponsor</C> entry set aside), pending records from the amount they hold (an amount too small to pay for them is refunded and writes nothing), what <C>rename</C> and <C>set_payout</C> add from the attached NEAR, sale and claim records from the proceeds, tide records from the vault. A NEAR sale or claim must also cover the records a refund would need, so a failed payout pays for its own <C>Refund</C> entry; NEAR winnings too small for that stay owed until they grow. A forced unregistration pays its <C>Burn</C> entry from its refund. Idle tides write nothing. A dish nobody touches for two hours writes one Skip entry instead of hours of catch-up.
      </>
    ),
    tests: ["the_planting_deposit_covers_its_storage_without_overcharging", "a_slide_pays_for_its_storage", "an_approval_pays_for_its_storage", "transfers_never_outgrow_the_storage_a_slide_paid_for", "winnings_too_small_for_a_claims_records_wait", "dust_wnear_is_refunded", "an_idle_dish_runs_no_tides_and_keeps_its_vault", "an_untended_dish_skips_ahead_instead_of_piling_up_work"],
    limit: "Skip entries and the board's growth during a catch-up are paid by the contract's own surplus. In the simulator's empty 30-day dish, skipping idle tides took the contract's own storage bill from 1.95 NEAR to zero.",
  },
  {
    id: "t-injection",
    title: "Prompt injection into the AI strains",
    threat: "A player writes a colony name or a lab note that reads as an instruction to the model playing a house strain.",
    defense: (
      <>
        No player-written text reaches a model, at a move or at the council. The prompts name outside colonies only as <C>colony 7 with 72 cells</C>; the strains&rsquo; own names and the terms of their pacts are written by the agents&rsquo; code. Names are plain ASCII from a short list of characters, and notes and titles refuse control, direction, invisible and tag characters, so nothing can hide in them. The model only chooses a number from a list of plantings the rules already accept (checked with petri-core), and its answer is rejected if the number is out of range; a council offer is checked against the deals the contract can hold anyone to (a pact has a fixed radius and length) before anyone answers it. Its own note on a planting is cleaned of links, account names and anything outside plain Latin text before it is stored; council pitches and replies come only from the house strains’ own models and are cut to one short sentence. The house never lays siege.
      </>
    ),
    tests: ["names_cannot_hide_characters", "names_cannot_use_look_alike_letters", "notes_cannot_carry_invisible_text"],
    limit: "The agents are JavaScript with no automated tests; the tests named cover the contract's text rules. A model can still choose badly; it can never choose an illegal move, a pact is refused by the contract unless it keeps to the rules, and a council payment can only go to another house strain.",
  },
  {
    id: "t-guest",
    title: "Guests leaking NEAR",
    threat: "Turn free testnet play, or self-sponsored accounts on any network, into NEAR someone can withdraw.",
    defense: (
      <>
        A colony that has not attached NEAR is paid every tide share, sale and bounty as won credit, which is spendable only in the dish and which no sponsor can take back. A colony attaches NEAR only when one join, buy or planting puts at least <C>min_join</C> (0.01 NEAR), net of storage, into the vault, so a yoctoNEAR on a call paid from credit changes nothing (<C>one_yocto_does_not_turn_credit_into_near</C>). Only a colony that attached NEAR may set a payout account, and never to the dish itself. A guest&rsquo;s function-call key cannot attach or transfer NEAR or PETRI. Sponsored credit goes to the credit pool, which pays only credit, and a sponsor can take back only its own unspent grant.
      </>
    ),
    tests: ["a_guest_wins_credit_where_a_wallet_wins_near", "a_guest_cannot_send_winnings_to_a_wallet", "a_guest_sale_pays_credit", "a_guest_that_runs_a_tide_is_paid_its_bounty_as_credit", "one_yocto_does_not_turn_credit_into_near", "sponsored_credit_pays_for_joining_and_planting_and_cannot_leave"],
    limit: "A SelfSponsor (one operator sponsoring 10 of its own full-access accounts) lost 0.33 to 0.47 NEAR a week in the simulator: the only NEAR it gets back is its own unused sponsorship.",
  },
  {
    id: "t-kept",
    title: "Free play farmed into vault NEAR",
    threat: (
      <>
        Found by the v6 simulator. A guest earns PETRI for free. Before v6.1 an operator could turn it into vault NEAR in two ways: its guests <C>ft_transfer</C> their PETRI to one wallet that sells it back to the agar, or each guest attaches a little NEAR (which makes it no longer a guest) and sells what it had farmed. The fifth review round found two more holes in v6.1: a single yoctoNEAR on a credit-paid call counted as attaching NEAR, and a colony holding kept PETRI was still paid its tide shares and claims in NEAR.
      </>
    ),
    defense: (
      <>
        PETRI earned before a colony&rsquo;s first NEAR is <strong>kept</strong>. A colony that has never attached NEAR cannot <C>ft_transfer</C> or <C>ft_transfer_call</C> PETRI at all. Every colony has a <C>kept</C> amount: a guest&rsquo;s claims, purchases (all credit) and royalties received; its unclaimed earnings when it first attaches NEAR; and PETRI anyone buys with credit (<C>credit_share</C>). Plantings and slides spend it first. While a colony holds any, it cannot sell for NEAR, send PETRI or pay into a pact. Guests take no keeper pot. While a colony holds any kept PETRI it is also paid in credit, not NEAR: its tide share and bounty are credit, and <C>claim</C> pays out only PETRI while its NEAR stays owed. A royalty from a guest, or from a planter whose kept PETRI is more than the planting costs, goes to the agar. Transfers are not ledger entries (an entry would let anyone grow the contract&rsquo;s storage at 1 yoctoNEAR a call), so the replays argue it from three facts: no transfer changes <C>kept</C>; every colony&rsquo;s <C>kept</C> is rebuilt from the ledger alone and must equal the colony view; and the contract refuses every transfer by a guest or by a colony with kept above zero. A sale for NEAR, a claim, or a PETRI pact, by a colony whose replayed <C>kept</C> is above zero fails the <C>kept</C> check in both replays.
      </>
    ),
    tests: ["guest_cannot_transfer_free_petri", "guest_that_attaches_cannot_sell_what_it_farmed", "attached_player_sells_what_it_earned_after", "kept_petri_can_still_be_planted", "petri_bought_with_credit_is_kept", "sybil_guests_that_attach_reach_no_vault_near", "a_guest_cannot_send_winnings_to_a_wallet", "kept_petri_is_paid_in_credit_and_claims_no_near", "kept_petri_pays_its_royalty_to_the_agar"],
    limit: (
      <>
        In the simulator (testnet, 150 players plus 3 operators of each attack, 7 days, 6 seeds) the transfer attack moved 476.9 PETRI and drew +0.0470 NEAR a week per operator from the vault without the rule and 0 with it; the attach-and-sell attack drew +0.0008 without it and 0 with it (82 sales refused per operator). Across every colony in the run, vault NEAR paid for farmed PETRI went from 0.1674 to 0. The cost to honest players is that a former guest plants its kept PETRI before it can sell any. Every sybil operator loses with the rule (SybilAttach −0.0550, SybilTransfer −0.0417 a week); without it SybilTransfer made −0.0030 at the median and +0.0138 in its best seed. See <Doc to="economy" hash="kept">Kept PETRI</Doc>.
      </>
    ),
  },
  {
    id: "t-pacts",
    title: "Breaking, forging or farming pacts",
    threat: (
      <>
        A pact is PETRI in escrow for a promise not to plant near. Ways to cheat: plant near the payer anyway; take the PETRI and leave; offer a pact to move house PETRI to a player or free-play PETRI to a seller; fill the dish with pacts to grow its storage, or fill another colony&rsquo;s pact slots with offers nobody asked for; end a pact early.
      </>
    ),
    defense: (
      <>
        The contract refuses a bound colony&rsquo;s planting within <C>pact_radius</C> (8) cells of the payer&rsquo;s living cells until <C>until</C>, so the promise needs no trust, and nobody can end an accepted pact early. The PETRI is in the dish&rsquo;s escrow (<C>pact_escrow</C>, part of the dish&rsquo;s own holding) until the promisor accepts, and goes back to the payer if the offer is withdrawn, declined or expires, so a promisor gets paid only by accepting what binds it. Every offer carries at least 1 PETRI, except between two house colonies, so guests, colonies holding kept PETRI and the house towards players cannot offer a pact, and a pact cannot carry farmed PETRI to a seller. Each colony is party to at most 8 pacts, counting only accepted pacts and the offers it made, so offers sent to it cannot fill its slots; offers waiting for a colony have their own cap of 16, which it empties by declining. There is one open offer per pair, and each offer pays for its own storage plus a reserve for its accept and end entries. Every pact is a ledger entry (<C>PactOffer</C>, <C>PactAccept</C>, <C>PactEnd</C>); both replays rebuild them and check the rules, the escrow, and every planting against the pacts binding its planter.
      </>
    ),
    tests: ["pact_refuses_breaking_planting", "pact_expires_and_planting_is_allowed", "unaccepted_offer_refunds", "kept_petri_cannot_pay_a_pact", "house_pact_stays_in_house", "a_colony_is_party_to_at_most_eight_pacts", "offers_cannot_jam_a_colonys_pacts", "pacts_gas_at_scale"],
    limit: "A pact covers a radius, not a promise of peace: a promisor can still aim a glider at the payer from beyond 8 cells. The agents score that as broken faith and show it to the next council; the contract cannot stop it. The protected ground is the payer&rsquo;s living cells as the board stands at each planting, including cells it plants after the pact was accepted: a promise to stay away from a colony, not from a place. With 30,000 colonies a newcomer bound by 8 pacts planting 64 cells costs 22.3 TGas, against 20.5 unbound. In the simulator a pact at a naive price (2 PETRI a tide window to the nearest raider) did not pay the builder (cash −0.2223 against −0.1865).",
  },
  {
    id: "t-gas",
    title: "Gas that grows with every colony",
    threat: (
      <>
        Found in review before v6. With enough colonies, a call could need more gas than one transaction can buy, and every later call would fail: the dish would halt. v5 kept each colony&rsquo;s numbers in seven packed arrays covering every colony that ever joined: a join rewrote all seven, every catch-up rewrote three, and every tide read four and looped over every colony. It would have halted at about 27,000 colonies.
      </>
    ),
    defense: (
      <>
        v6 split each colony&rsquo;s numbers between cold pages and a hot table; v6.1 keeps them in exactly one of two places and bounds the table. Cold pages hold 32 colonies a key, 69 bytes a colony, with its stake decayed lazily; a join appends one slot to the last page, so it costs the same however many colonies came before. The hot table holds only the colonies that play now, in a feed part and a purse part: those that earned since the last tide, and those with living cells and a stake that can still earn (never the house). A colony enters it when it plants; up to 32 rows a call that have no window and no living cell or too little stake move back to their cold slots. v6 kept every colony with stake, which lingers about a day, and a simulated busy dish of 30,000 colonies had up to 27,538 rows and a planting that cost 237 TGas; v6.1 averaged 1,336 rows and the largest call was 61 TGas. The table holds at most 10,000 rows: a colony with no row that plants while it is full waits for the next tide, so no number of colonies can push a call past its gas, where about 35,000 colonies earning within one tide window could have halted v6 for good. The feed, the tides and the decay read and write only the hot table, once per call. Living cells are counted sparsely, so a generation costs what the living cost. A catch-up stops at 110 TGas, or the prepaid gas less 40, less what is still to write (the feed part of the table, the purse part only if a tide falls in the window, and the idle rows' pages), and the next call carries on. The site prepays 300 TGas. Views that read many colonies are paged: <C>earnings</C> and <C>tide_winnings</C> at most 500 a call, <C>stakes</C> 2,000.
      </>
    ),
    tests: ["thirty_thousand_colonies_with_stake_every_call_under_150_tgas_on_the_real_network", "a_full_hot_table_keeps_every_call_under_150_tgas_on_the_real_network", "the_catch_up_reserves_only_what_the_rest_of_the_call_needs", "a_full_hot_table_waits_for_the_tide_and_makes_room_when_rows_can_leave", "a_tide_with_fifteen_hundred_winners_stays_well_under_the_gas_limit", "a_colony_whose_stake_is_gone_leaves_the_hot_table_with_its_numbers", "a_colony_without_living_cells_leaves_the_hot_table_and_keeps_its_stake", "a_colony_whose_stake_cannot_earn_leaves_the_hot_table_while_it_lives", "many_living_colonies_advance_with_one_summary_log", "sparse_stepping_matches_full_stepping (core)", "sparse_tides_and_feeds_match_the_dense_ones (core)", "catch_up_is_capped_and_plant_waits_for_the_clock"],
    limit: (
      <>
        The unit runtime charges host calls (storage, logs, promises), not wasm execution or the real price per rewritten byte, so the contract&rsquo;s own gas tests scale its host calls by that price (×1.83, measured in the test) and add an estimate of the wasm. On 30,000 colonies that all have stake, with 1,500 playing, the largest call is 67.5 TGas (advance through a paying tide; a planting 20.4, a claim with NEAR 47.7); with a full table, 9,999 playing, 125.7 (advance through a tide; claim with NEAR 115.6, planting 88.3); the tests assert every call stays under 150 TGas. The analytic worst case, 10,000 rows all paid at a tide, is 120 TGas for the tide, 105 for a claim with NEAR and 77 for a planting. Every NEAR payout figure includes about 30 TGas for the transfer and its callback. A tide with 1,500 winners is asserted at under 20 TGas of host calls; in v5 it was about 11 TGas with the arrays.
      </>
    ),
  },
  {
    id: "t-intents",
    title: "Wrong tokens and forged intents",
    threat: "Call ft_on_transfer directly claiming wNEAR that never arrived, send another token, forge a callback, or get one payment spent twice.",
    defense: (
      <>
        <C>ft_on_transfer</C> acts only when its caller is <C>rules.wnear</C>; any other token is returned whole and recorded nowhere. The unwrap and settle callbacks are private and check their caller again. A settle runs only the stored order, with only the NEAR that came with it, and one that finds nothing pending (claimed meanwhile) fails without changing anything. On the site, no deposit address is shown unless 1Click echoed <C>petri-dish.near</C> as recipient and <C>nep141:wrap.near</C> as the asset.
      </>
    ),
    tests: ["other_tokens_are_refunded_and_forged_calls_do_nothing", "nobody_else_can_call_the_unwrap_callback", "nobody_else_can_settle_an_order_from_the_callback", "an_order_claimed_before_it_settles_is_not_spent_twice", "a_settle_spends_only_the_orders_near", "a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped"],
    limit: "A message that names no valid account leaves the NEAR pending for the transfer's sender, which for 1Click is the intents contract; the site always names one.",
  },
  {
    id: "t-intent-refund",
    title: "A payment below the minimum, refunded into the void",
    threat: (
      <>
        Found in review before v6. v5 refunded wNEAR under 0.01 NEAR. Through 1Click the sender is the intents contract, not the player, so a quote that delivered a little less than expected was refunded to the intents contract and lost to its payer.
      </>
    ),
    defense: (
      <>
        wNEAR that pays for its own records is never refunded: it becomes pending NEAR for the account the message names (or the sender), less its record and its <C>Pending</C> entry. An amount no larger than what those two records can cost is refunded whole and writes nothing, so dust cannot grow the dish&rsquo;s storage; v6.1 put it in the vault with a <C>Dust</C> entry. The view <C>intent_minimum(what, account_id)</C> says what a payment must deliver for its order to run, and <C>/api/intents/quote</C> refuses any quote, dry or real, whose guaranteed output is below it.
      </>
    ),
    tests: ["an_intent_below_the_minimum_is_kept_for_its_account_not_refunded", "dust_wnear_is_refunded", "the_dish_tells_1click_the_least_a_payment_needs"],
    limit: "The quote route's check is server code with no automated test. A join delivered at exactly the least intent_minimum asks for nets under min_join after the join's own storage, so it does not attach NEAR: that colony is a guest until it buys 0.01 NEAR net.",
  },
  {
    id: "t-names",
    title: "Colonies under someone else's name",
    threat: (
      <>
        Found in review before v6. Anyone can pay wNEAR for any account. In v5 the payer also chose the colony&rsquo;s name and colour, so anyone could put their own words under someone else&rsquo;s account on the dish.
      </>
    ),
    defense: (
      <>
        The message&rsquo;s name and colour are used only when the transfer&rsquo;s <C>sender_id</C> is the account itself. The signer is not trusted, since a victim can be made to sign a call that relays wNEAR. Any other payment starts a <C>proxy</C> colony named <C>Culture</C> and the first 4 (then 6, … 16) hex digits of <C>sha256(account)</C>, in a colour from the same hash, and its account may <C>rename</C> it once. <C>join</C> and <C>rename</C> refuse names of the form <C>Culture &lt;hex&gt;</C>, so nobody can take an account&rsquo;s neutral name first.
      </>
    ),
    tests: ["a_proxy_join_gets_a_neutral_name_and_never_the_payers_text", "an_account_paying_for_itself_keeps_its_name", "neutral_names_cannot_be_taken_first", "a_colony_renames_once_and_only_if_someone_else_started_it", "a_colony_that_joined_itself_cannot_rename"],
    limit: "Anyone can still start a colony for any account with their own money; the account cannot refuse it, only rename it.",
  },
  {
    id: "t-settle",
    title: "A payment stuck as pending",
    threat: (
      <>
        Found in review before v6. When a payment arrived with too little gas for its join or purchase, v5 kept the NEAR pending with no public way to complete the order: only the account could claim it back.
      </>
    ),
    defense: (
      <>
        The order is stored with the pending NEAR (<C>order_near</C> is the part it may spend; NEAR that waits for other reasons, such as a failed payout, is never spent by an order). <C>settle_pending(account_id)</C> lets anyone run it later: it checks first and changes nothing if the order cannot run. The gas thresholds were cut to what the steps need: <C>near_withdraw</C> 5 TGas, the settle receipt 30 TGas, and the unwrap starts with 35 TGas left. <C>pending_record</C> shows the order; <C>claim_pending</C> takes everything and clears it.
      </>
    ),
    tests: ["an_order_without_gas_waits_and_anyone_can_settle_it", "a_settle_spends_only_the_orders_near", "an_unusable_order_waits_as_pending_near_and_is_claimed"],
    limit: "Nobody is obliged to call settle_pending. The site's relay allows it for guests, but the keeper agent does not call it today; it only unwraps waiting wNEAR.",
  },
  {
    id: "t-counters",
    title: "A verifier that trusts the contract's own counters",
    threat: (
      <>
        Found in review before v6. The solvency check in v5&rsquo;s replays took several terms (credit given, spent and reclaimed, NEAR owed, pending NEAR) from the contract&rsquo;s own counters, refunds were not tied to the payouts they refunded, and sponsorships and claims were not in the ledger. A bug in a counter would have passed unseen.
      </>
    ),
    defense: (
      <>
        The ledger now has an entry for every movement: <C>Sponsor</C>, <C>Unsponsor</C>, <C>Claim</C>, <C>Pending</C>, <C>Unpend</C>, <C>Dust</C> (written by v6.1, none since v6.2) and <C>Burn</C>; a <C>Refund</C> names the kind and the index (<C>of</C>) of the payout it refunds, and purchases, plantings and slides carry the credit they took (<C>spent</C>). Both replays, <C>scripts/verify.mjs</C> and the browser&rsquo;s <C>/verify</C>, recompute every solvency term from the ledger alone (the vault, the credit pool, credit given, won, sold, spent and reclaimed, NEAR owed and pending), compare each with the contract&rsquo;s counter, and check each refund against the payout it names, once.
      </>
    ),
    tests: ["replaying_the_ledger_reproduces_the_dish_the_agar_and_the_vault"],
    limit: (
      <>
        That test replays the ledger in Rust; with <C>PETRI_DUMP=&lt;file&gt;</C> it writes a snapshot that <C>node scripts/verify.mjs --dump &lt;file&gt;</C> replays too. The replays still trust their RPC: see <Doc to="verification" hash="limits">What verification does not prove</Doc>.
      </>
    ),
  },
  {
    id: "t-payouts",
    title: "Failed payouts and token edge cases",
    threat: (
      <>
        Found in review before v6. A NEAR transfer to a deleted or broken account fails. In v5 a failed sale went back to the vault, so the seller lost it, and a sponsor&rsquo;s reclaim had no callback at all. The token standards&rsquo; edge cases were loose too: PETRI refunded to a sender that had unregistered meanwhile, a forced unregistration, and enumeration views drawing up to 50 SVG images in one call.
      </>
    ),
    defense: (
      <>
        A failed sale, claim, reclaim or pending claim becomes pending NEAR for the account it was for, which it can claim again; only a failed bounty goes back to the vault. The refund&rsquo;s records are paid from the NEAR that came back. <C>set_payout</C> refuses the dish itself. <C>ft_resolve_transfer</C> burns a refund whose sender has unregistered (a <C>Burn</C> entry), as near-contract-standards does. <C>storage_unregister(force: true)</C> burns the balance and closes the registration; a colony&rsquo;s account cannot unregister, forced or not, since its colony is paid into it. <C>nft_tokens</C> and <C>nft_tokens_for_owner</C> return at most 10 tokens a call.
      </>
    ),
    tests: ["a_failed_sale_payout_is_pending_for_the_seller", "a_failed_claim_is_pending_for_the_colony", "a_failed_reclaim_is_pending_for_the_sponsor", "a_failed_bounty_goes_back_to_the_vault", "payouts_cannot_be_sent_into_the_dish", "a_refund_to_an_unregistered_sender_is_burned", "a_forced_unregistration_burns_the_balance", "a_colony_cannot_force_unregister", "nft_enumeration_draws_at_most_ten_images_a_call"],
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
    id: "t-licence",
    title: "Abusing a slide's licence",
    threat: (
      <>
        Found in review before v6: owning a slide changed nothing. v6 makes a slide a pattern licence, which opens new ways to cheat: plant some other shape at the licence&rsquo;s price, use a licence to make a rival&rsquo;s ground cheap, or pay the royalty to the wrong holder. The v6 simulator found two more: mint slides of the small common patterns at launch and collect 10% of everyone&rsquo;s planting of them, and plant under a licence from free play so that a royalty lands in a wallet that can sell the PETRI.
      </>
    ),
    defense: (
      <>
        A planting under a licence needs a slide that captured at least <C>licence_min_cells</C> (12) cells, so blocks, blinkers, beehives, loaves, gliders, lightweight spaceships and small oscillators cannot be licensed. The planting must be exactly the slide&rsquo;s pattern, moved anywhere (wrapping) but not turned (<C>petri_core::fits_slide</C>); it costs <C>slide_discount_bps</C> (25%) less, the same for everyone. The siege surcharge still applies in full, so a licence never makes a rival&rsquo;s ground cheap to take. A planter that does not hold the slide pays its current holder <C>slide_royalty_bps</C> (10%) of the discounted cost in PETRI, unless it has not attached NEAR or holds more kept PETRI than the planting costs: then the whole royalty goes to the agar and the holder gets nothing. Each Plant entry records the slide, its move count, the holder, the royalty and <C>to_agar</C>, and both replays check the shape, the 12-cell minimum, the price and royalty, that the holder is the minter until the slide&rsquo;s first move and one account between moves, and each slide&rsquo;s final owner, moves and royalties against the <C>slides</C> view.
      </>
    ),
    tests: ["the_holder_plants_its_slide_at_the_licence_discount", "a_stranger_plants_a_slide_and_pays_its_holder_a_royalty", "a_small_slide_is_a_keepsake_not_a_licence", "a_guest_pays_its_royalty_to_the_agar", "a_planting_of_another_shape_is_not_licensed", "a_turned_slide_is_not_licensed", "after_a_transfer_royalties_go_to_the_new_holder", "the_house_pays_no_royalty_to_players", "a_slide_licence_is_the_same_shape_anywhere (core)"],
    limit: "Moves are not logged in the ledger (a transfer carries one yoctoNEAR, too little to pay for an entry), so the replays check that holders are consistent with the move counts, not who held a slide between two moves; the NEP-171 transfer events show that. A farmer who mints the first slide of a large pattern others plant (the pulsar, 48 cells, or the Gosper gun, 36) still collects 10% of those plantings: +0.11 NEAR a week at 150 players in the v6.1 simulator, down from +0.29. That is by design: planters choose the licence and still save (whales −1.97 with the farmer, −2.01 without one), and the vault's totals hardly move with the royalty.",
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
  {
    id: "t-relaunch",
    title: "Restarting a dish that players use",
    threat: "The contract has a method that deletes a dish's state and starts over. Used on a running dish, it would wipe the players' colonies, PETRI and NEAR owed.",
    defense: (
      <>
        <C>relaunch(rules, accounts)</C> is <C>#[private]</C> and <C>#[init(ignore_state)]</C>: only a transaction from the contract account itself, signed with its full-access key, can run it. It clears only what v6.1 stored, refuses an account with no v6.1 dish (&ldquo;no v6.1 dish here&rdquo;) and one that already runs v6.2 (&ldquo;this account already runs v6.2&rdquo;), and logs any pending NEAR v6.1 still owed. It was used to start <C>petri-dish.near</C> from generation 0 when v6 was deployed there, and again on both dishes when v6.1 and v6.2 were.
      </>
    ),
    tests: ["relaunch_leaves_nothing_of_v6_1", "relaunch_refuses_an_account_without_a_v6_1_dish", "relaunch_refuses_a_dish_that_runs_v6_2"],
    limit: "The team keeps one full-access key on each contract account on purpose, so its holder can deploy new code and run relaunch to fix a bug. That restarts the dish from generation 0 with a fresh ledger, and new code changes the code hash that verify compares.",
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
        <li>
          The rules are fixed for a dish&rsquo;s life: there is no admin method, no parameter setter, no mint, no code-deploy method. The one privileged method, <C>relaunch</C>, can only be run by the contract account itself and refuses a dish that already runs v6.2 (<a href="#t-relaunch">below</a>).
        </li>
        <li>Every NEAR and PETRI movement is in the ledger, and the replay recomputes every solvency term from it.</li>
        <li>Every record is paid for by whoever writes it.</li>
        <li>The house is never fed, takes no tide share, bounty or keeper pot, never sells, and never hands PETRI to a player, so the operators cannot profit from their own players.</li>
      </ul>
      <Callout kind="note">
        <p>
          Each contract account has one full-access key, held by the team on purpose, so a bug can be fixed with new code plus <C>relaunch</C>. No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board, and new code changes the code hash, which <C>node scripts/verify.mjs</C> compares with the published build on every run. It is reported as a disclosed note. <Doc to="verification" hash="keys">Check it</Doc>.
        </p>
      </Callout>

      <H2 id="threats">Threats and defenses</H2>
      <p>
        Test names are the functions in <C>contract/src/tests.rs</C>, or <C>core/src/tests.rs</C> where marked core. Simulator figures are from <C>sim/out-v5</C>, which ran the v5 rules, unless a threat names v6 or v6.1: <C>sim/out-v6.1</C> re-ran v6.1 against v6 on the same seeds. Threats marked &ldquo;found in review before v6&rdquo; were reported against v5 and are fixed in the code both dishes run now.
      </p>
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
          <strong>The team holds a full-access key.</strong> Each contract account has one, on purpose: it exists only so a bug can be fixed with new code plus <C>relaunch</C>, which starts the dish again from generation 0 with a fresh ledger. It cannot change anything quietly, because new code changes the code hash that the verifier checks. Deleting it would make the dish unfixable.
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
          <strong>Relayed gas is capped at 300 TGas.</strong> A guest call that needs more is refused by the relay.
        </li>
        <li>
          <strong>Replays trust their RPC.</strong> See <Doc to="verification" hash="limits">What verification does not prove</Doc>.
        </li>
        <li>
          <strong>Model choices are not on chain.</strong> Which model chose a strain&rsquo;s move, the forecasts it saw, and the NEAR AI Cloud signature when there is one, are in the agents&rsquo; log, not the ledger. The pacts the council makes are on chain and enforced by the contract (within their radius); what the models said to each other, and the faith scored beyond the radius, are in the agents&rsquo; log.
        </li>
      </ul>

      <H2 id="tests">Running the tests that cover these</H2>
      <Code lang="sh" title="Shell, from the repository root">{`# everything: 139 contract tests and 36 core tests
cargo test -p petri-core -p petri-contract

# one threat at a time
cargo test -p petri-contract sponsor
cargo test -p petri-contract house
cargo test -p petri-contract guest
cargo test -p petri-contract slide
cargo test -p petri-contract wnear
cargo test -p petri-contract thirty_thousand -- --nocapture
cargo test -p petri-contract a_tide_with_fifteen_hundred_winners -- --nocapture
cargo test -p petri-core splitting_never_earns_more`}</Code>
      <p>
        The 1,500-winner test prints the gas it measured with <C>--nocapture</C>. Most contract tests end with a conservation check: every PETRI and every yoctoNEAR is accounted for, every bounty was paid or refunded, and the contract is solvent.
      </p>
    </DocPage>
  );
}
