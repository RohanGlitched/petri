// Server only. Counters that protect the relayer's NEAR: a daily cap on what relaying and making guests may spend, in
// all and per client address, plus the break-it lab's refusal tally. With Upstash Redis (Vercel KV) configured the
// counters are shared by every server instance and survive restarts; without it each instance keeps its own, which
// still bounds a single instance's spend but not the sum across instances (set KV_REST_API_URL and KV_REST_API_TOKEN,
// or UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN).

const URL_ = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "";
const TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
export const SHARED = !!(URL_ && TOKEN);

/** One unit is 10^18 yoctoNEAR, a millionth of a NEAR. */
export const UNIT = 10n ** 18n;
/** What relaying and making guests may spend in a UTC day, in all (default 2 NEAR) and per address (0.25 NEAR). */
export const DAILY_CAP = BigInt(process.env.PETRI_RELAY_DAILY_NEAR_MICRO ?? "2000000");
export const DAILY_CAP_PER_IP = BigInt(process.env.PETRI_RELAY_DAILY_NEAR_MICRO_PER_IP ?? "500000");
/** Most refused attempts the lab relays in a day, in all and per guest. */
export const LAB_DAILY = Number(process.env.PETRI_LAB_DAILY ?? "400");
export const LAB_DAILY_PER_GUEST = Number(process.env.PETRI_LAB_DAILY_PER_GUEST ?? "30");
/** Mainnet free play keeps its own day counters (default 3.1 NEAR a day in all, the whole budget, since the relayer's
 * balance floor is what really bounds it; 0.4 NEAR per address). */
export const MAINNET_DAILY_CAP = BigInt(process.env.PETRI_MAINNET_RELAY_DAILY_NEAR_MICRO ?? "3100000");
export const MAINNET_DAILY_CAP_PER_IP = BigInt(process.env.PETRI_MAINNET_RELAY_DAILY_NEAR_MICRO_PER_IP ?? "400000");
/** Testnet keeps the keys it always had. */
const scope = (net: "testnet" | "mainnet") => (net === "mainnet" ? "mainnet:" : "");

