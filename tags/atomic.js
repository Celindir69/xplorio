/* Write a file so that after a power cut it holds either the old or the new content, never half of one:
   write a copy next to it, flush it to the disk, then rename it over the old file. Node 8, ES5 only. */
var fs = require('fs');

function writeAtomic(file, data) {
  var tmp = file + '.neu', fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

module.exports = {writeAtomic: writeAtomic};
