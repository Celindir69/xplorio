/* Trash list in its own process (tag service GET /trash): on large or slow drives (USB, network) walking and measuring the
   trash folders takes a while, and the tag service must keep answering meanwhile. Message {root, journal} -> trash.list. */
var trash = require('./trash.js');
process.on('message', function(m){
  var r;
  try { r = trash.list(m.root, m.journal); r.ok = true; } catch (e) { r = {ok: false, error: e.message}; }
  process.send(r, function(){ process.exit(0); });
});
