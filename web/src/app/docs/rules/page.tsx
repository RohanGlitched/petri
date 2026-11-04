import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Formula, H2, H3, Table } from "@/components/docs/ui";

export const metadata = docMetadata("rules");

type Row = [key: string, value: string, plain: string, meaning: React.ReactNode];

const PARAMS: Row[] = [
  ["width", "128", "128 cells", "Width of the dish. It wraps."],
  ["height", "128", "128 cells", "Height of the dish. 16,384 cells in all."],
  ["generation_ms", "\"15000\"", "15 s", "Wall-clock time per generation: 5,760 a day."],
  ["max_supply", "\"1000000000000\"", "1,000,000 PETRI", "Every PETRI that will ever exist, minted once into the agar at launch."],
  ["feed_ppm", "3", "3 ppm", "Share of the agar released to the living each generation."],
  ["keeper_bps", "200", "2%", "Share of each generation's feed set aside in the keeper pot, paid to whoever advances the clock (never a house account)."],
  ["reach", "8", "8 cells", "A colony is paid for at most this many living cells per cell of stake."],
  ["stake_keep_bps", "8750", "87.5%", "Share of each colony's stake left after every tide."],
  ["burn_bps", "5000", "50%", "Share of a planting's cost that is burned; the rest returns to the agar."],
  ["payback", "480", "480 generations (2 h)", "A cell costs what an average counted cell earns in this many generations."],
  ["min_cell_price", "\"500000\"", "0.5 PETRI", "The lowest price of one cell."],
  ["live_floor", "1000", "1,000 cells", "The feed is released, and prices are set, as if at least this many cells were counted."],
  ["petri_price", "\"200000000000000000000\"", "0.0002 NEAR", "Launch price of one PETRI. The agar sells at petri_price × max_supply ÷ agar."],
  ["min_join", "\"10000000000000000000000\"", "0.01 NEAR", "The least NEAR a colony brings when it joins."],
  ["cell_fee", "\"100000000000000000000\"", "0.0001 NEAR", "NEAR per planted cell on top of the planting's storage. It goes to the vault or the credit pool."],
  ["tide_every", "240", "240 generations (1 h)", "Generations between tides."],
  ["tide_bps", "500", "5%", "Share of the vault and of the credit pool paid out at each tide."],
  ["tide_bounty_bps", "100", "1%", "Share of each tide's vault payout paid to the caller who runs it, up to max_bounty. A house colony or keeper is paid none: it stays in the vault."],
  ["max_bounty", "\"1000000000000000000000\"", "0.001 NEAR", "The largest tide bounty."],
  ["sell_bps", "5000", "50%", "The agar buys PETRI back at this share of the curve's price."],
  ["sell_cap_bps", "1000", "10%", "Between two tides the agar buys back at most this share of the vault."],
  ["siege_x", "3", "×3", "A planting inside a rival's buffer costs this many times the price."],
  ["buffer", "3", "3 cells", "Radius of the square around each living cell that makes a planting a siege (7 × 7)."],
  ["max_plant_cells", "64", "64 cells", "Most cells in one planting."],
  ["max_catchup", "120", "120 generations", "Most generations one call steps."],
  ["max_lag", "480", "480 generations (2 h)", "When the stored dish is this far behind the clock, the clock skips ahead to max_catchup behind."],
  ["house", "5 accounts", "see below", "The dish's own players: never fed, no tide shares, never sell, pass PETRI only to other house accounts, and their cells never make a siege."],
  ["keepers", "1 account", "see below", "The dish's own keepers. Like the house, they take no tide bounty and no keeper pot, and pass PETRI only to house accounts."],
  ["slide_cells_price", "\"1000000\"", "1 PETRI", "Price of a specimen slide per living cell it captures, all burned."],
  ["slide_min_cells", "5", "5 cells", "A slide must capture at least this many of the colony's own cells."],
  ["slide_discount_bps", "2500", "25%", "A planting of a slide's exact pattern under its licence costs this share less."],
  ["slide_royalty_bps", "1000", "10%", "Anyone but the slide's holder pays the holder this share of a licensed planting's cost, in PETRI."],
  ["wnear", "see below", "", "The wNEAR contract whose ft_transfer_call joins or buys for the account its message names."],
];

