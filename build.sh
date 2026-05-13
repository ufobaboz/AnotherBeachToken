#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL non impostata: configura le env vars su Cloudflare Pages.}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY non impostata: configura le env vars su Cloudflare Pages.}"

mkdir -p public/assets

cat > public/assets/config.js <<EOF
// Generato da build.sh. Non committare.
window.APP_CONFIG = {
  SUPABASE_URL: '${SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}'
};
EOF

echo "[OK] public/assets/config.js generato."
