/* Bewertungen (ratings.json im Datenordner): Künstler mit Herz, Alben mit 1–5 Sternen, Titel mit „mag ich nicht“.
   „Mag ich“ bei Titeln sind die Volumio-Favoriten; sie liegen bei Volumio, nicht hier.
   Schlüssel: Künstler normiert (plays.norm), lokale Alben nach Ordner (albums.albumDir), Titel nach Datei;
   Alben und Titel von Streamingdiensten mit "uri:" + Volumio-URI. Node 8, nur ES5. */
var fs     = require('fs');
var plays  = require('./plays.js');
var albums = require('./albums.js');

var LOCAL_RE = /^(INTERNAL|USB|NAS)\//;

/* Volumio-URI -> Datei relativ zur Musikbibliothek ("USB/…"), sonst '' */
function fileOf(uri) {
  var rel = String(uri || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, '');
  return LOCAL_RE.test(rel) ? rel : '';
}

function artistKey(name) { return plays.norm(name); }
/* uri: die eines Titels des Albums (lokal: daraus der Ordner) oder des Albums selbst (Streamingdienst) */
function albumKey(uri) { var f = fileOf(uri); return f ? albums.albumDir(f) : (uri ? 'uri:' + uri : ''); }
function trackKey(uri) { var f = fileOf(uri); return f || (uri ? 'uri:' + uri : ''); }

function Store(file) { this.file = file; this.data = null; this.rev = 0; }   /* rev: zählt Änderungen (Zwischenspeicher) */

Store.prototype.load = function() {
  if (this.data) return this.data;
  var d = null;
  try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* noch leer */ }
  if (!d || typeof d !== 'object') d = {};
  ['artists', 'albums', 'tracks'].forEach(function(k){ if (!d[k] || typeof d[k] !== 'object') d[k] = {}; });
  return (this.data = d);
};

Store.prototype.save = function() {
  var tmp = this.file + '.neu';
  fs.writeFileSync(tmp, JSON.stringify(this.data));
  fs.renameSync(tmp, this.file);
};

/* q: {artist: Name, album: URI, tracks: [URI, …]} -> {artist: 0|1, album: 0–5, tracks: [0|-1, …]} */
Store.prototype.get = function(q) {
  var d = this.load(), out = {};
  function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null; }   /* „constructor“ u. ä. zählen nicht */
  if (q.artist) { var a = own(d.artists, artistKey(q.artist)); out.artist = a ? 1 : 0; }
  if (q.album) { var b = own(d.albums, albumKey(q.album)); out.album = b ? b.v || 0 : 0; }
  if (Array.isArray(q.tracks)) out.tracks = q.tracks.map(function(u){ var t = own(d.tracks, trackKey(u)); return t ? t.v || 0 : 0; });
  return out;
};

/* b: {kind: 'artist'|'album'|'track', v, name | uri, ar, al, ti}; v 0 löscht. Gibt den gültigen Wert zurück oder null. */
Store.prototype.set = function(b, now) {
  var kind = b.kind, v = Math.round(Number(b.v) || 0), key, list, rec;
  if (kind === 'artist') { key = artistKey(b.name); list = 'artists'; if (v < 0 || v > 1) return null; rec = {n: String(b.name)}; }
  else if (kind === 'album') { key = albumKey(b.uri); list = 'albums'; if (v < 0 || v > 5) return null; rec = {al: String(b.al || ''), ar: String(b.ar || '')}; }
  else if (kind === 'track') { key = trackKey(b.uri); list = 'tracks'; if (v !== 0 && v !== -1) return null; rec = {ar: String(b.ar || ''), ti: String(b.ti || '')}; }
  else return null;
  if (!key) return null;
  var d = this.load();
  this.rev++;
  if (!v) delete d[list][key];
  else { rec.v = v; rec.t = now || Math.floor(Date.now() / 1000); d[list][key] = rec; }
  this.save();
  return v;
};

/* Schlüssel aller Titel mit „mag ich nicht“ -> true (für Würfel, Mood Mix und Entdecken) */
Store.prototype.disliked = function() {
  var t = this.load().tracks, out = {};
  Object.keys(t).forEach(function(k){ if (t[k].v === -1) out[k] = true; });
  return out;
};

module.exports = {Store: Store, fileOf: fileOf, artistKey: artistKey, albumKey: albumKey, trackKey: trackKey};
