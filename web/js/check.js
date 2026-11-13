/* Library check: problem cases in the collection (tag service GET/POST /check), each entry with a pen to the matching editor.
   Classic script, shared global scope; loaded after tagedit.js. */
var overlayCheck = document.getElementById('overlayCheck');
var checkBody    = document.getElementById('checkBody');
var checkTimer   = null;
var checkOpen    = {};          /* expanded categories stay open on redraw */
var checkUpTo    = {};          /* entries shown per category after "show more": a redraw (e.g. after Keep) shows as many again */
var CHECK_PAGE   = 100;         /* this many entries per category, then "show more" */
var checkDone    = {};          /* edited entries (tag service remembers them until the next check) */
var checkDoneAt  = 0;           /* which check run checkDone belongs to */

var CHECK_CATS = [
  {key: 'noCover', name: T('check.cat.noCover'), hint: T('check.cat.noCoverHint')},
  {key: 'albumArtist', name: T('check.cat.albumArtist'), hint: T('check.cat.albumArtistHint')},
  {key: 'artistFix', name: T('check.cat.artistFix'), hint: T('check.cat.artistFixHint')},
  {key: 'spelling', name: T('check.cat.spelling'), hint: T('check.cat.spellingHint')},
  {key: 'duplicates', name: T('check.cat.duplicates'), hint: T('check.cat.duplicatesHint')},
  {key: 'splitAlbums', name: T('check.cat.splitAlbums'), hint: T('check.cat.splitAlbumsHint')},
  {key: 'dupTracks', name: T('check.cat.dupTracks'), hint: T('check.cat.dupTracksHint')},
  {key: 'mixedQuality', name: T('check.cat.mixedQuality'), hint: T('check.cat.mixedQualityHint')},
  {key: 'albumName', name: T('check.cat.albumName'), hint: T('check.cat.albumNameHint')},
  {key: 'year', name: T('check.cat.year'), hint: T('check.cat.yearHint')},
  {key: 'noTrack', name: T('check.cat.noTrack'), hint: T('check.cat.noTrackHint')},
  {key: 'noTags', name: T('check.cat.noTags'), hint: T('check.cat.noTagsHint')},
  {key: 'hiddenKeys', name: T('check.cat.hiddenKeys'), hint: T('check.cat.hiddenKeysHint')},
  {key: 'tagText', name: T('check.cat.tagText'), hint: T('check.cat.tagTextHint')},
  {key: 'dsfTags', name: T('check.cat.dsfTags'), hint: T('check.cat.dsfTagsHint')},
  {key: 'coverQuality', name: T('check.cat.coverQuality'), hint: T('check.cat.coverQualityHint')},
  {key: 'folderName', name: T('check.cat.folderName'), hint: T('check.cat.folderNameHint')},
  {key: 'gaps', name: T('check.cat.gaps'), hint: T('check.cat.gapsHint')},
  {key: 'genreMissing', name: T('check.cat.genreMissing'), hint: T('check.cat.genreMissingHint')},
  {key: 'genreMerge', name: T('check.cat.genreMerge'), hint: T('check.cat.genreMergeHint')},
  {key: 'genreConflict', name: T('check.cat.genreConflict'), hint: T('check.cat.genreConflictHint')}
];
var CHECK_KEEPABLE = {genreConflict: 1, genreMerge: 1, genreMissing: 1, duplicates: 1, splitAlbums: 1, year: 1, albumName: 1, spelling: 1, mixedQuality: 1,
                      coverQuality: 1, folderName: 1, tagText: 1, hiddenKeys: 1};   /* categories with "Keep" */
var checkGenreOk = {};                                   /* genre suggestions marked "keep" (tag service genre-ok.json), see checkKeepOf */
var CHECK_CHEVRON = '<svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>';

function checkFmtDate(ms) {
  var d = new Date(ms);
  function two(n) { return (n < 10 ? '0' : '') + n; }
  return T('check.dateTime', {date: langDate(d), time: two(d.getHours()) + ':' + two(d.getMinutes())});
}
function checkNum(n) { return langNum(n); }

/* While the check is open, the tag service holds back MPD scans (editing many albums in a row would otherwise
   mean many scans, each with a minute of load); on close everything is scanned at once. */
var checkHeld = false;
function checkHold() {
  checkHeld = true;
  tagPost('/scan', {hold: true}).catch(function(){});
}
function checkRelease() {
  if (!checkHeld) return;
  checkHeld = false;
  tagPost('/scan', {hold: false}).catch(function(){});
}
window.addEventListener('pagehide', function(){
  if (checkHeld && navigator.sendBeacon) navigator.sendBeacon(TAGS + '/scan', JSON.stringify({hold: false}));
});

function openCheck() {
  closeAllOverlays();
  overlayCheck.classList.add('on');
  checkHold();
  while (checkBody.firstChild) checkBody.removeChild(checkBody.firstChild);
  checkBody.appendChild(browseNote(T('check.loading')));
  checkLoad();
}

