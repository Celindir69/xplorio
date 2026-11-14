#!/bin/bash
# make-app: builds the Mac program Xplorio.app (own window, own icon; opening starts MPD, tag service and web server,
# closing stops them). Runs on the Mac from the downloaded Xplorio folder:
#   bash tools/mac/make-app.sh
# Needs Homebrew's mpd and node and Apple's command line tools (swiftc; come with Homebrew, else: xcode-select --install).
# The first time it asks for the music folder. An existing test setup in ~/xplorio-mpd (docs) is taken over, with its
# library and history. Settings: ~/Library/Application Support/Xplorio (xplorio.conf, config.local.js, mpd/).
# Running it again (e.g. after downloading a newer version) replaces the program and keeps the settings.
# For tests: XPLORIO_SUPPORT, XPLORIO_APPS (target folder), XPLORIO_MUSIC (no folder dialog), XPLORIO_NO_SWIFT=1.
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
SRC=$(cd "$(dirname "$0")/../.." && pwd -P)
SUPPORT="${XPLORIO_SUPPORT:-$HOME/Library/Application Support/Xplorio}"
[ -f "$SRC/xplorio.html" ] && [ -d "$SRC/tags" ] || { echo "make-app: $SRC is not the Xplorio folder" >&2; exit 1; }

fail() { echo; echo "make-app: $1" >&2; exit 1; }
command -v node >/dev/null || fail "node fehlt. Bitte zuerst: brew install mpd mpc node"
command -v mpd >/dev/null  || fail "mpd fehlt. Bitte zuerst: brew install mpd mpc node"
if [ -z "$XPLORIO_NO_SWIFT" ]; then
  command -v swiftc >/dev/null || fail "swiftc fehlt. Bitte zuerst: xcode-select --install"
fi
if [ -z "$XPLORIO_APPS" ] && pgrep -x Xplorio >/dev/null 2>&1; then fail "Xplorio läuft gerade. Bitte zuerst das Xplorio-Fenster schließen."; fi

if [ -n "$XPLORIO_APPS" ]; then APPS="$XPLORIO_APPS"
elif [ -w /Applications ]; then APPS=/Applications
else APPS="$HOME/Applications"; fi
mkdir -p "$APPS" "$SUPPORT"

confValue() { sed -n "s/^[[:space:]]*$1[[:space:]]*\"\\{0,1\\}\\([^\"]*\\)\"\\{0,1\\}[[:space:]]*\$/\\1/p" "$2" | head -1; }

# ---------- MPD and folders (only the first time) ----------
if [ -f "$SUPPORT/xplorio.conf" ]; then
  echo "Einstellungen vorhanden: $SUPPORT/xplorio.conf"
elif [ -f "$HOME/xplorio-mpd/mpd.conf" ]; then
  echo "Übernehme die bisherige Einrichtung aus ~/xplorio-mpd"
  MPD_CONF="$HOME/xplorio-mpd/mpd.conf"
  MUSIC_ROOT=$(confValue music_directory "$MPD_CONF")
  MPD_PORT=$(confValue port "$MPD_CONF"); MPD_PORT=${MPD_PORT:-6600}
  if [ -d "$HOME/xplorio-mpd/xplorio-daten" ]; then TAGS_DATA="$HOME/xplorio-mpd/xplorio-daten"; else TAGS_DATA="$SUPPORT/daten"; fi
else
  MUSIC="$XPLORIO_MUSIC"
  if [ -z "$MUSIC" ]; then
    echo "Bitte im Fenster den Ordner mit deiner Musik wählen …"
    MUSIC=$(osascript -e 'POSIX path of (choose folder with prompt "Wo liegt deine Musik?")') || fail "kein Musikordner gewählt"
  fi
  MUSIC=${MUSIC%/}
  [ -d "$MUSIC" ] || fail "Ordner nicht gefunden: $MUSIC"
  M="$SUPPORT/mpd"
  mkdir -p "$M/daten"
  # Xplorio expects the music below INTERNAL, USB or NAS: a folder that already has them is used as it is,
  # otherwise it appears as USB
  if [ -d "$MUSIC/INTERNAL" ] || [ -d "$MUSIC/USB" ] || [ -d "$MUSIC/NAS" ]; then
    MUSIC_ROOT="$MUSIC"
  else
    mkdir -p "$M/musik"
    rm -f "$M/musik/USB"
    ln -s "$MUSIC" "$M/musik/USB"
    MUSIC_ROOT="$M/musik"
  fi
  MPD_PORT=6600
  MPD_CONF="$M/mpd.conf"
  if [ "$(uname)" = Darwin ]; then OUT='  type       "osx"
  name       "Mac"'; else OUT='  type       "null"
  name       "null"'; fi
  cat >"$MPD_CONF" <<EOF
