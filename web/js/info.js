/* Lyrics overlay and info overlay with tabs and swipe gestures
   Classic script, shared global scope; see xplorio.html for load order. */
/* ---------- Lyrics ---------- */
function showLyrics(data) {
  lyricLines = [];
paintTime();
  lyricsText.className = '';
  lyricsText.style.paddingBottom = '';
  area.scrollTop = 0;
  while (lyricsText.firstChild) lyricsText.removeChild(lyricsText.firstChild);
  btnLyrics.className = 'actBtn' + (data ? ' has-content' : '');
  lyrSyncShow(false);
  if (!data) return;
  if (data.kind === 'syncedLyrics') {
    renderSyncedLyrics(data.value, data.key);
  } else if (data.kind === 'tracks') {
    renderTrackList(data.value);
  } else {
    lyricsText.textContent = data.value;
  }
}

/* Stage view, album only queued while the amplifier is on another input: its track list in place of the lyrics */
function fmtTrackDur(s) {
  s = Math.round(Number(s) || 0);
  return s > 0 ? Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2) : '';
}
var lyrTrackList = null, lyrTrackSeq = 0;      /* the track list shown, to come back to it from a track's lyrics */
function renderTrackList(tracks) {
  if (!tracks || !tracks.length) return;
  lyrTrackList = tracks; lyrTrackSeq++;
  while (lyricsText.firstChild) lyricsText.removeChild(lyricsText.firstChild);
  lyricsText.className = 'lyrTracks';
  var head = document.createElement('div'); head.className = 'lyrTrkHead'; head.textContent = T('lyrics.tracks');
  lyricsText.appendChild(head);
  var side = '';
  tracks.forEach(function(t, i){
    var s = /^([A-Za-z])\d*$/.exec(t.pos || '');                /* record: side A, B … from "A1"; a line between the sides */
    s = s ? s[1].toUpperCase() : '';
    if (s && side && s !== side) lyricsText.appendChild(Object.assign(document.createElement('div'), {className: 'lyrTrkSide'}));
    if (s) side = s;
    var row = document.createElement('div'), n = document.createElement('span'), ti = document.createElement('span'), d = document.createElement('span');
    row.className = 'lyrTrk' + (t.lyrics ? ' lyr' : '') + (typeof curTitle !== 'undefined' && curTitle && (t.title || t.name) === curTitle ? ' cur' : ''); n.className = 'lyrTrkN'; ti.className = 'lyrTrkT'; d.className = 'lyrTrkD';
    n.textContent = t.pos || (i + 1) + '.';             /* record: side and number ("A1") */
    ti.textContent = t.title || t.name || '';
    d.textContent = fmtTrackDur(t.duration);
    row.appendChild(n); row.appendChild(ti); row.appendChild(d);
    if (t.queueIndex >= 0) row.addEventListener('click', function(){ queuePlayAt(t.queueIndex); });   /* play it (other input: only a hint, queue.js) */
    else if (t.lyrics) row.addEventListener('click', function(){ showTrackLyrics(t); });   /* record: its lyrics (lrclib) */
    lyricsText.appendChild(row);
  });
}
/* lyrics of one track of the list (record on the turntable): plain text from lrclib, the title centred above it, an
   arrow on the left goes back to the list */