var checkShown = null;          /* {at, info, res}: last drawn result; while checking, only rewrite the progress */
function checkLoad() {
  clearTimeout(checkTimer);
  var have = checkShown && checkShown.info.isConnected && checkShown.at ? '?have=' + encodeURIComponent(checkShown.at) +
    (checkShown.res && checkShown.res.fixStamp ? '&fix=' + encodeURIComponent(checkShown.res.fixStamp) : '') : '';
  Promise.all([tagGetJson('/check' + have), tagGetJson('/moodtags').catch(function(){ return null; })]).then(function(both){
    var res = both[0];
    if (!overlayCheck.classList.contains('on')) return;
    checkMood = both[1];
    if (res.result === 'same' && checkShown && checkShown.running && res.running) {
      checkShown.info.textContent = checkRunText(res.running) + (res.error ? T('check.errorSuffix', {error: res.error}) : '');
    } else {
      if (res.result === 'same') res.result = checkShown ? checkShown.res.result : null;
      if (res.fix === 'same' && checkShown) {                /* suggestion lists unchanged: keep the ones shown */
        ['genreOk', 'artistFix', 'yearFix', 'nameFix'].forEach(function(k){ res[k] = checkShown.res[k]; });
      }
      checkRender(res);
    }
    var mt = checkMood && checkMood.enabled && checkMood.status;
    if (res.running) checkTimer = setTimeout(checkLoad, 2000);
    else if (mt && mt.state === 'läuft') checkTimer = setTimeout(checkLoad, 10000);
  }).catch(function(){
    while (checkBody.firstChild) checkBody.removeChild(checkBody.firstChild);
    checkBody.appendChild(browseNote(T('check.serviceDownPort', {port: (window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766})));
  });
}

function checkStart() {
  tagPost('/check', {}).then(checkLoad).catch(checkLoad);
}

function checkRunText(run) {
  return run.phase === 'mpd'
    ? (run.total ? T('check.runFolders', {done: checkNum(run.done), total: checkNum(run.total)}) : T('check.runFoldersNoTotal', {done: checkNum(run.done)}))
    : run.phase === 'files' ? T('check.runFiles', {done: checkNum(run.done), total: checkNum(run.total)})
    : run.phase === 'hidden' ? T('check.runHidden', {done: checkNum(run.done), total: checkNum(run.total)})
    : T('check.runCovers', {done: checkNum(run.done), total: checkNum(run.total)});
}
/* the first row on screen (category, its text, distance from the top): after a redraw the list is scrolled so that
   this row stands where it stood, even if rows above it are gone (Keep, Apply) or have another height */
function checkAnchor() {
  var top = checkBody.getBoundingClientRect().top, boxes = checkBody.querySelectorAll('.ckList');
  for (var i = 0; i < boxes.length; i++) {
    if (!boxes[i].firstChild || boxes[i].getBoundingClientRect().bottom <= top) continue;
    for (var c = boxes[i].firstElementChild; c; c = c.nextElementSibling) {
      var r = c.getBoundingClientRect();
      if (r.bottom > top && r.height) return {box: i, text: checkRowText(c), off: r.top - top};
    }
  }
  return null;
}
function checkRowText(el) { var t = el.querySelector('.sTitle'); return (t || el).textContent.slice(0, 300); }
function checkToAnchor(a) {
  var box = a && checkBody.querySelectorAll('.ckList')[a.box];
  for (var c = box && box.firstElementChild; c; c = c.nextElementSibling) {
    if (checkRowText(c) !== a.text) continue;
    checkBody.scrollTop += c.getBoundingClientRect().top - checkBody.getBoundingClientRect().top - a.off;
    return true;
  }
  return false;
}
function checkRender(res) {
  var keepScroll = checkBody.scrollTop, anchor = checkAnchor();
  while (checkBody.firstChild) checkBody.removeChild(checkBody.firstChild);
  var r = res.result, run = res.running;

  var head = document.createElement('div'); head.className = 'ckHead';
  var info = document.createElement('div'); info.className = 'ckInfo';
  checkShown = {at: r ? r.at : null, info: info, res: res, running: !!run};
  if (run) {
    info.textContent = checkRunText(run);
  } else if (r) {
    info.textContent = T('check.checkedAt', {date: checkFmtDate(r.at), songs: checkNum(r.songs), albums: checkNum(r.albums)});
  } else {
    info.textContent = T('check.never');
  }
  if (res.error) info.textContent += T('check.errorSuffix', {error: res.error});
  var btn = document.createElement('button'); btn.className = 'ckBtn';
  btn.textContent = run ? T('check.running') : (r ? T('check.recheck') : T('check.start'));
  btn.disabled = !!run;
  btn.addEventListener('click', function(){ btn.disabled = true; btn.textContent = T('check.running'); checkStart(); });
  head.appendChild(info); head.appendChild(btn);
  checkBody.appendChild(head);
  checkBody.appendChild(checkDbRow());
  if (!r) { checkMoodSection(); checkBody.scrollTop = keepScroll; return; }
  if (res.genreOk) checkGenreOk = res.genreOk;
  if (checkDoneAt !== r.at) { checkDone = {}; checkUpTo = {}; cbKnown = {}; checkDoneAt = r.at; }
  Object.keys(r.done || {}).forEach(function(k){ checkDone[k] = 1; });
  r.artistFix = res.artistFix || [];
  r.year = res.yearFix || [];                            /* with the MusicBrainz suggestion of the moment (tag service) */
  r.albumName = res.nameFix || [];
  var fixed = {};                                        /* names with a usual spelling: not again under "several spellings" */
  r.artistFix.forEach(function(g){ g.variants.forEach(function(v){ fixed[v.name] = 1; }); });

  CHECK_CATS.forEach(function(cat){
    var list = r[cat.key] || [];
    if (CHECK_KEEPABLE[cat.key]) list = list.filter(function(it){ return !checkIsKept(cat.key, it); });   /* kept ones at the end */
    if (cat.key === 'dupTracks') list = checkDupTracksOpen(list);
    if (cat.key === 'spelling') list = list.filter(function(g){ return !g.variants.some(function(v){ return fixed[v.name]; }); });
    var row = document.createElement('div'); row.className = 'ckCat' + (checkOpen[cat.key] ? ' open' : '');
    row.innerHTML = '<div class="ckName"></div><div class="ckNum"></div>' + CHECK_CHEVRON;
    row.querySelector('.ckName').textContent = cat.name;
    var num = row.querySelector('.ckNum');
    num.textContent = checkNum(list.length);
    if (!list.length) num.className += ' zero';
    var box = document.createElement('div'); box.className = 'ckList';
    row.addEventListener('click', function(){
      checkOpen[cat.key] = !checkOpen[cat.key];
      if (!checkOpen[cat.key]) delete checkUpTo[cat.key];  /* closed by hand: next time from the first page again */
      row.classList.toggle('open', checkOpen[cat.key]);
      if (checkOpen[cat.key] && !box.firstChild) checkFill(box, cat, list);
    });
    checkBody.appendChild(row); checkBody.appendChild(box);
    if (checkOpen[cat.key]) checkFill(box, cat, list);
  });
  checkMoodSection();
  checkBody.scrollTop = keepScroll;
  checkToAnchor(anchor);
}

/* Update the library (whole MPD database); changes already collected are included.
   Shared state for the button in the check and the row in the menu (menu.js): '' | running | done | failed */
var libUpd = {state: '', timer: null, watch: {}};
function libUpdSet(st) {
  libUpd.state = st;
  Object.keys(libUpd.watch).forEach(function(k){ libUpd.watch[k](st); });
}
function libUpdWatch(key, fn) { libUpd.watch[key] = fn; fn(libUpd.state); }
function libUpdText(st) {
  return st === 'running' ? T('check.db.running') : st === 'done' ? T('check.db.done') : st === 'failed' ? T('check.db.failed') : T('check.db.hint');
}
function libUpdStart() {
  if (libUpd.state === 'running' || !confirm(T('check.db.confirm'))) return;
  libUpdSet('running');
  tagPost('/scan', {all: true}).then(function(r){
    if (!r || !r.ok) throw new Error();
    libUpdPoll();
    scanBusyShow('updating'); scanBusyPoll(5000);
  }).catch(function(){ libUpdSet('failed'); });
}
function libUpdPoll() {
  clearTimeout(libUpd.timer);
  libUpd.timer = setTimeout(function(){
    tagGetJson('/scan').then(function(r){
      if (r && r.ok && r.updating) return libUpdPoll();
      if (r && r.ok && r.building) { libUpdSet('done'); return libUpdPoll(); }   /* read in, album list still being built */
      libUpdSet(r && r.ok ? '' : 'failed');                                     /* all done: back to the normal hint */
    }).catch(libUpdPoll);
  }, 3000);
}
/* Symbol in the top bar while the library is read in or the album list rebuilt (GET /scan): explains a slow player.
   Asks every 15 s while the page is visible, every 5 s while the symbol shows; a tap shows what is going on */
var scanBusy = {el: document.getElementById('scanBusy'), timer: null, asking: false, state: ''};
function scanBusyShow(st) {
  scanBusy.state = st;
  if (!scanBusy.el) return;
  scanBusy.el.style.display = st ? '' : 'none';
  scanBusy.el.title = st ? T('scan.' + st) : '';
}
function scanBusyPoll(ms) {
  clearTimeout(scanBusy.timer);
  if (document.hidden || !scanBusy.el) return;
  scanBusy.timer = setTimeout(function(){
    if (scanBusy.asking) return;
    scanBusy.asking = true;
    tagGetJson('/scan').then(function(r){
      scanBusyShow(r && r.ok && r.updating ? 'updating' : r && r.ok && r.building ? 'building' : '');
    }).catch(function(){ scanBusyShow(''); }).then(function(){
      scanBusy.asking = false;
      scanBusyPoll(scanBusy.state ? 5000 : 15000);
    });
  }, ms);
}
if (scanBusy.el) {
  scanBusy.el.addEventListener('click', function(){ if (scanBusy.state) showToast(T('scan.' + scanBusy.state)); });
  whenTags(function(){ scanBusyPoll(0); });
  document.addEventListener('visibilitychange', function(){ if (!document.hidden && tagsHealth) scanBusyPoll(0); });
}

function checkDbRow() {
  var head = document.createElement('div'); head.className = 'ckHead';
  var info = document.createElement('div'); info.className = 'ckInfo';
  var btn = document.createElement('button'); btn.className = 'ckBtn';
  btn.textContent = T('check.db.button');
  btn.addEventListener('click', libUpdStart);
  head.appendChild(info); head.appendChild(btn);
  libUpdWatch('check', function(st){ info.textContent = libUpdText(st); btn.disabled = st === 'running'; });
  return head;
}

/* ---------- Mood tags (tag service GET /moodtags) ---------- */
var checkMood = null;
var MOOD_NAMES = {};            /* English id -> name in the UI language (lowercase); also used by moodmix.js */
['aggressive', 'atmospheric', 'calm', 'dark', 'dreamy', 'emotional', 'epic', 'happy', 'intense', 'melancholic',
 'reflective', 'relaxed', 'romantic', 'sad', 'sensual', 'uplifting'].forEach(function(id){ MOOD_NAMES[id] = T('mood.' + id); });
/* keys are the (German) state ids of the tag service */
var MOOD_STATES = {'läuft': T('check.mood.state.running'), wartet: T('check.mood.state.waiting'), fertig: T('check.mood.state.done'),
  leer: T('check.mood.state.empty'), fehler: T('check.mood.state.error'), aus: T('check.mood.state.off')};

function checkMoodSection() {
  var m = checkMood;
  if (!m || !m.ok) return;
  var st = m.status, sum = m.summary, key = 'moodtags';
  var row = document.createElement('div'); row.className = 'ckCat ckMoodCat' + (checkOpen[key] ? ' open' : '');
  row.innerHTML = '<div class="ckName"></div><div class="ckNum"></div>' + CHECK_CHEVRON;
  row.querySelector('.ckName').textContent = m.audio && m.audio.tracks ? T('check.mood.titleAudio') : T('check.mood.title');
  row.querySelector('.ckNum').textContent = !m.enabled ? T('check.mood.off') : st.total ? Math.floor(st.done * 100 / st.total) + ' %' : '–';
  var box = document.createElement('div'); box.className = 'ckList ckMood';
  row.addEventListener('click', function(){ checkOpen[key] = !checkOpen[key]; row.classList.toggle('open', checkOpen[key]); });

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; box.appendChild(e); return e; }
  el('div', 'ckCatHint', T('check.mood.hint'));
  var line = !m.enabled ? T('check.mood.disabled')
    : T('check.mood.progress', {done: checkNum(st.done), total: checkNum(st.total)}) + ' ' + (MOOD_STATES[st.state] || '');
  if (st.error) line += ' ' + st.error;
  el('div', 'ckMoodLine', line);
  if (st.total) { var bar = el('div', 'ckMoodBar'); var fill = document.createElement('div'); fill.style.width = (st.done * 100 / st.total) + '%'; bar.appendChild(fill); }
  if (m.audio) {
    el('div', 'ckMoodLine', m.audio.tracks
      ? T('check.mood.audio', {done: checkNum(sum.audio || 0), total: checkNum(st.total), date: langDate(m.audio.at)})
      : T('check.mood.audioNone'));
  }

  var rated = sum.track + sum.artist + (sum.audioOnly || 0);
  if (rated) {
    el('div', 'ckMoodLine', T('check.mood.rated', {rated: checkNum(rated), artist: checkNum(sum.artist), none: checkNum(sum.none)}));
    el('div', 'ckMoodHead', T('check.mood.headMood'));
    var chips = el('div', 'ckChips');
    Object.keys(sum.moods).sort(function(a, b){ return sum.moods[b] - sum.moods[a]; }).forEach(function(k){
      var c = document.createElement('span'); c.className = 'ckChip';
      c.textContent = (MOOD_NAMES[k] || k) + ' ' + checkNum(sum.moods[k]);
      chips.appendChild(c);
    });
    el('div', 'ckMoodHead', T('check.mood.headEnergy'));
    var max = Math.max.apply(null, sum.energy) || 1, bars = el('div', 'ckEnergy');
    sum.energy.forEach(function(n, i){
      var col = document.createElement('div'); col.className = 'ckEnCol';
      col.innerHTML = '<div class="ckEnN"></div><div class="ckEnBar"><div></div></div><div class="ckEnL"></div>';
      col.querySelector('.ckEnN').textContent = checkNum(n);
      col.querySelector('.ckEnBar div').style.height = (n * 100 / max) + '%';
      col.querySelector('.ckEnL').textContent = String(i + 1);
      bars.appendChild(col);
    });
    var styles = Object.keys(sum.styles).sort(function(a, b){ return sum.styles[b] - sum.styles[a]; }).slice(0, 15);
    if (styles.length) {
      el('div', 'ckMoodHead', T('check.mood.headStyles'));
      var sc = el('div', 'ckChips');
      styles.forEach(function(k){ var c = document.createElement('span'); c.className = 'ckChip'; c.textContent = k + ' ' + checkNum(sum.styles[k]); sc.appendChild(c); });
    }
  }
  checkBody.appendChild(row); checkBody.appendChild(box);
}

