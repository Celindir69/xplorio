/* Mood Mix (erster Reiter im Playlisten-Overlay): Stimmung, Energie und optional Stil wählen, Vorschau ansehen, dann Warteschlange ersetzen und spielen
   (Tag-Dienst GET /moodmix). Erstellen ändert die Warteschlange noch nicht; erst „Mix abspielen“.
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; nach check.js, history.js und discover.js geladen. */
var mixBody    = document.getElementById('mixBody');
var MIX_CORE   = ['relaxed', 'dreamy', 'uplifting', 'melancholic', 'dark', 'reflective', 'happy', 'romantic'];
var MIX_MORE   = ['calm', 'atmospheric', 'emotional', 'epic', 'intense', 'aggressive', 'sensual', 'sad'];
var MIX_DISC   = [[0, T('mix.disc.favorites')], [0.5, T('mix.disc.balanced')], [1, T('mix.disc.hidden')]];
var mixCrit    = {moods: [], emin: 1, emax: 5, bmin: 0, bmax: 0, ymin: 0, ymax: 0, styles: [], match: 'any', genres: [], n: 50, disc: 0.5, maxd: 20};
var MIX_MAXD   = 20;                           /* Vorgabe Höchstlänge je Titel in Minuten (DJ-Mixe draußen); 0 = keine Grenze */
var MIX_GENRES = 10;                           /* so viele Genre-Chips, der Rest hinter „mehr“ */
var MIX_BPM    = [60, 180, 5];                 /* Tempo-Regler: Ende links/rechts = offen (0) */
var mixState   = {view: 'pick', fine: false, more: false, styles: null, genres: null, genresMore: false, result: null};
var mixCountSeq = 0, mixCountTimer = null;

try { var saved = JSON.parse(localStorage.getItem('moodMix') || 'null'); if (saved && saved.moods) mixCrit = saved; } catch (e) { /* ohne Speicher */ }
if (!mixCrit.bmin) mixCrit.bmin = 0;
if (!mixCrit.bmax) mixCrit.bmax = 0;
if (!mixCrit.ymin) mixCrit.ymin = 0;
if (!mixCrit.ymax) mixCrit.ymax = 0;
if (!mixCrit.genres) mixCrit.genres = [];
if (typeof mixCrit.maxd !== 'number') mixCrit.maxd = MIX_MAXD;
function mixSave() { try { localStorage.setItem('moodMix', JSON.stringify(mixCrit)); } catch (e) { /* egal */ } }

function mixName(m) { var s = MOOD_NAMES[m] || m; return s.charAt(0).toUpperCase() + s.slice(1); }
function mixQuery() {
  return 'moods=' + encodeURIComponent(mixCrit.moods.join(',')) + '&emin=' + mixCrit.emin + '&emax=' + mixCrit.emax + '&bmin=' + mixCrit.bmin + '&bmax=' + mixCrit.bmax + '&ymin=' + mixCrit.ymin + '&ymax=' + mixCrit.ymax +
    '&styles=' + encodeURIComponent(mixCrit.styles.join(',')) + '&match=' + mixCrit.match +
    '&genres=' + encodeURIComponent(mixCrit.genres.join(',')) + '&n=' + mixCrit.n + '&disc=' + mixCrit.disc + '&maxd=' + mixCrit.maxd;
}
function mixClear() { while (mixBody.firstChild) mixBody.removeChild(mixBody.firstChild); }
function mixDuration(sec) {
  var m = Math.round(sec / 60);
  return m < 60 ? T('mix.duration.min', {m: m}) : T('mix.duration.hm', {h: Math.floor(m / 60), m: m % 60});
}
function mixEnergyDots(e) {
  if (!e) return '';
  var s = '';
  for (var i = 1; i <= 5; i++) s += i <= e ? '●' : '○';
  return s;
}

/* von außen: Reiter Mood Mix öffnen, optional mit einer Stimmung vorgewählt */
function openMoodMix(mood) {
  closeAllOverlays();
  if (mood) { mixCrit.moods = [mood]; mixState.view = 'pick'; }
  overlayPlaylists.classList.add('on');
  plShowTab(0);
}

