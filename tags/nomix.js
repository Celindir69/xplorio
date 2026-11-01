/* "NoMix": tracks with NoMix in the comment tag never go into a mix (mood mix, dice, similar, together), like "don't like",
   but kept in the files and independent of the rating. The tag service cannot read comments for the whole library
   (MPD leaves the comment tag out), so it learns them two ways:
   - written through Xplorio (tag editor, bulk editor, undo): kept in nomix.json, by file ("USB/…");
   - from the audio analysis (tools/essentia/analyse.py reads the comment, field "nomix" in essentia.jsonl).
   Node 8, ES5 only. */
var fs = require('fs');

var MARK_RE = /nomix/i;
function marked(comment) { return MARK_RE.test(String(comment || '')); }

function Store(file) { this.file = file; this.data = null; this.rev = 0; }   /* rev: counts changes (cache) */

Store.prototype.load = function() {
  if (this.data) return this.data;
  var d = null;
  try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { /* none yet */ }
  this.data = d && d.files && typeof d.files === 'object' ? d : {files: {}};
  return this.data;
};

/* file: "USB/…"; comment: the comment now in the file -> true if the list changed */
Store.prototype.noteComment = function(file, comment) {
  var f = this.load().files, on = marked(comment);
  if (!file || !!f[file] === on) return false;
  if (on) f[file] = 1; else delete f[file];
  this.rev++;
  try { fs.writeFileSync(this.file + '.neu', JSON.stringify(this.data)); fs.renameSync(this.file + '.neu', this.file); }
  catch (e) { console.log('nomix.json: ' + e.message); }
  return true;
};

/* files excluded from mixes: {file: true}; disliked: ratings' "don't like" {file: true};
   tracks [[artist, title, file, sec., album], …] with audioOf(artist, title, album) -> analysis entry (field nomix) */
Store.prototype.excluded = function(disliked, tracks, audioOf) {
  var out = {}, f = this.load().files;
  Object.keys(disliked || {}).forEach(function(k){ out[k] = true; });
  Object.keys(f).forEach(function(k){ out[k] = true; });
  (tracks || []).forEach(function(t){
    if (out[t[2]]) return;
    var a = audioOf(t[0], t[1], t[4]);
    if (a && a.nomix) out[t[2]] = true;
  });
  return out;
};

module.exports = {Store: Store, marked: marked};
