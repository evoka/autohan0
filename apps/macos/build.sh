#!/bin/bash
# Builds build/autohan0.app: engine bundle (npm) -> Swift (release) -> app bundle -> local signature.
# Signing identity: $AUTOHAN0_SIGN_IDENTITY, else a keychain identity named "autohan0 local signing"
# (a self-signed Code Signing certificate made once in Keychain Access, see README), else ad hoc.
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

# 서명 순서: $AUTOHAN0_SIGN_IDENTITY → 키체인의 "Developer ID Application" → "autohan0 local signing" → ad hoc
LOCAL_IDENTITY="autohan0 local signing"
IDENTITY="${AUTOHAN0_SIGN_IDENTITY:-}"
IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
if [ -z "$IDENTITY" ]; then
  DEV_ID="$(printf '%s\n' "$IDENTITIES" | grep -o '"Developer ID Application: [^"]*"' | head -1 | tr -d '"' || true)"  # pipefail: no match is fine
  if [ -n "$DEV_ID" ]; then
    IDENTITY="$DEV_ID"
  elif printf '%s\n' "$IDENTITIES" | grep -q "\"$LOCAL_IDENTITY\""; then
    IDENTITY="$LOCAL_IDENTITY"
  else
    IDENTITY="-"
  fi
fi
SIGN_OPTS=""
case "$IDENTITY" in
  -) echo "▸ 서명 (ad hoc: 빌드할 때마다 손쉬운 사용 권한을 다시 받아야 함)" ;;
  "Developer ID Application:"*) echo "▸ 서명 ($IDENTITY, hardened runtime + timestamp)"; SIGN_OPTS="--options runtime --timestamp" ;;
  *) echo "▸ 서명 ($IDENTITY)" ;;
esac
# shellcheck disable=SC2086
codesign --force --sign "$IDENTITY" $SIGN_OPTS --entitlements Resources/autohan0.entitlements "$APP"
codesign --verify --strict "$APP"
echo "완료: $(pwd)/$APP"
