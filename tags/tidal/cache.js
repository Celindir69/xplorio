'use strict';

const path = require('path');

const ID_RE = /^[A-Za-z0-9-]+$/;
const PART = '.flac.part';
const FLAC = '.flac';

class TrackCache {
  constructor({ dir, limitBytes, fsp = require('fs').promises, logger = console }) {
    this.dir = dir;
    this.limitBytes = limitBytes;
    this.fsp = fsp;
    this.logger = logger;
    this.index = new Map(); // id -> { size, mtimeMs }
  }

  _check(id) {
    id = String(id);
    if (!ID_RE.test(id)) throw new Error('Unsafe cache id: ' + id);
    return id;
  }

  filePath(id) { return path.join(this.dir, this._check(id) + FLAC); }
  partPath(id) { return path.join(this.dir, this._check(id) + PART); }

  async init() {
    await this.fsp.mkdir(this.dir, { recursive: true });
    this.index.clear();
    for (const name of await this.fsp.readdir(this.dir)) {
      const full = path.join(this.dir, name);
      if (name.endsWith(PART)) {
        await this.fsp.unlink(full).catch(() => {});
      } else if (name.endsWith(FLAC)) {
        const st = await this.fsp.stat(full);
        this.index.set(name.slice(0, -FLAC.length), { size: st.size, mtimeMs: st.mtimeMs });
      }
    }
    await this.evict();
  }

  isComplete(id) { return this.index.has(String(id)); }
  size(id) { const e = this.index.get(String(id)); return e ? e.size : 0; }
  totalBytes() { let t = 0; for (const e of this.index.values()) t += e.size; return t; }

  async touch(id) {
    const entry = this.index.get(String(id));
    if (!entry) return;
    const now = new Date();
    await this.fsp.utimes(this.filePath(id), now, now).catch(() => {});
    entry.mtimeMs = now.getTime();
  }

  async commit(id, { protect = [] } = {}) {
    id = this._check(id);
    await this.fsp.rename(this.partPath(id), this.filePath(id));
    const st = await this.fsp.stat(this.filePath(id));
    this.index.set(id, { size: st.size, mtimeMs: st.mtimeMs });
    await this.evict({ protect: [id, ...protect] });
  }

  async discard(id) {
    try {
      await this.fsp.unlink(this.partPath(id));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }

  async _remove(id) {
    await this.fsp.unlink(this.filePath(id)).catch(() => {});
    this.index.delete(id);
  }

  async evict({ protect = [] } = {}) {
    const protectedIds = new Set(protect.map(String));
    while (this.totalBytes() > this.limitBytes) {
      let oldest = null;
      for (const [id, e] of this.index) {
        if (protectedIds.has(id)) continue;
        if (!oldest || e.mtimeMs < oldest.mtimeMs) oldest = { id, mtimeMs: e.mtimeMs };
      }
      if (!oldest) break;
      this.logger.info('Tidal cache evicting ' + oldest.id);
      await this._remove(oldest.id);
    }
  }

  async clear({ protect = [] } = {}) {
    const protectedIds = new Set(protect.map(String));
    for (const id of [...this.index.keys()]) {
      if (!protectedIds.has(id)) await this._remove(id);
    }
  }

  async setLimit(bytes) {
    this.limitBytes = bytes;
    await this.evict();
  }
}

module.exports = { TrackCache };
