#!/bin/bash
# xplorio-deploy: update the Xplorio interface and services directly on the player, from the public repo xplorio.
#
#   sudo xplorio-deploy                    load main, show the changes, install after confirmation
#   sudo xplorio-deploy claude/my-branch   a specific branch
#   sudo xplorio-deploy -n [branch]        only show what would change
#   sudo xplorio-deploy -y [branch]        no confirmation
#   sudo xplorio-deploy --rollback         restore the last backup
#   sudo xplorio-deploy --password         set or change the password for the services on the "System" page
#   sudo xplorio-deploy --tag-service      set up the tag service (systemd unit, data folder, start, health check)
#   sudo xplorio-deploy --rotel [IP]       set up the Rotel bridge (amplifier address in config.local.js, unit, start)
#   --force                                with --tag-service/--rotel: rewrite an existing unit (the old one is backed up);
#                                          with --rotel also replace the amplifier address (asks for it without IP)
#
# The interface (xplorio.html, app.html as a redirect, kioskTV.html, web/, tools/) goes into every existing folder
# /volumio/http/www*/: which one Volumio serves depends on the version and the chosen interface (Volumio 3: www3,
# Volumio 4: www4). The script creates no new folders; if there is none, it stops.
# Everything else lives in /data/xplorio (survives Volumio updates; backing up this folder is enough):
#   tags/  tag service   rotel/  Rotel bridge   data/  tag service data   backup/  backups made by this script
# Earlier installations had everything under /data/web-app (before that the services under /data/INTERNAL): the script
# moves /data/web-app with data and backups to /data/xplorio, leaves a symlink behind and switches the services'
# systemd units to the new paths (the tag service moves its data from /data/INTERNAL by itself).
# Before every install the affected files are backed up under /data/xplorio/backup (the last 5 are kept).
# Your own files such as web/config.local.js are not in the repo and stay untouched; nothing is deleted.
# Only --rotel adds to config.local.js, and only if it has no ROTEL_HOST yet (after a backup); --rotel --force replaces it.
# Install:  curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null && sudo chmod +x /usr/local/bin/xplorio-deploy
# The earlier names web-app-deploy, mx-deploy and volumio4-deploy call this script (tools/web-app-deploy.sh, tools/mx-deploy.sh).
# The German option names of earlier versions still work (--passwort, --zurueck, --tagdienst, --neu).
set -e

