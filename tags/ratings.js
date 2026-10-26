/* Ratings (ratings.json in the data folder): artists with a heart, albums with 1–5 stars, tracks with "don't like".
   "Like" for tracks is the Volumio favorites; they live in Volumio, not here.
   Keys: normalized artist (plays.norm), local albums by folder (albums.albumDir), tracks by file;
   albums and tracks from streaming services as "uri:" + Volumio URI. Node 8, ES5 only. */
var fs     = require('fs');
var plays  = require('./plays.js');
var albums = require('./albums.js');

var LOCAL_RE = /^(INTERNAL|USB|NAS)\//;
var MAX_PER_KIND = 50000;      /* ratings per kind (artists, albums, tracks): more are refused, changing and deleting still works */
var MAX_TEXT = 300;            /* names stored along with the rating */
function cut(x) { return String(x || '').slice(0, MAX_TEXT); }

/* Volumio URI -> file relative to the music library ("USB/…"), else '' */
function fileOf(uri) {
  var rel = String(uri || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
  return LOCAL_RE.test(rel) ? rel : '';
}

function artistKey(name) { return plays.norm(name); }
/* uri: that of a track of the album (local: the folder is derived from it) or of the album itself (streaming service) */
function albumKey(uri) { var f = fileOf(uri); return f ? albums.albumDir(f) : (uri ? 'uri:' + uri : ''); }
function trackKey(uri) { var f = fileOf(uri); return f || (uri ? 'uri:' + uri : ''); }

function Store(file) { this.file = file; this.data = null; this.rev = 0; }   /* rev: counts changes (cache) */

Store.prototype.load = function() {
  if (this.data) return this.data;
  var d = null;
  try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* still empty */ }
  if (!d || typeof d !== 'object') d = {};
  ['artists', 'albums', 'tracks'].forEach(function(k){ if (!d[k] || typeof d[k] !== 'object') d[k] = {}; });
  return (this.data = d);
};

Store.prototype.save = function() {
  var tmp = this.file + '.neu';
  fs.writeFileSync(tmp, JSON.stringify(this.data));
  fs.renameSync(tmp, this.file);
};

/* q: {artist: name, album: URI, tracks: [URI, …]} -> {artist: 0|1, album: 0–5, tracks: [0|-1, …]} */
Store.prototype.get = function(q) {
  var d = this.load(), out = {};
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }   /* "constructor" and the like don't count */
  if (q.artist) { var a = own(d.artists, artistKey(q.artist)); out.artist = a ? 1 : 0; }
  if (q.album) { var b = own(d.albums, albumKey(q.album)); out.album = b ? b.v || 0 : 0; }
  if (Array.isArray(q.tracks)) out.tracks = q.tracks.map(function(u){ var t = own(d.tracks, trackKey(u)); return t ? t.v || 0 : 0; });
  return out;
};

/* b: {kind: 'artist'|'album'|'track', v, name | uri, ar, al, ti}; v 0 deletes. Returns the valid value or null. */
Store.prototype.set = function(b, now) {
  var kind = b.kind, v = Math.round(Number(b.v) || 0), key, list, rec;
  if (kind === 'artist') { key = artistKey(b.name); list = 'artists'; if (v < 0 || v > 1) return null; rec = {n: cut(b.name)}; }
  else if (kind === 'album') { key = albumKey(b.uri); list = 'albums'; if (v < 0 || v > 5) return null; rec = {al: cut(b.al), ar: cut(b.ar)}; }
  else if (kind === 'track') { key = trackKey(b.uri); list = 'tracks'; if (v !== 0 && v !== -1) return null; rec = {ar: cut(b.ar), ti: cut(b.ti)}; }
  else return null;
  if (!key || key.length > 1000) return null;
  var d = this.load();
  if (v && !Object.prototype.hasOwnProperty.call(d[list], key) && Object.keys(d[list]).length >= MAX_PER_KIND) return null;
  this.rev++;
  if (!v) delete d[list][key];
  else { rec.v = v; rec.t = now || Math.floor(Date.now() / 1000); d[list][key] = rec; }
  this.save();
  return v;
};

/* keys of all tracks with "don't like" -> true (for dice, Mood Mix and Discover) */
Store.prototype.disliked = function() {
  var t = this.load().tracks, out = {};
  Object.keys(t).forEach(function(k){ if (t[k].v === -1) out[k] = true; });
  return out;
};

module.exports = {MAX_PER_KIND: MAX_PER_KIND, Store: Store, fileOf: fileOf, artistKey: artistKey, albumKey: albumKey, trackKey: trackKey};
