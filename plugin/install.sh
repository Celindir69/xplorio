#!/bin/bash
# Volumio plugin Xplorio: dependencies, data folder and own settings. Data (tag service, history, keys) and
# config.local.js live in /data/xplorio and stay when the plugin is updated or removed.
echo "Installing Xplorio"
SCRIPTPATH="$(cd "$(dirname "$0")" && pwd -P)"
cd "$SCRIPTPATH" || exit 1
[ -d node_modules/kew ] && [ -d node_modules/v-conf ] || npm install --production --no-audit --no-fund
mkdir -p /data/xplorio
if [ ! -d /data/xplorio/data ]; then
  mkdir -m 700 /data/xplorio/data && chown volumio:volumio /data/xplorio/data
fi
# own settings from an earlier installation below /volumio (copied once, the original stays untouched)
if [ ! -e /data/xplorio/config.local.js ]; then
  for w in www4 www3 www; do
    f=/volumio/http/$w/web/config.local.js
    if [ -f "$f" ]; then cp "$f" /data/xplorio/config.local.js && echo "Settings taken over from $f"; break; fi
  done
fi
echo "Xplorio installed"
# required to end the plugin install
echo "plugininstallend"
