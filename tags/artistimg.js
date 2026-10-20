/* Artist photos from Deezer (no key needed), loaded once and stored on the player.
   Last.fm has not delivered artist photos since 2019, which is why Volumio only shows an icon there. Node 8, ES5 only. */
var fs     = require('fs');
var path   = require('path');
var crypto = require('crypto');
var coversearch = require('./coversearch.js');

var DEEZER   = process.env.DEEZER_URL || 'https://api.deezer.com';
var NONE_TTL = 30 * 86400 * 1000;      /* no photo: ask again after 30 days */
var PARALLEL = 2;                      /* concurrent requests to Deezer */

function norm(s) {
  s = String(s || '');
  if (s.normalize) s = s.normalize('NFKD');
  return s.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
}

/* dir: storage; opts.lookup(name, cb(image or null, temporary?), extra) replaces the Deezer artist search,
   opts.noneTtl: how long "nothing found" holds, opts.max: at most this many files (oldest get removed) */
function Store(dir, opts) {
  this.dir = dir; this.waiting = {}; this.queue = []; this.running = 0; this.writes = 0;
  opts = opts || {};
  if (opts.lookup) this.lookup = opts.lookup;
  this.noneTtl = opts.noneTtl || NONE_TTL;
  this.max = opts.max || 0;
  if (this.max) this.prune();
}

/* limit storage: delete the oldest files until at most max are left */
Store.prototype.prune = function() {
  var dir = this.dir, max = this.max, list;
  if (!max) return 0;
  try { list = fs.readdirSync(dir); } catch (e) { return 0; }
  if (list.length <= max) return 0;
  list = list.map(function(n){
    try { return {n: n, t: fs.statSync(path.join(dir, n)).mtime.getTime()}; } catch (e) { return null; }
  }).filter(Boolean).sort(function(a, b){ return a.t - b.t; });
  var gone = 0;
  list.slice(0, list.length - max).forEach(function(f){
    try { fs.unlinkSync(path.join(dir, f.n)); gone++; } catch (e) { /* already gone */ }
  });
  return gone;
};

Store.prototype.files = function(name) {
  var h = crypto.createHash('sha1').update(norm(name) || String(name)).digest('hex');
  return {img: path.join(this.dir, h + '.jpg'), none: path.join(this.dir, h + '.none')};
};

/* cb(null, Buffer) or cb(null, null) if there is no photo; extra is passed to lookup */
Store.prototype.get = function(name, cb, extra) {
  var self = this, f = this.files(name);
  fs.readFile(f.img, function(e, buf){
    if (!e) return cb(null, buf);
    var none = null, noneFor = '';
    try { none = fs.statSync(f.none); noneFor = fs.readFileSync(f.none, 'utf8'); } catch (x) { /* never searched yet */ }
    /* "nothing found" holds until the time is up; a new image URL (extra) is still tried */
    if (none && Date.now() - none.mtime.getTime() < self.noneTtl && (!extra || String(extra) === noneFor)) return cb(null, null);
    if (self.waiting[f.img]) return self.waiting[f.img].push(cb);
    self.waiting[f.img] = [cb];
    self.queue.push(function(done){
      self.lookup(name, function(buf, temporary){
        try { fs.mkdirSync(self.dir); } catch (x) { /* already exists */ }
        try {
          if (buf) { fs.writeFileSync(f.img, buf); try { fs.unlinkSync(f.none); } catch (x) { /* there was none */ } }
          else if (!temporary) fs.writeFileSync(f.none, extra ? String(extra) : '');   /* don't remember network errors */
        } catch (x) { /* retry next time */ }
        if (self.max && ++self.writes % 50 === 0) self.prune();
        var list = self.waiting[f.img]; delete self.waiting[f.img];
        list.forEach(function(c){ c(null, buf); });
        done();
      }, extra);
    });
    self.next();
  });
};

Store.prototype.next = function() {
  var self = this;
  while (this.running < PARALLEL && this.queue.length) {
    this.running++;
    this.queue.shift()(function(){ self.running--; self.next(); });
  }
};

/* cb(image or null, temporary error?). Deezer: artist with the same name (ignoring case, accents, "The"); placeholder image does not count */
Store.prototype.lookup = function(name, cb) {
  coversearch.fetchUrl(DEEZER + '/search/artist?limit=10&q=' + encodeURIComponent(name), 256 * 1024, function(e, r){
    if (e) return cb(null, true);
    var list;
    try { list = JSON.parse(r.body.toString('utf8')).data; } catch (x) { return cb(null, true); }
    if (!Array.isArray(list)) return cb(null, true);              /* e.g. error message on too many requests */
    var want = norm(name);
    var hit = list.filter(function(a){ return a && norm(a.name) === want; })
      .sort(function(a, b){ return (b.nb_fan || 0) - (a.nb_fan || 0); })[0];
    var u = hit && (hit.picture_big || hit.picture_medium);
    if (!u || /\/artist\/\/|\/images\/artist\/?$/.test(u)) return cb(null);
    coversearch.image(u, function(e2, img){ cb(e2 ? null : img.body, !!e2); });
  });
};

module.exports = {Store: Store, norm: norm};
