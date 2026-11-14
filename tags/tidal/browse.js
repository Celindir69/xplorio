'use strict';

const uris = require('./uris');
const items = require('./items');

const MY_TTL = 2 * 60 * 1000;
const PLAYLISTS_PAGE = 50; // Tidal: "Too big page, max page size is [50]"
const HOME_ROWS = 4;
const HOME_ROW_ITEMS = 12;
const PAGE = { deviceType: 'BROWSER' };

const MODULE_MAPPERS = {
  PLAYLIST_LIST: items.playlistItem,
  ALBUM_LIST: items.albumItem,
  TRACK_LIST: (t) => items.trackItem(t),
  MIX_LIST: items.mixItem,
};

const CATEGORIES = [
  { key: 'MY_PLAYLISTS', section: 'playlists', icon: 'playlist' },
  { key: 'MY_ALBUMS', section: 'albums', icon: 'album' },
  { key: 'MY_TRACKS', section: 'tracks', icon: 'track' },
  { key: 'MY_ARTISTS', section: 'artists', icon: 'artist' },
  { key: 'MY_MIXES', section: 'mixes', icon: 'mix' },
];

function list(itemsArr, { title, views = ['list', 'grid'] } = {}) {
  const l = { availableListViews: views, items: itemsArr };
  if (title) { l.type = 'title'; l.title = title; }
  return l;
}

function nav(lists, { info, prev = uris.ROOT } = {}) {
  const navigation = { prev: { uri: prev }, lists };
  if (info) navigation.info = info;
  return { navigation };
}

function moduleItems(mod) {
  if (!mod) return [];
  if (mod.pagedList && Array.isArray(mod.pagedList.items)) return mod.pagedList.items;
  return Array.isArray(mod.items) ? mod.items : [];
}

function pageModules(page) {
  const rows = page && Array.isArray(page.rows) ? page.rows : [];
  return rows.flatMap((r) => (Array.isArray(r.modules) ? r.modules : []));
}

function mapModule(mod) {
  const mapper = MODULE_MAPPERS[mod.type];
  if (!mapper) return null;
  let src = moduleItems(mod);
  if (mod.type === 'TRACK_LIST') src = src.filter(items.isPlayable);
  return src.map(mapper);
}

function tracksToItems(tracks, { album, queue = false } = {}) {
  return tracks.filter(items.isPlayable).map((t) => (queue ? items.queueItem(t, { album }) : items.trackItem(t, { album })));
}

class TidalBrowser {
  constructor({ api, auth, i18n, coreI18n = (k) => k, logger = console, searchLimit = 20 }) {
    this.searchLimit = searchLimit;
    this.api = api;
    this.auth = auth;
    this.i18n = i18n;
    this.coreI18n = coreI18n;
    this.logger = logger;
  }

  async browse(uri) {
    const p = uris.parse(uri);
    if (!p) throw new Error('Unknown Tidal uri: ' + uri);
    switch (p.kind) {
      case 'root': return this.root();
      case 'my': return this.my(p.section);
      case 'home': return this.homeMore(p.apiPath);
      case 'album': return this.album(p.id);
      case 'artist': return this.artist(p.id);
      case 'playlist': return this.playlist(p.id);
      case 'mix': return this.mix(p.id);
      default: throw new Error('Not browsable: ' + uri);
    }
  }

  async root() {
    const lists = [list(CATEGORIES.map((c) => items.categoryItem({ title: this.i18n(c.key), section: c.section, icon: c.icon })), { title: this.i18n('MY_COLLECTION') })];
    try {
      const page = await this.api.get('pages/home', PAGE);
      for (const mod of pageModules(page)) {
        if (lists.length > HOME_ROWS) break;
        const mapped = mapModule(mod);
        if (!mapped || !mapped.length) continue;
        const rowItems = mapped.slice(0, HOME_ROW_ITEMS);
        if (mod.showMore && mod.showMore.apiPath) {
          rowItems.push({ service: items.SERVICE, type: 'folder', title: this.i18n('SHOW_MORE'), icon: 'fa fa-ellipsis-h', uri: uris.build('home', mod.showMore.apiPath) });
        }
        lists.push(list(rowItems, { title: mod.title || '' }));
      }
    } catch (e) {
      this.logger.warn('Tidal home page unavailable: ' + (e && e.message));
    }
    return nav(lists);
  }

