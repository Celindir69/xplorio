/* Künstler und Album aus der Wiedergabe: Alben eines Künstlers, Titel eines Albums
   Klassisches Skript, gemeinsamer globaler Gültigkeitsbereich; Reihenfolge siehe xplorio.html.
   Klick auf den Künstler: Alben des Künstlers. Klick auf das Album (oder ein Album aus der Liste): Titel des Albums. */
var overlayBrowse = document.getElementById('overlayBrowse');
var browseTitle   = document.getElementById('browseTitle');
var browseBack    = document.getElementById('browseBack');
var browseBody    = document.getElementById('browseBody');
var browseStack   = [];       /* Verlauf: {kind:'artist'|'album'|'genre'|'playlist', artist, album, uri, genre, sub} */
var browseOrigin  = null;     /* Overlay, aus dem die Ansicht geöffnet wurde (Suche, Info): der Zurück-Pfeil führt dorthin */
var browseSeq     = 0;        /* verwirft Antworten veralteter Anfragen */

function browseItems(j) {
  var lists = (j && j.navigation && j.navigation.lists) || [];
  var out = [];
  lists.forEach(function(l){ (l.items || []).forEach(function(it){ out.push(it); }); });
  return out;
}

var STREAM_TIMEOUT_MS = 12000;    /* TIDAL/Qobuz antworten manchmal nicht mehr (Session-Timeout in Volumio) */

function browseGet(uri) {
  var p = fetch('/api/v1/browse?uri=' + encodeURIComponent(uri)).then(function(r){ return r.json(); });
  var svc = streamOf(uri);
  if (!svc) return p;
  return withTimeout(p, STREAM_TIMEOUT_MS).catch(function(err){
    svc.downUntil = Date.now() + 60000;              /* nach einem Timeout den Dienst kurz in Ruhe lassen */
    throw err;
  });
}

function browsePlay(item) {
  browseOrigin = null;
  fetch('/api/v1/replaceAndPlay', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body:JSON.stringify({item:item})
  }).catch(function(){});
  closeAllOverlays();
}

function browseNote(text, cls) {
  var d = document.createElement('div');
  d.className = cls || 'sHint';
  d.textContent = text;
  return d;
}

/* ---------- Streamingdienste: ähnliche Künstler ---------- */
var STREAM_FALLBACK_MAX = 8;      /* so viele Last.fm-Namen höchstens einzeln beim Dienst suchen */
var streamSimilarCache = {};

function streamArtistItems(svc, j) {
  return browseItems(j).filter(function(it){ return streamOf(it) === svc && streamIsArtist(it); });
}

/* Künstler bei einem Dienst suchen; nur ein Treffer mit genau gleichem Namen zählt */
function streamFindArtist(svc, name) {
  if (!svc.on || Date.now() < svc.downUntil) return Promise.resolve(null);
  return withTimeout(fetch('/api/v1/search?query=' + encodeURIComponent(name)).then(function(r){ return r.json(); }), STREAM_TIMEOUT_MS).then(function(j){
    var hit = null;
    streamArtistItems(svc, j).forEach(function(it){
      if (!hit && (it.title || '').toLowerCase() === name.toLowerCase()) hit = it;
    });
    return hit;
  }).catch(function(){ svc.downUntil = Date.now() + 60000; return null; });
}

/* Liefert [{title, uri, albumart}]. Erst die eigene Künstlerseite beim Dienst (falls sie ähnliche Künstler enthält),
   sonst die Last.fm-Namen, die nicht in der Sammlung sind, einzeln nachschlagen. */
function loadStreamSimilar(svc, artist, localNames) {
  if (!svc.on) return Promise.resolve([]);
  var key = svc.id + '|' + artist;
  if (streamSimilarCache[key]) return Promise.resolve(streamSimilarCache[key]);
  function done(list) { if (list.length || Date.now() >= svc.downUntil) streamSimilarCache[key] = list; return list; }   /* leere Antwort nach Timeout nicht merken */
  return streamFindArtist(svc, artist).then(function(self){
    var viaPage = self ? browseGet(self.uri).then(function(j){
      return streamArtistItems(svc, j).filter(function(it){ return it.uri !== self.uri; });
    }).catch(function(){ return []; }) : Promise.resolve([]);
    return viaPage.then(function(list){
      if (list.length) return list;
      var have = {};
      (localNames || []).forEach(function(n){ have[n.toLowerCase()] = true; });
      var names = (similarAllCache[artist] || []).filter(function(n){ return !have[n.toLowerCase()]; }).slice(0, STREAM_FALLBACK_MAX);
      var found = [];
      return names.reduce(function(chain, n){            /* nacheinander, schont den Player */
        return chain.then(function(){
          return streamFindArtist(svc, n).then(function(it){ if (it) found.push(it); });
        });
      }, Promise.resolve()).then(function(){ return found; });
    });
  }).then(function(list){
    var seen = {};
    return done(list.filter(function(it){ if (seen[it.uri]) return false; seen[it.uri] = true; return true; })
      .map(function(it){ return {title:it.title, uri:it.uri, albumart:it.albumart}; }));
  }).catch(function(){ return []; });
}

