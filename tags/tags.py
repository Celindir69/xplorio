# -*- coding: utf-8 -*-
"""Read and write tags (m4a, flac, mp3, dsf). Runs on Python 2.7 and 3.

Usage: python tags.py   -- job as JSON on stdin, response as JSON on stdout
  {"op":"read",  "path":"/mnt/USB/..."}
  {"op":"write", "path":"/mnt/USB/...", "tags":{"title":"...", "track":"3/12"}}
Fields: title artist album albumartist genre date composer track disc
With "write" only the given fields are changed; an empty value deletes the field.
Response of "write": {"ok":true, "before":{...}, "after":{...}} (before = previous values of the changed fields)

Cover (embedded front cover):
  {"op":"cover_get", "path":"..."}  -> {"ok":true, "mime":"image/jpeg", "data":"<base64>"} or {"ok":true, "mime":null}
  {"op":"cover_set", "path":"...", "image":"/path/image.jpg", "mime":"image/jpeg", "backup":"/path/backup"}
      replaces the front cover with the image file; without "image" it is removed. With "backup" the old cover
      is first saved to <backup>.jpg/.png. Response: {"ok":true, "changed":true, "backup":"<file>"|null}

All embedded images (DSF: MPD 0.20 ignores all tags of a file whose ID3 block is larger than 1 MB, big covers do that):
  {"op":"images_strip", "path":"...", "backup":"/path/backup"}
      saves every embedded image into the file's folder first (front cover as folder.jpg, else cover.jpg;
      back.jpg, booklet.jpg, cd.jpg, image.jpg; an image already there with the same content is not saved again,
      a name taken by another image gets " (2)"), keeps a copy of all of them for undo (<backup>-<k>.jpg/.png and
      <backup>.json), then removes them from the file.
      Response: {"ok":true, "changed":true, "manifest":"<backup>.json", "saved":[files], "images":n}
  {"op":"images_restore", "path":"...", "manifest":"<backup>.json"}  -> puts these images back (undo)

ReplayGain values (for the player view, read only):
  {"op":"replaygain", "path":"..."}  -> {"ok":true, "track":-6.53|null, "album":-7.1|null, "mqa":{"orig":192000|null}|null}
                                       (gain in dB; mqa: MQA file per its tags, orig = original sample rate)

Several jobs in one call (saves the Python startup per file, important with many files):
  {"op":"batch", "jobs":[{...}, {...}]}  -> {"ok":true, "results":[{...}, {...}]}  (one response per job as above)
"""
import base64
import json
import os
import signal
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'vendor'))

import mutagen  # noqa: E402
from mutagen.dsf import DSF  # noqa: E402
from mutagen.flac import FLAC  # noqa: E402
from mutagen.flac import Picture  # noqa: E402
from mutagen.id3 import (APIC, COMM, TALB, TCOM, TCON, TDRC, TIT2, TPE1, TPE2,  # noqa: E402
                         TPOS, TRCK)
from mutagen.mp3 import MP3  # noqa: E402
from mutagen.mp4 import MP4, MP4Cover  # noqa: E402

PY2 = sys.version_info[0] == 2
text_type = unicode if PY2 else str  # noqa: F821

FIELDS = ['title', 'artist', 'album', 'albumartist', 'genre', 'date', 'composer', 'track', 'disc', 'comment']

MP4_KEYS = {'title': '\xa9nam', 'artist': '\xa9ART', 'album': '\xa9alb', 'albumartist': 'aART',
            'genre': '\xa9gen', 'date': '\xa9day', 'composer': '\xa9wrt', 'comment': '\xa9cmt'}
FLAC_KEYS = {'title': 'title', 'artist': 'artist', 'album': 'album', 'albumartist': 'albumartist',
             'genre': 'genre', 'date': 'date', 'composer': 'composer',
             'track': 'tracknumber', 'disc': 'discnumber', 'comment': 'comment'}
ID3_FRAMES = {'title': TIT2, 'artist': TPE1, 'album': TALB, 'albumartist': TPE2,
              'genre': TCON, 'date': TDRC, 'composer': TCOM, 'track': TRCK, 'disc': TPOS}

