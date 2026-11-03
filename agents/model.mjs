// The strains think with Claude Haiku, within a fixed dollar budget, and can also think with a model on NEAR AI Cloud
// that runs inside a TEE (each NEAR AI answer's signature is fetched so anyone can check the enclave produced it).
// Either model only chooses among moves the rules already accept and writes the lab note; the log says which model
// chose. If no model answers, the strains fall back to their first candidate.

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const KEY = process.env.NEARAI_API_KEY ?? "";
export const MODEL = process.env.NEARAI_MODEL ?? "z-ai/glm-5.3-flash";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-haiku-5-5";
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
// Dollars per token for Claude Haiku 5.5 (prompts under 100K tokens), and the most the strains may spend in total.
const PRICE_IN = 0.1 / 1e6;
const PRICE_OUT = 0.5 / 1e6;
const BUDGET = Number(process.env.CLAUDE_BUDGET_USD ?? "10");
const SPENT_FILE = new URL("./log/claude-spent.json", import.meta.url);
let spent = 0;
try {
  spent = Number(JSON.parse(fs.readFileSync(SPENT_FILE, "utf8")).usd) || 0;
} catch {
  /* nothing spent yet */
}
export const claudeSpent = () => spent;

const ORDER = (process.env.PETRI_MODELS ?? "claude,nearai").split(",").map((p) => p.trim());

export const hasModel = () => KEY.length > 0 || claude !== null;
export const modelName = () =>
  ORDER.map((p) => (p === "claude" ? claude && CLAUDE_MODEL : p === "nearai" ? KEY && MODEL : null)).filter(Boolean).join(" / ") || null;

let errors = 0;
let lastError = null;
export const modelErrors = () => errors;
export const lastModelError = () => (hasModel() ? lastError : "no model configured");

function prompt(strain, summary, cands) {
  const system = `You are ${strain.name}, a colony of cells living on a shared Petri dish run by a NEAR smart contract. ${strain.voice}
The dish follows Conway's Life. New cells join the colony owning most of their three parents. Every generation the agar feeds PETRI to living cells, but a colony is paid for at most a few living cells per cell it has planted. Planting costs PETRI; half is burned, half returns to the agar. Planting inside a rival's buffer is a siege and costs several times as much, so you never do it. Rivals are known only by number.
Choose exactly one of the numbered plantings, all of which the contract will accept. Then write a lab note of one or two short sentences, at most 100 characters in all, in your own voice, saying why. Answer with JSON only: {"choice": <number>, "note": "<text>"}.`;
  const user = `Generation ${summary.generation}. You hold ${summary.balance} PETRI and ${summary.myCells} living cells. The dish has ${summary.totalLive} living cells; ${summary.agar} PETRI remain in the agar.
Rivals: ${summary.rivals || "none yet"}.
Plantings you can make:
${cands.map((c, i) => `${i + 1}. ${c.why} (${c.cells.length} cells, ${c.costText} PETRI)`).join("\n")}`;
  return { system, user };
}

/** Returns { index, note, model, chatId, signature } or null when no model can answer. */
export async function choose(strain, summary, cands) {
  if (cands.length === 0) return null;
  lastError = null;
  // Providers in order (PETRI_MODELS="claude,nearai" by default): the first that answers chooses.
  const errs = [];
  for (const p of ORDER) {
    const pick = p === "claude" ? await chooseClaude(strain, summary, cands) : p === "nearai" && KEY ? await chooseNearAI(strain, summary, cands) : null;
    if (pick) return pick;
    if (lastError) errs.push(lastError);
    lastError = null;
  }
  lastError = errs.join("; ").slice(0, 240) || null;
  return null;
}

/** Picks a candidate from a model's JSON answer, or throws. */
function parsePick(text, cands) {
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const index = Number(json.choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= cands.length) throw new Error(`choice out of range: ${json.choice}`);
  let note = String(json.note ?? "").replace(/\s+/g, " ").trim();
  // Too long: keep whole sentences, or failing that whole words, and never leave a trailing ellipsis.
  if (note.length > 120) {
    const sentences = note.slice(0, 120).match(/^.*[.!?](?=\s|$)/);
    note = sentences ? sentences[0] : `${note.slice(0, 118).replace(/[\s,;:–—-]+\S*$/, "")}.`;
  }
  note = note.replace(/(\.\.+|…)$/, ".");
  return { index, note };
}

const PICK_SCHEMA = {
  type: "object",
  properties: { choice: { type: "integer" }, note: { type: "string" } },
  required: ["choice", "note"],
  additionalProperties: false,
};

async function chooseClaude(strain, summary, cands) {
  if (!claude) return null;
  if (spent >= BUDGET) {
    lastError = `Claude budget of $${BUDGET} spent`;
    return null;
  }
  const { system, user } = prompt(strain, summary, cands);
  try {
    const res = await claude.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: 400,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: PICK_SCHEMA } },
      },
      { timeout: 40_000 },
    );
    spent += res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT;
    try {
      fs.writeFileSync(SPENT_FILE, JSON.stringify({ usd: spent, at: new Date().toISOString() }));
    } catch {
      /* the budget still holds for this run */
    }
    if (res.stop_reason === "refusal") throw new Error("Claude declined");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const { index, note } = parsePick(text, cands);
    return { index, note, model: CLAUDE_MODEL, chatId: res.id, signature: null, usage: res.usage };
  } catch (e) {
    errors++;
    lastError = `Claude: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    console.error("model failed:", lastError);
    return null;
  }
}

async function chooseNearAI(strain, summary, cands) {
  const { system, user } = prompt(strain, summary, cands);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", "x-no-aliasing": "true" },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: 400,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const text = body.choices?.[0]?.message?.content ?? "";
    const { index, note } = parsePick(text, cands);
    let signature = null;
    try {
      const s = await fetch(`${BASE}/signature/${encodeURIComponent(body.id)}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`, {
        headers: { authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (s.ok) signature = await s.json();
    } catch {
      /* the move stands; the log says the signature is missing */
    }
    return { index, note, model: MODEL, chatId: body.id, signature, usage: body.usage ?? null };
  } catch (e) {
    errors++;
    lastError = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.error("model failed:", lastError);
    return null;
  }
}
