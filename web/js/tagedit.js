/* Tag editor: edit tags of local files (m4a, flac, mp3, dsf) via the tag service on the player (tags/tag-service.js).
   Classic script, shared global scope; see xplorio.html for load order. */
var TAGS = 'http://' + location.hostname + ':' + ((window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766);
var TAG_LOCAL_RE = /^(music-library\/|\/?mnt\/)?(USB|INTERNAL|NAS)\//;
var TAG_COMMON = [['artist', T('tag.field.artist')], ['albumartist', T('tag.field.albumartist')], ['album', T('tag.field.album')],
                  ['genre', T('tag.field.genre')], ['date', T('tag.field.year')], ['composer', T('tag.field.composer')], ['disc', T('tag.field.disc')],
                  ['comment', T('tag.field.comment')]];

var overlayTags = document.getElementById('overlayTags');
var tagBody     = document.getElementById('tagBody');
var tagSave     = document.getElementById('tagSave');
var tagUndo     = document.getElementById('tagUndo');
var tagStatus   = document.getElementById('tagStatus');
var tagFiles    = [];     /* [{uri, ok, error, tags, titleIn, trackIn}] */
var tagCommon   = {};     /* field name -> {input, mixed} */
var tagBatch    = null;
var tagMode     = 'album';  /* 'album': editor for selected files; 'artist': bulk editing per artist */

/* only local files on the player can be edited (not TIDAL, Qobuz, radio) */
function isLocalTrack(t) {
  return !!t && (t.service || 'mpd') === 'mpd' && TAG_LOCAL_RE.test(t.uri || '');
}

var TAG_PEN_SVG = '<svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';

/* Pen button. A tap calls onClick and triggers nothing in the surrounding row
   (no playing, no swiping in the queue). */
function tagPenButton(cls, title, onClick) {
  var b = document.createElement('div');
  b.className = cls || 'tagEditMini';
  b.title = title;
  b.innerHTML = TAG_PEN_SVG;
  ['touchstart', 'touchend', 'pointerdown'].forEach(function(ev){
    b.addEventListener(ev, function(e){ e.stopPropagation(); }, {passive:true});
  });
  b.addEventListener('click', function(e){ e.stopPropagation(); onClick(); });
  return b;
}

/* pen for specific files; files: [{uri, title}] or a function returning them */
function tagEditButton(files, heading, cls) {
  return tagPenButton(cls, T('tag.edit'), function(){
    openTagEditor(typeof files === 'function' ? files() : files, heading);
  });
}

/* pen in the artist view: edit all of the artist's tracks together */
function tagArtistButton(name) {
  return tagPenButton('browseEditBtn', T('tag.editArtist'), function(){ openArtistEditor(name); });
}

/* pen for a single track, only for local files; otherwise null */
function tagTrackButton(t) {
  if (!isLocalTrack(t)) return null;
  var title = t.title || t.name || '';
  return tagEditButton([{uri:t.uri, title:title}], title);
}

/* pen for an album in a list (search, artist page): reads the tracks only on tap; local only, otherwise null */
function tagAlbumButton(al) {
  if (!al || !al.uri || (al.service || 'mpd') !== 'mpd' || streamOf(al.uri)) return null;
  return tagPenButton('tagEditMini', T('tag.edit'), function(){
    showToast(T('tag.loadingTracks'));
    browseGet(al.uri).then(function(j){
      var files = browseItems(j).filter(isLocalTrack).map(function(t){ return {uri:t.uri, title:t.title || t.name || ''}; });
      if (files.length) openTagEditor(files, al.title || al.name || '');
      else showToast(T('tag.noLocalTracks'));
    }).catch(function(){ showToast(T('tag.albumUnreadable')); });
  });
}

/* pen in the player next to the quality display: only while a local file is playing */
var mEdit = null, mEditUri = '', mInput = null;
function tagPaintPlayer(st) {
  if (!mEdit) {
    var row = document.getElementById('mTechRow');
    if (!row) return;
    mEdit = tagEditButton(function(){ return [{uri:mEditUri, title:mTitle.textContent}]; }, null, 'tagEditMini');
    mEdit.id = 'mEdit';
    row.appendChild(mEdit);
  }
  var inp = typeof rotelInput === 'function' ? rotelInput() : null;   /* other input on the amplifier: icon instead of pen */
  if (st && st.trackType === 'input') inp = null;                         /* large icon already sits in place of the cover */
  var local = !inp && !!st && st.trackType !== 'input' && st.trackType !== 'webradio' && isLocalTrack(st);
  mEditUri = local ? st.uri : '';
  mEdit.style.display = local ? '' : 'none';
  if (inp && !mInput) {
    mInput = document.createElement('span');
    mInput.id = 'mInput'; mInput.className = 'inputIcon';
    mInput.addEventListener('click', function(){ if (typeof openPlayback === 'function') openPlayback(); });   /* remote control */
    mEdit.parentNode.appendChild(mInput);
  }
  if (!mInput) return;
  mInput.style.display = inp ? '' : 'none';
  var ic = inp ? (ROTEL_ICONS[inp.icon] || ROTEL_ICONS.aux) : '';
  if (inp && mInput.getAttribute('data-icon') !== ic) {
    mInput.setAttribute('data-icon', ic);
    mInput.title = inp.name;
    mInput.innerHTML = '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="' + ic + '"/></svg>';
  }
}

function tagPost(route, body) {
  return fetch(TAGS + route, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(body)})
    .then(function(r){ return r.json(); }).then(tagNoWrite);
}

/* missing write permission: say how to fix it (files copied over Volumio's network share belong to the guest user) */
var TAG_NOWRITE = /permission denied|read-only|no write permission|EACCES|EPERM/i;
function tagNoWrite(res) {
  function fix(o) { if (o && o.error && TAG_NOWRITE.test(o.error)) o.error = T('tag.noWrite', {error: o.error}); }
  if (res) { fix(res); (res.items || []).forEach(fix); (res.folders || []).forEach(fix); }
  return res;
}

