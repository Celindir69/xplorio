'use strict';

const uris = require('./uris');

const SERVICE = 'tidal';
const IMAGE_BASE = 'https://resources.tidal.com/images/';

function imageUrl(uuid, size) {
  if (!uuid) return '';
  return IMAGE_BASE + String(uuid).replace(/-/g, '/') + '/' + size + 'x' + size + '.jpg';
}

function artistNames(obj) {
  if (obj && Array.isArray(obj.artists) && obj.artists.length) {
    return obj.artists.map((a) => a && a.name).filter(Boolean).join(', ');
  }
  return obj && obj.artist && obj.artist.name ? obj.artist.name : '';
}

function isPlayable(track) {
  return Boolean(track) && track.streamReady !== false && track.allowStreaming !== false;
}

function isHiRes(track) {
  const tags = track && track.mediaMetadata && track.mediaMetadata.tags;
  return Array.isArray(tags) && tags.includes('HIRES_LOSSLESS');
}

function trackItem(track, { artSize = 320, album } = {}) {
  const alb = track.album || album || {};
  const item = {
    service: SERVICE,
    type: 'song',
    title: track.title,
    name: track.title,
    artist: artistNames(track),
    album: alb.title || '',
    albumart: imageUrl(alb.cover, artSize),
    uri: uris.build('track', track.id),
    duration: Math.round(Number(track.duration) || 0),
    trackType: 'tidal',
  };
  if (isHiRes(track)) item.samplerate = 'HiRes';
  return item;
}

function queueItem(track, { album } = {}) {
  return trackItem(track, { artSize: 640, album });
}

function albumItem(album) {
  return {
    service: SERVICE,
    type: 'folder',
    title: album.title,
    artist: artistNames(album),
    album: album.title,
    year: album.releaseDate ? String(album.releaseDate).slice(0, 4) : '',
    albumart: imageUrl(album.cover, 320),
    uri: uris.build('album', album.id),
  };
}

function artistItem(artist) {
  const item = {
    service: SERVICE,
    type: 'folder',
    title: artist.name,
    albumart: imageUrl(artist.picture, 320),
    uri: uris.build('artist', artist.id),
  };
  if (!artist.picture) item.icon = 'fa fa-user';
  return item;
}

function playlistItem(playlist) {
  return {
    service: SERVICE,
    type: 'playlist',
    title: playlist.title,
    albumart: imageUrl(playlist.squareImage || playlist.image, 320),
    uri: uris.build('playlist', playlist.uuid),
  };
}

function mixItem(mix) {
  const images = mix.images || {};
  const img = images.MEDIUM || images.SMALL || images.LARGE;
  return {
    service: SERVICE,
    type: 'playlist',
    title: mix.title,
    artist: mix.subTitle || '',
    albumart: img && img.url ? img.url : '',
    uri: uris.build('mix', mix.id),
  };
}

function categoryItem({ title, section, icon }) {
  return {
    service: SERVICE,
    type: 'streaming-category',
    title,
    artist: '',
    album: '',
    albumart: '/albumart?sourceicon=music_service/tidal/icons/' + icon + '.png',
    uri: uris.build('my', section),
  };
}

module.exports = { SERVICE, imageUrl, artistNames, isPlayable, isHiRes, trackItem, queueItem, albumItem, artistItem, playlistItem, mixItem, categoryItem };