function mixRender() {
  mixClear();
  if (mixState.view === 'preview' && mixState.result) return mixPreview();
  mixPick();
}

/* ---------- Auswahl ---------- */

function mixChip(label, on, onClick, cls) {
  var c = histEl('div', 'mxChip' + (on ? ' on' : '') + (cls ? ' ' + cls : ''), label);
  c.addEventListener('click', onClick);
  return c;
}

function mixPick() {
  mixBody.appendChild(histEl('div', 'mxAsk', T('mix.ask')));
  var chips = histEl('div', 'mxChips');
  function toggle(m) {
    var i = mixCrit.moods.indexOf(m);
    if (i >= 0) mixCrit.moods.splice(i, 1); else mixCrit.moods.push(m);
    mixCrit.styles = [];                                   /* Stile hängen an der Stimmung */
    mixRender();
  }
  var more = mixState.more || MIX_MORE.some(function(m){ return mixCrit.moods.indexOf(m) >= 0; });
  MIX_CORE.concat(more ? MIX_MORE : []).forEach(function(m){
    chips.appendChild(mixChip((mixCrit.moods.indexOf(m) >= 0 ? '✓ ' : '') + mixName(m), mixCrit.moods.indexOf(m) >= 0, function(){ toggle(m); }));
  });
  if (!more) chips.appendChild(mixChip(T('mix.more'), false, function(){ mixState.more = true; mixRender(); }, 'mxMore'));
  mixBody.appendChild(chips);

  /* Energie als Bereich 1–5 */
  var enLabel = histEl('div', 'mxLabel', T('mix.energy'));
  mixBody.appendChild(enLabel);
  mixDual(mixBody, 1, 5, 1, mixCrit.emin, mixCrit.emax, T('mix.energy.low'), T('mix.energy.high'), function(a, b){
    return a === 1 && b === 5 ? T('mix.all') : a === b ? String(a) : a + '–' + b;
  }, function(a, b){ mixCrit.emin = a; mixCrit.emax = b; mixCount(); }, enLabel);

  /* Genre (Genre-Tag des Albums); erscheint, sobald der Tag-Dienst Genres meldet */
  var genreWrap = histEl('div', 'mxGenre');
  genreWrap.appendChild(histEl('div', 'mxLabel', T('mix.genre')));
  var genreBox = histEl('div', 'mxChips mxGenres');
  genreWrap.appendChild(genreBox);
  mixBody.appendChild(genreWrap);
  mixState.genreWrap = genreWrap; mixState.genreBox = genreBox;
  mixGenres();

  /* Feinabstimmung */
  var fold = histEl('div', 'hFold mxFold' + (mixState.fine ? ' open' : ''));
  var fineLabel = histEl('span', '', '');
  fold.appendChild(fineLabel);
  mixState.fineLabel = fineLabel;
  mixFineLabel();
  var fine = histEl('div', 'mxFine');
  fine.style.display = mixState.fine ? '' : 'none';
  fold.addEventListener('click', function(){
    mixState.fine = !mixState.fine;
    fold.classList.toggle('open', mixState.fine);
    fine.style.display = mixState.fine ? '' : 'none';
  });
  mixBody.appendChild(fold); mixBody.appendChild(fine);

  fine.appendChild(histEl('div', 'mxLabel', T('mix.style')));
  var styleBox = histEl('div', 'mxChips mxStyles');
  fine.appendChild(styleBox);
  var matchBox = histEl('div', 'mxSeg');
  fine.appendChild(matchBox);
  mixState.styleBox = styleBox; mixState.matchBox = matchBox;
  mixStyles();

  /* Tempo (BPM) nur, wenn es Audio-Analysen gibt (tools/essentia); bis die Trefferzahl da ist, verborgen */
  var tempo = histEl('div', 'mxTempo');
  tempo.style.display = mixState.hasBpm || mixCrit.bmin || mixCrit.bmax ? '' : 'none';
  mixState.tempo = tempo;
  var tempoLabel = histEl('div', 'mxLabel', T('mix.tempo'));
  tempo.appendChild(tempoLabel);
  var bl = MIX_BPM[0], bh = MIX_BPM[1];
  mixDual(tempo, bl, bh, MIX_BPM[2], mixCrit.bmin || bl, mixCrit.bmax || bh, T('mix.tempo.slow'), T('mix.tempo.fast'), function(a, b){
    if (a === bl && b === bh) return T('mix.all');
    if (a === bl) return T('mix.bpm.max', {b: b});
    if (b === bh) return T('mix.bpm.min', {a: a});
    return a === b ? T('mix.bpm', {a: a}) : T('mix.bpm.range', {a: a, b: b});
  }, function(a, b){ mixCrit.bmin = a === bl ? 0 : a; mixCrit.bmax = b === bh ? 0 : b; mixCount(); }, tempoLabel);
  fine.appendChild(tempo);

  /* Jahre (Jahr des Albums); Regler von der Spanne der Sammlung, sobald die Trefferzahl sie meldet */
  var years = histEl('div', 'mxYears');
  mixState.years = years;
  fine.appendChild(years);
  mixYearsPaint();

  fine.appendChild(histEl('div', 'mxLabel', T('mix.length')));
  fine.appendChild(mixSeg([[25, T('mix.tracks', {n: 25})], [50, T('mix.tracks', {n: 50})], [100, T('mix.tracks', {n: 100})]], mixCrit.n, function(v){ mixCrit.n = v; }));
  fine.appendChild(histEl('div', 'mxLabel', T('mix.maxLen')));
  fine.appendChild(mixSeg([[0, T('mix.maxLen.none')], [10, T('mix.maxLen.min', {m: 10})], [20, T('mix.maxLen.min', {m: 20})], [30, T('mix.maxLen.min', {m: 30})]],
    mixCrit.maxd, function(v){ mixCrit.maxd = v; }));
  fine.appendChild(histEl('div', 'mxHint', T('mix.maxLen.hint')));
  fine.appendChild(histEl('div', 'mxLabel', T('mix.discovery')));
  fine.appendChild(mixSeg(MIX_DISC, mixCrit.disc, function(v){ mixCrit.disc = v; }));
  fine.appendChild(histEl('div', 'mxHint', T('mix.discovery.hint')));

  var hits = histEl('div', 'mxHits', ' ');
  mixState.hits = hits;
  mixBody.appendChild(hits);
  var go = histEl('button', 'mxGo', T('mix.build'));
  go.addEventListener('click', mixBuild);
  mixState.go = go;
  mixBody.appendChild(go);
  mixCount();
}

