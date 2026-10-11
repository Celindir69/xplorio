#!/bin/bash
# Earlier name of xplorio-deploy. Installed as /usr/local/bin/web-app-deploy, it sets up xplorio-deploy (if not there
# yet) and calls it with the same arguments. Calls as before:
#   sudo web-app-deploy [-n|-y] [branch]   sudo web-app-deploy --rollback
ROOT=${DEPLOY_ROOT:-${MX_ROOT:-}}                   # tests only
B=$ROOT/usr/local/bin/xplorio-deploy
if [ ! -x "$B" ]; then
  [ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || { echo "$(basename "$0"): please run with sudo" >&2; exit 1; }
  mkdir -p "$(dirname "$B")"
  # installed with the interface, else load it from the repo
  src=$(ls -1 "$ROOT"/volumio/http/www*/tools/xplorio-deploy.sh 2>/dev/null | head -n 1)
  if [ -n "$src" ]; then cp "$src" "$B.new"
  else curl -fsSL --max-time 60 -o "$B.new" https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh \
    || { echo "could not load xplorio-deploy (network?)" >&2; rm -f "$B.new"; exit 1; }
  fi
  chmod +x "$B.new" && mv "$B.new" "$B"
  echo "xplorio-deploy set up ($B)"
fi
echo "Note: $(basename "$0" .sh) is now called xplorio-deploy."
exec "$B" "$@"