function checkFill(box, cat, list) {
  var hint = document.createElement('div'); hint.className = 'ckCatHint'; hint.textContent = list.length ? cat.hint : T('check.nothingFound');
  box.appendChild(hint);
  var shown = 0;
  function more(upTo) {
    var end = Math.min(list.length, typeof upTo === 'number' ? Math.max(upTo, CHECK_PAGE) : shown + CHECK_PAGE);
    for (; shown < end; shown++) {
      if (cat.key === 'genreMerge') box.insertBefore(checkGenreGroupRow(cat.key, list[shown]), moreRow);
      else if (cat.key === 'genreConflict') box.insertBefore(checkConflictRow(list[shown], false), moreRow);
      else if (cat.key === 'year' || cat.key === 'albumName') box.insertBefore(checkFixRow(cat.key, list[shown], false), moreRow);
      else if (cat.key === 'tagText') box.insertBefore(checkTagTextRow(list[shown], false), moreRow);
      else if (cat.key === 'hiddenKeys') box.insertBefore(checkHiddenRow(list[shown], false), moreRow);
      else if (cat.key === 'artistFix') box.insertBefore(checkArtistFixRow(list[shown]), moreRow);
      else if (cat.key === 'spelling') box.insertBefore(checkSpellingRow(list[shown], false), moreRow);
      else if (cat.key === 'mixedQuality') checkQualityRows(list[shown], false).forEach(function(el){ box.insertBefore(el, moreRow); });
      else if (cat.key === 'duplicates') checkDupRows(list[shown]).forEach(function(el){ box.insertBefore(el, moreRow); });
      else if (cat.key === 'splitAlbums') checkSplitRows(list[shown]).forEach(function(el){ box.insertBefore(el, moreRow); });
      else if (cat.key === 'dupTracks') checkDupTrackRows(list[shown]).forEach(function(el){ box.insertBefore(el, moreRow); });
      else if (CHECK_SIMPLE[cat.key]) box.insertBefore(checkSimpleRow(cat.key, list[shown], false), moreRow);
      else box.insertBefore(checkAlbumRow(cat.key, list[shown]), moreRow);
    }
    if (shown > CHECK_PAGE) checkUpTo[cat.key] = shown;
    moreRow.style.display = shown < list.length ? '' : 'none';
    moreRow.textContent = T('check.more', {k: checkNum(Math.min(CHECK_PAGE, list.length - shown)), left: checkNum(list.length - shown)});
  }
  if (cat.key === 'duplicates' && list.length) checkDupTrash(box);
  if (cat.key === 'artistFix') checkArtistStatus(box);
  var moreRow = document.createElement('div'); moreRow.className = 'ckMore';
  moreRow.addEventListener('click', function(){ more(); });
  box.appendChild(moreRow);
  more(checkUpTo[cat.key] || CHECK_PAGE);
  if (CHECK_KEEPABLE[cat.key]) checkKeptSection(box, cat.key);
}

/* ---------- Genre suggestions with buttons: "Apply" writes the suggestion, "Keep" leaves the tag for good ---------- */
/* Kept entries (tag service genre-ok.json, {key: value}): contradiction per album {folder: genre tag}, merging per change
   {"merge|<previous>|<genre>": genre}; they count as long as the album keeps the tag, and are listed folded at the end */
function checkKeepOf(cat, it) {
  if (cat === 'genreMerge') return {k: 'merge|' + it.from + '|' + it.genre, v: it.genre};
  if (cat === 'genreMissing') return {k: 'missing|' + it.dir, v: ''};            /* stays without a genre */
  if (cat === 'duplicates') return {k: 'dupk|' + checkDupDirs(it), v: ''};      /* all versions stay; a new version shows it again */
  if (cat === 'splitAlbums') return {k: 'split|' + checkDupDirs(it), v: ''};    /* folders stay apart; another folder shows it again */
  if (cat === 'year') return {k: 'year|' + it.dir, v: checkValuesKey(it.years)};  /* as long as the album keeps these years */
  if (cat === 'albumName') return {k: 'albumname|' + it.dir, v: checkValuesKey(it.names)};
  if (cat === 'mixedQuality') return {k: 'quality|' + it.dir, v: checkValuesKey(it.formats)};   /* as long as the formats stay */
  if (cat === 'coverQuality') return {k: 'cover|' + it.dir, v: it.image + ':' + it.why};   /* until the image changes */
  if (cat === 'folderName') return {k: 'folder|' + it.dir, v: it.folder};
  if (cat === 'tagText') return {k: 'tagtext|' + it.dir, v: checkTagTextKey(it)};   /* as long as these values stay */
  if (cat === 'hiddenKeys') return {k: 'hidden|' + it.dir, v: checkHiddenKey(it)};
  if (cat === 'spelling') return {k: 'spell|' + (it.key || checkValuesKey(it.variants)), v: checkValuesKey(it.variants)};   /* as long as these spellings stay */
  return {k: it.dir, v: it.tag};
}
function checkIsKept(cat, it) {
  var o = checkKeepOf(cat, it);
  return Object.prototype.hasOwnProperty.call(checkGenreOk, o.k) && checkGenreOk[o.k] === o.v;
}

/* "Rock → Electronic (80 % by audio) · Trip Hop, Downtempo"; pen: editor with the genre filled in */
function checkConflictRow(it, kept) {
  var sub = T('check.conflict.sub', {tag: it.tag, genre: it.genre, p: Math.round(it.share * 100), q: Math.round(it.tagShare * 100), top: it.tagTop}) +
            (it.subs && it.subs.length ? ' · ' + it.subs.join(', ') : '');
  var row = checkRow('genreConflict|' + it.dir, it.name + (it.artist ? ' · ' + it.artist : ''), sub, function(){
    openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name, {field: 'genre', value: it.genre});
  });
  checkGenreButtons(row, 'genreConflict', 'genreConflict|' + it.dir, it, it.files, kept);
  return row;
}

/* buttons before the pen: "Apply" (then "Undo") and "Keep"; kept entries: "Check again" */
function checkGenreButtons(row, cat, doneKey, it, files, kept) {
  var box = document.createElement('div');
  box.className = 'ckGenreBtns';
  function btn(label, hint, fn) {
    var b = document.createElement('button');
    b.className = 'ckBtn ckOkBtn';
    b.textContent = label; b.title = hint;
    b.addEventListener('click', function(ev){ ev.stopPropagation(); b.disabled = true; fn(b); });
    box.appendChild(b);
    return b;
  }
  function keep(on, b) {
    var o = checkKeepOf(cat, it);
    tagPost('/genreok', {dir: o.k, tag: o.v, ok: on}).then(function(r){
      if (!r || !r.ok) throw new Error((r && r.error) || 'genreok');
      if (on) checkGenreOk[o.k] = o.v; else delete checkGenreOk[o.k];
      if (checkShown && checkShown.res) checkRender(checkShown.res);
    }).catch(function(){ b.disabled = false; showToast(T('check.conflict.failed')); });
  }
  if (kept) btn(T('check.conflict.undoKeep'), T('check.conflict.undoKeepHint'), function(b){ keep(false, b); });
  else {
    var fix = cat === 'year' || cat === 'albumName' || cat === 'spelling' || cat === 'tagText' || cat === 'hiddenKeys';
    var run = function(b, to){                               /* write the suggestion (or the chosen spelling) -> batch */
      if (cat === 'spelling') return checkApplyArtist({variants: it.variants, to: to}, b);
      return fix ? checkApplyItems(checkFixItems(cat, it), b) : checkApplyGenre(files, it.genre, b);
    };
    var apply = function(label, hint, to){ btn(label, hint, function(b){
      run(b, to).then(function(batch){
        row.classList.add('done'); checkMarkDone(doneKey);
        while (box.firstChild) box.removeChild(box.firstChild);
        if (batch) btn(T('check.conflict.undoApply'), T('check.conflict.undoApplyHint'), function(u){
          tagPost('/undo', {batch: batch}).then(function(r){
            if (!r || !r.ok) throw new Error((r && r.error) || 'undo');
            row.classList.remove('done');
            u.textContent = T('check.conflict.undone');
            showToast(T('check.conflict.undone'));
          }).catch(function(e){ u.disabled = false; showToast(T('tag.error', {error: e.message})); });
        });
      }).catch(function(){ b.disabled = false; b.textContent = label; });
    }); };
    if (cat === 'hiddenKeys') apply(T('check.conflict.apply'), T('check.hidden.applyHint', {n: checkNum(it.fixes.length)}));
    else if (cat === 'tagText') { if (it.fixes.length) apply(T('check.conflict.apply'), T('check.tagText.applyHint', {n: checkNum(it.fixes.length)})); }
    else if (fix ? it.suggest : it.genre) apply(T('check.conflict.apply'), fix ? T('check.fix.applyHint', {value: it.suggest}) : T('check.conflict.applyHint', {genre: it.genre}), it.suggest);
    if (cat === 'spelling') checkSpellingOthers(it).forEach(function(to){       /* another spelling instead of the suggestion */
      apply(T('check.spelling.use', {name: to}), T('check.fix.applyHint', {value: to}), to);
    });
    btn(T('check.conflict.keep'), T(cat === 'genreMissing' ? 'check.conflict.keepNoneHint' : cat === 'mixedQuality' ? 'check.quality.keepHint' : CHECK_SIMPLE[cat] ? 'check.simple.keepHint'
        : fix ? 'check.fix.keepHint' : 'check.conflict.keepHint'), function(b){ keep(true, b); });
  }
  row.classList.add('ckGenreRow');
  checkBtnBox(row, box);
}
/* buttons right of the text, left of the pen (like the duplicate tracks), on the phone too */
function checkBtnBox(row, box) {
  var pen = row.lastChild && /\btagEditMini\b/.test(row.lastChild.className) ? row.lastChild : null;
  row.insertBefore(box, pen);
}