/* Bereich mit zwei Reglern übereinander (Energie, Tempo); fmt(a, b) -> Anzeige, set(a, b) bei jeder Änderung;
   label: Beschriftung, daneben „alle“ (setzt den Bereich zurück), solange ein Bereich gewählt ist */
function mixDual(parent, min, max, step, a0, b0, left, right, fmt, set, label) {
  var en = histEl('div', 'mxEnergy');
  var track = histEl('div', 'mxTrack'), fill = histEl('div', 'mxFill');
  track.appendChild(fill);
  var lo = document.createElement('input'), hi = document.createElement('input');
  [lo, hi].forEach(function(r){ r.type = 'range'; r.min = min; r.max = max; r.step = step; r.className = 'mxRange'; });
  lo.value = a0; hi.value = b0;
  var ends = histEl('div', 'mxEnds');
  ends.appendChild(histEl('span', '', left));
  var val = histEl('span', 'mxVal');
  ends.appendChild(val);
  ends.appendChild(histEl('span', '', right));
  var reset = null;
  if (label) {
    reset = histEl('span', 'mxReset', T('mix.all'));
    reset.title = T('mix.reset');
    reset.addEventListener('click', function(ev){
      ev.stopPropagation();
      lo.value = min; hi.value = max; changed(lo);
    });
    label.appendChild(reset);
  }
  function paint() {
    var a = +lo.value, b = +hi.value, w = max - min;
    if (reset) reset.style.display = a > min || b < max ? '' : 'none';
    fill.style.left = ((a - min) / w * 100) + '%';
    fill.style.right = ((max - b) / w * 100) + '%';
    val.textContent = fmt(a, b);
  }
  function changed(which) {
    var a = +lo.value, b = +hi.value;
    if (a > b) { if (which === lo) hi.value = b = a; else lo.value = a = b; }
    paint(); set(a, b);
  }
  lo.addEventListener('input', function(){ changed(lo); });
  hi.addEventListener('input', function(){ changed(hi); });
  en.appendChild(track); en.appendChild(lo); en.appendChild(hi);
  parent.appendChild(en); parent.appendChild(ends);
  paint();
}

