/* Own lists without Volumio (PLAYER 'mpd'): favourite tracks ("thumbs up") as an MPD playlist, favourite radio
   stations as a file (MPD playlists keep no names or logos). Answers in the shape of Volumio's browse, so the
   interface shows them as before. Node 8, ES5 only.
   Favourites: playlist FAV (hidden in the playlist list by mpdlibrary.js). Stations: [{title, uri, albumart}]. */
var fs = require('fs');
var path = require('path');

var FAV = 'Xplorio Favoriten';
var RADIO_MAX = 500;
function quote(s) { return '"' + String(s).replace(/[\\"]/g, '\\$&') + '"'; }
function fileOf(uri) { return String(uri || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''); }
function nav(items) { return {navigation: {prev: {uri: ''}, lists: [{title: '', availableListViews: ['list'], items: items}]}}; }
function lines2songs(lines) {
  var out = [], cur = null;
  (lines || []).forEach(function(l){
    var i = l.indexOf(': '), k = l.slice(0, i).toLowerCase(), v = l.slice(i + 2);
    if (k === 'file') { cur = {file: v}; out.push(cur); } else if (cur) cur[k] = v;
  });
  return out;
}

/* opts: mpd(cmds, cb), radioFile */
function Lists(opts) { this.o = opts; }

/* ---------- favourite tracks ---------- */
Lists.prototype.favourites = function(cb) {
  this.o.mpd(['listplaylistinfo ' + quote(FAV)], function(err, lists){
    if (err) return cb(null, nav([]));                    /* no favourites yet: no playlist */
    cb(null, nav(lines2songs(lists[0]).map(function(s){
      return {service: 'mpd', type: 'song', uri: 'music-library/' + s.file, title: s.title || path.basename(s.file),
              artist: s.artist || '', album: s.album || '', albumart: '/albumart?path=' + encodeURIComponent('/mnt/' + path.dirname(s.file))};
    })));
  });
};
Lists.prototype.favAdd = function(uri, cb) {
  var self = this, f = fileOf(uri);
  if (!f || /^https?:/i.test(f) || f.indexOf('\n') >= 0) return cb(new Error('uri'));
  this.o.mpd(['listplaylist ' + quote(FAV)], function(err, lists){
    var have = !err && (lists[0] || []).some(function(l){ return l === 'file: ' + f; });
    if (have) return cb(null);
    self.o.mpd(['playlistadd ' + quote(FAV) + ' ' + quote(f)], function(e){ cb(e); });
  });
};
Lists.prototype.favRemove = function(uri, cb) {
  var self = this, f = fileOf(uri);
  this.o.mpd(['listplaylist ' + quote(FAV)], function(err, lists){
    if (err) return cb(null);
    var pos = [];
    (lists[0] || []).filter(function(l){ return l.indexOf('file: ') === 0; }).forEach(function(l, i){ if (l === 'file: ' + f) pos.push(i); });
    if (!pos.length) return cb(null);
    self.o.mpd(pos.reverse().map(function(p){ return 'playlistdelete ' + quote(FAV) + ' ' + p; }), function(e){ cb(e); });
  });
};

/* ---------- favourite radio stations ---------- */
Lists.prototype.stations = function() {
  try { var l = JSON.parse(fs.readFileSync(this.o.radioFile, 'utf8')); return Array.isArray(l) ? l : []; } catch (e) { return []; }
};
Lists.prototype.saveStations = function(l) {
  var f = this.o.radioFile;
  try { fs.mkdirSync(path.dirname(f), {recursive: true}); } catch (e) { /* exists */ }
  fs.writeFileSync(f + '.neu', JSON.stringify(l, null, 1));
  fs.renameSync(f + '.neu', f);
};
Lists.prototype.radio = function() {
  return nav(this.stations().map(function(s){
    return {service: 'webradio', type: 'webradio', title: s.title, name: s.title, uri: s.uri, albumart: s.albumart || ''};
  }));
};
Lists.prototype.radioAdd = function(st) {
  var uri = String((st && st.uri) || '').trim(), title = String((st && st.title) || '').trim().slice(0, 200) || uri;
  var art = String((st && st.albumart) || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(uri) || uri.length > 2000) return {error: 'uri'};
  if (art && !/^https?:\/\/[^\s]+$/i.test(art)) art = '';
  var l = this.stations().filter(function(s){ return s.uri !== uri; });
  if (l.length >= RADIO_MAX) return {error: 'full'};
  l.push({title: title, uri: uri, albumart: art});
  this.saveStations(l);
  return {ok: true};
};
Lists.prototype.radioRemove = function(uri) {
  var l = this.stations(), rest = l.filter(function(s){ return s.uri !== uri; });
  if (rest.length !== l.length) this.saveStations(rest);
  return {ok: true};
};

module.exports = {Lists: Lists, FAV: FAV};
