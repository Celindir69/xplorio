/* Dateimanager (menu): two folder panes over INTERNAL, USB and NAS. Tick files and folders, then copy or move them into the
   folder open in the other pane (buttons, or drag & drop: dropping moves, with ⌥/Alt or Ctrl it copies), make folders,
   put things into "Xplorio Trash", delete empty folders. Only with the password of the System page (tag service
   POST /files, tags/fileops.js); without one nothing is shown.
   Classic script, shared global scope; load order see xplorio.html (after trash.js: trashToken, trashSize, trashSvg). */
var overlayFiles = document.getElementById('overlayFiles');
var filesBody = document.getElementById('filesBody');
var FILES_UP = 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z';
var FILES_NEWDIR = 'M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-1 8h-3v3h-2v-3h-3v-2h3V9h2v3h3v2z';
var FILES_DRIVE = 'M20 13H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1v-6c0-.55-.45-1-1-1zM7 19c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zM20 3H4c-.55 0-1 .45-1 1v6c0 .55.45 1 1 1h16c.55 0 1-.45 1-1V4c0-.55-.45-1-1-1zM7 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z';
var FILES_DOC = 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z';
var filesSeq = 0;
var filesPanes = [{path: '', sel: {}}, {path: '', sel: {}}];   /* folder and ticked names per pane, kept while the page is open */
var filesActive = 0;                                         /* the pane whose ticks the buttons act on */
var filesJobTimer = null;
var filesDrag = null;                                        /* {pane, items} while dragging */

function filesPost(body) { body.token = trashToken(); return tagPostJson('/files', body); }
function filesName(rel) { var p = String(rel).split('/'); return p[p.length - 1]; }
function filesShown(rel) { return '/mnt/' + rel; }
function filesClear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

function filesError(r) {
  var e = (r && r.error) || '?';
  if (e === 'auth') return T('check.dup.auth');
  if (e === 'nopw') return T('files.nopw');
  if (e === 'check running') return T('trash.checkRunning');
  if (e === 'busy') return T('files.busy');
  if (e === 'exists') return T('files.exists');
  if (e === 'not empty') return T('files.notEmpty');
  if (e === 'bad name') return T('files.badName');
  if (e === 'nothing to do') return T('files.nothing');
  if (/^into itself/.test(e)) return T('files.intoItself');
  return T('trash.error', {error: e});
}

function openFiles() {
  closeAllOverlays();
  overlayFiles.classList.add('on');
  filesStart();
}

/* first the password: the job query fails with auth without a valid login */
function filesStart() {
  var seq = ++filesSeq;
  filesClear(filesBody);
  filesBody.appendChild(browseNote(T('hist.loading')));
  filesPost({op: 'job'}).then(function(r){
    if (seq !== filesSeq) return;
    filesClear(filesBody);
    if (r && r.error === 'auth') return filesBody.appendChild(filesLogin());
    if (!r || !r.ok) return filesBody.appendChild(browseNote(filesError(r)));
    filesRender(r.job);
  }).catch(function(){
    if (seq !== filesSeq) return;
    filesClear(filesBody);
    filesBody.appendChild(browseNote(T('trash.offline')));
  });
}

function filesLogin() {
  var f = histEl('form', 'fmLogin');
  f.appendChild(histEl('div', 'ckInfo', T('files.loginHint')));
  var row = histEl('div', 'fmLoginRow');
  var inp = histEl('input', 'tagIn');
  inp.type = 'password'; inp.autocomplete = 'current-password'; inp.placeholder = T('sys.svc.password');
  var ok = histEl('button', 'ckBtn', T('sys.svc.login'));
  ok.type = 'submit';
  row.appendChild(inp); row.appendChild(ok);
  f.appendChild(row);
  var err = histEl('div', 'ckDupMsg', '');
  f.appendChild(err);
  f.addEventListener('submit', function(ev){
    ev.preventDefault();
    if (!inp.value || ok.disabled) return;
    ok.disabled = true;
    tagPostJson('/servicelogin', {password: inp.value}).then(function(r){
      ok.disabled = false; inp.value = '';
      if (r && r.ok) { sysSvcMem = sysSvcToken(r.token); return filesStart(); }
      err.textContent = r && r.error === 'unset' ? T('files.nopw') : r && r.error === 'locked' ? T('sys.svc.locked', {s: r.wait})
        : r && r.error === 'wrong' ? T('sys.svc.wrong') + (r.wait ? ' ' + T('sys.svc.locked', {s: r.wait}) : '') : T('sys.svc.error');
    }).catch(function(){ ok.disabled = false; err.textContent = T('sys.svc.error'); });
  });
  setTimeout(function(){ inp.focus(); }, 350);
  return f;
}

