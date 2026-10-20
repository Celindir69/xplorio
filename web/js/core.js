/* Basics: elements, state, time display, requests (plugin, discography, Last.fm)
   Classic script, shared global scope; see xplorio.html for load order. */
/* Images that fail to load (missing cover, server gone) stay empty instead of showing the question-mark icon.
   error/load do not bubble, so listen in the capture phase on the document; the space in the row is kept. */
function imgCheck(img) {
  if (img.complete && img.getAttribute('src') && !img.naturalWidth) img.classList.add('imgFail');
}
document.addEventListener('error', function(e){
  var t = e.target;
  if (t && t.tagName === 'IMG') t.classList.add('imgFail');
}, true);
document.addEventListener('load', function(e){
  var t = e.target;
  if (t && t.tagName === 'IMG') t.classList.remove('imgFail');
}, true);
/* errors that occurred before insertion into the document are handled on insertion */
if (window.MutationObserver) new MutationObserver(function(muts){
  muts.forEach(function(m){
    for (var i = 0; i < m.addedNodes.length; i++) {
      var n = m.addedNodes[i];
      if (n.nodeType !== 1) continue;
      if (n.tagName === 'IMG') imgCheck(n);
      else if (n.getElementsByTagName) Array.prototype.forEach.call(n.getElementsByTagName('img'), imgCheck);
    }
  });
}).observe(document.documentElement, {childList: true, subtree: true});

/* alias for lyrics functions */
var body = document.getElementById('lyricsText');
var area = document.getElementById('overlayLyrics').querySelector('.overlayBody');

var socket = io();
socket.on('connect', function(){ console.log('Socket connected'); socket.emit('getUiSettings'); });
/* Language of the Volumio UI: the app adopts it (i18n.js) unless ?lang= or LANGUAGE say otherwise.
   Volumio delivers info texts only in this language; if LANG differs, ask() fetches the texts itself first (infotext.js). */
var volumioLang = langStored().slice(0, 2);
socket.on('pushUiSettings', function(s){
  if (!s || !s.language) return;
  volumioLang = String(s.language).slice(0, 2).toLowerCase();
  if (typeof langFromVolumio === 'function') langFromVolumio(s.language);
});
/* Volumio reports playback errors as a toast (MPD: "Failed to open "alsa"…", "No such device" or Volumio's
   text for it): output device off or busy -> own short notice */
/* Playing while the amplifier is on another input: only fill the queue (items from track 1).
   Starting into the void would keep Volumio's clock running and skip through the tracks. Play on the player input then
   starts the first track (ui.js). true: done, otherwise play as usual */
var queuedForInput = false;
function queueForInput(items) {
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;
  if (!inp) { queuedForInput = false; return false; }
  if (!items || !items.length) return true;
  queuedForInput = true;
  socket.emit('clearQueue');
  setTimeout(function(){ socket.emit('addToQueue', items); }, 300);
  showToast(T('play.queuedInput', {name: inp.name}));
  if (typeof closeAllOverlays === 'function') closeAllOverlays();
  return true;
}
function audioErrorText(m) {
  var s = String((m && m.message) || '');
  if (!m || m.type !== 'error') return '';
  if (/resource busy|device is busy/i.test(s)) return T('audio.busy');
  if (/failed to open|alsa|no such device|output device/i.test(s)) {
    var inp = typeof rotelInput === 'function' ? rotelInput() : null;   /* amplifier on another input: say so */
    return inp ? T('audio.otherInput', {name: inp.name}) : T('audio.unreachable');
  }
  return '';
}
/* Output device disconnected: Volumio opens a confirmation dialog for it (openModal, title "Kein Audio-Gerät
   verfügbar" or "Das Audiogerät ist nicht verfügbar"; Volumio's texts in German, English, French, Spanish
   and Italian); here just a short notice. Back again: Volumio reports this only for the USB DAC ("USB DAC verbunden")
   and then closes its dialogs. */
