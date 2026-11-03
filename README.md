<p align="center">
  <img src="docs/cover.png" alt="Petri: a coin that is alive. Conway's Life with owners, run by a NEAR contract." width="100%" />
</p>

<p align="center">
  <a href="https://petri-near.vercel.app"><img alt="Live demo" src="https://img.shields.io/badge/live-petri--near.vercel.app-f2b45a?style=flat-square&labelColor=120a05" /></a>
  <a href="https://testnet.nearblocks.io/address/petri-dish.testnet"><img alt="Contract" src="https://img.shields.io/badge/contract-petri--dish.testnet-9fd8a8?style=flat-square&labelColor=120a05" /></a>
  <img alt="Tests" src="https://img.shields.io/badge/tests-35%20passing-9fd8a8?style=flat-square&labelColor=120a05" />
  <img alt="Rust" src="https://img.shields.io/badge/rust-near--sdk%205.30-e2d5c3?style=flat-square&labelColor=120a05" />
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/licence-MIT-e2d5c3?style=flat-square&labelColor=120a05" /></a>
</p>

<p align="center">
  <b><a href="https://petri-near.vercel.app">Live dish</a></b> &nbsp;&nbsp;
  <b><a href="https://petri-near.vercel.app/dish">Play, no wallet</a></b> &nbsp;&nbsp;
  <b><a href="https://petri-near.vercel.app/verify">Replay from genesis</a></b> &nbsp;&nbsp;
  <b><a href="https://petri-near.vercel.app/rules">How it works</a></b> &nbsp;&nbsp;
  <b><a href="RULES.md">Full rules</a></b>
</p>

**Petri is a coin that is alive.** One shared 128×128 dish runs Conway's Game of Life inside a NEAR smart contract, and every living cell belongs to a real NEAR account. All 1,000,000 PETRI were minted once, into the dish's own balance, the *agar*. Every 15 seconds the agar feeds a sliver of itself to whatever is alive; bringing new cells to life costs PETRI, half of which is burned and half returned to the agar. Births join the colony that owns most of their parents, nobody may plant within three cells of a rival, so the only way to take ground is to send something that travels: gliders, spaceships, guns. Five AI strains play it around the clock with a model on NEAR AI Cloud, and the browser runs the very same Rust engine as the contract, so anyone can rebuild the entire history from the plant log and check it to the last unit.

Built for the NEAR HACKATHON (November 2026). Tracks: Memecoins with mechanics, Games with real economies, AI swarms, Open.

---

## Try it in two minutes

Each step says what to do and what you should see. Everything runs against the live contract on NEAR testnet.

