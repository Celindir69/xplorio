#!/bin/bash
# Xplorio auf dem Mac aktualisieren: neueste Fassung von GitHub laden, entpacken, Xplorio beenden, die App bauen
# (tools/mac/make-app.sh), Xplorio wieder starten und aufräumen. Die Einstellungen bleiben.
#   bash xplorio-update.sh            (Zweig claude/project-thread-6k5f1h)
#   bash xplorio-update.sh main       (anderer Zweig)
# Auch der Knopf "Jetzt aktualisieren" in den Einstellungen (Karte "Xplorio aktualisieren") startet dieses Skript.
# Welche Fassung installiert ist, steht danach in ~/Library/Application Support/Xplorio/update.json
# (Commit aus dem Kommentar des Zip-Archivs von GitHub).
BRANCH="${1:-claude/project-thread-6k5f1h}"
REPO="${XPLORIO_REPO:-Celindir69/xplorio}"
SUPPORT="${XPLORIO_SUPPORT:-$HOME/Library/Application Support/Xplorio}"
STATE="${XPLORIO_UPDATE_STATE:-$SUPPORT/update.json}"
URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.zip"
export PATH="/opt/homebrew/bin:/opt/local/bin:/usr/local/bin:$PATH"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/xplorio-update.XXXXXX") || exit 1
OLD_SHA=$(sed -n 's/.*"sha":"\([0-9a-f]*\)".*/\1/p' "$STATE" 2>/dev/null | head -1)
STEP=download
SHA=

state() {   # ok sha error
  mkdir -p "$(dirname "$STATE")"
  printf '{"sha":"%s","branch":"%s","at":"%s","ok":%s,"error":"%s"}\n' "$2" "$BRANCH" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$3" >"$STATE.neu" &&
    mv "$STATE.neu" "$STATE"
}
finish() {
  local code=$?
  if [ $code -ne 0 ]; then
    echo "Aktualisierung abgebrochen (Schritt: $STEP)." >&2
    state false "$OLD_SHA" "$STEP"
  fi
  echo "Starte Xplorio …"
  open -a Xplorio 2>/dev/null || echo "Xplorio konnte nicht gestartet werden, bitte von Hand öffnen."
  [ -n "$TMP" ] && [ -d "$TMP" ] && rm -rf "$TMP"
}
trap finish EXIT
set -e

echo "$(date): Lade $URL …"
curl -fL --progress-bar -o "$TMP/xplorio.zip" "$URL"
STEP=unzip
# GitHub writes the commit into the archive's comment
SHA=$(unzip -z "$TMP/xplorio.zip" 2>/dev/null | grep -Eo '^[0-9a-f]{40}$' | head -1 || true)
unzip -q "$TMP/xplorio.zip" -d "$TMP"
DIR=$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -f "$DIR/tools/mac/make-app.sh" ] || { echo "make-app.sh nicht im Zip gefunden." >&2; exit 1; }

STEP=quit
if pgrep -xq Xplorio; then
  echo "Beende Xplorio …"
  osascript -e 'quit app "Xplorio"' >/dev/null 2>&1 || true
  i=0
  while pgrep -xq Xplorio; do
    i=$((i + 1)); [ $i -gt 30 ] && { echo "Xplorio lässt sich nicht beenden." >&2; exit 1; }
    sleep 1
  done
fi

STEP=build
bash "$DIR/tools/mac/make-app.sh"
state true "$SHA" ""
echo "Fertig${SHA:+: ${SHA:0:7}}. Zip und entpackter Ordner werden gelöscht."
