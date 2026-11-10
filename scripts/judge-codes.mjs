#!/usr/bin/env node
// Prints the judge codes for free mainnet play: each opens one of the places held for judges (PETRI_MAINNET_JUDGE_PLACES,
// 25 by default) on /dish's mainnet start card. A code is `petri-<n>-<8 hex>`, the hex the start of
// HMAC-SHA256(secret, "petri-judge:<n>"), exactly as web/src/lib/guest-program.ts checks it, so the site's server needs
// only the same secret in PETRI_JUDGE_CODE_SECRET. Nothing is stored anywhere.
//
//   PETRI_JUDGE_CODE_SECRET=<secret> node scripts/judge-codes.mjs [count, default 30] [--from <n>, default 1]
//   node scripts/judge-codes.mjs --new-secret       # prints a fresh random secret to put in the server's environment
//
// Paste the codes into the submission text for judges. A judge's guest is marked on chain (its sponsorship carries one
// extra yoctoNEAR), so the site counts the judge places taken from the dish's own ledger.

import { createHmac, randomBytes } from "node:crypto";

const args = process.argv.slice(2);
if (args.includes("--new-secret")) {
  console.log(randomBytes(32).toString("hex"));
  process.exit(0);
}
const secret = process.env.PETRI_JUDGE_CODE_SECRET?.trim();
if (!secret) {
  console.error("Set PETRI_JUDGE_CODE_SECRET (the same value as the site's server), or run with --new-secret to make one.");
  process.exit(2);
}
const fromAt = args.indexOf("--from");
const from = fromAt >= 0 ? Number(args[fromAt + 1]) : 1;
const count = Number(args.find((a, i) => /^\d+$/.test(a) && args[i - 1] !== "--from") ?? 30);
if (!Number.isInteger(from) || from < 0 || !Number.isInteger(count) || count < 1 || from + count > 10_000) {
  console.error("Usage: node scripts/judge-codes.mjs [count] [--from <n>]   (codes are numbered 0 to 9999)");
  process.exit(2);
}

export const judgeCode = (s, n) => `petri-${n}-${createHmac("sha256", s).update(`petri-judge:${n}`).digest("hex").slice(0, 8)}`;

for (let n = from; n < from + count; n++) console.log(judgeCode(secret, n));
