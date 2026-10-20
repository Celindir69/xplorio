/* Streaming services alongside the own collection (TIDAL, Qobuz, HIGHRESAUDIO, Spotify): which exist, how to recognize
   their entries and how Volumio's search results are split up. Enabled via APP_CONFIG.TIDAL,
   .QOBUZ, .HRA, .SPOTIFY (true, false or 'auto' = only if the plugin is active in Volumio).
   Classic script, shared global scope; loaded as the first app script (before core.js). */
/* key: plugin or service name (service, plugin_name) and start of the addresses; short: label of the checkbox in the search;
   title: heading of a result list of this service */
var STREAMS = [
  {id: 'tidal', name: 'TIDAL', short: 'TIDAL', cfg: 'TIDAL', key: /^tidal/i, title: /tidal/,
   uriRe: /^tidal:/i, artistRe: /^tidal:\/\/artist\/\d+$/i},
  /* Volumio's Qobuz plugin: addresses like qobuz://artist/123 (older versions qobuz/artist/123) */
  {id: 'qobuz', name: 'Qobuz', short: 'Qobuz', cfg: 'QOBUZ', key: /^qobuz/i, title: /qobuz/,
   uriRe: /^qobuz(:\/\/|\/)/i, artistRe: /^qobuz(:\/\/|\/)artists?\/[\w-]+$/i},
  /* HIGHRESAUDIO plugin: called hi_res_audio in Volumio (source uri "hi_res_audio"), older names hra/highresaudio; address format not yet verified on the device */
  {id: 'hra', name: 'HIGHRESAUDIO', short: 'HRA', cfg: 'HRA', key: /^(hra|highresaudio|hi_res_audio)/i, title: /\bhra\b|highresaudio|hi_res_audio|high res audio/,
   uriRe: /^(hra|highresaudio|hi_res_audio)(:\/\/|\/|:)/i, artistRe: /^(hra|highresaudio|hi_res_audio)(:\/\/|\/|:)artists?\/[\w-]+$/i},
  /* Volumio's Spotify plugin (spop, Premium only): addresses like spotify:artist:4Z8W…; Spotify Connect alone offers no search */
  {id: 'spotify', name: 'Spotify', short: 'Spotify', cfg: 'SPOTIFY', key: /^(spop|spotify)/i, title: /spotify/,
   uriRe: /^spotify[:\/]/i, artistRe: /^spotify:artist:\w+$/i}
];
STREAMS.forEach(function(s){ s.on = false; s.show = true; s.downUntil = 0; });

function streamById(id) { return STREAMS.filter(function(s){ return s.id === id; })[0] || null; }

/* service of an entry (item with service/uri) or of an address; null = own collection, radio etc. */
function streamOf(x) {
  if (!x) return null;
  if (typeof x === 'string') return STREAMS.filter(function(s){ return s.uriRe.test(x); })[0] || null;
  var sv = String(x.service || '');
  return (sv && STREAMS.filter(function(s){ return s.key.test(sv); })[0]) || streamOf(x.uri || '');
}
function streamIsArtist(it) {
  var s = streamOf(it);
  if (!s || !it.uri || !s.artistRe.test(it.uri)) return false;
  /* HIGHRESAUDIO also returns albums with an artists/ address; they carry a name other than the artist's */
  return !it.artist || String(it.artist).toLowerCase() === String(it.title || '').toLowerCase();
}
function streamsOn() { return STREAMS.filter(function(s){ return s.on; }); }

/* kind of a result list by its heading (German or English) and its entries: artists, albums, songs or null */
function streamListCat(title, items) {
  var t = String(title || '').toLowerCase().split("'")[0];   /* only the part before the search term: "gefunden 1 Album 'Begriff'" */
  if (/playlist|radio/.test(t)) return null;
  if (/interpret|künstler|kuenstler|artist/.test(t)) return 'artists';
  if (/album|alben/.test(t)) return 'albums';
  if (/titel|track|song/.test(t)) return 'songs';
  var first = (items || [])[0];                              /* unknown heading: recognize by the first entry */
  if (!first) return null;
  if (first.type === 'song') return 'songs';
  if (streamIsArtist(first)) return 'artists';
  if (/^folder|album/.test(first.type || '')) return 'albums';
  return null;
}

/* split Volumio's search answer -> {artists, albums, songs, stream: {tidal: {...}, qobuz: {...}}} */
function streamEmptySearch() {
  var d = {artists: [], albums: [], songs: [], stream: {}};
  STREAMS.forEach(function(s){ d.stream[s.id] = {artists: [], albums: [], songs: []}; });
  return d;
}
function streamSplitSearch(lists, query) {
  var d = streamEmptySearch(), q = String(query || '').toLowerCase();
  (lists || []).forEach(function(l){
    var items = l.items || [], title = String(l.title || '').toLowerCase().split("'")[0];   /* without the search term */
    if (title.indexOf('internetradio') > -1 || title.indexOf('webradio') > -1) return;
    var svc = STREAMS.filter(function(s){ return s.title.test(title); })[0] || (items[0] && streamOf(items[0]));
    var cat = streamListCat(l.title, items);
    if (!cat) return;
    if (svc) {
      var into = d.stream[svc.id], byTitle = streamListCat(l.title, []);
      items.forEach(function(it){
        if (!it.title && !it.name) return;                  /* HIGHRESAUDIO appends an empty entry */
        /* list without heading (TIDAL, HIGHRESAUDIO): classify each entry itself, the services mix kinds */
        var c = byTitle || (it.type === 'song' ? 'songs' : streamIsArtist(it) ? 'artists' : 'albums');
        into[c].push(it);
      });
      return;
    }
    if (cat === 'songs') {                                  /* local tracks: only real hits in title or artist */
      items = items.filter(function(it){
        return (it.title || it.name || '').toLowerCase().indexOf(q) > -1 || (it.artist || '').toLowerCase().indexOf(q) > -1;
      });
    }
    d[cat] = items;
  });
  return d;
}

/* enable services according to the setting; 'auto' only with Volumio's source list (sources) */
function streamConfigure(cfg, sources) {
  STREAMS.forEach(function(s){
    var v = cfg ? cfg[s.cfg] : undefined;
    if (v === true || v === false) { s.on = v; return; }
    if (!sources) { s.on = s.id === 'tidal'; return; }      /* until Volumio answers: assume only TIDAL as before */
    s.on = sources.some(function(x){ return s.key.test(x.plugin_name || '') || s.key.test(x.uri || ''); });
  });
}
function streamNeedsSources(cfg) {
  return STREAMS.some(function(s){ var v = cfg ? cfg[s.cfg] : undefined; return v !== true && v !== false; });
}

if (typeof module !== 'undefined') module.exports = {STREAMS: STREAMS, streamOf: streamOf, streamIsArtist: streamIsArtist,
  streamListCat: streamListCat, streamSplitSearch: streamSplitSearch, streamConfigure: streamConfigure,
  streamNeedsSources: streamNeedsSources, streamsOn: streamsOn};