function openBrowse(entry) {
  var ow = document.getElementById('overlayWelcome');
  var cur = document.querySelector('.overlay.on') || (ow && ow.classList.contains('on') ? ow : null);
  /* schon in der Ansicht (z. B. Stimmung, Jahr, ähnliches Album unter Entdecken): weiterblättern, Zurück führt hierher */
  if (cur === overlayBrowse) { browseStack.push(entry); browseRender(); return; }
  if (cur) browseOrigin = cur;
  else if (!cur) browseOrigin = null;
  closeAllOverlays();
  browseStack = [entry];
  overlayBrowse.classList.add('on');
  browseRender();
}

function browseRender() {
  var e = browseStack[browseStack.length - 1];
  var seq = ++browseSeq;
  browseBack.style.display = (browseStack.length > 1 || browseOrigin) ? '' : 'none';
  browseTitle.textContent = e.kind === 'artist' ? e.artist : e.kind === 'playlist' ? e.name : e.kind === 'genre' ? e.genre + (e.sub ? ' · ' + e.sub : '') : e.kind === 'decade' ? T('disc.decade', {d: e.decade}) : e.kind === 'year' ? String(e.year) : e.kind === 'moodset' ? e.title : e.kind === 'similar' ? T('similar.title', {ti: e.title}) : e.kind === 'together' ? togetherName(e.artists) : e.album;
  browseBody.scrollTop = 0;
  while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
  browseBody.appendChild(browseNote(T('browse.loading')));
  if (e.kind === 'artist') browseArtist(e, seq);
  else if (e.kind === 'playlist') browsePlaylist(e, seq);
  else if (e.kind === 'genre') browseGenre(e, seq);                 /* genre.js */
  else if (e.kind === 'decade') browseDecade(e, seq);               /* genre.js */
  else if (e.kind === 'year') browseYear(e, seq);                   /* genre.js */
  else if (e.kind === 'moodset') browseMoodSet(e, seq);             /* genre.js */
  else if (e.kind === 'similar') browseSimilar(e, seq);             /* discover.js */
  else if (e.kind === 'together') browseTogether(e, seq);           /* discover.js */
  else browseAlbum(e, seq);
}

/* ---------- Alben eines Künstlers ---------- */
/* Künstlerzeile wie "A feat. B" oder "A, B" gehört auch zu A und B */
function artistParts(str) {
  var whole = String(str || '').toLowerCase().trim();       /* ganze Zeile zählt auch ("Simon & Garfunkel") */
  return [whole].concat(whole.split(/\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bwith\b|\bx\b)\s*/)).filter(function(x){ return x; });
}

/* Einzeltitel des Künstlers, die auf keinem seiner Alben liegen (z. B. Compilations, Various Artists).
   Quelle: der Tag-Dienst (MPD-Suche nach Interpret); ohne ihn die Volumio-Suche, die aber nur Titel liefert,
   in deren Titel der Name vorkommt. */
