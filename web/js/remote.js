/* Playback on this device: not in the docs. Only if MPD has a stream output ("httpd", added by hand) a headphones
   button appears top right; a tap switches lokal (amplifier) -> remote (only devices) -> both -> lokal.
   Also with ?player=remote|both|lokal.
   The mode belongs to the player (MPD's outputs) and every open Xplorio follows it (GET /remote, every 10 s and when
   it comes back to the foreground). Sound comes only from devices that chose it themselves (remembered per device);
   others show the mode dimmed, and a tap there joins in without changing the mode.
   Needs a stream output ("httpd") in MPD's configuration, added by hand; the tag service passes it on
   (GET /stream, tags/remote.js) and switches MPD's outputs (POST /remote). Operation stays as usual: this only
   follows play and pause. iOS starts sound only after a tap, so the first tap anywhere starts it.
   Classic script, shared global scope; load order see xplorio.html. */
var REMOTE_KEY = 'xplorioPlayer';
var REMOTE_CHECK_MS = 10000;
var remoteMode = 'lokal', remoteListen = false, remoteAudio = null, remoteIcon = null, remoteWant = false, remoteHinted = false;
var remoteCheckAt = 0, remoteHold = 0;            /* after pausing: ignore "play" reports still on their way */
var REMOTE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/></svg>';   /* headphones */

function remoteStored() { try { return localStorage.getItem(REMOTE_KEY) || ''; } catch (e) { return ''; } }
function remoteStore(listen) {
  try { if (listen) localStorage.setItem(REMOTE_KEY, '1'); else localStorage.removeItem(REMOTE_KEY); } catch (e) { /* private mode */ }
}

/* change the player's mode; this device listens from now on if the mode is not "lokal" */
function remoteSet(mode, quiet) {
  if (typeof TAGS === 'undefined') return;
  tagPost('/remote', {mode: mode}).then(function(r){
    if (!r || !r.ok) {
      if (!quiet) showToast(r && r.available === false ? T('remote.none') : T('remote.failed'));
      if (r && r.available === false) remoteHide();
      else remoteCheck(true);
      return;
    }
    remoteListen = mode !== 'lokal';
    remoteStore(remoteListen);
    if (!quiet && remoteInterrupt(T('remote.mode.' + mode))) quiet = true;
    remoteApply(mode);
    if (!quiet) showToast(T('remote.mode.' + mode));
  }).catch(function(){ if (!quiet) showToast(T('remote.failed')); });
}

function remoteTap() {
  if (remoteMode !== 'lokal' && !remoteListen) {                /* running on another device: join in */
    remoteListen = true; remoteStore(true);
    if (!remoteInterrupt(T('remote.mode.' + remoteMode))) showToast(T('remote.mode.' + remoteMode));
    remoteApply(remoteMode);
    return;
  }
  remoteSet(remoteMode === 'lokal' ? 'remote' : remoteMode === 'remote' ? 'both' : 'lokal');
}

function remoteApply(mode) {
  remoteMode = mode;
  if (mode === 'lokal') { remoteListen = false; remoteStore(false); }
  if (!remoteIcon) {
    remoteIcon = document.createElement('span');
    remoteIcon.innerHTML = REMOTE_SVG;
    remoteIcon.addEventListener('click', function(ev){ ev.stopPropagation(); remoteTap(); });
    var anchor = document.getElementById('btnRemote'), bar = document.getElementById('topRight');   /* top right, next to the remote control */
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(remoteIcon, anchor.nextSibling);
    else if (bar) bar.insertBefore(remoteIcon, bar.firstChild);
  }
  var away = mode !== 'lokal' && !remoteListen;
  remoteIcon.style.display = '';
  remoteIcon.className = 'topBtn remoteIcon ' + mode + (away ? ' away' : '');
  remoteIcon.title = away ? T('remote.away') + ' · ' + T('remote.join') : T('remote.mode.' + mode) + ' · ' + T('remote.next');
  if (mode === 'lokal' || !remoteListen) remoteStop();
  else if (remoteWant) remoteStart();
  if (typeof rotelInputRepaint === 'function') rotelInputRepaint();   /* other input on the amplifier: matters only with the amplifier */
}

/* pause the player, so that Play (a tap, which iOS needs for sound) continues with the new output; true if it was playing */
function remoteInterrupt(lead) {
  if (!remoteWant) return false;
  remoteWant = false; remoteHold = Date.now() + 4000;
  remoteStop();
  if (typeof cmd === 'function') cmd('pause');
  showToast((lead ? lead + '. ' : '') + T('remote.tap'));
  return true;
}

function remoteHide() { remoteMode = 'lokal'; remoteListen = false; remoteStop(); if (remoteIcon) remoteIcon.style.display = 'none'; }