REPO=${DEPLOY_REPO:-${MX_REPO:-Celindir69/xplorio}}
ROOT=${DEPLOY_ROOT:-${MX_ROOT:-}}                   # tests only: everything below this folder instead of /
SOURCE=${DEPLOY_SOURCE:-${MX_SOURCE:-}}             # tests only: archive instead of download
PROG=xplorio-deploy
WWWS=${DEPLOY_WWW:-${MX_WWW:-}}                     # interface folders below /volumio/http/ (default: all existing www*)
if [ -z "$WWWS" ]; then
  for d in "$ROOT"/volumio/http/www*/; do
    [ -d "$d" ] && WWWS="$WWWS $(basename "$d")"
  done
  WWWS=${WWWS# }
fi
APP=$ROOT/data/xplorio
OLD_APP=$ROOT/data/web-app                          # earlier folder (until the move)
STATE=$APP/backup
OLD_STATES="$OLD_APP/backup $ROOT/data/INTERNAL/mx-deploy $ROOT/data/INTERNAL/volumio4-deploy"   # backups from before the move or under the earlier names
KEEP=5

# targets per repo file, one per line (empty = not for the player)
target() {
  case "$1" in
    tags/*)                  echo "$APP/$1" ;;
    rotel/rotel-bridge.js)   echo "$APP/$1" ;;
    tools/xplorio-deploy.sh) echo "$ROOT/usr/local/bin/$PROG"; for w in $WWWS; do echo "$ROOT/volumio/http/$w/$1"; done ;;   # also for the wrappers
    tools/web-app-deploy.sh) [ -e "$ROOT/usr/local/bin/web-app-deploy" ] && echo "$ROOT/usr/local/bin/web-app-deploy"; true ;;   # only earlier names that exist
    tools/mx-deploy.sh)      for p in mx-deploy volumio4-deploy; do [ -e "$ROOT/usr/local/bin/$p" ] && echo "$ROOT/usr/local/bin/$p"; done; true ;;
    xplorio.html|app.html|kioskTV.html|web/*|tools/*)  for w in $WWWS; do echo "$ROOT/volumio/http/$w/$1"; done ;;
  esac
}
TAB=$'\t'                                           # list entries: repo path TAB target

die() { echo "$PROG: $*" >&2; exit 1; }
[ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || die "please run with sudo"

# systemd units of the services that still point to /data/INTERNAL or /data/web-app
UNIT_DIR=$ROOT/etc/systemd/system
old_units() { for u in tag-service rotel-bridge; do
  grep -qs '/data/INTERNAL/\(tags\|rotel\)\|/data/web-app/' "$UNIT_DIR/$u.service" && echo "$u"; done; true; }

# move /data/web-app -> /data/xplorio needed? (old folder present, not a symlink, new folder not there yet)
MOVE=0
[ -d "$OLD_APP" ] && [ ! -L "$OLD_APP" ] && [ ! -e "$APP" ] && MOVE=1
# file that sits at a target's place today (before the move still in the old folder)
now_at() { if [ $MOVE = 1 ] && [ "${1#$APP/}" != "$1" ]; then echo "$OLD_APP/${1#$APP/}"; else echo "$1"; fi; }
# path relative to the root, for tar
rel() { echo "${1#${ROOT:-/}}" | sed 's|^/||'; }

# folders below /data/xplorio; data/ readable only by the service (volumio)
prepare_dirs() {
  mkdir -p "$APP" "$STATE"; chmod 700 "$STATE"
  [ -d "$APP/data" ] || { mkdir -m 700 "$APP/data" && echo "Data folder $APP/data created"; }
  [ -n "$ROOT" ] || chown volumio:volumio "$APP/data" 2>/dev/null || true
}

restart_services() {               # $1: list of changed repo paths (services as tags/… or rotel/…)
  [ -n "$ROOT" ] && { echo "$1" | grep -q '^tags/' && echo "(test) restart tag-service"; echo "$1" | grep -q '^rotel/' && echo "(test) restart rotel-bridge"; return 0; }
  systemctl daemon-reload 2>/dev/null || true
  if echo "$1" | grep -q '^tags/'; then
    chown -R volumio:volumio "$APP/tags" 2>/dev/null || true
    systemctl restart tag-service 2>/dev/null && echo "tag-service restarted" || echo "Note: tag-service not restarted (not set up? sudo $PROG --tag-service)"
  fi
  if echo "$1" | grep -q '^rotel/'; then
    systemctl restart rotel-bridge 2>/dev/null && echo "rotel-bridge restarted" || echo "Note: rotel-bridge not restarted (not set up? sudo $PROG --rotel)"
  fi
}

# next to each backup: <base>.new (files the install created, removed on rollback) and <base>.paths (repo paths, to
# restart the services); backups of earlier versions use .neu and .pfade
sidecar() { if [ -e "$1.$2" ]; then echo "$1.$2"; elif [ "$2" = new ]; then echo "$1.neu"; else echo "$1.pfade"; fi; }
prune_backups() {
  ls -1 "$STATE"/backup-*.tar.gz 2>/dev/null | sort | head -n -$KEEP | while IFS= read -r old; do
    b=${old%.tar.gz}; rm -f "$old" "$b.new" "$b.paths" "$b.neu" "$b.pfade"; done
}

# ---------- password for the services ("System" page): only a hash in data/admin.json ----------
if [ "$1" = "--password" ] || [ "$1" = "--passwort" ]; then
  [ -f "$APP/tags/adminpass.js" ] || die "$APP/tags/adminpass.js is missing: install the tag service first (sudo $PROG)"
  prepare_dirs
  NODE=${DEPLOY_NODE:-$(command -v node || echo /usr/bin/node)}
  "$NODE" "$APP/tags/adminpass.js" "$APP/data" || exit 1
  [ -n "$ROOT" ] || chown volumio:volumio "$APP/data/admin.json" 2>/dev/null || true
  exit 0
fi

# ---------- rollback ----------
if [ "$1" = "--rollback" ] || [ "$1" = "--zurueck" ] || [ "$1" = "--zurück" ]; then
  last=$(for d in "$STATE" $OLD_STATES; do ls -1 "$d"/backup-*.tar.gz 2>/dev/null; done \
    | while IFS= read -r b; do printf '%s\t%s\n' "$(basename "$b")" "$b"; done | sort | tail -n 1 | cut -f2)
  [ -n "$last" ] || die "no backup found"
  base=${last%.tar.gz}
  echo "Restoring: $(basename "$base")"
  tar xzf "$last" -C "${ROOT:-/}"
  created=$(sidecar "$base" new)
  if [ -s "$created" ]; then while IFS= read -r f; do rm -f "$f"; done < "$created"; fi
  restart_services "$(cat "$(sidecar "$base" paths)" 2>/dev/null)"
  rm -f "$last" "$base.new" "$base.paths" "$base.neu" "$base.pfade"   # the next rollback takes the previous backup
  echo "Done. Hard-reload the browser."
  exit 0
fi

[ -n "$WWWS" ] || die "no folder /volumio/http/www* found (is Volumio installed?); pick one with DEPLOY_WWW=<folder>"

DRY=0; YES=0; FORCE=0; SETUP=""; ROTEL_IP=""
while [ $# -gt 0 ]; do
  case "$1" in
    -n) DRY=1 ;;
    -y) YES=1 ;;
    --tag-service|--tagdienst) SETUP="$SETUP tag" ;;
    --rotel|--rotel-bridge)
      SETUP="$SETUP rotel"
      # optional address right after it: an IP or a host name with a dot (branch names have a slash or no dot)
      case "$2" in */*|-*) ;; *.*) ROTEL_IP=$2; shift ;; esac ;;
    --force|--neu) FORCE=1 ;;
    -*) die "unknown option $1" ;;
    *)  BRANCH=$1 ;;
  esac
  shift
