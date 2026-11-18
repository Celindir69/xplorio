'use strict';

const ROOT = 'tidal';
const MY_SECTIONS = ['playlists', 'albums', 'tracks', 'artists', 'mixes'];
const COLON_KINDS = ['album', 'artist', 'playlist', 'mix', 'track'];
const MY_PREFIX = ROOT + '/my/';
const HOME_PREFIX = ROOT + '/home/';
const COLON_RE = /^tidal:(album|artist|playlist|mix|track):([A-Za-z0-9-]+)$/;

function parse(uri) {
  if (typeof uri !== 'string') return null;
  if (uri === ROOT) return { kind: 'root' };
  if (uri.startsWith(MY_PREFIX)) {
    const section = uri.slice(MY_PREFIX.length);
    return MY_SECTIONS.includes(section) ? { kind: 'my', section } : null;
  }
  if (uri.startsWith(HOME_PREFIX)) {
    const apiPath = decodeURIComponent(uri.slice(HOME_PREFIX.length));
    return apiPath ? { kind: 'home', apiPath } : null;
  }
  const m = COLON_RE.exec(uri);
  if (m) return { kind: m[1], id: m[2] };
  return null;
}

function build(kind, id) {
  if (kind === 'root') return ROOT;
  if (kind === 'my') return MY_PREFIX + id;
  if (kind === 'home') return HOME_PREFIX + encodeURIComponent(id);
  if (COLON_KINDS.includes(kind)) return 'tidal:' + kind + ':' + id;
  throw new Error('Unknown Tidal uri kind: ' + kind);
}

module.exports = { ROOT, MY_SECTIONS, parse, build };
