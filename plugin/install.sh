#!/bin/bash
# Volumio plugin Xplorio: dependencies, data folder and the systemd services xplorio-web, xplorio-tags and
# xplorio-rotel (only defined here, the plugin starts and stops them). Data (tag service, history, keys) and own
# additions in config.local.js live in /data/xplorio and stay when the plugin is updated or removed.
echo "Installing Xplorio"
SCRIPTPATH="$(cd "$(dirname "$0")" && pwd -P)"
cd "$SCRIPTPATH" || exit 1
UNITS="xplorio-web xplorio-tags xplorio-rotel"
MARK="# Xplorio plugin"

# a failed installation leaves nothing behind (no half plugin in Volumio's list)
fail() {
  echo "Xplorio installation failed: $1"
  for u in $UNITS; do grep -qs "^$MARK" "/etc/systemd/system/$u.service" && rm -f "/etc/systemd/system/$u.service"; done
  systemctl daemon-reload 2>/dev/null
  case "$SCRIPTPATH" in /data/plugins/*) rm -rf "$SCRIPTPATH" ;; esac
  echo "plugininstallend"
  exit 1
}

if [ ! -d node_modules/kew ] || [ ! -d node_modules/v-conf ]; then
  echo "Installing the Node modules"
  npm install --production --no-audit --no-fund || fail "npm install"
fi
NODE=$(command -v node) || fail "node not found"

echo "Preparing /data/xplorio"
mkdir -p /data/xplorio || fail "mkdir /data/xplorio"
[ -d /data/xplorio/data ] || mkdir -m 700 /data/xplorio/data || fail "mkdir /data/xplorio/data"
chown volumio:volumio /data/xplorio /data/xplorio/data

# unit name, description, script below app/, node options, "nopriv" (needs no sudo: no privileges at all);
# only our own files (marked) are written or replaced. /usr, /boot and /etc stay read-only for all three
unit() {
  local f="/etc/systemd/system/$1.service"
  if [ -e "$f" ] && ! grep -qs "^$MARK" "$f"; then echo "$f exists and is not from Xplorio, left unchanged"; return 0; fi
  echo "Writing $f"
  cat > "$f" <<UNIT || fail "writing $f"
$MARK (written by install.sh, started and stopped by the plugin, removed on uninstall)
[Unit]
Description=$2
After=network-online.target

[Service]
User=volumio
Group=volumio
EnvironmentFile=-/tmp/xplorio/$1.env
WorkingDirectory=$SCRIPTPATH/app/$(dirname "$3")
ExecStart=$NODE ${4:+$4 }$SCRIPTPATH/app/$3
Restart=always
RestartSec=5
ProtectSystem=full
${5:+NoNewPrivileges=true}
UNIT
}
unit xplorio-web   "Xplorio web server (Volumio plugin)"  server/xplorio-server.js "" nopriv
unit xplorio-tags  "Xplorio tag service (Volumio plugin)" tags/tag-service.js "--max-old-space-size=384"
unit xplorio-rotel "Xplorio Rotel bridge (Volumio plugin)" rotel/rotel-bridge.js "" nopriv
systemctl daemon-reload || fail "systemctl daemon-reload"

echo "Xplorio installed"
# required to end the plugin install
echo "plugininstallend"
