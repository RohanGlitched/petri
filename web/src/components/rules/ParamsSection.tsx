"use client";

import { useLive, int, near } from "@/lib/live";
import { REPO, fmtPetri } from "@/lib/config";
import { LAUNCH, nearPer } from "./shared";
import s from "./rules.module.css";
import { CONTRACT_VERSION, RELAUNCHED } from "@/lib/facts";

// sim/out-v5/summary.txt, as written by sim/src/main.rs on the rules in contract/launch-rules.json (7 days; 20 seeds at
// 15 players, 12 at 150, 10 at 1,500). Cash: NEAR actually withdrawn − NEAR actually paid, gas included, for the kind's
// mean player: [min, median, max] over seeds. These runs predate three launched changes: they paid 10% tides (now 5%),
// paid guests' winnings as NEAR their accounts could not move (now credit) and ran tides with nobody to pay (now
// skipped). They also predate v6, in which a keeper takes no keeper pot and no tide bounty. The fix experiments below
// include the 5% tide.
type Net = [number, number, number];
const KINDS: { kind: string; stake: string; net: [Net, Net, Net] }[] = [
  { kind: "Builder", stake: "0.05 NEAR to join, up to 0.25; still lifes near home", net: [[-0.3518, -0.2656, -0.158], [-0.2175, -0.1831, -0.1532], [-0.1125, -0.1094, -0.1048]] },
  { kind: "Raider", stake: "0.05 / 0.25; gliders at rivals, one move in three a siege", net: [[-0.3822, -0.2199, -0.0458], [-0.172, -0.1534, -0.1235], [-0.1375, -0.1256, -0.1177]] },
  { kind: "Defender", stake: "0.05 / 0.25; eaters and beehives", net: [[-0.3991, -0.2138, 0.0455], [-0.1961, -0.1603, -0.1287], [-0.0972, -0.0872, -0.08]] },
  { kind: "Methuselah", stake: "0.1 / 0.5; one R-pentomino an hour", net: [[-0.1226, 0.0184, 0.5127], [0.0859, 0.1419, 0.2322], [-0.046, -0.0407, -0.0299]] },
  { kind: "Late", stake: "0.05 / 0.25; a builder joining on day 2 or 3", net: [[-0.3788, -0.3216, -0.293], [-0.2901, -0.2682, -0.2389], [-0.1589, -0.1535, -0.1474]] },
  { kind: "Whale", stake: "2 NEAR in one colony, up to 3", net: [[-4.3044, -3.972, -2.4409], [-2.2991, -2.1219, -1.2462], [-1.0333, -0.9856, -0.9608]] },
  { kind: "Split whale", stake: "the same over 10 colonies (20 at 1,500)", net: [[-3.2665, -2.3855, -1.8794], [-1.6218, -1.3715, -0.9754], [-1.2742, -1.1381, -0.9858]] },
  { kind: "Sniper", stake: "0.05 / 0.25; plants just before tides, sells after", net: [[-0.1226, -0.0764, -0.0583], [-0.0899, -0.0658, -0.0621], [-0.0618, -0.0572, -0.0512]] },
  { kind: "Locker", stake: "1.5 / 2; a lattice of blocks putting every empty cell in its buffer", net: [[-1.3552, -0.894, 0.0029], [-0.8141, -0.5767, -0.1652], [0.186, 0.5901, 0.9459]] },
  { kind: "Racer", stake: "0.01; never plants, races to advance for the pot and bounty", net: [[-0.0651, -0.0526, -0.0429], [-0.0569, -0.0542, -0.0492], [-0.0651, -0.0611, -0.0579]] },
  { kind: "Seller", stake: "0.2; buys and sells back as fast as allowed", net: [[-0.1056, -0.1055, -0.1053], [-0.1059, -0.1055, -0.1048], [-0.1027, -0.1022, -0.0996]] },
  { kind: "Sybil guest", stake: "a wallet builder plus 10 relayer guests near it", net: [[-0.2795, -0.1639, 0.1146], [-0.191, -0.124, -0.0813], [-0.1325, -0.0986, -0.0916]] },
  { kind: "Self-sponsor", stake: "sponsors 10 of its own accounts with 0.05 each, then takes the credit back", net: [[-0.57, -0.4696, -0.3327], [-0.4766, -0.4205, -0.2522], [-0.3554, -0.3265, -0.2874]] },
  { kind: "House strain", stake: "the five strains, 1 NEAR budget each; never fed, no tide share", net: [[-1.0796, -1.0781, -1.0725], [-1.084, -1.081, -1.0783], [-1.1152, -1.1114, -1.1084]] },
];

