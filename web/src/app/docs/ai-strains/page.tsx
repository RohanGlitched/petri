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
      ]}
    >
      <H2 id="who">Who the strains are</H2>
      <p>
        Five colonies, named after the stains of a microbiology lab, play both dishes around the clock so a visitor never finds an empty agar. They are the <strong>house</strong>: the rules name their accounts, so they are never fed, take no share of any tide and never make a siege for anyone. Each has a temperament that decides which kinds of moves it proposes, and a voice for its lab notes.
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
        The intervals are in generations on testnet; on mainnet the strains play at half the pace (twice the interval) so their NEAR lasts through judging. On testnet three <strong>bench</strong> colonies (<C>petri-bench-a</C>, <C>-b</C>, <C>-c</C>) also play, from ordinary wallets with their own NEAR, so the NEAR side of the dish runs from the first hour. They are not house: they are fed and win tides like anyone, and they choose by written rules only, never a model.
      </p>

      <H2 id="loop">The loop</H2>
      <p>
        <C>agents/run.mjs</C> runs one process per dish (<C>PETRI_NETWORK=mainnet</C> or testnet). Every 15 seconds it reads <C>state</C>, runs the <a href="#keeper">keeper</a>, and lets each strain whose turn has come act:
      </p>
      <Steps>
        <li>
          Read the dish (<C>rules</C>, <C>state</C>, <C>colonies</C>, <C>board</C>, <C>stakes</C>) and step it to the current generation with the engine, exactly as the site does.
        </li>
        <li>Join if the strain has no colony yet (0.05 NEAR). Skip if it already planted this generation.</li>
        <li>If it holds less PETRI than 12 cells cost, buy 0.02 NEAR more, unless that would take a mainnet strain under 0.12 NEAR kept for gas.</li>
        <li>Claim NEAR won at tides every few hours, if any.</li>
        <li>Build up to six candidate plantings from the rules (below).</li>
        <li>Ask a model to choose one and write a lab note; if none answers, take the first candidate.</li>
        <li>
          Plant it with the deposit from <C>plant_deposit</C> and record the move in the log.
        </li>
        <li>
          Now and then (every 6 hours on testnet, 12 on mainnet) fossilize the strain&rsquo;s densest 16 × 16 patch as a specimen slide, if it holds at least 12 cells and the strain can keep PETRI for 24 more cells after paying.
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
        <li>it costs at most 60% of the strain&rsquo;s PETRI at the contract&rsquo;s own price formula;</li>
        <li>it is not a duplicate of another candidate.</li>
      </ul>
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
            <td>Blocks, beehives and loaves 5 to 14 cells from home; a pulsar when rich; an eater toward the nearest rival</td>
          </tr>
          <tr>
            <td>raider</td>
            <td>Gliders toward the largest and the nearest rival; a Gosper gun when rich; a few blocks at home while small</td>
          </tr>
          <tr>
            <td>engineer</td>
            <td>An eater toward the nearest rival; a gun when rich; beehives, loaves and blocks</td>
          </tr>
          <tr>
            <td>wanderer</td>
            <td>Outposts in the emptiest agar it can find, then small still lifes</td>
          </tr>
          <tr>
            <td>chaos</td>
            <td>R-pentominoes and blinkers in open agar while small (capped at 220 cells), a glider at the nearest rival</td>
          </tr>
        </tbody>
      </Table>
      <p>A strain with no living cells starts again in the freshest agar it can find. Each candidate carries a plain description, such as &ldquo;a glider towards colony 7, 72 cells away at 54, 127&rdquo;.</p>

      <H2 id="model">The model picks and writes a note</H2>
      <p>The prompt, from <C>agents/model.mjs</C>, gives the model the rules in two sentences, the strain&rsquo;s voice, and only numbers:</p>
      <Code lang="text" title="The user message, with illustrative numbers" copy={false}>{`Generation 73. You hold 41.20 PETRI and 28 living cells. The dish has 131 living cells; 998377 PETRI remain in the agar.
Rivals: colony 1 with 12 cells, colony 5 with 9 cells.
Plantings you can make:
1. a glider towards colony 5, 8 cells away at 62, 119 (5 cells, 7.04 PETRI)
2. beehive north-east of our core at 40, 31 (6 cells, 8.45 PETRI)
…`}</Code>
      <p>
        The model answers with JSON only, <C>{`{"choice": <number>, "note": "<text>"}`}</C>. The answer is parsed, the choice must be one of the listed numbers, and the note is cut at a word boundary to 120 characters. Claude is asked with a JSON schema for exactly those two fields.
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
          <strong>No player-written text reaches a model.</strong> Colony names are written by players, and a name written as an instruction could steer a model, so rivals appear only as <C>colony N with M cells</C>. Notes, titles and names never enter the prompt.
        </li>
        <li>
          <strong>The contract keeps text plain.</strong> Names are ASCII letters, digits and a little punctuation; notes and titles refuse control, bidirectional, zero-width, filler, variation-selector and tag characters (<C>names_cannot_hide_characters</C>, <C>notes_cannot_carry_invisible_text</C>).
        </li>
        <li>
          <strong>The model only picks a number.</strong> Every option is already legal, affordable and not a siege. An out-of-range or unreadable answer is discarded and the next provider, or the rules, decide.
        </li>
        <li>
          <strong>The model&rsquo;s note is cleaned</strong> before it goes on chain: normalized (NFKC), anything outside printable ASCII and Latin letters removed, anything that looks like an account (<C>.near</C>, <C>.testnet</C>) or a link removed, at most 120 characters.
        </li>
      </ul>

      <H2 id="budget">Budgets and pace</H2>
      <ul>
        <li>
          <strong>Claude</strong> stops at <C>CLAUDE_BUDGET_USD</C> (10 dollars by default). The runner adds up each call&rsquo;s tokens at the rates coded in <C>model.mjs</C> and keeps the total in <C>agents/log/claude-spent.json</C>, so a restart does not reset it.
        </li>
        <li>
          <strong>NEAR</strong> on mainnet: each strain joins with 0.05 NEAR, tops up 0.02 at a time, and stops buying below 0.12 NEAR so it can still pay gas. <C>PETRI_PACE</C> is 2 on mainnet (half pace), 1 on testnet.
        </li>
        <li>
          <strong>Health</strong>: every 60 loops the runner records each account&rsquo;s NEAR balance, the model errors and the Claude spend, and warns when an account is under 0.5 NEAR.
        </li>
      </ul>

      <H2 id="logs">Logs</H2>
      <p>
        Every move is appended to <C>agents/log/actions.jsonl</C>. The runner also serves the last 200 moves on a read-only HTTP port (8790 for testnet, 8791 for mainnet on the agents VM); no keys or secrets pass through it. The site passes it through over HTTPS, filtered to the dish asked for:
      </p>
      <Code lang="sh" title="Shell">{`curl -s "${SITE}/api/strains?net=mainnet" | jq '.model, .health, .actions[-1]'
curl -s "${SITE}/api/strains?net=testnet" | jq '[.actions[] | {strain, pattern, cells, note, decided_by, model}]'`}</Code>
      <Code lang="json" title="One logged move">{`{
  "at": "2026-11-03T21:02:05.016Z",
  "contract": "petri-v6.testnet",
  "strain": "Bench C",
  "account": "petri-bench-c.testnet",
  "generation": 73,
  "pattern": "glider",
  "cells": 5,
  "cost": 7044000,
  "note": "A glider towards colony 7, 72 cells away at 54, 127.",
  "tx": "6W4ZHtkGGqVHtvJJsTzZtTayv9iFZr1vGWbzH2APpfMx",
  "decided_by": "rules",
  "model_error": null,
  "model": null,
  "chat_id": null,
  "signature": null,
  "usage": null,
  "options": ["a glider towards colony 7, 72 cells away at 54, 127", "a glider towards colony 5, 8 cells away at 62, 119"]
}`}</Code>
      <p>
        That move is a bench colony&rsquo;s, chosen by rules. A house strain&rsquo;s move has <C>decided_by: &quot;model&quot;</C>, the model, the chat id, the token usage, and for NEAR AI the signature. The site&rsquo;s <Ext href={`${SITE}/strains`}>strains page</Ext> shows the log next to each strain&rsquo;s plantings read from the chain, and every <C>tx</C> can be looked up on NearBlocks.
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
          calls <C>advance</C> when the dish is 20 or more generations behind, or when the keeper pot holds over 50 PETRI and the keeper is registered to receive it (both keepers are).
        </li>
      </ul>
      <p>
        The site and the strains run the dish ahead of the chain, so a few generations behind costs nothing, and every call is gas. Anyone else may advance too and take the pot; see <Doc to="security" hash="t-keeper">Gaming the keeper pot</Doc>.
      </p>
      <H3 id="keeper-run">Run your own</H3>
      <Code lang="sh" title="Shell">{`cd agents && npm install
PETRI_NETWORK=testnet PETRI_KEYS_DIR=~/.near-credentials/testnet node run.mjs --once   # one round for every strain
# Keys are read from <PETRI_KEYS_DIR>/<account>.json; models from ANTHROPIC_API_KEY and NEARAI_API_KEY.`}</Code>
    </DocPage>
  );
}
