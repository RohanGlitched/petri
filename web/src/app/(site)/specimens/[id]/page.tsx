import { SpecimenDetail } from "@/components/specimens/Detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `Specimen ${decodeURIComponent(id)}`,
    description: "A slide of living cells fixed by the Petri dish contract: its colony, generation, owner and the replay that proves those cells lived.",
  };
}

export default async function SpecimenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SpecimenDetail id={decodeURIComponent(id)} />;
}