function localExtraTitles(artist, albumTitles) {
  var have = {};
  albumTitles.forEach(function(t){ have[t.toLowerCase()] = true; });
  var me = artist.toLowerCase();
  return withTimeout(fetch(TAGS + '/artist?tracks=1&name=' + encodeURIComponent(artist)).then(function(r){ return r.json(); }), 15000).then(function(j){
    if (!j.ok || !Array.isArray(j.tracks)) throw new Error(j.error || 'Tag-Dienst');
    return j.tracks.filter(function(t){
      return artistParts(t.artist).indexOf(me) >= 0 && !have[(t.album || '').toLowerCase()];
    }).map(function(t){
      var dir = t.file.replace(/\/[^\/]*$/, '');
      return {uri: 'mnt/' + t.file, service: 'mpd', type: 'song', title: t.title || t.file.replace(/^.*\//, ''),
              artist: t.artist, album: t.album, albumart: '/albumart?' + (t.artist && t.album ? 'web=' + encodeURIComponent(t.artist) + '/' + encodeURIComponent(t.album) + '/extralarge&' : '') +
                        'path=' + encodeURIComponent('/mnt/' + dir)};      /* wie Volumio selbst */
    }).sort(function(x, y){ return (x.title || '').localeCompare(y.title || ''); }).slice(0, 100);
  }).catch(function(){ return localSearchTitles(artist, have, me); });
}

function localSearchTitles(artist, have, me) {
  return fetch('/api/v1/search?query=' + encodeURIComponent(artist)).then(function(r){ return r.json(); }).then(function(j){
    var seen = {};
    return browseItems(j).filter(function(it){
      if (it.type !== 'song' || it.service !== 'mpd' || !it.uri || seen[it.uri]) return false;
      if (artistParts(it.artist).indexOf(me) < 0) return false;
      if (have[(it.album || '').toLowerCase()]) return false;                 /* liegt auf einem eigenen Album */
      seen[it.uri] = true;
      return true;
    }).sort(function(x, y){ return (x.title || '').localeCompare(y.title || ''); }).slice(0, 100);
  }).catch(function(){ return []; });
}

/* Abspielzeile unter dem Seitenkopf, überall gleich: Kreis ▶ mit Text, darunter Anzahl und Dauer, rechts Symbole
   (Herz, Würfel, Stift bzw. ↻ und Anhängen); ein Tipp auf die Zeile spielt ab. Symbole rechts stoppen den Klick selbst. */
function playRow(label, sub, onPlay, extras) {
  var head = document.createElement('div');
  head.className = 'playRow';
  head.innerHTML = '<div class="playCircle"><svg viewBox="0 0 24 24"><path d="M7 5v14l12-7z"/></svg></div>';
  var lbl = document.createElement('div');
  lbl.className = 'sMeta';
  var t1 = document.createElement('div'); t1.className = 'sTitle bAlbum'; t1.textContent = label;
  var t2 = document.createElement('div'); t2.className = 'sSub'; t2.textContent = sub || '';
  lbl.appendChild(t1); lbl.appendChild(t2);
  head.appendChild(lbl);
  head.sub = t2;
  (extras || []).forEach(function(x){ if (x) head.appendChild(x); });
  head.addEventListener('click', onPlay);
  return head;
}
/* Symbol „An die Warteschlange anhängen“ für die Abspielzeile: items() liefert die Volumio-Einträge (Ordner werden von
   Volumio aufgelöst), n die Titelzahl für die Meldung (0: unbekannt). Die Seite bleibt offen, man kann weiter anhängen. */
var QUEUE_ADD_SVG = '<svg viewBox="0 0 24 24"><path d="M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z"/></svg>';
function queueAddButton(items, n) {
  var b = document.createElement('button');
  b.className = 'mxIcon';
  b.title = T('mix.addToQueue');
  b.innerHTML = QUEUE_ADD_SVG;
  b.addEventListener('click', function(ev){
    ev.stopPropagation();
    var list = typeof items === 'function' ? items() : items;
    if (!list || !list.length) return;
    socket.emit('addToQueue', list);
    showToast(n ? T('mix.added', {n: n}) : T('queue.added'));
  });
  return b;
}
/* Hinweis über der Titelliste (unter der Linie von Reitern bzw. Abspielzeile), damit man ihn auch bei langen Listen sieht */
function listHint(text) { return browseNote(text, 'sHint listHint'); }

/* "12 Titel · 48 Min." (Dauer nur, wenn alle Titel eine haben) */
function playRowSub(tracks, secOf) {
  var n = tracks.length, sum = 0, all = n > 0;
  tracks.forEach(function(t){ var d = Number(secOf(t)) || 0; if (d > 0) sum += d; else all = false; });
  return T('browse.trackCount', {n: n}) + (all && sum ? ' · ' + mixDuration(sum) : '');
}

function browseHeading(text) {
  var d = document.createElement('div');
  d.className = 'infoSection'; d.textContent = text;
  return d;
}

function browseTrackRow(t, e, showAlbum) {
  var row = document.createElement('div');
  row.className = 'sRow';
  var img = document.createElement('img');
  img.className = 'sCover';
  if (t.albumart) img.src = artUrl(t.albumart);
  var meta = document.createElement('div');
  meta.className = 'sMeta';
  var ti = document.createElement('div');
  ti.className = 'sTitle'; ti.textContent = t.title || t.name || '';
  meta.appendChild(ti);
  var subText = showAlbum ? (t.album || '') : '';
  if (subText) { var sub = document.createElement('div'); sub.className = 'sSub'; sub.textContent = subText; meta.appendChild(sub); }
  row.appendChild(img); row.appendChild(meta);
  var pen = tagTrackButton(t);                             /* lokale Datei: Tags dieses Titels bearbeiten */
  if (pen) row.appendChild(pen);
  row.addEventListener('click', function(){
    browsePlay({uri:t.uri, service:t.service || 'mpd', type:'song',
                title:t.title || t.name || '', artist:t.artist || e.artist || '', album:t.album || ''});
  });
  return row;
}

/* Reiter auf einer Seite (Künstler, Album, Jahr, Jahrzehnt): defs [[id, Name, fill], …] -> {id: Bereich}; der gewählte
   steht im browseStack-Eintrag (e.tab) und bleibt beim Zurück offen; der erste ist Vorgabe. fill(Bereich) füllt einen
   Reiter erst, wenn er zum ersten Mal gezeigt wird. */
function browseTabs(e, defs) {
  var tabs = histEl('div', 'bTabs'), panes = {}, filled = {};
  defs.forEach(function(x){
    panes[x[0]] = histEl('div');
    var t = histEl('div', 'infoTab', x[1]);
    t.addEventListener('click', function(){ e.tab = x[0]; show(); });
    tabs.appendChild(t);
  });
  function show() {
    var cur = panes[e.tab] ? e.tab : defs[0][0];
    defs.forEach(function(x, i){
      tabs.children[i].classList.toggle('on', x[0] === cur);
      panes[x[0]].style.display = x[0] === cur ? '' : 'none';
    });
    var d = defs.filter(function(x){ return x[0] === cur; })[0];
    if (d[2] && !filled[cur]) { filled[cur] = true; d[2](panes[cur]); }
  }
  browseBody.appendChild(tabs);
  defs.forEach(function(x){ browseBody.appendChild(panes[x[0]]); });
  show();
  return panes;
}

/* Reiter „Hintergrund“: Künstler- bzw. Albumtext wie auf der Info-Seite (Volumio, sonst Last.fm/Wikipedia),
   beim Album darunter die Mitwirkenden zum Aufklappen (info.js) */
function backgroundFill(pane, e, seq, artist, album) {
  var wait = browseNote(T('browse.loading'));
  pane.appendChild(wait);
  var jobs = album ? [ask({mode: 'storyAlbum', artist: artist, album: album}), ask({mode: 'creditsAlbum', artist: artist, album: album})]
                   : [ask({mode: 'storyArtist', artist: artist})];
  Promise.all(jobs).then(function(res){
    if (seq !== browseSeq) return;
    pane.removeChild(wait);
    var story = res[0] && res[0].kind === 'story' && res[0].value, credits = res[1] && res[1].kind === 'credits' && res[1].value;
    if (!story && !credits) return pane.appendChild(browseNote(T('info.noContent')));
    if (story) pane.appendChild(histEl('div', 'bgStory', story));
    if (credits) {
      pane.appendChild(browseHeading(T('info.credits')));
      creditsRender(pane, credits);
    }
  });
}

function browseArtist(e, seq) {
  if (e.stream && !e.uri) {                         /* aus dem Player bei einem Titel vom Dienst: Künstler dort suchen */
    var svc = streamById(e.stream);
    streamFindArtist(svc, e.artist).then(function(hit){
      if (seq !== browseSeq) return;
      if (hit) e.uri = hit.uri; else e.stream = null;  /* nicht gefunden: eigene Sammlung */
      browseArtist(e, seq);
    });
    return;
  }
  var isStream = !!streamOf(e.uri || '');
  browseGet(e.uri || ('artists://' + e.artist)).then(function(j){
    if (seq !== browseSeq) return;
    var seenUri = {};
    var all = browseItems(j);
    var albums = all.filter(function(it){
      if (!it.title || !it.uri || !/^folder/.test(it.type || '') || seenUri[it.uri]) return false;
      if (streamIsArtist(it)) return false;           /* andere Künstler nicht als Album */
      seenUri[it.uri] = true;
      return true;
    });
    var pageTracks = all.filter(function(it){ return it.uri && it.title && !/^folder/.test(it.type || '') && it.type === 'song'; });   /* z. B. Top-Titel bei TIDAL/Qobuz */
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (!albums.length && !pageTracks.length && isStream) { browseBody.appendChild(browseNote(T('browse.noAlbums'))); return; }

    var photo = document.createElement('img');      /* Künstlerfoto vom Tag-Dienst (Deezer); ohne Foto fällt es weg */
    photo.id = 'browseArtistPhoto';
    photo.alt = '';
    photo.addEventListener('error', function(){ if (photo.parentNode) photo.parentNode.removeChild(photo); });
    photo.src = TAGS + '/artistimage?name=' + encodeURIComponent(e.artist);
    browseBody.appendChild(photo);

    if (!isStream) {                                  /* alles vom Künstler abspielen (Alben und Einzeltitel) */
      browseBody.appendChild(playRow(T('browse.playAll'), '', function(){
        browsePlay({uri:'artists://' + e.artist, service:'mpd', type:'folder', title:e.artist});
      }, [rateArtistHeart(e.artist),                   /* Lieblingskünstler (rating.js) */
          randomMixButton({artist: e.artist}),         /* 25 zufällige Titel des Künstlers (discover.js) */
          tagArtistButton(e.artist),                   /* Tags aller lokalen Titel des Künstlers bearbeiten */
          queueAddButton([{uri:'artists://' + e.artist, service:'mpd', type:'folder', title:e.artist}], 0)]));
    }

    /* Reiter „Alben & Titel“, „Entdecken“ (discover.js; beim Dienst „Lokal entdecken“: aus der eigenen Sammlung)
       und „Hintergrund“; der gewählte bleibt beim Zurück (e.tab) */
    var panes = browseTabs(e, [['albums', T('browse.tab.albums')],
      ['more', T(isStream ? 'browse.tab.moreLocal' : 'browse.tab.more'), function(box){
        var moreNote = browseNote(T('browse.loading')), more;
        box.appendChild(moreNote);
        more = discoverMore(e.artist, function(){ return seq === browseSeq; }, function(){ if (moreNote.parentNode) moreNote.parentNode.removeChild(moreNote); },
          function(){ if (!box.querySelector('.dMoreSec')) { moreNote.textContent = T('more.empty'); box.insertBefore(moreNote, more); } });
        box.appendChild(more);
      }],
      ['bg', T('browse.tab.bg'), function(box){ backgroundFill(box, e, seq, e.artist); }]]);
    var pane = panes.albums;

    var albumHead = browseHeading(T('browse.albums'));
    albumHead.style.display = 'none';
    pane.appendChild(albumHead);
    if (!albums.length && !isStream) pane.appendChild(browseNote(T('browse.noAlbumsLocal')));
    var genreRows = [];

    albums.forEach(function(al){
      var row = document.createElement('div');
      row.className = 'sRow' + (al.title === curAlbum && e.artist === curArtist ? ' cur' : '');
      var img = document.createElement('img');
      img.className = 'sCover';
      if (al.albumart) img.src = artUrl(al.albumart);
      var meta = document.createElement('div');
      meta.className = 'sMeta';
      var ti = document.createElement('div');
      ti.className = 'sTitle'; ti.textContent = al.title;
      meta.appendChild(ti);
      var subText = streamOf(al) ? [al.year, al.audioQuality && al.audioQuality !== 'LOSSLESS' ? al.audioQuality : ''].filter(function(x){ return x; }).join('  ·  ') : (al.artist || '');
      if (subText) { var sub = document.createElement('div'); sub.className = 'sSub'; sub.textContent = subText; meta.appendChild(sub); }
      row.appendChild(img); row.appendChild(meta);
      var apen = tagAlbumButton(al);                  /* lokales Album: Tags aller Titel */
      if (apen) row.appendChild(apen);
      row.addEventListener('click', function(){
        browseStack.push({kind:'album', artist:e.artist, album:al.title, uri:al.uri, albumart:al.albumart, service:al.service});
        browseRender();
      });
      pane.appendChild(row);
      if (!isStream) genreRows.push({row: row, uri: al.uri, album: al.title, artist: al.artist || e.artist});
    });
    if (genreRows.length && typeof genreDecorate === 'function') genreDecorate(genreRows, seq);   /* Genre vor dem Stift */

    function addTitles(list, showAlbum) {
      if (!list.length || seq !== browseSeq) return;
      albumHead.style.display = '';                   /* "Alben" erst anzeigen, wenn darunter "Titel" folgt */
      pane.appendChild(browseHeading(T('browse.tracks')));
      list.forEach(function(t){ pane.appendChild(browseTrackRow(t, e, showAlbum)); });
    }
    if (isStream) addTitles(pageTracks, true);
    else localExtraTitles(e.artist, albums.map(function(a){ return a.title; })).then(function(list){ addTitles(list, true); });
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('browse.loadError')));
  });
}

