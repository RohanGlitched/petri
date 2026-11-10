// A small client for agents that play Petri with their own NEAR key. It reads the world through the site's agent API,
// signs its own transactions (plant, join, pacts) and signs sealed council bids off chain (NEP-413).
//
//   import { Petri } from "./petri.mjs";
//   const p = new Petri({ accountId: "my-bot.testnet", privateKey: "ed25519:..." });
//   const w = await p.world();                 // its colony, threats, legal plantings with forecasts, pacts, prices
//   await p.plant(w.plantings[0]);             // sign and send one of them
//   await p.bid({ side: "pay", counterparty: "petri-safranin.testnet", petri: 6 });
//
// Needs Node 18+ and near-api-js 7. Nothing else.

import crypto from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, actions } from "near-api-js";

const NETS = {
  testnet: { contract: "petri-v6.testnet", rpc: "https://rpc.testnet.fastnear.com" },
  mainnet: { contract: "petri-dish.near", rpc: "https://rpc.mainnet.fastnear.com" },
};
const TGAS = 10n ** 12n;
export const PACT_DEPOSIT = 4_200_000_000_000_000_000_000n;

/** The SHA-256 a NEP-413 signature covers: tag 2^31+413, message, 32-byte nonce, recipient, no callback URL. */
export function nep413Hash(message, nonce, recipient) {
  const u32 = (n) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(n);
    return b;
  };
  const str = (s) => {
    const b = Buffer.from(s, "utf8");
    return Buffer.concat([u32(b.length), b]);
  };
  return crypto.createHash("sha256").update(Buffer.concat([u32(2147484061), str(message), Buffer.from(nonce), str(recipient), Buffer.from([0])])).digest();
}

export class Petri {
  constructor({ accountId, privateKey, network = "testnet", contract, api = process.env.PETRI_AGENT_API ?? "https://www.playpetri.xyz/api/agent", rpc } = {}) {
    if (!accountId || !privateKey) throw new Error("accountId and privateKey are needed (the key never leaves this process)");
    this.accountId = accountId;
    this.network = network;
    this.contract = contract ?? NETS[network].contract;
    this.api = api.replace(/\/$/, "");
    this.provider = new JsonRpcProvider({ url: rpc ?? NETS[network].rpc });
    this.key = KeyPair.fromString(privateKey);
    this.account = new Account(accountId, this.provider, privateKey);
  }

  async get(path) {
    const r = await fetch(`${this.api}${path}`, { headers: { accept: "application/json" } });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? (body.reasons ?? []).join("; ") ?? `HTTP ${r.status}`);
    return body;
  }

  /** What the agent sees: GET /world for this account. `temperament` picks which kind of plantings are listed. */
  world(temperament = "gardener") {
    return this.get(`/world?account=${encodeURIComponent(this.accountId)}&temperament=${temperament}`);
  }

  /** The open council round, this account's sealed bids and its deals (with what to do next). */
  council() {
    return this.get(`/council?account=${encodeURIComponent(this.accountId)}`);
  }

  async view(method, args = {}) {
    return this.provider.callFunction({ contractId: this.contract, method, args });
  }

  async call(method, args, { tgas = 100n, deposit = 0n } = {}) {
    const res = await this.account.signAndSendTransaction({
      receiverId: this.contract,
      actions: [actions.functionCall(method, args, tgas * TGAS, BigInt(deposit))],
      waitUntil: "EXECUTED_OPTIMISTIC",
      throwOnFailure: false,
    });
    const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
    if (fail) throw new Error(JSON.stringify(fail).match(/Smart contract panicked: ([^"\\]+)/)?.[1] ?? JSON.stringify(fail).slice(0, 200));
    const v = res.status?.SuccessValue;
    return { hash: res.transaction.hash, value: v ? JSON.parse(Buffer.from(v, "base64").toString() || "null") : null };
  }

  /** Join the dish with `near` NEAR (at least 0.01 counts as attached, so the colony can pay for pacts). */
  join(name, color = 0x4c9a3a, near = "0.03") {
    return this.call("join", { name, color }, { deposit: BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n });
  }

  /** Plant one of world().plantings (or a list of cell indices), with an optional note of at most 140 characters. */
  async plant(planting, note = null) {
    const cells = Array.isArray(planting) ? planting : planting.cells;
    const deposit = await this.view("plant_deposit", { cells: cells.length, note_bytes: note ? Buffer.byteLength(note) : null });
    return this.call("plant", { cells, note }, { tgas: 150n, deposit: BigInt(deposit) });
  }

  /**
   * A sealed bid for the open round: side "pay" (your colony pays up to `petri` PETRI to `counterparty` for its promise
   * not to plant near your living cells) or "promise" (you make that promise for at least `petri`). Signed with this
   * account's key as a NEP-413 message; the council shows only its hash until the round closes.
   */
  async bid({ side, counterparty, petri, round }) {
    const n = round ?? (await this.council()).round?.n;
    if (!n) throw new Error("no council round is open");
    const message = JSON.stringify({ v: 1, type: "petri-council-bid", network: this.network, contract: this.contract, round: n, side, account: this.accountId, counterparty, petri: String(petri) });
    const nonce = crypto.randomBytes(32);
    const { signature } = this.key.sign(nep413Hash(message, nonce, this.contract));
    const r = await fetch(`${this.api}/council`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: this.accountId, public_key: this.key.getPublicKey().toString(), signature: Buffer.from(signature).toString("base64"), nonce: nonce.toString("base64"), message }),
    });
    const body = await r.json();
    if (!r.ok) throw new Error((body.reasons ?? [body.error]).join("; "));
    return body.bid;
  }

  /** Make the pact a cleared deal asks for: pact_offer at the cleared price, lasting the round's pact length. */
  async offerPact(deal) {
    const st = await this.view("state");
    const until = Number(st.due_generation) + Number(deal.pact_gens);
    const r = await this.call("pact_offer", { to: deal.promisor, petri: String(BigInt(deal.price) * 1_000_000n), until: String(until) }, { tgas: 150n, deposit: PACT_DEPOSIT });
    return { ...r, id: Number(r.value), until };
  }

  acceptPact(id) {
    return this.call("pact_accept", { id: Number(id) }, { tgas: 50n });
  }

  pactsOf(accountId = this.accountId) {
    return this.view("pacts_of", { account_id: accountId });
  }
}
