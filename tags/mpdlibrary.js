/* Library and search from MPD alone (PLAYER 'mpd', see mpdplayer.js): answers in the shape of Volumio's
   /api/v1/browse and /api/v1/search ({navigation: {lists: [{title, items}], info, prev}}), so the interface reads them
   as before. Addresses as Volumio builds them: music-library/<folder>, artists://<artist>, albums://<artist>/<album>,
   genres://<genre>, playlists/<name>. Covers as "/albumart?path=/mnt/<folder>" (the interface sends them to /mpd/albumart).
   mpd(cmds, cb(err, lists)) as in mpdplayer.js. Node 8, ES5 only. */

function quote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }
function dec(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function enc(s) { return encodeURIComponent(s); }
var SEARCH_MAX = 3000;                                   /* songs per search query (window) */
var LIST_MAX = 500;                                      /* entries per list in a search answer */

/* lines -> [{file}|{directory}|{playlist}] with their tags (lower-case keys, the first value counts) */
function entries(lines) {
  var out = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i <= 0) return;
    var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'file' || k === 'directory' || k === 'playlist') { cur = {}; cur[k] = v; out.push(cur); return; }
    if (cur && !(k in cur)) cur[k] = v;
  });
  return out;
}
/* "Key: value" lines of a list command (list artist, list genre) -> values */
function values(lines) {
  var out = [], seen = {};
  (lines || []).forEach(function(l){
    var i = l.indexOf(': ');
    if (i <= 0) return;
    var v = l.slice(i + 2);
    if (v && !seen[v]) { seen[v] = true; out.push(v); }
  });
  return out;
}

function dirOf(file) { var i = String(file).lastIndexOf('/'); return i > 0 ? file.slice(0, i) : ''; }
function baseName(p) { return String(p || '').split('/').pop(); }
function artPath(dir) { return '/albumart?path=' + enc('/mnt/' + dir); }
function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
function cmp(a, b) { a = String(a || '').toLowerCase(); b = String(b || '').toLowerCase(); return a < b ? -1 : a > b ? 1 : 0; }

function songItem(s) {
  var file = s.file;
  return {service: 'mpd', type: 'song', title: s.title || baseName(file).replace(/\.[a-z0-9]{2,5}$/i, ''), artist: s.artist || '',
          album: s.album || '', uri: 'music-library/' + file, albumart: artPath(dirOf(file)),
          duration: Math.round(num(s.duration) || num(s.time)), tracknumber: parseInt(s.track, 10) || 0, year: s.date || ''};
}
function bySong(a, b) {                                  /* disc, track, file */
  return (parseInt(a.disc, 10) || 0) - (parseInt(b.disc, 10) || 0) || (parseInt(a.track, 10) || 0) - (parseInt(b.track, 10) || 0) || cmp(a.file, b.file);
}
/* songs -> album folders [{uri: albums://…, title, artist, albumart}] (one per album artist and album), sorted by year, title */
function albumItems(songs, fallbackArtist) {
  var by = {}, order = [];
  songs.forEach(function(s){
    if (!s.album) return;
    var who = s.albumartist || s.artist || fallbackArtist || '';
    var k = who.toLowerCase() + '\u0000' + s.album.toLowerCase();
    if (!by[k]) {
      by[k] = {service: 'mpd', type: 'folder', title: s.album, artist: who, uri: 'albums://' + enc(who) + '/' + enc(s.album),
               albumart: artPath(dirOf(s.file)), year: (/\d{4}/.exec(s.date || '') || [''])[0]};
      order.push(k);
    }
  });
  return order.map(function(k){ return by[k]; }).sort(function(a, b){ return cmp(a.year, b.year) || cmp(a.title, b.title); });
}
function nav(lists, info, prev) {
  var n = {lists: lists, prev: {uri: prev || ''}};
  if (info) n.info = info;
  return {navigation: n};
}
function list(title, items, views) { return {title: title, availableListViews: views || ['list', 'grid'], items: items}; }

/* find with album artist, else by artist (albums without album artist tag) -> cb(err, songs) */
function findAlbum(mpd, artist, album, cb) {
  mpd(['find albumartist ' + quote(artist) + ' album ' + quote(album)], function(err, lists){
    var s = err ? [] : entries(lists[0]).filter(function(e){ return e.file; });
    if (s.length) return cb(null, s);
    mpd(['find artist ' + quote(artist) + ' album ' + quote(album)], function(e2, l2){
      if (e2) return cb(e2);
      cb(null, entries(l2[0]).filter(function(e){ return e.file; }));
    });
  });
}

