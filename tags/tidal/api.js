'use strict';

const API_BASE = 'https://api.tidal.com/v1/';
const CLIENT_VERSION = '2025.7.16';
const DEFAULT_TTL = 10 * 60 * 1000;
const MAX_RETRY_AFTER_MS = 10 * 1000;

class ApiError extends Error {
  constructor(status, body, path) {
    super('Tidal API ' + status + ' for ' + path);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

class TidalApi {
  constructor({ auth, fetch, now = Date.now, logger = console, defaultTtl = DEFAULT_TTL, sleep }) {
    this.auth = auth;
    this.fetch = fetch;
    this.now = now;
    this.logger = logger;
    this.defaultTtl = defaultTtl;
    this.sleep = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.cache = new Map();
  }

  _key(path, params) {
    return path + '?' + new URLSearchParams(params).toString();
  }

  async get(path, params = {}, { ttl } = {}) {
    const useTtl = ttl === undefined ? this.defaultTtl : ttl;
    const key = this._key(path, params);
    if (useTtl > 0) {
      const hit = this.cache.get(key);
      if (hit && hit.expires > this.now()) return hit.value;
    }
    const value = await this._request(path, params, true);
    if (useTtl > 0) this.cache.set(key, { value, expires: this.now() + useTtl });
    return value;
  }

  async _request(path, params, allowRetry) {
    const token = await this.auth.getAccessToken();
    const url = new URL(path.replace(/^\//, ''), API_BASE);
    const countryCode = this.auth.getCountryCode();
    if (countryCode && !url.searchParams.has('countryCode') && !('countryCode' in params)) {
      url.searchParams.set('countryCode', countryCode);
    }
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const res = await this.fetch(url, {
      headers: { authorization: 'Bearer ' + token, 'x-tidal-client-version': CLIENT_VERSION },
    });
    if (res.status === 401 && allowRetry) {
      await this.auth.refresh();
      return this._request(path, params, false);
    }
    if (res.status === 429 && allowRetry) {
      const retryAfter = Number(res.headers.get('retry-after')) || 1;
      await this.sleep(Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS));
      return this._request(path, params, false);
    }
    let body = null;
    try { body = await res.json(); } catch (e) { body = null; }
    if (!res.ok) throw new ApiError(res.status, body, path);
    return body;
  }

  async getAll(path, params = {}, { pageSize = 100, max = 1000, ttl } = {}) {
    const items = [];
    let offset = 0;
    let total = Infinity;
    while (offset < total && items.length < max) {
      const page = await this.get(path, { ...params, limit: pageSize, offset }, { ttl });
      const pageItems = Array.isArray(page && page.items) ? page.items : [];
      items.push(...pageItems);
      total = typeof page.totalNumberOfItems === 'number' ? page.totalNumberOfItems : offset + pageItems.length;
      if (pageItems.length === 0) break;
      offset += pageItems.length;
    }
    return items.slice(0, max);
  }

  flushCache() {
    this.cache.clear();
  }

  async loadSession() {
    const session = await this.get('sessions', {}, { ttl: 0 });
    if (session && session.countryCode) this.auth.setSession({ countryCode: session.countryCode });
    return session;
  }

  async loadSubscription() {
    const sub = await this.get('users/' + this.auth.getUserId() + '/subscription', {}, { ttl: 0 });
    const type = sub && sub.subscription && sub.subscription.type ? sub.subscription.type : '';
    const plan = type + (sub && sub.highestSoundQuality ? ' / ' + sub.highestSoundQuality : '');
    this.auth.setSession({ plan });
    return sub;
  }

  playbackInfo(trackId, quality) {
    return this.get('tracks/' + trackId + '/playbackinfopostpaywall', {
      playbackmode: 'STREAM',
      assetpresentation: 'FULL',
      audioquality: quality,
    }, { ttl: 0 });
  }
}

module.exports = { TidalApi, ApiError, API_BASE, CLIENT_VERSION };
