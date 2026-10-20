/* Data folder of the tag service and credentials. Node 8, ES5 only.
   Data (history, Last.fm session, check, analysis …) lives in /data/xplorio/data: outside the web folder and
   outside /data/INTERNAL, which Volumio offers as a network share. It used to sit next to the program in
   /data/INTERNAL/tags; on first start it is moved. xplorio-deploy moves the /data/web-app folder.
   The Last.fm key and secret are in keys.json in the data folder (readable only by the service), no longer in
   web/config.local.js, which any browser on the network can load. */
var fs   = require('fs');
var path = require('path');

/* everything the service creates itself; program files stay where they are */
var DATA_FILES = ['changes.jsonl', 'covers', 'check.json', 'plays.jsonl', 'lastfm.json', 'albums.json',
  'library-tracks.json', 'essentia.jsonl', 'moodtags', 'artists', 'radio-covers', 'stations', 'lyrics-offsets.json'];
var KEYS_FILE = 'keys.json';

function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { return false; } }

/* create the data folder (readable only by the service) and move old data over from oldDir.
   If creating fails (parent folder missing or no permission), the old folder stays in use. -> {dir, moved:[…], error} */
function prepare(dir, oldDir, log) {
  log = log || function(){};
  try { fs.mkdirSync(dir, 448); }                          /* 0700 */
  catch (e) {
    if (e.code !== 'EEXIST') {
      log('cannot create data folder ' + dir + ' (' + e.code + '), staying with ' + oldDir);
      return {dir: oldDir, moved: [], error: e.code};
    }
  }
  try { fs.chmodSync(dir, 448); } catch (e) { /* owned by someone else */ }
  var moved = [];
  if (oldDir && oldDir !== dir && exists(oldDir)) {
    DATA_FILES.forEach(function(name){
      var src = path.join(oldDir, name), dst = path.join(dir, name);
      if (!exists(src) || exists(dst)) return;
      try { fs.renameSync(src, dst); moved.push(name); }
      catch (e) { log('moving ' + name + ' failed: ' + e.code); }
    });
    if (moved.length) log('data moved to ' + dir + ': ' + moved.join(', '));
  }
  return {dir: dir, moved: moved};
}

/* default data folder: dir as long as its parent folder exists or legacy is missing; else legacy
   (set up by hand under /data/web-app, not moved yet) */
function defaultDir(dir, legacy) {
  return exists(path.dirname(dir)) || !legacy || !exists(legacy) ? dir : legacy;
}

/* Last.fm credentials: environment before keys.json before (transitionally) config.local.js.
   If the credentials are only in config.local.js, they are copied to keys.json once. */
function Keys(dir, appConfig, log) {
  this.file = path.join(dir, KEYS_FILE);
  this.appConfig = appConfig;
  this.log = log || function(){};
}
/* reread only when keys.json has changed */
Keys.prototype.read = function() {
  var stamp = '-';
  try { var st = fs.statSync(this.file); stamp = st.mtime.getTime() + ':' + st.size; } catch (e) { /* missing */ }
  if (this.cache && this.stamp === stamp) return this.cache;
  var k = {};
  try { k = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (!k || typeof k !== 'object') k = {}; } catch (e) { k = {}; }
  this.cache = k; this.stamp = stamp;
  return k;
};
Keys.prototype.write = function(k) {
  fs.writeFileSync(this.file + '.neu', JSON.stringify(k, null, 2) + '\n', {mode: 384});   /* 0600 */
  fs.renameSync(this.file + '.neu', this.file);
  this.cache = null;
};
/* once at start: take values from config.local.js if keys.json does not have them yet */
Keys.prototype.migrate = function() {
  var c = this.appConfig(), k = this.read(), changed = false;
  ['LASTFM_KEY', 'LASTFM_SECRET'].forEach(function(n){ if (c[n] && !k[n]) { k[n] = c[n]; changed = true; } });
  if (!changed) return false;
  try { this.write(k); } catch (e) { this.log('keys.json not writable: ' + e.message); return false; }
  this.log('Last.fm credentials copied to ' + this.file + '; LASTFM_KEY and LASTFM_SECRET can be removed from web/config.local.js');
  return true;
};
Keys.prototype.lastfm = function() {
  var k = this.read(), c = this.appConfig();
  return {key: process.env.LASTFM_KEY || k.LASTFM_KEY || c.LASTFM_KEY || '',
          secret: process.env.LASTFM_SECRET || k.LASTFM_SECRET || c.LASTFM_SECRET || ''};
};
/* are key or secret still in the web folder? (hint for the UI) */
Keys.prototype.inWeb = function() {
  var c = this.appConfig();
  return !!(c.LASTFM_KEY || c.LASTFM_SECRET);
};

module.exports = {prepare: prepare, defaultDir: defaultDir, Keys: Keys, DATA_FILES: DATA_FILES};