/* write the genre into all files of the entry, in chunks with one undo ID; the scan follows when the check is closed */
function checkApplyGenre(files, genre, b) {
  return checkApplyItems(files.map(function(f){ return {uri: f.uri, tags: {genre: genre}}; }), b);
}
/* items [{uri, tags}]: written in chunks with one undo ID -> batch or null (nothing changed) */
function checkApplyItems(items, b) {
  var batch = Date.now().toString(36), changed = [], errs = [];
  b.textContent = T('tag.saving');
  tagWriting++;
  return tagInChunks(items, TAG_WRITE_CHUNK, function(part){
    return tagPostRetry('/write', {items: part, batch: batch, scan: false})
      .then(function(res){
        if (!res.ok) throw new Error(res.error || T('tag.writeFailed'));
        res.items.forEach(function(r, k){ if (!r.ok) errs.push(r.error); else if (r.changed || res.retried) changed.push(part[k].uri); });
      });
  }).then(function(){
    if (changed.length) tagPost('/scan', {uris: changed}).catch(function(){});
    showToast(T('tag.filesChanged', {n: changed.length}) + (errs.length ? T('tag.errSuffix', {n: errs.length, error: errs[0]}) : ''));
    return changed.length ? batch : null;
  }).catch(function(e){
    showToast(T('tag.error', {error: e.message}) + (changed.length ? T('tag.alreadyChanged', {n: changed.length}) : ''));
    b.textContent = T('check.conflict.apply');
    throw e;
  }).then(function(r){ tagWriting--; return r; }, function(e){ tagWriting--; throw e; });
}

/* at the end of the list: the kept ones, folded */
var checkOkOpen = {};
function checkKeptSection(box, cat) {
  var all = (checkShown && checkShown.res && checkShown.res.result && checkShown.res.result[cat]) || [];
  var kept = all.filter(function(it){ return checkIsKept(cat, it); });
  if (!kept.length) return;
  var head = document.createElement('div');
  head.className = 'ckOkHead' + (checkOkOpen[cat] ? ' open' : '');
  head.innerHTML = '<span></span>' + CHECK_CHEVRON;
  head.firstChild.textContent = T('check.conflict.okList', {n: checkNum(kept.length)});
  var list = document.createElement('div');
  list.className = 'ckOkList';
  list.style.display = checkOkOpen[cat] ? '' : 'none';
  kept.forEach(function(it){
    if (cat === 'duplicates') return checkDupRows(it, true).forEach(function(el){ list.appendChild(el); });
    if (cat === 'splitAlbums') return checkSplitRows(it, true).forEach(function(el){ list.appendChild(el); });
    if (cat === 'year' || cat === 'albumName') return list.appendChild(checkFixRow(cat, it, true));
    if (cat === 'spelling') return list.appendChild(checkSpellingRow(it, true));
    if (cat === 'tagText') return list.appendChild(checkTagTextRow(it, true));
    if (cat === 'hiddenKeys') return list.appendChild(checkHiddenRow(it, true));
    if (cat === 'mixedQuality') return checkQualityRows(it, true).forEach(function(el){ list.appendChild(el); });
    if (CHECK_SIMPLE[cat]) return list.appendChild(checkSimpleRow(cat, it, true));
    list.appendChild(cat === 'genreMerge' ? checkGenreGroupRow(cat, it, true) : cat === 'genreMissing' ? checkGenreAlbumRow(cat, it, true) : checkConflictRow(it, true));
  });
  head.addEventListener('click', function(){
    checkOkOpen[cat] = !checkOkOpen[cat];
    head.classList.toggle('open', checkOkOpen[cat]);
    list.style.display = checkOkOpen[cat] ? '' : 'none';
  });
  box.appendChild(head); box.appendChild(list);
}

/* Edited entries stay greyed out, even after closing, until the next check */
function checkMarkDone(key) {
  if (checkDone[key]) return;
  checkDone[key] = 1;
  tagPost('/checkdone', {key: key}).catch(function(){});
}

function checkRow(key, title, sub, onEdit) {
  var row = document.createElement('div'); row.className = 'sRow' + (checkDone[key] ? ' done' : '');
  var meta = document.createElement('div'); meta.className = 'sMeta';
  var ti = document.createElement('div'); ti.className = 'sTitle'; ti.textContent = title;
  var su = document.createElement('div'); su.className = 'sSub'; su.textContent = sub;
  meta.appendChild(ti); meta.appendChild(su);
  row.appendChild(meta);
  row.appendChild(tagPenButton('tagEditMini', T('check.edit'), function(){ row.classList.add('done'); checkMarkDone(key); onEdit(); }));
  return row;
}

function checkAlbumRow(key, it) {
  var heading = it.name + (it.artist ? ' · ' + it.artist : '');
  var sub = it.dir;
  if (key === 'albumArtist') sub = (it.missing ? T('check.albumArtistMissing') : T('check.albumArtistIs', {names: it.albumartists.join(' / ')})) + ' · ' + it.artists.join(', ') + (it.artists.length > 5 ? ' …' : '');
  else if (key === 'noTrack') sub = T('check.noTrackSub', {missing: checkNum(it.missing), count: checkNum(it.count), dir: it.dir});
  else if (key === 'noTags') sub = checkNoTagsText(it) + ' · ' + it.dir;
  else if (key === 'gaps') sub = [it.disc ? T('check.gapsDisc', {disc: it.disc}) : '', it.nums ? T('check.gapsMissing', {nums: it.nums}) : '',
                                  it.dir].filter(Boolean).join(' · ');
  if (key === 'genreMissing') return checkGenreAlbumRow(key, it);
  return checkRow(key + '|' + it.dir + (it.disc ? '|' + it.disc : ''), heading, sub, function(){
    if (key === 'albumArtist') openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name);
    else openTagEditor(it.files, it.name, {move: true});
  });
}

/* ---------- DSF tags too large, cover image too small or too large, folder name does not fit the album ---------- */
/* pen: album editor (cover section: "Remove images", choose or search an image); folder name: also the file manager
   with the folder on the left and its parent on the right; cover and folder name can be kept */
var CHECK_SIMPLE = {dsfTags: 1, coverQuality: 1, folderName: 1};
function checkMB(bytes) { return langNum(Math.round(bytes / 104857.6) / 10); }
function checkSimpleRow(cat, it, kept) {
  var sub;
  if (cat === 'dsfTags') sub = T('check.dsf.sub', {n: checkNum(it.big), count: checkNum(it.count), mb: checkMB(it.bytes)});
  else if (cat === 'coverQuality') sub = it.why === 'small' ? T('check.coverq.small', {name: it.image, w: checkNum(it.w), h: checkNum(it.h)})
                                                            : T('check.coverq.big', {name: it.image, mb: checkMB(it.bytes)});
  else sub = it.why === 'unknown' ? T('check.folder.unknown', {folder: it.folder}) : T('check.folder.differs', {folder: it.folder, album: it.name});
  var key = cat + '|' + it.dir;
  var row = checkRow(key, it.name + (it.artist ? ' · ' + it.artist : ''), sub + ' · /mnt/' + it.dir, function(){
    openTagEditor(it.files, it.name, {move: true});
  });
  if (kept) row.removeChild(row.lastChild);                 /* kept: only "no longer keep" */
  if (cat === 'folderName' && !kept) {
    var fm = document.createElement('button'); fm.className = 'ckBtn'; fm.textContent = T('tag.fileManager');
    fm.title = T('tag.fileManagerHint');
    fm.addEventListener('click', function(ev){
      ev.stopPropagation();
      row.classList.add('done'); checkMarkDone(key);
      clearTimeout(checkTimer);
      openFiles(it.dir, it.dir.slice(0, it.dir.lastIndexOf('/')), openCheck);
    });
    row.insertBefore(fm, row.lastChild);
  }
  if (CHECK_KEEPABLE[cat]) checkGenreButtons(row, cat, key, it, it.files, kept);
  if (cat === 'coverQuality' && it.why === 'small' && !kept) checkCoverBest(row, it, key);   /* "Apply" goes in front of "Keep" */
  var bx = row.querySelector('.ckGenreBtns');
  if (fm && bx) bx.insertBefore(fm, bx.firstChild);       /* file manager with the other buttons */
  return row;
}

/* ---------- Cover too small: a larger one found online (tag service coverbest.js), "Apply" saves it ---------- */
/* Rows ask once they are on screen; the tag service searches one album after another, the list asks again every few
   seconds while any visible row still waits. Apply: into all files of the folder and as folder.jpg (replaced), with Undo */
