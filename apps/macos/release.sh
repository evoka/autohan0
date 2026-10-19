#!/bin/sh
# 배포판 만들기: 빌드 → Developer ID 서명(build.sh) → 앱 공증·스테이플 → DMG → DMG 서명·공증·스테이플 → dist/
# 한 번만 준비할 것:
#   1) 키체인에 "Developer ID Application" 인증서 (Xcode › Settings › Accounts › Manage Certificates… › + )
#   2) 공증 자격 증명:  xcrun notarytool store-credentials "autohan0-notary" --apple-id <Apple ID> --team-id <팀 ID>
#      (앱 암호는 appleid.apple.com › 로그인 및 보안 › 앱 암호 에서 만든 것을 물을 때 입력)
# 사용: apps/macos/release.sh                 빌드 + 공증 + DMG
#       apps/macos/release.sh --no-notarize   공증 없이 DMG만 (시험용)
set -euo pipefail
cd "$(dirname "$0")"
PROFILE="${AUTOHAN0_NOTARY_PROFILE:-autohan0-notary}"
NOTARIZE=1; [ "${1:-}" = "--no-notarize" ] && NOTARIZE=0

./build.sh
APP=build/autohan0.app
VERSION="$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' "$APP/Contents/Info.plist")"
IDENTITY="$(codesign -dv "$APP" 2>&1 | sed -n 's/^Authority=\(Developer ID Application: .*\)$/\1/p' | head -1 || true)"
if [ "$NOTARIZE" = 1 ] && [ -z "$IDENTITY" ]; then
  echo "앱이 Developer ID Application으로 서명되지 않았습니다(ad hoc 또는 자체 서명). 공증하려면 인증서가 필요합니다."
  echo "인증서 없이 DMG만 만들려면: $0 --no-notarize"; exit 1
fi
if [ "$NOTARIZE" = 1 ] && ! security find-generic-password -s "com.apple.gke.notary.tool" -a "$PROFILE" >/dev/null 2>&1; then
  echo "공증 자격 증명 '$PROFILE'이 키체인에 없습니다. 먼저: xcrun notarytool store-credentials \"$PROFILE\" --apple-id <Apple ID> --team-id <팀 ID>"; exit 1
fi

DIST=dist; mkdir -p "$DIST"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT

if [ "$NOTARIZE" = 1 ]; then
  echo "▸ 앱 공증"
  ditto -c -k --keepParent "$APP" "$STAGE/autohan0.zip"
  xcrun notarytool submit "$STAGE/autohan0.zip" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$APP"
fi

echo "▸ DMG"
DMG="$DIST/autohan0-$VERSION.dmg"
cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -quiet -volname "autohan0 $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG"
if [ -n "$IDENTITY" ]; then codesign --force --sign "$IDENTITY" --timestamp "$DMG"; fi

if [ "$NOTARIZE" = 1 ]; then
  echo "▸ DMG 공증"
  xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
  xcrun stapler staple "$DMG"
  echo "▸ Gatekeeper 확인"
  spctl -a -t open --context context:primary-signature -v "$DMG"
fi

(cd "$DIST" && shasum -a 256 "$(basename "$DMG")" > "$(basename "$DMG").sha256")
echo "완료: $(pwd)/$DMG ($(du -h "$DMG" | cut -f1))"
cat "$DMG.sha256"
