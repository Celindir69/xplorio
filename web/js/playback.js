/* Seite „Wiedergabe“ (Zahnrad-Menü): Crossfade und Lautstärke angleichen (ReplayGain) direkt in MPD, dazu Volumios
   Normalisierung zum Ansehen (ändern in Volumio) und ein Hinweis zur Automatik des AutoDJ-Plugins.
   Werte vom Tag-Dienst (GET/POST /playback, tags/playback.js). Mit Rotel (APP_CONFIG.ROTEL) außerdem eine Fernbedienung
   für den Verstärker: Bedienelemente laut Geräteprofil der Rotel-Bridge (GET /profile, rotel/rotel-bridge.js).
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
var overlayPlayback = document.getElementById('overlayPlayback');
var pbBody = document.getElementById('pbBody');
var pbData = null, pbSeq = 0, pbMsg = '', pbOffline = false;
var pbAmp = null, pbAmpProf = null, pbAmpState = null, pbAmpTimer = null, pbAmpDrag = false;
var PB_RG = ['off', 'track', 'album', 'auto'];

function pbLastXfade(v) {                                  /* zuletzt gewählte Sekunden, für „An“ */
  try {
    if (v) localStorage.setItem('xplorio.crossfade', String(v));
    return parseInt(localStorage.getItem('xplorio.crossfade'), 10) || 5;
  } catch (e) { return v || 5; }
}

/* amp: gleich zur Verstärker-Karte (Fernbedienungs-Symbol im Player) */
function openPlayback(amp) {
  closeAllOverlays();
  overlayPlayback.classList.add('on');
  pbSeq++; pbMsg = ''; pbOffline = false; pbData = null;
  while (pbBody.firstChild) pbBody.removeChild(pbBody.firstChild);
  pbBody.appendChild(browseNote(T('hist.loading')));
  pbLoad(amp);
  if (ROTEL_ON) pbAmpStart();
}
function pbLoad(amp) {
  var seq = pbSeq;
  tagGetJson('/playback').then(function(r){
    if (seq !== pbSeq) return;
    if (!r || !r.ok) throw new Error('keine Daten');
    pbData = r;
  }).catch(function(){ pbOffline = true; }).then(function(){
    if (seq !== pbSeq) return;
    pbRender();
    if (amp && pbAmp) setTimeout(function(){ if (seq === pbSeq) pbAmp.scrollIntoView({block: 'start', behavior: 'smooth'}); }, 350);   /* nach dem Einblenden */
  });
}
function pbSet(body) {
  var seq = pbSeq;
  pbMsg = '';
  return tagPostJson('/playback', body).then(function(r){
    if (seq !== pbSeq) return;
    if (r && r.ok) pbData = r; else pbMsg = T('pb.error');
    pbRender();
  }).catch(function(){ if (seq === pbSeq) { pbMsg = T('pb.error'); pbRender(); } });
}

/* again: auch der gewählte Eintrag sendet erneut (Verstärker, falls die Anzeige nicht zum Gerät passt) */
function pbChips(list, cur, fn, again) {
  var box = histEl('div', 'mxChips pbChips');
  list.forEach(function(it){
    var c = histEl('div', 'mxChip mxSmall' + (it[0] === cur ? ' on' : ''), it[1]);
    c.addEventListener('click', function(){ if (again || it[0] !== cur) fn(it[0]); });
    box.appendChild(c);
  });
  return box;
}

