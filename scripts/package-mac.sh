#!/bin/bash
# Empaquete NotchDrop Sync en une vraie app macOS "NotchZFX.app" (bundle autonome).
#
# Pourquoi : en dev, l'app tourne via le binaire Electron generique -> macOS l'appelle
# "Electron" et les permissions (Automatisation, Calendrier) ne s'attribuent pas
# correctement (le parent n'a pas les cles NS...UsageDescription). Ici on copie
# Electron.app, on le renomme, on injecte les descriptions d'usage + l'icone, on
# embarque le code + les helpers natifs (.app), puis on signe ad-hoc.
#
# Resultat : dist/NotchZFX.app double-cliquable, avec vrai nom/icone et prompts propres.
set -euo pipefail

NAME="NotchZFX"
BID="com.zfx.notchzfx"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON_APP="$SRC/node_modules/electron/dist/Electron.app"
OUT="$SRC/dist/$NAME.app"
ICON="$SRC/assets/NotchZFX.icns"

[ -d "$ELECTRON_APP" ] || { echo "Electron introuvable ($ELECTRON_APP) — lance 'npm install'."; exit 1; }

echo "==> Copie de Electron.app -> $NAME.app"
rm -rf "$SRC/dist"
mkdir -p "$SRC/dist"
ditto "$ELECTRON_APP" "$OUT"

echo "==> Renommage de l'executable"
mv "$OUT/Contents/MacOS/Electron" "$OUT/Contents/MacOS/$NAME"

PLIST="$OUT/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$PLIST" >/dev/null 2>&1 || true; }
# set = remplace si existe ; add+set = cree sinon met a jour
setkey() { # type key value
  /usr/libexec/PlistBuddy -c "Add :$2 $1 $3" "$PLIST" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Set :$2 $3" "$PLIST" >/dev/null 2>&1 || true
}

echo "==> Info.plist (nom, id, icone, descriptions d'usage)"
pb "Set :CFBundleExecutable $NAME"
pb "Set :CFBundleName $NAME"
setkey string CFBundleDisplayName "$NAME"
pb "Set :CFBundleIdentifier $BID"
setkey string CFBundleShortVersionString "0.1.0"
setkey string CFBundleVersion "1"
pb "Set :CFBundleIconFile icon"
# App accessoire (pas d'icone dans le Dock ; l'app vit dans l'encoche / la barre de menus)
setkey bool LSUIElement true
# Descriptions d'usage TCC -> ce sont elles qui font apparaitre les prompts au bon nom.
# ATTENTION : pas d'apostrophe (PlistBuddy casse sur « ' » -> Parse Error: Unclosed Quotes).
setkey string NSAppleEventsUsageDescription "NotchZFX pilote Spotify et Musique pour afficher et controler la lecture."
setkey string NSCalendarsUsageDescription "NotchZFX affiche tes evenements de calendrier."
setkey string NSCalendarsFullAccessUsageDescription "NotchZFX affiche tes evenements de calendrier."
setkey string NSRemindersUsageDescription "NotchZFX affiche tes rappels."
setkey string NSRemindersFullAccessUsageDescription "NotchZFX affiche tes rappels."

echo "==> Icone"
[ -f "$ICON" ] && cp "$ICON" "$OUT/Contents/Resources/icon.icns" || echo "  (pas d'icone $ICON, on garde celle d'Electron)"

# Compile les helpers natifs Swift (.app non versionnes -> a construire ici pour que
# le bundle packagé les embarque, y compris en CI sur un clone frais).
echo "==> Compilation des helpers natifs (Swift .app)"
for b in build-hud.sh build-catcher.sh build-calendar.sh build-mediakeys.sh; do
  [ -f "$SRC/src/main/$b" ] && bash "$SRC/src/main/$b" >/dev/null 2>&1 && echo "  ok $b" || echo "  (echec/absent $b)"
done

echo "==> Copie du code de l'app dans Resources/app"
APPRES="$OUT/Contents/Resources/app"
mkdir -p "$APPRES"
ditto "$SRC/package.json" "$APPRES/package.json"
ditto "$SRC/src" "$APPRES/src"
# node_modules SANS electron (electron est le runtime, pas une dependance embarquee)
rsync -a --exclude 'electron' --exclude '.bin' "$SRC/node_modules/" "$APPRES/node_modules/" >/dev/null

echo "==> Nettoyage des attributs etendus + quarantine"
xattr -cr "$OUT" 2>/dev/null || true

# Identite de signature STABLE (certificat auto-signe) : le Designated Requirement
# devient `identifier ... and certificate leaf = H"..."` — constant entre rebuilds,
# donc les permissions TCC PERSISTENT (l'ad-hoc, lui, a un cdhash qui change a chaque
# build et reinitialise toutes les autorisations). Cree-la via scripts/setup-signing.sh.
SIGN_ID="$(security find-identity -p codesigning 2>/dev/null | grep 'NotchZFX Self-Signed' | grep -oE '[0-9A-F]{40}' | head -1)"
if [ -n "$SIGN_ID" ]; then
  echo "==> Signature avec identite stable ($SIGN_ID) — permissions persistantes"
else
  SIGN_ID="-"
  echo "==> Signature ad-hoc (identite stable absente : lance scripts/setup-signing.sh pour eviter que les permissions se reinitialisent)"
fi
for h in "$APPRES/src/main/"*.app; do
  [ -d "$h" ] && codesign --force --deep --sign "$SIGN_ID" "$h" >/dev/null 2>&1 || true
done
codesign --force --deep --sign "$SIGN_ID" "$OUT" >/dev/null 2>&1 || codesign --force --sign "$SIGN_ID" "$OUT" || true

echo "==> Verification"
codesign --verify --verbose=1 "$OUT" 2>&1 | sed 's/^/  /' || true

echo ""
echo "OK -> $OUT"
echo "Lance : open \"$OUT\""
