// Facts the docs quote in many places, kept in one file so a page can never disagree with another. Every value here
// was read from the code or the chain: contract/launch-rules*.json, contract/Cargo.toml, scripts/verify.mjs,
// web/src/lib/config.ts and the accounts themselves.

export const SITE = "https://www.playpetri.xyz";
export const DOCS = "https://docs.playpetri.xyz";
export const REPO = "https://github.com/RohanGlitched/petri";
export const blob = (path: string) => `${REPO}/blob/main/${path}`;
export const tree = (path: string) => `${REPO}/tree/main/${path}`;

/** The commit both dishes were built from, as their NEP-330 metadata names it. */
export const BUILD_COMMIT = "27a59761af835f2278b7cf28676c3acf0fdda538";
export const BUILD_COMMIT_SHORT = "27a5976";
/** `cargo near build reproducible-wasm` at BUILD_COMMIT; the code hash of both contract accounts. */
export const CODE_HASH = "CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD";
export const BUILD_IMAGE = "sourcescan/cargo-near:0.22.0-rust-1.99.1";
export const BUILD_DIGEST = "sha256:c9655eaf7436b90c87ea8b25739f91063032c5c30ba24cfeafe72c142943b5bb";
export const NEAR_SDK = "5.29.1";

export type Net = "mainnet" | "testnet";

export const DISH: Record<Net, {
  contract: string;
  label: string;
  rules: string;
  wnear: string;
  keeper: string;
  house: string[];
  explorer: string;
  rpc: string;
  play: string;
}> = {
  mainnet: {
    contract: "petri-dish.near",
    label: "NEAR mainnet",
    rules: "contract/launch-rules-mainnet.json",
    wnear: "wrap.near",
    keeper: "keeper.petri-dish.near",
    house: ["violet.petri-dish.near", "safranin.petri-dish.near", "methylene.petri-dish.near", "malachite.petri-dish.near", "congo.petri-dish.near"],
    explorer: "https://nearblocks.io",
    rpc: "https://rpc.mainnet.fastnear.com",
    play: `${SITE}/dish?net=mainnet`,
  },
  testnet: {
    contract: "petri-v6.testnet",
    label: "NEAR testnet",
    rules: "contract/launch-rules.json",
    wnear: "wrap.testnet",
    keeper: "petri-keeper.testnet",
    house: ["petri-violet.testnet", "petri-safranin.testnet", "petri-methylene.testnet", "petri-malachite.testnet", "petri-congo.testnet"],
    explorer: "https://testnet.nearblocks.io",
    rpc: "https://rpc.testnet.fastnear.com",
    play: `${SITE}/dish?net=testnet`,
  },
};

export const BENCH = ["petri-bench-a.testnet", "petri-bench-b.testnet", "petri-bench-c.testnet"];

export const account = (net: Net, a: string) => `${DISH[net].explorer}/address/${a}`;

/** The five house strains, as agents/run.mjs defines them. */
export const STRAINS = [
  { short: "violet", name: "Crystal Violet", color: "#6b2fa0", temperament: "gardener", every: "40 to 80" },
  { short: "safranin", name: "Safranin", color: "#c8325a", temperament: "raider", every: "40 to 70" },
  { short: "methylene", name: "Methylene Blue", color: "#2364aa", temperament: "engineer", every: "50 to 90" },
  { short: "malachite", name: "Malachite Green", color: "#1e8c6e", temperament: "wanderer", every: "40 to 80" },
  { short: "congo", name: "Congo Red", color: "#c8431f", temperament: "chaos", every: "60 to 100" },
];

export const TESTS = { contract: 143, core: 37 };
