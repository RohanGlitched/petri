import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Ext, H2, Table } from "@/components/docs/ui";
import { DISH, SITE, blob } from "@/components/docs/facts";

export const metadata = docMetadata("living-slides");

const TESTNET_TX = "https://testnet.nearblocks.io/txns/";
const MAINNET_TX = "https://nearblocks.io/txns/";
const tx = (net: "testnet" | "mainnet", h: string) => (
  <a href={`${net === "testnet" ? TESTNET_TX : MAINNET_TX}${h}`}>
    <C>{h.slice(0, 8)}…</C>
  </a>
);
const PURSE_HASH = "HRSkpLzDjnevFrwEV8B9TadHyTiYr6NoXbUyFufxXF44";

/** The seller's attacks from docs/SLIDES-THREAT-MODEL.md: what they try, what stops it, the test that checks it. */
const THREATS: [string, string, string, string][] = [
  ["T1", "Keep using the purse after selling (plant, claim, withdraw NEAR or PETRI, list, transfer)", "Every privileged method requires predecessor == holder, checked and changed in the same receipt.", "the_old_holder_keeps_nothing_after_a_transfer"],
  ["T2", "Keep an access key on the purse", "No key was ever added: creation is one receipt with no AddKey, and the code cannot add one. view_access_key_list returns an empty list.", "testnet run: keys = 0 for each purse"],
  ["T3", "Redirect the colony's payouts to themselves (set_payout) before selling", "act forwards only join, rename, plant, claim, claim_pending, buy, sell, mint_slide, pact_accept, pact_cancel; set_payout is not on the list.", "act_forwards_only_whitelisted_dish_calls"],
  ["T4", "Sell in the middle of a payout and pocket it", "Money is paid to the account, never a person. While a call the purse made is in flight the token cannot be transferred or bought; a flight record whose callback never came back stops blocking after 600 blocks.", "a_sale_waits_for_calls_in_flight, a_stuck_flight_record_expires"],
  ["T5", "Drain the purse while a sale is pending", "A listed purse (its own market or any NEP-178 approval) refuses withdraw, ft_withdraw, act and release. Every change bumps the nonce, and buy(nonce) fails if the purse changed since the buyer looked.", "a_listed_slide_moves_nothing_out"],
  ["T6", "Keep a NEP-178 approval, then take the token back after the sale", "Every transfer clears every approval and refunds its storage; approval ids only increase.", "approvals_never_survive_a_transfer"],
  ["T7", "Re-run init, or have the factory re-make the purse", "init runs once, only from the parent account; the factory creates an account only if none exists.", "setup_once_by_the_factory_only, a_failed_creation_gives_the_slide_and_the_credit_back"],
  ["T8", "Approve themselves on the dish token from inside the purse, then lift the slide out", "act cannot call nft_approve or nft_transfer on the dish; release refuses the purse's own slide.", "act_forwards_only_whitelisted_dish_calls, its_own_slide_stays_sealed"],
  ["T9", "Move value out through the dish: sponsor, pact_offer, ft_transfer", "None of these is forwardable. PETRI leaves only through ft_withdraw, which pays the holder.", "act_forwards_only_whitelisted_dish_calls"],
  ["T10", "Strand the purse (send its token to itself, the factory, the dish or an invalid id)", "Transfers to those are refused.", "nobody_can_be_made_holder_who_could_not_use_it"],
  ["T11", "Grief its storage", "At most 4 approvals, each paid by its grantor; a 12-entry history ring; withdraw never takes the storage headroom; only the dish's own slides are accepted.", "storage_stays_bounded, withdraw_pays_the_holder_and_keeps_storage_paid"],
  ["T12", "Race the callbacks (reentrancy)", "Each callback checks predecessor == current account and trusts nothing it is passed beyond writing the history and freeing the flight.", "transfer_call_returns_the_token_when_the_receiver_refuses"],
];

