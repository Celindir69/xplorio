/* Verlauf und Statistik: zuletzt gespielt, meistgespielt, Statistik und Last.fm (Tag-Dienst GET /plays, /lastfm).
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; nach tagedit.js und browse.js geladen. */
var overlayHistory = document.getElementById('overlayHistory');
var histBody       = document.getElementById('histBody');
var histTab        = 'recent';
var histKind       = 'track';
var histRange      = 'd30';
var histSeq        = 0;          /* verwirft Antworten veralteter Anfragen */
var histTimer      = null;
/* kurze Namen in der Sprache, ohne Abkürzungspunkt ("Mo." -> "Mo") */
var HIST_DAYS      = langWeekdays('short').map(function(x){ return x.replace(/\.$/, ''); });
var HIST_MONTHS    = langMonths('short').map(function(x){ return x.replace(/\.$/, ''); });
var HIST_RANGES    = [['d30', T('hist.range.d30')], ['m12', T('hist.range.m12')], ['all', T('hist.range.all')]];
var HIST_KINDS     = [['track', T('hist.kind.track')], ['album', T('hist.kind.album')], ['artist', T('hist.kind.artist')], ['genre', T('hist.kind.genre')]];

function histClear() { while (histBody.firstChild) histBody.removeChild(histBody.firstChild); }
function histEl(tag, cls, text) {
  var el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}
function histTwo(n) { return (n < 10 ? '0' : '') + n; }
function histDay(t) {
  var d = new Date(t * 1000), today = new Date();
  today.setHours(0, 0, 0, 0);
  var diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff === 0) return T('hist.today');
  if (diff === 1) return T('hist.yesterday');
  return T('hist.dayDate', {day: HIST_DAYS[(d.getDay() + 6) % 7], date: langDate(d)});
}
/* wie histDay, aber "heute"/"gestern" klein (mitten im Satz) */
function histDayLower(t) {
  var s = histDay(t);
  return s === T('hist.today') || s === T('hist.yesterday') ? s.toLowerCase() : s;
}
function histTz() {
  var y = new Date().getFullYear();
  return '&tzw=' + (-new Date(y, 0, 1).getTimezoneOffset()) + '&tzs=' + (-new Date(y, 6, 1).getTimezoneOffset());
}

function openHistory() {
  closeAllOverlays();
  overlayHistory.classList.add('on');
  histShow(histTab);
}

function histShow(tab) {
  histTab = tab;
  clearTimeout(histTimer);
  document.querySelectorAll('#histTabBar .qTab').forEach(function(t){ t.className = 'qTab' + (t.dataset.tab === tab ? ' on' : ''); });
  histBody.scrollTop = 0;
  histClear();
  histBody.appendChild(browseNote(T('hist.loading')));
  var seq = ++histSeq;
  if (tab === 'recent') histRecent(seq);
  else if (tab === 'top') histTop(seq);
  else if (tab === 'year') histYear(seq);
  else histStats(seq);
}

