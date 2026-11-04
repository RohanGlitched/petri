/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Add `amount` yoctoNEAR to what `colony` won as credit: a tide's bounty paid to a guest that ran it (a Tide entry
     * whose `by` never attached NEAR).
     */
    add_credit_won(colony: number, amount: string): void;
    agar(): string;
    /**
     * Note that `colony` put NEAR into the vault itself (replaying a Buy or Plant entry whose `near` is at least
     * `min_join`): from then on its tide shares are paid in NEAR. The first time, its stake goes to zero (v6.3; the
     * house keeps its stake): the cells it planted as a guest stop earning until it plants with PETRI that is not kept.
     * Its tide window goes to zero too (v6.4), so what it earned as a guest wins nothing at the coming tide.
     */
    attach(colony: number): void;
    board_hash_hex(): string;
    /**
     * What one cell costs to plant now, in PETRI units, by the contract's formula.
     */
    cell_price(payback: number, min_price: string): string;
    /**
     * The owner array (u16 per cell), copied out for rendering.
     */
    cells(): Uint16Array;
    chain_hex(): string;
    /**
     * Check a planting the way the contract will. Returns "" when it would be accepted, "siege:<rival>" when it is
     * accepted inside a rival's buffer at the siege price, and an error code otherwise.
     */
    check_plant(colony: number, cells: Uint32Array | number[], buffer: number, max_cells: number): string;
    clone_engine(): Engine;
    compact(): Uint8Array;
    /**
     * Cells the last feed counted (prices are set against this).
     */
    counted(): number;
    /**
     * Exact credit one colony won at the tides since this engine started, from the credit pool and as vault shares
     * (yoctoNEAR, decimal string).
     */
    credit_won_of(colony: number): string;
    /**
     * PETRI units earned per colony since this engine started, approximate (f64), for display.
     */
    earned(): Float64Array;
    /**
     * Exact PETRI units one colony earned since this engine started, as a decimal string.
     */
    earned_of(colony: number): string;
    /**
     * Whether `cells` are exactly a specimen slide's pattern (its `bitmap`, `w` × `h`, as a Slide entry holds it) moved
     * to another place on this dish, as the contract requires of a planting under the slide's licence.
     */
    fits_slide(cells: Uint32Array | number[], bitmap: Uint8Array | number[], w: number, h: number): boolean;
    generation(): number;
    /**
     * Whether `colony` has put NEAR into the vault. One that has not is paid its tide shares and sales as credit.
     */
    has_attached(colony: number): boolean;
    height(): number;
    /**
     * Exact PETRI units set aside for keepers since this engine started.
     */
    keeper_total(): string;
    last_births(): Uint32Array;
    last_contested(): number;
    last_deaths(): Uint32Array;
    live_counts(): Uint32Array;
    load_compact(bytes: Uint8Array | number[], generation: number, chain_hex: string): boolean;
    constructor(width: number, height: number, feed_ppm: number, keeper_bps: number, reach: number, live_floor: number, stake_keep_bps: number);
    /**
     * Whether a planting of `cells` breaks a pact: "" if no planted cell has a living cell of a `protected` colony
     * within `radius` cells (a square, wrapping), else "planted,protected,colony" for the first one found, as the
     * contract refuses it (see `Dish::pact_breach`).
     */
    pact_breach(cells: Uint32Array | number[], _protected: Uint16Array | number[], radius: number): string;
    /**
     * Plant without checks, adding the full stake (a guest's planting; forecasts and demos).
     */
    plant(colony: number, cells: Uint32Array | number[]): void;
    /**
     * Plant without checks as the contract does (replaying its log, after `attach` for a planting that attaches): a
     * colony that has attached NEAR, outside the house, stakes only the part of `paid` (cost and royalty, decimal) that
     * its `kept` PETRI before the planting (decimal, spent first) did not cover; any other colony stakes in full.
     */
    plant_paid(colony: number, cells: Uint32Array | number[], paid: string, kept: string): void;
    /**
     * A specimen slide as the contract captures it: `colony`'s living cells in the `w` × `h` rectangle at (`x`, `y`),
     * as the bitmap a Slide entry holds (see `Dish::region_bitmap`). Count its set bits for the cells.
     */
    region_bitmap(colony: number, x: number, y: number, w: number, h: number): Uint8Array;
    /**
     * Start from a stored board (the contract's `board` view, base64-decoded) at a known generation.
     */
    set_agar(units: string): void;
    set_colonies(n: number): void;
    /**
     * Start from the contract's count when the engine starts mid-history.
     */
    set_counted(counted: number): void;
    /**
     * The dish's house colonies (the contract's `state().house`): they are never fed and win no tides.
     */
    set_house(house: Uint16Array | number[]): void;
    /**
     * Each colony's stake, as the contract's `stakes` view returns it (when the engine starts mid-history).
     */
    set_stakes(stakes: BigUint64Array | bigint[]): void;
    /**
     * A colony's stake in thousandths of a planted cell, as the contract's `stakes` view gives it.
     */
    stake_of(colony: number): number;
    /**
     * Advance `n` generations, tracking the chain and the agar's feed exactly as the contract does.
     */
    step(n: number): void;
    /**
     * Run a tide: split `pay` yoctoNEAR (the vault's share) and `credit_pay` (the credit pool's) by the window's
     * earnings, skipping the house, decay every stake, add it to each colony's winnings (a vault share as credit for a
     * colony that never attached NEAR) and reset the window. Returns "paid,credit_paid,as_credit": the NEAR colonies
     * can claim, the credit pool's share paid, and the vault's share paid as credit, as decimal strings.
     */
    tide(pay: string, credit_pay: string): string;
    /**
     * Whether the contract runs a tide now (at a multiple of `tide_every`): some colony outside the house earned since
     * the last one. A tide with nobody to pay is skipped and leaves no ledger entry.
     */
    tide_due(): boolean;
    total_live(): number;
    width(): number;
    /**
     * One colony's earnings since the last tide (PETRI units), for showing a tide's likely split.
     */
    window_of(colony: number): string;
    /**
     * Exact NEAR one colony won at the tides since this engine started (yoctoNEAR, decimal string).
     */
    won_of(colony: number): string;
}

