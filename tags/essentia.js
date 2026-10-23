/* Audio analysis with Essentia (runs on the Mac, tools/essentia/analyse.py): read the result file essentia.jsonl
   and convert it per track into mood, energy 1-5, style, BPM and key. Matched by artist and title
   (like the Last.fm tags), so folder structure and drive on the Mac don't matter. Node 8, ES5 only.

   One line of the file (v = version of the analysis script):
   {"v":1,"p":"Musik/A/B/01.flac","ar":"…","ti":"…","al":"…","d":245,"bpm":118.2,"key":"A","scale":"minor",
    "mood":{"happy":0.12,"sad":0.71,"relaxed":0.64,"aggressive":0.03,"party":0.08},"dance":0.31,"voice":0.88,
    "val":4.1,"aro":3.6,"styles":[["Electronic---Trip Hop",0.41],…]} */
var fs = require('fs');
var moodtags = require('./moodtags.js');
var jsonl = require('./jsonl.js');

var PROB = 0.6;                  /* from this probability on a mood counts */
var RELOAD_CHECK_MS = 10000;     /* check at most this often whether the file is new */
var STYLES_MAX = 5, STYLES_MIN = 0.05;   /* strongest styles per track (like analyse.py writes them; older or other files) */

/* value at position q (0..1) of a sorted list */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  var i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

/* one track in memory: always the same fields in the same order (compact objects in V8). Only what is evaluated:
   artist and title are in the key, path, size and the like are needed only by the analysis script on the Mac.
   intern: same text -> same string, e.g. the style names that thousands of tracks share */
function num(x) { return typeof x === 'number' ? x : null; }
function Mood(m) {
  this.happy = num(m.happy); this.sad = num(m.sad); this.relaxed = num(m.relaxed);
  this.aggressive = num(m.aggressive); this.party = num(m.party);
}
function Entry(o, intern) {
  this.al = o.al ? intern(String(o.al)) : '';
  this.bpm = num(o.bpm); this.key = o.key ? intern(String(o.key)) : ''; this.scale = o.scale ? intern(String(o.scale)) : '';
  this.mood = o.mood && typeof o.mood === 'object' ? new Mood(o.mood) : null;
  this.dance = num(o.dance); this.voice = num(o.voice); this.val = num(o.val); this.aro = num(o.aro);
  var st = (Array.isArray(o.styles) ? o.styles : []).filter(function(x){ return x && x[0] && +x[1] >= STYLES_MIN; });
  if (st.length > STYLES_MAX) st = st.sort(function(a, b){ return b[1] - a[1]; }).slice(0, STYLES_MAX);
  this.styles = st.map(function(x){ return [intern(String(x[0])), +x[1]]; });
  this._c = null;                                           /* classify cache */
}

function Store(file) {
  this.file = file; this.byKey = {}; this.n = 0; this.at = 0; this.mtime = 0; this.checked = 0; this.stats = null;
  this.reload();
}

/* reread if the file has changed; true = data has changed */
Store.prototype.reload = function(force) {
  if (!force && Date.now() - this.checked < RELOAD_CHECK_MS) return false;
  this.checked = Date.now();
  var st = null;
  try { st = fs.statSync(this.file); } catch (e) {
    if (!this.mtime) return false;
    this.byKey = {}; this.n = 0; this.mtime = 0; this.stats = null; return true;
  }
  if (!force && st.mtime.getTime() === this.mtime) return false;
  var by = {}, n = 0, aro = [], val = [], strings = {};
  function intern(x) { return strings.hasOwnProperty(x) ? strings[x] : (strings[x] = x); }
  var ok = jsonl.eachLine(this.file, function(l){            /* line by line: never the whole file in memory at once */
    var o = jsonl.parse(l);
    if (!o || !o.ar || !o.ti || o.err) return;
    var k = moodtags.trackKey(o.ar, o.ti);
    var list = by[k] || (by[k] = []);
    list.push(o = new Entry(o, intern));
    n++;
    if (typeof o.aro === 'number') aro.push(o.aro);
    if (typeof o.val === 'number') val.push(o.val);
  });
  if (!ok) return false;
  aro.sort(function(a, b){ return a - b; }); val.sort(function(a, b){ return a - b; });
  /* energy and mood quadrants relative to the own collection: DEAM values otherwise crowd in the middle */
  this.stats = {aLo: quantile(aro, 0.02), aHi: quantile(aro, 0.98), vLow: quantile(val, 0.33), vHigh: quantile(val, 0.67),
                aLow: quantile(aro, 0.33), aHigh: quantile(aro, 0.67)};
  this.byKey = by; this.n = n; this.mtime = st.mtime.getTime(); this.at = this.mtime;
  return true;
};