function histFail(seq) {
  if (seq !== histSeq) return;
  histClear();
  histBody.appendChild(browseNote(T('hist.offlinePort', {port: (window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766})));
}

/* Auswahl-Knöpfe (Zeitraum, Art) */
function histChips(list, cur, onPick) {
  var row = histEl('div', 'hChips');
  list.forEach(function(it){
    var b = histEl('button', 'hChip' + (it[0] === cur ? ' on' : ''), it[1]);
    b.addEventListener('click', function(){ onPick(it[0]); });
    row.appendChild(b);
  });
  return row;
}

/* ---------- Bilder (Volumios /albumart mit Zwischenspeicher; lokal aus dem Ordner, sonst einmal online) ---------- */

/* uri bzw. Ordner relativ zu /mnt ("USB/…"); '' bei TIDAL und Co. */
function histRel(u) {
  if (!u || /^([a-z]+:\/\/|(tidal|qobuz|hra|highresaudio|hi_res_audio)\/|spotify:)/i.test(u)) return '';
  return u.replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
}
function histAlbumArt(artist, album, dir) {
  var web = artist && album && artist !== 'Verschiedene' ? 'web=' + encodeURIComponent(artist) + '/' + encodeURIComponent(album) + '/extralarge' : '';
  var path = dir ? 'path=' + encodeURIComponent('/mnt/' + dir) : '';
  return web || path ? '/albumart?' + [web, path].filter(Boolean).join('&') : '';
}
/* Künstlerfoto vom Tag-Dienst (Deezer); gibt es keins, Volumios Künstler-Symbol */
function histArtistArt(artist) { return TAGS + '/artistimage?name=' + encodeURIComponent(artist); }
function histArtistFallback(img, artist) {
  img.addEventListener('error', function once(){
    img.removeEventListener('error', once);
    img.src = artUrl('/albumart?web=' + encodeURIComponent(artist) + '/large&icon=users');
  });
}
function histImg(src, round) {
  var img = histEl('img', 'sCover' + (round ? ' hRound' : ''));
  img.loading = 'lazy';
  img.decoding = 'async';
  if (src) img.src = artUrl(src);
  return img;
}
function histTrackArt(e) {
  var rel = histRel(e.u);
  return histAlbumArt(e.ar, e.al, rel ? rel.replace(/\/[^\/]*$/, '') : '');
}

/* ---------- Abspielen und Öffnen ---------- */

function histPlayUri(uri, service, e) {
  if (queueForInput([{uri: uri, service: service, type: 'song', title: e.ti, artist: e.ar, album: e.al || ''}])) return;
  fetch('/api/v1/replaceAndPlay', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({item: {uri: uri, service: service, type: 'song', title: e.ti, artist: e.ar, album: e.al || ''}})
  }).catch(function(){});
  closeAllOverlays();
}

function histPlay(e) {
  if (e.u) return histPlayUri(e.u, e.s && e.s !== 'lastfm' ? e.s : 'mpd', e);
  tagGetJson('/plays/resolve?artist=' + encodeURIComponent(e.ar) + '&title=' + encodeURIComponent(e.ti)).then(function(r){
    if (r && r.file) histPlayUri('music-library/' + r.file, 'mpd', e);
    else showToast(T('hist.notInLibrary', {title: e.ti}));
  }).catch(function(){ showToast(T('hist.offline')); });
}

function histRow(title, sub, right, onClick, img) {
  var row = histEl('div', 'sRow hRow');
  if (img) row.appendChild(img);
  var meta = histEl('div', 'sMeta');
  meta.appendChild(histEl('div', 'sTitle', title));
  if (sub) meta.appendChild(histEl('div', 'sSub', sub));
  row.appendChild(meta);
  if (right) row.appendChild(histEl('div', 'hRight', right));
  row.addEventListener('click', onClick);
  return row;
}

/* ---------- Zuletzt gespielt ---------- */

function histRecent(seq) {
  var lastDay = '', before = 0;
  function more(btn) {
    tagGetJson('/plays?view=recent&limit=100' + (before ? '&before=' + before : '')).then(function(r){
      if (seq !== histSeq) return;
      if (!btn) histClear();
      else btn.parentNode.removeChild(btn);
      var items = (r && r.items) || [];
      if (!before && !items.length) {
        histBody.appendChild(browseNote(r && r.recording === false
          ? T('hist.recent.off')
          : T('hist.recent.empty')));
        return;
      }
      items.forEach(function(e){
        var day = histDay(e.t);
        if (day !== lastDay) { histBody.appendChild(browseHeading(day)); lastDay = day; }
        var d = new Date(e.t * 1000);
        histBody.appendChild(histRow(e.ti, e.ar + (e.al ? ' · ' + e.al : ''), histTwo(d.getHours()) + ':' + histTwo(d.getMinutes()),
                                     function(){ histPlay(e); }, histImg(histTrackArt(e))));
        before = e.t;
      });
      if (items.length >= 100) {
        var b = histEl('div', 'ckMore', T('hist.recent.older'));
        b.addEventListener('click', function(){ b.textContent = T('hist.loading'); more(b); });
        histBody.appendChild(b);
      }
    }).catch(function(){ histFail(seq); });
  }
  more(null);
}

