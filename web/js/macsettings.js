/* "Settings" page on the Mac (gear menu, only with PLAYER 'mpd'): what the Volumio plugin's settings page does on the player.
   Music folders (links in the music folder), audio output, the audio analysis file (essentia.jsonl: link or upload), Last.fm
   access, TIDAL (own account, POST /mpd/tidal, tags/tidal/), endless playback (AutoDJ, POST /mpd/autodj, tags/autodj.js) and the interface settings (written to config.local.js, the page loads again after saving).
   Tag service: GET/POST /mac/settings (tags/macsettings.js), POST /essentia (upload). The folder and file dialog comes from the
   Mac program (message handler "xplorioChoose", tools/mac/Xplorio.swift), otherwise from the tag service (osascript).
   Classic script, shared global scope; see xplorio.html for load order. */
var overlayMacSettings = document.getElementById('overlayMacSettings');
var msBody = document.getElementById('msBody');
var msAudio = null, msAudioMsg = '', msAudioBusy = false, msAudioBad = false, msAudioExpert = false;
var msAdj = null, msAdjMsg = '', msAdjBad = false;
var msTidal = null, msTidalMsg = '', msTidalBad = false, msTidalWas = null;
var msAna = null, msAnaMsg = '', msAnaBad = false, msAnaTimer = null;
var msRg = null, msRgMsg = '', msRgBad = false, msRgTimer = null;
var msImpWasRunning = false;
var msBak = null, msBakMsg = '', msBakBad = false, msBakTimer = null, msBakEdit = null;
var msUpd = null, msUpdMsg = '', msUpdBad = false;
var msImp = null, msImpForm = null, msImpMsg = '', msImpBad = false, msImpTimer = null;
var msData = null, msSeq = 0, msMsg = '', msMsgBad = false, msSlot = 'USB', msEdit = {}, msChooseCb = null;
var MS_ERRORS = ['slot', 'path', 'inside', 'exists', 'notlink', 'lastfm', 'auth', 'value', 'fs', 'short', 'locked'];
var MS_AUDIO_ERRORS = ['audio.busy', 'audio.nodevices', 'audio.output', 'audio.conf', 'audio.mpd'];
var MS_BOOLS = ['history', 'releaseDates', 'artistNames', 'moodTags', 'colorMood', 'm4aProbe', 'm4aLossless'];

function msToken() { return (typeof sysSvcToken === 'function' && sysSvcToken()) || (typeof sysSvcMem !== 'undefined' && sysSvcMem) || ''; }

function openMacSettings() {
  closeAllOverlays();
  overlayMacSettings.classList.add('on');
  msSeq++; msMsg = ''; msData = null; msEdit = {};
  while (msBody.firstChild) msBody.removeChild(msBody.firstChild);
  msBody.appendChild(browseNote(T('hist.loading')));
  var seq = msSeq;
  msAudioLoad();
  msAdj = null; msAdjMsg = ''; msAdjBad = false;
  msAdjSend({});
  msTidal = null; msTidalMsg = ''; msTidalBad = false; msTidalWas = null;
  msTidalSend({});
  msAna = null; msAnaMsg = ''; msAnaBad = false;
  msAnaSend({});
  msRg = null; msRgMsg = ''; msRgBad = false;
  msRgSend({});
  msImp = null; msImpForm = null; msImpMsg = ''; msImpBad = false;
  msImpSend({});
  msBak = null; msBakMsg = ''; msBakBad = false; msBakEdit = null;
  msBakSend({});
  msUpd = null; msUpdMsg = ''; msUpdBad = false;
  msUpdSend({});
  tagGetJson('/mac/settings').then(function(r){
    if (seq !== msSeq) return;
    if (!r || !r.ok) throw new Error('keine Daten');
    msData = r;
  }).catch(function(){ msMsg = T('mac.offline'); msMsgBad = true; }).then(function(){ if (seq === msSeq) msRender(); })
    .catch(function(e){                                  /* an error while drawing: show it instead of "Loading" forever */
      while (msBody.firstChild) msBody.removeChild(msBody.firstChild);
      msBody.appendChild(histEl('div', 'syNote syWarn', T('mac.err.fs') + ' ' + (e && e.message || e) + (e && e.stack ? ' · ' + String(e.stack).split('\n')[0] : '')));
      if (window.console) console.error(e);
    });
}

/* ---------- audio output (GET /mac/audio, POST /mac/settings {action: audioSelect|audioScan}) ---------- */
function msAudioLoad() {
  var seq = msSeq;
  msAudio = null; msAudioMsg = ''; msAudioBusy = false;
  tagGetJson('/mac/audio').then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) msAudio = r; else msAudioMsg = T(MS_AUDIO_ERRORS.indexOf(r && r.error) >= 0 ? 'mac.err.' + r.error : 'mac.err.audio.mpd');
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msAudioMsg = T('mac.err.audio.mpd'); if (msData) msRender(); } });
}
function msAudioSend(body, okText) {
  var seq = msSeq;
  body.token = msToken();
  msAudioBusy = true; msAudioMsg = body.action === 'audioScan' ? T('mac.audioScanning') : ''; msRender();
  tagPostJson('/mac/settings', body).then(function(r){
    if (seq !== msSeq) return;
    msAudioBusy = false;
    msAudioBad = !(r && r.ok);
    if (r && r.ok) { msAudio = r; msAudioMsg = okText ? T(okText, {n: r.devices || 0}) : ''; }
    else if (r && r.error === 'auth') { msAuthLost(); msAudioMsg = T('mac.err.auth'); }
    else msAudioMsg = T(MS_AUDIO_ERRORS.indexOf(r && r.error) >= 0 ? 'mac.err.' + r.error : 'mac.err.audio.mpd');
    msRender();
  }).catch(function(){ if (seq === msSeq) { msAudioBusy = false; msAudioBad = true; msAudioMsg = T('mac.err.audio.mpd'); msRender(); } });
}
/* how long the buffer lasts: CD 16 bit, 96 and 352.8 kHz as 24 bit (MPD keeps those in 4 bytes), stereo */
function msBufferTime(kib) {
  function dur(sec) {
    if (sec < 10) return T('mac.durSec', {s: (Math.round(sec * 10) / 10).toLocaleString(LANG_LOCALE)});
    var m = Math.floor(Math.round(sec) / 60), r = Math.round(sec) % 60;
    return m ? T('mac.durMin', {m: m, s: r}) : T('mac.durSec', {s: r});
  }
  var b = kib * 1024;
  return T('mac.audioBufferTime', {cd: dur(b / (44100 * 2 * 2)), hd: dur(b / (96000 * 2 * 4)), dsd: dur(b / (352800 * 2 * 4))});
}
function msAudioCard() {
  var c = sysCard(T('mac.audio'), 'syWide'), a = msAudio;
  c.appendChild(histEl('div', 'syNote', T('mac.audioNote')));
  if (a) {
    a.outputs.forEach(function(o){
      var row = histEl('div', 'msItem');
      var tx = histEl('div', 'msItemText');
      tx.appendChild(histEl('div', 'msItemName', o.system ? T('mac.audioSystem') : o.name));
      tx.appendChild(histEl('div', 'msItemSub', o.system ? T('mac.audioSystemSub') : o.via ? T('mac.audioVia')
        : [o.hog ? T('mac.audioExclusiveOn') : '', o.fixed ? T('mac.audioFixedOn') : '', o.dop ? 'DoP' : ''].filter(Boolean).join(' · ')));
      row.appendChild(tx);
      if (o.enabled) row.appendChild(histEl('div', 'mxChip mxSmall on', T('mac.audioActive')));
      else row.appendChild(msButton(T('mac.audioUse'), function(){ if (!msAudioBusy) msAudioSend({action: 'audioSelect', id: o.id}); }));
      c.appendChild(row);
    });
    if (!a.outputs.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.audioNone')));
    if (a.canScan) {
      /* every change writes all three into mpd.conf (MPD restarts) */
      var scan = function(change){
        if (msAudioBusy) return;
        var b = {action: 'audioScan', exclusive: !!a.exclusive, fixedVolume: !!a.fixedVolume, dop: !!a.dop};
        Object.keys(change || {}).forEach(function(k){ b[k] = change[k]; });
        msAudioSend(b, 'mac.audioScanned');
      };
      var row = histEl('div', 'pbRow msAddRow');
      row.appendChild(msButton(T('mac.audioScan'), function(){ scan({}); }, 'on'));
      c.appendChild(row);
      /* expert settings: folded away; folded, a line says what is on */
      var on = [a.exclusive ? T('mac.audioExclusiveOn') : '', a.fixedVolume ? T('mac.audioFixedOn') : '', a.dsdFfmpeg ? T('mac.audioDsdFf') : '',
                a.dop && !a.dsdFfmpeg ? 'DoP' : '', a.bufferKib ? T('mac.audioBufferMb', {n: a.bufferKib / 1024}) : ''].filter(Boolean);
      var head = histEl('div', 'sHint listLink pbLink', (msAudioExpert ? '▾ ' : '▸ ') + T('mac.audioExpert') + (!msAudioExpert && on.length ? ' · ' + on.join(' · ') : ''));
      head.addEventListener('click', function(){ msAudioExpert = !msAudioExpert; msRender(); });
      c.appendChild(head);
      var cc = c;                                        /* the rows below go into the folding part (drawn, but shown only unfolded) */
      c = histEl('div', 'msExpert');
      if (msAudioExpert) cc.appendChild(c);
      /* inverted: the switch shows the opposite of the setting (software volume on = fixedVolume off); ask before setting it */
      var sw = function(label, key, note, ask, inverted){
        var r = histEl('div', 'msSetRow');
        r.appendChild(histEl('div', 'msSetLabel', T(label)));
        r.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], inverted ? !a[key] : !!a[key], function(v){
          var val = inverted ? !v : v;
          if (val && ask && !confirm(T(ask))) return;
          var ch = {}; ch[key] = val; scan(ch);
        }));
        c.appendChild(r);
        c.appendChild(histEl('div', 'syNote', T(note)));
      };
      sw('mac.audioExclusive', 'exclusive', 'mac.audioExclusiveNote');
      sw('mac.audioFixed', 'fixedVolume', 'mac.audioFixedNote', 'mac.audioFixedAsk', true);
      if (a.ffmpegDecoder || a.dsdFfmpeg) {                /* MPD's own DSD decoder off, ffmpeg decodes DSD (MPD 0.24.0 on the Mac: noise) */
        var dr = histEl('div', 'msSetRow');
        dr.appendChild(histEl('div', 'msSetLabel', T('mac.audioDsdFf')));
        dr.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.dsdFfmpeg, function(v){
          if (!msAudioBusy) msAudioSend({action: 'audioDsd', on: v}, 'mac.tidalSaved');
        }));
        c.appendChild(dr);
        c.appendChild(histEl('div', 'syNote', T('mac.audioDsdFfNote')));
      }
      if (!a.dsdFfmpeg) sw('mac.audioDop', 'dop', 'mac.audioDopNote', 'mac.audioDopAsk');
      if (!a.ffmpegDecoder && !a.dsdFfmpeg) c.appendChild(histEl('div', 'syNote', T('mac.audioDsdFfMissing')));
      var br = histEl('div', 'msSetRow');
      br.appendChild(histEl('div', 'msSetLabel', T('mac.audioBuffer')));
      br.appendChild(pbChips((a.buffers || [0]).map(function(k){ return [k, k ? T('mac.audioBufferMb', {n: k / 1024}) : T('mac.audioBufferStd')]; }), a.bufferKib || 0, function(v){
        if (!msAudioBusy) msAudioSend({action: 'audioBuffer', kib: v}, 'mac.tidalSaved');
      }));
      c.appendChild(br);
      c.appendChild(histEl('div', 'syNote', msBufferTime(a.bufferKib || 4096)));
      c.appendChild(histEl('div', 'syNote', T('mac.audioBufferNote')));
      c = cc;
    }
  } else if (!msAudioMsg) c.appendChild(browseNote(T('hist.loading')));
  if (msAudioMsg) c.appendChild(histEl('div', 'syNote' + (msAudioBad || (!msAudio && !msAudioBusy) ? ' syWarn' : ''), msAudioMsg));
  return c;
}

