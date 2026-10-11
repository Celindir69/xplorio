#!/bin/bash
# xplorio-deploy: Oberfläche und Dienste von Xplorio direkt auf dem Player aktualisieren, aus dem öffentlichen Repo xplorio.
#
#   sudo xplorio-deploy                    main laden, Änderungen zeigen, nach Rückfrage einspielen
#   sudo xplorio-deploy claude/mein-branch einen bestimmten Branch
#   sudo xplorio-deploy -n [branch]        nur zeigen, was sich ändern würde
#   sudo xplorio-deploy -y [branch]        ohne Rückfrage
#   sudo xplorio-deploy --rollback         letzte Sicherung wiederherstellen (alt: --zurueck)
#   sudo xplorio-deploy --passwort         Passwort für die Dienste auf der Seite „System“ festlegen oder ändern
#
# Die Oberfläche (xplorio.html, app.html als Weiterleitung, kioskTV.html, web/, tools/) kommt in jeden vorhandenen Ordner /volumio/http/www*/: Welchen Volumio
# ausliefert, hängt von Version und gewählter Oberfläche ab (Volumio 3: www3, Volumio 4: www4). Neue Ordner legt das
# Skript nicht an; gibt es keinen, bricht es ab.
# Alles Übrige liegt in /data/xplorio (bleibt bei Volumio-Updates erhalten; zum Sichern genügt dieser Ordner):
#   tags/  Tag-Dienst   rotel/  Rotel-Bridge   data/  Daten des Tag-Dienstes   backup/  Sicherungen dieses Skripts
# Frühere Installationen hatten alles unter /data/web-app (davor die Dienste unter /data/INTERNAL): Das Skript zieht
# /data/web-app samt Daten und Sicherungen nach /data/xplorio um, lässt dort einen Verweis (Symlink) zurück und stellt
# die systemd-Dateien der Dienste auf die neuen Pfade um (von /data/INTERNAL zieht der Tag-Dienst seine Daten selbst um).
# Vor jedem Einspielen werden die betroffenen Dateien unter /data/xplorio/backup gesichert (die letzten 5 bleiben).
# Eigene Dateien wie web/config.local.js stehen nicht im Repo und bleiben unberührt; gelöscht wird nichts.
# Einrichten:  curl -fsSL https://raw.githubusercontent.com/Celindir69/xplorio/main/tools/xplorio-deploy.sh | sudo tee /usr/local/bin/xplorio-deploy >/dev/null && sudo chmod +x /usr/local/bin/xplorio-deploy
# Die früheren Namen web-app-deploy, mx-deploy und volumio4-deploy rufen dieses Skript auf (tools/web-app-deploy.sh, tools/mx-deploy.sh).
set -e

