#!/bin/bash
# Volumio plugin Xplorio: stops and removes the systemd services of install.sh, then the caches and runtime files the
# services wrote (image caches, library lists, check result, CPU history; all rebuilt by themselves). The user's own
# data stays in /data/xplorio for a reinstall: history, ratings, lyrics offsets, password, Last.fm access, undo data,
# audio analysis, collected mood tags and release dates, own config.local.js (delete the folder by hand to remove everything).
for u in xplorio-web xplorio-tags xplorio-rotel; do
  f=/etc/systemd/system/$u.service
  if grep -qs "^# Xplorio plugin" "$f"; then
    systemctl stop "$u" 2>/dev/null
    rm -f "$f"
  fi
done
systemctl daemon-reload 2>/dev/null
rm -rf /tmp/xplorio
D=${XPLORIO_DATA:-/data/xplorio}/data            # XPLORIO_DATA: tests only
if [ -d "$D" ]; then
  rm -rf "$D/artists" "$D/radio-covers" "$D/stations"
  rm -f "$D/albums.json" "$D/library-tracks.json" "$D/check.json" "$D/sysinfo.json" "$D/welcome.json" "$D/together.json"
  find "$D" -maxdepth 2 \( -name '*.neu' -o -name '*.tmp' \) -type f -delete 2>/dev/null
fi
echo "Xplorio removed (caches deleted; your data in /data/xplorio kept)"
echo "pluginuninstallend"
