/* Clean up the audio analysis on the Mac (settings page "Audio analysis", "Clean up analysis"): essentia.jsonl keeps
   entries of files that are gone (moved, renamed, deleted) and of old paths, and the tag service takes the first entry of
   a track (artist + title), which may be an outdated one. Removed are:
   - older lines of the same path (the last one counts),
   - entries of files that no longer exist, but only when their drive is there (a disconnected drive keeps its entries),
   - entries outside the music folders whose track (artist + title) also has an entry inside them.
   Entries of other files outside the music folders stay (nothing else knows them). Before writing, a copy goes to
   essentia.jsonl.bak. Directories are read once each and asynchronously (network shares). Node 8, ES5 only. */
var fs = require('fs');
var path = require('path');
var jsonl = require('./jsonl.js');
var moodtags = require('./moodtags.js');

var PARALLEL = 8;

function under(p, roots) {
  for (var i = 0; i < roots.length; i++) if (roots[i] && (p === roots[i] || p.indexOf(roots[i].replace(/\/$/, '') + '/') === 0)) return true;
  return false;
}

/* o: file, inside [music folders, also their link targets], bases [folders where drives or links hang: '/', '/Volumes',
   the music root and its slots], readdir (tests) -> cb(err, {total, keep, drop: {dup, missing, outside}, offline, lines}) */
function scan(o, cb) {
  var readdir = o.readdir || fs.readdir, inside = o.inside || [], bases = (o.bases || []).concat(['/', '/Volumes']).map(function(b){ return path.resolve(b); });
  var lines = [], lastOf = {}, broken = 0;
  var ok = jsonl.eachLine(o.file, function(l){
    var e = jsonl.parse(l);
    if (!e || typeof e.p !== 'string' || !e.p) { broken++; return; }
    lastOf[e.p] = lines.length;
    lines.push({l: l, p: e.p, k: e.ar && e.ti ? moodtags.trackKey(e.ar, e.ti) : ''});
  });
  if (!ok) return cb(new Error('not readable'));
  var dirs = {}, list = [];
  lines.forEach(function(x){ var d = path.dirname(x.p); if (!dirs.hasOwnProperty(d)) { dirs[d] = undefined; list.push(d); } });
  /* each folder once: its names, or null when it is not there */
  var i = 0, running = 0;
  (function more(){
    if (i >= list.length && !running) return decide();
    while (running < PARALLEL && i < list.length) {
      var d = list[i++];
      running++;
      (function(d){
        readdir(d, function(e, names){
          var set = null;
          if (!e && names) { set = {}; names.forEach(function(n){ set[n] = 1; }); }
          dirs[d] = set; running--; more();
        });
      })(d);
    }
  })();
  var reach = {};
  /* the file's drive is there: the nearest existing folder above it is not just where drives hang */
  function reachable(d) {
    if (reach.hasOwnProperty(d)) return reach[d];
    var r;
    if (bases.indexOf(d) >= 0 || d === path.dirname(d)) r = false;
    else if (dirs[d] || (dirs[d] === undefined && fs.existsSync(d))) r = true;
    else r = reachable(path.dirname(d));
    return (reach[d] = r);
  }
  function decide() {
    var res = {total: lines.length + broken, keep: 0, drop: {dup: 0, missing: 0, outside: 0, broken: broken}, offline: 0, lines: []};
    var insideKeys = {}, state = [], off = {};
    lines.forEach(function(x, n){
      if (lastOf[x.p] !== n) return state.push('dup');
      var d = path.dirname(x.p), set = dirs[d];
      var exists = !!(set && set[path.basename(x.p)]);
      if (!exists && reachable(d)) return state.push('missing');
      if (!exists) off[n] = 1;                         /* drive not there: kept, unless it is an old path (below) */
      var inn = under(x.p, inside);
      if (inn && x.k) insideKeys[x.k] = 1;
      state.push(inn ? 'keep' : 'out');
    });
    lines.forEach(function(x, n){
      var s = state[n];
      if (s === 'out') s = x.k && insideKeys[x.k] ? 'outside' : 'keep';
      if (s === 'keep') { res.keep++; res.lines.push(x.l); if (off[n]) res.offline++; }
      else res.drop[s]++;
    });
    res.removed = res.drop.dup + res.drop.missing + res.drop.outside + res.drop.broken;
    cb(null, res);
  }
}

/* scan and write: copy to <file>.bak, then the kept lines -> cb(err, result without lines); dry: only count */
function clean(o, cb) {
  scan(o, function(e, r){
    if (e) return cb(e);
    var lines = r.lines;
    delete r.lines;
    if (o.dry || !r.removed) return cb(null, r);
    try {
      fs.writeFileSync(o.file + '.bak', fs.readFileSync(o.file));
      fs.writeFileSync(o.file + '.neu', lines.length ? lines.join('\n') + '\n' : '');
      fs.renameSync(o.file + '.neu', o.file);
    } catch (x) { return cb(x); }
    r.cleaned = true;
    cb(null, r);
  });
}

module.exports = {scan: scan, clean: clean};
