//! The purse's wasm is built first and embedded: set PURSE_WASM to its path. Without it (native tests) the factory
//! embeds nothing and refuses to seal.
use std::{env, fs, path::PathBuf};

fn main() {
    println!("cargo:rerun-if-env-changed=PURSE_WASM");
    let out = PathBuf::from(env::var("OUT_DIR").unwrap()).join("purse.wasm");
    match env::var("PURSE_WASM") {
        Ok(p) if !p.is_empty() => {
            println!("cargo:rerun-if-changed={}", p);
            fs::copy(&p, &out).expect("PURSE_WASM must point at the purse's built wasm");
        }
        _ => fs::write(&out, b"").unwrap(),
    }
}
