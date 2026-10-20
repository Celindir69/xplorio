/* Search & Discover without input, matching the tab (artists, albums, tracks): rows "Random discoveries" (with dice),
   "Played a year ago", "Not played in a long time", "Never played", "Often played in the past"
   (tag service GET /discover?kind=…, /plays?view=ago&kind=…). Empty rows are dropped.
   Classic script, shared global scope; loaded after library.js and history.js. */
var discoverReady = false;       /* tag service reachable */
var discoverSeq   = 0;
var discoverTimer = null;
/* search tab -> kind at the tag service */
var DISCOVER_KIND = {
  artists: {kind: 'artist', ago: 'disc.ago.artist'},
  albums:  {kind: 'album',  ago: 'disc.ago.album'},
  songs:   {kind: 'track',  ago: 'disc.ago.track'}
};
var DISCOVER_SHELVES = ['random', 'together', 'bday', 'recent', 'fresh', 'gems', 'ago', 'forgotten', 'never', 'oldfav'];   /* order on the page; bday, recent, fresh only for albums, together only for artists */

function discoverDate(t) { return langDate(t * 1000); }
function discoverCat() { return DISCOVER_KIND[searchCat] || DISCOVER_KIND.albums; }

/* called by renderSearchResults while nothing has been searched; false: not available */
function discoverShow() {
  if (!discoverReady) return false;
  var seq = ++discoverSeq, cat = discoverCat();
  clearTimeout(discoverTimer);
  while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
  var box = histEl('div', 'dBox'), secs = {};
  DISCOVER_SHELVES.forEach(function(id){ secs[id] = histEl('div', 'dSec'); box.appendChild(secs[id]); });
  box.appendChild(discoverChips(seq));
  searchResults.appendChild(box);

  tagGetJson('/plays?view=ago&kind=' + cat.kind + histTz()).then(function(r){
    var a = r && r.ago;
    if (seq !== discoverSeq || !a || !a.items.length) return;
    secs.ago.appendChild(discoverHead(T(cat.ago, {n: a.years}), 'ago'));
    var row = histEl('div', 'dRow');
    a.items.forEach(function(it){ row.appendChild(discoverTile(cat.kind, it)); });
    secs.ago.appendChild(row);
    discoverFit(row);
  }).catch(function(){});

  discoverLoad(seq, cat, secs, false);
  discoverGems(seq, cat, secs.gems);
  if (cat.kind === 'album') discoverAlbumRows(seq, secs);
  if (cat.kind === 'artist') togetherRow(secs.together, function(){ return seq === discoverSeq; });
  return true;
}

/* listener's local date, 'YYYY-MM-DD' (album of the day, birthdays) */
function discoverToday() {
  var d = new Date();
  return d.getFullYear() + '-' + histTwo(d.getMonth() + 1) + '-' + histTwo(d.getDate());
}

/* albums tab: birthdays, recently played, new in the collection (tag service GET /welcome, like the welcome page) */
function discoverAlbumRows(seq, secs) {
  tagGetJson('/welcome?day=' + discoverToday()).then(function(r){
    if (seq !== discoverSeq || !r || !r.ok) return;
    bdayRows(secs.bday, r.birthdays, ['today', 'week', 'month'], r.dates);
    if (r.recent.length) discoverRow(secs.recent, T('disc.shelf.recent'), r.recent.map(function(it){ return discoverTile('album', it); }));
    if (r.fresh.length) discoverRow(secs.fresh, T('disc.shelf.fresh'), r.fresh.map(function(it){ return discoverShelfTile('album', 'never', it); }));
  }).catch(function(){});
}
function discoverRow(sec, title, tiles) {
  discoverClear(sec);
  sec.appendChild(browseHeading(title));
  var row = histEl('div', 'dRow');
  tiles.forEach(function(t){ row.appendChild(t); });
  sec.appendChild(row);
  discoverFit(row);
}

/* ---------- Album birthdays ---------- */
/* b: {today, week, month} from the tag service; which: which rows; dates: status of the release dates (note while collecting).
   Round birthdays (10, 20 … years) and anniversaries (25, 50, 75) get a badge, anniversaries also a golden border. */
