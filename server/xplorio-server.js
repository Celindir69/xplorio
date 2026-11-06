/* Xplorio's own web server: serves the interface from the plugin folder (nothing below /volumio, so Volumio's
   integrity check before a system update stays intact) and passes everything else through to Volumio on port 3000
   (/api/v1, /socket.io including WebSocket, /albumart, music files). For the browser it is one address, so the
   interface works as before. HTTP, port 4040. Runs on Node 8 (ES5 syntax only), no packages needed.
   Runs as the plugin's systemd service xplorio-web (settings from /tmp/xplorio/xplorio-web.env, see plugin/index.js). */
var http = require('http');
var net  = require('net');
var fs   = require('fs');
var path = require('path');
var url  = require('url');
var zlib = require('zlib');

var DEFAULTS = {
  port:        parseInt(process.env.HTTP_PORT || '4040', 10),
  volumioHost: process.env.VOLUMIO_HOST || '127.0.0.1',
  volumioPort: parseInt(process.env.VOLUMIO_PORT || '3000', 10),
  www:         process.env.XPLORIO_WWW || path.join(__dirname, '..')
};

/* files of the interface; everything else belongs to Volumio */
var OURS = /^\/(xplorio\.html|web\/.*)$/;
var TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
             '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
             '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8'};

var GZ_TYPES = /^\.(html|js|css|json|svg|txt|webmanifest)$/;

/* opts: port, volumioHost, volumioPort, www (folder of the interface) (see DEFAULTS) -> http.Server */
function create(opts) {
  var o = {};
  Object.keys(DEFAULTS).forEach(function(k){ o[k] = opts && opts[k] !== undefined ? opts[k] : DEFAULTS[k]; });
  o.www = path.resolve(o.www);
  /* request path -> file in the interface folder, null if not ours or outside the folder */
  function fileFor(pathname) {
    var p;
    try { p = decodeURIComponent(pathname); } catch (e) { return null; }
    if (p === '/') p = '/xplorio.html';
    if (!OURS.test(p) || p.indexOf('\0') >= 0) return null;
    var f = path.join(o.www, p);
    return f.indexOf(o.www + path.sep) === 0 ? f : null;
  }

  /* text files compressed once and kept (the whole interface is about 1 MB, compressed a quarter of it) */
  var gzCache = {};
  function gzipped(f, st, cb) {
    var key = f + ':' + st.size + ':' + st.mtime.getTime(), c = gzCache[f];
    if (c && c.key === key) return cb(null, c.buf);
    fs.readFile(f, function(err, raw){
      if (err) return cb(err);
      zlib.gzip(raw, {level: 9}, function(e, buf){
        if (e) return cb(e);
        gzCache[f] = {key: key, buf: buf};
        cb(null, buf);
      });
    });
  }

  function serveFile(req, res, f) {
    fs.stat(f, function(err, st){
      if (err || !st.isFile()) { res.writeHead(404, {'Content-Type': 'text/plain'}); return res.end('not found'); }
      var ext = path.extname(f).toLowerCase(), gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '') && GZ_TYPES.test(ext);
      /* scripts, styles and languages come with ?v=<build> (a hash over all interface files): a new build has a new address,
         so the browser keeps them; everything else is checked every time and answered with 304 when unchanged */
      var forever = /^v=[\w-]+$/.test(url.parse(req.url).query || '') && ext !== '.html';
      var mod = st.mtime.toUTCString(), tag = '"' + st.size.toString(16) + '-' + st.mtime.getTime().toString(16) + (gz ? '-gz' : '') + '"';
      var head = {'Content-Type': TYPES[ext] || 'application/octet-stream',
                  'Cache-Control': forever ? 'public, max-age=31536000, immutable' : 'no-cache', 'Last-Modified': mod, 'ETag': tag,
                  'Vary': 'Accept-Encoding'};
      if (req.headers['if-none-match'] === tag || (!req.headers['if-none-match'] && req.headers['if-modified-since'] === mod)) {
        res.writeHead(304, head); return res.end();
      }
      if (gz) return gzipped(f, st, function(e, buf){
        if (e) { res.writeHead(500, {'Content-Type': 'text/plain'}); return res.end('read error'); }
        head['Content-Encoding'] = 'gzip'; head['Content-Length'] = buf.length;
        res.writeHead(200, head);
        res.end(req.method === 'HEAD' ? undefined : buf);
      });
      head['Content-Length'] = st.size;
      res.writeHead(200, head);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(f).on('error', function(){ res.destroy(); }).pipe(res);
    });
  }

  /* pass through to Volumio, unchanged (method, headers, body; also Range for music files) */
  function proxy(req, res) {
    var up = http.request({host: o.volumioHost, port: o.volumioPort, method: req.method, path: req.url, headers: req.headers}, function(r){
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
    var up = net.connect(o.volumioPort, o.volumioHost, function(){
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
    if (f) return serveFile(req, res, f);
    proxy(req, res);
  });
  server.on('upgrade', tunnel);
  server.fileFor = fileFor;
  return server;
}

module.exports = {create: create, DEFAULTS: DEFAULTS};

if (require.main === module) {
  create().listen(DEFAULTS.port, function(){
    console.log('xplorio-server on port ' + DEFAULTS.port + ', interface from ' + DEFAULTS.www + ', Volumio on ' + DEFAULTS.volumioHost + ':' + DEFAULTS.volumioPort);
  });
}