function remotePlaying() { return remoteMode !== 'lokal' && remoteListen; }

/* How far this device's sound lags behind the player, in ms (0 if it is not listening): the live stream's newest data
   is "now", so it is what the browser holds ahead of what it plays (the stream cushion plus its own buffer).
   Smoothed, measured at most twice a second. Synced lyrics follow it (lyrics.js) */
var remoteDelay = {ms: 0, at: 0};
function remoteDelayMs() {
  if (!remotePlaying() || !remoteAudio || remoteAudio.paused || !remoteAudio.buffered || !remoteAudio.buffered.length) return 0;
  var now = Date.now();
  if (now - remoteDelay.at >= 500) {
    var b = remoteAudio.buffered, ahead = (b.end(b.length - 1) - remoteAudio.currentTime) * 1000;
    if (ahead >= 0 && ahead < 30000) remoteDelay.ms = remoteDelay.ms ? remoteDelay.ms * 0.8 + ahead * 0.2 : ahead;
    remoteDelay.at = now;
  }
  return remoteDelay.ms;
}

function remoteStart() {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    var again = function(){                                    /* connection lost (network, app switch): connect anew */
      if (!remotePlaying() || !remoteWant || !remoteAudio.src) return;
      setTimeout(function(){ if (remotePlaying() && remoteWant) { remoteAudio.removeAttribute('src'); remoteStart(); } }, 2000);
    };
    remoteAudio.addEventListener('ended', again);
    remoteAudio.addEventListener('error', again);
    remoteAudio.addEventListener('playing', function(){ remoteHinted = false; });   /* next interruption: hint again */
  }
  if (!remoteAudio.paused && remoteAudio.src) return;
  remoteAudio.src = TAGS + '/stream?t=' + Date.now();          /* live: always connect anew, so it does not lag behind */
  var p = remoteAudio.play();
  if (p && p.catch) p.catch(function(){                         /* iOS: sound only after a tap -> pause, Play continues */
    if (!remoteHinted) { remoteHinted = true; remoteInterrupt(''); }
  });
}
function remoteStop() {
  remoteDelay = {ms: 0, at: 0};                                /* next connection: measure anew */
  if (!remoteAudio || !remoteAudio.src) return;
  remoteAudio.pause();
  remoteAudio.removeAttribute('src');
  remoteAudio.load();                                          /* drop the connection */
}

/* the player's mode, as another device or the safety switch may have changed it */
function remoteCheck(now) {
  if (typeof TAGS === 'undefined' || !remoteIcon || remoteIcon.style.display === 'none') return;
  if (!now && Date.now() - remoteCheckAt < REMOTE_CHECK_MS) return;
  remoteCheckAt = Date.now();
  tagGetJson('/remote').then(function(r){
    if (!r || !r.ok) return;
    if (!r.available) return remoteHide();
    if (r.mode !== remoteMode) remoteApply(r.mode);
  }).catch(function(){});
}

/* called with every player state (poll.js) */
function remoteSync(st) {
  remoteWant = st.status === 'play' && Date.now() > remoteHold;
  remoteCheck(false);
  if (!remotePlaying()) return;
  if (remoteWant) remoteStart(); else remoteStop();
}

/* Play: start the sound here within the tap, iOS allows it only then (the stream waits until the player sends) */
document.addEventListener('click', function(ev){
  if (!remotePlaying() || !ev.target || !ev.target.closest || !ev.target.closest('#cPlay')) return;
  if (remoteWant) return;                                      /* playing: this tap pauses, poll stops the sound */
  remoteWant = true; remoteHold = 0;
  if (remoteAudio) remoteAudio.removeAttribute('src');
  remoteStart();
}, true);

/* back in the foreground: take over a change made meanwhile, reconnect if needed */
document.addEventListener('visibilitychange', function(){
  if (document.hidden) return;
  remoteCheck(true);
  if (remotePlaying() && remoteWant && (!remoteAudio || remoteAudio.paused)) remoteStart();
});

/* start: button only with a stream output; explicit ?player=, else the player's mode (listening here if this device
   chose it before) */
(function(){
  if (typeof TAGS === 'undefined') return;
  tagGetJson('/remote').then(function(r){
    if (!r || !r.ok || !r.available) return;
    var m = /[?&]player=(lokal|local|remote|both)\b/.exec(location.search);
    if (m) { remoteApply(r.mode); return remoteSet(m[1] === 'local' ? 'lokal' : m[1]); }
    remoteListen = !!remoteStored() && r.mode !== 'lokal';
    remoteCheckAt = Date.now();
    remoteApply(r.mode);
  }).catch(function(){});
})();
