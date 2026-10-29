/* State polling and start of the timers
   Classic script, shared global scope; see xplorio.html for load order. */
/* ---------- Poll ---------- */
var qualityState = null;
/* ReplayGain of the current file (tag service /replaygain): asked when the track changes and once more shortly after,
   because the "Automatic" mode may switch between album and track right at the change */
var rgState = {uri: null, gain: null};
function rgFetch(st) {
  if (st.uri === rgState.uri) return;
  rgState = {uri: st.uri, gain: null};
  if (typeof TAGS === 'undefined' || typeof isLocalTrack !== 'function' || !isLocalTrack(st)) return;
  var uri = st.uri;
  function ask() {
    withTimeout(fetch(TAGS + '/replaygain?uri=' + encodeURIComponent(uri)), 8000).then(function(r){ return r.json(); })
      .then(function(j){
        if (rgState.uri !== uri) return;
        rgState.gain = j && j.gain && typeof j.gain.db === 'number' ? j.gain : null;
        if (qualityState && qualityState.uri === uri) paintQuality(qualityState);
      }).catch(function(){ /* no tag service: no value */ });
  }
  ask();
  setTimeout(function(){ if (rgState.uri === uri) ask(); }, 3000);
}
/* mode changed on the Playback page: hide the value at once and ask again (off -> no value) */
function rgRefresh() {
  rgState = {uri: null, gain: null};
  if (qualityState) paintQuality(qualityState);
}
function paintQuality(st) {
  qualityState = st;
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;   /* other input on the amplifier: its name instead of the format */
  if (st.trackType === 'input') { mTech.textContent = ''; mBadge.textContent = ''; mBadge.className = 'qBadge'; return; }   /* large icon instead of cover */
  if (inp) { mTech.textContent = inp.name; mBadge.textContent = ''; mBadge.className = 'qBadge'; return; }
  mp4Attach(st, function(){ if (qualityState === st) paintQuality(st); });   /* m4a: codec from the file, once known */
  var q = classifyQuality(st, window.APP_CONFIG);
  rgFetch(st);
  var tech = q.tech.slice();
  if (rgState.uri === st.uri && rgState.gain) tech.push(qGainText(rgState.gain.db));
  /* each value unbreakable, a line break only after a "·": "−8.6 dB" never splits */
  mTech.textContent = '';
  tech.forEach(function(v, i){
    if (i) mTech.appendChild(document.createTextNode('\u00a0· '));
    var it = document.createElement('span');
    it.className = 'techItem'; it.textContent = v;
    mTech.appendChild(it);
  });
  mTech.title = rgState.uri === st.uri && rgState.gain ? 'ReplayGain (' + T('pb.rg.' + rgState.gain.mode) + ')' : '';
  mBadge.textContent = q.label;
  mBadge.className = 'qBadge' + (q.kind ? ' ' + q.kind : '');
}
/* touch devices show no title tooltip: tapping the line shows the same text as a message */
mTech.addEventListener('click', function(){ if (mTech.title) showToast(mTech.title); });

/* Web radio: if the player shows a station logo (address from Volumio), report it to the tag service for the station list.
   The station list knows the name (radioNames in library.js); once per station and address */
var radioLogoSent = {};
/* Station name for the current stream, from the station list (radioNames):
   0. TuneIn: same station ID in the logo (cdn-profiles.tunein.com/s250282/…) and in the favorite address (Tune.ashx?id=s250282)
   1. same address (also without trailing /, http or https)
   2. same server and same station path (e.g. stream.klassikradio.de/piano, regardless of bitrate), if unique
   3. a station on the same server whose name contains what Volumio reports as artist (e.g. "Piano")
   otherwise the artist itself (with TuneIn usually the station name) */
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
  if (ar && ti.indexOf(ar + ' - ') === 0) ar = '';             /* "artist - title" with the same artist: no station name */
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

/* web radio: cover for the current track from the tag service (iTunes/Deezer); the station logo until loaded and if not found */
var radioCovers = {};            /* "artist|title" -> image address, false (no cover) or null (loading) */
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

