/* Xplorio's own web server: serves the interface from /data/xplorio/www (nothing below /volumio, so Volumio's
   integrity check before a system update stays intact) and passes everything else through to Volumio on port 3000
   (/api/v1, /socket.io including WebSocket, /albumart, music files). For the browser it is one address, so the
   interface works as before. HTTP, port 4040. Runs on Node 8 (ES5 syntax only), no packages needed. */
var http = require('http');
var net  = require('net');
var fs   = require('fs');
var path = require('path');
var url  = require('url');

var HTTP_PORT    = parseInt(process.env.HTTP_PORT || '4040', 10);
var VOLUMIO_HOST = process.env.VOLUMIO_HOST || '127.0.0.1';
var VOLUMIO_PORT = parseInt(process.env.VOLUMIO_PORT || '3000', 10);
var WWW          = process.env.XPLORIO_WWW || path.join(__dirname, '..', 'www');
var VOLUMIO_HTTP = process.env.VOLUMIO_HTTP || '/volumio/http';   /* earlier installation: config.local.js from there */

/* files of the interface; everything else belongs to Volumio */
var OURS = /^\/(xplorio\.html|app\.html|kioskTV\.html|web\/.*)$/;
var TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
             '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
             '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'};

/* web/config.local.js: own settings, from the own folder; until then (parallel to an installation in /volumio)
   read from there, only read */
function configFile() {
  var own = path.join(WWW, 'web', 'config.local.js');
  if (exists(own)) return own;
  var dirs = [];
  try { dirs = fs.readdirSync(VOLUMIO_HTTP).filter(function(d){ return /^www/.test(d); }).sort().reverse(); } catch (e) { /* no Volumio */ }
  for (var i = 0; i < dirs.length; i++) {
    var f = path.join(VOLUMIO_HTTP, dirs[i], 'web', 'config.local.js');
    if (exists(f)) return f;
  }
  return null;
}
function exists(f) { try { return fs.statSync(f).isFile(); } catch (e) { return false; } }

/* request path -> file in WWW, null if not ours or outside the folder */
function fileFor(pathname) {
  var p;
  try { p = decodeURIComponent(pathname); } catch (e) { return null; }
  if (p === '/') p = '/xplorio.html';
  if (!OURS.test(p) || p.indexOf('\0') >= 0) return null;
  if (p === '/web/config.local.js') return configFile() || '';
  var f = path.join(WWW, p);
  return f.indexOf(WWW + path.sep) === 0 ? f : null;
}

function serveFile(req, res, f) {
  fs.stat(f, function(err, st){
    if (err || !st.isFile()) { res.writeHead(404, {'Content-Type': 'text/plain'}); return res.end('not found'); }
    /* the HTML loads scripts and styles with ?v=<build>: check every time, answer 304 when unchanged */
    var mod = st.mtime.toUTCString(), tag = '"' + st.size.toString(16) + '-' + st.mtime.getTime().toString(16) + '"';
    var head = {'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream',
                'Cache-Control': 'no-cache', 'Last-Modified': mod, 'ETag': tag};
    if (req.headers['if-none-match'] === tag || (!req.headers['if-none-match'] && req.headers['if-modified-since'] === mod)) {
      res.writeHead(304, head); return res.end();
    }
    head['Content-Length'] = st.size;
    res.writeHead(200, head);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f).on('error', function(){ res.destroy(); }).pipe(res);
  });
}

/* pass through to Volumio, unchanged (method, headers, body; also Range for music files) */
function proxy(req, res) {
  var up = http.request({host: VOLUMIO_HOST, port: VOLUMIO_PORT, method: req.method, path: req.url, headers: req.headers}, function(r){
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on('error', function(){
    if (!res.headersSent) { res.writeHead(502, {'Content-Type': 'text/plain'}); res.end('Volumio does not answer'); } else res.destroy();
  });
  req.pipe(up);
}

/* WebSocket (socket.io): forward the upgrade request as it is, then connect both sides */
function tunnel(req, sock, head) {
  sock.pause();                                               /* hold what the browser sends until Volumio is connected */
  var up = net.connect(VOLUMIO_PORT, VOLUMIO_HOST, function(){
    var lines = [req.method + ' ' + req.url + ' HTTP/' + req.httpVersion];
    for (var i = 0; i < req.rawHeaders.length; i += 2) lines.push(req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    up.pipe(sock); sock.pipe(up);
  });
  function close() { up.destroy(); sock.destroy(); }
  up.on('error', close); sock.on('error', close);
  up.setNoDelay(true); sock.setNoDelay(true);
}

var server = http.createServer(function(req, res){
  var f = (req.method === 'GET' || req.method === 'HEAD') ? fileFor(url.parse(req.url).pathname) : null;
  if (f === '') { res.writeHead(404, {'Content-Type': 'text/plain'}); return res.end('not found'); }   /* no config.local.js */
  if (f) return serveFile(req, res, f);
  proxy(req, res);
});
server.on('upgrade', tunnel);

module.exports = {server: server, fileFor: fileFor};

if (require.main === module) {
  server.listen(HTTP_PORT, function(){ console.log('xplorio-server on port ' + HTTP_PORT + ', interface from ' + WWW + ', Volumio on ' + VOLUMIO_HOST + ':' + VOLUMIO_PORT); });
}
