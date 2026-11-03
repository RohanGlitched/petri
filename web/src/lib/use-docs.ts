"use client";
// Where the documentation lives on the deployment being read. www.X has its docs at docs.X; any other host (localhost,
// or the VM's own address while the domain's DNS moves) serves them under /docs on the same host.

import { useSyncExternalStore } from "react";

export const DOCS_CANONICAL = "https://docs.playpetri.xyz";

function docsFor(host: string, protocol: string): string {
  const h = host.toLowerCase();
  if (h.startsWith("www.")) return `${protocol}//docs.${h.slice(4)}`;
  if (h === "playpetri.xyz") return DOCS_CANONICAL;
  return "/docs/introduction";
}

const noop = () => () => {};

/** The docs' home on this deployment; the canonical address during server rendering. */
export function useDocsHref(): string {
  return useSyncExternalStore(
    noop,
    () => docsFor(window.location.host, window.location.protocol),
    () => DOCS_CANONICAL,
  );
}
