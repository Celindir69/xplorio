/* Radio addresses that are playlists, not streams, for MPD (PLAYER 'mpd'): TuneIn's opml.radiotime.com/Tune.ashx?id=…
   (stations from Volumio's favourites), .pls and .m3u. Volumio resolves them itself; MPD plays them only in part.
   Here: fetched when the station is added to the queue, the first stream address goes to MPD; decorate() puts the
   station's own address, name and logo back on state and queue, so "Meine Sender" and the favourite heart still match.
   Node 8, ES5 only, no packages. opts: get(url, cb(err, {type, body})) (tests), log(text) */
var http = require('http');
var https = require('https');
var urlMod = require('url');

var MAX_BODY = 64 * 1024, TIMEOUT = 8000, MAX_DEPTH = 3, MAX_KNOWN = 200;
var PLAYLIST_TYPE = /mpegurl|scpls|pls|text\/|x-scpls|playlist/i;   /* not m3u8 (HLS): MPD plays that through ffmpeg */

function isPlaylist(u) {
  u = String(u || '');
  return /^https?:\/\/opml\.radiotime\.com\/Tune\.ashx\b/i.test(u) || /^https?:\/\/[^?#]+\.(pls|m3u)([?#]|$)/i.test(u);
}
/* playlist text -> [stream addresses]: PLS (FileN=) or M3U/plain (one address per line) */
function parse(text) {
  var t = String(text || ''), out = [];
  if (/^\s*\[playlist\]/i.test(t)) t.replace(/^\s*File\d+\s*=\s*(\S+)\s*$/gim, function(_, u){ out.push(u); return ''; });
  else t.split(/\r?\n/).forEach(function(l){ l = l.trim(); if (l.charAt(0) !== '#' && /^https?:\/\/\S+$/i.test(l)) out.push(l); });
  return out.filter(function(u){ return /^https?:\/\/\S+$/i.test(u) && u.length <= 2000; });
}

/* GET with redirects; a stream answer (audio, or longer than MAX_BODY) -> {stream: true}, nothing more read */
function get(u, cb, hops) {
  hops = hops || 0;
  var done = false;
  function finish(e, r) { if (!done) { done = true; cb(e, r); } }
  var p; try { p = urlMod.parse(u); } catch (e) { return finish(e); }
  var lib = p.protocol === 'https:' ? https : p.protocol === 'http:' ? http : null;
  if (!lib) return finish(new Error('protocol'));
  var req = lib.get({protocol: p.protocol, hostname: p.hostname, port: p.port, path: p.path, headers: {'User-Agent': 'Xplorio', 'Icy-MetaData': '0'}}, function(res){
    var loc = res.headers.location;
    if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
      res.resume();
      if (hops >= 5) return finish(new Error('too many redirects'));
      return get(urlMod.resolve(u, loc), finish, hops + 1);
    }
    if (res.statusCode !== 200) { res.resume(); return finish(new Error('HTTP ' + res.statusCode)); }
    var type = String(res.headers['content-type'] || '');
    if (/^(audio|video)\//i.test(type) && !PLAYLIST_TYPE.test(type)) { res.destroy(); return finish(null, {stream: true, url: u}); }
    var chunks = [], size = 0;
    res.on('data', function(d){
      size += d.length; chunks.push(d);
      if (size > MAX_BODY) { res.destroy(); finish(null, {stream: true, url: u}); }
    });
    res.on('end', function(){ finish(null, {type: type, body: Buffer.concat(chunks).toString('utf8'), url: u}); });
    res.on('error', finish);
  });
  req.setTimeout(TIMEOUT, function(){ req.abort(); finish(new Error('timeout')); });
  req.on('error', finish);
}

function Resolver(opts) {
  opts = opts || {};
  this.get = opts.get || get;
  this.log = opts.log || function(){};
  this.known = {};                                       /* stream address -> {uri, title, albumart} */
  this.order = [];
}
Resolver.prototype.handles = function(item) {
  return !!item && (item.service === 'webradio' || item.type === 'webradio' || !item.service) && isPlaylist(item.uri);
};
/* address -> cb(err, stream address) */
Resolver.prototype.resolve = function(u, cb, depth) {
  var self = this;
  depth = depth || 0;
  this.get(u, function(e, r){
    if (e) return cb(e);
    if (r.stream) return cb(null, r.url || u);
    var list = parse(r.body);
    if (!list.length) return cb(new Error('no stream in ' + u));
    if (isPlaylist(list[0]) && depth < MAX_DEPTH) return self.resolve(list[0], cb, depth + 1);
    cb(null, list[0]);
  });
};
/* item {uri, title, albumart} -> cb(err, [MPD address]); on failure the address as it is (MPD may still manage) */
Resolver.prototype.expand = function(item, cb) {
  var self = this, uri = String(item.uri);
  this.resolve(uri, function(e, stream){
    if (e) { self.log('radio: ' + uri + ': ' + e.message); return cb(null, [uri]); }
    if (!self.known[stream]) { self.order.push(stream); if (self.order.length > MAX_KNOWN) delete self.known[self.order.shift()]; }
    self.known[stream] = {uri: uri, title: String(item.title || item.name || ''), albumart: String(item.albumart || '')};
    cb(null, [stream]);
  });
};
/* MPD's address -> the station's own on a state or queue entry */
Resolver.prototype.decorate = function(file, o) {
  var k = this.known[file];
  if (!k) return false;
  o.uri = k.uri;
  if (k.title && (!o.title || o.title === file)) { o.title = k.title; if (o.name !== undefined) o.name = k.title; }
  if (k.albumart && !o.albumart) o.albumart = k.albumart;
  if (k.title && o.title !== k.title && o.artist !== undefined && o.type === undefined) o.artist = k.title;   /* state: station below the title */
  return true;
};

module.exports = {Resolver: Resolver, parse: parse, isPlaylist: isPlaylist, get: get};
