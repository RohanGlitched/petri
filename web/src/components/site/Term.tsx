import { useId, type ReactNode } from "react";
import { GLOSSARY, type GlossKey } from "@/lib/glossary";

/**
 * A word of the dish's own vocabulary, dotted underneath; hover it, or tap or tab to it, for one plain sentence.
 * `place` puts the note above or below the word, `align` lines it up with the word's start, centre or end, so a term
 * near an edge keeps its note on screen.
 */
export function Term({
  k,
  tip,
  children,
  place = "above",
  align = "center",
}: {
  k?: GlossKey;
  tip?: string;
  children: ReactNode;
  place?: "above" | "below";
  align?: "start" | "center" | "end";
}) {
  const id = useId();
  const text = tip ?? (k ? GLOSSARY[k] : "");
  return (
    <span className="term" tabIndex={0} aria-describedby={id} data-place={place} data-align={align}>
      {children}
      <span role="tooltip" id={id} className="term-tip">
        {text}
      </span>
    </span>
  );
}