/* Jahresregler: Ende links/rechts = offen (0); Spanne aus der Sammlung (auf Jahrzehnte gerundet), gewählte Grenzen immer darin */
function mixYearSpan() {
  var sp = mixState.yearSpan;
  if (!sp) return null;
  var lo = Math.floor(sp[0] / 10) * 10, hi = Math.max(sp[1], lo + 10);
  if (mixCrit.ymin && mixCrit.ymin <= lo) lo = Math.floor(mixCrit.ymin / 10) * 10 - 10;
  if (mixCrit.ymax && mixCrit.ymax >= hi) hi = mixCrit.ymax + 1;
  return [lo, hi];
}
function mixYearText(a, b) {
  if (!a && !b) return T('mix.all');
  if (!a) return T('mix.year.max', {b: b});
  if (!b) return T('mix.year.min', {a: a});
  return a === b ? String(a) : a + '\u2060–\u2060' + b;
}
function mixYearsPaint() {
  var box = mixState.years, sp = mixYearSpan();
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  box.style.display = sp ? '' : 'none';
  if (!sp) return;
  var lo = sp[0], hi = sp[1];
  var yearLabel = histEl('div', 'mxLabel', T('mix.years'));
  box.appendChild(yearLabel);
  mixDual(box, lo, hi, 1, mixCrit.ymin || lo, mixCrit.ymax || hi, T('mix.years.old'), T('mix.years.new'), function(a, b){
    return mixYearText(a === lo ? 0 : a, b === hi ? 0 : b);
  }, function(a, b){ mixCrit.ymin = a === lo ? 0 : a; mixCrit.ymax = b === hi ? 0 : b; mixCount(); }, yearLabel);
  box.appendChild(histEl('div', 'mxHint', T('mix.years.hint')));
}

/* Auswahl aus festen Werten (Länge, Entdeckungsgrad, Stil-Verknüpfung) */
function mixSeg(opts, cur, set) {
  var seg = histEl('div', 'mxSeg');
  opts.forEach(function(o){
    var b = histEl('div', 'mxSegB' + (o[0] === cur ? ' on' : ''), o[1]);
    b.addEventListener('click', function(){
      set(o[0]); mixSave();
      Array.prototype.forEach.call(seg.children, function(x){ x.classList.toggle('on', x === b); });
      mixCount();
    });
    seg.appendChild(b);
  });
  return seg;
}

/* Stil-Chips: die häufigsten Stile unter den Treffern der gewählten Stimmung */
function mixStyles() {
  var box = mixState.styleBox, mb = mixState.matchBox;
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  while (mb.firstChild) mb.removeChild(mb.firstChild);
  var list = mixState.styles || [];
  mixCrit.styles.forEach(function(s){ if (!list.some(function(x){ return x[0] === s; })) list = list.concat([[s, 0]]); });
  if (!list.length) { box.appendChild(histEl('div', 'mxHint', T('mix.noStyles'))); return; }
  list.slice(0, 16).forEach(function(x){
    var on = mixCrit.styles.indexOf(x[0]) >= 0;
    box.appendChild(mixChip((on ? '✓ ' : '') + x[0], on, function(){
      var i = mixCrit.styles.indexOf(x[0]);
      if (i >= 0) mixCrit.styles.splice(i, 1); else mixCrit.styles.push(x[0]);
      mixStyles(); mixCount();
    }, 'mxSmall'));
  });
  if (mixCrit.styles.length > 1) {
    mb.appendChild(mixSeg([['any', T('mix.match.any')], ['all', T('mix.match.all')]], mixCrit.match, function(v){ mixCrit.match = v; }));
  }
}