/* ---------- Meistgespielt ---------- */

/* eine Zeile mit Rang, Bild und Anzahl; kind track|album|artist|genre (Bild: meistgespieltes Album des Genres) */
/* Sampler: der Tag-Dienst nennt den Künstler intern 'Verschiedene'; angezeigt in der gewählten Sprache */
function histArtistName(ar) { return ar === 'Verschiedene' ? T('hist.various') : ar; }

function histTopRow(kind, it, i) {
  if (kind === 'genre') {
    var grow = histRow(it.g, '', it.n + '×', function(){ genreFromAnywhere(it.g); }, histImg(histAlbumArt(it.ar || '', it.al || '', it.u || '')));
    grow.insertBefore(histEl('div', 'hRank', String(i + 1)), grow.firstChild);
    return grow;
  }
  var title = kind === 'artist' ? it.ar : it.ti;
  var sub = kind === 'artist' ? '' : (kind === 'track' && it.al ? it.ar + ' · ' + it.al : histArtistName(it.ar));
  var art = kind === 'artist' ? histArtistArt(it.ar)
          : kind === 'album' ? histAlbumArt(it.ar, it.ti, it.u || '')
          : histTrackArt(it);
  var row = histRow(title, sub, it.n + '×', function(){
    if (kind === 'track') return histPlay({ti: it.ti, ar: it.ar, al: it.al, u: it.u});
    if (kind === 'artist') return openBrowse({kind: 'artist', artist: it.ar});
    openBrowse({kind: 'album', artist: it.ar === 'Verschiedene' ? '' : it.ar, album: it.ti, uri: it.u ? 'music-library/' + it.u : undefined,
                albumart: art});
  }, histImg(art, kind === 'artist'));
  if (kind === 'artist') histArtistFallback(row.querySelector('img'), it.ar);
  row.insertBefore(histEl('div', 'hRank', String(i + 1)), row.firstChild);
  return row;
}

function histTop(seq) {
  tagGetJson('/plays?view=top&limit=100&kind=' + histKind + '&range=' + histRange).then(function(r){
    if (seq !== histSeq) return;
    histClear();
    histBody.appendChild(histChips(HIST_KINDS, histKind, function(k){ histKind = k; histShow('top'); }));
    histBody.appendChild(histChips(HIST_RANGES, histRange, function(k){ histRange = k; histShow('top'); }));
    var items = (r && r.items) || [];
    if (!items.length) { histBody.appendChild(browseNote(r && r.building ? T('disc.building') : T('hist.top.empty'))); return; }
    items.forEach(function(it, i){ histBody.appendChild(histTopRow(histKind, it, i)); });
  }).catch(function(){ histFail(seq); });
}

/* ---------- Statistik ---------- */

function histNum(n) { return langNum(n); }

