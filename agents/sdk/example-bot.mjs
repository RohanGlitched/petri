// An outside agent in about sixty lines: it plays Petri with its own NEAR key and buys peace from the house.
//   PETRI_ACCOUNT=my-bot.testnet PETRI_KEY=ed25519:... node example-bot.mjs [--once]
// (or PETRI_KEY_FILE=~/.near-credentials/testnet/my-bot.testnet.json). Each turn it reads the world, plants the
// option whose forecast leaves it the most cells, and, when a house strain lives within 24 cells and no pact protects
// it from that strain yet, sends a sealed bid to pay it for peace. A cleared deal becomes a pact_offer; the house
// accepts on chain, and from then the contract refuses that strain's plantings near this colony.
import fs from "node:fs";
import { Petri } from "./petri.mjs";

const key = process.env.PETRI_KEY ?? JSON.parse(fs.readFileSync(process.env.PETRI_KEY_FILE, "utf8")).private_key;
const p = new Petri({ accountId: process.env.PETRI_ACCOUNT, privateKey: key, network: process.env.PETRI_NETWORK ?? "testnet" });
const BID = Number(process.env.PETRI_BID ?? "8");
const NEAR_CELLS = Number(process.env.PETRI_THREAT_CELLS ?? "24");
const say = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function turn() {
  let w = await p.world("wanderer");
  if (!w.you?.colony) {
    say("joining:", (await p.join(`Bot ${p.accountId.slice(0, 12)}`, 0x4c9a3a, "0.03")).hash);
    w = await p.world("wanderer");
  }
  say(`generation ${w.generation}: ${w.you.cells} cells, ${w.you.petri.toFixed(1)} PETRI, ${w.plantings.length} legal plantings`);
  const best = [...w.plantings].sort((a, b) => (b.forecast?.your_cells ?? 0) - (a.forecast?.your_cells ?? 0))[0];
  if (best) say(`planted ${best.what}:`, (await p.plant(best, "Planted by an outside agent.")).hash);

  const c = await p.council();
  for (const d of c.your_deals) {
    if (d.status === "awaiting offer" && d.payer === p.accountId) {
      const o = await p.offerPact(d);
      say(`deal ${d.id} cleared at ${d.price} PETRI: offered pact ${o.id} to ${d.promisor}`, o.hash);
    } else if (d.status === "offered" && d.promisor === p.accountId) {
      say(`accepted pact ${d.pact_id}:`, (await p.acceptPact(d.pact_id)).hash);
    }
  }
  const protectedFrom = new Set(w.pacts.protecting_you.map((x) => x.to));
  const threat = w.threats.find((t) => t.house && t.distance <= NEAR_CELLS && !protectedFrom.has(t.colony));
  const pending = c.your_bids.some((b) => b.counterparty === w.house.find((h) => h.colony === threat?.colony)?.account);
  if (threat && c.round && w.you.can_pay_for_pacts && !pending) {
    const house = w.house.find((h) => h.colony === threat.colony);
    const b = await p.bid({ side: "pay", counterparty: house.account, petri: BID, round: c.round.n });
    say(`sealed bid ${b.id} to ${house.name} (${threat.distance} cells away) in round ${b.round}; it closes at generation ${b.closes_generation}`);
  }
}

for (;;) {
  try {
    await turn();
  } catch (e) {
    say("error:", e.message);
  }
  if (process.argv.includes("--once")) break;
  await sleep(Number(process.env.PETRI_EVERY_S ?? "60") * 1000);
}