var CB_ASK_MS = 4000;
var cbRows = [], cbTimer = null, cbObs = null;
var cbKnown = {};               /* dir -> answer already shown (found / none): a redrawn row shows it at once, without asking again */
function checkCoverBest(row, it, key) {
  var box = document.createElement('div'); box.className = 'ckCb';
  var cur = document.createElement('img'); cur.className = 'ckCbImg'; cur.alt = '';
  cur.src = TAGS + '/coverbestimage?which=cur&dir=' + encodeURIComponent(it.dir);
  cur.onerror = function(){ cur.style.display = 'none'; arrow.style.display = 'none'; };
  var arrow = document.createElement('span'); arrow.className = 'ckCbArrow'; arrow.textContent = '→';
  var neu = document.createElement('img'); neu.className = 'ckCbImg'; neu.alt = '';
  var txt = document.createElement('span'); txt.className = 'ckCbText'; txt.textContent = T('check.coverq.searching');
  box.appendChild(cur); box.appendChild(arrow); box.appendChild(neu); box.appendChild(txt);
  arrow.style.display = neu.style.display = 'none';
  row.querySelector('.sMeta').appendChild(box);
  var e = {row: row, it: it, key: key, seen: !window.IntersectionObserver, done: false, show: show};
  if (cbKnown[it.dir]) { show(cbKnown[it.dir]); return; }
  cbRows.push(e);
  if (window.IntersectionObserver) {
    if (!cbObs) cbObs = new IntersectionObserver(function(list){
      list.forEach(function(x){ cbRows.forEach(function(r){ if (r.row === x.target) r.seen = x.isIntersecting; }); });
      checkCoverBestAsk();
    });
    cbObs.observe(row);
  } else checkCoverBestAsk();

  /* in front of "Keep" (checkGenreButtons), in one line with it */
  function btn(label, hint, fn, instead) {
    var b = document.createElement('button'); b.className = 'ckBtn ckOkBtn';
    b.textContent = label; b.title = hint;
    b.addEventListener('click', function(ev){ ev.stopPropagation(); b.disabled = true; fn(b); });
    var boxes = row.querySelectorAll('.ckGenreBtns'), at = boxes[boxes.length - 1];
    if (instead) instead.parentNode.replaceChild(b, instead);
    else if (at) at.insertBefore(b, at.firstChild);
    else { at = document.createElement('div'); at.className = 'ckGenreBtns'; at.appendChild(b); checkBtnBox(row, at); }
    return b;
  }
  function show(st) {
    if (st.state === 'wait' || e.done) return;            /* two answers overlapping: only the first one adds "Apply" */
    e.done = true; cbKnown[it.dir] = st;
    if (st.state !== 'found') { txt.textContent = T('check.coverq.none'); return; }
    var src = TAGS + '/coverbestimage?which=new&dir=' + encodeURIComponent(it.dir);
    neu.src = src; neu.style.display = ''; if (cur.style.display !== 'none') arrow.style.display = '';
    txt.textContent = T('check.coverq.found', {w: checkNum(st.w), h: checkNum(st.h), src: st.src});
    btn(T('check.conflict.apply'), T('check.coverq.applyHint'), function(b){
      txt.textContent = T('tag.cover.preparing');
      fetch(src).then(function(x){ if (!x.ok) throw new Error(T('tag.imageNotLoadable')); return x.blob(); })
        .then(tagPrepareImage)
        .then(function(img){ txt.textContent = T('tag.cover.writing'); return checkCoverSave(it.files.map(function(f){ return f.uri; }), img.b64); })
        .then(function(batch){
          row.classList.add('done'); checkMarkDone(key);
          txt.textContent = T('check.coverq.saved');
          btn(T('check.conflict.undoApply'), T('check.conflict.undoApplyHint'), function(u){
            tagPost('/undo', {batch: batch}).then(function(r){
              if (!r || !r.ok) throw new Error((r && r.error) || 'undo');
              row.classList.remove('done');
              u.textContent = T('check.conflict.undone');
              showToast(T('check.conflict.undone'));
            }).catch(function(x){ u.disabled = false; showToast(T('tag.error', {error: x.message})); });
          }, b);
        }).catch(function(x){ b.disabled = false; txt.textContent = T('tag.error', {error: x.message}); });
    });
  }
}
/* the visible rows that still wait -> POST /coverbest; again after CB_ASK_MS while any of them waits */
function checkCoverBestAsk() {
  cbRows = cbRows.filter(function(r){ return document.body.contains(r.row); });   /* list redrawn or closed */
  var ask = cbRows.filter(function(r){ return r.seen && !r.done; });
  clearTimeout(cbTimer); cbTimer = null;
  if (!ask.length || document.hidden) return;
  tagPost('/coverbest', {dirs: ask.map(function(r){ return r.it.dir; })}).then(function(res){
    if (!res || !res.ok) return;
    var waiting = false;
    ask.forEach(function(r){
      var st = res.covers[r.it.dir];
      if (r.done) return;
      if (!st) { r.done = true; return; }
      if (st.state === 'wait') waiting = true; else r.show(st);
    });
    if (waiting && !cbTimer) cbTimer = setTimeout(checkCoverBestAsk, CB_ASK_MS);
  }).catch(function(){ if (!cbTimer) cbTimer = setTimeout(checkCoverBestAsk, 3 * CB_ASK_MS); });
}
document.addEventListener('visibilitychange', function(){ if (!document.hidden && cbRows.length) checkCoverBestAsk(); });
/* one image into all files and as folder.jpg (replaced): in parts of 100 files under one batch -> batch */
var CB_PART = 100;
function checkCoverSave(uris, b64) {
  var batch = Date.now().toString(36), parts = [], i;
  for (i = 0; i < uris.length; i += CB_PART) parts.push(uris.slice(i, i + CB_PART));
  var k = 0;
  function next() {
    if (k >= parts.length) return batch;
    var body = {uris: parts[k], image: b64, embed: true, folder: k === 0, overwrite: true, batch: batch};
    k++;
    return tagPost('/cover', body).then(function(res){
      if (!res || !res.ok) throw new Error((res && res.error) || T('tag.unknown'));
      var bad = (res.items || []).filter(function(r){ return !r.ok; }).concat((res.folders || []).filter(function(f){ return !f.ok; }));
      if (bad.length) throw new Error(bad[0].error || T('tag.unknown'));
      return next();
    });
  }
  return Promise.resolve().then(next);
}

/* "ohne Titel: 3, ohne Künstler: 1 von 12 · 01.flac, 02.flac" */
function checkNoTagsText(it) {
  var parts = ['title', 'artist', 'album'].filter(function(k){ return it[k]; }).map(function(k){
    return T('check.noTags.' + k, {n: checkNum(it[k])});
  });
  return T('check.noTags.sub', {what: parts.join(', '), count: checkNum(it.count)}) +
         (it.without && it.without.length ? ' · ' + it.without.slice(0, 3).join(', ') + (it.without.length > 3 ? ' …' : '') : '');
}

/* ---------- Placeholders, broken umlauts, odd track or date values (libcheck.tagText) ---------- */
/* "„KÃ¼nstler“ → „Künstler“ (12×) · Platzhalter „Track 01“ · /mnt/USB/…"; Apply repairs umlauts and dates, the pen opens the editor */
function checkTagTextKey(it) {
  return it.found.map(function(f){ return f.kind + ':' + f.field + ':' + f.value; }).sort().join('|').slice(0, 300);   /* /genreok: at most 300 characters */
}
function checkTagTextSub(it) {
  var parts = it.found.slice(0, 3).map(function(f){
    var s = T('check.tagText.' + (f.fix ? f.kind + 'Fix' : f.kind), {value: f.value, fix: f.fix || ''});
    return f.n > 1 ? T('check.tagText.times', {text: s, n: checkNum(f.n)}) : s;
  });
  if (it.found.length > 3) parts.push(T('check.tagText.more', {n: checkNum(it.found.length - 3)}));
  return parts.join(' · ');
}
function checkTagTextRow(it, kept) {
  var key = 'tagText|' + it.dir;
  var row = checkRow(key, it.name + (it.artist ? ' · ' + it.artist : ''), checkTagTextSub(it) + ' · /mnt/' + it.dir, function(){
    openTagEditor(it.files, it.name, {move: true});
  });
  checkGenreButtons(row, 'tagText', key, it, it.files, kept);
  return row;
}

/* ---------- Album artist or date under a name MPD does not read (tag service hiddenKeys) ---------- */
/* "ALBUM ARTIST „Velvet Static“ → Album-Künstler (12×) · YEAR „1999“ → Datum"; Apply copies them to the usual name */
function checkHiddenKey(it) {
  return it.found.map(function(f){ return f.field + ':' + f.key + ':' + f.value; }).sort().join('|').slice(0, 300);   /* /genreok: at most 300 characters */
}
function checkHiddenRow(it, kept) {
  var key = 'hiddenKeys|' + it.dir;
  var parts = it.found.slice(0, 3).map(function(f){
    var s = T('check.hidden.' + f.field, {key: f.key, value: f.value});
    return f.n > 1 ? T('check.tagText.times', {text: s, n: checkNum(f.n)}) : s;
  });
  if (it.found.length > 3) parts.push(T('check.tagText.more', {n: checkNum(it.found.length - 3)}));
  var row = checkRow(key, it.name + (it.artist ? ' · ' + it.artist : ''), parts.join(' · ') + ' · /mnt/' + it.dir, function(){
    openTagEditor(it.files, it.name, {move: true});
  });
  checkGenreButtons(row, 'hiddenKeys', key, it, it.files, kept);
  return row;
}

/* ---------- Lossless and lossy tracks in one album: the worse ones with ▶ and "Move", "Keep" if it is intended ---------- */
/* head "Album · Artist", "FLAC 16/44.1 (10), MP3 (2)" and Keep; below it one row per worse track (as for duplicate tracks) */
function checkQualityRows(it, kept) {
  var formats = it.formats.map(function(f){ return T('check.fix.value', {name: f.name, n: checkNum(f.count)}); }).join(', ');
  var head = document.createElement('div'); head.className = 'sRow ckGenreRow';
  var meta = document.createElement('div'); meta.className = 'sMeta';
  var ti = document.createElement('div'); ti.className = 'sTitle'; ti.textContent = it.name + (it.artist ? ' · ' + it.artist : '');
  var su = document.createElement('div'); su.className = 'sSub'; su.textContent = formats + ' · ' + it.dir;
  meta.appendChild(ti); meta.appendChild(su); head.appendChild(meta);
  checkGenreButtons(head, 'mixedQuality', 'mixedQuality|' + it.dir, it, it.files, kept);
  var rows = [head];
  if (!kept) it.worse.forEach(function(f){
    var nr = f.track ? (f.disc ? f.disc + '-' : '') + (f.track < 10 ? '0' : '') + f.track + ' ' : '';   /* "03 Title", "2-03 Title" */
    rows.push(checkDupTrackFile({uri: f.uri, name: nr + f.name, format: f.format, seconds: f.seconds}, 'mixedQuality|'));
  });
  return rows;
}

/* ---------- Year and album name not the same in all tracks: values found -> suggestion, "Apply" / "Keep" ---------- */
function checkValuesKey(vals) { return (vals || []).map(function(v){ return v.name; }).sort().join('|').slice(0, 300); }   /* /genreok: at most 300 characters */
/* "1999 (8), 2001 (4) → 1999-05-01 (MusicBrainz)" */
function checkFixRow(cat, it, kept) {
  var vals = (cat === 'year' ? it.years : it.names).map(function(v){
    return T('check.fix.value', {name: v.name || T('check.releaseNone'), n: checkNum(v.count)});
  }).join(', ');
  var sub = T('check.fix.sub', {values: vals, suggest: it.suggest, src: it.src === 'mb' ? 'MusicBrainz' : T('check.fix.most')});
  if (cat === 'albumName' && it.files.some(function(f){ return f.disc; })) sub += ' · ' + T('check.fix.disc');
  var row = checkRow(cat + '|' + it.dir, it.name + (it.artist ? ' · ' + it.artist : ''), sub, function(){
    openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name, {field: cat === 'year' ? 'date' : 'album', value: it.suggest});
  });
  checkGenreButtons(row, cat, cat + '|' + it.dir, it, it.files, kept);
  return row;
}
/* what "Apply" writes: the date into all files; the album name, and the disc number from "(Disc 2)" where the disc tag is empty */
function checkFixItems(cat, it) {
  if (cat === 'tagText' || cat === 'hiddenKeys') return it.fixes;   /* repaired umlauts and dates / the value under the usual name, per track */
  return it.files.map(function(f){
    var tags = cat === 'year' ? {date: it.suggest} : {album: it.suggest};
    if (cat === 'albumName' && f.disc) tags.disc = f.disc;
    return {uri: f.uri, tags: tags};
  });
}