/* ---------- Titel eines Albums ---------- */
/* Aus der Wiedergabe ist nur Künstler und Album bekannt: die Adresse steht in der Albumliste des Künstlers */
function resolveAlbumUri(artist, album) {
  return browseGet('artists://' + artist).then(function(j){
    var hit = null;
    browseItems(j).forEach(function(it){
      if (!hit && it.type === 'folder' && it.uri && (it.title || '').toLowerCase() === album.toLowerCase()) hit = it;
    });
    return hit ? hit.uri : 'albums://' + artist + '/' + album;
  }).catch(function(){ return 'albums://' + artist + '/' + album; });
}

/* Album beim Dienst suchen (Titel vom Dienst im Player): gleicher Titel, bei mehreren der vom gleichen Künstler;
   Zusätze wie „(Remastered)“ zählen nicht. -> Adresse oder null */
function streamFindAlbum(svc, artist, album) {
  if (!svc || !svc.on) return Promise.resolve(null);
  function bare(s) { return String(s || '').toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, '').trim(); }
  var want = bare(album), who = bare(artist);
  return withTimeout(fetch('/api/v1/search?query=' + encodeURIComponent(album)).then(function(r){ return r.json(); }), STREAM_TIMEOUT_MS).then(function(j){
    var lists = (j && j.navigation && j.navigation.lists) || [];
    var found = streamSplitSearch(lists, album).stream[svc.id].albums.filter(function(it){ return bare(it.title || it.name) === want; });
    var best = found.filter(function(it){ return !it.artist || bare(it.artist) === who; })[0] || found[0];
    return best ? best.uri : null;
  }).catch(function(){ svc.downUntil = Date.now() + 60000; return null; });
}