export function buy_quote(near: string, agar: string, petri_price: string, max_supply: string): string;

/**
 * PETRI units that `near` yoctoNEAR buys from an agar of `agar` units, with `petri_price` yoctoNEAR per PETRI at
 * launch and `max_supply` units in all.
 * The PETRI of a purchase of `units` that `credit` of `total` yoctoNEAR paid for, which the contract keeps in the dish
 * (see `petri_core::credit_share`).
 */
export function credit_share(units: string, credit: string, total: string): string;

/**
 * What a planting that would cost `cost` PETRI units costs under a specimen slide's licence (`slide_discount_bps`
 * off), and the royalty (`slide_royalty_bps` of that) anyone but the slide's holder pays its holder: "cost,royalty".
 */
export function licence(cost: string, discount_bps: number, royalty_bps: number): string;

/**
 * Flat indices for a named pattern placed at (x, y), wrapped onto the dish. Empty if the name is unknown.
 */
export function pattern_cells(name: string, x: number, y: number, width: number, height: number, rotate: number, flip: boolean): Uint32Array;

/**
 * What planting `cells` costs in PETRI units (decimal string), given the agar and the cells the last feed counted
 * (`counted`, the contract's `state().counted`; pass it as `total_live`); a siege
 * (a planting inside a rival's buffer) costs `siege_x` times as much.
 */
export function quote(agar: string, feed_ppm: number, keeper_bps: number, total_live: number, live_floor: number, payback: number, min_price: string, cells: number, siege: boolean, siege_x: number): string;

/**
 * yoctoNEAR the agar pays for `petri` units handed back (before the sale's record): `sell_bps` of the curve, but never
 * more than their share of `vault` among `outstanding` PETRI (all PETRI outside the agar).
 */
export function sell_quote(petri: string, agar: string, petri_price: string, max_supply: string, sell_bps: number, vault: string, outstanding: string): string;

/**
 * A specimen slide's image exactly as the contract's `nft_token` draws it: an SVG of `bitmap` (`w` × `h`, a Slide
 * entry's or the `slides` view's) in `color` (0xRRGGBB), marked with its generation.
 */
export function slide_svg(bitmap: Uint8Array | number[], w: number, h: number, color: number, generation: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly buy_quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly credit_share: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_add_credit_won: (a: number, b: number, c: number, d: number) => void;
    readonly engine_agar: (a: number) => [number, number];
    readonly engine_attach: (a: number, b: number) => void;
    readonly engine_board_hash_hex: (a: number) => [number, number];
    readonly engine_cell_price: (a: number, b: number, c: number, d: number) => [number, number];
    readonly engine_cells: (a: number) => [number, number];
    readonly engine_chain_hex: (a: number) => [number, number];
    readonly engine_check_plant: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_clone_engine: (a: number) => number;
    readonly engine_compact: (a: number) => [number, number];
    readonly engine_counted: (a: number) => number;
    readonly engine_credit_won_of: (a: number, b: number) => [number, number];
    readonly engine_earned: (a: number) => [number, number];
    readonly engine_earned_of: (a: number, b: number) => [number, number];
    readonly engine_fits_slide: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly engine_generation: (a: number) => number;
    readonly engine_has_attached: (a: number, b: number) => number;
    readonly engine_height: (a: number) => number;
    readonly engine_keeper_total: (a: number) => [number, number];
    readonly engine_last_births: (a: number) => [number, number];
    readonly engine_last_contested: (a: number) => number;
    readonly engine_last_deaths: (a: number) => [number, number];
    readonly engine_live_counts: (a: number) => [number, number];
    readonly engine_load_compact: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly engine_new: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly engine_pact_breach: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_plant: (a: number, b: number, c: number, d: number) => void;
    readonly engine_plant_paid: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly engine_region_bitmap: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_set_agar: (a: number, b: number, c: number) => void;
    readonly engine_set_colonies: (a: number, b: number) => void;
    readonly engine_set_counted: (a: number, b: number) => void;
    readonly engine_set_house: (a: number, b: number, c: number) => void;
    readonly engine_set_stakes: (a: number, b: number, c: number) => void;
    readonly engine_stake_of: (a: number, b: number) => number;
    readonly engine_step: (a: number, b: number) => void;
    readonly engine_tide: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_tide_due: (a: number) => number;
    readonly engine_total_live: (a: number) => number;
    readonly engine_width: (a: number) => number;
    readonly engine_window_of: (a: number, b: number) => [number, number];
    readonly engine_won_of: (a: number, b: number) => [number, number];
    readonly licence: (a: number, b: number, c: number, d: number) => [number, number];
    readonly pattern_cells: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly sell_quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number];
    readonly slide_svg: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
