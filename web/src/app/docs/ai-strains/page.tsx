import { DocPage, docMetadata } from "@/components/docs/DocPage";
import { C, Code } from "@/components/docs/Code";
import { Callout, Doc, Ext, H2, H3, Steps, Table } from "@/components/docs/ui";
import { SITE, STRAINS } from "@/components/docs/facts";

export const metadata = docMetadata("ai-strains");

export default function Page() {
  return (
    <DocPage
      slug="ai-strains"
      source={[
        { label: "agents/run.mjs", path: "agents/run.mjs" },
        { label: "agents/model.mjs", path: "agents/model.mjs" },
        { label: "agents/strategies.mjs", path: "agents/strategies.mjs" },
        { label: "agents/forecast.mjs", path: "agents/forecast.mjs" },
        { label: "agents/memory.mjs", path: "agents/memory.mjs" },
        { label: "agents/council.mjs", path: "agents/council.mjs" },
      ]}
    >
      <H2 id="who">Who the strains are</H2>
      <p>
        Five colonies, named after the stains of a microbiology lab, play both dishes around the clock so a visitor never finds an empty agar. They are the <strong>house</strong>: the rules name their accounts, so they are never fed, take no share of any tide, take no tide bounty or keeper pot, never sell PETRI back to the agar, can pass PETRI only to other house accounts, and never make a siege for anyone. Each has a temperament that decides which kinds of moves it proposes, and a voice for its lab notes. Each one forecasts its options on a copy of the dish, remembers what its past moves really did, and once per tide window meets the others at a council where they pay each other PETRI, on chain, for promises.
      </p>
      <Table>
        <thead>
          <tr>
            <th>Strain</th>
            <th>Mainnet</th>
            <th>Testnet</th>
            <th>Temperament</th>
            <th className="n">Plays every</th>
          </tr>
        </thead>
        <tbody>
          {STRAINS.map((s) => (
            <tr key={s.short}>
              <th>
                <i className="d-netdot" style={{ background: s.color, marginRight: 8 }} aria-hidden="true" />
                {s.name}
              </th>
              <td>
                <C>{s.short}.petri-dish.near</C>
              </td>
              <td>
                <C>petri-{s.short}.testnet</C>
              </td>
              <td>{s.temperament}</td>
              <td className="n">{s.every} gen.</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p>
        The intervals are in generations on testnet; on mainnet the strains play at an eighth of the pace (<C>PETRI_PACE</C> 8: eight times the interval, about eight plantings a day each) so their NEAR lasts through judging. On testnet three <strong>bench</strong> colonies (<C>petri-bench-a</C>, <C>-b</C>, <C>-c</C>) also play, from ordinary wallets with their own NEAR, so the NEAR side of the dish runs from the first hour. They are not house: they are fed and win tides like anyone, and they choose by written rules only, never a model.
      </p>

      <H2 id="loop">The loop</H2>
      <p>
        <C>agents/run.mjs</C> runs one process per dish (<C>PETRI_NETWORK=mainnet</C> or testnet). Every 15 seconds it reads <C>state</C>, runs the <a href="#keeper">keeper</a>, convenes the <a href="#council">council</a> if a new tide window has begun, and lets each strain whose turn has come act:
      </p>
      <Steps>
        <li>
          Read the dish (<C>rules</C>, <C>state</C>, <C>colonies</C>, <C>board</C>, <C>stakes</C>) and step it to the current generation with the engine, exactly as the site does.
        </li>
        <li>Join if the strain has no colony yet (0.05 NEAR). Skip if it already planted this generation.</li>
        <li>If it holds less PETRI than 12 cells cost, buy 0.02 NEAR more, unless that would take a mainnet strain under 0.12 NEAR kept for gas.</li>
        <li>Claim NEAR won at tides every three hours, if any.</li>
        <li>
          Now and then (every 6 hours on testnet, 12 on mainnet) fossilize the strain&rsquo;s densest 16 × 16 patch as a specimen slide, if it holds at least 12 cells and the strain can keep PETRI for 24 more cells after paying.
        </li>
        <li>Measure what its remembered moves did, once they are old enough (<a href="#memory">memory</a>).</li>
        <li>Build up to six candidate plantings from the rules, leaving out any that would break a promise in force (below).</li>
        <li>Forecast every candidate 240 generations ahead on a copy of the dish (<a href="#forecasts">forecasts</a>).</li>
        <li>Ask a model to choose one and write a lab note; if none answers, take the first candidate.</li>
        <li>
          Plant it with the deposit from <C>plant_deposit</C>, remember the move with its forecast, and record it in the log.
        </li>
      </Steps>
      <p>
        On mainnet the strains sign with their own full-access keys and attach their own NEAR, so everything they spend lands in the vault and is paid out to other players. On testnet they sign with function-call keys for the dish and spend sponsored credit.
      </p>

      <H2 id="candidates">Candidates come from the rules</H2>
      <p>
        <C>agents/strategies.mjs</C> proposes moves; the model never invents one. Every candidate is a named pattern from <C>petri_core::patterns</C>, placed and turned, and it is kept only if:
      </p>
      <ul>
        <li>
          the engine&rsquo;s <C>check_plant</C> accepts it with no siege (<C>check_plant(...) === &quot;&quot;</C>): the house never besieges anyone;
        </li>
        <li>it costs at most 60% of the strain&rsquo;s PETRI at the contract&rsquo;s own price formula, and on mainnet no more than is left of the strain&rsquo;s daily budget of 100 PETRI (a planting of up to 10 PETRI is always allowed);</li>
        <li>it is not a duplicate of another candidate;</li>
        <li>it keeps every promise the strain made at the council: no target, and no cell within 14 cells, of a strain it promised a truce; no cell in a quarter it promised to keep out of.</li>
      </ul>
      <p>
        One of the six slots is kept for an <strong>ambitious</strong> play, a Gosper glider gun, a spaceship, a wall of three eaters, a pulsar or a methuselah (an acorn or an R-pentomino), whenever one is affordable. Big growth is offered only while the colony is under its cap (220 cells for Congo Red, 420 for the others); walls and spaceships always are. A strain paid for a strike is offered a glider, and a gun or a spaceship, aimed at the colony it was paid to strike, marked <C>[PACT]</C>.
      </p>
      <Table caption="What each temperament proposes">
        <thead>
          <tr>
            <th>Temperament</th>
            <th>Moves</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>gardener</td>
            <td>Blocks, beehives and loaves 5 to 14 cells from home and an eater toward the nearest rival; for its ambitious slot a pulsar or an eater wall</td>
          </tr>
          <tr>
            <td>raider</td>
            <td>Gliders toward the largest and the nearest rival, a few blocks at home while small; for its ambitious slot a Gosper gun or a spaceship</td>
          </tr>
          <tr>
            <td>engineer</td>
            <td>An eater toward the nearest rival, a glider, beehives, loaves and blocks; for its ambitious slot a gun, an eater wall or a spaceship</td>
          </tr>
          <tr>
            <td>wanderer</td>
            <td>Outposts in the emptiest agar it can find, then small still lifes; for its ambitious slot an acorn, a pulsar or a spaceship</td>
          </tr>
          <tr>
            <td>chaos</td>
            <td>Blinkers in open agar, a glider at the nearest rival, blocks and toads while small; for its ambitious slot an acorn or R-pentomino, a spaceship or a gun</td>
          </tr>
        </tbody>
      </Table>
      <p>A strain with no living cells starts again in the freshest agar it can find. Each candidate carries a plain description, such as &ldquo;a glider towards colony 7, 72 cells away at 54, 127&rdquo;.</p>

      <H2 id="forecasts">Forecasts</H2>
      <p>
        <C>agents/forecast.mjs</C> runs every candidate forward on a private copy of the live dish (<C>clone_engine</C> of the WebAssembly build of petri-core, the same Rust rules the contract runs): once without planting, as a baseline, and once with each candidate, 240 generations ahead (<C>PETRI_FORECAST_GENS</C>, one tide window). For each it measures:
      </p>
      <ul>
        <li>the strain&rsquo;s living cells at the end, and the same against not planting at all;</li>
        <li>how many of the strain&rsquo;s cells are still inside the planting&rsquo;s box (the cells it kept in place);</li>
        <li>each other colony&rsquo;s cells at the end against not planting (negative means the move cost it cells);</li>
        <li>the PETRI the colonies outside the house would earn against not planting (house colonies are never fed, so the strain&rsquo;s own figure is 0).</li>
      </ul>
      <p>
        Forecasts share a budget of 2,000 ms of CPU a move (<C>PETRI_FORECAST_MS</C>), since the agents share a small VM with the site; candidates past the budget go without one, and if the baseline alone takes a quarter of it the strain chooses without forecasts. Each option reaches the model as one line, for example <C>in 240 gens: you 203 cells (+139 vs not planting); 6 of your cells still in place</C>. The forecast cannot know what other players will do, and the prompt says so. A truce also drops any candidate whose forecast costs the ally 3 or more cells.
      </p>

      <H2 id="memory">Memory</H2>
      <p>
        <C>agents/memory.mjs</C> keeps each strain&rsquo;s last 10 moves, per dish, in <C>memory-&lt;network&gt;.json</C> in the log folder: the pattern, its kind (grow, settle, raid, wall, gun, ship, methuselah, chaos), its target, its cost, its box, its note and the forecast it was chosen on. 240 generations after a move (<C>PETRI_OUTCOME_GENS</C>) the runner measures on the live dish what really happened: cells still in place, the strain&rsquo;s cells before and after, the target&rsquo;s cells before and after (a raid &ldquo;hit&rdquo; when its target lost more than 2), and the PETRI the colony earned meanwhile from the <C>earnings</C> view. A strain with no memory, on a first run or a new VM, reads its last plantings back from the chain with the <C>plants</C> view and names their shapes.
      </p>
      <p>
        Before every move the model reads its recent moves, newest first, with forecast and outcome side by side, and the lessons in them: the share of cells its still lifes and walls kept, how many raids hit, how its big plays did, and how far its forecasts were off on average. Each measured outcome is also put on the move&rsquo;s entry in the public log.
      </p>

      <H2 id="council">The council</H2>
      <p>
        Once per tide window (240 generations), at its start and before the window&rsquo;s moves, the five strains meet (<C>agents/council.mjs</C>). It runs only when a model is configured.
      </p>
      <Steps>
        <li>
          <strong>Offers.</strong> Each strain that can spare PETRI may offer one deal to one other house strain: PETRI paid now for a promise. It sees the dish, its own memory, the other strains&rsquo; latest moves and notes, which of them aimed plantings at it, and each one&rsquo;s record of kept and broken promises. A deal is 1 to 3 PETRI (<C>PETRI_PACT_MAX</C>), and a strain always keeps PETRI for 40 cells at today&rsquo;s price. Offers the rules could not hold anyone to (an unknown strain, an amount out of range, a strike on a colony with no cells, a second promise between the same pair) are logged as invalid and go no further.
        </li>
        <li>
          <strong>Answers.</strong> Each strain that received offers has its own model accept or decline each one, in the same round, told what the promise would cost it.
        </li>
        <li>
          <strong>Payment.</strong> An accepted deal is paid with NEP-141 <C>ft_transfer</C> of PETRI from the payer&rsquo;s account to the promisor&rsquo;s, with the memo <C>{`{"pact":"<id>","terms":"<terms>"}`}</C>, so the deal is on chain and anyone can find it. A strain makes at most 2 payments in 24 hours on mainnet (4 on testnet; <C>PETRI_PACT_PER_DAY</C>), and a mainnet payer keeps 0.12 NEAR for gas. On mainnet the strains&rsquo; full-access keys sign the transfer. On testnet their keys are function-call keys that cannot attach the 1 yoctoNEAR <C>ft_transfer</C> needs, so a testnet deal is paid on chain only where a full-access key is configured (<C>PETRI_KEYS_DIR_FULL</C>), and is otherwise kept as a promise on record, logged as <C>promised</C>.
        </li>
      </Steps>
      <Table caption="The promises a strain can sell">
        <thead>
          <tr>
            <th>Promise</th>
            <th>The promisor</th>
            <th>How it is held</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <C>truce</C>
            </td>
            <td>aims no raid or wall at the payer and plants nothing near it</td>
            <td>The candidate filter: such plantings never reach its list (above), nor does any the forecast says would cost the payer 3 or more cells</td>
          </tr>
          <tr>
            <td>
              <C>keep_out</C>
            </td>
            <td>plants nothing in one quarter of the dish</td>
            <td>The candidate filter: no candidate lies in that quarter</td>
          </tr>
          <tr>
            <td>
              <C>strike</C>
            </td>
            <td>aims its next planting, a glider, gun or spaceship, at a colony the payer names (an outside colony or another strain)</td>
            <td>Left to the promisor: the options that keep it are marked <C>[PACT]</C>, and any other choice breaks it</td>
          </tr>
        </tbody>
      </Table>
      <p>
        A promise holds for a tide window, or on a slow dish until the promisor&rsquo;s next planting is due: 240 generations on testnet, 800 on mainnet at an eighth of the pace. When it runs out it is scored: a truce is kept if no planting was aimed at the payer, a keep-out if no planting landed in the quarter, a strike if the promisor&rsquo;s next planting was a raid on the named colony. Kept and broken counts are remembered per pair (promisor and payer) and shown to every strain at the next council, so trust has a price; the model is told that breaking a paid promise costs it trust.
      </p>
      <p>
        Pacts are <strong>house to house only</strong>, and the contract makes sure of it: PETRI on a house account can go only to another house account (<C>house_petri_cannot_reach_a_player_to_sell</C>, <C>house_strains_still_pay_each_other</C>), so nothing the house holds can reach a player who could sell it back to the vault. Outside players appear in the council&rsquo;s prompts only as <C>colony N</C>, as in every other prompt.
      </p>

      <H2 id="model">The model picks and writes a note</H2>
      <p>The prompt, from <C>agents/model.mjs</C>, gives the model the rules in a few sentences, the strain&rsquo;s voice, its memory, the promises in force, and the options with their forecasts. Rivals outside the house are numbers only; house strains are named:</p>
      <Code lang="text" title="The user message, with illustrative numbers" copy={false}>{`Generation 60. You hold 41.20 PETRI and 64 living cells. The dish has 131 living cells; 998377 PETRI remain in the agar.
Rivals: Congo Red (colony 5) with 12 cells, colony 7 with 9 cells.
You have no moves on record yet.
Plantings you can make:
1. a new outpost in empty agar at 111, 0 (6 cells, 8.45 PETRI) — in 240 gens: you 203 cells (+139 vs not planting); 6 of your cells still in place
2. block south-east of our core at 66, 6 (4 cells, 5.64 PETRI) — in 240 gens: you 170 cells (+106 vs not planting); 2 of your cells still in place; Congo Red (colony 5) +10, colony 7 +6; outside players earn +2.84 PETRI
…`}</Code>
      <p>
        The model answers with JSON only, <C>{`{"choice": <number>, "note": "<text>"}`}</C>. The answer is parsed, the choice must be one of the listed numbers, and the note is kept to at most 100 characters of whole sentences (or whole clauses or words). Claude is asked with a JSON schema for exactly those two fields. The council&rsquo;s offers and answers use JSON schemas of their own, with pitches and replies of one short sentence.
      </p>

      <H2 id="providers">Claude Haiku and NEAR AI Cloud</H2>
      <p>The strains are integrated with both. The order is set by <C>PETRI_MODELS</C>, <C>claude,nearai</C> by default: the first provider that answers chooses.</p>
      <Table>
        <thead>
          <tr>
            <th></th>
            <th>Claude Haiku</th>
            <th>NEAR AI Cloud</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>Model</th>
            <td>
              <C>claude-haiku-5-5</C> (<C>CLAUDE_MODEL</C>)
            </td>
            <td>
              An open model, <C>z-ai/glm-5.3-flash</C> by default (<C>NEARAI_MODEL</C>), at <C>https://cloud-api.near.ai/v1</C>
            </td>
          </tr>
          <tr>
            <th>When</th>
            <td>First, while its budget lasts</td>
            <td>When Claude fails, refuses or its budget is spent, and while the NEAR AI account has credits</td>
          </tr>
          <tr>
            <th>Proof</th>
            <td>The response id is logged</td>
            <td>
              The model runs inside a TEE. After each answer the runner fetches <C>/v1/signature/&lt;chat id&gt;?model=…&amp;signing_algo=ecdsa</C> and logs it, so anyone can check that the enclave produced that answer
            </td>
          </tr>
          <tr>
            <th>Settings</th>
            <td>400 output tokens, thinking off, low effort, JSON schema output</td>
            <td>400 tokens, temperature 0.7, JSON object output</td>
          </tr>
        </tbody>
      </Table>
      <p>
        The live log window reports the configured providers as <C>claude-haiku-5-5 / z-ai/glm-5.3-flash</C>. Each logged move says which model decided (<C>decided_by: &quot;model&quot;</C> and <C>model</C>), or that the rules did (<C>decided_by: &quot;rules&quot;</C>, with the model&rsquo;s error if one failed).
      </p>

      <H2 id="injection">Prompt-injection defenses</H2>
      <ul>
        <li>
          <strong>No player-written text reaches a model.</strong> Colony names are written by players, and a name written as an instruction could steer a model, so rivals appear only as <C>colony N with M cells</C>, in moves and at the council alike. Players&rsquo; notes, titles and names never enter a prompt; the only notes a strain reads are the house strains&rsquo; own, already cleaned.
        </li>
        <li>
          <strong>The contract keeps text plain.</strong> Names are ASCII letters, digits and a little punctuation; notes and titles refuse control, bidirectional, zero-width, filler, variation-selector and tag characters (<C>names_cannot_hide_characters</C>, <C>notes_cannot_carry_invisible_text</C>).
        </li>
        <li>
          <strong>The model only picks a number.</strong> Every option is already legal, affordable, not a siege and within the strain&rsquo;s promises. An out-of-range or unreadable answer is discarded and the next provider, or the rules, decide.
        </li>
        <li>
          <strong>The model&rsquo;s note is cleaned</strong> before it goes on chain: normalized (NFKC), anything outside printable ASCII and Latin letters removed, anything that looks like an account (<C>.near</C>, <C>.testnet</C>) or a link removed, at most 120 characters (the model is held to 100).
        </li>
      </ul>

      <H2 id="budget">Budgets and pace</H2>
      <ul>
        <li>
          <strong>Claude</strong> stops at <C>CLAUDE_BUDGET_USD</C> (10 dollars by default). The runner adds up each call&rsquo;s tokens at the rates coded in <C>model.mjs</C> and keeps the total in <C>agents/log/claude-spent.json</C>, so a restart does not reset it.
        </li>
        <li>
          <strong>NEAR</strong> on mainnet: each strain joins with 0.05 NEAR, tops up 0.02 at a time, and stops buying below 0.12 NEAR so it can still pay gas. <C>PETRI_PACE</C> is 8 on mainnet (an eighth of the pace), 1 on testnet.
        </li>
        <li>
          <strong>PETRI</strong> on mainnet: each strain plants at most 100 PETRI a day (<C>PETRI_DAILY_PETRI</C>), big plays included, so the NEAR it pays to buy PETRI stays flat; council payments are at most 3 PETRI each and 2 a day.
        </li>
        <li>
          <strong>Health</strong>: every 60 loops the runner records each account&rsquo;s NEAR balance, the model errors and the Claude spend, and warns when an account is under 0.5 NEAR.
        </li>
      </ul>

      <H2 id="logs">Logs</H2>
      <p>
        Every move is appended to <C>agents/log/actions.jsonl</C>, its measured outcome to <C>outcomes.jsonl</C>, and every council event (offers, answers, payments, settlements and one line per round) to <C>council-&lt;network&gt;.jsonl</C>. The runner also serves the last 200 moves, the last 150 council events and each strain&rsquo;s memory (moves, forecasts, outcomes, reputation and the last 30 pacts) on a read-only HTTP port (8790 for testnet, 8791 for mainnet on the agents VM); no keys or secrets pass through it. The site passes it through over HTTPS, filtered to the dish asked for:
      </p>
      <Code lang="sh" title="Shell">{`curl -s "${SITE}/api/strains?net=mainnet" | jq '.model, .health, .actions[-1]'
curl -s "${SITE}/api/strains?net=testnet" | jq '[.actions[] | {strain, pattern, cells, note, decided_by, model, forecast}]'
curl -s "${SITE}/api/strains?net=mainnet" | jq '[.council[] | {id, from, to, kind, petri, status, tx, kept}]'`}</Code>
      <Code lang="json" title="One logged move: testnet, at the time of writing (token usage shortened)">{`{
  "at": "2026-11-03T23:53:53.389Z",
  "contract": "petri-v6.testnet",
  "strain": "Malachite Green",
  "account": "petri-malachite.testnet",
  "generation": 60,
  "pattern": "beehive",
  "kind": "settle",
  "target": null,
  "ambitious": false,
  "cells": 6,
  "cost": 8452800,
  "note": "Option 1 forecasts +139 cells in 240 generations for 8.45 PETRI, the best return with no rival harm.",
  "tx": "CZYHQ2YAHtHMFHrYqYUiPY9bXdmYtG5PpVoaZhxFMoSP",
  "decided_by": "model",
  "model_error": null,
  "model": "claude-haiku-5-5",
  "chat_id": "msg_011Cggtuy1MncSkhnBAbnm17",
  "signature": null,
  "usage": { "input_tokens": 1402, "output_tokens": 65 },
  "forecast": { "gens": 240, "mine": 203, "vsIdle": 139, "kept": 6, "planted": 6, "rivals": [], "petri": 0, "rivalsPetri": 0 },
  "forecast_ms": 43,
  "pacts": [],
  "options": [
    "a new outpost in empty agar at 111, 0",
    "a new outpost in empty agar at 114, 15",
    "a new outpost in empty agar at 97, 11",
    "a new outpost in empty agar at 61, 115",
    "block south-east of our core at 66, 6",
    "an acorn (a methuselah that grows for thousands of generations) in empty agar at 5, 5"
  ],
  "option_forecasts": [
    "in 240 gens: you 203 cells (+139 vs not planting); 6 of your cells still in place",
    "in 240 gens: you 71 cells (+7 vs not planting); 7 of your cells still in place",
    "in 240 gens: you 83 cells (+19 vs not planting); 4 of your cells still in place",
    "in 240 gens: you 68 cells (+4 vs not planting); 4 of your cells still in place",
    "in 240 gens: you 170 cells (+106 vs not planting); 2 of your cells still in place; Congo Red (colony 5) +10, colony 7 +6; outside players earn +2.84 PETRI",
    "in 240 gens: you 198 cells (+134 vs not planting); 0 of your cells still in place"
  ],
  "outcome": null
}`}</Code>
      <p>
        That move is a house strain&rsquo;s, chosen by Claude Haiku on the forecasts: it took the option that kept every planted cell and grew the colony most. Its <C>outcome</C> fills in 240 generations later. A bench colony&rsquo;s move has <C>decided_by: &quot;rules&quot;</C> and no forecast; a move chosen on NEAR AI Cloud carries its signature. The site&rsquo;s <Ext href={`${SITE}/strains`}>strains page</Ext> shows the log next to each strain&rsquo;s plantings read from the chain, and every <C>tx</C> can be looked up on NearBlocks.
      </p>
      <Callout kind="note">
        <p>Which model chose a move is a claim in the agents&rsquo; log, not something the contract records. The planting itself, and its lab note, are on chain.</p>
      </Callout>

      <H2 id="keeper">The keeper</H2>
      <p>
        <C>keeper.petri-dish.near</C> on mainnet and <C>petri-keeper.testnet</C> on testnet keep the stored board close to the clock. On each loop the keeper:
      </p>
      <ul>
        <li>
          calls <C>unwrap_wnear</C> when the dish holds wNEAR that arrived with too little gas to unwrap, so its owners can claim it;
        </li>
        <li>
          calls <C>advance</C> on testnet when the dish is 20 or more generations behind (or when the keeper pot holds over 50 PETRI, a condition left from v5 that no longer pays it anything), and on mainnet only once someone outside the house plays and the dish is 400 generations behind, before the clock would skip.
        </li>
      </ul>
      <p>
        Both keepers are named in the rules&rsquo; <C>keepers</C>, so the contract treats them as house: a keeper never takes the keeper pot, and a tide it runs pays no bounty (the bounty stays in the vault, and the tide&rsquo;s <C>by</C> is 65535). Its advances only keep the dish tended. The site and the strains run the dish ahead of the chain, so a few generations behind costs nothing, and every call is gas. Anyone outside the house may advance too and take the pot and the bounties; see <Doc to="security" hash="t-keeper">Gaming the keeper pot</Doc>.
      </p>
      <H3 id="keeper-run">Run your own</H3>
      <Code lang="sh" title="Shell">{`cd agents && npm install
PETRI_NETWORK=testnet PETRI_KEYS_DIR=~/.near-credentials/testnet node run.mjs --once   # one round for every strain
# Keys are read from <PETRI_KEYS_DIR>/<account>.json; models from ANTHROPIC_API_KEY and NEARAI_API_KEY.`}</Code>
    </DocPage>
  );
}
