import type { Metadata } from "next";
import { RulesHeader, RulesJump } from "@/components/rules/RulesHeader";
import { BoardSection } from "@/components/rules/BoardSection";
import { LifeSection } from "@/components/rules/LifeSection";
import { PlantingSection } from "@/components/rules/PlantingSection";
import { CoinSection } from "@/components/rules/CoinSection";
import { TidesSection } from "@/components/rules/TidesSection";
import { ParamsSection } from "@/components/rules/ParamsSection";
import { StrategySection } from "@/components/rules/StrategySection";
import { VerifySection } from "@/components/rules/VerifySection";
import { LimitsSection, RulesCta } from "@/components/rules/LimitsSection";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The complete rules of Petri: Conway's Life with colony owners on a 128 × 128 dish kept by a NEAR contract, buying PETRI from the agar, the payback price of a cell, the capped feed, the NEAR tides, the replayable ledger and the known trade-offs, with live numbers from the contract.",
};

export default function RulesPage() {
  return (
    <>
      <RulesHeader />
      <RulesJump />
      <BoardSection />
      <LifeSection />
      <PlantingSection />
      <CoinSection />
      <TidesSection />
      <ParamsSection />
      <StrategySection />
      <VerifySection />
      <LimitsSection />
      <RulesCta />
    </>
  );
}