function browseAlbum(e, seq) {
  var svc = e.stream && !e.uri ? streamById(e.stream) : null;
  var ready = e.uri ? Promise.resolve(e.uri)
    : (svc ? streamFindAlbum(svc, e.artist, e.album) : Promise.resolve(null)).then(function(u){
        return u || resolveAlbumUri(e.artist, e.album);    /* beim Dienst nicht gefunden: eigene Sammlung */
      }).then(function(u){ e.uri = u; return u; });
  ready.then(browseGet).then(function(j){
    if (seq !== browseSeq) return;
    var info = (j && j.navigation && j.navigation.info) || {};
    var tracks = browseItems(j).filter(function(it){ return it.uri && !/^folder/.test(it.type || ''); });
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (!tracks.length) { browseBody.appendChild(browseNote(T('browse.noTracks'))); return; }

    var art = info.albumart || e.albumart || tracks[0].albumart || (e.album === curAlbum ? lastArt : '');
    var head = document.createElement('div');
    head.id = 'browseAlbumHead';
    var img = document.createElement('img');
    img.className = 'bCover';
    if (art) img.src = artUrl(art);
    var meta = document.createElement('div');
    meta.className = 'sMeta';
    /* Künstler (klein) – Album (groß) – Genre (klein); Künstler und Genre öffnen ihre Seite */
    var who = info.artist || e.artist || '';
    var ar = document.createElement('div');
    ar.className = 'sSub bArtist'; ar.textContent = who;
    if (who && !streamOf(e.uri) && who !== 'Verschiedene' && !/^various( artists)?$/i.test(who)) {   /* lokal: Alben des Künstlers */
      ar.classList.add('bLink');
      ar.addEventListener('click', function(){
        browseStack.push({kind:'artist', artist:who});
        browseRender();
      });
    }
    var ti = document.createElement('div');
    ti.className = 'sTitle bAlbum'; ti.textContent = e.album;
    var ge = document.createElement('div');
    ge.className = 'sSub bGenreHead';
    meta.appendChild(ar); meta.appendChild(ti); meta.appendChild(ge);
    if (!streamOf(e.uri) && typeof albumInfoLookup === 'function') {
      albumInfoLookup([{uri: e.uri, album: e.album, artist: who}]).then(function(info){
        var gs = info.genres;
        if (seq !== browseSeq) return;
        if (info.years[0]) ti.appendChild(yearSpan(info.years[0]));
        if (!gs[0]) return;
        ge.textContent = gs[0];
        ge.classList.add('bLink');
        ge.addEventListener('click', function(){ genreOpen(gs[0]); });
      });
    }
    head.appendChild(img); head.appendChild(meta);
    browseBody.appendChild(head);
    var localTracks = tracks.filter(isLocalTrack);
    var play = playRow(T('browse.play'), playRowSub(tracks, function(t){ return t.duration; }), function(){
      browsePlay({uri:e.uri, service:info.service || e.service || 'mpd', type:'folder', title:e.album, artist:e.artist});
    }, [localTracks.length ? tagEditButton(localTracks.map(function(t){ return {uri:t.uri, title:t.title || t.name || ''}; }),   /* lokale Dateien: Tags bearbeiten */
                                           e.album, 'browseEditBtn') : null,
        queueAddButton([{uri:e.uri, service:info.service || e.service || 'mpd', type:'folder', title:e.album, artist:e.artist}], tracks.length)]);
    play.title = T('browse.playAlbum');
    browseBody.appendChild(play);
    albumPlaysInfo(play, seq, e.uri, e.album, who);

    /* Reiter „Titel“, „Entdecken“ (beim Dienst „Lokal entdecken“) und „Hintergrund“ */
    var stream = !!streamOf(e.uri);
    var panes = browseTabs(e, [['tracks', T('browse.tab.tracks')],
      ['more', T(stream ? 'browse.tab.moreLocal' : 'browse.tab.more'), function(box){
        discoverAlbum(box, {artist: who, album: e.album, uri: stream ? '' : e.uri}, function(){ return seq === browseSeq; });
      }],
      ['bg', T('browse.tab.bg'), function(box){ backgroundFill(box, e, seq, who, e.album); }]]);
    var pane = panes.tracks;

    var rows = [];
    pane.appendChild(listHint(T('browse.hintAlbum')));
    tracks.forEach(function(t, i){
      var row = document.createElement('div');
      var isCur = (e.album === curAlbum && (t.title || t.name) === mTitle.textContent);
      row.className = 'sRow bTrack' + (isCur ? ' cur' : '');
      var num = document.createElement('div');
      num.className = 'bNum'; num.textContent = i + 1;
      var tm = document.createElement('div');
      tm.className = 'sMeta';
      var tt = document.createElement('div');
      tt.className = 'sTitle'; tt.textContent = t.title || t.name || '';
      tm.appendChild(tt);
      row.appendChild(num); row.appendChild(tm);
      if (t.duration) {
        var du = document.createElement('div');
        du.className = 'bDur'; du.textContent = fmtTime(t.duration);
        row.appendChild(du);
      }
      var pen = tagTrackButton(t);
      if (pen) row.appendChild(pen);
      row.addEventListener('click', function(){            /* Album ab diesem Titel (wie bei Playlisten) */
        playlistPlay({uri:e.uri, name:e.album, service:info.service || e.service || 'mpd', type:'folder'}, tracks, i);
      });
      pane.appendChild(row);
      rows.push(row);
    });
    rateAlbumPage(seq, e, who, tracks, meta, rows);         /* Sterne und Daumen (rating.js) */
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('browse.loadError')));
  });
}