async function redis(cmds: (string | number)[][]): Promise<unknown[]> {
  const res = await fetch(`${URL_}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(cmds),
    signal: AbortSignal.timeout(3000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`kv ${res.status}`);
  const body = (await res.json()) as { result?: unknown; error?: string }[];
  return body.map((b) => {
    if (b.error) throw new Error(b.error);
    return b.result;
  });
}

const mem = new Map<string, { v: bigint; until: number }>();
const memList = new Map<string, string[]>();

function day() {
  return new Date().toISOString().slice(0, 10);
}

async function incr(key: string, by: bigint, ttl: number): Promise<bigint> {
  if (SHARED) {
    try {
      const [v] = await redis([["INCRBY", key, by.toString()], ["EXPIRE", key, ttl]]);
      return BigInt(String(v));
    } catch (e) {
      console.error("kv incr failed; counting in memory", e instanceof Error ? e.message : e);
    }
  }
  const now = Date.now();
  const cur = mem.get(key);
  const v = (cur && cur.until > now ? cur.v : 0n) + by;
  mem.set(key, { v, until: now + ttl * 1000 });
  return v;
}

async function get(key: string): Promise<bigint> {
  if (SHARED) {
    try {
      const [v] = await redis([["GET", key]]);
      return v === null || v === undefined ? 0n : BigInt(String(v));
    } catch {
      /* fall through to memory */
    }
  }
  const cur = mem.get(key);
  return cur && cur.until > Date.now() ? cur.v : 0n;
}

/** The address a request came from: Vercel's own header first (clients cannot set it), then the usual proxies. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return (h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for") ?? "local").split(",")[0].trim() || "local";
}

/** Refuse when today's spend, in all or from this address, has reached its cap. */
export async function overBudget(ip: string, net: "testnet" | "mainnet" = "testnet"): Promise<string | null> {
  const d = `${scope(net)}${day()}`;
  const [all, mine] = await Promise.all([get(`petri:spend:${d}`), get(`petri:spend:${d}:${ip}`)]);
  if (net === "mainnet") {
    if (all >= MAINNET_DAILY_CAP) return "Free mainnet play has spent today's budget. It resumes at 00:00 UTC; a NEAR wallet works meanwhile.";
    if (mine >= MAINNET_DAILY_CAP_PER_IP) return "This network has used today's share of free mainnet play. Connect a NEAR wallet, play free on testnet, or try again after 00:00 UTC.";
    return null;
  }
  if (all >= DAILY_CAP) return "The relayer has spent today's budget. Free play resumes at 00:00 UTC; a NEAR wallet works meanwhile.";
  if (mine >= DAILY_CAP_PER_IP) return "This network has used today's share of the free-play relayer. Watch meanwhile (press C on /dish for cinema mode, or replay the history on /verify), connect a NEAR wallet, or try again after 00:00 UTC.";
  return null;
}

/** Count what a relay or a new guest cost, in yoctoNEAR. */
export async function spent(ip: string, yocto: bigint, net: "testnet" | "mainnet" = "testnet") {
  const units = yocto / UNIT + 1n;
  const d = `${scope(net)}${day()}`;
  await Promise.all([incr(`petri:spend:${d}`, units, 2 * 86400), incr(`petri:spend:${d}:${ip}`, units, 2 * 86400)]);
}

/** Add one to a counter that lasts the UTC day (`name` is scoped by the caller) and return the new count. */
export async function bumpToday(name: string): Promise<number> {
  return Number(await incr(`petri:count:${day()}:${name}`, 1n, 2 * 86400));
}

/** Read such a counter. */
export async function countToday(name: string): Promise<number> {
  return Number(await get(`petri:count:${day()}:${name}`));
}

/** One more lab attempt today for this guest, or the reason it is refused. */
export async function labAllowed(guest: string): Promise<string | null> {
  const d = day();
  const [all, mine] = await Promise.all([incr(`petri:lab:${d}`, 1n, 2 * 86400), incr(`petri:lab:${d}:${guest}`, 1n, 2 * 86400)]);
  if (all > BigInt(LAB_DAILY)) return "The lab has relayed today's attempts. It opens again at 00:00 UTC.";
  if (mine > BigInt(LAB_DAILY_PER_GUEST)) return `Your guest has made ${LAB_DAILY_PER_GUEST} attempts today, the most a guest may.`;
  return null;
}

export type Refusal = { attempt: string; hash: string; text: string; at: number };

/** Record a refusal the chain returned: the running total, per attempt, and the latest few. */
export async function recordRefusal(r: Refusal) {
  const item = JSON.stringify(r);
  if (SHARED) {
    try {
      await redis([["INCR", "petri:lab:refused"], ["HINCRBY", "petri:lab:by", r.attempt, 1], ["LPUSH", "petri:lab:recent", item], ["LTRIM", "petri:lab:recent", 0, 49]]);
      return;
    } catch (e) {
      console.error("kv refusal not recorded", e instanceof Error ? e.message : e);
    }
  }
  await incr("petri:lab:refused", 1n, 365 * 86400);
  await incr(`petri:lab:by:${r.attempt}`, 1n, 365 * 86400);
  memList.set("recent", [item, ...(memList.get("recent") ?? [])].slice(0, 50));
}

export async function refusals(): Promise<{ total: number; by: Record<string, number>; recent: Refusal[]; shared: boolean }> {
  if (SHARED) {
    try {
      const [total, by, recent] = await redis([["GET", "petri:lab:refused"], ["HGETALL", "petri:lab:by"], ["LRANGE", "petri:lab:recent", 0, 19]]);
      const flat = (by as string[] | null) ?? [];
      const m: Record<string, number> = {};
      for (let i = 0; i + 1 < flat.length; i += 2) m[flat[i]] = Number(flat[i + 1]);
      return { total: Number(total ?? 0), by: m, recent: ((recent as string[]) ?? []).map((x) => JSON.parse(x) as Refusal), shared: true };
    } catch {
      /* fall through */
    }
  }
  const by: Record<string, number> = {};
  for (const [k, v] of mem) if (k.startsWith("petri:lab:by:")) by[k.slice("petri:lab:by:".length)] = Number(v.v);
  return { total: Number(await get("petri:lab:refused")), by, recent: (memList.get("recent") ?? []).map((x) => JSON.parse(x) as Refusal).slice(0, 20), shared: false };
}

/** yoctoNEAR a transaction's outcome burnt, the transaction and every receipt. */
export function burnt(res: { transaction_outcome?: { outcome?: { tokens_burnt?: string } }; receipts_outcome?: { outcome?: { tokens_burnt?: string } }[] }): bigint {
  let t = BigInt(res.transaction_outcome?.outcome?.tokens_burnt ?? "0");
  for (const r of res.receipts_outcome ?? []) t += BigInt(r.outcome?.tokens_burnt ?? "0");
  return t;
}
