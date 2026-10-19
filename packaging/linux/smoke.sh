#!/usr/bin/env bash
# Install the signed RPM the way a user would (key imported, signature checking on), start the
# app headless with DITHER_SMOKE, and check what it reports; then the AppImage the same way.
set -euo pipefail
variant="${1:-standard}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle="$root/src-tauri/target/release/bundle"
rpm_file="$(ls "$bundle"/rpm/*.rpm | head -n1)"
appimage="$(ls "$bundle"/appimage/*.AppImage | head -n1)"

# Serve the model packs so the app can install one through its own (Rust) download path.
python3 -m http.server 8765 --bind 127.0.0.1 --directory "$root/models/packs" >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
export DITHER_SMOKE_PACKS="http://127.0.0.1:8765/"

rpm --import "$root/packaging/linux/out/dither-rpm-signing.asc"
# gpgcheck stays on: dnf refuses the package unless its signature verifies.
dnf -y install --setopt=localpkg_gpgcheck=1 "$rpm_file"

check() {
  local report="$1"
  cat "$report"; echo
  python3 - "$report" "$variant" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
assert "error" not in r, r
assert r["storage"] == "sqlite", r
assert r["modelStore"] == "tauri", r
assert not r["errors"], r["errors"]
m = r.get("model") or {}
assert m.get("installed") and m.get("legalMoves") == 20, m
print("smoke OK:", sys.argv[2], "isolated" if r["crossOriginIsolated"] else "not isolated", r.get("inference"), m)
PY
}

export DITHER_SMOKE="$(mktemp --suffix=.json)"
dbus-run-session -- xvfb-run -a dither
check "$DITHER_SMOKE"

chmod +x "$appimage"
export APPIMAGE_EXTRACT_AND_RUN=1
export DITHER_SMOKE="$(mktemp --suffix=.json)"
dbus-run-session -- xvfb-run -a "$appimage"
check "$DITHER_SMOKE"

dnf -y remove dither
