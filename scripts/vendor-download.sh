#!/usr/bin/env bash
# Idempotente: file esistente -> skip. Upgrade: cambia _VERSION, rilancia, committa.
set -euo pipefail

VENDOR_ROOT="public/vendor"

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

download_file \
  "${JSDELIVR}/alpinejs@${ALPINE_VERSION}/dist/cdn.min.js" \
  "${VENDOR_ROOT}/alpinejs/${ALPINE_VERSION}/alpine.min.js"

download_file \
  "${JSDELIVR}/@supabase/supabase-js@${SUPABASE_VERSION}/dist/umd/supabase.js" \
  "${VENDOR_ROOT}/supabase/${SUPABASE_VERSION}/supabase.js"

download_file \
  "${JSDELIVR}/html5-qrcode@${HTML5QR_VERSION}/html5-qrcode.min.js" \
  "${VENDOR_ROOT}/html5-qrcode/${HTML5QR_VERSION}/html5-qrcode.min.js"

# Il bundle ESM di jsdelivr per qrcode ha import runtime su
# /npm/dijkstrajs@<v>/+esm. Self-hostiamo dijkstrajs e patchiamo l'import
# path per evitare fetch verso jsdelivr in runtime.
DIJKSTRA_VERSION="1.0.3"
download_file \
  "${JSDELIVR}/qrcode@${QRCODE_VERSION}/+esm" \
  "${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/qrcode.esm.min.js"
download_file \
  "${JSDELIVR}/dijkstrajs@${DIJKSTRA_VERSION}/+esm" \
  "${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/dijkstrajs.js"
QRCODE_BUNDLE="${VENDOR_ROOT}/qrcode/${QRCODE_VERSION}/qrcode.esm.min.js"
if grep -q '/npm/dijkstrajs@' "$QRCODE_BUNDLE"; then
  sed -i "s|from\"/npm/dijkstrajs@${DIJKSTRA_VERSION}/+esm\"|from\"/vendor/qrcode/${QRCODE_VERSION}/dijkstrajs.js\"|g" "$QRCODE_BUNDLE"
  echo "[ok]   patched qrcode bundle import dijkstrajs -> /vendor/qrcode/${QRCODE_VERSION}/dijkstrajs.js"
fi

# Shoelace via tarball npm registry: serve l'intera cartella cdn/.
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
