#!/bin/bash
# Compile mediaKeys.swift en une vraie app .app (agent accessoire).
# Le bundle .app est REQUIS pour l'attribution TCC (Accessibilite).
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
APP="$DIR/MediaKeyInterceptor.app"
MACOS="$APP/Contents/MacOS"
rm -rf "$APP"
mkdir -p "$MACOS"

# Cocoa : NSEvent. CoreGraphics : CGEvent tap + CGMainDisplayID. CoreAudio : volume.
# ApplicationServices : AXIsProcessTrustedWithOptions (permission Accessibilite).
swiftc -O "$DIR/mediaKeys.swift" \
  -framework Cocoa \
  -framework CoreGraphics \
  -framework CoreAudio \
  -framework ApplicationServices \
  -o "$MACOS/MediaKeyInterceptor"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>MediaKeyInterceptor</string>
  <key>CFBundleIdentifier</key><string>com.notchzfx.mediakeys</string>
  <key>CFBundleName</key><string>NotchZFX MediaKeys</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP" 2>/dev/null || true
echo "OK -> $APP"
