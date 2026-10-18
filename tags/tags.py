# -*- coding: utf-8 -*-
"""Tags lesen und schreiben (m4a, flac, mp3, dsf). Läuft mit Python 2.7 und 3.

Aufruf: python tags.py   -- Auftrag als JSON auf stdin, Antwort als JSON auf stdout
  {"op":"read",  "path":"/mnt/USB/..."}
  {"op":"write", "path":"/mnt/USB/...", "tags":{"title":"...", "track":"3/12"}}
Felder: title artist album albumartist genre date composer track disc
Bei "write" werden nur die genannten Felder geändert; ein leerer Wert löscht das Feld.
Antwort von "write": {"ok":true, "before":{...}, "after":{...}} (before = Werte der geänderten Felder vorher)

Cover (eingebettetes Frontcover):
  {"op":"cover_get", "path":"..."}  -> {"ok":true, "mime":"image/jpeg", "data":"<base64>"} oder {"ok":true, "mime":null}
  {"op":"cover_set", "path":"...", "image":"/pfad/bild.jpg", "mime":"image/jpeg", "backup":"/pfad/sicherung"}
      ersetzt das Frontcover durch die Bilddatei; ohne "image" wird es entfernt. Mit "backup" wird das alte Cover
      vorher nach <backup>.jpg/.png gesichert. Antwort: {"ok":true, "changed":true, "backup":"<datei>"|null}

Mehrere Aufträge in einem Aufruf (spart den Python-Start je Datei, wichtig bei vielen Dateien):
  {"op":"batch", "jobs":[{...}, {...}]}  -> {"ok":true, "results":[{...}, {...}]}  (je Auftrag eine Antwort wie oben)
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
    """ID3-Kommentare ohne Beschreibung; solche mit Beschreibung (z. B. iTunNORM von iTunes) sind keine Notizen"""
    return [fr for fr in tags.getall('COMM') if not fr.desc]


class JobError(Exception):
    pass


def fail(msg):
    raise JobError(msg)


def txt(v):
    return v if isinstance(v, text_type) else text_type(v)


def plain(v):
    # nur Text und Zahlen als Tag-Wert; null, Listen o. Ä. würden sonst als "None" bzw. "[...]" geschrieben
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
        raise ValueError(u'Ungültige Nummer: %s' % s)


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

FRONT = 3     # Bildtyp "Front Cover" (FLAC, ID3)
OTHER = 0     # "Other": manche Programme legen das Cover so ab


def mime_of(data):
    return 'image/png' if data[:8] == b'\x89PNG\r\n\x1a\n' else 'image/jpeg'


def get_cover(audio, kind):
    """-> (bytes, mime) oder (None, None); bevorzugt das Frontcover"""
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
    """Frontcover ersetzen (data=None: entfernen). Andere Bilder (z. B. Rückseite) bleiben."""
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
    if not path or op not in ('read', 'write', 'cover_get', 'cover_has', 'cover_set'):
        fail('Ungültiger Auftrag')
    if PY2 and isinstance(path, text_type):
        path = path.encode('utf-8')
    kind = kind_of(path)
    if not kind:
        fail('Dateityp nicht unterstützt')
    if not os.path.isfile(path):
        fail('Datei nicht gefunden')
    try:
        audio = open_file(path, kind)
        if op.startswith('cover_'):
            return cover_job(job, path, kind, audio)
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


# SIGTERM vom Tag-Dienst (Zeitüberschreitung): die laufende Datei fertig schreiben, die übrigen auslassen.
# Hartes Abbrechen könnte eine m4a- oder mp3-Datei halb geschrieben zurücklassen.
STOP = []


def on_term(signum, frame):
    STOP.append(signum)


def safe_job(job):
    if STOP:
        return {'ok': False, 'error': 'abgebrochen (Zeitüberschreitung)'}
    try:
        return run_job(job if isinstance(job, dict) else {})
    except JobError as e:
        return {'ok': False, 'error': e.args[0]}
    except Exception as e:                    # ein kaputter Auftrag soll die anderen im Stapel nicht mitreißen
        return {'ok': False, 'error': txt(e) or e.__class__.__name__}


def main():
    signal.signal(signal.SIGTERM, on_term)
    try:
        job = json.loads(sys.stdin.read())
    except ValueError:
        job = None
    if not isinstance(job, dict):
        out = {'ok': False, 'error': 'Ungültiger Auftrag'}
    elif job.get('op') == 'batch':
        out = {'ok': True, 'results': [safe_job(j) for j in (job.get('jobs') or [])]}
    else:
        out = safe_job(job)
    sys.stdout.write(json.dumps(out))
    sys.exit(0 if out.get('ok') else 1)


if __name__ == '__main__':
    main()