/* ---------- layout: job line, two panes, action bar ---------- */

var filesEls = null;
function filesRender(job) {
  filesClear(filesBody);
  var e = filesEls = {};
  e.job = histEl('div', 'fmJob');
  e.msg = histEl('div', 'ckDupMsg fmMsg');
  e.msg.style.display = 'none';
  var panes = histEl('div', 'fmPanes');
  e.panes = [0, 1].map(function(i){ var p = filesPaneEl(i); panes.appendChild(p.el); return p; });
  e.bar = histEl('div', 'fmBar');
  filesBody.appendChild(e.job);
  filesBody.appendChild(e.msg);
  filesBody.appendChild(panes);
  filesBody.appendChild(e.bar);
  filesBody.appendChild(histEl('div', 'ckCatHint', T('files.hint')));
  filesShowJob(job);
  filesLoad(0); filesLoad(1);
}

function filesNote(text) {
  if (!filesEls) return;
  filesEls.msg.textContent = text || '';
  filesEls.msg.style.display = text ? '' : 'none';
}

function filesPaneEl(i) {
  var p = {el: histEl('div', 'fmPane' + (i ? '' : ' fmLeft')), seq: 0, data: null};   /* the left pane has its index on the left */
  var head = histEl('div', 'fmHead');
  p.up = histEl('button', 'fmTool');
  p.up.title = T('files.up'); p.up.setAttribute('aria-label', T('files.up'));
  p.up.innerHTML = trashSvg(FILES_UP);
  p.up.addEventListener('click', function(){ var cur = filesPanes[i].path; filesOpen(i, filesParent(cur)); });
  p.crumbs = histEl('div', 'fmCrumbs');
  p.mk = histEl('button', 'fmTool');
  p.mk.title = T('files.newDir'); p.mk.setAttribute('aria-label', T('files.newDir'));
  p.mk.innerHTML = trashSvg(FILES_NEWDIR);
  p.mk.addEventListener('click', function(){ filesMkdir(i); });
  head.appendChild(p.up); head.appendChild(p.crumbs); head.appendChild(p.mk);
  p.list = histEl('div', 'fmList');
  p.idx = histEl('div', 'fmIdx');                              /* # 0-9 A … Z at the outer edge, for long lists */
  var wrap = histEl('div', 'fmListWrap');
  wrap.appendChild(p.list); wrap.appendChild(p.idx);
  p.el.appendChild(head); p.el.appendChild(wrap);
  filesIndexEvents(p);
  /* dropping on the empty part of a pane: into its open folder */
  filesDropTarget(p.list, i, function(){ return filesPanes[i].path; });
  p.el.addEventListener('click', function(){ if (filesActive !== i && !filesCount(i)) { filesActive = i; filesPaint(); } });
  return p;
}

/* "USB/S/Beatles" -> "USB/S"; a drive -> '' (the list of drives) */
function filesParent(rel) {
  var parts = String(rel).split('/'), n = parts[0] === 'INTERNAL' ? 1 : 2;
  return parts.length <= n ? '' : parts.slice(0, -1).join('/');
}

function filesDrive(rel) { var p = String(rel).split('/'); return p.slice(0, p[0] === 'INTERNAL' ? 1 : 2).join('/'); }

function filesOpen(i, rel) {
  filesPanes[i].path = rel; filesPanes[i].sel = {};
  filesLoad(i);
}

function filesLoad(i) {
  var p = filesEls.panes[i], seq = ++p.seq, rel = filesPanes[i].path;
  filesClear(p.list);
  p.list.appendChild(browseNote(T('hist.loading')));
  filesCrumbs(i);
  filesPost({op: 'list', path: rel}).then(function(r){
    if (seq !== p.seq || !filesEls || filesEls.panes[i] !== p) return;
    if (r && !r.ok && rel && r.error === 'not found') return filesOpen(i, filesParent(rel));   /* gone meanwhile: one up */
    if (r && r.error === 'auth') { filesClear(filesBody); filesEls = null; return filesBody.appendChild(filesLogin()); }
    p.data = r && r.ok ? r : null;
    filesList(i, r);
  }).catch(function(){
    if (seq !== p.seq) return;
    filesClear(p.list);
    p.list.appendChild(browseNote(T('trash.offline')));
  });
}

