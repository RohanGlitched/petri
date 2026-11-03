import type { Metadata } from "next";
import { DishApp } from "@/components/DishApp";
import { Witness } from "@/components/Witness";

export const metadata: Metadata = {
  title: "The dish",
  description: "Watch the live dish, start a colony and plant patterns. Every planting is a NEAR transaction.",
};

export default function DishPage() {
  return (
    <section className="page page-dish" aria-labelledby="dish-title">
      <div className="page-head">
        <div>
          <h1 id="dish-title">The dish</h1>
          <p className="entry-date">Plate 1, live. Drag to move, scroll or pinch to look closer.</p>
        </div>
        <span className="page-no">p. 2</span>
      </div>
      <DishApp />
      <Witness page={2} />
    </section>
  );
}