var AUDIO_GONE_TITLES = new RegExp('^(' + [
  'kein audio-gerät verfügbar', 'das audiogerät ist nicht verfügbar',
  'no audio output available', 'the selected output device is not available',
  'pas de sortie audio disponible', 'la sortie audio choisie n.est pas disponible',
  'no hay salida de audio disponible', 'el dispositivo de salida seleccionado no está disponible',
  'nessuna uscita audio disponibile', 'l.uscita audio selezionata non è disponibile'].join('|') + ')$', 'i');
var AUDIO_BACK_TITLES = /^(usb dac (verbunden|connected)|(dac )?usb dac connecté|dac usb (conectado|connesso))$/i;
var audioGone = false;
function audioToast(key) { if (typeof showToast === 'function') showToast(T(key)); }
socket.on('pushToastMessage', function(m){
  if (m && m.type === 'success' && AUDIO_BACK_TITLES.test(String(m.title || '').trim())) { audioGone = false; return audioToast('audio.connected'); }
  var t = audioErrorText(m);
  if (t && typeof showToast === 'function') showToast(t);
});
socket.on('openModal', function(m){
  if (!m || !AUDIO_GONE_TITLES.test(String(m.title || '').trim())) return;
  audioGone = true;
  audioToast('audio.disconnected');
});
socket.on('closeAllModals', function(){
  if (audioGone) { audioGone = false; audioToast('audio.connected'); }
});
socket.on('pushState', function(st){
  if (typeof showVolumio === 'function') showVolumio(st);
  if (typeof st.random === 'boolean') { stRandom = st.random; updateCtrlUI(); }
  if (typeof st.repeat === 'boolean') {
    stRepeatMode = st.repeatSingle ? 'one' : (st.repeat ? 'all' : 'off');
    updateCtrlUI();
  }
});

/* Streaming services (streaming.js): enabled according to APP_CONFIG.TIDAL / QOBUZ, 'auto' by Volumio's sources.
   Until the answer arrives, only TIDAL is assumed present (so nothing hangs while loading). */
var appCfg = window.APP_CONFIG || {};
var tidalOn = false;                                   /* shorthand for places that concern TIDAL only */
function streamCap(s) { return s.id.charAt(0).toUpperCase() + s.id.slice(1); }
function streamsApply() {
  var root = document.documentElement;
  STREAMS.forEach(function(s){
    root.classList.toggle('no' + streamCap(s), !s.on);         /* hides the service's checkbox in the search */
    var box = document.getElementById('src' + streamCap(s));
    if (box) box.checked = s.show;
  });
  root.classList.toggle('noStream', !streamsOn().length);
  root.classList.toggle('manyStreams', streamsOn().length > 2);
  tidalOn = streamById('tidal').on;
  if (!streamsOn().length && typeof searchShowLocal !== 'undefined') {
    searchShowLocal = true;
    document.getElementById('srcLocal').checked = true;
  }
}
streamConfigure(appCfg, null);
if (streamNeedsSources(appCfg)) {
  socket.on('pushBrowseSources', function(list){ streamConfigure(appCfg, list || []); streamsApply(); });
  socket.emit('getBrowseSources');
}
streamsApply();

function fmtTime(s) {
  s = Math.floor(s || 0);
  var m = Math.floor(s / 60); s = s % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}

var bg       = document.getElementById('bg');
var cover    = document.getElementById('cover');
/* non-square covers (e.g. a landscape photo): class on the frame so the image fits the square */
cover.addEventListener('load', function(){
  var r = cover.naturalHeight ? cover.naturalWidth / cover.naturalHeight : 1, w = cover.parentNode;
  w.classList.toggle('arWide', r > 1.03);
  w.classList.toggle('arTall', r < 0.97);
});
var mTitle   = document.getElementById('mTitle');
var mArtist  = document.getElementById('mArtist');
var mAlbum   = document.getElementById('mAlbum');
var mTech    = document.getElementById('mTech');
var mBadge   = document.getElementById('mBadge');
var seekFill = document.getElementById('seekFill');
var tElapsed = document.getElementById('tElapsed');
var tRemain  = document.getElementById('tRemain');
var playIcon = document.getElementById('playIcon');

