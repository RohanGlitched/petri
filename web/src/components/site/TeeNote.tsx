// A planting note as people read it. The strains end every note a NEAR AI answer chose with " · tee:<16 hex>", the start
// of the SHA-256 of that answer: the chain keeps it so anyone can find the archived proof. On the page the hex is
// replaced by a small "TEE ✓" chip that opens the proof (served and cached by /api/tee, content-addressed).
//
// Anyone can type " · tee:<hex>" into a note, so the chip is drawn only for a planting by a strain: a house strain
// (lib/strains.ts) or a spawned one (*.petri-strains.testnet). Anyone else's note shows the tag as the plain text it is,
// and the relayer refuses guests' notes that carry one.

import type { Network } from "@/lib/config";
import { strainOf } from "@/lib/strains";

/** Whether a planting by `account` may show a TEE chip: house strains and spawned strains only. */
export function teeEligible(account: string | null | undefined): boolean {
  return !!account && (!!strainOf(account) || account.endsWith(".petri-strains.testnet"));
}

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

/** The note's text followed by its TEE chip, if it has one. With `account` (who planted it), the chip shows only for a
 * strain's planting; anyone else's note is shown as written. */
export function NoteText({ note, net, account }: { note: string | null | undefined; net?: Network; account?: string | null }) {
  if (account !== undefined && !teeEligible(account)) return <>{note ?? ""}</>;
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
