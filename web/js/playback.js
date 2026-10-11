/* Seite „Wiedergabe“ (Zahnrad-Menü): Crossfade und Lautstärke angleichen (ReplayGain) direkt in MPD, dazu Volumios
   Normalisierung zum Ansehen (ändern in Volumio) und ein Hinweis zur Automatik des AutoDJ-Plugins.
   Werte vom Tag-Dienst (GET/POST /playback, tags/playback.js).
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
var overlayPlayback = document.getElementById('overlayPlayback');
var pbBody = document.getElementById('pbBody');
var pbData = null, pbSeq = 0, pbMsg = '';
var PB_RG = ['off', 'track', 'album', 'auto'];

function pbLastXfade(v) {                                  /* zuletzt gewählte Sekunden, für „An“ */
  try {
    if (v) localStorage.setItem('xplorio.crossfade', String(v));
    return parseInt(localStorage.getItem('xplorio.crossfade'), 10) || 5;
  } catch (e) { return v || 5; }
}

function openPlayback() {
  closeAllOverlays();
  overlayPlayback.classList.add('on');
  pbSeq++; pbMsg = '';
  while (pbBody.firstChild) pbBody.removeChild(pbBody.firstChild);
  pbBody.appendChild(browseNote(T('hist.loading')));
  pbLoad();
}
function pbLoad() {
  var seq = pbSeq;
  tagGetJson('/playback').then(function(r){
    if (seq !== pbSeq) return;
    if (!r || !r.ok) throw new Error('keine Daten');
    pbData = r; pbRender();
  }).catch(function(){
    if (seq !== pbSeq) return;
    while (pbBody.firstChild) pbBody.removeChild(pbBody.firstChild);
    pbBody.appendChild(browseNote(T('pb.offline')));
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

function pbChips(list, cur, fn) {
  var box = histEl('div', 'mxChips pbChips');
  list.forEach(function(it){
    var c = histEl('div', 'mxChip mxSmall' + (it[0] === cur ? ' on' : ''), it[1]);
    c.addEventListener('click', function(){ if (it[0] !== cur) fn(it[0]); });
    box.appendChild(c);
  });
  return box;
}

function pbRender() {
  var d = pbData;
  while (pbBody.firstChild) pbBody.removeChild(pbBody.firstChild);
  var grid = histEl('div', 'syGridBox');
  pbBody.appendChild(grid);

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

document.getElementById('closePlayback').addEventListener('click', function(){ pbSeq++; closeAllOverlays(); });
document.getElementById('playbackBack').addEventListener('click', function(){ pbSeq++; openMenu(); });
