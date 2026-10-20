/* Mood tags: collect Last.fm tags per track (track.getTopTags, falling back to artist.getTopTags) and convert them
   via mood/lastfm_mapping.json and mood/classification_rules.json into mood (MOOD), energy 1-5 (ENERGY) and style (STYLE).
   The raw tags stay on the player (moodtags/*.jsonl); the music files are not changed.
   Queries run only while nothing is playing. Node 8, ES5 only. */
var fs     = require('fs');
var path   = require('path');
var plays  = require('./plays.js');
var jsonl  = require('./jsonl.js');
var lastfm = require('./lastfm.js');

var MAPPING = require('./mood/lastfm_mapping.json');
var RULES   = require('./mood/classification_rules.json');

var STEP_MS     = 250;            /* interval between requests (Last.fm allows about 5 per second) */
var IDLE_MS     = 5000;           /* how often to check whether music is playing */
var WAIT_MS     = 30000;          /* pause while music is playing or there is nothing to do */
var BACKOFF_MS  = 60000;          /* after network or rate-limit error */
var ARTIST_FACTOR = 0.6;          /* artist tags count less than track tags */

/* ---------- convert ---------- */

function canon(tag) {
  var s = String(tag || '');
  if (s.normalize) s = s.normalize('NFKC');
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

var index = (function(){
  var alias = {}, ignore = {};
  Object.keys(MAPPING.entries).forEach(function(k){
    alias[canon(k)] = k;
    (MAPPING.entries[k].aliases || []).forEach(function(a){ if (!alias[canon(a)]) alias[canon(a)] = k; });
  });
  (MAPPING.ignore || []).forEach(function(i){ ignore[canon(i.tag)] = true; (i.aliases || []).forEach(function(a){ ignore[canon(a)] = true; }); });
  return {alias: alias, ignore: ignore};
})();

function pickValues(scores, rule) {
  var list = Object.keys(scores).map(function(v){ return {v: v, s: scores[v]}; }).sort(function(a, b){ return b.s - a.s; });
  var best = list.length ? list[0].s : 0;
  return list.filter(function(x){ return x.s >= rule.minimum_score && x.s >= best - rule.minimum_margin_from_best; }).slice(0, rule.max_values);
}

/* raw: [[tag, count], ...] as from Last.fm (strongest first); factor < 1 weakens (artist tags).
   -> {mood: [..], energy: 1-5 or null, style: [..]} or null without usable tags */
function classify(raw, factor) {
  factor = factor || 1;
  var inp = RULES.input, list = (raw || []).slice(0, inp.max_lastfm_tags);
  var max = 0;
  list.forEach(function(t){ if (t[1] > max) max = t[1]; });
  if (!max) return null;
  var best = {};                                       /* canonical tag -> highest count */
  list.forEach(function(t){
    var c = canon(t[0]), n = t[1];
    if (n < inp.minimum_lastfm_count || n / max < inp.minimum_relative_count || index.ignore[c]) return;
    var k = index.alias[c];
    if (k && !(best[k] >= n)) best[k] = n;
  });
  var mood = {}, style = {}, eSum = 0, eEv = 0, bSum = 0, bEv = 0, any = false;
  Object.keys(best).forEach(function(k){
    var n = best[k] / max * factor, tg = MAPPING.entries[k].targets;
    any = true;
    (tg.MOOD || []).forEach(function(m){ mood[m.value] = (mood[m.value] || 0) + n * m.weight * m.confidence; });
    (tg.STYLE || []).forEach(function(m){ style[m.value] = (style[m.value] || 0) + n * m.weight * m.confidence; });
    if (tg.ENERGY) {
      var ev = n * tg.ENERGY.weight * tg.ENERGY.confidence;
      if (tg.ENERGY.weight < 0.7) { bSum += ev * tg.ENERGY.value; bEv += ev; }   /* broad genre (rock, classical …) */
      else { eSum += ev * tg.ENERGY.value; eEv += ev; }
    }
  });
  if (!any) return null;
  var moods = pickValues(mood, RULES.output.MOOD);
  /* keep opposites only if both sides have enough evidence of their own */
  (RULES.conflict_rules || []).forEach(function(r){
    if (!Array.isArray(r.if)) return;
    var m = /at_least_([\d.]+)/.exec(r.action), min = m ? parseFloat(m[1]) : 0.35;
    var a = moods.filter(function(x){ return x.v === r.if[0]; })[0], b = moods.filter(function(x){ return x.v === r.if[1]; })[0];
    if (a && b && (a.s < min || b.s < min)) moods.splice(moods.indexOf(a.s < b.s ? a : b), 1);
  });
  var energy = null, er = RULES.output.ENERGY;
  if (eEv) { if (eEv >= er.minimum_total_evidence) energy = Math.round(eSum / eEv); }   /* specific styles before broad genres */
  else if (bEv >= er.minimum_total_evidence) energy = Math.round(bSum / bEv);
  if (energy !== null) energy = Math.max(er.range[0], Math.min(er.range[1], energy));
  var out = {mood: moods.map(function(x){ return x.v; }), energy: energy,
             style: pickValues(style, RULES.output.STYLE).map(function(x){ return x.v; })};
  return out.mood.length || out.energy !== null || out.style.length ? out : null;
}

/* ---------- collect ---------- */

function trackKey(ar, ti) { return plays.norm(ar) + '|' + plays.norm(ti); }
function mainArtist(ar) { return String(ar || '').split(/\s+(?:feat\.?|ft\.?|featuring|with|&|und|and|x|vs\.?)\s+|\s*[,;\/]\s*/i)[0].trim(); }
function artistKey(ar) { return plays.norm(mainArtist(ar)); }

function readJsonl(file, into) {
  jsonl.eachLine(file, function(l){ var o = jsonl.parse(l); if (o && o.k) into[o.k] = o; });   /* broken lines are dropped */
}

/* opts: dir, libFile (track list [[artist, title, file], …]), getCfg() -> {key}, playing(cb(true/false));
   audio: essentia.Store (audio analysis from the Mac), optional;
   libRaw() -> {m: modification time, list: track list}, optional: already read list instead of reading libFile itself;
   stepMs, idleMs, waitMs, backoffMs for tests only */
function Collector(opts) {
  this.t = {step: opts.stepMs || STEP_MS, idle: opts.idleMs || IDLE_MS, wait: opts.waitMs || WAIT_MS, backoff: opts.backoffMs || BACKOFF_MS};
  this.dir = opts.dir; this.libFile = opts.libFile; this.getCfg = opts.getCfg; this.playing = opts.playing;
  this.audio = opts.audio || null; this.libRaw = opts.libRaw || null;
  this.tracks = {}; this.artists = {}; this.lib = null; this.libAt = 0;
  this.pos = 0; this.timer = null; this.running = false; this.state = 'aus'; this.error = null;
  this.lastIdleCheck = 0; this.idle = false; this.fetched = 0; this.summaryCache = null; this.doneLib = 0;
  readJsonl(path.join(this.dir, 'tracks.jsonl'), this.tracks);
  readJsonl(path.join(this.dir, 'artists.jsonl'), this.artists);
}

Collector.prototype.loadLib = function() {
  var raw = null, m = 0;
  if (this.libRaw) {                                   /* share the service's list: the strings only once in memory */
    raw = this.libRaw();
    if (!raw || !Array.isArray(raw.list)) return this.lib || [];
    m = raw.m;
  } else {
    var st = null;
    try { st = fs.statSync(this.libFile); } catch (e) { return this.lib || []; }
    m = st.mtime.getTime();
  }
  if (this.lib && m === this.libAt) return this.lib;
  var list = [], seen = {}, libFile = this.libFile;
  try {
    (raw ? raw.list : JSON.parse(fs.readFileSync(libFile, 'utf8'))).forEach(function(p){
      if (!p || !p[0] || !p[1]) return;
      var k = trackKey(p[0], p[1]);
      if (seen[k]) return;
      seen[k] = true;
      list.push({ar: p[0], ti: p[1], k: k, f: p[2] || '', d: p[3] || 0, al: p[4] || '', ge: p[5] || ''});
    });
  } catch (e) { return this.lib || []; }
  this.lib = list; this.libAt = m; this.pos = 0; this.summaryCache = null;
  return list;
};

Collector.prototype.save = function(file, o) {
  try { fs.mkdirSync(this.dir); } catch (e) { /* already exists */ }
  try { fs.appendFileSync(path.join(this.dir, file), JSON.stringify(o) + '\n'); } catch (e) { /* next time */ }
};

Collector.prototype.start = function() {
  if (this.running) return;
  this.running = true;
  this.schedule(4 * this.t.step);
};
Collector.prototype.stop = function() { this.running = false; clearTimeout(this.timer); this.state = 'aus'; };
Collector.prototype.schedule = function(ms) {
  var self = this;
  clearTimeout(this.timer);
  if (this.running) this.timer = setTimeout(function(){ self.step(); }, ms);
};

/* conversion of a stored entry, computed once */
function clsOf(rec, factor) {
  if (!rec) return null;
  var k = factor ? '_ca' : '_ct';
  if (rec[k] === undefined) rec[k] = classify(rec.g, factor);
  return rec[k] && {mood: rec[k].mood, energy: rec[k].energy, style: rec[k].style};
}

/* next track without tags (or a missing artist); null when everything is done */
Collector.prototype.next = function() {
  var lib = this.loadLib();
  for (var n = 0; n < lib.length; n++, this.pos++) {
    if (this.pos >= lib.length) this.pos = 0;
    var it = lib[this.pos], t = this.tracks[it.k];
    if (!t) return {kind: 'track', it: it};
    if (!clsOf(t) && !this.artists[artistKey(it.ar)] && mainArtist(it.ar)) return {kind: 'artist', it: it};
  }
  return null;
};

Collector.prototype.step = function() {
  var self = this, cfg = this.getCfg() || {};
  if (!cfg.key) { this.state = 'fehler'; this.error = 'LASTFM_KEY missing (keys.json in the data folder)'; return this.schedule(this.t.wait); }
  if (Date.now() - this.lastIdleCheck > this.t.idle) {
    this.lastIdleCheck = Date.now();
    return this.playing(function(on){
      self.idle = !on;
      if (on) { self.state = 'wartet'; return self.schedule(self.t.wait); }
      self.step();
    });
  }
  if (!this.idle) { this.state = 'wartet'; return this.schedule(this.t.wait); }
  this.loadLib();
  var job = this.doneLib === this.libAt ? null : this.next();   /* done: only again when the library changes */
  if (!job) { this.doneLib = this.libAt; this.state = this.lib && this.lib.length ? 'fertig' : 'leer'; return this.schedule(this.t.wait); }
  this.state = 'läuft';
  var it = job.it;
  var method = job.kind === 'track' ? 'track.gettoptags' : 'artist.gettoptags';
  var params = job.kind === 'track' ? {artist: it.ar, track: it.ti, autocorrect: 1} : {artist: mainArtist(it.ar), autocorrect: 1};
  lastfm.call({key: cfg.key}, method, params, false, false, function(e, j){
    if (e && e.code !== 6) {                             /* 6: not found = no tags */
      self.error = 'Last.fm: ' + e.message;
      if (e.code === 10 || e.code === 26) { self.state = 'fehler'; return self.schedule(10 * self.t.wait); }   /* key invalid */
      return self.schedule(self.t.backoff);
    }
    self.error = null;
    var tags = (!e && j && j.toptags && j.toptags.tag) || [];
    if (!Array.isArray(tags)) tags = [tags];
    var g = tags.slice(0, RULES.input.max_lastfm_tags).filter(function(t){ return t && t.name; })
      .map(function(t){ return [String(t.name), parseInt(t.count, 10) || 0]; });
    var rec = {k: job.kind === 'track' ? it.k : artistKey(it.ar), g: g, at: Math.floor(Date.now() / 1000)};
    if (job.kind === 'track') { self.tracks[rec.k] = rec; self.save('tracks.jsonl', rec); }
    else { self.artists[rec.k] = rec; self.save('artists.jsonl', rec); }
    self.fetched++;
    self.summaryCache = null;
    self.schedule(self.t.step);
  });
};

/* result for a track: track tags, else artist tags (weakened); extended with the audio analysis (al: album) */
Collector.prototype.moodOf = function(ar, ti, al) {
  var r = clsOf(this.tracks[trackKey(ar, ti)]);
  if (r) r.src = 'track';
  else {
    r = clsOf(this.artists[artistKey(ar)], ARTIST_FACTOR);
    if (r) r.src = 'artist';
  }
  return this.audio ? this.audio.combine(r || null, ar, ti, al) : (r || null);
};

Collector.prototype.status = function() {
  var lib = this.loadLib(), done = 0, self = this;
  lib.forEach(function(it){ if (self.tracks[it.k]) done++; });
  return {state: this.state, error: this.error, total: lib.length, done: done, fetched: this.fetched};
};

/* distribution across the library (for display); recomputed at most once per minute */
Collector.prototype.summary = function() {
  var am = this.audio ? (this.audio.reload(), this.audio.mtime) : 0;
  if (this.summaryCache && Date.now() - this.summaryCache.at < 60000 && this.summaryCache.am === am) return this.summaryCache.s;
  var self = this, s = {track: 0, artist: 0, audio: 0, audioOnly: 0, none: 0, moods: {}, energy: [0, 0, 0, 0, 0], styles: {}};
  this.loadLib().forEach(function(it){
    var r = self.moodOf(it.ar, it.ti, it.al);
    if (!self.tracks[it.k] && !(r && r.audio)) return;
    if (!r) { s.none++; return; }
    if (r.src === 'audio') s.audioOnly++; else s[r.src]++;
    if (r.audio) s.audio++;
    r.mood.forEach(function(m){ s.moods[m] = (s.moods[m] || 0) + 1; });
    if (r.energy) s.energy[r.energy - 1]++;
    r.style.forEach(function(m){ s.styles[m] = (s.styles[m] || 0) + 1; });
  });
  this.summaryCache = {at: Date.now(), am: am, s: s};
  return s;
};

module.exports = {Collector: Collector, classify: classify, canon: canon, mainArtist: mainArtist, trackKey: trackKey, artistKey: artistKey};