function showTrackLyrics(t) {
  var seq = ++lyrTrackSeq, list = lyrTrackList;
  while (lyricsText.firstChild) lyricsText.removeChild(lyricsText.firstChild);
  lyricsText.className = 'lyrTracks lyrTrkLyrics';
  area.scrollTop = 0;
  var head = document.createElement('div'); head.className = 'lyrTrkTop';
  var back = document.createElement('button'); back.className = 'lyrTrkBack'; back.title = T('lyrics.tracks');
  back.innerHTML = '<svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
  back.addEventListener('click', function(ev){ ev.stopPropagation(); area.scrollTop = 0; renderTrackList(list); });
  var ti = document.createElement('div'); ti.className = 'lyrTrkName';
  if (t.pos) ti.appendChild(Object.assign(document.createElement('span'), {className: 'lyrTrkPos', textContent: t.pos + ' '}));
  ti.appendChild(document.createTextNode(t.title || ''));
  head.appendChild(back); head.appendChild(ti); head.appendChild(document.createElement('span'));   /* empty right cell: title centred */
  var body = document.createElement('div'); body.className = 'lyrTrkText'; body.textContent = T('browse.loading');
  lyricsText.appendChild(head); lyricsText.appendChild(body);
  fetch(extraUrl(t.artist || '', t.title || '')).then(function(r){ return r.ok ? r.json() : null; }).then(function(j){
    var plain = j && typeof j.plainLyrics === 'string' ? j.plainLyrics.trim() : '';
    if (!plain && j && typeof j.syncedLyrics === 'string')                 /* only synced: without the times */
      plain = j.syncedLyrics.split(/\r?\n/).map(function(l){ return l.replace(/\[[^\]]+\]/g, '').trim(); }).join('\n').trim();
    return plain.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  }).catch(function(){ return ''; }).then(function(text){
    if (seq !== lyrTrackSeq) return;
    body.textContent = text || T('lyrics.none');
    if (!text) body.classList.add('none');
  });
}
/* the queued tracks of this album (all of the queue if none match, e.g. a playlist) */
function albumTracks(queue, album, artist) {
  var all = (queue || []).map(function(t, i){
    var c = {};
    for (var k in t) if (t.hasOwnProperty(k)) c[k] = t[k];
    c.queueIndex = i;                                   /* position in the queue: a tap plays it */
    return c;
  });
  var same = all.filter(function(t){ return album && t.album === album && (!artist || !t.artist || t.artist === artist || t.albumartist === artist); });
  return same.length ? same : all;
}

/* ---------- Info ---------- */
/* "Track" tab (text about the single song): only if something was found. For albums as the second tab (album stays
   the start tab, so nothing jumps); for web radio at the very front, since there is no album and the track is what's new */
var trackInfo = null;            /* {key, item, radio} of the current track */
function trackInfoAt() { return trackInfo && trackInfo.radio ? 0 : 1; }
function withTrackInfo(list) {
  if (!trackInfo || !trackInfo.item || !list.length) return list;
  var at = trackInfoAt();
  return list.slice(0, at).concat([trackInfo.item], list.slice(at));
}
function setTrackInfo(key, title, data, radio) {
  var cur = infoItems[infoIdx];
  var item = data ? {title: title, label: T('info.tab.track'), data: data, track: true} : null;
  trackInfo = {key: key, item: item, radio: !!radio};
  var at = -1;
  infoItems.forEach(function(it, i){ if (it.track) at = i; });
  if (!infoItems.length || (at < 0 && !item)) return;  /* album/artist not there yet: comes with showInfo */
  if (at >= 0) infoItems.splice(at, 1);
  if (item) infoItems.splice(trackInfoAt(), 0, item);
  var idx = infoItems.indexOf(cur);                    /* stay on the same tab */
  if (item && radio && infoIdx === 0) idx = -1;        /* radio: if the start tab was open, show the track */
  infoIdx = idx >= 0 ? idx : 0;
  btnInfo.className = 'actBtn' + (infoItems.length ? ' has-content' : '');
  buildInfoTabs();
  if (idx < 0) renderInfo(false);                      /* the old track tab was open */
}

function showInfo(list) {
  list = withTrackInfo(list);
  infoItems = list.filter(function(i){ return i && (i.data || i.always || i.lazy || i.discover); });
  infoIdx = 0;
  btnInfo.className = 'actBtn' + (infoItems.length ? ' has-content' : '');
  buildInfoTabs();
  renderInfo(false);
}


