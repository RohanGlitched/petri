// The facts the site states in more than one place: the product's name, the contract version both dishes run, the
// build, the test counts and what /verify reports. Every page, the docs and llms.txt read them from here, so a version
// bump is one edit. `node scripts/check-facts.mjs` fails the build if an older figure is written out by hand anywhere.

/** The product. The coin is PETRI; the dish is where it lives. */
export const PRODUCT = "Petri Dish";
export const COIN = "PETRI";
export const TAGLINE = "a memecoin that is alive";
/** The tagline as a sentence, for headings and the title bar. */
export const TAGLINE_SENTENCE = "A memecoin that is alive.";

/** The contract version both dishes run (mainnet petri-dish.near, testnet petri-v6.testnet). */
export const CONTRACT_VERSION = "v6.5";
/** The commit both dishes were built from, as their NEP-330 metadata names it. */
export const BUILD_COMMIT = "27a59761af835f2278b7cf28676c3acf0fdda538";
export const BUILD_COMMIT_SHORT = BUILD_COMMIT.slice(0, 7);
/** `cargo near build reproducible-wasm` at BUILD_COMMIT; the code hash of both contract accounts. */
export const CODE_HASH = "CFSKarjkzmD6a3ryQy7ZWFjYXGK8tpAQa6ofKyt3MXRD";
/** Size of that wasm in bytes. */
export const WASM_BYTES = 617_238;
/** The day both dishes last started again from generation 0 (on v6.4); v6.5 was a code-only upgrade over that state, on UPGRADED. */
export const RELAUNCHED = "4 November 2026";
export const UPGRADED = "10 November 2026";

/** The `version` of the contract's own NEP-297 events. */
export const EVENT_VERSION = `${CONTRACT_VERSION.slice(1)}.0`;

/** `cargo test -p petri-contract` and `cargo test -p petri-core` at BUILD_COMMIT. */
export const TESTS = { contract: 152, core: 37, total: 152 + 37 };

/** What /verify shows: its checks, plus one disclosed note (the team-held full-access key). */
export const VERIFY = { checks: 44, notes: 1 };
/** Rows `node scripts/verify.mjs` prints: the same ground, some split finer, plus the key note. */
export const VERIFY_CLI_ROWS = 45;
