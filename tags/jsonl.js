/* JSON Lines Zeile für Zeile lesen, ohne die ganze Datei als Text und als Zeilenliste im Speicher zu halten
   (bei großen Dateien wie essentia.jsonl oder plays.jsonl sonst kurz das Doppelte bis Dreifache). Node 8, nur ES5. */
var fs = require('fs');

var CHUNK = 256 * 1024;

/* fn(zeile) für jede nicht leere Zeile; false, wenn die Datei fehlt oder nicht lesbar ist */
function eachLine(file, fn) {
  var fd;
  try { fd = fs.openSync(file, 'r'); } catch (e) { return false; }
  try {
    var buf = Buffer.alloc(CHUNK), rest = '', n;
    var dec = new (require('string_decoder').StringDecoder)('utf8');   /* Umlaute an Blockgrenzen nicht zerreißen */
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

/* Zeile als JSON; kaputte Zeilen ergeben null */
function parse(l) { try { return JSON.parse(l); } catch (e) { return null; } }

module.exports = {eachLine: eachLine, parse: parse, CHUNK: CHUNK};
