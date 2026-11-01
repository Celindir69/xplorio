/* Playback on this device: a hidden feature, in no menu and not in the docs. Opened with ?player=remote (only here),
   ?player=both (here and on the amplifier) or ?player=lokal (back to normal). The device remembers its choice.
   Needs a stream output ("httpd") in MPD's configuration, added by hand; the tag service passes it on
   (GET /stream, tags/remote.js) and switches MPD's outputs (POST /remote). Operation stays as usual: this only
   follows play and pause. iOS starts sound only after a tap, so the first tap anywhere starts it.
   Classic script, shared global scope; load order see xplorio.html. */
var REMOTE_KEY = 'xplorioPlayer';
var remoteMode = 'lokal', remoteAudio = null, remoteIcon = null, remoteWant = false, remoteHinted = false;
var REMOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M16 1H8C6.34 1 5 2.34 5 4v16c0 1.66 1.34 3 3 3h8c1.66 0 3-1.34 3-3V4c0-1.66-1.34-3-3-3zm-2 20h-4v-1h4v1zm3.25-3H6.75V4h10.5v14z"/></svg>';

function remoteStored() { try { return localStorage.getItem(REMOTE_KEY) || ''; } catch (e) { return ''; } }
function remoteStore(m) {
  try { if (m === 'lokal') localStorage.removeItem(REMOTE_KEY); else localStorage.setItem(REMOTE_KEY, m); } catch (e) { /* private mode */ }
}

function remoteSet(mode, quiet) {
  if (typeof TAGS === 'undefined') return;
  tagPost('/remote', {mode: mode}).then(function(r){
    if (!r || !r.ok) {
      if (!quiet) showToast(r && r.available === false ? T('remote.none') : T('remote.failed'));
      if (mode !== 'lokal') { remoteStore('lokal'); remoteApply('lokal'); }
      return;
    }
    remoteStore(mode);
    remoteApply(mode);
    if (!quiet) showToast(T('remote.mode.' + mode));
  }).catch(function(){ if (!quiet) showToast(T('remote.failed')); });
}

function remoteApply(mode) {
  remoteMode = mode;
  if (!remoteIcon) {
    remoteIcon = document.createElement('span');
    remoteIcon.className = 'remoteIcon';
    remoteIcon.innerHTML = REMOTE_SVG;
    remoteIcon.title = T('remote.back');
    remoteIcon.addEventListener('click', function(ev){ ev.stopPropagation(); remoteSet('lokal'); });
    var row = document.getElementById('mTechRow');
    if (row) row.appendChild(remoteIcon);
  }
  remoteIcon.style.display = mode === 'lokal' ? 'none' : '';
  if (mode === 'lokal') remoteStop();
  else if (remoteWant) remoteStart();
}

function remoteStart() {
  if (!remoteAudio) remoteAudio = new Audio();
  if (!remoteAudio.paused && remoteAudio.src) return;
  remoteAudio.src = TAGS + '/stream?t=' + Date.now();          /* live: always connect anew, so it does not lag behind */
  var p = remoteAudio.play();
  if (p && p.catch) p.catch(function(){
    if (!remoteHinted) { remoteHinted = true; showToast(T('remote.tap')); }   /* iOS: needs a tap first */
  });
}
function remoteStop() {
  if (!remoteAudio || !remoteAudio.src) return;
  remoteAudio.pause();
  remoteAudio.removeAttribute('src');
  remoteAudio.load();                                          /* drop the connection */
}

/* called with every player state (poll.js) */
function remoteSync(st) {
  remoteWant = st.status === 'play';
  if (remoteMode === 'lokal') return;
  if (remoteWant) remoteStart(); else remoteStop();
}

/* first tap: start the sound within the tap, iOS allows it only then */
document.addEventListener('click', function(){
  if (remoteMode !== 'lokal' && remoteWant && (!remoteAudio || remoteAudio.paused)) { if (remoteAudio) remoteAudio.removeAttribute('src'); remoteStart(); }
}, true);

(function(){
  var m = /[?&]player=(lokal|local|remote|both)\b/.exec(location.search);
  if (m) return remoteSet(m[1] === 'local' ? 'lokal' : m[1]);
  var stored = remoteStored();
  if (stored === 'remote' || stored === 'both') remoteSet(stored, true);   /* remembered; the safety switch may have reset it */
})();
