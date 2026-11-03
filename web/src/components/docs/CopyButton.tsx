"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className="d-copy"
      onClick={() => {
        const done = (s: "done" | "failed") => {
          setState(s);
          setTimeout(() => setState("idle"), 1600);
        };
        if (!navigator.clipboard) return done("failed");
        navigator.clipboard.writeText(text).then(() => done("done"), () => done("failed"));
      }}
    >
      {state === "done" ? "Copied" : state === "failed" ? "Select and copy" : "Copy"}
    </button>
  );
}
