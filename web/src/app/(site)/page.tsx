import { HeroScene } from "@/components/home/HeroScene";
import { RulesBand } from "@/components/home/RulesBand";
import { CoinBand } from "@/components/home/CoinBand";
import { TrayBand } from "@/components/home/TrayBand";
import { StrainsBand } from "@/components/home/StrainsBand";
import { SpecimensBand } from "@/components/home/SpecimensBand";
import { ProofBand, CtaBand } from "@/components/home/ProofBand";

export default function Home() {
  return (
    <>
      <HeroScene />
      <RulesBand />
      <CoinBand />
      <TrayBand />
      <StrainsBand />
      <SpecimensBand />
      <ProofBand />
      <CtaBand />
    </>
  );
}
