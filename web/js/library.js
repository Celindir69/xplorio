/* Playlists, web radio and search
   Classic script, shared global scope; see xplorio.html for load order. */
/* ---------- Playlists / radio ---------- */
function renderPlList(items, container, clickFn, tiles, note) {   /* tiles: playlists with artist tile; note: notice at the top */
  while (container.firstChild) container.removeChild(container.firstChild);
  if (note) container.appendChild(volumioLink(note));
  if (plTileSeen) plTileSeen.disconnect();                 /* stop observing old tiles (would otherwise fill up over days) */
  plTileQueue = plTileQueue.filter(function(j){ return document.body.contains(j.icon); });
  if (!items.length) {
    var empty = document.createElement('div');
    empty.className = 'plHint'; empty.textContent = T('pl.empty');
    container.appendChild(empty);
    return;
  }
  items.forEach(function(it){
    var row = document.createElement('div');
    row.className = 'plRow';
    var icon = document.createElement('div');
    icon.className = 'plIcon';
    if (it.albumart) {
      var img = document.createElement('img');
      img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:calc(1.5 * var(--vw));';
      img.src = artUrl(it.albumart);
      icon.appendChild(img);
    } else {
      icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15 6H3v2h12V6zm0 4H3v2h12v-2zM3 16h8v-2H3v2zM17 6v8.18c-.31-.11-.65-.18-1-.18-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3V8h3V6h-5z"/></svg>';
      if (tiles) plTileLater(icon, it.uri);
    }
    var nm = document.createElement('div');
    nm.className = 'plName'; nm.textContent = it.title || it.name || '';
    row.appendChild(icon); row.appendChild(nm);
    row.addEventListener('click', function(){ clickFn(it); });
    container.appendChild(row);
  });
}

/* note above the list, like "Tap: … from this track"; a tap opens the Volumio UI (gear -> Volumio) */
function volumioLink(text) {
  var h = listHint(text);
  h.classList.add('listLink');
  h.setAttribute('role', 'button');
  h.addEventListener('click', function(){ openVolumio(); });
  return h;
}

/* ---------- Tile of artist photos instead of the playlist icon ---------- */
/* Artists by frequency: 1 image, 2–3 artists two halves, 4 or more four quarters. Photos from the tag service (Deezer),
   if one is missing, the cover of a track by that artist. Playlists are read only once their row is visible,
   one after another; the result stays stored in the browser for a day. */
var PL_TILE_TTL = 86400000, plTileQueue = [], plTileBusy = false, plTileSeen = null;

function plTileArtists(tracks) {
  var count = {}, name = {}, art = {};
  tracks.forEach(function(t){
    var a = String(t.artist || '').split(/\s+(?:feat\.?|ft\.?|featuring|with)\s+|\s*[,;\/]\s*/i)[0].trim();
    if (!a) return;
    var k = a.toLowerCase();
    count[k] = (count[k] || 0) + 1;
    if (!name[k]) name[k] = a;
    if (!art[k] && t.albumart) art[k] = t.albumart;
  });
  return Object.keys(count).sort(function(x, y){ return count[y] - count[x]; }).slice(0, 4)
    .map(function(k){ return {name: name[k], art: art[k] || ''}; });
}

function plTileDraw(icon, artists) {
  if (!artists || !artists.length) return;
  var list = artists.length >= 4 ? artists.slice(0, 4) : artists.length >= 2 ? artists.slice(0, 2) : artists.slice(0, 1);
  while (icon.firstChild) icon.removeChild(icon.firstChild);
  icon.className = 'plIcon plTile n' + list.length;
  list.forEach(function(a){
    var img = document.createElement('img');
    img.alt = '';
    img.addEventListener('error', function once(){
      img.removeEventListener('error', once);
      if (a.art) img.src = artUrl(a.art);
    });
    img.src = (typeof TAGS !== 'undefined' ? TAGS + '/artistimage?name=' + encodeURIComponent(a.name) : artUrl(a.art));
    icon.appendChild(img);
  });
}

function plTileCache(uri, val) {
  try {
    var all = JSON.parse(localStorage.getItem('plTiles') || '{}');
    if (val === undefined) { var c = all[uri]; return c && Date.now() - c.at < PL_TILE_TTL ? c.artists : null; }
    all[uri] = {at: Date.now(), artists: val};
    localStorage.setItem('plTiles', JSON.stringify(all));
  } catch (e) { return null; }
}

