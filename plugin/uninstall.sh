#!/bin/bash
# Volumio plugin Xplorio: removes the permissions of install.sh. Data and own settings in /data/xplorio stay
# (delete that folder by hand to remove everything).
rm -f /etc/sudoers.d/xplorio-plugin
rm -rf /usr/local/lib/xplorio
echo "Xplorio removed (data in /data/xplorio kept)"
echo "pluginuninstallend"
