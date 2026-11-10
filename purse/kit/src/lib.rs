//! What the living-slide purse and its factory need from NEAR, without near-sdk.
//!
//! On wasm32 these call the host functions directly (a bump allocator, no formatting machinery), which keeps each
//! contract a few kilobytes. Natively they run against `mock`, a small in-memory chain, so the contracts' own code is
//! what the unit tests exercise.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::vec::Vec;

pub mod json;

#[cfg(not(target_arch = "wasm32"))]
pub mod mock;

/// NEAR's storage price: 10^19 yoctoNEAR a byte (1 NEAR per 100 KB).
pub const BYTE_COST: u128 = 10_000_000_000_000_000_000;
pub const TGAS: u64 = 1_000_000_000_000;

#[cfg(target_arch = "wasm32")]
mod sys {
    #[link(wasm_import_module = "env")]
    extern "C" {
        pub fn read_register(register_id: u64, ptr: u64);
        pub fn register_len(register_id: u64) -> u64;
        pub fn current_account_id(register_id: u64);
        pub fn predecessor_account_id(register_id: u64);
        pub fn input(register_id: u64);
        pub fn block_index() -> u64;
        pub fn block_timestamp() -> u64;
        pub fn storage_usage() -> u64;
        pub fn account_balance(balance_ptr: u64);
        pub fn attached_deposit(balance_ptr: u64);
        pub fn prepaid_gas() -> u64;
        pub fn used_gas() -> u64;
        pub fn value_return(value_len: u64, value_ptr: u64);
        pub fn panic_utf8(len: u64, ptr: u64) -> !;
        pub fn log_utf8(len: u64, ptr: u64);
        pub fn storage_write(key_len: u64, key_ptr: u64, value_len: u64, value_ptr: u64, register_id: u64) -> u64;
        pub fn storage_read(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
        pub fn storage_remove(key_len: u64, key_ptr: u64, register_id: u64) -> u64;
        pub fn promise_batch_create(account_id_len: u64, account_id_ptr: u64) -> u64;
        pub fn promise_batch_then(promise_index: u64, account_id_len: u64, account_id_ptr: u64) -> u64;
        pub fn promise_batch_action_create_account(promise_index: u64);
        pub fn promise_batch_action_deploy_contract(promise_index: u64, code_len: u64, code_ptr: u64);
        pub fn promise_batch_action_function_call_weight(
            promise_index: u64,
            function_name_len: u64,
            function_name_ptr: u64,
            arguments_len: u64,
            arguments_ptr: u64,
            amount_ptr: u64,
            gas: u64,
            weight: u64,
        );
        pub fn promise_batch_action_transfer(promise_index: u64, amount_ptr: u64);
        pub fn promise_return(promise_id: u64);
        pub fn promise_results_count() -> u64;
        pub fn promise_result(result_idx: u64, register_id: u64) -> u64;
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use core::alloc::{GlobalAlloc, Layout};

    /// Every call is short and starts with fresh memory, so nothing is ever freed.
    struct Bump;
    static mut NEXT: usize = 0;
    static mut END: usize = 0;

    unsafe impl GlobalAlloc for Bump {
        unsafe fn alloc(&self, l: Layout) -> *mut u8 {
            if END == 0 {
                END = core::arch::wasm32::memory_size(0) * 65536;
                NEXT = END;
            }
            let start = (NEXT + l.align() - 1) & !(l.align() - 1);
            let end = start + l.size();
            if end > END {
                let pages = (end - END + 65535) / 65536;
                if core::arch::wasm32::memory_grow(0, pages) == usize::MAX {
                    return core::ptr::null_mut();
                }
                END += pages * 65536;
            }
            NEXT = end;
            start as *mut u8
        }
        unsafe fn dealloc(&self, _: *mut u8, _: Layout) {}
    }

    #[global_allocator]
    static ALLOC: Bump = Bump;

    #[panic_handler]
    fn panic(_: &core::panic::PanicInfo) -> ! {
        super::fail("internal error")
    }
}

#[cfg(target_arch = "wasm32")]
fn register() -> Option<Vec<u8>> {
    unsafe {
        let len = sys::register_len(0);
        if len == u64::MAX {
            return None;
        }
        let mut v = alloc::vec![0u8; len as usize];
        sys::read_register(0, v.as_mut_ptr() as u64);
        Some(v)
    }
}

#[cfg(target_arch = "wasm32")]
mod host {
    use super::*;

    pub fn input() -> Vec<u8> {
        unsafe { sys::input(0) };
        register().unwrap_or_default()
    }
    pub fn current() -> Vec<u8> {
        unsafe { sys::current_account_id(0) };
        register().unwrap()
    }
    pub fn predecessor() -> Vec<u8> {
        unsafe { sys::predecessor_account_id(0) };
        register().unwrap()
    }
    pub fn attached() -> u128 {
        let mut b = [0u8; 16];
        unsafe { sys::attached_deposit(b.as_mut_ptr() as u64) };
        u128::from_le_bytes(b)
    }
    pub fn balance() -> u128 {
        let mut b = [0u8; 16];
        unsafe { sys::account_balance(b.as_mut_ptr() as u64) };
        u128::from_le_bytes(b)
    }
    pub fn storage_usage() -> u64 {
        unsafe { sys::storage_usage() }
    }
    pub fn prepaid_gas() -> u64 {
        unsafe { sys::prepaid_gas() }
    }
    pub fn used_gas() -> u64 {
        unsafe { sys::used_gas() }
    }
    pub fn block_height() -> u64 {
        unsafe { sys::block_index() }
    }
    pub fn block_ms() -> u64 {
        unsafe { sys::block_timestamp() / 1_000_000 }
    }
    pub fn read(key: &[u8]) -> Option<Vec<u8>> {
        if unsafe { sys::storage_read(key.len() as u64, key.as_ptr() as u64, 0) } == 1 {
            register()
        } else {
            None
        }
    }
    pub fn write(key: &[u8], value: &[u8]) {
        unsafe { sys::storage_write(key.len() as u64, key.as_ptr() as u64, value.len() as u64, value.as_ptr() as u64, 1) };
    }
    pub fn remove(key: &[u8]) {
        unsafe { sys::storage_remove(key.len() as u64, key.as_ptr() as u64, 1) };
    }
    pub fn ret(value: &[u8]) {
        unsafe { sys::value_return(value.len() as u64, value.as_ptr() as u64) }
    }
    pub fn log(msg: &[u8]) {
        unsafe { sys::log_utf8(msg.len() as u64, msg.as_ptr() as u64) }
    }
    pub fn fail(msg: &str) -> ! {
        unsafe { sys::panic_utf8(msg.len() as u64, msg.as_ptr() as u64) }
    }
    pub fn batch(account: &[u8]) -> u64 {
        unsafe { sys::promise_batch_create(account.len() as u64, account.as_ptr() as u64) }
    }
    pub fn batch_then(after: u64, account: &[u8]) -> u64 {
        unsafe { sys::promise_batch_then(after, account.len() as u64, account.as_ptr() as u64) }
    }
    pub fn a_create(p: u64) {
        unsafe { sys::promise_batch_action_create_account(p) }
    }
    pub fn a_deploy(p: u64, code: &[u8]) {
        unsafe { sys::promise_batch_action_deploy_contract(p, code.len() as u64, code.as_ptr() as u64) }
    }
    pub fn a_call(p: u64, method: &str, args: &[u8], amount: u128, gas: u64, weight: u64) {
        let a = amount.to_le_bytes();
        unsafe {
            sys::promise_batch_action_function_call_weight(
                p,
                method.len() as u64,
                method.as_ptr() as u64,
                args.len() as u64,
                args.as_ptr() as u64,
                a.as_ptr() as u64,
                gas,
                weight,
            )
        }
    }
    pub fn a_transfer(p: u64, amount: u128) {
        let a = amount.to_le_bytes();
        unsafe { sys::promise_batch_action_transfer(p, a.as_ptr() as u64) }
    }
    pub fn promise_return(p: u64) {
        unsafe { sys::promise_return(p) }
    }
    pub fn result_count() -> u64 {
        unsafe { sys::promise_results_count() }
    }
    /// The value promise `i` returned, or None if it failed.
    pub fn result(i: u64) -> Option<Vec<u8>> {
        if unsafe { sys::promise_result(i, 0) } == 1 {
            Some(register().unwrap_or_default())
        } else {
            None
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
use mock as host;

pub use host::*;

/// Contract methods: exported to the host on wasm32, plain functions natively (so tests can call them and catch their
/// failures).
#[macro_export]
macro_rules! methods {
    ($($(#[$m:meta])* fn $name:ident() $body:block)*) => { $(
        $(#[$m])*
        #[cfg(target_arch = "wasm32")]
        #[no_mangle]
        pub extern "C" fn $name() $body
        $(#[$m])*
        #[cfg(not(target_arch = "wasm32"))]
        pub fn $name() $body
    )* };
}

// ---------- helpers both contracts use ----------

/// Fail unless `cond`.
pub fn require(cond: bool, msg: &str) {
    if !cond {
        fail(msg)
    }
}

pub fn require_one_yocto() {
    require(attached() == 1, "attach exactly 1 yoctoNEAR")
}

pub fn read_u64(key: &[u8]) -> u64 {
    read(key).map(|v| le_u64(&v, 0)).unwrap_or(0)
}

pub fn le_u64(v: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&v[at..at + 8]);
    u64::from_le_bytes(b)
}

pub fn le_u32(v: &[u8], at: usize) -> u32 {
    let mut b = [0u8; 4];
    b.copy_from_slice(&v[at..at + 4]);
    u32::from_le_bytes(b)
}

pub fn le_u128(v: &[u8], at: usize) -> u128 {
    let mut b = [0u8; 16];
    b.copy_from_slice(&v[at..at + 16]);
    u128::from_le_bytes(b)
}

/// A valid NEAR account id: 2 to 64 characters of a-z, 0-9 and the separators `-`, `_` and `.`, which never start,
/// end or follow one another.
pub fn valid_account(a: &[u8]) -> bool {
    if a.len() < 2 || a.len() > 64 {
        return false;
    }
    let mut last_sep = true;
    for &c in a {
        let sep = c == b'-' || c == b'_' || c == b'.';
        if sep {
            if last_sep {
                return false;
            }
        } else if !(c.is_ascii_lowercase() || c.is_ascii_digit()) {
            return false;
        }
        last_sep = sep;
    }
    !last_sep
}

/// A plain decimal token id: 1 to 10 digits, no leading zero.
pub fn valid_token_id(t: &[u8]) -> bool {
    !t.is_empty() && t.len() <= 10 && t[0] != b'0' && t.iter().all(|c| c.is_ascii_digit())
}
