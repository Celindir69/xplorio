/* read JSON Lines line by line, without holding the whole file as text and as a line list in memory
   (for large files like essentia.jsonl or plays.jsonl that would briefly be two to three times as much). Node 8, ES5 only. */
var fs = require('fs');

var CHUNK = 256 * 1024;
var MAX_LINE = 1024 * 1024;      /* longer lines are skipped (no real entry is that long; a broken file would make reading slow) */

/* fn(line) for each non-empty line (up to MAX_LINE characters); false if the file is missing or not readable */
function eachLine(file, fn) {
  var fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return false; }
  try {
    var buf = Buffer.alloc(CHUNK), rest = '', n, skip = false;
    var dec = new (require('string_decoder').StringDecoder)('utf8');   /* don't split multi-byte characters at chunk boundaries */
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      var txt = rest + dec.write(buf.slice(0, n)), start = 0, i;
      while ((i = txt.indexOf('\n', start)) >= 0) {
        if (i > start && !skip) fn(txt.slice(start, i));
        start = i + 1; skip = false;
      }
      rest = txt.slice(start);
      if (rest.length > MAX_LINE) { rest = ''; skip = true; }   /* rest of this line too */
    }
    rest += dec.end();
    if (rest && !skip) fn(rest);
    return true;
  } catch (e) {
    return false;
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
  }
}

/* line as JSON; broken lines yield null */
function parse(l) { try { return JSON.parse(l); } catch (e) { return null; } }

module.exports = {eachLine: eachLine, parse: parse, CHUNK: CHUNK, MAX_LINE: MAX_LINE};
