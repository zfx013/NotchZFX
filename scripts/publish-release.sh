#!/usr/bin/env bash
# Publie une Release GitHub avec les binaires téléchargeables.
# NÉCESSITE un token GitHub (scope "repo") car `gh` n'est pas requis ici.
#
#   GITHUB_TOKEN=ghp_xxx bash scripts/publish-release.sh
#
# Reconstruit d'abord les binaires si dist/ est vide (voir README).
set -euo pipefail

REPO="zfx013/NotchZFX"
TAG="v$(node -p "require('./package.json').version")"
DIST="dist"
ASSETS=(
  "$DIST/NotchZFX-$(node -p "require('./package.json').version")-mac.zip"
  "$DIST/NotchZFX-$(node -p "require('./package.json').version")-win-x64.zip"
  "$DIST/NotchZFX-$(node -p "require('./package.json').version")-win-arm64.zip"
)

: "${GITHUB_TOKEN:?Définis GITHUB_TOKEN (Personal Access Token, scope repo)}"
API="https://api.github.com/repos/$REPO"
UP="https://uploads.github.com/repos/$REPO"
AUTH=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")

echo "==> Création de la release $TAG"
NOTES=$(cat <<EOF
## NotchZFX $TAG

Bibliothèque commune de fichiers sur le réseau local — Mac ⇄ PC.

**Nouveautés**
- Bibliothèque commune : dépose un fichier, il est copié automatiquement sur tous les appareils.
- Anneau de progression (façon App Store) à la réception.
- Vider partout d'un geste ; liste des appareils en lecture seule.
- Support Windows (partage de fichiers) : encoche compacte, x64 + ARM64.

**Téléchargements** : macOS (Apple Silicon), Windows x64, Windows ARM64.
Binaires non signés — voir le README pour l'ouverture (Gatekeeper / SmartScreen).
EOF
)

REL=$(curl -sS "${AUTH[@]}" "$API/releases" \
  -d "$(node -e "console.log(JSON.stringify({tag_name:process.argv[1],name:'NotchZFX '+process.argv[1],body:process.argv[2],draft:false,prerelease:false}))" "$TAG" "$NOTES")")
RID=$(echo "$REL" | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).id || ''")
if [ -z "$RID" ]; then echo "Échec création release :"; echo "$REL" | head -c 400; exit 1; fi
echo "    release id=$RID"

for a in "${ASSETS[@]}"; do
  [ -f "$a" ] || { echo "!! manquant: $a (reconstruis les binaires)"; continue; }
  name=$(basename "$a")
  echo "==> Upload $name ($(du -h "$a" | cut -f1))"
  curl -sS "${AUTH[@]}" -H "Content-Type: application/zip" \
    --data-binary @"$a" "$UP/releases/$RID/assets?name=$name" -o /dev/null -w "    %{http_code}\n"
done

echo "==> Fait : https://github.com/$REPO/releases/tag/$TAG"
