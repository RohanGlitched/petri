import { VerifyRun } from "@/components/verify/VerifyRun";
import { CONTRACT, REPO } from "@/lib/config";
import s from "@/components/verify/verify.module.css";

export const metadata = {
  title: "Verify",
  description: "Replay the whole Petri dish from generation zero in your browser and check it against the contract: every cell, every owner, every PETRI.",
};

export default function VerifyPage() {
  return (
    <>
      <section className="wrap">
        <header className={s.head}>
          <h1 className={s.title}>Rebuild the dish from nothing</h1>
          <p className="lede">
            The contract keeps one ordered ledger: every colony that joined, every purchase and sale, every planting and every
            tide, with the PETRI and NEAR each moved. That is all anyone needs: Life is deterministic, so replaying the ledger
            from an empty dish must land on exactly the board, the history chain, the PETRI balances and the NEAR vault the
            contract holds. This page does it now, in your browser, with the same Rust code the contract runs, reading
            everything from one final block.
          </p>
          <p className="muted small" style={{ maxWidth: "60ch", margin: "-12px 0 0" }}>
            The replay stops at the generation the contract last stored. The live dish elsewhere on this site runs a few
            generations ahead of that in your browser, by the same rules, until someone advances the contract.
          </p>
        </header>
        <VerifyRun />
      </section>

      <section className="band band-paper" aria-labelledby="chain-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="chain-title" className="h2">How the history chain is built</h2>
            <p className="lede">
              Every sixteenth generation the contract hashes the board (each living cell and its owner) and folds that hash into
              a running chain. At every tide, each 240th generation, the ledger records the chain. Change one cell anywhere in the past
              and every later link changes.
            </p>
          </div>
          <svg className={s.chainFig} viewBox="0 0 960 150" role="img" aria-label="Each link is sha256 of the previous link, the generation and the board hash.">
            {[0, 1, 2, 3].map((i) => {
              const x = 20 + i * 240;
              return (
                <g key={i}>
                  <rect x={x} y="20" width="200" height="110" rx="18" fill="#fbf5ec" stroke="#d8c6ad" />
                  <text x={x + 18} y="52" className={s.chainBig}>{i === 3 ? "chain now" : `chain at ${(i + 1) * 16}`}</text>
                  <text x={x + 18} y="78" className={s.chainText}>sha256(previous link,</text>
                  <text x={x + 18} y="98" className={s.chainText}>generation {i === 3 ? "g" : (i + 1) * 16},</text>
                  <text x={x + 18} y="118" className={s.chainText}>hash of the board)</text>
                  {i < 3 && <path d={`M${x + 204} 75 L${x + 236} 75`} stroke="#9c5a14" strokeWidth="2" markerEnd="url(#vf-arrow)" />}
                </g>
              );
            })}
            <defs>
              <marker id="vf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0 0L10 5L0 10z" fill="#9c5a14" />
              </marker>
            </defs>
          </svg>
          <ol className={s.steps}>
            <li>
              <p>Your browser reads the rules, the colonies, the whole ledger, each colony's earnings and tide winnings, and the contract account's keys from {CONTRACT}, all at one final block. Nothing else.</p>
            </li>
            <li>
              <p>It starts petri-core on an empty dish with all 1,000,000 PETRI in the agar and an empty vault, then applies each entry at its generation: it checks every planting is legal and paid the formula's price, every purchase and sale followed the curve, and every tide paid the right share of the vault, split the right way. Between entries it steps Life and feeds the living exactly as the contract does.</p>
            </li>
            <li>
              <p>At every tide and at the end it compares hashes, PETRI and NEAR with the contract. A match means the dish you see, and every coin and NEAR in it, is what the rules produced.</p>
            </li>
          </ol>
        </div>
      </section>

      <section className="band" aria-labelledby="cli-title">
        <div className="wrap">
          <div className="section-head">
            <h2 id="cli-title" className="h2">Run it without this page</h2>
            <p className="lede">The same replay runs from a terminal with Node 20 or later, straight against NEAR RPC. It prints each check and exits non-zero on any mismatch.</p>
          </div>
          <pre className={s.term}>
            <b>git clone</b> {REPO}{"\n"}
            <b>cd</b> petri{"\n"}
            <b>node</b> scripts/verify.mjs{"\n"}
            {"\n"}
            # or check another dish or network{"\n"}
            <b>node</b> scripts/verify.mjs --contract {CONTRACT} --network testnet
          </pre>
          <h3 className="h3" style={{ marginTop: 48 }}>What this does not prove</h3>
          <ul className={s.limits}>
            <li>It proves the board and balances follow from the log. It cannot prove the log itself is complete; that is NEAR&rsquo;s job, since every planting is a transaction anyone can look up.</li>
            <li>It reads through public RPC providers. A lying provider could feed you a consistent fake; check against a node you trust if the stakes are high.</li>
            <li>Token transfers between accounts are not replayed here. They do not touch the dish, and their totals are covered by the contract&rsquo;s conservation tests.</li>
          </ul>
        </div>
      </section>
    </>
  );
}