// The fix experiments in sim/out-v5/fixes.txt: one rule changed at a time against the simulated launch rules, median cash.
const FIX_KINDS = ["Builder", "Methuselah", "Late", "Whale", "Split whale", "Locker", "Racer", "Seller"];
const FIXES: { society: string; rows: { rule: string; net: number[]; lock: number; launched?: boolean }[] }[] = [
  {
    society: "150 players",
    rows: [
      { rule: "The simulated launch rules (10% tides, keeper unregistered)", net: [-0.1831, 0.1419, -0.2682, -2.1219, -1.3715, -0.5767, -0.0542, -0.1055], lock: 5.8 },
      { rule: "Tides of 5% (launched)", net: [-0.1657, 0.2892, -0.2563, -2.0521, -1.6734, -1.2077, -0.0598, -0.1054], lock: 3.1, launched: true },
      { rule: "The team keeper registered, so it collects the pot (as v5 ran; a v6 keeper takes none)", net: [-0.1733, 0.1101, -0.2666, -1.7837, -1.2657, -0.4554, -0.0458, -0.1055], lock: 5.7 },
      { rule: "Stake keeps 80% at each tide, not 87.5%", net: [-0.1741, 0.1146, -0.2752, -1.8698, -1.3275, -0.5152, -0.0529, -0.1055], lock: 5.5 },
      { rule: "Reach 4", net: [-0.1798, 0.1109, -0.2643, -2.0632, -1.3949, -0.4439, -0.0537, -0.1055], lock: 5.3 },
      { rule: "Reach 2", net: [-0.1714, 0.074, -0.2691, -1.7583, -1.2875, -0.485, -0.0533, -0.1055], lock: 5.8 },
      { rule: "Siege ×2", net: [-0.1763, 0.1325, -0.2728, -2.1062, -1.3942, -0.5863, -0.0534, -0.1055], lock: 5.8 },
      { rule: "Sell-back at 30% of the curve", net: [-0.1785, 0.1289, -0.2717, -2.1011, -1.3294, -0.4961, -0.0515, -0.1441], lock: 4.8 },
    ],
  },
  {
    society: "1,500 players",
    rows: [
      { rule: "The simulated launch rules (10% tides, keeper unregistered)", net: [-0.1094, -0.0407, -0.1535, -0.9856, -1.1381, 0.5901, -0.0611, -0.1022], lock: 1.4 },
      { rule: "Tides of 5% (launched)", net: [-0.1098, -0.0443, -0.0995, -1.1898, -1.5392, -0.4506, -0.0695, -0.1025], lock: 0.7, launched: true },
      { rule: "The team keeper registered, so it collects the pot (as v5 ran; a v6 keeper takes none)", net: [-0.1089, -0.0356, -0.1528, -0.9974, -1.1549, 0.5901, -0.0189, -0.1022], lock: 1.4 },
      { rule: "Stake keeps 80% at each tide, not 87.5%", net: [-0.1086, -0.0384, -0.1535, -0.9971, -1.0824, 0.6376, -0.0614, -0.1022], lock: 1.4 },
      { rule: "Reach 4", net: [-0.1098, -0.0374, -0.151, -0.9879, -1.1019, 0.7034, -0.0602, -0.1022], lock: 1.4 },
      { rule: "Reach 2", net: [-0.1061, -0.0401, -0.1526, -0.9703, -1.1771, 0.6222, -0.0614, -0.1023], lock: 1.4 },
      { rule: "Siege ×2", net: [-0.1189, -0.0439, -0.1567, -0.976, -1.1521, 0.6128, -0.0596, -0.1021], lock: 1.4 },
      { rule: "Sell-back at 30% of the curve", net: [-0.0992, -0.0499, -0.1537, -1.1748, -1.0653, 0.389, -0.0459, -0.143], lock: 1.2 },
    ],
  },
];

// The newcomer with the carpet locker on the dish: a colony with no cells looking for its cheapest 2 × 2 block.
// Free spots are blocks it could plant at the normal price; with none free, the cheapest is a siege. mNEAR counts the
// block's PETRI at the buy price and its deposit.
const LOCKOUT: { society: string; rows: [string, string, string, string, string][] }[] = [
  {
    society: "15 players, 20 seeds",
    rows: [
      ["1 h", "0.3 (0.0–1.8)", "0.2 (0.0–1.1)", "3.86", "6.03"],
      ["6 h", "25.6 (2.2–40.5)", "19.5 (1.3–32.3)", "3.72", "5.64"],
      ["day 1", "32.3 (24.8–50.4)", "24.6 (18.3–41.6)", "3.62", "5.33"],
      ["day 7", "58.8 (46.5–63.8)", "51.4 (39.1–57.0)", "3.89", "6.15"],
    ],
  },
  {
    society: "150 players, 12 seeds",
    rows: [
      ["1 h", "2.5 (0.9–10.3)", "1.4 (0.4–6.5)", "3.71", "5.61"],
      ["6 h", "28.0 (16.6–36.1)", "20.5 (11.1–28.2)", "3.52", "5.05"],
      ["day 1", "21.7 (15.3–28.3)", "15.2 (9.5–21.0)", "3.41", "4.71"],
      ["day 7", "48.8 (39.5–60.6)", "41.5 (32.1–53.7)", "3.89", "6.15"],
    ],
  },
];

