'use strict';
/* TIDAL on the Mac (PLAYER 'mpd'): the tag service's side of it. Login with the user's own TIDAL account (device code:
   TIDAL shows a short code, the user confirms it at link.tidal.com), browse and search in the shape of Volumio's answers,
   queue entries for MPD and seeking. The building blocks (auth, api, browse, items, uris, manifest, cache, proxy) come
   from Michal Tamas' Volumio TIDAL plugin (MIT, see LICENSE and README.md here).
   MPD gets addresses of a small proxy on this computer (http://127.0.0.1:7780/tidal/<id>.flac): it asks TIDAL for the
   stream only when MPD opens the track, ffmpeg turns TIDAL's segments into one FLAC file and keeps it in the cache.
   AAC and plain FLAC streams (no segments) go to MPD as a redirect to TIDAL's address.
   Title, artist, album and cover of each queued track are kept here (tidal-meta.json), MPD does not know them.
   Needs Node 18 or newer (fetch) and ffmpeg. Only loaded with PLAYER 'mpd'. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const { TidalAuth } = require('./auth');
const { TidalApi } = require('./api');
const { TidalBrowser } = require('./browse');
const { TrackCache } = require('./cache');
const { TrackProxy } = require('./proxy');
const { parsePlaybackInfo } = require('./manifest');
const uris = require('./uris');

const QUALITIES = ['HI_RES_LOSSLESS', 'LOSSLESS', 'HIGH'];
const LIMITS = [10, 20, 50];
const META_MAX = 3000;
const PENDING_TTL_MS = 60 * 60 * 1000;
const SEEK_WAIT_MS = 30 * 1000;
const SWITCH_TRIES = 20;
const ITEMS_MAX = 1000;

const I18N = {
  MY_COLLECTION: 'My collection', MY_PLAYLISTS: 'Playlists', MY_ALBUMS: 'Albums', MY_TRACKS: 'Tracks',
  MY_ARTISTS: 'Artists', MY_MIXES: 'Mixes', SHOW_MORE: 'More', TOP_TRACKS: 'Top tracks', ALBUMS: 'Albums',
  EPS_AND_SINGLES: 'EPs and singles', SIMILAR_ARTISTS: 'Similar artists'
};
/* headings of the search lists ("Tidal Artists" …): the interface sorts them by these words (web/js/streaming.js) */
const CORE_I18N = {
  'COMMON.SEARCH_ARTIST_SECTION': 'Artists', 'COMMON.SEARCH_ALBUM_SECTION': 'Albums',
  'COMMON.PLAYLISTS': 'Playlists', 'COMMON.TRACKS': 'Tracks'
};

class SeekError extends Error {
  constructor(code) { super('TIDAL seek: ' + code); this.code = code; }
}

/* small JSON file as the plugin's config store (get/set), written right away, only readable by the user */
function jsonFile(file) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch (e) { data = {}; }
  function save() {
    try {
      fs.writeFileSync(file + '.neu', JSON.stringify(data), { mode: 0o600 });
      fs.renameSync(file + '.neu', file);
    } catch (e) { /* reported by the caller's log at the next use */ }
  }
  return {
    get: (k, d) => (data[k] !== undefined ? data[k] : d),
    set: (k, v) => { data[k] = v; save(); },
    data: () => data,
    save
  };
}