/* body {action, …} -> new state; ok(r) after success */
function msSend(body, okText, ok) {
  var seq = msSeq;
  body.token = msToken();
  msMsg = T('mac.saving'); msMsgBad = false; msRender();
  return tagPostJson('/mac/settings', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) {
      if (r.music) msData = r;
      msMsg = okText || ''; msMsgBad = false;
      if (ok) ok(r);
    } else {
      var e = r && r.error;
      if (e === 'auth') msAuthLost();
      msMsg = T('mac.err.' + (MS_ERRORS.indexOf(e) >= 0 ? e : 'fs')); msMsgBad = true;
    }
    msRender();
  }).catch(function(){ if (seq === msSeq) { msMsg = T('mac.err.fs'); msMsgBad = true; msRender(); } });
}

/* folder or file dialog: the Mac program's own, else the tag service's */
function msChoose(kind, cb) {
  var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xplorioChoose;
  if (h) { msChooseCb = cb; h.postMessage(kind); return; }
  tagPostJson('/mac/settings', {action: 'choose', kind: kind, token: msToken()}).then(function(r){ if (r && r.ok && r.path) cb(r.path); }).catch(function(){});
}
window.xplorioChosen = function(p){ var cb = msChooseCb; msChooseCb = null; if (cb && p) cb(String(p)); };
/* opened from another device (iPhone, other computer): the tag service's dialog would open on the Mac's screen */
function msRemote() {
  if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xplorioChoose) return false;
  return !/^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(location.hostname);
}
function msCanChoose() { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xplorioChoose) || (!!(msData && msData.mac) && !msRemote()); }

/* password set, but this device is not logged in: changes would answer "auth" */
function msLoggedIn() { return !msData || !msData.pw || !!msToken(); }
function msAuthLost() { if (typeof sysSvcToken === 'function') sysSvcMem = sysSvcToken(null); }
function msLoginCard() {
  var c = sysCard(T('mac.login'), 'syWide');
  c.appendChild(histEl('div', 'syNote', T('mac.loginNote')));
  var f = histEl('form', 'pbRow msAddRow'), inp = msInput('', T('sys.svc.password'), 'password');
  inp.autocomplete = 'current-password';
  f.appendChild(inp);
  var ok = histEl('button', 'mxChip mxSmall msBtn on', T('sys.svc.login'));
  ok.type = 'submit';
  f.appendChild(ok);
  var err = histEl('div', 'syNote syWarn', '');
  f.addEventListener('submit', function(ev){
    ev.preventDefault();
    if (!inp.value) return;
    tagPostJson('/servicelogin', {password: inp.value}).then(function(r){
      if (r && r.ok) { sysSvcMem = sysSvcToken(r.token); msMsg = ''; return openMacSettings(); }
      inp.value = '';
      err.textContent = r && r.error === 'locked' ? T('sys.svc.locked', {s: r.wait}) : r && r.error === 'wrong' ? T('sys.svc.wrong') : T('sys.svc.error');
    }).catch(function(){ err.textContent = T('sys.svc.error'); });
  });
  c.appendChild(f);
  c.appendChild(err);
  return c;
}

function msButton(text, fn, cls) {
  var b = histEl('div', 'mxChip mxSmall msBtn' + (cls ? ' ' + cls : ''), text);
  b.addEventListener('click', fn);
  return b;
}
function msInput(value, placeholder, type) {
  var i = histEl('input', 'pbNum msInput');
  i.type = type || 'text'; i.value = value || ''; i.placeholder = placeholder || '';
  i.autocomplete = 'off'; i.spellcheck = false; i.setAttribute('autocapitalize', 'off');
  return i;
}
function msSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' kB'; }

/* drawing again keeps the scroll position (the page would jump to the top while it is empty for a moment) */
function msRender() {
  var keep = [], el = msBody;
  for (; el && el.nodeType === 1; el = el.parentNode) if (el.scrollTop) keep.push([el, el.scrollTop]);
  var winY = window.pageYOffset || 0, h = msBody.offsetHeight;
  if (h) msBody.style.minHeight = h + 'px';
  try { msDraw(); } finally {
    msBody.style.minHeight = '';
    keep.forEach(function(k){ k[0].scrollTop = k[1]; });
    if (winY) window.scrollTo(0, winY);
  }
}
function msDraw() {
  var d = msData;
  while (msBody.firstChild) msBody.removeChild(msBody.firstChild);
  var grid = histEl('div', 'syGridBox');
  msBody.appendChild(grid);
  if (msMsg) grid.appendChild(histEl('div', 'syNote pbFoot' + (msMsgBad ? ' syWarn' : ''), msMsg));
  if (!d) return;
  if (!msLoggedIn()) grid.appendChild(msLoginCard());
  if (msRemote()) grid.appendChild(histEl('div', 'syNote pbFoot', T('mac.remoteNote')));
  grid.appendChild(msMusicCard(d));
  grid.appendChild(msAudioCard());
  grid.appendChild(msEssentiaCard(d));
  if (msRg && msRg.available) grid.appendChild(msRgCard());
  grid.appendChild(msLastfmCard(d));
  grid.appendChild(msTidalCard());
  grid.appendChild(msAdjCard());
  grid.appendChild(msRotelCard(d));
  if (msBak && msBak.available) grid.appendChild(msBakCard());
  grid.appendChild(msPwCard(d));
  if (msUpd && msUpd.available) grid.appendChild(msUpdCard());
  grid.appendChild(msUiCard(d));
  msFold(grid);
}

