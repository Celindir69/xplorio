/* Playback on this device (docs: "Wiedergabe auf dem Handy"). Only if MPD has a stream output ("httpd") a headphones
   button appears top right; a tap switches between lokal (amplifier) and remote (only devices). "both" (amplifier and
   devices) is left out on purpose (rarely wanted); set from elsewhere (?player=both) it is still shown, a tap ends it.
   The mode belongs to the player (MPD's outputs) and every open Xplorio follows it (GET /remote, every 10 s and when
   it comes back to the foreground). Sound comes only from devices that chose it themselves (remembered per device);
   others show the mode dimmed, and a tap there joins in without changing the mode.
   Needs a stream output ("httpd") in MPD's configuration: the "MPD HTTP & Icecast output" plugin (Volumio 4) or added by
   hand to Volumio's mpd.conf template (Volumio 2); the tag service passes it on
   (GET /stream, tags/remote.js) and switches MPD's outputs (POST /remote). Operation stays as usual: this only
   follows play and pause. iOS starts sound only after a tap, so the first tap anywhere starts it.
   Classic script, shared global scope; load order see xplorio.html. */
var REMOTE_KEY = 'xplorioPlayer';
var REMOTE_CHECK_MS = 10000;
var remoteMode = 'lokal', remoteListen = false, remoteAudio = null, remoteIcon = null, remoteWant = false, remoteHinted = false;
var remoteEnc = {encoder: 'lame', bitrate: 0};       /* encoder of the stream output (GET /remote), for the quality display */
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
  remoteSet(remoteMode === 'lokal' ? 'remote' : 'lokal');
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
  /* only on the devices: the player's volume works on the amplifier output, which is off; the device's own buttons set it */
  document.documentElement.classList.toggle('remoteVol', mode === 'remote');
  remoteQualityRepaint();
}
document.addEventListener('click', function(ev){              /* volume dimmed: a tap only says why */
  if (remoteMode !== 'remote' || !ev.target || !ev.target.closest || !ev.target.closest('#volWrap')) return;
  ev.stopPropagation(); ev.preventDefault();
  showToast(T('remote.volume'));
}, true);