function lineFields(lines) {
  const o = {};
  (lines || []).forEach((l) => {
    const i = l.indexOf(': ');
    if (i > 0) { const k = l.slice(0, i).toLowerCase(); if (!(k in o)) o[k] = l.slice(i + 2); }
  });
  return o;
}
function mpdQuote(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'; }

class TidalService {
  /* opts: dataDir, mpd(cmds, cb(err, lists)), fetch, spawn, ffmpeg, port, cacheDir, cacheMb, tmpDir, logger, sleep */
  constructor(opts) {
    this.o = opts;
    this.log = opts.logger || { info() {}, warn() {}, error() {} };
    this.fetch = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.store = jsonFile(path.join(opts.dataDir, 'tidal.json'));
    this.metaFile = path.join(opts.dataDir, 'tidal-meta.json');
    this.meta = new Map();
    try { (JSON.parse(fs.readFileSync(this.metaFile, 'utf8')) || []).forEach((m) => { if (m && m.id) this.meta.set(String(m.id), m); }); } catch (e) { /* none yet */ }
    this.metaTimer = null;
    this.auth = new TidalAuth({ store: this.store, fetch: this.fetch, logger: this.log });
    this.api = new TidalApi({ auth: this.auth, fetch: this.fetch, logger: this.log });
    this.browser = new TidalBrowser({ api: this.api, auth: this.auth, logger: this.log,
      i18n: (k) => I18N[k] || k, coreI18n: (k) => CORE_I18N[k] || k, searchLimit: this.searchLimit() });
    this.port = opts.port || 7780;
    this.cache = new TrackCache({ dir: opts.cacheDir || path.join(opts.dataDir, 'tidal-cache'),
      limitBytes: (opts.cacheMb || 1024) * 1024 * 1024, logger: this.log });
    const self = this;
    class Proxy extends TrackProxy {
      /* streams without segments (AAC, plain FLAC): MPD fetches them from TIDAL itself */
      async _serveStream(id, req, res) {
        let r;
        try { r = await self.resolve(id); } catch (e) {
          self.log.warn('TIDAL: track ' + id + ' not playable: ' + (e && e.message));
          res.writeHead(404); res.end(); return;
        }
        if (r.kind === 'bts') { res.writeHead(302, { Location: r.url }); res.end(); return; }
        return super._serveStream(id, req, res);
      }
    }
    this.proxy = new Proxy({ port: this.port, host: '127.0.0.1', cache: this.cache, resolve: (id) => this.resolve(id),
      spawn: opts.spawn, ffmpegPath: opts.ffmpeg || 'ffmpeg', logger: this.log,
      tmpDir: opts.tmpDir || path.join(os.tmpdir(), 'xplorio-tidal') });
    this.proxyUp = null;
    this.pending = new Map();
    this.login = null;              /* {deviceCode, userCode, url, expires, interval} while the user confirms */
    this.loginError = '';
    this.ffmpegOk = null;
  }

  available() { return Boolean(this.fetch); }
  loggedIn() { return this.available() && this.auth.isLoggedIn(); }
  quality() { const q = this.store.get('quality', 'HI_RES_LOSSLESS'); return QUALITIES.includes(q) ? q : 'HI_RES_LOSSLESS'; }
  searchLimit() { const n = Number(this.store.get('searchLimit', 20)); return LIMITS.includes(n) ? n : 20; }

  /* ffmpeg there? (once, then remembered) */
  checkFfmpeg() {
    if (this.ffmpegOk !== null) return Promise.resolve(this.ffmpegOk);
    return new Promise((resolve) => {
      const run = this.o.execFile || cp.execFile;
      run(this.o.ffmpeg || 'ffmpeg', ['-version'], { timeout: 10000 }, (e) => { this.ffmpegOk = !e; resolve(this.ffmpegOk); });
    });
  }

  /* the proxy runs while someone is logged in (also for tracks queued before a restart) */
  ensureProxy() {
    if (!this.proxyUp) {
      this.proxyUp = this.cache.init().then(() => this.proxy.start()).catch((e) => {
        this.proxyUp = null;
        this.log.error('TIDAL: proxy not started: ' + e.message);
        throw e;
      });
    }
    return this.proxyUp;
  }
  start() { if (this.loggedIn()) this.ensureProxy().catch(() => {}); }

  async status() {
    if (this.login && Date.now() > this.login.expires) { this.login = null; this.loginError = 'expired'; }
    return {
      ok: true, available: this.available(), ffmpeg: await this.checkFfmpeg(), loggedIn: this.loggedIn(),
      username: this.auth.getUsername(), plan: this.auth.getPlan(), quality: this.quality(), searchLimit: this.searchLimit(),
      login: this.login ? { code: this.login.userCode, url: this.login.url, expiresIn: Math.max(0, Math.round((this.login.expires - Date.now()) / 1000)) } : null,
      error: this.loginError
    };
  }

  /* {} state; {action: 'login'|'logout'}; {quality, searchLimit} */
  async handle(body) {
    body = body || {};
    if (!this.available()) return Object.assign(await this.status(), { ok: false, error: 'node' });
    if (body.action === 'login') { await this.loginStart(); return this.status(); }
    if (body.action === 'logout') { this.logout(); return this.status(); }
    if (body.quality !== undefined) {
      if (!QUALITIES.includes(body.quality)) return { ok: false, error: 'value' };
      this.store.set('quality', body.quality);
      this.pending.clear();
    }
    if (body.searchLimit !== undefined) {
      const n = Number(body.searchLimit);
      if (!LIMITS.includes(n)) return { ok: false, error: 'value' };
      this.store.set('searchLimit', n);
      this.browser.searchLimit = n;
    }
    return this.status();
  }

  async loginStart() {
    if (this.login && Date.now() < this.login.expires - 10000) return;
    this.loginError = '';
    const d = await this.auth.startDeviceLogin();
    let url = d.verificationUriComplete || d.verificationUri || 'link.tidal.com';
    if (!/^https?:\/\//.test(url)) url = 'https://' + url;
    const login = { deviceCode: d.deviceCode, userCode: d.userCode, url, expires: Date.now() + (Number(d.expiresIn) || 300) * 1000,
      interval: this.o.pollMs ? this.o.pollMs / 1000 : Math.max(2, Number(d.interval) || 2) };
    this.login = login;
    this.pollLogin(login);
  }

  pollLogin(login) {
    const t = setTimeout(async () => {
      if (this.login !== login) return;
      if (Date.now() > login.expires) { this.login = null; this.loginError = 'expired'; return; }
      let r;
      try { r = await this.auth.pollDeviceToken(login.deviceCode); } catch (e) { r = { status: 'pending' }; }
      if (this.login !== login) return;
      if (r.status === 'pending') return this.pollLogin(login);
      this.login = null;
      if (r.status !== 'ok') { this.loginError = r.status === 'expired' ? 'expired' : 'login'; return; }
      this.log.info('TIDAL: logged in as ' + (this.auth.getUsername() || this.auth.getUserId()));
      try { await this.api.loadSession(); await this.api.loadSubscription(); } catch (e) { this.log.warn('TIDAL: subscription unknown: ' + e.message); }
      this.ensureProxy().catch(() => {});
    }, login.interval * 1000);
    if (t.unref) t.unref();
  }

  logout() {
    this.login = null; this.loginError = '';
    this.auth.logout();
    this.api.flushCache();
    this.pending.clear();
  }

  handles(item) { return /^tidal([:/]|$)/.test(String((item && item.uri) || '')); }
  async browse(uri) {
    if (!this.loggedIn()) throw new Error('not logged in');
    return this.browser.browse(uri);
  }
  async search(q) {
    if (!this.loggedIn() || String(q || '').trim().length < 2 || q === '*') return [];
    return this.browser.search({ value: String(q).trim() });
  }

  /* an item (track, album, playlist, mix, artist: its top tracks) -> addresses for MPD; remembers what they are */
  async expand(item) {
    if (!this.loggedIn()) throw new Error('not logged in');
    await this.ensureProxy();
    const tracks = (await this.browser.explode(item.uri)).slice(0, ITEMS_MAX);
    const out = [];
    tracks.forEach((t) => {
      const p = uris.parse(t.uri);
      if (!p || p.kind !== 'track') return;
      this.meta.delete(String(p.id));
      this.meta.set(String(p.id), { id: String(p.id), title: t.title || '', artist: t.artist || '', album: t.album || '',
        albumart: t.albumart || '', duration: t.duration || 0 });
      out.push(this.proxy.urlFor(p.id));
    });
    this.saveMeta();
    return out;
  }
  saveMeta() {
    while (this.meta.size > META_MAX) this.meta.delete(this.meta.keys().next().value);
    if (this.metaTimer) return;
    this.metaTimer = setTimeout(() => {
      this.metaTimer = null;
      try { fs.writeFileSync(this.metaFile, JSON.stringify([...this.meta.values()])); } catch (e) { this.log.warn('TIDAL: ' + e.message); }
    }, 1000);
    if (this.metaTimer.unref) this.metaTimer.unref();
  }

  idOf(file) {
    const m = /^http:\/\/127\.0\.0\.1:(\d+)\/tidal\/([A-Za-z0-9-]+)\.flac$/.exec(String(file || ''));
    return m && Number(m[1]) === this.proxy.port ? m[2] : null;
  }

  /* MPD's state or queue entry for a proxy address -> as Volumio's TIDAL entries look (o is changed) */
  decorate(file, o) {
    const id = this.idOf(file);
    if (!id) return false;
    const m = this.meta.get(id) || {};
    o.uri = uris.build('track', id);
    o.service = 'tidal';
    o.trackType = 'tidal';
    if (o.stream !== undefined) o.stream = false;
    if (o.type !== undefined) o.type = 'song';
    if (m.title) { o.title = m.title; if (o.name !== undefined) o.name = m.title; }
    if (m.artist) o.artist = m.artist;
    if (m.album) o.album = m.album;
    o.albumart = m.albumart || '';
    if (!o.duration && m.duration) o.duration = m.duration;
    return true;
  }

  async resolve(id) {
    id = String(id);
    const hit = this.pending.get(id);
    if (hit && hit.expires > Date.now()) return hit.resolved;
    let info;
    const quality = (await this.checkFfmpeg()) ? this.quality() : 'HIGH';   /* without ffmpeg only AAC (one plain stream) */
    try { info = await this.api.playbackInfo(id, quality); } catch (e) {
      const b = e && e.body;
      throw new Error((b && (b.userMessage || b.subStatus)) || (e && e.message) || 'unavailable');
    }
    const resolved = parsePlaybackInfo(info);
    if (resolved.encrypted) throw new Error('encrypted stream');
    if (resolved.kind === 'bts' && !resolved.url) throw new Error('no stream address');
    this.pending.set(id, { resolved, expires: Date.now() + PENDING_TTL_MS });
    return resolved;
  }

  mpdP(cmds) { return new Promise((res, rej) => this.o.mpd(cmds, (e, lists) => (e ? rej(e) : res(lists)))); }

  /* seek in the track that plays. null: not a TIDAL proxy track (the caller seeks as usual).
     The proxy streams a track while it downloads, MPD cannot seek in that; once it is in the cache, the same address
     answers with a file that can be seeked, so MPD switches to a fresh copy right behind and the old entry goes. */
  async seek(sec) {
    const [stl, cur] = await this.mpdP(['status', 'currentsong']);
    const st = lineFields(stl), song = lineFields(cur);
    const id = this.idOf(song.file);
    if (!id) return null;
    const r = this.pending.get(id);
    if (r && r.resolved.kind === 'bts') return null;
    try { await this.mpdP(['seekcur ' + sec]); return { ok: true }; } catch (e) { /* still the live stream */ }
    const deadline = Date.now() + SEEK_WAIT_MS;
    while (!this.cache.isComplete(id)) {
      if (Date.now() >= deadline) throw new SeekError('downloading');
      await this.sleep(500);
      const now = lineFields((await this.mpdP(['currentsong']))[0]);
      if (now.id !== song.id) return { ok: true };         /* another track started meanwhile */
    }
    const pos = parseInt(st.song, 10) || 0;
    const added = lineFields((await this.mpdP(['addid ' + mpdQuote(song.file) + ' ' + (pos + 1)]))[0]);
    if (!added.id) throw new SeekError('mpd');
    await this.mpdP(['playid ' + added.id]);
    let switched = false;
    for (let i = 0; i < SWITCH_TRIES && !switched; i++) {
      const s = lineFields((await this.mpdP(['status']))[0]);
      switched = s.songid === added.id && s.state === 'play';
      if (!switched) await this.sleep(150);
    }
    if (switched) await this.mpdP(['seekcur ' + sec]).catch(() => {});
    await this.mpdP(['deleteid ' + song.id]).catch(() => {});
    if (st.state === 'pause') await this.mpdP(['pause 1']).catch(() => {});
    return { ok: switched };
  }

  stop() { return this.proxy.stop(); }
}

module.exports = { TidalService, QUALITIES, LIMITS, jsonFile };