/* every card folds by its title (like the library check); open: music folders, audio output and sign-in, until changed.
   Remembered per device (localStorage) */
var msOpen = null;
function msOpenGet() {
  if (msOpen) return msOpen;
  msOpen = {};
  try { msOpen = JSON.parse(localStorage.getItem('xplorio.macOpen') || '{}') || {}; } catch (e) { msOpen = {}; }
  return msOpen;
}
function msFold(grid) {
  var open = msOpenGet(), always = [T('mac.login')];
  [].slice.call(grid.children).forEach(function(card){
    var t = card.classList.contains('syCard') && card.querySelector('.syTitle');
    if (!t) return;
    var key = t.textContent;
    if (always.indexOf(key) >= 0) return;
    var isOpen = !!open[key];                             /* all folded at first */
    card.classList.add('msFoldable');
    card.classList.toggle('msFolded', !isOpen);
    t.addEventListener('click', function(){
      var o = card.classList.toggle('msFolded');
      msOpen[key] = !o;
      try { localStorage.setItem('xplorio.macOpen', JSON.stringify(msOpen)); } catch (e) { /* private window */ }
    });
  });
}

/* ---------- music folders ---------- */
function msMusicCard(d) {
  var c = sysCard(T('mac.music'), 'syWide');
  c.appendChild(histEl('div', 'syNote', T('mac.musicNote')));
  if (!d.music.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.musicNone')));
  if (d.library && d.library.songs) {                    /* MPD's stats, like Volumio's library info */
    var lb = d.library, h = Math.floor(lb.playtime / 3600), days = Math.floor(h / 24);
    var kv = histEl('div', 'syKv');
    kv.appendChild(histEl('span', 'syK', T('mac.library')));
    kv.appendChild(histEl('span', 'syV', T('mac.libraryInfo', {ar: histNum(lb.artists), al: histNum(lb.albums), ti: histNum(lb.songs),
      time: days ? T('mac.libraryDays', {d: days, h: h % 24}) : T('mac.libraryHours', {h: h, m: Math.floor(lb.playtime % 3600 / 60)})})));
    c.appendChild(kv);
    if (lb.updated) c.appendChild(histEl('div', 'msItemSub', T('mac.libraryUpdated', {date: langDate(lb.updated)})));
  }
  if (d.library) {
    var lr = histEl('div', 'pbRow msAddRow');
    if (d.library.updating) lr.appendChild(histEl('div', 'syNote', T('mac.libraryScanning')));
    else {
      lr.appendChild(msButton(T('mac.libraryScan'), function(){ msSend({action: 'libraryScan'}, T('mac.libraryScanStarted'), msLibraryWatch); }, 'on'));
      lr.appendChild(msButton(T('mac.libraryRescan'), function(){
        if (confirm(T('mac.libraryRescanAsk'))) msSend({action: 'libraryScan', full: true}, T('mac.libraryScanStarted'), msLibraryWatch);
      }));
    }
    c.appendChild(lr);
    if (d.library.updating) msLibraryWatch();
  }
  d.music.forEach(function(m){
    var row = histEl('div', 'msItem');
    var tx = histEl('div', 'msItemText');
    tx.appendChild(histEl('div', 'msItemName', m.rel));
    tx.appendChild(histEl('div', 'msItemSub' + (m.missing ? ' syWarn' : ''), m.missing ? T('mac.missing', {p: m.target}) : m.target));
    row.appendChild(tx);
    if (m.link) row.appendChild(msButton(T('mac.remove'), function(){
      if (!confirm(T('mac.removeAsk', {p: m.target}))) return;
      msSend({action: 'musicRemove', rel: m.rel}, T('mac.removed'));
    }));
    c.appendChild(row);
  });
  c.appendChild(histEl('div', 'syK msLabel', T('mac.addFolder')));
  c.appendChild(pbChips(['INTERNAL', 'USB', 'NAS'].map(function(s){ return [s, s]; }), msSlot, function(s){ msSlot = s; msRender(); }));
  var row = histEl('div', 'pbRow msAddRow'), inp = msInput(msEdit.folder, T('mac.folderPh'));
  inp.addEventListener('input', function(){ msEdit.folder = inp.value; });
  row.appendChild(inp);
  if (msCanChoose()) row.appendChild(msButton(T('mac.choose'), function(){ msChoose('folder', function(p){ msEdit.folder = p; msRender(); }); }));
  row.appendChild(msButton(T('mac.add'), function(){
    var p = String(inp.value || '').trim();
    if (!p) return;
    msSend({action: 'musicAdd', slot: msSlot, path: p}, T('mac.added'), function(){ msEdit.folder = ''; });
  }, 'on'));
  c.appendChild(row);
  c.appendChild(histEl('div', 'syNote', T('mac.musicScan')));
  msImpPart(c, d);
  return c;
}

/* ---------- importing new music (POST /mac/import, tags/musicimport.js) ---------- */
var MS_IMP_ERRORS = {source: 'mac.impErrSource', target: 'mac.impErrTarget', inside: 'mac.impErrInside', exists: 'mac.impErrExists',
  running: 'mac.impErrRunning', busy: 'mac.impErrBusy', fs: 'mac.impErrFs', mpd: 'mac.err.audio.mpd', auth: 'mac.err.auth'};
function msImpSend(body) {
  var seq = msSeq;
  if (body.action) body.token = msToken();
  clearTimeout(msImpTimer);
  tagPostJson('/mac/import', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.available === false) { msImp = r; return; }
    if (r && r.ok) { msImp = r; if (body.action) { msImpForm = null; msImpMsg = ''; msImpBad = false; } }
    else { msImpBad = true; msImpMsg = T(MS_IMP_ERRORS[r && r.error] || 'mac.impErrFs'); }
    if (msImp && msImp.job && !msImp.job.end) msImpTimer = setTimeout(function(){
      if (seq !== msSeq || !overlayMacSettings.classList.contains('on')) return;
      if (msImp.job.step === 'analysis' && !(msAna && msAna.running)) msAnaSend({});   /* its progress, asked from then on */
      msImpSend({});
    }, 3000);
    else if (body.action === undefined && msImp && msImp.job && msImp.job.end && msImpWasRunning) { msImpWasRunning = false; openMacSettings(); return; }
    msImpWasRunning = !!(msImp && msImp.job && !msImp.job.end);
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msImpBad = true; msImpMsg = T('mac.impErrFs'); if (msData) msRender(); } });
}
function msImpPart(c, d) {
  if (!msImp || msImp.available === false || !d.music.length) return;
  c.appendChild(histEl('div', 'syK msLabel', T('mac.imp')));
  var j = msImp.job, f = msImpForm;
  if (j && !j.end) {
    var pct = j.totalBytes ? Math.floor(j.bytes / j.totalBytes * 100) : 0;
    var kv = histEl('div', 'syKv');
    kv.appendChild(histEl('span', 'syK', j.dest.split('/').slice(-1)[0]));
    kv.appendChild(histEl('span', 'syV', j.step === 'copy' ? T(j.move ? 'mac.impMoving' : 'mac.impCopying', {n: j.done, m: j.total, p: pct}) : T('mac.impStep.' + j.step)));
    c.appendChild(kv);
    if (j.step === 'analysis' && msAna && msAna.progress && msAna.progress.total) c.appendChild(histEl('div', 'msItemSub', T('mac.anaProgress', {n: msAna.progress.done || 0, m: msAna.progress.total})));
  } else if (f) {
    c.appendChild(histEl('div', 'msItemName', f.source));
    function line(label, ctl) { var r = histEl('div', 'msSetRow'); r.appendChild(histEl('div', 'msSetLabel', label)); r.appendChild(ctl); c.appendChild(r); }
    line(T('mac.impTo'), pbChips(d.music.filter(function(m){ return !m.missing; }).map(function(m){ return [m.rel, m.rel + '/import']; }), f.rel, function(v){ f.rel = v; msRender(); }));
    line(T('mac.impHow'), pbChips([[false, T('mac.impCopy')], [true, T('mac.impMove')]], f.move, function(v){ f.move = v; msRender(); }));
    if (msRg && msRg.rsgain) line('ReplayGain (rsgain)', pbChips([[true, T('pb.on')], [false, T('pb.off')]], f.rsgain, function(v){ f.rsgain = v; msRender(); }));
    if (msAna && msAna.python && msAna.script) line(T('mac.impAnalysis'), pbChips([[true, T('pb.on')], [false, T('pb.off')]], f.analysis, function(v){ f.analysis = v; msRender(); }));
    var row = histEl('div', 'pbRow msAddRow');
    row.appendChild(msButton(T('mac.impStart'), function(){
      msImpSend({action: 'start', source: f.source, rel: f.rel, move: f.move, rsgain: f.rsgain && !!(msRg && msRg.rsgain), analysis: f.analysis && !!(msAna && msAna.python)});
    }, 'on'));
    row.appendChild(msButton(T('mac.impCancel'), function(){ msImpForm = null; msRender(); }));
    c.appendChild(row);
  } else {
    c.appendChild(histEl('div', 'syNote', T('mac.impNote')));
    var r2 = histEl('div', 'pbRow msAddRow');
    var form = function(p){
      var first = d.music.filter(function(m){ return !m.missing; })[0];
      msImpForm = {source: p, rel: first ? first.rel : '', move: false, rsgain: true, analysis: true};
      msImpMsg = ''; msRender();
    };
    if (msCanChoose()) r2.appendChild(msButton(T('mac.impButton'), function(){ msChoose('folder', form); }, 'on'));
    else {                                               /* from another device: the path, typed */
      var ip = msInput('', T('mac.impPathPh'));
      r2.appendChild(ip);
      r2.appendChild(msButton(T('mac.impNext'), function(){ var p = String(ip.value || '').trim(); if (p) form(p); }, 'on'));
    }
    c.appendChild(r2);
    if (j && j.end) msImpResult(c, j);
  }
  if (msImpMsg) c.appendChild(histEl('div', 'syNote' + (msImpBad ? ' syWarn' : ''), msImpMsg));
}
/* album recognition after the import (tag service: albumid.js): exact matches already written (Undo), other matches as
   a suggestion to take over with one tap or to check in the tag editor. msImpRecDone[dir]: what was done here since */
