import { HeroScene } from "@/components/home/HeroScene";
import { RulesBand } from "@/components/home/RulesBand";
import { CoinBand } from "@/components/home/CoinBand";
import { TrayBand } from "@/components/home/TrayBand";
import { StrainsBand } from "@/components/home/StrainsBand";
import { SpecimensBand } from "@/components/home/SpecimensBand";
import { ProofBand, CtaBand } from "@/components/home/ProofBand";
import { Deferred } from "@/components/site/Deferred";

export default function Home() {
  return (
    <>
      <HeroScene />
      <RulesBand />
      <CoinBand />
      <TrayBand />
      {/* Below the fold: their reads and scripts wait until the reader comes near (the hero hydrates first). */}
      <Deferred id="strains" section="Five AI strains" minHeight={1500}>
        <StrainsBand />
      </Deferred>
      <Deferred id="specimens" section="Fossils of a living coin" minHeight={760}>
        <SpecimensBand />
      </Deferred>
      <ProofBand />
      <CtaBand />
    </>
  );
}
