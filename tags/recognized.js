/* Erkannter Titel: läuft am Verstärker eine andere Quelle, erkennt ein iPhone/iPad den Titel (Kurzbefehl mit
   „Musik erkennen“, also Shazam) und schickt Künstler und Titel per POST /recognized. Die Oberfläche zeigt ihn an,
   solange Volumio nichts spielt. Nur im Speicher; nach MAX_AGE_MS vergessen. Node 8, nur ES5. */
var MAX_AGE_MS = 10 * 60000;
var MAX_LEN = 300;

function clean(v) { return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, MAX_LEN); }

function Recognized(opts) { this.maxAge = (opts && opts.maxAgeMs) || MAX_AGE_MS; this.cur = null; this.n = 0; }

/* b: {artist, title, album?, art? (https-Adresse des Covers)} oder {clear: true}; Ergebnis für die Antwort */
Recognized.prototype.set = function(b, now) {
  b = b || {};
  if (b.clear) { this.cur = null; return {ok: true}; }
  var t = {artist: clean(b.artist), title: clean(b.title), album: clean(b.album), art: clean(b.art)};
  if (!t.artist || !t.title) return {ok: false, error: 'artist und title fehlen'};
  if (!/^https:\/\/[^\s"'<>]+$/i.test(t.art)) t.art = '';
  t.at = typeof now === 'number' ? now : Date.now(); t.id = ++this.n;
  this.cur = t;
  return {ok: true, text: t.artist + ' – ' + t.title};
};

/* aktueller Titel oder null */
Recognized.prototype.get = function(now) {
  if (this.cur && (typeof now === 'number' ? now : Date.now()) - this.cur.at > this.maxAge) this.cur = null;
  return this.cur;
};

module.exports = {Recognized: Recognized, MAX_AGE_MS: MAX_AGE_MS};
