'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const FFMPEG_BASE_ARGS = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-flush_packets', '1'];
const TRACK_RE = /^\/tidal\/([A-Za-z0-9-]+)\.flac$/;
const POLL_MS = 100;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// "drain" never comes once the listener has gone: wait for whichever happens first
function waitDrain(res) {
  return new Promise((resolve) => {
    const done = () => { res.removeListener('drain', done); res.removeListener('close', done); res.removeListener('error', done); resolve(); };
    res.once('drain', done); res.once('close', done); res.once('error', done);
  });
}

class TrackProxy {
  constructor({ port = 7780, host = '127.0.0.1', cache, resolve, spawn = require('child_process').spawn, fsp = fs.promises, tmpDir = '/tmp/tidal', ffmpegPath = 'ffmpeg', pollMs = POLL_MS, logger = console }) {
    this.port = port;
    this.host = host;
    this.cache = cache;
    this.resolve = resolve;
    this.spawn = spawn;
    this.fsp = fsp;
    this.tmpDir = tmpDir;
    this.ffmpegPath = ffmpegPath;
    this.pollMs = pollMs;
    this.logger = logger;
    this.server = null;
    this.fill = null; // { id, child }
  }

  urlFor(id) {
    return 'http://' + this.host + ':' + this.port + '/tidal/' + id + '.flac';
  }

  isFilling(id) {
    return Boolean(this.fill && this.fill.id === String(id));
  }

  readerCount(id) {
    return this.fill && this.fill.id === String(id) ? this.fill.readers : 0;
  }

  // Only a download nobody is listening to may be replaced: cutting one that still feeds
  // MPD would truncate the track that is playing, which is exactly what happens a few
  // seconds before the end of a track when the next one is prefetched.
  _retireIdleFill() {
    if (this.fill && this.fill.readers === 0) this.killFill();
  }

  async start() {
    await this.fsp.mkdir(this.tmpDir, { recursive: true });
    this.server = http.createServer((req, res) => {
      this._handle(req, res).catch((err) => {
        this.logger.error('Tidal proxy error: ' + (err && err.message));
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.port = this.server.address().port;
        resolve();
      });
    });
    this.logger.info('Tidal proxy listening on ' + this.host + ':' + this.port);
  }

  async stop() {
    this.killFill();
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    if (server.closeAllConnections) server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  killFill() {
    if (!this.fill) return;
    const { child } = this.fill;
    this.fill = null;
    child.kill('SIGKILL');
  }

  async _handle(req, res) {
    const m = TRACK_RE.exec((req.url || '').split('?')[0]);
    if (!m || req.method !== 'GET') {
      res.writeHead(404);
      res.end();
      return;
    }
    const id = m[1];
    if (this.cache.isComplete(id)) return this._serveFile(id, req, res);
    return this._serveStream(id, req, res);
  }

  async _serveFile(id, req, res) {
    const file = this.cache.filePath(id);
    const st = await this.fsp.stat(file);
    await this.cache.touch(id);
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    let start = 0;
    let end = st.size - 1;
    const partial = Boolean(range && (range[1] || range[2]));
    if (partial) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(Number(range[2]), st.size - 1);
      } else {
        start = Math.max(st.size - Number(range[2]), 0);
      }
      if (start > end || start >= st.size) {
        res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
        res.end();
        return;
      }
    }
    const headers = { 'Content-Type': 'audio/flac', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
    if (partial) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
    res.writeHead(partial ? 206 : 200, headers);
    const stream = fs.createReadStream(file, { start, end });
    stream.pipe(res);
    req.on('close', () => stream.destroy());
  }

  // One download per track, never attached to the listener's socket. ffmpeg used to write
  // the pipe and the cache file in lockstep, so MPD reading at playback speed throttled
  // the download to about 0.4 MB/s and the cached copy (the one seeking needs) was only
  // ready when the track had all but finished. Now ffmpeg fills the cache at full speed
  // and the response follows that file as it grows.
  async _startFill(id, playlist) {
    this._retireIdleFill();
    await this.cache.discard(id);
    const args = [...FFMPEG_BASE_ARGS, '-i', playlist, '-map', '0:a', '-c:a', 'copy', '-f', 'flac', '-y', this.cache.partPath(id)];
    const child = this.spawn(this.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const fill = { id, child, done: false, readers: 0 };
    this.fill = fill;

    let stderr = '';
    if (child.stderr) child.stderr.on('data', (d) => { stderr += d; if (stderr.length > 4000) stderr = stderr.slice(-4000); });
    child.on('error', (err) => this.logger.error('Tidal proxy ffmpeg error: ' + err.message));
    child.on('close', async (code) => {
      fill.done = true;
      try {
        if (code === 0) {
          await this.cache.commit(id);
          this.logger.info('Tidal cache stored track ' + id);
        } else {
          if (code !== null) this.logger.warn('Tidal ffmpeg exited ' + code + ' for ' + id + ': ' + stderr.trim());
          await this.cache.discard(id);
        }
      } catch (err) {
        this.logger.error('Tidal cache update failed for ' + id + ': ' + err.message);
      } finally {
        if (this.fill === fill) this.fill = null;
      }
    });
    return fill;
  }

  async _openWhenReady(id, fill, isClosed) {
    const deadline = Date.now() + 10000;
    for (;;) {
      if (isClosed()) return null;
      for (const candidate of [this.cache.partPath(id), this.cache.filePath(id)]) {
        try {
          return await this.fsp.open(candidate, 'r');
        } catch (err) {
          if (err.code !== 'ENOENT') throw err;
        }
      }
      if (fill.done || Date.now() > deadline) return null;
      await sleep(this.pollMs);
    }
  }

  async _streamGrowingFile(id, fill, isClosed, res) {
    const handle = await this._openWhenReady(id, fill, isClosed);
    if (!handle) {
      if (!res.writableEnded) res.end();
      return;
    }
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    try {
      while (!isClosed()) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (bytesRead > 0) {
          position += bytesRead;
          if (!res.write(Buffer.from(buffer.subarray(0, bytesRead)))) {
            await waitDrain(res);   // also ends when MPD hangs up, or the file handle stays open forever
          }
          continue;
        }
        if (fill.done) break;
        await sleep(this.pollMs);
      }
    } catch (err) {
      this.logger.warn('Tidal proxy stream for ' + id + ' ended: ' + err.message);
    } finally {
      await handle.close().catch(() => {});
      if (!res.writableEnded) res.end();
    }
  }

  async _serveStream(id, req, res) {
    let resolved;
    try {
      resolved = await this.resolve(id);
    } catch (err) {
      this.logger.warn('Tidal proxy cannot resolve track ' + id + ': ' + (err && err.message));
      res.writeHead(404);
      res.end();
      return;
    }
    if (this.cache.isComplete(id)) return this._serveFile(id, req, res);

    const playlist = path.join(this.tmpDir, id + '.m3u8');
    await this.fsp.writeFile(playlist, resolved.hls);

    const fill = this.isFilling(id) ? this.fill : await this._startFill(id, playlist);
    // Count the listener before the first byte exists: otherwise a track starting in the
    // same moment would see a reader-less fill and replace it.
    fill.readers += 1;
    let closed = false;
    req.on('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'audio/flac', 'Transfer-Encoding': 'chunked' });
    try {
      await this._streamGrowingFile(id, fill, () => closed, res);
    } finally {
      fill.readers = Math.max(fill.readers - 1, 0);
    }
  }
}

module.exports = { TrackProxy, FFMPEG_BASE_ARGS };