SEP = u'; '


def id3_comments(tags):
    """ID3 comments without description; those with a description (e.g. iTunNORM from iTunes) are not notes"""
    return [fr for fr in tags.getall('COMM') if not fr.desc]


class JobError(Exception):
    pass


def fail(msg):
    raise JobError(msg)


def txt(v):
    return v if isinstance(v, text_type) else text_type(v)


def plain(v):
    # only text and numbers as tag value; null, lists etc. would otherwise be written as "None" or "[...]"
    return isinstance(v, (text_type, str, int, float)) and not isinstance(v, bool)


def join(values):
    return SEP.join(txt(v) for v in values)


def kind_of(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in ('.m4a', '.mp4', '.m4b'):
        return 'm4a'
    if ext == '.flac':
        return 'flac'
    if ext == '.mp3':
        return 'mp3'
    if ext == '.dsf':
        return 'dsf'
    return None


def open_file(path, kind):
    if kind == 'm4a':
        return MP4(path)
    if kind == 'flac':
        return FLAC(path)
    if kind == 'mp3':
        return MP3(path)
    return DSF(path)


def num_pair(t):
    """MP4: (3, 12) -> '3/12', (3, 0) -> '3'"""
    n, total = (list(t) + [0, 0])[:2]
    if not n:
        return u''
    return u'%d/%d' % (n, total) if total else u'%d' % n


def parse_pair(s):
    a, _, b = s.partition('/')
    try:
        return (int(a.strip() or 0), int(b.strip() or 0))
    except ValueError:
        raise ValueError(u'Invalid number: %s' % s)


def read_tags(audio, kind):
    out = dict((f, u'') for f in FIELDS)
    tags = audio.tags
    if tags is None:
        return out
    if kind == 'm4a':
        for f, k in MP4_KEYS.items():
            if k in tags:
                out[f] = join(tags[k])
        if 'trkn' in tags and tags['trkn']:
            out['track'] = num_pair(tags['trkn'][0])
        if 'disk' in tags and tags['disk']:
            out['disc'] = num_pair(tags['disk'][0])
    elif kind == 'flac':
        for f, k in FLAC_KEYS.items():
            if k in tags:
                out[f] = join(tags[k])
    else:
        for f, cls in ID3_FRAMES.items():
            fr = tags.get(cls.__name__)
            if fr is not None:
                out[f] = join(fr.text)
        com = id3_comments(tags)
        if com:
            out['comment'] = join(com[0].text)
    return out


def gain_of(v):
    """'-6.53 dB' -> -6.53; None if not a number"""
    try:
        return round(float(txt(v).strip().split()[0].replace(',', '.')), 2)
    except (ValueError, IndexError):
        return None


def read_replaygain(audio, kind):
    """REPLAYGAIN_TRACK_GAIN / _ALBUM_GAIN: Vorbis comment, MP4 freeform atom or ID3 TXXX (any case)"""
    found = {}
    tags = audio.tags
    if tags is None:
        return {'track': None, 'album': None, 'mqa': None}
    if kind == 'flac':
        for k, v in tags.items():
            found[k.lower()] = v[0] if isinstance(v, list) and v else v
    elif kind == 'm4a':
        for k, v in tags.items():
            if k.startswith('----:'):
                val = v[0] if isinstance(v, list) and v else v
                found[k.split(':')[-1].lower()] = val.decode('utf-8', 'replace') if isinstance(val, bytes) else val
    else:
        for fr in tags.getall('TXXX'):
            if fr.text:
                found[txt(fr.desc).lower()] = fr.text[0]
    return {'track': gain_of(found.get('replaygain_track_gain', '')),
            'album': gain_of(found.get('replaygain_album_gain', '')),
            'mqa': mqa_of(found)}


def mqa_of(found):
    """MQA file: its encoder writes MQAENCODER (or ENCODER "MQAEncode ...") and ORIGINALSAMPLERATE"""
    enc = txt(found.get('mqaencoder', '')) or ''
    if not enc and 'mqa' not in (txt(found.get('encoder', '')) or '').lower():
        return None
    orig = None
    for k in ('originalsamplerate', 'mqaoriginalsamplerate'):
        try:
            orig = int(float(txt(found.get(k, '')).strip()))
            break
        except (ValueError, AttributeError):
            pass
    return {'orig': orig if orig and orig > 0 else None}


def write_tags(audio, kind, new):
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    for f, v in new.items():
        v = txt(v).strip()
        if kind == 'm4a':
            if f in ('track', 'disc'):
                k = 'trkn' if f == 'track' else 'disk'
                if v:
                    tags[k] = [parse_pair(v)]
                elif k in tags:
                    del tags[k]
            else:
                k = MP4_KEYS[f]
                if v:
                    tags[k] = [v]
                elif k in tags:
                    del tags[k]
        elif kind == 'flac':
            k = FLAC_KEYS[f]
            if v:
                tags[k] = [v]
            elif k in tags:
                del tags[k]
        elif f == 'comment':
            for fr in id3_comments(tags):
                del tags[fr.HashKey]
            if v:
                tags.add(COMM(encoding=3, lang='eng', desc=u'', text=[v]))
        else:
            cls = ID3_FRAMES[f]
            tags.delall(cls.__name__)
            if v:
                tags.add(cls(encoding=3, text=[v]))


# ---------- Cover ----------

FRONT = 3     # picture type "Front Cover" (FLAC, ID3)
OTHER = 0     # "Other": some programs store the cover this way


def mime_of(data):
    return 'image/png' if data[:8] == b'\x89PNG\r\n\x1a\n' else 'image/jpeg'


def get_cover(audio, kind):
    """-> (bytes, mime) or (None, None); prefers the front cover"""
    if kind == 'm4a':
        covr = audio.tags.get('covr') if audio.tags is not None else None
        if covr:
            c = covr[0]
            return bytes(c), ('image/png' if c.imageformat == MP4Cover.FORMAT_PNG else 'image/jpeg')
        return None, None
    if kind == 'flac':
        pics = audio.pictures
    else:
        pics = audio.tags.getall('APIC') if audio.tags is not None else []
    if not pics:
        return None, None
    pics = sorted(pics, key=lambda p: 0 if p.type == FRONT else 1 if p.type == OTHER else 2)
    return pics[0].data, (pics[0].mime or mime_of(pics[0].data))


def set_cover(audio, kind, data, mime):
    """Replace the front cover (data=None: remove). Other images (e.g. back cover) are kept."""
    if kind == 'm4a':
        if audio.tags is None:
            audio.add_tags()
        if data is None:
            if 'covr' in audio.tags:
                del audio.tags['covr']
        else:
            fmt = MP4Cover.FORMAT_PNG if mime == 'image/png' else MP4Cover.FORMAT_JPEG
            audio.tags['covr'] = [MP4Cover(data, imageformat=fmt)]
    elif kind == 'flac':
        keep = [p for p in audio.pictures if p.type not in (FRONT, OTHER)]
        audio.clear_pictures()
        for p in keep:
            audio.add_picture(p)
        if data is not None:
            pic = Picture()
            pic.type = FRONT
            pic.mime = mime
            pic.desc = u''
            pic.data = data
            audio.add_picture(pic)
    else:
        if audio.tags is None:
            audio.add_tags()
        keep = [p for p in audio.tags.getall('APIC') if p.type not in (FRONT, OTHER)]
        audio.tags.delall('APIC')
        for p in keep:
            audio.tags.add(p)
        if data is not None:
            audio.tags.add(APIC(encoding=3, mime=mime, type=FRONT, desc=u'', data=data))


# picture types (ID3 APIC / FLAC): file names when saved into the folder; front cover first as folder.jpg
IMAGE_NAMES = {3: ['folder', 'cover'], 4: ['back'], 5: ['booklet'], 6: ['cd'], 0: ['image']}


def all_images(audio, kind):
    """-> [{'type', 'mime', 'desc', 'data'}] of all embedded images"""
    if kind == 'm4a':
        covr = audio.tags.get('covr') if audio.tags is not None else None
        return [{'type': FRONT if k == 0 else OTHER, 'desc': u'', 'data': bytes(c),
                 'mime': 'image/png' if c.imageformat == MP4Cover.FORMAT_PNG else 'image/jpeg'}
                for k, c in enumerate(covr or [])]
    pics = audio.pictures if kind == 'flac' else (audio.tags.getall('APIC') if audio.tags is not None else [])
    return [{'type': p.type, 'mime': p.mime or mime_of(p.data), 'desc': p.desc or u'', 'data': p.data} for p in pics]


def put_images(audio, kind, imgs):
    """replace all embedded images by imgs (empty: remove all)"""
    if kind == 'm4a':
        if audio.tags is None:
            audio.add_tags()
        if 'covr' in audio.tags:
            del audio.tags['covr']
        if imgs:
            audio.tags['covr'] = [MP4Cover(i['data'], imageformat=MP4Cover.FORMAT_PNG if i['mime'] == 'image/png'
                                           else MP4Cover.FORMAT_JPEG) for i in imgs]
    elif kind == 'flac':
        audio.clear_pictures()
        for i in imgs:
            pic = Picture()
            pic.type = i['type']
            pic.mime = i['mime']
            pic.desc = i['desc']
            pic.data = i['data']
            audio.add_picture(pic)
    else:
        if audio.tags is None:
            audio.add_tags()
        audio.tags.delall('APIC')
        for i in imgs:
            audio.tags.add(APIC(encoding=3, mime=i['mime'], type=i['type'], desc=i['desc'], data=i['data']))


def ext_of(mime):
    return '.png' if mime == 'image/png' else '.jpg'


def save_image(folder, img):
    """write the image into the folder under its name, unless the same image is already there -> file or None"""
    ext = ext_of(img['mime'])
    names = IMAGE_NAMES.get(img['type'], ['image-%d' % img['type']])
    tries = [n + ext for n in names] + ['%s (%d)%s' % (names[-1], k, ext) for k in range(2, 100)]
    for name in tries:
        target = os.path.join(folder, native(name))
        if os.path.lexists(target):
            if os.path.isfile(target) and not os.path.islink(target):
                with open(target, 'rb') as f:
                    if f.read() == img['data']:
                        return None                       # already there
            continue
        with open(target + native('.neu'), 'wb') as f:
            f.write(img['data'])
        os.rename(target + native('.neu'), target)
        return target
    raise ValueError('no free name for the image')


def strip_job(job, path, kind, audio):
    imgs = all_images(audio, kind)
    if not imgs:
        return {'ok': True, 'changed': False, 'saved': [], 'images': 0}
    base = native(job['backup'])
    d = os.path.dirname(base)
    if not os.path.isdir(d):
        os.makedirs(d)
    manifest = []
    for k, img in enumerate(imgs):                    # copy for undo, before anything changes
        f = base + native('-%d' % k + ext_of(img['mime']))
        with open(f, 'wb') as out:
            out.write(img['data'])
        manifest.append({'file': f.decode('utf-8') if PY2 else f,
                         'type': img['type'], 'mime': img['mime'], 'desc': img['desc']})
    with open(base + native('.json'), 'w') as out:
        out.write(json.dumps(manifest))
    saved = []
    for img in imgs:                                  # into the folder (fails before the file is changed)
        t = save_image(os.path.dirname(path), img)
        if t:
            saved.append(t.decode('utf-8') if PY2 else t)
    put_images(audio, kind, [])
    save(audio, kind)
    m = base + native('.json')
    return {'ok': True, 'changed': True, 'manifest': m.decode('utf-8') if PY2 else m,
            'saved': saved, 'images': len(imgs)}


def restore_job(job, path, kind, audio):
    with open(native(job['manifest'])) as f:
        manifest = json.loads(f.read())
    imgs = []
    for m in manifest:
        with open(native(m['file']), 'rb') as f:
            imgs.append({'type': m['type'], 'mime': m['mime'], 'desc': m['desc'], 'data': f.read()})
    put_images(audio, kind, imgs)
    save(audio, kind)
    return {'ok': True, 'changed': True}


def save(audio, kind):
    if kind == 'mp3':
        ver = audio.tags.version[1] if audio.tags.version[1] in (3, 4) else 4
        audio.save(v2_version=ver)
    else:
        audio.save()


def native(p):
    return p.encode('utf-8') if PY2 and isinstance(p, text_type) else p


def cover_job(job, path, kind, audio):
    old, old_mime = get_cover(audio, kind)
    if job['op'] == 'cover_has':
        return {'ok': True, 'has': old is not None}
    if job['op'] == 'cover_get':
        out = {'ok': True, 'mime': old_mime}
        if old is not None:
            out['data'] = base64.b64encode(old).decode('ascii')
        return out
    data, mime = None, None
    if job.get('image'):
        with open(native(job['image']), 'rb') as f:
            data = f.read()
        mime = job.get('mime') or mime_of(data)
    if data == old or (data is None and old is None):
        return {'ok': True, 'changed': False, 'backup': None}
    backup = None
    if old is not None and job.get('backup'):
        backup = job['backup'] + ('.png' if old_mime == 'image/png' else '.jpg')
        d = os.path.dirname(native(backup))
        if not os.path.isdir(d):
            os.makedirs(d)
        with open(native(backup), 'wb') as f:
            f.write(old)
    set_cover(audio, kind, data, mime)
    save(audio, kind)
    return {'ok': True, 'changed': True, 'backup': backup}


def run_job(job):
    path = job.get('path')
    op = job.get('op')
    if not path or op not in ('read', 'write', 'cover_get', 'cover_has', 'cover_set', 'replaygain',
                              'images_strip', 'images_restore'):
        fail('invalid job')
    if PY2 and isinstance(path, text_type):
        path = path.encode('utf-8')
    kind = kind_of(path)
    if not kind:
        fail('file type not supported')
    if not os.path.isfile(path):
        fail('file not found')
    try:
        audio = open_file(path, kind)
        if op.startswith('cover_'):
            return cover_job(job, path, kind, audio)
        if op == 'images_strip':
            return strip_job(job, path, kind, audio)
        if op == 'images_restore':
            return restore_job(job, path, kind, audio)
        if op == 'replaygain':
            return dict(read_replaygain(audio, kind), ok=True)
        before = read_tags(audio, kind)
        if op == 'read':
            return {'ok': True, 'format': kind, 'tags': before}
        new = dict((f, v) for f, v in (job.get('tags') or {}).items() if f in FIELDS and plain(v))
        new = dict((f, v) for f, v in new.items() if txt(v).strip() != before[f])
        if not new:
            return {'ok': True, 'changed': False, 'before': {}, 'after': {}}
        write_tags(audio, kind, new)
        save(audio, kind)
        after = read_tags(open_file(path, kind), kind)
        return {'ok': True, 'changed': True,
                'before': dict((f, before[f]) for f in new),
                'after': dict((f, after[f]) for f in new)}
    except ValueError as e:
        fail(txt(e))
    except (mutagen.MutagenError, IOError, OSError) as e:
        fail(txt(e))


# SIGTERM from the tag service (timeout): finish writing the current file, skip the rest.
# Aborting hard could leave an m4a or mp3 file half written.
STOP = []


def on_term(signum, frame):
    STOP.append(signum)


def safe_job(job):
    if STOP:
        return {'ok': False, 'error': 'aborted (timeout)'}
    try:
        return run_job(job if isinstance(job, dict) else {})
    except JobError as e:
        return {'ok': False, 'error': e.args[0]}
    except Exception as e:                    # one broken job must not take down the others in the batch
        return {'ok': False, 'error': txt(e) or e.__class__.__name__}


def main():
    signal.signal(signal.SIGTERM, on_term)
    try:
        job = json.loads(sys.stdin.read())
    except ValueError:
        job = None
    if not isinstance(job, dict):
        out = {'ok': False, 'error': 'invalid job'}
    elif job.get('op') == 'batch':
        out = {'ok': True, 'results': [safe_job(j) for j in (job.get('jobs') or [])]}
    else:
        out = safe_job(job)
    sys.stdout.write(json.dumps(out))
    sys.exit(0 if out.get('ok') else 1)


if __name__ == '__main__':
    main()