var lyricsText       = document.getElementById('lyricsText');
var infoContent      = document.getElementById('infoContent');
var infoTabs         = document.getElementById('infoTabs');
var infoOverlayTitle = document.getElementById('infoOverlayTitle');
var infoOverlayBody  = document.getElementById('infoOverlayBody');

var overlayLyrics    = document.getElementById('overlayLyrics');
var overlayInfo      = document.getElementById('overlayInfo');
var overlayQueue     = document.getElementById('overlayQueue');
var overlayPlaylists = document.getElementById('overlayPlaylists');
var overlaySearch    = document.getElementById('overlaySearch');

var queueList        = document.getElementById('queueList');

var btnLyrics    = document.getElementById('btnLyrics');
var btnInfo      = document.getElementById('btnInfo');
var btnQueue     = document.getElementById('btnQueue');
var btnPlaylists = document.getElementById('btnPlaylists');
var btnSearch    = document.getElementById('btnSearch');

var cRepeat      = document.getElementById('cRepeat');
var cRandom      = document.getElementById('cRandom');
var repeatBadge  = cRepeat.querySelector('.badge');

var playlistResults = document.getElementById('playlistResults');
var radioPanel      = document.getElementById('radioPanel');
var searchInput     = document.getElementById('searchInput');
var searchResults   = document.getElementById('searchResults');

var radioArtist = '';          /* artist from the stream title (web radio only) */
var curRadio    = false;       /* is a web radio playing? */
var curStream   = null;        /* streaming service of the current track (streaming.js), otherwise null */
var lastKey     = '';
var lastLyrKey  = '';
var lastArt     = '';
var lyricLines  = [];
var infoItems   = [];
var infoIdx     = 0;
var curDur      = 0;
var curAlbum    = '';
var curArtist = '';
var curPos      = -1;
var curUri      = '';        /* file or uri and title of the current track (More like this track, browse.js) */
var curTitle    = '';
var curAlbumTitle = '', curAlbumUri = '';   /* album in now playing without "(year)" (genre.js) */
var queueData   = [];
var stRandom    = false;
var stRepeatMode= 'off';
var drag        = null;
var swipe       = null;
var plTabActive = 1;

var searchData  = streamEmptySearch();
var searchCat   = 'artists';
var searchQuery = '';

var LASTFM_KEY = (window.APP_CONFIG && window.APP_CONFIG.LASTFM_KEY) || '';   /* only a fallback when the tag service is missing */

/* The UI's Last.fm requests go through the tag service (GET /lastfmapi): the key stays on the player.
   Without the tag service (or without a key there) directly with LASTFM_KEY from config.local.js, if present.
   -> Promise {key, fetch}; empty key = no Last.fm requests */
var LFM_API = 'https://ws.audioscrobbler.com/2.0/';
var lastfmReady = null;
function lastfmAccess() {
  if (lastfmReady) return lastfmReady;
  var direct = {key: LASTFM_KEY, fetch: fetch.bind(window)};
  if (typeof TAGS === 'undefined') return Promise.resolve(direct);
  lastfmReady = withTimeout(fetch(TAGS + '/health'), 4000).then(function(r){ return r.json(); }).then(function(h){
    if (!h || !h.lastfm) return direct;
    return {key: 'tags', fetch: function(u){
      if (u.indexOf(LFM_API) !== 0) return fetch(u);
      return fetch(TAGS + '/lastfmapi?' + u.slice(LFM_API.length + 1).replace(/(^|&)(api_key|format)=[^&]*/g, ''));
    }};
  }, function(){ lastfmReady = null; return direct; });   /* service not reachable (yet): ask again next time */
  return lastfmReady;
}
var similarCache = {};
var similarAllCache = {};       /* artist name -> all names from Last.fm (including those not in the collection) */          /* artist name -> array of found names */

/* ---------- Time display (keeps running by itself between polls) ---------- */
var seekBase = 0, seekStamp = 0, playing = false;

