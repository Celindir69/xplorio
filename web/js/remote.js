/* Playback on this device: not in the docs. Only if MPD has a stream output ("httpd", added by hand) a headphones button
   appears top right; a tap switches lokal (amplifier) -> remote (only here) -> both -> lokal. Also with
   ?player=remote|both|lokal. The device remembers its choice.
   Needs a stream output ("httpd") in MPD's configuration, added by hand; the tag service passes it on
   (GET /stream, tags/remote.js) and switches MPD's outputs (POST /remote). Operation stays as usual: this only
   follows play and pause. iOS starts sound only after a tap, so the first tap anywhere starts it.
   Classic script, shared global scope; load order see xplorio.html. */
var REMOTE_KEY = 'xplorioPlayer';
var remoteMode = 'lokal', remoteAudio = null, remoteIcon = null, remoteWant = false, remoteHinted = false;
var REMOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>';   /* headphones */

function remoteStored() { try { return localStorage.getItem(REMOTE_KEY) || ''; } catch (e) { return ''; } }
function remoteStore(m) {
  try { if (m === 'lokal') localStorage.removeItem(REMOTE_KEY); else localStorage.setItem(REMOTE_KEY, m); } catch (e) { /* private mode */ }
}

function remoteSet(mode, quiet) {
  if (typeof TAGS === 'undefined') return;
  tagPost('/remote', {mode: mode}).then(function(r){
    if (!r || !r.ok) {
      if (!quiet) showToast(r && r.available === false ? T('remote.none') : T('remote.failed'));
      if (mode !== 'lokal') { remoteStore('lokal'); if (r && r.available === false) remoteHide(); else remoteApply('lokal'); }
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
    remoteIcon.addEventListener('click', function(ev){
      ev.stopPropagation();
      remoteSet(remoteMode === 'lokal' ? 'remote' : remoteMode === 'remote' ? 'both' : 'lokal');
    });
    var anchor = document.getElementById('btnRemote'), bar = document.getElementById('topRight');   /* top right, next to the remote control */
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(remoteIcon, anchor.nextSibling);
    else if (bar) bar.insertBefore(remoteIcon, bar.firstChild);
  }
  remoteIcon.className = 'topBtn remoteIcon ' + mode;
  remoteIcon.title = T('remote.mode.' + mode) + ' · ' + T('remote.next');
  if (mode === 'lokal') remoteStop();
  else if (remoteWant) remoteStart();
  if (typeof rotelInputRepaint === 'function') rotelInputRepaint();   /* other input on the amplifier: matters only with the amplifier */
}

function remoteHide() { remoteMode = 'lokal'; remoteStop(); if (remoteIcon) remoteIcon.style.display = 'none'; }

function remoteStart() {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    var again = function(){                                    /* connection lost (network, app switch): connect anew */
      if (remoteMode === 'lokal' || !remoteWant || !remoteAudio.src) return;
      setTimeout(function(){ if (remoteMode !== 'lokal' && remoteWant) { remoteAudio.removeAttribute('src'); remoteStart(); } }, 2000);
    };
    remoteAudio.addEventListener('ended', again);
    remoteAudio.addEventListener('error', again);
    remoteAudio.addEventListener('playing', function(){ remoteHinted = false; });   /* next interruption: hint again */
  }
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

/* back in the foreground: take over a change made meanwhile (safety switch, another device) */
document.addEventListener('visibilitychange', function(){
  if (document.hidden || !remoteIcon || remoteIcon.style.display === 'none') return;
  tagGetJson('/remote').then(function(r){
    if (!r || !r.ok || !r.available) return;
    if (r.mode === 'lokal' && remoteMode !== 'lokal') { remoteStore('lokal'); remoteApply('lokal'); }
    else if (remoteMode !== 'lokal' && remoteWant && (!remoteAudio || remoteAudio.paused)) remoteStart();
  }).catch(function(){});
});

/* start: symbol only with a stream output; explicit ?player=, else the remembered choice (the safety switch may have reset it) */
(function(){
  if (typeof TAGS === 'undefined') return;
  tagGetJson('/remote').then(function(r){
    if (!r || !r.ok || !r.available) return;
    var m = /[?&]player=(lokal|local|remote|both)\b/.exec(location.search);
    if (m) return remoteSet(m[1] === 'local' ? 'lokal' : m[1]);
    var stored = remoteStored();
    if (stored === 'remote' || stored === 'both') remoteSet(stored, true);
    else remoteApply('lokal');
  }).catch(function(){});
})();
