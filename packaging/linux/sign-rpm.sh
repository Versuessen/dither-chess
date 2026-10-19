#!/usr/bin/env bash
# Sign RPMs with `rpm --addsign` and check the signature with the exported public key.
#
# With RPM_SIGNING_KEY (ASCII-armoured private key) and RPM_SIGNING_PASSPHRASE set, that key
# signs. Without them (forks, pull requests) a throwaway key is generated so the signed-install
# path is still tested; such builds are never published.
#
# Writes the public key to packaging/linux/out/dither-rpm-signing.asc. Users import it with
#   sudo rpm --import dither-rpm-signing.asc
# and then install normally; signature checking stays on.
set -euo pipefail
[ $# -ge 1 ] || { echo "usage: $0 file.rpm..." >&2; exit 2; }
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/out"
mkdir -p "$out"
export GNUPGHOME="$(mktemp -d)"
chmod 700 "$GNUPGHOME"
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT

if [ -n "${RPM_SIGNING_KEY:-}" ]; then
  printf '%s\n' "$RPM_SIGNING_KEY" | gpg --batch --pinentry-mode loopback --passphrase "${RPM_SIGNING_PASSPHRASE:-}" --import
  passphrase="${RPM_SIGNING_PASSPHRASE:-}"
else
  echo "RPM_SIGNING_KEY is not set: signing with a throwaway key (this build must not be published)" >&2
  passphrase=""
  gpg --batch --pinentry-mode loopback --passphrase '' --quick-gen-key "DITHER test signing <test@dither.invalid>" rsa4096 sign 1d
fi
fpr="$(gpg --batch --with-colons --list-secret-keys | awk -F: '/^fpr:/ {print $10; exit}')"
gpg --batch --armor --export "$fpr" > "$out/dither-rpm-signing.asc"

pass="$(mktemp)"
printf '%s' "$passphrase" > "$pass"
for rpm in "$@"; do
  rpm --define "_gpg_name $fpr" \
      --define "_gpg_sign_cmd_extra_args --batch --pinentry-mode loopback --passphrase-file $pass" \
      --addsign "$rpm"
done
rm -f "$pass"

# Verify against a keyring that holds only the exported public key.
db="$(mktemp -d)"
rpm --dbpath "$db" --initdb
rpm --dbpath "$db" --import "$out/dither-rpm-signing.asc"
for rpm in "$@"; do
  rpm --dbpath "$db" -K "$rpm"
  rpm --dbpath "$db" -K "$rpm" | grep -Eq 'signatures OK|digests signatures OK' || { echo "signature check failed: $rpm" >&2; exit 1; }
done
rm -rf "$db"
echo "signed and verified: $*"
