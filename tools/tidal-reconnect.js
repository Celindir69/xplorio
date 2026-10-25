/* Reconnect TIDAL without restarting Volumio: disable the plugin and enable it again
   (the switch in the plugin manager does the same). Runs on the MX-Stream:

     node /data/xplorio/tools/tidal-reconnect.js

   Node 8 is enough; uses Volumio's socket.io-client package. Do not run while TIDAL is playing. */
var io = require('/volumio/node_modules/socket.io-client');

var CATEGORY = 'music_service';
var PLUGIN = 'tidal';
var PAUSE_MS = 4000;      /* between off and on */
var SETTLE_MS = 8000;     /* after enabling, wait until Volumio reports it is done */

var socket = io('http://localhost:3000', { reconnection: false, timeout: 5000 });
var seen = [];

socket.on('connect_error', function (e) { console.log('No connection to Volumio:', e && e.message); process.exit(2); });
socket.on('pushToastMessage', function (m) {
  seen.push(m);
  console.log('Message from Volumio:', m && (m.type || '') , m && (m.message || m.title || ''));
});

socket.on('connect', function () {
  console.log('connected, disabling', PLUGIN, '...');
  socket.emit('disablePlugin', { category: CATEGORY, plugin: PLUGIN });
  setTimeout(function () {
    console.log('enabling', PLUGIN, '...');
    socket.emit('enablePlugin', { category: CATEGORY, plugin: PLUGIN });
    setTimeout(function () {
      console.log('done (' + seen.length + ' messages). Now try a TIDAL search in the app.');
      process.exit(0);
    }, SETTLE_MS);
  }, PAUSE_MS);
});
