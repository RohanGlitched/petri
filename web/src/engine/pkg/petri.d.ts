/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    agar(): string;
    board_hash_hex(): string;
    /**
     * What one cell costs to plant now, in PETRI units, by the contract's formula.
     */
    cell_price(payback: number, min_price: string, live_floor: number): string;
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
     * PETRI units earned per colony since this engine started, approximate (f64), for display.
     */
    earned(): Float64Array;
    /**
     * Exact PETRI units one colony earned since this engine started, as a decimal string.
     */
    earned_of(colony: number): string;
    generation(): number;
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
    constructor(width: number, height: number, feed_ppm: number, keeper_bps: number, reach: number);
    /**
     * Plant without checks (replaying the contract's log).
     */
    plant(colony: number, cells: Uint32Array | number[]): void;
    /**
     * Start from a stored board (the contract's `board` view, base64-decoded) at a known generation.
     */
    set_agar(units: string): void;
    set_colonies(n: number): void;
    /**
     * The dish's house colonies (the contract's `state().house`): they are never fed and win no tides.
     */
    set_house(house: Uint16Array | number[]): void;
    /**
     * Cells each colony has planted, as the contract counts them (when the engine starts mid-history).
     */
    set_planted(planted: Uint32Array | number[]): void;
    /**
     * Advance `n` generations, tracking the chain and the agar's feed exactly as the contract does.
     */
    step(n: number): void;
    /**
     * Run a tide: split `pay` yoctoNEAR by the window's earnings, skipping the house, add it to each colony's winnings
     * and reset the window. Returns the total paid to colonies, as a decimal string.
     */
    tide(pay: string): string;
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

/**
 * PETRI units that `near` yoctoNEAR buys from an agar of `agar` units, with `petri_price` yoctoNEAR per PETRI at
 * launch and `max_supply` units in all.
 */
export function buy_quote(near: string, agar: string, petri_price: string, max_supply: string): string;

/**
 * Flat indices for a named pattern placed at (x, y), wrapped onto the dish. Empty if the name is unknown.
 */
export function pattern_cells(name: string, x: number, y: number, width: number, height: number, rotate: number, flip: boolean): Uint32Array;

/**
 * What planting `cells` costs in PETRI units (decimal string), given the agar and the living population; a siege
 * (a planting inside a rival's buffer) costs `siege_x` times as much.
 */
export function quote(agar: string, feed_ppm: number, keeper_bps: number, total_live: number, live_floor: number, payback: number, min_price: string, cells: number, siege: boolean, siege_x: number): string;

/**
 * yoctoNEAR the agar pays for `petri` units handed back (before the sale's record): `sell_bps` of the curve, but never
 * more than their share of `vault` among `outstanding` PETRI (all PETRI outside the agar).
 */
export function sell_quote(petri: string, agar: string, petri_price: string, max_supply: string, sell_bps: number, vault: string, outstanding: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly buy_quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly engine_agar: (a: number) => [number, number];
    readonly engine_board_hash_hex: (a: number) => [number, number];
    readonly engine_cell_price: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly engine_cells: (a: number) => [number, number];
    readonly engine_chain_hex: (a: number) => [number, number];
    readonly engine_check_plant: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_clone_engine: (a: number) => number;
    readonly engine_compact: (a: number) => [number, number];
    readonly engine_earned: (a: number) => [number, number];
    readonly engine_earned_of: (a: number, b: number) => [number, number];
    readonly engine_generation: (a: number) => number;
    readonly engine_height: (a: number) => number;
    readonly engine_keeper_total: (a: number) => [number, number];
    readonly engine_last_births: (a: number) => [number, number];
    readonly engine_last_contested: (a: number) => number;
    readonly engine_last_deaths: (a: number) => [number, number];
    readonly engine_live_counts: (a: number) => [number, number];
    readonly engine_load_compact: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly engine_new: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly engine_plant: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_agar: (a: number, b: number, c: number) => void;
    readonly engine_set_colonies: (a: number, b: number) => void;
    readonly engine_set_house: (a: number, b: number, c: number) => void;
    readonly engine_set_planted: (a: number, b: number, c: number) => void;
    readonly engine_step: (a: number, b: number) => void;
    readonly engine_tide: (a: number, b: number, c: number) => [number, number];
    readonly engine_total_live: (a: number) => number;
    readonly engine_width: (a: number) => number;
    readonly engine_window_of: (a: number, b: number) => [number, number];
    readonly engine_won_of: (a: number, b: number) => [number, number];
    readonly pattern_cells: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number];
    readonly sell_quote: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number];
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
