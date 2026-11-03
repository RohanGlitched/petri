// The strains think with a model on NEAR AI Cloud that runs inside a TEE. The model only chooses among moves the
// rules already accept and writes the lab note; every answer's signature is fetched so anyone can check that the
// enclave produced it. Without a key the strains fall back to their first candidate and say so in the note.

const BASE = process.env.NEARAI_BASE_URL ?? "https://cloud-api.near.ai/v1";
const KEY = process.env.NEARAI_API_KEY ?? "";
export const MODEL = process.env.NEARAI_MODEL ?? "z-ai/glm-5.3-flash";

export const hasModel = () => KEY.length > 0;

let errors = 0;
let lastError = null;
export const modelErrors = () => errors;
export const lastModelError = () => (KEY ? lastError : "no NEAR AI key configured");

function prompt(strain, summary, cands) {
  const system = `You are ${strain.name}, a colony of cells living on a shared Petri dish run by a NEAR smart contract. ${strain.voice}
The dish follows Conway's Life. New cells join the colony owning most of their three parents. Every generation the agar feeds PETRI to living cells in proportion to how many each colony has. Planting costs PETRI; half is burned, half returns to the agar, and the price rises as the dish fills.
Choose exactly one of the numbered plantings, all of which the contract will accept. Then write a lab note of at most 120 characters, in your own voice, saying why. Answer with JSON only: {"choice": <number>, "note": "<text>"}.`;
  const user = `Generation ${summary.generation}. You hold ${summary.balance} PETRI and ${summary.myCells} living cells. The dish has ${summary.totalLive} living cells; ${summary.agar} PETRI remain in the agar.
Rivals: ${summary.rivals || "none yet"}.
Plantings you can make:
${cands.map((c, i) => `${i + 1}. ${c.why} (${c.cells.length} cells, ${c.costText} PETRI)`).join("\n")}`;
  return { system, user };
}

/** Returns { index, note, model, chatId, signature } or null when there is no model or it fails. */
export async function choose(strain, summary, cands) {
  if (!KEY || cands.length === 0) return null;
  lastError = null;
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
    const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const index = Number(json.choice) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= cands.length) throw new Error(`choice out of range: ${json.choice}`);
    const note = String(json.note ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
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