function tagField(label, input, extra) {
  var l = document.createElement('label');
  l.className = 'tagField';
  var s = document.createElement('span');
  s.textContent = label;
  l.appendChild(s);
  if (extra) {                                     /* e.g. "Aa" menu to the right of the input field */
    var line = document.createElement('div');
    line.className = 'tagLine';
    line.appendChild(input); line.appendChild(extra);
    l.appendChild(line);
  } else l.appendChild(input);
  return l;
}

/* "Aa" menu with the text functions (textfn.js); onPick(fn) applies the chosen function */
function tagAaMenu(onPick, title) {
  var sel = document.createElement('select');
  sel.className = 'tagAa';
  sel.title = title || T('tag.textFn');
  var o = document.createElement('option');
  o.value = ''; o.textContent = 'Aa';
  sel.appendChild(o);
  TEXT_FUNCS.forEach(function(f){
    var op = document.createElement('option');
    op.value = f[0]; op.textContent = f[1];
    sel.appendChild(op);
  });
  sel.addEventListener('click', function(e){ e.stopPropagation(); });
  sel.addEventListener('change', function(){
    var fn = textFunc(sel.value);
    sel.value = '';
    if (fn) onPick(fn);
  });
  return sel;
}

/* Discogs main genres (like TOPS in tags/genres.js): picker next to each genre field, custom values remain possible */
var GENRE_TOPS = ['Blues', 'Brass & Military', "Children's", 'Classical', 'Electronic', 'Folk, World, & Country', 'Funk / Soul',
                  'Hip Hop', 'Jazz', 'Latin', 'Non-Music', 'Pop', 'Reggae', 'Rock', 'Stage & Screen'];
function tagGenreMenu(input) {
  var sel = document.createElement('select');
  sel.className = 'tagAa tagGenre';
  sel.title = T('tag.genreTopHint');
  [''].concat(GENRE_TOPS).forEach(function(g){
    var o = document.createElement('option');
    o.value = g; o.textContent = g || T('tag.genreTop');
    sel.appendChild(o);
  });
  sel.addEventListener('click', function(e){ e.stopPropagation(); });
  sel.addEventListener('change', function(){
    var g = sel.value;
    sel.value = '';
    if (!g) return;
    input.value = g;
    input.setAttribute('data-dirty', '1');
    input.dispatchEvent(new Event('input'));
  });
  return sel;
}

/* apply a text function to an input field and mark it as changed */
function tagApplyFn(input, fn) {
  var v = fn(input.value);
  if (v === input.value) return;
  input.value = v;
  input.setAttribute('data-dirty', '1');
}

function tagInput(value, cls) {
  var i = document.createElement(cls === 'tagMulti' ? 'textarea' : 'input');   /* comment field: multi-line */
  if (cls === 'tagMulti') i.rows = 2; else i.type = 'text';
  i.className = 'tagIn' + (cls ? ' ' + cls : '');
  i.value = value || '';
  i.autocomplete = 'off'; i.autocorrect = 'off'; i.spellcheck = false;
  i.addEventListener('input', function(){ i.setAttribute('data-dirty', '1'); });
  return i;
}

function tagMsg(text) {
  while (tagBody.firstChild) tagBody.removeChild(tagBody.firstChild);
  tagBody.appendChild(browseNote(text));
}