/* Albumseite: „12-mal gehört / zuletzt …“ aus dem Verlauf, klein und mittig zwischen „Abspielen“ und den Symbolen.
   Nur Information, kein Knopf: ein Tipp darauf spielt wie die übrige Zeile das Album. */
function albumPlaysDay(t) {                               /* heute, gestern, sonst 3.10.2025 */
  var s = histDay(t);
  return s === T('hist.today') || s === T('hist.yesterday') ? s.toLowerCase() : langDate(new Date(t * 1000));
}
function albumPlaysInfo(play, seq, uri, album, artist) {
  if (typeof TAGS === 'undefined') return;
  var local = histRel(uri || '');
  tagGetJson('/plays?view=album&u=' + encodeURIComponent(local) + '&al=' + encodeURIComponent(album || '') + '&ar=' + encodeURIComponent(local ? '' : artist || ''))
    .then(function(r){
      if (seq !== browseSeq || !r || !r.ok) return;
      var st = r.stats, box = histEl('div', 'bPlays');
      box.appendChild(histEl('div', 'bPlaysN', st ? T('album.plays', {n: st.n}) : T('album.playsNone')));
      if (st) box.appendChild(histEl('div', '', T('album.playsLast', {d: albumPlaysDay(st.last)})));
      play.insertBefore(box, play.querySelector('.sMeta').nextSibling);
    }).catch(function(){});
}