const EMPTY: [string, string, string, string][] = [
  ["Nobody at all, the team keeper advancing", "1,000,000", "0", "The keeper spent 3.18 NEAR of gas in 30 days."],
  ["Nobody at all, and nobody calls for 30 days", "1,000,000", "0", "One visit at day 30 skips 172,680 generations in a single Skip entry."],
  ["Only the five house strains, 1 NEAR each", "996,880", "0.27", "The house paid 5.39 NEAR; it is never fed, so no PETRI left the agar except what it bought."],
  ["Only the house, with no budget limit", "957,383", "29.22", "The house paid 75.59 NEAR, gas included; with nobody else to win it, the vault grew to 29.22."],
];

const CHANGES_V62: [string, string][] = [
  [
    "NEAR attaches at 0.01",
    "A colony attaches NEAR only when one join, buy or planting puts at least min_join (0.01 NEAR), net of storage, into the vault. Less goes to the vault but attaches nothing, so a yoctoNEAR on a call paid from credit no longer turns credit into NEAR. The site's 0.02 NEAR join nets about 0.0155 and still attaches.",
  ],
  [
    "Kept PETRI is paid in credit",
    "A colony is paid in NEAR only while it has attached NEAR and holds no kept PETRI. Otherwise its tide share and any bounty are credit, and claim pays out only its PETRI while its NEAR stays owed. A royalty paid out of kept PETRI goes to the agar: when the planter has not attached NEAR, or holds more kept PETRI than the planting costs, the whole royalty goes to the agar.",
  ],
  [
    "Pacts cannot jam a colony",
    "Every offer carries at least 1 PETRI unless both colonies are the house's, so guests, colonies holding kept PETRI and the house towards players cannot offer a pact. The cap of 8 counts only accepted pacts and the offers a colony made; offers waiting for a colony have their own cap of 16, which it empties by declining. A pact protects the payer's living cells as the board stands at each planting, cells planted after it was accepted included.",
  ],
  [
    "Dust wNEAR is refunded",
    "An amount of wNEAR no larger than what a pending record and its Pending entry cost is returned whole and writes nothing, so dust cannot grow the dish's storage. Amounts that cover their records are still never refunded.",
  ],
  [
    "A current dish, and small fixes",
    "sell and mint_slide need the dish to be current, as plant did; the site puts up to three advance calls ahead of the move when the dish lags, and the strains advance it first. A join runs the clock only if it attaches at least 0.01 NEAR, petri_for_near is exact for any deposit, and set_payout and rename are payable and charge the storage they add.",
  ],
  [
    "Sealed bids at the council",
    "The payer gives a sealed maximum bid and the promisor a sealed ask. An accepted offer is made at the open price; a declined one still clears at the midpoint of ask and bid if the ask is within the bid.",
  ],
  [
    "Started again",
    "Both dishes were relaunched in place with relaunch, which deleted everything v6.1 stored and started a fresh dish from generation 0. v6.2 moves balances, grants, pending NEAR and the cold pages to prefixes v6.1 never used (r, e, z, x), so nothing a wrong account list leaves behind can be read as v6.2 state.",
  ],
];

const CHANGES_V61: [string, string][] = [
  [
    "Gas at 30,000 colonies",
    "The hot table holds only the colonies that play now: those that earned since the last tide and those with living cells and a stake that can still earn, never the house, at most 10,000 rows and 32 leaving a call. The rest wait in 69-byte cold slots (pages of 32) whose stake decays lazily when read, and the catch-up stops at 110 TGas less what is still to write. In the simulator the hot rows fell from 17,102 to 1,336 on average, the largest call from 237 to 61 TGas, and calls over 150 TGas from 116,731 to 0.",
  ],
  [
    "Smaller ledger entries",
    "A tide entry is 130 bytes, not 289: it stores the chain, its bytes and its caller, and a replay works out the amounts, which a new tide event logs. PETRI amounts in entries are u64, a planting's fixed storage is 180 bytes (was 240) and a purchase's 113 (was 140).",
  ],
  [
    "Licences need 12 cells",
    "A planting under a slide's licence needs a slide that captured at least licence_min_cells (12). Smaller slides are keepsakes. In the simulator the royalty farmer's licensed plantings fell from 7,852 to 466 and its cash from +0.29 to +0.11 NEAR a week.",
  ],
  [
    "A guest's royalty goes to the agar",
    "A planter that has never attached NEAR pays its licence royalty to the agar, not to the holder, so free play cannot route PETRI to a wallet through royalties. In the simulator the sybil wallet's royalties from such planters fell from 56 to 0 PETRI.",
  ],
  [
    "The keeper pot goes to any caller",
    "The catch-up pays the pot to the account whose call ran at least one generation, whichever call it was, if the account can hold PETRI and is not a house account or keeper. In the simulator the pot left after a week fell from 1,480 to 1.1 PETRI on a young dish.",
  ],
  [
    "Site gas",
    "The site prepays 300 TGas for join, plant, buy, sell, claim, advance and mint_slide (unused gas is refunded), and the relay accepts up to 300.",
  ],
  [
    "Free play never reaches NEAR",
    "PETRI earned before a colony's first NEAR stays in the dish: a guest cannot send PETRI, and while a colony holds kept PETRI (what it earned or was paid in royalties before its first NEAR, and PETRI bought with credit) it cannot sell for NEAR, send PETRI or pay into a pact. Plantings and slides spend it first. In the simulator the vault's NEAR paid for farmed PETRI fell from 0.1674 to 0, and a transfer attack that drew +0.0470 NEAR a week per operator drew nothing. Guests also take no keeper pot.",
  ],
  [
    "Pacts the contract enforces",
    "The council's deals are pacts: pact_offer escrows the payer's PETRI, pact_accept pays it to the promisor, and until the pact ends the contract refuses every planting of the promisor within pact_radius (8) cells of the payer's living cells. A colony is party to at most 8 pacts; both replays rebuild and check every pact.",
  ],
  [
    "Started again",
    "Both dishes were relaunched in place with relaunch, which deleted everything v6 stored and started a fresh dish from generation 0. v6.1 keeps per-account data, cold pages, the hot table and the tide index under new key prefixes, so nothing a wrong account list leaves behind can be read as v6.1 state.",
  ],
];

