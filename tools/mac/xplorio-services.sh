#!/bin/bash
# Xplorio on the Mac: starts and stops what Xplorio needs (MPD, tag service, web server). Called by the program
# Xplorio.app (make-app.sh): "start" when it opens, "stop" when its window is closed.
#   xplorio-services.sh start|stop|status
# start: starts what is not running yet and waits until all three answer. On an error the reason is printed (German,
# shown by the program) and the exit code is 1.
# Settings in ../xplorio.conf next to the app files (written by make-app.sh). Logs: ~/Library/Logs/Xplorio.
# bash 3.2 (macOS); besides macOS itself only node and mpd (Homebrew).

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"                          # the Xplorio files (xplorio.html, web, server, tags)
. "${XPLORIO_CONF:-$APP/../xplorio.conf}"               # SUPPORT, MPD_CONF, MPD_PORT, MUSIC_ROOT, TAGS_DATA
LOG="${XPLORIO_LOG:-$HOME/Library/Logs/Xplorio}"
RUN="$SUPPORT/run"
WEB_PORT=${WEB_PORT:-4040}
TAGS_PORT=${TAGS_PORT:-8766}
MPD_PORT=${MPD_PORT:-6600}
mkdir -p "$LOG" "$RUN"

up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }   # something answers on this port
waitUp() { local i=0; while [ $i -lt "$2" ]; do up "$1" && return 0; sleep 0.5; i=$((i + 1)); done; return 1; }

stopAll() {
  local n p
  for n in web tags; do
    if [ -f "$RUN/$n.pid" ]; then
      p=$(cat "$RUN/$n.pid")
      kill "$p" 2>/dev/null
      rm -f "$RUN/$n.pid"
    fi
  done
  mpd --kill "$MPD_CONF" >/dev/null 2>&1
  return 0
}

case "$1" in
  stop) stopAll; exit 0 ;;
  status)
    for x in "mpd:$MPD_PORT" "tags:$TAGS_PORT" "web:$WEB_PORT"; do
      if up "${x#*:}"; then echo "${x%%:*} läuft"; else echo "${x%%:*} aus"; fi
    done
    exit 0 ;;
  start) ;;
  *) echo "usage: $0 start|stop|status" >&2; exit 2 ;;
esac

NODE=$(command -v node); MPD=$(command -v mpd)
if [ -z "$NODE" ] || [ -z "$MPD" ]; then
  echo "Es fehlen Programme. Bitte im Terminal eingeben: brew install mpd mpc node"
  exit 1
fi

if ! up "$MPD_PORT"; then
  "$MPD" "$MPD_CONF" >>"$LOG/mpd.log" 2>&1
  if ! waitUp "$MPD_PORT" 20; then
    echo "MPD startet nicht. Den Grund zeigt die Datei $LOG/mpd.log"
    exit 1
  fi
fi

cd "$APP" || exit 1
if ! up "$TAGS_PORT"; then
  XPLORIO_PLAYER=mpd MPD_HOST=127.0.0.1 MPD_PORT="$MPD_PORT" MUSIC_ROOT="$MUSIC_ROOT" TAGS_DATA="$TAGS_DATA" HTTP_PORT="$TAGS_PORT" \
    nohup "$NODE" tags/tag-service.js >>"$LOG/tags.log" 2>&1 </dev/null &
  echo $! >"$RUN/tags.pid"
fi
if ! up "$WEB_PORT"; then
  HTTP_PORT="$WEB_PORT" nohup "$NODE" server/xplorio-server.js >>"$LOG/web.log" 2>&1 </dev/null &
  echo $! >"$RUN/web.pid"
fi
if ! waitUp "$WEB_PORT" 30 || ! waitUp "$TAGS_PORT" 30; then
  echo "Xplorio startet nicht. Den Grund zeigen die Dateien in $LOG"
  exit 1
fi
exit 0
