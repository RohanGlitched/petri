// A real NEAR Intents join of the mainnet dish, end to end, from a team account (the keeper): first 1Click swaps a
// little NEAR into USDC on NEAR, then 1Click swaps that USDC into wNEAR delivered to the dish with a `join` order, as
// any payer from another chain would. Run inside WSL with the keeper's key:
//   PETRI_NETWORK=mainnet PETRI_KEYS_DIR=~/.near-credentials/mainnet node agents/intents-join-mainnet.mjs <step>
// Steps: wrap, quote-usdc, pay-usdc <depositAddress>, quote-join, pay-join <depositAddress>, status <depositAddress>.
import { actions } from "near-api-js";
import { account, rpc, view } from "./lib.mjs";

const API = "https://1click.chaindefuser.com";
const ME = process.env.PAYER ?? "keeper.petri-dish.near";
const DISH = "petri-dish.near";
const WNEAR = "nep141:wrap.near";
// The stablecoin leg: native USDC on NEAR by default; STABLE=usdt uses USDt when 1Click has no USDC route at the moment.
const USDC = process.env.STABLE === "usdt" ? "nep141:usdt.tether-token.near" : "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
const USDC_ACCOUNT = USDC.slice("nep141:".length);
const NEAR = 10n ** 24n;
const WRAP_YOCTO = (NEAR * 10n) / 100n; // 0.1 NEAR

async function rpcView(contract, method, args) {
  const r = await rpc("query", { request_type: "call_function", finality: "final", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}

async function call(receiverId, methodName, args, deposit = 0n, tgas = 100n) {
  const res = await account(ME).signAndSendTransaction({
    receiverId,
    actions: [actions.functionCall(methodName, args, tgas * 10n ** 12n, deposit)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  const fail = res.status?.Failure ?? res.receipts_outcome?.map((r) => r.outcome.status?.Failure).find(Boolean);
  console.log(methodName, "→", receiverId, res.transaction.hash, fail ? `FAILED ${JSON.stringify(fail).slice(0, 300)}` : "ok");
  if (fail) process.exit(1);
  return res;
}

async function quote(body) {
  const r = await fetch(`${API}/v0/quote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json();
  if (r.status !== 200 && r.status !== 201) {
    console.log("quote refused", r.status, JSON.stringify(j));
    process.exit(1);
  }
  const q = j.quote;
  console.log(JSON.stringify({ depositAddress: q.depositAddress, amountIn: q.amountIn, amountOut: q.amountOut, minAmountOut: q.minAmountOut, deadline: q.deadline, timeEstimate: q.timeEstimate }, null, 1));
  return q;
}

const deadline = () => new Date(Date.now() + 30 * 60_000).toISOString();
const [step, arg] = process.argv.slice(2);

switch (step) {
  case "wrap": {
    // wNEAR and USDC registrations for the payer (refunds and the USDC leg land here), then wrap 0.1 NEAR.
    for (const token of ["wrap.near", USDC_ACCOUNT]) {
      const reg = await rpcView(token, "storage_balance_of", { account_id: ME });
      if (!reg) await call(token, "storage_deposit", { account_id: ME, registration_only: true }, 125n * 10n ** 21n / 100n);
    }
    if (BigInt(await rpcView("wrap.near", "ft_balance_of", { account_id: ME })) < WRAP_YOCTO) await call("wrap.near", "near_deposit", {}, WRAP_YOCTO, 30n);
    console.log("wNEAR", await rpcView("wrap.near", "ft_balance_of", { account_id: ME }));
    break;
  }
  case "quote-usdc": {
    const amount = await rpcView("wrap.near", "ft_balance_of", { account_id: ME });
    await quote({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: WNEAR, depositType: "ORIGIN_CHAIN", destinationAsset: USDC, amount, refundTo: ME, refundType: "ORIGIN_CHAIN", recipient: ME, recipientType: "DESTINATION_CHAIN", deadline: deadline(), referral: "petri" });
    break;
  }
  case "pay-usdc": {
    const amount = await rpcView("wrap.near", "ft_balance_of", { account_id: ME });
    if (!(await rpcView("wrap.near", "storage_balance_of", { account_id: arg }))) await call("wrap.near", "storage_deposit", { account_id: arg, registration_only: true }, 125n * 10n ** 21n / 100n);
    await call("wrap.near", "ft_transfer", { receiver_id: arg, amount, memo: "petri: NEAR to USDC through 1Click" }, 1n, 30n);
    break;
  }
  case "quote-join": {
    const amount = await rpcView(USDC_ACCOUNT, "ft_balance_of", { account_id: ME });
    const need = BigInt(await view("intent_minimum", { what: "join", account_id: ME }));
    console.log("USDC (6 dp)", amount, "dish needs at least", need.toString(), "yocto wNEAR");
    const q = await quote({ dry: false, swapType: "EXACT_INPUT", slippageTolerance: 100, originAsset: USDC, depositType: "ORIGIN_CHAIN", destinationAsset: WNEAR, amount, refundTo: ME, refundType: "ORIGIN_CHAIN", recipient: DISH, recipientType: "DESTINATION_CHAIN", customRecipientMsg: JSON.stringify({ for: ME, do: "join" }), deadline: deadline(), referral: "petri" });
    if (BigInt(q.minAmountOut) < need) console.log("WARNING: the least this can deliver is below the dish's minimum; do not pay");
    break;
  }
  case "pay-join": {
    const amount = await rpcView(USDC_ACCOUNT, "ft_balance_of", { account_id: ME });
    if (!(await rpcView(USDC_ACCOUNT, "storage_balance_of", { account_id: arg }))) await call(USDC_ACCOUNT, "storage_deposit", { account_id: arg, registration_only: true }, 125n * 10n ** 21n / 100n);
    await call(USDC_ACCOUNT, "ft_transfer", { receiver_id: arg, amount, memo: "petri: USDC to a colony through 1Click" }, 1n, 30n);
    break;
  }
  case "status": {
    const r = await fetch(`${API}/v0/status?depositAddress=${encodeURIComponent(arg)}`);
    console.log(JSON.stringify(await r.json(), null, 1).slice(0, 2500));
    break;
  }
  default:
    console.log("steps: wrap | quote-usdc | pay-usdc <addr> | quote-join | pay-join <addr> | status <addr>");
}
