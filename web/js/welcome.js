/* Begrüßung: einmal beim Öffnen der Seite eine Karte in der Mitte mit Album des Tages, zuletzt gehörten und neuen Alben
   (Tag-Dienst GET /welcome). Nicht in der Bühnenansicht, nicht öfter als alle 30 Minuten; abschaltbar unten im Overlay,
   jederzeit über das Menü. Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; nach discover.js, genre.js und stage.js geladen. */
var overlayWelcome = document.getElementById('overlayWelcome');
var welcomeBody    = document.getElementById('welcomeBody');
var WELCOME_KEY = 'welcome';                 /* {off: true} abgeschaltet, {at: ms} zuletzt gezeigt */
var WELCOME_GAP_MS = 30 * 60000;             /* so lange nach dem letzten Mal nicht wieder von selbst */
var welcomeSeq = 0;

function welcomePref() { try { return JSON.parse(localStorage.getItem(WELCOME_KEY) || '{}') || {}; } catch (e) { return {}; } }
function welcomeSave(p) { try { localStorage.setItem(WELCOME_KEY, JSON.stringify(p)); } catch (e) { /* ohne Speicher */ } }

function welcomeGreeting() {
  var h = new Date().getHours();
  return T(h < 5 ? 'welcome.night' : h < 11 ? 'welcome.morning' : h < 17 ? 'welcome.day' : h < 23 ? 'welcome.evening' : 'welcome.night');
}

function welcomeAlbumOpen(it, art) {
  openBrowse({kind: 'album', artist: it.ar === 'Verschiedene' ? '' : it.ar, album: it.al, uri: 'music-library/' + it.dir, albumart: art});
}

/* Album des Tages: großes Cover, Titel (Jahr), Künstler, wann zuletzt gehört, ▶ und der Albumtext; Tipp öffnet das Album.
   Querformat: Angaben oben neben dem Cover, ▶ rechts daneben, darunter der Text bis zur Unterkante des Covers */
function welcomeDay(it) {
  var box = histEl('div', 'dRand wDay');
  var art = histAlbumArt(it.ar, it.al, it.dir);
  var img = histEl('img', 'dBig');
  img.src = artUrl(art);
  box.appendChild(img);
  var meta = histEl('div', 'dMeta');
  var ti = histEl('div', 'dTi', it.al);
  if (it.y) ti.appendChild(yearSpan(it.y));
  meta.appendChild(ti);
  meta.appendChild(histEl('div', 'dAr', histArtistName(it.ar)));
  meta.appendChild(histEl('div', 'dLast', it.last ? T('disc.last', {date: discoverDate(it.last)}) : T('disc.never')));
  box.appendChild(meta);
  var play = histEl('button', 'wPlay');
  play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg>';
  play.appendChild(document.createTextNode(T('welcome.play')));
  play.addEventListener('click', function(ev){
    ev.stopPropagation();
    browsePlay({uri: 'music-library/' + it.dir, service: 'mpd', type: 'folder', title: it.al, artist: it.ar});
  });
  box.appendChild(play);
  if (it.ar !== 'Verschiedene') {                    /* Albumtext wie im Info-Overlay (Volumio, sonst Last.fm); scrollt bei Bedarf */
    var info = histEl('div', 'wInfo');
    info.addEventListener('click', function(ev){ ev.stopPropagation(); });
    box.appendChild(info);
    ask({mode: 'storyAlbum', artist: it.ar, album: it.al}).then(function(res){
      if (res && res.kind === 'story' && res.value) info.textContent = res.value;
      else box.removeChild(info);
    }).catch(function(){ if (info.parentNode) box.removeChild(info); });
  }
  box.addEventListener('click', function(){ welcomeAlbumOpen(it, art); });
  return box;
}

/* Reihe mit Albenkacheln; sub(it): kleine Zeile darunter */
function welcomeRow(title, items, tile) {
  var sec = histEl('div', 'dSec');
  sec.appendChild(browseHeading(title));
  var row = histEl('div', 'dRow');
  items.forEach(function(it){ row.appendChild(tile(it)); });
  sec.appendChild(row);
  return sec;
}
function welcomeYear(tile, y) {
  if (y) tile.appendChild(histEl('div', 'dSub', String(y)));
  return tile;
}