function buildInfoTabs() {
  while (infoTabs.firstChild) infoTabs.removeChild(infoTabs.firstChild);
  if (infoItems.length < 2) { infoTabs.style.display = 'none'; return; }
  infoTabs.style.display = 'flex';
  infoItems.forEach(function(it, i){
    var t = document.createElement('div');
    t.className = 'infoTab' + (i === infoIdx ? ' on' : '');
    t.textContent = it.label || it.title;
    t.addEventListener('click', function(){
      var dir = i > infoIdx ? 1 : -1;
      infoIdx = i; buildInfoTabs(); renderInfo(dir);
    });
    infoTabs.appendChild(t);
  });
}

function tinyart() {
  var parts = Array.prototype.slice.call(arguments);
  return '/tinyart/' + parts.map(function(s){
    return (s || '').replace(/ /g, '_');
  }).join('/') + '/large';
}

function renderInfo(dir) {
  if (!infoItems.length) {
    while (infoContent.firstChild) infoContent.removeChild(infoContent.firstChild);
    return;
  }
  var it = infoItems[infoIdx];
  infoOverlayTitle.textContent = it.title;
  if (dir) {
    infoContent.style.transition = 'none';
    infoContent.style.transform = 'translateX(' + (dir * 100) + '%)';
    setTimeout(function(){
      infoContent.style.transition = 'transform .25s ease';
      infoContent.style.transform = 'translateX(0)';
    }, 20);
  } else {
    infoContent.style.transition = 'none';
    infoContent.style.transform = 'translateX(0)';
  }
  while (infoContent.firstChild) infoContent.removeChild(infoContent.firstChild);


  /* "Discover" tab: as on the artist page (discover.js); built once, not reloaded when switching back */
  if (it.discover) {
    if (!it.el) {
      var box = document.createElement('div'), note = browseNote(T('browse.loading'));
      box.appendChild(note);
      box.appendChild(discoverMore(it.artist, function(){ return infoItems.indexOf(it) >= 0; },
        function(){ if (note.parentNode) note.parentNode.removeChild(note); },
        function(){ if (!box.querySelector('.dMoreSec')) { note.textContent = T('more.empty'); box.insertBefore(note, box.firstChild); } }));
      it.el = box;
    }
    infoContent.appendChild(it.el);
    return;
  }

  if (it.lazy && !it.data) {
    var loading = document.createElement('div');
    loading.className = 'plHint';
    loading.textContent = T('info.similar.searching');
    infoContent.appendChild(loading);
    if (it.loading) return;                                /* already in progress (tab selected again): do not load twice */
    it.loading = true;
    loadSimilarArtists(it.artist).then(function(matches){
      var streams = {};                                    /* per service: null = still searching */
      streamsOn().forEach(function(svc){ streams[svc.id] = null; });
      it.data = {kind:'similarArtists', value: matches, streams: streams};
      if (infoItems[infoIdx] === it) renderInfo(false);
      var data = it.data;                                  /* services afterwards (one after another), so the collection appears immediately */
      streamsOn().reduce(function(chain, svc){
        return chain.then(function(){
          return loadStreamSimilar(svc, it.artist, matches).then(function(list){
            data.streams[svc.id] = list;
            if (infoItems[infoIdx] === it && it.data === data) renderInfo(false);
          });
        });
      }, Promise.resolve());
    }, function(){ it.loading = false; });
    return;
  }


if (!it.data || it.data.kind === 'story') {
  var img = document.createElement('img');
  if (it.title === curAlbum || it.track) {
    img.src = lastArt || tinyart(curArtist, curAlbum);
    img.className = 'infoImg album';             /* hidden in landscape: the cover is visible there anyway */
  } else {                                     /* artist photo from the tag service (Deezer), else Volumio's */
    var vol = tinyart(it.title);
    img.src = typeof TAGS !== 'undefined' && TAGS ? TAGS + '/artistimage?name=' + encodeURIComponent(it.title) : vol;
    img.className = 'infoImg artist';
    img.onerror = function(){ if (!this.dataset.vol) { this.dataset.vol = '1'; this.src = vol; } else this.style.display = 'none'; };
  }
  if (!img.onerror) img.onerror = function(){ this.style.display='none'; };
  if (typeof zoomable === 'function') zoomable(img, it.title, img.className === 'infoImg album' && typeof coverOriginals === 'function' && typeof curUri !== 'undefined' && curUri
    ? function(){ return coverOriginals(curUri); } : null);
  infoContent.appendChild(img);

  var p = document.createElement('div');
  p.style.cssText = 'font-size:calc(4 * var(--vw));line-height:1.65;white-space:pre-wrap;padding-bottom:2vh;';
  p.textContent = it.data ? it.data.value : T('info.noContent');
  infoContent.appendChild(p);
  return;
}

  if (it.data.kind === 'disc') {
    it.data.value.forEach(function(al){
      var row = document.createElement('div');
      var isCur = (al.title === curAlbum);
      row.className = 'disc-row' + (isCur ? ' cur' : '');
      row.textContent = al.title;
      row.addEventListener('click', function(){
        openBrowse({kind:'album', artist:curArtist, album:al.title, uri:al.uri});   /* album tracks; back arrow leads here */
      });
      infoContent.appendChild(row);
    });
    return;
  }


  if (it.data.kind === 'similarArtists') {
    var st = it.data.streams || {}, ids = Object.keys(st);
    var pending = ids.filter(function(id){ return st[id] === null; });
    var found = ids.filter(function(id){ return st[id] && st[id].length; });
    if (!it.data.value.length && !found.length && !pending.length) {
      var none = document.createElement('div');
      none.className = 'plHint';
      none.textContent = T('info.similar.none');
      infoContent.appendChild(none);
      return;
    }
    it.data.value.forEach(function(name){
      var row = document.createElement('div');
      row.className = 'disc-row';
      row.textContent = name;
      row.addEventListener('click', function(){
        openBrowse({kind:'artist', artist:name});                                  /* the artist's albums; back arrow leads here */
      });
      infoContent.appendChild(row);
    });
    found.forEach(function(id){
      var svc = streamById(id);
      var hd = document.createElement('div');
      hd.className = 'infoSection'; hd.textContent = svc.name;
      infoContent.appendChild(hd);
      st[id].forEach(function(t){
        var row = document.createElement('div');
        row.className = 'disc-row';
        row.textContent = t.title;
        row.addEventListener('click', function(){
          openBrowse({kind:'artist', artist:t.title, uri:t.uri});     /* albums at the service (browse.js) */
        });
        infoContent.appendChild(row);
      });
    });
    if (pending.length) {
      var wait = document.createElement('div');
      wait.className = 'plHint';
      wait.textContent = T('info.similar.searchingAt', {services: pending.map(function(id){ return streamById(id).name; }).join(T('info.listAnd'))});

      infoContent.appendChild(wait);
    }
    return;
  }


  creditsRender(infoContent, it.data.value);
}