done
BRANCH=${BRANCH:-main}
valid_host() { echo "$1" | grep -Eq '^[A-Za-z0-9._-]+$'; }

# ---------- set up services (--tag-service, --rotel) ----------
if [ -n "$SETUP" ]; then
  [ $DRY = 0 ] || die "-n does not work with --tag-service or --rotel"
  [ -z "$ROTEL_IP" ] || valid_host "$ROTEL_IP" || die "invalid amplifier address: $ROTEL_IP"
  has() { case "$SETUP" in *"$1"*) return 0 ;; esac; return 1; }

  # service files missing (or still in /data/web-app)? install the branch first
  need=0
  has tag   && [ ! -f "$APP/tags/tag-service.js" ]   && need=1
  has rotel && [ ! -f "$APP/rotel/rotel-bridge.js" ] && need=1
  if [ $need = 1 ] || [ $MOVE = 1 ]; then
    echo "Files in /data/xplorio are missing, installing $BRANCH first."
    bash "$0" -y "$BRANCH" || die "install failed"
    echo
  fi
  prepare_dirs
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
  BACKUP=""                       # existing files that change (relative to the root)
  UNITS_NEW=""                    # units to write
  CFG_ADD=""                      # www folders whose config.local.js gets the Rotel lines
  CFG_SET=""                      # www folders whose ROTEL_HOST is replaced (--force with an address)

  # unit name dir script description [environment line]: prepared in $WORK, written after the backup
  unit() {
    local f="$UNIT_DIR/$1.service"
    if [ -e "$f" ] && [ $FORCE = 0 ]; then
      echo "$1 is already set up, unit left unchanged (/etc/systemd/system/$1.service; --force rewrites it)"
      return 0
    fi
    [ -e "$f" ] && BACKUP="$BACKUP$(rel "$f")"$'\n'
    UNITS_NEW="$UNITS_NEW $1"
    {
      echo "[Unit]"
      echo "Description=$4"
      echo "After=network-online.target"
      echo
      echo "[Service]"
      echo "ExecStart=/usr/bin/env node /data/xplorio/$2/$3"
      echo "WorkingDirectory=/data/xplorio/$2"
      echo "Restart=always"
      echo "User=volumio"
      if [ -n "$5" ]; then echo "$5"; fi
      echo
      echo "[Install]"
      echo "WantedBy=multi-user.target"
    } > "$WORK/$1.service"
  }

  has tag && unit tag-service tags tag-service.js "Xplorio tag service"

  if has rotel; then
    cfg_of() { echo "$ROOT/volumio/http/$1/web/config.local.js"; }
    has_host() { grep -Eqs '^[^/]*ROTEL_HOST' "$(cfg_of "$1")"; }
    # config folder for the bridge: one that already has ROTEL_HOST, else www3, www4, www
    CFG_DIR=""
    for w in $WWWS; do has_host "$w" && { CFG_DIR=$w; break; }; done
    if [ -z "$CFG_DIR" ]; then
      for w in www3 www4 www; do case " $WWWS " in *" $w "*) CFG_DIR=$w; break ;; esac; done
      CFG_DIR=${CFG_DIR:-${WWWS%% *}}
    fi
    HAVE=""
    for w in $WWWS; do if has_host "$w"; then HAVE="$HAVE $w"; else CFG_ADD="$CFG_ADD $w"; fi; done
    # --force: replace an existing address too (asks for it when none was given; empty input keeps it)
    if [ $FORCE = 1 ] && [ -n "$HAVE" ]; then
      if [ -z "$ROTEL_IP" ]; then
        cur=$(grep -Eho '^[^/]*ROTEL_HOST[[:space:]]*[:=][[:space:]]*[^,;]*' "$(cfg_of "$CFG_DIR")" | head -n 1 | sed -E "s/.*[:=][[:space:]]*//; s/['\"]//g")
        read -r -p "IP address of the amplifier (Enter keeps ${cur:-the current one}): " ROTEL_IP || true
        [ -z "$ROTEL_IP" ] || valid_host "$ROTEL_IP" || die "invalid amplifier address: $ROTEL_IP"
      fi
      if [ -n "$ROTEL_IP" ]; then CFG_SET=$HAVE; HAVE=""; fi
    fi
    for w in $HAVE; do echo "ROTEL_HOST is already set in /volumio/http/$w/web/config.local.js, left unchanged (--force replaces it)"; done
    if [ -n "$CFG_ADD" ]; then
      if [ -z "$ROTEL_IP" ]; then
        read -r -p "IP address of the amplifier (e.g. 192.168.1.50): " ROTEL_IP || true
        [ -n "$ROTEL_IP" ] || die "no amplifier address given (sudo $PROG --rotel <IP>)"
        valid_host "$ROTEL_IP" || die "invalid amplifier address: $ROTEL_IP"
      fi
    elif [ -z "$CFG_SET" ] && [ -n "$ROTEL_IP" ]; then
      echo "Note: $ROTEL_IP not used, config.local.js already has an address (--force replaces it)"
    fi
    for w in $CFG_ADD $CFG_SET; do [ -e "$(cfg_of "$w")" ] && BACKUP="$BACKUP$(rel "$(cfg_of "$w")")"$'\n'; done
    unit rotel-bridge rotel rotel-bridge.js "Rotel bridge for Xplorio" "Environment=APP_CONFIG_DIR=/volumio/http/$CFG_DIR/web"
  fi

  # back up the existing files that change (restored with --rollback)
  if [ -n "$BACKUP" ]; then
    base="$STATE/backup-$(date +%Y%m%d-%H%M%S)"
    printf '%s' "$BACKUP" > "$WORK/list"
    tar czf "$base.tar.gz" -C "${ROOT:-/}" -T "$WORK/list"
    : > "$base.new"
    { for u in $UNITS_NEW; do [ $u = tag-service ] && echo "tags/$u.service" || echo "rotel/$u.service"; done
      [ -n "$CFG_ADD$CFG_SET" ] && echo "rotel/config.local.js"; true; } > "$base.paths"
    prune_backups
    echo "Backup: $(basename "$base") (undo with: sudo $PROG --rollback)"
  fi

  for w in $CFG_ADD; do
    c=$(cfg_of "$w")
    {
      if [ -s "$c" ] && [ -n "$(tail -c 1 "$c")" ]; then echo; fi
      echo "/* Rotel (added by $PROG --rotel) */"
      echo "window.APP_CONFIG.ROTEL = true;"
      echo "window.APP_CONFIG.ROTEL_HOST = '$ROTEL_IP';"
    } >> "$c"
    echo "Amplifier $ROTEL_IP added to /volumio/http/$w/web/config.local.js"
  done
  for w in $CFG_SET; do
    sed -i -E "/^[^/]*ROTEL_HOST/ s/(ROTEL_HOST[[:space:]]*[:=][[:space:]]*)(['\"])[^'\"]*(['\"])/\\1\\2$ROTEL_IP\\3/" "$(cfg_of "$w")"
    echo "Amplifier address in /volumio/http/$w/web/config.local.js set to $ROTEL_IP"
  done
  mkdir -p "$UNIT_DIR"
  for u in $UNITS_NEW; do
    cp "$WORK/$u.service" "$UNIT_DIR/$u.service"
    echo "Unit /etc/systemd/system/$u.service written"
  done

  # start (only what is new or changed), then check
  start() {
    if [ -n "$ROOT" ]; then echo "(test) enable and restart $1"; return 1; fi
    systemctl daemon-reload
    systemctl enable "$1" >/dev/null 2>&1 || true
    systemctl restart "$1" || { echo "$1 did not start: journalctl -u $1 -n 30 --no-pager"; return 1; }
  }
  changed() { case " $UNITS_NEW " in *" $1 "*) return 0 ;; esac; [ "$1" = rotel-bridge ] && [ -n "$CFG_ADD$CFG_SET" ]; }
  ask() {                         # ask url pattern: up to 10 tries, prints the last answer
    local r="" i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      r=$(curl -s --max-time 3 "$1" 2>/dev/null || true)
      case "$r" in *$2*) break ;; esac
      sleep 1
    done
    echo "$r"
  }
  if has tag; then
    chown -R volumio:volumio "$APP/tags" 2>/dev/null || true
    go=1; if changed tag-service; then start tag-service || go=0; fi
    if [ $go = 1 ] && [ -z "$ROOT" ]; then
      h=$(ask localhost:8766/health '"ok":true')
      case "$h" in *'"ok":true'*) echo "tag-service is running: $h" ;;
        *) echo "tag-service does not answer on port 8766: journalctl -u tag-service -n 30 --no-pager" ;; esac
    fi
  fi
  if has rotel; then
    go=1; if changed rotel-bridge; then start rotel-bridge || go=0; fi
    if [ $go = 1 ] && [ -z "$ROOT" ]; then
      s=$(ask localhost:8765/state '"connected":true')
      case "$s" in
        *'"connected":true'*) echo "rotel-bridge is running: connected to the amplifier" ;;
        "") echo "rotel-bridge does not answer on port 8765: journalctl -u rotel-bridge -n 30 --no-pager" ;;
        *)  echo "rotel-bridge is running but not connected to the amplifier (address right? network control on at the amp?)"
            echo "Details: journalctl -u rotel-bridge -n 30 --no-pager" ;;
      esac
    fi
  fi
  if [ -n "$CFG_ADD$CFG_SET" ]; then echo "Hard-reload the browser."; fi
  exit 0
