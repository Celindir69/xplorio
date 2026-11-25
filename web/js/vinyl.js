/* Own records from Discogs ("Meine Platten", tag service /vinyl, tags/vinyl.js): only for information. Search source
   "Vinyl" next to Local and the services, a hint on album and artist pages, a page per record with the ways to play it
   (own files, streaming services), the whole collection by folder, and the setup (Discogs name, folders, labels).
   Classic script, shared global scope; loaded after library.js, browse.js, discover.js and menu.js. */
var VINYL_SVG = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14.5a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9zm0-5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z';
var vinylStatus = null;          /* {configured, user, folders: [{id, name, label}], count, tracks, at, error, busy, token} */
var vinylItems = null;           /* the whole list for "Meine Platten" (loaded when opened) */
var vinylHits = null;            /* search: {q, artists, albums, songs} */
var searchShowVinyl = true;      /* "Vinyl" checkbox next to the heading of the search */

function vinylOn() { return !!(vinylStatus && vinylStatus.configured && vinylStatus.count); }
function vinylApply() {
  document.documentElement.classList.toggle('hasVinyl', vinylOn());
}
function vinylLoad() {
  return tagGetJson('/vinyl').then(function(r){
    if (!r || !r.ok) return null;
    vinylStatus = r.status; vinylItems = r.items || [];
    vinylApply();
    return r;
  });
}
whenTags(function(){ vinylLoad().catch(function(){}); });