function bdayRows(sec, b, which, dates) {
  discoverClear(sec);
  var any = false;
  which.forEach(function(k){
    var items = (b && b[k]) || [];
    if (!items.length) return;
    any = true;
    var title = k === 'month' ? T('bday.month', {m: langMonths('long')[new Date().getMonth()]}) : T('bday.' + k);
    var s = histEl('div', 'dSec');
    discoverRow(s, title, items.map(bdayTile));
    sec.appendChild(s);
  });
  if (!any && dates && dates.running && dates.dated < dates.albums / 2) {
    sec.appendChild(browseHeading(T('bday.title')));
    sec.appendChild(browseNote(T('bday.collecting', {n: dates.dated, total: dates.albums})));
  }
  return any;
}
function bdayTile(it) {
  var tile = discoverShelfTile('album', 'never', it);
  var p = it.date.split('-');
  var date = langDate(new Date(+p[0], +p[1] - 1, +p[2]), {day: 'numeric', month: 'numeric'});   /* the year is implied by the age */
  tile.appendChild(histEl('div', 'dSub', it.mark ? date : date + ' · ' + T('bday.years', {n: it.years})));
  if (it.mark) {
    tile.classList.add(it.mark === 'jubilee' ? 'dJubilee' : 'dRound');
    tile.appendChild(histEl('div', 'dBadge', T('bday.years', {n: it.years})));
  }
  return tile;
}

/* hidden gems (tag service GET /gems): own row with dice; empty without taste data (no ratings, no history) */
function discoverGems(seq, cat, sec) {
  tagGetJson('/gems?kind=' + cat.kind).then(function(r){
    if (seq !== discoverSeq || !r || !r.ok) return;
    discoverClear(sec);
    if (!r.items.length) return;
    var head = discoverHead(T('disc.shelf.gems'), 'gems', function(){ discoverGems(discoverSeq, cat, sec); });
    sec.appendChild(head);
    var row = histEl('div', 'dRow');
    r.items.forEach(function(it){ row.appendChild(discoverShelfTile(cat.kind, 'gems', it)); });
    sec.appendChild(row);
    discoverFit(row);
  }).catch(function(){});
}

/* reason for a gem: unplayed by a favorite artist, like a favorite artist, otherwise mood · genre */
function discoverWhy(it) {
  var w = it.why || {};
  if (w.why === 'artist') return T(it.plays ? 'gems.why.artistRare' : 'gems.why.artist');   /* artist is already shown above */
  if (w.why === 'like') return T('gems.why.like', {ar: histArtistName(w.ar)});
  var m = w.mood ? T('mood.' + w.mood) : '';
  return [m ? m.charAt(0).toUpperCase() + m.slice(1) : '', w.ge || ''].filter(Boolean).join(' · ');
}

/* Row heading: dice on the right (25 tracks from the whole row, tag service POST /randommix {shelf, kind};
   in the artists or albums tab, tracks of that row's artists or albums; none without shelf),
   for the random row, gems and "Go together" preceded by ↻ (draw new tiles) */
var REROLL_SVG = '<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>';
function discoverHead(title, shelf, roll) {
  var head = browseHeading(title);
  head.classList.add('dHead');
  var btns = histEl('div', 'dHeadBtns');
  function btn(svg, tip, fn) {
    var b = histEl('div', 'dDice');
    b.title = tip;
    b.innerHTML = svg;
    b.addEventListener('click', function(){
      b.classList.remove('roll'); void b.offsetWidth; b.classList.add('roll');
      fn();
    });
    btns.appendChild(b);
    return b;
  }
  if (roll) btn(REROLL_SVG, T('disc.reroll'), roll).classList.add('dReroll');
  if (shelf) btn(DICE_SVG, T('disc.mix'), function(){
    var q = {shelf: shelf, kind: discoverCat().kind}, tz = histTz().match(/tzw=(-?\d+)&tzs=(-?\d+)/);
    if (tz) { q.tzw = +tz[1]; q.tzs = +tz[2]; }
    randomMixPlay(q);
  });
  head.appendChild(btns);
  return head;
}

/* rows from the tag service; onlyRandom: renew only the random row (dice) */
function discoverLoad(seq, cat, secs, onlyRandom) {
  tagGetJson('/discover?kind=' + cat.kind).then(function(r){
    if (seq !== discoverSeq) return;
    if (!r || !r.ok) {
      if (r && r.building) {
        discoverClear(secs.random);
        secs.random.appendChild(browseNote(T('disc.building')));
        discoverTimer = setTimeout(function(){ if (seq === discoverSeq) discoverLoad(seq, cat, secs, false); }, 5000);
      }
      return;
    }
    r.shelves.forEach(function(sh){
      if (!secs[sh.id] || (onlyRandom && sh.id !== 'random')) return;
      discoverShelf(secs[sh.id], sh, cat, secs);
    });
  }).catch(function(){});
}