/* genre suggestion: "Electronic (78 % by audio) · Trip Hop, Downtempo" */
function checkGenreText(it) {
  if (!it.genre) return T('check.genre.none');
  var why = it.how === 'audio' ? T('check.genre.byAudio', {p: Math.round(it.share * 100)})
          : it.how === 'both' ? T('check.genre.byBoth') : T('check.genre.byTable');
  return T('check.genre.suggest', {genre: it.genre}) + ' ' + why + (it.subs && it.subs.length ? ' · ' + it.subs.join(', ') : '');
}

function checkGenreAlbumRow(key, it, kept) {
  var row = checkRow(key + '|' + it.dir, it.name + (it.artist ? ' · ' + it.artist : ''), checkGenreText(it), function(){
    openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name, {field: 'genre', value: it.genre || ''});
  });
  checkGenreButtons(row, key, key + '|' + it.dir, it, it.files, kept);
  return row;
}

/* same change "previous -> top category" for several albums = one row; the pen opens all their tracks */
function checkGenreGroupRow(key, g, kept) {
  var names = g.albums.slice(0, 3).map(function(a){ return a.name; }).join(', ') + (g.albums.length > 3 ? ' …' : '');
  var audio = g.albums.some(function(a){ return a.how !== 'table'; });
  var row = checkRow(key + '|' + g.from + '|' + g.genre, g.from.replace(/ \/ –$/, ' / ' + T('check.genre.empty')) + ' → ' + g.genre,
    T('check.genre.groupSub', {albums: T('check.genre.albums', {n: g.albums.length}), n: g.count}) +
    (audio ? ' · ' + T('check.genre.withAudio') : '') + ' · ' + names, function(){
    openBulkEditor(g.files.map(function(f){ return f.uri; }), g.from + ' → ' + g.genre, {field: 'genre', value: g.genre});
  });
  checkAlbumFold(row, g.albums);
  checkGenreButtons(row, key, key + '|' + g.from + '|' + g.genre, g, g.files, kept);
  return row;
}

/* "▸ 12 albums": all albums of a row, folded (Album · Artist (5 tracks)) */
function checkAlbumFold(row, albums) {
  var meta = row.querySelector('.sMeta'), list = document.createElement('div'), tog = document.createElement('div');
  list.className = 'ckAlbFold'; list.style.display = 'none';
  tog.className = 'ckAlbToggle';
  function label() { tog.textContent = (list.style.display === 'none' ? '\u25b8 ' : '\u25be ') + T('check.genre.albums', {n: albums.length}); }
  tog.addEventListener('click', function(ev){
    ev.stopPropagation();
    if (!list.firstChild) albums.slice().sort(function(a, b){ return (a.artist || '').localeCompare(b.artist || '') || a.name.localeCompare(b.name); })
      .forEach(function(a){
        list.appendChild(histEl('div', '', a.name + (a.artist ? ' · ' + a.artist : '') + (a.count ? ' (' + T('browse.trackCount', {n: a.count}) + ')' : '')));
      });
    list.style.display = list.style.display === 'none' ? '' : 'none';
    label();
  });
  label();
  meta.appendChild(tog); meta.appendChild(list);
}

/* ---------- Usual spelling of artist names (MusicBrainz, Last.fm; tags/artistnames.js) ---------- */
/* progress of the lookup, below the hint: "MusicBrainz: 120 of 800 artists looked up" */
function checkArtistStatus(box) {
  var st = checkShown && checkShown.res && checkShown.res.artistStatus;
  if (!st || !st.names || st.done >= st.names) return;
  var line = document.createElement('div'); line.className = 'ckCatHint';
  line.textContent = T('check.artistFix.progress', {done: checkNum(st.done), total: checkNum(st.names)});
  box.appendChild(line);
}

/* one row per usual spelling: "AC/DC (MusicBrainz)" · "ac dc · 3 tracks, Ac/Dc · 12 tracks"; Apply / Ignore, pen: editor */
function checkArtistFixRow(g) {
  var src = g.src.split('+').map(function(x){ return x === 'mb' ? 'MusicBrainz' : 'Last.fm'; }).join(', ');
  var sub = g.variants.map(function(v){ return T('check.artistFix.variant', {name: v.name, n: checkNum(v.count)}); }).join(', ');
  var key = 'artistFix|' + g.to;
  var row = checkRow(key, T('check.artistFix.title', {to: g.to, src: src}), sub, function(){ openArtistEditor(g.variants[0].name); });
  var box = document.createElement('div'); box.className = 'ckGenreBtns';
  function btn(label, hint, fn) {
    var b = document.createElement('button'); b.className = 'ckBtn ckOkBtn';
    b.textContent = label; b.title = hint;
    b.addEventListener('click', function(ev){ ev.stopPropagation(); b.disabled = true; fn(b); });
    box.appendChild(b);
    return b;
  }
  btn(T('check.conflict.apply'), T('check.artistFix.applyHint', {to: g.to}), function(b){
    checkApplyArtist(g, b).then(function(batch){
      row.classList.add('done'); checkMarkDone(key);
      while (box.firstChild) box.removeChild(box.firstChild);
      if (batch) btn(T('check.conflict.undoApply'), T('check.conflict.undoApplyHint'), function(u){
        tagPost('/undo', {batch: batch}).then(function(r){
          if (!r || !r.ok) throw new Error((r && r.error) || 'undo');
          row.classList.remove('done');
          u.textContent = T('check.conflict.undone');
          showToast(T('check.conflict.undone'));
        }).catch(function(e){ u.disabled = false; showToast(T('tag.error', {error: e.message})); });
      });
    }).catch(function(){ b.disabled = false; b.textContent = T('check.conflict.apply'); });
  });
  btn(T('check.artistFix.ignore'), T('check.artistFix.ignoreHint'), function(b){
    Promise.all(g.variants.map(function(v){ return tagPost('/genreok', {dir: 'artist|' + v.name, tag: g.to, ok: true}); })).then(function(rs){
      if (rs.some(function(r){ return !r || !r.ok; })) throw new Error('genreok');
      g.variants.forEach(function(v){ checkGenreOk['artist|' + v.name] = g.to; });
      if (checkShown && checkShown.res) {
        checkShown.res.artistFix = (checkShown.res.artistFix || []).filter(function(x){ return x !== g; });
        checkRender(checkShown.res);
      }
    }).catch(function(){ b.disabled = false; showToast(T('check.conflict.failed')); });
  });
  row.classList.add('ckGenreRow');
  checkBtnBox(row, box);
  return row;
}

/* write the usual spelling into artist and album artist of all tracks with one of the variants (only the field that
   has it), in chunks with one undo ID */
function checkApplyArtist(g, b) {
  var names = {}, uris = [], seen = {}, items = [], batch = Date.now().toString(36), changed = [], errs = [];
  g.variants.forEach(function(v){ names[checkCleanName(v.name)] = 1; });   /* spellings that differ only in spaces count too */
  b.textContent = T('tag.searchingTracks');
  tagWriting++;
  return g.variants.reduce(function(p, v){
    return p.then(function(){
      return tagGetJson('/artist?name=' + encodeURIComponent(v.name)).then(function(r){
        if (!r.ok) throw new Error(r.error || T('tag.searchFailed'));
        r.files.forEach(function(f){ if (!seen[f]) { seen[f] = 1; uris.push(f); } });
      });
    });
  }, Promise.resolve()).then(function(){
    b.textContent = T('tag.saving');
    return tagInChunks(uris, TAG_CHUNK * 2, function(part){
      return tagPost('/read', {uris: part}).then(function(r){
        if (!r.ok) throw new Error(r.error || T('tag.readFailed'));
        r.items.forEach(function(it){
          var t = (it.ok && it.tags) || {}, set = {};
          if (t.artist && names[checkCleanName(t.artist)] && t.artist !== g.to) set.artist = g.to;
          if (t.albumartist && names[checkCleanName(t.albumartist)] && t.albumartist !== g.to) set.albumartist = g.to;
          if (set.artist || set.albumartist) items.push({uri: it.uri, tags: set});
        });
      });
    });
  }).then(function(){
    return tagInChunks(items, TAG_WRITE_CHUNK, function(part){
      return tagPostRetry('/write', {items: part, batch: batch, scan: false}).then(function(res){
        if (!res.ok) throw new Error(res.error || T('tag.writeFailed'));
        res.items.forEach(function(r, k){ if (!r.ok) errs.push(r.error); else if (r.changed || res.retried) changed.push(part[k].uri); });
      });
    });
  }).then(function(){
    if (changed.length) tagPost('/scan', {uris: changed}).catch(function(){});
    showToast(T('tag.filesChanged', {n: changed.length}) + (errs.length ? T('tag.errSuffix', {n: errs.length, error: errs[0]}) : ''));
    return changed.length ? batch : null;
  }).catch(function(e){
    showToast(T('tag.error', {error: e.message}) + (changed.length ? T('tag.alreadyChanged', {n: changed.length}) : ''));
    throw e;
  }).then(function(r){ tagWriting--; return r; }, function(e){ tagWriting--; throw e; });
}

/* one row per artist: "Barry White (most common spelling)" · "Barry White · 22 tracks, Barry  White · 1 track, double space";
   Apply writes the suggestion into artist and album artist, the other spellings can be chosen instead; Keep; pen: editor */
function checkSpellingRow(g, kept) {
  g.key = g.key || checkValuesKey(g.variants);             /* result of an older check: without key and suggestion */
  var sub = g.variants.map(function(v){
    return T('check.artistFix.variant', {name: v.name, n: checkNum(v.count)}) +
           (v.flaws ? ' (' + v.flaws.map(function(f){ return T('check.spelling.flaw.' + f); }).join(', ') + ')' : '');
  }).join(', ');
  var row = checkRow('spelling|' + g.key, T('check.spelling.title', {to: g.suggest || g.variants[0].name}), sub, function(){
    openArtistEditor(g.variants[g.variants.length - 1].name);   /* the rarest spelling: usually the one to change */
  });
  checkGenreButtons(row, 'spelling', 'spelling|' + g.key, g, [], kept);
  return row;
}
/* the other spellings worth choosing instead of the suggestion: those that look different from it */
function checkCleanName(n) { n = String(n || ''); return (n.normalize ? n.normalize('NFC') : n).replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '').replace(/\s+/g, ' ').trim(); }
function checkSpellingOthers(g) {
  var seen = {}, out = [];
  seen[g.suggest] = 1;
  g.variants.forEach(function(v){ var c = checkCleanName(v.name); if (!seen[c]) { seen[c] = 1; out.push(c); } });
  return out;
}