/* Genre-Chips: Genres unter den Treffern der gewählten Stimmung, die häufigsten zuerst */
function mixGenres() {
  var box = mixState.genreBox;
  if (!box) return;
  while (box.firstChild) box.removeChild(box.firstChild);
  var list = mixState.genres || [];
  mixCrit.genres.forEach(function(g){ if (!list.some(function(x){ return x[0].toLowerCase() === g; })) list = list.concat([[g, 0]]); });
  mixState.genreWrap.style.display = list.length ? '' : 'none';
  var on = function(x){ return mixCrit.genres.indexOf(x[0].toLowerCase()) >= 0; };
  var shown = mixState.genresMore ? list : list.filter(function(x, i){ return i < MIX_GENRES || on(x); });
  shown.forEach(function(x){
    box.appendChild(mixChip((on(x) ? '✓ ' : '') + x[0], on(x), function(){
      var g = x[0].toLowerCase(), i = mixCrit.genres.indexOf(g);
      if (i >= 0) mixCrit.genres.splice(i, 1); else mixCrit.genres.push(g);
      mixGenres(); mixCount();
    }, 'mxSmall'));
  });
  if (shown.length < list.length) box.appendChild(mixChip(T('mix.more'), false, function(){ mixState.genresMore = true; mixGenres(); }, 'mxMore mxSmall'));
}

/* Feinabstimmung zugeklappt, aber abweichend von den Vorgaben: „(aktiv)“ hinter der Überschrift */
function mixFineActive() {
  return mixCrit.styles.length > 0 || !!mixCrit.bmin || !!mixCrit.bmax || !!mixCrit.ymin || !!mixCrit.ymax || mixCrit.n !== 50 || mixCrit.disc !== 0.5 || mixCrit.maxd !== MIX_MAXD;
}
function mixFineLabel() {
  if (mixState.fineLabel) mixState.fineLabel.textContent = T('mix.fine') + (mixFineActive() ? ' ' + T('mix.fine.active') : '');
}

/* Trefferzahl live (kurz verzögert, damit der Regler nicht für jeden Schritt fragt) */
function mixCount() {
  mixSave();
  mixFineLabel();
  clearTimeout(mixCountTimer);
  var seq = ++mixCountSeq;
  mixCountTimer = setTimeout(function(){
    tagGetJson('/moodmix?count=1&' + mixQuery()).then(function(r){
      if (seq !== mixCountSeq || !mixState.hits) return;
      mixState.hasBpm = r.bpm > 0;
      if (mixState.tempo && mixState.hasBpm) mixState.tempo.style.display = '';
      var yk = JSON.stringify(r.years || null);
      if (yk !== mixState.yearKey) { mixState.yearKey = yk; mixState.yearSpan = r.years || null; mixYearsPaint(); }
      var styleKey = JSON.stringify(r.styles || []);
      if (styleKey !== mixState.styleKey) { mixState.styleKey = styleKey; mixState.styles = r.styles || []; mixStyles(); }
      var genreKey = JSON.stringify(r.genres || []);
      if (genreKey !== mixState.genreKey) { mixState.genreKey = genreKey; mixState.genres = r.genres || []; mixGenres(); }
      var h = mixState.hits;
      h.className = 'mxHits';
      if (!r.rated) {
        h.textContent = T('mix.hits.unrated');
        mixState.go.disabled = true;
        return;
      }
      mixState.go.disabled = false;
      if (!r.count) { h.textContent = mixCrit.ymin || mixCrit.ymax ? T('mix.hits.noneYears') : mixCrit.bmin || mixCrit.bmax ? T('mix.hits.noneTempo') : T('mix.hits.none'); h.className += ' warn'; }
      else if (r.count < Math.min(mixCrit.n, 20)) { h.textContent = T('mix.hits.few', {n: r.count}); h.className += ' warn'; }
      else if (r.count < mixCrit.n) h.textContent = T('mix.hits.short', {n: r.count});
      else h.textContent = T('mix.hits.ok', {n: r.count});
    }).catch(function(){ if (seq === mixCountSeq && mixState.hits) mixState.hits.textContent = T('mix.offline'); });
  }, 200);
}

