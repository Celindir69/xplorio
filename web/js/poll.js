/* Zustandsabfrage (Poll) und Start der Takte
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html. */
/* ---------- Poll ---------- */
var qualityState = null;
function paintQuality(st) {
  qualityState = st;
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;   /* anderer Eingang am Verstärker: dessen Name statt Format */
  if (st.trackType === 'input') { mTech.textContent = ''; mBadge.textContent = ''; mBadge.className = 'qBadge'; return; }   /* großes Icon statt Cover */
  if (inp) { mTech.textContent = inp.name; mBadge.textContent = ''; mBadge.className = 'qBadge'; return; }
  mp4Attach(st, function(){ if (qualityState === st) paintQuality(st); });   /* m4a: Codec aus der Datei, sobald bekannt */
  var q = classifyQuality(st, window.APP_CONFIG);
  mTech.textContent = q.tech.join('  ·  ');
  mBadge.textContent = q.label;
  mBadge.className = 'qBadge' + (q.kind ? ' ' + q.kind : '');
}

/* Webradio: zeigt der Player ein Senderlogo (Adresse von Volumio), es dem Tag-Dienst für die Senderliste melden.
   Den Namen kennt die Senderliste (radioNames in library.js); einmal je Sender und Adresse */
var radioLogoSent = {};
/* Sendername zum laufenden Stream, aus der Senderliste (radioNames):
   0. TuneIn: dieselbe Sender-ID im Logo (cdn-profiles.tunein.com/s250282/…) und in der Favoriten-Adresse (Tune.ashx?id=s250282)
   1. gleiche Adresse (auch ohne / am Ende, http oder https)
   2. gleicher Server und gleicher Senderpfad (z. B. stream.klassikradio.de/piano, egal welche Bitrate), wenn eindeutig
   3. ein Sender vom selben Server, dessen Name das enthält, was Volumio als Künstler meldet (z. B. „Piano“)
   sonst der Künstler selbst (bei TuneIn meist der Sendername) */
