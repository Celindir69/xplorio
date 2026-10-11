#!/bin/sh
# TIDAL watchdog: restarts Volumio when TIDAL stops answering (session timeout in the plugin).
#
# How it works: query a light TIDAL page (time limit TIMEOUT). If that fails, try again after RETRY_PAUSE seconds.
# If the second try fails too, Volumio is restarted (playback continues meanwhile). After SETTLE seconds it checks
# again and logs the result.
# Protection against loops: at most one restart per MIN_GAP seconds (e.g. during an outage at TIDAL itself).
# If Volumio is not running at all (connection refused), nothing happens.
#
# Usage:    tidal-watchdog.sh            check and restart if needed (for cron, as root)
#           tidal-watchdog.sh --check    only check and print, never restart
# Log:      /var/log/tidal-watchdog.log (only the last lines are kept)

URL="${VOLUMIO_URL:-http://localhost:3000}"
CHECK_URI="${CHECK_URI:-tidal://artist/27441}"      # a page that is queried at TIDAL
TIMEOUT="${TIMEOUT:-20}"
RETRY_PAUSE="${RETRY_PAUSE:-60}"
SETTLE="${SETTLE:-90}"
MIN_GAP="${MIN_GAP:-3600}"                          # 1 hour (TIDAL drops out about every 4 hours, see the TIDAL watchdog section in docs/setup.md)
RESTART_CMD="${RESTART_CMD:-systemctl restart volumio}"
LOG="${LOG:-/var/log/tidal-watchdog.log}"
STAMP="${STAMP:-/var/run/tidal-watchdog.last}"
LOCK="${LOCK:-/var/run/tidal-watchdog.lock}"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG" 2>/dev/null
  [ "$CHECK_ONLY" = 1 ] && echo "$*"
  if [ -f "$LOG" ] && [ "$(wc -l < "$LOG")" -gt 300 ]; then tail -n 150 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"; fi
}

CHECK_ONLY=0
[ "$1" = "--check" ] && CHECK_ONLY=1

# result: 0 = TIDAL answers, 1 = timeout or wrong answer, 2 = Volumio not reachable
check() {
  body=$(curl -s -m "$TIMEOUT" "$URL/api/v1/browse?uri=$CHECK_URI")
  rc=$?
  [ $rc -eq 7 ] && return 2
  [ $rc -ne 0 ] && return 1
  case "$body" in *'"navigation"'*'"lists"'*) return 0 ;; esac
  return 1
}

# only one run at a time
if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi
trap 'rmdir "$LOCK"' EXIT

check; r=$?
[ $r -eq 2 ] && { log "Volumio not reachable - nothing done"; exit 0; }
[ $r -eq 0 ] && { log "TIDAL ok"; exit 0; }

log "TIDAL does not answer (1st try), waiting ${RETRY_PAUSE}s"
[ "$CHECK_ONLY" = 1 ] && exit 1
sleep "$RETRY_PAUSE"
check; r=$?
[ $r -eq 2 ] && { log "Volumio not reachable - nothing done"; exit 0; }
[ $r -eq 0 ] && { log "TIDAL ok again (2nd try)"; exit 0; }

now=$(date +%s)
last=$(cat "$STAMP" 2>/dev/null || echo 0)
if [ $((now - last)) -lt "$MIN_GAP" ]; then
  log "TIDAL still does not answer, but the last restart was less than ${MIN_GAP}s ago - no restart"
  exit 1
fi

echo "$now" > "$STAMP"
log "TIDAL does not answer (2nd try): restarting Volumio"
sh -c "$RESTART_CMD" >> "$LOG" 2>&1
sleep "$SETTLE"
check; r=$?
if [ $r -eq 0 ]; then log "after the restart: TIDAL ok"; else log "after the restart: TIDAL still does not answer (result $r)"; fi
