/* Codec and resolution of m4a files on the player itself (ALAC or AAC), for the duplicate albums: MPD does not always
   report the format of an m4a correctly (missing, or float samples for ALAC), so the best version would be chosen wrongly.
   Reads only the header boxes, like web/js/mp4probe.js in the browser, whose parsing it uses. Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var WINDOW = 65536, MOOV_MAX = 524288;
var mp4 = (function(){                     /* the pure parts of mp4probe.js (mp4U32, mp4Type, mp4Audio) */
  var ctx = {window: {APP_CONFIG: {}}, fetch: function(){ throw new Error('no fetch'); }};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'web', 'js', 'mp4probe.js'), 'utf8'), ctx);
  return ctx;
})();

/* full path -> cb({codec:'alac'|'aac'|…, bits, rate} | null) */
function probe(file, cb) {
  fs.open(file, 'r', function(e, fd){
    if (e) return cb(null);
    var steps = 0;
    function done(r) { fs.close(fd, function(){ cb(r); }); }
    function read(off, len, fn) {
      var b = Buffer.alloc(len);
      fs.read(fd, b, 0, len, off, function(err, n){ fn(err ? null : b.slice(0, n)); });
    }
    function at(off) {
      if (++steps > 8) return done(null);
      read(off, WINDOW, function(b){
        if (!b || !b.length) return done(null);
        var o = 0;
        while (o + 8 <= b.length) {
          var size = mp4.mp4U32(b, o), type = mp4.mp4Type(b, o + 4), hdr = 8;
          if (size === 1) { if (o + 16 > b.length) return done(null); size = mp4.mp4U32(b, o + 8) * 4294967296 + mp4.mp4U32(b, o + 12); hdr = 16; }
          if (type === 'moov') return read(off + o, Math.min(size, MOOV_MAX), function(m){
            var r = null;
            try { r = m && mp4.mp4Audio(m, hdr, m.length); } catch (x) { r = null; }
            if (!r) return done(null);
            var o2 = {codec: r.codec};                   /* a plain object of this context */
            if (r.bits) o2.bits = r.bits;
            if (r.rate) o2.rate = r.rate;
            done(o2);
          });
          if (size === 0 || size < hdr) return done(null);
          o += size;
          if (o >= b.length) return at(off + o);
        }
        done(null);
      });
    }
    at(0);
  });
}

/* songs (libcheck.mpdWalk) of the folders dirs: one m4a per folder is probed, its result goes into the format of all m4a
   songs of that folder as MPD would write it ("192000:24:2" for ALAC, "44100:f:2" for AAC). cb() when done */
function fixFormats(songs, dirs, root, cb) {
  var byDir = {};
  songs.forEach(function(s){
    if (!/\.(m4a|mp4)$/i.test(s.file)) return;
    var d = path.dirname(s.file);
    if (dirs[d]) (byDir[d] = byDir[d] || []).push(s);
  });
  var list = Object.keys(byDir), i = 0;
  (function next() {
    if (i >= list.length) return cb();
    var d = list[i++], first = byDir[d][0];
    probe(path.join(root, first.file), function(r){
      if (r && (r.codec === 'alac' || r.codec === 'aac')) {
        byDir[d].forEach(function(s){
          var old = String(s.format || '').split(':'), rate = r.rate || parseInt(old[0], 10) || 44100;
          s.format = r.codec === 'alac' ? rate + ':' + (r.bits || 16) + ':2' : rate + ':f:2';
        });
      }
      setImmediate(next);
    });
  })();
}

module.exports = {probe: probe, fixFormats: fixFormats};
