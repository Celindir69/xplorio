/* Library check: problem cases in the collection (tag service GET/POST /check), each entry with a pen to the matching editor.
   Classic script, shared global scope; loaded after tagedit.js. */
var overlayCheck = document.getElementById('overlayCheck');
var checkBody    = document.getElementById('checkBody');
var checkTimer   = null;
var checkOpen    = {};          /* expanded categories stay open on redraw */
var CHECK_PAGE   = 100;         /* this many entries per category, then "show more" */
var checkDone    = {};          /* edited entries (tag service remembers them until the next check) */
var checkDoneAt  = 0;           /* which check run checkDone belongs to */

var CHECK_CATS = [
  {key: 'noCover', name: T('check.cat.noCover'), hint: T('check.cat.noCoverHint')},
  {key: 'albumArtist', name: T('check.cat.albumArtist'), hint: T('check.cat.albumArtistHint')},
  {key: 'spelling', name: T('check.cat.spelling'), hint: T('check.cat.spellingHint')},
  {key: 'duplicates', name: T('check.cat.duplicates'), hint: T('check.cat.duplicatesHint')},
  {key: 'mixed', name: T('check.cat.mixed'), hint: T('check.cat.mixedHint')},
  {key: 'releaseDate', name: T('check.cat.releaseDate'), hint: T('check.cat.releaseDateHint')},
  {key: 'noTrack', name: T('check.cat.noTrack'), hint: T('check.cat.noTrackHint')},
  {key: 'genreMissing', name: T('check.cat.genreMissing'), hint: T('check.cat.genreMissingHint')},
  {key: 'genreMerge', name: T('check.cat.genreMerge'), hint: T('check.cat.genreMergeHint')}
];
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
  var have = checkShown && checkShown.info.isConnected && checkShown.at ? '?have=' + encodeURIComponent(checkShown.at) : '';
  Promise.all([tagGetJson('/check' + have), tagGetJson('/moodtags').catch(function(){ return null; })]).then(function(both){
    var res = both[0];
    if (!overlayCheck.classList.contains('on')) return;
    checkMood = both[1];
    if (res.result === 'same' && checkShown && checkShown.running && res.running) {
      checkShown.info.textContent = checkRunText(res.running) + (res.error ? T('check.errorSuffix', {error: res.error}) : '');
    } else {
      if (res.result === 'same') res.result = checkShown ? checkShown.res.result : null;
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
    : T('check.runCovers', {done: checkNum(run.done), total: checkNum(run.total)});
}
function checkRender(res) {
  var keepScroll = checkBody.scrollTop;
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
  if (checkDoneAt !== r.at) { checkDone = {}; checkDoneAt = r.at; }
  Object.keys(r.done || {}).forEach(function(k){ checkDone[k] = 1; });

  CHECK_CATS.forEach(function(cat){
    var list = r[cat.key] || [];
    var row = document.createElement('div'); row.className = 'ckCat' + (checkOpen[cat.key] ? ' open' : '');
    row.innerHTML = '<div class="ckName"></div><div class="ckNum"></div>' + CHECK_CHEVRON;
    row.querySelector('.ckName').textContent = cat.name;
    var num = row.querySelector('.ckNum');
    num.textContent = checkNum(list.length);
    if (!list.length) num.className += ' zero';
    var box = document.createElement('div'); box.className = 'ckList';
    row.addEventListener('click', function(){
      checkOpen[cat.key] = !checkOpen[cat.key];
      row.classList.toggle('open', checkOpen[cat.key]);
      if (checkOpen[cat.key] && !box.firstChild) checkFill(box, cat, list);
    });
    checkBody.appendChild(row); checkBody.appendChild(box);
    if (checkOpen[cat.key]) checkFill(box, cat, list);
  });
  checkMoodSection();
  checkBody.scrollTop = keepScroll;
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
  }).catch(function(){ libUpdSet('failed'); });
}
function libUpdPoll() {
  clearTimeout(libUpd.timer);
  libUpd.timer = setTimeout(function(){
    tagGetJson('/scan').then(function(r){
      if (r && r.ok && r.updating) return libUpdPoll();
      libUpdSet(r && r.ok ? 'done' : 'failed');
    }).catch(libUpdPoll);
  }, 3000);
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
  function more() {
    var end = Math.min(list.length, shown + CHECK_PAGE);
    for (; shown < end; shown++) {
      if (cat.key === 'genreMerge') box.insertBefore(checkGenreGroupRow(cat.key, list[shown]), moreRow);
      else if (cat.key === 'spelling') list[shown].variants.forEach(function(v, i){ box.insertBefore(checkSpellingRow(v, i, list[shown]), moreRow); });
      else if (cat.key === 'duplicates') checkDupRows(list[shown]).forEach(function(el){ box.insertBefore(el, moreRow); });
      else box.insertBefore(checkAlbumRow(cat.key, list[shown]), moreRow);
    }
    moreRow.style.display = shown < list.length ? '' : 'none';
    moreRow.textContent = T('check.more', {k: checkNum(Math.min(CHECK_PAGE, list.length - shown)), left: checkNum(list.length - shown)});
  }
  if (cat.key === 'duplicates' && list.length) checkDupTrash(box, list);
  var moreRow = document.createElement('div'); moreRow.className = 'ckMore';
  moreRow.addEventListener('click', more);
  box.appendChild(moreRow);
  more();
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
  else if (key === 'mixed') sub = [it.albums.length > 1 ? it.albums.join(' / ') : '', it.years.length > 1 ? it.years.join(' / ') : ''].filter(Boolean).join(' · ') || it.dir;
  else if (key === 'releaseDate') sub = T('check.releaseSub', {tag: it.tag || T('check.releaseNone'), mb: it.mb});
  else if (key === 'noTrack') sub = T('check.noTrackSub', {missing: checkNum(it.missing), count: checkNum(it.count), dir: it.dir});
  if (key === 'genreMissing') return checkGenreAlbumRow(key, it);
  return checkRow(key + '|' + it.dir, heading, sub, function(){
    if (key === 'releaseDate') openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name, {field: 'date', value: it.mb});   /* date suggested by MusicBrainz */
    else if (key === 'albumArtist' || key === 'mixed') openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name);
    else openTagEditor(it.files, it.name);
  });
}

