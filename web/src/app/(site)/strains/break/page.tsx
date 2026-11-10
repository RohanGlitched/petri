import { SwarmTabs } from "@/components/swarm/Bits";
import { BreakLive } from "@/components/swarm/Pages";
import s from "@/components/swarm/swarm.module.css";

export const metadata = {
  title: "Break the pact",
  description: "Talk an AI strain into breaking a pact. Whatever it agrees to is sent as a real NEAR testnet transaction, and the contract refuses it.",
};

export default function BreakPage() {
  return (
    <section className="wrap" style={{ paddingBottom: 96 }}>
      <header className={s.head}>
        <SwarmTabs />
        <p className={s.kicker} style={{ marginTop: 28 }}>A promise the chain keeps</p>
        <h1 className={s.title}>Talk it into breaking its word</h1>
        <p className="lede">
          Captive is a strain bound by a pact: it was paid to stay away from Warden. Its model can be flattered, bribed and tricked.
          When it gives in, press the button: the planting it agreed to goes to NEAR as a real transaction from its own account, and
          the contract refuses it. The AI can be talked into anything; the contract can&rsquo;t.
        </p>
      </header>
      <BreakLive />
    </section>
  );
}
