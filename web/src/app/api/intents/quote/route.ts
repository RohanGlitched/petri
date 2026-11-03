// A 1Click quote that pays the mainnet dish. The browser chooses the asset, the amount, the refund address and what
// the NEAR is for; everything else is fixed here: wNEAR out, the dish as recipient, the exact-input swap, 1% slippage,
// refunds on the origin chain, and the deadline. A dry quote has no deposit address and commits to nothing.

import { isAccountId } from "@/lib/config";
import { ORIGINS, WNEAR, refundOk } from "@/lib/intents";
import { MAINNET_DISH, dishDeployed, fail, oneClick, paysTheDish, upstreamError } from "../oneclick";

export const dynamic = "force-dynamic";

// The contract's own rule for colony names (clean_name): 1 to 24 characters of letters, digits, spaces and a little
// punctuation, after runs of whitespace are folded to one space.
const NAME = /^[A-Za-z0-9 \-'.&!?_,:()]{1,24}$/;

// Ordinary addresses (the examples in 1Click's own API reference) so a dry quote can be priced before the payer has typed
// theirs; 1Click refuses burn and program addresses. Never used for a real quote.
const DRY_REFUND = { evm: "0x2527D02599Ba641c19FEa793cD0F167589a0f10D", sol: "13QkxhNMrTPxoCkRdYdJ65tFuwXPhL5gLS2Z5Nr6gjRK", btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq" };

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return fail(400, "Send the quote request as JSON.");
  const dry = b.dry === true;
  const origin = ORIGINS.find((o) => o.id === b.originAsset);
  if (!origin) return fail(400, "That asset is not offered here.");
  if (typeof b.amount !== "string" || !/^[1-9]\d{0,30}$/.test(b.amount)) return fail(400, "The amount must be a whole number of base units.");
  // A dry quote may be priced before the form is filled in; a real one needs every field.
  const forAccount = typeof b.for === "string" && b.for.trim() ? b.for.trim() : dry ? "preview.near" : "";
  if (!isAccountId(forAccount, "mainnet")) return fail(400, "Name the NEAR mainnet account that will own the colony.");
  if (b.do !== "join" && b.do !== "buy") return fail(400, "Say whether the NEAR joins the dish or buys PETRI.");
  let refundTo = typeof b.refundTo === "string" ? b.refundTo.trim() : "";
  if (refundTo && !refundOk(origin, refundTo)) return fail(400, `The refund address must be ${origin.address === "evm" ? "a 0x address" : origin.address === "sol" ? "a Solana address" : "a Bitcoin address"}.`);
  if (!refundTo) {
    if (!dry) return fail(400, "A real quote needs the refund address the swap pays back to if it fails.");
    refundTo = DRY_REFUND[origin.address];
  }

  const msg: Record<string, unknown> = { for: forAccount, do: b.do };
  if (b.do === "join") {
    const typed = typeof b.name === "string" ? b.name.split(/\s+/).filter(Boolean).join(" ") : "";
    const name = typed || (dry ? "Preview" : "");
    if (!NAME.test(name)) return fail(400, "A colony name is 1 to 24 letters, digits, spaces and - ' . & ! ? _ , : ( ).");
    if (dry && b.color === undefined) b.color = 0;
    if (typeof b.color !== "number" || !Number.isInteger(b.color) || b.color < 0 || b.color > 0xffffff) return fail(400, "The stain must be a colour 0xRRGGBB.");
    msg.name = name;
    msg.color = b.color;
  }

  const request = {
    dry,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: origin.id,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: WNEAR,
    amount: b.amount,
    refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: MAINNET_DISH,
    recipientType: "DESTINATION_CHAIN",
    customRecipientMsg: JSON.stringify(msg),
    deadline: new Date(Date.now() + origin.minutes * 60_000).toISOString(),
    referral: "petri",
  };

  if (!dry && !(await dishDeployed())) return fail(409, `${MAINNET_DISH} has no contract on NEAR mainnet yet, so no deposit address is given out.`);

  try {
    const { status, body } = await oneClick("/v0/quote", { method: "POST", body: JSON.stringify(request) });
    if (status !== 200 && status !== 201) return fail(status === 400 ? 400 : 502, upstreamError(body, status));
    // Check 1Click quoted what was asked before the browser shows anyone a deposit address.
    if (!paysTheDish(body)) return fail(502, "NEAR Intents returned a quote for a different recipient; it was not shown.");
    const q = body.quote as { depositAddress?: string } | undefined;
    if (!dry && !q?.depositAddress) return fail(502, "NEAR Intents returned no deposit address.");
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return fail(502, `NEAR Intents could not be reached: ${e instanceof Error ? e.message : String(e)}`);
  }
}