/* picker buttons below the rows: mood, energy, style and decade; each opens the matching albums (genre.js) */
var DISCOVER_MOODS = [['relaxed'], ['dreamy'], ['melancholic'], ['dark'], ['happy'], ['intense'], ['epic']];   /* names as in Mood Mix */
var DISCOVER_ENERGY = [[1, 2, 'disc.energy.low'], [3, 3, 'disc.energy.mid'], [4, 5, 'disc.energy.high']];
var DISCOVER_STYLES = [
  ['Acoustic', ['acoustic', 'folk', 'singer-songwriter']],
  ['Ambient', ['ambient', 'dark ambient', 'atmospheric']],
  ['Electronic', ['electronic', 'downtempo', 'trip-hop', 'house', 'deep house', 'techno', 'minimal', 'trance', 'breakbeat', 'drum and bass', 'dubstep']],
  ['Funky', ['funky', 'funk', 'groovy', 'disco']],
  ['Soulful', ['soul', 'neo-soul', 'r&b']],
  ['Experimental', ['experimental', 'avant-garde', 'noise', 'free jazz']]
];
function discoverChips(seq) {
  var wrap = histEl('div', 'dChipBox');
  function group(title) {
    var sec = histEl('div', 'dSec');
    sec.appendChild(browseHeading(title));
    var chips = histEl('div', 'mxChips dChips');
    sec.appendChild(chips);
    wrap.appendChild(sec);
    return chips;
  }
  function chip(box, label, onClick) {
    var c = histEl('div', 'mxChip', label);
    c.addEventListener('click', onClick);
    box.appendChild(c);
  }
  function open(title, q) { openBrowse({kind: 'moodset', title: title, q: q}); }
  var g = group(T('disc.chips.mood'));
  DISCOVER_MOODS.forEach(function(m){
    var name = mixName(m[0]);
    chip(g, name, function(){ open(name, 'moods=' + encodeURIComponent(m.join(','))); });
  });
  g = group(T('disc.chips.energy'));
  DISCOVER_ENERGY.forEach(function(e){
    var name = T(e[2]);
    chip(g, name, function(){ open(name, 'emin=' + e[0] + '&emax=' + e[1]); });
  });
  g = group(T('disc.chips.style'));
  DISCOVER_STYLES.forEach(function(s){ chip(g, s[0], function(){ open(s[0], 'styles=' + encodeURIComponent(s[1].join(','))); }); });
  var dec = group(T('disc.chips.decade'));
  dec.parentNode.style.display = 'none';
  tagGetJson('/decades').then(function(r){
    if (seq !== discoverSeq || !r || !r.ok || !r.decades.length) return;
    r.decades.forEach(function(d){
      chip(dec, T('disc.decade', {d: d.d}), function(){ openBrowse({kind: 'decade', decade: d.d}); });
    });
    dec.parentNode.style.display = '';
  }).catch(function(){});
  return wrap;
}

function discoverClear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function discoverShelf(sec, sh, cat, secs) {
  discoverClear(sec);
  if (!sh.items.length && sh.id !== 'random') return;
  sec.appendChild(discoverHead(T('disc.shelf.' + sh.id), sh.id,
    sh.id === 'random' ? function(){ discoverLoad(discoverSeq, cat, secs, true); } : null));
  if (!sh.items.length) {
    sec.appendChild(browseNote(T('disc.none.' + cat.kind)));
    return;
  }
  var row = histEl('div', 'dRow');
  sh.items.forEach(function(it){ row.appendChild(discoverShelfTile(cat.kind, sh.id, it)); });
  sec.appendChild(row);
  discoverFit(row);
}