function plTileNext() {
  if (plTileBusy || !plTileQueue.length) return;
  var job = plTileQueue.shift();
  plTileBusy = true;
  fetch('/api/v1/browse?uri=' + encodeURIComponent(job.uri)).then(function(r){ return r.json(); }).then(function(j){
    var tracks = browseItems(j).filter(function(it){ return it.uri && !/^folder/.test(it.type || ''); });
    var artists = plTileArtists(tracks);
    plTileCache(job.uri, artists);
    plTileDraw(job.icon, artists);
  }).catch(function(){}).then(function(){ plTileBusy = false; plTileNext(); });
}

function plTileLater(icon, uri) {
  if (!uri) return;
  var cached = plTileCache(uri);
  if (cached) return plTileDraw(icon, cached);
  function go() { plTileQueue.push({icon: icon, uri: uri}); plTileNext(); }
  if (!window.IntersectionObserver) return go();
  if (!plTileSeen) plTileSeen = new IntersectionObserver(function(entries){
    entries.forEach(function(en){
      if (!en.isIntersecting) return;
      plTileSeen.unobserve(en.target);
      en.target._plGo();
    });
  });
  icon._plGo = go;
  plTileSeen.observe(icon);
}

function loadPlaylists() {
  while (playlistResults.firstChild) playlistResults.removeChild(playlistResults.firstChild);
  var hint = document.createElement('div');
  hint.className = 'plHint'; hint.textContent = T('pl.loading');
  playlistResults.appendChild(hint);

  fetch('/api/v1/browse?uri=playlists')
    .then(function(r){ return r.json(); })
    .then(function(j){
      var items = (j && j.navigation && j.navigation.lists && j.navigation.lists[0])
                  ? j.navigation.lists[0].items : [];
      renderPlList(items, playlistResults, function(pl){
        openBrowse({kind:'playlist', name:pl.title || pl.name || '', uri:pl.uri, service:pl.service || 'mpd'});   /* playlist tracks; back arrow leads here */
      }, true, T('pl.manageHint'));
    }).catch(function(){
      while (playlistResults.firstChild) playlistResults.removeChild(playlistResults.firstChild);
      var err = document.createElement('div');
      err.className = 'plHint'; err.textContent = T('pl.loadError');
      playlistResults.appendChild(err);
    });
}