function vinylIcon(cls) { return menuSvg(VINYL_SVG, cls || 'vnIcon'); }
/* "Polar Echo · 1977 · LP" */
function vinylSub(it, noArtist) {
  return [noArtist ? '' : it.ar, it.y ? String(it.y) : '', it.lbl || ''].filter(Boolean).join(' · ');
}
/* Discogs format without what the folder label already says: "Vinyl, LP, Album" in the folder "LP" -> "Album" */
function vinylFormat(it) {
  var lbl = String(it.lbl || '').toLowerCase().replace(/[″"]/g, '"');
  return String(it.fmt || '').split(/,\s*/).filter(function(p){
    var k = p.toLowerCase().replace(/[″"]/g, '"');
    return k && k !== 'vinyl' && k !== lbl;
  }).join(', ');
}
function vinylOpen(it) { openBrowse({kind: 'vinyl', id: it.id, album: it.al, artist: it.ar}); }
function vinylDiscogsUrl(id) { return 'https://www.discogs.com/release/' + encodeURIComponent(id); }

/* one record as a list row: cover, title, artist · year · folder; "Lokal" when it is in the library too */
function vinylRow(it, noArtist, title, sub) {
  var row = histEl('div', 'sRow vnRow');
  var img = histImg(it.th || it.img || '');
  row.appendChild(img);
  var meta = histEl('div', 'sMeta');
  meta.appendChild(histEl('div', 'sTitle', title || it.al));
  meta.appendChild(histEl('div', 'sSub', sub || vinylSub(it, noArtist)));
  row.appendChild(meta);
  if (it.dir) row.appendChild(histEl('div', 'vnLocal', T('vinyl.local')));
  row.appendChild(vinylIcon());
  row.addEventListener('click', function(){ vinylOpen(it); });
  return row;
}

/* tile for the birthdays: a record only on vinyl (cover from Discogs), tap: the record */
function vinylTile(b) {
  var it = b.vinyl, tile = histEl('div', 'dTile vnTile');
  tile.appendChild(histImg(it.img || it.th || ''));
  tile.appendChild(histEl('div', 'dTi', b.al));
  tile.appendChild(histEl('div', 'dAr', histArtistName(b.ar)));
  tile.appendChild(vinylIcon('vnIcon vnTileMark'));
  tile.addEventListener('click', function(){ if (it.id) vinylOpen({id: it.id, al: b.al, ar: b.ar}); });
  return tile;
}

/* ---------- search ---------- */
function vinylSearch(q, seq) {
  vinylHits = null;
  if (!vinylOn() || !q || q === '*') return;
  tagGetJson('/vinyl?q=' + encodeURIComponent(q)).then(function(r){
    if (seq !== searchSeq || !r || !r.ok) return;
    vinylHits = {q: q, artists: r.artists, albums: r.albums, songs: r.songs};
    if (searchShownSeq === searchSeq) renderSearchResults();
  }).catch(function(){});
}
/* rows of the tab that is open (artists, albums, songs), [] if the source is off */
function vinylSearchRows() {
  if (!vinylOn() || !searchShowVinyl || !vinylHits || vinylHits.q !== searchQuery) return [];
  if (searchCat === 'artists') return vinylHits.artists.map(function(a){
    var row = histEl('div', 'sRow vnRow');
    var img = histImg(histArtistArt(a.name), true);
    histArtistFallback(img, a.name);
    row.appendChild(img);
    var meta = histEl('div', 'sMeta');
    meta.appendChild(histEl('div', 'sTitle', a.name));
    meta.appendChild(histEl('div', 'sSub', T('vinyl.records', {n: a.n})));
    row.appendChild(meta);
    row.appendChild(vinylIcon());
    row.addEventListener('click', function(){ openBrowse({kind: 'records', artist: a.name}); });
    return row;
  });
  if (searchCat === 'albums') return vinylHits.albums.map(function(it){ return vinylRow(it); });
  if (searchCat === 'songs') return vinylHits.songs.map(function(s){
    return vinylRow(s.item, false, s.t, [s.ar, s.item.al, s.p].filter(Boolean).join(' · '));
  });
  return [];
}
(function(){
  var box = document.getElementById('srcVinyl');
  if (box) box.addEventListener('change', function(){ searchShowVinyl = this.checked; renderSearchResults(); });
})();

/* ---------- hint on album and artist pages ---------- */
/* album page: "Auf Vinyl · LP" below the title, tap: the record (several pressings: the first, the others are listed there) */
function vinylAlbumHint(meta, artist, album, seq) {
  if (!vinylOn() || !album) return;
  tagGetJson('/vinyl?ar=' + encodeURIComponent(artist || '') + '&al=' + encodeURIComponent(album)).then(function(r){
    if (seq !== browseSeq || !r || !r.ok || !r.items.length) return;
    var labels = [];
    r.items.forEach(function(it){ if (it.lbl && labels.indexOf(it.lbl) < 0) labels.push(it.lbl); });
    var chip = histEl('div', 'vnHint bLink');
    chip.appendChild(vinylIcon());
    chip.appendChild(histEl('span', '', labels.length ? T('vinyl.onVinylAs', {what: labels.join(', ')}) : T('vinyl.onVinyl')));
    chip.addEventListener('click', function(){ vinylOpen(r.items[0]); });
    meta.appendChild(chip);
  }).catch(function(){});
}
/* artist page: a row "On vinyl: 5 records" above the albums */
function vinylArtistRow(box, before, artist, seq) {
  if (!vinylOn() || !artist) return;
  tagGetJson('/vinyl?artist=' + encodeURIComponent(artist)).then(function(r){
    if (seq !== browseSeq || !r || !r.ok || !r.items.length) return;
    var names = [];
    r.items.forEach(function(it){ if (names.indexOf(it.al) < 0) names.push(it.al); });
    var row = histEl('div', 'sRow vnRow vnArtist');
    var ic = histEl('div', 'vnBig'); ic.appendChild(vinylIcon());
    row.appendChild(ic);
    var meta = histEl('div', 'sMeta');
    meta.appendChild(histEl('div', 'sTitle', T('vinyl.myRecords')));
    meta.appendChild(histEl('div', 'sSub', T('vinyl.records', {n: r.items.length}) + ' · ' +
      names.slice(0, 3).join(', ') + (names.length > 3 ? ' …' : '')));
    row.appendChild(meta);
    row.addEventListener('click', function(){ browseStack.push({kind: 'records', artist: artist}); browseRender(); });
    box.insertBefore(row, before && before.parentNode === box ? before : null);
  }).catch(function(){});
}

/* ---------- one record ---------- */
function browseVinyl(e, seq) {
  tagGetJson('/vinyl?id=' + encodeURIComponent(e.id)).then(function(r){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (!r || !r.ok) { browseBody.appendChild(browseNote(T('vinyl.gone'))); return; }
    var it = r.item;
    var head = histEl('div'); head.id = 'browseAlbumHead';
    var img = histEl('img', 'bCover');
    if (it.img || it.th) img.src = it.img || it.th;
    zoomable(img, it.al);
    var meta = histEl('div', 'sMeta');
    var ar = histEl('div', 'sSub bArtist bLink', it.ar);
    ar.addEventListener('click', function(){ browseStack.push({kind: 'artist', artist: it.ar}); browseRender(); });
    var ti = histEl('div', 'sTitle bAlbum', it.al);
    if (it.y) ti.appendChild(yearSpan(it.y));
    meta.appendChild(ar); meta.appendChild(ti);
    var chip = histEl('div', 'vnHint');
    chip.appendChild(vinylIcon());
    chip.appendChild(histEl('span', '', [it.lbl, vinylFormat(it)].filter(Boolean).join(' · ')));
    meta.appendChild(chip);
    if (it.lab) meta.appendChild(histEl('div', 'sSub', it.lab));
    head.appendChild(img); head.appendChild(meta);
    browseBody.appendChild(head);

    /* playing: the own files, else the streaming services that have it */
    var ways = histEl('div');
    browseBody.appendChild(ways);
    var local = r.local && r.local.length ? r.local : it.dir ? [{dir: it.dir, al: it.al}] : [];
    var versBox = histEl('div');                         /* the list of own versions after all play rows */
    if (local.length) vinylLocalWays(ways, versBox, it, local);
    browseBody.appendChild(versBox);
    var svcs = streamsOn();
    var searching = svcs.length ? browseNote(T('vinyl.searching', {services: streamNames()})) : null;
    if (searching) ways.appendChild(searching);
    else if (!local.length) ways.appendChild(browseNote(T('vinyl.nowhere')));
    var found = 0, left = svcs.length;
    svcs.forEach(function(svc){
      streamFindAlbum(svc, it.ar, it.al, true).then(function(hit){
        if (seq !== browseSeq) return;
        left--;
        if (hit) {
          found++;
          ways.insertBefore(playRow(T('vinyl.playOn', {service: svc.name}), hit.title || hit.name || it.al, function(){
            browsePlay({uri: hit.uri, service: hit.service, type: 'folder', title: hit.title || it.al, artist: hit.artist || it.ar});
          }, [queueAddButton([{uri: hit.uri, service: hit.service, type: 'folder', title: hit.title || it.al, artist: hit.artist || it.ar}], 0)]), searching);
        }
        if (!left && searching && searching.parentNode) {
          if (found || local.length) ways.removeChild(searching);
          else searching.textContent = T('vinyl.nowhere');
        }
      });
    });

    if (r.tracks && r.tracks.length) {
      browseBody.appendChild(browseHeading(T('browse.tab.tracks')));
      r.tracks.forEach(function(t){
        var row = histEl('div', 'sRow bTrack vnTrack');
        row.appendChild(histEl('div', 'bNum', t.p || ''));
        var tm = histEl('div', 'sMeta');
        tm.appendChild(histEl('div', 'sTitle', t.t));
        if (t.ar && t.ar !== it.ar) tm.appendChild(histEl('div', 'sSub bTrackArtist', t.ar));
        row.appendChild(tm);
        if (t.d) row.appendChild(histEl('div', 'bDur', t.d));
        browseBody.appendChild(row);
      });
    } else if (r.tracks === null) browseBody.appendChild(browseNote(T('vinyl.tracksLater'), 'sHint'));
    if (r.also && r.also.length) {
      browseBody.appendChild(browseHeading(T('vinyl.also')));
      r.also.forEach(function(x){ browseBody.appendChild(vinylRow(x, true, x.al, [x.y ? String(x.y) : '', x.lbl, vinylFormat(x)].filter(Boolean).join(' · '))); });
    }
    var link = histEl('a', 'sHint vnDiscogs', T('vinyl.atDiscogs'));
    link.href = vinylDiscogsUrl(it.id); link.target = '_blank'; link.rel = 'noopener';
    browseBody.appendChild(link);
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('browse.loadError')));
  });
}

/* own versions of the record: "Play local" (several: "Play best local", which one it is in the line below, then each
   version with its quality: tap opens it, ▶ plays it); "Open in the library" inside the row, above its line */
function vinylLocalWays(box, listBox, it, local) {
  function item(v) { return {uri: 'music-library/' + v.dir, service: 'mpd', type: 'folder', title: v.al || it.al, artist: it.ar}; }
  function open(v) { browseStack.push({kind: 'album', artist: it.ar, album: v.al || it.al, uri: 'music-library/' + v.dir, version: local.length > 1}); browseRender(); }
  function quality(v) {
    if (!v.ext || typeof versionQuality !== 'function') return [];
    var q = versionQuality(v);
    return [q.label || ''].concat(q.tech || []).filter(Boolean);
  }
  var best = local[0];
  var lp = playRow(T(local.length > 1 ? 'vinyl.playBestLocal' : 'vinyl.playLocal'),
                   [best.al || it.al].concat(quality(best)).join(' · '),
                   function(){ browsePlay(item(best)); }, [queueAddButton([item(best)], best.tracks || 0)]);
  if (local.length === 1) {
    var link = histEl('div', 'sSub vnOpen bLink', T('vinyl.openLocal'));
    link.addEventListener('click', function(ev){ ev.stopPropagation(); open(best); });
    lp.sub.parentNode.appendChild(link);
  }
  box.appendChild(lp);
  if (local.length < 2) return;
  box = listBox;
  box.appendChild(browseHeading(T('vinyl.localVersions', {n: local.length})));
  local.forEach(function(v){
    var row = histEl('div', 'sRow verRow vnVersion');
    var img = histEl('img', 'sCover');
    img.src = artUrl('/albumart?path=' + encodeURIComponent('/mnt/' + v.dir));
    var meta = histEl('div', 'sMeta');
    var ti = histEl('div', 'sTitle', v.al || it.al);
    if (v.y) ti.appendChild(yearSpan(v.y));
    var line = histEl('div', 'sSub verQ', [quality(v).join(' · '), v.tracks ? T('browse.trackCount', {n: v.tracks}) : ''].filter(Boolean).join(' · '));
    if (v.best) line.appendChild(histEl('span', 'verBest', ' \u00b7 ' + T('browse.versionBest')));
    meta.appendChild(ti); meta.appendChild(line); meta.appendChild(histEl('div', 'sSub verPath', v.dir));
    row.appendChild(img); row.appendChild(meta);
    var pb = histEl('button', 'mxIcon vnPlay');
    pb.title = T('browse.play');
    pb.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    pb.addEventListener('click', function(ev){ ev.stopPropagation(); browsePlay(item(v)); });
    row.appendChild(pb);
    row.addEventListener('click', function(){ open(v); });
    box.appendChild(row);
  });
}

/* ---------- the whole collection ("Meine Platten"), or one artist's records ---------- */
function openRecords() { openBrowse({kind: 'records'}); }
function browseRecords(e, seq) {
  vinylLoad().then(function(r){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (!r) { browseBody.appendChild(browseNote(T('browse.loadError'))); return; }
    var st = r.status;
    if (!st.configured || e.setup) return vinylSetup(browseBody, seq, st, e);
    var items = r.items;
    if (e.artist) {
      var a = vinylKey(e.artist);
      items = items.filter(function(it){ return vinylKey(it.ar) === a || it.ar.split(/\s*(?:,|&|\band\b|\bfeat\.?|\bwith\b|\bund\b)\s*/i).some(function(n){ return vinylKey(n) === a; }); });
    }
    if (!e.artist) browseBody.appendChild(vinylStatusLine(st, seq, e));
    if (!items.length) { browseBody.appendChild(browseNote(st.busy ? T('vinyl.reading') : st.error ? T('vinyl.error', {error: st.error}) : T('vinyl.empty'))); return; }
    var groups = [['all', T('vinyl.all', {n: items.length})]];
    (st.folders || []).forEach(function(f){
      var n = items.filter(function(it){ return it.f === f.id; }).length;
      if (n) groups.push([String(f.id), f.label + ' (' + n + ')']);
    });
    function fill(box, list) {
      var filter = msInput('', T('vinyl.filter'));
      filter.classList.add('vnFilter');
      if (!e.artist && list.length > 12) box.appendChild(filter);
      var rows = histEl('div');
      box.appendChild(rows);
      function draw() {
        while (rows.firstChild) rows.removeChild(rows.firstChild);
        var q = vinylKey(filter.value);
        list.filter(function(it){ return !q || vinylKey(it.ar + ' ' + it.al).indexOf(q) >= 0; }).forEach(function(it){
          rows.appendChild(vinylRow(it, !!e.artist));
        });
        if (!rows.firstChild) rows.appendChild(browseNote(T('search.noResults')));
      }
      filter.addEventListener('input', draw);
      draw();
    }
    items = items.slice().sort(function(x, y){ return x.ar.localeCompare(y.ar, undefined, {sensitivity: 'base'}) || (x.y || 9999) - (y.y || 9999) || x.al.localeCompare(y.al); });
    if (groups.length <= 2) { fill(browseBody, items); return; }   /* one folder only: no tabs */
    browseTabs(e, groups.map(function(g){
      return [g[0], g[1], function(box){ fill(box, g[0] === 'all' ? items : items.filter(function(it){ return String(it.f) === g[0]; })); }];
    }));
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('browse.loadError')));
  });
}
function vinylKey(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '');
}
/* "312 Platten von Celindir · aktualisiert 25.11." with "Update" and "Set up" */
function vinylStatusLine(st, seq, e) {
  var box = histEl('div', 'vnStatus');
  var when = st.at ? langDate(new Date(st.at * 1000), {day: 'numeric', month: 'numeric', year: 'numeric'}) : '';
  var txt = T('vinyl.status', {n: st.count, user: st.user}) + (when ? ' · ' + T('vinyl.updated', {date: when}) : '');
  if (st.busy) txt += ' · ' + T('vinyl.reading');
  else if (st.count && st.tracks < st.count) txt += ' · ' + T('vinyl.tracksProgress', {n: st.tracks, total: st.count});
  if (st.error && !st.busy) txt += ' · ' + T('vinyl.error', {error: st.error});
  box.appendChild(histEl('div', 'sSub', txt));
  var btns = histEl('div', 'mxChips');
  btns.appendChild(msButton(T('vinyl.refresh'), function(){
    tagPostJson('/vinyl', {action: 'refresh'}).then(function(){
      showToast(T('vinyl.refreshing'));
      setTimeout(function(){ if (seq === browseSeq) browseRender(); }, 4000);
    }).catch(function(){ showToast(T('genre.offline')); });
  }));
  btns.appendChild(msButton(T('vinyl.setup'), function(){ browseStack.push({kind: 'records', setup: true}); browseRender(); }));
  box.appendChild(btns);
  return box;
}