/* tile of a row: open artist, open album, play track; below it, when or how often played */
function discoverShelfTile(kind, shelf, it) {
  var tile = histEl('div', 'dTile' + (kind === 'artist' ? ' dArtist' : ''));
  var dir = kind === 'track' ? it.f.replace(/\/[^\/]*$/, '') : it.dir;
  var art = kind === 'artist' ? histArtistArt(it.ar) : histAlbumArt(it.ar, it.al, dir);
  var img = histImg(art, kind === 'artist');
  if (kind === 'artist') histArtistFallback(img, it.ar);
  tile.appendChild(img);
  tile.appendChild(histEl('div', 'dTi', kind === 'artist' ? it.ar : kind === 'track' ? it.ti : it.al));
  tile.appendChild(histEl('div', 'dAr', kind === 'artist' ? T('disc.albums', {n: it.n}) : histArtistName(it.ar)));
  var info = shelf === 'gems' ? discoverWhy(it)
           : shelf === 'oldfav' ? T('disc.plays', {n: it.plays})
           : shelf === 'never' ? '' : it.last ? T('disc.last', {date: discoverDate(it.last)}) : T('disc.never');
  if (info) tile.appendChild(histEl('div', 'dSub', info));
  tile.addEventListener('click', function(){
    if (kind === 'artist') return openBrowse({kind: 'artist', artist: it.ar});
    if (kind === 'track') return histPlayUri('music-library/' + it.f, 'mpd', it);
    openBrowse({kind: 'album', artist: it.ar === 'Verschiedene' ? '' : it.ar, album: it.al, uri: 'music-library/' + it.dir, albumart: art});
  });
  return tile;
}

/* tile for "a year ago": open artist, open album, play track */
function discoverTile(kind, it) {
  var tile = histEl('div', 'dTile' + (kind === 'artist' ? ' dArtist' : ''));
  var art = kind === 'artist' ? histArtistArt(it.ar) : kind === 'album' ? histAlbumArt(it.ar, it.ti, it.u || '') : histTrackArt(it);
  var img = histImg(art, kind === 'artist');
  if (kind === 'artist') histArtistFallback(img, it.ar);
  tile.appendChild(img);
  tile.appendChild(histEl('div', 'dTi', kind === 'artist' ? it.ar : it.ti));
  if (kind !== 'artist') tile.appendChild(histEl('div', 'dAr', histArtistName(it.ar)));
  tile.addEventListener('click', function(){
    if (kind === 'artist') return openBrowse({kind: 'artist', artist: it.ar});
    if (kind === 'track') return histPlay({ti: it.ti, ar: it.ar, al: it.al, u: it.u ? 'music-library/' + it.u : ''});
    openBrowse({kind: 'album', artist: it.ar === 'Verschiedene' ? '' : it.ar, album: it.ti,
                uri: it.u ? 'music-library/' + it.u : undefined, albumart: art});
  });
  return tile;
}

/* spread tiles evenly across the width if they fit; otherwise start on the left for swiping */
function discoverFit(row) {
  if (!row || !row.parentNode) return;
  row.classList.remove('fit');
  if (row.scrollWidth <= row.clientWidth + 1) row.classList.add('fit');
}
window.addEventListener('resize', function(){ Array.prototype.forEach.call(document.querySelectorAll('.dRow'), discoverFit); });

/* refill when opening the search if nothing was searched */
if (window.MutationObserver) new MutationObserver(function(){
  if (overlaySearch.classList.contains('on') && !searchQuery && discoverReady && searchCat !== 'genres') discoverShow();   /* genres: tiles stay */
  if (!overlaySearch.classList.contains('on')) clearTimeout(discoverTimer);
}).observe(overlaySearch, {attributes: true, attributeFilter: ['class']});

whenTags(function(){ discoverReady = true; if (!searchQuery) renderSearchResults(); });

/* ---------- Random mix: dice next to "Play all" ---------- */
/* q: {artist} or {dirs: [...]}; the tag service draws 25 tracks (never the same artist twice in a row),
   which replace the queue */
function randomMixPlay(q) {
  tagPostJson('/randommix', q).then(function(r){
    if (!(r && r.items && r.items.length)) return showToast(T(r && r.building ? 'disc.building' : 'mix.empty'));
    tracksPlay(r.items);
    showToast(T('disc.mixStarted', {n: r.items.length}));
  }).catch(function(){ showToast(T('hist.offline')); });
}

/* tracks from the tag service ([{f, ti, ar, al}]) become the queue, the first one plays */
function tracksItems(list) {
  return list.map(function(t){
    return {uri: 'music-library/' + t.f, service: 'mpd', type: 'song', title: t.ti, artist: t.ar, album: t.al};
  });
}
function tracksPlay(list) {
  var items = tracksItems(list);
  browseOrigin = null;
  if (queueForInput(items)) return;
  fetch('/api/v1/replaceAndPlay', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({item: items[0]})
  }).then(function(){
    if (items.length > 1) setTimeout(function(){ socket.emit('addToQueue', items.slice(1)); }, 300);
  }).catch(function(){});
  closeAllOverlays();
}

/* Tracks after the current one: the current one keeps playing, whatever followed in the queue gives way to the mix.
   If nothing is playing, like tracksPlay. */
