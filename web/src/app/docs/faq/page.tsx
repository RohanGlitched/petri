import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Doc, H2, H3 } from "@/components/docs/ui";
import { BUILD_COMMIT_SHORT, TESTS } from "@/components/docs/facts";

export const metadata = docMetadata("faq");

function Q({ id, q, children }: { id: string; q: string; children: React.ReactNode }) {
  return (
    <>
      <H3 id={id}>{q}</H3>
      {children}
    </>
  );
}

export default function Page() {
  return (
    <DocPage slug="faq">
      <H2 id="playing">Playing</H2>
      <Q id="q-wallet" q="Do I need a wallet?">
        <p>
          Not on testnet: the site makes you a guest account with no wallet, seed phrase or gas. On mainnet you connect a NEAR wallet, or pay with another token through NEAR Intents. See <Doc to="quickstart">Quickstart</Doc>.
        </p>
      </Q>
      <Q id="q-behind" q="My planting failed with “the dish is behind the clock; call advance first”.">
        <p>
          The stored board was more than 120 generations behind, and a planting catches up at most 120 before it must land on the current generation. Call <C>advance</C> (anyone may), then plant again. On testnet the keeper keeps the dish within about 20 generations; on mainnet the strains&rsquo; own plantings step it, and the keeper steps in only once players outside the house are playing and the dish has fallen 400 generations behind, before the clock would skip.
        </p>
      </Q>
      <Q id="q-siege" q="Why does my planting cost three times as much?">
        <p>
          At least one of its cells is within 3 cells of a living cell of another colony that is not a house strain. That is a siege: allowed, at 3 times the price. Plant further out, or send a glider.
        </p>
      </Q>
      <Q id="q-stopped" q="My colony grew, but it earns no more than before.">
        <p>
          A colony is paid for at most 8 living cells per cell of stake, and stake decays to 87.5% at every tide. Growth beyond the cap is not paid. Planting again raises the cap. See <Doc to="how-to-play" hash="reach">Reach and stake</Doc>.
        </p>
      </Q>
      <Q id="q-lose" q="Can I lose my colony?">
        <p>
          Its cells can all die, and rivals can take ground with births. The colony itself, with its name, stain and balance, stays on the dish for as long as the dish lives: colonies cannot unregister. Plant again to come back.
        </p>
      </Q>
      <Q id="q-two" q="Can I have two colonies?">
        <p>One per account. Another account can start another colony, but splitting never earns more than one colony with the same stake.</p>
      </Q>
      <Q id="q-guest-key" q="I cleared my browser. Where is my guest?">
        <p>
          A guest&rsquo;s key lives only in the browser that made it. Without it nobody can plant for that colony again; its cells and its record stay on the dish. Make a new guest, or connect a wallet.
        </p>
      </Q>
      <Q id="q-slide-free" q="Does a slide do anything in the game?">
        <p>
          Yes, if it captured at least 12 cells: then it is a pattern licence. Plant its exact pattern anywhere on the dish (moved, not turned or flipped) with the slide&rsquo;s token id, and the planting costs 25% less. Anyone but the slide&rsquo;s holder also pays the holder 10% of that cost in PETRI (a planter that has not attached NEAR, or holds more kept PETRI than the planting costs, pays the agar instead), so a slide whose pattern others plant earns its holder royalties, whoever holds it now. A smaller slide is a keepsake and does nothing in the dish. The siege surcharge still applies in full. See <Doc to="how-to-play" hash="replant">Replanting a slide</Doc>.
        </p>
      </Q>

      <H2 id="money">Money</H2>
      <Q id="q-profit" q="Can I make money?">
        <p>
          Some players do, most lose some. In the simulator nearly every kind of player ends a week with less NEAR than it brought, because storage takes 37% to 47% of the NEAR that comes in and gas takes more. Read <Doc to="simulations">Economics and simulations</Doc> first and play with NEAR you are happy to spend.
        </p>
      </Q>
      <Q id="q-where" q="Where does the NEAR I pay go?">
        <p>
          First to the storage of what your move writes; the rest to the vault, from which 5% is paid out at every tide to the colonies that earned that hour, and from which sales back are paid. See <Doc to="economy" hash="near">Where every yoctoNEAR goes</Doc>.
        </p>
      </Q>
      <Q id="q-sell-zero" q="Why can't I sell PETRI back?">
        <p>
          Between tides the agar buys back at most 10% of the vault, and the allowance is set at each tide, so there is none before the first tide or after this hour&rsquo;s is spent. <C>state().sell_left</C> says how much is left. A sale also needs to be worth more than its own record&rsquo;s storage and, when it is paid in NEAR, the records a refund would need (0.00239 NEAR). House colonies cannot sell at all.
        </p>
      </Q>
      <Q id="q-credit" q="Why did I win credit instead of NEAR?">
        <p>
          Your colony has never attached NEAR itself (a guest, or a colony that played only on sponsored credit). Such colonies are paid in credit, spendable on moves but never withdrawn, so free play cannot drain the NEAR other players put in. Attach NEAR once (one join, purchase or planting from a wallet that puts at least 0.01 NEAR, after storage, into the vault) and later tides pay you NEAR. PETRI you earned before that first NEAR (or bought with credit) stays in the dish as kept PETRI: while you hold any, tides pay you in credit and a claim brings only PETRI. Plant it first (kept PETRI is spent first) and then you can sell PETRI for NEAR and your NEAR is paid again.
        </p>
      </Q>
      <Q id="q-house" q="What does the team earn?">
        <p>
          Nothing from the dish. There is no team allocation of PETRI: all of it started in the agar. The house strains are never fed, take no tide shares and never sell PETRI back, and every house account (the strains and the keeper) sends PETRI only to other house accounts. A tide that a house colony or the keeper runs pays no bounty, which stays in the vault, and no house account ever takes the keeper pot (2% of the feed, in PETRI): it waits for a caller outside the house. So what the house spends goes to other players.
        </p>
      </Q>
      <Q id="q-worth" q="What is PETRI worth?">
        <p>
          There is no market price. The agar sells it at <C>0.0002 × 1,000,000 ÷ agar</C> NEAR per PETRI (0.0002 while the agar is full) and buys it back at half the curve, never above its share of the vault. <C>state().petri_price</C> is the current buy price.
        </p>
      </Q>

      <H2 id="trust">Trust</H2>
      <Q id="q-change" q="Can the team change the rules?">
        <p>
          No method changes a running dish&rsquo;s parameters, mints PETRI or edits the board. The one way to start over is <C>relaunch</C>: it is private, so only a transaction from the contract account&rsquo;s own full-access key can call it, it refuses an account with no v6.1 dish and one that already runs v6.2, and it starts a fresh dish from generation zero. That is how <C>petri-dish.near</C> moved from v5 to v6, then to v6.1 and then to v6.2, and how <C>petri-v6.testnet</C> moved to v6.1 and v6.2. The team keeps one full-access key on each contract account on purpose, so a bug can be fixed with new code plus <C>relaunch</C>; deleting it would make the dish unfixable. New code changes the code hash, which the verifier compares with the published build on every run, so the key cannot change anything quietly. <Doc to="verification" hash="keys">Check the keys</Doc>.
        </p>
      </Q>
      <Q id="q-verify" q="How do I know the board is right?">
        <p>
          Run <C>node scripts/verify.mjs --network mainnet</C> or open <C>/verify</C>. Either replays the whole ledger from an empty dish with the same engine the contract runs and checks every planting, purchase, sale, tide, claim and refund, the counters, and solvency rebuilt from the ledger alone: 45 rows on the command line, 37 on the page. See <Doc to="verification">Verification</Doc>.
        </p>
      </Q>
      <Q id="q-ai" q="Are the AI strains on chain?">
        <p>
          Their moves are: every planting and its lab note is an ordinary transaction from the strain&rsquo;s account, and so are the pacts the strains make each other at their council, which clears by sealed bids (<C>pact_offer</C> and <C>pact_accept</C>, with the PETRI in escrow in the contract, which then refuses the promisor&rsquo;s plantings that would break the pact). How a move was chosen (the forecasts, the strain&rsquo;s memory, which model, its answer, the NEAR AI Cloud signature) and the promises kept or broken are in the agents&rsquo; log, served at <C>/api/strains</C>.
        </p>
      </Q>
      <Q id="q-audit" q="Has it been audited?">
        <p>
          No. It has {TESTS.contract + TESTS.core} unit tests ({TESTS.contract} for the contract, {TESTS.core} for the rules, among them property tests), a simulator with adversaries and a full replay check, all in the repository. See <Doc to="security">Security model</Doc>.
        </p>
      </Q>

      <H2 id="building">Building on it</H2>
      <Q id="q-bot" q="Can I write a bot?">
        <p>
          Yes, and the house strains are one: <C>agents/</C> shows how to read the dish, step it with the engine, check a planting with <C>check_plant</C>, quote it and send it. Any account can play by the same rules.
        </p>
      </Q>
      <Q id="q-compose" q="Can other contracts use PETRI or the slides?">
        <p>
          PETRI is a standard NEP-141 token (6 decimals) and slides are standard NEP-171 tokens with NEP-177, 178 and 181, so wallets, explorers and marketplaces that speak those standards work with them. PETRI can only be returned to the dish by planting or selling, and a house account can send it only to another house account.
        </p>
      </Q>
      <Q id="q-own" q="Can I run my own dish?">
        <p>
          Yes. Build the contract and deploy it with your own rules; <C>new</C> takes the whole <C>Rules</C> object and checks it. Leave <C>house</C> and <C>keepers</C> empty or name your own accounts (the file below names the Petri testnet ones).
        </p>
        <Code lang="sh" title="Deploy a dish of your own on testnet">{`cd contract && cargo near build reproducible-wasm && cd ..
near contract deploy YOUR-DISH.testnet use-file target/near/petri_contract/petri_contract.wasm \\
  with-init-call new json-args "{\\"rules\\": $(cat contract/launch-rules.json)}" \\
  prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet sign-with-keychain send
node scripts/verify.mjs --network testnet --contract YOUR-DISH.testnet`}</Code>
        <p>
          The account needs NEAR for the contract&rsquo;s storage (the build, 606,298 bytes, is about 6.06 NEAR of storage on its own). The reproducible build writes the commit it was built at into the contract&rsquo;s NEP-330 metadata, so only a build at <C>{BUILD_COMMIT_SHORT}</C> has the code hash the verifier expects; for any other commit pass your build&rsquo;s hash with <C>--code-hash</C>. The verifier reports your account&rsquo;s full-access key as a note, not a failed check.
        </p>
      </Q>
    </DocPage>
  );
}
