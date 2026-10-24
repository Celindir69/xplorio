#!/bin/bash
# Volumio plugin Xplorio: dependencies, data folder and the permissions the settings page needs (Volumio runs this as
# root). Data (tag service, history, keys) and own additions in config.local.js live in /data/xplorio and stay when the
# plugin is updated or removed; the plugin takes over the settings of an earlier installation itself on the first start.
echo "Installing Xplorio"
SCRIPTPATH="$(cd "$(dirname "$0")" && pwd -P)"
cd "$SCRIPTPATH" || exit 1
[ -d node_modules/kew ] && [ -d node_modules/v-conf ] || npm install --production --no-audit --no-fund
mkdir -p /data/xplorio
if [ ! -d /data/xplorio/data ]; then
  mkdir -m 700 /data/xplorio/data && chown volumio:volumio /data/xplorio/data
fi
chown volumio:volumio /data/xplorio

# tags.py as a root-owned copy: the switch "write tags with root rights" runs exactly this one via sudo
# (the plugin folder belongs to volumio, a rule for the file there would allow anything)
LIB=/usr/local/lib/xplorio
rm -rf "$LIB/tags.neu"
mkdir -p "$LIB/tags.neu"
cp app/tags/tags.py "$LIB/tags.neu/" && cp -R app/tags/vendor "$LIB/tags.neu/" 2>/dev/null
chown -R root:root "$LIB" && chmod -R go-w "$LIB"
rm -rf "$LIB/tags" && mv "$LIB/tags.neu" "$LIB/tags"

# System page: restart Volumio, MPD and the kiosk, restart and power off the player (the tag service and the Rotel
# bridge are restarted by the plugin itself); tags with root rights (see above)
RULE=/etc/sudoers.d/xplorio-plugin
S=/bin/systemctl
cat > "$RULE.neu" <<RULES
# Xplorio plugin: System page and tag editor (written by the plugin's install.sh, removed on uninstall)
volumio ALL=(root) NOPASSWD: $S --no-block restart volumio, $S --no-block restart mpd, $S --no-block start volumio-kiosk, $S --no-block stop volumio-kiosk, $S --no-block restart volumio-kiosk, /sbin/reboot, /sbin/poweroff
volumio ALL=(root) NOPASSWD: /usr/bin/python $LIB/tags/tags.py, /usr/bin/python3 $LIB/tags/tags.py
RULES
chmod 440 "$RULE.neu"
if ! command -v visudo >/dev/null 2>&1 || visudo -cf "$RULE.neu" >/dev/null; then
  mv "$RULE.neu" "$RULE"
else
  rm -f "$RULE.neu"; echo "sudo rule not valid, left out"
fi
echo "Xplorio installed"
# required to end the plugin install
echo "plugininstallend"