/* uri -> cb(err, answer like Volumio's browse) */
function browse(mpd, uri, cb) {
  uri = String(uri || '');
  var m;
  if (uri === 'music-library' || /^music-library\//.test(uri) || /^\/?mnt(\/|$)/.test(uri)) {
    var dir = uri.replace(/^\/+/, '').replace(/^(music-library|mnt)\/?/, '');
    return mpd(['lsinfo ' + quote(dir)], function(err, lists){
      if (err) return cb(err);
      var items = entries(lists[0]).map(function(e){
        if (e.directory) return {service: 'mpd', type: 'folder', title: baseName(e.directory), uri: 'music-library/' + e.directory, albumart: artPath(e.directory)};
        if (e.file) return songItem(e);
        return null;
      }).filter(Boolean);
      cb(null, nav([list('', items)], null, dir ? 'music-library/' + dirOf(dir) : ''));
    });
  }
  if (uri === 'artists://' || uri === 'artists:/') {
    return mpd(['list albumartist'], function(err, lists){
      if (err) return cb(err);
      cb(null, nav([list('', values(lists[0]).sort(cmp).map(function(a){
        return {service: 'mpd', type: 'folder', title: a, uri: 'artists://' + enc(a), albumart: '/albumart?web=' + enc(a) + '/large&icon=users'};
      }))], null, ''));
    });
  }
  if ((m = /^artists:\/\/([^\/]+)\/?$/.exec(uri))) {
    var artist = dec(m[1]);
    return mpd(['find albumartist ' + quote(artist), 'find artist ' + quote(artist)], function(err, lists){
      if (err) return cb(err);
      var songs = entries(lists[0]).concat(entries(lists[1])).filter(function(e){ return e.file; });
      var albums = albumItems(songs, artist).filter(function(a){ return a.artist.toLowerCase() === artist.toLowerCase(); });
      if (!albums.length) albums = albumItems(songs, artist);           /* only guest appearances: their albums */
      cb(null, nav([list('Albums', albums)], null, 'artists://'));
    });
  }
  if ((m = /^(?:albums|artists):\/\/([^\/]+)\/(.+)$/.exec(uri))) {
    var who = dec(m[1]), album = dec(m[2]);
    return findAlbum(mpd, who, album, function(err, songs){
      if (err) return cb(err);
      songs.sort(bySong);
      var items = songs.map(songItem);
      var info = items.length ? {service: 'mpd', type: 'album', title: album, album: album, artist: who, uri: uri, albumart: items[0].albumart} : null;
      cb(null, nav([list('', items, ['list'])], info, 'artists://' + enc(who)));
    });
  }
  if (uri === 'albums://' || uri === 'albums:/') {
    return mpd(['list album group albumartist'], function(err, lists){
      if (err) return cb(err);
      var items = [], who = '';
      (lists[0] || []).forEach(function(l){
        var i = l.indexOf(': ');
        if (i <= 0) return;
        var k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
        if (k === 'albumartist') who = v;
        else if (k === 'album' && v) items.push({service: 'mpd', type: 'folder', title: v, artist: who, uri: 'albums://' + enc(who) + '/' + enc(v)});
      });
      cb(null, nav([list('', items.sort(function(a, b){ return cmp(a.title, b.title); }))], null, ''));
    });
  }
  if (uri === 'genres://' || uri === 'genres:/') {
    return mpd(['list genre'], function(err, lists){
      if (err) return cb(err);
      cb(null, nav([list('', values(lists[0]).sort(cmp).map(function(g){
        return {service: 'mpd', type: 'folder', title: g, uri: 'genres://' + enc(g)};
      }))], null, ''));
    });
  }
  if ((m = /^genres:\/\/([^\/]+)\/?$/.exec(uri))) {
    return mpd(['find genre ' + quote(dec(m[1]))], function(err, lists){
      if (err) return cb(err);
      cb(null, nav([list('Albums', albumItems(entries(lists[0]).filter(function(e){ return e.file; })))], null, 'genres://'));
    });
  }
  if (uri === 'playlists') {
    return mpd(['listplaylists'], function(err, lists){
      if (err) return cb(err);
      cb(null, nav([list('', entries(lists[0]).filter(function(e){ return e.playlist; }).sort(function(a, b){ return cmp(a.playlist, b.playlist); }).map(function(e){
        return {service: 'mpd', type: 'playlist', title: e.playlist, uri: 'playlists/' + e.playlist};
      }))], null, ''));
    });
  }
  if ((m = /^playlists\/(.+)$/.exec(uri))) {
    return mpd(['listplaylistinfo ' + quote(m[1])], function(err, lists){
      if (err) return cb(err);
      cb(null, nav([list('', entries(lists[0]).filter(function(e){ return e.file; }).map(songItem), ['list'])], null, 'playlists'));
    });
  }
  /* Volumio's own lists (favourites, web radio) and the streaming services: not there without Volumio */
  cb(null, nav([], null, ''));
}

