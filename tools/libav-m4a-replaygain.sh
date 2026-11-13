#!/bin/bash
# libav-m4a-replaygain: ReplayGain in m4a (ALAC, AAC) for MPD on Volumio 2 (e.g. MX-Stream), by patching libav 11.
#
# MPD reads m4a through libavformat (libav 11). It takes ReplayGain from freeform atoms only when their domain is
# "org.hydrogenaudio.replaygain" (libavformat/mov.c, mov_read_custom); the usual domain "com.apple.iTunes" is ignored,
# so MPD plays such files without ReplayGain. The patch changes that one string in the library to "com.apple.iTunes":
# 17 bytes ("com.apple.iTunes" and its end), the rest stays as it is. Afterwards the iTunes fields are read (also
# other iTunes fields such as iTunNORM end up as harmless extra metadata), hydrogenaudio fields no longer are.
#
#   sudo bash libav-m4a-replaygain.sh            # check only: finds the library, shows whether it is patched
#   sudo bash libav-m4a-replaygain.sh apply      # backup to /data/xplorio/libav-backup, patch, restart MPD
#   sudo bash libav-m4a-replaygain.sh rollback   # original back from the backup, restart MPD
#
# Only for libav 11 (libavformat.so.56); refuses anything else. Tested on copies, not on every player: if MPD no longer
# plays afterwards, "rollback" brings the original back.
set -u
LIBDIR=${LIBDIR:-/usr/lib/arm-linux-gnueabihf}
BACKUP=${BACKUP:-/data/xplorio/libav-backup}
OLD='org.hydrogenaudio.replaygain'
NEW='com.apple.iTunes'
CMD=${1:-check}

restart_mpd() {
  [ -n "${NOSVC:-}" ] && { echo "(MPD-Neustart übersprungen)"; return; }
  systemctl restart mpd && echo "MPD neu gestartet." || echo "MPD-Neustart fehlgeschlagen: sudo systemctl restart mpd"
}

# the real files behind libavformat.so.56 (plain and the neon/vfp variant Raspbian loads on the Pi 2/3)
libs() {
  find "$LIBDIR" -name 'libavformat.so.56*' 2>/dev/null | while read -r l; do readlink -f "$l"; done | sort -u
}

# state of one file: orig | patched | unknown (python 2 and 3)
state() {
  python - "$1" "$OLD" "$NEW" <<'EOF'
import sys
d = open(sys.argv[1], 'rb').read()
old = sys.argv[2].encode('ascii'); new = sys.argv[3].encode('ascii')
o = d.count(old + b'\0')
p = d.count(new + b'\0' + old[len(new) + 1:] + b'\0')
print('orig' if o == 1 and p == 0 else 'patched' if p == 1 and o == 0 else 'unknown %d %d' % (o, p))
EOF
}

patch_file() {
  python - "$1" "$2" "$OLD" "$NEW" <<'EOF'
import sys
src, dst, old, new = sys.argv[1], sys.argv[2], sys.argv[3].encode('ascii'), sys.argv[4].encode('ascii')
d = open(src, 'rb').read()
i = d.find(old + b'\0')
assert i >= 0 and d.count(old + b'\0') == 1
d = d[:i] + new + b'\0' + d[i + len(new) + 1:]          # same length, the tail "replaygain" stays untouched
open(dst, 'wb').write(d)
EOF
}

L=$(libs)
[ -z "$L" ] && { echo "Keine libavformat.so.56 unter $LIBDIR gefunden: nicht libav 11, nichts zu tun."; exit 1; }

case "$CMD" in
  check)
    for f in $L; do echo "$f: $(state "$f")"; done
    ls "$BACKUP" 2>/dev/null | sed 's/^/Sicherung: /'
    ;;
  apply)
    mkdir -p "$BACKUP" || exit 1
    todo=""
    for f in $L; do
      s=$(state "$f")
      case "$s" in
        orig) todo="$todo $f" ;;
        patched) echo "$f: schon gepatcht." ;;
        *) echo "$f: unerwarteter Inhalt ($s), Abbruch, nichts geändert."; exit 1 ;;
      esac
    done
    [ -z "$todo" ] && exit 0
    for f in $todo; do
      b="$BACKUP/$(basename "$f")$(echo "$f" | grep -q /neon/ && echo .neon)"
      [ -e "$b" ] || cp -p "$f" "$b" || { echo "Sicherung von $f fehlgeschlagen, Abbruch."; exit 1; }
      echo "$f" > "$b.path"
      patch_file "$f" "$f.xplorio-neu" && chmod --reference="$f" "$f.xplorio-neu" && mv -f "$f.xplorio-neu" "$f" \
        || { rm -f "$f.xplorio-neu"; echo "Patch von $f fehlgeschlagen, Original unverändert."; exit 1; }
      echo "$f: gepatcht ($(state "$f")), Original in $b"
    done
    restart_mpd
    echo "Rückweg: sudo bash $0 rollback"
    ;;
  rollback)
    n=0
    for p in "$BACKUP"/*.path; do
      [ -e "$p" ] || continue
      b=${p%.path}; f=$(cat "$p")
      cp -p "$b" "$f.xplorio-alt" && mv -f "$f.xplorio-alt" "$f" && echo "$f: Original zurück ($(state "$f"))" && n=$((n+1))
    done
    [ "$n" -eq 0 ] && { echo "Keine Sicherung in $BACKUP gefunden."; exit 1; }
    restart_mpd
    ;;
  *) echo "Aufruf: $0 [check|apply|rollback]"; exit 2 ;;
esac
