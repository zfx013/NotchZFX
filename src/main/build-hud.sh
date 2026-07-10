#!/bin/bash
# Compile hudMonitor.swift en une vraie app .app (agent accessoire en arriere-plan).
# Calque sur build-catcher.sh : swiftc -> bundle .app + Info.plist + codesign ad-hoc.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/HUDMonitor.app"
MACOS="$APP/Contents/MacOS"
rm -rf "$APP"
mkdir -p "$MACOS"

# CoreAudio : volume + muet. CoreGraphics : CGMainDisplayID pour la luminosite.
# DisplayServices/CoreDisplay sont charges via dlopen (pas besoin de les linker).
swiftc -O "$DIR/hudMonitor.swift" \
  -framework AppKit \
  -framework CoreAudio \
  -framework CoreGraphics \
  -o "$MACOS/HUDMonitor"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>HUDMonitor</string>
  <key>CFBundleIdentifier</key><string>com.notchdrop.hudmonitor</string>
  <key>CFBundleName</key><string>HUDMonitor</string>
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