export default function Page() {
  return (
    <DocPage
      slug="living-slides"
      source={[
        { label: "purse/contract/src/lib.rs", path: "purse/contract/src/lib.rs" },
        { label: "purse/factory/src/lib.rs", path: "purse/factory/src/lib.rs" },
        { label: "docs/LIVING-SLIDES.md", path: "docs/LIVING-SLIDES.md" },
        { label: "docs/SLIDES-THREAT-MODEL.md", path: "docs/SLIDES-THREAT-MODEL.md" },
      ]}
    >
      <H2 id="what">What a living slide is</H2>
      <p>
        A <Doc to="specimens">specimen slide</Doc> is a NEP-171 token in the dish contract. <strong>Sealing</strong> it moves it into a NEAR account of its own, <C>slide-&lt;id&gt;.&lt;factory&gt;</C>, called its <strong>purse</strong>. The purse has no access keys. From then on:
      </p>
      <ul>
        <li><strong>It owns money.</strong> NEAR and PETRI sit in the purse. Every payout from the dish lands there, never with a person.</li>
        <li><strong>It earns.</strong> The purse owns the slide, so the slide&rsquo;s licence royalties are paid into it. It is also a colony on the dish: it plants the slide&rsquo;s own pattern back onto the board, and its cells are fed and share the tides like any player&rsquo;s colony.</li>
        <li><strong>It holds inventory.</strong> It holds the sealed slide for good, plus any slides its colony mints. The holder can release those extra slides, never the sealed one.</li>
        <li><strong>It carries access.</strong> Only the holder opens the slide&rsquo;s darkroom on the site, with a fresh NEP-413 signature the server checks (<C>agents/darkroom-test.mjs</C> admits the holder and refuses another account and a tampered message).</li>
        <li><strong>It is the NFT.</strong> Each purse is itself a one-token NEP-171 contract (NEP-177 metadata, NEP-178 approvals, NEP-199 payouts, one-token NEP-181) whose token id is the slide&rsquo;s id. Whoever holds that token is the only account that can make the purse act. Sell it and the account, its NEAR, its PETRI, its colony and its slide go to the buyer at once.</li>
      </ul>
      <p>
        The dish contract is unchanged by this: the purse and its factory are separate contracts in <a href={blob("purse")}>purse/</a>. A sealed slide&rsquo;s page on <Ext href={`${SITE}/specimens`}>/specimens</Ext> reads its access keys live (0), its NEAR and PETRI, its living cells, feed, tides and royalties, and its history from the purse&rsquo;s own log.
      </p>

      <H2 id="control">How control passes</H2>
      <p>
        Control is one field in the purse, <C>holder</C>. Every privileged method (<C>act</C>, <C>withdraw</C>, <C>ft_withdraw</C>, <C>release</C>, <C>list</C>, <C>nft_approve</C>, <C>nft_transfer*</C>) compares the caller with <C>holder</C> in the same receipt that moves anything, and moving the token rewrites <C>holder</C> in the same receipt too. There is no gap between the check and the effect.
      </p>
      <ul>
        <li><strong>No keys.</strong> The factory creates the account, funds its storage, deploys the purse and calls <C>init</C> with the holder in one receipt with no <C>AddKey</C>. The code cannot add a key, deploy code or delete the account.</li>
        <li>
          <strong>Fixed payout routing.</strong> <C>act</C> forwards only <C>join, rename, plant, claim, claim_pending, buy, sell, mint_slide, pact_accept, pact_cancel</C> to the dish. It cannot forward <C>set_payout</C>, <C>sponsor</C>, <C>pact_offer</C>, <C>ft_transfer</C>, <C>nft_approve</C> or <C>nft_transfer</C>, so the colony is always paid into the purse.
        </li>
        <li><strong>Listed means frozen.</strong> While the purse is listed (on its own market with <C>list</C>, or through any NEP-178 approval), nothing leaves it. Every change bumps its <C>nonce</C>, and <C>buy(nonce)</C> fails if the purse changed since the buyer looked.</li>
        <li><strong>Nothing in flight.</strong> While a call the purse made is on its way, the token cannot move.</li>
        <li><strong>Approvals do not survive a transfer.</strong> Every transfer clears them and refunds their storage to the old holder.</li>
      </ul>

      <H2 id="design">Why the purse is the token</H2>
      <p>The obvious design leaves the token with the person and has the purse ask the dish who owns it before obeying. It was rejected for three reasons:</p>
      <ol>
        <li>That check is asynchronous, so the token can move between the check and the effect; re-checking in the callback only moves the gap.</li>
        <li>The dish pays a licence royalty to the slide&rsquo;s owner, which would be the person, so the slide&rsquo;s account would never earn its own royalties.</li>
        <li>&ldquo;Listed means frozen&rdquo; cannot be enforced: the purse could not know synchronously that a marketplace holds an approval on the dish token.</li>
      </ol>
      <p>
        Putting the slide inside the purse, and making the purse the token, removes all three. The cost is that the dish token is sealed for good, and the token that trades is the purse&rsquo;s own, a standard NEP-171 token that marketplaces can list through NEP-178 and NEP-199.
      </p>

      <H2 id="threats">Threat model for a transfer</H2>
      <p>
        Written before the code: every way a seller could try to keep the money, the cells or the control, the rule that stops it and the test that checks it (<C>purse/contract/src/tests.rs</C>, <C>purse/factory/src/tests.rs</C>, and the testnet run in <C>scripts/purse-testnet.mjs</C>). The full text is <a href={blob("docs/SLIDES-THREAT-MODEL.md")}>docs/SLIDES-THREAT-MODEL.md</a>.
      </p>
      <Table caption="The seller's attacks">
        <thead>
          <tr>
            <th>#</th>
            <th>The seller tries to</th>
            <th>What stops it</th>
            <th>Test</th>
          </tr>
        </thead>
        <tbody>
          {THREATS.map(([n, tries, stops, test]) => (
            <tr key={n}>
              <th>{n}</th>
              <td>{tries}</td>
              <td>{stops}</td>
              <td>
                <C>{test}</C>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <H2 id="testnet">Proof on testnet</H2>
      <p>
        Factory <a href={`https://testnet.nearblocks.io/address/petri-slides.testnet`}><C>petri-slides.testnet</C></a> (dish <C>{DISH.testnet.contract}</C>). Purse code hash <C>{PURSE_HASH}</C>, the SHA-256 of <C>purse/res/petri_purse.wasm</C> (29,404 bytes). Both purses, <C>slide-1.petri-slides.testnet</C> and <C>slide-2.petri-slides.testnet</C>, report 0 access keys, and both colonies have attached NEAR. Each step below is a real testnet transaction:
      </p>
      <Table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Transactions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Methylene Blue seals slide 1 (prepay, then <C>nft_transfer_call</C> to the factory)</td>
            <td>{tx("testnet", "76jyiJveYBnVcM8yeUzBkAtV96MqQcYXgXux1dVvQZsN")}, {tx("testnet", "13SdLwZrERz7HkzWiCWq1z6RZoTacrnTc7JVDSdku9yG")}</td>
          </tr>
          <tr>
            <td>Bench A plants slide 1&rsquo;s pattern; a 5.653152 PETRI royalty is paid into the purse</td>
            <td>{tx("testnet", "EJxAxjWwALfvF3aB3cAVhKyspi7EN958SAwkLJJmc6rb")}</td>
          </tr>
          <tr>
            <td>Purse 1 passes from Methylene Blue to <C>petri-lab.testnet</C></td>
            <td>{tx("testnet", "DJDkq7tmKyLpiPiscDUhqpX9b43s4PqWw7iU2WSdVVJL")}</td>
          </tr>
          <tr>
            <td>The old holder is refused: act, withdraw NEAR, withdraw PETRI, transfer back</td>
            <td>
              {tx("testnet", "Dq6v1JuY2MgruuybY6cEbuYqFkk6BLErQayn1tDZF2uJ")}, {tx("testnet", "DXByfnDUgUoeaSpCmsQDsPvoKCW4wfxkBj3J9GjF9q6H")}, {tx("testnet", "8SojUvgkc9FQf9ubii4e1NxroUSaMNJFZFHLrnz9Qg7g")}, {tx("testnet", "6ir8wZ6v8uLxQd4ue5tb5oBnHPouokXuKyCssU37W3Mj")}
            </td>
          </tr>
          <tr>
            <td>
              <strong>Sale in the middle of a payout:</strong> a claim and a transfer signed together; the transfer is refused while the claim is in flight, then goes through once it lands
            </td>
            <td>
              claim {tx("testnet", "9wDjrhVudeQuJZ7PigygWVgXvH9EHMDJYPLUYzxvqGYT")}, refused {tx("testnet", "DNwXbDJXwP2Rm1CEC8JwQuPXhwFFTTMwFoSiefniAHp8")}, then {tx("testnet", "H91TGE69nuNb7RwSBoo6eWYDXTU75gNgKihuQjPc5sz4")}
            </td>
          </tr>
          <tr>
            <td>The purse refuses <C>set_payout</C>, <C>sponsor</C>, <C>nft_approve</C>, <C>ft_transfer</C>, <C>pact_offer</C></td>
            <td>
              {tx("testnet", "HMW6nhfVkoWfiBqnDUPzbVvKnih5UjuVrLDXBrDYfQ9y")}, {tx("testnet", "9nGwMqhr6aRdqKoToTMhUReD45zavcRpBuRuxpUFtKXk")}, {tx("testnet", "Dvqhp5eupn3Fz1wtcAeYXbHJ7MZoS5Wwn8fxxYU3yqud")}, {tx("testnet", "EZ6oQLCa9T2Jg8RjuPZ6hHjNEhCoKyHbKsqiMxrDtoTN")}, {tx("testnet", "Hyfsaoek6QB3cjoR7B9utBoNcUcCNXp3pDSf5Ykvirva")}
            </td>
          </tr>
          <tr>
            <td>Slide 2 listed at 0.01 NEAR; the seller&rsquo;s withdrawal and act are refused while it is listed</td>
            <td>
              {tx("testnet", "3mS2bnGpQXSSmUBZues1FdpsrRKXNcA7Trv6qTh32HRn")}, {tx("testnet", "FaFBrSt2ZSe547N1rBc3ELhmxK1JNmEdtx3cBoFqLLPQ")}, {tx("testnet", "8T5u3ViGBFa4sDu8pE8TdVWk3gXEmnV8FKgpVdYVNxwt")}
            </td>
          </tr>
          <tr>
            <td>The seller unlists and relists; a purchase pinned to the old nonce is refused</td>
            <td>
              {tx("testnet", "EVqp7aYZjEz6BDp8yDz3nsgo56vpGKSRs3RwRBkMSH9L")}, {tx("testnet", "3NCouKtYiqYqJPzYmUrMA1e6yCEKLxuam9fMLFA4edU3")}, {tx("testnet", "2F8ABHd1syvEwcwtGRM9merWxnycM39diumu5DUnErdv")}
            </td>
          </tr>
          <tr>
            <td>Bench B buys at the current nonce (the price goes to the seller); the seller is refused afterwards</td>
            <td>
              {tx("testnet", "BtyT5YwBabgaUrnLzALNYiwv8Jq5eUhrLYLqZC1kNwRG")}, {tx("testnet", "6mT2UDMbBWsas6ufEufv32A3AopQGcn65SDipWzRrP2A")}
            </td>
          </tr>
        </tbody>
      </Table>
      <p>
        Every step, with the rest (the purses joining, planting, claiming and withdrawing), is in <a href={blob("docs/LIVING-SLIDES.md")}>docs/LIVING-SLIDES.md</a>. Reproduce them with <C>node scripts/purse-testnet.mjs keys|midpayout|handover|sale|whitelist</C> and <C>node agents/purse.mjs</C>.
      </p>
      <Callout kind="check">
        <Code lang="sh">{`curl -s ${DISH.testnet.rpc} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"slide-1.petri-slides.testnet"}}'
# "keys":[]`}</Code>
      </Callout>

      <H2 id="mainnet">Mainnet: slide 14</H2>
      <p>
        Mainnet has no factory. <C>{DISH.mainnet.contract}</C> made one purse itself, with <C>scripts/purse-mainnet.mjs</C>, on 10 November 2026: one transaction created <C>slide-14.petri-dish.near</C>, funded its storage, deployed the purse and called <C>init</C> with Congo Red as holder, with no <C>AddKey</C> action. Congo Red then sent slide 14, its 45-cell specimen from generation 3,817, into the purse; the purse joined the dish as its own colony (&ldquo;Living slide 14&rdquo;) and planted its slide&rsquo;s pattern under its licence. Alone on an empty dish the engine keeps that pattern at 45 living cells for at least 1,000 generations.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Step</th>
            <th>Signer</th>
            <th>Transaction</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Create, fund 0.31604 NEAR, deploy the purse, <C>init</C>; no key added</td>
            <td><C>petri-dish.near</C></td>
            <td>{tx("mainnet", "FFyXQGq413Y2d8CyHjJkftQ7ozpJjMyoMStCfkDsAr7J")}</td>
          </tr>
          <tr>
            <td>Congo Red sends slide 14 into its purse</td>
            <td><C>congo.petri-dish.near</C></td>
            <td>{tx("mainnet", "39nNhzovv4jsWvkYHi41R8FF2sP2WGCGkSaUeTp9y8Ne")}</td>
          </tr>
          <tr>
            <td>The purse joins the dish</td>
            <td><C>congo.petri-dish.near</C></td>
            <td>{tx("mainnet", "53CojkigLHHVL9t6qUEvjNjZobfG4cd6R7PTipjohhCX")}</td>
          </tr>
          <tr>
            <td>The purse buys the PETRI its planting needed</td>
            <td><C>congo.petri-dish.near</C></td>
            <td>{tx("mainnet", "GLLZ74XchqtFm3xiYURmDpeH4oEcaejaERnBMTm65WTu")}</td>
          </tr>
          <tr>
            <td>The purse plants its slide&rsquo;s 45-cell pattern</td>
            <td><C>congo.petri-dish.near</C></td>
            <td>{tx("mainnet", "Df4SYSysAqSaSXYonu93aTHCjG2Etqh7SXUzxAYSKrXg")}</td>
          </tr>
        </tbody>
      </Table>
      <p>
        <C>slide-14.petri-dish.near</C> has 0 access keys, the dish&rsquo;s <C>slide</C> view names it as slide 14&rsquo;s owner, and the purse&rsquo;s own <C>nft_token(&quot;14&quot;)</C> names <C>congo.petri-dish.near</C> as the holder. The mainnet house strains tend it: they replant its pattern if its colony dies and claim for it.
      </p>
      <Callout kind="warn" title="What slide 14 earns on mainnet">
        <p>
          The purse joined with 0.015 NEAR, which netted under <C>min_join</C> (0.01 NEAR) after the join&rsquo;s storage, so its colony has not attached NEAR (<C>attached: false</C> in <C>colonies</C>). Since v6.5 a colony outside the house that has never attached can attach only while it has no living cells, and slide 14&rsquo;s pattern is stable. So on mainnet, for as long as its cells live, what the purse earns is kept PETRI and tide shares paid as credit: it wins no NEAR, it cannot sell its PETRI for NEAR, and <C>ft_withdraw</C> of its PETRI is refused by the dish (a colony that has never attached cannot send PETRI). It can still plant what it holds. The testnet purses, <C>slide-1</C> and <C>slide-2</C>, have attached and earn normally.
        </p>
      </Callout>
      <Callout kind="check">
        <Code lang="sh">{`curl -s ${DISH.mainnet.rpc} -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"slide-14.petri-dish.near"}}'
# "keys":[]`}</Code>
      </Callout>

      <H2 id="buyer">What a buyer should check</H2>
      <p>These are encumbrances that are visible, not hidden:</p>
      <ul>
        <li><strong>Sponsored credit is not the purse&rsquo;s.</strong> A sponsor, possibly the seller, can reclaim dish credit it gave the purse after a day unused (<C>unsponsor</C>). Credit the colony won is its own. The slide page shows the two apart.</li>
        <li><strong>Pacts the purse accepted bind it</strong> not to plant near the paying colony until their <C>until</C> generation, at most <C>pact_max_gens</C>. <C>pacts_of(&lt;purse&gt;)</C> shows them before you buy.</li>
        <li><strong>Kept PETRI.</strong> A colony that has not attached, or played on credit, holds kept PETRI, which the dish will not sell for NEAR (see slide 14 above).</li>
        <li><strong>The holder decides the play.</strong> The house tends the purses it holds. A new holder can stop or change that.</li>
      </ul>

      <H2 id="build">Build, test and cost</H2>
      <Code lang="sh">{`cd purse && cargo test                    # 16 purse + 5 factory + 2 JSON tests
WASM_OPT=<binaryen wasm-opt> ./build.sh   # res/petri_purse.wasm, res/petri_purse_factory.wasm`}</Code>
      <p>
        The purse is written without near-sdk, against NEAR&rsquo;s host functions, to keep its code small: every purse carries its own copy, and storage costs 1 NEAR per 100 KB. Native tests run the contract&rsquo;s own code against a mock chain (<C>purse/kit/src/mock.rs</C>) in which a failed call rolls back as it would on chain.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Item</th>
            <th className="n">NEAR</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>One purse: its code (29,404 bytes) and state, locked in the purse as storage</td>
            <td className="n">0.316</td>
          </tr>
          <tr>
            <td>The factory, once (42,459 bytes with the purse embedded)</td>
            <td className="n">about 0.43</td>
          </tr>
          <tr>
            <td>Joining the dish and planting the slide</td>
            <td className="n">about 0.02</td>
          </tr>
        </tbody>
      </Table>
      <p>
        A NEAR global contract (NEP-591) would deploy the code once for every purse, but its storage is charged at ten times the rate and burned, about 2.9 NEAR for this code, so it pays off only beyond about ten purses.
      </p>

      <H2 id="limits">Limits</H2>
      <ul>
        <li>A slide sent by plain <C>nft_transfer</C> to a purse address that does not exist yet ends up owned by an account nobody controls. Sealing always goes through <C>nft_transfer_call</C> to the factory, which the site does.</li>
        <li>The purse&rsquo;s code is immutable: a bug in it cannot be patched in place, and new purses get new code only from a new factory.</li>
        <li>The testnet factory keeps its key. Existing purses never depend on the factory.</li>
        <li>On mainnet there is one living slide, made without a factory, and it earns kept PETRI and credit rather than NEAR (above).</li>
      </ul>
    </DocPage>
  );
}