function mixBuild() {
  if (mixState.go) { mixState.go.disabled = true; mixState.go.textContent = T('mix.building'); }
  tagGetJson('/moodmix?' + mixQuery()).then(function(r){
    if (!r || !r.ok) throw new Error('kein Ergebnis');
    mixState.result = r;
    mixState.view = 'preview';
    mixRender();
    mixBody.scrollTop = 0;
  }).catch(function(){
    if (mixState.go) { mixState.go.disabled = false; mixState.go.textContent = T('mix.build'); }
    if (mixState.hits) mixState.hits.textContent = T('mix.buildFailed');
  });
}

/* ---------- Vorschau ---------- */

function mixSummary() {
  var parts = mixCrit.moods.map(mixName);
  if (!parts.length) parts.push(T('mix.sum.allMoods'));
  parts.push(mixCrit.emin === 1 && mixCrit.emax === 5 ? T('mix.sum.anyEnergy') : T('mix.sum.energy', {e: mixCrit.emin === mixCrit.emax ? mixCrit.emin : mixCrit.emin + '\u2060–\u2060' + mixCrit.emax}));
  if (mixCrit.bmin || mixCrit.bmax) parts.push(!mixCrit.bmax ? T('mix.sum.bpmMin', {a: mixCrit.bmin}) : !mixCrit.bmin ? T('mix.sum.bpmMax', {b: mixCrit.bmax}) :
    T('mix.sum.bpmRange', {a: mixCrit.bmin, b: mixCrit.bmax}));
  if (mixCrit.ymin || mixCrit.ymax) parts.push(mixYearText(mixCrit.ymin, mixCrit.ymax));
  var gs = mixCrit.genres;                     /* ohne Auswahl: die Genres im Ergebnis */
  if (!gs.length && mixState.result) mixState.result.tracks.forEach(function(x){ var g = String(x.ge || '').toLowerCase(); if (g && gs.indexOf(g) < 0) gs = gs.concat([g]); });
  if (gs.length) parts.push(gs.length === 1 ? mixGenreName(gs[0]) : T('mix.sum.genres', {n: gs.length}));
  return parts.join(' · ');
}

/* gewählte Genres stehen klein geschrieben in mixCrit; angezeigt wird die Schreibweise der Bibliothek */
function mixGenreName(g) {
  var all = (mixState.genres || []).concat((mixState.result && mixState.result.tracks || []).map(function(x){ return [x.ge || '']; }));
  for (var i = 0; i < all.length; i++) if (String(all[i][0]).toLowerCase() === g) return all[i][0];
  return g.charAt(0).toUpperCase() + g.slice(1);
}