function tracksAfterCurrent(list) {
  var items = tracksItems(list);
  Promise.all([
    fetch('/api/v1/getState').then(function(r){ return r.json(); }),
    fetch('/api/v1/getQueue').then(function(r){ return r.json(); })
  ]).then(function(res){
    var st = res[0] || {}, q = (res[1] && res[1].queue) || [], pos = typeof st.position === 'number' ? st.position : -1;
    if (st.status !== 'play' || pos < 0 || pos >= q.length) return tracksPlay(list);
    for (var i = q.length - 1; i > pos; i--) socket.emit('removeFromQueue', {value: i});   /* from the end: indices stay valid */
    socket.emit('addToQueue', items);
    closeAllOverlays();
  }).catch(function(){ tracksPlay(list); });
}

/* ---------- More like this track (tap on the title in now playing) ---------- */
/* Tag service GET /similar: tracks with similar mood, energy and tempo, at most two per artist.
   "Play all" plays the list, the dice 25 other similar tracks; a tap on a track plays it. */
function similarQuery(e) {
  return '/similar?file=' + encodeURIComponent(e.file || '') + '&artist=' + encodeURIComponent(e.artist || '') +
    '&title=' + encodeURIComponent(e.title || '') + '&album=' + encodeURIComponent(e.album || '');
}
function browseSimilar(e, seq) {
  tagGetJson(similarQuery(e)).then(function(r){
    if (seq !== browseSeq) return;
    discoverClear(browseBody);
    if (!r || !r.ok || !r.items.length) { browseBody.appendChild(browseNote(T(r && r.nodata ? 'similar.nodata' : 'similar.none'))); return; }
    var s = r.seed, sum = s.mood.map(mixName).concat(s.energy ? [T('similar.energy', {e: s.energy})] : [], s.bpm ? [s.bpm + '\u00a0BPM'] : []);
    if (sum.length) browseBody.appendChild(browseNote(T('similar.seed', {why: sum.join(' · ')}), 'sHint simSeed'));
    var dice = histEl('div', 'mixDice');
    dice.title = T('disc.mix');
    dice.innerHTML = DICE_SVG;
    dice.addEventListener('click', function(ev){
      ev.stopPropagation();
      dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll');
      tagGetJson(similarQuery(e) + '&shuffle=1').then(function(m){
        if (!m || !m.ok || !m.items.length) return showToast(T('similar.none'));
        tracksAfterCurrent(m.items);                                  /* the current track plays to the end */
        showToast(T('similar.mixQueued', {n: m.items.length}));
      }).catch(function(){ showToast(T('hist.offline')); });
    });
    browseBody.appendChild(playRow(T('browse.playAll'), playRowSub(r.items, function(x){ return x.d; }),
      function(){ tracksPlay(r.items); }, [dice, queueAddButton(tracksItems(r.items), r.items.length)]));
    browseBody.appendChild(listHint(T('similar.hint')));
    r.items.forEach(function(x){
      var row = histEl('div', 'sRow mxRow');
      row.appendChild(histImg(histAlbumArt(x.ar, x.al, x.f.replace(/\/[^\/]*$/, ''))));
      var meta = histEl('div', 'sMeta');
      meta.appendChild(histEl('div', 'sTitle', x.ti));
      meta.appendChild(histEl('div', 'sSub', x.ar));
      var why = x.why.mood.map(mixName);
      if (x.why.bpm) why.push(x.why.bpm + '\u00a0BPM');
      if (why.length) meta.appendChild(histEl('div', 'mxWhy', why.join(' · ')));
      row.appendChild(meta);
      if (x.why.energy) row.appendChild(histEl('div', 'mxDots', mixEnergyDots(x.why.energy)));
      row.style.cursor = 'pointer';
      row.addEventListener('click', function(){ histPlayUri('music-library/' + x.f, 'mpd', x); });
      browseBody.appendChild(row);
    });
  }).catch(function(){
    if (seq !== browseSeq) return;
    discoverClear(browseBody);
    browseBody.appendChild(browseNote(T('genre.offline')));
  });
}

/* ---------- Go together ---------- */
/* Mixes of 2–3 artists from the collection that go together musically (tag service GET /together, fixed per day, ↻ redraws).
   Tile: the artist photos overlapping, below them the names and what connects them; a tap opens the mix preview.
   In the "Artists" tab of the search without input and on the welcome page. alive(): page still the same. */