music_directory "$MUSIC_ROOT"
db_file         "$M/daten/db"
state_file      "$M/daten/state"
pid_file        "$M/daten/pid"
log_file        "$M/daten/log"
bind_to_address "127.0.0.1"
port            "$MPD_PORT"
audio_output {
$OUT
  mixer_type "software"
}
EOF
  TAGS_DATA="$SUPPORT/daten"
  NEW_LIBRARY=1
fi
if [ ! -f "$SUPPORT/xplorio.conf" ]; then
  {
    echo "# Xplorio on the Mac (written by tools/mac/make-app.sh)"
    printf 'SUPPORT="%s"\nMPD_CONF="%s"\nMPD_PORT="%s"\nMUSIC_ROOT="%s"\nTAGS_DATA="%s"\n' "$SUPPORT" "$MPD_CONF" "$MPD_PORT" "$MUSIC_ROOT" "$TAGS_DATA"
  } >"$SUPPORT/xplorio.conf"
fi
# own settings of the interface; MPD as the player
CL="$SUPPORT/config.local.js"
[ -f "$CL" ] || echo "/* own settings (see web/config.js); kept when the program is rebuilt */" >"$CL"
grep -q "PLAYER" "$CL" || echo "window.APP_CONFIG.PLAYER = 'mpd';" >>"$CL"

# ---------- the program ----------
echo "Baue Xplorio.app …"
TMP=$(mktemp -d)
B="$TMP/Xplorio.app/Contents"
R="$B/Resources/xplorio"
mkdir -p "$B/MacOS" "$R/mac"
cp "$SRC/xplorio.html" "$R/"
cp -R "$SRC/web" "$SRC/server" "$SRC/tags" "$R/"
rm -f "$R/web/config.local.js"
ln -s "$CL" "$R/web/config.local.js"
cp "$SRC/tools/mac/xplorio-services.sh" "$R/mac/"
chmod +x "$R/mac/xplorio-services.sh"
ln -s "$SUPPORT/xplorio.conf" "$B/Resources/xplorio.conf"
VERSION=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/plugin/package.json" | head -1)
cat >"$B/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Xplorio</string>
  <key>CFBundleDisplayName</key><string>Xplorio</string>
  <key>CFBundleIdentifier</key><string>local.xplorio.mac</string>
  <key>CFBundleExecutable</key><string>Xplorio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION:-1.0}</string>
  <key>CFBundleVersion</key><string>${VERSION:-1.0}</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.music</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsLocalNetworking</key><true/>
    <key>NSAllowsArbitraryLoadsInWebContent</key><true/>
  </dict>
</dict>
</plist>
EOF
if [ -z "$XPLORIO_NO_SWIFT" ]; then
  swiftc -O -o "$B/MacOS/Xplorio" "$SRC/tools/mac/Xplorio.swift" || fail "Übersetzen fehlgeschlagen (Meldungen oben)"
else
  printf '#!/bin/bash\nexec /bin/bash "$(dirname "$0")/../Resources/xplorio/mac/xplorio-services.sh" start\n' >"$B/MacOS/Xplorio"
  chmod +x "$B/MacOS/Xplorio"
fi
# icon from the app icon (web/icons/icon-512.png)
if command -v sips >/dev/null && command -v iconutil >/dev/null; then
  IS="$TMP/AppIcon.iconset"
  mkdir -p "$IS"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC/web/icons/icon-512.png" --out "$IS/icon_${s}x${s}.png" >/dev/null 2>&1 || true
    d=$((s * 2)); [ $d -le 512 ] && sips -z $d $d "$SRC/web/icons/icon-512.png" --out "$IS/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
  done
  cp "$SRC/web/icons/icon-512.png" "$IS/icon_512x512.png"
  iconutil -c icns "$IS" -o "$B/Resources/AppIcon.icns" 2>/dev/null || echo "(Icon konnte nicht erstellt werden, Xplorio läuft trotzdem)"
fi
command -v codesign >/dev/null && codesign --force --deep --sign - "$TMP/Xplorio.app" >/dev/null 2>&1 || true

rm -rf "$APPS/Xplorio.app"
mv "$TMP/Xplorio.app" "$APPS/"
rm -rf "$TMP"
command -v xattr >/dev/null && xattr -dr com.apple.quarantine "$APPS/Xplorio.app" 2>/dev/null || true

# a new library: start MPD once and read the music in, so the first start shows it
if [ -n "$NEW_LIBRARY" ] && command -v mpc >/dev/null; then
  echo "Lese die Musik ein (läuft im Hintergrund weiter) …"
  mpd "$MPD_CONF" >/dev/null 2>&1 || true
  sleep 1
  mpc -p "$MPD_PORT" update >/dev/null 2>&1 || true
fi

echo
echo "Fertig: $APPS/Xplorio.app"
echo "Öffnen per Doppelklick (oder im Launchpad). Zum Dock hinzufügen: Xplorio öffnen, dann Rechtsklick aufs Dock-Symbol"
echo "→ Optionen → Im Dock behalten. Schließen des Fensters beendet Xplorio samt MPD."
