// A planting note as people read it. The strains end every note a NEAR AI answer chose with " · tee:<16 hex>", the start
// of the SHA-256 of that answer: the chain keeps it so anyone can find the archived proof. On the page the hex is
// replaced by a small "TEE ✓" chip that opens the proof (served and cached by /api/tee, content-addressed).

import type { Network } from "@/lib/config";

const TAG = /\s*·\s*tee:([0-9a-f]{16,64})\s*$/;

/** The note without its proof tag, and the tag (null when the move was not chosen by NEAR AI). */
export function splitTee(note: string | null | undefined): { text: string; tag: string | null } {
  const s = note ?? "";
  const m = s.match(TAG);
  return m ? { text: s.slice(0, m.index).trimEnd(), tag: m[1] } : { text: s, tag: null };
}

export const teeProofUrl = (tag: string, net?: Network) => `/api/tee/${tag}${net ? `?net=${net}` : ""}`;

export function TeeChip({ tag, net }: { tag: string; net?: Network }) {
  return (
    <a
      className="tee-chip"
      href={teeProofUrl(tag, net)}
      target="_blank"
      rel="noopener"
      title={`Chosen by a NEAR AI model inside a TEE. Opens the archived signed answer (tee:${tag}); node scripts/verify-tee.mjs <tx> re-checks it end to end.`}
    >
      TEE ✓
    </a>
  );
}

/** The note's text followed by its TEE chip, if it has one. */
export function NoteText({ note, net }: { note: string | null | undefined; net?: Network }) {
  const { text, tag } = splitTee(note);
  return (
    <>
      {text}
      {tag && (
        <>
          {" "}
          <TeeChip tag={tag} net={net} />
        </>
      )}
    </>
  );
}