/* setup: Discogs name (empty: the owner of the token), then tick folders and name them */
function vinylSetup(box, seq, st, e) {
  box.appendChild(browseNote(T('vinyl.setupIntro'), 'sSub vnText'));
  if (!st.token) box.appendChild(browseNote(T('vinyl.noToken'), 'sSub vnText'));
  var row = histEl('div', 'pbRow msAddRow');
  var user = msInput(st.user || '', T('vinyl.userPh'));
  row.appendChild(user);
  var msg = histEl('div', 'sSub vnMsg');
  var list = histEl('div', 'vnFolders');
  var chosen = {};
  (st.folders || []).forEach(function(f){ chosen[f.id] = f; });
  row.appendChild(msButton(T('vinyl.loadFolders'), load));
  box.appendChild(row);
  box.appendChild(msg);
  box.appendChild(list);
  function load() {
    msg.textContent = T('browse.loading');
    tagPostJson('/vinyl', {action: 'folders', user: user.value.trim()}).then(function(r){
      if (seq !== browseSeq) return;
      if (!r || !r.ok) { msg.textContent = T('vinyl.err.' + (r && /^(user|private|nouser)$/.test(r.error) ? r.error : 'other'), {error: (r && r.error) || ''}); return; }
      msg.textContent = '';
      if (!user.value.trim()) user.value = r.user;
      draw(r.folders);
    }).catch(function(){ msg.textContent = T('genre.offline'); });
  }
  function draw(folders) {
    while (list.firstChild) list.removeChild(list.firstChild);
    list.appendChild(histEl('div', 'sSub vnText', T('vinyl.pickFolders')));
    folders.forEach(function(f){
      if (!f.count && !chosen[f.id]) return;              /* empty folders ("Uncategorized") only if chosen before */
      var r = histEl('label', 'vnFolder');
      var cb = histEl('input'); cb.type = 'checkbox'; cb.checked = !!chosen[f.id];
      var name = histEl('span', 'vnFolderName', (f.id === 0 ? T('vinyl.allFolder') : f.name) + ' (' + f.count + ')');
      var label = msInput(chosen[f.id] ? chosen[f.id].label : (f.id === 0 ? 'Vinyl' : f.name), T('vinyl.labelPh'));
      label.maxLength = 24;
      label.classList.add('vnLabel');
      cb.addEventListener('change', function(){
        if (cb.checked) chosen[f.id] = {id: f.id, name: f.name, label: label.value}; else delete chosen[f.id];
      });
      label.addEventListener('input', function(){ if (chosen[f.id]) chosen[f.id].label = label.value; });
      r.appendChild(cb); r.appendChild(name); r.appendChild(label);
      list.appendChild(r);
    });
    var btns = histEl('div', 'mxChips vnSave');
    btns.appendChild(msButton(T('vinyl.save'), save, 'on'));
    list.appendChild(btns);
  }
  function save() {
    var folders = Object.keys(chosen).map(function(k){ return chosen[k]; });
    tagPostJson('/vinyl', {action: 'save', user: user.value.trim(), folders: folders}).then(function(r){
      if (!r || !r.ok) { msg.textContent = T('vinyl.err.' + (r && r.error === 'user' ? 'user' : 'other'), {error: (r && r.error) || ''}); return; }
      vinylStatus = r.status; vinylApply();
      showToast(folders.length ? T('vinyl.saved') : T('vinyl.off'));
      browseStack = [{kind: 'records'}];
      browseRender();
    }).catch(function(){ msg.textContent = T('genre.offline'); });
  }
  if (st.configured) {
    var off = histEl('div', 'mxChips');
    off.appendChild(msButton(T('vinyl.turnOff'), function(){
      if (!confirm(T('vinyl.turnOffAsk'))) return;
      chosen = {}; save();
    }));
    box.appendChild(off);
  }
  if (st.user || st.token) load();                     /* known: the folders at once */
}

/* ---------- menu ---------- */
MENU_ITEMS.splice(1, 0, {id: 'records', needsTags: true, title: T('vinyl.myRecords'), sub: T('vinyl.menuSub'), open: openRecords, icon: VINYL_SVG});
