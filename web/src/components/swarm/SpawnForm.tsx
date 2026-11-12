"use client";
// Spawn a strain: a name, a stain, a family of plays and a temperament of up to 600 characters. The browser does a small
// proof of work; the agents VM runs the guard and, on approval, makes the strain's own account and colony.

import { useEffect, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { STAINS } from "@/lib/stains";
import { accountUrl, txUrl } from "@/lib/config";
import { rememberOwn, type SpawnedStrain } from "@/lib/swarm";
import s from "./swarm.module.css";

const FAMILIES = [
  { id: "gardener", name: "Gardener", line: "Tidy still lifes near home, eaters towards rivals" },
  { id: "raider", name: "Raider", line: "Gliders at the fattest or nearest colony" },
  { id: "engineer", name: "Engineer", line: "Eaters first, then guns when it can afford them" },
  { id: "wanderer", name: "Wanderer", line: "Settles empty agar far from everyone" },
  { id: "chaos", name: "Chaos", line: "Methuselahs and blinkers in quiet agar" },
];

const EXAMPLES = [
  { label: "A cautious hermit", text: "A shy colony that hates crowds. Settle empty agar far from everyone, keep outposts small and spread out, and only take a big play when the forecast says most of our cells survive." },
  { label: "A grudge-holder", text: "Proud and vindictive. Prefer plantings that cost the colony nearest to us the most cells in the forecast, but never spend more than a third of our PETRI in one go." },
  { label: "A gambler", text: "Loves long odds. Always pick the most ambitious option on the list, a gun, a spaceship or a methuselah, unless the forecast says we would lose cells by it." },
  { label: "A gardener of patience", text: "Calm and frugal. Choose the cheapest planting that still grows our colony in the forecast, and wall ourselves off from whoever came closest last time." },
];

const STEPS = ["Proof of work, in your browser", "The guard reads the temperament", "NEAR makes the strain's account, it joins, prepays its brain, gets credit and drops its setup key"];

type Result = { ok: boolean; strain?: SpawnedStrain; ownerToken?: string; reasons?: string[]; guard?: { model: string | null; layer: string } | null; error?: string };

async function work(challenge: string, digest: string, bits: number): Promise<string> {
  const enc = new TextEncoder();
  for (let n = 0; ; n++) {
    const h = sha256(enc.encode(`petri-spawn:${challenge}:${digest}:${n}`));
    let z = 0;
    for (const b of h) {
      if (b === 0) {
        z += 8;
        continue;
      }
      z += Math.clz32(b) - 24;
      break;
    }
    if (z >= bits) return String(n);
    if (n % 20_000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

export function SpawnForm({ onSpawned }: { onSpawned?: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(STAINS.find((x) => x.name === "Eosin")!.color);
  const [family, setFamily] = useState("wanderer");
  const [prompt, setPrompt] = useState("");
  const [step, setStep] = useState(-1);
  const [secs, setSecs] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const busy = step >= 0 && !result;

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setSecs((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  const over = prompt.length > 600;
  const ready = name.trim().length > 0 && name.length <= 24 && prompt.trim().length >= 20 && !over;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setResult(null);
    setSecs(0);
    setStep(0);
    try {
      const ch = await (await fetch("/api/strains/spawn", { cache: "no-store" })).json();
      if (!ch.challenge) throw new Error(ch.error ?? "The spawner did not answer.");
      const digest = bytesToHex(sha256(new TextEncoder().encode(`${name}\n${prompt}`)));
      const nonce = await work(ch.challenge, digest, ch.bits ?? 18);
      setStep(1);
      // The guard and the chain work happen in one call; the second step lights once the guard is likely done.
      const t = setTimeout(() => setStep(2), 6000);
      const r = await fetch("/api/strains/spawn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, color, prompt, family, challenge: ch.challenge, nonce }),
      });
      clearTimeout(t);
      const body = (await r.json()) as Result;
      if (body.ok && body.strain && body.ownerToken) {
        rememberOwn(body.strain.account, body.ownerToken);
        onSpawned?.();
      }
      setResult(r.ok || body.reasons ? body : { ok: false, reasons: [body.error ?? `The spawner answered ${r.status}.`] });
    } catch (err) {
      setResult({ ok: false, reasons: [err instanceof Error ? err.message : String(err)] });
    }
  }

  const st = result?.strain;
  /** After a spawn the form is locked on what was sent, until "Spawn another" clears it. */
  const locked = !!result?.ok;
  function again() {
    setResult(null);
    setStep(-1);
    setName("");
    setPrompt("");
  }
  return (
    <div className={s.spawnGrid}>
      <form className={s.form} onSubmit={submit} aria-describedby="guard-rules">
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: "inherit", opacity: locked ? 0.6 : 1 }}>
        <div className={s.field}>
          <label htmlFor="sp-name">Name</label>
          <input id="sp-name" className={s.input} value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Gram Stain Coccus" autoComplete="off" />
          <p className={s.hint}>Up to 24 letters, digits, spaces and - &apos; . &amp; ! ? _ , : ( ). It becomes the colony&rsquo;s name on the dish and the first part of its account.</p>
        </div>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={s.legend}>Stain</legend>
          <div className={s.stains}>
            {STAINS.map((x) => (
              <button key={x.color} type="button" className={s.stain} style={{ background: `#${x.color.toString(16).padStart(6, "0")}` }} aria-pressed={color === x.color} aria-label={x.name} title={x.name} onClick={() => setColor(x.color)} />
            ))}
          </div>
        </fieldset>
        <fieldset className={s.field} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={s.legend}>Plays like</legend>
          <p className={s.hint}>Which kind of legal plantings the rules list for it each turn. Its temperament then chooses among them.</p>
          <div className={s.families}>
            {FAMILIES.map((f) => (
              <button key={f.id} type="button" className={s.family} aria-pressed={family === f.id} onClick={() => setFamily(f.id)}>
                <b>{f.name}</b>
                {f.line}
              </button>
            ))}
          </div>
        </fieldset>
        <div className={s.field}>
          <label htmlFor="sp-prompt">Temperament</label>
          <textarea id="sp-prompt" className={s.textarea} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="How should it choose? What does it love, fear, avoid?" />
          <span className={`${s.counter} ${over ? s.counterOver : ""}`}>{prompt.length} / 600</span>
          <div className={s.chips}>
            {EXAMPLES.map((x) => (
              <button key={x.label} type="button" className={s.chip} onClick={() => setPrompt(x.text)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>
        </fieldset>
        <div className={s.actions}>
          {locked ? (
            <button className="btn btn-ghost" type="button" onClick={again}>
              Spawn another
            </button>
          ) : (
            <button className="btn btn-amber" type="submit" disabled={!ready || busy}>
              {busy ? `Spawning… ${secs} s` : "Spawn it on testnet"}
            </button>
          )}
          <span className={s.hint}>Free: the testnet sponsor pays about 0.14 testnet NEAR. No wallet needed.</span>
        </div>
        {step >= 0 && (
          <ol className={s.steps} aria-live="polite">
            {STEPS.map((label, i) => {
              const failed = result && !result.ok && i === Math.max(1, step);
              const done = (result?.ok && i <= 2) || (!failed && i < step);
              return (
                <li key={label} className={`${s.step} ${failed ? s.stepBad : done ? s.stepDone : i === step && !result ? s.stepNow : ""}`}>
                  <span>{label}</span>
                  <span />
                </li>
              );
            })}
          </ol>
        )}
        {result && !result.ok && (
          <div className={s.problem} role="alert">
            {result.guard ? `The guard (${result.guard.layer === "rules" ? "its written rules" : result.guard.model ?? "a model"}) said no:` : "It could not be spawned:"}
            <ul>
              {(result.reasons ?? ["unknown reason"]).map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}
        {result?.ok && st && (
          <div className={s.done} role="status">
            <p style={{ margin: "0 0 8px" }}>
              <b>{st.name}</b> is alive as <a href={accountUrl(st.account)}>{st.account}</a>, colony {st.colony}. Its first move comes within a minute or two; it is listed below.
            </p>
            <p className={s.doneLinks}>
              <a className="btn btn-amber btn-small" href={`/dish?colony=${st.colony}&net=testnet`}>
                Watch it on the dish
              </a>
              <a className="btn btn-ghost btn-small" href={`/c/${st.colony}`}>
                Its share card
              </a>
            </p>
            <p className={s.small} style={{ marginBottom: 8 }}>
              On chain: {Object.entries(st.txs).map(([k, h], i) => (
                <span key={k}>
                  {i ? " · " : ""}
                  <a href={txUrl(h, "testnet")}>{k}</a>
                </span>
              ))}
              . Its one key: {st.keys?.[0]?.kind ?? "a function-call key for the dish"}.
            </p>
            <p className={s.small}>This browser holds its owner token, so you can top it up from here when its brain runs low.</p>
          </div>
        )}
      </form>
      <aside className={s.aside} id="guard-rules">
        <section className={s.panel}>
          <h3>What the guard checks</h3>
          <ul className={s.ticks}>
            <li>Written rules first: at most 600 plain characters; no links, e-mail addresses, NEAR accounts, keys or seed phrases; nothing addressed to the operator or the model&rsquo;s own instructions; no code.</li>
            <li>Then a model reads it as data, NEAR AI Cloud first (inside a TEE), Claude Haiku if NEAR AI does not answer, and approves only a temperament about play.</li>
            <li>If no model can read it, the answer is no. Nothing is waved through unread.</li>
          </ul>
        </section>
        <section className={s.panel}>
          <h3>What a temperament can and cannot do</h3>
          <p>It can only steer which of the listed plantings the strain picks. Each turn the dish&rsquo;s own rules list up to six plantings the contract will accept, each with a forecast; the runner plants one of those or nothing.</p>
          <p>The strain&rsquo;s account has one key: a function-call key for the dish&rsquo;s play methods (plant, buy with credit, claim, advance, pact offer, accept and cancel). It cannot attach NEAR or move it, and the chain shows it.</p>
        </section>
        <section className={s.panel}>
          <h3>Its brain is paid for</h3>
          <p>At birth the strain pays 0.01 testnet NEAR from its own account to the account that pays the team&rsquo;s model bill. Each decision draws 0.0002 of it, logged with the model&rsquo;s chat id, so about fifty decisions. At zero it stops thinking and planting until it is topped up.</p>
          <p>The payment is in testnet NEAR and the model calls are real. The runner is the team&rsquo;s VM, and it caps each strain&rsquo;s decisions and PETRI per day.</p>
        </section>
      </aside>
    </div>
  );
}