/* other input on the amplifier: large icon of the input instead of the cover (as an SVG image) */
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

/* Track whose playback could not start (e.g. other input): Volumio then sometimes reports only position and
   volume, sometimes still the previous (paused) track, although the queue already contains the new album.
   Title, artist, album and cover then come from the queue (entry at the position); starting from another
   input this is reconciled until something plays again, and stop is sent once, so that Volumio does not skip
   unheard through the album or resume the old track on play. Refetched at most every 3 s, immediately on a
   different position */
var stateFillCache = {pos: -1, at: 0, item: null}, stateFillWatch = false, stateFillStopped = '';
function stateUriKey(u) { return String(u || '').replace(/^(music-library\/|mnt\/)/, ''); }   /* prefixes differ */
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
    if (check && stateUriKey(it.uri) === stateUriKey(st.uri)) return st;   /* Volumio already reports the right track */
    var r = {};
    for (var k in st) if (st.hasOwnProperty(k)) r[k] = st[k];
    if (check) {                                                    /* stale track: replace its details entirely */
      ['title', 'artist', 'album', 'albumart', 'samplerate', 'bitdepth', 'bitrate', 'channels'].forEach(function(k){ r[k] = ''; });
      r.status = 'stop'; r.seek = 0;
    }
    ['uri', 'title', 'artist', 'album', 'albumart', 'trackType', 'service', 'duration', 'samplerate', 'bitdepth'].forEach(function(k){
      if (it[k] !== undefined && it[k] !== '') r[k] = it[k];
    });
    if (!r.title && it.name) r.title = it.name;
    if (!r.status) { r.status = 'stop'; r.seek = 0; r.noStatus = true; }   /* not playing: time at the start */
    if (stateFillWatch && (r.noStatus || check) && stateFillStopped !== r.uri) {
      stateFillStopped = r.uri;
      fetch('/api/v1/commands/?cmd=stop').catch(function(){});
    }
    return r;
  }, function(){ return st; });
}

/* What the player shows: with another input its icon and name, otherwise Volumio. If you meanwhile pick something
   else to play in Xplorio (or Volumio plays), the album is shown (cover, artist, album title; no title,
   no track info, no lyrics, since the amplifier is playing something else), with controls locked: switch the amplifier
   to the player and play (reconciled with the queue and stop: stateFill) */
var inputSession = '', inputBaseUri = '';
function inputApply(st) {
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;
  document.documentElement.classList.toggle('otherInput', !!inp);
  if (!inp) { inputSession = ''; return st; }
  if (inputSession !== inp.name) { inputSession = inp.name; inputBaseUri = st.uri || ''; }   /* what was loaded when switching */
  if (st.status === 'play' || (st.uri || '') !== inputBaseUri) {
    var a = {};
    for (var j in st) if (st.hasOwnProperty(j)) a[j] = st[j];
    a.inputAlbum = true;
    return a;
  }
  var r = {};
  for (var k in st) if (st.hasOwnProperty(k)) r[k] = st[k];          /* volume, shuffle, repeat stay from Volumio */
  r.artist = ''; r.title = inp.name; r.album = ''; r.albumart = inputArt(inp);
  r.trackType = r.service = 'input'; r.uri = ''; r.duration = 0; r.seek = 0;
  r.samplerate = r.bitdepth = r.bitrate = r.fileFormat = '';
  return r;
}

