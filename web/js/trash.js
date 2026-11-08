/* Papierkorb (menu): what the library check and the album editor moved into "Xplorio Trash" on each drive.
   Put back to the old place, or delete for good (one entry, or empty a drive). Tag service GET /trash,
   POST /trashrestore, POST /trashdelete; the password as for moving (System -> services).
   Classic script, shared global scope; load order see xplorio.html (after system.js and history.js). */
var overlayTrash = document.getElementById('overlayTrash');
var trashBody = document.getElementById('trashBody');
var trashSeq = 0;
var trashOpen = {};                                /* folder entries whose files are shown (path -> true), kept over reloads */
var TRASH_ICON = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
var TRASH_DIR = 'M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z';
var TRASH_FILE = 'M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z';
var TRASH_MORE = 'M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z';

function trashToken() { return (typeof sysSvcToken === 'function' && sysSvcToken()) || (typeof sysSvcMem === 'string' ? sysSvcMem : ''); }
function trashSize(bytes) { return sysBytes(Math.max(0, bytes) / 1024); }
function trashWhen(ms) {
  if (!ms) return '';
  var d = new Date(ms);
  return d.toLocaleDateString(LANG_LOCALE, {day: 'numeric', month: 'short', year: 'numeric'});
}
function trashName(rel) { var p = String(rel).split('/'); return p[p.length - 1]; }
function trashSvg(d) { return '<svg viewBox="0 0 24 24"><path d="' + d + '"/></svg>'; }

/* short line for the menu: "3 entries · 1.2 GB" or "empty" */
function trashSummary(r) {
  if (!r || !r.ok) return T('trash.menuSub');
  return r.count ? T('trash.sum', {n: r.count, size: trashSize(r.bytes)}) : T('trash.empty');
}

function openTrash() {
  closeAllOverlays();
  trashOpen = {};
  overlayTrash.classList.add('on');
  trashLoad();
}

function trashLoad(note) {
  var seq = ++trashSeq;
  while (trashBody.firstChild) trashBody.removeChild(trashBody.firstChild);
  trashBody.appendChild(browseNote(T('hist.loading')));
  tagGetJson('/trash').then(function(r){
    if (seq !== trashSeq) return;
    trashRender(r, note);
  }).catch(function(){
    if (seq !== trashSeq) return;
    while (trashBody.firstChild) trashBody.removeChild(trashBody.firstChild);
    trashBody.appendChild(browseNote(T('trash.offline')));
  });
}

function trashError(r) {
  var e = (r && r.error) || '?';
  if (e === 'auth') return T('check.dup.auth');
  if (e === 'exists') return T('trash.exists', {path: '/mnt/' + (r.conflict || '')});
  if (e === 'check running') return T('trash.checkRunning');
  return T('trash.error', {error: e});
}

function trashRender(r, note) {
  while (trashBody.firstChild) trashBody.removeChild(trashBody.firstChild);
  if (!r || !r.ok) { trashBody.appendChild(browseNote(trashError(r))); return; }
  var head = histEl('div', 'ckHead');
  var dirs = r.drives.some(function(d){ return d.entries.some(function(e){ return e.kind === 'dir'; }); });
  head.appendChild(histEl('div', 'ckInfo', r.count ? T('trash.info', {n: r.count, size: trashSize(r.bytes)}) + (dirs ? ' ' + T('trash.tapFiles') : '') : T('trash.none')));
  trashBody.appendChild(head);
  if (note) trashBody.appendChild(histEl('div', 'ckDupMsg trMsg', note));
  r.drives.forEach(function(d){
    var dh = histEl('div', 'trDrive');
    dh.appendChild(histEl('div', 'trDriveName', '/mnt/' + d.drive + ' · ' + trashSize(d.bytes)));
    var all = histEl('button', 'ckBtn', T('trash.emptyDrive'));
    all.addEventListener('click', function(){
      if (!confirm(T('trash.confirmEmpty', {n: d.entries.length, size: trashSize(d.bytes), drive: '/mnt/' + d.drive}))) return;
      all.disabled = true;
      tagPostJson('/trashdelete', {drive: d.drive, token: trashToken()}).then(function(x){
        if (x && x.ok) return trashLoad(T('trash.emptied', {drive: '/mnt/' + d.drive}));
        all.disabled = false; alert(trashError(x));
      }).catch(function(){ all.disabled = false; alert(trashError(null)); });
    });
    dh.appendChild(all);
    trashBody.appendChild(dh);
    d.entries.forEach(function(e){ trashBody.appendChild(trashRow(e)); });
  });
  trashBody.appendChild(histEl('div', 'ckCatHint', T('trash.hint')));
}

