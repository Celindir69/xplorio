/* Data folder of the tag service and credentials. Node 8, ES5 only.
   Data (history, Last.fm session, check, analysis …) lives in /data/xplorio/data: outside the plugin folder (stays on
   updates) and outside /data/INTERNAL, which Volumio offers as a network share.
   The Last.fm key and secret are in keys.json in the data folder (readable only by the service; the plugin's
   settings page writes them), never in web/config.local.js, which any browser on the network can load. */
var fs   = require('fs');
var path = require('path');

var KEYS_FILE = 'keys.json';

/* create the data folder (readable only by the service) -> {dir, error} */
function prepare(dir, log) {
  log = log || function(){};
  try { fs.mkdirSync(dir, 448); }                          /* 0700 */
  catch (e) {
    if (e.code !== 'EEXIST') { log('cannot create data folder ' + dir + ' (' + e.code + ')'); return {dir: dir, error: e.code}; }
  }
  try { fs.chmodSync(dir, 448); } catch (e) { /* owned by someone else */ }
  return {dir: dir};
}

/* Last.fm credentials: environment before keys.json */
function Keys(dir) {
  this.file = path.join(dir, KEYS_FILE);
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
Keys.prototype.lastfm = function() {
  var k = this.read();
  return {key: process.env.LASTFM_KEY || k.LASTFM_KEY || '', secret: process.env.LASTFM_SECRET || k.LASTFM_SECRET || ''};
};

module.exports = {prepare: prepare, Keys: Keys};
