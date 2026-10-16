/* Menü hinter dem Zahnrad oben rechts: Werkzeuge, die nicht zur Suche gehören.
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; nach check.js, history.js, system.js, playback.js und volumio.js geladen (help.js danach, openHelp erst beim Tippen).
   Weitere Einträge: eine Zeile in MENU_ITEMS (needsTags: nur, wenn der Tag-Dienst läuft). */
var overlayMenu = document.getElementById('overlayMenu');
var menuBody    = document.getElementById('menuBody');
var menuTags    = false;          /* Tag-Dienst erreichbar */

var MENU_ITEMS = [
  {id: 'welcome', needsTags: true, title: T('menu.welcome'), sub: T('menu.welcomeSub'), open: function(){ openWelcome(false); },
   icon: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-1-6h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1l1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z'},
  {id: 'history', needsTags: true, title: T('menu.history'), sub: T('menu.historySub'), open: function(){ openHistory(); },
   icon: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9.1.1L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.25 2.52.77-1.28-3.52-2.09V8z'},
  {id: 'check', needsTags: true, title: T('menu.check'), sub: T('menu.checkSub'), open: function(){ openCheck(); },
   icon: 'M2 5h11v2H2zm0 4h11v2H2zm0 4h7v2H2zm15.3 1.3l-2.8-2.8-1.4 1.4 4.2 4.2 6.7-6.7-1.4-1.4z'},
  {id: 'update', needsTags: true, title: T('check.db.button'), action: true, open: function(){ libUpdStart(); },
   icon: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z'},
  {id: 'system', needsTags: true, title: T('menu.system'), sub: T('menu.systemSub'), open: function(){ openSystem(); },
   icon: 'M3 13h4l3-8 4 14 3-6h4v2h-2.8L14 22 10 9.4 8.4 15H3z'},
  {id: 'playback', needsTags: !ROTEL_ON, title: T('menu.playback'), sub: T('menu.playbackSub'), open: function(){ openPlayback(); },
   icon: 'M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06A9 9 0 0 0 14 3.23z'},
  {id: 'recognize', needsTags: true, show: recogShortcutOk, action: true, title: T('menu.recognize'), sub: T('menu.recognizeSub'), open: recogShortcutRun,
   icon: 'M7 18h2V6H7v12zm4 4h2V2h-2v20zm-8-8h2v-4H3v4zm12 4h2V6h-2v12zm4-8v4h2v-4h-2z'},
  {id: 'volumio', title: T('menu.volumio'), sub: T('menu.volumioSub'), open: function(){ openVolumio(); },
   icon: 'M3 4h4.2l4.8 11.3L16.8 4H21l-7 16h-4L3 4z'},
  {id: 'help', title: T('menu.help'), sub: T('menu.helpSub'), open: function(){ openHelp(); },
   icon: 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14a4 4 0 0 0-4 4h2a2 2 0 1 1 4 0c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5a4 4 0 0 0-4-4z'}
];
/* Titel erkennen: startet den Kurzbefehl (APP_CONFIG.RECOGNIZE_SHORTCUT), der per Shazam erkennt und an POST /recognized schickt.
   Nur auf Apple-Geräten (iPhone, iPad, Mac), dort gibt es die Kurzbefehle-App */
function recogShortcutName() { return String((window.APP_CONFIG && window.APP_CONFIG.RECOGNIZE_SHORTCUT) || '').trim(); }
function recogShortcutOk() {
  var ua = navigator.userAgent || '';
  return !!recogShortcutName() && /iPhone|iPad|iPod|Macintosh/.test(ua);
}
function recogShortcutRun() {
  var name = encodeURIComponent(recogShortcutName());
  /* im Browser danach zurück zu Xplorio; als Web-App auf dem Home-Bildschirm würde das einen Safari-Tab öffnen */
  location.href = navigator.standalone ? 'shortcuts://run-shortcut?name=' + name
    : 'shortcuts://x-callback-url/run-shortcut?name=' + name + '&x-success=' + encodeURIComponent(location.href);
}

var MENU_CHEVRON = 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z';

function menuSvg(d, cls) {
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (cls) svg.setAttribute('class', cls);
  p.setAttribute('d', d);
  svg.appendChild(p);
  return svg;
}

function menuRender() {
  while (menuBody.firstChild) menuBody.removeChild(menuBody.firstChild);
  var listEl = document.createElement('div'); listEl.className = 'menuList';
  menuBody.appendChild(listEl);
  MENU_ITEMS.forEach(function(it){
    if (it.needsTags && !menuTags) return;
    if (it.show && !it.show()) return;
    var row = document.createElement('div'); row.className = 'menuRow';
    var icon = document.createElement('div'); icon.className = 'menuIcon'; icon.appendChild(menuSvg(it.icon));
    var text = document.createElement('div'); text.className = 'menuText';
    var ti = document.createElement('div'); ti.className = 'menuTitle'; ti.textContent = it.title;
    var sub = document.createElement('div'); sub.className = 'menuSub'; sub.textContent = it.sub || '';
    text.appendChild(ti); text.appendChild(sub);
    row.appendChild(icon); row.appendChild(text);
    if (!it.action) row.appendChild(menuSvg(MENU_CHEVRON, 'menuChev'));
    row.addEventListener('click', function(){ if (!row.classList.contains('busy')) it.open(); });
    if (it.id === 'update') libUpdWatch('menu', function(st){ sub.textContent = libUpdText(st); row.classList.toggle('busy', st === 'running'); });
    listEl.appendChild(row);
  });
  menuBody.appendChild(menuAbout());
}

/* Unten im Menü: Logo, Name, Leitsatz; Stand (web/version.json, schreibt xplorio-deploy), Copyright, Lizenz */
var MENU_REPO = 'https://github.com/Celindir69/xplorio';
/* fremde Bestandteile und Dienste: Name, Text (i18n) */
var MENU_THIRD = [
  ['mutagen', 'about.3.mutagen'],
  ['Volumio, socket.io', 'about.3.volumio'],
  ['Essentia', 'about.3.essentia'],
  ['Last.fm, MusicBrainz, Cover Art Archive, Deezer, iTunes, LRCLIB, radio-browser.info', 'about.3.services']
];
var menuVersion = null;          /* einmal geladen: {branch, commit, date} oder {} */
function menuAbout() {
  var box = document.createElement('div'); box.className = 'menuAbout';
  var logo = document.createElement('img'); logo.className = 'menuLogo'; logo.src = 'web/icons/icon-180.png'; logo.alt = '';
  var name = document.createElement('div'); name.className = 'menuName'; name.textContent = 'Xplorio';
  var claim = document.createElement('div'); claim.className = 'menuClaim'; claim.textContent = T('about.claim');
  var ver = document.createElement('div'); ver.className = 'menuFine';
  var copy = document.createElement('div'); copy.className = 'menuFine'; copy.textContent = '© 2026 Celindir69';
  var lic = document.createElement('a'); lic.className = 'menuFine menuLink'; lic.href = MENU_REPO + '/blob/main/LICENSE';
  lic.target = '_blank'; lic.rel = 'noopener'; lic.textContent = T('about.license');
  var more = document.createElement('div'); more.className = 'menuFine menuLink'; more.textContent = T('about.thirdParty');
  var list = document.createElement('div'); list.className = 'menuThird';
  MENU_THIRD.forEach(function(x){
    var row = document.createElement('div');
    var b = document.createElement('b'); b.textContent = x[0];
    row.appendChild(b); row.appendChild(document.createTextNode(' · ' + T(x[1])));
    list.appendChild(row);
  });
  more.addEventListener('click', function(){
    box.classList.toggle('third');
    if (box.classList.contains('third')) list.scrollIntoView({behavior: 'smooth', block: 'end'});   /* klappt sonst unter dem Rand auf */
  });
  [logo, name, claim, ver, copy, lic, more, list].forEach(function(el){ box.appendChild(el); });
  function show(v) {
    var parts = [];
    if (v.date) parts.push(langDate(Date.parse(v.date + 'T12:00:00')));
    if (v.branch && v.branch !== 'main') parts.push(v.branch);
    if (v.commit) parts.push(v.commit.slice(0, 7));
    ver.textContent = parts.length ? T('about.version', {v: parts.join(' · ')}) : T('about.dev');
  }
  if (menuVersion) show(menuVersion);
  else fetch('web/version.json?t=' + Date.now()).then(function(r){ return r.ok ? r.json() : {}; })
    .catch(function(){ return {}; }).then(function(v){ menuVersion = v || {}; show(menuVersion); });
  return box;
}

function openMenu() {
  closeAllOverlays();
  menuRender();
  overlayMenu.classList.add('on');
}

document.getElementById('btnMenu').addEventListener('click', function(){
  if (overlayMenu.classList.contains('on')) closeAllOverlays(); else openMenu();
});
document.getElementById('closeMenu').addEventListener('click', closeAllOverlays);

/* Einträge mit Tag-Dienst nur, wenn er läuft */
whenTags(function(){ menuTags = true; if (overlayMenu.classList.contains('on')) menuRender(); });