/* files: [{uri, title}] */
function openTagEditor(files, heading) {
  tagMode = 'album';
  var seq = ++artSeq;                                     /* discard a late answer for a previously opened album */
  tagSave.textContent = T('tag.save');
  if (!heading && files.length === 1) heading = files[0].title;
  document.getElementById('tagTitle').textContent = heading || T('tag.edit');
  tagBatch = null; tagUndo.style.display = 'none'; tagSave.disabled = true; tagStatus.textContent = '';
  tagMsg(T('tag.loading'));
  overlayTags.classList.add('on');
  tagPost('/read', {uris: files.map(function(f){ return f.uri; })}).then(function(res){
    if (seq !== artSeq) return;
    if (!res.ok) { tagMsg(T('tag.error', {error: res.error || T('tag.unknown')})); return; }
    tagRender(files, res.items);
  }).catch(function(){
    if (seq !== artSeq) return;
    tagMsg(T('tag.serviceDownPort', {port: (window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766}));
  });
}

function tagRender(files, items) {
  tagFiles = items.map(function(it, i){
    return {uri: it.uri, ok: !!it.ok, error: it.error, tags: it.tags || {}, name: files[i] && files[i].title};
  });
  var good = tagFiles.filter(function(f){ return f.ok; });
  while (tagBody.firstChild) tagBody.removeChild(tagBody.firstChild);
  if (!good.length) { tagMsg(tagFiles.length ? tagFiles[0].error || T('tag.noTagsReadable') : T('tag.noFiles')); return; }

  tagBody.appendChild(tagCoverSection(good));

  tagCommon = {};
  TAG_COMMON.forEach(function(fd){
    var vals = good.map(function(f){ return f.tags[fd[0]] || ''; });
    var same = vals.every(function(v){ return v === vals[0]; });
    var inp = tagInput(same ? vals[0] : '', fd[0] === 'comment' ? 'tagMulti' : '');
    if (!same) inp.placeholder = T('tag.mixed');
    tagCommon[fd[0]] = {input: inp, mixed: !same};
    var aa = fd[0] === 'date' || fd[0] === 'disc' || fd[0] === 'comment' ? null : tagAaMenu(function(fn){ tagApplyFn(inp, fn); });
    if (fd[0] === 'genre') { var both = document.createDocumentFragment(); both.appendChild(tagGenreMenu(inp)); both.appendChild(aa); aa = both; }
    tagBody.appendChild(tagField(fd[1], inp, aa));
  });

  if (good.length > 1) {                                /* pattern, replace etc. for the whole album */
    var bulk = document.createElement('button');
    bulk.className = 'tagBtn'; bulk.textContent = T('tag.bulkButton');
    bulk.addEventListener('click', function(){
      openBulkEditor(good.map(function(f){ return f.uri; }), document.getElementById('tagTitle').textContent);
    });
    tagBody.appendChild(bulk);
  }

  var h = document.createElement('div');
  h.className = 'infoSection tagSectionAa';
  var hl = document.createElement('span');
  hl.textContent = good.length > 1 ? T('tag.tracks') : T('tag.titleAndNumber');
  h.appendChild(hl);
  h.appendChild(tagAaMenu(function(fn){                  /* to all tracks of the album */
    tagFiles.forEach(function(f){ if (f.titleIn) tagApplyFn(f.titleIn, fn); });
  }, T('tag.textFnAll')));
  tagBody.appendChild(h);
  tagFiles.forEach(function(f){
    var row = document.createElement('div');
    row.className = 'tagRow';
    if (!f.ok) {
      row.textContent = (f.name || f.uri) + ': ' + (f.error || T('tag.unreadable'));
      row.classList.add('err');
    } else {
      f.trackIn = tagInput(f.tags.track, 'tagNum');
      f.titleIn = tagInput(f.tags.title, 'tagTit');
      row.appendChild(f.trackIn); row.appendChild(f.titleIn);
    }
    tagBody.appendChild(row);
  });
  tagSave.disabled = false;
}

function tagCollect() {
  var common = {};
  Object.keys(tagCommon).forEach(function(k){
    var c = tagCommon[k], v = c.input.value;
    if (c.input.getAttribute('data-dirty') !== '1') return;
    if (c.mixed && v === '') return;            /* do not accidentally clear "(various)" */
    common[k] = v;
  });
  return tagFiles.filter(function(f){ return f.ok; }).map(function(f){
    var t = {title: f.titleIn.value, track: f.trackIn.value};
    Object.keys(common).forEach(function(k){ t[k] = common[k]; });
    return {uri: f.uri, tags: t};
  });
}

/* ---------- Cover ---------- */
var TAG_COVER_MAX = 1000;          /* longer side of a chosen image in pixels (larger ones are scaled down) */

function tagImageUrl(uri, src) {
  return TAGS + '/image?src=' + src + '&uri=' + encodeURIComponent(uri) + '&t=' + Date.now();
}

function bufToB64(buf) {
  var bytes = new Uint8Array(buf), out = '', CH = 0x8000;
  for (var i = 0; i < bytes.length; i += CH) out += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(out);
}
function isJpeg(buf) { var b = new Uint8Array(buf, 0, 2); return b[0] === 0xff && b[1] === 0xd8; }

/* image (Blob) -> base64 JPEG; JPEGs up to TAG_COVER_MAX stay unchanged, everything else is re-encoded */
function tagPrepareImage(blob) {
  return new Promise(function(resolve, reject){
    var url = URL.createObjectURL(blob), img = new Image();
    img.onload = function(){
      URL.revokeObjectURL(url);
      var w = img.naturalWidth, h = img.naturalHeight, f = Math.min(1, TAG_COVER_MAX / Math.max(w, h));
      blob.arrayBuffer().then(function(buf){
        if (f === 1 && isJpeg(buf)) return resolve({b64: bufToB64(buf), w: w, h: h});
        var c = document.createElement('canvas');
        c.width = Math.round(w * f); c.height = Math.round(h * f);
        var g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);            /* PNG with transparency: white background */
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve({b64: c.toDataURL('image/jpeg', 0.9).split(',')[1], w: c.width, h: c.height});
      }, reject);
    };
    img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error(T('tag.imageUnreadable'))); };
    img.src = url;
  });
}

function tagThumb(caption) {
  var box = document.createElement('div');
  box.className = 'tagThumb';
  var img = document.createElement('img');
  var cap = document.createElement('div');
  cap.className = 'tagThumbCap'; cap.textContent = caption;
  var none = document.createElement('div');
  none.className = 'tagThumbNone'; none.textContent = T('tag.cover.none');
  box.appendChild(img); box.appendChild(none); box.appendChild(cap);
  box.show = function(src, text){
    box.classList.remove('empty');
    img.onerror = function(){ box.classList.add('empty'); if (box.onEmpty) box.onEmpty(); };
    img.onload = function(){ if (text !== undefined) cap.textContent = text; else if (img.naturalWidth) cap.textContent = caption + ' · ' + img.naturalWidth + '×' + img.naturalHeight; };
    img.src = src;
  };
  return box;
}