fi

# ---------- download ----------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "$SOURCE" ]; then
  cp "$SOURCE" "$TMP/src.tar.gz"                 # tests only
else
  echo "Loading $REPO, branch $BRANCH …"
  curl -fsSL --max-time 120 -o "$TMP/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
    || die "download failed (does branch '$BRANCH' exist? network?)"
fi
mkdir "$TMP/src"
tar xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1 || die "archive not readable"
[ -f "$TMP/src/xplorio.html" ] || [ -f "$TMP/src/app.html" ] || die "xplorio.html is missing from the archive"
# version for the menu (web/version.json): branch, commit (in the header of GitHub archives) and its date (file timestamps)
commit=$(gzip -dc "$TMP/src.tar.gz" 2>/dev/null | head -c 2048 | grep -ao 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2 || true)
stamp=$(date -r "$TMP/src/xplorio.html" +%Y-%m-%d 2>/dev/null || true)
mkdir -p "$TMP/src/web"
printf '{"branch":"%s","commit":"%s","date":"%s"}\n' "$BRANCH" "$commit" "$stamp" > "$TMP/src/web/version.json"
# id for the browser cache (xplorio.html loads scripts and styles with ?v=<id>): checksum of the interface,
# so it changes exactly when something there changed
build=$(cd "$TMP/src" && find xplorio.html web -type f ! -name build.js ! -name version.json 2>/dev/null | LC_ALL=C sort | xargs cat 2>/dev/null | md5sum | cut -c1-12)
printf "window.XPLORIO_BUILD = '%s';\n" "$build" > "$TMP/src/web/build.js"