REPO=${DEPLOY_REPO:-${MX_REPO:-Celindir69/xplorio}}
ROOT=${DEPLOY_ROOT:-${MX_ROOT:-}}                   # nur für Tests: alles unter diesem Ordner statt unter /
SOURCE=${DEPLOY_SOURCE:-${MX_SOURCE:-}}             # nur für Tests: Archiv statt Download
PROG=xplorio-deploy
WWWS=${DEPLOY_WWW:-${MX_WWW:-}}                     # Ordner der Oberfläche unter /volumio/http/ (Vorgabe: alle vorhandenen www*)
if [ -z "$WWWS" ]; then
  for d in "$ROOT"/volumio/http/www*/; do
    [ -d "$d" ] && WWWS="$WWWS $(basename "$d")"
  done
  WWWS=${WWWS# }
fi
APP=$ROOT/data/xplorio
OLD_APP=$ROOT/data/web-app                          # früherer Ordner (bis zum Umzug)
STATE=$APP/backup
OLD_STATES="$OLD_APP/backup $ROOT/data/INTERNAL/mx-deploy $ROOT/data/INTERNAL/volumio4-deploy"   # Sicherungen vor dem Umzug bzw. der früheren Namen
KEEP=5

# Ziele je Datei im Repo, eins je Zeile (leer = nicht auf den Player)
target() {
  case "$1" in
    tags/*)                  echo "$APP/$1" ;;
    rotel/rotel-bridge.js)   echo "$APP/$1" ;;
    tools/xplorio-deploy.sh) echo "$ROOT/usr/local/bin/$PROG"; for w in $WWWS; do echo "$ROOT/volumio/http/$w/$1"; done ;;   # auch für die Verweise
    tools/web-app-deploy.sh) [ -e "$ROOT/usr/local/bin/web-app-deploy" ] && echo "$ROOT/usr/local/bin/web-app-deploy"; true ;;   # nur vorhandene alte Namen
    tools/mx-deploy.sh)      for p in mx-deploy volumio4-deploy; do [ -e "$ROOT/usr/local/bin/$p" ] && echo "$ROOT/usr/local/bin/$p"; done; true ;;
    xplorio.html|app.html|kioskTV.html|web/*|tools/*)  for w in $WWWS; do echo "$ROOT/volumio/http/$w/$1"; done ;;
  esac
}
TAB=$'\t'                                           # Einträge der Listen: Repo-Pfad TAB Ziel

die() { echo "$PROG: $*" >&2; exit 1; }
[ -n "$ROOT" ] || [ "$(id -u)" = 0 ] || die "bitte mit sudo aufrufen"

# systemd-Dateien der Dienste, die noch auf /data/INTERNAL oder /data/web-app zeigen
UNIT_DIR=$ROOT/etc/systemd/system
old_units() { for u in tag-service rotel-bridge; do
  grep -qs '/data/INTERNAL/\(tags\|rotel\)\|/data/web-app/' "$UNIT_DIR/$u.service" && echo "$u"; done; true; }

# Umzug /data/web-app -> /data/xplorio nötig? (alter Ordner da, kein Verweis, neuer Ordner noch nicht)
MOVE=0
[ -d "$OLD_APP" ] && [ ! -L "$OLD_APP" ] && [ ! -e "$APP" ] && MOVE=1
# Datei, die heute an der Stelle eines Ziels liegt (vor dem Umzug noch im alten Ordner)
now_at() { if [ $MOVE = 1 ] && [ "${1#$APP/}" != "$1" ]; then echo "$OLD_APP/${1#$APP/}"; else echo "$1"; fi; }

# Ordner unter /data/xplorio; data/ nur für den Dienst (volumio) lesbar
prepare_dirs() {
  mkdir -p "$APP" "$STATE"; chmod 700 "$STATE"
  [ -d "$APP/data" ] || { mkdir -m 700 "$APP/data" && echo "Datenordner $APP/data angelegt"; }
  [ -n "$ROOT" ] || chown volumio:volumio "$APP/data" 2>/dev/null || true
}

restart_services() {               # $1: Liste geänderter Repo-Pfade (Dienste als tags/… bzw. rotel/…)
  [ -n "$ROOT" ] && { echo "$1" | grep -q '^tags/' && echo "(Test) tag-service neu starten"; echo "$1" | grep -q '^rotel/' && echo "(Test) rotel-bridge neu starten"; return 0; }
  systemctl daemon-reload 2>/dev/null || true
  if echo "$1" | grep -q '^tags/'; then
    chown -R volumio:volumio "$APP/tags" 2>/dev/null || true
    systemctl restart tag-service 2>/dev/null && echo "tag-service neu gestartet" || echo "Hinweis: tag-service nicht neu gestartet (eingerichtet?)"
  fi
  if echo "$1" | grep -q '^rotel/'; then
    systemctl restart rotel-bridge 2>/dev/null && echo "rotel-bridge neu gestartet" || echo "Hinweis: rotel-bridge nicht neu gestartet (eingerichtet?)"
  fi
}

# ---------- Passwort für die Dienste (Seite „System“): nur ein Hash in data/admin.json ----------
if [ "$1" = "--passwort" ] || [ "$1" = "--password" ]; then
  [ -f "$APP/tags/adminpass.js" ] || die "$APP/tags/adminpass.js fehlt: erst den Tag-Dienst einspielen (sudo $PROG)"
  prepare_dirs
  NODE=${DEPLOY_NODE:-$(command -v node || echo /usr/bin/node)}
  "$NODE" "$APP/tags/adminpass.js" "$APP/data" || exit 1
  [ -n "$ROOT" ] || chown volumio:volumio "$APP/data/admin.json" 2>/dev/null || true
  exit 0
fi

# ---------- Wiederherstellen ----------
if [ "$1" = "--rollback" ] || [ "$1" = "--zurueck" ] || [ "$1" = "--zurück" ]; then
  last=$(for d in "$STATE" $OLD_STATES; do ls -1 "$d"/backup-*.tar.gz 2>/dev/null; done \
    | while IFS= read -r b; do printf '%s\t%s\n' "$(basename "$b")" "$b"; done | sort | tail -n 1 | cut -f2)
  [ -n "$last" ] || die "keine Sicherung vorhanden"
  base=${last%.tar.gz}
  echo "Stelle wieder her: $(basename "$base")"
  tar xzf "$last" -C "${ROOT:-/}"
  if [ -s "$base.neu" ]; then while IFS= read -r f; do rm -f "$f"; done < "$base.neu"; fi
  restart_services "$(cat "$base.pfade" 2>/dev/null)"
  rm -f "$last" "$base.neu" "$base.pfade"            # die nächste Wiederherstellung nimmt die vorige Sicherung
  echo "Fertig. Im Browser hart neu laden."
  exit 0
fi

[ -n "$WWWS" ] || die "kein Ordner /volumio/http/www* gefunden (Volumio installiert?); mit DEPLOY_WWW=<ordner> einen bestimmten wählen"

DRY=0; YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    -n) DRY=1 ;;
    -y) YES=1 ;;
    -*) die "unbekannte Option $1" ;;
    *)  BRANCH=$1 ;;
  esac
  shift
done
BRANCH=${BRANCH:-main}

# ---------- Laden ----------
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "$SOURCE" ]; then
  cp "$SOURCE" "$TMP/src.tar.gz"                 # nur für Tests
else
  echo "Lade $REPO, Branch $BRANCH …"
  curl -fsSL --max-time 120 -o "$TMP/src.tar.gz" "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" \
    || die "Laden fehlgeschlagen (Branch '$BRANCH' vorhanden? Netz?)"
fi
mkdir "$TMP/src"
tar xzf "$TMP/src.tar.gz" -C "$TMP/src" --strip-components=1 || die "Archiv nicht lesbar"
[ -f "$TMP/src/xplorio.html" ] || [ -f "$TMP/src/app.html" ] || die "im Archiv fehlt xplorio.html"
# Stand fürs Menü (web/version.json): Branch, Commit (steht bei GitHub-Archiven im Kopf) und dessen Datum (Zeitstempel der Dateien)
commit=$(gzip -dc "$TMP/src.tar.gz" 2>/dev/null | head -c 2048 | grep -ao 'comment=[0-9a-f]\{40\}' | head -n 1 | cut -d= -f2 || true)
stamp=$(date -r "$TMP/src/xplorio.html" +%Y-%m-%d 2>/dev/null || true)
mkdir -p "$TMP/src/web"
printf '{"branch":"%s","commit":"%s","date":"%s"}\n' "$BRANCH" "$commit" "$stamp" > "$TMP/src/web/version.json"
# Kennung für den Browser-Cache (xplorio.html lädt Skripte und Styles mit ?v=<Kennung>): Prüfsumme der Oberfläche,
# ändert sich also genau dann, wenn sich dort etwas geändert hat
build=$(cd "$TMP/src" && find xplorio.html web -type f ! -name build.js ! -name version.json 2>/dev/null | LC_ALL=C sort | xargs cat 2>/dev/null | md5sum | cut -c1-12)
printf "window.XPLORIO_BUILD = '%s';\n" "$build" > "$TMP/src/web/build.js"

# ---------- Vergleichen ----------
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
# Anzeige: Repo-Pfad, bei mehreren Oberflächen-Ordnern mit dem Ordner dahinter
show() { while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  r=${t#$ROOT/volumio/http/}
  if [ "$r" != "$t" ] && [ "${WWWS#* }" != "$WWWS" ]; then echo "$f (${r%%/*})"; else echo "$f"; fi
done; }

UNITS=$(old_units)
if [ $n = 0 ] && [ -z "$UNITS" ] && [ $MOVE = 0 ]; then echo "Alles aktuell ($BRANCH), nichts zu tun."; exit 0; fi
echo "Branch $BRANCH: $n Datei(en)"
[ -n "$CHANGED" ] && printf '%s' "$CHANGED" | show | sed 's/^/  geändert: /'
[ -n "$NEW" ]     && printf '%s' "$NEW"     | show | sed 's/^/  neu:      /'
[ $MOVE = 1 ] && echo "  Umzug:    /data/web-app nach /data/xplorio (mit Daten und Sicherungen; /data/web-app bleibt als Verweis)"
for u in $UNITS; do echo "  Dienst:   $u auf /data/xplorio umstellen"; done
[ $DRY = 1 ] && exit 0
if [ $YES = 0 ]; then
  read -r -p "Einspielen? [j/N] " a
  case "$a" in j|J|ja|Ja|y|Y) ;; *) echo "Abgebrochen."; exit 0 ;; esac
fi

# ---------- Umziehen ----------
if [ $MOVE = 1 ]; then
  mv "$OLD_APP" "$APP" && ln -s "$APP" "$OLD_APP"       # Verweis: alte Pfade (laufender Dienst, ältere Sicherungen) gehen weiter
  echo "Umgezogen: /data/web-app -> /data/xplorio"
fi

# ---------- Sichern ----------
prepare_dirs
base="$STATE/backup-$(date +%Y%m%d-%H%M%S)"
ALL="$CHANGED$NEW"
RESTART=$ALL                                        # dazu die umgestellten Dienste (zum Neustart, auch beim Zurückholen)
for u in $UNITS; do case $u in tag-service) RESTART="${RESTART}tags/$u.service"$'\n' ;; *) RESTART="${RESTART}rotel/$u.service"$'\n' ;; esac; done
: > "$base.neu"
printf '%s' "$RESTART" > "$base.pfade"
list="$TMP/sicherung.txt"; : > "$list"
for u in $UNITS; do echo "${UNIT_DIR#${ROOT:-/}}/$u.service" | sed 's|^/||' >> "$list"; done
while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  if [ -e "$t" ]; then echo "${t#${ROOT:-/}}" | sed 's|^/||' >> "$list"; else echo "$t" >> "$base.neu"; fi
done <<< "$ALL"
if [ -s "$list" ]; then tar czf "$base.tar.gz" -C "${ROOT:-/}" -T "$list"; else tar czf "$base.tar.gz" -T /dev/null; fi
ls -1 "$STATE"/backup-*.tar.gz | sort | head -n -$KEEP | while IFS= read -r old; do rm -f "$old" "${old%.tar.gz}.neu" "${old%.tar.gz}.pfade"; done

# ---------- Einspielen ----------
while IFS="$TAB" read -r f t; do
  [ -n "$f" ] || continue
  mkdir -p "$(dirname "$t")"
  case "$t" in
    */usr/local/bin/*) cp "$f" "$t.neu" && chmod +x "$t.neu" && mv "$t.neu" "$t" ;;   # läuft evtl. gerade: neue Datei statt überschreiben
    *.sh)              cp "$f" "$t" && chmod +x "$t" ;;
    *)                 cp "$f" "$t" ;;                                               # vorhandene Datei: Besitzer und Rechte bleiben
  esac
done <<< "$ALL"
for u in $UNITS; do
  sed -i 's|/data/INTERNAL/tags|/data/xplorio/tags|g; s|/data/INTERNAL/rotel|/data/xplorio/rotel|g; s|/data/web-app/|/data/xplorio/|g' "$UNIT_DIR/$u.service"
  case $u in tag-service) d=tags ;; *) d=rotel ;; esac
  echo "Dienst $u läuft jetzt aus /data/xplorio/$d"
done
echo "Eingespielt nach /volumio/http/$(echo $WWWS | sed 's/ /, /g'). Sicherung: $(basename "$base") (zurück mit: sudo $PROG --rollback)"
restart_services "$RESTART"
echo "Im Browser hart neu laden."
