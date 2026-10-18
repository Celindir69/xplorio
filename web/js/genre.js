/* Genres: vierter Suchreiter (Kacheln aller Genres bzw. passende Genres zum Suchbegriff), Genre-Seite (alle Alben eines
   Genres) und das Genre klein an Alben (Albumseite, Albumlisten). Quelle: Tag-Dienst (je Album das häufigste Genre-Tag,
   GET /genrelist, /genrealbums, /albumgenre). Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich;
   nach library.js, browse.js, history.js und discover.js geladen. */
var genreReady = false;          /* Tag-Dienst erreichbar: Reiter zeigen, Genres an Alben nachtragen */
var genreSeq = 0;
var genreTab = document.getElementById('searchTabGenres');

/* Suchreiter "Genres": ohne Suchbegriff Kacheln aller Genres, sonst Zeilen der passenden */
function genreSearch() {
  var seq = ++genreSeq, q = searchQuery || '';
  while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
  searchResults.appendChild(browseNote(T('browse.loading')));
  tagGetJson('/genrelist' + (q ? '?q=' + encodeURIComponent(q) : '')).then(function(r){
    if (seq !== genreSeq || searchCat !== 'genres') return;
    while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
    var list = (r && r.genres) || [];
    if (!r || !r.ok) { searchResults.appendChild(browseNote(r && r.building ? T('disc.building') : T('genre.none'))); return; }
    if (!list.length && !(r.subs || []).length) { searchResults.appendChild(browseNote(q ? T('search.noResults') : T('genre.none'))); return; }
    if (!q) {
      if (list.length > GENRE_RANDOM) searchResults.appendChild(genreRandomShelf(list));
      if (list.length > GENRE_RANDOM) searchResults.appendChild(browseHeading(T('genre.allHead')));
      var grid = histEl('div', 'gGrid');
      list.forEach(function(g){ grid.appendChild(genreTile(g)); });
      searchResults.appendChild(grid);
      return;
    }
    list.forEach(function(g){
      var row = histEl('div', 'sRow');
      row.appendChild(histImg(histAlbumArt(g.ar, g.al, g.dir)));
      var meta = histEl('div', 'sMeta');
      meta.appendChild(histEl('div', 'sTitle', g.g));
      meta.appendChild(histEl('div', 'sSub', T('disc.albums', {n: g.n})));
      row.appendChild(meta);
      row.addEventListener('click', function(){ openBrowse({kind: 'genre', genre: g.g}); });
      searchResults.appendChild(row);
    });
    (r.subs || []).forEach(function(x){                  /* Unterstile (Audio-Analyse) mit ihrem Genre */
      var row = histEl('div', 'sRow');
      row.appendChild(histImg(histAlbumArt(x.ar, x.al, x.dir)));
      var meta = histEl('div', 'sMeta');
      meta.appendChild(histEl('div', 'sTitle', x.s));
      meta.appendChild(histEl('div', 'sSub', x.g + ' · ' + T('disc.albums', {n: x.n})));
      row.appendChild(meta);
      row.addEventListener('click', function(){ openBrowse({kind: 'genre', genre: x.g, sub: x.s}); });
      searchResults.appendChild(row);
    });
    searchResults.appendChild(browseNote(T('search.tapOpen')));
  }).catch(function(){
    if (seq !== genreSeq) return;
    while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
    searchResults.appendChild(browseNote(T('genre.offline')));
  });
}