/* ---------- Titel einer Playlist ---------- */
/* Tipp auf einen Titel: die ganze Playlist wird zur Warteschlange und läuft ab diesem Titel */
var lastPlayedPlaylist = '', playlistJump = 0;
function playlistPlay(e, tracks, from) {
  lastPlayedPlaylist = e.uri;
  var jump = ++playlistJump;                       /* inzwischen etwas anderes gestartet: nicht mehr springen */
  socket.emit('replaceAndPlay', {uri:e.uri, title:e.name, albumart:null, service:e.service || 'mpd', type:e.type || undefined});
  closeAllOverlays();
  browseOrigin = null;
  if (!from) return;
  var tries = 0;
  (function waitForQueue() {                       /* warten, bis die Warteschlange vollständig ist, dann springen */
    setTimeout(function(){
      if (jump !== playlistJump || lastPlayedPlaylist !== e.uri) return;
      fetch('/api/v1/getQueue').then(function(r){ return r.json(); }).then(function(j){
        if (jump !== playlistJump) return;
        var q = (j && j.queue) || [], n = q.length;
        function tail(u) { return String(u || '').split('/').pop(); }   /* Präfixe (music-library/, mnt/) unterscheiden sich */
        var t0 = tracks[0] && tail(tracks[0].uri), q0 = q[0] && tail(q[0].uri);
        if (t0 && q0 && t0 !== q0) return;            /* Warteschlange gehört nicht (mehr) zu dieser Playlist */
        if (n >= tracks.length) socket.emit('play', {value:from});
        else if (++tries < 16) waitForQueue();
      }).catch(function(){ if (++tries < 16) waitForQueue(); });
    }, 500);
  })();
}

