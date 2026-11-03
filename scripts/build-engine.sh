#!/usr/bin/env bash
# Rebuild the browser engine (petri-core compiled to WebAssembly), copy it into the site, and stamp its hash into
# web/src/engine/index.ts so browsers never pair a new engine with a cached old binary.
#
#   bash scripts/build-engine.sh        (needs Rust, wasm-pack and sha256sum)
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
(cd wasm && wasm-pack build --release --target web --out-dir "$out" --out-name petri)
pkg=web/src/engine/pkg
cp "$out/petri.js" "$out/petri.d.ts" "$out/petri_bg.wasm" "$out/petri_bg.wasm.d.ts" "$pkg/"
printf '{ "type": "module" }\n' > "$pkg/package.json"
cp "$out/petri_bg.wasm" web/public/petri_bg.wasm
hash="$(sha256sum web/public/petri_bg.wasm | cut -c1-12)"
sed -i "s/^export const ENGINE_HASH = \"[0-9a-f]*\";/export const ENGINE_HASH = \"$hash\";/" web/src/engine/index.ts
rm -rf "$out"
echo "engine $hash"