/* Reihe „Zufällige Genres“ über der Übersicht, ↻ zieht neu (nur bei mehr Genres, als in die Reihe passen) */
var GENRE_RANDOM = 12;
function genreRandomShelf(list) {
  var sec = histEl('div', 'dSec'), head = browseHeading(T('disc.shelf.randomGenres')), row = histEl('div', 'dRow');
  head.classList.add('dHead');
  var dice = histEl('div', 'dDice dReroll');
  dice.title = T('disc.reroll');
  dice.innerHTML = REROLL_SVG;
  function fill() {
    while (row.firstChild) row.removeChild(row.firstChild);
    var a = list.slice();
    for (var i = 0; i < GENRE_RANDOM; i++) {
      var j = i + Math.floor(Math.random() * (a.length - i)), x = a[i];
      a[i] = a[j]; a[j] = x;
      row.appendChild(genreTile(a[i]));
    }
    discoverFit(row);
  }
  dice.addEventListener('click', function(){
    dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll');
    fill();
  });
  head.appendChild(dice);
  sec.appendChild(head);
  sec.appendChild(row);
  fill();
  setTimeout(function(){ discoverFit(row); }, 0);   /* erst im Dokument messbar */
  return sec;
}

function genreTile(g) {
  var tile = histEl('div', 'dTile');
  tile.appendChild(histImg(histAlbumArt(g.ar, g.al, g.dir)));
  tile.appendChild(histEl('div', 'dTi', g.g));
  tile.appendChild(histEl('div', 'dAr', T('disc.albums', {n: g.n})));
  tile.addEventListener('click', function(){ openBrowse({kind: 'genre', genre: g.g}); });
  return tile;
}

/* Genre-Seite (browseStack-Eintrag {kind:'genre', genre, sub, all}): gibt es Unterstile, zuerst deren Kacheln mit „Alle“
   davor, sonst (und nach der Wahl) die Alben, nach Künstler sortiert; sub: nur Alben mit diesem Unterstil */
function browseGenre(e, seq) {
  tagGetJson('/genrealbums?g=' + encodeURIComponent(e.genre)).then(function(r){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    var list = (r && r.albums) || [], subs = (r && r.subs) || [];
    if (list.length && subs.length && !e.sub && !e.all) return genreSubTiles(e, list, subs);
    if (e.sub) list = list.filter(function(a){ return (a.st || []).indexOf(e.sub) >= 0; });
    if (!list.length) { browseBody.appendChild(browseNote(r && r.building ? T('disc.building') : T('genre.noAlbums'))); return; }
    genreAlbumPage(list);
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('genre.offline')));
  });
}

/* Alben aus der Albenliste des Tag-Dienstes ({dir, al, ar, y}) mit „Alle abspielen“ und Würfel darüber, Jahr hinter
   dem Titel; into: Ziel (sonst browseBody), noHead: ohne „Alle abspielen“ (steht dann schon über den Reitern),
   match: Stimmungs-/Stil-Abfrage der Seite, der Würfel nimmt dann nur Titel, die selbst passen */
function genreAlbumPage(list, into, noHead, match) {
  var browseBody_ = into || browseBody;
  if (!noHead) browseBody_.appendChild(genrePlayAllHead(list, match));
  browseBody_.appendChild(browseHeading(T('disc.albums', {n: list.length})));
  list.forEach(function(a){
    var uri = 'music-library/' + a.dir, art = histAlbumArt(a.ar, a.al, a.dir);
    var row = histEl('div', 'sRow' + (a.al === curAlbum ? ' cur' : ''));
    row.appendChild(histImg(art));
    var meta = histEl('div', 'sMeta');
    var ti = histEl('div', 'sTitle', a.al);
    if (a.y) ti.appendChild(yearSpan(a.y));
    meta.appendChild(ti);
    meta.appendChild(histEl('div', 'sSub', histArtistName(a.ar)));
    row.appendChild(meta);
    var pen = tagAlbumButton({uri: uri, title: a.al, service: 'mpd'});
    if (pen) row.appendChild(pen);
    row.addEventListener('click', function(){
      browseStack.push({kind: 'album', artist: a.ar === 'Verschiedene' ? '' : a.ar, album: a.al, uri: uri, albumart: art});
      browseRender();
    });
    browseBody_.appendChild(row);
  });
}

/* Jahrzehnt-Seite (browseStack-Eintrag {kind:'decade', decade: 1990}): Alben nach Jahr (Date-Tag) */
function browseDecade(e, seq) { browseYears(e, seq, '/decadealbums?d=' + e.decade, e.decade); }

