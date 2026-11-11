/* Small file checks for the library check: size of the ID3 block in DSF files, pixel size of cover images, and whether a
   folder name fits the album tag. Plus a cache per file and folder, so that the next check reads only what changed
   (key: MPD's last-modified of the song, mtime and size of the image).
   Node 8, ES5 only. */
var fs = require('fs'), path = require('path');

/* MPD 0.20 (Volumio 2) reads no tags at all from a DSF file whose ID3 block is larger than 1 MB (DsdLib) */
var DSF_TAG_LIMIT = 1024 * 1024;
var COVER_MIN_PX = 500;                  /* shorter side below: blurry on the iPad */
var COVER_MAX_BYTES = 2 * 1024 * 1024;   /* larger: loads slowly on every album page */

/* read len bytes from the start of a file -> cb(buffer or null) */
function head(file, len, cb) {
  fs.open(file, 'r', function(e, fd){
    if (e) return cb(null);
    var buf = Buffer.alloc ? Buffer.alloc(len) : new Buffer(len);
    fs.read(fd, buf, 0, len, 0, function(e2, n){
      fs.close(fd, function(){});
      cb(e2 ? null : buf.slice(0, n));
    });
  });
}

/* 64-bit little endian (DSF header) as a number; files stay far below 2^53 */
function u64(b, o) { return b.readUInt32LE(o) + b.readUInt32LE(o + 4) * 4294967296; }

/* DSF: "DSD " chunk: size of the whole file at 12, offset of the ID3 block at 20 (0: none) -> bytes of the ID3 block */
function dsfTagBytes(buf) {
  if (!buf || buf.length < 28 || buf.toString('latin1', 0, 4) !== 'DSD ') return 0;
  var total = u64(buf, 12), meta = u64(buf, 20);
  return meta > 0 && total > meta ? total - meta : 0;
}
function dsfTagSize(file, cb) { head(file, 28, function(b){ cb(dsfTagBytes(b)); }); }

/* JPEG (first SOF marker) or PNG (IHDR) -> {w, h} or null; reads at most the first 256 kB (EXIF thumbnails come first) */
function imageDims(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return {w: buf.readUInt32BE(16), h: buf.readUInt32BE(20)};
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  var o = 2;
  while (o + 9 < buf.length) {
    if (buf[o] !== 0xff) { o++; continue; }
    var m = buf[o + 1];
    if (m === 0xff) { o++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { o += 2; continue; }
    var len = buf.readUInt16BE(o + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return {w: buf.readUInt16BE(o + 7), h: buf.readUInt16BE(o + 5)};
    o += 2 + len;
  }
  return null;
}
function imageSize(file, cb) { head(file, 256 * 1024, function(b){ cb(imageDims(b)); }); }

/* the cover image of a folder as players pick it: folder.jpg, cover.jpg, front.jpg, then any jpg/png */
var COVER_NAMES = ['folder', 'cover', 'front', 'albumart'];
function coverName(names) {
  var imgs = (names || []).filter(function(n){ return /\.(jpe?g|png)$/i.test(n) && n.charAt(0) !== '.'; });
  for (var i = 0; i < COVER_NAMES.length; i++) {
    for (var k = 0; k < imgs.length; k++) if (imgs[k].replace(/\.[^.]+$/, '').toLowerCase() === COVER_NAMES[i]) return imgs[k];
  }
  return imgs.sort()[0] || null;
}
/* -> 'small' | 'big' | null */
function coverFlaw(info) {
  if (!info) return null;
  if (info.w && info.h && Math.min(info.w, info.h) < COVER_MIN_PX) return 'small';
  if (info.bytes > COVER_MAX_BYTES) return 'big';
  return null;
}

/* ---------- folder name vs. album tag ---------- */
var UNKNOWN_DIR_RE = /^(unknown album|unbekanntes album|album inconnu|album sconosciuto|álbum desconocido|untitled|new folder|neuer ordner)$/i;
function norm(s) {
  s = String(s || '').toLowerCase();
  if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return s.replace(/&/g, ' and ').replace(/[\[({][^\])}]*[\])}]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
}
function words(s) { return norm(s).split(' ').filter(function(w){ return w && !/^(the|a|an|der|die|das|le|la|les|el|il)$/.test(w); }); }
/* folder name without a leading year ("1999 - …", "(1999) …") and without the artist in front ("Artist - Album") */
function bareFolder(name, artist) {
  var n = norm(name).replace(/^(19|20)\d\d\s+/, '').replace(/\s+(19|20)\d\d$/, '');
  var a = norm(artist);
  if (a && n.indexOf(a + ' ') === 0 && n.length > a.length + 1) n = n.slice(a.length + 1);
  return n;
}
/* does the folder name fit the album tag? Contained one in the other, or most words shared */
function folderFits(folder, album, artist) {
  var f = bareFolder(folder, artist), al = norm(album);
  if (!f || !al) return true;
  if (f === al || f.indexOf(al) >= 0 || al.indexOf(f) >= 0) return true;
  var fw = words(f), aw = words(al), shared = 0;
  if (!fw.length || !aw.length) return true;
  fw.forEach(function(w){ if (aw.indexOf(w) >= 0) shared++; });
  return shared / Math.min(fw.length, aw.length) >= 0.6;
}
/* -> {why: 'unknown' | 'differs'} or null. Only folders that hold one album (collection folders like "Singles" have
   several album tags and are fine). Disc folders ("CD2") count with the name of their parent. */