const CHANGES_V6: [string, string][] = [
  [
    "Sponsored credit",
    "Credit is kept per sponsor: an account holds grants from at most 8 sponsors, spends what it won first and then the oldest grant, and a sponsor can take back only its own unspent grant, once a day of wall-clock time has passed since it last gave or the account last drew on it. A sponsorship brings at least 0.01 NEAR. In v5 one record held all of an account's credit, and whoever sponsored last could take all of it back.",
  ],
  [
    "The house",
    "House colonies never sell PETRI back, and house accounts (the strains and the keepers) can send PETRI only to other house accounts. A tide run by a house colony or a keeper pays no bounty: it stays in the vault. House accounts never take the keeper pot, and the house plants only slides it holds, so it never pays a royalty.",
  ],
  [
    "Gas as the dish grows",
    "Each colony's numbers live in cold pages of 64 colonies and in a hot table of the colonies that have stake. A join appends one slot; the feed, tides and decay touch only the hot table. (The simulator later showed that table still grew to 27,538 rows on a busy dish; v6.1 narrowed it, below.)",
  ],
  [
    "Paying with any token",
    "wNEAR is not refunded: any amount becomes pending NEAR for its account with its order, or goes to the vault with a Dust entry when it cannot pay for its own records (v6.2 refunds such an amount instead). Anyone can complete a waiting order with settle_pending, and intent_minimum tells the site the least a payment needs.",
  ],
  [
    "Names paid for by others",
    "A colony started by someone else's payment is named Culture and hex digits of its account's hash, in a colour from the same hash, and may rename once. Nobody can choose a name of that form.",
  ],
  [
    "Failed payouts",
    "A sale, claim, reclaim or pending claim whose transfer fails becomes pending NEAR for its account; only a failed bounty goes back to the vault. Each refund names the payout it refunds.",
  ],
  [
    "A ledger that rebuilds solvency",
    "Sponsorships, reclaims, claims, pending NEAR, dust and burns are ledger entries, so both replays rebuild every term of the solvency check from the ledger alone and compare each with the contract's own counter.",
  ],
  [
    "Slides that do something",
    "A slide is a pattern licence: planting its exact pattern, moved anywhere but not turned, costs 25% less, and anyone but the holder pays the holder 10% of that cost in PETRI. (v6.1 limits this to slides of 12 or more cells.)",
  ],
  [
    "Token standards",
    "PETRI refunded to a sender that unregistered meanwhile is burned, storage_unregister with force burns the balance (a colony's account cannot unregister), and nft_tokens draws at most 10 images a call.",
  ],
  [
    "Started again",
    "petri-dish.near was relaunched in place with relaunch, which deleted everything v5 stored and started a fresh dish from generation 0; the testnet dish moved to petri-v6.testnet.",
  ],
];

const CHANGES_V5: [string, string][] = [
  [
    "Free play and NEAR",
    "Sponsored credit spent in the dish now goes to its own credit pool, paid out at the tides only as credit. A colony that has never attached NEAR is paid its share of the vault, its sales and the bounties of tides it runs as credit too, and only a colony that has attached NEAR may name a payout account.",
  ],
  [
    "A pay cap that never shrank",
    "Stake: planting adds a cell of stake per cell, and every tide keeps 87.5% of it, so holding ground means planting again now and then. The reach went from 4 cells per cell planted to 8 per cell of stake.",
  ],
  [
    "Idle tides",
    "A tide with nobody to pay, because no colony outside the house earned since the last one, no longer runs: no entry, no storage, no decay.",
  ],
  [
    "Big tides and gas",
    "Tide winnings are kept in packed per-colony arrays, each read and written once per tide. In the simulator the biggest tide at 1,500 players fell from about 104 TGas to about 11.",
  ],
  [
    "Tides of 10%",
    "Tides of 5%. In the simulator it cut the carpet locker's share of all tide NEAR from 5.8% to 3.1% at 150 players.",
  ],
  [
    "A dish left alone for days",
    "When the dish is more than 480 generations behind, the clock skips ahead to 120 behind and writes a Skip entry, so the next caller does not pay for the quiet stretch.",
  ],
  [
    "Payouts that fail",
    "A failed claim is owed to the colony again; a failed sale or bounty goes back to the vault with a Refund entry, so the books still close.",
  ],
  [
    "Owing more than it holds",
    "The solvency view compares the contract's NEAR with everything it owes, and both replays check it.",
  ],
  [
    "New in v5",
    "Specimen slides (NFTs drawn on chain and checked by both replays), paying with any token through NEAR Intents, a one-time rename for colonies someone else paid for, house cells that never make a planting a siege, and sponsors that can take back credit left unused for a day. The same build runs on mainnet.",
  ],
];