function togetherName(artists) { return (artists || []).map(histArtistName).join(' + '); }
function togetherWhy(w) {
  w = w || {};
  var parts = [w.mood ? mixName(w.mood) : '', w.style || w.ge || ''].filter(Boolean);
  if (w.lfm && parts.length < 2) parts.push(T('tog.lfm'));
  return parts.map(function(x){ return x.charAt(0).toUpperCase() + x.slice(1); }).join(' · ');
}
function togetherTile(it) {
  var tile = histEl('div', 'dTile dTogether');
  var art = histEl('div', 'tgArt n' + it.artists.length);
  it.artists.forEach(function(a){
    var img = histImg(histArtistArt(a.ar), true);
    histArtistFallback(img, a.ar);
    art.appendChild(img);
  });
  tile.appendChild(art);
  var names = it.artists.map(function(a){ return a.ar; });
  tile.appendChild(histEl('div', 'dTi', togetherName(names)));
  var why = togetherWhy(it.why);
  if (why) tile.appendChild(histEl('div', 'dAr', why));
  tile.addEventListener('click', function(){ openBrowse({kind: 'together', artists: names}); });
  return tile;
}
function togetherRow(sec, alive, reroll) {
  tagGetJson('/together?day=' + discoverToday() + (reroll ? '&reroll=1' : '')).then(function(r){
    if (!alive() || !r || !r.ok) return;
    discoverClear(sec);
    if (!r.items.length) return;
    sec.appendChild(discoverHead(T('tog.title'), '', function(){ togetherRow(sec, alive, true); }));
    var row = histEl('div', 'dRow');
    r.items.forEach(function(it){ row.appendChild(togetherTile(it)); });
    sec.appendChild(row);
    discoverFit(row);
  }).catch(function(){});
}
function togetherQuery(e) {
  return '/togethermix?day=' + discoverToday() + e.artists.map(function(a){ return '&ar=' + encodeURIComponent(a); }).join('');
}
/* preview: ▶ plays the mix, the dice a newly drawn one, + appends it; never-played items are marked "new" */
function browseTogether(e, seq) {
  tagGetJson(togetherQuery(e)).then(function(r){
    if (seq !== browseSeq) return;
    discoverClear(browseBody);
    if (!r || !r.ok || !r.items.length) { browseBody.appendChild(browseNote(T(r && r.building ? 'disc.building' : 'tog.none'))); return; }
    var dice = histEl('div', 'mixDice');
    dice.title = T('disc.mix');
    dice.innerHTML = DICE_SVG;
    dice.addEventListener('click', function(ev){
      ev.stopPropagation();
      dice.classList.remove('roll'); void dice.offsetWidth; dice.classList.add('roll');
      tagGetJson(togetherQuery(e) + '&shuffle=1').then(function(m){
        if (!m || !m.ok || !m.items.length) return showToast(T('tog.none'));
        tracksPlay(m.items);
        showToast(T('disc.mixStarted', {n: m.items.length}));
      }).catch(function(){ showToast(T('hist.offline')); });
    });
    browseBody.appendChild(playRow(T('tog.play'), playRowSub(r.items, function(x){ return x.d; }),
      function(){ tracksPlay(r.items); }, [dice, queueAddButton(tracksItems(r.items), r.items.length)]));
    browseBody.appendChild(listHint(T('tog.hint')));
    r.items.forEach(function(x){
      var row = histEl('div', 'sRow mxRow');
      row.appendChild(histImg(histAlbumArt(x.ar, x.al, x.f.replace(/\/[^\/]*$/, ''))));
      var meta = histEl('div', 'sMeta');
      meta.appendChild(histEl('div', 'sTitle', x.ti));
      meta.appendChild(histEl('div', 'sSub', x.ar + (x.al ? ' · ' + x.al : '')));
      row.appendChild(meta);
      if (!x.plays) row.appendChild(histEl('div', 'tgMark', T('tog.new')));
      row.style.cursor = 'pointer';
      row.addEventListener('click', function(){ histPlayUri('music-library/' + x.f, 'mpd', x); });
      browseBody.appendChild(row);
    });
  }).catch(function(){
    if (seq !== browseSeq) return;
    discoverClear(browseBody);
    browseBody.appendChild(browseNote(T('genre.offline')));
  });
}

/* ---------- Discover (tab on the artist page) ---------- */
/* Similar artists from the collection (with dice: 25 tracks from them, each artist about equally often) and
   the artist's moods, energy, styles and decades (tag service GET /artistprofile); each button opens the
   matching albums as in Discover. alive(): page still the same; onContent(): first content there; onDone(): all loaded. */
