/* read JSON Lines line by line, without holding the whole file as text and as a line list in memory
   (for large files like essentia.jsonl or plays.jsonl that would briefly be two to three times as much). Node 8, ES5 only. */
var fs = require('fs');

var CHUNK = 256 * 1024;

/* fn(line) for each non-empty line; false if the file is missing or not readable */
function eachLine(file, fn) {
  var fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return false; }
  try {
    var buf = Buffer.alloc(CHUNK), rest = '', n;
    var dec = new (require('string_decoder').StringDecoder)('utf8');   /* don't split multi-byte characters at chunk boundaries */
    while ((n = fs.readSync(fd, buf, 0, CHUNK, null)) > 0) {
      var txt = rest + dec.write(buf.slice(0, n)), start = 0, i;
      while ((i = txt.indexOf('\n', start)) >= 0) {
        if (i > start) fn(txt.slice(start, i));
        start = i + 1;
      }
      rest = txt.slice(start);
    }
    rest += dec.end();
    if (rest) fn(rest);
    return true;
  } catch (e) {
    return false;
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
  }
}

/* line as JSON; broken lines yield null */
function parse(l) { try { return JSON.parse(l); } catch (e) { return null; } }

module.exports = {eachLine: eachLine, parse: parse, CHUNK: CHUNK};