/* credits as rows in box (info page, "Background" tab of the album page) */
function creditsRender(box, value) {
  value.forEach(function(row){
    var line = document.createElement('div');
    line.className = 'credit-row';
    var k = document.createElement('div');
    k.className = 'credit-key'; k.textContent = row.key;
    var v = document.createElement('div');
    v.className = 'credit-val';
    var more = document.createElement('div');                  /* expanded info below the row */
    more.className = 'credit-more';
    (row.values || []).forEach(function(x, i){
      if (i) v.appendChild(document.createTextNode(', '));
      var link = creditLink(x.uri), n = document.createElement('span');
      n.textContent = x.name;
      if (link) { n.className = 'credit-link'; n.addEventListener('click', function(){ toggleCredit(n, more, x.name, link); }); }
      v.appendChild(n);
    });
    line.appendChild(k); line.appendChild(v);
    box.appendChild(line);
    box.appendChild(more);
  });
}

/* Volumio links credits via MusicBrainz ID (mbid:/artist|place|label/…) */
function creditLink(uri) {
  var m = /^mbid:\/(artist|place|label)\/([0-9a-f-]+)/i.exec(uri || '');
  return m ? {mode: 'story' + m[1].charAt(0).toUpperCase() + m[1].slice(1), mbid: m[2]} : null;
}