function radioUriKey(u) { return String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/[\/;]+$/, ''); }
function radioTuneInId(u) { var m = /(?:tune\.ashx\?(?:[^#]*&)?id=|tunein\.com\/)(s\d+)(?!\d)/i.exec(String(u || '')); return m ? m[1].toLowerCase() : ''; }
function radioUriParts(u) { var p = radioUriKey(u).replace(/[?#].*$/, '').split('/'); return {host: p[0].replace(/^www\./, ''), first: p[1] || ''}; }
function radioUnique(list) { return list.length === 1 ? list[0] : ''; }
function radioStationName(st) {
  var names = typeof radioNames === 'function' ? radioNames() : {};
  if (names[st.uri]) return names[st.uri];
  var tid = radioTuneInId(st.albumart) || radioTuneInId(st.uri), hit = '';
  if (tid) Object.keys(names).some(function(u){ if (radioTuneInId(u) === tid) { hit = names[u]; return true; } return false; });
  if (hit) return hit;
  var k = radioUriKey(st.uri), me = radioUriParts(st.uri), all = Object.keys(names);
  all.some(function(u){ if (radioUriKey(u) === k) { hit = names[u]; return true; } return false; });
  if (hit) return hit;
  var ar = String(st.artist || '').trim(), ti = String(st.title || '');
  if (ar && ti.indexOf(ar + ' - ') === 0) ar = '';             /* „Künstler - Titel“ mit demselben Künstler: kein Sendername */
  var sameHost = all.filter(function(u){ return me.host && radioUriParts(u).host === me.host; });
  hit = me.first && radioUnique(sameHost.filter(function(u){ return radioUriParts(u).first === me.first; }));
  if (hit) return names[hit];
  var al = ar.toLowerCase();
  hit = al && radioUnique(sameHost.filter(function(u){ return String(names[u]).toLowerCase().indexOf(al) >= 0; }));
  if (hit) return names[hit];
  return ar;
}
function radioLogoLearn(st) {
  if (st.trackType !== 'webradio' || typeof TAGS === 'undefined' || !st.uri) return;
  var a = String(st.albumart || '');
  if (!/^https?:\/\//.test(a)) return;
  var name = radioStationName(st);
  if (!name || radioLogoSent[st.uri] === a) return;
  radioLogoSent[st.uri] = a;
  new Image().src = TAGS + '/stationlogo?name=' + encodeURIComponent(name) + '&url=' + encodeURIComponent(a);
}

/* Webradio: Cover zum laufenden Titel vom Tag-Dienst (iTunes/Deezer); bis es geladen ist und ohne Treffer das Senderlogo */
var radioCovers = {};            /* "Künstler|Titel" -> Bildadresse, false (kein Cover) oder null (lädt) */
function radioArt(st, stationArt) {
  if (st.trackType !== 'webradio' || typeof TAGS === 'undefined') return stationArt;
  var t = st.title || '', p = t.indexOf(' - ');
  if (p <= 0) return stationArt;
  var artist = t.slice(0, p).trim(), title = t.slice(p + 3).trim(), k = artist + '|' + title;
  if (!artist || !title) return stationArt;
  if (radioCovers[k]) return radioCovers[k];
  if (radioCovers[k] === undefined) {
    radioCovers[k] = null;
    var u = TAGS + '/radiocover?artist=' + encodeURIComponent(artist) + '&title=' + encodeURIComponent(title);
    var img = new Image();
    img.onload = function(){ radioCovers[k] = u; poll(); };
    img.onerror = function(){ radioCovers[k] = false; };
    img.src = u;
  }
  return stationArt;
}

/* Anderer Eingang am Verstärker: großes Icon des Eingangs statt Cover (als SVG-Bild) */
var inputArtCache = {};
function inputArt(inp) {
  var light = document.documentElement.classList.contains('light'), fg = light ? '#000' : '#fff';
  var k = inp.icon + '|' + (light ? 1 : 0);
  if (inputArtCache[k]) return inputArtCache[k];
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600">' +
    '<rect width="600" height="600" rx="24" fill="' + fg + '" fill-opacity=".07"/>' +
    '<g transform="translate(180 180) scale(10)"><path fill-rule="evenodd" fill="' + fg + '" fill-opacity=".5" d="' +
    (ROTEL_ICONS[inp.icon] || ROTEL_ICONS.aux) + '"/></g></svg>';
  return (inputArtCache[k] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
}

/* Titel, dessen Wiedergabe nicht starten konnte (z. B. anderer Eingang): Volumio meldet dann teils nur Position und
   Lautstärke, teils noch den vorigen (pausierten) Titel, obwohl die Warteschlange schon das neue Album enthält.
   Titel, Künstler, Album und Cover kommen dann aus der Warteschlange (Eintrag an der Position); ab einem anderen
   Eingang wird dafür abgeglichen, bis wieder etwas spielt, und einmal Stopp geschickt, damit Volumio nicht ungehört
   durch das Album springt bzw. beim Abspielen den alten Titel fortsetzt. Höchstens alle 3 s neu geholt, bei anderer
   Position sofort */
var stateFillCache = {pos: -1, at: 0, item: null}, stateFillWatch = false, stateFillStopped = '';
function stateUriKey(u) { return String(u || '').replace(/^(music-library\/|mnt\/)/, ''); }   /* Präfixe unterscheiden sich */
function stateFill(st) {
  if (!st || typeof st.position !== 'number') return st;
  if (typeof rotelInput === 'function' && rotelInput()) stateFillWatch = true;
  else if (st.status === 'play') stateFillWatch = false;
  var empty = !st.uri && !st.title;
  var check = !empty && st.status !== 'play' && stateFillWatch;
  if (!empty && !check) return st;
  var c = stateFillCache, p = st.position;
  var got = (c.pos === p && Date.now() - c.at < 3000) ? Promise.resolve(c.item)
    : withTimeout(fetch('/api/v1/getQueue'), 4000).then(function(r){ return r.json(); }).then(function(j){
        var q = (j && j.queue) || [];
        stateFillCache = {pos: p, at: Date.now(), item: q[p] || null};
        return q[p] || null;
      });
  return got.then(function(it){
    if (!it || !it.uri) return st;
    if (check && stateUriKey(it.uri) === stateUriKey(st.uri)) return st;   /* Volumio meldet schon den richtigen Titel */
    var r = {};
    for (var k in st) if (st.hasOwnProperty(k)) r[k] = st[k];
    if (check) {                                                    /* veralteter Titel: dessen Angaben ganz ersetzen */
      ['title', 'artist', 'album', 'albumart', 'samplerate', 'bitdepth', 'bitrate', 'channels'].forEach(function(k){ r[k] = ''; });
      r.status = 'stop'; r.seek = 0;
    }
    ['uri', 'title', 'artist', 'album', 'albumart', 'trackType', 'service', 'duration', 'samplerate', 'bitdepth'].forEach(function(k){
      if (it[k] !== undefined && it[k] !== '') r[k] = it[k];
    });
    if (!r.title && it.name) r.title = it.name;
    if (!r.status) { r.status = 'stop'; r.seek = 0; r.noStatus = true; }   /* läuft nicht: Zeit am Anfang */
    if (stateFillWatch && (r.noStatus || check) && stateFillStopped !== r.uri) {
      stateFillStopped = r.uri;
      fetch('/api/v1/commands/?cmd=stop').catch(function(){});
    }
    return r;
  }, function(){ return st; });
}

/* Was der Player zeigt: bei anderem Eingang dessen Icon und Name, sonst Volumio. Wählt man währenddessen in Xplorio
   etwas anderes zum Abspielen (oder spielt Volumio), steht das Album da (Cover, Künstler, Albumtitel; kein Titel,
   keine Titelinfo, kein Text, denn am Verstärker läuft gerade etwas anderes), mit gesperrter Bedienung: am Verstärker
   auf den Player umschalten und abspielen (Abgleich mit der Warteschlange und Stopp: stateFill) */
var inputSession = '', inputBaseUri = '';
function inputApply(st) {
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;
  document.documentElement.classList.toggle('otherInput', !!inp);
  if (!inp) { inputSession = ''; return st; }
  if (inputSession !== inp.name) { inputSession = inp.name; inputBaseUri = st.uri || ''; }   /* was beim Umschalten geladen war */
  if (st.status === 'play' || (st.uri || '') !== inputBaseUri) {
    var a = {};
    for (var j in st) if (st.hasOwnProperty(j)) a[j] = st[j];
    a.inputAlbum = true;
    return a;
  }
  var r = {};
  for (var k in st) if (st.hasOwnProperty(k)) r[k] = st[k];          /* Lautstärke, Zufall, Wiederholen bleiben von Volumio */
  r.artist = ''; r.title = inp.name; r.album = ''; r.albumart = inputArt(inp);
  r.trackType = r.service = 'input'; r.uri = ''; r.duration = 0; r.seek = 0;
  r.samplerate = r.bitdepth = r.bitrate = r.fileFormat = '';
  return r;
}

var playIconShown = null;                              /* zuletzt gezeichnetes Symbol (nur bei Wechsel neu setzen) */
var pollBusy = false;                                   /* nie mehrere getState gleichzeitig (Volumio hängt z. B. beim Einlesen) */
function poll() {
  if (document.hidden || pollBusy) return;
  pollBusy = true;
  if (!volDrag && ROTEL_ON) rotel('/state');  
withTimeout(fetch('/api/v1/getState'), 8000).then(function(r){ return r.json(); }).then(stateFill).then(function(st){
st = inputApply(st);

curDur = Number(st.duration) || 0;
/* gestoppt zählt Volumio die Zeit teils weiter (Wiedergabe angefordert, aber das Ausgabegerät ließ sich nicht öffnen):
   dann steht der Titel am Anfang */
seekBase = st.status === 'stop' ? 0 : (Number(st.seek) || 0); seekStamp = Date.now();
playing = (st.status === 'play') && st.trackType !== 'input';   /* anderer Eingang: keine laufende Zeit */
paintTime();
updateSyncedLyrics();


    var iconPlay = st.status === 'play';
    if (iconPlay !== playIconShown) {
      playIconShown = iconPlay;
      playIcon.innerHTML = iconPlay ? '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>' : '<path d="M7 5v14l12-7z"/>';
    }

    curRadio = (st.trackType === 'webradio');
    curStream = curRadio ? null : streamOf({service: st.service, uri: st.uri});
    showVolumio(st);
    if (typeof st.random === 'boolean') stRandom = st.random;
    if (typeof st.repeat === 'boolean') {
      stRepeatMode = st.repeatSingle ? 'one' : (st.repeat ? 'all' : 'off');
    }
    updateCtrlUI();

    radioLogoLearn(st);
    var art = radioArt(st, artUrl(st.albumart));
    if (art && art !== lastArt) {
      lastArt = art;
      cover.src = art;
      bg.style.backgroundImage = 'url("' + String(art).replace(/["\\\n]/g, encodeURIComponent) + '")';
      updateMood(art);
    }

    var newPos = (typeof st.position === 'number') ? st.position : -1;
    if (newPos !== curPos) {
      curPos = newPos;
      if (overlayQueue.classList.contains('on')) loadQueue();
    }

    var artist = st.artist || '', album = st.album || '';
    var title  = st.title  || '';
    var radio  = (st.trackType === 'webradio');
    var preview = !!st.inputAlbum;                      /* anderer Eingang, Album gewählt: Albumtitel groß, kein Titel */
    if (preview) title = '';

    marqueeSet(mTitle, preview ? album : title);
    mArtist.textContent = artist;
    if ((radio || preview ? '' : album) !== curAlbumTitle || st.uri !== curAlbumUri) {   /* nur bei Wechsel: das Jahr kommt verzögert dazu */
      curAlbumTitle = radio || preview ? '' : album; curAlbumUri = st.uri;
      mAlbum.textContent = curAlbumTitle;
      if (typeof playerYear === 'function') playerYear(st.uri || '', curAlbumTitle, artist);
    }
    mArtist.classList.toggle('link', !radio && !!artist);      /* Klick öffnet Alben bzw. Titel (browse.js) */
    mAlbum.classList.toggle('link',  !radio && !preview && !!album);
    paintQuality(st);
    tagPaintPlayer(st);
    if (radio) {
      var p = title.indexOf(' - ');
      artist = (p > 0) ? title.slice(0, p).trim() : '';
      title  = (p > 0) ? title.slice(p + 3).trim() : title;
      album  = '';
    }
    radioArtist = radio ? artist : '';                 /* "Künstler - Titel" im Stream-Titel erkannt */
    curUri = st.uri || ''; curTitle = radio ? '' : title;
    mTitle.classList.toggle('link', !!radioArtist || similarOk());   /* Klick öffnet dessen Alben bzw. ähnliche Titel (browse.js) */

    var key    = artist + '|' + album + '|' + (radio ? title : '');
    var lyrKey = artist + '|' + title;

    if (lyrKey !== lastLyrKey) {
      lastLyrKey = lyrKey;
      setTrackInfo(lyrKey, title, null, radio);                   /* Reiter des vorigen Titels weg */
      if (!artist || !title) showLyrics(null);                     /* z. B. anderer Eingang */
      else {
        askExtra(artist, title, radio).then(function(res){ if (lyrKey === lastLyrKey) showLyrics(res); });   /* späte Antwort des vorigen Titels verwerfen */
        (function(k, ti){
          askTrack(artist, ti).then(function(res){ if (k === lastLyrKey) setTrackInfo(k, ti, res, radio); });
        })(lyrKey, title);
      }
    }

    if (key === lastKey) return;
    lastKey  = key;
    curAlbum = album;
curArtist = artist;    
if (!artist) { showInfo([]); return; }

if (radio) {
  Promise.all([ask({mode:'storyArtist', artist:artist}), askDiscography(artist)])
    .then(function(res){
      if (key !== lastKey) return;                   /* inzwischen läuft etwas anderes */
      showInfo([
        {title:artist,            label:T('info.tab.artist'), data:res[0], always:true},
        {title:T('info.collection'), label:T('info.tab.collection'), data:res[1]},
        {title:T('info.similar'), label:T('info.tab.similar'), lazy:true, artist:artist},
        {title:T('browse.tab.more'), label:T('browse.tab.more'), discover:true, artist:artist}
      ]);
    });
  return;
}

Promise.all([
  ask({mode:'storyAlbum',   artist:artist, album:album}),
  ask({mode:'storyArtist',  artist:artist}),
  ask({mode:'creditsAlbum', artist:artist, album:album}),
  askDiscography(artist)
]).then(function(res){
  if (key !== lastKey) return;    /* inzwischen läuft etwas anderes: späte Antwort verwerfen */
  showInfo([                      /* title: Überschrift im Overlay; label: kurzer Reitername (lange Namen würden die Leiste sprengen) */
    {title:album,             label:T('info.tab.album'),       data:res[0], always:true},
    {title:artist,            label:T('info.tab.artist'),    data:res[1], always:true},
    {title:T('info.credits'), label:T('info.tab.credits'), data:res[2]},
    {title:T('info.collection'), label:T('info.tab.collection'), data:res[3]},
    {title:T('info.similar'), label:T('info.tab.similar'),   lazy:true, artist:artist},
    {title:T('browse.tab.more'), label:T('browse.tab.more'), discover:true, artist:artist}
  ]);
});

  }).catch(function(){ playing = false; })            /* Volumio nicht erreichbar: Zeit nicht weiterlaufen lassen */
    .then(function(){ pollBusy = false; });
}

/* kleine Zwischenspeicher im Dauerbetrieb (iPad läuft tagelang) begrenzen: älteste Einträge zuerst */
setInterval(function(){
  [[radioCovers, 300], [radioLogoSent, 300], [similarCache, 300], [similarAllCache, 300], [streamSimilarCache, 200], [moodCache, 300], [creditCache, 300]]
    .forEach(function(p){
      var keys = Object.keys(p[0]);
      keys.slice(0, Math.max(0, keys.length - p[1])).forEach(function(k){ delete p[0][k]; });
    });
}, 30 * 60000);

setInterval(function(){ updateSyncedLyrics(); }, 200);
setInterval(poll, 2000);
poll();

