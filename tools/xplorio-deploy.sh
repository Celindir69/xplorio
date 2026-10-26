#!/bin/bash
# xplorio-deploy: install or update the Xplorio plugin on the player from the public repo xplorio, without the plugin
# store (for example on Volumio 2, or to try a branch).
#
#   sudo xplorio-deploy                    install or update the plugin from main
#   sudo xplorio-deploy claude/my-branch   from a specific branch
#   sudo xplorio-deploy -n [branch]        only say what would happen
#   sudo xplorio-deploy --password         set the password for the services again (if it is forgotten)
#
# tools/make-plugin.sh puts the plugin together; it is installed through Volumio's own websocket (tools/plugin-install.js,
# the same way as Volumio's plugin page), not with "volumio plugin install", which hangs forever on some Volumio 2 devices.
# Everything runs as user volumio (Volumio itself runs as volumio); the data in /data/xplorio stays as it is.
# Install:  curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null && sudo chmod +x /usr/local/bin/xplorio-deploy
set -e

REPO=${DEPLOY_REPO:-Celindir69/xplorio}
ROOT=${DEPLOY_ROOT:-}                               # tests only: everything below this folder instead of /
SOURCE=${DEPLOY_SOURCE:-}                           # tests only: archive instead of download
PROG=xplorio-deploy
APP=$ROOT/data/xplorio
PLUGIN_DIR=$ROOT/data/plugins/user_interface/xplorio

die() { echo "$PROG: $*" >&2; exit 1; }
[ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || die "please run with sudo"
NODE=${DEPLOY_NODE:-$(command -v node || echo /usr/bin/node)}

# ---------- password for the services ("System" page): only a hash in data/admin.json ----------
if [ "$1" = "--password" ]; then
  [ -f "$PLUGIN_DIR/app/tags/adminpass.js" ] || die "the Xplorio plugin is not installed (sudo $PROG)"
  mkdir -p "$APP/data"
  "$NODE" "$PLUGIN_DIR/app/tags/adminpass.js" "$APP/data" || exit 1
  [ -n "$ROOT" ] || chown volumio:volumio "$APP/data/admin.json" 2>/dev/null || true
  exit 0
fi

DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    -n) DRY=1 ;;
    --plugin) ;;                                    # earlier versions: the plugin is all there is now
    -*) die "unknown option $1" ;;
    *)  BRANCH=$1 ;;
  esac
  shift
done
BRANCH=${BRANCH:-main}
if [ -d "$PLUGIN_DIR" ]; then how=update; else how=install; fi
if [ $DRY = 1 ]; then echo "Branch $BRANCH would be installed as Volumio plugin ($how; nothing done with -n)"; exit 0; fi

# ---------- download ----------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "$SOURCE" ]; then
  cp "$SOURCE" "$TMP/src.tar.gz"                 # tests only
else
  echo "Loading $REPO, branch $BRANCH …"
  curl -fsSL --max-time 120 -o "$TMP/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
    || die "download failed (does branch '$BRANCH' exist? network?)"
fi
mkdir "$TMP/src"
tar xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1 || die "archive not readable"
[ -f "$TMP/src/tools/make-plugin.sh" ] || die "branch $BRANCH has no plugin"
# version for the menu (web/version.json): branch, commit (in the header of GitHub archives) and its date (file timestamps)
commit=$(gzip -dc "$TMP/src.tar.gz" 2>/dev/null | head -c 2048 | grep -ao 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2 || true)
stamp=$(date -r "$TMP/src/xplorio.html" +%Y-%m-%d 2>/dev/null || true)
mkdir -p "$TMP/src/web"
printf '{"branch":"%s","commit":"%s","date":"%s"}\n' "$BRANCH" "$commit" "$stamp" > "$TMP/src/web/version.json"

# ---------- put together and pack ----------
bash "$TMP/src/tools/make-plugin.sh" "$TMP/src" "$TMP/plugin" >/dev/null || die "the plugin could not be put together"
# dependencies (kew, v-conf) from the installed plugin: then install.sh needs no npm install (and no internet)
[ -d "$PLUGIN_DIR/node_modules" ] && cp -R "$PLUGIN_DIR/node_modules" "$TMP/plugin/xplorio/"
ZIP=$TMP/plugin/xplorio.zip
if command -v zip >/dev/null 2>&1; then
  (cd "$TMP/plugin/xplorio" && zip -qr "$ZIP" .) || die "the plugin could not be packed"
else
  PY=$(command -v python3 || command -v python) || die "neither zip nor python found to pack the plugin"
  "$PY" -c 'import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
z = zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED)
for d, dirs, files in os.walk(src):
    for f in files:
        full = os.path.join(d, f)
        z.write(full, os.path.relpath(full, src))
z.close()' "$TMP/plugin/xplorio" "$ZIP" || die "the plugin could not be packed"
fi
if [ -n "$ROOT" ]; then
  rm -rf "$ROOT/plugin-build"; cp -R "$TMP/plugin/xplorio" "$ROOT/plugin-build"; cp "$ZIP" "$ROOT/plugin-build.zip"
  echo "(test) plugin $how through Volumio"; exit 0
fi

# ---------- install through Volumio ----------
id volumio >/dev/null 2>&1 || die "user volumio is missing: is this a Volumio player?"
mkdir -p /data/xplorio/data && chown volumio:volumio /data/xplorio && chown -R volumio:volumio /data/xplorio/data
mkdir -p /tmp/plugins && chown volumio:volumio /tmp/plugins
# Volumio replaces the plugin folder as volumio: root-owned files from earlier installs (node_modules of install.sh)
# would make the update stop with "Directory not empty"
[ $how = update ] && chown -R volumio:volumio "$PLUGIN_DIR"
rm -rf /data/plugins/xplorio /data/temp/downloaded_plugin    # leftovers of an update that failed halfway
install -o volumio -g volumio -m 644 "$ZIP" /tmp/plugins/xplorio.zip
install -o volumio -g volumio -m 644 "$TMP/src/tools/plugin-install.js" /tmp/plugins/xplorio-install.js
echo "Xplorio plugin ($BRANCH): $how through Volumio …"
if ! sudo -u volumio "$NODE" /tmp/plugins/xplorio-install.js $how xplorio.zip; then
  rm -f /tmp/plugins/xplorio-install.js
  [ $how = update ] || die "installing failed (log: sudo journalctl -u volumio -n 100)"
  # fallback: copy the new files into the plugin folder (settings and node_modules stay), restart below
  echo "Updating through Volumio failed: copying the files into $PLUGIN_DIR"
  sleep 5                                                    # Volumio cleans up its plugin folders after a failure
  mkdir -p "$PLUGIN_DIR" && cp -R "$TMP/plugin/xplorio/." "$PLUGIN_DIR/" || die "copying failed"
  (cd "$PLUGIN_DIR" && sh install.sh >/dev/null) || echo "install.sh reported an error"
  chown -R volumio:volumio "$PLUGIN_DIR" 2>/dev/null || true
fi
rm -f /tmp/plugins/xplorio-install.js /tmp/plugins/xplorio.zip
# Volumio keeps the plugin's old code in memory after an update: only a restart loads the new version
if [ $how = update ]; then echo "Restarting Volumio so the new version takes effect …"; systemctl restart volumio; fi
[ $how = install ] && echo "Now switch the plugin on in Volumio: Plugins > Installed plugins > Xplorio."
echo "Xplorio then runs at http://$(hostname -I 2>/dev/null | cut -d' ' -f1):4040/ (port in the plugin settings)."
