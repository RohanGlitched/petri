// The strains think with Claude Haiku, within a fixed dollar budget, and can also think with a model on NEAR AI Cloud
// that runs inside a TEE (each NEAR AI answer's signature is fetched so anyone can check the enclave produced it).
// Either model only chooses among moves the rules already accept (and, at the council, among deals the rules can
// enforce) and writes the lab note; the log says which model chose. If no model answers, the strains fall back to
// their first candidate and the council does not sit.

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
const readSpent = () => {
  try {
    return Number(JSON.parse(fs.readFileSync(SPENT_FILE, "utf8")).usd) || 0;
  } catch {
    return 0;
  }
};
let spent = readSpent();
// Both dishes' agents share the one budget file, so each charge is added to what the file holds now.
function charge(usd) {
  spent = Math.max(spent, readSpent()) + usd;
  try {
    fs.writeFileSync(SPENT_FILE, JSON.stringify({ usd: spent, at: new Date().toISOString() }));
  } catch {
    /* the budget still holds for this run */
  }
}
export const claudeSpent = () => spent;
// Calls and tokens this process has used, by purpose (move, propose, answer), for the cost report.
const tally = {};
export const modelTally = () => tally;

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
The dish follows Conway's Life. New cells join the colony owning most of their three parents. Every generation the agar feeds PETRI to living cells outside the house; you are one of the dish's five house strains, which are never fed, so what you play for is living cells, territory, and what you do to the rivals. Planting costs PETRI; half is burned, half returns to the agar. Planting inside a rival's buffer is a siege and costs several times as much, so you never do it. Rivals outside the house are known only by number.
Each option comes with a forecast: the contract's own rules run ${summary.forecastGens} generations ahead on a copy of the dish as it is now (other players' future moves are unknown, so it can be wrong). Your memory shows what your past moves really did. Small still lifes are cheap and safe but change little; a glider gun, spaceship, eater wall or methuselah costs more and can change the dish. Choose a big play when its forecast earns it.
Promises from the house council are listed; an option marked [PACT] keeps one. Breaking a paid promise costs you trust at the next council.
Choose exactly one of the numbered plantings, all of which the contract will accept. Then write a lab note of one or two short sentences, at most 100 characters in all, in your own voice, saying why. Answer with JSON only: {"choice": <number>, "note": "<text>"}.`;
  const user = `Generation ${summary.generation}. You hold ${summary.balance} PETRI and ${summary.myCells} living cells. The dish has ${summary.totalLive} living cells; ${summary.agar} PETRI remain in the agar.
Rivals: ${summary.rivals || "none yet"}.
${summary.memory ?? "You have no moves on record yet."}
${summary.pacts ? `Council promises this window:\n${summary.pacts}\n` : ""}Plantings you can make:
${cands.map((c, i) => `${i + 1}. ${c.pact ? "[PACT] " : ""}${c.why} (${c.cells.length} cells, ${c.costText} PETRI) — ${c.forecastText ?? "no forecast"}`).join("\n")}`;
  return { system, user };
}

/** Returns { index, note, model, chatId, signature } or null when no model can answer. */
export async function choose(strain, summary, cands) {
  if (cands.length === 0) return null;
  const { system, user } = prompt(strain, summary, cands);
  const r = await askJson({ system, user, schema: PICK_SCHEMA, maxTokens: 400, purpose: "move" });
  if (!r) return null;
  try {
    const { index, note } = parsePick(r.json, cands);
    return { index, note, model: r.model, chatId: r.chatId, signature: r.signature, usage: r.usage };
  } catch (e) {
    errors++;
    lastError = `${r.model}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    return null;
  }
}

/** Picks a candidate from a model's JSON answer, or throws. */
function parsePick(json, cands) {
  const index = Number(json.choice) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= cands.length) throw new Error(`choice out of range: ${json.choice}`);
  return { index, note: trimNote(json.note) };
}

/**
 * A note of at most 100 characters: whole sentences, or failing that whole clauses, or failing that whole words, and
 * never a trailing ellipsis.
 */
export function trimNote(n) {
  let note = String(n ?? "").replace(/\s+/g, " ").trim();
  if (note.length > 100) {
    const head = note.slice(0, 100);
    const sentences = head.match(/^.*[.!?](?=\s|$)/);
    let clause = -1;
    for (const m of head.matchAll(/[,;:](?=\s)|\s[–—-](?=\s)/g)) if (m.index >= 40) clause = m.index;
    note = sentences ? sentences[0] : clause > 0 ? `${head.slice(0, clause)}.` : `${note.slice(0, 98).replace(/[\s,;:–—-]+\S*$/, "")}.`;
  }
  return note.replace(/(\.\.+|…)$/, ".");
}

const PICK_SCHEMA = {
  type: "object",
  properties: { choice: { type: "integer" }, note: { type: "string" } },
  required: ["choice", "note"],
  additionalProperties: false,
};

/**
 * Asks the providers in order (PETRI_MODELS="claude,nearai" by default) for a JSON answer matching `schema`; the first
 * that answers wins. Returns { json, model, chatId, signature, usage } or null (lastModelError() says why).
 */
export async function askJson({ system, user, schema, maxTokens = 400, purpose = "move" }) {
  lastError = null;
  const errs = [];
  for (const p of ORDER) {
    const r = p === "claude" ? await askClaude(system, user, schema, maxTokens) : p === "nearai" && KEY ? await askNearAI(system, user, maxTokens) : null;
    if (r) {
      const t = (tally[purpose] ??= { calls: 0, input: 0, output: 0 });
      t.calls++;
      t.input += r.usage?.input_tokens ?? r.usage?.prompt_tokens ?? 0;
      t.output += r.usage?.output_tokens ?? r.usage?.completion_tokens ?? 0;
      return r;
    }
    if (lastError) errs.push(lastError);
    lastError = null;
  }
  lastError = errs.join("; ").slice(0, 240) || null;
  return null;
}

const parseJson = (text) => JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));

async function askClaude(system, user, schema, maxTokens) {
  if (!claude) return null;
  if (spent >= BUDGET) {
    lastError = `Claude budget of $${BUDGET} spent`;
    return null;
  }
  try {
    const res = await claude.messages.create(
      {
        model: CLAUDE_MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema } },
      },
      { timeout: 40_000 },
    );
    charge(res.usage.input_tokens * PRICE_IN + res.usage.output_tokens * PRICE_OUT);
    if (res.stop_reason === "refusal") throw new Error("Claude declined");
    const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { json: parseJson(text), model: CLAUDE_MODEL, chatId: res.id, signature: null, usage: res.usage };
  } catch (e) {
    errors++;
    lastError = `Claude: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
    console.error("model failed:", lastError);
    return null;
  }
}

async function askNearAI(system, user, maxTokens) {
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
        max_tokens: maxTokens,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!res.ok) throw new Error(`NEAR AI ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const json = parseJson(body.choices?.[0]?.message?.content ?? "");
    let signature = null;
    try {
      const s = await fetch(`${BASE}/signature/${encodeURIComponent(body.id)}?model=${encodeURIComponent(MODEL)}&signing_algo=ecdsa`, {
        headers: { authorization: `Bearer ${KEY}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (s.ok) signature = await s.json();
    } catch {
      /* the answer stands; the log says the signature is missing */
    }
    return { json, model: MODEL, chatId: body.id, signature, usage: body.usage ?? null };
  } catch (e) {
    errors++;
    lastError = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.error("model failed:", lastError);
    return null;
  }
}
