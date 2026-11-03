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
          The page asks <C>/api/intents/quote</C> for a dry quote (no deposit address, commits to nothing) to show how much NEAR will arrive, at least, and how much PETRI that buys at the agar&rsquo;s price now. It warns when the minimum would be under 0.01 NEAR, or under the join minimum for a join.
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
            <td>The colony name for a join, under the same rules as <C>join</C>. A name that is invalid or taken leaves the NEAR pending.</td>
          </tr>
          <tr>
            <td>
              <C>color</C>
            </td>
            <td>
              <C>0xRRGGBB</C> as a JSON number. If it is missing, the colour comes from the account&rsquo;s hash, lightened (<C>| 0x404040</C>) so it is never too dark to see.
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        Anyone can pay for any account; it is the payer&rsquo;s money, given to <C>for</C>. A colony started this way is marked <C>proxy</C>, and its account may choose its name and colour once with <C>rename</C>. Its NEAR counts as attached, so it is paid tide shares and sales in NEAR like any wallet colony.
      </p>

      <H2 id="contract">What the contract does</H2>
      <Code lang="rust" title="The path of one payment">{`wrap.near.ft_transfer_call(petri-dish.near, amount, msg)
  └─ petri-dish.near.ft_on_transfer(sender_id, amount, msg)        // never panics
       ├─ not rules.wnear, or amount < 0.01 NEAR   -> return amount (refunded)
       ├─ less than 40 TGas left                    -> amount pending for msg.for (still wNEAR); return 0
       └─ wrap.near.near_withdraw(amount)            // unwrap, 10 TGas, detached from the return value; return 0
            └─ on_unwrapped(account, what, name, color, amount)
                 ├─ add amount to account's pending NEAR (less a new record's storage)
                 ├─ unwrap failed, no "do", or under about 50 TGas left -> stays pending
                 └─ settle_intent(account, what, name, color, credited)   // its own receipt
                      ├─ account has a colony             -> buy_with(account, NEAR)
                      ├─ "join", valid free name, ≥ min_join -> join_with(account, name, color, NEAR, proxy = true)
                      └─ otherwise                          -> stays pending`}</Code>
      <ul>
        <li>
          <C>ft_on_transfer</C> keeps the whole amount whatever happens next, because a withdrawal from the intents contract with a message is not refunded when the receiver fails. Nothing after it can lose the NEAR: every failure path leaves it pending.
        </li>
        <li>
          The join or purchase runs in a receipt of its own, so if it fails for any reason (storage, a race with another join of the same name), the pending NEAR is untouched.
        </li>
        <li>
          If the account claims its pending NEAR between <C>on_unwrapped</C> and <C>settle_intent</C>, the settle sees less pending than it was sent and does nothing (<C>&quot;claimed&quot;</C>), so nothing is spent twice.
        </li>
        <li>
          A pending record&rsquo;s storage comes out of the amount, and the storage is paid back when the record is emptied, so nobody can make the dish pay for records.
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
            <td>Another token, or under 0.01 NEAR of wNEAR</td>
            <td>Returned by the dish to the sender (the NEP-141 refund)</td>
            <td>The site never quotes below 0.01 NEAR</td>
          </tr>
          <tr>
            <td>The message names no valid account</td>
            <td>Pending for the transfer&rsquo;s sender</td>
            <td>The site always sets <C>for</C></td>
          </tr>
          <tr>
            <td>Name taken or invalid, under 0.01 NEAR after the swap for a join, unknown <C>do</C></td>
            <td>Pending NEAR for <C>for</C></td>
            <td>
              <C>claim_pending</C> from that account, or join yourself and pay again
            </td>
          </tr>
          <tr>
            <td>Too little gas to unwrap, or the unwrap failed</td>
            <td>
              wNEAR held by the dish (<C>state().wrapped</C>), pending for <C>for</C>
            </td>
            <td>
              Anyone calls <C>unwrap_wnear</C> (the keeper does it automatically); then <C>claim_pending</C>
            </td>
          </tr>
          <tr>
            <td>The join or purchase itself failed</td>
            <td>Pending NEAR for <C>for</C></td>
            <td>
              <C>claim_pending</C>
            </td>
          </tr>
        </tbody>
      </Table>
      <Code lang="sh" title="See and claim pending NEAR">{`near contract call-function as-read-only petri-dish.near pending_of json-args '{"account_id":"YOU.near"}' network-config mainnet now
near contract call-function as-transaction petri-dish.near claim_pending json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' sign-as YOU.near network-config mainnet sign-with-keychain send`}</Code>
      <p>
        The dish page shows pending NEAR to a connected wallet with a <strong>Claim</strong> button. The tests <C>an_unusable_order_waits_as_pending_near_and_is_claimed</C>, <C>a_failed_unwrap_keeps_the_wnear_for_its_account_until_it_is_unwrapped</C>, <C>wnear_with_too_little_gas_to_unwrap_is_kept_for_its_account</C>, <C>an_order_claimed_before_it_settles_is_not_spent_twice</C> and <C>other_tokens_and_dust_are_refunded_and_forged_calls_do_nothing</C> cover each row.
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
            <td>Least wNEAR in one transfer</td>
            <td>0.01 NEAR</td>
            <td>
              <C>MIN_INTENT</C> in the contract
            </td>
          </tr>
          <tr>
            <td>Least NEAR for a join</td>
            <td>0.01 NEAR</td>
            <td>
              <C>rules.min_join</C>
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
            <td>None: the site&rsquo;s quote request sets no <C>appFees</C></td>
            <td>
              <C>/api/intents/quote</C>
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
          ].map(([e, s]) => (
            <tr key={e}>
              <td>{e}</td>
              <td className="n">{s}</td>
            </tr>
          ))}
        </tbody>
      </Table>
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
        Nothing in the contract depends on 1Click. Any account holding wNEAR on mainnet can start a colony for any account by sending it with a message. Give the call enough gas for the unwrap, the settle and the join: below about 100 TGas the join may not fit, and the NEAR waits as pending.
      </p>
      <Code lang="sh" title="Join for alice.near with 0.02 wNEAR (mainnet, real NEAR)">{`near contract call-function as-transaction wrap.near ft_transfer_call json-args '{
  "receiver_id": "petri-dish.near",
  "amount": "20000000000000000000000",
  "msg": "{\\"for\\":\\"alice.near\\",\\"do\\":\\"join\\",\\"name\\":\\"Alice\\",\\"color\\":15905882}"
}' prepaid-gas '300.0 Tgas' attached-deposit '1 yoctoNEAR' sign-as YOU.near network-config mainnet sign-with-keychain send`}</Code>
      <p>
        You need wNEAR first: register on <C>wrap.near</C> with its <C>storage_deposit</C>, then wrap NEAR with <C>near_deposit</C>. The dish itself is already registered there (<C>state().wnear_ready</C> is true). On testnet the same works with <C>wrap.testnet</C> and <C>petri-v5.testnet</C>, whose rules trust <C>wrap.testnet</C>. See also <Doc to="security" hash="t-intents">the security notes</Doc>.
      </p>
    </DocPage>
  );
}