var creditCache = {};
function creditStory(name, link) {
  var k = link.mode + '|' + link.mbid;
  if (creditCache[k]) return creditCache[k];
  var p = link.mode === 'storyArtist'                          /* people: own sources too if needed (Last.fm, Wikipedia) */
    ? ask({mode: link.mode, mbid: link.mbid, artist: name})
    : askVolumio({mode: link.mode, mbid: link.mbid});
  creditCache[k] = p.then(function(res){
    if (!res || res.kind !== 'story' || !res.value) { delete creditCache[k]; return null; }
    var txt = new DOMParser().parseFromString(String(res.value), 'text/html').body.textContent.trim();   /* Volumio sometimes delivers HTML */
    return txt || null;
  });
  return creditCache[k];
}

function toggleCredit(n, more, name, link) {
  var open = more.querySelector('.credit-info[data-name="' + CSS.escape(name) + '"]');
  if (open) { open.remove(); n.classList.remove('open'); return; }
  var box = document.createElement('div');
  box.className = 'credit-info'; box.setAttribute('data-name', name);
  var h = document.createElement('div');
  h.className = 'credit-info-name'; h.textContent = name;
  var t = document.createElement('div');
  t.textContent = '…';
  box.appendChild(h); box.appendChild(t);
  box.addEventListener('click', function(){ box.remove(); n.classList.remove('open'); });   /* a tap on the info closes it again */
  more.appendChild(box); n.classList.add('open');
  box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  creditStory(name, link).then(function(txt){
    t.textContent = txt || T('info.noContent');
    if (box.isConnected) box.scrollIntoView({behavior: 'smooth', block: 'nearest'});
  });
}

/* Swipe between the info tabs. Scrolling through long texts must never flip the tab, so:
   the direction is decided once after the first few pixels and then kept for the whole gesture;
   only a clearly sideways gesture (twice as wide as high, long enough) counts, and once the
   text has scrolled vertically the gesture is a scroll, not a swipe. Touches inside a row that
   scrolls sideways itself (cover rows) are left to that row. */
var infoSwipe = null;
function infoInSideScroller(el) {
  for (; el && el !== infoOverlayBody; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 2) {
      var ox = getComputedStyle(el).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
  }
  return false;
}
infoOverlayBody.addEventListener('touchstart', function(e){
  if (e.touches.length !== 1 || infoInSideScroller(e.target)) { infoSwipe = null; return; }
  var t = e.touches[0];
  infoSwipe = { x: t.clientX, y: t.clientY, top: infoOverlayBody.scrollTop, dir: null };
}, {passive:true});
infoOverlayBody.addEventListener('touchmove', function(e){
  if (!infoSwipe) return;
  if (e.touches.length !== 1) { infoSwipe = null; return; }
  if (infoSwipe.dir) return;                                         /* direction already locked */
  var t = e.touches[0];
  var dx = Math.abs(t.clientX - infoSwipe.x), dy = Math.abs(t.clientY - infoSwipe.y);
  if (dx < 10 && dy < 10) return;                                    /* too little movement to tell yet */
  infoSwipe.dir = dx > dy * 2 ? 'h' : 'v';
  if (infoSwipe.dir === 'v') infoSwipe = null;                       /* a scroll: ignore the rest */
}, {passive:true});
infoOverlayBody.addEventListener('touchcancel', function(){ infoSwipe = null; }, {passive:true});
infoOverlayBody.addEventListener('touchend', function(e){
  var s = infoSwipe; infoSwipe = null;
  if (!s || s.dir !== 'h') return;
  if (Math.abs(infoOverlayBody.scrollTop - s.top) > 5) return;       /* the text scrolled meanwhile */
  var t = e.changedTouches[0];
  var dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;  /* not long or not sideways enough */
  var dir = dx < 0 ? 1 : -1;
  var next = infoIdx + dir;
  if (next < 0 || next >= infoItems.length) return;
  infoIdx = next; buildInfoTabs(); renderInfo(dir);
}, {passive:true});