/* ---------- Duplicate albums: move a version into "Xplorio Trash" on the same drive (tag service POST /dupmove) ---------- */
var CHECK_TRASH = 'Xplorio Trash';                     /* duplicates.TRASH in the tag service */
function checkDupTrashPath(dir) {                       /* same rule as duplicates.trashPath in the tag service */
  var p = dir.split('/'), drive = p[0] === 'INTERNAL' ? 'INTERNAL' : p.slice(0, 2).join('/');
  return drive + '/' + CHECK_TRASH + '/' + dir.slice(drive.length + 1);
}
/* what was moved aside: put back or delete for good in the trash view (trash.js) */
function checkDupTrash(box) {
  var row = document.createElement('div'); row.className = 'ckCmdRow';
  var note = document.createElement('div'); note.className = 'ckCatHint ckTrashNote'; note.textContent = T('check.dup.trash');
  var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.dup.openTrash');
  btn.addEventListener('click', function(){ openTrash(); });
  row.appendChild(note); row.appendChild(btn);
  box.appendChild(row);
}
/* play one version (all its folders) in place of the queue; the check stays open to compare */
function checkDupPlay(g, v) {
  var items = v.dirs.map(function(d){ return {uri: 'music-library/' + d, service: 'mpd', type: 'folder', title: g.name, artist: g.artist}; });
  playItems(items, true);
}
/* album editor for one version: its tracks from Volumio (all its folders), moving offered for exactly these folders */
function checkDupEdit(g, v) {
  if (tagBusyOn) return;
  tagBusy(T('tag.loadingTracks'));
  Promise.all(v.dirs.map(function(d){ return browseGet('music-library/' + d).then(browseItems); })).then(function(lists){
    var files = [].concat.apply([], lists).filter(isLocalTrack).map(function(t){ return {uri: t.uri, title: t.title || t.name || ''}; });
    if (files.length) openTagEditor(files, g.name, {move: v.dirs});
    else { tagBusy(''); showToast(T('tag.noLocalTracks')); }
  }).catch(function(){ tagBusy(''); showToast(T('tag.albumUnreadable')); });
}
/* moved from the album editor: the version rows of these folders count as done */
function checkMovedElsewhere(dirs) {
  dirs.forEach(function(d){ checkDone['duplicates|' + d] = 1; });
  if (overlayCheck.classList.contains('on') && checkShown && checkShown.res) checkRender(checkShown.res);
}
function checkDupDirs(g) { return g.versions.map(function(v){ return v.dirs.join('+'); }).sort().join('|'); }
/* kept: the group listed folded at the end, with "Check again" instead of "Keep" */
function checkDupRows(g, kept) {
  var head = document.createElement('div'); head.className = 'ckDupHead ckDupTrHead';
  head.appendChild(document.createTextNode(g.name + (g.artist ? ' · ' + g.artist : '')));
  var keep = document.createElement('button'); keep.className = 'ckBtn ckOkBtn';
  keep.textContent = T(kept ? 'check.conflict.undoKeep' : 'check.conflict.keep');
  keep.title = T(kept ? 'check.conflict.undoKeepHint' : 'check.dup.keepAllHint');
  keep.addEventListener('click', function(ev){
    ev.stopPropagation();
    keep.disabled = true;
    var o = checkKeepOf('duplicates', g);
    tagPost('/genreok', {dir: o.k, tag: o.v, ok: !kept}).then(function(r){
      if (!r || !r.ok) throw new Error((r && r.error) || 'genreok');
      if (kept) delete checkGenreOk[o.k]; else checkGenreOk[o.k] = o.v;
      if (checkShown && checkShown.res) checkRender(checkShown.res);
    }).catch(function(){ keep.disabled = false; showToast(T('check.conflict.failed')); });
  });
  head.appendChild(keep);
  var rows = [head];
  g.versions.forEach(function(v){
    var key = 'duplicates|' + v.dirs[0];
    var row = document.createElement('div'); row.className = 'sRow ckDupRow' + (checkDone[key] ? ' done' : '');
    var meta = document.createElement('div'); meta.className = 'sMeta';
    var ti = document.createElement('div'); ti.className = 'sTitle';
    ti.textContent = T('check.dup.sub', {format: v.format, n: checkNum(v.tracks), m: checkNum(Math.round(v.seconds / 60))}) + (v.keep ? ' · ' + T('check.dup.keep') : '');
    var su = document.createElement('div'); su.className = 'sSub'; su.textContent = v.dirs.map(function(d){ return '/mnt/' + d; }).join(' + ');
    var msg = document.createElement('div'); msg.className = 'ckDupMsg'; msg.style.display = 'none';
    meta.appendChild(ti); meta.appendChild(su); meta.appendChild(msg);
    row.appendChild(meta);
    meta.addEventListener('click', function(){            /* look inside first: album editor of this version, with "Move" */
      if (checkDone[key]) return;
      checkDupEdit(g, v);
    });
    var play = document.createElement('button'); play.className = 'ckBtn ckDupPlay'; play.title = T('check.dup.play');
    play.setAttribute('aria-label', T('check.dup.play'));
    play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    play.addEventListener('click', function(){ checkDupPlay(g, v); });
    if (!checkDone[key]) row.appendChild(play);
    var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.dup.move');
    btn.disabled = !!checkDone[key];
    btn.addEventListener('click', function(){
      var to = v.dirs.map(function(d){ return '/mnt/' + checkDupTrashPath(d); }).join(' + ');
      if (!confirm(T(v.keep ? 'check.dup.confirmKeep' : 'check.dup.confirm', {dir: su.textContent, to: to}))) return;
      btn.disabled = true;
      var token = (typeof sysSvcToken === 'function' && sysSvcToken()) || (typeof sysSvcMem === 'string' ? sysSvcMem : '');
      tagPostJson('/dupmove', {dirs: v.dirs, token: token}).then(function(r){
        msg.style.display = '';
        if (r && r.ok) {
          checkDone[key] = 1; row.classList.add('done');
          if (play.parentNode) play.parentNode.removeChild(play);
          msg.textContent = T('check.dup.moved', {to: r.moved.map(function(m){ return '/mnt/' + m.to; }).join(' + ')});
          return;
        }
        btn.disabled = false;
        msg.textContent = r && r.error === 'auth' ? T('check.dup.auth') : T('check.dup.error', {error: (r && r.error) || '?'});
      }).catch(function(){ btn.disabled = false; msg.style.display = ''; msg.textContent = T('check.dup.error', {error: '?'}); });
    });
    row.appendChild(btn);
    rows.push(row);
    if (v.keep && g.missing) rows.push(checkDupFillRow(g));
  });
  return rows;
}

/* album split over folders (libcheck.splitAlbum): head with "Keep", one line per folder; the first has the most tracks
   (target). "File manager" opens the Dateimanager with that folder on the left and the target on the right; back goes
   to the check */
function checkSplitRows(g, kept) {
  var head = document.createElement('div'); head.className = 'ckDupHead ckDupTrHead';
  head.appendChild(document.createTextNode(g.name + (g.artist ? ' · ' + g.artist : '')));
  var keep = document.createElement('button'); keep.className = 'ckBtn ckOkBtn';
  keep.textContent = T(kept ? 'check.conflict.undoKeep' : 'check.conflict.keep');
  keep.title = T(kept ? 'check.conflict.undoKeepHint' : 'check.split.keepHint');
  keep.addEventListener('click', function(ev){
    ev.stopPropagation();
    keep.disabled = true;
    var o = checkKeepOf('splitAlbums', g);
    tagPost('/genreok', {dir: o.k, tag: o.v, ok: !kept}).then(function(r){
      if (!r || !r.ok) throw new Error((r && r.error) || 'genreok');
      if (kept) delete checkGenreOk[o.k]; else checkGenreOk[o.k] = o.v;
      if (checkShown && checkShown.res) checkRender(checkShown.res);
    }).catch(function(){ keep.disabled = false; showToast(T('check.conflict.failed')); });
  });
  head.appendChild(keep);
  var rows = [head], target = g.versions[0].dirs[0];
  g.versions.forEach(function(v, i){
    var key = 'split|' + v.dirs[0];
    var row = document.createElement('div'); row.className = 'sRow ckDupRow' + (checkDone[key] ? ' done' : '');
    var meta = document.createElement('div'); meta.className = 'sMeta';
    var ti = document.createElement('div'); ti.className = 'sTitle';
    ti.textContent = T('check.split.sub', {format: v.format, n: checkNum(v.tracks)}) + (i ? '' : ' · ' + T('check.split.target'));
    var su = document.createElement('div'); su.className = 'sSub'; su.textContent = v.dirs.map(function(d){ return '/mnt/' + d; }).join(' + ');
    meta.appendChild(ti); meta.appendChild(su);
    row.appendChild(meta);
    if (i && !kept) {
      var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.split.open');
      btn.title = T('check.split.openHint');
      btn.addEventListener('click', function(){
        row.classList.add('done'); checkMarkDone(key);
        clearTimeout(checkTimer);
        openFiles(v.dirs[0], target, openCheck);
      });
      row.appendChild(btn);
    }
    rows.push(row);
  });
  return rows;
}

/* below the best version: "3 tracks missing here" (folded: which, from where), "Add missing" copies them in (POST /dupfill),
   then "Undo" deletes the copies again */