/* the buttons of an entry or of a single file: put back, delete for good; messages under the name */
function trashActions(e, meta, name) {
  var msg = histEl('div', 'ckDupMsg');
  msg.style.display = 'none';
  meta.appendChild(msg);
  var back = histEl('button', 'ckBtn', T('trash.restore'));
  var del = histEl('button', 'ckBtn ckDupPlay trDel');
  del.title = T('trash.delete'); del.setAttribute('aria-label', T('trash.delete'));
  del.innerHTML = trashSvg(TRASH_ICON);
  function busy(on) { back.disabled = on; del.disabled = on; }
  function fail(x) { busy(false); msg.style.display = ''; msg.textContent = trashError(x); }
  back.addEventListener('click', function(ev){
    ev.stopPropagation();
    busy(true);
    tagPostJson('/trashrestore', {path: e.path, token: trashToken()}).then(function(x){
      if (x && x.ok) return trashLoad(T('trash.restored', {path: '/mnt/' + x.to}));
      fail(x);
    }).catch(function(){ fail(null); });
  });
  del.addEventListener('click', function(ev){
    ev.stopPropagation();
    if (!confirm(T('trash.confirmDelete', {name: name, size: trashSize(e.bytes)}))) return;
    busy(true);
    tagPostJson('/trashdelete', {path: e.path, token: trashToken()}).then(function(x){
      if (x && x.ok) return trashLoad(T('trash.deleted', {name: name}));
      fail(x);
    }).catch(function(){ fail(null); });
  });
  var btns = histEl('div', 'trBtns');
  btns.appendChild(back); btns.appendChild(del);
  return btns;
}

function trashRow(e) {
  var wrap = histEl('div', 'trEntry');
  var row = histEl('div', 'sRow ckDupRow trRow');
  var icon = histEl('div', 'trIcon');
  icon.innerHTML = trashSvg(e.kind === 'dir' ? TRASH_DIR : TRASH_FILE);
  row.appendChild(icon);
  var meta = histEl('div', 'sMeta');
  meta.appendChild(histEl('div', 'sTitle', trashName(e.path)));
  var parts = [e.reason ? T('trash.why.' + e.reason) : '', trashWhen(e.at), trashSize(e.bytes) + (e.kind === 'dir' ? ' · ' + T('trash.files', {n: e.files}) : '')];
  meta.appendChild(histEl('div', 'sSub', T('trash.from', {path: '/mnt/' + e.from.split('/').slice(0, -1).join('/')})));   /* the folder it came from */
  meta.appendChild(histEl('div', 'sSub', parts.filter(Boolean).join(' · ')));
  row.appendChild(meta);
  wrap.appendChild(row);
  if (e.kind === 'dir') {
    /* a tap on a folder entry shows its files, each to put back or delete on its own */
    var more = histEl('div', 'trMore');
    more.innerHTML = trashSvg(TRASH_MORE);
    row.insertBefore(more, meta.nextSibling);
    var list = histEl('div', 'trFiles');
    wrap.appendChild(list);
    var toggle = function(on){
      trashOpen[e.path] = on;
      row.classList.toggle('open', on);
      row.setAttribute('aria-expanded', on ? 'true' : 'false');
      while (list.firstChild) list.removeChild(list.firstChild);
      if (on) trashFiles(e, list);
    };
    row.classList.add('trTap');
    row.setAttribute('role', 'button');
    row.addEventListener('click', function(){ toggle(!trashOpen[e.path]); });
    if (trashOpen[e.path]) toggle(true);
  }
  row.appendChild(trashActions(e, meta, trashName(e.path)));
  return wrap;
}

/* the files of a folder entry, loaded when it is opened */
function trashFiles(e, list) {
  var seq = trashSeq;
  list.appendChild(browseNote(T('hist.loading')));
  tagGetJson('/trashfiles?p=' + encodeURIComponent(e.path)).then(function(r){
    if (seq !== trashSeq || !trashOpen[e.path]) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    if (!r || !r.ok) { list.appendChild(browseNote(trashError(r))); return; }
    r.files.forEach(function(f){
      var row = histEl('div', 'sRow ckDupRow trRow trFile');
      var meta = histEl('div', 'sMeta');
      meta.appendChild(histEl('div', 'sTitle', f.name));
      meta.appendChild(histEl('div', 'sSub', trashSize(f.bytes)));
      if (f.title) meta.appendChild(histEl('div', 'sSub', (f.track ? (f.track < 10 ? '0' : '') + f.track + ' ' : '') + f.title));   /* from the tags */
      row.appendChild(meta);
      row.appendChild(trashActions(f, meta, f.name));
      list.appendChild(row);
    });
  }).catch(function(){
    if (seq !== trashSeq) return;
    while (list.firstChild) list.removeChild(list.firstChild);
    list.appendChild(browseNote(T('trash.offline')));
  });
}

document.getElementById('closeTrash').addEventListener('click', function(){ trashSeq++; closeAllOverlays(); });
document.getElementById('trashBack').addEventListener('click', function(){ trashSeq++; openMenu(); });
