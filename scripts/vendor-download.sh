#!/usr/bin/env bash
# vendor-download.sh -- scarica/aggiorna le vendor libraries in public/vendor/.
# Eseguire dalla root del repo: bash scripts/vendor-download.sh
# Idempotente: se un file/directory destinazione esiste, viene saltato.
# Per upgrade: cambiare la _VERSION corrispondente, rilanciare, committare.
set -euo pipefail

VENDOR_ROOT="public/vendor"

PICO_VERSION="2.1.1"
ALPINE_VERSION="3.15.12"
SUPABASE_VERSION="2.105.3"
HTML5QR_VERSION="2.3.8"
QRCODE_VERSION="1.5.4"
SHOELACE_VERSION="2.20.1"

JSDELIVR="https://cdn.jsdelivr.net/npm"

command -v curl >/dev/null 2>&1 || { echo "[error] curl richiesto"; exit 1; }
command -v tar  >/dev/null 2>&1 || { echo "[error] tar richiesto per Shoelace"; exit 1; }

download_file() {
  local url="$1"
  local dest="$2"
  if [[ -f "$dest" ]]; then
    echo "[skip] $dest"
    return
  fi
  mkdir -p "$(dirname "$dest")"
  curl -fsSL "$url" -o "$dest"
  echo "[ok]   $dest"
}

# 1. Pico CSS
download_file \
  "${JSDELIVR}/@picocss/pico@${PICO_VERSION}/css/pico.min.css" \
  "${VENDOR_ROOT}/pico/${PICO_VERSION}/pico.min.css"

# 2. Alpine.js
download_file \
  "${JSDELIVR}/alpinejs@${ALPINE_VERSION}/dist/cdn.min.js" \
  "${VENDOR_ROOT}/alpinejs/${ALPINE_VERSION}/alpine.min.js"

# 3. Supabase JS (UMD bundle browser)
download_file \
  "${JSDELIVR}/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.js" \
  "${VENDOR_ROOT}/supabase/${SUPABASE_VERSION}/supabase.js"

# 4. html5-qrcode
download_file \
  "${JSDELIVR}/html5-qrcode@${HTML5QR_VERSION}/html5-qrcode.min.js" \
  "${VENDOR_ROOT}/html5-qrcode/${HTML5QR_VERSION}/html5-qrcode.min.js"

# 5. qrcode (ESM bundle, jsdelivr +esm). Il package upstream non
# pubblica un UMD browser standalone: lib/browser.js e' un wrapper
# che richiede un bundler. Il bundle ESM auto-generato da jsdelivr
# (rollup+terser) e' pronto per <script type="module">.
# Il bundle ha 1 dipendenza esterna runtime su /npm/dijkstrajs@1.0.3/+esm
# che noi NON serviamo: la self-hostiamo come dijkstrajs.js a fianco e
# patchiamo l'import path nel bundle a /vendor/qrcode/<v>/dijkstrajs.js.
DIJKSTRA_VERSION="1.0.3"
download_file \
  "${JSDELIVR}/qrcode@${QRCODE_VERSION}/+esm" \
  "${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/qrcode.esm.min.js"
download_file \
  "${JSDELIVR}/dijkstrajs@${DIJKSTRA_VERSION}/+esm" \
  "${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/dijkstrajs.js"
# Patch idempotente: sostituisci l'import esterno se presente
QRCODE_BUNDLE="${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/qrcode.esm.min.js"
if grep -q '/npm/dijkstrajs@' "$QRCODE_BUNDLE"; then
  sed -i "s|from\"/npm/dijkstrajs@${DIJKSTRA_VERSION}/+esm\"|from\"/vendor/qrcode/${QRCODE_VERSION}/dijkstrajs.js\"|g" "$QRCODE_BUNDLE"
  echo "[ok]   patched qrcode bundle import dijkstrajs -> /vendor/qrcode/${QRCODE_VERSION}/dijkstrajs.js"
fi

# 6. Shoelace -- intera cartella cdn/ via tarball npm registry (no npm CLI)
SL_DEST="${VENDOR_ROOT}/shoelace/${SHOELACE_VERSION}"
if [[ -d "$SL_DEST" && -f "${SL_DEST}/shoelace-autoloader.js" ]]; then
  echo "[skip] $SL_DEST gia presente"
else
  echo "[..]   Shoelace via tarball npm registry..."
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  TARBALL_URL="https://registry.npmjs.org/@shoelace-style/shoelace/-/shoelace-${SHOELACE_VERSION}.tgz"
  curl -fsSL "$TARBALL_URL" -o "${TMPDIR}/shoelace.tgz"
  tar -xzf "${TMPDIR}/shoelace.tgz" -C "${TMPDIR}"
  [[ -d "${TMPDIR}/package/cdn" ]] || { echo "[error] cdn/ non trovato nel tarball Shoelace"; exit 1; }
  mkdir -p "$SL_DEST"
  cp -R "${TMPDIR}/package/cdn/." "$SL_DEST/"
  echo "[ok]   $SL_DEST (cartella cdn/)"
fi

echo
echo "[done] vendor scaricati in $VENDOR_ROOT"
