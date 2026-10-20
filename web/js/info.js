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
  } else {
    lyricsText.textContent = data.value;
  }
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
  } else {
    img.src = tinyart(it.title);
    img.className = 'infoImg artist';
  }
  img.onerror = function(){ this.style.display='none'; };
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

var infoSwipeX = null;
infoOverlayBody.addEventListener('touchstart', function(e){
  infoSwipeX = e.changedTouches[0].clientX;
}, {passive:true});
infoOverlayBody.addEventListener('touchend', function(e){
  if (infoSwipeX === null) return;
  var dx = e.changedTouches[0].clientX - infoSwipeX;
  infoSwipeX = null;
  if (Math.abs(dx) < 50) return;
  var dir = dx < 0 ? 1 : -1;
  var next = infoIdx + dir;
  if (next < 0 || next >= infoItems.length) return;
  infoIdx = next; buildInfoTabs(); renderInfo(dir);
}, {passive:true});

