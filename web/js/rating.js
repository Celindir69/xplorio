/* Ratings: heart for artists, 1–5 stars for albums, thumbs for tracks (neutral, like, dislike).
   "Like" is the Volumio favourite: thumbs up adds the track to Volumio's favourites, a favourite from Volumio
   shows thumbs up here. "Dislike", hearts and stars are stored by the tag service (POST /ratings, /rate).
   Classic script, shared global scope; loaded after browse.js and tagedit.js. */
var rateReady = false;           /* tag service reachable */
function rateSvg(d) { return '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; }
var RATE_SVG = {
  up0: rateSvg('M21 8h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.58 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2c0-1.1-.9-2-2-2zm0 4l-3 7H9V9l4.34-4.34L12.23 10H21v2zM1 9h4v12H1z'),
  up1: rateSvg('M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z'),
  down: rateSvg('M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z'),
  heart0: rateSvg('M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3 4.42 3 2 5.42 2 8.5c0 3.78 3.4 6.86 8.55 11.54L12 21.35l1.45-1.32C18.6 15.36 22 12.28 22 8.5 22 5.42 19.58 3 16.5 3zm-4.4 15.55l-.1.1-.1-.1C7.14 14.24 4 11.39 4 8.5 4 6.5 5.5 5 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z'),
  heart1: rateSvg('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'),
  star0: rateSvg('M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z'),
  star1: rateSvg('M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z')
};

/* taps on ratings never trigger the row or header below (playback) */
function rateStop(el) {
  ['touchstart', 'touchend', 'pointerdown'].forEach(function(ev){
    el.addEventListener(ev, function(e){ e.stopPropagation(); }, {passive:true});
  });
}

/* ---------- Volumio favourites (= thumbs up) ---------- */
/* key as in the tag service: file without leading music-library/ or mnt/, streaming URIs unchanged */
function rateFileKey(uri) { return String(uri || '').replace(/^\/+/, '').replace(/^music-library\//, '').replace(/^mnt\//, ''); }
var favMap = {}, favAt = 0, favLoading = null;
function favRefresh(force) {
  if (!force && Date.now() - favAt < 5000) return Promise.resolve(favMap);
  if (favLoading) return favLoading;
  favLoading = fetch('/api/v1/browse?uri=favourites').then(function(r){ return r.json(); }).then(function(j){
    var m = {};
    browseItems(j).forEach(function(it){ if (it.uri) m[rateFileKey(it.uri)] = it; });
    favMap = m; favAt = Date.now(); favLoading = null;
    return m;
  }).catch(function(){ favLoading = null; return favMap; });
  return favLoading;
}

/* t: {uri, service, title, artist, album, albumart}; v: 1 like (favourite), -1 dislike, 0 neutral */
function rateTrackSet(t, v) {
  var k = rateFileKey(t.uri), fav = favMap[k];
  if (v === 1 && !fav) {
    socket.emit('addToFavourites', {uri: t.uri, title: t.title || '', service: t.service || 'mpd',
                                    artist: t.artist || '', album: t.album || '', albumart: t.albumart || ''});
    favMap[k] = {uri: t.uri, service: t.service || 'mpd'};
  } else if (v !== 1 && fav) {
    socket.emit('removeFromFavourites', {uri: fav.uri, service: fav.service || 'mpd', name: t.title || ''});
    delete favMap[k];
  }
  favAt = Date.now();                                  /* Volumio needs a moment until the list is correct */
  showToast(T(v === 1 ? 'rate.liked' : v === -1 ? 'rate.disliked' : 'rate.cleared'));
  return tagPostJson('/rate', {kind: 'track', uri: t.uri, v: v === -1 ? -1 : 0, ar: t.artist || '', ti: t.title || ''})
    .catch(function(){ if (v === -1) showToast(T('rate.saveError')); });
}

function rateTrackValue(t, down) { return down === -1 ? -1 : favMap[rateFileKey(t.uri)] ? 1 : 0; }

/* thumb: a tap cycles neutral -> like -> dislike -> neutral */
function rateThumb(t, v) {
  var b = histEl('div', 'rateThumb');
  b.title = T('rate.track');
  b.setValue = function(x){
    v = x;
    b.innerHTML = x === 1 ? RATE_SVG.up1 : x === -1 ? RATE_SVG.down : RATE_SVG.up0;
    b.classList.toggle('on', x !== 0);
  };
  b.setValue(v);
  rateStop(b);
  b.addEventListener('click', function(e){
    e.stopPropagation();
    var next = v === 0 ? 1 : v === 1 ? -1 : 0;
    b.setValue(next);
    rateTrackSet(t, next);
  });
  return b;
}

/* Add thumbs to track rows: items (Volumio entries) and rows in the same order, before the pen
   (else before `before`, e.g. the queue's trash can); alive() false: list rebuilt in the meantime */
function rateRows(items, rows, alive, before, extra) {
  var idx = [];
  items.forEach(function(t, i){ if (t.uri && (t.service || 'mpd') !== 'webradio' && t.trackType !== 'webradio') idx.push(i); });
  if (!rateReady || !idx.length) return Promise.resolve(null);
  var body = extra || {};
  body.tracks = idx.map(function(i){ return items[i].uri; });
  return Promise.all([favRefresh(true), tagPostJson('/ratings', body)]).then(function(r){
    if (!alive()) return null;
    idx.forEach(function(i, k){
      var t = items[i];
      var item = {uri: t.uri, service: t.service || 'mpd', title: t.title || t.name || '', artist: t.artist || '', album: t.album || '', albumart: t.albumart || ''};
      var row = rows[i], th = rateThumb(item, rateTrackValue(item, (r[1].tracks || [])[k]));
      row.insertBefore(th, row.querySelector('.tagEditMini') || (before ? row.querySelector(before) : null));
    });
    return r[1];
  });
}

/* ---------- Queue: thumbs per track ---------- */
var rateQueueSeq = 0;
function rateQueue(items, rows) {
  var seq = ++rateQueueSeq;
  rateRows(items, rows, function(){ return seq === rateQueueSeq; }, '.qTrash').catch(function(){});
}
/* favourite changed (also in the Volumio UI) */
socket.on('urifavourites', function(){ favRefresh(true); });

/* ---------- Artist page: heart ---------- */
function rateArtistHeart(name) {
  var b = histEl('div', 'rateHeart'), v = 0;
  b.title = T('rate.artist');
  function show() { b.innerHTML = v ? RATE_SVG.heart1 : RATE_SVG.heart0; b.classList.toggle('on', !!v); }
  show();
  if (!rateReady) { b.style.display = 'none'; return b; }
  tagPostJson('/ratings', {artist: name}).then(function(r){ v = r && r.artist ? 1 : 0; show(); }).catch(function(){});
  rateStop(b);
  b.addEventListener('click', function(e){
    e.stopPropagation();
    v = v ? 0 : 1; show();
    showToast(T(v ? 'rate.artistOn' : 'rate.artistOff', {name: name}));
    tagPostJson('/rate', {kind: 'artist', name: name, v: v}).catch(function(){ showToast(T('rate.saveError')); });
  });
  return b;
}

/* ---------- Album page: stars in the header, thumbs per track ---------- */
/* meta: text block in the header; rows: rows in the order of tracks; seq: discards outdated answers */
function rateAlbumPage(seq, e, who, tracks, meta, rows) {
  if (!rateReady) return;
  var local = tracks.filter(isLocalTrack)[0];
  var albumUri = local ? local.uri : e.uri;
  var stars = histEl('div', 'rateStars'), v = 0;
  stars.title = T('rate.album');
  function show() {
    while (stars.firstChild) stars.removeChild(stars.firstChild);
    [1, 2, 3, 4, 5].forEach(function(n){
      var s = histEl('span', 'rateStar' + (n <= v ? ' on' : ''));
      s.innerHTML = n <= v ? RATE_SVG.star1 : RATE_SVG.star0;
      s.addEventListener('click', function(ev){
        ev.stopPropagation();
        v = (v === n) ? 0 : n;                            /* same star again: remove rating */
        show();
        var hint = false;                                 /* explain removal only the first time */
        if (!v) try { hint = !localStorage.getItem('rateClearHint'); localStorage.setItem('rateClearHint', '1'); } catch (er) { /* ignore */ }
        showToast(v ? T('rate.albumSet', {n: v}) : hint ? T('rate.albumClearedHint') : T('rate.cleared'));
        tagPostJson('/rate', {kind: 'album', uri: albumUri, al: e.album || '', ar: who || '', v: v}).catch(function(){ showToast(T('rate.saveError')); });
      });
      stars.appendChild(s);
    });
  }
  show();
  rateStop(stars);
  meta.appendChild(stars);
  var items = tracks.map(function(t){
    return {uri: t.uri, service: t.service, title: t.title || t.name || '', artist: t.artist || who || '', album: t.album || e.album || '', albumart: t.albumart || ''};
  });
  rateRows(items, rows, function(){ return seq === browseSeq; }, null, {album: albumUri}).then(function(r){
    if (r) { v = r.album || 0; show(); }
  }).catch(function(){});
}

whenTags(function(){
  rateReady = true;
  favRefresh(true);
});