/* Balken: Tippen (oder Mauszeiger) zeigt den Wert in der Überschrift; details[i] ist die ausführliche Beschriftung */
/* opts.onSel(i oder -1): Tippen wählt einen Balken aus (Rückblick: Monat), opts.sel ist vorgewählt */
function histBars(title, values, labels, every, details, opts) {
  opts = opts || {};
  var box = histEl('div', 'hChart');
  var head = browseHeading(title);
  var info = histEl('span', 'hPick');
  head.appendChild(info);
  box.appendChild(head);
  var max = Math.max.apply(null, values.concat([1]));
  var bars = histEl('div', 'hBars'), lab = histEl('div', 'hLabels'), picked = null;
  function pick(b, i) {
    if (picked) picked.classList.remove('on');
    if (picked === b) { picked = null; info.textContent = ''; return; }
    picked = b; b.classList.add('on');
    info.textContent = (details || labels)[i] + ': ' + histNum(values[i]);
  }
  values.forEach(function(v, i){
    var b = histEl('div', 'hBar');
    var fill = histEl('div', 'hFill');
    fill.style.height = Math.round(v / max * 100) + '%';
    b.appendChild(fill);
    if (i === opts.sel) b.classList.add('sel');
    b.addEventListener('click', function(){ if (opts.onSel) opts.onSel(i === opts.sel ? -1 : i); else pick(b, i); });
    b.addEventListener('pointerenter', function(e){ if (e.pointerType === 'mouse' && picked !== b) pick(b, i); });   /* Touch: nur Tippen */
    bars.appendChild(b);
    lab.appendChild(histEl('div', 'hLabel', i % every === 0 ? labels[i] : ''));
  });
  bars.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse' && picked) pick(picked, 0); });
  if (opts.onSel) bars.classList.add('hSelect');
  if (opts.onSel && opts.sel >= 0) bars.classList.add('hHasSel');
  if (opts.sel >= 0) info.textContent = (details || labels)[opts.sel] + ': ' + histNum(values[opts.sel]);
  box.appendChild(bars); box.appendChild(lab);
  return box;
}

/* Genres als waagrechte Balken (Wiedergaben); Tippen öffnet die Genre-Seite (genre.js) */
function histGenreBars(title, list) {
  var box = histEl('div', 'hChart');
  box.appendChild(browseHeading(title));
  var max = Math.max.apply(null, list.map(function(g){ return g.n; }).concat([1]));
  list.forEach(function(g){
    var row = histEl('div', 'hgRow');
    row.appendChild(histEl('div', 'hgName', g.g));
    var bar = histEl('div', 'hgBar'), fill = histEl('div', 'hFill');
    fill.style.width = Math.round(g.n / max * 100) + '%';
    bar.appendChild(fill);
    row.appendChild(bar);
    row.appendChild(histEl('div', 'hgN', histNum(g.n)));
    if (typeof genreFromAnywhere === 'function') row.addEventListener('click', function(){ genreFromAnywhere(g.g); });
    box.appendChild(row);
  });
  return box;
}

function histStats(seq) {
  Promise.all([
    tagGetJson('/plays?view=stats&range=' + histRange + histTz()),
    tagGetJson('/lastfm').catch(function(){ return null; })
  ]).then(function(rs){
    if (seq !== histSeq) return;
    histClear();
    var s = rs[0] && rs[0].stats;
    histBody.appendChild(histChips(HIST_RANGES, histRange, function(k){ histRange = k; histShow('stats'); }));
    if (s) {
      var hours = Math.round(s.seconds / 3600);
      var grid = histEl('div', 'hNums');
      [[histNum(s.plays), T('hist.stat.plays')], [T('hist.hours', {n: hours}), s.estimated ? T('hist.stat.timeApprox') : T('hist.stat.time')],
       [histNum(s.tracks), T('hist.kind.track')], [histNum(s.artists), T('hist.kind.artist')], [histNum(s.albums), T('hist.kind.album')]].forEach(function(n){
        var c = histEl('div', 'hNum');
        c.appendChild(histEl('div', 'hBig', n[0]));
        c.appendChild(histEl('div', 'hSmall', n[1]));
        grid.appendChild(c);
      });
      histBody.appendChild(grid);
      if (s.plays) {
        var labels = s.buckets.map(function(b){
          var p = b.k.split('-');
          return s.unit === 'day' ? String(parseInt(p[2], 10)) : s.unit === 'month' ? HIST_MONTHS[parseInt(p[1], 10) - 1] : p[0];
        });
        var every = s.unit === 'day' ? 5 : s.unit === 'month' ? 2 : Math.max(1, Math.ceil(labels.length / 8));
        var details = s.buckets.map(function(b){
          var p = b.k.split('-');
          if (s.unit === 'day') {
            var d = new Date(+p[0], +p[1] - 1, +p[2]);
            return T('hist.dayDate', {day: HIST_DAYS[(d.getDay() + 6) % 7], date: langDate(d, {day: 'numeric', month: 'numeric'})});
          }
          return s.unit === 'month' ? HIST_MONTHS[+p[1] - 1] + ' ' + p[0] : p[0];
        });
        histBody.appendChild(histBars(s.unit === 'day' ? T('hist.chart.perDay') : s.unit === 'month' ? T('hist.chart.perMonth') : T('hist.chart.perYear'),
          s.buckets.map(function(b){ return b.n; }), labels, every, details));
        histBody.appendChild(histBars(T('hist.chart.hour'), s.hours, s.hours.map(function(v, i){ return String(i); }), 6,
          s.hours.map(function(v, i){ return T('hist.hourRange', {from: i, to: i + 1}); })));
        histBody.appendChild(histBars(T('hist.chart.weekday'), s.weekdays, HIST_DAYS, 1, langWeekdays('long')));
        if (s.genres && s.genres.length) histBody.appendChild(histGenreBars(T('hist.chart.genres'), s.genres));
      }
      if (s.first) histBody.appendChild(browseNote(T('hist.since', {day: histDayLower(s.first)})));
    }
    histBody.appendChild(histLastfm(rs[1] && rs[1].lastfm, seq));
  }).catch(function(){ histFail(seq); });
}