/* area at the top of the editor: show embedded cover and folder.jpg, choose a new image, create folder.jpg */
function tagCoverSection(good) {
  var uris = good.map(function(f){ return f.uri; }), first = uris[0], n = uris.length;
  var wrap = document.createElement('div');
  wrap.className = 'tagCover';
  var thumbs = document.createElement('div');
  thumbs.className = 'tagThumbs';
  var emb = tagThumb(T('tag.cover.embedded')), fol = tagThumb('folder.jpg');
  thumbs.appendChild(emb); thumbs.appendChild(fol);
  wrap.appendChild(thumbs);

  var btns = document.createElement('div');
  btns.className = 'tagCoverBtns';
  var file = document.createElement('input');
  file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
  var pick = document.createElement('button'); pick.textContent = T('tag.cover.pick');
  var toFolder = document.createElement('button'); toFolder.textContent = T('tag.cover.toFolder');
  var online = document.createElement('button'); online.textContent = T('tag.cover.online');
  btns.appendChild(pick); btns.appendChild(online); btns.appendChild(toFolder); btns.appendChild(file);
  wrap.appendChild(btns);
  var found = document.createElement('div');               /* suggestions from the online search */
  found.className = 'tagOnline'; found.style.display = 'none';
  wrap.appendChild(found);

  var opts = document.createElement('div');                 /* appears after choosing an image */
  opts.className = 'tagCoverOpts'; opts.style.display = 'none';
  function check(label, on) {
    var l = document.createElement('label'), c = document.createElement('input');
    c.type = 'checkbox'; c.checked = on;
    l.appendChild(c); l.appendChild(document.createTextNode(' ' + label));
    opts.appendChild(l);
    return c;
  }
  var cEmbed = check(T('tag.cover.embedIn', {n: n}), true);
  var cFolder = check(T('tag.cover.asFolder'), false);
  var apply = document.createElement('button'); apply.className = 'tagCoverApply'; apply.textContent = T('tag.cover.apply');
  opts.appendChild(apply);
  wrap.appendChild(opts);

  var chosen = null;
  function refresh() {
    emb.show(tagImageUrl(first, 'embedded'));
    fol.show(tagImageUrl(first, 'folder'));
  }
  emb.onEmpty = function(){ toFolder.disabled = true; };
  refresh();

  pick.addEventListener('click', function(){ file.click(); });
  file.addEventListener('change', function(){
    if (!file.files || !file.files[0]) return;
    tagStatus.textContent = T('tag.cover.preparing');
    tagPrepareImage(file.files[0]).then(function(r){ useImage(r, T('tag.cover.new')); }).catch(function(e){ tagStatus.textContent = e.message; });
    file.value = '';
  });

  function useImage(r, label) {                            /* preview in the "Embedded" field, show options */
    chosen = r;
    emb.show('data:image/jpeg;base64,' + r.b64, label + ' · ' + r.w + '×' + r.h + ' · ' + Math.round(r.b64.length * 0.75 / 1024) + ' KB');
    opts.style.display = '';
    tagStatus.textContent = '';
  }

  /* Search covers online (iTunes, Last.fm, Cover Art Archive via the tag service): album artist (otherwise artist)
     and album as they currently are in the fields (change them briefly for searching, without saving); empty fields
     ("various") take the first track's value. Suggestions side by side, a tap puts the image into the preview. */
  online.addEventListener('click', function(){
    var t = good[0].tags || {};
    function cur(k) { var c = tagCommon[k]; var v = c && c.input.value.trim(); return v || t[k] || ''; }
    var artist = cur('albumartist') || cur('artist'), album = cur('album');
    if (!album) { tagStatus.textContent = T('tag.cover.noAlbum'); return; }
    tagStatus.textContent = T('tag.cover.searching', {album: album});
    online.disabled = true;
    while (found.firstChild) found.removeChild(found.firstChild);
    found.style.display = 'none';
    tagGetJson('/coversearch?artist=' + encodeURIComponent(artist) + '&album=' + encodeURIComponent(album)).then(function(res){
      online.disabled = false;
      if (!res.ok) { tagStatus.textContent = res.error || T('tag.errorShort'); return; }
      var left = res.results.length, countText = null;     /* countText: status last set by count() */
      function count() {
        var k = found.children.length;
        if (!k) { found.style.display = 'none'; tagStatus.textContent = T('tag.cover.noneOnline'); }
        else tagStatus.textContent = T('tag.cover.suggestions', {n: k});
        countText = tagStatus.textContent;
      }
      function gone() { left--; if (tagStatus.textContent === countText) count(); }
      if (!left) { tagStatus.textContent = T('tag.cover.noneOnline'); return; }
      found.style.display = '';
      res.results.forEach(function(r){
        var src = TAGS + '/coverimage?id=' + encodeURIComponent(r.id);
        var card = tagThumb(r.source);
        card.classList.add('tagPick');
        card.onEmpty = function(){ if (card.parentNode) found.removeChild(card); gone(); };
        card.show(src);
        card.addEventListener('click', function(){
          tagStatus.textContent = T('tag.cover.preparing');
          fetch(src).then(function(x){ if (!x.ok) throw new Error(T('tag.imageNotLoadable')); return x.blob(); })
            .then(tagPrepareImage)
            .then(function(img){
              Array.prototype.forEach.call(found.children, function(c){ c.classList.toggle('on', c === card); });
              useImage(img, r.source);
            }).catch(function(e){ tagStatus.textContent = e.message; });
        });
        found.appendChild(card);
      });
      count();
    }).catch(function(){ online.disabled = false; tagStatus.textContent = T('tag.serviceDown'); });
  });

  function send(body, done) {
    tagStatus.textContent = T('tag.cover.writing');
    pick.disabled = toFolder.disabled = apply.disabled = true;
    tagPost('/cover', body).then(function(res){
      if (!res.ok && res.exists) {
        var q = T('tag.cover.exists', {n: res.exists.length});
        if (window.confirm(q)) { body.overwrite = true; return send(body, done); }
        tagStatus.textContent = T('tag.nothingChanged');
        pick.disabled = toFolder.disabled = apply.disabled = false;
        return;
      }
      pick.disabled = toFolder.disabled = apply.disabled = false;
      if (!res.ok) { tagStatus.textContent = T('tag.error', {error: res.error || T('tag.unknown')}); return; }
      var files = (res.items || []).filter(function(r){ return r.ok && r.changed; }).length;
      var errs = (res.items || []).filter(function(r){ return !r.ok; }).concat((res.folders || []).filter(function(f){ return !f.ok; }));
      var dirs = (res.folders || []).filter(function(f){ return f.ok; }).length;
      var parts = [];
      if (files) parts.push(T('tag.cover.partFiles', {n: files}));
      if (dirs) parts.push(T('tag.cover.partFolders', {n: dirs}));
      tagStatus.textContent = (parts.length ? T('tag.cover.written', {parts: parts.join(', ')}) : T('tag.nothingChanged')) +
        (errs.length ? T('tag.errSuffix', {n: errs.length, error: errs[0].error}) : '');
      tagBatch = res.batch;
      tagUndo.style.display = tagBatch ? '' : 'none';
      if (done) done();
      refresh();
      if (files || dirs) tagRefreshView();
    }).catch(function(){
      tagStatus.textContent = T('tag.serviceDown');
      pick.disabled = toFolder.disabled = apply.disabled = false;
    });
  }

  apply.addEventListener('click', function(){
    if (!chosen || (!cEmbed.checked && !cFolder.checked)) return;
    send({uris: uris, image: chosen.b64, embed: cEmbed.checked, folder: cFolder.checked},
         function(){ chosen = null; opts.style.display = 'none'; });
  });

  toFolder.addEventListener('click', function(){
    tagStatus.textContent = T('tag.cover.reading');
    fetch(tagImageUrl(first, 'embedded')).then(function(r){
      if (!r.ok) throw new Error(T('tag.cover.noEmbedded'));
      return r.blob();
    }).then(function(blob){
      return blob.arrayBuffer().then(function(buf){            /* take JPEG unchanged, otherwise convert */
        return isJpeg(buf) ? {b64: bufToB64(buf)} : tagPrepareImage(blob);
      });
    }).then(function(r){
      send({uris: uris, image: r.b64, embed: false, folder: true});
    }).catch(function(e){ tagStatus.textContent = e.message; });
  });

  return wrap;
}