/* only write what has changed: setting the same texts again still forces a new layout */
var shownTime = {el: null, rem: null, fill: null};
function paintTime() {
  if (document.hidden) return;
  var pos = seekBase + (playing ? Date.now() - seekStamp : 0);
  if (curDur) pos = Math.min(pos, curDur * 1000);
  window.currentSeekMs = pos;          /* keeps lyrics flowing smoothly */
  var el = '', rem = '', fill = 0;     /* web radio: no duration */
  if (curDur) {
    el = fmtTime(pos / 1000);
    rem = '-' + fmtTime(Math.max(0, curDur - pos / 1000));
    fill = Math.round(Math.min(1, pos / 1000 / curDur) * 1000) / 1000;
  }
  if (el !== shownTime.el) tElapsed.textContent = shownTime.el = el;
  if (rem !== shownTime.rem) tRemain.textContent = shownTime.rem = rem;
  if (fill !== shownTime.fill) { shownTime.fill = fill; seekFill.style.transform = 'scaleX(' + fill + ')'; }
}
setInterval(paintTime, 250);

/* seek to a position in the song (ms) */
function seekToMs(ms) {
  if (!curDur) return;
  var sec = Math.max(0, Math.min(curDur, Math.ceil(ms / 1000)));
  seekBase = sec * 1000; seekStamp = Date.now();
  paintTime();
  fetch('/api/v1/commands/?cmd=seek&position=' + sec).catch(function(){});
}


/* wait at most ms milliseconds for an answer (Volumio/TIDAL sometimes hangs, session timeout) */
function withTimeout(p, ms) {
  return new Promise(function(resolve, reject){
    var t = setTimeout(function(){ reject(new Error('timeout')); }, ms);
    p.then(function(v){ clearTimeout(t); resolve(v); }, function(e){ clearTimeout(t); reject(e); });
  });
}

/* dice (random row in Discover, random mix next to "Play all") */
var DICE_SVG = '<svg viewBox="0 0 24 24"><path d="M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2.5 3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM7.5 15a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm9 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>';

function artUrl(a) {
  if (!a) return '';
  return (a.indexOf('http') === 0 || a.indexOf('data:') === 0) ? a : (location.origin + a);   /* data: large input icon (poll.js) */
}

function askVolumio(payload) {
  return withTimeout(fetch('/api/v1/pluginEndpoint', {          /* Volumio 4 without subscription sometimes does not answer at all */
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({endpoint:'metavolumio', data:payload})
  }), 6000).then(function(r){ return r.json(); })
    .then(function(j){
      if (!j || !j.data || !j.data.value) return null;
      if (j.data.type === 'story')   return {kind:'story',   value:j.data.value};
      if (j.data.type === 'credits' && j.data.value.length)
                                     return {kind:'credits', value:j.data.value};
      return null;
    }).catch(function(){ return null; });
}

function askOwn(payload) {                     /* fetch texts ourselves (infotext.js), in language LANG */
  return withTimeout(lastfmAccess().then(function(lf){ return infoFallback(lf.fetch, lf.key, payload.mode, payload.artist, payload.album, LANG); }), 10000)
    .catch(function(){ return null; });
}

/* text for the single track (infotext.js); result cached per track, including "nothing found" (localStorage) */
var TRACKINFO_MAX = 400;
function trackInfoCache() {
  try { return JSON.parse(localStorage.getItem('trackInfo') || '{}'); } catch (e) { return {}; }
}
function askTrack(artist, title) {
  if (typeof infoTrack !== 'function' || !artist || !title) return Promise.resolve(null);
  var k = LANG + '|' + artist.toLowerCase() + '|' + title.toLowerCase(), c = trackInfoCache();
  if (k in c) return Promise.resolve(c[k] ? {kind: 'story', value: c[k]} : null);
  return withTimeout(lastfmAccess().then(function(lf){ return infoTrack(lf.fetch, lf.key, artist, title, LANG); }), 15000).then(function(res){
    c = trackInfoCache();
    c[k] = res ? res.value : 0;
    var keys = Object.keys(c);                                 /* drop oldest first (insertion order) */
    keys.slice(0, Math.max(0, keys.length - TRACKINFO_MAX)).forEach(function(x){ delete c[x]; });
    /* storage full: retry with fewer entries, otherwise the state would stay frozen forever */
    for (var keep = keys.length; keep > 0; keep = Math.floor(keep / 2)) {
      try { localStorage.setItem('trackInfo', JSON.stringify(c)); break; }
      catch (e) { Object.keys(c).slice(0, Math.ceil(keep / 2)).forEach(function(x){ delete c[x]; }); }
    }
    return res;
  }, function(){ return null; });                              /* timeout: do not cache, retry next time */
}