function pbRender() {
  var d = pbData;
  while (pbBody.firstChild) pbBody.removeChild(pbBody.firstChild);
  var grid = histEl('div', 'syGridBox');
  pbBody.appendChild(grid);
  if (!d) {                                                /* ohne Tag-Dienst: nur die Fernbedienung */
    grid.appendChild(histEl('div', 'syNote pbFoot', T('pb.offline')));
    if (ROTEL_ON) grid.appendChild(pbAmpCard());
    return;
  }

  /* Crossfade: an/aus und Sekunden */
  var xf = sysCard(T('pb.xfade'), 'syWide'), on = d.crossfade > 0;
  var row = histEl('div', 'pbRow');
  row.appendChild(pbChips([['off', T('pb.off')], ['on', T('pb.on')]], on ? 'on' : 'off', function(v){
    pbSet({crossfade: v === 'on' ? pbLastXfade() : 0});
  }));
  var inp = histEl('input', 'pbNum');
  inp.type = 'number'; inp.min = 1; inp.max = 30; inp.step = 1; inp.inputMode = 'numeric';
  inp.value = on ? d.crossfade : pbLastXfade();
  inp.setAttribute('aria-label', T('pb.seconds'));
  inp.addEventListener('change', function(){
    var v = String(inp.value).trim();
    if (!/^\d+$/.test(v) || +v < 1 || +v > 30) { pbMsg = T('pb.xfadeBad'); return pbRender(); }
    pbLastXfade(+v);
    if (on) pbSet({crossfade: +v}); else { pbMsg = ''; pbRender(); }
  });
  inp.addEventListener('keydown', function(ev){ if (ev.key === 'Enter') inp.blur(); });
  row.appendChild(inp);
  row.appendChild(histEl('span', 'sySub', T('pb.seconds')));
  xf.appendChild(row);
  if (pbMsg === T('pb.xfadeBad')) xf.appendChild(histEl('div', 'syNote syWarn', pbMsg));   /* gleich am Eingabefeld */
  xf.appendChild(histEl('div', 'syNote', T('pb.xfadeNote')));
  grid.appendChild(xf);

  /* ReplayGain */
  var rg = sysCard(T('pb.rg'), 'syWide');
  rg.appendChild(pbChips(PB_RG.map(function(m){ return [m, T('pb.rg.' + m)]; }), d.replaygain, function(m){ pbSet({replaygain: m}); }));
  rg.appendChild(histEl('div', 'syNote', T('pb.rgNote.' + (PB_RG.indexOf(d.replaygain) >= 0 ? d.replaygain : 'off'))));
  rg.appendChild(histEl('div', 'syNote', T('pb.rgTags')));
  grid.appendChild(rg);

  if (ROTEL_ON) grid.appendChild(pbAmpCard());

  /* Volumios Normalisierung: nur anzeigen, ändern in Volumio */
  var nm = sysCard(T('pb.norm'), 'syWide');
  var kv = histEl('div', 'syKv');
  kv.appendChild(histEl('span', 'syK', T('pb.normState')));
  kv.appendChild(histEl('span', 'syV', d.normalization === true ? T('pb.on') : d.normalization === false ? T('pb.off') : T('sys.none')));
  nm.appendChild(kv);
  nm.appendChild(histEl('div', 'syNote', T('pb.normNote')));
  var link = histEl('div', 'sHint listLink pbLink', T('pb.normLink'));
  link.addEventListener('click', function(){ openVolumio(); showVolumioPage(2); });
  nm.appendChild(link);
  grid.appendChild(nm);

  /* AutoDJ: Automatik im Plugin besser aus, wenn hier eingestellt */
  if (d.autodj) {
    var ad = sysCard(T('pb.autodj'), 'syWide'), auto = [];
    if (d.autodj.replayGain) auto.push(T('pb.autodjRg'));
    if (d.autodj.crossfade) auto.push(T('pb.autodjXf', {s: d.autodj.crossfade}));
    ad.appendChild(histEl('div', 'syNote', T('pb.autodjNote')));
    ad.appendChild(histEl('div', 'syNote' + (auto.length ? ' syWarn' : ''),
      auto.length ? T('pb.autodjOn', {list: auto.join(', ')}) : T('pb.autodjOff')));
    grid.appendChild(ad);
  }

  var err = pbMsg && pbMsg !== T('pb.xfadeBad') ? pbMsg : '';
  var foot = histEl('div', 'syNote pbFoot' + (err ? ' syWarn' : ''), err || T('pb.runtime'));
  grid.appendChild(foot);
}

