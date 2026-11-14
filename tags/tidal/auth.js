'use strict';

const AUTH_BASE = 'https://auth.tidal.com/v1/oauth2';
// Device-flow client used by python-tidal ("Android Automotive HiRes"); yields HI_RES_LOSSLESS.
const DEVICE_CLIENT = { id: 'fX2JxdmntZWK0ixT', secret: '1Nn9AfDAjxrgJFJbKNWLeAyKGVGmINuXPPLHVXAvxAg=' };
const SCOPE = 'r_usr w_usr w_sub';
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const SESSION_KEYS = ['access_token', 'refresh_token', 'user_id', 'country_code', 'username', 'plan'];

class AuthError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

class TidalAuth {
  constructor({ store, fetch, now = Date.now, logger = console }) {
    this.store = store;
    this.fetch = fetch;
    this.now = now;
    this.logger = logger;
  }

  async _post(path, data) {
    const res = await this.fetch(AUTH_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(data).toString(),
    });
    let json = {};
    try { json = await res.json(); } catch (e) { json = {}; }
    return { status: res.status, json: json || {} };
  }

  async startDeviceLogin() {
    const { status, json } = await this._post('/device_authorization', { client_id: DEVICE_CLIENT.id, scope: SCOPE });
    if (status !== 200 || !json.deviceCode) throw new AuthError('device_authorization_failed', 'HTTP ' + status);
    return {
      deviceCode: json.deviceCode,
      userCode: json.userCode,
      verificationUri: json.verificationUri,
      verificationUriComplete: json.verificationUriComplete,
      expiresIn: json.expiresIn,
      interval: json.interval || 2,
    };
  }

  async pollDeviceToken(deviceCode) {
    const { status, json } = await this._post('/token', {
      client_id: DEVICE_CLIENT.id,
      client_secret: DEVICE_CLIENT.secret,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      scope: SCOPE,
    });
    if (status === 200 && json.access_token) {
      this._saveTokens(json);
      return { status: 'ok' };
    }
    if (json.error === 'authorization_pending') return { status: 'pending' };
    if (json.error === 'expired_token') return { status: 'expired' };
    return { status: 'error', error: json.error || 'HTTP ' + status };
  }

  _saveTokens(json) {
    this.store.set('access_token', json.access_token);
    if (json.refresh_token) this.store.set('refresh_token', json.refresh_token);
    this.store.set('expires_at', this.now() + (Number(json.expires_in) || 0) * 1000);
    if (json.user) {
      if (json.user.userId !== undefined) this.store.set('user_id', String(json.user.userId));
      if (json.user.username) this.store.set('username', json.user.username);
      if (json.user.countryCode) this.store.set('country_code', json.user.countryCode);
    }
  }

  isLoggedIn() {
    return Boolean(this.store.get('refresh_token', ''));
  }

  async refresh() {
    const refreshToken = this.store.get('refresh_token', '');
    if (!refreshToken) throw new AuthError('not_logged_in');
    const { status, json } = await this._post('/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: DEVICE_CLIENT.id,
      client_secret: DEVICE_CLIENT.secret,
    });
    if (status === 200 && json.access_token) {
      this._saveTokens(json);
      return;
    }
    if (json.error === 'invalid_grant') {
      this.logger.warn('Tidal refresh token rejected, logging out');
      this.logout();
      throw new AuthError('invalid_grant', json.error_description || json.error);
    }
    throw new AuthError('refresh_failed', 'HTTP ' + status + (json.error ? ' ' + json.error : ''));
  }

  async getAccessToken() {
    if (!this.isLoggedIn()) throw new AuthError('not_logged_in');
    const expiresAt = Number(this.store.get('expires_at', 0)) || 0;
    if (!this.store.get('access_token', '') || expiresAt - this.now() < REFRESH_MARGIN_MS) {
      await this.refresh();
    }
    return this.store.get('access_token', '');
  }

  logout() {
    for (const key of SESSION_KEYS) this.store.set(key, '');
    this.store.set('expires_at', 0);
  }

  getUserId() { return this.store.get('user_id', ''); }
  getCountryCode() { return this.store.get('country_code', ''); }
  getUsername() { return this.store.get('username', ''); }
  getPlan() { return this.store.get('plan', ''); }

  setSession({ countryCode, plan } = {}) {
    if (countryCode) this.store.set('country_code', countryCode);
    if (plan !== undefined) this.store.set('plan', plan);
  }
}

module.exports = { TidalAuth, AuthError, DEVICE_CLIENT, AUTH_BASE };