const CHANGES_V3: [string, string][] = [
  [
    "The relayer attached the guest's deposits itself. A guest could sign calls that fail inside the contract, and each failure refunded the deposit to the guest, draining the relayer.",
    "The relayer relays only calls with no deposit. Guests pay from credit the relayer gives them on chain with sponsor, spendable only in the dish, and their keys are function-call keys for the dish, which cannot attach or move NEAR.",
  ],
  [
    "The guest proof of work was not bound to anything, so one solution could be replayed for many guests.",
    "A guest needs a challenge the server signed in the last ten minutes, an 18-bit proof of work bound to that challenge and its key, and the account name comes from the key: one guest per key.",
  ],
  [
    "The 15% cap counted living cells, so splitting into colonies just under the cap earned more.",
    "The reach: a colony is paid for at most a fixed number of living cells per cell it paid for (4 per cell planted then; 8 per cell of stake now), and the parts of a split never weigh more than the whole.",
  ],
  [
    "A carpet of blocks could put every empty cell inside someone's buffer and close the dish to newcomers.",
    "Sieges: planting inside a rival's buffer is allowed at 3× the price. Without siege, the simulated locker left no legal spot in 5 of 20 seeds; with it every seed has one.",
  ],
  [
    "Tides split by cells alive at the tide generation, so a colony planted just before a tide took a full share.",
    "Window tides: each tide splits by the PETRI each colony earned since the previous one.",
  ],
  [
    "advance paid the keeper pot even when it ran no generation.",
    "The pot is paid only by a call that ran at least one generation.",
  ],
  [
    "The strains' model read colony names, so a name written as an instruction could steer it.",
    "Rivals reach the model by number and size only, and names are plain ASCII; notes refuse hidden and tag characters.",
  ],
  [
    "NEAR moved through counters the replay could not rebuild.",
    "Every purchase, planting, sale and tide records its NEAR in the ledger, and the replay checks the vault, NEAR in, tide payouts and every colony's winnings.",
  ],
  [
    "The contract was not a reproducible build and the account kept a full-access key.",
    "Built with cargo near build reproducible-wasm, with NEP-330 metadata linking the commit; petri-dish.near has had no access key since 10 November 2026 (deleted after a final verify, tx Dsn8BxvX…), so its code can never change; the testnet dish keeps one for fixes, and the verifiers check the code hash.",
  ],
  [
    "The simulator's claims were ratios of PETRI earned to PETRI spent.",
    "Every result is now NEAR per player, cash and paper (PETRI held, valued at the sell-back price) reported apart.",
  ],
  [
    "On a sparse dish the price counted 1,000 cells but the whole ration went to the few alive, so early cells paid back far faster than the price assumed.",
    "The agar releases its ration for at least 1,000 counted cells and never more per cell; with fewer, it releases that fraction and keeps the rest.",
  ],
  [
    "The house strains were fed like players, so on a quiet dish they slowly ate the agar.",
    "House colonies are never fed and take no tide share; the NEAR they pay in goes to the other players.",
  ],
];

