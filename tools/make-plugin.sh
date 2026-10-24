#!/bin/bash
# make-plugin: put the Volumio plugin together from the repo (plugin/ plus the interface and the services in app/).
#   bash tools/make-plugin.sh [repo folder] [target folder]     -> <target folder>/xplorio and <target folder>/xplorio.zip
#                                                                  (default: ./build)
# Install on the player from that folder with "volumio plugin install" (xplorio-deploy --plugin does all of it), upload
# xplorio.zip on Volumio's plugin page (no console needed), or copy the folder into the Volumio plugin sources for the store.
set -e
SRC=$(cd "${1:-$(dirname "$0")/..}" && pwd -P)
OUT=${2:-$SRC/build}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd -P)
DEST=$OUT/xplorio
[ -f "$SRC/plugin/package.json" ] && [ -f "$SRC/xplorio.html" ] || { echo "make-plugin: $SRC is not the Xplorio repo" >&2; exit 1; }
rm -rf "$DEST"
mkdir -p "$DEST/app/rotel"
cp -R "$SRC/plugin/." "$DEST/"
cp "$SRC/xplorio.html" "$SRC/app.html" "$SRC/kioskTV.html" "$DEST/app/"
cp -R "$SRC/web" "$SRC/server" "$SRC/tags" "$DEST/app/"
cp "$SRC/rotel/rotel-bridge.js" "$DEST/app/rotel/"
rm -f "$DEST/app/web/config.local.js"                     # own settings: /data/xplorio/config.local.js (link at start)
find "$DEST/app" \( -name '*.pyc' -o -name '__pycache__' \) -prune -exec rm -rf {} +
# version for the menu and id for the browser cache, as xplorio-deploy writes them (unless already there)
W=$DEST/app/web
if [ ! -f "$W/version.json" ]; then
  branch=$(git -C "$SRC" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  commit=$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)
  stamp=$(git -C "$SRC" log -1 --format=%cd --date=short 2>/dev/null || date +%Y-%m-%d)
  printf '{"branch":"%s","commit":"%s","date":"%s"}\n' "$branch" "$commit" "$stamp" > "$W/version.json"
fi
if [ ! -f "$W/build.js" ]; then
  build=$(cd "$SRC" && find xplorio.html web -type f ! -name build.js ! -name version.json ! -name config.local.js 2>/dev/null | LC_ALL=C sort | xargs cat 2>/dev/null | md5sum | cut -c1-12)
  printf "window.XPLORIO_BUILD = '%s';\n" "$build" > "$W/build.js"
fi
# ZIP as Volumio expects it: the plugin files at the top level (kew and v-conf come with npm install in install.sh)
rm -f "$OUT/xplorio.zip"
if command -v zip >/dev/null 2>&1; then
  (cd "$DEST" && zip -qrX "$OUT/xplorio.zip" .)
else
  python3 -c 'import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for d, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            full = os.path.join(d, f)
            z.write(full, os.path.relpath(full, src))' "$DEST" "$OUT/xplorio.zip"
fi
echo "Plugin ready: $DEST ($OUT/xplorio.zip)"
