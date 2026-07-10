#!/bin/bash
# Compile calendarHelper.swift en une vraie app .app (agent en arriere-plan).
# Indispensable : une app compilee + signee ad-hoc + bundle avec les cles d'usage
# TCC (NSCalendarsUsageDescription, NSRemindersUsageDescription) est NECESSAIRE
# pour que macOS attribue correctement la permission calendrier/rappels.
# Un simple `swift calendarHelper.swift` ne recoit PAS ces permissions.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/CalendarHelper.app"
MACOS="$APP/Contents/MacOS"
rm -rf "$APP"
mkdir -p "$MACOS"

swiftc -O "$DIR/calendarHelper.swift" -o "$MACOS/CalendarHelper"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>CalendarHelper</string>
  <key>CFBundleIdentifier</key><string>com.notchdrop.calendarhelper</string>
  <key>CFBundleName</key><string>CalendarHelper</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <!-- Cles d'usage TCC : indispensables pour la demande d'acces (macOS 14+/26). -->
  <key>NSCalendarsUsageDescription</key><string>NotchDrop affiche vos evenements a venir dans l'encoche.</string>
  <key>NSRemindersUsageDescription</key><string>NotchDrop affiche vos rappels a venir dans l'encoche.</string>
  <key>NSCalendarsFullAccessUsageDescription</key><string>NotchDrop affiche vos evenements a venir dans l'encoche.</string>
  <key>NSRemindersFullAccessUsageDescription</key><string>NotchDrop affiche vos rappels a venir dans l'encoche.</string>
</dict>
</plist>
PLIST

# Signature ad-hoc (suffit pour un usage local, evite les blocages de securite).
codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "OK -> $APP"
