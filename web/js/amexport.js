/* Hidden: hand music to Apple Music on iOS via the shortcut "Xplorio-Mix". Not in the docs.
   1. Queue export: a button in the queue's header, switched on per device with ?amexport=1 (off with ?amexport=0) or for
      all devices with window.APP_CONFIG.AM_EXPORT = true in /data/xplorio/config.local.js; from the current track on.
   2. "Apple Music" mode, only while the page is open with ?amexport=play (not remembered): whatever is played in Xplorio
      (album, artist, track, mixes, dice, history, …: queueForInput in core.js) goes to Apple Music instead of the player,
      "add to queue" is appended there; the player at home stays untouched, its controls are greyed out (amPlay class).
   The tag service finds the tracks in Apple Music (POST /applemusic: iTunes search, albums and folders through MPD,
   at most 50; no match: dropped). The shortcut gets a first line "play" (replace Apple Music's queue) or "add"
   (append), then one line "artist title" per track (search term in Apple's spelling).
   Classic script, shared global scope; load order see xplorio.html. */
var AM_KEY = 'xplorioAmExport', AM_MAX = 50, AM_SHORTCUT = 'Xplorio-Mix';
var AM_SVG = '<svg viewBox="0 0 24 24"><path d="M4.2 18a2.9 2.3 0 1 1 5.8 0a2.9 2.3 0 1 1-5.8 0zM8.6 8.4h1.4V18H8.6zM14.2 15.6a2.9 2.3 0 1 1 5.8 0a2.9 2.3 0 1 1-5.8 0zM18.6 5.8h1.4v9.8h-1.4zM8.6 7.6L20 5v2.8L8.6 10.4z"/></svg>';   /* two beamed eighth notes, drawn for Xplorio */
var AM_PLAY = /[?&]amexport=play\b/.test(location.search);
var amBusy = false;

function amPlayMode() { return AM_PLAY && typeof TAGS !== 'undefined'; }

/* panel at the bottom, like the toast but staying: "searching …" until the tag service answers, then the result with
   Cancel / OK; only OK hands the tracks to the shortcut (a tap, so iOS also allows switching apps) */
var amSheet = null;
function amSheetShow(text, onOk) {
  if (!amSheet) {
    amSheet = document.createElement('div'); amSheet.id = 'amSheet';
    amSheet.innerHTML = '<div class="amSheetText"></div><div class="amSheetBtns"></div>';
    document.body.appendChild(amSheet);
  }
  amSheet.querySelector('.amSheetText').textContent = text;
  var btns = amSheet.querySelector('.amSheetBtns');
  while (btns.firstChild) btns.removeChild(btns.firstChild);
  amSheet.classList.toggle('busy', onOk === undefined);
  function button(label, cls, fn) {
    var b = document.createElement('button'); b.className = 'amSheetBtn ' + cls; b.textContent = label;
    b.addEventListener('click', function(ev){ ev.stopPropagation(); amSheetHide(); if (fn) fn(); });
    btns.appendChild(b);
  }
  if (onOk === null) button(T('amexport.close'), 'ok');             /* nothing found: only close */
  else if (onOk) { button(T('amexport.cancel'), 'cancel'); button(T('amexport.ok'), 'ok', onOk); }
  amSheet.classList.add('on');
}
function amSheetHide() { if (amSheet) amSheet.classList.remove('on'); }

/* body: {tracks} or {items}; add: append in Apple Music instead of replacing */
function amSend(body, add, done) {
  if (amBusy) return;
  amBusy = true;
  amSheetShow(T('amexport.searching'));
  tagPost('/applemusic', body).then(function(r){
    amBusy = false; if (done) done();
    var list = (r && r.tracks) || [];
    if (!list.length) return amSheetShow(T('amexport.none'), null);
    var text = [add ? 'add' : 'play'].concat(list.map(function(t){ return t.artist + ' ' + t.title; })).join('\n');
    amSheetShow(T('amexport.found', {n: list.length, of: r.of || list.length}) + (add ? ' · ' + T('amexport.toAdd') : ''), function(){
      location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(AM_SHORTCUT) + '&input=text&text=' + encodeURIComponent(text);
    });
  }).catch(function(){ amBusy = false; if (done) done(); amSheetShow(T('amexport.none'), null); });
}

/* "Apple Music" mode: Xplorio items to Apple Music; true = handled (core.js queueForInput, add paths) */
function amPlayItems(items, add) {
  if (!amPlayMode()) return false;
  if (typeof closeAllOverlays === 'function') closeAllOverlays();
  amSend({items: (items || []).map(function(it){
    return {uri: it.uri, service: it.service, type: it.type, artist: it.artist || '', title: it.title || it.name || '', album: it.album || ''};
  })}, !!add);
  return true;
}

(function(){
  if (AM_PLAY) {
    document.documentElement.classList.add('amPlay');
    var chip = document.createElement('div');
    chip.id = 'amChip'; chip.innerHTML = AM_SVG + '<span>Apple Music</span>';
    chip.title = T('amexport.mode');
    chip.addEventListener('click', function(){ showToast(T('amexport.mode')); });
    document.body.appendChild(chip);
  }
  var m = /[?&]amexport=([01])\b/.exec(location.search), on = false;
  try {
    if (m) { if (m[1] === '1') localStorage.setItem(AM_KEY, '1'); else localStorage.removeItem(AM_KEY); }
    on = localStorage.getItem(AM_KEY) === '1';
  } catch (e) { on = false; }
  if (!on && !AM_PLAY && !(window.APP_CONFIG && window.APP_CONFIG.AM_EXPORT === true)) return;
  if (typeof TAGS === 'undefined') return;
  var head = document.querySelector('#overlayQueue .overlayHead'), close = document.getElementById('closeQueue');
  if (!head) return;
  var btn = document.createElement('div');
  btn.className = 'overlayClose amExport'; btn.title = 'Apple Music'; btn.innerHTML = AM_SVG;
  head.insertBefore(btn, close || null);
  btn.addEventListener('click', function(){
    if (amBusy) return;
    var from = Math.max(0, typeof curPos === 'number' ? curPos : 0);
    var tracks = (queueData || []).slice(from, from + AM_MAX).map(function(t){
      return {artist: t.artist || '', title: t.name || t.title || '', album: t.album || ''};
    }).filter(function(t){ return t.artist && t.title; });
    if (!tracks.length) return showToast(T('amexport.empty'));
    btn.classList.add('busy');
    amSend({tracks: tracks}, false, function(){ btn.classList.remove('busy'); });
  });
})();
