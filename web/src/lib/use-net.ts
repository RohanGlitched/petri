"use client";
// The dish being read, for anything that renders it. The server renders the default dish, so components read the
// network through this hook: the first render matches the server's HTML and the next one names the real dish.

import { useSyncExternalStore } from "react";
import { CONTRACTS, DEFAULT_NETWORK, NETWORK, NETWORK_LABEL, accountUrl, type Network } from "./config";

const noop = () => () => {};

export type Net = {
  network: Network;
  contract: string;
  /** Guests, the relayer and sponsored credit: testnet only. */
  freePlay: boolean;
  label: (typeof NETWORK_LABEL)[Network];
  contractUrl: string;
};

const view = (n: Network): Net => ({
  network: n,
  contract: CONTRACTS[n],
  freePlay: n === "testnet",
  label: NETWORK_LABEL[n],
  contractUrl: accountUrl(CONTRACTS[n], n),
});
const client = view(NETWORK);
const server = view(DEFAULT_NETWORK);

export function useNet(): Net {
  return useSyncExternalStore(noop, () => client, () => server);
}
