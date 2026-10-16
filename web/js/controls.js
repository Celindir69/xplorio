/* Repeat/Random und Lautstärke (Rotel-Dienst oder, mit APP_CONFIG.ROTEL = false, Volumio)
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
/* ---------- Repeat / Random ---------- */
function updateCtrlUI() {
  var shown = repeatShown(stRepeatMode, autodj);                 /* ∞ = AutoDJ (autodj.js) */
  cRepeat.className = shown + (curRadio ? ' disabled' : '');
  repeatBadge.textContent = {all: 'ALL', one: '1', inf: '∞'}[shown] || '';
  cRandom.className = (stRandom ? 'on' : '') + (curRadio ? ' disabled' : '');
}

cRepeat.addEventListener('click', function(){
  if (curRadio) return;
  var nx = repeatNext(repeatShown(stRepeatMode, autodj), autodj);
  if (nx.repeat) socket.emit('setRepeat', nx.repeat);
  stRepeatMode = nx.mode === 'inf' ? 'off' : nx.mode;
  if (nx.autodj !== null) { autodj.enabled = nx.autodj; autodjCall({enabled: nx.autodj}); }
  updateCtrlUI();
});

cRandom.addEventListener('click', function(){
  if (curRadio) return;
  stRandom = !stRandom;
  socket.emit('setRandom', {value: stRandom});
  updateCtrlUI();
});


/* ---------- Rotel Lautstärke ---------- */
var ROTEL_ON = !!(window.APP_CONFIG && window.APP_CONFIG.ROTEL);
var ROTEL    = 'http://' + location.hostname + ':' + ((window.APP_CONFIG && window.APP_CONFIG.ROTEL_PORT) || 8765);
var volWrap  = document.getElementById('volWrap');
var vSlider  = document.getElementById('vSlider');
var vVal     = document.getElementById('vVal');
var vMute    = document.getElementById('vMute');
var volDrag  = false;
var rotelMute= false;

var SVG_VOL  = '<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
var SVG_MUTE = '<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
vMute.innerHTML = SVG_VOL;

function paintSlider() {
  var pct = vSlider.value / vSlider.max * 100;
  vSlider.style.background = 'linear-gradient(to right, var(--accent, var(--fg)) ' + pct +
    '%, rgba(var(--fg-rgb),.25) ' + pct + '%)';
  vVal.textContent = vSlider.value;
}

/* Rotel ein/aus (Symbol oben links). Die Befehlsnamen stehen in web/config.js.
   Ausschalten: erst die Wiedergabe stoppen, dann Rotel aus. */
var btnRotelPower = document.getElementById('btnRotelPower');
var rotelOn = false;          /* was die Anzeige gerade zeigt */
var rotelReachable = false;   /* antwortet der Rotel-Dienst überhaupt? */
var rotelLinked = false;      /* hat der Rotel-Dienst eine Verbindung zum Verstärker? (Standby: oft nein) */
var rotelBusy = false;        /* Ausschalten läuft (Wiedergabe wird gestoppt) */
var rotelPowerHold = null;    /* {want:true/false, until:ms}: nach dem Tippen dem Wunsch folgen, bis der Dienst es bestätigt */

function paintRotelPower() {
  var cls = 'topBtn';
  if (!rotelReachable) cls += ' na';
  else if (rotelOn) cls += ' on';
  btnRotelPower.className = cls;
  btnRotelPower.title = !rotelReachable ? T('controls.rotel.unreachable') : (rotelOn ? T('controls.rotel.off') : T('controls.rotel.on'));
}

function sendRotelPower(want) {
  var cfg = window.APP_CONFIG || {};
  var c = want ? (cfg.ROTEL_CMD_POWER_ON || 'power_on') : (cfg.ROTEL_CMD_POWER_OFF || 'power_off');
  rotelPowerHold = { want: want, until: Date.now() + 20000 };
  return rotel('/cmd?c=' + encodeURIComponent(c));
}

/* Wiedergabe stoppen und kurz warten, bis Volumio sie nicht mehr als laufend meldet (höchstens 4 s) */
function stopPlaybackThen(done) {
  var tries = 0;
  function check() {
    fetch('/api/v1/getState').then(function(r){ return r.json(); }).then(function(st){
      if (st.status !== 'play' || ++tries > 12) { setTimeout(done, 500); } else { setTimeout(check, 300); }
    }).catch(function(){ setTimeout(done, 500); });
  }
  fetch('/api/v1/getState').then(function(r){ return r.json(); }).then(function(st){
    if (st.status === 'stop') { done(); return; }
    cmd('stop'); setTimeout(check, 300);
  }).catch(function(){ done(); });
}

