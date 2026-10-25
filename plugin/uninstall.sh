#!/bin/bash
# Volumio plugin Xplorio: stops and removes the systemd services of install.sh. Data and own settings in /data/xplorio
# stay (delete that folder by hand to remove everything).
for u in xplorio-web xplorio-tags xplorio-rotel; do
  f=/etc/systemd/system/$u.service
  if grep -qs "^# Xplorio plugin" "$f"; then
    systemctl stop "$u" 2>/dev/null
    rm -f "$f"
  fi
done
systemctl daemon-reload 2>/dev/null
rm -rf /tmp/xplorio
echo "Xplorio removed (data in /data/xplorio kept)"
echo "pluginuninstallend"