/* Jahres-Seite (browseStack-Eintrag {kind:'year', year: 1984}): Alben des Jahres */
function browseYear(e, seq) { browseYears(e, seq, '/yearalbums?y=' + e.year, e.year - e.year % 10); }

/* Jahres- und Jahrzehnt-Seite: „Alle abspielen“ mit Würfel, darunter Reiter „Alben“ und „Entdecken“ (Jahrzehnt d) */
function browseYears(e, seq, url, d) {
  tagGetJson(url).then(function(r){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    var list = (r && r.albums) || [];
    if (!list.length) { browseBody.appendChild(browseNote(r && r.building ? T('disc.building') : T('genre.noAlbums'))); return; }
    browseBody.appendChild(genrePlayAllHead(list));
    var panes = browseTabs(e, [['albums', T('browse.tab.albumsOnly')], ['more', T('browse.tab.more')]]);
    genreAlbumPage(list, panes.albums, true);
    panes.more.appendChild(decadeMore(d, e.kind === 'year' ? 0 : d, function(){ return seq === browseSeq; }));
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('genre.offline')));
  });
}

/* Entdecken zum Jahrzehnt d (Tag-Dienst GET /decadeprofile): Künstler mit Alben darin, häufige Stimmungen und Stile,
   Nachbar-Jahrzehnte (auf der Jahres-Seite auch das eigene; self: Jahrzehnt der Seite, fällt weg) */
function decadeMore(d, self, alive) {
  var box = histEl('div', 'dMore'), note = browseNote(T('browse.loading'));
  box.appendChild(note);
  function group(label, items, open) {
    if (!items.length) return;
    var sec = histEl('div', 'dMoreSec');
    sec.appendChild(histEl('div', 'mxLabel', label));
    var chips = histEl('div', 'mxChips');
    items.forEach(function(x){
      var c = histEl('div', 'mxChip', x[0]);
      c.addEventListener('click', function(ev){ ev.stopPropagation(); open(x[1]); });
      chips.appendChild(c);
    });
    sec.appendChild(chips);
    box.appendChild(sec);
  }
  function push(entry) { browseStack.push(entry); browseRender(); }
  tagGetJson('/decadeprofile?d=' + d).then(function(r){
    if (!alive()) return;
    if (note.parentNode) box.removeChild(note);
    if (!r || !r.ok) { box.appendChild(browseNote(T('genre.offline'))); return; }
    var dec = T('disc.decade', {d: d});
    group(T('dec.artists', {d: dec}), r.artists.map(function(a){ return [a, a]; }), function(a){ push({kind: 'artist', artist: a}); });
    function moodset(name, q) { push({kind: 'moodset', title: name + ' · ' + dec, q: q + '&d=' + d, all: {title: name, q: q}}); }   /* nur im Jahrzehnt */
    group(T('dec.moods', {d: dec}), r.moods.map(function(m){ return [mixName(m), m]; }), function(m){
      moodset(mixName(m), 'moods=' + encodeURIComponent(m));
    });
    group(T('dec.styles', {d: dec}), r.styles.map(function(s){ return [s.charAt(0).toUpperCase() + s.slice(1), s]; }), function(s){
      moodset(s.charAt(0).toUpperCase() + s.slice(1), 'styles=' + encodeURIComponent(s));
    });
    group(T('dec.decades'), r.decades.filter(function(x){ return x !== self; }).map(function(x){ return [T('disc.decade', {d: x}), x]; }),
      function(x){ push({kind: 'decade', decade: x}); });
    if (!box.querySelector('.dMoreSec')) box.appendChild(browseNote(T('more.empty')));
  }).catch(function(){ if (alive() && note.parentNode) note.textContent = T('genre.offline'); });
  return box;
}

/* Alben nach Stimmung, Energie oder Stil (browseStack-Eintrag {kind:'moodset', title, q}): q geht an GET /moodalbums;
   e.all ({title, q}): Seite ist auf ein Jahrzehnt beschränkt, der Knopf „Alle Jahrzehnte“ ersetzt sie durch die ungefilterte */
