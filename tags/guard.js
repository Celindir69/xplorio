/* Access protection for the services on the player (tag service; rotel/rotel-bridge.js has a copy).
   - Host: only addresses from the home network (IP, name without dot, .local/.lan/…, own list).
     Protects against "DNS rebinding", where a foreign website points its name at the player.
   - Origin: if the browser sends an origin, it must belong to the same device.
     That way foreign websites can neither write nor read responses.
   - Modifying requests without Origin (curl, analyse.py) need the X-Xplorio header
     or a JSON content type; a foreign page cannot send either unnoticed. */

var LOCAL_SUFFIX = /\.(local|lan|home|internal|home\.arpa|fritz\.box|localdomain)$/;

/* "name:port" or "[::1]:port" -> name in lower case */
function hostName(h) {
  h = String(h || '').trim().toLowerCase();
  if (h.charAt(0) === '[') { var e = h.indexOf(']'); return e > 0 ? h.slice(1, e) : ''; }
  var i = h.indexOf(':');
  if (i >= 0 && h.indexOf(':', i + 1) < 0) h = h.slice(0, i);    /* IPv6 without brackets: unchanged */
  return h.replace(/\.$/, '');
}

function isIp(h) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || (h.indexOf(':') >= 0 && /^[0-9a-f:.]+$/.test(h));
}

/* extra: additional allowed names (APP_CONFIG.ALLOWED_HOSTS) */
function hostOk(h, extra) {
  var n = hostName(h);
  if (!n) return false;
  if ((extra || []).some(function(x){ return hostName(x) === n; })) return true;
  return n === 'localhost' || isIp(n) || /^[a-z0-9-]+$/.test(n) || LOCAL_SUFFIX.test(n);
}

/* origin "http://name:port" -> name, else '' ("null", file:, garbage) */
function originName(o) {
  var m = /^https?:\/\/([^\/?#]+)$/i.exec(String(o || '').trim());
  return m ? hostName(m[1].replace(/^[^@]*@/, '')) : '';
}

/* checks a request. Result: {ok, origin, reason}
   origin: the allowed origin for Access-Control-Allow-Origin ('' = none)
   write:  true for requests that change something */
function check(req, write, extra) {
  var h = req.headers || {}, host = h.host, origin = h.origin;
  if (!hostOk(host, extra)) return {ok: false, origin: '', reason: 'host'};
  if (origin !== undefined) {
    var on = originName(origin);
    if (!on || on !== hostName(host) && !(extra || []).some(function(x){ return hostName(x) === on; }))
      return {ok: false, origin: '', reason: 'origin'};
    return {ok: true, origin: String(origin).trim(), reason: ''};
  }
  if (write && !h['x-xplorio'] && !/^application\/(json|x-ndjson)\b/i.test(String(h['content-type'] || '')))
    return {ok: false, origin: '', reason: 'marker'};
  return {ok: true, origin: '', reason: ''};
}

/* CORS headers: only for the allowed origin */
function corsHeaders(origin) {
  var o = {'Vary': 'Origin'};
  if (origin) {
    o['Access-Control-Allow-Origin'] = origin;
    o['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    o['Access-Control-Allow-Headers'] = 'Content-Type, X-Xplorio';
    o['Access-Control-Max-Age'] = '600';
  }
  return o;
}

/* list from APP_CONFIG.ALLOWED_HOSTS or the environment variable XPLORIO_HOSTS ("a,b") */
function extraHosts(cfg, env) {
  var l = [].concat(cfg && cfg.ALLOWED_HOSTS || []);
  if (env) l = l.concat(String(env).split(','));
  return l.map(function(x){ return String(x).trim(); }).filter(Boolean);
}

module.exports = {hostName: hostName, hostOk: hostOk, originName: originName, check: check,
                  corsHeaders: corsHeaders, extraHosts: extraHosts};