var playIconShown = null;                              /* last drawn icon (set again only on change) */
var pollBusy = false;                                   /* never several getState at once (Volumio hangs e.g. while scanning) */
function poll() {
  if (document.hidden || pollBusy) return;
  pollBusy = true;
  if (!volDrag && ROTEL_ON) rotel('/state');  
withTimeout(fetch('/api/v1/getState'), 8000).then(function(r){ return r.json(); }).then(stateFill).then(function(st){
st = inputApply(st);
if (st.status === 'play' && typeof queuedForInput !== 'undefined') queuedForInput = false;   /* already playing: play back to normal */

curDur = Number(st.duration) || 0;
/* when stopped, Volumio sometimes keeps counting the time (playback requested, but the output device could not be opened):
   then the track is at the start */
seekBase = st.status === 'stop' ? 0 : (Number(st.seek) || 0); seekStamp = Date.now();
playing = (st.status === 'play') && st.trackType !== 'input';   /* other input: no running time */
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
    var preview = !!st.inputAlbum;                      /* other input, album selected: album title large, no track title */
    if (preview) title = '';

    marqueeSet(mTitle, preview ? album : title);
    mArtist.textContent = artist;
    if ((radio || preview ? '' : album) !== curAlbumTitle || st.uri !== curAlbumUri) {   /* only on change: the year arrives later */
      curAlbumTitle = radio || preview ? '' : album; curAlbumUri = st.uri;
      mAlbum.textContent = curAlbumTitle;
      if (typeof playerYear === 'function') playerYear(st.uri || '', curAlbumTitle, artist);
    }
    mArtist.classList.toggle('link', !radio && !!artist);      /* click opens albums or tracks (browse.js) */
    mAlbum.classList.toggle('link',  !radio && !preview && !!album);
    paintQuality(st);
    tagPaintPlayer(st);
    if (radio) {
      var p = title.indexOf(' - ');
      artist = (p > 0) ? title.slice(0, p).trim() : '';
      title  = (p > 0) ? title.slice(p + 3).trim() : title;
      album  = '';
    }
    radioArtist = radio ? artist : '';                 /* "artist - title" recognized in the stream title */
    curUri = st.uri || ''; curTitle = radio ? '' : title;
    mTitle.classList.toggle('link', !!radioArtist || similarOk());   /* click opens their albums or similar tracks (browse.js) */

    var key    = artist + '|' + album + '|' + (radio ? title : '');
    var tracks = preview && stageOn && !!album;           /* stage view, album only queued (other input): its track list */
    var lyrKey = tracks ? 'tracks|' + artist + '|' + album : artist + '|' + title;

    if (lyrKey !== lastLyrKey) {
      lastLyrKey = lyrKey;
      setTrackInfo(lyrKey, title, null, radio);                   /* remove the previous track's tab */
      if (tracks) {
        (function(k, al, ar){
          fetch('/api/v1/getQueue').then(function(r){ return r.json(); }).then(function(q){
            if (k === lastLyrKey) showLyrics({kind: 'tracks', value: albumTracks(q && q.queue, al, ar)});
          }).catch(function(){ if (k === lastLyrKey) showLyrics(null); });
        })(lyrKey, album, artist);
      }
      else if (!artist || !title) showLyrics(null);                /* e.g. other input */
      else {
        askExtra(artist, title, radio).then(function(res){ if (lyrKey === lastLyrKey) showLyrics(res); });   /* discard a late answer for the previous track */
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
      if (key !== lastKey) return;                   /* something else is playing meanwhile */
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
  if (key !== lastKey) return;    /* something else is playing meanwhile: discard late answer */
  showInfo([                      /* title: heading in the overlay; label: short tab name (long names would break the bar) */
    {title:album,             label:T('info.tab.album'),       data:res[0], always:true},
    {title:artist,            label:T('info.tab.artist'),    data:res[1], always:true},
    {title:T('info.credits'), label:T('info.tab.credits'), data:res[2]},
    {title:T('info.collection'), label:T('info.tab.collection'), data:res[3]},
    {title:T('info.similar'), label:T('info.tab.similar'),   lazy:true, artist:artist},
    {title:T('browse.tab.more'), label:T('browse.tab.more'), discover:true, artist:artist}
  ]);
});

  }).catch(function(){ playing = false; })            /* Volumio unreachable: stop the time from running */
    .then(function(){ pollBusy = false; });
}

/* limit small caches in continuous operation (the iPad runs for days): oldest entries first */
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