function filesCrumbs(i) {
  var p = filesEls.panes[i], rel = filesPanes[i].path;
  filesClear(p.crumbs);
  p.up.disabled = !rel;
  var root = histEl('span', 'fmCrumb', T('files.drives'));
  root.addEventListener('click', function(){ filesOpen(i, ''); });
  p.crumbs.appendChild(root);
  if (!rel) return;
  var parts = rel.split('/'), n = parts[0] === 'INTERNAL' ? 1 : 2;
  for (var k = n; k <= parts.length; k++) {
    (function(to, label){
      p.crumbs.appendChild(histEl('span', 'fmSep', '›'));
      var c = histEl('span', 'fmCrumb', label);
      c.addEventListener('click', function(){ filesOpen(i, to); });
      p.crumbs.appendChild(c);
    })(parts.slice(0, k).join('/'), k === n ? parts.slice(0, n).join('/') : parts[k - 1]);
  }
  p.crumbs.scrollLeft = p.crumbs.scrollWidth;
}

function filesList(i, r) {
  var p = filesEls.panes[i], rel = filesPanes[i].path;
  filesClear(p.list);
  if (!r || !r.ok) { p.list.appendChild(browseNote(filesError(r))); return filesPaint(); }
  if (!rel) {
    r.drives.forEach(function(d){ p.list.appendChild(filesRow(i, {name: d.name, path: d.path, kind: 'drive'})); });
    if (!r.drives.length) p.list.appendChild(browseNote(T('files.noDrives')));
    return filesPaint();
  }
  r.dirs.forEach(function(d){ p.list.appendChild(filesRow(i, {name: d.name, path: rel + '/' + d.name, kind: 'dir'})); });
  r.files.forEach(function(f){ p.list.appendChild(filesRow(i, {name: f.name, path: rel + '/' + f.name, kind: 'file', bytes: f.bytes, audio: f.audio})); });
  if (!r.dirs.length && !r.files.length) p.list.appendChild(histEl('div', 'sHint fmEmpty', T('files.emptyDir')));
  if (r.more) p.list.appendChild(histEl('div', 'sHint', T('files.more')));
  filesPaint();
}

function filesRow(i, it) {
  var row = histEl('div', 'fmRow fm-' + it.kind);
  row.dataset.name = it.name;
  if (it.kind !== 'drive') {
    var box = histEl('input', 'fmCheck');
    box.type = 'checkbox';
    box.checked = !!filesPanes[i].sel[it.name];
    box.setAttribute('aria-label', it.name);
    box.addEventListener('click', function(ev){ ev.stopPropagation(); filesTick(i, it.name, box.checked); });
    row.appendChild(box);
  }
  var icon = histEl('div', 'fmIcon');
  icon.innerHTML = trashSvg(it.kind === 'drive' ? FILES_DRIVE : it.kind === 'dir' ? TRASH_DIR : it.audio ? TRASH_FILE : FILES_DOC);
  row.appendChild(icon);
  row.appendChild(histEl('div', 'fmName', it.name));
  if (it.kind === 'file') row.appendChild(histEl('div', 'fmSize', trashSize(it.bytes)));
  /* tap: a folder opens, a file is ticked */
  row.addEventListener('click', function(){
    if (it.kind === 'file') { filesTick(i, it.name, !filesPanes[i].sel[it.name]); return; }
    filesOpen(i, it.path);
  });
  if (it.kind !== 'drive') {
    row.draggable = true;
    row.addEventListener('dragstart', function(ev){
      if (!filesPanes[i].sel[it.name]) { filesPanes[i].sel = {}; filesTick(i, it.name, true); }
      filesDrag = {pane: i, items: filesItems(i)};
      try { ev.dataTransfer.setData('text/plain', filesDrag.items.join('\n')); ev.dataTransfer.effectAllowed = 'copyMove'; } catch (e) { /* old browser */ }
      row.classList.add('fmDragging');
    });
    row.addEventListener('dragend', function(){ filesDrag = null; row.classList.remove('fmDragging'); filesDropOff(); });
  }
  /* dropping on a folder (or a drive): into it */
  if (it.kind !== 'file') filesDropTarget(row, i, function(){ return it.path; });
  return row;
}