# ---------- compare ----------
CHANGED=""; NEW=""; n=0
cd "$TMP/src"
while IFS= read -r f; do
  f=${f#./}
  while IFS= read -r t; do
    [ -n "$t" ] || continue
    c=$(now_at "$t")
    if [ ! -e "$c" ]; then NEW="$NEW$f$TAB$t"$'\n'; n=$((n+1))
    elif ! cmp -s "$f" "$c"; then CHANGED="$CHANGED$f$TAB$t"$'\n'; n=$((n+1))
    fi
  done <<< "$(target "$f")"
done < <(find . -type f ! -name '*.pyc' | sort)
# display: repo path, with several interface folders followed by the folder
show() { while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  r=${t#$ROOT/volumio/http/}
  if [ "$r" != "$t" ] && [ "${WWWS#* }" != "$WWWS" ]; then echo "$f (${r%%/*})"; else echo "$f"; fi
done; }

UNITS=$(old_units)
if [ $n = 0 ] && [ -z "$UNITS" ] && [ $MOVE = 0 ]; then echo "Everything up to date ($BRANCH), nothing to do."; exit 0; fi
echo "Branch $BRANCH: $n file(s)"
[ -n "$CHANGED" ] && printf '%s' "$CHANGED" | show | sed 's/^/  changed: /'
[ -n "$NEW" ]     && printf '%s' "$NEW"     | show | sed 's/^/  new:     /'
[ $MOVE = 1 ] && echo "  move:    /data/web-app to /data/xplorio (with data and backups; /data/web-app stays as a symlink)"
for u in $UNITS; do echo "  service: switch $u to /data/xplorio"; done
[ $DRY = 1 ] && exit 0
if [ $YES = 0 ]; then
  read -r -p "Install? [y/N] " a
  case "$a" in y|Y|yes|Yes|j|J|ja|Ja) ;; *) echo "Cancelled."; exit 0 ;; esac
