#!/bin/bash
# Builds build/autohan0.app: engine bundle (npm) -> Swift (release) -> app bundle -> local signature.
# Signing identity: $AUTOHAN0_SIGN_IDENTITY, else the name in apps/macos/.sign-identity (local, not
# committed; e.g. "Apple Development: Name (TEAMID)"), else the keychain's Developer ID Application,
# else "autohan0 local signing" (a self-signed Code Signing certificate, see README), else ad hoc.
# With a certificate the Accessibility permission survives rebuilds; ad hoc, macOS asks again
# after every build because the signature (cdhash) changes.
# No hardened runtime: notarization is out of scope, and under it opening System Settings panes
# would also need the Apple Events entitlement.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
APP="build/autohan0.app"

if command -v npm >/dev/null 2>&1 && [ -d "$ROOT/node_modules" ]; then
  echo "▸ 엔진 번들 (npm run build:jsc)"
  (cd "$ROOT" && npm run --silent build:jsc -w @autohan0/engine >/dev/null)
fi
[ -f Resources/autohan0-engine.js ] || { echo "Resources/autohan0-engine.js 없음: 저장소 루트에서 npm install 후 다시 실행" >&2; exit 1; }

echo "▸ Swift 빌드 (release)"
swift build -c release --product autohan0
BIN="$(swift build -c release --show-bin-path)/autohan0"

echo "▸ $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/autohan0"
cp Resources/Info.plist "$APP/Contents/Info.plist"
cp Resources/autohan0-engine.js "$APP/Contents/Resources/"

# 서명 순서: $AUTOHAN0_SIGN_IDENTITY → 키체인의 "Developer ID Application" → .sign-identity 파일
# → "autohan0 local signing" → ad hoc  (release.sh는 Developer ID가 필요하므로 그것이 파일보다 먼저)
LOCAL_IDENTITY="autohan0 local signing"
IDENTITY="${AUTOHAN0_SIGN_IDENTITY:-}"
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
if [ -z "$IDENTITY" ]; then
  DEV_ID="$(printf '%s\n' "$IDENTITIES" | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"' || true)"  # pipefail: no match is fine
  if [ -n "$DEV_ID" ]; then
    IDENTITY="$DEV_ID"
  elif [ -f .sign-identity ]; then
    IDENTITY="$(head -1 .sign-identity | tr -d '\r')"
  elif printf '%s\n' "$IDENTITIES" | grep -q "\"$LOCAL_IDENTITY\""; then
    IDENTITY="$LOCAL_IDENTITY"
  else
    IDENTITY="-"
  fi
fi
# The same name can belong to several certificates (an Apple Development certificate made again):
# sign with the SHA-1 of one that Apple has not revoked, so codesign does not stop at "ambiguous".
# find-identity lists revoked certificates as valid, but macOS moves an app signed with one to
# the Trash as malware when it is opened. The Accessibility permission is kept by the
# certificate's name and team, so any unrevoked one keeps it.
if [ "$IDENTITY" != "-" ]; then
  CERTS="$(mktemp -d)"
  HASH=""
  for h in $(printf '%s\n' "$IDENTITIES" | grep -F "\"$IDENTITY\"" | awk '{print $2}'); do
    security find-certificate -a -Z -p -c "$IDENTITY" 2>/dev/null \
      | awk -v h="$h" '/^SHA-1 hash:/ { p = ($3 == h) } p' | sed -n '/BEGIN CERT/,/END CERT/p' > "$CERTS/$h.pem"
    # (not "verify-cert | grep -q": under pipefail the pipeline fails whenever verify-cert does)
    VERDICT="$(security verify-cert -c "$CERTS/$h.pem" -p codeSign -R ocsp 2>&1 || true)"
    case "$VERDICT" in
      *REVOKED*)
        echo "▸ 건너뜀: 폐기된 인증서 $h ($IDENTITY)"
        continue
        ;;
    esac
    HASH="$h"
    break
  done
  rm -rf "$CERTS"
  if [ -n "$HASH" ]; then
    SIGN_NAME="$IDENTITY"
    IDENTITY="$HASH"
  elif printf '%s\n' "$IDENTITIES" | grep -qF "\"$IDENTITY\""; then
    echo "\"$IDENTITY\" 인증서가 모두 폐기되었습니다. Xcode에서 새로 만들거나 .sign-identity를 바꾸세요." >&2
    exit 1
  fi
fi
SIGN_OPTS=""
case "${SIGN_NAME:-$IDENTITY}" in
  -) echo "▸ 서명 (ad hoc: 빌드할 때마다 손쉬운 사용 권한을 다시 받아야 함)" ;;
  "Developer ID Application:"*) echo "▸ 서명 (${SIGN_NAME:-$IDENTITY}, hardened runtime + timestamp)"; SIGN_OPTS="--options runtime --timestamp" ;;
  *) echo "▸ 서명 (${SIGN_NAME:-$IDENTITY})" ;;
esac
# shellcheck disable=SC2086
codesign --force --sign "$IDENTITY" $SIGN_OPTS --entitlements Resources/autohan0.entitlements "$APP"
codesign --verify --strict "$APP"
echo "완료: $(pwd)/$APP"