function checkDupFillRow(g) {
  var dir = g.versions[0].dirs[0], key = 'dupfill|' + dir, worse = g.missing.some(function(m){ return m.worse; });
  var row = document.createElement('div'); row.className = 'sRow ckDupFill' + (checkDone[key] ? ' done' : '');
  var meta = document.createElement('div'); meta.className = 'sMeta';
  var ti = document.createElement('div'); ti.className = 'sTitle';
  ti.textContent = T('check.dupfill.title', {n: checkNum(g.missing.length)}) + (worse ? ' · ' + T('check.dupfill.worse') : '');
  var msg = document.createElement('div'); msg.className = 'ckDupMsg'; msg.style.display = 'none';
  var list = document.createElement('div'); list.className = 'ckAlbFold'; list.style.display = 'none';
  var tog = document.createElement('div'); tog.className = 'ckAlbToggle';
  function label() { tog.textContent = (list.style.display === 'none' ? '\u25b8 ' : '\u25be ') + T('check.dupfill.which'); }
  /* one line per track with a tick: ticked are those whose number is free in the best version; a taken number is named */
  var picked = {};
  g.missing.forEach(function(m){ if (m.sure !== false) picked[m.uri] = 1; });
  function count() { return Object.keys(picked).length; }
  g.missing.forEach(function(m){
    var num = (m.disc ? parseInt(m.disc, 10) + '-' : '') + (parseInt(m.track, 10) || '');
    var line = document.createElement('label'); line.className = 'ckDupFillLine';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!picked[m.uri];
    cb.disabled = !!checkDone[key];
    cb.addEventListener('change', function(){
      if (cb.checked) picked[m.uri] = 1; else delete picked[m.uri];
      btn.textContent = T('check.dupfill.add', {n: checkNum(count())});
      btn.disabled = !count();
    });
    var txt = document.createElement('span');
    txt.textContent = (num ? num + ' ' : '') + m.title + (m.artist && m.artist !== g.artist ? ' · ' + m.artist : '') + ' · ' +
      m.format + (m.worse ? ' (' + T('check.dupfill.worseOne') + ')' : '') + ' · ' + T('check.dupfill.from', {dir: '/mnt/' + m.uri.replace(/\/[^\/]*$/, '')}) +
      (m.to !== dir ? ' → /mnt/' + m.to : '') + (m.taken ? ' · ' + T('check.dupfill.taken', {num: num, title: m.taken}) : '');
    line.appendChild(cb); line.appendChild(txt);
    line.addEventListener('click', function(ev){ ev.stopPropagation(); });
    list.appendChild(line);
  });
  tog.addEventListener('click', function(ev){
    ev.stopPropagation();
    list.style.display = list.style.display === 'none' ? '' : 'none';
    label();
  });
  label();
  meta.appendChild(ti); meta.appendChild(tog); meta.appendChild(list); meta.appendChild(msg);
  row.appendChild(meta);
  var token = function(){ return (typeof sysSvcToken === 'function' && sysSvcToken()) || (typeof sysSvcMem === 'string' ? sysSvcMem : ''); };
  function fail(r, b) {
    b.disabled = false; msg.style.display = '';
    msg.textContent = r && r.error === 'auth' ? T('check.dup.auth') : T('check.dup.error', {error: (r && r.error) || '?'});
  }
  var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.dupfill.add', {n: checkNum(count())});
  btn.disabled = !!checkDone[key] || !count();
  if (g.missing.some(function(m){ return m.sure === false; })) { list.style.display = ''; label(); }   /* something to decide: open */
  btn.addEventListener('click', function(){
    var files = Object.keys(picked);
    if (!files.length || !confirm(T('check.dupfill.confirm', {n: files.length, dir: '/mnt/' + dir}))) return;
    btn.disabled = true; btn.textContent = T('check.dupfill.copying');
    tagPostJson('/dupfill', {dir: dir, files: files, token: token()}).then(function(r){
      btn.textContent = T('check.dupfill.add', {n: checkNum(files.length)});
      list.querySelectorAll('input').forEach(function(c){ c.disabled = !!(r && r.ok && r.batch); });
      if (!r || !r.ok) return fail(r, btn);
      msg.style.display = '';
      msg.textContent = T('check.dupfill.done', {n: checkNum(r.copied.length)}) +
        (r.skipped.length ? ' ' + T('check.dupfill.skipped', {n: checkNum(r.skipped.length), error: r.skipped[0].error}) : '');
      if (!r.batch) { btn.disabled = false; return; }
      checkDone[key] = 1; row.classList.add('done');
      btn.textContent = T('check.conflict.undoApply'); btn.disabled = false;
      btn.onclick = null;
      var undo = btn.cloneNode(true); btn.parentNode.replaceChild(undo, btn);
      undo.addEventListener('click', function(){
        undo.disabled = true;
        tagPostJson('/dupfill', {undo: r.batch, token: token()}).then(function(u){
          if (!u || !u.ok) return fail(u, undo);
          row.classList.remove('done'); delete checkDone[key];
          list.querySelectorAll('input').forEach(function(c){ c.disabled = false; });
          msg.textContent = T('check.dupfill.undone', {n: checkNum(u.removed.length)}) +
            (u.kept.length ? ' ' + T('check.dupfill.kept', {n: checkNum(u.kept.length)}) : '');
        }).catch(function(){ fail(null, undo); });
      });
    }).catch(function(){ btn.textContent = T('check.dupfill.add', {n: checkNum(files.length)}); fail(null, btn); });
  });
  row.appendChild(btn);
  return row;
}

/* ---------- Duplicate tracks in an album: per file play, move into "Xplorio Trash" (POST /filemove), keep the group ---------- */
/* kept groups: genre-ok.json like the genre suggestions, key "dupt|<album folder>|<group>" with value "" */
function checkDupTrackKey(a, g) { return 'dupt|' + a.dir + '|' + g.key; }
function checkDupTracksOpen(list) {
  return list.map(function(a){
    var groups = a.groups.filter(function(g){ return checkGenreOk[checkDupTrackKey(a, g)] !== ''; });
    if (groups.length === a.groups.length) return a;
    var o = {}; for (var k in a) o[k] = a[k]; o.groups = groups; return o;
  }).filter(function(a){ return a.groups.length; });
}
function checkDupTrackRows(a) {
  var head = document.createElement('div'); head.className = 'ckDupHead ckDupTrHead';
  head.appendChild(document.createTextNode(a.name + (a.artist ? ' · ' + a.artist : '')));
  head.appendChild(tagPenButton('tagEditMini', T('check.edit'), function(){ openTagEditor(a.files, a.name, {move: true}); }));
  var rows = [head];
  a.groups.forEach(function(g){
    var gh = document.createElement('div'); gh.className = 'ckDupTrGroup' + (g.sure ? '' : ' maybe');
    var gt = document.createElement('div'); gt.className = 'ckDupTrTitle';
    gt.textContent = g.title + ' · ' + checkNum(g.files.length) + '× · ' + T('check.dupt.why.' + g.why);
    gh.appendChild(gt);
    var keep = document.createElement('button'); keep.className = 'ckBtn ckOkBtn'; keep.textContent = T('check.conflict.keep');
    keep.title = T('check.dupt.keepHint');
    keep.addEventListener('click', function(){
      keep.disabled = true;
      tagPost('/genreok', {dir: checkDupTrackKey(a, g), tag: '', ok: true}).then(function(r){
        if (!r || !r.ok) throw new Error((r && r.error) || 'genreok');
        checkGenreOk[checkDupTrackKey(a, g)] = '';
        if (checkShown && checkShown.res) checkRender(checkShown.res);
      }).catch(function(){ keep.disabled = false; showToast(T('check.conflict.failed')); });
    });
    gh.appendChild(keep);
    rows.push(gh);
    g.files.forEach(function(f){ rows.push(checkDupTrackFile(f)); });
  });
  return rows;
}
function checkDupTrackFile(f, prefix) {                  /* prefix: done mark of the category, 'dupTracks|' by default */
  var key = (prefix || 'dupTracks|') + f.uri;
  var row = document.createElement('div'); row.className = 'sRow ckDupRow ckDupFile' + (checkDone[key] ? ' done' : '');
  var meta = document.createElement('div'); meta.className = 'sMeta';
  var ti = document.createElement('div'); ti.className = 'sTitle';
  ti.textContent = [f.format, f.seconds ? fmtTime(f.seconds) : ''].filter(Boolean).join(' · ') + (f.best ? ' · ' + T('check.dupt.best') : '');
  var su = document.createElement('div'); su.className = 'sSub'; su.textContent = f.name;
  su.title = '/mnt/' + f.uri;
  var msg = document.createElement('div'); msg.className = 'ckDupMsg'; msg.style.display = 'none';
  meta.appendChild(ti); meta.appendChild(su); meta.appendChild(msg);
  row.appendChild(meta);
  var play = document.createElement('button'); play.className = 'ckBtn ckDupPlay'; play.title = T('check.dup.play');
  play.setAttribute('aria-label', T('check.dup.play'));
  play.innerHTML = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
  play.addEventListener('click', function(){
    var item = {uri: 'music-library/' + f.uri, service: 'mpd', type: 'song', title: f.name};
    playItems([item], true);
  });
  if (!checkDone[key]) row.appendChild(play);
  var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.dup.move');
  btn.disabled = !!checkDone[key];
  btn.addEventListener('click', function(){
    var to = '/mnt/' + checkDupTrashPath(f.uri);
    if (!confirm(T(f.best ? 'check.dup.confirmKeep' : 'check.dup.confirm', {dir: '/mnt/' + f.uri, to: to}))) return;
    btn.disabled = true;
    var token = (typeof sysSvcToken === 'function' && sysSvcToken()) || (typeof sysSvcMem === 'string' ? sysSvcMem : '');
    tagPostJson('/filemove', {files: [f.uri], token: token}).then(function(r){
      msg.style.display = '';
      if (r && r.ok) {
        checkDone[key] = 1; row.classList.add('done');
        if (play.parentNode) play.parentNode.removeChild(play);
        msg.textContent = T('check.dup.moved', {to: r.moved.map(function(m){ return '/mnt/' + m.to; }).join(' + ')});
        return;
      }
      btn.disabled = false;
      msg.textContent = r && r.error === 'auth' ? T('check.dup.auth') : T('check.dup.error', {error: (r && r.error) || '?'});
    }).catch(function(){ btn.disabled = false; msg.style.display = ''; msg.textContent = T('check.dup.error', {error: '?'}); });
  });
  row.appendChild(btn);
  return row;
}

document.getElementById('closeCheck').addEventListener('click', function(){ clearTimeout(checkTimer); closeAllOverlays(); });
document.getElementById('checkBack').addEventListener('click', function(){
  clearTimeout(checkTimer);
  openMenu();
});