fi

# ---------- move ----------
if [ $MOVE = 1 ]; then
  mv "$OLD_APP" "$APP" && ln -s "$APP" "$OLD_APP"       # symlink: old paths (running service, older backups) keep working
  echo "Moved: /data/web-app -> /data/xplorio"
fi

# ---------- back up ----------
prepare_dirs
base="$STATE/backup-$(date +%Y%m%d-%H%M%S)"
ALL="$CHANGED$NEW"
RESTART=$ALL                                        # plus the switched services (to restart them, also on rollback)
for u in $UNITS; do case $u in tag-service) RESTART="${RESTART}tags/$u.service"$'\n' ;; *) RESTART="${RESTART}rotel/$u.service"$'\n' ;; esac; done
: > "$base.new"
printf '%s' "$RESTART" > "$base.paths"
list="$TMP/backup.txt"; : > "$list"
for u in $UNITS; do rel "$UNIT_DIR/$u.service" >> "$list"; done
while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  if [ -e "$t" ]; then rel "$t" >> "$list"; else echo "$t" >> "$base.new"; fi
done <<< "$ALL"
if [ -s "$list" ]; then tar czf "$base.tar.gz" -C "${ROOT:-/}" -T "$list"; else tar czf "$base.tar.gz" -T /dev/null; fi
prune_backups

# ---------- install ----------
while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  mkdir -p "$(dirname "$t")"
  case "$t" in
    */usr/local/bin/*) cp "$f" "$t.new" && chmod +x "$t.new" && mv "$t.new" "$t" ;;   # may be running right now: new file instead of overwriting
    *.sh)              cp "$f" "$t" && chmod +x "$t" ;;
    *)                 cp "$f" "$t" ;;                                               # existing file: owner and permissions stay
  esac
done <<< "$ALL"
for u in $UNITS; do
  sed -i 's|/data/INTERNAL/tags|/data/xplorio/tags|g; s|/data/INTERNAL/rotel|/data/xplorio/rotel|g; s|/data/web-app/|/data/xplorio/|g' "$UNIT_DIR/$u.service"
  case $u in tag-service) d=tags ;; *) d=rotel ;; esac
  echo "Service $u now runs from /data/xplorio/$d"
done
echo "Installed to /volumio/http/$(echo $WWWS | sed 's/ /, /g'). Backup: $(basename "$base") (undo with: sudo $PROG --rollback)"
restart_services "$RESTART"
echo "Hard-reload the browser."