/* ---------- Bulk editing (all tracks of an artist or an album) ---------- */
var TAG_BULK_FIELDS = [['artist', T('tag.field.artist')], ['albumartist', T('tag.field.albumartist')], ['album', T('tag.field.album')],
                       ['title', T('tag.field.title')], ['genre', T('tag.field.genre')], ['composer', T('tag.field.composer')]];
var TAG_BULK_ACTIONS = [['set', T('tag.bulk.set')], ['replace', T('tag.bulk.replace')], ['split', T('tag.bulk.split')]].concat(
  TEXT_FUNCS.map(function(f){ return [f[0], f[1]]; }));
var TAG_CHUNK = 100;                                 /* files per request to the tag service */
var TAG_WRITE_CHUNK = 20;                            /* files per write request: rewriting m4a on a NAS is slow, and
                                                        Safari gives up on a request that stays silent for about a minute */
var TAG_RETRY = [5000, 15000, 30000];                /* waits before repeating a request after a network error */

var artName = '', artFiles = [], artBad = [];         /* artFiles: [{uri, tags}]; artBad: unreadable [{uri, error}] */
var artSeq = 0;                                       /* discards answers for a previously opened editor */
var artUi = null;                                     /* input elements of the view */
var artChanges = [];                                  /* preview: [{from, to, tags:{field:value}, files:[f], check}] */
var artReload = null;                                 /* reloads the editor after undo */
var artPreset = null;                                 /* preset {field, value} (genre suggestion from the check) */
var TAG_LABELS = {title: T('tag.field.title'), track: T('tag.field.track')};
TAG_COMMON.forEach(function(fd){ TAG_LABELS[fd[0]] = fd[1]; });

function tagSelect(list, value) {
  var sel = document.createElement('select');
  sel.className = 'tagSel';
  list.forEach(function(x){
    var o = document.createElement('option');
    o.value = x[0]; o.textContent = x[1];
    sel.appendChild(o);
  });
  if (value) sel.value = value;
  return sel;
}

function tagGetJson(route) {
  return fetch(TAGS + route).then(function(r){ return r.json(); });
}

/* whenTags(fn): fn(health) as soon as the tag service answers. One shared request for all parts; without an answer
   retry later (5 s, 10 s, … up to 1 min) and when returning to the page, e.g. when the iPad loads faster than the
   player after a power cut */
var tagsHealth = null, tagsWaiters = [], tagsChecking = false, tagsRetry = null, tagsTries = 0;
function whenTags(fn) {
  if (tagsHealth) return fn(tagsHealth);
  tagsWaiters.push(fn);
  tagsCheck();
}
function tagsCheck() {
  if (tagsHealth || tagsChecking) return;
  tagsChecking = true; clearTimeout(tagsRetry);
  withTimeout(tagGetJson('/health'), 5000).then(function(r){
    tagsChecking = false;
    if (!r || !r.ok) throw new Error('kein Tag-Dienst');
    tagsHealth = r;
    var list = tagsWaiters; tagsWaiters = [];
    list.forEach(function(f){ try { f(r); } catch (e) { console.error(e); } });
  }).catch(function(){
    tagsChecking = false;
    if (!tagsHealth) tagsRetry = setTimeout(tagsCheck, Math.min(60000, 5000 * Math.pow(2, tagsTries++)));
  });
}
document.addEventListener('visibilitychange', function(){ if (!document.hidden && !tagsHealth && tagsWaiters.length) { tagsTries = 0; tagsCheck(); } });
/* JSON to the tag service (as text/plain: no browser preflight request needed) */
function tagPostJson(route, body) {
  return fetch(TAGS + route, {method: 'POST', headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(body)})
    .then(function(r){ return r.json(); }).then(tagNoWrite);
}

/* process a list in chunks one after another; fn(chunk) -> Promise */
function tagInChunks(list, size, fn) {
  var i = 0;
  function step() {
    if (i >= list.length) return Promise.resolve();
    var part = list.slice(i, i + size);
    i += part.length;
    return fn(part, i).then(step);
  }
  return step();
}

/* tagPost, but repeat it after a network error (screen locked, Wi-Fi gone, tag service restarting).
   Safe for /write: files already written come back as unchanged, and the change log keeps them under the same batch */
function tagPostRetry(route, body) {
  var n = 0;
  function attempt() {
    return tagPost(route, body).catch(function(e){
      if (!(e instanceof TypeError) || n >= TAG_RETRY.length) throw e;
      tagStatus.textContent = T('tag.retrying');
      return new Promise(function(ok){ setTimeout(ok, TAG_RETRY[n++]); }).then(attempt);
    }).then(function(res){ if (res && n) res.retried = true; return res; });
  }
  return attempt();
}

function tagBulkStart(heading) {
  tagMode = 'artist';
  var seq = ++artSeq;
  artFiles = []; artBad = []; artChanges = []; artUi = null;
  document.getElementById('tagTitle').textContent = heading;
  tagBatch = null; tagUndo.style.display = 'none'; tagSave.disabled = true; tagSave.textContent = T('tag.save');
  tagStatus.textContent = '';
  overlayTags.classList.add('on');
  return seq;
}