1. **Watch the coin live.** Open <https://petri-near.vercel.app>. You see a close-up of glossy colonies drifting across the agar and a generation counter that advances every 15 seconds. Scroll: the view pulls back from one cell to the whole round dish.
2. **Start a colony with no wallet.** Open [/dish](https://petri-near.vercel.app/dish), type a name, pick a stain, press **Start my colony**. Within about ten seconds the panel shows your colony holding 64 PETRI (plus the keeper share if your join caught the dish up) and a link to the transaction. Your browser made a key; the site's relayer paid the gas with a NEP-366 meta transaction.
3. **Plant something.** Pick **Block** in the dock and click the dish. The stamp turns red inside a rival's hatched buffer; click anyway and it snaps to the nearest spot the contract will accept, or press **Find open agar**. Type a lab note and press **Plant**. The cells pulse until the chain confirms, then join the dish; the lab log shows your note, stored on chain.
4. **Rebuild the dish from nothing.** Open [/verify](https://petri-near.vercel.app/verify). In a few seconds your browser downloads every planting since generation 0, replays it with petri-core, and shows nine checks: the history chain, the board hash, every checkpoint, the agar, burned, returned and granted totals, each colony's lifetime earnings, and the living-cell count. All of them say **match**.
5. **Do the same from a terminal.** With Node 20 or later:
   ```bash
   git clone https://github.com/RohanGlitched/petri && cd petri
   node scripts/verify.mjs
   ```
   It prints `match` nine times and `Everything matches.`, and exits 0. Any mismatch exits 1.
6. **Read what the AI strains decided.** Open [/strains](https://petri-near.vercel.app/strains): each strain's temperament, its last move with the options it had, and its recent lab notes, each linked to its transaction and marked as chosen by the model or by the rules fallback.
7. **Run the tests.** With Rust installed:
   ```bash
   cargo test -p petri-core -p petri-contract
   ```
   15 engine tests (including property tests against a plain reference implementation of Life) and 20 contract tests (including conservation of every PETRI after every scenario) pass.

## How it works

| | |
|---|---|
| **The board** | 128×128 cells on a torus: every edge wraps. One generation every 15 seconds by the block clock. The contract catches up lazily: any join, plant or advance steps the dish to the present (up to 120 generations per call), and a keeper advances it when nobody else does. |
| **Life with owners** | Standard B3/S23 rules. A new cell takes the owner of the majority of its three parents; if all three belong to different colonies the birth is *contested* and does not happen. |
| **Planting** | Up to 64 cells, once per generation, on empty cells at least 3 cells from any rival's living cell. Price per cell = 2 PETRI × (1000 + living cells) / 1000, so the dish gets dearer as it fills. Half is burned, half returns to the agar. An optional 140-character lab note is stored with the planting. |
| **The coin** | NEP-141 (plus NEP-145 and NEP-148), 6 decimals, fixed supply of 1,000,000 minted into the agar at launch. Each generation the agar pays out 20 parts per million of its balance: 2% to whoever advanced the dish, the rest split across colonies by living cells. Joining grants 64 PETRI from the agar. Supply only falls. |
| **Proof** | Every 16th generation the board hash is folded into a history chain, `sha256(previous ‖ generation ‖ board hash)`; every 240th is stored as a checkpoint. Replaying the public plant log reproduces all of it. |

The parameters were chosen with a simulator of scripted societies (`sim/`); the full rules, methods and trade-offs are in [RULES.md](RULES.md) and on [/rules](https://petri-near.vercel.app/rules).

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI[Next.js site<br/>WebGL culture renderer]
    WASM[petri-core<br/>compiled to WASM]
    KEY[guest key<br/>in localStorage]
  end
  subgraph NEAR testnet
    C[petri-dish.testnet<br/>Rust contract + PETRI token]
  end
  subgraph Vercel
    R[relayer<br/>/api/guest, /api/relay]
  end
  subgraph VM
    K[keeper]
    S[5 AI strains]
  end
  AI[NEAR AI Cloud<br/>glm-5.3-flash in a TEE]
  CORE[(petri-core crate)]
  CORE --> C
  CORE --> WASM
  UI --> WASM
  UI -- view calls --> C
  KEY -- signed delegate action --> R -- pays gas --> C
  K -- advance --> C
  S -- choose among legal moves --> AI
  S -- plant with lab note --> C
```

- **One engine, three places.** `core/` is a `no_std` Rust crate: a bit-sliced Life step that does 64 cells per machine word and touches owners only where cells are born or die. The contract, the browser (via `wasm/`) and the simulator all call it, so they cannot disagree. A generation costs about 0.17 TGas on top of a 2.5 TGas base.
- **The renderer.** A WebGL2 shader turns the owner grid into stained colonies: a soft field over each neighbourhood, glossy domes lit from above, births swelling in and deaths fading over the next frame. The dish is a torus, so panning never ends.
- **Gasless play.** Guests get a sub-account of the relayer funded with 0.01 NEAR. Their calls are signed in the browser as NEP-366 delegate actions; the relayer submits only calls to the dish (join, plant, advance), with no deposit and bounded gas, under per-account and global rate limits.
- **The strains.** Code reads the dish with the same WASM, lists up to six legal plantings that suit the strain's temperament (gardener, raider, engineer, wanderer, chaos), and asks the model to pick one and write the note. Every answer's enclave signature is fetched and kept in the public action log. If the model is unavailable, the strain takes its first option and the log says so.

## Screens

| The play page | Verified from genesis |
|---|---|
| ![The play page: colony panel, stamp dock, loupe and lab log](docs/screens/dish.png) | ![The verify page after a full replay: everything matches](docs/screens/verify.png) |
| **Rules as live dishes** | **The coin as a nutrient cycle** |
| ![Three live rule demos running the real engine](docs/screens/rules-demos.png) | ![The agar cycle and the live ledger](docs/screens/coin.png) |
| **Colonies** | **AI strains** |
| ![The colonies ledger with territory maps](docs/screens/colonies.png) | ![The AI strains with their lab notes](docs/screens/strains.png) |

## Repository

| Path | What it is |
|---|---|
| `core/` | petri-core: the Life-with-owners engine, planting checks, price formula, history chain, patterns. 15 tests. |
| `contract/` | The NEAR contract: dish state, joins, plantings, catch-up and feeding, PETRI token (NEP-141/145/148), views. 20 tests. |
| `wasm/` | wasm-bindgen wrapper around petri-core for the browser and Node. |
| `sim/` | The economy simulator used to pick the launch parameters (`sim/out/summary.txt`). |
| `agents/` | The keeper and the five AI strains (Node), plus the read-only action-log window. |
| `web/` | The Next.js site: renderer, play page, verify, rules, colonies, strains, guest relayer. |
| `scripts/verify.mjs` | Replay the dish from genesis against the live contract, from a terminal. |
| `RULES.md` | The complete rules and economics, checked against the code. |

### Build it yourself

```bash
# engine and contract tests
cargo test -p petri-core -p petri-contract

# the contract (needs cargo-near)
cd contract && cargo near build non-reproducible-wasm

# the browser engine (needs wasm-pack)
cd wasm && wasm-pack build --target web --release

# the site
cd web && npm install && npm run dev        # http://localhost:3210
```

The site reads `NEXT_PUBLIC_NEAR_NETWORK` and `NEXT_PUBLIC_PETRI_CONTRACT`; the relayer needs `PETRI_RELAYER_ACCOUNT` and `PETRI_RELAYER_KEY` (see `web/src/app/api/`).

## Limits, honestly

- Petri runs on NEAR testnet. The contract, engine and site are network-agnostic; mainnet needs a funded relayer and a keeper.
- The keeper and the strains run on one small VM. If it stops, the dish still runs (any transaction catches it up) but fewer moves are made.
- The AI strains need NEAR AI Cloud credits. Without them they play by their written rules, and the public log marks every move with who decided it.
- Early colonies have an advantage: the agar is richest at the start and shrinks by about 0.002% a generation. The rising planting price and the buffer are the counterweights.
- Verification proves the board and balances follow from the plant log; it trusts the RPC provider you read the log from.

## Licence

MIT. See [LICENSE](LICENSE).
