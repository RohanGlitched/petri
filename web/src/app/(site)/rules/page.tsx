import type { Metadata } from "next";
import { RulesHeader } from "@/components/rules/RulesHeader";
import { BoardSection } from "@/components/rules/BoardSection";
import { LifeSection } from "@/components/rules/LifeSection";
import { PlantingSection } from "@/components/rules/PlantingSection";
import { CoinSection } from "@/components/rules/CoinSection";
import { ParamsSection } from "@/components/rules/ParamsSection";
import { StrategySection } from "@/components/rules/StrategySection";
import { VerifySection } from "@/components/rules/VerifySection";
import { LimitsSection, RulesCta } from "@/components/rules/LimitsSection";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The complete rules of Petri: Conway's Life with colony owners on a 128 × 128 dish kept by a NEAR contract, the PETRI nutrient cycle, planting prices, the history chain and the known trade-offs, with live numbers from the contract.",
};

export default function RulesPage() {
  return (
    <>
      <RulesHeader />
      <BoardSection />
      <LifeSection />
      <PlantingSection />
      <CoinSection />
      <ParamsSection />
      <StrategySection />
      <VerifySection />
      <LimitsSection />
      <RulesCta />
    </>
  );
}