/* search term -> cb(err, answer like Volumio's search): lists "Artists", "Albums", "Tracks" */
function search(mpd, q, cb) {
  q = String(q || '').trim();
  if (q.length < 2) return cb(null, nav([], null, ''));
  var w = ' window 0:' + SEARCH_MAX;
  mpd(['search artist ' + quote(q) + w, 'search albumartist ' + quote(q) + w, 'search album ' + quote(q) + w, 'search title ' + quote(q) + w], function(err, lists){
    if (err) return cb(err);
    var ql = q.toLowerCase();
    function songsOf(i) { return entries(lists[i]).filter(function(e){ return e.file; }); }
    var names = {}, artists = [];
    songsOf(0).concat(songsOf(1)).forEach(function(s){
      [s.albumartist, s.artist].forEach(function(a){
        if (!a || a.toLowerCase().indexOf(ql) < 0 || names[a.toLowerCase()]) return;
        names[a.toLowerCase()] = true;
        artists.push({service: 'mpd', type: 'folder', title: a, uri: 'artists://' + enc(a), albumart: '/albumart?web=' + enc(a) + '/large&icon=users'});
      });
    });
    artists.sort(function(a, b){ return cmp(a.title, b.title); });
    var albums = albumItems(songsOf(2)).filter(function(a){ return a.title.toLowerCase().indexOf(ql) >= 0; })
      .sort(function(a, b){ return cmp(a.title, b.title); });
    var tracks = songsOf(3).sort(function(a, b){ return cmp(a.title, b.title); }).map(songItem);
    var out = [];
    if (artists.length) out.push(list('Artists', artists.slice(0, LIST_MAX)));
    if (albums.length) out.push(list('Albums', albums.slice(0, LIST_MAX)));
    if (tracks.length) out.push(list('Tracks', tracks.slice(0, LIST_MAX), ['list']));
    var r = nav(out, null, '');
    r.navigation.isSearchResult = true;
    cb(null, r);
  });
}

/* /albumart?path=/mnt/<folder or file>[&web=<artist>/<album>/…] -> cb(err, file of MPD's library whose cover to show) */
function artFile(mpd, query, cb) {
  var p = String(query.path || '').replace(/^\/+/, '').replace(/^mnt\//, '').replace(/^music-library\//, '');
  if (p) {
    if (/\.[a-z0-9]{2,5}$/i.test(p) && !/\/$/.test(p)) return cb(null, p);
    return firstFile(mpd, p, 2, cb);
  }
  var web = String(query.web || '').split('/');
  if (web.length >= 2 && web[1] && web[1] !== 'large' && web[1] !== 'extralarge') {
    return findAlbum(mpd, dec(web[0]), dec(web[1]), function(err, songs){ cb(err || (songs.length ? null : new Error('none')), songs.length ? songs[0].file : null); });
  }
  cb(new Error('no cover address'));
}
/* first song in a folder, at most depth levels down */
function firstFile(mpd, dir, depth, cb) {
  mpd(['lsinfo ' + quote(dir)], function(err, lists){
    if (err) return cb(err);
    var es = entries(lists[0]);
    var f = es.filter(function(e){ return e.file; })[0];
    if (f) return cb(null, f.file);
    var d = es.filter(function(e){ return e.directory; })[0];
    if (d && depth > 0) return firstFile(mpd, d.directory, depth - 1, cb);
    cb(new Error('no song'));
  });
}

module.exports = {browse: browse, search: search, artFile: artFile, entries: entries, albumItems: albumItems};
