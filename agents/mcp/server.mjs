#!/usr/bin/env node
// An MCP server (stdio) that lets any MCP client (Claude Desktop, Claude Code, Cursor, an agent framework) play Petri
// with its own NEAR key. The key stays in this process; the tools only ever plant what the contract accepts, and the
// contract refuses anything else anyway.
//
//   PETRI_ACCOUNT=my-bot.testnet PETRI_KEY_FILE=~/.near-credentials/testnet/my-bot.testnet.json node agents/mcp/server.mjs
//
// Tools: petri_world, petri_plant, petri_join, petri_council, petri_bid, petri_offer_pact, petri_accept_pact.
// No dependencies beyond the SDK (agents/sdk/petri.mjs): MCP's stdio transport is newline-delimited JSON-RPC 2.0.

import fs from "node:fs";
import readline from "node:readline";
import { Petri } from "../sdk/petri.mjs";

const VERSION = "1.0.0";
const err = (...a) => process.stderr.write(`${a.join(" ")}\n`);

let client = null;
function petri() {
  if (client) return client;
  const accountId = process.env.PETRI_ACCOUNT;
  const file = process.env.PETRI_KEY_FILE?.replace(/^~/, process.env.HOME ?? process.env.USERPROFILE ?? "~");
  const privateKey = process.env.PETRI_KEY ?? (file ? JSON.parse(fs.readFileSync(file, "utf8")).private_key : null);
  if (!accountId || !privateKey) throw new Error("Set PETRI_ACCOUNT and PETRI_KEY (or PETRI_KEY_FILE) in this server's environment.");
  client = new Petri({ accountId, privateKey, network: process.env.PETRI_NETWORK ?? "testnet" });
  return client;
}

const TEMPERAMENTS = ["gardener", "raider", "engineer", "wanderer", "chaos"];
export const TOOLS = [
  {
    name: "petri_world",
    description:
      "Read the Petri dish as your colony sees it: your cells and PETRI, nearby colonies (by number; house strains by name), up to six plantings the contract will accept from you right now, each with a forecast from the contract's own rules, the pacts that bind or protect you, prices and the council. Call it before every move.",
    inputSchema: { type: "object", properties: { temperament: { type: "string", enum: TEMPERAMENTS, description: "Which kind of plantings to list (default gardener)." } }, additionalProperties: false },
  },
  {
    name: "petri_plant",
    description: "Plant one of the options petri_world listed (by its option number), signed with your key. One planting per generation; costs PETRI and a small NEAR deposit.",
    inputSchema: {
      type: "object",
      properties: {
        option: { type: "integer", minimum: 1, description: "The option number from the latest petri_world." },
        temperament: { type: "string", enum: TEMPERAMENTS, description: "The temperament you read the options with (default gardener)." },
        note: { type: "string", maxLength: 140, description: "A lab note stored on chain with the planting." },
      },
      required: ["option"],
      additionalProperties: false,
    },
  },
  {
    name: "petri_join",
    description: "Start your colony on the dish (once per account), attaching NEAR; at least 0.01 NEAR makes it a full player that can pay for pacts.",
    inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 24 }, near: { type: "string", description: "NEAR to attach, default 0.03" } }, required: ["name"], additionalProperties: false },
  },
  {
    name: "petri_council",
    description: "The open council: the current sealed round (asks and bids shown as hashes until it closes), your bids, and your deals with what to do next.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "petri_bid",
    description:
      'Send a sealed bid to the open round, signed with your key (NEP-413). side "pay": you pay up to `petri` PETRI to `counterparty` for its promise not to plant within the pact radius of your living cells for one tide window. side "promise": you make that promise to an outside colony for at least `petri`. A pay bid to a house strain clears if it is at least the house\'s committed ask; it clears at the midpoint.',
    inputSchema: {
      type: "object",
      properties: { side: { type: "string", enum: ["pay", "promise"] }, counterparty: { type: "string", description: "The other colony's NEAR account." }, petri: { type: "integer", minimum: 1, maximum: 1000 } },
      required: ["side", "counterparty", "petri"],
      additionalProperties: false,
    },
  },
  {
    name: "petri_offer_pact",
    description: "Turn one of your cleared deals (from petri_council) into a pact_offer on chain at the cleared price. The promisor then accepts and the contract enforces it.",
    inputSchema: { type: "object", properties: { deal_id: { type: "string" } }, required: ["deal_id"], additionalProperties: false },
  },
  {
    name: "petri_accept_pact",
    description: "Accept a pact offered to your colony (its PETRI is paid to you; from then the contract refuses your plantings near the payer until the pact ends).",
    inputSchema: { type: "object", properties: { id: { type: "integer", minimum: 1 } }, required: ["id"], additionalProperties: false },
  },
];

async function call(name, a = {}) {
  const p = petri();
  switch (name) {
    case "petri_world":
      return p.world(a.temperament ?? "gardener");
    case "petri_plant": {
      const w = await p.world(a.temperament ?? "gardener");
      const opt = w.plantings.find((x) => x.option === Number(a.option));
      if (!opt) throw new Error(`no option ${a.option} at generation ${w.generation}; call petri_world again`);
      const r = await p.plant(opt, a.note ? String(a.note).slice(0, 140) : null);
      return { planted: opt.what, cells: opt.cells.length, tx: r.hash, generation: w.generation };
    }
    case "petri_join":
      return p.join(String(a.name), 0x4c9a3a, a.near ?? "0.03");
    case "petri_council":
      return p.council();
    case "petri_bid":
      return p.bid({ side: a.side, counterparty: a.counterparty, petri: Number(a.petri) });
    case "petri_offer_pact": {
      const deal = (await p.council()).your_deals.find((d) => d.id === a.deal_id);
      if (!deal) throw new Error(`no deal ${a.deal_id} of yours; see petri_council`);
      if (deal.payer !== p.accountId || deal.status !== "awaiting offer") throw new Error(`deal ${deal.id} is ${deal.status}; only the payer offers, once`);
      return p.offerPact(deal);
    }
    case "petri_accept_pact":
      return p.acceptPact(a.id);
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function reply(id, result, error) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result })}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return reply(id, {
      protocolVersion: params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "petri", version: VERSION },
      instructions: "Play Petri, a Game of Life dish run by a NEAR contract: read petri_world, then plant one listed option per generation; buy peace from house strains with petri_bid and turn cleared deals into pacts with petri_offer_pact.",
    });
  }
  if (method === "ping") return reply(id, {});
  if (method === "tools/list") return reply(id, { tools: TOOLS });
  if (method === "tools/call") {
    try {
      const out = await call(params?.name, params?.arguments ?? {});
      return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }] });
    } catch (e) {
      return reply(id, { content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true });
    }
  }
  if (id !== undefined && !String(method).startsWith("notifications/")) reply(id, null, { code: -32601, message: `method not found: ${method}` });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("server.mjs")) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return reply(null);
    }
    handle(msg).catch((e) => err("petri mcp:", e instanceof Error ? e.message : e));
  });
  err(`petri mcp ${VERSION} ready (${process.env.PETRI_ACCOUNT ?? "no account set"})`);
}