var DISC_DIR_RE = /^(cd|dis[ck]|disco|seite|side|vol(ume)?)[\s._-]*\d+\b/i;
function folderNameFlaw(dir, albums, artist) {
  var name = path.basename(dir);
  if (DISC_DIR_RE.test(name)) name = path.basename(path.dirname(dir));
  if (UNKNOWN_DIR_RE.test(name.trim())) return {why: 'unknown', folder: name};
  if (albums.length !== 1) return null;
  return folderFits(name, albums[0], artist) ? null : {why: 'differs', folder: name};
}

/* ---------- cache: what was read about files and folders in the last check ---------- */
function Cache(file) { this.file = file; this.old = {f: {}, d: {}}; this.cur = {f: {}, d: {}}; this.hits = 0; this.misses = 0; }
Cache.prototype.load = function() {
  try { var j = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (j && j.v === 1) this.old = {f: j.f || {}, d: j.d || {}}; }
  catch (e) { /* first check */ }
  return this;
};
/* value stored under key (file or folder) when its stamp is unchanged (no stamp: always read anew); it is kept for the next save */
Cache.prototype.get = function(kind, key, stamp, name) {
  var o = this.old[kind][key];
  if (stamp && o && o.s === stamp && o.hasOwnProperty(name)) { this.hits++; this.put(kind, key, stamp, name, o[name]); return {v: o[name]}; }
  this.misses++;
  return null;
};
Cache.prototype.put = function(kind, key, stamp, name, value) {
  var o = this.cur[kind][key];
  if (!o || o.s !== stamp) o = this.cur[kind][key] = {s: stamp};
  o[name] = value;
};
/* only what this check saw remains: deleted files leave the cache */
Cache.prototype.save = function(write) {
  write(this.file, JSON.stringify({v: 1, f: this.cur.f, d: this.cur.d}));
};

module.exports = {DSF_TAG_LIMIT: DSF_TAG_LIMIT, COVER_MIN_PX: COVER_MIN_PX, COVER_MAX_BYTES: COVER_MAX_BYTES,
                  dsfTagBytes: dsfTagBytes, dsfTagSize: dsfTagSize, imageDims: imageDims, imageSize: imageSize, coverName: coverName,
                  coverFlaw: coverFlaw, folderFits: folderFits, folderNameFlaw: folderNameFlaw, Cache: Cache};