function moodSetAll(e) {
  var c = histEl('div', 'mxChip bAllDec', T('dec.allDecades'));
  c.addEventListener('click', function(){
    browseStack[browseStack.length - 1] = {kind: 'moodset', title: e.all.title, q: e.all.q};
    browseRender();
  });
  var row = histEl('div', 'mxChips bAllDecRow');
  row.appendChild(c);
  return row;
}
function browseMoodSet(e, seq) {
  tagGetJson('/moodalbums?' + e.q).then(function(r){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (e.all) browseBody.appendChild(moodSetAll(e));
    var list = (r && r.albums) || [];
    if (!list.length) { browseBody.appendChild(browseNote(r && r.building ? T('disc.building') : T('disc.moodNone'))); return; }
    genreAlbumPage(list, null, false, e.q);
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('genre.offline')));
  });
}

/* „Alle abspielen“ wie auf der Künstlerseite: Warteschlange durch alle Alben der Liste ersetzen (Reihenfolge wie angezeigt) */
function genrePlayAllHead(list, match) {
  function folders() { return list.map(function(a){ return {uri: 'music-library/' + a.dir, service: 'mpd', type: 'folder', title: a.al, artist: a.ar}; }); }
  return playRow(T('browse.playAll'), '', function(){
    var items = folders();
    browseOrigin = null;
    if (queueForInput(items)) return;
    fetch('/api/v1/replaceAndPlay', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({item: items[0]})
    }).then(function(){
      if (items.length > 1) setTimeout(function(){ socket.emit('addToQueue', items.slice(1)); }, 300);
    }).catch(function(){});
    closeAllOverlays();
  }, [randomMixButton({dirs: list.map(function(a){ return a.dir; }), match: match || ''}),     /* Würfel: 25 zufällige Titel daraus (discover.js) */
      queueAddButton(folders, 0)]);
}

function genreSubTiles(e, list, subs) {
  var grid = histEl('div', 'gGrid');
  function tile(title, n, art, next) {
    var t = histEl('div', 'dTile');
    t.appendChild(histImg(art));
    t.appendChild(histEl('div', 'dTi', title));
    t.appendChild(histEl('div', 'dAr', T('disc.albums', {n: n})));
    t.addEventListener('click', function(){ browseStack.push(next); browseRender(); });
    grid.appendChild(t);
  }
  tile(T('genre.all'), list.length, histAlbumArt(list[0].ar, list[0].al, list[0].dir), {kind: 'genre', genre: e.genre, all: true});
  subs.forEach(function(x){ tile(x.s, x.n, histAlbumArt(x.ar, x.al, x.dir), {kind: 'genre', genre: e.genre, sub: x.s}); });
  browseBody.appendChild(grid);
  browseBody.appendChild(browseNote(T('genre.subsHint')));
}

function genreOpen(g) {
  browseStack.push({kind: 'genre', genre: g});
  browseRender();
}

/* Genre und Jahr zu Alben nachschlagen: items [{uri, album, artist}] -> Promise {genres: [...], years: [...]} ('' bzw. 0 = unbekannt) */
function albumInfoLookup(items) {
  var none = {genres: items.map(function(){ return ''; }), years: items.map(function(){ return 0; })};
  if (!genreReady || !items.length) return Promise.resolve(none);
  var q = items.map(function(it){ return [it.uri || '', it.album || '', it.artist || '']; });
  /* in Stücken: eine lange Adresse sprengt sonst die Kopfgrenze des Dienstes (rund 8 kB), und alles fehlt still */
  var parts = [], cur = [], len = 0;
  q.forEach(function(x){
    var l = encodeURIComponent(JSON.stringify(x)).length + 3;
    if (cur.length && len + l > 6000) { parts.push(cur); cur = []; len = 0; }
    cur.push(x); len += l;
  });
  if (cur.length) parts.push(cur);
  return Promise.all(parts.map(function(part){
    return tagGetJson('/albumgenre?q=' + encodeURIComponent(JSON.stringify(part))).then(function(r){
      return {genres: (r && r.genres) || part.map(function(){ return ''; }), years: (r && r.years) || part.map(function(){ return 0; })};
    }).catch(function(){ return {genres: part.map(function(){ return ''; }), years: part.map(function(){ return 0; })}; });
  })).then(function(rs){
    return {genres: [].concat.apply([], rs.map(function(r){ return r.genres; })), years: [].concat.apply([], rs.map(function(r){ return r.years; }))};
  });
}
function genreLookup(items) { return albumInfoLookup(items).then(function(r){ return r.genres; }); }