/* matching entry: same album preferred, else the first */
Store.prototype.get = function(ar, ti, al) {
  this.reload();
  var list = this.byKey[moodtags.trackKey(ar, ti)];
  if (!list) return null;
  if (al && list.length > 1) {
    var a = String(al).toLowerCase();
    for (var i = 0; i < list.length; i++) if (String(list[i].al || '').toLowerCase() === a) return list[i];
  }
  return list[0];
};

/* entry -> {mood, energy, style, bpm, key, dance, voice} in the mood tag vocabulary (once per file version) */
Store.prototype.classify = function(o) {
  if (!o) return null;
  if (o._c && o._c.at === this.mtime) return o._c.r;
  var r = this.classifyNow(o);
  o._c = {at: this.mtime, r: r};
  return r;
};
Store.prototype.classifyNow = function(o) {
  var s = this.stats || {}, m = o.mood || {}, mood = [];
  function add(x) { if (mood.indexOf(x) < 0) mood.push(x); }
  if (m.happy >= PROB) add('happy');
  if (m.party >= PROB) add('uplifting');
  if (m.relaxed >= PROB) add('relaxed');
  if (m.sad >= PROB) add('sad');
  if (m.aggressive >= PROB) { add('aggressive'); add('intense'); }
  var energy = null, a = o.aro, v = o.val;
  if (typeof a === 'number' && s.aHi > s.aLo) {
    energy = Math.round(1 + 4 * (a - s.aLo) / (s.aHi - s.aLo));
    energy = Math.max(1, Math.min(5, energy));
    if (typeof v === 'number') {
      if (v <= s.vLow && a <= s.aLow) add('melancholic');
      if (v <= s.vLow && a >= s.aHigh) add('dark');
      if (v >= s.vHigh && a <= s.aLow) add('calm');
    }
  }
  /* send Discogs styles through the existing mapping like Last.fm tags (weight = probability) */
  var raw = [];
  (o.styles || []).forEach(function(x){
    var parts = String(x[0] || '').split('---'), w = Math.round((x[1] || 0) * 100);
    if (parts[1]) raw.push([parts[1], w]);
    if (parts[0]) raw.push([parts[0], Math.round(w / 2)]);
  });
  var st = raw.length ? moodtags.classify(raw) : null;
  return {mood: mood.slice(0, 4), energy: energy, style: st ? st.style : [],
          bpm: typeof o.bpm === 'number' ? Math.round(o.bpm) : null, key: o.key ? o.key + (o.scale === 'minor' ? 'm' : '') : null,
          dance: typeof o.dance === 'number' ? o.dance : null, voice: typeof o.voice === 'number' ? o.voice : null};
};

/* extend the mood tag result (lf, may be null) with the audio analysis */
Store.prototype.combine = function(lf, ar, ti, al) {
  var o = this.get(ar, ti, al);
  return o ? merge(lf, this.classify(o)) : lf;
};

Store.prototype.status = function() {
  this.reload();
  return {tracks: this.n, at: this.at || null};
};

/* merge the Last.fm result (track/artist) and the audio analysis:
   energy and BPM from the audio, moods and styles from both (audio first) */
function merge(lf, au) {
  if (!au) return lf;
  var r = {mood: au.mood.slice(), energy: au.energy, style: au.style.slice(), src: lf && lf.src === 'track' ? 'track' : 'audio',
           audio: true, bpm: au.bpm, key: au.key, dance: au.dance, voice: au.voice};
  if (lf) {
    lf.mood.forEach(function(x){ if (r.mood.indexOf(x) < 0 && r.mood.length < 5) r.mood.push(x); });
    lf.style.forEach(function(x){ if (r.style.indexOf(x) < 0 && r.style.length < 5) r.style.push(x); });
    if (r.energy === null) r.energy = lf.energy;
  }
  return r.mood.length || r.energy !== null || r.style.length || r.bpm ? r : lf;
}

module.exports = {Store: Store, merge: merge, PROB: PROB};
