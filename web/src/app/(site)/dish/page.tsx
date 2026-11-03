import { DishStage } from "@/components/dish/DishStage";

export const metadata = {
  title: "The dish",
  description: "The live Petri dish. Start a colony, plant patterns, fossilize your cells as specimens and watch Life play out on NEAR: free play on testnet, or real NEAR on mainnet.",
};

export default function DishPage() {
  return <DishStage />;
}
