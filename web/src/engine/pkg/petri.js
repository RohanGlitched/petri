/* @ts-self-types="./petri.d.ts" */

export class Engine {
    static __wrap(ptr) {
        const obj = Object.create(Engine.prototype);
        obj.__wbg_ptr = ptr;
        EngineFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        EngineFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_engine_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    agar() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_agar(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    board_hash_hex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_board_hash_hex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * What one cell costs to plant now, in PETRI units, by the contract's formula.
     * @param {number} payback
     * @param {string} min_price
     * @returns {string}
     */
    cell_price(payback, min_price) {
        let deferred3_0;
        let deferred3_1;
        try {
            const val2 = +payback;
            const ptr0 = passStringToWasm0(min_price, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_cell_price(this.__wbg_ptr, val2, ptr0, len0);
            deferred3_0 = ret[0];
            deferred3_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
    }
    /**
     * The owner array (u16 per cell), copied out for rendering.
     * @returns {Uint16Array}
     */
    cells() {
        const ret = wasm.engine_cells(this.__wbg_ptr);
        var v1 = getArrayU16FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 2, 2);
        return v1;
    }
    /**
     * @returns {string}
     */
    chain_hex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_chain_hex(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Check a planting the way the contract will. Returns "" when it would be accepted, "siege:<rival>" when it is
     * accepted inside a rival's buffer at the siege price, and an error code otherwise.
     * @param {number} colony
     * @param {Uint32Array | number[]} cells
     * @param {number} buffer
     * @param {number} max_cells
     * @returns {string}
     */
    check_plant(colony, cells, buffer, max_cells) {
        let deferred5_0;
        let deferred5_1;
        try {
            const val2 = +colony;
            const val3 = +buffer;
            const val4 = +max_cells;
            const ptr0 = passArray32ToWasm0(cells, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_check_plant(this.__wbg_ptr, val2, ptr0, len0, val3, val4);
            deferred5_0 = ret[0];
            deferred5_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
        }
    }
    /**
     * @returns {Engine}
     */
    clone_engine() {
        const ret = wasm.engine_clone_engine(this.__wbg_ptr);
        return Engine.__wrap(ret);
    }
    /**
     * @returns {Uint8Array}
     */
    compact() {
        const ret = wasm.engine_compact(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Cells the last feed counted (prices are set against this).
     * @returns {number}
     */
    counted() {
        const ret = wasm.engine_counted(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * PETRI units earned per colony since this engine started, approximate (f64), for display.
     * @returns {Float64Array}
     */
    earned() {
        const ret = wasm.engine_earned(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Exact PETRI units one colony earned since this engine started, as a decimal string.
     * @param {number} colony
     * @returns {string}
     */
    earned_of(colony) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_earned_of(this.__wbg_ptr, colony);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    generation() {
        const ret = wasm.engine_generation(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {number}
     */
    height() {
        const ret = wasm.engine_height(this.__wbg_ptr);
        return ret;
    }
    /**
     * Exact PETRI units set aside for keepers since this engine started.
     * @returns {string}
     */
    keeper_total() {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_keeper_total(this.__wbg_ptr);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {Uint32Array}
     */
    last_births() {
        const ret = wasm.engine_last_births(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {number}
     */
    last_contested() {
        const ret = wasm.engine_last_contested(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {Uint32Array}
     */
    last_deaths() {
        const ret = wasm.engine_last_deaths(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @returns {Uint32Array}
     */
    live_counts() {
        const ret = wasm.engine_live_counts(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * @param {Uint8Array | number[]} bytes
     * @param {number} generation
     * @param {string} chain_hex
     * @returns {boolean}
     */
    load_compact(bytes, generation, chain_hex) {
        const val3 = +generation;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(chain_hex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.engine_load_compact(this.__wbg_ptr, ptr0, len0, val3, ptr1, len1);
        return ret !== 0;
    }
    /**
     * @param {number} width
     * @param {number} height
     * @param {number} feed_ppm
     * @param {number} keeper_bps
     * @param {number} reach
     * @param {number} live_floor
     */
    constructor(width, height, feed_ppm, keeper_bps, reach, live_floor) {
        const ret = wasm.engine_new(width, height, feed_ppm, keeper_bps, reach, live_floor);
        this.__wbg_ptr = ret;
        EngineFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Plant without checks (replaying the contract's log).
     * @param {number} colony
     * @param {Uint32Array | number[]} cells
     */
    plant(colony, cells) {
        const val2 = +colony;
        const ptr0 = passArray32ToWasm0(cells, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_plant(this.__wbg_ptr, val2, ptr0, len0);
    }
    /**
     * Start from a stored board (the contract's `board` view, base64-decoded) at a known generation.
     * @param {string} units
     */
    set_agar(units) {
        const ptr0 = passStringToWasm0(units, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_set_agar(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * @param {number} n
     */
    set_colonies(n) {
        wasm.engine_set_colonies(this.__wbg_ptr, n);
    }
    /**
     * Start from the contract's count when the engine starts mid-history.
     * @param {number} counted
     */
    set_counted(counted) {
        wasm.engine_set_counted(this.__wbg_ptr, counted);
    }
    /**
     * The dish's house colonies (the contract's `state().house`): they are never fed and win no tides.
     * @param {Uint16Array | number[]} house
     */
    set_house(house) {
        const ptr0 = passArray16ToWasm0(house, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_set_house(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Cells each colony has planted, as the contract counts them (when the engine starts mid-history).
     * @param {Uint32Array | number[]} planted
     */
    set_planted(planted) {
        const ptr0 = passArray32ToWasm0(planted, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.engine_set_planted(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Advance `n` generations, tracking the chain and the agar's feed exactly as the contract does.
     * @param {number} n
     */
    step(n) {
        wasm.engine_step(this.__wbg_ptr, n);
    }
    /**
     * Run a tide: split `pay` yoctoNEAR by the window's earnings, skipping the house, add it to each colony's winnings
     * and reset the window. Returns the total paid to colonies, as a decimal string.
     * @param {string} pay
     * @returns {string}
     */
    tide(pay) {
        let deferred2_0;
        let deferred2_1;
        try {
            const ptr0 = passStringToWasm0(pay, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_tide(this.__wbg_ptr, ptr0, len0);
            deferred2_0 = ret[0];
            deferred2_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    total_live() {
        const ret = wasm.engine_total_live(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    width() {
        const ret = wasm.engine_width(this.__wbg_ptr);
        return ret;
    }
    /**
     * One colony's earnings since the last tide (PETRI units), for showing a tide's likely split.
     * @param {number} colony
     * @returns {string}
     */
    window_of(colony) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_window_of(this.__wbg_ptr, colony);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Exact NEAR one colony won at the tides since this engine started (yoctoNEAR, decimal string).
     * @param {number} colony
     * @returns {string}
     */
    won_of(colony) {
        let deferred1_0;
        let deferred1_1;
        try {
            const ret = wasm.engine_won_of(this.__wbg_ptr, colony);
            deferred1_0 = ret[0];
            deferred1_1 = ret[1];
            return getStringFromWasm0(ret[0], ret[1]);
        } finally {
            wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

/**
 * PETRI units that `near` yoctoNEAR buys from an agar of `agar` units, with `petri_price` yoctoNEAR per PETRI at
 * launch and `max_supply` units in all.
 * @param {string} near
 * @param {string} agar
 * @param {string} petri_price
 * @param {string} max_supply
 * @returns {string}
 */
export function buy_quote(near, agar, petri_price, max_supply) {
    let deferred5_0;
    let deferred5_1;
    try {
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3;
        try {
            ptr0 = passStringToWasm0(near, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(agar, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(petri_price, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passStringToWasm0(max_supply, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len3 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.buy_quote(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
        deferred5_0 = ret[0];
        deferred5_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * Flat indices for a named pattern placed at (x, y), wrapped onto the dish. Empty if the name is unknown.
 * @param {string} name
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} rotate
 * @param {boolean} flip
 * @returns {Uint32Array}
 */
export function pattern_cells(name, x, y, width, height, rotate, flip) {
    const val2 = +x;
    const val3 = +y;
    const val4 = +width;
    const val5 = +height;
    const val6 = +rotate;
    const val7 = +flip;
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pattern_cells(ptr0, len0, val2, val3, val4, val5, val6, val7);
    var v8 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v8;
}

/**
 * What planting `cells` costs in PETRI units (decimal string), given the agar and the cells the last feed counted
 * (`counted`, the contract's `state().counted`; pass it as `total_live`); a siege
 * (a planting inside a rival's buffer) costs `siege_x` times as much.
 * @param {string} agar
 * @param {number} feed_ppm
 * @param {number} keeper_bps
 * @param {number} total_live
 * @param {number} live_floor
 * @param {number} payback
 * @param {string} min_price
 * @param {number} cells
 * @param {boolean} siege
 * @param {number} siege_x
 * @returns {string}
 */
export function quote(agar, feed_ppm, keeper_bps, total_live, live_floor, payback, min_price, cells, siege, siege_x) {
    let deferred11_0;
    let deferred11_1;
    try {
        const val3 = +feed_ppm;
        const val4 = +keeper_bps;
        const val5 = +total_live;
        const val6 = +live_floor;
        const val7 = +payback;
        const val8 = +cells;
        const val9 = +siege;
        const val10 = +siege_x;
        let ptr0, len0, ptr1, len1;
        try {
            ptr0 = passStringToWasm0(agar, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(min_price, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.quote(ptr0, len0, val3, val4, val5, val6, val7, ptr1, len1, val8, val9, val10);
        deferred11_0 = ret[0];
        deferred11_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred11_0, deferred11_1, 1);
    }
}

/**
 * yoctoNEAR the agar pays for `petri` units handed back (before the sale's record): `sell_bps` of the curve, but never
 * more than their share of `vault` among `outstanding` PETRI (all PETRI outside the agar).
 * @param {string} petri
 * @param {string} agar
 * @param {string} petri_price
 * @param {string} max_supply
 * @param {number} sell_bps
 * @param {string} vault
 * @param {string} outstanding
 * @returns {string}
 */
export function sell_quote(petri, agar, petri_price, max_supply, sell_bps, vault, outstanding) {
    let deferred8_0;
    let deferred8_1;
    try {
        const val7 = +sell_bps;
        let ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5;
        try {
            ptr0 = passStringToWasm0(petri, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len0 = WASM_VECTOR_LEN;
            ptr1 = passStringToWasm0(agar, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len1 = WASM_VECTOR_LEN;
            ptr2 = passStringToWasm0(petri_price, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len2 = WASM_VECTOR_LEN;
            ptr3 = passStringToWasm0(max_supply, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len3 = WASM_VECTOR_LEN;
            ptr4 = passStringToWasm0(vault, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len4 = WASM_VECTOR_LEN;
            ptr5 = passStringToWasm0(outstanding, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            len5 = WASM_VECTOR_LEN;
        } catch (e) {
            if (ptr5) { wasm.__wbindgen_free(ptr5, len5 * 1, 1); }
            if (ptr4) { wasm.__wbindgen_free(ptr4, len4 * 1, 1); }
            if (ptr3) { wasm.__wbindgen_free(ptr3, len3 * 1, 1); }
            if (ptr2) { wasm.__wbindgen_free(ptr2, len2 * 1, 1); }
            if (ptr1) { wasm.__wbindgen_free(ptr1, len1 * 1, 1); }
            if (ptr0) { wasm.__wbindgen_free(ptr0, len0 * 1, 1); }
            throw e;
        }
        const ret = wasm.sell_quote(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, val7, ptr4, len4, ptr5, len5);
        deferred8_0 = ret[0];
        deferred8_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred8_0, deferred8_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_4c88d8bf264fd984: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            table.set(0, undefined);
            table.set(1024, undefined);
            table.set(1025, null);
            table.set(1026, true);
            table.set(1027, false);
        },
    };
    return {
        __proto__: null,
        "./petri_bg.js": import0,
    };
}

const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr, 1));

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayU16FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint16ArrayMemory0().subarray(ptr / 2, ptr / 2 + len);
}

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return decodeText(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

let cachedUint16ArrayMemory0 = null;
function getUint16ArrayMemory0() {
    if (cachedUint16ArrayMemory0 === null || cachedUint16ArrayMemory0.byteLength === 0) {
        cachedUint16ArrayMemory0 = new Uint16Array(wasm.memory.buffer);
    }
    return cachedUint16ArrayMemory0;
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray16ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 2, 2) >>> 0;
    getUint16ArrayMemory0().set(arg, ptr / 2);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(bytes) {
    numBytesDecoded += bytes.length;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true });
        cachedTextDecoder.decode();
        numBytesDecoded = bytes.length;
    }
    return cachedTextDecoder.decode(bytes);
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedFloat64ArrayMemory0 = null;
    cachedUint16ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

let __wbg_init_promise;
async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;
    if (__wbg_init_promise === undefined) {
        __wbg_init_promise = __wbg_init_once(module_or_path);
        __wbg_init_promise.catch(() => { __wbg_init_promise = undefined; });
    }
    return __wbg_init_promise;
}

async function __wbg_init_once(module_or_path) {

    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('petri_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