/* ---------- Jahresrückblick ---------- */

var histYearSel = 0;            /* 0: neuestes Jahr */
var histYearOpen = {};
var histYearMonth = -1;         /* gewählter Monat (0-11) für die Ranglisten, -1: ganzes Jahr */          /* aufgeklappte Rubriken im Rückblick */
var HIST_MONTHS_FULL = langMonths('long');

/* Veränderung zum Vorjahr in Prozent, '' ohne Vorjahr */
function histDelta(now, before) {
  if (!before) return '';
  var p = Math.round((now - before) / before * 100);
  return (p > 0 ? '+' : p < 0 ? '−' : '±') + T('hist.percent', {n: Math.abs(p)});
}

function histYear(seq) {
  tagGetJson('/plays?view=year' + (histYearSel ? '&y=' + histYearSel : '') + (histYearMonth >= 0 ? '&m=' + (histYearMonth + 1) : '') + histTz()).then(function(r){
    if (seq !== histSeq) return;
    var keep = histBody.scrollTop;                       /* Monat gewählt: an der Stelle bleiben */
    histClear();
    var y = r && r.review, years = (r && r.years) || [];
    if (!y || !years.length) { histBody.appendChild(browseNote(T('hist.year.empty'))); return; }
    if (years.length > 1) histBody.appendChild(histChips(years.map(function(v){ return [v, String(v)]; }), y.year, function(v){ histYearSel = v; histYearMonth = -1; histShow('year'); }));
    if (!y.plays) { histBody.appendChild(browseNote(T('hist.year.nothing', {year: y.year}))); return; }
    var hp = Math.round(y.prev.seconds / 3600), hours = Math.round(y.seconds / 3600);
    var grid = histEl('div', 'hNums');
    [[histNum(y.plays), T('hist.stat.plays'), histDelta(y.plays, y.prev.plays)],
     [T('hist.hours', {n: hours}), y.estimated ? T('hist.stat.timeApprox') : T('hist.stat.time'), histDelta(hours, hp)],
     [histNum(y.tracks), T('hist.kind.track'), histDelta(y.tracks, y.prev.tracks)],
     [histNum(y.artists), T('hist.kind.artist'), histDelta(y.artists, y.prev.artists)],
     [histNum(y.albums), T('hist.kind.album'), histDelta(y.albums, y.prev.albums)]].forEach(function(n){
      var c = histEl('div', 'hNum');
      c.appendChild(histEl('div', 'hBig', n[0]));
      c.appendChild(histEl('div', 'hSmall', n[1]));
      if (n[2]) c.appendChild(histEl('div', 'hDelta', T('hist.year.delta', {delta: n[2], year: y.year - 1})));
      grid.appendChild(c);
    });
    histBody.appendChild(grid);
    if (y.partial && y.prev.plays) {
      var td = new Date();
      histBody.appendChild(browseNote(T('hist.year.compare', {year: y.year - 1, date: langDate(td, {day: 'numeric', month: 'long'})})));
    }
    var best = y.months.indexOf(Math.max.apply(null, y.months));
    var full = HIST_MONTHS_FULL;
    histBody.appendChild(histBars(T('hist.chart.perMonth'), y.months, langMonths('narrow'), 1,
      full.map(function(m){ return m + ' ' + y.year; }), {sel: histYearMonth, onSel: function(i){
        histYearMonth = i;
        histYear(++histSeq);
      }}));
    histBody.appendChild(browseNote(T('hist.year.best', {month: full[best], n: y.months[best]})));
    var inMonth = y.month >= 0 && y.month < 12, suffix = inMonth ? ' · ' + full[y.month] : '';
    if (inMonth) {
      var scope = histEl('div', 'hScope');
      scope.appendChild(histEl('span', '', T('hist.year.chartsFor', {month: full[y.month], year: y.year})));
      var whole = histEl('button', 'hChip', T('hist.year.whole'));
      whole.addEventListener('click', function(){ histYearMonth = -1; histYear(++histSeq); });
      scope.appendChild(whole);
      histBody.appendChild(scope);
    } else {
      histBody.appendChild(browseNote(T('hist.year.tapMonth')));
    }
    /* Rubriken zum Aufklappen (anfangs zu); der Zustand bleibt beim Jahreswechsel */
    function section(key, head, fill) {
      var h = browseHeading(head);
      h.classList.add('hFold');
      var body = histEl('div', 'hFoldBody');
      function paint() { var on = !!histYearOpen[key]; h.classList.toggle('open', on); body.style.display = on ? '' : 'none'; }
      h.addEventListener('click', function(){ histYearOpen[key] = !histYearOpen[key]; paint(); });
      fill(body);
      paint();
      histBody.appendChild(h); histBody.appendChild(body);
    }
    function list(key, head, kind, items, empty) {
      if (!items.length && !empty) return;
      section(key, head, function(body){
        if (!items.length) body.appendChild(browseNote(empty));
        items.forEach(function(it, i){ body.appendChild(histTopRow(kind, it, i)); });
      });
    }
    list('tracks', T('hist.year.topTracks') + suffix, 'track', y.tracks_top);
    list('albums', T('hist.year.topAlbums') + suffix, 'album', y.albums_top);
    list('artists', T('hist.year.topArtists') + suffix, 'artist', y.artists_top);
    section('genres', T('hist.year.topGenres') + suffix, function(body){
      if (!y.genres_top.length) { body.appendChild(browseNote(T('hist.year.noGenres'))); return; }
      y.genres_top.forEach(function(g, i){
        var row = histRow(g.g, '', histNum(g.n) + '×', function(){ if (typeof genreFromAnywhere === 'function') genreFromAnywhere(g.g); });
        row.classList.add('hNoImg');
        row.insertBefore(histEl('div', 'hRank', String(i + 1)), row.firstChild);
        body.appendChild(row);
      });
    });
    if (y.hasBefore) list('new', T('hist.year.newArtists') + suffix, 'artist', y.newArtists, inMonth ? T('hist.year.noNewMonth') : T('hist.year.noNewYear'));
    if (inMonth && !y.tracks_top.length) histBody.appendChild(browseNote(T('hist.year.nothingMonth')));
    histBody.scrollTop = keep;
  }).catch(function(){ histFail(seq); });
}

