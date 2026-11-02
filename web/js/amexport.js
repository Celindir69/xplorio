/* Hidden: hand the queue to Apple Music on iOS. Not in the docs. Switched on per device with ?amexport=1
   (off with ?amexport=0), or for all devices with window.APP_CONFIG.AM_EXPORT = true in /data/xplorio/config.local.js; then a button sits in the queue's header. From the current track on (at most
   AM_MAX), the tag service finds each track in Apple Music (POST /applemusic, iTunes search; no match: dropped)
   and Xplorio opens the iOS shortcut "Xplorio-Mix" with one line "artist title" per track (search term) in Apple's spelling.
   Classic script, shared global scope; load order see xplorio.html. */
var AM_KEY = 'xplorioAmExport', AM_MAX = 50, AM_SHORTCUT = 'Xplorio-Mix';
var AM_SVG = '<svg viewBox="0 0 24 24"><path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"/></svg>';   /* note */

(function(){
  var m = /[?&]amexport=([01])\b/.exec(location.search);
  try {
    if (m) { if (m[1] === '1') localStorage.setItem(AM_KEY, '1'); else localStorage.removeItem(AM_KEY); }
    var on = localStorage.getItem(AM_KEY) === '1';
  } catch (e) { on = false; }
  if (!on && !(window.APP_CONFIG && window.APP_CONFIG.AM_EXPORT === true)) return;
  if (typeof TAGS === 'undefined') return;
  var head = document.querySelector('#overlayQueue .overlayHead'), close = document.getElementById('closeQueue');
  if (!head) return;
  var btn = document.createElement('div');
  btn.className = 'overlayClose amExport'; btn.title = 'Apple Music'; btn.innerHTML = AM_SVG;
  head.insertBefore(btn, close || null);
  var busy = false;
  btn.addEventListener('click', function(){
    if (busy) return;
    var from = Math.max(0, typeof curPos === 'number' ? curPos : 0);
    var tracks = (queueData || []).slice(from, from + AM_MAX).map(function(t){
      return {artist: t.artist || '', title: t.name || t.title || '', album: t.album || ''};
    }).filter(function(t){ return t.artist && t.title; });
    if (!tracks.length) return showToast(T('amexport.empty'));
    busy = true; btn.classList.add('busy');
    showToast(T('amexport.search', {n: tracks.length}));
    tagPost('/applemusic', {tracks: tracks}).then(function(r){
      busy = false; btn.classList.remove('busy');
      var list = (r && r.tracks) || [];
      if (!list.length) return showToast(T('amexport.none'));
      showToast(T('amexport.found', {n: list.length, of: tracks.length}));
      var text = list.map(function(t){ return t.artist + ' ' + t.title; }).join('\n');   /* search term for the shortcut */
      location.href = 'shortcuts://run-shortcut?name=' + encodeURIComponent(AM_SHORTCUT) + '&input=text&text=' + encodeURIComponent(text);
    }).catch(function(){ busy = false; btn.classList.remove('busy'); showToast(T('amexport.none')); });
  });
})();