  async homeMore(apiPath) {
    const page = await this.api.get(apiPath, PAGE);
    let mapped = [];
    let title = page && page.title;
    for (const mod of pageModules(page)) {
      const m = mapModule(mod);
      if (m) { mapped = m; title = mod.title || title; break; }
    }
    return nav([list(mapped, { title })]);
  }

  async my(section) {
    const uid = this.auth.getUserId();
    const fav = (kind) => this.api.getAll('users/' + uid + '/favorites/' + kind, { order: 'DATE', orderDirection: 'DESC' }, { ttl: MY_TTL });
    let mapped;
    let views;
    if (section === 'playlists') {
      const raw = await this.api.getAll('users/' + uid + '/playlistsAndFavoritePlaylists', {}, { ttl: MY_TTL, pageSize: PLAYLISTS_PAGE });
      mapped = raw.map((r) => r.playlist).filter(Boolean).map(items.playlistItem);
    } else if (section === 'albums') {
      mapped = (await fav('albums')).map((r) => r.item).filter(Boolean).map(items.albumItem);
    } else if (section === 'tracks') {
      mapped = tracksToItems((await fav('tracks')).map((r) => r.item).filter(Boolean));
      views = ['list'];
    } else if (section === 'artists') {
      mapped = (await fav('artists')).map((r) => r.item).filter(Boolean).map(items.artistItem);
    } else {
      const page = await this.api.get('pages/my_collection_my_mixes', PAGE, { ttl: MY_TTL });
      mapped = pageModules(page).filter((m) => m.type === 'MIX_LIST').flatMap(moduleItems).map(items.mixItem);
    }
    return nav([list(mapped, { views })]);
  }

  async albumTracks(id) {
    const [album, tracks] = await Promise.all([this.api.get('albums/' + id), this.api.getAll('albums/' + id + '/tracks')]);
    return { album, tracks };
  }

  async album(id) {
    const { album, tracks } = await this.albumTracks(id);
    const info = { uri: uris.build('album', id), service: items.SERVICE, type: 'album', title: album.title, artist: items.artistNames(album), albumart: items.imageUrl(album.cover, 640), year: album.releaseDate ? String(album.releaseDate).slice(0, 4) : '' };
    return nav([list(tracksToItems(tracks, { album }), { views: ['list'] })], { info });
  }

  async optional(promise) {
    try { return await promise; } catch (e) { this.logger.warn('Tidal optional request failed: ' + (e && e.message)); return { items: [] }; }
  }

  async artist(id) {
    const base = 'artists/' + id;
    const [artist, top, albums, eps, similar] = await Promise.all([
      this.api.get(base),
      this.optional(this.api.get(base + '/toptracks', { limit: 20 })),
      this.optional(this.api.get(base + '/albums', { limit: 50 })),
      this.optional(this.api.get(base + '/albums', { filter: 'EPSANDSINGLES', limit: 50 })),
      this.optional(this.api.get(base + '/similar', { limit: 20 })),
    ]);
    const lists = [];
    const push = (arr, title, views) => { if (arr.length) lists.push(list(arr, { title, views })); };
    push(tracksToItems(top.items || []), this.i18n('TOP_TRACKS'), ['list']);
    push((albums.items || []).map(items.albumItem), this.i18n('ALBUMS'));
    push((eps.items || []).map(items.albumItem), this.i18n('EPS_AND_SINGLES'));
    push((similar.items || []).map(items.artistItem), this.i18n('SIMILAR_ARTISTS'));
    const info = { uri: uris.build('artist', id), service: items.SERVICE, type: 'artist', title: artist.name, albumart: items.imageUrl(artist.picture, 640) };
    return nav(lists, { info });
  }