/* station logos from the tag service (stored on the player) instead of the icon; without a logo the previous display stays */
/* remember the station name per address: when the station plays, poll.js reports the player's logo under this name (radioLogoLearn) */
function radioNames() { try { return JSON.parse(localStorage.getItem('radioNames') || '{}') || {}; } catch (e) { return {}; } }
function radioLogos(items, container) {
  if (typeof TAGS === 'undefined') return;
  var names = radioNames(), keys;
  items.forEach(function(it){ var n = it.title || it.name || ''; if (it.uri && n) { delete names[it.uri]; names[it.uri] = n; } });
  keys = Object.keys(names);
  keys.slice(0, Math.max(0, keys.length - 500)).forEach(function(k){ delete names[k]; });
  try { localStorage.setItem('radioNames', JSON.stringify(names)); } catch (e) { /* ignore */ }
  var rows = container.querySelectorAll('.plRow');
  items.forEach(function(it, i){
    var icon = rows[i] && rows[i].querySelector('.plIcon'), name = it.title || it.name || '';
    if (!icon || !name) return;
    if (!it.albumart) icon.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3.24 6.15C2.51 6.43 2 7.17 2 8v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8c0-1.11-.89-2-2-2H8.3l8.26-3.34L15.88 1 3.24 6.15zM7 20a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm13-8h-2v-2h-2v2H4V8h16v4z"/></svg>';   /* radio instead of playlist */
    var a = it.albumart || '', img = new Image(), tid = radioTuneInId(it.uri);
    if (!/^https?:\/\//.test(a) && tid) a = 'https://cdn-profiles.tunein.com/' + tid + '/images/logoq.jpg';   /* TuneIn favorite: logo directly via the station ID */
    img.style.cssText = 'width:100%;height:100%;object-fit:contain;border-radius:calc(1.5 * var(--vw));background:#fff;';
    img.onload = function(){ while (icon.firstChild) icon.removeChild(icon.firstChild); icon.appendChild(img); };
    img.src = TAGS + '/stationlogo?name=' + encodeURIComponent(name) + (/^https?:\/\//.test(a) ? '&url=' + encodeURIComponent(a) : '');
  });
}

function loadMyRadio() {
  while (radioPanel.firstChild) radioPanel.removeChild(radioPanel.firstChild);
  var hint = document.createElement('div');
  hint.className = 'plHint'; hint.textContent = T('pl.loading');
  radioPanel.appendChild(hint);

  fetch('/api/v1/browse?uri=' + encodeURIComponent('radio/favourites'))
    .then(function(r){ return r.json(); })
    .then(function(j){
      var lists = (j && j.navigation && j.navigation.lists) || [];
      var items = [];
      lists.forEach(function(l){ items = items.concat(l.items || []); });
      renderPlList(items, radioPanel, function(it){
        if (queueForInput([{uri: it.uri, title: it.title || it.name || '', albumart: it.albumart || null, service: it.service || 'webradio', type: 'webradio'}])) return;
        socket.emit('replaceAndPlay', {
          uri:      it.uri,
          title:    it.title || it.name || '',
          albumart: it.albumart || null,
          service:  it.service || 'webradio'
        });
        closeAllOverlays();
      }, false, T('radio.manageHint'));
      radioLogos(items, radioPanel);
    }).catch(function(){
      while (radioPanel.firstChild) radioPanel.removeChild(radioPanel.firstChild);
      var err = document.createElement('div');
      err.className = 'plHint'; err.textContent = T('pl.loadError');
      radioPanel.appendChild(err);
    });
}

/* Tabs 0 Mood Mix (moodmix.js, visible only with the tag service), 1 playlists, 2 radio;
   the last selected one applies again on next opening */
var PL_TABS = [[T('pl.tab.mix'), 'mixBody'], [T('pl.tab.playlists'), 'playlistResults'], [T('pl.tab.radio'), 'radioPanel']];
try { plTabActive = +(localStorage.getItem('plTab') || 0) || 0; } catch (e) { plTabActive = 0; }
function plShowTab(n) {
  if (!(n >= 0 && n < PL_TABS.length)) n = 0;
  if (n === 0 && document.getElementById('plTab0').style.display === 'none') n = 1;
  plTabActive = n;
  PL_TABS.forEach(function(t, i){
    document.getElementById('plTab' + i).classList.toggle('on', i === n);
    document.getElementById(t[1]).style.display = i === n ? 'block' : 'none';
  });
  document.getElementById('plOverlayTitle').textContent = PL_TABS[n][0];
  if (n === 0 && typeof mixRender === 'function') mixRender();
  else if (n === 1) loadPlaylists();
  else if (n === 2) loadMyRadio();
}
PL_TABS.forEach(function(t, i){
  document.getElementById('plTab' + i).addEventListener('click', function(){
    try { localStorage.setItem('plTab', String(i)); } catch (e) { /* ignore */ }
    plShowTab(i);
  });
});

/* ---------- Search ---------- */
document.getElementById('searchTabBar').querySelectorAll('.qTab').forEach(function(t){
  t.addEventListener('click', function(){
    document.getElementById('searchTabBar').querySelectorAll('.qTab').forEach(function(x){
      x.className = 'qTab';
    });
    t.className = 'qTab on';
    searchCat = t.dataset.cat;
    renderSearchResults();
  });
});

function triggerSearch() {
  var q = searchInput.value.trim();
  if (q.length < 2) {
    searchData = streamEmptySearch();
    searchSuggest = null;
    searchSeq++;
    renderSearchResults();
    return;
  }
  doSearch(q);
}

var searchShowLocal = true;     /* "Local" checkbox next to the heading; those of the streaming services: STREAMS[i].show */
var searchSeq = 0;          /* discards answers to outdated searches */
var SEARCH_SLOW_MS = 5000;  /* then the note "Waiting for TIDAL/Qobuz" */
var SEARCH_TIMEOUT_MS = 20000;
var searchSuggest = null;   /* {q, items: [{kind, name, ar}]} "Did you mean …?" from the tag service, only without local hits */

function searchMessage(text) {
  while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
  var hint = document.createElement('div');
  hint.className = 'sHint'; hint.textContent = text;
  searchResults.appendChild(hint);
}

/* nothing found locally: ask the tag service for similar artist and album names (typos, accents, "The") */
function searchSuggestAsk(q, seq) {
  if (searchData.artists.length || searchData.albums.length || searchData.songs.length || typeof tagGetJson !== 'function') return;
  tagGetJson('/suggest?q=' + encodeURIComponent(q)).then(function(r){
    if (seq !== searchSeq || !r || !r.ok || !r.items || !r.items.length) return;
    searchSuggest = {q: q, items: r.items};
    renderSearchResults();
  }).catch(function(){ /* without tag service: no suggestions */ });
}

function searchSuggestRow() {
  if (!searchShowLocal || !searchSuggest || searchSuggest.q !== searchQuery) return;
  var box = document.createElement('div');
  box.className = 'sSuggest';
  box.appendChild(document.createTextNode(T('search.didYouMean')));
  var chips = document.createElement('div');
  chips.className = 'mxChips';
  searchSuggest.items.forEach(function(it){
    var c = document.createElement('span');
    c.className = 'mxChip mxSmall';
    c.textContent = it.kind === 'album' && it.ar ? it.name + ' · ' + it.ar : it.name;
    c.addEventListener('click', function(){
      var tab = document.querySelector('#searchTabBar .qTab[data-cat="' + (it.kind === 'album' ? 'albums' : 'artists') + '"]');
      if (tab && searchCat !== tab.dataset.cat) tab.click();
      searchInput.value = it.name;
      triggerSearch();
    });
    chips.appendChild(c);
  });
  box.appendChild(chips);
  searchResults.appendChild(box);
}

function doSearch(q) {
  searchQuery = q;
  searchSuggest = null;
  var seq = ++searchSeq;
  searchMessage(T('search.searching'));
  var slow = setTimeout(function(){ if (seq === searchSeq) searchMessage(streamsOn().length ? T('search.slowWaiting', {services: streamNames()}) : T('search.slow')); }, SEARCH_SLOW_MS);
  withTimeout(fetch('/api/v1/search?query=' + encodeURIComponent(q)).then(function(r){ return r.json(); }), SEARCH_TIMEOUT_MS)
    .then(function(j){
      clearTimeout(slow);
      if (seq !== searchSeq) return;
      searchData = streamSplitSearch((j && j.navigation && j.navigation.lists) || [], q);

      renderSearchResults();
      searchSuggestAsk(q, seq);
    }).catch(function(){
      clearTimeout(slow);
      if (seq !== searchSeq) return;
      searchMessage(streamsOn().length ? T('search.noAnswerStreams', {services: streamNames()}) : T('search.noAnswer'));
    });
}

function searchRow(it, stream) {
  var row = document.createElement('div');
  row.className = 'sRow';
  var img = document.createElement('img');
  img.className = 'sCover';
  if (it.albumart) img.src = artUrl(it.albumart);
  var meta = document.createElement('div');
  meta.className = 'sMeta';
  var ti = document.createElement('div');
  ti.className = 'sTitle'; ti.textContent = it.title || it.name || '';
  var sub = document.createElement('div');
  sub.className = 'sSub';
  sub.textContent = searchCat === 'artists' ? '' : (it.artist || it.album || '');
  meta.appendChild(ti);
  if (sub.textContent) meta.appendChild(sub);
  row.appendChild(img); row.appendChild(meta);
  if (searchCat === 'songs' && !stream) {                   /* local track: edit tags */
    var pen = tagTrackButton(it);
    if (pen) row.appendChild(pen);
  }
  if (searchCat === 'albums' && !stream) {                  /* local album: tags of all tracks */
    var apen = tagAlbumButton(it);
    if (apen) row.appendChild(apen);
  }
  row.addEventListener('click', function(){
    if (searchCat === 'songs') { playSearchItem(it); closeAllOverlays(); return; }
    if (searchCat === 'artists') {
      openBrowse({kind:'artist', artist:it.title || it.name || '', uri:stream ? it.uri : undefined});
      return;
    }
    openBrowse({kind:'album', artist:it.artist || '', album:it.title || it.name || '', uri:it.uri,
                albumart:it.albumart, service:it.service});          /* back arrow leads to the search */
  });
  return row;
}

function streamNames() { return streamsOn().map(function(s){ return s.name; }).join('/'); }

function renderSearchResults() {
  if (searchCat === 'genres' && typeof genreSearch === 'function') return genreSearch();     /* genre.js */
  while (searchResults.firstChild) searchResults.removeChild(searchResults.firstChild);
  searchSuggestRow();
  var list = searchShowLocal ? (searchData[searchCat] || []) : [];
  var parts = streamsOn().filter(function(s){ return s.show; }).map(function(s){
    return {s: s, list: (searchData.stream && searchData.stream[s.id] && searchData.stream[s.id][searchCat]) || []};
  }).filter(function(p){ return p.list.length; });

  if (!list.length && !parts.length) {
    if (!searchQuery && typeof discoverShow === 'function' && discoverShow()) return;     /* Discover (discover.js) */
    var hint = document.createElement('div');
    hint.className = 'sHint';
    var none = !searchShowLocal && !streamsOn().some(function(s){ return s.show; });
    hint.textContent = none ? T('search.pickSource', {services: streamsOn().map(function(s){ return s.name; }).join(T('search.or'))})
                     : (searchQuery ? T('search.noResults') : T('search.minChars'));
    searchResults.appendChild(hint);
    return;
  }

  if (list.length) {
    var lh = document.createElement('div');
    lh.className = 'infoSection'; lh.textContent = T('search.local');
    searchResults.appendChild(lh);
  }
  var genreRows = [];
  list.forEach(function(it){
    var row = searchRow(it, false);
    searchResults.appendChild(row);
    if (searchCat === 'albums') genreRows.push({row: row, uri: it.uri, album: it.title || it.name || '', artist: it.artist || ''});
  });
  if (genreRows.length && typeof genreDecorate === 'function') genreDecorate(genreRows);
  parts.forEach(function(p){
    var hd = document.createElement('div');
    hd.className = 'infoSection'; hd.textContent = p.s.name;
    searchResults.appendChild(hd);
    p.list.forEach(function(it){ searchResults.appendChild(searchRow(it, true)); });
  });

  var hint = document.createElement('div');
  hint.className = 'sHint'; hint.textContent = searchCat === 'songs' ? T('search.tapPlay') : T('search.tapOpen');
  searchResults.appendChild(hint);
}

function playSearchItem(it) {
  var type = searchCat === 'songs' ? 'song' : 'folder';
  if (queueForInput([{uri: it.uri, service: it.service || 'mpd', type: type, title: it.title || it.name || '', artist: it.artist || '', album: it.album || ''}])) return;
  fetch('/api/v1/replaceAndPlay', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({item:{
      uri:    it.uri,
      service:it.service || 'mpd',
      type:   type,
      title:  it.title || it.name || '',
      artist: it.artist || '',
      album:  it.album  || ''
    }})
  }).catch(function(){});
}

searchInput.addEventListener('keydown', function(e){
  if (e.key === 'Enter') { e.preventDefault(); searchInput.blur(); triggerSearch(); }
});
document.getElementById('searchGoBtn').addEventListener('click', triggerSearch);


streamsApply();
document.getElementById('srcLocal').addEventListener('change', function(){ searchShowLocal = this.checked; renderSearchResults(); });
STREAMS.forEach(function(s){
  var box = document.getElementById('src' + streamCap(s));
  if (box) box.addEventListener('change', function(){ s.show = this.checked; renderSearchResults(); });
});

/* x in the search field: clear input */
var searchClear = document.getElementById('searchClear');
function paintSearchClear() { searchClear.style.display = searchInput.value ? 'block' : 'none'; }
searchInput.addEventListener('input', paintSearchClear);
searchClear.addEventListener('click', function(){
  searchInput.value = '';
  paintSearchClear();
  searchSeq++;                                  /* discard the running search */
  searchQuery = '';
  searchData = streamEmptySearch();
  renderSearchResults();
  searchInput.focus();
});
