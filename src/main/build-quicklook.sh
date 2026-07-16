#!/bin/bash
# Compile quickLook.swift en une vraie app .app (helper d'apercu Quick Look natif).
# Une app compilee + bundle peut s'activer et prendre le focus clavier -> le panneau
# QLPreviewPanel reagit a l'espace / echap / fleches (contrairement a `qlmanage -p`).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/QuickLook.app"
MACOS="$APP/Contents/MacOS"
rm -rf "$APP"
mkdir -p "$MACOS"

swiftc -O "$DIR/quickLook.swift" -framework Cocoa -framework Quartz -o "$MACOS/QuickLook"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>QuickLook</string>
  <key>CFBundleIdentifier</key><string>com.notchdrop.quicklook</string>
  <key>CFBundleName</key><string>QuickLook</string>
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