btnRotelPower.addEventListener('click', function(){
  if (rotelBusy) return;
  var want = !rotelOn;
  if (want && !rotelLinked) {
    /* Der Dienst erreicht den Verstärker nicht (im Standby meist ohne Netzwerk): Befehl würde verworfen */
    showToast(T('controls.rotel.notLinked'));

    return;
  }
  rotelOn = want; paintRotelPower();
  volWrap.className = want ? '' : 'off';
  rotelPowerHold = { want: want, until: Date.now() + 20000 };
  if (want) { sendRotelPower(true); return; }
  rotelBusy = true;
  stopPlaybackThen(function(){ sendRotelPower(false); rotelBusy = false; });
});

/* Aktiver Eingang am Verstärker: ist es nicht der des Players, zeigt der Player statt Format und Stift
   den Namen und ein Icon des Eingangs (poll.js paintQuality, tagedit.js tagPaintPlayer).
   Namen und Icons kommen aus dem Profil der Bridge (ROTEL_PROFILE, ROTEL_INPUTS) */
var ROTEL_ICONS = {
  phono: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 14.5c-2.49 0-4.5-2.01-4.5-4.5S9.51 7.5 12 7.5s4.5 2.01 4.5 4.5-2.01 4.5-4.5 4.5zm0-5.5c-.55 0-1 .45-1 1s.45 1 1 1 1-.45 1-1-.45-1-1-1z',
  cd: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 3.8a8.2 8.2 0 1 0 0 16.4a8.2 8.2 0 1 0 0-16.4zM12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM12 10.8a1.2 1.2 0 1 0 0 2.4a1.2 1.2 0 1 0 0-2.4zM6.2 11.4A5.9 5.9 0 0 1 11.4 6.2v1.6A4.3 4.3 0 0 0 7.8 11.4z',
  tuner: 'M3.24 6.15C2.51 6.43 2 7.17 2 8v12c0 1.1.89 2 2 2h16c1.11 0 2-.9 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm13-8h-2v-2h-2v2H4V8h16v4z',
  bluetooth: 'M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z',
  usb: 'M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07c.7-.37 1.2-1.08 1.2-1.93 0-1.21-.99-2.2-2.2-2.2S4.8 7.79 4.8 9c0 .85.5 1.56 1.2 1.93V13c0 1.11.89 2 2 2h3v3.05c-.71.37-1.2 1.1-1.2 1.95 0 1.22.99 2.2 2.2 2.2s2.2-.98 2.2-2.2c0-.85-.49-1.58-1.2-1.95V15h3c1.11 0 2-.89 2-2v-2h1V7h-4z',
  tv: 'M21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h5v2h8v-2h5c1.1 0 1.99-.9 1.99-2L23 5c0-1.1-.9-2-2-2zm0 14H3V5h18v12z',
  digital: 'M20 5V4c0-.55-.45-1-1-1h-2c-.55 0-1 .45-1 1v1h-1v4c0 .55.45 1 1 1h1v7c0 1.1-.9 2-2 2s-2-.9-2-2V7c0-2.21-1.79-4-4-4S5 4.79 5 7v7H4c-.55 0-1 .45-1 1v4h1v1c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-1h1v-4c0-.55-.45-1-1-1H7V7c0-1.1.9-2 2-2s2 .9 2 2v10c0 2.21 1.79 4 4 4s4-1.79 4-4v-7h1c.55 0 1-.45 1-1V5h-1z',
  aux: 'M21 3.01H3c-1.1 0-2 .9-2 2V9h2V4.99h18v14.03H3V15H1v4.01c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98v-14c0-1.11-.9-2-2-2zM11 16l4-4-4-4v3H1v2h10v3z',
  pc: 'M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z'
};
var rotelSource = null;       /* zuletzt gemeldeter Eingang */
var rotelProf = null, rotelProfAt = 0;
function rotelNorm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }   /* pc_usb = pcusb */
function rotelProfLoad() {
  if (rotelProf || Date.now() - rotelProfAt < 60000) return;          /* höchstens einmal je Minute versuchen */
  rotelProfAt = Date.now();
  fetch(ROTEL + '/profile').then(function(r){ return r.json(); })
    .then(function(j){ if (j && j.profile) { rotelProf = j.profile; rotelInputRepaint(); } }).catch(function(){});
}
/* {name, icon} des aktiven fremden Eingangs oder null (Verstärker aus, Player-Eingang, noch unbekannt) */
function rotelInput() {
  if (!ROTEL_ON || !rotelProf || !rotelOn || !rotelLinked || !rotelSource) return null;
  var src = rotelNorm(rotelSource);
  if (src === rotelNorm(rotelProf.player)) return null;
  var hit = (rotelProf.sources || []).filter(function(x){ return rotelNorm(x.cmd) === src; })[0];
  return hit ? {name: hit.name, icon: hit.icon} : {name: rotelSource, icon: 'aux'};
}
var rotelInputShown = '';
function rotelInputRepaint() {
  var i = rotelInput(), k = i ? i.name + '|' + i.icon : '';
  if (k === rotelInputShown) return;
  rotelInputShown = k;
  if (typeof qualityState !== 'undefined' && qualityState) {
    if (typeof paintQuality === 'function') paintQuality(qualityState);
    if (typeof tagPaintPlayer === 'function') tagPaintPlayer(qualityState);
  }
}