function tagBulkFail(seq, e) {
  if (e.message === 'abgebrochen' || seq !== artSeq) return;
  tagMsg(e instanceof TypeError ? T('tag.serviceDownPort', {port: (window.APP_CONFIG && window.APP_CONFIG.TAGS_PORT) || 8766})
                                : T('tag.error', {error: e.message}));
}

/* read the files' tags in chunks, then show bulk editing */
function tagBulkLoad(seq, uris) {
  return tagInChunks(uris, TAG_CHUNK * 2, function(part, done){
    if (seq !== artSeq) return Promise.reject(new Error('abgebrochen'));
    tagMsg(T('tag.readingProgress', {done: langNum(Math.min(done, uris.length)), total: langNum(uris.length)}));
    return tagPost('/read', {uris: part}).then(function(r){
      if (!r.ok) throw new Error(r.error || T('tag.readFailed'));
      r.items.forEach(function(it){
        if (it.ok) artFiles.push({uri: it.uri, tags: it.tags || {}}); else artBad.push({uri: it.uri, error: it.error || ''});
      });
    });
  }).then(function(){ if (seq === artSeq) artistRender(); });
}

/* all local tracks of an artist (pen in the artist view) */
function openArtistEditor(name) {
  var seq = tagBulkStart(name);
  artName = name;
  artReload = function(){ openArtistEditor(name); };
  tagMsg(T('tag.searchingTracks'));
  tagGetJson('/artist?name=' + encodeURIComponent(name)).then(function(res){
    if (!res.ok) throw new Error(res.error || T('tag.searchFailed'));
    if (!res.files.length) { tagMsg(T('tag.noArtistTracks')); return; }
    return tagBulkLoad(seq, res.files);
  }).catch(function(e){ tagBulkFail(seq, e); });
}

/* specific files, e.g. an album ("Bulk edit" button in the album editor);
   preset {field, value}: preset the field to "Set" with this value and show the preview right away */
function openBulkEditor(uris, heading, preset) {
  var seq = tagBulkStart(heading);
  artPreset = preset || null;
  artReload = function(){ openBulkEditor(uris, heading); };
  tagBulkLoad(seq, uris).catch(function(e){ tagBulkFail(seq, e); });
}

/* readable reason for a file the tag service could not read (its errors are short English texts) */
var TAG_EXT_RE = /\.(m4a|mp4|m4b|flac|mp3|dsf)$/i;   /* same list as EXT_RE in tags/tag-service.js */
function tagWhy(uri, error) {
  var ext = (String(uri).match(/\.([^.\/]+)$/) || [])[1];
  if (!TAG_EXT_RE.test(uri)) return T('tag.why.format', {ext: ext ? '.' + ext.toLowerCase() : '?'});
  if (error === 'file not found') return T('tag.why.missing');
  if (error === 'path not allowed') return T('tag.why.path');
  if (/permission denied|EACCES|EPERM/i.test(error)) return T('tag.why.perm');
  if (/timeout/i.test(error)) return T('tag.why.timeout');
  return T('tag.why.broken', {error: error || '?'});
}

/* collapsible list of the unreadable files with folder, file name and reason */
function tagBadList(bad) {
  var box = document.createElement('details');
  box.className = 'tagBad';
  var sum = document.createElement('summary');
  sum.textContent = T('tag.bulk.showUnreadable');
  box.appendChild(sum);
  bad.forEach(function(f){
    var row = document.createElement('div');
    row.className = 'tagRow err';
    var name = document.createElement('div');
    name.className = 'tagBadName';
    name.textContent = String(f.uri).split('/').slice(-2).join(' / ');
    name.title = f.uri;
    var why = document.createElement('div');
    why.textContent = tagWhy(f.uri, f.error);
    row.appendChild(name); row.appendChild(why);
    box.appendChild(row);
  });
  return box;
}

function artistRender() {
  while (tagBody.firstChild) tagBody.removeChild(tagBody.firstChild);
  var albums = {};
  artFiles.forEach(function(f){ albums[(f.tags.album || '').toLowerCase()] = true; });
  var n = Object.keys(albums).length;
  var info = document.createElement('div');
  info.className = 'tagInfo';
  info.textContent = T('tag.bulk.info', {tracks: T('tag.bulk.tracks', {n: artFiles.length}), albums: T('tag.bulk.albums', {n: n})}) +
    (artBad.length ? T('tag.bulk.unreadable', {n: artBad.length}) : '');
  tagBody.appendChild(info);
  if (artBad.length) tagBody.appendChild(tagBadList(artBad));

  var ui = artUi = {
    field: tagSelect(TAG_BULK_FIELDS, artUi ? artUi.field.value : 'artist'),
    action: tagSelect(TAG_BULK_ACTIONS, artUi ? artUi.action.value : 'words'),
    value: tagInput(''), find: tagInput(''), repl: tagInput(''), pattern: tagInput(artUi ? artUi.pattern.value : '%TITLE% - %ARTIST%'),
    preview: document.createElement('button'),
    list: document.createElement('div')
  };
  ui.value.placeholder = T('tag.bulk.valuePh');
  ui.find.placeholder = T('tag.bulk.findPh');
  ui.repl.placeholder = T('tag.bulk.replPh');
  var genreMenu = tagGenreMenu(ui.value);
  var fValue = tagField(T('tag.bulk.value'), ui.value, genreMenu), fFind = tagField(T('tag.bulk.find'), ui.find), fRepl = tagField(T('tag.bulk.repl'), ui.repl);
  var fPattern = tagField(T('tag.bulk.pattern'), ui.pattern);
  var hint = document.createElement('div');
  hint.className = 'tagHint';
  hint.textContent = T('tag.bulk.patternHint');
  fPattern.appendChild(hint);
  var fField = tagField(T('tag.bulk.field'), ui.field);
  tagBody.appendChild(fField);
  tagBody.appendChild(tagField(T('tag.bulk.action'), ui.action));
  tagBody.appendChild(fValue); tagBody.appendChild(fFind); tagBody.appendChild(fRepl); tagBody.appendChild(fPattern);
  ui.preview.className = 'tagBtn'; ui.preview.textContent = T('tag.bulk.preview');
  tagBody.appendChild(ui.preview);
  ui.list.className = 'tagPreview';
  tagBody.appendChild(ui.list);

  function sync() {
    var a = ui.action.value;
    fValue.style.display = a === 'set' ? '' : 'none';
    genreMenu.style.display = ui.field.value === 'genre' ? '' : 'none';
    fFind.style.display = fRepl.style.display = a === 'replace' ? '' : 'none';
    fPattern.style.display = a === 'split' ? '' : 'none';
    fField.firstChild.textContent = a === 'split' ? T('tag.bulk.fieldSplit') : T('tag.bulk.field');
    artChanges = []; ui.list.innerHTML = ''; tagSave.disabled = true; tagStatus.textContent = '';
  }
  [ui.field, ui.action].forEach(function(el){ el.addEventListener('change', sync); });
  [ui.value, ui.find, ui.repl, ui.pattern].forEach(function(el){ el.addEventListener('input', function(){
    if (artChanges.length) { artChanges = []; ui.list.innerHTML = ''; tagSave.disabled = true; tagStatus.textContent = ''; }
  }); });
  ui.preview.addEventListener('click', artistPreview);
  sync();
  if (artPreset) {
    ui.field.value = artPreset.field; ui.action.value = 'set'; sync();
    ui.value.value = artPreset.value || '';
    artPreset = null;
    if (ui.value.value) artistPreview(); else ui.value.focus();
  }
}

