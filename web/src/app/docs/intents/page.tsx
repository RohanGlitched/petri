import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, H2, H3, Steps, Table } from "@/components/docs/ui";
import { IntentsFlow } from "@/components/docs/Diagrams";

export const metadata = docMetadata("intents");

export default function Page() {
  return (
    <DocPage
      slug="intents"
      source={[
        { label: "contract/src/intents.rs", path: "contract/src/intents.rs" },
        { label: "web/src/app/api/intents/", path: "web/src/app/api/intents/quote/route.ts" },
        { label: "web/src/lib/intents.ts", path: "web/src/lib/intents.ts" },
      ]}
    >
      <H2 id="overview">Overview</H2>
      <p>
        A player on the mainnet dish can pay with tokens on other chains. NEAR Intents&rsquo; 1Click API gives the player a deposit address; solvers swap what arrives into wNEAR; NEAR Intents delivers the wNEAR to <C>petri-dish.near</C> with <C>ft_transfer_call</C> and a message naming the account to join or buy for. The dish unwraps it to NEAR and acts as if that account had attached the NEAR itself.
      </p>
      <IntentsFlow />
      <p>The contract side is generic: any wNEAR sent with such a message works, whoever sends it. The site side only makes the quote safe and easy.</p>
      <Callout kind="money">
        <p>This is real money on NEAR mainnet. Intents settles only on mainnet, so the site&rsquo;s routes only ever quote for <C>petri-dish.near</C>, whichever dish a browser is reading.</p>
      </Callout>

      <H2 id="flow">The 1Click flow</H2>
      <Steps>
        <li>
          The player picks an asset (the site offers USDC on Base, Solana and Arbitrum, ETH on Base, SOL and BTC), an amount, the NEAR account that will own the colony, and whether the NEAR joins the dish or buys PETRI for an existing colony.
        </li>
        <li>
          The page asks <C>/api/intents/quote</C> for a dry quote (no deposit address, commits to nothing) to show how much NEAR will arrive, at least, and how much PETRI that buys at the agar&rsquo;s price now. The form asks for at least 0.01 NEAR after the swap, and for a join at least <C>min_join</C>. The server checks what matters: it refuses any quote, dry or real, whose guaranteed output is below the dish&rsquo;s own <C>intent_minimum</C> for the order (<a href="#fees">below</a>).
        </li>
        <li>
          With a refund address on the origin chain filled in, it asks for a real quote. The server fixes everything that matters: wNEAR out, <C>petri-dish.near</C> as recipient, exact-input swap, 1% slippage, refunds on the origin chain, the deadline, and the message. Before showing a deposit address it checks that 1Click echoed the dish as recipient (<C>paysTheDish</C>) and that the dish has code on mainnet.
        </li>
        <li>The browser keeps the quote and 1Click&rsquo;s signature in local storage (the last 20) as evidence if a swap goes wrong, and offers it as a file.</li>
        <li>
          The player sends the tokens from any wallet. The page polls <C>/api/intents/status</C>; it can tell 1Click the deposit transaction hash early through <C>/api/intents/submit</C>.
        </li>
        <li>
          When the swap settles, wNEAR arrives in <C>ft_on_transfer</C> and the colony appears, or the NEAR waits as pending (below).
        </li>
      </Steps>

      <H2 id="message">The message format</H2>
      <p>
        1Click&rsquo;s <C>customRecipientMsg</C> becomes the <C>msg</C> of the <C>ft_transfer_call</C>. It is a JSON string:
      </p>
      <Code lang="json" title="msg">{`{ "for": "alice.near", "do": "join", "name": "Alice", "color": 15905882 }
{ "for": "alice.near", "do": "buy" }`}</Code>
      <Table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>for</C>
            </td>
            <td>The account to join or buy for. Must parse as a NEAR account id and not be the dish. If it is missing or invalid, the whole amount is pending for the transfer&rsquo;s sender instead.</td>
          </tr>
          <tr>
            <td>
              <C>do</C>
            </td>
            <td>
              <C>&quot;join&quot;</C> or <C>&quot;buy&quot;</C>. Anything else leaves the NEAR pending. A join for an account that already has a colony buys instead.
            </td>
          </tr>
          <tr>
            <td>
              <C>name</C>
            </td>
            <td>
              The colony name for a join, under the same rules as <C>join</C>. It is used only when the transfer&rsquo;s <C>sender_id</C> is <C>for</C> itself (an account paying from its own wNEAR) and the name is valid and free; otherwise the colony gets a neutral name (below). Through 1Click the sender is the intents contract, so a 1Click join always starts under a neutral name.
            </td>
          </tr>
          <tr>
            <td>
              <C>color</C>
            </td>
            <td>
              <C>0xRRGGBB</C> as a JSON number, used only when <C>sender_id</C> is <C>for</C>. Otherwise, or if it is missing, the colour comes from the first three bytes of <C>sha256(account)</C>, lightened (<C>| 0x404040</C>) so it is never too dark to see.
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        Anyone can pay for any account; it is the payer&rsquo;s money, given to <C>for</C>. Because anyone can, the payer&rsquo;s text never appears under someone else&rsquo;s account: a colony started by someone else&rsquo;s payment is called <C>Culture</C> and the first 4 hex digits of <C>sha256(account)</C> (6, 8, … up to 16 if a shorter one is taken), in a colour from the same hash. It is marked <C>proxy</C>, and its account may choose its own name and colour once with <C>rename</C>. Nobody can take such a name first: <C>join</C> and <C>rename</C> refuse names of the form <C>Culture &lt;hex digits&gt;</C>. The house&rsquo;s accounts start their own colonies, so a payment for one of them waits as pending NEAR. So every colony started through the site&rsquo;s <strong>Pay with any token</strong> gets a neutral name and a hash colour: the name and stain typed in that form travel in the message, but the dish does not use them, and the account renames the colony afterwards if it likes. Only an account sending its own wNEAR with <C>ft_transfer_call</C> (<C>sender_id</C> is <C>for</C>) keeps the name it chose. A colony started by a payment counts as having attached NEAR only if what reaches the vault after the join&rsquo;s own storage is at least 0.01 NEAR (<C>min_join</C>); then it is paid tide shares and sales in NEAR like any wallet colony, as long as it holds no kept PETRI. A join delivered at exactly the least <C>intent_minimum</C> asks for nets less than that, so it does not attach: the colony is a guest, paid in credit, until it buys 0.01 NEAR net. (The site&rsquo;s quote route refuses quotes below that floor, not below 0.01 NEAR net of the join&rsquo;s storage.)
      </p>

      <H2 id="contract">What the contract does</H2>
      <Code lang="rust" title="The path of one payment">{`wrap.near.ft_transfer_call(petri-dish.near, amount, msg)
  └─ petri-dish.near.ft_on_transfer(sender_id, amount, msg)   // never panics
       ├─ not rules.wnear, or amount 0        -> return amount (refunded: other tokens)
       ├─ amount <= intent_bytes(account, order) × byte price (a pending record and its Pending entry)
       │                                       -> return amount (refunded whole, nothing written)
       ├─ read msg: account = for (or sender_id), order = { join, name, color }
       ├─ less than 35 TGas left              -> pending for account with its order (still wNEAR,
       │                                         unwrap_wnear later); return 0
       └─ wrap.near.near_withdraw(amount)      // unwrap, 5 TGas, detached from the return value; return 0
            └─ on_unwrapped(account, order, amount)        // 15 TGas plus the unused gas
                 ├─ pending NEAR for account with its order, less its record and Pending entry
                 ├─ unwrap failed, no order, or under 30 TGas left -> waits for settle_pending
                 └─ settle_intent(account)                 // its own receipt, 30 TGas
                      ├─ account has a colony   -> buy_with(account, the order's NEAR)
                      ├─ "join", >= min_join     -> join_with(account, its own name if sender_id == for
                      │                              and the name is free, else "Culture <hex>" as proxy)
                      └─ otherwise              -> panics, changing nothing: the NEAR waits with its order`}</Code>
      <ul>
        <li>
          wNEAR that pays for its own records is never refunded. <C>ft_on_transfer</C> keeps the whole amount, because a 1Click delivery that bounced would go back to the intents contract and be lost to its payer; it becomes pending NEAR for <C>for</C> (or for the sender if the message names nobody), less what its pending record and its <C>Pending</C> ledger entry cost. The one exception is dust: an amount no larger than <C>intent_bytes(account, order)</C> at the byte price (a fresh pending record plus its <C>Pending</C> entry, an upper bound on what arrival writes) is refunded whole and writes no record and no entry, so it cannot grow the dish&rsquo;s storage. 1Click never delivers so little, and the quote route refuses any quote below <C>intent_minimum</C>. Before v6.2 such an amount went into the tide vault with a <C>Dust</C> entry.
        </li>
        <li>
          The order is stored with the pending NEAR: <C>order_near</C> is the part it may spend. A newer order replaces an older one; the NEAR adds up. NEAR that waits for another reason (a failed payout) is never spent by an order. <C>pending_record(account_id)</C> shows both.
        </li>
        <li>
          The join or purchase runs in a receipt of its own. If it cannot run (too little gas, a failed unwrap, a purchase for an account with no colony, too little NEAR, a house account), it fails before changing anything and the NEAR waits with its order. Anyone (the keeper, the account, you) can complete it later with <C>settle_pending(account_id)</C>, which does only what the order asked, with only the order&rsquo;s NEAR. The account can instead take everything back with <C>claim_pending</C>, which also drops the order.
        </li>
        <li>
          If the account claims its pending NEAR between <C>on_unwrapped</C> and <C>settle_intent</C>, the settle finds nothing pending and fails without changing anything, so nothing is spent twice.
        </li>
        <li>
          Every change to pending NEAR is in the ledger (<C>Pending</C>, <C>Unpend</C>; <C>Dust</C> entries exist only on ledgers written by v6.1), so both replays recompute the pending total. A pending record&rsquo;s storage comes out of the amount and is paid back when the record empties, so nobody can make the dish pay for records.
        </li>
      </ul>

      <H2 id="failures">When something goes wrong</H2>
      <Table>
        <thead>
          <tr>
            <th>What happened</th>
            <th>Where the money is</th>
            <th>What to do</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>The swap could not complete before the deposit address expired, or you sent less than quoted</td>
            <td>Refunded by NEAR Intents to your refund address on the origin chain, less its refund fee</td>
            <td>Nothing; start a new payment</td>
          </tr>
          <tr>
            <td>Another token</td>
            <td>Returned by the dish to the sender (the NEP-141 refund)</td>
            <td>Nothing; the site only quotes wNEAR</td>
          </tr>
          <tr>
            <td>wNEAR too small to pay for its own pending record and entry</td>
            <td>Returned by the dish to the sender (the NEP-141 refund); nothing is written</td>
            <td>The site refuses quotes below <C>intent_minimum</C>, so it never sends one</td>
          </tr>
          <tr>
            <td>The message names no valid account</td>
            <td>Pending for the transfer&rsquo;s sender</td>
            <td>The site always sets <C>for</C></td>
          </tr>
          <tr>
            <td>Less than <C>min_join</C> waits with a join, a purchase for an account with no colony, an unknown <C>do</C>, or a house account</td>
            <td>Pending NEAR for <C>for</C>, with its order if it had one</td>
            <td>
              <C>claim_pending</C> from that account; or, once the order can run (the account has joined, say), anyone calls <C>settle_pending</C>
            </td>
          </tr>
          <tr>
            <td>Too little gas to unwrap, or the unwrap failed</td>
            <td>
              wNEAR held by the dish (<C>state().wrapped</C>), pending for <C>for</C> with its order
            </td>
            <td>
              Anyone calls <C>unwrap_wnear</C> (the keeper does it automatically); then anyone calls <C>settle_pending</C>, or the account calls <C>claim_pending</C>
            </td>
          </tr>
          <tr>
            <td>Too little gas was left for the join or purchase</td>
            <td>Pending NEAR for <C>for</C>, with its order</td>
            <td>
              Anyone calls <C>settle_pending</C>, or the account calls <C>claim_pending</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <Code lang="sh" title="See, settle or claim pending NEAR">{`# what waits for an account and the order still waiting on it (null when nothing waits)
near contract call-function as-read-only petri-dish.near pending_record json-args '{"account_id":"YOU.near"}' network-config mainnet now

# run the waiting order: anyone may; it fails, changing nothing, if the order cannot run yet
near contract call-function as-transaction petri-dish.near settle_pending json-args '{"account_id":"YOU.near"}' prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' sign-as ANYONE.near network-config mainnet sign-with-keychain send

# or take all of it back, which also drops the order
near contract call-function as-transaction petri-dish.near claim_pending json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as YOU.near network-config mainnet sign-with-keychain send`}</Code>
      <p>
        <C>pending_of</C> returns only the amount. The dish page shows pending NEAR to a connected wallet with a <strong>Claim</strong> button. The tests <C>an_intent_below_the_minimum_is_kept_for_its_account_not_refunded</C>, <C>dust_wnear_is_refunded</C>, <C>an_unusable_order_waits_as_pending_near_and_is_claimed</C>, <C>an_order_without_gas_waits_and_anyone_can_settle_it</C>, <C>a_settle_spends_only_the_orders_near</C>, <C>a_payment_for_the_house_waits_for_the_house</C>, <C>a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped</C>, <C>an_order_claimed_before_it_settles_is_not_spent_twice</C> and <C>other_tokens_are_refunded_and_forged_calls_do_nothing</C> cover these rows; <C>a_proxy_join_gets_a_neutral_name_and_never_the_payers_text</C>, <C>an_account_paying_for_itself_keeps_its_name</C>, <C>neutral_names_cannot_be_taken_first</C> and <C>a_colony_renames_once_and_only_if_someone_else_started_it</C> cover the names.
      </p>

      <H2 id="fees">Fees and minimums</H2>
      <Table>
        <thead>
          <tr>
            <th>What</th>
            <th>Amount</th>
            <th>Set by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Least wNEAR for the order to run</td>
            <td>
              <C>intent_minimum(what, account_id)</C>: <C>min_join</C> (0.01 NEAR) for a join or a purchase&rsquo;s 114 bytes (<C>BUY_BYTES</C> and one more) for a buy, plus the <C>Pending</C> and <C>Unpend</C> entries the payment writes on its way; since v6.5 a join&rsquo;s figure also includes the join&rsquo;s own storage (colony record, name, registration, entry, cold slot and purchase record), so a join paid at the floor still nets <C>min_join</C> and attaches NEAR. Those entries name the account, so the figure grows with its length: read live on 10 November 2026, for <C>alice.near</C>, 0.01912 NEAR to join and 0.00298 NEAR to buy. Less than that waits as pending NEAR (unless it is dust, which is refunded)
            </td>
            <td>
              The contract; <C>/api/intents/quote</C> refuses quotes below it
            </td>
          </tr>
          <tr>
            <td>Least the payment form asks for</td>
            <td>0.01 NEAR after the swap (and <C>min_join</C> for a join): a floor for the form only</td>
            <td>
              <C>MIN_INTENT</C> in <C>PayAnyToken.tsx</C>
            </td>
          </tr>
          <tr>
            <td>Slippage</td>
            <td>1% (100 bps); the quote&rsquo;s minimum output is what you are guaranteed</td>
            <td>
              <C>/api/intents/quote</C>
            </td>
          </tr>
          <tr>
            <td>Swap and bridge fees</td>
            <td>Already taken out of the quote&rsquo;s output; they depend on the route</td>
            <td>NEAR Intents</td>
          </tr>
          <tr>
            <td>App fee</td>
            <td>
              0.2% (20 bps), added by 1Click itself to quotes made without an API key: live quotes return it in{" "}
              <C>quoteRequest.appFees</C>. The site&rsquo;s own request asks for no fee, and the payment dialog shows the fee each quote carries.
            </td>
            <td>
              NEAR Intents; shown by <C>PayAnyToken.tsx</C>
            </td>
          </tr>
          <tr>
            <td>Bridge minimums</td>
            <td>Per chain; 1Click&rsquo;s &ldquo;try at least …&rdquo; message is shown in tokens. The Bitcoin bridge takes at least about 8,300 sats.</td>
            <td>NEAR Intents</td>
          </tr>
          <tr>
            <td>Deposit window</td>
            <td>60 minutes; 180 for Bitcoin, which needs confirmations</td>
            <td>
              <C>ORIGINS</C> in <C>web/src/lib/intents.ts</C>
            </td>
          </tr>
          <tr>
            <td>Refund fee</td>
            <td>Shown with the quote when 1Click returns one</td>
            <td>NEAR Intents</td>
          </tr>
        </tbody>
      </Table>
      <p>Ethereum mainnet is left out of the offered assets on purpose: a refund there costs more than a typical stake.</p>

      <H2 id="routes">The site&rsquo;s /api/intents routes</H2>
      <p>
        The routes pass requests to <C>https://1click.chaindefuser.com</C> and refuse anything that would not pay the dish. An optional <C>INTENTS_API_KEY</C> on the server only lowers 1Click&rsquo;s fee and lifts its rate limit; it works without one.
      </p>
      <H3 id="route-quote">POST /api/intents/quote</H3>
      <Code lang="json" title="Request body">{`{
  "dry": false,
  "originAsset": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
  "amount": "2000000",
  "refundTo": "0x…",
  "for": "alice.near",
  "do": "join",
  "name": "Alice",
  "color": 15905882
}`}</Code>
      <p>The server builds this 1Click request; the browser cannot change any field but the asset, amount, refund address and the message:</p>
      <Code lang="json" title="What is sent to 1Click /v0/quote">{`{
  "dry": false, "swapType": "EXACT_INPUT", "slippageTolerance": 100,
  "originAsset": "<the chosen asset>", "depositType": "ORIGIN_CHAIN",
  "destinationAsset": "nep141:wrap.near", "amount": "<base units>",
  "refundTo": "<refund address>", "refundType": "ORIGIN_CHAIN",
  "recipient": "petri-dish.near", "recipientType": "DESTINATION_CHAIN",
  "customRecipientMsg": "{\\"for\\":\\"alice.near\\",\\"do\\":\\"join\\",\\"name\\":\\"Alice\\",\\"color\\":15905882}",
  "deadline": "<now + 60 or 180 minutes>", "referral": "petri"
}`}</Code>
      <Table>
        <thead>
          <tr>
            <th>Refusal</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Send the quote request as JSON.", "400"],
            ["That asset is not offered here.", "400"],
            ["The amount must be a whole number of base units.", "400"],
            ["Name the NEAR mainnet account that will own the colony.", "400"],
            ["Say whether the NEAR joins the dish or buys PETRI.", "400"],
            ["The refund address must be a 0x address / a Solana address / a Bitcoin address.", "400"],
            ["A real quote needs the refund address the swap pays back to if it fails.", "400"],
            ["A colony name is 1 to 24 letters, digits, spaces and - ' . & ! ? _ , : ( ).", "400"],
            ["The stain must be a colour 0xRRGGBB.", "400"],
            ["petri-dish.near has no contract on NEAR mainnet yet, so no deposit address is given out.", "409"],
            ["NEAR Intents returned a quote for a different recipient; it was not shown.", "502"],
            ["NEAR Intents returned no deposit address.", "502"],
            ["NEAR Intents returned no amount out; the quote was not shown.", "502"],
            ["This payment could deliver as little as … NEAR, and the dish needs at least … NEAR to start a colony (or buy PETRI) for …. Send a little more.", "400"],
            ["NEAR Intents could not be reached: …", "502"],
          ].map(([e, s]) => (
            <tr key={e}>
              <td>{e}</td>
              <td className="n">{s}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        The minimum check runs on dry quotes too, so the form shows it before anyone pays. The least the swap can deliver is the quote&rsquo;s <C>minAmountOut</C> (or <C>amountOut</C> if it has none), compared with <C>intent_minimum</C> read from <C>petri-dish.near</C> over <C>https://rpc.mainnet.fastnear.com</C>. If the view cannot be read, the route uses 0.013 NEAR for a join and 0.004 NEAR for a purchase, a margin above what the launch rules need. A refusal from 1Click itself is passed on in 1Click&rsquo;s own words.
      </p>
      <H3 id="route-status">GET /api/intents/status?depositAddress=…&amp;depositMemo=…</H3>
      <p>
        The swap&rsquo;s state from 1Click&rsquo;s <C>/v0/status</C>: <C>PENDING_DEPOSIT</C>, <C>KNOWN_DEPOSIT_TX</C>, <C>INCOMPLETE_DEPOSIT</C>, <C>PROCESSING</C>, then <C>SUCCESS</C>, <C>REFUNDED</C> or <C>FAILED</C>. Only swaps whose quote pays the dish are reported; others get 404.
      </p>
      <H3 id="route-submit">POST /api/intents/submit</H3>
      <p>
        <C>{`{ "depositAddress": "…", "txHash": "…" }`}</C>: tells 1Click the deposit transaction so it looks for it sooner. Optional; 1Click finds deposits anyway.
      </p>
      <H3 id="route-tokens">GET /api/intents/tokens</H3>
      <p>The offered assets and wNEAR with 1Click&rsquo;s current USD prices, cached for a minute.</p>

      <H2 id="direct">Paying wNEAR directly</H2>
      <p>
        Nothing in the contract depends on 1Click. Any account holding wNEAR on mainnet can start a colony for any account by sending it with a message. <C>ft_on_transfer</C> unwraps only with at least 35 TGas left, and the join runs only if the unwrap&rsquo;s callback still has 30 TGas to give it; with less, nothing is lost: the NEAR waits with its order for <C>settle_pending</C>. Paying from your own wNEAR is the one case where the message&rsquo;s name and colour are used, because the sender is <C>for</C>.
      </p>
      <Code lang="sh" title="alice.near joins with 0.02 of its own wNEAR (mainnet, real NEAR)">{`near contract call-function as-transaction wrap.near ft_transfer_call json-args '{
  "receiver_id": "petri-dish.near",
  "amount": "20000000000000000000000",
  "msg": "{\\"for\\":\\"alice.near\\",\\"do\\":\\"join\\",\\"name\\":\\"Alice\\",\\"color\\":15905882}"
}' prepaid-gas '300.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as alice.near network-config mainnet sign-with-keychain send`}</Code>
      <p>
        You need wNEAR first: register on <C>wrap.near</C> with its <C>storage_deposit</C>, then wrap NEAR with <C>near_deposit</C>. The dish itself is already registered there (<C>state().wnear_ready</C> is true). On testnet the same works with <C>wrap.testnet</C> and <C>petri-v6.testnet</C>, whose rules trust <C>wrap.testnet</C>. See also <Doc to="security" hash="t-intents">the security notes</Doc>.
      </p>
    </DocPage>
  );
}
