/* Album versions: the same album in several folders (e.g. FLAC 24/96, CD rip and MP3), for the album page.
   The grouping is the one of the duplicate check (duplicates.find): same album artist and album name, additions such
   as "(Remastered)" or "[Deluxe Edition]" do not count, disc folders of one album are one version.
   build() runs with the album list (tag service, albums.json), lookup() answers GET /versions. Node 8, ES5 only. */
var duplicates = require('./duplicates.js');
var albums = require('./albums.js');

/* songs as from libcheck.mpdWalk -> [{n, a, v: [{dir, dirs, al, ext, bits, rate, codec, tracks, seconds}]}], best version first;
   dir: the album folder (disc folders: their parent, as in albums.albumDir) */
function build(songs, artistKey) {
  return duplicates.find(songs, artistKey).map(function(g){
    return {n: g.name, a: g.artist, v: g.versions.map(function(v){
      var dir = albums.albumDir(v.dirs[0] + '/x');
      return {dir: dir, dirs: v.dirs, al: v.name, ext: v.ext, bits: v.bits, rate: v.rate, codec: v.codec, tracks: v.tracks, seconds: v.seconds};
    })};
  });
}

/* groups -> find(u, al, ar): the group of a folder (album or disc folder) or, if not found, of album and artist; null if
   the album exists only once */
function index(groups, artistKey) {
  var byDir = {}, byKey = {};
  groups.forEach(function(g){
    g.v.forEach(function(v){
      byDir[v.dir] = g;
      v.dirs.forEach(function(d){ byDir[d] = g; });
    });
    byKey[(g.a ? artistKey(g.a) : '*') + '|' + duplicates.albumKey(g.n, artistKey)] = g;
  });
  return function(u, al, ar) {
    u = String(u || '').replace(/^\/+|\/+$/g, '');
    u = u.replace(/^music-library\//, '').replace(/^mnt\//, '');
    if (u && (byDir[u] || byDir[albums.albumDir(u + '/x')])) return byDir[u] || byDir[albums.albumDir(u + '/x')];
    if (!al) return null;
    var k = duplicates.albumKey(al, artistKey);
    return byKey[(duplicates.isVA(ar) ? '*' : artistKey(ar)) + '|' + k] || null;
  };
}

/* group -> answer for the album page; year from the album list (dirIndex of albums.js: {u} -> dir) */
function answer(g, yearOf) {
  return {name: g.n, artist: g.a, versions: g.v.map(function(v, i){
    var o = {dir: v.dir, al: v.al, ext: v.ext, bits: v.bits, rate: v.rate, codec: v.codec, tracks: v.tracks, seconds: v.seconds, best: i === 0};
    var y = yearOf ? yearOf(v.dir) : 0;
    if (y) o.y = y;
    return o;
  })};
}

/* album list [{dir, al, ar, …}] -> the same list with one entry per album: of several versions the best one that is in the
   list stays (at the place of the first), with nv = number of versions in the collection; find from index() */
function collapse(list, find) {
  var kept = [], at = {};
  list.forEach(function(a){
    var g = find(a.dir);
    if (!g) return kept.push(a);
    var rank = rankOf(g, a.dir), key = g.v[0].dir, k = at[key];
    if (!k) { var c = copy(a, g.v.length); at[key] = {i: kept.length, rank: rank}; return kept.push(c); }
    if (rank < k.rank) { kept[k.i] = copy(a, g.v.length); k.rank = rank; }
  });
  return kept;
}
function rankOf(g, dir) {
  for (var i = 0; i < g.v.length; i++) if (g.v[i].dir === dir || g.v[i].dirs.indexOf(dir) >= 0) return i;
  return g.v.length;
}
function copy(a, n) { var o = {}; for (var k in a) o[k] = a[k]; o.nv = n; return o; }

/* for /albumgenre: [best folder, number of versions, place of this folder (0 = best)] or 0 if the album exists once */
function mark(g, dir) { return g ? [g.v[0].dir, g.v.length, rankOf(g, dir)] : 0; }

module.exports = {build: build, index: index, answer: answer, collapse: collapse, mark: mark};