var msImpRecDone = {};
function msImpRecognized(c, j) {
  (j.recognized || []).forEach(function(r){
    var folder = String(r.dir || '').split('/').slice(-1)[0], done = msImpRecDone[j.start + '|' + r.dir] || {};
    var box = histEl('div', 'msItem'), tx = histEl('div', 'msItemText'), row = histEl('div', 'pbRow');
    var best = r.best || (r.candidates && r.candidates[0]);
    function files() { return (r.files || []).map(function(u){ return {uri: u}; }); }
    function mark(state, batch) { msImpRecDone[j.start + '|' + r.dir] = {state: state, batch: batch}; msRender(); }
    var state = done.state || r.state, batch = done.batch || r.batch;
    if (state === 'written' && best) {
      tx.appendChild(histEl('div', 'msItemName', T('mac.recWritten', {folder: folder})));
      tx.appendChild(histEl('div', 'msItemSub', tagAlbumIdText(best) + ' · ' + tagAlbumIdWhy(best)));
      if (batch) row.appendChild(msButton(T('html.undo'), function(){
        tagPost('/undo', {batch: batch}).then(function(res){ mark(res.ok ? 'undone' : 'written', res.ok ? '' : batch); }).catch(function(){});
      }));
    } else if (state === 'suggest' && best) {
      tx.appendChild(histEl('div', 'msItemName', T('mac.recSuggest', {folder: folder})));
      tx.appendChild(histEl('div', 'msItemSub', tagAlbumIdText(best) + ' · ' + tagAlbumIdWhy(best)));
      row.appendChild(msButton(T('tag.rec.use'), function(){
        tagPost('/write', {items: best.items}).then(function(res){
          if (res.ok) mark('written', res.batch); else { msImpBad = true; msImpMsg = T('tag.error', {error: res.error || T('tag.unknown')}); msRender(); }
        }).catch(function(){ msImpBad = true; msImpMsg = T('tag.serviceDown'); msRender(); });
      }, 'on'));
    } else if (state === 'undone') {
      tx.appendChild(histEl('div', 'msItemName', T('mac.recUndone', {folder: folder})));
    } else {
      tx.appendChild(histEl('div', 'msItemName', T(state === 'error' ? 'mac.recError' : 'mac.recNone', {folder: folder})));
    }
    if (r.files && r.files.length && typeof openTagEditor === 'function') row.appendChild(msButton(T('mac.recEditor'), function(){
      tagAutoRecognize = state !== 'written';
      openTagEditor(files(), folder);
    }));
    box.appendChild(tx); box.appendChild(row);
    c.appendChild(box);
  });
}
function msImpResult(c, j) {
  var name = j.dest.split('/').slice(-1)[0];
  if (j.error) { c.appendChild(histEl('div', 'syNote syWarn', T('mac.impFailed', {name: name}) + ' ' + T(MS_IMP_ERRORS[j.error] || 'mac.impErrFs'))); return; }
  var parts = [T('mac.impDone', {name: name, n: j.total, date: langDate(j.end)})];
  if (j.keptSource) parts.push(T('mac.impKept'));
  if (j.rsgainFiles !== undefined) parts.push(T('mac.impRg', {n: j.rsgainFiles}));
  if (j.analysed !== undefined) parts.push(T('mac.impAna', {n: j.analysed}));
  c.appendChild(histEl('div', 'syNote', parts.join(' ')));
  msImpRecognized(c, j);
  var ck = j.check;
  if (!ck) return;
  var miss = Object.keys(ck.missing).filter(function(k){ return ck.missing[k]; });
  if (!miss.length && !ck.noCover.length && ck.tracks === ck.audioFiles) { c.appendChild(histEl('div', 'syNote', T('mac.impTagsOk', {n: ck.tracks}))); return; }
  if (ck.tracks < ck.audioFiles) c.appendChild(histEl('div', 'syNote syWarn', T('mac.impUnread', {n: ck.audioFiles - ck.tracks})));
  if (miss.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.impMissing', {list: miss.map(function(k){ return T('mac.impField.' + k) + ' (' + ck.missing[k] + ')'; }).join(', ')})));
  ck.examples.slice(0, 6).forEach(function(e){ c.appendChild(histEl('div', 'msItemSub', e.file.split('/').slice(-2).join('/') + ': ' + e.missing.map(function(k){ return T('mac.impField.' + k); }).join(', '))); });
  if (ck.noCover.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.impNoCover', {list: ck.noCover.map(function(p){ return p.split('/').slice(-1)[0]; }).slice(0, 5).join(', ')})));
  var row = histEl('div', 'pbRow msAddRow');                 /* fix it: all imported tracks in the bulk editor, or the library check */
  if (ck.files && ck.files.length && typeof openBulkEditor === 'function') row.appendChild(msButton(T('mac.impEdit'), function(){ openBulkEditor(ck.files, name); }, 'on'));
  if (typeof openCheck === 'function') row.appendChild(msButton(T('mac.impCheck'), function(){ openCheck(); }));
  c.appendChild(row);
}

/* while MPD reads the library: ask again every 5 s, then show the new numbers */
var msLibTimer = null;
function msLibraryWatch() {
  var seq = msSeq;
  clearTimeout(msLibTimer);
  msLibTimer = setTimeout(function(){
    if (seq !== msSeq || !overlayMacSettings.classList.contains('on')) return;
    tagGetJson('/mac/settings').then(function(r){
      if (seq !== msSeq || !r || !r.ok) return;
      var was = msData && msData.library && msData.library.updating;
      msData.library = r.library;
      if (r.library && r.library.updating) { if (!was) msRender(); return msLibraryWatch(); }
      msMsg = T('mac.libraryScanDone'); msMsgBad = false; msRender();
    }).catch(function(){});
  }, 5000);
}

/* ---------- audio analysis ---------- */
function msEssentiaCard(d) {
  var c = sysCard(T('mac.essentia'), 'syWide'), e = d.essentia || {};
  var kv = histEl('div', 'syKv');
  kv.appendChild(histEl('span', 'syK', T('mac.essState')));
  kv.appendChild(histEl('span', 'syV', !e.exists ? T('mac.essNone')
    : T(e.linked ? 'mac.essLinked' : 'mac.essCopy', {n: e.tracks || 0, size: msSize(e.size), date: langDate(Date.parse(e.date))})));
  c.appendChild(kv);
  if (e.linked) c.appendChild(histEl('div', 'msItemSub' + (e.exists ? '' : ' syWarn'), e.exists ? e.target : T('mac.missing', {p: e.target})));
  c.appendChild(histEl('div', 'syNote', T('mac.essNote')));
  c.appendChild(histEl('div', 'syK msLabel', T('mac.essLink')));
  var row = histEl('div', 'pbRow msAddRow'), inp = msInput(msEdit.ess, T('mac.essPh'));
  inp.addEventListener('input', function(){ msEdit.ess = inp.value; });
  row.appendChild(inp);
  if (msCanChoose()) row.appendChild(msButton(T('mac.choose'), function(){ msChoose('file', function(p){ msEdit.ess = p; msRender(); }); }));
  row.appendChild(msButton(T('mac.link'), function(){
    var p = String(inp.value || '').trim();
    if (!p) return;
    msSend({action: 'essentiaLink', path: p}, T('mac.essLinkedOk'), function(){ msEdit.ess = ''; });
  }, 'on'));
  c.appendChild(row);
  /* or a copy: upload the file (replaces the current one) */
  var file = histEl('input');
  file.type = 'file'; file.accept = '.jsonl'; file.style.display = 'none';
  file.addEventListener('change', function(){ if (file.files && file.files[0]) msUpload(file.files[0]); });
  var up = histEl('div', 'sHint listLink pbLink', T('mac.essUpload'));
  up.addEventListener('click', function(){ file.click(); });
  c.appendChild(up); c.appendChild(file);
  msAnaPart(c);
  return c;
}

/* analysis on this Mac (POST /mac/analysis, tags/essentiarun.js): {} = state, {action: start|stop|check}, {nightly}.
   While it runs the state is asked every 5 s */
var MS_ANA_ERRORS = {python: 'mac.anaErrPython', script: 'mac.anaErrScript', roots: 'mac.anaErrRoots', running: 'mac.anaRunning', start: 'mac.anaErrStart', busy: 'mac.anaBusyRg'};
function msAnaSend(body, okText) {
  var seq = msSeq;
  if (Object.keys(body).length) body.token = msToken();
  clearTimeout(msAnaTimer);
  tagPostJson('/mac/analysis', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) {
      msAna = r; msAnaBad = !!r.startError;
      msAnaMsg = r.startError ? T(MS_ANA_ERRORS[r.startError] || 'mac.err.fs') : okText ? T(okText) : '';
      if (r.running) msAnaTimer = setTimeout(function(){ if (seq === msSeq && overlayMacSettings.classList.contains('on')) msAnaSend({}); }, 5000);
    } else if (r && r.available === false) msAna = r;
    else { msAnaBad = true; if (r && r.error === 'auth') msAuthLost(); msAnaMsg = T(r && r.error === 'auth' ? 'mac.err.auth' : 'mac.err.fs'); }
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msAnaBad = true; msAnaMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msAnaPart(c) {
  var a = msAna;
  if (a && a.available === false) return;              /* only on the Mac itself */
  c.appendChild(histEl('div', 'syK msLabel', T('mac.ana')));
  if (!a) { if (!msAnaMsg) c.appendChild(browseNote(T('hist.loading'))); }
  else if (!a.python || !a.script) {
    c.appendChild(histEl('div', 'syNote syWarn', T(a.script ? 'mac.anaNoPython' : 'mac.anaErrScript')));
    if (a.script) {
      c.appendChild(histEl('div', 'syNote', T('mac.anaInstall')));
      c.appendChild(histEl('pre', 'msCode', 'sudo port install python311 py311-pip libsdl2\npython3.11 -m pip install --user "essentia-tensorflow==2.1b6.dev1110" "numpy<2" mutagen'));
      c.appendChild(histEl('div', 'syNote', T('mac.anaInstallNew')));
      c.appendChild(histEl('pre', 'msCode', 'brew install python@3.11\npython3.11 -m pip install --user --break-system-packages essentia-tensorflow mutagen'));
      var chk = histEl('div', 'pbRow msAddRow');
      chk.appendChild(msButton(T('mac.anaCheck'), function(){ msAnaSend({action: 'check'}); }));
      c.appendChild(chk);
    }
  } else {
    c.appendChild(histEl('div', 'syNote', T('mac.anaNote')));
    var kv = histEl('div', 'syKv'), p = a.progress || {};
    kv.appendChild(histEl('span', 'syK', T('mac.essState')));
    var txt;
    var est = !p.done && p.total && (a.perFile || 10) * p.total / 60;   /* before the first progress: from the last run */
    if (a.running) txt = p.total ? T('mac.anaProgress', {n: p.done || 0, m: p.total}) + (p.minutesLeft !== undefined && p.done ? ' · ' + T('mac.anaLeft', {min: p.minutesLeft})
      : est ? ' · ' + T('mac.anaEstimate', {t: est >= 90 ? Math.round(est / 60) + ' h' : Math.max(1, Math.round(est)) + ' min'}) : '')
      : p.found !== undefined ? T('mac.anaNone2')
      : T('mac.anaPreparing');
    else if (a.lastEnd) txt = T('mac.anaLast', {date: langDate(a.lastEnd), n: a.lastAnalysed || 0}) + (a.lastError ? ' · ' + T('mac.anaStopped') : '');
    else txt = T('mac.anaNever');
    kv.appendChild(histEl('span', 'syV', txt));
    c.appendChild(kv);
    if (a.running && a.tail && a.tail.length) c.appendChild(histEl('div', 'msItemSub', a.tail[a.tail.length - 1]));
    var row = histEl('div', 'pbRow msAddRow');
    if (a.running) row.appendChild(msButton(T('mac.anaStop'), function(){ msAnaSend({action: 'stop'}, 'mac.anaStopping'); }));
    else row.appendChild(msButton(T('mac.anaStart'), function(){ msAnaSend({action: 'start'}, 'mac.anaStarted'); }, 'on'));
    c.appendChild(row);
    var nr = histEl('div', 'msSetRow');
    nr.appendChild(histEl('div', 'msSetLabel', T('mac.anaNightly')));
    nr.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.nightly, function(v){ msAnaSend({nightly: v}, 'mac.tidalSaved'); }));
    c.appendChild(nr);
  }
  if (msAnaMsg) c.appendChild(histEl('div', 'syNote' + (msAnaBad ? ' syWarn' : ''), msAnaMsg));
}
/* ReplayGain tags with rsgain (POST /mac/rsgain, tags/rsgainrun.js): {} = state, {action: start|stop}, {nightly} */
var MS_RG_ERRORS = {rsgain: 'mac.rgErrBin', roots: 'mac.anaErrRoots', running: 'mac.rgRunning', busy: 'mac.rgBusyAna'};
function msRgSend(body, okText) {
  var seq = msSeq;
  if (Object.keys(body).length) body.token = msToken();
  clearTimeout(msRgTimer);
  tagPostJson('/mac/rsgain', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) {
      var was = msRg && msRg.running;
      msRg = r; msRgBad = !!r.startError;
      msRgMsg = r.startError ? T(MS_RG_ERRORS[r.startError] || 'mac.err.fs') : okText ? T(okText) : was && !r.running ? T('mac.rgDone') : msRgMsg;
      if (r.running) msRgTimer = setTimeout(function(){ if (seq === msSeq && overlayMacSettings.classList.contains('on')) msRgSend({}); }, 5000);
    } else if (r && r.available === false) msRg = r;
    else { msRgBad = true; if (r && r.error === 'auth') msAuthLost(); msRgMsg = T(r && r.error === 'auth' ? 'mac.err.auth' : 'mac.err.fs'); }
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msRgBad = true; msRgMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msRgCard() {
  var c = sysCard('ReplayGain (rsgain)', 'syWide'), a = msRg;
  c.appendChild(histEl('div', 'syNote', T('mac.rgNote')));
  if (!a.rsgain) {
    c.appendChild(histEl('div', 'syNote syWarn', T('mac.rgNoBin')));
    c.appendChild(histEl('pre', 'msCode', 'brew install rsgain\n# MacPorts: sudo port install rsgain'));
  } else {
    var kv = histEl('div', 'syKv'), p = a.progress || {};
    kv.appendChild(histEl('span', 'syK', T('mac.essState')));
    var txt = a.running ? (p.phase === 'tagging' ? T('mac.rgTagging', {n: p.dir, m: p.dirs}) : T(p.phase === 'checking' ? 'mac.rgChecking' : 'mac.rgListing'))
      : a.lastEnd ? T('mac.rgLast', {date: langDate(a.lastEnd), n: a.lastFiles || 0, k: a.lastCarried || 0}) + (a.lastError ? ' · ' + T('mac.anaStopped') : '')
      : T('mac.anaNever');
    kv.appendChild(histEl('span', 'syV', txt));
    c.appendChild(kv);
    if (a.running && p.phase === 'tagging' && a.tail && a.tail.length) c.appendChild(histEl('div', 'msItemSub', a.tail[a.tail.length - 1]));
    var row = histEl('div', 'pbRow msAddRow');
    if (a.running) row.appendChild(msButton(T('mac.anaStop'), function(){ msRgSend({action: 'stop'}, 'mac.anaStopping'); }));
    else row.appendChild(msButton(T('mac.rgStart'), function(){ if (confirm(T('mac.rgAsk'))) msRgSend({action: 'start'}, 'mac.rgStarted'); }, 'on'));
    c.appendChild(row);
    var nr = histEl('div', 'msSetRow');
    nr.appendChild(histEl('div', 'msSetLabel', T('mac.rgNightly')));
    nr.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.nightly, function(v){ msRgSend({nightly: v}, 'mac.tidalSaved'); }));
    c.appendChild(nr);
  }
  if (msRgMsg) c.appendChild(histEl('div', 'syNote' + (msRgBad ? ' syWarn' : ''), msRgMsg));
  return c;
}
/* ---------- backup of Xplorio's own data (POST /mac/backup, tags/macbackup.js): {} = state, {target}, {nightly}, {action: start} ---------- */
var MS_BAK_ERRORS = {unset: 'mac.bakErrUnset', target: 'mac.bakErrTarget', missing: 'mac.bakErrTarget', write: 'mac.bakErrWrite',
                     inside: 'mac.bakErrInside', running: 'mac.bakRunning', fs: 'mac.err.fs'};
