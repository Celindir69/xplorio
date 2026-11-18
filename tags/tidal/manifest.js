'use strict';

function decodeManifest(b64) {
  return Buffer.from(String(b64 || ''), 'base64').toString('utf8');
}

function unescapeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function attr(xml, name) {
  const m = new RegExp('\\b' + name + '="([^"]*)"').exec(xml);
  return m ? unescapeXml(m[1]) : null;
}

function dashToHls(xml) {
  const init = attr(xml, 'initialization');
  const media = attr(xml, 'media');
  if (!init || !media) throw new Error('DASH manifest without SegmentTemplate');
  const timescale = Number(attr(xml, 'timescale')) || 1;
  const sampleRate = Number(attr(xml, 'audioSamplingRate')) || 0;
  const codecs = attr(xml, 'codecs') || '';
  const startNumber = Number(attr(xml, 'startNumber')) || 1;

  const segments = [];
  const re = /<S\b([^>]*?)\/?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const d = /\bd="(\d+)"/.exec(m[1]);
    const r = /\br="(\d+)"/.exec(m[1]);
    if (d) segments.push({ d: Number(d[1]), r: r ? Number(r[1]) : 0 });
  }
  if (!segments.length) throw new Error('DASH manifest without SegmentTimeline');

  const entries = [];
  let maxDuration = 0;
  let n = startNumber;
  for (const s of segments) {
    const duration = s.d / timescale;
    maxDuration = Math.max(maxDuration, duration);
    for (let k = 0; k <= s.r; k++) {
      entries.push('#EXTINF:' + duration.toFixed(3) + ',');
      entries.push(media.replace('$Number$', String(n++)));
    }
  }
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:7',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-TARGETDURATION:' + Math.ceil(maxDuration),
    '#EXT-X-MAP:URI="' + init + '"',
    ...entries,
    '#EXT-X-ENDLIST',
  ];
  return { hls: lines.join('\n') + '\n', sampleRate, codecs, segmentCount: n - startNumber };
}

function parsePlaybackInfo(json) {
  const mime = String(json.manifestMimeType || '');
  const text = decodeManifest(json.manifest);
  const base = {
    trackId: String(json.trackId),
    audioQuality: json.audioQuality,
    bitDepth: json.bitDepth || null,
    sampleRate: json.sampleRate || null,
  };
  if (mime.includes('vnd.tidal.bts')) {
    const bts = JSON.parse(text);
    return {
      ...base,
      kind: 'bts',
      codecs: bts.codecs || '',
      url: Array.isArray(bts.urls) ? bts.urls[0] : undefined,
      encrypted: Boolean(bts.encryptionType && bts.encryptionType !== 'NONE'),
    };
  }
  if (mime.includes('dash+xml')) {
    const dash = dashToHls(text);
    return {
      ...base,
      kind: 'dash',
      codecs: dash.codecs,
      sampleRate: base.sampleRate || dash.sampleRate || null,
      hls: dash.hls,
      segmentCount: dash.segmentCount,
      encrypted: false,
    };
  }
  throw new Error('Unknown manifest type: ' + mime);
}

module.exports = { parsePlaybackInfo, dashToHls, decodeManifest };