function welcomeRender(r) {
  while (welcomeBody.firstChild) welcomeBody.removeChild(welcomeBody.firstChild);
  var box = histEl('div', 'dBox');
  if (r.day) {
    box.appendChild(browseHeading(T('welcome.dayAlbum')));
    box.appendChild(welcomeDay(r.day));
  }
  var bday = histEl('div', 'dSec');                 /* Geburtstage: heute und diese Woche, sonst dieser Monat */
  if (bdayRows(bday, r.birthdays, ['today', 'week']) || bdayRows(bday, r.birthdays, ['month'])) box.appendChild(bday);
  var tog = histEl('div', 'dSec');                  /* Passt zusammen (discover.js), lädt nach */
  box.appendChild(tog);
  togetherRow(tog, function(){ return welcomeBody.contains(tog); });
  var rows = [];
  if (r.recent.length) rows.push(welcomeRow(T('welcome.recent'), r.recent, function(it){ return welcomeYear(discoverTile('album', it), it.y); }));
  if (r.ago && r.ago.items.length) rows.push(welcomeRow(T('welcome.ago', {n: r.ago.years}), r.ago.items, function(it){ return welcomeYear(discoverTile('album', it), it.y); }));
  if (r.fresh.length) rows.push(welcomeRow(T('welcome.fresh'), r.fresh, function(it){ return welcomeYear(discoverShelfTile('album', 'never', it), it.y); }));
  rows.forEach(function(s){ box.appendChild(s); });
  var mix = histEl('div', 'wMix');
  var dice = histEl('div', 'dDice');
  dice.innerHTML = DICE_SVG;
  mix.appendChild(dice);
  mix.appendChild(histEl('span', '', T('welcome.mix')));
  mix.addEventListener('click', function(){ dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll'); randomMixPlay({shelf: 'random'}); });
  box.appendChild(mix);
  var pref = welcomePref(), sw = histEl('label', 'wAuto');
  var cb = document.createElement('input');
  cb.type = 'checkbox'; cb.checked = !pref.off;
  cb.addEventListener('change', function(){ var p = welcomePref(); p.off = !cb.checked; welcomeSave(p); });
  sw.appendChild(cb);
  sw.appendChild(document.createTextNode(T('welcome.auto')));
  box.appendChild(sw);
  welcomeBody.appendChild(box);
  Array.prototype.forEach.call(box.querySelectorAll('.dRow'), discoverFit);
}

/* auto: beim Laden der Seite; dann nur, wenn nichts anderes offen ist und es etwas zu zeigen gibt */
function openWelcome(auto) {
  var seq = ++welcomeSeq;
  document.getElementById('welcomeTitle').textContent = welcomeGreeting();
  document.getElementById('welcomeBack').style.display = auto ? 'none' : '';     /* aus dem Menü geöffnet */
  if (!auto) { closeAllOverlays(); welcomeBody.textContent = ''; welcomeBody.appendChild(browseNote(T('browse.loading'))); overlayWelcome.classList.add('on'); }
  tagGetJson('/welcome?day=' + discoverToday() + histTz()).then(function(r){
    if (seq !== welcomeSeq) return;
    if (!r || !r.ok || !(r.day || r.recent.length || r.fresh.length)) {
      if (!auto) { welcomeBody.textContent = ''; welcomeBody.appendChild(browseNote(T(r && r.building ? 'disc.building' : 'hist.offline'))); }
      return;
    }
    if (auto && document.querySelector('.overlay.on')) return;          /* schon woanders unterwegs */
    welcomeRender(r);
    if (auto) { var p = welcomePref(); p.at = Date.now(); welcomeSave(p); }
    overlayWelcome.classList.add('on');
  }).catch(function(){ if (!auto && seq === welcomeSeq) { welcomeBody.textContent = ''; welcomeBody.appendChild(browseNote(T('hist.offline'))); } });
}

document.getElementById('closeWelcome').addEventListener('click', closeAllOverlays);
document.getElementById('welcomeBack').addEventListener('click', function(){ openMenu(); });
overlayWelcome.addEventListener('click', function(ev){ if (ev.target === overlayWelcome) closeAllOverlays(); });   /* Tipp auf den Rand */

(function(){
  var p = welcomePref();
  if (p.off || stageOn || Date.now() - (p.at || 0) < WELCOME_GAP_MS || /[?&]welcome=0\b/.test(location.search)) return;
  var loaded = Date.now();
  whenTags(function(){ if (Date.now() - loaded < 120000 && !stageOn) openWelcome(true); });   /* später nicht mehr überraschend aufgehen */
})();
