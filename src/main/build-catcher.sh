#!/bin/bash
# Compile dragMonitor.swift en une vraie app .app (agent en arriere-plan).
# Indispensable : une fenetre creee par l'interpreteur `swift fichier.swift` n'est
# PAS une cible de drag & drop valide pour macOS. Une app compilee + bundle l'est.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/DragCatcher.app"
MACOS="$APP/Contents/MacOS"
rm -rf "$APP"
mkdir -p "$MACOS"

swiftc -O "$DIR/dragMonitor.swift" -o "$MACOS/DragCatcher"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>DragCatcher</string>
  <key>CFBundleIdentifier</key><string>com.notchdrop.dragcatcher</string>
  <key>CFBundleName</key><string>DragCatcher</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Signature ad-hoc (suffit pour un usage local, evite les blocages de securite).
codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "OK -> $APP"