function mixPreview() {
  var r = mixState.result, tracks = r.tracks;
  var head = histEl('div', 'mxHead');
  var info = histEl('div', 'mxSum');
  info.appendChild(histEl('div', 'mxSumT', mixSummary()));
  if (mixCrit.genres.length > 1) info.appendChild(histEl('div', 'mxSumS', mixCrit.genres.map(mixGenreName).join(' · ')));
  if (mixCrit.styles.length) info.appendChild(histEl('div', 'mxSumS', mixCrit.styles.join(mixCrit.match === 'all' ? ' + ' : ' · ')));
  var total = tracks.reduce(function(s, x){ return s + (x.d || 0); }, 0);
  head.appendChild(info);
  var edit = histEl('div', 'mxEdit', T('mix.edit'));
  edit.addEventListener('click', function(){ mixState.view = 'pick'; mixRender(); });
  head.appendChild(edit);
  mixBody.appendChild(head);

  var wide = mixCrit.bmin || mixCrit.bmax;              /* Energie und Tempo gelockert, sonst nur Energie */
  if (r.level) mixBody.appendChild(histEl('div', 'mxHits warn', r.level === 1
    ? (wide ? T('mix.level1.tempo') : T('mix.level1'))
    : (wide ? T('mix.level2.tempo') : T('mix.level2'))));
  if (!tracks.length) {
    mixBody.appendChild(histEl('div', 'mxHits', T('mix.empty')));
    return;
  }

  var reroll = histEl('button', 'mxIcon', '');
  reroll.title = T('mix.reroll');
  reroll.innerHTML = '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
  reroll.addEventListener('click', function(ev){ ev.stopPropagation(); reroll.classList.add('spin'); mixBuild(); });
  var add = queueAddButton(function(){ return mixItems(tracks); }, tracks.length);
  mixBody.appendChild(playRow(T('mix.play'), T('mix.tracks', {n: tracks.length}) + (total ? ' · ' + mixDuration(total) : ''),
    function(){ mixPlay(tracks, true); }, [reroll, add]));   /* Zeile wie auf Album- und Künstlerseite (browse.js) */
  mixBody.appendChild(listHint(T('mix.hint')));

  var list = histEl('div', 'mxList');
  tracks.forEach(function(x, i){
    var dir = x.f.replace(/\/[^\/]*$/, '');
    var row = histEl('div', 'sRow mxRow');
    row.appendChild(histEl('div', 'mxNo', String(i + 1)));
    row.appendChild(histImg(histAlbumArt(x.ar, x.al, dir)));
    var meta = histEl('div', 'sMeta');
    meta.appendChild(histEl('div', 'sTitle', x.ti));
    meta.appendChild(histEl('div', 'sSub', x.ar));
    var why = x.mood.map(mixName).concat(x.y && (mixCrit.ymin || mixCrit.ymax) ? [String(x.y)] : [], x.ge ? [x.ge] : [], x.style.slice(0, 2));
    if (x.bpm) why.push(x.bpm + '\u00a0BPM');
    if (x.src === 'artist') why.push(T('mix.why.artist'));
    meta.appendChild(histEl('div', 'mxWhy', why.join(' · ')));
    row.appendChild(meta);
    row.appendChild(histEl('div', 'mxDots', mixEnergyDots(x.energy)));
    var del = histEl('div', 'mxDel');
    del.title = T('mix.remove');
    del.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>';
    del.addEventListener('click', function(e){
      e.stopPropagation();
      tracks.splice(tracks.indexOf(x), 1);
      var keep = mixBody.scrollTop;
      mixRender();
      mixBody.scrollTop = keep;
    });
    row.appendChild(del);
    row.addEventListener('click', function(){ mixPlay(tracks.slice(tracks.indexOf(x)), true); });   /* ab diesem Titel */
    list.appendChild(row);
  });
  mixBody.appendChild(list);
}

/* replace: Warteschlange ersetzen und ab Titel 1 spielen; sonst hinten anhängen */
function mixItems(tracks) {
  return tracks.map(function(x){
    return {uri: 'music-library/' + x.f, service: 'mpd', type: 'song', title: x.ti, artist: x.ar, album: x.al};
  });
}
function mixPlay(tracks, replace) {
  var items = mixItems(tracks);
  if (!replace) { socket.emit('addToQueue', items); closeAllOverlays(); showToast(T('mix.added', {n: items.length})); return; }
  if (queueForInput(items)) return;
  fetch('/api/v1/replaceAndPlay', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({item: items[0]})
  }).then(function(){
    if (items.length > 1) setTimeout(function(){ socket.emit('addToQueue', items.slice(1)); }, 300);
  }).catch(function(){});
  closeAllOverlays();
}

/* Reiter nur zeigen, wenn der Tag-Dienst läuft; beim ersten Mal (noch nichts gewählt) mit dem Mix beginnen */
whenTags(function(){
  document.getElementById('plTab0').style.display = '';
  var stored = null;
  try { stored = localStorage.getItem('plTab'); } catch (e) { /* egal */ }
  if (stored === null || stored === '0') plTabActive = 0;
});