/* listening here: the quality display shows the stream, not the file ("Stream", MP3 with lame) */
var REMOTE_FORMATS = {lame: 'MP3', shine: 'MP3', vorbis: 'Ogg Vorbis', opus: 'Opus', flac: 'FLAC', wave: 'WAV'};
function remoteQuality() {
  if (!remotePlaying()) return null;
  var tech = [REMOTE_FORMATS[remoteEnc.encoder] || String(remoteEnc.encoder || 'MP3').toUpperCase()];
  if (remoteEnc.bitrate) tech.push(remoteEnc.bitrate + ' kbps');
  return {kind: 'stream', label: 'Stream', tech: tech};
}
function remoteQualityRepaint() { if (typeof qualityState !== 'undefined' && qualityState && typeof paintQuality === 'function') paintQuality(qualityState); }
function remoteEncoder(r) {
  if (r && r.encoder && (r.encoder !== remoteEnc.encoder || (r.bitrate || 0) !== remoteEnc.bitrate)) {
    remoteEnc = {encoder: r.encoder, bitrate: r.bitrate || 0};
    remoteQualityRepaint();
  }
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

function remoteHide() { remoteMode = 'lokal'; remoteListen = false; remoteStop(); if (remoteIcon) remoteIcon.style.display = 'none'; remoteQualityRepaint(); }

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

/* Keeping the stream alive on the go: mobile networks drop, change (WLAN <-> mobile) or stall without the audio element
   ever reporting an error. Every interruption reconnects by itself, with growing pauses (REMOTE_RETRY_MS) until sound
   comes again; a watchdog notices a stream that stopped moving (no progress for REMOTE_STALL_MS, longer right after
   connecting because of the server's cushion), a network change ("online", connection type) checks at once.
   Only a missing tap (iOS: NotAllowedError) pauses the player as before; other failures just try again. */
var REMOTE_RETRY_MS = [1000, 2000, 4000, 8000, 15000];
var REMOTE_STALL_MS = 10000, REMOTE_STALL_START_MS = 20000, REMOTE_STALL_NET_MS = 3000;
var remoteRetryN = 0, remoteRetryTimer = null, remoteProg = {t: -1, at: 0, played: false}, remoteNetAt = 0, remoteToasted = false;
function remoteRetry() {
  if (remoteRetryTimer || !remotePlaying() || !remoteWant) return;
  var ms = REMOTE_RETRY_MS[Math.min(remoteRetryN, REMOTE_RETRY_MS.length - 1)];
  remoteRetryN++;
  if (remoteRetryN === 2 && !remoteToasted && !document.hidden) { remoteToasted = true; showToast(T('remote.reconnect')); }
  remoteRetryTimer = setTimeout(function(){
    remoteRetryTimer = null;
    if (!remotePlaying() || !remoteWant) return;
    if (remoteAudio) { remoteAudio.pause(); remoteAudio.removeAttribute('src'); }
    remoteStart(true);
  }, ms);
}
function remoteRetryReset() {
  clearTimeout(remoteRetryTimer); remoteRetryTimer = null; remoteRetryN = 0;
}
/* watchdog: playing wanted, element not paused by the user, but the time stands still */
setInterval(function(){
  if (!remotePlaying() || !remoteWant || !remoteAudio || !remoteAudio.src || remoteAudio.paused || remoteRetryTimer) return;
  var now = Date.now(), t = remoteAudio.currentTime;
  if (t !== remoteProg.t) { remoteProg.t = t; remoteProg.at = now; return; }
  var limit = remoteNetAt > remoteProg.at ? REMOTE_STALL_NET_MS : remoteProg.played ? REMOTE_STALL_MS : REMOTE_STALL_START_MS;
  if (now - Math.max(remoteProg.at, remoteNetAt) >= limit) remoteRetry();
}, 1000);
function remoteNetChange() {                                   /* network changed: the old connection is often dead */
  remoteNetAt = Date.now();
}
window.addEventListener('online', function(){ remoteNetChange(); if (remotePlaying() && remoteWant) { remoteRetryReset(); remoteRetry(); } });
if (navigator.connection && navigator.connection.addEventListener) navigator.connection.addEventListener('change', remoteNetChange);

function remoteStart(retry) {
  if (!remoteAudio) {
    remoteAudio = new Audio();
    remoteAudio.preload = 'auto';
    var again = function(){ if (remotePlaying() && remoteWant && remoteAudio.src) remoteRetry(); };   /* connection lost: connect anew */
    remoteAudio.addEventListener('ended', again);
    remoteAudio.addEventListener('error', again);
    remoteAudio.addEventListener('playing', function(){                 /* sound again: next interruption starts from the beginning */
      remoteHinted = false; remoteRetryReset(); remoteToasted = false;
      remoteProg.played = true; remoteProg.at = Date.now();
    });
  }
  if (!remoteAudio.paused && remoteAudio.src) return;
  if (!retry) remoteRetryReset();
  remoteProg = {t: -1, at: Date.now(), played: false};
  remoteAudio.src = TAGS + '/stream?t=' + Date.now();          /* live: always connect anew, so it does not lag behind */
  var p = remoteAudio.play();
  if (p && p.catch) p.catch(function(e){
    if (!e || e.name !== 'NotAllowedError') return remoteRetry();   /* network, aborted: try again */
    if (retry && document.hidden) return;                       /* in the background: back in the foreground it tries again */
    if (!remoteHinted) { remoteHinted = true; remoteInterrupt(''); }   /* iOS: sound only after a tap -> pause, Play continues */
  });
}
function remoteStop() {
  remoteDelay = {ms: 0, at: 0};                                /* next connection: measure anew */
  remoteRetryReset();
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
    remoteEncoder(r);
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
  if (!remotePlaying() || !remoteWant) return;
  if (!remoteAudio || remoteAudio.paused || !remoteAudio.src) remoteStart();
  else if (remoteAudio.currentTime !== remoteProg.t) { remoteProg.t = remoteAudio.currentTime; remoteProg.at = Date.now(); }
  else if (remoteProg.played && !remoteRetryTimer && Date.now() - remoteProg.at > 1500) { remoteRetryReset(); remoteRetry(); }   /* stood still meanwhile */
});

/* start: button only with a stream output; explicit ?player=, else the player's mode (listening here if this device
   chose it before) */
(function(){
  if (typeof TAGS === 'undefined') return;
  tagGetJson('/remote').then(function(r){
    if (!r || !r.ok || !r.available) return;
    remoteEncoder(r);
    var m = /[?&]player=(lokal|local|remote|both)\b/.exec(location.search);
    if (m) { remoteApply(r.mode); return remoteSet(m[1] === 'local' ? 'lokal' : m[1]); }
    remoteListen = !!remoteStored() && r.mode !== 'lokal';
    remoteCheckAt = Date.now();
    remoteApply(r.mode);
  }).catch(function(){});
})();
