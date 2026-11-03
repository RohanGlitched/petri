import { DishStage } from "@/components/dish/DishStage";

export const metadata = {
  title: "The dish",
  description: "The live Petri dish. Start a colony with no wallet, plant patterns, and watch Life play out on NEAR.",
};

export default function DishPage() {
  return <DishStage />;
}