function discoverMore(artist, alive, onContent, onDone) {
  var box = histEl('div', 'dMore'), pending = 2;
  function done() { if (--pending === 0 && onDone) onDone(); }
  function group(label) {
    if (onContent) onContent();
    var sec = histEl('div', 'dMoreSec');
    sec.appendChild(histEl('div', 'mxLabel', label));
    var chips = histEl('div', 'mxChips');
    sec.appendChild(chips);
    return {sec: sec, chips: chips};
  }
  function chip(box_, label, onClick, cls) {
    var c = histEl('div', 'mxChip' + (cls ? ' ' + cls : ''), label);
    c.addEventListener('click', function(ev){ ev.stopPropagation(); onClick(c); });
    box_.appendChild(c);
    return c;
  }
  function moodset(title, q) { openBrowse({kind: 'moodset', title: title, q: q}); }
  var simSec = histEl('div'), tagSec = histEl('div');            /* fixed order, regardless of what arrives first */
  box.appendChild(simSec); box.appendChild(tagSec);
  loadSimilarArtists(artist).then(function(names){
    if (!alive() || !names || !names.length) return;
    var g = group(T('more.similar'));
    var dice = chip(g.chips, '', function(c){
      c.classList.remove('roll'); void c.offsetWidth; c.classList.add('roll');
      randomMixPlay({artists: [artist].concat(names)});            /* the artist themself is included */
    }, 'dMixChip');
    dice.innerHTML = DICE_SVG;
    dice.title = T('disc.mix');
    names.forEach(function(n){ chip(g.chips, n, function(){ openBrowse({kind: 'artist', artist: n}); }); });
    simSec.appendChild(g.sec);
  }).catch(function(){}).then(done);
  if (!discoverReady) { done(); return box; }
  tagGetJson('/artistprofile?artist=' + encodeURIComponent(artist)).then(function(r){
    if (!alive() || !r || !r.ok) return;
    var g;
    if (r.moods.length || r.energy) {
      g = group(T('more.mood'));
      r.moods.forEach(function(m){ var name = mixName(m); chip(g.chips, name, function(){ moodset(name, 'moods=' + encodeURIComponent(m)); }); });
      DISCOVER_ENERGY.forEach(function(e){
        if (r.energy < e[0] || r.energy > e[1]) return;
        var name = T(e[2]);
        chip(g.chips, name, function(){ moodset(name, 'emin=' + e[0] + '&emax=' + e[1]); });
      });
      tagSec.appendChild(g.sec);
    }
    if (r.styles.length) {
      g = group(T('more.style'));
      r.styles.forEach(function(s){
        var name = s.charAt(0).toUpperCase() + s.slice(1);
        chip(g.chips, name, function(){ moodset(name, 'styles=' + encodeURIComponent(s)); });
      });
      tagSec.appendChild(g.sec);
    }
    if (r.decades.length) {
      g = group(T('more.decade'));
      r.decades.forEach(function(d){ chip(g.chips, T('disc.decade', {d: d}), function(){ openBrowse({kind: 'decade', decade: d}); }); });
      tagSec.appendChild(g.sec);
    }
  }).catch(function(){}).then(done);
  return box;
}

/* ---------- Discover (tab on the album page) ---------- */
/* Tag service GET /albumprofile: similar albums from the collection (with dice: 25 tracks from them and from the album itself), mood, energy and
   styles of the album (without a local album: of the artist), year, decade and genre, more albums by the artist.
   q: {artist, album, uri}; uri empty for albums from a service. alive(): page still the same. */
