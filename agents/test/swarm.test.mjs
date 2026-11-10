// node --test test/   (from agents/)
import test from "node:test";
import assert from "node:assert/strict";

process.env.PETRI_SWARM_SECRET = "test-secret";
const { authorize, signRequest } = await import("../swarm/http.mjs");
const { councilView } = await import("../swarm/open-council.mjs");
const { nep413Hash } = await import("../swarm/nep413.mjs");

const req = (method, headers) => ({ method, headers, socket: { remoteAddress: "10.0.0.1" } });

test("a signed request passes once, with the client it signed", () => {
  const h = signRequest("test-secret", "GET", "/swarm/world?account=a.testnet", "", { client: "1.2.3.4" });
  const r = req("GET", h);
  assert.deepEqual(authorize(r, "/swarm/world?account=a.testnet", ""), { ok: true, client: "1.2.3.4" });
  assert.equal(authorize(r, "/swarm/world?account=a.testnet", "").ok, false, "replayed");
});

test("a changed client, path, body or secret fails", () => {
  const h = signRequest("test-secret", "POST", "/swarm/spawn", "{}", { client: "1.2.3.4" });
  assert.equal(authorize(req("POST", { ...h, "x-petri-client": "5.6.7.8" }), "/swarm/spawn", "{}").ok, false);
  const h2 = signRequest("test-secret", "POST", "/swarm/spawn", "{}", { client: "1.2.3.4" });
  assert.equal(authorize(req("POST", h2), "/swarm/topup", "{}").ok, false);
  const h3 = signRequest("test-secret", "POST", "/swarm/spawn", "{}", { client: "1.2.3.4" });
  assert.equal(authorize(req("POST", h3), "/swarm/spawn", '{"a":1}').ok, false);
  const h4 = signRequest("other", "POST", "/swarm/spawn", "{}", { client: "1.2.3.4" });
  assert.equal(authorize(req("POST", h4), "/swarm/spawn", "{}").ok, false);
});

test("an old timestamp or an unsigned client header is not trusted", () => {
  const h = signRequest("test-secret", "GET", "/swarm/world", "", { client: "1.2.3.4", ts: Date.now() - 120_000 });
  assert.equal(authorize(req("GET", h), "/swarm/world", "").ok, false);
  assert.deepEqual(authorize(req("GET", { "x-petri-client": "1.2.3.4" }), "/swarm/world", ""), { ok: false, client: null });
});

test("the council view shows commits, never another account's amounts", () => {
  const reg = {
    council: {
      rounds: [{ n: 3, status: "open", opened_generation: 1, closes_generation: 61, pact_gens: 240, formula: "f", asks: [], bids: [{ id: "b1", account: "a.testnet", side: "pay", counterparty: "petri-violet.testnet", petri: 17, commit: "c1", at: "t", nonce: "n", signature: "s", message: "m" }] }],
      deals: [],
    },
  };
  const v = councilView(reg, "a.testnet");
  const text = JSON.stringify(v);
  assert.equal(v.your_bids.length, 1);
  assert.equal(v.your_bids[0].commit, "c1");
  assert.ok(!("petri" in v.your_bids[0]));
  assert.ok(!text.includes("17"), "the amount must not appear anywhere in the view");
  assert.ok(!text.includes('"signature"') && !text.includes('"message"'));
});

test("NEP-413: a callbackUrl changes the signed hash", () => {
  const base = { message: "m", nonce: Buffer.alloc(32, 1), recipient: "petri-v6.testnet" };
  assert.notDeepEqual(nep413Hash(base), nep413Hash({ ...base, callbackUrl: "https://x.example" }));
  assert.deepEqual(nep413Hash(base), nep413Hash({ ...base, callbackUrl: null }));
});