function msBakSend(body, okText) {
  var seq = msSeq;
  if (Object.keys(body).length) body.token = msToken();
  clearTimeout(msBakTimer);
  tagPostJson('/mac/backup', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) {
      var was = msBak && msBak.running, err = r.startError || r.setError;
      msBak = r; msBakBad = !!err;
      if (r.setError === undefined && body.target !== undefined) msBakEdit = null;
      msBakMsg = err ? T(MS_BAK_ERRORS[err] || 'mac.err.fs') : okText ? T(okText) : was && !r.running ? T(r.lastError ? 'mac.bakFailed' : 'mac.bakDone') : msBakMsg;
      if (r.running) msBakTimer = setTimeout(function(){ if (seq === msSeq && overlayMacSettings.classList.contains('on')) msBakSend({}); }, 3000);
    } else if (r && r.available === false) msBak = r;
    else { msBakBad = true; if (r && r.error === 'auth') msAuthLost(); msBakMsg = T(r && r.error === 'auth' ? 'mac.err.auth' : 'mac.err.fs'); }
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msBakBad = true; msBakMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msBakCard() {
  var c = sysCard(T('mac.bak'), 'syWide'), a = msBak, p = a.progress || {};
  c.appendChild(histEl('div', 'syNote', T('mac.bakNote')));
  var kv = histEl('div', 'syKv');
  kv.appendChild(histEl('span', 'syK', T('mac.essState')));
  kv.appendChild(histEl('span', 'syV', a.running ? (p.phase === 'copying' ? T('mac.bakCopying', {n: p.done, m: p.total}) : T('mac.bakListing'))
    : a.lastEnd ? (a.lastError ? T('mac.bakLastErr', {date: langDate(a.lastEnd)})
                               : T('mac.bakLast', {date: langDate(a.lastEnd), n: a.lastFiles || 0, size: msSize(a.lastBytes || 0), k: a.lastCopied || 0}))
    : T('mac.anaNever')));
  c.appendChild(kv);
  if (a.target && a.backups) {
    var kv2 = histEl('div', 'syKv');
    kv2.appendChild(histEl('span', 'syK', T('mac.bakWhere')));
    kv2.appendChild(histEl('span', 'syV', a.folder + ' · ' + T('mac.bakCount', {n: a.backups.length})));
    c.appendChild(kv2);
  }
  c.appendChild(histEl('div', 'syK msLabel', T('mac.bakTarget')));
  var inp = msInput(msBakEdit !== null ? msBakEdit : a.target, '/Volumes/…');
  inp.addEventListener('input', function(){ msBakEdit = inp.value; });
  var r1 = histEl('div', 'pbRow msAddRow');
  r1.appendChild(inp);
  if (msCanChoose()) r1.appendChild(msButton(T('mac.choose'), function(){ msChoose('folder', function(pth){ msBakEdit = pth; msRender(); }); }));
  r1.appendChild(msButton(T('mac.bakSave'), function(){ msBakSend({target: inp.value}, 'mac.tidalSaved'); }));
  c.appendChild(r1);
  if (a.target && !a.targetOk) c.appendChild(histEl('div', 'syNote syWarn', T('mac.bakErrTarget')));
  var row = histEl('div', 'pbRow msAddRow');
  if (!a.running && a.target) row.appendChild(msButton(T('mac.bakStart'), function(){ msBakSend({action: 'start'}, 'mac.bakStarted'); }, 'on'));
  c.appendChild(row);
  var nr = histEl('div', 'msSetRow');
  nr.appendChild(histEl('div', 'msSetLabel', T('mac.bakNightly')));
  nr.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.nightly, function(v){ msBakSend({nightly: v}, 'mac.tidalSaved'); }));
  c.appendChild(nr);
  c.appendChild(histEl('div', 'syNote', T('mac.bakRestore')));
  if (msBakMsg) c.appendChild(histEl('div', 'syNote' + (msBakBad ? ' syWarn' : ''), msBakMsg));
  return c;
}