/* ---------- Last.fm ---------- */

function histLastfmBtn(text, fn) {
  var b = histEl('button', 'ckBtn', text);
  b.addEventListener('click', function(){ b.disabled = true; fn(b); });
  return b;
}

function histLastfmAction(action) {
  return tagPost('/lastfm', {action: action}).then(function(r){
    if (r && !r.ok) showToast(r.error || T('hist.lastfm.error'));
    return r;
  }).catch(function(){ showToast(T('hist.offline')); });
}

function histLastfm(st, seq) {
  var box = histEl('div', 'hLastfm');
  box.appendChild(browseHeading('LAST.FM'));
  var info = histEl('div', 'ckInfo'), btns = histEl('div', 'hBtns');
  box.appendChild(info); box.appendChild(btns);
  if (!st) { info.textContent = T('hist.offlineDot'); return box; }
  if (!st.configured) {
    info.textContent = st.hasKey
      ? T('hist.lastfm.noSecret')
      : T('hist.lastfm.noKey');
    return box;
  }
  if (!st.connected) {
    info.textContent = st.user ? T('hist.lastfm.expired') : T('hist.lastfm.notConnected');
    btns.appendChild(histLastfmBtn(T('hist.lastfm.connect'), function(b){
      var win = window.open('about:blank', '_blank');          /* gleich öffnen, sonst blockiert der Browser das Fenster */
      if (win) win.opener = null;                             /* Last.fm-Seite bekommt keinen Zugriff auf die App */
      histLastfmAction('connect').then(function(r){
        b.disabled = false;
        if (!r || !r.ok) { if (win) win.close(); return; }
        if (win) win.location.href = r.url; else location.href = r.url;
        info.textContent = T('hist.lastfm.authorize');
        while (btns.firstChild) btns.removeChild(btns.firstChild);
        btns.appendChild(histLastfmBtn(T('hist.lastfm.done'), function(b2){
          histLastfmAction('finish').then(function(r2){ b2.disabled = false; if (r2 && r2.ok) histShow('stats'); });
        }));
      });
    }));
    return box;
  }
  var lines = [T('hist.lastfm.connected', {user: st.user})];
  if (st.queue) lines.push(T('hist.lastfm.queue', {n: st.queue, error: st.sendError ? ' (' + st.sendError + ')' : ''}));
  if (st.importing) lines.push(T('hist.lastfm.importing', {page: st.importing.page, pages: st.importing.pages || '?', added: histNum(st.importing.added)}));
  else if (st.importError) lines.push(T('hist.lastfm.importFailed', {error: st.importError}));
  else if (st.lastImport) lines.push(T('hist.lastfm.lastImport', {day: histDayLower(st.lastImport.at), added: histNum(st.lastImport.added)}));
  info.textContent = lines.join(' ');
  if (!st.importing) btns.appendChild(histLastfmBtn(st.lastImport ? T('hist.lastfm.sync') : T('hist.lastfm.import'), function(){
    histLastfmAction('import').then(function(){ histShow('stats'); });
  }));
  if (st.queue && !st.importing) btns.appendChild(histLastfmBtn(T('hist.lastfm.sendNow'), function(){
    histLastfmAction('send').then(function(){ setTimeout(function(){ histShow('stats'); }, 1500); });
  }));
  btns.appendChild(histLastfmBtn(T('hist.lastfm.disconnect'), function(){ histLastfmAction('disconnect').then(function(){ histShow('stats'); }); }));
  if (st.importing) histTimer = setTimeout(function(){ if (seq === histSeq && overlayHistory.classList.contains('on')) histShow('stats'); }, 3000);
  return box;
}

document.querySelectorAll('#histTabBar .qTab').forEach(function(t){
  t.addEventListener('click', function(){ histShow(t.dataset.tab); });
});
document.getElementById('closeHistory').addEventListener('click', function(){ clearTimeout(histTimer); closeAllOverlays(); });
document.getElementById('historyBack').addEventListener('click', function(){
  clearTimeout(histTimer);
  openMenu();
});
