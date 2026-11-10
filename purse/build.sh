#!/usr/bin/env bash
# Build the purse, then the factory with the purse embedded, into purse/res/. Run in WSL or Linux with the
# wasm32-unknown-unknown target. WASM_OPT (binaryen's wasm-opt) shrinks both if set; the committed builds used
# binaryen version_117 with -Oz.
set -euo pipefail
cd "$(dirname "$0")"
T="${CARGO_TARGET_DIR:-target}"
export CARGO_TARGET_DIR="$T"
FEATURES="--enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types"
mkdir -p res
opt() {
  if [ -n "${WASM_OPT:-}" ]; then "$WASM_OPT" -Oz $FEATURES --strip-debug --strip-producers "$1" -o "$2"; else cp "$1" "$2"; fi
}
cargo build --release --target wasm32-unknown-unknown -p petri-purse
opt "$T/wasm32-unknown-unknown/release/petri_purse.wasm" res/petri_purse.wasm
PURSE_WASM="$(pwd)/res/petri_purse.wasm" cargo build --release --target wasm32-unknown-unknown -p petri-purse-factory
opt "$T/wasm32-unknown-unknown/release/petri_purse_factory.wasm" res/petri_purse_factory.wasm
ls -l res/*.wasm
sha256sum res/*.wasm
