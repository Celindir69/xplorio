/* "Settings" page on the Mac (gear menu, only with PLAYER 'mpd'): what the Volumio plugin's settings page does on the player.
   Music folders (links in the music folder), the audio analysis file (essentia.jsonl: link or upload), Last.fm access and the
   interface settings (written to config.local.js, the page loads again after saving).
   Tag service: GET/POST /mac/settings (tags/macsettings.js), POST /essentia (upload). The folder and file dialog comes from the
   Mac program (message handler "xplorioChoose", tools/mac/Xplorio.swift), otherwise from the tag service (osascript).
   Classic script, shared global scope; see xplorio.html for load order. */
var overlayMacSettings = document.getElementById('overlayMacSettings');
var msBody = document.getElementById('msBody');
var msAudio = null, msAudioMsg = '', msAudioBusy = false, msAudioBad = false;
var msData = null, msSeq = 0, msMsg = '', msMsgBad = false, msSlot = 'USB', msEdit = {}, msChooseCb = null;
var MS_ERRORS = ['slot', 'path', 'inside', 'exists', 'notlink', 'lastfm', 'auth', 'value', 'fs'];
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
    else msAudioMsg = T(MS_AUDIO_ERRORS.indexOf(r && r.error) >= 0 ? 'mac.err.' + r.error : 'mac.err.audio.mpd');
    msRender();
  }).catch(function(){ if (seq === msSeq) { msAudioBusy = false; msAudioBad = true; msAudioMsg = T('mac.err.audio.mpd'); msRender(); } });
}
function msAudioCard() {
  var c = sysCard(T('mac.audio'), 'syWide'), a = msAudio;
  c.appendChild(histEl('div', 'syNote', T('mac.audioNote')));
  if (a) {
    a.outputs.forEach(function(o){
      var row = histEl('div', 'msItem');
      var tx = histEl('div', 'msItemText');
      tx.appendChild(histEl('div', 'msItemName', o.system ? T('mac.audioSystem') : o.name));
      tx.appendChild(histEl('div', 'msItemSub', o.system ? T('mac.audioSystemSub') : o.hog ? T('mac.audioExclusiveOn') : ''));
      row.appendChild(tx);
      if (o.enabled) row.appendChild(histEl('div', 'mxChip mxSmall on', T('mac.audioActive')));
      else row.appendChild(msButton(T('mac.audioUse'), function(){ if (!msAudioBusy) msAudioSend({action: 'audioSelect', id: o.id}); }));
      c.appendChild(row);
    });
    if (!a.outputs.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.audioNone')));
    if (a.canScan) {
      var ex = histEl('div', 'msSetRow');
      ex.appendChild(histEl('div', 'msSetLabel', T('mac.audioExclusive')));
      ex.appendChild(pbChips([[true, T('pb.on')], [false, T('pb.off')]], !!a.exclusive, function(v){
        if (!msAudioBusy) msAudioSend({action: 'audioScan', exclusive: v}, 'mac.audioScanned');
      }));
      c.appendChild(ex);
      c.appendChild(histEl('div', 'syNote', T('mac.audioExclusiveNote')));
      var row = histEl('div', 'pbRow msAddRow');
      row.appendChild(msButton(T('mac.audioScan'), function(){ if (!msAudioBusy) msAudioSend({action: 'audioScan', exclusive: !!a.exclusive}, 'mac.audioScanned'); }, 'on'));
      c.appendChild(row);
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
function msCanChoose() { return !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.xplorioChoose) || !!(msData && msData.mac); }

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

function msRender() {
  var d = msData;
  while (msBody.firstChild) msBody.removeChild(msBody.firstChild);
  var grid = histEl('div', 'syGridBox');
  msBody.appendChild(grid);
  if (msMsg) grid.appendChild(histEl('div', 'syNote pbFoot' + (msMsgBad ? ' syWarn' : ''), msMsg));
  if (!d) return;
  grid.appendChild(msMusicCard(d));
  grid.appendChild(msAudioCard());
  grid.appendChild(msEssentiaCard(d));
  grid.appendChild(msLastfmCard(d));
  grid.appendChild(msUiCard(d));
}

/* ---------- music folders ---------- */
function msMusicCard(d) {
  var c = sysCard(T('mac.music'), 'syWide');
  c.appendChild(histEl('div', 'syNote', T('mac.musicNote')));
  if (!d.music.length) c.appendChild(histEl('div', 'syNote syWarn', T('mac.musicNone')));
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
  return c;
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
