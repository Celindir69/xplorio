/* Files and folders that macOS and Windows leave on a drive: they do not make a folder "not empty", are not copied and
   do not count as content of the trash. Folders such as .Trashes go with them (their content is also only leftovers).
   Not here: "$RECYCLE.BIN" and "System Volume Information" at the top of a drive (may hold things the user still wants).
   Node 8, ES5 only. */
var JUNK_FILE = /^(\.DS_Store|\._.*|Icon\r|\.localized|\.VolumeIcon\.icns|Thumbs\.db|ehthumbs(_vista)?\.db|desktop\.ini)$/i;
var JUNK_DIR = /^(\.Trashes|\.Spotlight-V100|\.fseventsd|\.TemporaryItems|\.DocumentRevisions-V100|\.AppleDouble|\.AppleDB|\.AppleDesktop)$/;
function junkFile(name) { return JUNK_FILE.test(String(name)); }
function junkDir(name) { return JUNK_DIR.test(String(name)); }
module.exports = {junkFile: junkFile, junkDir: junkDir};