/* new value of a field after the chosen action */
function artistNewValue(old) {
  var a = artUi.action.value;
  if (a === 'set') return artUi.value.value.trim();
  if (a === 'replace') return textReplace(old, artUi.find.value, artUi.repl.value);
  return textFunc(a)(old);
}

/* changed fields from split values -> {tags, label} or null */
function artistSplitTags(f, values) {
  var tags = {}, parts = [];
  Object.keys(values).forEach(function(k){
    if (values[k] === (f.tags[k] || '')) return;
    tags[k] = values[k];
    parts.push((TAG_LABELS[k] || k) + ': ' + (values[k] || T('tag.empty')));
  });
  return parts.length ? {tags: tags, label: parts.join(' · ')} : null;
}

/* changes to one file after the chosen action -> [{from, to, tags}] (empty: no change);
   when splitting, null if the pattern does not match; ambiguous: two mutually exclusive variants */
function artistChanges(f, field, pat) {
  var from = f.tags[field] || '';
  if (pat) {
    var r = textSplit(from, pat);
    if (!r) return null;
    var a = artistSplitTags(f, r.tags);
    if (!r.ambiguous) return a ? [{from: from, to: a.label, tags: a.tags}] : [];
    var b = artistSplitTags(f, r.alt), out = [];
    if (a) out.push({from: from, to: a.label, tags: a.tags, ambiguous: 1});
    if (b) out.push({from: from, to: b.label, tags: b.tags, ambiguous: 2});
    return out;
  }
  var to = artistNewValue(from);
  if (to === from) return [];
  var t = {}; t[field] = to;
  return [{from: from, to: to, tags: t}];
}

/* compute changes and show them grouped (same change "old -> new" = one row) */
function artistPreview() {
  var field = artUi.field.value, action = artUi.action.value, groups = {}, order = [], pat = null, skipped = 0;
  if (action === 'replace' && !artUi.find.value) { tagStatus.textContent = T('tag.bulk.findMissing'); return; }
  if (action === 'split') {
    pat = textPattern(artUi.pattern.value);
    if (pat.error) { tagStatus.textContent = T('tag.bulk.patternError', {error: pat.error}); return; }
  }
  artFiles.forEach(function(f, n){
    var cs = artistChanges(f, field, pat);
    if (!cs) { skipped++; return; }
    cs.forEach(function(c){
      var key = c.ambiguous ? n + '\u0000' + c.ambiguous : c.from + '\u0000' + c.to;    /* do not merge variants */
      if (!groups[key]) { c.files = []; groups[key] = c; order.push(key); }
      groups[key].files.push(f);
    });
  });
  artChanges = order.map(function(k){ return groups[k]; });
  artChanges.forEach(function(g, k){ g.order = k; });
  artChanges.sort(function(x, y){ return x.from.localeCompare(y.from) || x.order - y.order; });
  var list = artUi.list;
  list.innerHTML = '';
  if (skipped) list.appendChild(browseNote(T('tag.bulk.skipped', {n: skipped})));
  if (!artChanges.length) { list.appendChild(browseNote(T('tag.bulk.noChanges'))); tagSave.disabled = true; tagStatus.textContent = ''; return; }
  artChanges.forEach(function(g, k){
    var row = document.createElement('label');
    row.className = 'tagChange' + (g.ambiguous ? ' unsure' : '');
    g.check = document.createElement('input');
    g.check.type = 'checkbox'; g.check.checked = !g.ambiguous;      /* ambiguous: check only after review */
    g.check.addEventListener('change', function(){
      if (g.ambiguous && g.check.checked) {                      /* only one of the two variants */
        var other = artChanges[g.ambiguous === 1 ? k + 1 : k - 1];
        if (other && other.files[0] === g.files[0] && other.ambiguous) other.check.checked = false;
      }
      artistCount();
    });
    var txt = document.createElement('div');
    txt.className = 'tagChangeText';
    var a = document.createElement('div'); a.className = 'tagOld'; a.textContent = g.from || T('tag.empty');
    var b = document.createElement('div'); b.className = 'tagNew'; b.textContent = '→ ' + (g.to || T('tag.empty'));
    txt.appendChild(a); txt.appendChild(b);
    var sub = document.createElement('div');
    sub.className = 'tagChangeSub';
    sub.textContent = (g.ambiguous ? T('tag.bulk.ambiguous', {k: g.ambiguous}) : '') + (g.files.length > 1 ? T('tag.bulk.tracks', {n: g.files.length})
      : (field === 'title' ? (g.files[0].tags.album || '') : (g.files[0].tags.title || '')));
    if (sub.textContent) txt.appendChild(sub);
    row.appendChild(g.check); row.appendChild(txt);
    list.appendChild(row);
  });
  artistCount();
}

