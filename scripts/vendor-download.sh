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

# 5. qrcode (browser bundle minified)
download_file \
  "${JSDELIVR}/qrcode@${QRCODE_VERSION}/lib/browser.min.js" \
  "${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/qrcode.min.js"

# 6. Shoelace -- intera cartella cdn/ via npm pack
SL_DEST="${VENDOR_ROOT}/shoelace/${SHOELACE_VERSION}"
if [[ -d "$SL_DEST" && -f "${SL_DEST}/shoelace-autoloader.js" ]]; then
  echo "[skip] $SL_DEST gia presente"
else
  echo "[..]   Shoelace via npm pack..."
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  (
    cd "$TMPDIR"
    npm pack --silent "@shoelace-style/shoelace@${SHOELACE_VERSION}" > /dev/null
    tar -xzf "shoelace-style-shoelace-${SHOELACE_VERSION}.tgz"
  )
  mkdir -p "$SL_DEST"
  cp -R "${TMPDIR}/package/cdn/." "$SL_DEST/"
  echo "[ok]   $SL_DEST (cartella cdn/)"
fi

echo
echo "[done] vendor scaricati in $VENDOR_ROOT"