function browsePlaylist(e, seq) {
  browseGet(e.uri).then(function(j){
    if (seq !== browseSeq) return;
    var tracks = browseItems(j).filter(function(it){ return it.uri && !/^folder/.test(it.type || ''); });
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    if (!tracks.length) { browseBody.appendChild(browseNote(T('browse.playlistEmpty'))); return; }

    var tile = document.createElement('div');        /* Kachel aus den Künstlerfotos, wie in der Playlistenliste */
    plTileDraw(tile, plTileArtists(tracks));
    if (tile.firstChild) { tile.id = 'browsePlTile'; browseBody.appendChild(tile); }

    browseBody.appendChild(playRow(T('browse.playPlaylist'), playRowSub(tracks, function(t){ return t.duration; }),
      function(){ playlistPlay(e, tracks, 0); },
      [queueAddButton(tracks.map(function(t){ return {uri:t.uri, service:t.service || 'mpd', type:'song', title:t.title || t.name || '', artist:t.artist || '', album:t.album || ''}; }), tracks.length)]));
    browseBody.appendChild(listHint(T('browse.hintPlaylist')));

    tracks.forEach(function(t, i){
      var row = document.createElement('div');
      var isCur = (i === curPos && lastPlayedPlaylist === e.uri);
      row.className = 'sRow bTrack' + (isCur ? ' cur' : '');
      var num = document.createElement('div');
      num.className = 'bNum'; num.textContent = i + 1;
      var tm = document.createElement('div');
      tm.className = 'sMeta';
      var tt = document.createElement('div');
      tt.className = 'sTitle'; tt.textContent = t.title || t.name || '';
      tm.appendChild(tt);
      if (t.artist) { var ts = document.createElement('div'); ts.className = 'sSub'; ts.textContent = t.artist; tm.appendChild(ts); }
      row.appendChild(num); row.appendChild(tm);
      if (t.duration) {
        var du = document.createElement('div');
        du.className = 'bDur'; du.textContent = fmtTime(t.duration);
        row.appendChild(du);
      }
      var pen = tagTrackButton(t);
      if (pen) row.appendChild(pen);
      row.addEventListener('click', function(){ playlistPlay(e, tracks, i); });
      browseBody.appendChild(row);
    });
  }).catch(function(){
    if (seq !== browseSeq) return;
    while (browseBody.firstChild) browseBody.removeChild(browseBody.firstChild);
    browseBody.appendChild(browseNote(T('browse.loadError')));
  });
}

/* ---------- Einstieg und Zurück ---------- */
mArtist.addEventListener('click', function(){
  var a = mArtist.textContent;
  if (curRadio || !a) return;
  openBrowse({kind:'artist', artist:a, stream:curStream ? curStream.id : undefined});   /* Titel vom Dienst: dort suchen */
});
mAlbum.addEventListener('click', function(){
  var a = mArtist.textContent, al = curAlbumTitle;
  if (curRadio || !a || !al) return;
  openBrowse({kind:'album', artist:a, album:al, stream:curStream ? curStream.id : undefined});
});
mTitle.addEventListener('click', function(){       /* Webradio: Klick auf "Künstler - Titel"; eigene Datei: Mehr wie dieser Titel */
  if (curRadio && radioArtist) return openBrowse({kind:'artist', artist:radioArtist});
  if (similarOk()) openBrowse({kind:'similar', file:curUri, artist:mArtist.textContent, title:curTitle, album:curAlbumTitle});
});
function similarOk() { return !curRadio && !curStream && !!curUri && !!curTitle && discoverReady; }
browseBack.addEventListener('click', function(){
  if (browseStack.length > 1) { browseStack.pop(); browseRender(); }
  else if (browseOrigin) {                        /* zurück zu Suche bzw. Info, wie sie waren */
    var o = browseOrigin; browseOrigin = null;
    closeAllOverlays(); o.classList.add('on');
  }
});
document.getElementById('closeBrowse').addEventListener('click', function(){ closeAllOverlays(); });
