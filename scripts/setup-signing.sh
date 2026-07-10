#!/bin/bash
# Cree une identite de signature de code STABLE et auto-signee ("NotchZFX Self-Signed")
# dans le trousseau login. But : donner a NotchZFX.app un Designated Requirement
# constant (base sur le certificat, pas sur le cdhash), afin que les permissions
# macOS (TCC : calendrier, controle d'apps, dossiers...) PERSISTENT d'un rebuild a
# l'autre au lieu de se reinitialiser a chaque fois (comportement de la signature ad-hoc).
#
# Idempotent : ne fait rien si l'identite existe deja. A lancer UNE fois par machine.
set -euo pipefail

CERT_NAME="NotchZFX Self-Signed"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if security find-identity -p codesigning 2>/dev/null | grep -q "$CERT_NAME"; then
  echo "Identite deja presente :"
  security find-identity -p codesigning | grep "$CERT_NAME"
  exit 0
fi

echo "==> Generation du certificat auto-signe (code signing, 10 ans)"
cat > "$TMP/cert.cnf" <<'EOF'
[req]
distinguished_name = dn
x509_extensions = v3
prompt = no
[dn]
CN = NotchZFX Self-Signed
[v3]
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
basicConstraints = critical, CA:false
EOF

openssl req -x509 -newkey rsa:2048 -keyout "$TMP/k.key" -out "$TMP/c.crt" \
  -days 3650 -nodes -config "$TMP/cert.cnf" >/dev/null 2>&1

# Format p12 LEGACY : `security import` de macOS ne lit pas le chiffrement OpenSSL 3 par defaut.
openssl pkcs12 -export -inkey "$TMP/k.key" -in "$TMP/c.crt" -out "$TMP/id.p12" \
  -passout pass:notch -legacy -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1 \
  -name "$CERT_NAME" >/dev/null 2>&1

echo "==> Import dans $KEYCHAIN"
security import "$TMP/id.p12" -k "$KEYCHAIN" -P "notch" -A -T /usr/bin/codesign

echo "==> Identite installee :"
security find-identity -p codesigning | grep "$CERT_NAME" || {
  echo "ECHEC : identite non listee." >&2; exit 1;
}
echo "OK. Relance scripts/package-mac.sh : l'app sera signee avec cette identite stable."