/* genre suggestion: "Electronic (78 % by audio) · Trip Hop, Downtempo" */
function checkGenreText(it) {
  if (!it.genre) return T('check.genre.none');
  var why = it.how === 'audio' ? T('check.genre.byAudio', {p: Math.round(it.share * 100)})
          : it.how === 'both' ? T('check.genre.byBoth') : T('check.genre.byTable');
  return T('check.genre.suggest', {genre: it.genre}) + ' ' + why + (it.subs && it.subs.length ? ' · ' + it.subs.join(', ') : '');
}

function checkGenreAlbumRow(key, it) {
  return checkRow(key + '|' + it.dir, it.name + (it.artist ? ' · ' + it.artist : ''), checkGenreText(it), function(){
    openBulkEditor(it.files.map(function(f){ return f.uri; }), it.name, {field: 'genre', value: it.genre || ''});
  });
}

/* same change "previous -> top category" for several albums = one row; the pen opens all their tracks */
function checkGenreGroupRow(key, g) {
  var names = g.albums.slice(0, 3).map(function(a){ return a.name; }).join(', ') + (g.albums.length > 3 ? ' …' : '');
  var audio = g.albums.some(function(a){ return a.how !== 'table'; });
  return checkRow(key + '|' + g.from + '|' + g.genre, g.from.replace(/ \/ –$/, ' / ' + T('check.genre.empty')) + ' → ' + g.genre,
    T('check.genre.groupSub', {albums: T('check.genre.albums', {n: g.albums.length}), n: g.count}) +
    (audio ? ' · ' + T('check.genre.withAudio') : '') + ' · ' + names, function(){
    openBulkEditor(g.files.map(function(f){ return f.uri; }), g.from + ' → ' + g.genre, {field: 'genre', value: g.genre});
  });
}

function checkSpellingRow(v, i, group) {
  var others = group.variants.filter(function(o){ return o !== v; }).map(function(o){ return o.name; }).join(', ');
  return checkRow('spelling|' + v.name, v.name, T('check.spellingSub', {n: v.count, others: others}), function(){ openArtistEditor(v.name); });
}

/* ---------- Duplicate albums: move a version into .duplicates on the same drive (tag service POST /dupmove) ---------- */
function checkShellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function checkDupTrashPath(dir) {                       /* same rule as duplicates.trashPath in the tag service */
  var p = dir.split('/'), drive = p[0] === 'INTERNAL' ? 'INTERNAL' : p.slice(0, 2).join('/');
  return drive + '/.duplicates/' + dir.slice(drive.length + 1);
}
/* copy text: the clipboard API only exists on https, on http the old way via a selected text field */
function checkCopy(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  var ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select(); ta.setSelectionRange(0, text.length);
  var ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { /* not allowed */ }
  document.body.removeChild(ta);
  return ok ? Promise.resolve() : Promise.reject(new Error('copy'));
}
function checkCmdRow(cmd) {
  var row = document.createElement('div'); row.className = 'ckCmdRow';
  var code = document.createElement('div'); code.className = 'ckCmd'; code.textContent = cmd;
  var btn = document.createElement('button'); btn.className = 'ckBtn'; btn.textContent = T('check.dup.copy');
  btn.addEventListener('click', function(){
    checkCopy(cmd).then(function(){ btn.textContent = T('check.dup.copied'); }, function(){ btn.textContent = T('check.dup.copyFailed'); });
    setTimeout(function(){ btn.textContent = T('check.dup.copy'); }, 2500);
  });
  row.appendChild(code); row.appendChild(btn);
  return row;
}
/* delete what was moved aside for good: one command per drive, only via ssh */
function checkDupTrash(box, list) {
  var drives = {};
  list.forEach(function(g){ g.versions.forEach(function(v){ drives[v.drive] = 1; }); });
  var note = document.createElement('div'); note.className = 'ckCatHint'; note.textContent = T('check.dup.trash');
  box.appendChild(note);
  Object.keys(drives).sort().forEach(function(d){ box.appendChild(checkCmdRow('sudo rm -rf ' + checkShellQuote('/mnt/' + d + '/.duplicates'))); });
}
/* play one version (all its folders) in place of the queue; the check stays open to compare */
function checkDupPlay(g, v) {
  var items = v.dirs.map(function(d){ return {uri: 'music-library/' + d, service: 'mpd', type: 'folder', title: g.name, artist: g.artist}; });
  if (queueForInput(items)) return;
  fetch('/api/v1/replaceAndPlay', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({item: items[0]})
  }).then(function(){
    if (items.length > 1) setTimeout(function(){ socket.emit('addToQueue', items.slice(1)); }, 300);
  }).catch(function(){});
}
function checkDupRows(g) {
  var head = document.createElement('div'); head.className = 'ckDupHead';
  head.textContent = g.name + (g.artist ? ' · ' + g.artist : '');
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
  });
  return rows;
}

document.getElementById('closeCheck').addEventListener('click', function(){ clearTimeout(checkTimer); closeAllOverlays(); });
document.getElementById('checkBack').addEventListener('click', function(){
  clearTimeout(checkTimer);
  openMenu();
});
