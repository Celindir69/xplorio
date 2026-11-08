#!/bin/bash
# Installs the "MPD HTTP & Icecast output" plugin (github.com/foonerd/mpd-output, ISC license) on Volumio 2,
# e.g. the Musical Fidelity MX-Stream. The plugin is written for Volumio 4; two small adjustments make it run on
# Volumio 2 / Node 8:
#   - the backup folder is created without fs.mkdirSync({recursive}) (Node 10+)
#   - its libraries kew and v-conf come from the installed Xplorio plugin (no npm, no internet beyond GitHub)
# It is installed through Volumio's websocket (Xplorio's tools/plugin-install.js), because
# "volumio plugin install" hangs on the MX-Stream.
# Run: sudo bash mpdoutput-volumio2.sh
set -e
COMMIT=e30167872814148c756ee32bf856bea42284b5ad      # mpd-output 3.0.0, checked on 08.11.2026
XPLORIO_MODULES=/data/plugins/user_interface/xplorio/node_modules
MPD_JS=/volumio/app/plugins/music_service/mpd/index.js
T=/tmp/mpdoutput-build

die() { echo "ERROR: $*"; exit 1; }
[ "$(id -u)" = 0 ] || die "please run with sudo"
NODE=$(command -v node || true); [ -n "$NODE" ] || for n in /usr/local/bin/node /usr/bin/node; do [ -x "$n" ] && NODE=$n && break; done
[ -n "$NODE" ] || die "node not found"
MPD=$(command -v mpd || echo /usr/bin/mpd)
grep -q registeredCallbacks "$MPD_JS" || die "Volumio's MPD plugin has no registeredCallbacks: outputs cannot be added"
"$MPD" --version | sed -n '/Output plugins/,/^$/p' | grep -qw httpd || die "MPD has no httpd output"
[ -d "$XPLORIO_MODULES/kew" ] && [ -d "$XPLORIO_MODULES/v-conf" ] || die "kew/v-conf not found in $XPLORIO_MODULES"
[ -d /data/plugins/audio_interface/mpdoutput ] && die "the plugin is already installed"

rm -rf "$T"; mkdir -p "$T/mpdoutput"; cd "$T/mpdoutput"
echo "Downloading mpd-output …"
curl -fsSL "https://codeload.github.com/foonerd/mpd-output/tar.gz/$COMMIT" | tar xz --strip-components=1
rm -rf .github test
# Node and MPD where this Volumio has them (Volumio 2: /usr/local/bin/node), not where Volumio 4 has them
sed -i "s|/usr/bin/node|$NODE|g; s|/usr/bin/mpd|$MPD|g" install.sh
sed -i "s|/usr/bin/node|$NODE|g" systemd/mpd-output-relay.service
grep -q "fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });" index.js || die "index.js differs from the checked version"
sed -i "s|fs.mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o700 });|try { fs.mkdirSync(path.dirname(BACKUP_DIR)); } catch (e) { /* exists */ } try { fs.mkdirSync(BACKUP_DIR, 0o700); } catch (e) { if (e.code !== 'EEXIST') throw e; }   /* Node 8 (Volumio 2) */|" index.js
"$NODE" --check index.js || die "index.js does not run on this Node"
cp -R "$XPLORIO_MODULES" node_modules

echo "Packing …"
if command -v zip >/dev/null 2>&1; then zip -qr ../mpdoutput.zip .
else
  PY=$(command -v python3 || command -v python)
  "$PY" -c 'import os, sys, zipfile
z = zipfile.ZipFile(sys.argv[2], "w", zipfile.ZIP_DEFLATED)
for d, dirs, files in os.walk(sys.argv[1]):
    for f in files:
        full = os.path.join(d, f); z.write(full, os.path.relpath(full, sys.argv[1]))
z.close()' . ../mpdoutput.zip
fi

mkdir -p /tmp/plugins && chown volumio:volumio /tmp/plugins
install -o volumio -g volumio -m 644 ../mpdoutput.zip /tmp/plugins/mpdoutput.zip
curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/plugin-install.js -o /tmp/plugins/mpdoutput-install.js
chown volumio:volumio /tmp/plugins/mpdoutput-install.js
echo "Installing through Volumio …"
sudo -u volumio "$NODE" /tmp/plugins/mpdoutput-install.js install mpdoutput.zip || die "Volumio did not finish the install (log: sudo journalctl -u volumio -n 100)"
rm -f /tmp/plugins/mpdoutput-install.js /tmp/plugins/mpdoutput.zip; rm -rf "$T"
echo
echo "Done. Now in Volumio: Plugins > Installed plugins > MPD HTTP & Icecast output: switch on, open the settings,"
echo "switch on the HTTP stream with encoder MP3 and save."