/* ---------- index at the outer edge (left pane left, right pane right): # (other), 0-9, A … Z; only when the list does not fit ---------- */

var FILES_INDEX = ['#', '0-9'].concat('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''));
/* the group of a name: first letter without accents (Ä -> A), digits, else # */
function filesGroup(name) {
  var c = String(name).charAt(0);
  try { c = c.normalize('NFD').charAt(0); } catch (e) { /* old browser */ }
  c = c.toUpperCase();
  if (/[0-9]/.test(c)) return '0-9';
  return /[A-Z]/.test(c) ? c : '#';
}
function filesIndex(p) {
  var rows = p.list.querySelectorAll('.fmRow'), first = {};
  Array.prototype.forEach.call(rows, function(row){ var g = filesGroup(row.dataset.name); if (!first[g]) first[g] = row; });
  p.first = first;
  var long = rows.length > 1 && p.list.scrollHeight > p.list.clientHeight + 4;
  p.list.classList.toggle('fmHasIdx', long);
  p.idx.style.display = long ? '' : 'none';
  filesClear(p.idx);
  if (!long) return;
  FILES_INDEX.forEach(function(g){
    var el = histEl('div', 'fmIdxKey' + (first[g] ? '' : ' off'), g === '0-9' ? '0–9' : g);
    el.dataset.g = g;
    p.idx.appendChild(el);
  });
}
/* jump to the first entry of a group; an empty group: the next one that has entries */
function filesJump(p, g) {
  var k = FILES_INDEX.indexOf(g);
  while (k >= 0 && k < FILES_INDEX.length && !(p.first && p.first[FILES_INDEX[k]])) k++;
  var row = k >= 0 && k < FILES_INDEX.length ? p.first[FILES_INDEX[k]] : null;
  if (row) p.list.scrollTop = row.offsetTop - 4;
}
/* tap on a key, or slide along the bar (touch too) */
function filesIndexEvents(p) {
  var on = false;
  function at(ev) {
    var el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (el && el.dataset && el.dataset.g && p.idx.contains(el)) filesJump(p, el.dataset.g);
  }
  p.idx.addEventListener('pointerdown', function(ev){
    on = true; ev.preventDefault(); ev.stopPropagation();
    try { p.idx.setPointerCapture(ev.pointerId); } catch (e) { /* not supported */ }
    at(ev);
  });
  p.idx.addEventListener('pointermove', function(ev){ if (on) at(ev); });
  ['pointerup', 'pointercancel'].forEach(function(t){ p.idx.addEventListener(t, function(){ on = false; }); });
  p.idx.addEventListener('click', function(ev){ ev.stopPropagation(); });
}
window.addEventListener('resize', function(){ if (filesEls) filesEls.panes.forEach(filesIndex); });

/* ---------- ticks ---------- */

function filesTick(i, name, on) {
  if (filesActive !== i) { filesPanes[filesActive].sel = {}; filesActive = i; }   /* ticks in one pane only */
  if (on) filesPanes[i].sel[name] = true; else delete filesPanes[i].sel[name];
  filesPaint();
}
function filesCount(i) { return Object.keys(filesPanes[i].sel).length; }
function filesItems(i) {
  var base = filesPanes[i].path;
  return Object.keys(filesPanes[i].sel).map(function(n){ return base + '/' + n; });
}

/* checkboxes, the active pane and the action bar after every change */
function filesPaint() {
  if (!filesEls) return;
  [0, 1].forEach(function(i){
    var p = filesEls.panes[i];
    p.el.classList.toggle('fmActive', i === filesActive);
    filesIndex(p);
    p.mk.disabled = !filesPanes[i].path;
    Array.prototype.forEach.call(p.list.querySelectorAll('.fmRow'), function(row){
      var on = !!filesPanes[i].sel[row.dataset.name], box = row.querySelector('.fmCheck');
      row.classList.toggle('fmSel', on);
      if (box) box.checked = on;
    });
  });
  filesBar();
}

function filesBar() {
  var bar = filesEls.bar, i = filesActive, n = filesCount(i), other = 1 - i, dest = filesPanes[other].path, busy = filesBusy();
  filesClear(bar);
  if (!n) { bar.appendChild(histEl('div', 'fmBarInfo', T('files.tickHint'))); return; }
  bar.appendChild(histEl('div', 'fmBarInfo', T('files.ticked', {n: n})));
  var target = dest ? filesName(dest) : '';
  [['copy', 'files.copyTo'], ['move', 'files.moveTo']].forEach(function(x){
    var b = histEl('button', 'ckBtn', dest ? T(x[1], {dir: target}) : T(x[1] + 'None'));
    b.title = dest ? filesShown(dest) : T('files.pickTarget');
    b.disabled = !dest || busy;
    b.addEventListener('click', function(){ filesTransfer(x[0], filesItems(i), dest); });
    bar.appendChild(b);
  });
  var dirsOnly = filesEls.panes[i].data && Object.keys(filesPanes[i].sel).every(function(nm){
    return filesEls.panes[i].data.dirs.some(function(d){ return d.name === nm; });
  });
  if (dirsOnly) {
    var rm = histEl('button', 'ckBtn', T('files.rmdir'));
    rm.disabled = busy;
    rm.addEventListener('click', function(){ filesRmdir(i); });
    bar.appendChild(rm);
  }
  var tr = histEl('button', 'ckBtn ckDupPlay trDel');
  tr.title = T('files.toTrash'); tr.setAttribute('aria-label', T('files.toTrash'));
  tr.innerHTML = trashSvg(TRASH_ICON);
  tr.disabled = busy;
  tr.addEventListener('click', function(){ filesTrash(i); });
  bar.appendChild(tr);
  var none = histEl('button', 'ckBtn fmNone', T('files.untick'));
  none.addEventListener('click', function(){ filesPanes[i].sel = {}; filesPaint(); });
  bar.appendChild(none);
}

/* ---------- drag & drop ---------- */

var filesOver = null;
function filesDropOff() { if (filesOver) { filesOver.classList.remove('fmDrop'); filesOver = null; } }
function filesCopyKey(ev) { return !!(ev.altKey || ev.ctrlKey); }
function filesDropTarget(el, i, destOf) {
  function ok() {
    var dest = destOf();
    if (!filesDrag || !dest || filesBusy()) return false;
    return !filesDrag.items.some(function(it){ return dest === it || dest.indexOf(it + '/') === 0; });   /* not into itself */
  }
  el.addEventListener('dragover', function(ev){
    if (!ok()) return;
    ev.preventDefault(); ev.stopPropagation();
    try { ev.dataTransfer.dropEffect = filesCopyKey(ev) ? 'copy' : 'move'; } catch (e) { /* old browser */ }
    if (filesOver !== el) { filesDropOff(); filesOver = el; el.classList.add('fmDrop'); }
  });
  el.addEventListener('dragleave', function(ev){ if (filesOver === el && !el.contains(ev.relatedTarget)) filesDropOff(); });
  el.addEventListener('drop', function(ev){
    if (!ok()) return;
    ev.preventDefault(); ev.stopPropagation();
    var d = filesDrag, dest = destOf();
    filesDropOff(); filesDrag = null;
    filesTransfer(filesCopyKey(ev) ? 'copy' : 'move', d.items, dest);
  });
}

/* ---------- actions ---------- */

function filesTransfer(mode, items, dest) {
  if (!items.length || !dest) return;
  var what = items.length === 1 ? '„' + filesName(items[0]) + '“' : T('files.entries', {n: items.length});
  var cross = mode === 'move' && items.some(function(it){ return filesDrive(it) !== filesDrive(dest); });
  if (!confirm(T(mode === 'copy' ? 'files.confirmCopy' : 'files.confirmMove', {what: what, dir: filesShown(dest)}) +
               (cross ? '\n\n' + T('files.crossHint') : ''))) return;
  filesNote('');
  filesPost({op: mode, items: items, dest: dest}).then(function(r){
    if (!r || !r.ok) return filesNote(filesError(r));
    filesPanes[0].sel = {}; filesPanes[1].sel = {};
    filesShowJob(r.job);
  }).catch(function(){ filesNote(filesError(null)); });
}

function filesMkdir(i) {
  var dest = filesPanes[i].path;
  if (!dest) return;
  var name = prompt(T('files.newDirName', {dir: filesShown(dest)}), '');
  if (name === null) return;
  name = name.trim();
  if (!name) return;
  filesPost({op: 'mkdir', dest: dest, name: name}).then(function(r){
    if (!r || !r.ok) return filesNote(filesError(r));
    filesNote('');
    filesLoad(i);
  }).catch(function(){ filesNote(filesError(null)); });
}

function filesTrash(i) {
  var items = filesItems(i);
  if (!items.length) return;
  var what = items.length === 1 ? '„' + filesName(items[0]) + '“' : T('files.entries', {n: items.length});
  if (!confirm(T('files.confirmTrash', {what: what}))) return;
  filesPost({op: 'trash', items: items}).then(function(r){
    filesPanes[i].sel = {};
    filesNote(r && r.ok ? T('files.trashed', {n: r.moved.length}) : filesError(r));
    filesReload();
  }).catch(function(){ filesNote(filesError(null)); });
}

function filesRmdir(i) {
  var items = filesItems(i), bad = [], k = 0;
  (function next() {
    if (k >= items.length) {
      filesPanes[i].sel = {};
      filesNote(bad.length ? T('files.notEmptyList', {names: bad.join(', ')}) : T('files.removed', {n: items.length}));
      return filesReload();
    }
    var it = items[k++];
    filesPost({op: 'rmdir', path: it}).then(function(r){ if (!r || !r.ok) bad.push(filesName(it)); next(); })
      .catch(function(){ bad.push(filesName(it)); next(); });
  })();
}

function filesReload() { if (filesEls) { filesLoad(0); filesLoad(1); } }

/* ---------- the running job: progress, cancel, result ---------- */

var filesLastJob = null;
function filesBusy() { return !!(filesLastJob && filesLastJob.state === 'running'); }
function filesShowJob(job) {
  var was = filesLastJob;
  filesLastJob = job;
  clearTimeout(filesJobTimer);
  if (!filesEls) return;
  var box = filesEls.job;
  filesClear(box);
  if (!job) { box.style.display = 'none'; return; }
  box.style.display = '';
  var verb = T(job.op === 'copy' ? 'files.copying' : 'files.moving');
  if (job.state === 'running') {
    var pct = job.bytes ? Math.round(job.bytesDone / job.bytes * 100) : 0;
    box.appendChild(histEl('div', 'fmJobText', T('files.progress', {what: verb, done: job.filesDone, n: job.files,
      size: trashSize(job.bytesDone), total: trashSize(job.bytes), dir: filesShown(job.dest)})));
    var barEl = histEl('div', 'fmProg'), fill = histEl('div', 'fmProgFill');
    fill.style.width = pct + '%';
    barEl.appendChild(fill);
    box.appendChild(barEl);
    if (job.current) box.appendChild(histEl('div', 'sSub fmCur', job.current));
    var stop = histEl('button', 'ckBtn', T('files.cancel'));
    stop.addEventListener('click', function(){ stop.disabled = true; filesPost({op: 'cancel'}).catch(function(){}); });
    box.appendChild(stop);
    filesJobTimer = setTimeout(filesPoll, 1000);
  } else if (was && was.id === job.id && was.state === 'running') {
    filesJobResult(job);                                      /* just ended: say what happened, reload */
    filesReload();
  } else box.style.display = 'none';                         /* an old job: nothing to say */
  filesPaint();
}
function filesJobResult(job) {
  var box = filesEls.job;
  var text = T(job.op === 'copy' ? 'files.copied' : 'files.moved', {n: job.done.length, dir: filesShown(job.dest)});
  if (job.state === 'cancelled') text += ' ' + T('files.cancelled');
  box.appendChild(histEl('div', 'fmJobText', text));
  job.errors.forEach(function(e){ box.appendChild(histEl('div', 'ckDupMsg', filesName(e.from) + ': ' + tagNoWrite({error: e.error}).error)); });
  if (job.op === 'move' && job.done.some(function(d){ return d.trashed; })) box.appendChild(histEl('div', 'sSub', T('files.originals')));
  var ok = histEl('button', 'ckBtn', T('files.ok'));
  ok.addEventListener('click', function(){ box.style.display = 'none'; });
  box.appendChild(ok);
}
function filesPoll() {
  if (!overlayFiles.classList.contains('on') || !filesEls) return;
  filesPost({op: 'job'}).then(function(r){ if (r && r.ok) filesShowJob(r.job); else filesJobTimer = setTimeout(filesPoll, 3000); })
    .catch(function(){ filesJobTimer = setTimeout(filesPoll, 3000); });
}

function filesClose() { filesSeq++; clearTimeout(filesJobTimer); filesEls = null; }
document.getElementById('closeFiles').addEventListener('click', function(){ filesClose(); closeAllOverlays(); });
document.getElementById('filesBack').addEventListener('click', function(){ filesClose(); openMenu(); });
