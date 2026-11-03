/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    board_hash_hex(): string;
    /**
     * The owner array (u16 per cell), copied out for rendering.
     */
    cells(): Uint16Array;
    chain_hex(): string;
    /**
     * Check a planting the way the contract will. Returns "" when it would be accepted.
     */
    check_plant(colony: number, cells: Uint32Array | number[], buffer: number, max_cells: number): string;
    clone_engine(): Engine;
    compact(): Uint8Array;
    /**
     * PETRI units earned per colony since this engine started (f64 is exact below 2^53 units, ~9 billion PETRI).
     */
    earned(): Float64Array;
    generation(): number;
    height(): number;
    last_births(): Uint32Array;
    last_contested(): number;
    last_deaths(): Uint32Array;
    live_counts(): Uint32Array;
    /**
     * Start from a stored board (the contract's `board` view, base64-decoded) at a known generation.
     */
    load_compact(bytes: Uint8Array | number[], generation: number, chain_hex: string): boolean;
    constructor(width: number, height: number, emission: number, keeper_bps: number);
    /**
     * Plant without checks (replaying the contract's log).
     */
    plant(colony: number, cells: Uint32Array | number[]): void;
    set_colonies(n: number): void;
    /**
     * Advance `n` generations, tracking the chain and emission exactly as the contract does.
     */
    step(n: number): void;
    total_live(): number;
    width(): number;
}

/**
 * Flat indices for a named pattern placed at (x, y), wrapped onto the dish. Empty if the name is unknown.
 */
export function pattern_cells(name: string, x: number, y: number, width: number, height: number, rotate: number, flip: boolean): Uint32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_board_hash_hex: (a: number) => [number, number];
    readonly engine_cells: (a: number) => [number, number];
    readonly engine_chain_hex: (a: number) => [number, number];
    readonly engine_check_plant: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly engine_clone_engine: (a: number) => number;
    readonly engine_compact: (a: number) => [number, number];
    readonly engine_earned: (a: number) => [number, number];
    readonly engine_generation: (a: number) => number;
    readonly engine_height: (a: number) => number;
    readonly engine_last_births: (a: number) => [number, number];
    readonly engine_last_contested: (a: number) => number;
    readonly engine_last_deaths: (a: number) => [number, number];
    readonly engine_live_counts: (a: number) => [number, number];
    readonly engine_load_compact: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly engine_new: (a: number, b: number, c: number, d: number) => number;
    readonly engine_plant: (a: number, b: number, c: number, d: number) => void;
    readonly engine_set_colonies: (a: number, b: number) => void;
    readonly engine_step: (a: number, b: number) => void;
    readonly engine_total_live: (a: number) => number;
    readonly engine_width: (a: number) => number;
    readonly pattern_cells: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
