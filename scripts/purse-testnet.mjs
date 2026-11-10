// The living-slide transfer path, run for real on testnet: each threat-model case as a transaction that must go through
// or must be refused. Prints every transaction hash. Signs with the team's testnet keys (PETRI_KEYS_DIR).
//
//   node scripts/purse-testnet.mjs keys <token>...                     each purse has 0 access keys
//   node scripts/purse-testnet.mjs midpayout <token> <to>              T4: transfer right behind a claim is refused,
//                                                                      then goes through once the claim has landed
//   node scripts/purse-testnet.mjs handover <token> <old holder>       T1: the old holder is refused, the new one is paid
//   node scripts/purse-testnet.mjs sale <token> <buyer> <yocto>        T5: listed slide moves nothing; stale nonce
//                                                                      refused; the sale pays the seller exactly
//   node scripts/purse-testnet.mjs whitelist <token>                   T3/T8/T9: set_payout, sponsor, nft_approve refused

import { createHash } from "node:crypto";
import { account, failureText } from "../agents/lib.mjs";
import { accessKeys, act, actions, purseOf, send, status, viewAt } from "../agents/purse.mjs";

const T = 10n ** 12n;
const rows = [];
function row(what, r, want) {
  const ok = want === "refused" ? !!r.failed : !r.failed;
  rows.push({ what, tx: r.hash, result: r.failed ? `refused: ${r.failed}` : "went through", as_expected: ok });
  console.log(`${ok ? "ok  " : "FAIL"} ${what}\n     ${r.hash} ${r.failed ? `refused: ${r.failed}` : "went through"}`);
}

/** A signed transaction's hash: base58 of the sha256 of its borsh encoding. */
function txHash(signed) {
  const bytes = createHash("sha256").update(signed.transaction.encode()).digest();
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt("0x" + bytes.toString("hex"));
  let out = "";
  while (n > 0n) {
    out = A[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** The outcome of a transaction already sent, in the shape `send` returns. */
async function outcome(hash, signer) {
  const res = await account(signer).provider.viewTransactionStatus({ txHash: hash, accountId: signer, waitUntil: "FINAL" });
  const fail = [res.status, ...res.receipts_outcome.map((r) => r.outcome.status)].map((s) => s?.Failure).find(Boolean);
  return { hash, failed: fail ? failureText(fail) : null };
}

const [cmd, token, ...rest] = process.argv.slice(2);
const purse = purseOf(token);

if (cmd === "keys") {
  for (const t of [token, ...rest]) console.log(purseOf(t), "access keys:", (await accessKeys(purseOf(t))).length);
} else if (cmd === "midpayout") {
  const to = rest[0];
  const holder = (await viewAt(purse, "purse")).holder;
  const a = account(holder);
  // Both signed first (nonces n and n + 1) and broadcast together, so they land in the same block: the claim's call
  // reaches the purse first and takes off; the transfer comes right behind it, before the dish has answered.
  const claim = await a.createSignedTransaction({ receiverId: purse, actions: [actions.functionCall("act", { method: "claim", args: {} }, 200n * T, 0n)] });
  const transfer = await a.createSignedTransaction({ receiverId: purse, actions: [actions.functionCall("nft_transfer", { receiver_id: to, token_id: token }, 30n * T, 1n)] });
  const sent = await Promise.all([a.provider.sendTransactionAsync(claim), a.provider.sendTransactionAsync(transfer)]);
  if (sent.some((x) => x?.final_execution_status === undefined)) console.log(sent);
  console.log("claim", txHash(claim));
  await new Promise((ok) => setTimeout(ok, 8000));
  row("transfer while the purse's claim is in flight (T4)", await outcome(txHash(transfer), holder), "refused");
  await new Promise((ok) => setTimeout(ok, 6000));
  row("the same transfer once the claim has landed", await send(holder, purse, "nft_transfer", { receiver_id: to, token_id: token }, 1n, 30n), "ok");
} else if (cmd === "handover") {
  const old = rest[0];
  const st = await status(token);
  const holder = st.info.holder;
  row("old holder makes the purse claim (T1)", await send(old, purse, "act", { method: "claim", args: {} }, 0n, 200n), "refused");
  row("old holder withdraws NEAR (T1)", await send(old, purse, "withdraw", {}, 1n, 60n), "refused");
  row("old holder withdraws PETRI (T1)", await send(old, purse, "ft_withdraw", { amount: "1000" }, 1n, 80n), "refused");
  row("old holder transfers the token back (T1)", await send(old, purse, "nft_transfer", { receiver_id: old, token_id: token }, 1n, 30n), "refused");
  const petri = BigInt(st.petri) / 2n;
  if (petri > 0n) row(`new holder withdraws ${petri} PETRI units`, await send(holder, purse, "ft_withdraw", { amount: petri.toString() }, 1n, 80n), "ok");
  row("new holder withdraws 0.001 NEAR", await send(holder, purse, "withdraw", { amount: (10n ** 21n).toString() }, 1n, 60n), "ok");
} else if (cmd === "sale") {
  const [buyer, price] = rest;
  const seller = (await viewAt(purse, "purse")).holder;
  row("seller lists the slide", await send(seller, purse, "list", { price }, 1n, 30n), "ok");
  row("seller withdraws NEAR while listed (T5)", await send(seller, purse, "withdraw", {}, 1n, 60n), "refused");
  row("seller makes the purse claim while listed (T5)", await act(seller, token, "claim", {}, 0n, 200n), "refused");
  const seen = (await viewAt(purse, "purse")).nonce;
  row("seller unlists", await send(seller, purse, "unlist", {}, 1n, 30n), "ok");
  row("seller lists again", await send(seller, purse, "list", { price }, 1n, 30n), "ok");
  row("buyer pays with the nonce it saw before the change (T5)", await send(buyer, purse, "buy", { nonce: seen }, BigInt(price), 60n), "refused");
  const now = (await viewAt(purse, "purse")).nonce;
  row("buyer pays with the current nonce", await send(buyer, purse, "buy", { nonce: now }, BigInt(price), 60n), "ok");
  row("seller makes the purse claim after the sale (T1)", await send(seller, purse, "act", { method: "claim", args: {} }, 0n, 200n), "refused");
} else if (cmd === "whitelist") {
  const holder = (await viewAt(purse, "purse")).holder;
  for (const m of ["set_payout", "sponsor", "nft_approve", "ft_transfer", "pact_offer"])
    row(`holder asks the purse to call ${m} (T3/T8/T9)`, await send(holder, purse, "act", { method: m, args: {} }, 0n, 100n), "refused");
} else {
  console.log("usage: see the top of this file");
}
if (rows.length) console.log(JSON.stringify(rows));
