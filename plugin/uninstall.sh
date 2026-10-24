#!/bin/bash
# Volumio removes the plugin folder itself. /data/xplorio (data, history, keys, config.local.js) stays in place
# for a later reinstall; delete it by hand if it is no longer needed.
echo "Removing Xplorio"
# required to end the plugin uninstall
echo "pluginuninstallend"
