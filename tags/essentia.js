/* Audio-Analyse mit Essentia (läuft auf dem Mac, tools/essentia/analyse.py): Ergebnisdatei essentia.jsonl lesen
   und je Titel in Stimmung, Energie 1-5, Stil, BPM und Tonart umrechnen. Zuordnung über Künstler und Titel
   (wie die Last.fm-Tags), damit Ordnerstruktur und Laufwerk auf dem Mac keine Rolle spielen. Node 8, nur ES5.

   Eine Zeile der Datei (v = Fassung des Analyse-Skripts):
   {"v":1,"p":"Musik/A/B/01.flac","ar":"…","ti":"…","al":"…","d":245,"bpm":118.2,"key":"A","scale":"minor",
    "mood":{"happy":0.12,"sad":0.71,"relaxed":0.64,"aggressive":0.03,"party":0.08},"dance":0.31,"voice":0.88,
    "val":4.1,"aro":3.6,"styles":[["Electronic---Trip Hop",0.41],…]} */
var fs = require('fs');
var moodtags = require('./moodtags.js');
var jsonl = require('./jsonl.js');

var PROB = 0.6;                  /* ab dieser Wahrscheinlichkeit zählt eine Stimmung */
var RELOAD_CHECK_MS = 10000;     /* so oft höchstens nachsehen, ob die Datei neu ist */
var DROP = ['p', 'sz', 'mt', 'v', 'kstr'];   /* braucht nur das Analyse-Skript auf dem Mac: nicht im Speicher halten */

/* Wert an Stelle q (0..1) einer sortierten Liste */
function quantile(sorted, q) {
  if (!sorted.length) return null;
  var i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function Store(file) {
  this.file = file; this.byKey = {}; this.n = 0; this.at = 0; this.mtime = 0; this.checked = 0; this.stats = null;
  this.reload();
}

/* neu lesen, wenn sich die Datei geändert hat; true = Daten haben sich geändert */
Store.prototype.reload = function(force) {
  if (!force && Date.now() - this.checked < RELOAD_CHECK_MS) return false;
  this.checked = Date.now();
  var st = null;
  try { st = fs.statSync(this.file); } catch (e) {
    if (!this.mtime) return false;
    this.byKey = {}; this.n = 0; this.mtime = 0; this.stats = null; return true;
  }
  if (!force && st.mtime.getTime() === this.mtime) return false;
  var by = {}, n = 0, aro = [], val = [];
  var ok = jsonl.eachLine(this.file, function(l){            /* zeilenweise: die ganze Datei nie auf einmal im Speicher */
    var o = jsonl.parse(l);
    if (!o || !o.ar || !o.ti || o.err) return;
    DROP.forEach(function(f){ delete o[f]; });
    var k = moodtags.trackKey(o.ar, o.ti);
    var list = by[k] || (by[k] = []);
    list.push(o);
    n++;
    if (typeof o.aro === 'number') aro.push(o.aro);
    if (typeof o.val === 'number') val.push(o.val);
  });
  if (!ok) return false;
  aro.sort(function(a, b){ return a - b; }); val.sort(function(a, b){ return a - b; });
  /* Energie und Stimmungsquadranten relativ zur eigenen Sammlung: DEAM-Werte drängen sich sonst in der Mitte */
  this.stats = {aLo: quantile(aro, 0.02), aHi: quantile(aro, 0.98), vLow: quantile(val, 0.33), vHigh: quantile(val, 0.67),
                aLow: quantile(aro, 0.33), aHigh: quantile(aro, 0.67)};
  this.byKey = by; this.n = n; this.mtime = st.mtime.getTime(); this.at = this.mtime;
  return true;
};

/* passender Eintrag: gleiches Album bevorzugt, sonst der erste */
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

/* Eintrag -> {mood, energy, style, bpm, key, dance, voice} im Vokabular der Stimmungs-Tags (je Datei-Stand einmal) */
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
  /* Discogs-Stile wie Last.fm-Tags durch die vorhandene Zuordnung schicken (Gewicht = Wahrscheinlichkeit) */
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

/* Ergebnis der Stimmungs-Tags (lf, darf null sein) um die Audio-Analyse ergänzen */
Store.prototype.combine = function(lf, ar, ti, al) {
  var o = this.get(ar, ti, al);
  return o ? merge(lf, this.classify(o)) : lf;
};

Store.prototype.status = function() {
  this.reload();
  return {tracks: this.n, at: this.at || null};
};

/* Last.fm-Ergebnis (track/artist) und Audio-Analyse zusammenführen:
   Energie und BPM aus dem Audio, Stimmungen und Stile aus beiden (Audio zuerst) */
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
