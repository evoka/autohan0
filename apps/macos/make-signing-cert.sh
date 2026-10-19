#!/bin/sh
# "autohan0 local signing" 자체 서명 코드 서명 인증서를 로그인 키체인에 만든다.
# 한 번만 실행하면 build.sh가 이 인증서를 자동으로 써서, 다시 빌드해도 손쉬운 사용 권한이 유지된다.
# 사용: apps/macos/make-signing-cert.sh            (키체인에 넣음, 암호 확인 창이 뜰 수 있음)
#       apps/macos/make-signing-cert.sh --dry-run  (파일만 만들어 보고 키체인은 건드리지 않음)
set -eu
NAME="autohan0 local signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

if [ "$DRY" = 0 ] && security find-identity -v -p codesigning 2>/dev/null | grep -q "\"$NAME\""; then
  echo "이미 있음: $NAME"; exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = $NAME
[v3]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
CNF
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" 2>/dev/null
openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -out "$TMP/id.p12" -passout pass:autohan0
echo "▸ 인증서 생성: $(openssl x509 -in "$TMP/cert.pem" -noout -subject -enddate | tr '\n' ' ')"

if [ "$DRY" = 1 ]; then
  openssl pkcs12 -in "$TMP/id.p12" -passin pass:autohan0 -nokeys -nomacver 2>/dev/null | grep -c BEGIN >/dev/null && echo "▸ dry-run: p12 확인 OK, 키체인은 건드리지 않음"
  exit 0
fi

# 1) 키와 인증서를 로그인 키체인에 넣고 codesign이 키를 쓰도록 허용
security import "$TMP/id.p12" -k "$KEYCHAIN" -P autohan0 -T /usr/bin/codesign -T /usr/bin/security
# 2) 이 인증서를 코드 서명용으로 신뢰 (사용자 범위, 암호 확인 창이 뜰 수 있음)
security add-trusted-cert -r trustRoot -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem"
echo "▸ 키체인에 넣음"
security find-identity -v -p codesigning | grep "$NAME" || { echo "인증서를 찾지 못함"; exit 1; }
echo "완료. 이제 apps/macos/build.sh 가 '$NAME'으로 서명합니다."
echo "첫 서명 때 'codesign이 키에 접근하려고 합니다' 창이 뜨면 '항상 허용'을 누르세요."
echo "인증서로 바꾼 첫 빌드에서만 손쉬운 사용 권한을 한 번 더 받으면, 그다음부터는 유지됩니다."