/* ---------- Fernbedienung für den Rotel ---------- */
function pbNorm(x) { return String(x || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }   /* pcusb = pc_usb */
function pbAmpStart() {
  var seq = pbSeq;
  clearTimeout(pbAmpTimer);
  fetch(ROTEL + '/profile').then(function(r){ return r.json(); }).then(function(j){
    if (seq !== pbSeq) return;
    pbAmpProf = j && j.profile || null;
    pbAmpShow(j && j.state);
  }).catch(function(){ if (seq === pbSeq) { pbAmpProf = null; pbAmpShow(null); } });
  (function poll(){
    pbAmpTimer = setTimeout(function(){
      if (seq !== pbSeq || !overlayPlayback.classList.contains('on')) return;
      if (document.hidden || pbAmpDrag) return poll();
      fetch(ROTEL + '/state').then(function(r){ return r.json(); })
        .then(function(j){ if (seq === pbSeq) pbAmpShow(j && j.state); })
        .catch(function(){ if (seq === pbSeq) pbAmpShow(null); })
        .then(poll);
    }, 2000);
  })();
}
function pbAmpShow(st) {
  pbAmpState = st || null;
  if (st && typeof showRotel === 'function') showRotel(st);          /* Player-Anzeige gleich mitziehen */
  pbAmpPaint();
}
function pbAmpCmd(c) {
  if (!c) return;
  var seq = pbSeq;
  fetch(ROTEL + '/cmd?c=' + encodeURIComponent(c)).then(function(r){ return r.json(); })
    .then(function(j){ if (seq === pbSeq && j && j.state) pbAmpShow(j.state); })
    .catch(function(){});
  setTimeout(function(){                                   /* Rückmeldung des Verstärkers abholen */
    if (seq !== pbSeq) return;
    fetch(ROTEL + '/state').then(function(r){ return r.json(); }).then(function(j){ if (seq === pbSeq) pbAmpShow(j && j.state); }).catch(function(){});
  }, 450);
}
function pbAmpCard() {
  if (!pbAmp) pbAmp = sysCard(T('pb.amp'), 'syWide pbAmp');
  pbAmpPaint();
  return pbAmp;
}
function pbSigned(v) { return v > 0 ? '+' + v : String(v); }
function pbAmpPaint() {
  var card = pbAmp, p = pbAmpProf, st = pbAmpState;
  if (!card || pbAmpDrag) return;
  while (card.childNodes.length > 1) card.removeChild(card.lastChild);   /* Titel bleibt */
  if (!st) return card.appendChild(histEl('div', 'syNote', T('pb.ampOffline')));
  if (!st.connected) return card.appendChild(histEl('div', 'syNote', T('controls.rotel.notLinked')));
  function line(label, el) {
    var r = histEl('div', 'pbAmpRow');
    r.appendChild(histEl('span', 'pbAmpLabel', label));
    var box = histEl('div', 'pbAmpCtl');
    (Array.isArray(el) ? el : [el]).forEach(function(x){ box.appendChild(x); });
    r.appendChild(box);
    card.appendChild(r);
  }
  function chip(text, on, fn, cls) {
    var c = histEl('div', 'mxChip mxSmall' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), text);
    c.addEventListener('click', fn);
    return c;
  }
  var power = st.power !== false;
  line(T('pb.ampPower'), pbChips([['off', T('pb.ampStandby')], ['on', T('pb.on')]], power ? 'on' : 'off', function(){ btnRotelPower.click(); setTimeout(pbAmpStart, 600); }));
  if (!power) return;

  /* Lautstärke und Mute */
  var max = p && p.maxVol || +vSlider.max || 70, vol = typeof st.volume === 'number' ? st.volume : 0;
  var sl = histEl('input', 'pbVol'), val = histEl('span', 'pbAmpVal', String(vol));
  sl.type = 'range'; sl.min = 0; sl.max = max; sl.step = 1; sl.value = Math.min(vol, max);
  function fill() { var pc = sl.value / max * 100; sl.style.background = 'linear-gradient(to right, var(--accent, var(--fg)) ' + pc + '%, rgba(var(--fg-rgb),.25) ' + pc + '%)'; val.textContent = sl.value; }
  fill();
  sl.addEventListener('input', function(){ pbAmpDrag = true; fill(); });
  sl.addEventListener('change', function(){
    fetch(ROTEL + '/vol?v=' + sl.value).then(function(r){ return r.json(); })
      .then(function(j){ pbAmpDrag = false; if (j && j.state) pbAmpShow(j.state); })
      .catch(function(){ pbAmpDrag = false; });
  });
  line(T('pb.ampVol'), [sl, val, chip(T('pb.ampMute'), !!st.mute, function(){ pbAmpCmd(st.mute ? 'mute_off' : 'mute_on'); })]);

  if (!p) return card.appendChild(histEl('div', 'syNote', T('pb.ampOld')));

  /* Eingang */
  if (p.sources && p.sources.length) {
    var src = histEl('div', 'mxChips pbChips');
    p.sources.forEach(function(x){
      src.appendChild(chip(x.name, pbNorm(st.source) === pbNorm(x.cmd), function(){ pbAmpCmd(x.cmd); }));
    });
    line(T('pb.ampSource'), src);
  }

  /* Klang: Bypass, Bass, Höhen; Balance */
  if (p.bypass) line(T('pb.ampBypass'), [pbChips([['off', T('pb.off')], ['on', T('pb.on')]], st.bypass ? 'on' : 'off', function(v){ pbAmpCmd(p.cmd.bypass[v === 'on' ? 0 : 1]); }, true)]
    .concat(st.bypass && (p.cmd.bass || p.cmd.treble) ? [histEl('span', 'pbAmpHint', T('pb.ampBypassNote'))] : []));
  function stepper(key, label, fmt) {
    var cmd = p.cmd[key], v = st[key];
    if (!cmd) return;
    line(label, [chip('−', false, function(){ pbAmpCmd(cmd[1]); }, 'pbStep'),
                 histEl('span', 'pbAmpVal pbWide', typeof v === 'number' ? fmt(v) : '–'),
                 chip('+', false, function(){ pbAmpCmd(cmd[0]); }, 'pbStep'),
                 chip(T('pb.ampZero'), false, function(){ pbAmpCmd(cmd[2]); }, 'mxMore')]);
  }
  stepper('bass', T('pb.ampBass'), pbSigned);
  stepper('treble', T('pb.ampTreble'), pbSigned);
  if (p.cmd.balance) {
    var b = p.cmd.balance, bv = st.balance;
    line(T('pb.ampBalance'), [chip('L', false, function(){ pbAmpCmd(b[1]); }, 'pbStep'),
                              histEl('span', 'pbAmpVal pbWide', typeof bv !== 'number' ? '–' : bv === 0 ? '0' : (bv < 0 ? 'L ' : 'R ') + Math.abs(bv)),
                              chip('R', false, function(){ pbAmpCmd(b[0]); }, 'pbStep'),
                              chip(T('pb.ampCenter'), false, function(){ pbAmpCmd(b[2]); }, 'mxMore')]);
  }

  /* Lautsprecher A und B */
  var spk = [];
  if (p.cmd.speakerA) spk.push(chip('A', !!st.speakerA, function(){ pbAmpCmd(p.cmd.speakerA[st.speakerA ? 1 : 0]); }));
  if (p.cmd.speakerB) spk.push(chip('B', !!st.speakerB, function(){ pbAmpCmd(p.cmd.speakerB[st.speakerB ? 1 : 0]); }));
  if (spk.length) line(T('pb.ampSpeakers'), spk);
}

/* Fernbedienungs-Symbol oben rechts im Player, nur mit Rotel */
var btnRemote = document.getElementById('btnRemote');
if (ROTEL_ON) { btnRemote.style.display = ''; btnRemote.addEventListener('click', function(){ openPlayback(true); }); }

document.getElementById('closePlayback').addEventListener('click', function(){ pbSeq++; closeAllOverlays(); });
document.getElementById('playbackBack').addEventListener('click', function(){ pbSeq++; openMenu(); });