export default function Page() {
  return (
    <DocPage
      slug="rules"
      source={[
        { label: "contract/launch-rules.json", path: "contract/launch-rules.json" },
        { label: "contract/launch-rules-mainnet.json", path: "contract/launch-rules-mainnet.json" },
        { label: "core/src/lib.rs", path: "core/src/lib.rs" },
      ]}
    >
      <Callout kind="check">
        <p>
          The rules are fixed when a dish launches (<C>new</C>, or <C>relaunch</C> on an account that ran v5) and no method changes them while it runs. <C>relaunch</C> is private, so only a transaction from the contract account&rsquo;s own full-access key can call it, and it refuses an account that already ran v6. Read the live values with the <C>rules</C> view, below.
        </p>
      </Callout>

      <H2 id="parameters">Parameters</H2>
      <p>
        The JSON column is exactly what <C>contract/launch-rules.json</C> holds and what the <C>rules</C> view returns: amounts of PETRI and NEAR are strings of base units, shares are basis points (<C>bps</C>, 10,000 = 100%) or parts per million (<C>ppm</C>).
      </p>
      <Code lang="sh" title="Read the live rules (curl and jq)">{`curl -s https://rpc.mainnet.fastnear.com -H 'content-type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "query",
  "params": { "request_type": "call_function", "finality": "final",
              "account_id": "petri-dish.near", "method_name": "rules", "args_base64": "e30=" }
}' | jq -r '.result.result | implode' | jq .`}</Code>
      <Table caption="Launch rules, identical on both networks except house, keepers and wnear">
        <thead>
          <tr>
            <th>Key</th>
            <th>JSON</th>
            <th>In words</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {PARAMS.map(([k, v, p, m]) => (
            <tr key={k}>
              <td>
                <C>{k}</C>
              </td>
              <td>
                <C>{v}</C>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>{p}</td>
              <td>{m}</td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="networks">Testnet and mainnet</H2>
      <p>The two rule files differ in three keys and nothing else.</p>
      <Table>
        <thead>
          <tr>
            <th>Key</th>
            <th>Mainnet (petri-dish.near)</th>
            <th>Testnet (petri-v6.testnet)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>house</C>
            </td>
            <td>
              <C>violet.petri-dish.near</C>, <C>safranin.petri-dish.near</C>, <C>methylene.petri-dish.near</C>, <C>malachite.petri-dish.near</C>, <C>congo.petri-dish.near</C>
            </td>
            <td>
              <C>petri-violet.testnet</C>, <C>petri-safranin.testnet</C>, <C>petri-methylene.testnet</C>, <C>petri-malachite.testnet</C>, <C>petri-congo.testnet</C>
            </td>
          </tr>
          <tr>
            <td>
              <C>keepers</C>
            </td>
            <td>
              <C>keeper.petri-dish.near</C>
            </td>
            <td>
              <C>petri-keeper.testnet</C>
            </td>
          </tr>
          <tr>
            <td>
              <C>wnear</C>
            </td>
            <td>
              <C>wrap.near</C>
            </td>
            <td>
              <C>wrap.testnet</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        What differs in practice is around the contract, not in it: guests, the relayer and the bench exist only on testnet, and NEAR Intents settles only on mainnet. The contract&rsquo;s unit tests load <C>launch-rules.json</C> itself (<C>the_tests_use_the_launched_economics</C>), changing only the board (32 × 32), the tide interval (8), the catch-up limits and the house and keeper accounts so they run quickly; every economic parameter is the launched one, and the test also checks the mainnet file&rsquo;s keepers and slide shares.
      </p>

      <H2 id="units">Units</H2>
      <Table>
        <thead>
          <tr>
            <th>Quantity</th>
            <th>Base unit</th>
            <th>One whole</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>PETRI</td>
            <td>unit (6 decimals, <C>ft_metadata().decimals = 6</C>)</td>
            <td>1 PETRI = 1,000,000 units</td>
          </tr>
          <tr>
            <td>NEAR, credit</td>
            <td>yoctoNEAR</td>
            <td>1 NEAR = 10<sup>24</sup> yoctoNEAR</td>
          </tr>
          <tr>
            <td>Stake</td>
            <td>thousandths of a planted cell (<C>STAKE_UNIT = 1000</C>)</td>
            <td>1 planted cell = 1,000</td>
          </tr>
          <tr>
            <td>Storage</td>
            <td>bytes, at NEAR&rsquo;s storage price of 10<sup>19</sup> yoctoNEAR per byte</td>
            <td>100,000 bytes = 1 NEAR</td>
          </tr>
          <tr>
            <td>Time</td>
            <td>generations</td>
            <td>
              <C>due_generation = (now_ms − epoch_ms) ÷ 15000</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <p>All arithmetic is integer, rounding down (<C>÷</C> below is floor division). Rounding dust stays where it was: in the agar for the feed, in the vault for a tide.</p>

      <H2 id="life">Life with owners</H2>
      <p>
        <C>Dish::step</C> applies B3/S23 to every cell at once, 64 cells at a time with a bit-sliced neighbour count, wrapping at every edge. Owners change only where a cell is born or dies:
      </p>
      <Formula>{`survive:  live and 2 or 3 live neighbours  -> keeps its owner
birth:    dead and exactly 3 live neighbours:
          owner = the colony owning at least two of the three parents
          (all three different -> no birth; counted as "contested")
death:    otherwise -> EMPTY (0)`}</Formula>
      <p>
        Every birth reads its parents from the board before any owner changes, so the order cells are visited in never matters. The property tests <C>step_matches_reference</C>, <C>two_colonies_play_exactly_like_life</C> and <C>wide_dishes_match_reference</C> check the fast step against a plain cell-by-cell implementation.
      </p>

      <H2 id="feed">The feed</H2>
      <p>
        Each generation, after the Life step, <C>feed_sparse</C> pays the living. With <C>live[c]</C> the colony&rsquo;s living cells and <C>stake[c]</C> its stake:
      </p>
      <Formula>{`w[c]    = min(live[c], stake[c] × reach ÷ 1000)        for every colony c outside the house with live[c] > 0
W       = Σ w[c]                                         ("counted"; nothing is paid if W = 0)
ration  = agar × feed_ppm ÷ 1,000,000
total   = ration                         if W ≥ live_floor
        = ration × W ÷ live_floor        if W < live_floor
keeper  = total × keeper_bps ÷ 10,000                    -> the keeper pot
pool    = total − keeper
share[c]= pool × w[c] ÷ W                                -> c's unclaimed earnings and its tide window
paid    = keeper + Σ share[c]                            leaves the agar (dust stays in it)`}</Formula>
      <p>
        At launch, with 1,000,000 PETRI in the agar and at least 1,000 cells counted, a generation releases 3 PETRI: 0.06 to the keeper pot and 2.94 to colonies. <C>state().counted</C> is the last <C>W</C>; prices are set against it.
      </p>

      <H2 id="weight">Weight, reach and stake</H2>
      <Formula>{`plant n cells:   stake[c] += n × 1000
after each tide: stake[c]  = stake[c] × stake_keep_bps ÷ 10,000      (every colony)
weight:          w[c]      = min(live[c], stake[c] × reach ÷ 1000)`}</Formula>
      <p>
        Because the cap is linear in stake, the capped weights of the parts of a split colony never sum to more than the capped weight of the whole. The core property test <C>splitting_never_earns_more</C> checks this for random splits, and the contract test <C>pay_is_capped_by_cells_planted_and_splitting_does_not_help</C> checks it on chain.
      </p>

      <H2 id="price">Planting price</H2>
      <Formula>{`per_cell = (ration − ration × keeper_bps ÷ 10,000) ÷ max(counted, live_floor, 1)
price(n) = max(per_cell × payback, min_cell_price) × n                      in PETRI units`}</Formula>
      <p>
        <C>ration</C> uses the agar at the moment of the planting, after the planting has caught the dish up and claimed the colony&rsquo;s earnings. With the full agar and the floor: <C>per_cell = (3,000,000 − 60,000) ÷ 1,000 = 2,940</C> units, so a cell costs <C>2,940 × 480 = 1,411,200</C> units, 1.4112 PETRI. The views <C>quote(cells, siege, licensed)</C> and <C>state().cell_price</C> return it.
      </p>

      <H2 id="siege">Siege multiplier</H2>
      <Formula>{`siege    = some planted cell has, within buffer (Chebyshev distance ≤ 3, wrapping),
           a live cell of another colony that is not in the house
cost(n)  = price(n) × siege_x     if siege
         = price(n)               otherwise
burned   = cost × burn_bps ÷ 10,000;   returned to the agar = cost − burned`}</Formula>

      <H2 id="licence">Planting under a slide&rsquo;s licence</H2>
      <p>
        <C>plant</C> with <C>slide</C> (a token id) is a planting under that specimen slide&rsquo;s licence. The cells must be exactly the slide&rsquo;s pattern moved anywhere on the dish (wrapping at the edges), every cell once, in the same orientation: a turned or flipped copy is a different pattern and is refused (<C>fits_slide</C> in core).
      </p>
      <Formula>{`cost     = price(n) × siege_x if siege, else price(n)                 the siege surcharge applies in full
licensed = cost − cost × slide_discount_bps ÷ 10,000                   (licensed_cost)   what the planting costs
royalty  = licensed × slide_royalty_bps ÷ 10,000                       (royalty)         only when the planter does not hold the slide
burned   = licensed × burn_bps ÷ 10,000;   returned to the agar = licensed − burned
royalty  -> transferred to the slide's holder (not burned); the holder is registered for PETRI at the planter's expense if it is not`}</Formula>
      <p>
        With the full agar, a licensed block costs <C>5,644,800 − 1,411,200 = 4,233,600</C> units (4.2336 PETRI), and a planter that does not hold the slide also pays the holder <C>423,360</C> units. The house plants only slides it holds. The Plant entry carries the licence (token, the slide&rsquo;s move count, the holder paid and the royalty), so both replays check the shape, the price, the royalty and who held the slide at that point.
      </p>

      <H2 id="buy">The buy curve</H2>
      <p>
        The agar prices PETRI at <C>k ÷ agar</C> yoctoNEAR per unit, where <C>k</C> is the launch price times the full supply. A purchase is priced at the midpoint of the curve it moves along:
      </p>
      <Formula>{`k       = petri_price ÷ 1,000,000 × max_supply = 2 × 10^14 × 10^12 = 2 × 10^26
units   = min(agar × deposit ÷ (k + deposit ÷ 2), agar)                   (petri_for_near)
price   = k ÷ agar × 1,000,000    yoctoNEAR per whole PETRI                (state().petri_price)`}</Formula>
      <p>
        The agar is full at launch, so one PETRI costs 0.0002 NEAR; with half the agar sold it costs 0.0004. 0.01 NEAR buys 49.99875 PETRI from a full agar. A purchase first pays 140 bytes of storage (0.0014 NEAR) for its ledger entry; the rest buys. <C>buy_quote(near)</C> applies the formula to the current agar.
      </p>

      <H2 id="sell">Sell-back and the allowance</H2>
      <Formula>{`outstanding = total_supply − agar             (all PETRI outside the agar; total_supply = max_supply − burned)
mid         = agar + units ÷ 2
curve       = (k × units ÷ mid) × sell_bps ÷ 10,000                             (near_for_petri)
near        = min(curve, vault × min(units, outstanding) ÷ outstanding)           (sell_back)
requires    the seller is not a house colony,  0 < near ≤ sell_left,
            near > the storage of the Sell entry (+ 239 bytes for a possible refund's records, when paid in NEAR)
paid        = near − storage
after each tide: sell_left = vault × sell_cap_bps ÷ 10,000`}</Formula>
      <p>
        <C>sell_left</C> is zero until the first tide runs. <C>sell_quote(petri)</C> returns <C>near</C> before the record&rsquo;s storage. The core test <C>selling_back_always_loses_against_buying</C> checks that a buy followed by a sale never comes out ahead, and <C>the_sell_back_never_promises_more_than_the_vault</C> checks the cap.
      </p>

      <H2 id="tide">Tides: split, bounty and storage</H2>
      <Formula>{`due        = generation % tide_every = 0  and  some colony outside the house has window[c] > 0
pay        = vault × tide_bps ÷ 10,000
bounty     = min(pay × tide_bounty_bps ÷ 10,000, max_bounty)
storage    = min(the Tide entry's storage cost, pay − bounty)
split      = tide_split(pay − bounty − storage, window, house)     share[c] = amount × window[c] ÷ Σ window
              colony that attached NEAR      -> NEAR it can claim       (Tide.paid)
              colony that never attached     -> won credit              (Tide.as_credit)
credit_pay = credit_pool × tide_bps ÷ 10,000
csplit     = tide_split(credit_pay, window, house)                      -> won credit for every share (Tide.credit_paid)
bounty     -> the caller as NEAR, or as credit when the caller's colony never attached NEAR,
              or 0 when the caller is a house colony or keeper (it stays in the vault; Tide.bounty = 0)
by         = the caller's colony id, 0 for a caller without one, 65535 (HOUSE_RUNNER) for a keeper without one
then       stake decays, window = 0, sell_left = vault × sell_cap_bps ÷ 10,000`}</Formula>
      <p>
        If the split pays nobody (the vault&rsquo;s share is too small to divide), no bounty is paid and only the entry&rsquo;s storage leaves the vault. <C>window[c]</C> is the PETRI colony <C>c</C> earned from the feed since the last tide, so a tide follows a whole hour of earnings. Shares use <C>a ÷ d × b + (a mod d) × b ÷ d</C> to avoid overflow; rounding dust stays in the vault.
      </p>

      <H2 id="dormancy">The clock, catch-up and skips</H2>
      <p>Every state-changing call runs <C>catch_up</C> first:</p>
      <Formula>{`due = (block_timestamp_ms − epoch_ms) ÷ generation_ms
if due > generation + max_lag:                         # nobody tended the dish for 2 hours
    skip      = due − generation − max_catchup
    epoch_ms += skip × generation_ms;  skipped += skip;  ledger += Skip { generation, skipped: skip }
step up to min(due, generation + cap) generations, where cap = max_catchup (or advance's max, clamped to 1..120)
stop early once the call has used min(180 TGas, prepaid gas − 40 TGas − the gas to write the hot table back)
each generation: Life step; history chain every 16th; feed; tide if due`}</Formula>
      <p>
        A Skip moves only the clock: the board, the agar and the stakes are exactly as they were. <C>plant</C> also requires <C>generation = due</C> after its catch-up, so a planting always lands on the current board. The contract test <C>an_untended_dish_skips_ahead_instead_of_piling_up_work</C> covers this; the simulator&rsquo;s dormant dish ran one skip of 172,680 generations after 30 idle days.
      </p>

      <H2 id="limits">Limits and validation</H2>
      <Table>
        <thead>
          <tr>
            <th>What</th>
            <th>Rule</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Colony name</td>
            <td>Whitespace folded; 1 to 24 characters and bytes; only <C>A–Z a–z 0–9</C>, space and <C>- &apos; . &amp; ! ? _ , : ( )</C>; unique ignoring case. Names of the form <C>Culture &lt;hex digits&gt;</C> are kept for colonies someone else paid to start, and <C>join</C> and <C>rename</C> refuse them</td>
          </tr>
          <tr>
            <td>Colour</td>
            <td>
              <C>0</C> to <C>0xFFFFFF</C>
            </td>
          </tr>
          <tr>
            <td>Lab note</td>
            <td>Trimmed; at most 140 characters and 280 bytes; no control, bidirectional, zero-width, filler, variation-selector or tag characters</td>
          </tr>
          <tr>
            <td>Slide title</td>
            <td>The same character rules; at most 40 characters and 160 bytes</td>
          </tr>
          <tr>
            <td>Planting</td>
            <td>1 to 64 cells, each &lt; 16,384, empty, not repeated; one planting per colony per generation; only at the current generation; under a licence, exactly the slide&rsquo;s pattern, translated, not turned</td>
          </tr>
          <tr>
            <td>Slide</td>
            <td>4 to 32 cells a side; corner on the dish; at least 5 of the colony&rsquo;s own living cells</td>
          </tr>
          <tr>
            <td>Colonies</td>
            <td>One per account; at most 65,534 (ids are u16)</td>
          </tr>
          <tr>
            <td>House</td>
            <td>At most 16 house accounts (5 are named) and at most 16 keepers (1 is named)</td>
          </tr>
          <tr>
            <td>Pages of views</td>
            <td>
              <C>ledger</C> and <C>plants</C> at most 1,000 a call; <C>colonies</C>, <C>slides</C>, <C>slides_for</C>, <C>earnings</C> and <C>tide_winnings</C> 500; <C>stakes</C> and <C>checkpoints</C> 2,000; <C>nft_tokens</C> and <C>nft_tokens_for_owner</C> 10
            </td>
          </tr>
        </tbody>
      </Table>

      <H2 id="constants">Constants in the code</H2>
      <p>Values compiled into the contract rather than read from the rules.</p>
      <Table>
        <thead>
          <tr>
            <th>Constant</th>
            <th>Value</th>
            <th>Where and what</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["CHAIN_EVERY", "16", "core: the history chain advances on generations that are multiples of 16"],
            ["STAKE_UNIT", "1,000", "core: stake per planted cell"],
            ["PLANT_STORAGE_BASE", "240 bytes", "contract: plant_deposit's fixed part, plus the 77-byte hot row, 4 per cell, note bytes + 64 and a licence's bytes"],
            ["CATCHUP_GAS_LIMIT", "180 TGas", "contract: a catch-up stops stepping past this, or past prepaid gas less GAS_RESERVE (40 TGas)"],
            ["RECLAIM_AFTER", "5,760 generations", "contract: a sponsor may take back its grant once a day of wall-clock time has passed since it last gave or the account last drew on it"],
            ["MIN_SPONSOR", "0.01 NEAR", "contract: the least one sponsorship brings"],
            ["MAX_GRANTS", "8", "contract: most sponsors one account's credit can come from at once"],
            ["UNSPONSOR_BYTES", "210 bytes", "contract: what a new grant sets aside for its later Unsponsor entry"],
            ["REFUND_BYTES + PENDING_RECORD_BYTES", "97 + 142 bytes", "contract: what a NEAR payout must be able to pay for, should it fail and become pending"],
            ["HOUSE_RUNNER", "65535", "contract: the by of a tide a keeper with no colony ran"],
            ["PAGE", "64 colonies", "books: colonies per cold page"],
            ["FLUSH_MAX", "16", "books: rows a call moves from the hot table back to their cold slots once their stake is gone"],
            ["MAX_NAME_CHARS", "24", "contract: colony names"],
            ["MAX_NOTE_CHARS", "140 (280 bytes)", "contract: lab notes"],
            ["MAX_HOUSE", "16", "contract: house accounts"],
            ["ACCOUNT_STORAGE", "125 bytes", "token: storage_deposit costs 0.00125 NEAR"],
            ["GAS_FOR_UNWRAP", "5 TGas", "intents: near_withdraw on the wNEAR contract"],
            ["WNEAR_STORAGE", "0.00125 NEAR", "intents: registering the dish on the wNEAR contract"],
            ["GAS_FOR_SETTLE", "30 TGas", "intents: the gas the receipt that runs a wNEAR payment's order is given; with less left, the order waits for settle_pending"],
            ["SLIDE_RESERVE", "184 bytes", "slides: storage each slide sets aside for later owners"],
            ["MAX_APPROVALS", "16", "slides: approvals per slide"],
            ["MAX_PAGE", "10", "slides: tokens nft_tokens and nft_tokens_for_owner return a call, each with its image"],
          ].map(([k, v, w]) => (
            <tr key={k}>
              <td>
                <C>{k}</C>
              </td>
              <td className="n">{v}</td>
              <td>{w}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <H3 id="constants-read">Read them yourself</H3>
      <Code lang="sh" title="Shell">{`grep -n "^const\\|^pub const\\|^pub(crate) const" contract/src/*.rs core/src/lib.rs`}</Code>
      <p>
        For what these rules do to real players over days, see <Doc to="economy">Economy</Doc> and <Doc to="simulations">Economics and simulations</Doc>.
      </p>
    </DocPage>
  );
}
