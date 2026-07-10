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

echo "==> Copie du code de l'app dans Resources/app"
APPRES="$OUT/Contents/Resources/app"
mkdir -p "$APPRES"
ditto "$SRC/package.json" "$APPRES/package.json"
ditto "$SRC/src" "$APPRES/src"
# node_modules SANS electron (electron est le runtime, pas une dependance embarquee)
rsync -a --exclude 'electron' --exclude '.bin' "$SRC/node_modules/" "$APPRES/node_modules/" >/dev/null

echo "==> Nettoyage des attributs etendus + quarantine"
xattr -cr "$OUT" 2>/dev/null || true

echo "==> Signature ad-hoc (helpers natifs d'abord, puis l'app entiere)"
for h in "$APPRES/src/main/"*.app; do
  [ -d "$h" ] && codesign --force --deep --sign - "$h" >/dev/null 2>&1 || true
done
codesign --force --deep --sign - "$OUT" >/dev/null 2>&1 || codesign --force --sign - "$OUT" || true

echo "==> Verification"
codesign --verify --verbose=1 "$OUT" 2>&1 | sed 's/^/  /' || true

echo ""
echo "OK -> $OUT"
echo "Lance : open \"$OUT\""
