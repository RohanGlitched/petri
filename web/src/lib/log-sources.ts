// Where each dish's agents serve their read-only log window (the agents VM): the strains' moves, and the archived
// proof behind every NEAR AI answer (/tee/<sha>, /attestation/<sha>). Server-side only.

import type { Network } from "./config";

const strip = (u: string) => u.replace(/\/+$/, "");

export const LOG_SOURCES: Record<Network, string> = {
  testnet: strip(process.env.PETRI_STRAINS_LOG_URL ?? "http://136.64.100.170:8790/"),
  mainnet: strip(process.env.PETRI_STRAINS_LOG_URL_MAINNET ?? "http://136.64.100.170:8791/"),
};