/* „(1984)“ hinter einem Albumtitel; ein Tipp öffnet die Alben dieses Jahres (Klick geht nicht an die Zeile) */
function yearSpan(y) {
  var el = histEl('span', 'bYear', '\u00a0(' + y + ')');
  el.addEventListener('click', function(ev){ ev.stopPropagation(); yearFromAnywhere(y); });
  return el;
}
function yearFromAnywhere(y) {
  if (overlayBrowse.classList.contains('on')) { browseStack.push({kind: 'year', year: y}); browseRender(); }
  else openBrowse({kind: 'year', year: y});
}

/* Wiedergabe: Jahr hinter dem Album und Genre klein unter der Qualitätsangabe (lokal; ein Tipp öffnet die Genre-Seite);
   key verhindert, dass ein spätes Ergebnis beim nächsten Titel landet */
var playerYearKey = '', mGenre = document.getElementById('mGenre');
function playerYear(uri, album, artist) {
  var key = playerYearKey = uri + '|' + album + '|' + artist;
  if (mGenre) mGenre.textContent = '';
  if (!album || !uri || streamOf(uri)) return;
  albumInfoLookup([{uri: uri, album: album, artist: artist}]).then(function(r){
    if (key !== playerYearKey) return;
    if (r.years[0]) mAlbum.appendChild(yearSpan(r.years[0]));
    var g = r.genres[0];
    if (!g || !mGenre) return;
    var el = histEl('span', '', g);
    el.addEventListener('click', function(ev){ ev.stopPropagation(); genreFromAnywhere(g); });
    mGenre.appendChild(el);
  });
}

/* Genre klein rechts in Albumzeilen (vor dem Stift), Jahr hinter dem Titel; ein Tipp öffnet Genre- bzw. Jahres-Seite.
   rows: [{row, uri, album, artist}] */
function genreDecorate(rows, seq) {
  rows = rows.filter(function(x){ return x.uri && !streamOf(x.uri); });
  for (var i = 0; i < rows.length; i += 200) (function(part){
    albumInfoLookup(part).then(function(info){
      if (seq !== undefined && seq !== browseSeq) return;
      part.forEach(function(x, k){
        var g = info.genres[k], y = info.years[k];
        if (!x.row.parentNode) return;
        var ti = x.row.querySelector('.sTitle');
        if (y && ti) ti.appendChild(yearSpan(y));          /* Jahr hinter dem Albumtitel */
        if (!g) return;
        var el = histEl('div', 'bGenre', g);
        el.addEventListener('click', function(ev){ ev.stopPropagation(); genreFromAnywhere(g); });
        x.row.insertBefore(el, x.row.querySelector('.tagEditMini'));
      });
    });
  })(rows.slice(i, i + 200));
}

/* Genre-Seite aus der Suche oder aus dem Browser heraus öffnen */
function genreFromAnywhere(g) {
  if (overlayBrowse.classList.contains('on')) genreOpen(g);
  else openBrowse({kind: 'genre', genre: g});
}

whenTags(function(){
  genreReady = true;
  if (curAlbumTitle && !mAlbum.querySelector('.bYear')) playerYear(curAlbumUri || '', curAlbumTitle, mArtist.textContent);   /* erster Titel kam vor dem Tag-Dienst */
  if (genreTab) genreTab.style.display = '';
});