function showRotel(s) {
  rotelReachable = true;
  rotelLinked = !!s.connected;
  var real = !!s.connected && s.power !== false;
  if (rotelPowerHold && (Date.now() > rotelPowerHold.until || real === rotelPowerHold.want)) rotelPowerHold = null;
  rotelOn = rotelPowerHold ? rotelPowerHold.want : real;
  paintRotelPower();
  volWrap.className = rotelOn ? '' : 'off';
  if (!!s.mute !== rotelMute || !vMute.firstChild) {
    rotelMute = !!s.mute;
    vMute.innerHTML = rotelMute ? SVG_MUTE : SVG_VOL;
  }
  if (!volDrag && typeof s.volume === 'number') {
    vSlider.value = s.volume;
    paintSlider();
  }
  rotelSource = s.source || null;
  rotelProfLoad();
  rotelInputRepaint();
}

/* ohne Rotel: Lautstärke von Volumio (getState/pushState); ausgeblendet, wenn Volumio keine Lautstärkeregelung hat */
function showVolumio(st) {
  if (ROTEL_ON) return;
  var none = st.disableVolumeControl || typeof st.volume !== 'number';
  volWrap.style.display = none ? 'none' : '';
  if (none) return;
  volWrap.className = '';
  if (!!st.mute !== rotelMute || !vMute.firstChild) {
    rotelMute = !!st.mute;
    vMute.innerHTML = rotelMute ? SVG_MUTE : SVG_VOL;
  }
  if (!volDrag) { vSlider.value = st.volume; paintSlider(); }
}

function volumioVol(v) {
  v = Math.max(0, Math.min(100, v));
  vSlider.value = v; paintSlider();
  socket.emit('volume', v);
}

if (!ROTEL_ON) {
  btnRotelPower.style.display = 'none';
  vSlider.max = 100;
}

function rotel(path) {
  if (!ROTEL_ON) return Promise.resolve();
  return fetch(ROTEL + path)
    .then(function(r){ return r.json(); })
    .then(function(j){ if (j && j.state) showRotel(j.state); })
    .catch(function(){ volWrap.className = 'off'; rotelReachable = false; paintRotelPower(); });
}

vSlider.addEventListener('input', function(){ volDrag = true; paintSlider(); });
vSlider.addEventListener('change', function(){
  if (!ROTEL_ON) { volumioVol(+vSlider.value); volDrag = false; return; }
  rotel('/vol?v=' + vSlider.value).then(function(){ volDrag = false; });
});

document.getElementById('vDown').addEventListener('click', function(){
  if (!ROTEL_ON) return volumioVol(+vSlider.value - 1);
  vSlider.value = Math.max(0, +vSlider.value - 1); paintSlider();
  rotel('/cmd?c=vol_dwn');
});
document.getElementById('vUp').addEventListener('click', function(){
  if (!ROTEL_ON) return volumioVol(+vSlider.value + 1);
  vSlider.value = Math.min(+vSlider.max, +vSlider.value + 1); paintSlider();
  rotel('/cmd?c=vol_up');
});
vMute.addEventListener('click', function(){
  if (!ROTEL_ON) { socket.emit(rotelMute ? 'unmute' : 'mute'); return; }
  rotel('/cmd?c=' + (rotelMute ? 'mute_off' : 'mute_on'));
});

