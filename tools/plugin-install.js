/* plugin-install: installs or updates the Xplorio plugin through Volumio's own websocket (the same events as Volumio's
   plugin page). "volumio plugin install" hangs forever on some Volumio 2 devices (e.g. Musical Fidelity MX-Stream);
   this way works there too. Called by xplorio-deploy --plugin as user volumio, Node 8, ES5 only.
     node plugin-install.js install|update <zip name in /tmp/plugins> [category] [name]
   Exit code 0 when Volumio reports 100 %, 1 on an error or after 90 s without an answer. */
var mode = process.argv[2], zip = process.argv[3];
var category = process.argv[4] || 'user_interface', name = process.argv[5] || 'xplorio';
var TIMEOUT = 90000;
if ((mode !== 'install' && mode !== 'update') || !/^[A-Za-z0-9_.-]+\.zip$/.test(zip || '')) {
  console.error('usage: node plugin-install.js install|update <file.zip> [category] [name]');
  process.exit(2);
}
var io;
try { io = require(process.env.SOCKET_IO_CLIENT || '/volumio/node_modules/socket.io-client'); }
catch (e) { console.error('socket.io-client from Volumio not found: ' + e.message); process.exit(1); }

var url = 'http://127.0.0.1:3000/plugin-serve/' + zip;      /* Volumio moves /tmp/plugins/<zip> instead of downloading */
var socket = io.connect(process.env.VOLUMIO_URL || 'http://127.0.0.1:3000', {reconnection: true});
var sent = false, done = false, heard = false;

function send() {
  if (sent) return;
  sent = true;
  console.log(mode === 'install' ? 'Installing the plugin …' : 'Updating the plugin …');
  if (mode === 'install') socket.emit('installPlugin', {url: url, confirm: true});
  else socket.emit('updatePlugin', {url: url, category: category, name: name});
}
function end(code, text) {
  if (done) return;
  done = true;
  console.log(text);
  try { socket.close(); } catch (e) { /* already closed */ }
  process.exit(code);
}
socket.on('connect', send);
/* after a lost connection send again, but only if Volumio has not started yet (afterwards the zip is moved away) */
socket.on('reconnect', function(){ if (!heard) { sent = false; send(); } });
socket.on('installPluginStatus', function(d){
  d = d || {}; heard = true;
  var msg = String(d.message || '').replace(/<[^>]*>/g, '');
  if (d.progress === 100) return end(0, '[100%] ' + msg);
  if (d.progress === 0 && sent) return end(1, 'Volumio reports an error: ' + msg);
  console.log('[' + d.progress + '%] ' + msg);
});
/* socket.io reconnects by itself, e.g. while Volumio is still busy right after the start */
socket.on('connect_error', function(e){ console.error('no connection to Volumio yet: ' + (e && e.message || e)); });
setTimeout(function(){ end(1, 'No answer from Volumio after ' + TIMEOUT / 1000 + ' s; see: sudo journalctl -u volumio -f'); }, TIMEOUT);