function discoverAlbum(box, q, alive) {
  var wait = browseNote(T('browse.loading'));
  box.appendChild(wait);
  function group(label) {
    var sec = histEl('div', 'dMoreSec');
    sec.appendChild(histEl('div', 'mxLabel', label));
    var chips = histEl('div', 'mxChips');
    sec.appendChild(chips);
    box.appendChild(sec);
    return chips;
  }
  function chip(chips, label, onClick) {
    if (Array.prototype.some.call(chips.children, function(x){ return x.textContent === label; })) return;   /* "Calm" as both mood and energy */
    var c = histEl('div', 'mxChip', label);
    c.addEventListener('click', function(ev){ ev.stopPropagation(); onClick(); });
    chips.appendChild(c);
  }
  function moodset(title, mq) { openBrowse({kind: 'moodset', title: title, q: mq}); }
  function tiles(title, items, dice, self) {        /* self: folder of the album itself, included in the dice mix */
    var sec = histEl('div', 'dMoreSec');
    var head = histEl('div', 'mxLabel', title);
    if (dice) {
      head.classList.add('dHead');
      var btns = histEl('div', 'dHeadBtns'), b = histEl('div', 'dDice');
      b.title = T('disc.mix'); b.innerHTML = DICE_SVG;
      b.addEventListener('click', function(){
        b.classList.remove('roll'); void b.offsetWidth; b.classList.add('roll');
        randomMixPlay({dirs: (self ? [self] : []).concat(items.map(function(it){ return it.dir; }))});
      });
      btns.appendChild(b); head.appendChild(btns);
    }
    sec.appendChild(head);
    var row = histEl('div', 'dRow dLeft');
    items.forEach(function(it){
      var t = discoverShelfTile('album', 'never', it);
      if (it.y) t.appendChild(histEl('div', 'dSub', String(it.y)));
      row.appendChild(t);
    });
    sec.appendChild(row);
    box.appendChild(sec);
    discoverFit(row);
  }
  if (!discoverReady) { wait.textContent = T('more.emptyAlbum'); return; }
  var dir = String(q.uri || '').replace(/^music-library\//, '');
  tagGetJson('/albumprofile?artist=' + encodeURIComponent(q.artist || '') + '&album=' + encodeURIComponent(q.album || '') +
             (dir && !/^[a-z]+:\/\//i.test(dir) ? '&dir=' + encodeURIComponent(dir) : '')).then(function(r){
    if (!alive()) return;
    box.removeChild(wait);
    if (!r || !r.ok) return box.appendChild(browseNote(T(r && r.building ? 'disc.building' : 'genre.offline')));
    var any = false, chips;
    if (r.source === 'artist' && !r.found && (r.similar.length || r.moods.length || r.styles.length))
      box.appendChild(browseNote(T('more.byArtist', {ar: q.artist}), 'sHint'));
    if (r.similar.length) { tiles(T('more.similarAlbums'), r.similar, true, dir && !/^[a-z]+:\/\//i.test(dir) ? dir : r.dir || ''); any = true; }   /* from the search (albums://…): folder from the tag service */
    if (r.moods.length || r.energy) {
      chips = group(T('more.mood'));
      r.moods.forEach(function(m){ var name = mixName(m); chip(chips, name, function(){ moodset(name, 'moods=' + encodeURIComponent(m)); }); });
      DISCOVER_ENERGY.forEach(function(en){
        if (r.energy < en[0] || r.energy > en[1]) return;
        var name = T(en[2]);
        chip(chips, name, function(){ moodset(name, 'emin=' + en[0] + '&emax=' + en[1]); });
      });
      any = true;
    }
    if (r.styles.length) {
      chips = group(T('more.style'));
      r.styles.forEach(function(st){
        var name = st.charAt(0).toUpperCase() + st.slice(1);
        chip(chips, name, function(){ moodset(name, 'styles=' + encodeURIComponent(st)); });
      });
      any = true;
    }
    if (r.year || r.genre) {
      chips = group(T('more.when'));
      if (r.year) {
        chip(chips, String(r.year), function(){ openBrowse({kind: 'year', year: r.year}); });
        var d = r.year - r.year % 10;
        chip(chips, T('disc.decade', {d: d}), function(){ openBrowse({kind: 'decade', decade: d}); });
      }
      if (r.genre && typeof genreOpen === 'function') chip(chips, r.genre, function(){ genreOpen(r.genre); });
      any = true;
    }
    if (r.others.length) { tiles(T('more.others', {ar: histArtistName(r.others[0].ar)}), r.others, false); any = true; }
    if (!any) box.appendChild(browseNote(T('more.emptyAlbum')));
  }).catch(function(){
    if (!alive()) return;
    if (wait.parentNode) box.removeChild(wait);
    box.appendChild(browseNote(T('genre.offline')));
  });
}

/* dice button for the "Play all" row (click does not reach the row) */
function randomMixButton(q) {
  var b = histEl('div', 'mixDice');
  b.title = T('disc.mix');
  b.innerHTML = DICE_SVG;
  b.addEventListener('click', function(ev){
    ev.stopPropagation();
    b.classList.remove('roll'); void b.offsetWidth; b.classList.add('roll');
    randomMixPlay(typeof q === 'function' ? q() : q);
  });
  return b;
}