function artistSelected() {
  var items = [];
  artChanges.forEach(function(g){
    if (!g.check.checked) return;
    g.files.forEach(function(f){ items.push({uri: f.uri, tags: g.tags, file: f}); });
  });
  return items;
}

function artistCount() {
  var n = artistSelected().length;
  tagSave.disabled = !n;
  tagStatus.textContent = n ? T('tag.bulk.willChange', {n: n}) : T('tag.bulk.noneSelected');
}

/* saving in chunks still running: leaving the page (reload, closing the tab) would stop it halfway, so the browser asks first.
   Closing the overlay is fine, saving goes on in the background */
var tagWriting = 0;
window.addEventListener('beforeunload', function(ev){
  if (!tagWriting) return;
  ev.preventDefault();
  ev.returnValue = '';
});

/* write in chunks (shared ID for undo), have MPD rescan only once at the end */
function artistSave() {
  var items = artistSelected();
  if (!items.length) return;
  var batch = Date.now().toString(36), changed = [], errs = [];
  tagSave.disabled = true; artUi.preview.disabled = true;
  tagWriting++;
  tagInChunks(items, TAG_WRITE_CHUNK, function(part, done){
    tagStatus.textContent = T('tag.savingProgress', {done: langNum(Math.min(done, items.length)), total: langNum(items.length)});
    return tagPostRetry('/write', {items: part.map(function(it){ return {uri: it.uri, tags: it.tags}; }), batch: batch, scan: false})
      .then(function(res){
        if (!res.ok) throw new Error(res.error || T('tag.writeFailed'));
        res.items.forEach(function(r, k){
          var it = part[k];
          if (!r.ok) { errs.push(r.error); return; }
          if (!r.changed && res.retried) changed.push(it.uri);   /* may have been written by the lost first attempt */
          if (r.changed) { changed.push(it.uri); Object.keys(r.after || {}).forEach(function(f){ it.file.tags[f] = r.after[f]; }); }
        });
      });
  }).then(function(){
    return changed.length ? tagPost('/scan', {uris: changed}).catch(function(){ return {ok: false}; }) : {ok: true};
  }).then(function(scan){
    tagBatch = changed.length ? batch : null;
    tagUndo.style.display = tagBatch ? '' : 'none';
    artistRender();
    tagStatus.textContent = (changed.length ? T('tag.filesChanged', {n: changed.length}) : T('tag.nothingChanged')) +
      (errs.length ? T('tag.errSuffix', {n: errs.length, error: errs[0]}) : '') +
      (changed.length && !(scan && scan.ok && scan.scan !== false) ? T('tag.rescanHint') : '');
    if (changed.length) tagRefreshView();
  }).catch(function(e){
    tagBatch = changed.length ? batch : null;            /* what was already written stays undoable */
    tagUndo.style.display = tagBatch ? '' : 'none';
    artUi.preview.disabled = false;
    tagStatus.textContent = (e instanceof TypeError ? T('tag.serviceDown') : T('tag.error', {error: e.message})) +
      (changed.length ? T('tag.alreadyChanged', {n: changed.length}) : '');
    if (changed.length) tagPost('/scan', {uris: changed}).catch(function(){});
  }).then(function(){ tagWriting--; });
}

/* after changes, reload the view as soon as MPD has rescanned the files */
function tagRefreshView() {
  setTimeout(function(){
    if (overlayBrowse.classList.contains('on') && browseStack.length) browseRender();
    if (overlayQueue.classList.contains('on')) loadQueue();
    if (overlaySearch.classList.contains('on') && searchQuery) doSearch(searchQuery);
    lastKey = null; lastLyrKey = null;               /* player: fetch info and lyrics again with the new tags */
  }, 4000);
}

tagSave.addEventListener('click', function(){
  if (tagMode === 'artist') return artistSave();
  tagSave.disabled = true; tagStatus.textContent = T('tag.saving');
  tagPost('/write', {items: tagCollect()}).then(function(res){
    if (!res.ok) { tagStatus.textContent = T('tag.error', {error: res.error || T('tag.unknown')}); tagSave.disabled = false; return; }
    var changed = 0, errs = [];
    res.items.forEach(function(r){
      if (!r.ok) errs.push(r.error); else if (r.changed) changed++;
    });
    tagBatch = res.batch;
    tagUndo.style.display = tagBatch ? '' : 'none';
    tagStatus.textContent = (changed ? T('tag.filesChanged', {n: changed}) : T('tag.nothingChanged')) +
      (errs.length ? T('tag.errSuffix', {n: errs.length, error: errs[0]}) : '') +
      (changed && res.scan === false ? T('tag.rescanHintMpc') : '');
    tagSave.disabled = false;
    if (changed) tagRefreshView();
  }).catch(function(){ tagStatus.textContent = T('tag.serviceDown'); tagSave.disabled = false; });
});

tagUndo.addEventListener('click', function(){
  if (!tagBatch) return;
  tagUndo.style.display = 'none'; tagStatus.textContent = T('tag.undoing');
  tagPost('/undo', {batch: tagBatch}).then(function(res){
    showToast(res.ok ? T('tag.undone') : T('tag.undoFailed', {error: res.error || ''}));
    tagBatch = null;
    if (tagMode === 'artist' && artReload) artReload();    /* reload bulk editing with the old values */
    else overlayTags.classList.remove('on');
    tagRefreshView();
  }).catch(function(){ tagStatus.textContent = T('tag.serviceDown'); });
});

document.getElementById('closeTags').addEventListener('click', function(){ overlayTags.classList.remove('on'); });