const sign = (x: number, dp = 3) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x).toFixed(dp)}`;

export function ParamsSection() {
  const { rules } = useLive();
  const r = rules ?? LAUNCH;
  const params: [string, string, string][] = [
    ["width × height", `${r.width} × ${r.height}`, "Cells on the dish, edges wrapped."],
    ["generation_ms", int(Number(r.generation_ms)), "Milliseconds between generations."],
    ["max_supply", `${fmtPetri(r.max_supply, 0)} PETRI`, "Minted once, into the agar."],
    ["feed_ppm", String(r.feed_ppm), "Parts per million of the agar fed to the living each generation."],
    ["keeper_bps", `${r.keeper_bps} (${r.keeper_bps / 100}%)`, "Share of the feed set aside in the keeper pot, paid to the account whose call ran the generation (never a house account, a keeper or a guest)."],
    ["reach", String(r.reach), "Most living cells a colony is paid for, per cell of stake."],
    ["stake_keep_bps", `${r.stake_keep_bps} (${r.stake_keep_bps / 100}%)`, "Share of every colony's stake left after each tide that runs."],
    ["burn_bps", `${r.burn_bps} (${r.burn_bps / 100}%)`, "Share of a planting burned; the rest returns to the agar."],
    ["payback", int(r.payback), "Generations of an average cell's feed that a cell costs."],
    ["min_cell_price", `${fmtPetri(r.min_cell_price)} PETRI`, "The lowest price of one cell."],
    ["live_floor", int(r.live_floor), "The agar releases its full ration only for at least this many counted cells, and prices count at least this many."],
    ["petri_price", `${nearPer(Number(r.petri_price))} NEAR`, "Launch price of one PETRI; the agar asks this × max supply ÷ agar."],
    ["min_join", `${near(Number(r.min_join), 2)} NEAR`, "The least NEAR a colony joins with."],
    ["cell_fee", `${near(Number(r.cell_fee), 4)} NEAR`, "NEAR per planted cell, on top of storage, to the tide vault (or the credit pool)."],
    ["tide_every", int(r.tide_every), "Generations between tides."],
    ["tide_bps", `${r.tide_bps} (${r.tide_bps / 100}%)`, "Share of the vault, and of the credit pool, paid out at each tide."],
    ["tide_bounty_bps", `${r.tide_bounty_bps} (${r.tide_bounty_bps / 100}%)`, "Share of a tide paid to the caller whose transaction runs it; none when that is a house colony or a keeper (it stays in the vault)."],
    ["max_bounty", `${near(Number(r.max_bounty), 3)} NEAR`, "The most a tide bounty pays."],
    ["sell_bps", `${r.sell_bps} (${r.sell_bps / 100}%)`, "Share of the curve's price the agar pays when it buys PETRI back."],
    ["sell_cap_bps", `${r.sell_cap_bps} (${r.sell_cap_bps / 100}%)`, "Most of the vault the agar buys back with between two tides."],
    ["siege_x", String(r.siege_x), "Price multiple of a planting inside a rival's buffer."],
    ["buffer", String(r.buffer), "Cells around a rival's live cell where a planting is a siege."],
    ["max_plant_cells", String(r.max_plant_cells), "Most cells in one planting."],
    ["max_catchup", String(r.max_catchup), "Most generations one call advances."],
    ["max_lag", String(r.max_lag), "Generations behind the clock past which the clock skips ahead to max_catchup behind."],
    ["slide_cells_price", `${fmtPetri(r.slide_cells_price)} PETRI`, "PETRI per captured cell a specimen slide burns."],
    ["slide_min_cells", String(r.slide_min_cells), "Fewest of its own living cells a slide must capture."],
    ["licence_min_cells", String(r.licence_min_cells ?? "none"), "Fewest cells a slide must have captured to be a licence. A smaller slide is a keepsake: a planting under it is refused."],
    ["slide_discount_bps", `${r.slide_discount_bps} (${r.slide_discount_bps / 100}%)`, "How much less a planting of a slide's exact pattern costs under its licence."],
    ["pact_radius", String(r.pact_radius ?? "none"), "Cells around the payer's living cells where a bound colony may not plant, for as long as a pact binds it."],
    ["pact_max_gens", String(r.pact_max_gens ?? "none"), "Most generations a pact can last beyond the dish's stored generation when it is offered."],
    ["slide_royalty_bps", `${r.slide_royalty_bps} (${r.slide_royalty_bps / 100}%)`, "Share of a licensed planting's cost that anyone but the slide's holder pays the holder, in PETRI (to the agar, from a planter that has not attached NEAR or holds more kept PETRI than the planting costs)."],
    ["wnear", r.wnear ?? "none", "The wNEAR contract whose transfers join or buy (pay with any token)."],
    ["house", r.house.join(", "), "The dish's own strains: never fed, no tide share, never sell, send PETRI only to other house accounts, take no tide bounty or keeper pot, and their cells never make a siege."],
    ["keepers", (r.keepers ?? []).join(", ") || "none", "The dish's keepers, house accounts too: no tide bounty, no keeper pot, and PETRI only to other house accounts."],
  ];
  return (
    <section id="parameters" data-section="Parameters and the simulator" className={`band ${s.section}`} aria-labelledby="params-title">
      <div className="wrap">
        <div className="section-head">
          <h2 id="params-title" className={s.h2}>How the parameters were chosen</h2>
          <p className="lede">
            The numbers are set once, when a dish starts, and no method changes them while it runs. The dish now runs {CONTRACT_VERSION} as
            petri-v6.testnet and, with the same build, as petri-dish.near on mainnet. Earlier testnet dishes (petri-dish.testnet,
            then petri-v2 to petri-v5) were left behind as reviews found problems; each time the rules were changed, tested, and
            launched on a new contract that started again from an empty board. petri-dish.near ran v5 first and was relaunched in
            place for v6, and both dishes were relaunched again for each release since, most recently for {CONTRACT_VERSION} on {RELAUNCHED}: the
            private relaunch method deleted everything the earlier version stored and started again from generation 0.
          </p>
        </div>

        <div className={s.paramsGrid}>
          <div className={s.prose}>
            <h3 className="h3">The simulator</h3>
            <p>
              <a className={s.link} href={`${REPO}/tree/main/sim`}>sim/src/main.rs</a> runs <code className={s.code}>petri-core</code>
              &rsquo;s own Life step, feed, reach on decaying stake, price, curve, sell-back, credit pool and window tides on a 128
              by 128 dish for 7 and 30 days, with 15, 150 and 1,500 scripted players, relayer guests and the five house strains,
              and counts every yoctoNEAR: what each player paid, gas included, and what it withdrew from tides, sales and
              bounties. It reads the launch rules from <code className={s.code}>contract/launch-rules.json</code>, but its
              published runs predate three launched changes: they paid 10% tides (now 5%), paid guests&rsquo; winnings in NEAR
              their accounts could not move (now credit), and ran tides with nobody to pay (now skipped). It estimates storage
              and gas rather than measuring them on chain. The runs also predate v6, in which a keeper takes no keeper pot and no
              tide bounty and the house cannot sell (the simulated house never sold), and v6.1; sim/out-v6.1 reruns v6.1's rules against v6's on the same seeds. The later releases were not simulated again.
            </p>
            <h3 className="h3">What the runs show</h3>
            <ul className={s.findings}>
              <li>
                Ordinary players lose a little NEAR: builders, raiders, defenders and late joiners end between −0.27 and −0.15
                NEAR at 150 players and −0.15 to −0.09 at 1,500 (medians, cash). Storage takes 37% to 44% of all the NEAR that
                comes in.
              </li>
              <li>
                The methuselah, one R-pentomino an hour, is the only kind ahead at 15 and 150 players (+0.02 and +0.14 NEAR), and
                behind at 1,500 (−0.04). With 5% tides, as launched, it made +0.29 at 150.
              </li>
              <li>
                The carpet locker lost at 15 and 150 players (−0.89, −0.58) and won at 1,500 (+0.59). With 5% tides it lost at
                both 150 and 1,500 (−1.21, −0.45). It is the biggest weakness the simulator found.
              </li>
              <li>
                Big stakes lose the most: the 2-NEAR whale ended −3.97, −2.12 and −0.99. Splitting the same NEAR over 10
                colonies lost less at 15 and 150 players and more at 1,500.
              </li>
              <li>
                Sybils do not pay: a builder with 10 relayer guests beside it ended −0.16, −0.12 and −0.10, and a player that
                sponsored 10 of its own accounts and took the credit back −0.47, −0.42 and −0.33.
              </li>
              <li>
                Snipers and racers lose a little (−0.08 to −0.05), sellers about −0.10. Each house strain costs the team about
                1.1 NEAR a week, paid to the other players.
              </li>
            </ul>
          </div>
          <div>
            <details className={s.fold}>
              <summary>
                What changed for v6.2 <small>{CHANGES_V62.length} changes, v6.1 to v6.2</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V62.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                What changed for v6.1 <small>{CHANGES_V61.length} changes, v6 to v6.1</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V61.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                What changed for v6 <small>{CHANGES_V6.length} changes, v5 to v6</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V6.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                What changed for v5 <small>{CHANGES_V5.length} changes, v4 to v5</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V5.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                What changed after the second review <small>{CHANGES_V3.length} findings, v2 to v4</small>
              </summary>
              <div className={s.foldBody}>
                <dl className={s.changeList}>
                  {CHANGES_V3.map(([was, now]) => (
                    <div key={was} className={s.change}>
                      <dt>{was}</dt>
                      <dd>{now}</dd>
                    </div>
                  ))}
                </dl>
                <p className="muted small">
                  The first review (v1 to v2) found free 64-PETRI grants that could be farmed, a cell price unrelated to what a
                  cell earns, a methuselah taking 45% of the dish, one log line per colony per catch-up (the dish would stop at
                  about 115 colonies), and a contract that could mint by sending PETRI to itself. v2 fixed those with the NEAR
                  buy-in, the payback price, accrued earnings and the self-call guard; the current dish keeps all of it.
                </p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                The dish&rsquo;s parameters, read now <small>{params.length} fields of rules</small>
              </summary>
              <div className={s.foldBody}>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Contract parameters">
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th scope="col">Field</th>
                        <th scope="col">Value</th>
                        <th scope="col">Meaning</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map(([k, val, m]) => (
                        <tr key={k}>
                          <th scope="row">
                            <code className={s.code}>{k}</code>
                          </th>
                          <td className="num">{val}</td>
                          <td className={s.cellDim}>{m}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  From the contract&rsquo;s <code className={s.code}>rules</code> view. Fixed in code: names of 1 to 24 ASCII
                  characters, notes of at most 140 characters, slide titles of at most 40, slides 4 to 32 cells a side, the
                  chain folded every 16 generations, catch-up stopping at 110 TGas less what is still to be written, sponsored credit reclaimable after 5,760
                  generations of wall-clock time unused (each sponsor its own grant, at most 8 sponsors an account, at least 0.01
                  NEAR a sponsorship), and wNEAR that pays for its own records never refunded (it waits as pending NEAR; an amount too small for its records is returned).
                </p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                Cash per player after 7 days <small>{KINDS.length} kinds, 3 societies</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  Median NEAR actually withdrawn minus NEAR actually paid, gas included, with the lowest and highest over seeds
                  below. PETRI still held, valued at the sell-back price, barely changes these. Relayer guests attach nothing
                  and withdraw nothing, so they are 0 by construction and left out. Run with 10% tides; the next table has 5%.
                </p>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Cash by kind of player">
                  <table className={`${s.table} ${s.simSmall}`}>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">15 players</th>
                        <th scope="col">150</th>
                        <th scope="col">1,500</th>
                      </tr>
                    </thead>
                    <tbody>
                      {KINDS.map((k) => (
                        <tr key={k.kind}>
                          <th scope="row">
                            {k.kind}
                            <span className={s.range}>{k.stake}</span>
                          </th>
                          {k.net.map(([lo, med, hi], i) => (
                            <td key={i} className={`num ${med > 0 ? s.pos : ""}`}>
                              {sign(med)}
                              <span className={s.range}>
                                {sign(lo, 2)} to {sign(hi, 2)}
                              </span>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                One rule changed at a time <small>median cash</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  Each row changes one rule against the simulated launch rules, on the same seeds. The dish runs with the
                  highlighted change. In v6 a keeper takes no pot, as in the runs where the keeper is unregistered. The last
                  column is the locker&rsquo;s share of all tide NEAR.
                </p>
                {FIXES.map((f) => (
                  <div key={f.society} className={s.tableWrap} tabIndex={0} role="region" aria-label={`Fix experiments, ${f.society}`}>
                    <table className={`${s.table} ${s.simTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">{f.society}</th>
                          {FIX_KINDS.map((k) => (
                            <th key={k} scope="col">{k}</th>
                          ))}
                          <th scope="col">Locker tides</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f.rows.map((row) => (
                          <tr key={row.rule} className={row.launched ? s.nowRow : undefined}>
                            <th scope="row">{row.rule}</th>
                            {row.net.map((x, i) => (
                              <td key={i} className="num">{sign(x)}</td>
                            ))}
                            <td className="num">{row.lock.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                A newcomer beside the carpet locker <small>its first block</small>
              </summary>
              <div className={s.foldBody}>
                <p>
                  The locker lays a lattice of blocks 8 cells apart at launch so every empty cell is inside its buffer. Free
                  cells and free 2 × 2 spots are where a newcomer could plant at the normal price (median, range); with none
                  free, its cheapest block is a siege. Without the locker, 94.8% of 2 × 2 spots are free after 1 h at 15 players.
                </p>
                {LOCKOUT.map((l) => (
                  <div key={l.society} className={s.tableWrap} tabIndex={0} role="region" aria-label={`Lockout, ${l.society}`}>
                    <table className={`${s.table} ${s.simTable}`}>
                      <thead>
                        <tr>
                          <th scope="col">{l.society}</th>
                          <th scope="col">Free cells %</th>
                          <th scope="col">Free 2 × 2 spots %</th>
                          <th scope="col">Cheapest block, mNEAR</th>
                          <th scope="col">Siege block, mNEAR</th>
                        </tr>
                      </thead>
                      <tbody>
                        {l.rows.map((row) => (
                          <tr key={row[0]}>
                            <th scope="row">{row[0]}</th>
                            {row.slice(1).map((c, i) => (
                              <td key={i} className="num">{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <p className="muted small">
                  After the first hour at 15 players, 9 of 20 seeds had no free 2 × 2 spot at all, but a siege block is always
                  legal, so no seed is ever without somewhere to plant.
                </p>
              </div>
            </details>
            <details className={s.fold}>
              <summary>
                A dish with no players, 30 days <small>{EMPTY.length} runs</small>
              </summary>
              <div className={s.foldBody}>
                <div className={s.tableWrap} tabIndex={0} role="region" aria-label="Zero-player runs">
                  <table className={`${s.table} ${s.simSmall}`}>
                    <thead>
                      <tr>
                        <th scope="col">Run</th>
                        <th scope="col">Agar after 30 days, PETRI</th>
                        <th scope="col">Vault, NEAR</th>
                        <th scope="col">What happened</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EMPTY.map((row) => (
                        <tr key={row[0]}>
                          <th scope="row">{row[0]}</th>
                          <td className="num">{row[1]}</td>
                          <td className="num">{row[2]}</td>
                          <td className={s.cellDim}>{row[3]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="muted small">
                  From <a className={s.link} href={`${REPO}/blob/main/sim/out-v5/summary.txt`}>sim/out-v5/summary.txt</a>. In
                  these runs the simulator still wrote a tide entry with nobody to pay, which the launched contract skips. The
                  scripted players follow fixed habits and do not adapt to prices, so the runs show how NEAR moves under each
                  rule set, not how people would change their play.
                </p>
              </div>
            </details>
          </div>
        </div>
      </div>
    </section>
  );
}