/* ---------- updating Xplorio (POST /mac/update, tags/macupdate.js): {} = state, {action: check|install} ---------- */
var MS_UPD_ERRORS = {value: 'mac.err.value', busy: 'mac.updBusy', running: 'mac.updRunning', script: 'mac.updErrScript', fs: 'mac.err.fs', start: 'mac.err.fs'};
function msUpdSend(body, okText) {
  var seq = msSeq;
  if (body.action === 'install' || body.branch !== undefined) body.token = msToken();
  if (body.action === 'check') { msUpdMsg = T('mac.updChecking'); msUpdBad = false; if (msData) msRender(); }
  tagPostJson('/mac/update', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && r.ok) {
      msUpd = r; msUpdBad = !!r.startError;
      msUpdMsg = r.startError ? T(MS_UPD_ERRORS[r.startError] || 'mac.err.fs') : okText ? T(okText) : '';
    } else if (r && r.available === false) msUpd = r;
    else { msUpdBad = true; if (r && r.error === 'auth') msAuthLost(); msUpdMsg = T(r && r.error === 'auth' ? 'mac.err.auth' : 'mac.err.fs'); }
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msUpdBad = true; msUpdMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msUpdCard() {
  var c = sysCard(T('mac.upd'), 'syWide'), a = msUpd, inst = a.installed || {}, l = a.latest || {};
  function short(sha) { return String(sha || '').slice(0, 7); }
  function kv(k, v) { var e = histEl('div', 'syKv'); e.appendChild(histEl('span', 'syK', k)); e.appendChild(histEl('span', 'syV', v)); c.appendChild(e); }
  c.appendChild(histEl('div', 'syK msLabel', T('mac.updBranch')));
  var br = msInput(a.branch, 'claude/project-thread-6k5f1h'), r0 = histEl('div', 'pbRow msAddRow');
  r0.appendChild(br);
  r0.appendChild(msButton(T('mac.bakSave'), function(){ msUpdSend({branch: br.value}, 'mac.tidalSaved'); }));
  c.appendChild(r0);
  kv(T('mac.updInstalled'), inst.sha ? short(inst.sha) + (inst.at ? ' · ' + langDate(Date.parse(inst.at)) : '') : T('mac.updUnknown'));
  kv(T('mac.updLatest'), l.sha ? short(l.sha) + (l.date ? ' · ' + langDate(Date.parse(l.date)) : '') + (l.message ? ' · ' + l.message : '') : T('mac.updNoNet'));
  if (inst.ok === false) {
    c.appendChild(histEl('div', 'syNote syWarn', T('mac.updFailed', {step: inst.error || '?'})));
    if (a.log && a.log.length) c.appendChild(histEl('pre', 'msCode', a.log.join('\n')));
  }
  if (a.running) c.appendChild(histEl('div', 'syNote', T('mac.updStarted')));
  else if (l.sha) c.appendChild(histEl('div', 'syNote', T(a.newer ? (inst.sha ? 'mac.updNewer' : 'mac.updFirst') : 'mac.updCurrent')));
  var row = histEl('div', 'pbRow msAddRow');
  if (!a.running && a.script) row.appendChild(msButton(T(a.newer || !l.sha ? 'mac.updInstall' : 'mac.updAgain'), function(){
    if (confirm(T('mac.updAsk'))) msUpdSend({action: 'install'}, 'mac.updStarted');
  }, a.newer ? 'on' : ''));
  row.appendChild(msButton(T('mac.updCheck'), function(){ msUpdSend({action: 'check'}); }));
  c.appendChild(row);
  if (msUpdMsg) c.appendChild(histEl('div', 'syNote' + (msUpdBad ? ' syWarn' : ''), msUpdMsg));
  return c;
}
function msUpload(f) {
  var seq = msSeq;
  msMsg = T('mac.uploading'); msMsgBad = false; msRender();
  var h = {};
  if (msToken()) h['x-xplorio-password'] = msToken();
  fetch(TAGS + '/essentia', {method: 'POST', body: f, headers: h}).then(function(r){ return r.json(); }).then(function(r){
    if (seq !== msSeq) return;
    if (!r || !r.ok) throw new Error(r && r.error || 'upload');
    openMacSettings();
    msMsg = T('mac.uploaded', {n: r.tracks, m: r.matched});
  }).catch(function(){ if (seq === msSeq) { msMsg = T('mac.err.upload'); msMsgBad = true; msRender(); } });
}

/* ---------- password for the System page and the file manager (POST /mac/settings {action: password}) ---------- */
function msPwCard(d) {
  var c = sysCard(T('mac.pw'), 'syWide');
  c.appendChild(histEl('div', 'syNote', T('mac.pwNote')));
  var kv = histEl('div', 'syKv');
  kv.appendChild(histEl('span', 'syK', T('mac.essState')));
  kv.appendChild(histEl('span', 'syV', T(d.pw ? 'mac.pwSet' : 'mac.pwUnset')));
  c.appendChild(kv);
  var cur = d.pw ? msInput('', T('mac.pwCurrent'), 'password') : null, nw = msInput('', T('mac.pwNew'), 'password'), again = msInput('', T('mac.pwAgain'), 'password');
  [cur, nw, again].forEach(function(i){ if (i) { i.autocomplete = 'new-password'; var r = histEl('div', 'pbRow msAddRow'); r.appendChild(i); c.appendChild(r); } });
  var row = histEl('div', 'pbRow msAddRow');
  row.appendChild(msButton(T(d.pw ? 'mac.pwChange' : 'mac.pwSave'), function(){
    if (nw.value.length < 4) { msMsg = T('mac.err.short'); msMsgBad = true; return msRender(); }
    if (nw.value !== again.value) { msMsg = T('mac.pwMismatch'); msMsgBad = true; return msRender(); }
    msSend({action: 'password', password: nw.value, current: cur ? cur.value : ''}, T('mac.pwSaved'), function(r){
      if (r.token && typeof sysSvcToken === 'function') sysSvcMem = sysSvcToken(r.token);   /* this device stays logged in */
    });
  }, 'on'));
  c.appendChild(row);
  return c;
}

/* ---------- Last.fm ---------- */
function msLastfmCard(d) {
  var c = sysCard(T('mac.lastfm'), 'syWide'), lf = d.lastfm || {};
  var kv = histEl('div', 'syKv');
  kv.appendChild(histEl('span', 'syK', T('mac.lfState')));
  kv.appendChild(histEl('span', 'syV', lf.key ? T(lf.secret ? 'mac.lfBoth' : 'mac.lfKey') : T('mac.lfNone')));
  c.appendChild(kv);
  c.appendChild(histEl('div', 'syNote', T('mac.lfNote')));
  var key = msInput('', T(lf.key ? 'mac.lfKeyKeep' : 'mac.lfKeyPh')), secret = msInput('', T(lf.secret ? 'mac.lfSecretKeep' : 'mac.lfSecretPh'), 'password');
  [key, secret].forEach(function(i){ var r = histEl('div', 'pbRow msAddRow'); r.appendChild(i); c.appendChild(r); });
  var row = histEl('div', 'pbRow msAddRow');
  row.appendChild(msButton(T('mac.save'), function(){
    var k = key.value.trim(), s = secret.value.trim();
    if (!k) { msMsg = T('mac.err.lastfm'); msMsgBad = true; return msRender(); }
    msSend({action: 'lastfm', key: k, secret: s}, T('mac.lfSaved'));
  }, 'on'));
  if (lf.key) row.appendChild(msButton(T('mac.lfClear'), function(){
    if (confirm(T('mac.lfClearAsk'))) msSend({action: 'lastfm', clear: true}, T('mac.lfCleared'));
  }));
  c.appendChild(row);
  var link = histEl('a', 'sHint listLink pbLink', T('mac.lfGet'));
  link.href = 'https://www.last.fm/api/account/create'; link.target = '_blank'; link.rel = 'noopener';
  c.appendChild(link);
  return c;
}

/* ---------- TIDAL with the user's own account (POST /mpd/tidal, tags/tidal/service.js): {} = state,
   {action: login|logout}, {quality}, {searchLimit}. While the code waits for confirmation the state is asked every 3 s ---------- */
var MS_TIDAL_ERRORS = {auth: 'mac.err.auth', value: 'mac.err.value', login: 'mac.tidalErrLogin'};
function msTidalSend(body, okText) {
  var seq = msSeq;
  if (Object.keys(body).length) body.token = msToken();
  tagPostJson('/mpd/tidal', body).then(function(r){
    if (seq !== msSeq) return;
    if (r && (r.ok || r.error === 'node')) {
      msTidal = r; msTidalBad = false; msTidalMsg = okText ? T(okText) : '';
      if (r.error === 'expired') { msTidalMsg = T('mac.tidalExpired'); msTidalBad = true; }
      if (msTidalWas !== null && msTidalWas !== !!r.loggedIn && typeof streamMpdSources === 'function') streamMpdSources();
      msTidalWas = !!r.loggedIn;
      if (r.login) setTimeout(function(){ if (seq === msSeq && overlayMacSettings.classList.contains('on')) msTidalSend({}); }, 3000);
    } else { msTidalBad = true; msTidalMsg = T(MS_TIDAL_ERRORS[r && r.error] || 'mac.err.fs'); }
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msTidalBad = true; msTidalMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msTidalCard() {
  var c = sysCard('TIDAL', 'syWide'), a = msTidal;
  function line(label, ctl) {
    var r = histEl('div', 'msSetRow');
    r.appendChild(histEl('div', 'msSetLabel', label));
    r.appendChild(ctl);
    c.appendChild(r);
  }
  c.appendChild(histEl('div', 'syNote', T('mac.tidalNote')));
  if (!a) { if (!msTidalMsg) c.appendChild(browseNote(T('hist.loading'))); }
  else if (!a.available) c.appendChild(histEl('div', 'syNote syWarn', T('mac.tidalNode')));
  else {
    if (a.ffmpeg === false) c.appendChild(histEl('div', 'syNote syWarn', T('mac.tidalFfmpeg')));
    var kv = histEl('div', 'syKv');
    kv.appendChild(histEl('span', 'syK', T('mac.lfState')));
    kv.appendChild(histEl('span', 'syV', a.loggedIn ? (a.username ? T('mac.tidalAs', {user: a.username}) : T('mac.tidalIn')) + (a.plan ? ' · ' + a.plan : '') : T('mac.tidalOut')));
    c.appendChild(kv);
    if (a.login) {
      c.appendChild(histEl('div', 'syNote', T('mac.tidalStep')));
      c.appendChild(histEl('div', 'msTidalCode', a.login.code));
      var link = histEl('a', 'sHint listLink pbLink', a.login.url.replace(/^https:\/\//, ''));
      link.href = a.login.url; link.target = '_blank'; link.rel = 'noopener';
      c.appendChild(link);
      c.appendChild(histEl('div', 'syNote', T('mac.tidalWait')));
    }
    var row = histEl('div', 'pbRow msAddRow');
    if (a.loggedIn) row.appendChild(msButton(T('mac.tidalLogout'), function(){
      if (confirm(T('mac.tidalLogoutAsk'))) msTidalSend({action: 'logout'}, 'mac.tidalLoggedOut');
    }));
    else if (!a.login) row.appendChild(msButton(T('mac.tidalLogin'), function(){ msTidalSend({action: 'login'}); }, 'on'));
    if (row.firstChild) c.appendChild(row);
    if (a.loggedIn) {
      line(T('mac.tidalQuality'), pbChips([['HI_RES_LOSSLESS', T('mac.tidalMax')], ['LOSSLESS', T('mac.tidalHifi')], ['HIGH', 'AAC 320']],
        a.quality, function(v){ msTidalSend({quality: v}, 'mac.tidalSaved'); }));
      line(T('mac.tidalHits'), pbChips([[10, '10'], [20, '20'], [50, '50']], a.searchLimit, function(v){ msTidalSend({searchLimit: v}, 'mac.tidalSaved'); }));
    }
  }
  if (msTidalMsg) c.appendChild(histEl('div', 'syNote' + (msTidalBad ? ' syWarn' : ''), msTidalMsg));
  return c;
}

/* ---------- endless playback (AutoDJ): {} = state, {enabled}, {excludes, maxMinutes} ---------- */
function msAdjSend(body, okText) {
  var seq = msSeq;
  tagPostJson('/mpd/autodj', body).then(function(r){
    if (seq !== msSeq) return;
    msAdjBad = !(r && r.ok);
    if (r && r.ok) {
      msAdj = r; msAdjMsg = okText ? T(okText) : '';
      if (typeof autodjState === 'function' && body.enabled !== undefined) { autodj = autodjState(r); if (typeof updateCtrlUI === 'function') updateCtrlUI(); }
    } else msAdjMsg = T('mac.err.value');
    if (msData) msRender();
  }).catch(function(){ if (seq === msSeq) { msAdjBad = true; msAdjMsg = T('mac.err.fs'); if (msData) msRender(); } });
}
function msAdjCard() {
  var c = sysCard(T('mac.adj'), 'syWide'), a = msAdj;
  c.appendChild(histEl('div', 'syNote', T('mac.adjNote')));
  if (a) {
    var on = histEl('div', 'msSetRow');
    on.appendChild(histEl('div', 'msSetLabel', T('mac.adj')));
    on.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.enabled, function(v){ msAdjSend({enabled: v}); }));
    c.appendChild(on);
    if (!a.ready) c.appendChild(histEl('div', 'syNote syWarn', T('mac.adjNoKey')));
    var ex = msInput(a.excludes, T('mac.adjExcludePh')), mx = msInput(String(a.maxMinutes), '20', 'number');
    mx.min = '0'; mx.max = '600'; mx.style.maxWidth = '6em';
    var r1 = histEl('div', 'msSetRow'); r1.appendChild(histEl('div', 'msSetLabel', T('mac.adjExclude'))); r1.appendChild(ex); c.appendChild(r1);
    var r2 = histEl('div', 'msSetRow'); r2.appendChild(histEl('div', 'msSetLabel', T('mac.adjMax'))); r2.appendChild(mx); c.appendChild(r2);
    var row = histEl('div', 'pbRow msAddRow');
    row.appendChild(msButton(T('mac.save'), function(){
      var m = parseInt(mx.value, 10);
      msAdjSend({excludes: ex.value.trim(), maxMinutes: m >= 0 ? m : 0}, 'mac.adjSaved');
    }, 'on'));
    c.appendChild(row);
  } else if (!msAdjMsg) c.appendChild(browseNote(T('hist.loading')));
  if (msAdjMsg) c.appendChild(histEl('div', 'syNote' + (msAdjBad ? ' syWarn' : ''), msAdjMsg));
  return c;
}

/* ---------- Rotel amplifier (config.local.js: ROTEL, ROTEL_HOST, ROTEL_MODEL; the tag service runs the Rotel bridge) ---------- */
function msRotelCard(d) {
  var c = sysCard(T('mac.rotel'), 'syWide'), s = d.settings, ch = msEdit.rotel || (msEdit.rotel = {});
  function cur(id) { return Object.prototype.hasOwnProperty.call(ch, id) ? ch[id] : s[id]; }
  function line(label, ctl) {
    var r = histEl('div', 'msSetRow');
    r.appendChild(histEl('div', 'msSetLabel', label));
    r.appendChild(ctl);
    c.appendChild(r);
  }
  c.appendChild(histEl('div', 'syNote', T('mac.rotelNote')));
  line(T('mac.rotel'), pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!cur('rotel'), function(v){ ch.rotel = v; msRender(); }));
  var host = msInput(cur('rotelHost'), '192.168.1.50');
  host.addEventListener('input', function(){ ch.rotelHost = host.value.trim(); });
  line(T('mac.rotelHost'), host);
  line(T('mac.rotelModel'), pbChips([['RA-1572', 'RA-1572 / MKII'], ['RA-1592', 'RA-1592'], ['RC-1592', 'RC-1592'], ['RSP-1582', 'RSP-1582']],
    cur('rotelModel'), function(v){ ch.rotelModel = v; msRender(); }));
  var row = histEl('div', 'pbRow msAddRow');
  row.appendChild(msButton(T('mac.saveReload'), function(){
    if (!Object.keys(ch).length) return;
    if (cur('rotel') && !cur('rotelHost')) { msMsg = T('mac.rotelNoHost'); msMsgBad = true; return msRender(); }
    msSend({action: 'settings', settings: ch}, T('mac.saved'), function(){ setTimeout(function(){ location.reload(); }, 1500); });
  }, 'on'));
  c.appendChild(row);
  return c;
}

/* ---------- interface settings ---------- */
function msUiCard(d) {
  var c = sysCard(T('mac.ui'), 'syWide'), s = d.settings, ch = msEdit.ui || (msEdit.ui = {});
  function cur(id) { return Object.prototype.hasOwnProperty.call(ch, id) ? ch[id] : s[id]; }
  function line(label, ctl) {
    var r = histEl('div', 'msSetRow');
    r.appendChild(histEl('div', 'msSetLabel', label));
    r.appendChild(ctl);
    c.appendChild(r);
  }
  line(T('mac.set.language'), pbChips([['', T('mac.auto')], ['de', 'Deutsch'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano']],
    cur('language'), function(v){ ch.language = v; msRender(); }));
  line(T('mac.set.theme'), pbChips([['auto', T('mac.auto')], ['light', T('mac.light')], ['dark', T('mac.dark')]],
    cur('theme'), function(v){ ch.theme = v; msRender(); }));
  MS_BOOLS.forEach(function(id){
    line(T('mac.set.' + id), pbChips([[true, T('pb.on')], [false, T('pb.off')]], cur(id), function(v){ ch[id] = v; msRender(); }));
  });
  var hosts = msInput(cur('allowedHosts'), 'xplorio.local, 192.168.1.20');
  hosts.addEventListener('input', function(){ ch.allowedHosts = hosts.value; });
  line(T('mac.set.allowedHosts'), hosts);
  line(T('mac.set.effects'), pbChips([['full', T('mac.fxFull')], ['lite', T('mac.fxLite')]], cur('effects'), function(v){ ch.effects = v; msRender(); }));
  c.appendChild(histEl('div', 'syNote', T('mac.fxNote')));
  /* VU meter (as on the plugin's page): level shown as 0 VU, needle, delay to the sound */
  function pick(id, opts, label) {
    var sel = histEl('select', 'pbNum msInput msSelect');
    opts.forEach(function(o){ var e = histEl('option', '', label(o)); e.value = o; sel.appendChild(e); });
    sel.value = cur(id);
    sel.addEventListener('change', function(){ ch[id] = sel.value; });
    return sel;
  }
  c.appendChild(histEl('div', 'msSetHead', T('mac.vu')));
  line(T('mac.set.vuRef'), pick('vuRef', ['-4', '-5', '-6', '-7', '-8', '-9', '-10', '-11', '-12', '-13', '-14', '-16', '-18'],
    function(o){ return o + ' dBFS' + (o === '-8' ? ' (' + T('mac.std') + ')' : ''); }));
  line(T('mac.set.vuNeedle'), pbChips([['fast', T('mac.vuFast')], ['classic', T('mac.vuClassic')]], cur('vuNeedle'), function(v){ ch.vuNeedle = v; msRender(); }));
  line(T('mac.set.vuDelay'), pick('vuDelay', ['0', '100', '200', '300', '400', '500', '600', '700', '800', '900', '1000', '1200', '1500', '2000'],
    function(o){ return o + ' ms' + (o === '400' ? ' (' + T('mac.std') + ')' : ''); }));
  c.appendChild(histEl('div', 'syNote', T('mac.vuNote')));
  c.appendChild(histEl('div', 'syNote', T('mac.uiNote')));
  var row = histEl('div', 'pbRow msAddRow');
  row.appendChild(msButton(T('mac.saveReload'), function(){
    if (!Object.keys(ch).length) return;
    msSend({action: 'settings', settings: ch}, T('mac.saved'), function(){ setTimeout(function(){ location.reload(); }, 400); });
  }, 'on'));
  c.appendChild(row);
  return c;
}

document.getElementById('closeMacSettings').addEventListener('click', function(){ msSeq++; closeAllOverlays(); });
document.getElementById('macSettingsBack').addEventListener('click', function(){ msSeq++; openMenu(); });