function ask(payload) {
  var own = /^story/.test(payload.mode) && typeof infoFallback === 'function';
  if (own && volumioLang && volumioLang !== LANG)      /* Volumio delivers another language: fetch ourselves first */
    return askOwn(payload).then(function(res){ return res || askVolumio(payload); });
  return askVolumio(payload).then(function(res){       /* nothing from Volumio (Volumio 4 without subscription): fetch ourselves */
    return (res || !own) ? res : askOwn(payload);
  });
}

function askDiscography(artist) {
  var url = '/api/v1/browse?uri=' + encodeURIComponent('artists://' + artist);
  return fetch(url).then(function(r){ return r.json(); }).then(function(j){
    var lists = (j && j.navigation && j.navigation.lists) || [];
    var out = [];
    lists.forEach(function(l){
      (l.items || []).forEach(function(it){
        if (it.title && it.uri && it.type === 'folder')
          out.push({title:it.title, uri:it.uri});
      });
    });
    if (!out.length) return null;
    return {kind:'disc', value:out};
  }).catch(function(){ return null; });
}


function loadSimilarArtists(artist) {
  if (similarCache[artist]) return Promise.resolve(similarCache[artist]);
  return lastfmAccess().then(function(lf){
    if (!lf.key) return null;                    /* no similar artists without a key */
    return lf.fetch(LFM_API + '?method=artist.getsimilar&artist=' + encodeURIComponent(artist) +
                    '&api_key=' + encodeURIComponent(lf.key) + '&format=json&limit=15').then(function(r){ return r.json(); });
  })
    .then(function(j){
      var list = (j && j.similarartists && j.similarartists.artist) || [];
      var names = list.map(function(a){ return a.name; }).filter(function(n){ return n; });
      similarAllCache[artist] = names;
      if (!names.length) { similarCache[artist] = []; return []; }
      var checks = names.map(function(name){
        return fetch('/api/v1/browse?uri=' + encodeURIComponent('artists://' + name))
          .then(function(r){ return r.json(); })
          .then(function(j){
            var lists = (j && j.navigation && j.navigation.lists) || [];
            var hasAlbums = lists.some(function(l){ return (l.items||[]).length > 0; });
            return hasAlbums ? name : null;
          }).catch(function(){ return null; });
      });
      return Promise.all(checks).then(function(results){
        var matched = results.filter(function(n){ return n; });
        similarCache[artist] = matched;
        return matched;
      });
    }).catch(function(){ similarCache[artist] = []; return []; });
}

function playArtistByName(name) {
  fetch('/api/v1/search?query=' + encodeURIComponent(name))
    .then(function(r){ return r.json(); })
    .then(function(j){
      var lists = (j && j.navigation && j.navigation.lists) || [];
      var artistItem = null;
      lists.forEach(function(l){
        var t = (l.title || '').toLowerCase();
        if (t.indexOf('interpret') > -1) {
          (l.items || []).forEach(function(it){
            if (!artistItem && (it.title||it.name||'').toLowerCase() === name.toLowerCase())
              artistItem = it;
          });
          if (!artistItem && l.items && l.items.length) artistItem = l.items[0];
        }
      });
      if (artistItem) {
        if (queueForInput([{uri: artistItem.uri, service: artistItem.service || 'mpd', type: 'folder', title: artistItem.title || artistItem.name || name}])) return;
        fetch('/api/v1/replaceAndPlay', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body:JSON.stringify({item:{
            uri: artistItem.uri, service: artistItem.service || 'mpd',
            type:'folder', title: artistItem.title || artistItem.name || name
          }})
        }).catch(function(){});
      }
    }).catch(function(){});
}