  async playlistTracks(uuid) {
    return this.api.getAll('playlists/' + uuid + '/tracks');
  }

  async playlist(uuid) {
    const [playlist, tracks] = await Promise.all([this.api.get('playlists/' + uuid), this.playlistTracks(uuid)]);
    const info = { uri: uris.build('playlist', uuid), service: items.SERVICE, type: 'playlist', title: playlist.title, albumart: items.imageUrl(playlist.squareImage || playlist.image, 640) };
    return nav([list(tracksToItems(tracks), { views: ['list'] })], { info });
  }

  async mixPage(id) {
    const page = await this.api.get('pages/mix', { mixId: id, ...PAGE });
    const mod = pageModules(page).find((m) => m.type === 'TRACK_LIST');
    return { page, tracks: moduleItems(mod) };
  }

  async mix(id) {
    const { page, tracks } = await this.mixPage(id);
    const info = { uri: uris.build('mix', id), service: items.SERVICE, type: 'playlist', title: page.title || '' };
    return nav([list(tracksToItems(tracks), { views: ['list'] })], { info });
  }

  async search(query) {
    const value = query && query.value ? String(query.value) : '';
    if (!value) return [];
    const res = await this.api.get('search', { query: value, types: 'ARTISTS,ALBUMS,PLAYLISTS,TRACKS', limit: this.searchLimit });
    const lists = [];
    const section = (key, arr, views) => { if (arr.length) lists.push({ type: 'title', title: 'Tidal ' + this.coreI18n(key), availableListViews: views, items: arr }); };
    const pick = (k) => (res && res[k] && Array.isArray(res[k].items) ? res[k].items : []);
    section('COMMON.SEARCH_ARTIST_SECTION', pick('artists').map(items.artistItem), ['list', 'grid']);
    section('COMMON.SEARCH_ALBUM_SECTION', pick('albums').map(items.albumItem), ['list', 'grid']);
    section('COMMON.PLAYLISTS', pick('playlists').map(items.playlistItem), ['list', 'grid']);
    section('COMMON.TRACKS', tracksToItems(pick('tracks')), ['list']);
    return lists;
  }

  async explode(uri) {
    const p = uris.parse(uri);
    if (!p) return [];
    if (p.kind === 'track') {
      const t = await this.api.get('tracks/' + p.id);
      return tracksToItems([t], { queue: true });
    }
    if (p.kind === 'album') {
      const { album, tracks } = await this.albumTracks(p.id);
      return tracksToItems(tracks, { album, queue: true });
    }
    if (p.kind === 'playlist') return tracksToItems(await this.playlistTracks(p.id), { queue: true });
    if (p.kind === 'mix') return tracksToItems((await this.mixPage(p.id)).tracks, { queue: true });
    if (p.kind === 'artist') {
      const top = await this.optional(this.api.get('artists/' + p.id + '/toptracks', { limit: 20 }));
      return tracksToItems(top.items || [], { queue: true });
    }
    if (p.kind === 'my' && p.section === 'tracks') {
      const raw = await this.api.getAll('users/' + this.auth.getUserId() + '/favorites/tracks', { order: 'DATE', orderDirection: 'DESC' }, { ttl: MY_TTL });
      return tracksToItems(raw.map((r) => r.item).filter(Boolean), { queue: true });
    }
    return [];
  }

  async goto(data) {
    const type = data && data.type === 'album' ? 'album' : 'artist';
    const key = type === 'album' ? 'albums' : 'artists';
    const res = await this.api.get('search', { query: String(data.value || ''), types: key.toUpperCase(), limit: 1 });
    const hit = res && res[key] && res[key].items && res[key].items[0];
    if (!hit) return this.root();
    return this.browse(uris.build(type, hit.id));
  }
}

module.exports = { TidalBrowser };
