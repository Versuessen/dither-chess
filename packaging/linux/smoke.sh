#!/usr/bin/env bash
# Install the signed RPM the way a user would (key imported, signature checking on), start the
# app headless with DITHER_SMOKE, and check what it reports; then the AppImage the same way.
set -euo pipefail
variant="${1:-standard}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
bundle="$root/src-tauri/target/release/bundle"
rpm_file="$(ls "$bundle"/rpm/*.rpm | head -n1)"
appimage="$(ls "$bundle"/appimage/*.AppImage | head -n1)"

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
print("smoke OK:", sys.argv[2], "isolated" if r["crossOriginIsolated"] else "not isolated", r.get("inference"))
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
